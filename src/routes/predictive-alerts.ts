import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { deductCredit, topUpCredits, logAudit } from '../db/index';
import { round6 } from '../core/credits';
import { trackDelegatedSpend } from '../utils/billing';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';
import {
  createIntelSubscription,
  getSubscriptionsForKey,
  deleteIntelSubscription,
} from '../db/intel';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

const AnalyzeSchema = z.object({
  target: z.string().min(1).max(100),
  target_type: z.enum(['token', 'wallet', 'contract']).default('token'),
  chain: z.enum(['solana', 'ethereum', 'base']).default('solana'),
  tier: z.enum(['analysis', 'forecast']).default('analysis'),
});

const SubscribeSchema = z.object({
  entity_address: z.string().min(1).max(100),
  entity_chain: z.enum(['solana', 'ethereum', 'base']).default('solana'),
  entity_type: z.enum(['token', 'wallet', 'contract']).default('token'),
  alert_types: z.array(z.string()).min(1).max(10).default(['SCORE_CHANGE', 'ANOMALY']),
  webhook_url: z.string().url().optional(),
  thresholds: z.object({
    score_drop: z.number().min(1).max(100).optional(),
    confidence_below: z.number().min(0).max(1).optional(),
  }).optional(),
});

// ─── Constants ──────────────────────────────────────────────────────────────

const TIER_COSTS: Record<string, number> = {
  analysis: 3.0,
  forecast: 6.0,
};

const SUBSCRIBE_COST = 5.0;
const CACHE_TTL = 1800; // 30 minutes for alerts (shorter than VIE)

// ─── Router ─────────────────────────────────────────────────────────────────

export const predictiveAlertsRouter = new Hono();

// POST /v1/intel/alerts/analyze
predictiveAlertsRouter.post('/analyze', checkApiKey, async (c) => {
  // 1. Validate input
  const body = await c.req.json().catch(() => ({}));
  const parsed = AnalyzeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { target, target_type, chain, tier } = parsed.data;
  const tierCost = round6(TIER_COSTS[tier]);
  const cacheKey = `alert:${chain}:${target_type}:${target.toLowerCase()}:${tier}`;

  // 2. Check cache for analysis tier
  if (tier === 'analysis') {
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
        credits_charged: cacheCost,
      });
    }
  }

  // 3. Deduct credits
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = keyInfo.delegatedFrom
    ? (keyInfo.delegation?.parentKey || keyInfo.key)
    : keyInfo.key;

  const deducted = deductCredit(billingKey, tierCost);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, tierCost);

  // 4. Run pattern analysis
  try {
    const { analyzePatterns } = await import('../core/predictive-alerts');
    const result = await analyzePatterns(target, target_type, chain, tier);

    // 5. Build response
    const response: Record<string, unknown> = {
      entity: result.entity,
      alert_score: result.alert_score,
      alert_level: result.alert_level,
      confidence: result.confidence,
      patterns: result.patterns,
      active_subscriptions: result.active_subscriptions,
      summary: result.summary,
      cached: false,
      tier,
      credits_charged: tierCost,
    };

    if (tier === 'forecast' && result.forecast) {
      response.forecast = result.forecast;
    }

    // 6. Cache the result
    await cacheSet(cacheKey, response, CACHE_TTL).catch(() => {});

    // 7. Audit log
    logAudit({
      entityType: 'predictive_alert',
      entityId: target,
      action: 'ANALYZE',
      actorId: keyInfo.key,
      data: { tier, alert_score: result.alert_score, alert_level: result.alert_level, pattern_count: result.patterns.length },
    });

    return c.json(response);
  } catch (err) {
    logger.error({ err, target, tier }, 'Predictive alert analysis failed');
    topUpCredits(billingKey, tierCost);
    return c.json({
      error: 'Predictive alert analysis failed',
      code: 'ALERT_INTERNAL_ERROR',
      credits_refunded: tierCost,
    }, 500);
  }
});

// POST /v1/intel/alerts/subscribe
predictiveAlertsRouter.post('/subscribe', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SubscribeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({
      error: 'Invalid request body',
      code: 'VALIDATION_ERROR',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { entity_address, entity_chain, entity_type, alert_types, webhook_url, thresholds } = parsed.data;

  // Deduct subscription setup fee
  const keyInfo = c.get('apiKeyInfo');
  const billingKey = keyInfo.delegatedFrom
    ? (keyInfo.delegation?.parentKey || keyInfo.key)
    : keyInfo.key;

  const deducted = deductCredit(billingKey, SUBSCRIBE_COST);
  if (!deducted) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }
  trackDelegatedSpend(keyInfo, SUBSCRIBE_COST);

  try {
    const subId = createIntelSubscription(
      keyInfo.key,
      entity_address,
      entity_chain,
      entity_type,
      alert_types,
      webhook_url,
      thresholds,
    );

    logAudit({
      entityType: 'predictive_alert',
      entityId: entity_address,
      action: 'SUBSCRIBE',
      actorId: keyInfo.key,
      data: { subscription_id: subId, alert_types, webhook_url: webhook_url ? '(set)' : null },
    });

    return c.json({
      ok: true,
      subscription_id: subId,
      entity_address,
      entity_chain,
      entity_type,
      alert_types,
      webhook_configured: !!webhook_url,
      credits_charged: SUBSCRIBE_COST,
    });
  } catch (err) {
    logger.error({ err, entity_address }, 'Alert subscription creation failed');
    topUpCredits(billingKey, SUBSCRIBE_COST);
    return c.json({
      error: 'Subscription creation failed',
      code: 'ALERT_SUBSCRIBE_ERROR',
      credits_refunded: SUBSCRIBE_COST,
    }, 500);
  }
});

// GET /v1/intel/alerts/subscriptions
predictiveAlertsRouter.get('/subscriptions', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  try {
    const subs = getSubscriptionsForKey(keyInfo.key);

    return c.json({
      subscriptions: subs.map(s => ({
        id: s.id,
        entity_address: s.entity_address,
        entity_chain: s.entity_chain,
        entity_type: s.entity_type,
        alert_types: (() => { try { return JSON.parse(s.alert_types); } catch { return []; } })(),
        webhook_configured: !!s.webhook_url,
        active: s.active === 1,
        fire_count: s.fire_count,
      })),
      total: subs.length,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list alert subscriptions');
    return c.json({ error: 'Failed to list subscriptions', code: 'ALERT_LIST_ERROR' }, 500);
  }
});

// DELETE /v1/intel/alerts/subscriptions/:id
predictiveAlertsRouter.delete('/subscriptions/:id', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const subId = c.req.param('id');

  if (!subId) {
    return c.json({ error: 'Subscription ID required', code: 'MISSING_ID' }, 400);
  }

  const deleted = deleteIntelSubscription(subId, keyInfo.key);

  if (!deleted) {
    return c.json({ error: 'Subscription not found or already inactive', code: 'NOT_FOUND' }, 404);
  }

  logAudit({
    entityType: 'predictive_alert',
    entityId: subId,
    action: 'UNSUBSCRIBE',
    actorId: keyInfo.key,
  });

  return c.json({ ok: true, subscription_id: subId, status: 'deactivated' });
});
