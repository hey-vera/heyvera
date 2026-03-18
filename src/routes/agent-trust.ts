import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, topUpCredits, getDb, logAudit } from '../db/index';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TrustResult = any;

// ─── Zod Validation ──────────────────────────────────────────────────────────

const TrustRequestSchema = z.object({
  target: z.string().min(1).max(100),
  target_type: z.enum(['agent', 'wallet', 'deployer']).default('agent'),
  chain: z.enum(['solana', 'ethereum', 'base']).default('solana'),
  tier: z.enum(['quick', 'standard', 'deep']).default('standard'),
});

// ─── Constants ───────────────────────────────────────────────────────────────

const TIER_COSTS: Record<string, number> = {
  quick: 1.0,
  standard: 2.5,
  deep: 5.0,
};

const CACHE_TTL = 3600; // 1 hour

// ─── Router ──────────────────────────────────────────────────────────────────

export const agentTrustRouter = new Hono();

// POST /v1/intel/trust
agentTrustRouter.post('/trust', checkApiKey, async (c) => {
  // 1. Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = TrustRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { target, target_type, chain, tier } = parsed.data;
  const tierCost = round6(TIER_COSTS[tier]);
  const cacheKey = `trust:${chain}:${target_type}:${target.toLowerCase()}`;

  // 2. For quick tier: check cache first
  if (tier === 'quick') {
    const cached = await cacheGet<TrustResult>(cacheKey);
    if (cached) {
      const keyInfo = c.get('apiKeyInfo');
      const billingKey = keyInfo.delegatedFrom
        ? (keyInfo.delegation?.parentKey || keyInfo.key)
        : keyInfo.key;
      const cacheCost = round6(Math.max(0.1, tierCost * 0.10));
      const deducted = deductCredit(billingKey, cacheCost);
      if (!deducted) {
        return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
      trackDelegatedSpend(keyInfo, cacheCost);

      return c.json({
        ...cached,
        cached: true,
        tier,
        credits_charged: cacheCost,
      });
    }
  }

  // 3. Deduct credits based on tier
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = keyInfo.delegatedFrom
    ? (keyInfo.delegation?.parentKey || keyInfo.key)
    : keyInfo.key;

  const deducted = deductCredit(billingKey, tierCost);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, tierCost);

  // 4. Compute Agent Trust Score
  let result: TrustResult;
  try {
    const { computeAgentTrust } = await import('../core/agent-trust');
    result = await computeAgentTrust(target, target_type, chain, tier);

    // 5. Store report in intel tables (non-blocking, never crashes caller)
    try {
      const { upsertIntelEntity, upsertIntelScore, appendIntelEvent } = await import('../db/intel');
      const entityId = upsertIntelEntity(target, target_type, chain);
      upsertIntelScore(entityId, target, chain, 'trust', result.trust_score, result.confidence, result.trust_level,
        `Trust: ${result.trust_score}/100 (${result.trust_level})`, {
          behavioral_signals: result.behavioral_signals,
          risk_flags: result.risk_flags,
          recommendation: result.recommendation,
        });
      appendIntelEvent(entityId, target, chain, 'trust', 'SCORE_CHANGE',
        result.trust_score < 30 ? 'warning' : 'info',
        { trust_score: result.trust_score, trust_level: result.trust_level, confidence: result.confidence, tier });
    } catch (err) {
      logger.warn({ err }, 'Intel shared table write failed — non-blocking');
    }

    // 6. Cache the result
    await cacheSet(cacheKey, result, CACHE_TTL).catch(() => {});

    // 7. Audit log
    logAudit({
      entityType: 'trust',
      entityId: target,
      action: 'REPORT',
      actorId: keyInfo.key,
      data: { tier, trust_score: result.trust_score, trust_level: result.trust_level },
    });

    // 8. Build response based on tier
    if (tier === 'quick') {
      return c.json({
        entity: result.entity,
        trust_score: result.trust_score,
        trust_level: result.trust_level,
        confidence: result.confidence,
        recommendation: result.recommendation,
        risk_flags: result.risk_flags,
        cached: false,
        tier,
        credits_charged: tierCost,
      });
    }

    const response: Record<string, unknown> = {
      entity: result.entity,
      trust_score: result.trust_score,
      trust_level: result.trust_level,
      confidence: result.confidence,
      behavioral_signals: result.behavioral_signals,
      risk_flags: result.risk_flags,
      recommendation: result.recommendation,
      related_vie_score: result.related_vie_score,
      summary: result.summary,
      cached: false,
      tier,
      credits_charged: tierCost,
    };

    return c.json(response);
  } catch (err) {
    // Refund credits on unexpected error
    logger.error({ err, target, tier }, 'Agent Trust report failed');
    topUpCredits(billingKey, tierCost);
    return c.json({
      error: 'Agent Trust report generation failed',
      code: 'TRUST_INTERNAL_ERROR',
      credits_refunded: tierCost,
    }, 500);
  }
});
