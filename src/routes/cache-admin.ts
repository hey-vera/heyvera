import { Hono } from 'hono';
import { cacheStats, smartCacheSet, invalidateByEndpoint, invalidateKey } from '../cache/index';
import { getVolatilityStats, cleanupOldVolatility } from '../cache/adaptive-ttl';
import { getHotKeys, getWarmingCandidates, getCacheAnalytics, cleanupAccessLog } from '../cache/warming';
import { getDb } from '../db/index';

export const cacheAdminRouter = new Hono();

// GET /cache/stats — memory/redis stats + daily analytics
cacheAdminRouter.get('/cache/stats', (c) => {
  const stats = cacheStats();
  const analytics = getCacheAnalytics('day');
  return c.json({ ...stats, analytics });
});

// GET /cache/volatility — all volatility entries
cacheAdminRouter.get('/cache/volatility', (c) => {
  return c.json(getVolatilityStats());
});

// GET /cache/hot-keys — hot cache keys
cacheAdminRouter.get('/cache/hot-keys', (c) => {
  return c.json(getHotKeys());
});

// GET /cache/warming-candidates — keys to pre-warm
cacheAdminRouter.get('/cache/warming-candidates', (c) => {
  return c.json(getWarmingCandidates());
});

// DELETE /cache/cleanup — prune old volatility + access log data
cacheAdminRouter.delete('/cache/cleanup', (c) => {
  const volatilityDeleted = cleanupOldVolatility();
  const accessLogDeleted = cleanupAccessLog();
  return c.json({ ok: true, volatilityDeleted, accessLogDeleted });
});

// DELETE /cache/key/:key — manual cache invalidation
cacheAdminRouter.delete('/cache/key/:key', async (c) => {
  const key = c.req.param('key');
  // Overwrite with null and a 0s TTL to effectively expire it immediately
  await smartCacheSet(key, null, 0);
  return c.json({ ok: true, key });
});

// DELETE /cache/endpoint/:endpointId — invalidate all cache entries for an endpoint
cacheAdminRouter.delete('/cache/endpoint/:endpointId', async (c) => {
  const endpointId = c.req.param('endpointId');
  const count = await invalidateByEndpoint(endpointId);
  return c.json({ ok: true, entriesInvalidated: count });
});

// DELETE /cache/keys — batch invalidate multiple keys
cacheAdminRouter.delete('/cache/keys', async (c) => {
  const body = await c.req.json<{ keys: string[] }>();
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    return c.json({ error: 'Provide { keys: ["key1", "key2"] }', code: 'INVALID_BODY' }, 400);
  }
  if (body.keys.length > 100) {
    return c.json({ error: 'Max 100 keys per batch', code: 'TOO_MANY_KEYS' }, 400);
  }
  let invalidated = 0;
  for (const key of body.keys) {
    await invalidateKey(key);
    invalidated++;
  }
  return c.json({ ok: true, invalidated });
});

// GET /cache/endpoint-analytics — per-endpoint cache performance
cacheAdminRouter.get('/cache/endpoint-analytics', (c) => {
  const rows = getDb().prepare(`
    SELECT endpoint_id,
           COUNT(*) as total_accesses,
           SUM(hit) as hits,
           SUM(stale_served) as stale_served,
           SUM(CASE WHEN content_changed = 0 THEN 1 ELSE 0 END) as unchanged_fetches,
           ROUND(AVG(credits_saved), 4) as avg_credits_saved,
           ROUND(SUM(credits_saved), 2) as total_credits_saved
    FROM cache_access_log
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY endpoint_id
    ORDER BY total_accesses DESC
    LIMIT 50
  `).all() as Array<{
    endpoint_id: string;
    total_accesses: number;
    hits: number;
    stale_served: number;
    unchanged_fetches: number;
    avg_credits_saved: number;
    total_credits_saved: number;
  }>;

  return c.json({
    endpoints: rows.map((r) => ({
      endpointId: r.endpoint_id,
      totalAccesses: r.total_accesses,
      hits: r.hits,
      staleServed: r.stale_served,
      unchangedFetches: r.unchanged_fetches,
      avgCreditsSaved: r.avg_credits_saved,
      totalCreditsSaved: r.total_credits_saved,
      hitRate: r.total_accesses > 0 ? Math.round((r.hits / r.total_accesses) * 100) / 100 : 0,
    })),
  });
});
