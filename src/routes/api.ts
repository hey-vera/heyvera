import { z } from 'zod';
import { insertOrchestration, getApiKeyBalance, getApiKeyByStripeSession, getApiKeyByEmail, deductCredit, createAutoAttestation } from '../db/index';
import { trackDelegatedSpend } from '../utils/billing';
import { Hono } from 'hono';
import { maskApiKey } from '../utils/mask';
import { creditsForExecution, creditsToUsd, cacheCreditCost, creditCostForEndpoint, round6 } from '../core/credits';
import { nanoid } from 'nanoid';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import {
  PricingPreferencesSchema, type PricingPreferences,
  pricingPromptHint, checkBudget, optimizePlan, estimatePlanCost,
  getAlternativesForEndpoint,
} from '../core/pricing';
import { logUsage, getRecentUsage, getUsageStats } from '../utils/usage';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { apiRegistry, findEndpoint } from '../config/api-registry';
import { env, isSimulationMode, rateTier, ORCHESTRATION_FEE } from '../config/index';
import { logger } from '../utils/logger';
import { getHeartSafe } from '../core/soma';
import { sendApiKeyEmail, sendLowBalanceEmail, sendAdminAlert } from '../utils/email';
import { wasEmailSentRecently, logEmailSend } from '../db/index';
import crypto from 'crypto';

export const apiRouter = new Hono();

