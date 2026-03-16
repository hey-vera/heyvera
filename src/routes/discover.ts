import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { runDiscovery } from '../core/discovery-engine';
import { isEmbeddingModelReady } from '../core/embeddings';
import { logger } from '../utils/logger';

const discoverRouter = new Hono();
discoverRouter.use('*', checkApiKey);

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
