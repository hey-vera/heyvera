/**
 * Vouch Graph Routes — Agent-to-Agent Trust Staking (Layer 4)
 *
 * Free operations (strengthen the graph):
 *   POST /v1/vouch/stake          — Stake credits to vouch for an agent
 *   POST /v1/vouch/revoke         — Revoke a vouch (recover stake)
 *   GET  /v1/vouch/:did/score     — Aggregate vouch score
 *   GET  /v1/vouch/:did/vouchers  — Who vouches for this agent
 *   GET  /v1/vouch/:did/vouching  — Who does this agent vouch for
 *
 * Paid operations (revenue):
 *   GET  /v1/vouch/resolve?from=X&to=Y — Transitive trust resolution
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit } from '../db/credits';
import { resolveAgentDid } from '../core/soma-heartbeat';
import { logger } from '../utils/logger';
import {
  stakeVouch,
  revokeVouch,
  getVouchesFor,
  getVouchesBy,
  getVouchScore,
  resolveVouchPath,
} from '../core/vouch-graph';
import { recordTrustQuery, queryTrust } from '../core/trust-oracle';

const router = new Hono();

const VOUCH_RESOLVE_COST = 0.02; // credits per resolution

// ─── POST /stake — Vouch for an agent ───────────────────────────────────────
const StakeBody = z.object({
  voucheeDid: z.string().min(1),
  stakeAmount: z.number().min(1),
  expiresAt: z.string().optional(),
});

router.post('/stake', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const body = await c.req.json().catch(() => ({}));
  const parsed = StakeBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const voucherDid = resolveAgentDid(keyInfo.key);

  // Query voucher's trust score for budget enforcement (Q7: max vouch = trust / cost_factor)
  let voucherTrustScore: number | undefined;
  try {
    const trust = queryTrust(voucherDid, 'basic');
    voucherTrustScore = trust.trustScore;
  } catch { /* non-critical — allow vouch without budget check if trust query fails */ }

  try {
    const stake = stakeVouch(voucherDid, parsed.data.voucheeDid, parsed.data.stakeAmount, parsed.data.expiresAt, voucherTrustScore);
    return c.json({ ok: true, stake });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'VOUCH_FAILED' }, 400);
  }
});

// ─── POST /revoke — Revoke a vouch ──────────────────────────────────────────
const RevokeBody = z.object({
  voucheeDid: z.string().min(1),
});

router.post('/revoke', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const body = await c.req.json().catch(() => ({}));
  const parsed = RevokeBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', code: 'VALIDATION_ERROR' }, 400);
  }

  const voucherDid = resolveAgentDid(keyInfo.key);
  const ok = revokeVouch(voucherDid, parsed.data.voucheeDid);
  if (!ok) {
    return c.json({ error: 'No active vouch found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ ok: true });
});

// ─── GET /:did/score — Aggregate vouch score ─────────────────────────────────
router.get('/:did/score', async (c) => {
  const did = c.req.param('did');
  const score = getVouchScore(did);
  return c.json({ protocol: 'soma-vouch-graph/0.1', ...score });
});

// ─── GET /:did/vouchers — Who vouches for this agent ─────────────────────────
router.get('/:did/vouchers', async (c) => {
  const did = c.req.param('did');
  const vouchers = getVouchesFor(did);
  return c.json({
    did,
    count: vouchers.length,
    vouchers: vouchers.map(v => ({
      voucherDid: v.voucherDid,
      stakeAmount: v.stakeAmount,
      createdAt: v.createdAt,
      expiresAt: v.expiresAt,
    })),
  });
});

// ─── GET /:did/vouching — Who does this agent vouch for ──────────────────────
router.get('/:did/vouching', async (c) => {
  const did = c.req.param('did');
  const vouching = getVouchesBy(did);
  return c.json({
    did,
    count: vouching.length,
    vouching: vouching.map(v => ({
      voucheeDid: v.voucheeDid,
      stakeAmount: v.stakeAmount,
      createdAt: v.createdAt,
      expiresAt: v.expiresAt,
    })),
  });
});

// ─── GET /resolve — Transitive trust resolution (PAID) ───────────────────────
router.get('/resolve', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const from = c.req.query('from');
  const to = c.req.query('to');

  if (!from || !to) {
    return c.json({ error: 'Both "from" and "to" query params required', code: 'MISSING_PARAMS' }, 400);
  }

  if (from === to) {
    return c.json({ error: 'Cannot resolve path to self', code: 'SELF_RESOLVE' }, 400);
  }

  // Charge for resolution
  if (!deductCredit(keyInfo.key, VOUCH_RESOLVE_COST)) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      required: VOUCH_RESOLVE_COST,
    }, 402);
  }

  try {
    const path = resolveVouchPath(from, to);
    recordTrustQuery(keyInfo.key, to, 'basic', VOUCH_RESOLVE_COST);

    if (!path) {
      return c.json({
        from,
        to,
        connected: false,
        message: 'No trust path found within 3 hops',
        creditsCharged: VOUCH_RESOLVE_COST,
      });
    }

    return c.json({
      from,
      to,
      connected: true,
      path,
      creditsCharged: VOUCH_RESOLVE_COST,
    });
  } catch (err) {
    logger.error({ err, from, to }, 'Vouch resolution failed');
    return c.json({ error: 'Resolution failed', code: 'RESOLVE_FAILED' }, 500);
  }
});

export { router as vouchGraphRouter };
