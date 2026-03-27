import { Hono } from 'hono';
import { apiRegistry } from '../config/api-registry';
import { getCircuitStats } from '../core/circuit-breaker';
import { getDb } from '../db/connection';

const endpointsRouter = new Hono();

// Public — no auth required. Used by the endpoints catalog page.
endpointsRouter.get('/', (c) => {
  const url = new URL(c.req.url);
  const category = url.searchParams.get('category') || undefined;
  const search = url.searchParams.get('q') || undefined;
  const source = url.searchParams.get('source') || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '500', 10)));
  const offset = (page - 1) * limit;

  const circuits = getCircuitStats();

  // Static registry endpoints
  const staticData = apiRegistry.map((ep) => {
    const circuit = circuits[ep.id];
    const state = circuit?.state ?? 'CLOSED';
    const failures = circuit?.failures ?? 0;
    const status: 'operational' | 'degraded' | 'down' =
      state === 'CLOSED'    ? 'operational' :
      state === 'HALF_OPEN' ? 'degraded'    : 'down';

    return {
      id:           ep.id,
      provider:     ep.provider,
      name:         ep.name,
      description:  ep.description,
      category:     ep.category,
      costPerCall:  ep.costPerCall,
      latencyMs:    ep.latencyMs,
      inputSchema:  ep.inputSchema,
      outputFields: ep.outputFields,
      rateLimit:    ep.rateLimit ?? null,
      status,
      circuitState: state,
      failures,
      source: 'registry',
    };
  });

  // Indexed (discovered) endpoints from DB
  let indexedData: any[] = [];
  let indexedTotal = 0;
  try {
    let countSql = 'SELECT COUNT(*) as n FROM indexed_endpoints WHERE 1=1';
    let sql = 'SELECT * FROM indexed_endpoints WHERE 1=1';
    const params: unknown[] = [];
    const countParams: unknown[] = [];

    if (category) {
      sql += ' AND category = ?'; params.push(category);
      countSql += ' AND category = ?'; countParams.push(category);
    }
    if (source) {
      sql += ' AND source = ?'; params.push(source);
      countSql += ' AND source = ?'; countParams.push(source);
    }
    if (search) {
      const like = `%${search}%`;
      sql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ? OR provider LIKE ?)';
      params.push(like, like, like, like);
      countSql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ? OR provider LIKE ?)';
      countParams.push(like, like, like, like);
    }

    indexedTotal = (getDb().prepare(countSql).get(...countParams) as { n: number })?.n ?? 0;

    sql += ' ORDER BY reliability_score DESC NULLS LAST, last_synced DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = getDb().prepare(sql).all(...params) as any[];
    indexedData = rows.map((ep) => ({
      id:           ep.id,
      provider:     ep.provider || ep.source,
      name:         ep.name,
      description:  ep.description,
      category:     ep.category,
      costPerCall:  ep.price_usd ?? 0,
      latencyMs:    ep.latency_p50_ms ?? 0,
      inputSchema:  null,
      outputFields: null,
      rateLimit:    null,
      status:       ep.health_status === 'healthy' ? 'operational' : ep.health_status === 'degraded' ? 'degraded' : 'degraded',
      circuitState: 'CLOSED',
      failures:     0,
      source:       ep.source,
      url:          ep.url,
      protocol:     ep.protocol,
      httpMethod:   ep.http_method,
      uptimePct:    ep.uptime_30d,
      reliability:  ep.reliability_score,
    }));
  } catch { /* indexed_endpoints table may not exist yet */ }

  // Merge: static registry first, then indexed
  const allEndpoints = [...staticData, ...indexedData];
  const total = apiRegistry.length + indexedTotal;
  const operational = allEndpoints.filter((e) => e.status === 'operational').length;
  const degraded = allEndpoints.filter((e) => e.status === 'degraded').length;
  const providers = [...new Set(allEndpoints.map((e) => e.provider).filter(Boolean))].length;
  const withCost = allEndpoints.filter((e) => e.costPerCall > 0);
  const avgCost = withCost.length > 0 ? withCost.reduce((s, e) => s + e.costPerCall, 0) / withCost.length : 0;
  const withLatency = allEndpoints.filter((e) => e.latencyMs > 0);
  const avgLatency = withLatency.length > 0 ? Math.round(withLatency.reduce((s, e) => s + e.latencyMs, 0) / withLatency.length) : 0;

  return c.json({
    meta: { total, operational, degraded, providers, avgCost: +avgCost.toFixed(4), avgLatency, page, limit, indexedTotal, registryTotal: apiRegistry.length },
    endpoints: allEndpoints,
    generatedAt: new Date().toISOString(),
  });
});

export { endpointsRouter };
