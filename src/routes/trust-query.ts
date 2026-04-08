/**
 * Trust Query Routes — ClawNet Revenue Engine
 *
 * Paid trust queries backed by Soma Pulse Trees, verdicts, and behavioral data.
 * Three tiers: basic (0.01 credits), dimensional (0.05), full (0.10).
 *
 * Routes:
 *   GET /v1/trust/:did           — Basic trust check (score + level)
 *   GET /v1/trust/:did/dimensions — Dimensional breakdown (5 dimensions)
 *   GET /v1/trust/:did/full      — Full report (dimensions + pulse + verdicts + activity)
 *   GET /v1/trust/stats          — Admin: trust query analytics
 */

import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { deductCredit } from '../db/credits';
import { logger } from '../utils/logger';
import {
  queryTrust,
  recordTrustQuery,
  getTrustQueryStats,
  TRUST_QUERY_COSTS,
  type TrustTier,
} from '../core/trust-oracle';

const router = new Hono();

// ─── GET /:did — Basic trust check ─────────────────────────────────────────
// Cheapest query: trust score, verdict, confidence, risk flags.
router.get('/:did', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const tier: TrustTier = 'basic';
  const cost = TRUST_QUERY_COSTS[tier];

  // Charge
  if (!deductCredit(keyInfo.key, cost)) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      required: cost,
      tier,
    }, 402);
  }

  try {
    const result = queryTrust(did, tier);
    recordTrustQuery(keyInfo.key, did, tier, cost);

    return c.json({
      ...result,
      _meta: {
        tier,
        creditsCharged: cost,
        upgradeTo: 'dimensional',
        upgradeUrl: `/v1/trust/${did}/dimensions`,
      },
    });
  } catch (err) {
    logger.error({ err, did }, 'Trust query failed');
    return c.json({ error: 'Trust query failed', code: 'QUERY_FAILED' }, 500);
  }
});

// ─── GET /:did/dimensions — Dimensional breakdown ───────────────────────────
// Mid-tier: includes per-dimension scores (reliability, economic, verification, longevity, consistency).
router.get('/:did/dimensions', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const tier: TrustTier = 'dimensional';
  const cost = TRUST_QUERY_COSTS[tier];

  if (!deductCredit(keyInfo.key, cost)) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      required: cost,
      tier,
    }, 402);
  }

  try {
    const result = queryTrust(did, tier);
    recordTrustQuery(keyInfo.key, did, tier, cost);

    return c.json({
      ...result,
      _meta: {
        tier,
        creditsCharged: cost,
        upgradeTo: 'full',
        upgradeUrl: `/v1/trust/${did}/full`,
      },
    });
  } catch (err) {
    logger.error({ err, did }, 'Trust query (dimensional) failed');
    return c.json({ error: 'Trust query failed', code: 'QUERY_FAILED' }, 500);
  }
});

// ─── GET /:did/full — Full trust report ─────────────────────────────────────
// Premium: everything — dimensions, pulse snapshot, verdict summary, recent activity.
router.get('/:did/full', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const tier: TrustTier = 'full';
  const cost = TRUST_QUERY_COSTS[tier];

  if (!deductCredit(keyInfo.key, cost)) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      required: cost,
      tier,
    }, 402);
  }

  try {
    const result = queryTrust(did, tier);
    recordTrustQuery(keyInfo.key, did, tier, cost);

    return c.json({
      ...result,
      _meta: {
        tier,
        creditsCharged: cost,
      },
    });
  } catch (err) {
    logger.error({ err, did }, 'Trust query (full) failed');
    return c.json({ error: 'Trust query failed', code: 'QUERY_FAILED' }, 500);
  }
});

// ─── GET /stats — Trust query analytics (admin) ────────────────────────────
router.get('/stats', checkApiKey, async (c) => {
  try {
    const stats = getTrustQueryStats();
    return c.json({
      ...stats,
      pricing: TRUST_QUERY_COSTS,
      protocol: 'soma-trust-oracle',
    });
  } catch (err) {
    logger.error({ err }, 'Trust query stats failed');
    return c.json({ error: 'Failed to get stats', code: 'STATS_FAILED' }, 500);
  }
});

export { router as trustQueryRouter };