function queryCacheKey(query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  return 'qcache:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// POST /v1/orchestrate
apiRouter.post('/orchestrate', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();

  let body: { query?: string; pricing?: unknown; cache?: string; diff?: boolean; mode?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ requestId, error: 'Invalid JSON body', code: 'INVALID_BODY', hint: 'Send { "query": "your question" }' }, 400);
  }

  const query = body.query?.trim();
  if (!query) {
    return c.json({ requestId, error: 'Missing required field: query', code: 'MISSING_QUERY', hint: 'Send { "query": "your question" }' }, 400);
  }

  if (query.length > 2000) {
    return c.json({ requestId, error: 'Query too long (max 2000 chars)', code: 'QUERY_TOO_LONG' }, 400);
  }

  // Parse optional cache freshness + diff preferences
  const cacheFreshness = (body.cache && ['prefer', 'fresh', 'smart'].includes(body.cache) ? body.cache : 'smart') as import('../cache/index').CacheFreshness;
  const wantDiff = body.diff === true;

  // Parse optional pricing preferences
  let pricing: PricingPreferences | undefined;
  if (body.pricing) {
    const pricingResult = PricingPreferencesSchema.safeParse(body.pricing);
    if (!pricingResult.success) {
      return c.json({ requestId, error: 'Invalid pricing preferences', code: 'INVALID_PRICING', details: pricingResult.error.flatten().fieldErrors }, 400);
    }
    pricing = pricingResult.data;
  }

  // keyInfo is set by checkApiKey middleware — available from handler start
  const keyInfo = c.get('apiKeyInfo');

  // Query-level cache check — proportional cache pricing (10% of live cost, min 0.1 credits)
  const qKey = queryCacheKey(query);
  const cachedResponse = await cacheGet<Record<string, unknown>>(qKey);
  if (cachedResponse) {
    const originalCredits = (cachedResponse.costBreakdown as Record<string, unknown>)?.creditsUsed as number | undefined;
    const cacheCredits = cacheCreditCost(originalCredits ?? 2); // fallback to orch fee if missing
    if (!keyInfo.isEnvKey) {
      if (keyInfo.credits < cacheCredits) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsAvailable: keyInfo.credits, hint: 'Top up your credits at claw-net.org' }, 402);
      }
      let cacheDeducted = false;
      try {
        cacheDeducted = deductCredit(keyInfo.key, cacheCredits);
      } catch (err) {
        logger.error({ err, key: maskApiKey(keyInfo.key), credits: cacheCredits }, 'Cache credit deduction failed (possible SQLITE_BUSY)');
        return c.json({ error: 'Billing temporarily unavailable, please retry', code: 'BILLING_ERROR' }, 503);
      }
      if (!cacheDeducted) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: cacheCredits, creditsAvailable: keyInfo.credits, hint: 'Top up your credits at claw-net.org' }, 402);
      }
      trackDelegatedSpend(keyInfo, cacheCredits);
    }
    logger.info({ requestId, query: query.slice(0, 100), creditsUsed: cacheCredits }, 'Query cache hit');
    return c.json({
      ...cachedResponse,
      requestId,
      costBreakdown: { ...(cachedResponse.costBreakdown as Record<string, unknown>), creditsUsed: cacheCredits, fromCache: true },
      metadata: { ...(cachedResponse.metadata as Record<string, unknown>), cacheHits: 1, fromCache: true },
    });
  }

  // Per-key tiered rate limit (separate from global IP limit).
  // POLICY (D3): tier is based on lifetime amount_paid (cumulative across all purchases).
  // This rewards total investment, not just the most recent transaction.
  // Tiers (per 60-second window):
  //   < $20 paid  →  30 req/min  (new / casual users)
  //   $20–$99     →  60 req/min  (active developers)
  //   $100–$499   → 120 req/min  (power users)
  //   $500+       → 300 req/min  (enterprise / high-volume)
  // Alternative considered: tier by active subscription level — rejected because
  // it would downgrade heavy one-time purchasers. Revisit if subscription adoption
  // warrants a separate policy (see D3 in ROADMAP.md).
  if (!keyInfo.isEnvKey) {
    const tierLimit = rateTier(keyInfo.amountPaid).perMinute;
    const rlCount = await cacheIncr(`rl:orch:${keyInfo.key}`, 60);
    if (rlCount > tierLimit) {
      return c.json({
        requestId,
        error: 'Orchestration rate limit exceeded for your tier',
        code: 'RATE_LIMITED',
        limit: tierLimit,
        hint: 'Top up to $20+ for higher limits',
      }, 429);
    }
  }

  // Pre-check: reject zero-balance users BEFORE expensive LLM work
  if (!keyInfo.isEnvKey && keyInfo.credits < 1) {
    return c.json({
      requestId,
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      creditsAvailable: keyInfo.credits,
      hint: 'Top up your credits at claw-net.org',
    }, 402);
  }

  logger.info({ requestId, query: query.slice(0, 100) }, 'Orchestration request');

  try {
    // Build pricing-aware LLM hint (if pricing preferences provided)
    const hint = pricing ? pricingPromptHint(pricing) : undefined;
    let intent = await parseIntent(query, hint);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    // Budget pre-flight: reject if estimated cost > maxCredits before any API calls
    if (pricing) {
      const budgetCheck = checkBudget(intent, pricing);
      if (!budgetCheck.ok) {
        // Try optimizing first — maybe cheaper alternatives fit the budget
        const optimized = optimizePlan(intent, { ...pricing, strategy: 'cheapest' });
        const recheck = checkBudget(optimized.intent, pricing);
        if (!recheck.ok) {
          return c.json({
            requestId,
            error: recheck.error,
            code: 'BUDGET_EXCEEDED',
            estimatedCredits: recheck.estimatedCredits,
            maxCredits: pricing.maxCredits,
            hint: 'Increase maxCredits or simplify your query',
          }, 402);
        }
        intent = optimized.intent;
        logger.info({ requestId, swaps: optimized.swaps.length, saved: optimized.originalCredits - optimized.optimizedCredits }, 'Budget rescue — swapped to cheaper endpoints');
      } else {
        // Within budget — still optimize per strategy
        const optimized = optimizePlan(intent, pricing);
        if (optimized.swaps.length > 0) {
          intent = optimized.intent;
          logger.info({ requestId, strategy: pricing.strategy, swaps: optimized.swaps.length, saved: optimized.originalCredits - optimized.optimizedCredits }, 'Plan optimized per pricing strategy');
        }
      }
    }

    // Tighter pre-flight: now that we know the plan, check estimated cost against balance
    const planEstimate = estimatePlanCost(intent);
    if (!keyInfo.isEnvKey) {
      const estimatedTotal = round6(planEstimate.totalCredits + ORCHESTRATION_FEE);
      if (keyInfo.credits < estimatedTotal) {
        return c.json({
          requestId,
          error: 'Insufficient credits for estimated plan cost',
          code: 'INSUFFICIENT_CREDITS',
          estimatedCredits: estimatedTotal,
          creditsAvailable: keyInfo.credits,
          hint: 'Top up your credits at claw-net.org',
        }, 402);
      }
    }

    // ─── Discovery Mode ─────────────────────────────────────────────────
    // Returns the plan (endpoints, pricing, alternatives) without executing.
    // Agent caches the endpoints and calls them directly via x402.
    // Re-discovers when TTL expires to pick up cheaper/faster alternatives.
    // Cost: 0.5 credits (LLM intent parsing only, no API execution).
    const DISCOVERY_FEE = 0.5;
    if (body.mode === 'discover') {
      if (!keyInfo.isEnvKey) {
        let discoveryDeducted = false;
        try {
          discoveryDeducted = deductCredit(keyInfo.key, DISCOVERY_FEE);
        } catch (err) {
          logger.error({ err, key: maskApiKey(keyInfo.key) }, 'Discovery credit deduction failed');
          return c.json({ error: 'Billing temporarily unavailable, please retry', code: 'BILLING_ERROR' }, 503);
        }
        if (!discoveryDeducted) {
          return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: DISCOVERY_FEE, creditsAvailable: keyInfo.credits }, 402);
        }
        trackDelegatedSpend(keyInfo, DISCOVERY_FEE);
      }

      // Build discovery response with endpoints, pricing, and alternatives
      const endpoints = intent.steps.map((step) => {
        const ep = findEndpoint(step.endpointId);
        const creditCost = ep ? creditCostForEndpoint(ep) : 0.001;
        const alternatives = getAlternativesForEndpoint(step.endpointId)
          .slice(0, 5)
          .map(alt => {
            const altEp = findEndpoint(alt.id);
            return {
              endpointId: alt.id,
              creditCost: altEp ? creditCostForEndpoint(altEp) : 0.001,
              latencyMs: alt.latencyMs,
            };
          });
        return {
          endpointId: step.endpointId,
          invokeUrl: step.endpointId.startsWith('skill:')
            ? `/v1/skills/${step.endpointId.replace('skill:', '')}/invoke`
            : null, // built-in endpoints are called via orchestration, not directly
          method: 'POST',
          params: step.params,
          reason: step.reason,
          creditCost,
          estimatedUsd: creditsToUsd(creditCost),
          alternatives,
        };
      });

      // TTL heuristic: volatile categories get shorter TTLs
      const volatileKeywords = ['price', 'trade', 'swap', 'balance', 'rate', 'market', 'gas'];
      const isVolatile = volatileKeywords.some(kw =>
        query.toLowerCase().includes(kw) ||
        intent.steps.some(s => s.endpointId.toLowerCase().includes(kw))
      );
      const ttlSeconds = isVolatile ? 21600 : 86400; // 6h for volatile, 24h for stable

      logger.info({ requestId, query: query.slice(0, 100), endpoints: endpoints.length, ttl: ttlSeconds }, 'Discovery mode response');

      return c.json({
        requestId,
        mode: 'discover',
        summary: intent.summary,
        reasoning: intent.reasoning,
        endpoints,
        totalEstimatedCredits: round6(planEstimate.totalCredits),
        totalEstimatedUsd: creditsToUsd(planEstimate.totalCredits),
        ttl: ttlSeconds,
        rediscoverAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        costBreakdown: {
          discoveryFee: DISCOVERY_FEE,
          estimatedExecutionCredits: round6(planEstimate.totalCredits),
          hint: 'Call endpoints directly. Re-discover when TTL expires to find cheaper alternatives.',
        },
      });
    }

    // Execute with optional budget constraint for runtime step-skipping
    const budgetConstraint = pricing?.maxCredits
      ? { maxCredits: pricing.maxCredits, strict: pricing.strict }
      : pricing?.strict
        ? { maxCredits: Infinity, strict: true }
        : undefined;
    const execution = await executePlan(intent, budgetConstraint, keyInfo.key, cacheFreshness, wantDiff);
    const formatted = await formatResponse(query, intent, execution);

    const apiCosts = execution.totalCost;
    const cacheHits = execution.steps.filter((s) => s.cached).length;
    const staleServed = execution.steps.filter((s) => s.staleServed).length;
    const unchangedData = execution.steps.filter((s) => s.contentChanged === false && !s.cached).length;
    const totalDurationMs = Date.now() - start;

    // Smart billing: content-hash-aware pricing
    // - Cache hits (fresh): cache rate (10%)
    // - Stale served (SWR): cache rate (10%)
    // - Fresh fetch, data unchanged: cache rate (10%) — same data = same savings
    // - Fresh fetch, data changed: full rate
    let stepCredits = 0;
    for (const step of execution.steps) {
      if (!step.success) continue;
      const ep = findEndpoint(step.endpointId);
      if (!ep) continue;
      const liveCost = creditCostForEndpoint(ep);
      if (step.cached || step.staleServed) {
        // Cache or SWR hit — cache rate
        stepCredits += cacheCreditCost(liveCost);
      } else if (step.contentChanged === false) {
        // Fresh fetch but data didn't change — charge cache rate (smart pricing)
        stepCredits += cacheCreditCost(liveCost);
      } else {
        // Fresh fetch with new data — full rate
        stepCredits += liveCost;
      }
    }
    stepCredits = round6(stepCredits);
    const creditsToDeduct = stepCredits + ORCHESTRATION_FEE;
    if (!keyInfo.isEnvKey) {
      // Daily spend tracking — used for anomaly detection and optional hard cap.
      // DAILY_SPEND_CAP=0 (default): no cap — agents spend freely until credits run out.
      // Set DAILY_SPEND_CAP > 0 only to protect a specific deployment from runaway automation.
      const today = new Date().toISOString().split('T')[0];
      const dailyKey = `daily_spend:${keyInfo.key}:${today}`;
      const dailySpent = (await cacheGet<number>(dailyKey)) ?? 0;
      if (env.DAILY_SPEND_CAP > 0 && dailySpent + creditsToDeduct > env.DAILY_SPEND_CAP) {
        logger.warn({ requestId, key: maskApiKey(keyInfo.key), dailySpent, creditsToDeduct, cap: env.DAILY_SPEND_CAP }, 'Daily spend cap exceeded');
        return c.json({
          requestId,
          error: 'Daily spend cap reached. Try again tomorrow or contact support to raise your limit.',
          code: 'DAILY_CAP_EXCEEDED',
          dailyCapCredits: env.DAILY_SPEND_CAP,
          spentToday: dailySpent,
        }, 429);
      }

      let deducted = false;
      try {
        deducted = deductCredit(keyInfo.key, creditsToDeduct);
      } catch (err) {
        logger.error({ err, key: maskApiKey(keyInfo.key), credits: creditsToDeduct }, 'Credit deduction failed (possible SQLITE_BUSY)');
        return c.json({ error: 'Billing temporarily unavailable, please retry', code: 'BILLING_ERROR' }, 503);
      }
      if (deducted) trackDelegatedSpend(keyInfo, creditsToDeduct);
      if (!deducted) {
        logger.warn(
          { requestId, credits: keyInfo.credits, creditsRequired: creditsToDeduct },
          'Credit deduction failed — insufficient balance, returning 402'
        );
        return c.json({
          requestId,
          error: 'Insufficient credits to complete this request',
          code: 'INSUFFICIENT_CREDITS',
          creditsRequired: creditsToDeduct,
          creditsAvailable: keyInfo.credits,
          hint: 'Top up your credits at claw-net.org',
        }, 402);
      }

      // Update daily spend counter (25h TTL covers day boundary)
      const newDailySpent = dailySpent + creditsToDeduct;
      cacheSet(dailyKey, newDailySpent, 90_000).catch(() => {});

      // Anomaly detection: fire admin alert the first time a key crosses the threshold today
      if (newDailySpent >= env.ANOMALY_THRESHOLD && dailySpent < env.ANOMALY_THRESHOLD) {
        logger.warn({ key: maskApiKey(keyInfo.key), email: keyInfo.email, newDailySpent }, 'Anomaly: daily spend threshold crossed');
        sendAdminAlert({
          subject: `Anomaly — key ${maskApiKey(keyInfo.key)} hit ${newDailySpent.toLocaleString()} credits today`,
          body: [
            `API key anomaly detected`,
            ``,
            `Key    : ${maskApiKey(keyInfo.key)}`,
            `Email  : ${keyInfo.email}`,
            `Today  : ${today}`,
            `Spent  : ${newDailySpent.toLocaleString()} credits`,
            `Cap    : ${env.DAILY_SPEND_CAP.toLocaleString()} credits`,
            `Threshold: ${env.ANOMALY_THRESHOLD.toLocaleString()} credits`,
            ``,
            `Review at: ${env.NODE_ENV === 'production' ? 'https://api.claw-net.org' : 'http://localhost:3402'}/v1/admin/dashboard`,
          ].join('\n'),
        }).catch(() => {});
      }

      // Low-balance alert: fire-and-forget, throttled to once per 24h per key
      const remainingCredits = keyInfo.credits - creditsToDeduct;
      const LOW_BALANCE_THRESHOLD = env.LOW_BALANCE_THRESHOLD;
      if (remainingCredits < LOW_BALANCE_THRESHOLD && keyInfo.email && keyInfo.email !== 'env-key') {
        if (!wasEmailSentRecently(keyInfo.email, 'low_balance', 24 * 60 * 60 * 1000)) {
          logEmailSend(keyInfo.email, 'low_balance');
          sendLowBalanceEmail({ to: keyInfo.email, credits: remainingCredits, apiKey: keyInfo.key })
            .catch((err) => logger.warn({ err }, 'Low-balance email failed'));
        }
      }
    }

    const usageEntry = {
      requestId,
      timestamp: new Date().toISOString(),
      query,
      plannedSteps: intent.steps.length,
      executedSteps: execution.steps.length,
      successfulSteps: execution.steps.filter((s) => s.success).length,
      cacheHits,
      totalDurationMs,
      apiCost: apiCosts,
      markup: 0,
      total: creditsToDeduct,
      success: true,
      llmProvider: env.LLM_PROVIDER,
    };
    logUsage(usageEntry);
    insertOrchestration({ id: requestId, ...usageEntry, apiKey: keyInfo?.key });

    // ─── Auto-Manifest (inline trust verdict — free, no extra cost) ────
    let trustVerdict: { verdict: string; confidence: number; sources: number; attestationId?: string } | null = null;
    try {
      const { computeVerdict } = await import('../core/manifest-engine');
      const { crossReferenceExternalTrust } = await import('../core/manifest-engine');

      // Build a lightweight verify result from execution step success rates
      const successfulSteps = execution.steps.filter(s => s.success).length;
      const totalSteps = execution.steps.length || 1;
      const stepVerifyResult = {
        overall: (successfulSteps / totalSteps >= 0.8 ? 'verified' : successfulSteps / totalSteps >= 0.5 ? 'partial' : 'disputed') as 'verified' | 'partial' | 'disputed',
        claims: [],
        verified_count: successfulSteps,
        disputed_count: totalSteps - successfulSteps,
        unverifiable_count: 0,
      };

      // Cross-reference external trust signals
      const externalTrust = await crossReferenceExternalTrust(
        { preflight: { action: 'orchestrate', params: { query } } },
        [],
      );

      const result = computeVerdict(stepVerifyResult, null, null, externalTrust);
      trustVerdict = {
        verdict: result.verdict,
        confidence: result.confidence,
        sources: (externalTrust?.sources?.length || 0) + 1,
      };
    } catch {}

    // ─── Attestation (delivery proof) ──────────────────────────────────
    let attestationId: string | null = null;
    const manifestId = c.req.header('X-Manifest-Id') || undefined;
    try {
      attestationId = createAutoAttestation(
        keyInfo.key,
        'ORCHESTRATE',
        'POST /v1/orchestrate',
        { query, pricing },
        { answer: formatted.answer },
        creditsToDeduct,
        totalDurationMs,
        manifestId,
        execution.steps.map(s => ({
          endpointId: s.endpointId,
          success: s.success,
          cached: s.cached,
          durationMs: s.durationMs,
          cost: s.cost,
        })),
      );
      if (trustVerdict) trustVerdict.attestationId = attestationId || undefined;
    } catch {}

    const responsePayload = {
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions,
      costBreakdown: {
        creditsUsed: creditsToDeduct,
        stepCredits,
        orchestrationFee: ORCHESTRATION_FEE,
        estimatedUsd: creditsToUsd(creditsToDeduct),
        cacheHitsSaved: cacheHits,
        staleServed,
        unchangedData,
        // Show how much the smart cache saved vs full-price
        fullPriceCredits: round6(execution.steps.filter(s => s.success).reduce((sum, s) => {
          const ep = findEndpoint(s.endpointId);
          return sum + (ep ? creditCostForEndpoint(ep) : 0);
        }, 0) + ORCHESTRATION_FEE),
        creditsSaved: round6(execution.steps.filter(s => s.success).reduce((sum, s) => {
          const ep = findEndpoint(s.endpointId);
          if (!ep) return sum;
          const live = creditCostForEndpoint(ep);
          if (s.cached || s.staleServed || s.contentChanged === false) {
            return sum + (live - cacheCreditCost(live));
          }
          return sum;
        }, 0)),
        ...(pricing && {
          strategy: pricing.strategy,
          maxCredits: pricing.maxCredits,
          targetCredits: pricing.targetCredits,
          budgetSkippedSteps: execution.steps.filter((s) => s.error === 'BUDGET_EXCEEDED').length,
        }),
      },
      metadata: {
        stepsExecuted: execution.steps.length,
        cacheHits,
        totalDurationMs,
        llmProvider: env.LLM_PROVIDER,
        synthesisCached: formatted.synthesisCached,
        simulationMode: isSimulationMode,
      },
      route: {
        summary: intent.summary,
        reasoning: intent.reasoning,
        steps: execution.steps.map((s, i) => ({
          endpoint: intent.steps[i]?.endpointId ?? s.endpointId,
          endpointId: s.endpointId,
          success: s.success,
          cached: s.cached,
          durationMs: s.durationMs,
          cost: s.cost,
          ...(s.error && { error: s.error }),
        })),
      },
    };

    // Store in query cache
    await cacheSet(qKey, responsePayload);

    return c.json({
      requestId, ...responsePayload,
      ...(trustVerdict && { trust: trustVerdict }),
      ...(attestationId && {
        attestation: { id: attestationId, verifyUrl: `${env.CLAWNET_BASE_URL}/v1/attest/verify/${attestationId}` },
      }),
      ...(execution.birthCertificates?.length && {
        provenance: {
          certificates: execution.birthCertificates,
          heartDid: getHeartSafe()?.did ?? null,
          canonicalDid: 'did:web:api.claw-net.org',
        },
      }),
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const code = (err as { code?: string }).code ?? 'INTERNAL_ERROR';

    logger.error({ requestId, error: error.message, code }, 'Orchestration failed');

    logUsage({
      requestId,
      timestamp: new Date().toISOString(),
      query,
      plannedSteps: 0,
      executedSteps: 0,
      successfulSteps: 0,
      cacheHits: 0,
      totalDurationMs: Date.now() - start,
      apiCost: 0,
      markup: 0,
      total: 0,
      success: false,
      llmProvider: env.LLM_PROVIDER,
    });

    return c.json({
      requestId,
      error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      code,
      ...(env.NODE_ENV !== 'production' && code === 'INTENT_PARSE_FAILED' && { hint: 'Check your LLM provider config in .env' }),
    }, 500);
  }
});

