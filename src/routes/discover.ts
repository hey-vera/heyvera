import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { runDiscovery } from '../core/discovery-engine';

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
  let body: z.infer<typeof DiscoverBody>;
  try {
    body = DiscoverBody.parse(await c.req.json());
  } catch {
    return c.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' }, 400);
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
