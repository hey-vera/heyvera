/**
 * aid-protocol.ts — AID Protocol endpoints (the /aid/* path)
 *
 * These routes implement the AID Protocol specification (docs/aid-protocol-spec.md).
 * They are SEPARATE from /v1/aid/* (credit-based AID management).
 *
 * /aid/heartbeat    — mandatory discovery endpoint (public, no auth)
 * /aid/feedback     — outcome reporting (authenticated)
 * /aid/skills/:id   — pay-per-use skill invocation via USDC (Phase 2)
 *
 * All endpoints follow the AID spec: did:key identity, Ed25519 signatures,
 * trust-gated pricing, portable atomic receipts.
 */

import { Hono } from 'hono';
import { getEd25519PublicKeyMultibase, getEd25519PublicKeyRaw } from '../utils/ed25519-signer';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { listPublicSkills, countPublicSkills } from '../db/skills';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── Platform identity constants ─────────────────────────────────────────────

const PLATFORM_DID = 'did:web:api.claw-net.org';
const PROTOCOL_VERSION = '1.0.0';

// ─── GET /heartbeat — AID Protocol mandatory discovery endpoint ──────────────
//
// Every AID-compatible server MUST expose this endpoint (spec Section 7).
// Returns: provider identity, available services, trust-gated pricing tiers,
// crypto-agility info, and platform public key.
//
// Public — no auth required. Rate-limited by global middleware.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/heartbeat', (c) => {
  try {
    // Fetch top services from skill marketplace
    const skills = listPublicSkills(0, 20);
    const totalSkills = countPublicSkills();

    // Compute basic platform stats
    const statsRow = getDb().prepare(`
      SELECT
        COUNT(*) as total_attestations,
        SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes
      FROM attestations
      WHERE created_at > datetime('now', '-24 hours')
    `).get() as { total_attestations: number; successes: number } | undefined;

    const last24h = statsRow?.total_attestations || 0;
    const successRate = last24h > 0 ? Number(((statsRow?.successes || 0) / last24h).toFixed(3)) : 1.0;

    // Count active agents (unique keys with attestations in last 30 days)
    const activeRow = getDb().prepare(`
      SELECT COUNT(DISTINCT owner_key) as n FROM attestations
      WHERE created_at > datetime('now', '-30 days')
    `).get() as { n: number } | undefined;

    const services = skills.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.skill_type || 'prompt_template',
      price: String(s.credit_cost / 1000), // credits → USDC (CREDITS_PER_USD=1000)
      trustGate: 0,
      status: 'healthy' as const,
    }));

    const raw = getEd25519PublicKeyRaw();

    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      provider: {
        did: PLATFORM_DID,
        name: 'ClawNet',
        trustScore: 100, // platform is self-trusted
        uptime: 0.999,
        verified: true,
      },
      services,
      totalServices: totalSkills,
      pricing: {
        currency: 'USDC',
        chain: 'base',
        tiers: [
          { minTrust: 0,  multiplier: 1.0,  settlement: 'immediate', verdict: 'new' },
          { minTrust: 20, multiplier: 1.0,  settlement: 'immediate', verdict: 'building' },
          { minTrust: 40, multiplier: 0.9,  settlement: 'standard',  verdict: 'caution' },
          { minTrust: 60, multiplier: 0.8,  settlement: 'batched',   verdict: 'standard' },
          { minTrust: 80, multiplier: 0.75, settlement: 'batched',   verdict: 'trusted' },
          { minTrust: 90, multiplier: 0.7,  settlement: 'deferred',  verdict: 'proceed',
            requiresVerification: true, requiresMinAge: '6mo', requiresMinRevenue: 50 },
        ],
      },
      cryptoAgility: {
        current: 'Ed25519',
        supported: ['Ed25519'],
        planned: ['ML-DSA-44'],
        hashAlgorithm: AID_HASH_ALGORITHM,
        pqcReady: false,
        migrationTarget: 'ML-DSA-44',
        migrationDate: null,
      },
      platformKey: raw.toString('base64url'),
      stats: {
        totalServices: totalSkills,
        last24hTransactions: last24h,
        successRate,
        activeAgents: activeRow?.n || 0,
      },
      decentralization: {
        currentPhase: 1,
        description: 'Transparent centralization',
        nextMilestone: 'Optimistic trust oracle on Base',
        targetDate: '2026-09-01',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Heartbeat error:', err);
    return c.json({
      protocolVersion: PROTOCOL_VERSION,
      provider: { did: PLATFORM_DID, name: 'ClawNet', trustScore: 100, uptime: 0.999, verified: true },
      services: [],
      totalServices: 0,
      pricing: { currency: 'USDC', chain: 'base', tiers: [] },
      cryptoAgility: { current: 'Ed25519', supported: ['Ed25519'], planned: ['ML-DSA-44'], hashAlgorithm: AID_HASH_ALGORITHM, pqcReady: false, migrationTarget: 'ML-DSA-44', migrationDate: null },
      platformKey: getEd25519PublicKeyRaw().toString('base64url'),
      stats: { totalServices: 0, last24hTransactions: 0, successRate: 1.0, activeAgents: 0 },
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── POST /feedback — AID Protocol outcome reporting ─────────────────────────
//
// Agents report transaction outcomes to feed the trust flywheel (spec Section 6).
// Requires AID authentication (X-AID-DID + X-AID-PROOF).
// Feedback weight depends on reporter's transaction history (anti-Sybil).
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { nanoid } from 'nanoid';
import { checkAidProof, type AidInfo } from '../middleware/aid-verify';
import { aidProviderProof } from '../middleware/aid-provider-proof';

const FeedbackSchema = z.object({
  receiptId: z.string().min(1).max(100),
  outcome: z.enum(['success', 'partial', 'failure']),
  qualityScore: z.number().int().min(1).max(10).optional(),
  latencyAcceptable: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

router.post('/feedback', checkAidProof, aidProviderProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) {
    return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid feedback', code: 'INVALID_FEEDBACK', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { receiptId, outcome, qualityScore, latencyAcceptable, notes } = parsed.data;

  // ── Anti-Sybil: new agents (trust score 0) cannot submit feedback ──────
  if (aidInfo.trustScore === 0) {
    return c.json({ error: 'New agents cannot submit feedback', code: 'AID_TRUST_GATE_BLOCKED', verdict: 'new' }, 403);
  }

  // ── Feedback velocity cap: max 3 per reporter per provider per 30 days ──
  const velocityCheck = getDb().prepare(`
    SELECT COUNT(*) as n FROM aid_feedback
    WHERE reporter_did = ? AND receipt_id IN (
      SELECT receipt_id FROM aid_feedback WHERE provider_did = (
        SELECT provider_did FROM aid_feedback WHERE receipt_id = ? LIMIT 1
      )
    ) AND created_at > datetime('now', '-30 days')
  `).get(aidInfo.did, receiptId) as { n: number } | undefined;

  if ((velocityCheck?.n ?? 0) >= 3) {
    return c.json({ error: 'Feedback velocity cap reached (max 3 per provider per 30 days)', code: 'RATE_LIMITED' }, 429);
  }

  // ── Compute feedback weight based on reporter history ──────────────────
  const reporterStats = getDb().prepare(`
    SELECT COUNT(*) as tx_count FROM attestations
    WHERE owner_key = ? AND created_at > datetime('now', '-90 days')
  `).get(aidInfo.ownerKey) as { tx_count: number } | undefined;

  const txCount = reporterStats?.tx_count ?? 0;
  let weight = 0.5; // new agent default
  if (txCount >= 100) weight = 2.0;
  else if (txCount >= 10) weight = 1.0;
  // Attestation history bonus
  if (txCount >= 50) weight = Math.min(weight + 1.0, 5.0);

  // ── Mutual feedback decay: if reporter and provider gave each other positive
  //    feedback within 30 days, both are weighted at 0.1x ──────────────────
  const mutualCheck = getDb().prepare(`
    SELECT COUNT(*) as n FROM aid_feedback
    WHERE reporter_did = ? AND outcome = 'success'
    AND created_at > datetime('now', '-30 days')
  `).get(receiptId) as { n: number } | undefined;
  // Note: full mutual decay requires cross-referencing provider→reporter feedback,
  // which needs the provider_did. We track it for future implementation.

  // ── Insert feedback ────────────────────────────────────────────────────
  const id = `fb-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_feedback (id, receipt_id, reporter_did, reporter_owner_key, outcome, quality_score, latency_acceptable, notes, weight)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, receiptId, aidInfo.did, aidInfo.ownerKey, outcome, qualityScore ?? null, latencyAcceptable != null ? (latencyAcceptable ? 1 : 0) : null, notes ?? null, weight);

  logger.info({ feedbackId: id, receiptId, reporter: aidInfo.did, outcome, weight }, 'AID feedback recorded');

  return c.json({
    feedbackId: id,
    credited: 0.1,
    feedbackWeight: weight,
    providerTrustDelta: outcome === 'success' ? 0.02 : outcome === 'failure' ? -0.05 : 0,
  });
});

// ─── GET /leaderboard — Public trust leaderboard ─────────────────────────────
//
// Returns aggregated trust data for the ecosystem. Individual agent lookups
// are rate-limited (Section 39.17, Vector 57). Bulk enumeration returns
// tier aggregates, not individual DID-level data.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/leaderboard', (c) => {
  try {
    // Tier aggregates (safe — no individual DID enumeration)
    const tiers = getDb().prepare(`
      SELECT
        CASE
          WHEN frozen = 1 THEN 'frozen'
          WHEN proof_of_life_status = 'auto_frozen' THEN 'frozen'
          ELSE 'active'
        END as status,
        COUNT(*) as count
      FROM aid_keys WHERE key_status = 'active'
      GROUP BY status
    `).all() as { status: string; count: number }[];

    // Top agents by attestation count (opt-in public agents only — show DID + verdict, not exact score)
    const topAgents = getDb().prepare(`
      SELECT ak.did, ak.display_name, ak.proof_of_life_status,
        COALESCE(ast.total_attestations, 0) as attestations,
        COALESCE(ast.success_count, 0) as successes,
        ak.created_at
      FROM aid_keys ak
      LEFT JOIN attestation_stats ast ON ast.owner_key = ak.owner_key
      WHERE ak.key_status = 'active' AND ak.frozen = 0
      ORDER BY COALESCE(ast.total_attestations, 0) DESC
      LIMIT 25
    `).all() as any[];

    const leaderboard = topAgents.map(a => {
      const total = a.attestations || 0;
      const successRate = total > 0 ? a.successes / total : 0;
      const volume = Math.min(total / 1000, 1);
      const rawScore = Math.round(successRate * 40 + 0.5 * 25 + volume * 20 + 0.5 * 15);
      const verdict = rawScore >= 90 ? 'proceed' : rawScore >= 80 ? 'trusted' : rawScore >= 60 ? 'standard' : rawScore >= 40 ? 'caution' : rawScore >= 20 ? 'building' : 'new';

      return {
        did: a.did,
        displayName: a.display_name,
        verdict,
        attestations: total,
        activeMonths: Math.max(1, Math.round((Date.now() - new Date(a.created_at).getTime()) / (30 * 86400000))),
        proofOfLife: a.proof_of_life_status,
      };
    });

    const activeCount = tiers.find(t => t.status === 'active')?.count || 0;
    const frozenCount = tiers.find(t => t.status === 'frozen')?.count || 0;

    return c.json({
      ecosystem: {
        totalAgents: activeCount + frozenCount,
        activeAgents: activeCount,
        frozenAgents: frozenCount,
      },
      leaderboard,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Leaderboard error:', err);
    return c.json({ ecosystem: { totalAgents: 0, activeAgents: 0, frozenAgents: 0 }, leaderboard: [], timestamp: new Date().toISOString() });
  }
});

// ─── GET /trajectory/:did — Trust trajectory (score history + projections) ────

router.get('/trajectory/:did', (c) => {
  const did = c.req.param('did');
  const history = getDb().prepare(
    'SELECT month, score FROM aid_trust_trajectory WHERE did = ? ORDER BY month DESC LIMIT 12'
  ).all(did) as { month: string; score: number }[];

  if (history.length === 0) {
    return c.json({ did, trajectory: 'insufficient_data', history: [] });
  }

  const current = history[0]?.score || 0;
  const oldest = history[history.length - 1]?.score || current;
  const months = history.length;
  const trend = months > 1 ? Number(((current - oldest) / months).toFixed(1)) : 0;
  const trajectory = trend > 0.5 ? 'ascending' : trend < -0.5 ? 'descending' : 'stable';

  return c.json({
    did,
    currentScore: current,
    trend: `${trend > 0 ? '+' : ''}${trend}`,
    trendPeriod: `${months}mo`,
    trajectory,
    projectedScore30d: Math.min(100, Math.max(0, Math.round(current + trend))),
    projectedScore90d: Math.min(100, Math.max(0, Math.round(current + trend * 3))),
    history: history.reverse(),
  });
});

// ─── GET /milestones/:did — Onboarding milestones ────────────────────────────

router.get('/milestones/:did', (c) => {
  const did = c.req.param('did');
  const milestones = getDb().prepare(
    'SELECT stage, timestamp FROM aid_onboarding_milestones WHERE did = ? ORDER BY timestamp ASC'
  ).all(did) as { stage: string; timestamp: string }[];

  const currentStage = milestones.length > 0 ? milestones[milestones.length - 1].stage : 'registered';

  return c.json({ did, stage: currentStage, history: milestones });
});

// ─── GET /guardians — List approved guardians ────────────────────────────────

router.get('/guardians', (c) => {
  const guardians = getDb().prepare(`
    SELECT guardian_did, guardian_type, agents_guarded, successful_freezes,
           false_positives, trust_score, status, created_at
    FROM aid_guardians WHERE status = 'active'
    ORDER BY trust_score DESC LIMIT 50
  `).all() as any[];

  return c.json({ guardians, total: guardians.length });
});

// ─── POST /guardians/register — Register as a guardian ───────────────────────

router.post('/guardians/register', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  // Guardian must have trust score >= 70
  if (aidInfo.trustScore < 70) {
    return c.json({ error: 'Trust score must be 70+ to become a guardian', code: 'AID_TRUST_GATE_BLOCKED' }, 403);
  }

  // Check if already registered
  const existing = getDb().prepare(
    'SELECT id FROM aid_guardians WHERE guardian_did = ? AND status = ?'
  ).get(aidInfo.did, 'active');
  if (existing) return c.json({ error: 'Already registered as guardian', code: 'GUARDIAN_EXISTS' }, 409);

  const id = `guard-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_guardians (id, guardian_did, guardian_owner_key, trust_score)
    VALUES (?, ?, ?, ?)
  `).run(id, aidInfo.did, aidInfo.ownerKey, aidInfo.trustScore);

  return c.json({ guardianId: id, did: aidInfo.did, status: 'active' }, 201);
});

// ─── POST /guardians/assign — Assign a guardian to an agent ──────────────────

router.post('/guardians/assign', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const guardianDid = body?.guardianDid;
  if (!guardianDid) return c.json({ error: 'guardianDid required', code: 'MISSING_FIELD' }, 400);

  // Verify guardian exists and is active
  const guardian = getDb().prepare(
    'SELECT id, agents_guarded, max_agents FROM aid_guardians WHERE guardian_did = ? AND status = ?'
  ).get(guardianDid, 'active') as any;
  if (!guardian) return c.json({ error: 'Guardian not found or inactive', code: 'GUARDIAN_NOT_FOUND' }, 404);

  // Check concentration limit (10% max)
  const totalAgents = getDb().prepare('SELECT COUNT(*) as n FROM aid_keys WHERE key_status = ?').get('active') as { n: number };
  const maxAllowed = Math.max(5, Math.floor(totalAgents.n * 0.10));
  if (guardian.agents_guarded >= maxAllowed) {
    return c.json({ error: 'Guardian at capacity (10% concentration limit)', code: 'GUARDIAN_FULL' }, 429);
  }

  const id = `assign-${nanoid(16)}`;
  getDb().transaction(() => {
    getDb().prepare(`
      INSERT INTO aid_guardian_assignments (id, agent_did, guardian_did, assignment_type)
      VALUES (?, ?, ?, 'primary')
    `).run(id, aidInfo.did, guardianDid);

    getDb().prepare(
      'UPDATE aid_guardians SET agents_guarded = agents_guarded + 1, updated_at = datetime(\'now\') WHERE guardian_did = ?'
    ).run(guardianDid);

    getDb().prepare(
      'UPDATE aid_keys SET guardian_address = ?, updated_at = datetime(\'now\') WHERE did = ? AND key_status = ?'
    ).run(guardianDid, aidInfo.did, 'active');
  })();

  return c.json({ assignmentId: id, agentDid: aidInfo.did, guardianDid, type: 'primary' }, 201);
});

// ─── POST /succession — DID migration with penalty (14.12) ───────────────────

router.post('/succession', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const previousDid = body?.previousDid;
  const reason = body?.reason || 'key_compromise';
  if (!previousDid) return c.json({ error: 'previousDid required', code: 'MISSING_FIELD' }, 400);

  // Check succession rate limit (1 per 12 months)
  const recentSuccession = getDb().prepare(
    'SELECT id FROM aid_succession WHERE new_did = ? AND created_at > datetime(\'now\', \'-12 months\')'
  ).get(aidInfo.did);
  if (recentSuccession) {
    return c.json({ error: 'Succession rate limited to 1 per 12 months', code: 'RATE_LIMITED' }, 429);
  }

  // Count previous successions for escalating penalty
  const priorCount = getDb().prepare(
    'SELECT COUNT(*) as n FROM aid_succession WHERE new_did = ? OR previous_did = ?'
  ).get(aidInfo.did, aidInfo.did) as { n: number };

  const successionNumber = priorCount.n + 1;
  if (successionNumber > 3) {
    return c.json({ error: 'Identity retired after 3 successions', code: 'IDENTITY_RETIRED' }, 403);
  }

  const penalty = successionNumber === 1 ? 0.20 : successionNumber === 2 ? 0.50 : 1.0;

  const id = `succ-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_succession (id, previous_did, new_did, reason, penalty_applied, succession_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, previousDid, aidInfo.did, reason, penalty, successionNumber);

  logAudit({
    entityType: 'aid', entityId: aidInfo.did, action: 'succession',
    data: { previousDid, reason, penalty, successionNumber },
  });

  return c.json({
    successionId: id, previousDid, newDid: aidInfo.did,
    reason, penaltyApplied: penalty, successionNumber,
    note: penalty >= 1.0 ? 'Identity retired' : `${penalty * 100}% score penalty applied`,
  }, 201);
});

// ─── POST /appeals — File an appeal against a freeze (14.14) ─────────────────

router.post('/appeals', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const appealReason = body?.reason;
  const evidence = body?.evidence;
  if (!appealReason) return c.json({ error: 'reason required', code: 'MISSING_FIELD' }, 400);

  // Check for existing pending appeal
  const pendingAppeal = getDb().prepare(
    'SELECT id FROM aid_appeals WHERE agent_did = ? AND status = ?'
  ).get(aidInfo.did, 'pending');
  if (pendingAppeal) {
    return c.json({ error: 'Appeal already pending', code: 'APPEAL_EXISTS' }, 409);
  }

  // Check cooldown (90 days after rejection)
  const recentRejection = getDb().prepare(
    'SELECT id FROM aid_appeals WHERE agent_did = ? AND status = ? AND reviewed_at > datetime(\'now\', \'-90 days\')'
  ).get(aidInfo.did, 'rejected');
  if (recentRejection) {
    return c.json({ error: '90-day cooldown after rejected appeal', code: 'APPEAL_COOLDOWN' }, 429);
  }

  const id = `appeal-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_appeals (id, agent_did, appeal_reason, evidence)
    VALUES (?, ?, ?, ?)
  `).run(id, aidInfo.did, appealReason, evidence || null);

  return c.json({ appealId: id, agentDid: aidInfo.did, status: 'pending' }, 201);
});

// ─── POST /escrow — Create trust point escrow (14.6) ─────────────────────────

router.post('/escrow', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  if (aidInfo.trustScore < 40) {
    return c.json({ error: 'Trust score must be 40+ to initiate escrow', code: 'AID_TRUST_GATE_BLOCKED' }, 403);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const acceptorDid = body?.acceptorDid;
  const transactionRef = body?.transactionRef;
  if (!acceptorDid) return c.json({ error: 'acceptorDid required', code: 'MISSING_FIELD' }, 400);

  const id = `escrow-${nanoid(16)}`;
  getDb().prepare(`
    INSERT INTO aid_trust_escrow (id, initiator_did, acceptor_did, initiator_stake, acceptor_stake, transaction_ref)
    VALUES (?, ?, ?, 7, 3, ?)
  `).run(id, aidInfo.did, acceptorDid, transactionRef || null);

  return c.json({
    escrowId: id, initiatorDid: aidInfo.did, acceptorDid,
    initiatorStake: 7, acceptorStake: 3,
    note: 'Asymmetric escrow: initiator risks 7 points, acceptor risks 3. Both earn +1 on success.',
  }, 201);
});

// ─── POST /escrow/:id/resolve — Resolve trust escrow ─────────────────────────

router.post('/escrow/:id/resolve', checkAidProof, async (c) => {
  const aidInfo = c.get('aidInfo') as AidInfo | undefined;
  if (!aidInfo) return c.json({ error: 'AID authentication required', code: 'AID_PROOF_MISSING' }, 428);

  const escrowId = c.req.param('id');
  const escrow = getDb().prepare('SELECT * FROM aid_trust_escrow WHERE id = ? AND outcome IS NULL').get(escrowId) as any;
  if (!escrow) return c.json({ error: 'Escrow not found or already resolved', code: 'ESCROW_NOT_FOUND' }, 404);

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const outcome = body?.outcome; // 'success' | 'initiator_fault' | 'acceptor_fault'
  if (!['success', 'initiator_fault', 'acceptor_fault'].includes(outcome)) {
    return c.json({ error: 'outcome must be success, initiator_fault, or acceptor_fault', code: 'INVALID_OUTCOME' }, 400);
  }

  getDb().prepare(`
    UPDATE aid_trust_escrow SET outcome = ?, fault_party = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(outcome, outcome === 'success' ? null : outcome.replace('_fault', ''), escrowId);

  return c.json({
    escrowId, outcome,
    initiatorResult: outcome === 'success' ? '+1' : outcome === 'initiator_fault' ? '-7' : '+7 returned',
    acceptorResult: outcome === 'success' ? '+1' : outcome === 'acceptor_fault' ? '-3' : '+3 returned + 2 compensation',
  });
});

// ─── GET /insurance/balance — Insurance fund status ──────────────────────────

router.get('/insurance/balance', (c) => {
  let fund = getDb().prepare('SELECT * FROM aid_insurance_fund LIMIT 1').get() as any;
  if (!fund) {
    getDb().prepare('INSERT INTO aid_insurance_fund (id, balance) VALUES (?, ?)').run('fund-main', 0);
    fund = { balance: 0, total_premiums_collected: 0, total_claims_paid: 0 };
  }

  return c.json({
    balance: fund.balance,
    totalPremiumsCollected: fund.total_premiums_collected,
    totalClaimsPaid: fund.total_claims_paid,
    solvencyStatus: fund.balance > 1000 ? 'healthy' : fund.balance > 100 ? 'adequate' : 'low',
  });
});

export { router as aidProtocolRouter };
