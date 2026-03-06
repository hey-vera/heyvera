import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { logUsage } from '../utils/usage';
import { getRecentUsage, getUsageStats } from '../utils/usage';
import { cacheStats } from '../cache/index';
import { apiRegistry } from '../config/api-registry';
import { env, isSimulationMode } from '../config/index';
import { logger } from '../utils/logger';

export const apiRouter = new Hono();

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

  // Input sanitization
  if (query.length > 2000) {
    return c.json({ requestId, error: 'Query too long (max 2000 chars)', code: 'QUERY_TOO_LONG' }, 400);
  }

  logger.info({ requestId, query: query.slice(0, 100) }, 'Orchestration request');

  try {
    // Stage 1: Parse intent
    const intent = await parseIntent(query);
    // Enforce max steps
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    // Stage 2: Execute
    const execution = await executePlan(intent);

    // Stage 3: Synthesize
    const formatted = await formatResponse(query, intent, execution);

    // Stage 4: Cost engine
    const apiCosts = execution.totalCost;
    const markup = apiCosts * (env.MARKUP_PERCENT / 100);
    const total = apiCosts + markup;
    const cacheHits = execution.steps.filter((s) => s.cached).length;
    const savings = cacheHits * 0.002; // avg endpoint cost estimate

    const totalDurationMs = Date.now() - start;

    // Log usage
    logUsage({
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
    });

    return c.json({
      requestId,
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