// GET /v1/health — public: only safe operational fields
apiRouter.get('/health', (c) => {
  return c.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    endpoints: apiRegistry.length,
  });
});

// GET /v1/registry — handled by registryRouter (see routes/registry.ts)

// GET /v1/usage — strip query field to avoid leaking user queries on public endpoint
apiRouter.get('/usage', (c) => {
  const recent = getRecentUsage(20).map((entry) => {
    const { query: _q, ...rest } = entry;
    return rest;
  });
  return c.json({ stats: getUsageStats(), recent });
});

// GET /v1/balance
apiRouter.get('/balance', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const data = getApiKeyBalance(keyInfo.key);
  if (!data) return c.json({ error: 'Invalid or inactive API key', code: 'INVALID_API_KEY' }, 401);
  return c.json({
    credits: data.credits,
    creditsUsed: data.credits_used,
    memberSince: data.created_at,
  });
});

// GET /v1/estimate?query=...&strategy=...&maxCredits=... — runs intent parsing only, returns estimated credit cost
// No credits are deducted. Useful for budgeting before committing to an orchestration.
apiRouter.get('/estimate', async (c) => {
  const query = c.req.query('query')?.trim();
  if (!query) return c.json({ error: 'Missing required query parameter: query', code: 'MISSING_QUERY' }, 400);
  if (query.length > 2000) return c.json({ error: 'Query too long (max 2000 chars)', code: 'QUERY_TOO_LONG' }, 400);

  // Optional pricing params from query string
  const strategyParam = c.req.query('strategy');
  const maxCreditsParam = c.req.query('maxCredits');
  let pricing: PricingPreferences | undefined;
  if (strategyParam || maxCreditsParam) {
    const parsed = PricingPreferencesSchema.safeParse({
      strategy: strategyParam ?? 'balanced',
      maxCredits: maxCreditsParam ? parseInt(maxCreditsParam) : undefined,
    });
    if (parsed.success) pricing = parsed.data;
  }

  try {
    const hint = pricing ? pricingPromptHint(pricing) : undefined;
    const plan = await parseIntent(query, hint);

    // Default estimate
    const estimate = estimatePlanCost(plan);

    // If pricing provided, show optimized estimate too
    let optimized: { estimatedCredits: number; swaps: { from: string; to: string; savedCredits: number }[] } | undefined;
    if (pricing) {
      const opt = optimizePlan(plan, pricing);
      if (opt.swaps.length > 0) {
        optimized = {
          estimatedCredits: opt.optimizedCredits,
          swaps: opt.swaps.map((s) => ({ from: s.from, to: s.to, savedCredits: s.savedCredits })),
        };
      }
    }

    const breakdown = estimate.perStep.map((s, i) => ({
      endpointId: s.endpointId,
      credits: s.credits,
      reason: plan.steps[i]?.reason ?? '',
      alternatives: getAlternativesForEndpoint(s.endpointId).slice(0, 3),
    }));

    return c.json({
      query,
      estimatedCredits: estimate.totalCredits,
      steps: plan.steps.length,
      breakdown,
      summary: plan.summary,
      ...(optimized && { optimized }),
    });
  } catch (err) {
    logger.error({ err }, '/v1/estimate failed');
    return c.json({ error: 'Failed to estimate query cost', code: 'ESTIMATE_FAILED' }, 500);
  }
});

