import { insertOrchestration, getApiKeyBalance, getApiKeyByStripeSession, getApiKeyByEmail } from '../db/index';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { logUsage, getRecentUsage, getUsageStats } from '../utils/usage';
import { cacheStats, cacheGet, cacheSet } from '../cache/index';
import { apiRegistry } from '../config/api-registry';
import { env, isSimulationMode } from '../config/index';
import { logger } from '../utils/logger';
import { sendApiKeyEmail } from '../utils/email';
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

  logger.info({ requestId, query: query.slice(0, 100) }, 'Orchestration request');

  try {
    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    const apiCosts = execution.totalCost;
    const markup = apiCosts * (env.MARKUP_PERCENT / 100);
    const total = apiCosts + markup;
    const cacheHits = execution.steps.filter((s) => s.cached).length;
    const savings = cacheHits * 0.002;
    const totalDurationMs = Date.now() - start;

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
      markup,
      total,
      success: true,
      llmProvider: env.LLM_PROVIDER,
    };
    logUsage(usageEntry);
    insertOrchestration({ id: requestId, ...usageEntry });

    const responsePayload = {
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions,
      costBreakdown: {
        apiCosts: Math.round(apiCosts * 10000) / 10000,
        markup: Math.round(markup * 10000) / 10000,
        total: Math.round(total * 10000) / 10000,
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

  return c.json({
    apiKey: row.key,
    credits: keyInfo.credits,
    email: masked,
  });
});

// POST /v1/resend-key — lost key recovery, no auth required
const recentResends = new Map<string, number>();

apiRouter.post('/resend-key', async (c) => {
  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return c.json({ error: 'Valid email required' }, 400);
  }

  // Rate limit: 1 resend per email per 5 minutes
  const lastSent = recentResends.get(email) ?? 0;
  if (Date.now() - lastSent < 5 * 60 * 1000) {
    return c.json({ message: 'If an account exists for this email, your key has been sent.' });
  }
  recentResends.set(email, Date.now());

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