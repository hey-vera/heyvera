/**
 * soma-challenge.ts — Computation Challenge Protocol Routes
 *
 * POST /v1/soma/challenge           — File a challenge against a computation certificate
 * GET  /v1/soma/challenge/:id       — Get challenge status
 * POST /v1/soma/challenge/:id/respond — Agent responds (bisection or proof)
 *
 * Implements the constrained arbiter model from heartbeat-fraud-proofs.md Section 3.
 * Arbiter can only route funds to challenger OR agent, never to itself.
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { getDb, logAudit } from '../db/connection';
import { somaHash } from '../utils/crypto-agility';
import { maskApiKey } from '../utils/mask';
import { logger } from '../utils/logger';
import { deductCredit } from '../db/index';
import { round6 } from '../core/credits';
import {
  calculateChallengeEconomics,
  calculateSlashAmounts,
  canChallengeTransition,
  isChallengeWindowOpen,
  type ChallengeState,
} from '../core/bond-economics';
import { getComputationCertificateById } from '../core/computation-certificate';

const challengeRouter = new Hono();

// ─── Schemas ───────────────────────────────────────────────────────────────

const FileChallengeBody = z.object({
  certId: z.string().min(1),
  reason: z.string().min(10).max(2000),
});

const RespondBody = z.object({
  action: z.enum(['provide_checkpoints', 'concede']),
  checkpoints: z.array(z.object({
    index: z.number().int().min(0),
    stateHash: z.string().min(1),
  })).optional(),
  disputedRangeStart: z.number().int().min(0).optional(),
  disputedRangeEnd: z.number().int().min(0).optional(),
});

// ─── File a Challenge ──────────────────────────────────────────────────────

challengeRouter.post('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as any;
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);

  const parsed = FileChallengeBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.issues.map(i => i.message),
    }, 400);
  }

  const { certId, reason } = parsed.data;

  // Look up the computation certificate
  const cert = getComputationCertificateById(certId);
  if (!cert) {
    return c.json({ error: 'Computation certificate not found', code: 'CERT_NOT_FOUND' }, 404);
  }

  // Check challenge window is still open
  if (!cert.challengeWindowEnd || !isChallengeWindowOpen(cert.challengeWindowEnd)) {
    return c.json({
      error: 'Challenge window has closed',
      code: 'WINDOW_CLOSED',
      challengeWindowEnd: cert.challengeWindowEnd,
      finalized: cert.finalized,
    }, 409);
  }

  // Tier 0 has no challenge window
  if (cert.bondTier === 0) {
    return c.json({ error: 'Tier 0 computations cannot be challenged (spot-checks only)', code: 'TIER_ZERO' }, 409);
  }

  // Check no duplicate challenge from same key on same cert
  const existing = getDb().prepare(
    `SELECT id FROM computation_challenges WHERE cert_id = ? AND challenger_api_key_hash = ? AND state NOT IN ('resolved_valid', 'resolved_fraud', 'expired')`,
  ).get(certId, somaHash(keyInfo.key)) as any;
  if (existing) {
    return c.json({ error: 'You already have an active challenge on this certificate', code: 'DUPLICATE_CHALLENGE', existingId: existing.id }, 409);
  }

  // Calculate challenger bond and deduct
  const economics = calculateChallengeEconomics(cert.bondAmount);
  if (!keyInfo.isEnvKey) {
    const deducted = deductCredit(keyInfo.key, economics.challengerBond);
    if (!deducted) {
      return c.json({
        error: 'Insufficient credits for challenger bond',
        code: 'INSUFFICIENT_CREDITS',
        bondRequired: economics.challengerBond,
        creditsAvailable: keyInfo.credits,
      }, 402);
    }
  }

  // Create the challenge
  const id = `ch-${nanoid()}`;
  const responseDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h to respond

  getDb().prepare(`
    INSERT INTO computation_challenges (
      id, cert_id, challenger_api_key_hash, challenger_bond, agent_bond,
      state, reason, response_deadline
    ) VALUES (?, ?, ?, ?, ?, 'filed', ?, ?)
  `).run(
    id, certId, somaHash(keyInfo.key), economics.challengerBond,
    cert.bondAmount, reason, responseDeadline,
  );

  logAudit({
    entityType: 'computation_challenge',
    entityId: id,
    action: 'filed',
    actorId: maskApiKey(keyInfo.key),
    data: { certId, bondTier: cert.bondTier, challengerBond: economics.challengerBond, reason },
  });

  logger.info({
    challengeId: id, certId, bondTier: cert.bondTier,
    challengerBond: economics.challengerBond,
  }, 'Computation challenge filed');

  return c.json({
    id,
    certId,
    state: 'filed',
    challengerBond: economics.challengerBond,
    agentBond: cert.bondAmount,
    responseDeadline,
    economics: {
      correctChallengeReward: economics.correctChallengeReward,
      slashDistribution: economics.slashDistribution,
    },
  }, 201);
});

// ─── Get Challenge Status ──────────────────────────────────────────────────

challengeRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = getDb().prepare('SELECT * FROM computation_challenges WHERE id = ?').get(id) as any;
  if (!row) return c.json({ error: 'Challenge not found', code: 'NOT_FOUND' }, 404);

  return c.json({
    id: row.id,
    certId: row.cert_id,
    state: row.state,
    reason: row.reason,
    challengerBond: row.challenger_bond,
    agentBond: row.agent_bond,
    bisectionRounds: row.bisection_rounds_json ? JSON.parse(row.bisection_rounds_json) : [],
    disputedRange: row.current_disputed_range_start != null ? {
      start: row.current_disputed_range_start,
      end: row.current_disputed_range_end,
    } : null,
    resolution: row.resolution,
    resolutionDetail: row.resolution_detail,
    winner: row.winner,
    slash: row.slash_winner != null ? {
      winner: row.slash_winner,
      treasury: row.slash_treasury,
      burned: row.slash_burned,
    } : null,
    responseDeadline: row.response_deadline,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
});

// ─── Respond to Challenge ──────────────────────────────────────────────────

challengeRouter.post('/:id/respond', checkApiKey, async (c) => {
  const challengeId = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);

  const parsed = RespondBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: parsed.error.issues.map(i => i.message),
    }, 400);
  }

  const row = getDb().prepare('SELECT * FROM computation_challenges WHERE id = ?').get(challengeId) as any;
  if (!row) return c.json({ error: 'Challenge not found', code: 'NOT_FOUND' }, 404);

  const currentState = row.state as ChallengeState;

  // Handle concession — agent admits fault
  if (parsed.data.action === 'concede') {
    if (!canChallengeTransition(currentState, 'resolved_fraud')) {
      return c.json({ error: `Cannot concede from state '${currentState}'`, code: 'INVALID_TRANSITION' }, 409);
    }

    const slash = calculateSlashAmounts(row.agent_bond);
    const now = new Date().toISOString();

    getDb().prepare(`
      UPDATE computation_challenges SET
        state = 'resolved_fraud', resolution = 'conceded', resolution_detail = 'Agent conceded the challenge',
        winner = 'challenger', slash_winner = ?, slash_treasury = ?, slash_burned = ?, resolved_at = ?
      WHERE id = ?
    `).run(slash.winner, slash.treasury, slash.burned, now, challengeId);

    // Mark cert as not finalized (fraud)
    getDb().prepare('UPDATE computation_certificates SET finalized = 0 WHERE id = ?').run(row.cert_id);

    // Refund challenger bond + award
    // (In production, this would credit the challenger's account)

    logAudit({
      entityType: 'computation_challenge',
      entityId: challengeId,
      action: 'resolved_fraud',
      data: { resolution: 'conceded', slash },
    });

    return c.json({
      id: challengeId,
      state: 'resolved_fraud',
      resolution: 'conceded',
      winner: 'challenger',
      slash,
    });
  }

  // Handle checkpoint provision (bisection)
  if (parsed.data.action === 'provide_checkpoints') {
    const nextState: ChallengeState = currentState === 'filed' ? 'responded' : 'bisecting';
    if (!canChallengeTransition(currentState, nextState)) {
      return c.json({ error: `Cannot provide checkpoints from state '${currentState}'`, code: 'INVALID_TRANSITION' }, 409);
    }

    const existingRounds = row.bisection_rounds_json ? JSON.parse(row.bisection_rounds_json) : [];
    existingRounds.push({
      round: existingRounds.length + 1,
      checkpoints: parsed.data.checkpoints,
      disputedRangeStart: parsed.data.disputedRangeStart,
      disputedRangeEnd: parsed.data.disputedRangeEnd,
      timestamp: new Date().toISOString(),
    });

    getDb().prepare(`
      UPDATE computation_challenges SET
        state = ?, bisection_rounds_json = ?,
        current_disputed_range_start = ?, current_disputed_range_end = ?
      WHERE id = ?
    `).run(
      nextState,
      JSON.stringify(existingRounds),
      parsed.data.disputedRangeStart ?? row.current_disputed_range_start,
      parsed.data.disputedRangeEnd ?? row.current_disputed_range_end,
      challengeId,
    );

    logAudit({
      entityType: 'computation_challenge',
      entityId: challengeId,
      action: 'bisection_round',
      data: { round: existingRounds.length, state: nextState },
    });

    return c.json({
      id: challengeId,
      state: nextState,
      bisectionRound: existingRounds.length,
      disputedRange: {
        start: parsed.data.disputedRangeStart ?? row.current_disputed_range_start,
        end: parsed.data.disputedRangeEnd ?? row.current_disputed_range_end,
      },
    });
  }

  return c.json({ error: 'Unknown action', code: 'INVALID_ACTION' }, 400);
});

// ─── List challenges for a cert ────────────────────────────────────────────

challengeRouter.get('/by-cert/:certId', async (c) => {
  const certId = c.req.param('certId');
  const rows = getDb().prepare(
    'SELECT id, state, reason, challenger_bond, agent_bond, winner, created_at, resolved_at FROM computation_challenges WHERE cert_id = ? ORDER BY created_at DESC',
  ).all(certId) as any[];

  return c.json({
    certId,
    challenges: rows.map(r => ({
      id: r.id,
      state: r.state,
      reason: r.reason,
      challengerBond: r.challenger_bond,
      agentBond: r.agent_bond,
      winner: r.winner,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    })),
  });
});

export { challengeRouter };