// GET /v1/session/:sessionId — called by success page after Stripe redirect
apiRouter.get('/session/:sessionId', async (c) => {
  const { sessionId } = c.req.param();

  if (!sessionId || sessionId.length < 20) {
    return c.json({ error: 'Invalid session ID', code: 'INVALID_SESSION' }, 400);
  }

  const row = getApiKeyByStripeSession(sessionId);
  if (!row) {
    return c.json({ error: 'Session not found — payment may still be processing', code: 'SESSION_NOT_FOUND' }, 404);
  }

  const keyInfo = getApiKeyBalance(row.key);
  if (!keyInfo) {
    return c.json({ error: 'Key not found', code: 'KEY_NOT_FOUND' }, 404);
  }

  // Mask email: jo****@gmail.com
  const masked = keyInfo.email.replace(/^(.{2})(.*)(@.*)$/, (_: string, a: string, b: string, d: string) =>
    a + '*'.repeat(Math.min(b.length, 4)) + d
  );

  const maskedKey = maskApiKey(row.key);

  return c.json({
    apiKey: maskedKey,
    credits: keyInfo.credits,
    email: masked,
  });
});

// POST /v1/resend-key — lost key recovery, no auth required
apiRouter.post('/resend-key', async (c) => {
  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  const emailResult = z.string().email().safeParse(email);
  if (!emailResult.success) {
    return c.json({ error: 'Valid email required', code: 'INVALID_EMAIL' }, 400);
  }

  // Rate limit: 1 resend per email per 5 minutes — persisted to DB so it survives restarts
  if (wasEmailSentRecently(email, 'resend_key', 5 * 60 * 1000)) {
    return c.json({ message: 'If an account exists for this email, your key has been sent.' });
  }
  logEmailSend(email, 'resend_key');

  // Always return same message — don't reveal if email exists
  const keyInfo = getApiKeyByEmail(email);
  if (keyInfo) {
    try {
      await sendApiKeyEmail({
        to: keyInfo.email,
        apiKey: keyInfo.key,
        credits: keyInfo.credits,
        amountPaid: keyInfo.amount_paid,
      });
    } catch (err) {
      logger.error({ err, email }, 'resend-key: email send failed');
    }
  }

  return c.json({ message: 'If an account exists for this email, your key has been sent.' });
});