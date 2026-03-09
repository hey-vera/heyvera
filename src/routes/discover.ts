import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { runDiscovery } from '../core/discovery-engine';
import { isEmbeddingModelReady } from '../core/embeddings';

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

  // Validate custom weights sum to ~1.0 if all three are provided
  if (body.weights) {
    const w = body.weights;
    if (w.semantic !== undefined && w.p2p !== undefined && w.onchain !== undefined) {
      const sum = w.semantic + w.p2p + w.onchain;
      if (Math.abs(sum - 1.0) > 0.01) {
        return c.json({ error: 'weights must sum to 1.0', code: 'VALIDATION_ERROR' }, 400);
      }
    }
  }

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
});

export { discoverRouter };
