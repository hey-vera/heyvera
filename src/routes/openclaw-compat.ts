import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';

const router = new Hono();

// ─── GET /v1/openclaw-compat/skill-manifest — Public skill manifest ────────

router.get('/skill-manifest', async (c) => {
  return c.json({
    name: 'clawnet-data',
    version: '1.0.0',
    description: 'Access 344 crypto data endpoints through ClawNet. Prices, on-chain data, sentiment, risk scoring — with smart caching that saves 90% on repeat queries.',
    author: 'ClawNet',
    capabilities: [
      'crypto_price', 'token_analysis', 'whale_tracking', 'social_sentiment',
      'risk_scoring', 'defi_yields', 'exchange_data', 'news_search',
    ],
    setup: {
      apiKey: {
        description: 'Get a ClawNet API key at claw-net.org',
        envVar: 'CLAWNET_API_KEY',
      },
    },
    endpoints: [
      {
        name: 'query',
        description: 'Ask any crypto question in natural language',
        method: 'POST',
        url: 'https://api.claw-net.org/v1/orchestrate',
        headers: { 'X-API-Key': '{{CLAWNET_API_KEY}}', 'Content-Type': 'application/json' },
        body: { query: '{{input}}', cache: 'smart', pricing: { maxCredits: 10 } },
      },
      {
        name: 'simple-query',
        description: 'Simplified query endpoint with flat response — ideal for agent integrations',
        method: 'POST',
        url: 'https://api.claw-net.org/v1/openclaw-compat/query',
        headers: { 'X-API-Key': '{{CLAWNET_API_KEY}}', 'Content-Type': 'application/json' },
        body: { question: '{{input}}' },
      },
    ],
  });
});

// ─── POST /v1/openclaw-compat/query — Simplified query for OpenClaw agents ──

const QuerySchema = z.object({
  question: z.string().min(1).max(2000),
  maxCredits: z.number().min(1).max(1000).optional().default(10),
});

router.post('/query', checkApiKey, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = QuerySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid body — send { question: string }', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }

  // Forward to the internal orchestrate handler via fetch to reuse all existing logic
  const keyInfo = c.get('apiKeyInfo');
  const apiKey = c.req.header('X-API-Key') ?? '';

  // Build internal orchestrate request
  const orchestrateUrl = new URL('/v1/orchestrate', `http://127.0.0.1:${process.env.PORT ?? 3402}`);

  try {
    const resp = await fetch(orchestrateUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        query: parsed.data.question,
        cache: 'smart',
        pricing: { maxCredits: parsed.data.maxCredits, strategy: 'cheapest' },
      }),
    });

    const result = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      return c.json({
        error: (result as any).error ?? 'Query failed',
        code: (result as any).code ?? 'QUERY_FAILED',
      }, resp.status as 400);
    }

    // Flatten the response for easy agent consumption
    const costBreakdown = result.costBreakdown as Record<string, unknown> | undefined;
    const creditsUsed = (costBreakdown?.total as number) ?? 0;
    const cached = ((costBreakdown?.cacheHits as number) ?? 0) > 0;
    const usdCost = Math.round(creditsUsed * 0.001 * 10000) / 10000;
    const openclawEstimate = 0.014;
    const saved = Math.round((openclawEstimate - usdCost) * 10000) / 10000;

    return c.json({
      answer: result.response ?? result.summary ?? '',
      data: result.data ?? result.results ?? null,
      cost: { credits: creditsUsed, usd: usdCost },
      cached,
      savedVsOpenClaw: saved > 0 ? `$${saved.toFixed(4)} saved vs direct API calls` : null,
    });
  } catch (err) {
    return c.json({ error: 'Internal query failed', code: 'INTERNAL_ERROR' }, 500);
  }
});

export { router as openclawCompatRouter };
