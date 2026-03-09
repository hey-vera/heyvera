import { z } from 'zod';
import { insertOrchestration, getApiKeyBalance, getApiKeyByStripeSession, getApiKeyByEmail, deductCredit } from '../db/index';
import { Hono } from 'hono';
import { creditsForApiCost } from '../core/credits';
import { nanoid } from 'nanoid';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { logUsage, getRecentUsage, getUsageStats } from '../utils/usage';
import { cacheStats, cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { apiRegistry } from '../config/api-registry';
import { env, isSimulationMode } from '../config/index';
import { logger } from '../utils/logger';
import { sendApiKeyEmail, sendLowBalanceEmail } from '../utils/email';
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

  let body: { query?: string };
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

  // Query-level cache check
  const qKey = queryCacheKey(query);
  const cachedResponse = await cacheGet<Record<string, unknown>>(qKey);
  if (cachedResponse) {
    logger.info({ requestId, query: query.slice(0, 100) }, 'Query cache hit');
    return c.json({ ...cachedResponse, requestId, metadata: { ...(cachedResponse.metadata as Record<string, unknown>), cacheHits: 1 } });
  }

  // Per-key tiered rate limit (separate from global IP limit)
  const keyInfo = c.get('apiKeyInfo');
  if (!keyInfo.isEnvKey) {
    const tierLimit = keyInfo.amountPaid >= 500 ? 300
      : keyInfo.amountPaid >= 100 ? 120
      : keyInfo.amountPaid >= 20  ? 60
      : 30;
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
    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    const apiCosts = execution.totalCost;
// margin is in package spread, no runtime markup applied
    const cacheHits = execution.steps.filter((s) => s.cached).length;
    const savings = cacheHits * 0.002;
    const totalDurationMs = Date.now() - start;

    const creditsToDeduct = creditsForApiCost(apiCosts);
    if (!keyInfo.isEnvKey) {
      const deducted = deductCredit(keyInfo.key, creditsToDeduct);
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

      // Low-balance alert: fire-and-forget, throttled to once per 24h per key
      const remainingCredits = keyInfo.credits - creditsToDeduct;
      const LOW_BALANCE_THRESHOLD = parseInt(process.env.LOW_BALANCE_THRESHOLD ?? '500');
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
      total: apiCosts,
      success: true,
      llmProvider: env.LLM_PROVIDER,
    };
    logUsage(usageEntry);
    insertOrchestration({ id: requestId, ...usageEntry, apiKey: keyInfo?.key });

    const responsePayload = {
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions,
      costBreakdown: {
        costUsd: Math.round(apiCosts * 10000) / 10000,
        creditsUsed: creditsToDeduct,
        savings: Math.round(savings * 10000) / 10000,
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

    return c.json({ requestId, ...responsePayload });

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
      hint: code === 'INTENT_PARSE_FAILED' ? 'Check your LLM provider config in .env' : undefined,
    }, 500);
  }
});

// GET /v1/health
apiRouter.get('/health', (c) => {
  const stats = getUsageStats();
  const cache = cacheStats();
  return c.json({
    status: 'ok',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    simulationMode: isSimulationMode,
    cache,
    usage: stats,
    endpoints: apiRegistry.length,
  });
});

// GET /v1/registry
apiRouter.get('/registry', (c) => {
  const categories = apiRegistry.reduce((acc, ep) => {
    if (!acc[ep.category]) acc[ep.category] = [];
    acc[ep.category].push({ id: ep.id, name: ep.name, costPerCall: ep.costPerCall, description: ep.description });
    return acc;
  }, {} as Record<string, unknown[]>);
  return c.json({ totalEndpoints: apiRegistry.length, categories });
});

// GET /v1/usage
apiRouter.get('/usage', (c) => {
  return c.json({ stats: getUsageStats(), recent: getRecentUsage(20) });
});

// GET /v1/balance
apiRouter.get('/balance', async (c) => {
  const key = c.req.header('X-API-Key');
  if (!key) return c.json({ error: 'Missing X-API-Key header' }, 401);
  const data = getApiKeyBalance(key);
  if (!data) return c.json({ error: 'Invalid or inactive API key' }, 401);
  return c.json({
    credits: data.credits,
    creditsUsed: data.credits_used,
    memberSince: data.created_at,
  });
});

// GET /v1/session/:sessionId — called by success page after Stripe redirect
apiRouter.get('/session/:sessionId', async (c) => {
  const { sessionId } = c.req.param();

  if (!sessionId || sessionId.length < 20) {
    return c.json({ error: 'Invalid session ID' }, 400);
  }

  const row = getApiKeyByStripeSession(sessionId);
  if (!row) {
    return c.json({ error: 'Session not found — payment may still be processing' }, 404);
  }

  const keyInfo = getApiKeyBalance(row.key);
  if (!keyInfo) {
    return c.json({ error: 'Key not found' }, 404);
  }

  // Mask email: jo****@gmail.com
  const masked = keyInfo.email.replace(/^(.{2})(.*)(@.*)$/, (_: string, a: string, b: string, d: string) =>
    a + '*'.repeat(Math.min(b.length, 4)) + d
  );

  // Mask key: show first 6 and last 4 chars
  const maskedKey = row.key.slice(0, 6) + '...' + row.key.slice(-4);

  return c.json({
    apiKey: maskedKey,
    credits: keyInfo.credits,
    email: masked,
  });
});

// POST /v1/resend-key — lost key recovery, no auth required
apiRouter.post('/resend-key', async (c) => {
  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  const emailResult = z.string().email().safeParse(email);
  if (!emailResult.success) {
    return c.json({ error: 'Valid email required' }, 400);
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