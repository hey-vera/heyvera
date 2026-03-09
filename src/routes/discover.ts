import { Hono } from 'hono';
import { z } from 'zod';
import { embed } from '../core/embeddings';
import { searchDiscovery } from '../db/index';
import { isEmbeddingModelReady } from '../core/embeddings';

const discoverRouter = new Hono();

const DiscoverBody = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  provider: z.string().optional(),
});

discoverRouter.post('/', async (c) => {
  if (!isEmbeddingModelReady()) {
    return c.json({ error: 'Embedding model not ready yet — try again in a few seconds', code: 'MODEL_LOADING' }, 503);
  }

  let body: z.infer<typeof DiscoverBody>;
  try {
    body = DiscoverBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' }, 400);
  }

  const queryVec = await embed(body.query);
  let results = searchDiscovery(queryVec, body.limit * 2); // over-fetch for provider filter

  if (body.provider) {
    results = results.filter(r => r.provider.toLowerCase() === body.provider!.toLowerCase());
  }

  return c.json({
    query: body.query,
    results: results.slice(0, body.limit).map(r => ({
      id: r.id,
      name: r.skillName,
      description: r.skillDesc,
      provider: r.provider,
      score: +(1 - r.distance).toFixed(4), // cosine similarity from L2 distance
    })),
    total: results.length,
  });
});

export { discoverRouter };
