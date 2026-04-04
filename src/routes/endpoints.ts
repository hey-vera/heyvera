import { Hono } from 'hono';
import { apiRegistry, findEndpoint } from '../config/api-registry';
import { getCircuitStats, isEndpointAvailable } from '../core/circuit-breaker';
import { getDb } from '../db/connection';
import { creditCostForEndpoint, round6, cacheCreditCost } from '../core/credits';
import { isClawApisReady, clawApiCall, getLastBirthCertificate } from '../providers/clawapis';
import { cacheKey, smartCacheGet, smartCacheSet, cacheNegative, getNegativeCache, coalesceRequest, type CacheFreshness } from '../cache/index';
import { deductCredit } from '../db/index';
import { trackDelegatedSpend } from '../utils/billing';
import { maskApiKey } from '../utils/mask';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import { recordSuccess, recordFailure } from '../core/circuit-breaker';
import { createSomaReceipt } from '../core/soma-receipt';

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

// ─── POST /v1/endpoints/:id/call — direct endpoint invocation ────────────────
// No LLM, no orchestration fee. Caller pays only the endpoint's credit cost.
// Returns raw data + Soma birth certificate when available.

endpointsRouter.post('/:id/call', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const endpointId = c.req.param('id');

  // ── Lookup endpoint ──────────────────────────────────────────────────────
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) {
    return c.json({ requestId, error: 'Endpoint not found', code: 'ENDPOINT_NOT_FOUND', hint: 'Browse available endpoints at GET /v1/endpoints' }, 404);
  }

  // ── Parse params ─────────────────────────────────────────────────────────
  let params: Record<string, unknown> = {};
  try {
    const body = await c.req.json();
    params = body.params ?? body ?? {};
  } catch {
    // Allow empty body for endpoints that take no params
  }
  // Strip non-param fields if caller sent them at the top level
  delete (params as any).cache;

  const freshness: CacheFreshness = ((await c.req.json().catch(() => ({}))) as any).cache ?? 'smart';

  // ── Auth + billing ───────────────────────────────────────────────────────
  const keyInfo = c.get('apiKeyInfo');
  const endpointCredits = creditCostForEndpoint(endpoint);

  // ── Smart cache check ────────────────────────────────────────────────────
  const key = cacheKey(endpointId, params as Record<string, string>);
  const cacheResult = await smartCacheGet<unknown>(key, freshness, endpointId, endpointCredits);

  if (cacheResult?.fresh) {
    const cacheCredits = cacheCreditCost(endpointCredits);
    if (!keyInfo.isEnvKey) {
      if (keyInfo.credits < cacheCredits) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: cacheCredits, creditsAvailable: keyInfo.credits }, 402);
      }
      const deducted = deductCredit(keyInfo.key, cacheCredits);
      if (!deducted) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
      trackDelegatedSpend(keyInfo, cacheCredits);
    }
    logger.info({ requestId, endpointId, creditsUsed: cacheCredits }, 'Direct endpoint call — cache hit');
    return c.json({
      requestId,
      endpointId,
      data: cacheResult.value,
      cached: true,
      creditsUsed: cacheCredits,
      durationMs: Date.now() - start,
    });
  }

  // ── Pre-flight checks ───────────────────────────────────────────────────
  if (!keyInfo.isEnvKey) {
    if (keyInfo.credits < endpointCredits) {
      return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: endpointCredits, creditsAvailable: keyInfo.credits }, 402);
    }
  }

  if (!isEndpointAvailable(endpointId)) {
    return c.json({ requestId, error: 'Endpoint temporarily unavailable (circuit open)', code: 'CIRCUIT_OPEN' }, 503);
  }

  const negError = getNegativeCache(key);
  if (negError) {
    return c.json({ requestId, error: `Endpoint recently failed: ${negError}`, code: 'CACHED_FAILURE' }, 503);
  }

  if (!isClawApisReady()) {
    return c.json({ requestId, error: 'x402 client not initialized', code: 'X402_NOT_READY' }, 503);
  }

  // ── Live fetch ──────────────────────────────────────────────────────────
  try {
    const apiPath = endpoint.path ?? `/${endpointId}`;
    const data = await coalesceRequest(key, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        return await clawApiCall(apiPath, params, endpoint.baseUrl, controller.signal);
      } finally {
        clearTimeout(timer);
      }
    });

    // Cache the result
    const serialized = JSON.stringify(data);
    if (serialized.length <= 1_000_000) {
      await smartCacheSet(key, data, endpoint.cacheTtl, endpointId, endpoint.creditCost ?? endpoint.costPerCall);
    }

    // Deduct credits
    if (!keyInfo.isEnvKey) {
      const deducted = deductCredit(keyInfo.key, endpointCredits);
      if (!deducted) {
        // Data already fetched — return it but warn
        logger.warn({ requestId, endpointId, key: maskApiKey(keyInfo.key) }, 'Credit deduction failed after fetch');
      } else {
        trackDelegatedSpend(keyInfo, endpointCredits);
      }
    }

    recordSuccess(endpointId);
    const birthCertificate = getLastBirthCertificate() ?? undefined;
    const durationMs = Date.now() - start;

    logger.info({ requestId, endpointId, creditsUsed: endpointCredits, durationMs, hasCert: !!birthCertificate }, 'Direct endpoint call — live');

    // Set Soma provenance headers when certificate exists
    if (birthCertificate) {
      c.header('X-Soma-Data-Hash', birthCertificate.dataHash);
      c.header('X-Soma-Signature', birthCertificate.signature);
      c.header('X-Soma-Public-Key', birthCertificate.publicKey);
      c.header('X-Soma-Heartbeat-Index', String(birthCertificate.heartbeatIndex));
      c.header('X-Soma-Protocol', 'soma/1.0');
    }

    // Soma Receipt — cryptographic delivery proof (fire-and-forget)
    createSomaReceipt({
      requestId,
      apiKey: keyInfo.key,
      paymentMethod: 'credits',
      creditsCost: endpointCredits,
      requestData: JSON.stringify({ endpointId, params: c.req.query() }),
      responseData: typeof data === 'string' ? data.slice(0, 1000) : JSON.stringify(data).slice(0, 1000),
      somaDataHash: birthCertificate?.dataHash,
      heartbeatIndex: birthCertificate?.heartbeatIndex,
    }).catch((err) => logger.warn({ requestId, err }, 'Soma receipt failed for endpoint call'));

    return c.json({
      requestId,
      endpointId,
      data,
      cached: false,
      creditsUsed: endpointCredits,
      durationMs,
      provenance: birthCertificate ?? null,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    cacheNegative(key, isTimeout ? 'TIMEOUT' : error.slice(0, 100));
    recordFailure(endpointId);
    logger.error({ requestId, endpointId, error, timeout: isTimeout }, 'Direct endpoint call failed');
    return c.json({ requestId, error: isTimeout ? 'Endpoint timed out' : error, code: isTimeout ? 'TIMEOUT' : 'UPSTREAM_ERROR' }, 502);
  }
});

export { endpointsRouter };
