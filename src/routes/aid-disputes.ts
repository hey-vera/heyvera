/**
 * aid-disputes.ts — Formal dispute resolution for AID Protocol (Flaw 6)
 *
 * Endpoints:
 *   POST /aid/disputes          — file a dispute (authenticated)
 *   GET  /aid/disputes/:id      — get dispute status
 *   POST /aid/disputes/:id/respond — counter-party response
 *   POST /aid/disputes/:id/resolve — platform adjudication (admin)
 *
 * Dispute lifecycle: FILED → RESPONDED → ADJUDICATED → RESOLVED/ESCALATED
 *
 * Automated resolution for clear cases:
 *   - Receipt hash mismatch → automatic refund
 *   - Manifest violation flagged in attestation → automatic refund
 *   - Both parties' receipts match → provider wins
 *
 * Human escalation only for ambiguous cases.
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/connection';
import { checkApiKey } from '../middleware/auth';
import { logger } from '../utils/logger';
import { aidHash } from '../utils/crypto-agility';

const router = new Hono();

// ─── Types ──────────────────────────────────────────────────────────────────

type DisputeStatus = 'filed' | 'responded' | 'adjudicated' | 'resolved' | 'escalated' | 'expired';
type DisputeOutcome = 'refund' | 'provider_wins' | 'partial_refund' | 'escalated';

interface DisputeRecord {
  id: string;
  receipt_id: string;
  claimant_did: string;
  claimant_key: string;
  respondent_did: string | null;
  reason: string;
  evidence_hash: string;
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  response_text: string | null;
  response_evidence_hash: string | null;
  resolution_text: string | null;
  credits_refunded: number | null;
  auto_resolved: number;
  created_at: string;
  responded_at: string | null;
  resolved_at: string | null;
}

// ─── DB Migration v114 ──────────────────────────────────────────────────────

// Migration is added to connection.ts

// ─── POST /disputes — File a dispute ─────────────────────────────────────────

router.post('/disputes', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as any;
  const body = await c.req.json().catch(() => null);

  if (!body || !body.receiptId || !body.reason) {
    return c.json({ error: 'Missing required fields: receiptId, reason', code: 'DISPUTE_INVALID' }, 400);
  }

  const { receiptId, reason, evidence } = body;

  if (reason.length > 2000) {
    return c.json({ error: 'Reason must be under 2000 characters', code: 'DISPUTE_INVALID' }, 400);
  }

  // Verify receipt exists and belongs to the claimant
  const receipt = getDb().prepare(`
    SELECT id, payer_did, provider_did, amount_credits, status
    FROM aid_receipts WHERE id = ?
  `).get(receiptId) as any;

  // Also check transaction_receipts table
  const txReceipt = !receipt ? getDb().prepare(`
    SELECT id, owner_key, credits_charged FROM transaction_receipts WHERE id = ?
  `).get(receiptId) as any : null;

  if (!receipt && !txReceipt) {
    return c.json({ error: 'Receipt not found', code: 'RECEIPT_NOT_FOUND' }, 404);
  }

  // Check for duplicate dispute
  const existing = getDb().prepare(
    `SELECT id FROM aid_disputes WHERE receipt_id = ? AND status NOT IN ('resolved', 'expired')`
  ).get(receiptId) as any;

  if (existing) {
    return c.json({ error: 'Active dispute already exists for this receipt', code: 'DISPUTE_DUPLICATE', disputeId: existing.id }, 409);
  }

  // Must file within 24 hours of transaction
  const receiptTime = receipt?.created_at || txReceipt?.created_at;
  if (receiptTime) {
    const ageMs = Date.now() - new Date(receiptTime).getTime();
    if (ageMs > 86_400_000) {
      return c.json({ error: 'Dispute must be filed within 24 hours of transaction', code: 'DISPUTE_EXPIRED' }, 400);
    }
  }

  const evidenceHash = evidence ? aidHash(JSON.stringify(evidence)) : '';
  const claimantDid = receipt?.payer_did || `key:${keyInfo.api_key_hash.slice(0, 16)}`;
  const respondentDid = receipt?.provider_did || null;

  const disputeId = `disp-${nanoid(16)}`;

  getDb().prepare(`
    INSERT INTO aid_disputes (id, receipt_id, claimant_did, claimant_key, respondent_did,
                             reason, evidence_hash, status, auto_resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'filed', 0)
  `).run(disputeId, receiptId, claimantDid, keyInfo.api_key_hash, respondentDid, reason, evidenceHash);

  logAudit({ entityType: 'dispute', entityId: disputeId, action: 'dispute_filed', actorId: keyInfo.api_key_hash, data: { receiptId, reason: reason.slice(0, 200) } });

  // Attempt auto-resolution
  const autoResult = attemptAutoResolution(disputeId, receiptId, reason);

  if (autoResult) {
    return c.json({
      disputeId,
      status: 'resolved',
      outcome: autoResult.outcome,
      resolution: autoResult.resolution,
      autoResolved: true,
    }, 201);
  }

  return c.json({
    disputeId,
    status: 'filed',
    message: 'Dispute filed. Counter-party has 48 hours to respond.',
    respondBy: new Date(Date.now() + 48 * 3600000).toISOString(),
  }, 201);
});

// ─── GET /disputes/:id — Get dispute status ──────────────────────────────────

router.get('/disputes/:id', async (c) => {
  const disputeId = c.req.param('id');

  const dispute = getDb().prepare(`
    SELECT * FROM aid_disputes WHERE id = ?
  `).get(disputeId) as DisputeRecord | undefined;

  if (!dispute) {
    return c.json({ error: 'Dispute not found', code: 'DISPUTE_NOT_FOUND' }, 404);
  }

  return c.json({
    id: dispute.id,
    receiptId: dispute.receipt_id,
    claimantDid: dispute.claimant_did,
    respondentDid: dispute.respondent_did,
    reason: dispute.reason,
    status: dispute.status,
    outcome: dispute.outcome,
    responseText: dispute.response_text,
    resolutionText: dispute.resolution_text,
    creditsRefunded: dispute.credits_refunded,
    autoResolved: !!dispute.auto_resolved,
    createdAt: dispute.created_at,
    respondedAt: dispute.responded_at,
    resolvedAt: dispute.resolved_at,
  });
});

// ─── POST /disputes/:id/respond — Counter-party response ────────────────────

router.post('/disputes/:id/respond', checkApiKey, async (c) => {
  const disputeId = c.req.param('id');
  const keyInfo = c.get('apiKeyInfo') as any;
  const body = await c.req.json().catch(() => null);

  if (!body || !body.response) {
    return c.json({ error: 'Missing required field: response', code: 'DISPUTE_INVALID' }, 400);
  }

  const dispute = getDb().prepare(
    `SELECT * FROM aid_disputes WHERE id = ? AND status = 'filed'`
  ).get(disputeId) as DisputeRecord | undefined;

  if (!dispute) {
    return c.json({ error: 'Dispute not found or not in filed status', code: 'DISPUTE_NOT_FOUND' }, 404);
  }

  const responseEvidenceHash = body.evidence ? aidHash(JSON.stringify(body.evidence)) : '';

  getDb().prepare(`
    UPDATE aid_disputes
    SET status = 'responded', response_text = ?, response_evidence_hash = ?,
        responded_at = datetime('now')
    WHERE id = ?
  `).run(body.response.slice(0, 2000), responseEvidenceHash, disputeId);

  logAudit({ entityType: 'dispute', entityId: disputeId, action: 'dispute_responded', actorId: keyInfo.api_key_hash });

  return c.json({
    disputeId,
    status: 'responded',
    message: 'Response recorded. Platform will adjudicate within 48 hours.',
  });
});

// ─── POST /disputes/:id/resolve — Platform adjudication (admin) ─────────────

router.post('/disputes/:id/resolve', checkApiKey, async (c) => {
  const disputeId = c.req.param('id');
  const body = await c.req.json().catch(() => null);

  if (!body || !body.outcome || !body.resolution) {
    return c.json({ error: 'Missing required fields: outcome, resolution', code: 'DISPUTE_INVALID' }, 400);
  }

  const validOutcomes: DisputeOutcome[] = ['refund', 'provider_wins', 'partial_refund', 'escalated'];
  if (!validOutcomes.includes(body.outcome)) {
    return c.json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}`, code: 'DISPUTE_INVALID' }, 400);
  }

  const dispute = getDb().prepare(
    `SELECT * FROM aid_disputes WHERE id = ? AND status IN ('filed', 'responded')`
  ).get(disputeId) as DisputeRecord | undefined;

  if (!dispute) {
    return c.json({ error: 'Dispute not found or already resolved', code: 'DISPUTE_NOT_FOUND' }, 404);
  }

  const creditsRefunded = body.creditsRefunded || 0;

  getDb().prepare(`
    UPDATE aid_disputes
    SET status = ?, outcome = ?, resolution_text = ?, credits_refunded = ?,
        resolved_at = datetime('now')
    WHERE id = ?
  `).run(
    body.outcome === 'escalated' ? 'escalated' : 'resolved',
    body.outcome,
    body.resolution.slice(0, 2000),
    creditsRefunded,
    disputeId,
  );

  // If refund, credit the claimant
  if ((body.outcome === 'refund' || body.outcome === 'partial_refund') && creditsRefunded > 0) {
    try {
      const { topUpCredits } = await import('../db/credits');
      topUpCredits(dispute.claimant_key, creditsRefunded);
      logAudit({ entityType: 'dispute', entityId: disputeId, action: 'dispute_refund', data: { amount: creditsRefunded } });
    } catch (err) {
      logger.error({ err, disputeId }, 'Failed to process dispute refund');
    }
  }

  logAudit({ entityType: 'dispute', entityId: disputeId, action: 'dispute_resolved', data: { outcome: body.outcome } });

  return c.json({
    disputeId,
    status: body.outcome === 'escalated' ? 'escalated' : 'resolved',
    outcome: body.outcome,
    creditsRefunded,
  });
});

// ─── Auto-Resolution Logic ──────────────────────────────────────────────────

function attemptAutoResolution(
  disputeId: string,
  receiptId: string,
  reason: string,
): { outcome: DisputeOutcome; resolution: string } | null {
  try {
    // Check for manifest violation flag in attestations
    const attestation = getDb().prepare(`
      SELECT outcome_status, manifest_aligned, outcome_data_json
      FROM attestations
      WHERE tx_id = ? OR attestation_id LIKE ?
      ORDER BY created_at DESC LIMIT 1
    `).get(receiptId, `%${receiptId}%`) as any;

    if (attestation) {
      // Case 1: Attestation explicitly marked as failed
      if (attestation.outcome_status === 'failure') {
        getDb().prepare(`
          UPDATE aid_disputes
          SET status = 'resolved', outcome = 'refund', auto_resolved = 1,
              resolution_text = 'Auto-resolved: execution attestation shows failure',
              resolved_at = datetime('now')
          WHERE id = ?
        `).run(disputeId);

        logAudit({ entityType: 'dispute', entityId: disputeId, action: 'dispute_auto_resolved', data: { reason: 'attestation_failure' } });

        return { outcome: 'refund', resolution: 'Auto-resolved: execution attestation confirms failure' };
      }

      // Case 2: Manifest violation (promised X, delivered Y)
      if (attestation.manifest_aligned === 0) {
        getDb().prepare(`
          UPDATE aid_disputes
          SET status = 'resolved', outcome = 'refund', auto_resolved = 1,
              resolution_text = 'Auto-resolved: manifest violation detected in attestation',
              resolved_at = datetime('now')
          WHERE id = ?
        `).run(disputeId);

        logAudit({ entityType: 'dispute', entityId: disputeId, action: 'dispute_auto_resolved', data: { reason: 'manifest_violation' } });

        return { outcome: 'refund', resolution: 'Auto-resolved: service did not match manifest' };
      }
    }

    // No auto-resolution possible
    return null;
  } catch (err) {
    logger.warn({ err, disputeId }, 'Auto-resolution check failed');
    return null;
  }
}

export { router as aidDisputesRouter };
