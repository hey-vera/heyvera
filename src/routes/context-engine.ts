/**
 * Context Engine Route — POST /v1/intel/context
 *
 * ClawNet Intelligence Skill #2. Takes any crypto entity and returns
 * normalized profile, current state, anomaly detection, and LLM enrichment.
 *
 * Pricing: summary=1.0cr, standard=2.0cr, deep=4.0cr
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, topUpCredits, logAudit } from '../db/index';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';

// ─── Zod Validation ─────────────────────────────────────────────────────────

const ContextRequestSchema = z.object({
  target: z.string().min(1).max(100),
  target_type: z.enum(['token', 'wallet', 'contract']).default('token'),
  chain: z.enum(['solana', 'ethereum', 'base']).default('solana'),
  tier: z.enum(['summary', 'standard', 'deep']).default('standard'),
});

// ─── Constants ──────────────────────────────────────────────────────────────

const TIER_COSTS: Record<string, number> = {
  summary: 1.0,
  standard: 2.0,
  deep: 4.0,
};

const CACHE_TTL = 1800; // 30 minutes

// ─── Router ─────────────────────────────────────────────────────────────────

export const contextEngineRouter = new Hono();

// POST /v1/intel/context
contextEngineRouter.post('/context', checkApiKey, async (c) => {
  // 1. Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = ContextRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { target, target_type, chain, tier } = parsed.data;
  const tierCost = round6(TIER_COSTS[tier]);
  const cacheKey = `intel:context:${chain}:${target.toLowerCase()}`;

  // 2. Check cache first
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);
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

  // 4. Generate context
  try {
    const { generateContext } = await import('../core/context-engine');
    const result = await generateContext(target, target_type, chain, tier);

    // 5. Check if we got enough data
    const nullStateFields = Object.values(result.state).filter(v => v === null).length;
    if (nullStateFields >= 5 && result.data_sources.length <= 1) {
      topUpCredits(billingKey, tierCost);
      return c.json({
        error: 'Insufficient data sources available for this entity',
        code: 'CONTEXT_INSUFFICIENT_DATA',
        sources_available: result.data_sources.length,
        credits_refunded: tierCost,
      }, 503);
    }

    // 6. Cache the result
    await cacheSet(cacheKey, result, CACHE_TTL).catch(() => {});

    // 7. Audit log
    logAudit({
      entityType: 'context',
      entityId: target,
      action: 'CONTEXT_REPORT',
      actorId: keyInfo.key,
      data: { tier, context_score: result.context_score, confidence: result.confidence, anomaly_count: result.anomalies.length },
    });

    // 8. Build response
    const response: Record<string, unknown> = {
      entity: result.entity,
      state: result.state,
      anomalies: result.anomalies,
      context_score: result.context_score,
      confidence: result.confidence,
      summary: result.summary,
      data_sources: result.data_sources,
      cached: false,
      tier,
      credits_charged: tierCost,
    };

    // Include enrichment for standard/deep
    if (tier === 'standard' || tier === 'deep') {
      response.enrichment = result.enrichment ?? null;
    }

    // Include VIE cross-reference if available
    if (result.related_vie_score !== undefined) {
      response.related_vie_score = result.related_vie_score;
    }

    // Upgrade hint: VIE score MEDIUM (40-59) suggests mixed signals
    if (result.related_vie_score !== undefined && result.related_vie_score >= 40 && result.related_vie_score <= 59) {
      response.upgrade_hint = 'This token has mixed signals. The Verified Intelligence Engine can show exactly which safety factors are driving the score.';
    }

    return c.json(response);
  } catch (err) {
    // Refund credits on unexpected error
    logger.error({ err, target, tier }, 'Context Engine: report failed');
    topUpCredits(billingKey, tierCost);
    return c.json({
      error: 'Context report generation failed',
      code: 'CONTEXT_INTERNAL_ERROR',
      credits_refunded: tierCost,
    }, 500);
  }
});
