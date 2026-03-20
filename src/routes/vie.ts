import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, topUpCredits, getDb, logAudit } from '../db/index';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';

// Types imported from engine modules at runtime (dynamic imports below)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VieResult = any;

// ─── Zod Validation ──────────────────────────────────────────────────────────

const VieRequestSchema = z.object({
  target: z.string().min(1).max(100),
  target_type: z.enum(['token', 'wallet', 'contract']).default('token'),
  chain: z.enum(['solana', 'ethereum', 'base']).default('solana'),
  tier: z.enum(['quick', 'standard', 'deep']).default('standard'),
});

// ─── Constants ───────────────────────────────────────────────────────────────

const TIER_COSTS: Record<string, number> = {
  quick: 0.25,
  standard: 1.5,
  deep: 3.0,
};

const CACHE_TTL = 3600; // 1 hour

// ─── Router ──────────────────────────────────────────────────────────────────

export const vieRouter = new Hono();

// POST /v1/vie/report
vieRouter.post('/report', checkApiKey, async (c) => {
  // 1. Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = VieRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { target, target_type, chain, tier } = parsed.data;
  const tierCost = round6(TIER_COSTS[tier]);
  const cacheKey = `vie:${chain}:${target_type}:${target.toLowerCase()}`;

  // 2. For quick tier: check cache first
  if (tier === 'quick') {
    const cached = await cacheGet<VieResult>(cacheKey);
    if (cached) {
      // Deduct reduced cache cost
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
        target,
        target_type,
        chain,
        trust_score: cached.trust_score,
        risk_level: cached.risk_level,
        recommendation: cached.recommendation,
        confidence: cached.confidence,
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

  // 4. Fetch data from all 5 sources in parallel
  let result: VieResult;
  try {
    const { fetchAllSources } = await import('../core/vie-sources');
    const rawData = await fetchAllSources(target, target_type, chain);

    // 5. Compute VIE score
    const { computeVieScore } = await import('../core/vie-engine');
    result = computeVieScore(rawData);

    // 6. Check if too many sources failed — refund credits
    const nullFactors = Object.values(result.factors).filter(f => f === null).length;
    if (nullFactors >= 3) {
      topUpCredits(billingKey, tierCost);
      return c.json({
        error: 'Insufficient data sources available to produce a reliable score',
        code: 'VIE_INSUFFICIENT_DATA',
        sources_available: 5 - nullFactors,
        credits_refunded: tierCost,
      }, 503);
    }

    // 7. For deep tier: synthesize LLM verdict
    let explanation: string | null = null;
    let evidence: unknown[] | null = null;
    if (tier === 'deep') {
      try {
        const { synthesizeVerdict } = await import('../core/vie-synthesis');
        const synthesis = await synthesizeVerdict(target, target_type, result, rawData as any);
        if (synthesis) {
          explanation = synthesis.explanation;
          evidence = synthesis.evidence;
        }
      } catch (err) {
        logger.warn({ err, target }, 'VIE LLM synthesis failed — returning standard response');
        explanation = null;
        evidence = null;
      }
    }

    // 8. Store report in vie_reports table
    const reportId = nanoid();
    try {
      getDb().prepare(
        `INSERT INTO vie_reports (id, target, target_type, chain, trust_score, risk_level, confidence, factors_json, tier, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).run(
        reportId, target, target_type, chain,
        result.trust_score, result.risk_level, result.confidence,
        JSON.stringify(result.factors), tier
      );
    } catch (err) {
      logger.warn({ err, reportId }, 'VIE report insert failed — non-blocking');
    }

    // Write to shared intelligence tables (non-blocking, never crashes caller)
    try {
      const { upsertIntelEntity, upsertIntelScore, appendIntelEvent } = await import('../db/intel');
      const entityId = upsertIntelEntity(target, target_type, chain);
      upsertIntelScore(entityId, target, chain, 'vie', result.trust_score, result.confidence, result.risk_level,
        `Trust: ${result.trust_score}/100 (${result.risk_level})`, result.factors);
      appendIntelEvent(entityId, target, chain, 'vie', 'SCORE_CHANGE',
        result.trust_score < 30 ? 'warning' : 'info',
        { trust_score: result.trust_score, risk_level: result.risk_level, confidence: result.confidence, tier });
    } catch (err) {
      logger.warn({ err }, 'Intel shared table write failed — non-blocking');
    }

    // 9. Cache the result
    await cacheSet(cacheKey, result, CACHE_TTL).catch(() => {});

    // 10. Audit log
    logAudit({
      entityType: 'vie',
      entityId: target,
      action: 'REPORT',
      actorId: keyInfo.key,
      data: { tier, trust_score: result.trust_score, risk_level: result.risk_level, reportId },
    });

    // 11. Build response based on tier
    if (tier === 'quick') {
      return c.json({
        target,
        target_type,
        chain,
        trust_score: result.trust_score,
        risk_level: result.risk_level,
        recommendation: result.recommendation,
        confidence: result.confidence,
        cached: false,
        tier,
        credits_charged: tierCost,
      });
    }

    const response: Record<string, unknown> = {
      target,
      target_type,
      chain,
      trust_score: result.trust_score,
      risk_level: result.risk_level,
      recommendation: result.recommendation,
      confidence: result.confidence,
      factors: result.factors,
      overrides_applied: result.overrides_applied,
      cached: false,
      tier,
      credits_charged: tierCost,
    };

    if (tier === 'deep') {
      response.explanation = explanation;
      response.evidence = evidence;
    }

    return c.json(response);
  } catch (err) {
    // Refund credits on unexpected error
    logger.error({ err, target, tier }, 'VIE report failed');
    topUpCredits(billingKey, tierCost);
    return c.json({
      error: 'VIE report generation failed',
      code: 'VIE_INTERNAL_ERROR',
      credits_refunded: tierCost,
    }, 500);
  }
});
