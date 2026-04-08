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
import { deductCredit, topUpCredits } from '../db/credits';
import { logger } from '../utils/logger';
import {
  queryTrust,
  recordTrustQuery,
  getTrustQueryStats,
  TRUST_QUERY_COSTS,
  PROOF_GENERATION_COST,
  type TrustTier,
} from '../core/trust-oracle';
import { novaCompress } from '../core/soma-heartbeat';

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
    topUpCredits(keyInfo.key, cost);
    logger.error({ err, did }, 'Trust query failed — credits refunded');
    return c.json({ error: 'Trust query failed', code: 'QUERY_FAILED', refunded: cost }, 500);
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
    topUpCredits(keyInfo.key, cost);
    logger.error({ err, did }, 'Trust query (dimensional) failed — credits refunded');
    return c.json({ error: 'Trust query failed', code: 'QUERY_FAILED', refunded: cost }, 500);
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
    topUpCredits(keyInfo.key, cost);
    logger.error({ err, did }, 'Trust query (full) failed — credits refunded');
    return c.json({ error: 'Trust query failed', code: 'QUERY_FAILED', refunded: cost }, 500);
  }
});

// ─── POST /:did/prove — Generate Groth16 proof (premium) ────────────────────
// Compresses all Nova IVC folds into a constant-size EVM-verifiable proof.
// First call triggers lazy Groth16 trusted setup (~3-7 min), subsequent ~30s.
// On success, agent tier upgrades to 'zk-verified'.
router.post('/:did/prove', checkApiKey, async (c) => {
  const did = c.req.param('did');
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const cost = PROOF_GENERATION_COST;

  if (!deductCredit(keyInfo.key, cost)) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      required: cost,
      hint: `Proof generation costs ${cost} credits`,
    }, 402);
  }

  try {
    const result = await novaCompress(did);
    if (!result) {
      // Refund — prover unavailable
      topUpCredits(keyInfo.key, cost);
      return c.json({
        error: 'ZK prover unavailable — credits refunded',
        code: 'PROVER_UNAVAILABLE',
        refunded: cost,
      }, 503);
    }

    recordTrustQuery(keyInfo.key, did, 'full', cost);

    return c.json({
      ok: true,
      agentDid: did,
      proof: result.proof,
      proofSizeBytes: result.proofSizeBytes,
      foldCount: result.foldCount,
      proofTier: 'zk-verified',
      _meta: {
        creditsCharged: cost,
        hint: 'This proof is EVM-verifiable via the Groth16 verifier contract on Base',
      },
    });
  } catch (err) {
    // Refund on failure
    topUpCredits(keyInfo.key, cost);
    logger.error({ err, did }, 'Proof generation failed — credits refunded');
    return c.json({
      error: 'Proof generation failed — credits refunded',
      code: 'PROOF_FAILED',
      refunded: cost,
    }, 500);
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
