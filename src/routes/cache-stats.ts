import { Hono } from 'hono';
import { getDb } from '../db/index';
import { checkApiKey } from '../middleware/auth';
import { getCacheAnalytics } from '../cache/warming';
import { getTTLSuggestions, getBudgetAdvice } from '../cache/optimizer';

export const cacheStatsRouter = new Hono();

// GET /my-stats — per-agent cache performance stats
cacheStatsRouter.get('/my-stats', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const apiKey = keyInfo.key;

  // Agent's own orchestration stats (cache_hits column tracks per-orchestration cache usage)
  const agentRow = getDb()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN cache_hits > 0 THEN 1 ELSE 0 END) AS cached,
              COALESCE(SUM(cache_hits), 0) AS total_cache_hits
       FROM orchestrations WHERE api_key = ?`,
    )
    .get(apiKey) as { total: number; cached: number; total_cache_hits: number } | undefined;

  const total = agentRow?.total ?? 0;
  const cached = agentRow?.cached ?? 0;
  const hitRate = total > 0 ? Math.round((cached / total) * 10000) / 10000 : 0;

  // Find the agent's most-used endpoint from orchestrations (best-effort)
  const topEndpointRow = getDb()
    .prepare(
      `SELECT skill_id, COUNT(*) AS cnt
       FROM orchestrations
       WHERE api_key = ? AND skill_id IS NOT NULL
       GROUP BY skill_id
       ORDER BY cnt DESC
       LIMIT 1`,
    )
    .get(apiKey) as { skill_id: string; cnt: number } | undefined;

  // Platform-wide analytics from cache access log
  const platform = getCacheAnalytics('week');

  // Estimate credits saved: cached queries x average credit cost
  const estimatedCreditsSaved = Math.round(platform.totalCreditsSaved * (total > 0 ? cached / Math.max(platform.hitCount, 1) : 0) * 100) / 100;

  // Per-agent budget advice
  const suggestions = getBudgetAdvice(apiKey);

  return c.json({
    yourStats: {
      totalQueries: total,
      cacheHits: cached,
      hitRate,
      estimatedCreditsSaved,
      mostCachedEndpoint: topEndpointRow?.skill_id ?? null,
    },
    platformStats: {
      globalHitRate: platform.hitRate,
      totalCreditsSaved: platform.totalCreditsSaved,
      topCachedEndpoints: platform.topEndpoints.slice(0, 5).map((e) => e.endpointId),
    },
    suggestions,
  });
});

// GET /optimizer — TTL suggestions for all endpoints (generic, no auth needed)
cacheStatsRouter.get('/optimizer', (c) => {
  const suggestions = getTTLSuggestions();
  return c.json({ suggestions });
});
