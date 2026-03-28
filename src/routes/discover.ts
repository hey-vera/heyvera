import { Hono } from 'hono';
import { z } from 'zod';
import { runDiscovery } from '../core/discovery-engine';
import { isEmbeddingModelReady } from '../core/embeddings';
import { logger } from '../utils/logger';
import { cacheIncr } from '../cache/index';

const discoverRouter = new Hono();

// Public endpoint — no API key required. Rate-limited by IP (60 req/hour).
discoverRouter.use('*', async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ?? 'unknown';
  const key = `discover-ratelimit:${ip}`;
  const count = await cacheIncr(key, 3600);
  if (count > 60) {
    return c.json({ error: 'Rate limited — 60 requests per hour for unauthenticated discovery', code: 'RATE_LIMITED' }, 429);
  }
  return next();
});

const DiscoverBody = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  filters: z.object({
    provider: z.string().optional(),
    source: z.array(z.enum(['semantic', 'p2p', 'onchain'])).optional(),
  }).optional(),
  weights: z.object({
    semantic: z.number().min(0).max(1).optional(),
    p2p:      z.number().min(0).max(1).optional(),
    onchain:  z.number().min(0).max(1).optional(),
  }).optional(),
});

discoverRouter.post('/', async (c) => {
  if (!isEmbeddingModelReady()) {
    return c.json({ error: 'Vector search is still loading, try /v1/skills instead', code: 'SERVICE_UNAVAILABLE' }, 503);
  }

  let body: z.infer<typeof DiscoverBody>;
  try {
    body = DiscoverBody.parse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' }, 400);
  }

  // Validate custom weights: if any are provided, fill missing with defaults and normalize
  if (body.weights) {
    const w = body.weights;
    const s = w.semantic ?? 0.60;
    const p = w.p2p ?? 0.25;
    const o = w.onchain ?? 0.15;
    const sum = s + p + o;
    if (sum <= 0) {
      return c.json({ error: 'weights must have a positive sum', code: 'VALIDATION_ERROR' }, 400);
    }
    // Normalize so they sum to 1.0 before passing to engine
    body.weights = { semantic: s / sum, p2p: p / sum, onchain: o / sum };
  }

  try {
    const { results, layerStats } = await runDiscovery({
      query: body.query,
      limit: body.limit,
      filters: body.filters,
      weights: body.weights,
    });

    return c.json({
      query: body.query,
      results,
      total: results.length,
      layers: layerStats,
    });
  } catch (err) {
    logger.error({ err, query: body.query }, 'Discovery engine error');
    return c.json({ error: 'Discovery failed', code: 'DISCOVERY_ERROR' }, 500);
  }
});

export { discoverRouter };
