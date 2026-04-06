import { Hono } from 'hono';
import { apiRegistry, findEndpoint } from '../config/api-registry';
import { getCircuitStats, isEndpointAvailable } from '../core/circuit-breaker';
import { getDb, logAudit, dbRowToApiEndpoint, safeJsonParse } from '../db/connection';
import { creditCostForEndpoint, round6, cacheCreditCost } from '../core/credits';
import { isClawApisReady, clawApiCall, getLastBirthCertificate } from '../providers/clawapis';
import { cacheKey, smartCacheGet, smartCacheSet, cacheNegative, getNegativeCache, coalesceRequest, enqueueRefresh, type CacheFreshness } from '../cache/index';
import { recordDemand, recordWarmHit } from '../cache/keep-warm';
import { deductCredit, creditProviderShare } from '../db/index';
import { trackDelegatedSpend, buildDelegationChainHeaders } from '../utils/billing';
import { checkProviderScope, checkDelegationScope } from '../middleware/auth';
import { createCacheCertificate, getCacheCertificate, getCacheHashInfo } from '../core/cache-certificate';
import { somaHashJson } from '../utils/crypto-agility';
import { env } from '../config/index';
import { getEndpointFreshness, getProviderSomaCheckTier, getEndpointProvider } from '../db/providers';
import { extractDualSignReceiptFields } from '../core/dual-sign-state';
import { computeSomaCheckSplit, cacheHitProviderShareByTier } from '../core/soma-check-billing';
import { maskApiKey } from '../utils/mask';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';
import { recordSuccess, recordFailure } from '../core/circuit-breaker';
import { createSomaReceipt } from '../core/soma-receipt';
import { logSomaCheckEvent } from '../db/soma-check';
import { awardSignal } from '../db/signal';

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

  // ── Query endpoints table (unified source of truth) ──────────────────────
  let countSql = "SELECT COUNT(*) as n FROM endpoints WHERE status = 'active'";
  let sql = "SELECT * FROM endpoints WHERE status = 'active'";
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

  const registryTotal = (getDb().prepare(countSql).get(...countParams) as { n: number })?.n ?? 0;
  sql += ' ORDER BY provider ASC, name ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = getDb().prepare(sql).all(...params) as any[];
  const registryData = rows.map((row) => {
    const circuit = circuits[row.id];
    const state = circuit?.state ?? 'CLOSED';
    const failures = circuit?.failures ?? 0;
    const epStatus: 'operational' | 'degraded' | 'down' =
      row.health_status === 'degraded' ? 'degraded' :
      row.health_status === 'down'     ? 'down'     :
      state === 'CLOSED'               ? 'operational' :
      state === 'HALF_OPEN'            ? 'degraded'    : 'down';

    return {
      id:           row.id,
      provider:     row.provider,
      name:         row.name,
      description:  row.description,
      category:     row.category,
      costPerCall:  row.cost_per_call,
      latencyMs:    row.latency_ms,
      inputSchema:  safeJsonParse(row.input_schema_json, null),
      outputFields: safeJsonParse(row.output_fields_json, null),
      rateLimit:    row.rate_limit ?? null,
      status:       epStatus,
      circuitState: state,
      failures,
      source:       row.source,
    };
  });

  // ── Indexed (discovered/staging) endpoints — not yet in endpoints table ──
  let indexedData: any[] = [];
  let indexedTotal = 0;
  try {
    let idxCountSql = 'SELECT COUNT(*) as n FROM indexed_endpoints WHERE 1=1';
    let idxSql = 'SELECT * FROM indexed_endpoints WHERE 1=1';
    const idxParams: unknown[] = [];
    const idxCountParams: unknown[] = [];

    if (category) {
      idxSql += ' AND category = ?'; idxParams.push(category);
      idxCountSql += ' AND category = ?'; idxCountParams.push(category);
    }
    if (search) {
      const like = `%${search}%`;
      idxSql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ? OR provider LIKE ?)';
      idxParams.push(like, like, like, like);
      idxCountSql += ' AND (name LIKE ? OR description LIKE ? OR category LIKE ? OR provider LIKE ?)';
      idxCountParams.push(like, like, like, like);
    }

    indexedTotal = (getDb().prepare(idxCountSql).get(...idxCountParams) as { n: number })?.n ?? 0;
    idxSql += ' ORDER BY reliability_score DESC NULLS LAST, last_synced DESC LIMIT ? OFFSET ?';
    idxParams.push(limit, offset);

    const idxRows = getDb().prepare(idxSql).all(...idxParams) as any[];
    indexedData = idxRows.map((ep) => ({
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
      status:       ep.health_status === 'healthy' ? 'operational' : 'degraded',
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

  // Merge: registry endpoints first, then discovered/staging
  const allEndpoints = [...registryData, ...indexedData];
  const total = registryTotal + indexedTotal;
  const operational = allEndpoints.filter((e) => e.status === 'operational').length;
  const degraded = allEndpoints.filter((e) => e.status === 'degraded').length;
  const providers = [...new Set(allEndpoints.map((e) => e.provider).filter(Boolean))].length;
  const withCost = allEndpoints.filter((e) => e.costPerCall > 0);
  const avgCost = withCost.length > 0 ? withCost.reduce((s, e) => s + e.costPerCall, 0) / withCost.length : 0;
  const withLatency = allEndpoints.filter((e) => e.latencyMs > 0);
  const avgLatency = withLatency.length > 0 ? Math.round(withLatency.reduce((s, e) => s + e.latencyMs, 0) / withLatency.length) : 0;

  return c.json({
    meta: { total, operational, degraded, providers, avgCost: +avgCost.toFixed(4), avgLatency, page, limit, indexedTotal, registryTotal },
    endpoints: allEndpoints,
    generatedAt: new Date().toISOString(),
  });
});

// ─── GET /v1/endpoints/:id/check — soma-check free hash check ──────────────────────
// Returns the cached data hash + freshness info. Zero credits. No auth required.
// Agents use this to decide if they need to pay for a full fetch.
// Protocol: soma-check — conditional payment via content-addressed change detection.

endpointsRouter.get('/:id/check', (c) => {
  const endpointId = c.req.param('id');
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) {
    return c.json({ error: 'Endpoint not found', code: 'ENDPOINT_NOT_FOUND' }, 404);
  }

  // Build cache key from query params (same as a call would use)
  const url = new URL(c.req.url);
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    params[k] = v;
  }

  const key = cacheKey(endpointId, params);
  const hashInfo = getCacheHashInfo(key);

  if (!hashInfo) {
    return c.json({
      endpointId,
      cached: false,
      dataHash: null,
      protocol: 'soma-check',
      creditsUsed: 0,
      hint: 'No cached data. A full fetch (POST /v1/endpoints/:id/call) is required.',
    });
  }

  c.header('X-Fresh-Hash', hashInfo.dataHash);
  c.header('X-Soma-Hash', hashInfo.dataHash);
  c.header('X-Fresh-Protocol', 'x402-fresh/1.0');
  c.header('X-Soma-Protocol', 'soma-check/1.0');

  return c.json({
    endpointId,
    cached: true,
    dataHash: hashInfo.dataHash,
    cachedAt: hashInfo.cachedAt,
    freshUntil: hashInfo.freshUntil,
    fresh: hashInfo.fresh,
    age: hashInfo.age,
    certId: hashInfo.certId,
    chainHash: hashInfo.chainHash,
    protocol: 'soma-check',
    externalProtocol: 'x402-fresh/1.0',
    creditsUsed: 0,
    usage: {
      checkHash: `Send If-Fresh-Hash: ${hashInfo.dataHash} on your next POST to skip payment if unchanged.`,
      forceRefresh: 'Use freshness: "realtime" to always get live data.',
    },
  });
});

// ─── POST /v1/endpoints/:id/call — direct endpoint invocation ────────────────
// No LLM, no orchestration fee. Caller pays only the endpoint's credit cost.
// Returns raw data + Soma birth certificate when available.
// Supports soma-check: send If-Soma-Hash header to skip payment when data unchanged.

endpointsRouter.post('/:id/call', async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const endpointId = c.req.param('id');

  // ── Lookup endpoint ──────────────────────────────────────────────────────
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) {
    return c.json({ requestId, error: 'Endpoint not found', code: 'ENDPOINT_NOT_FOUND', hint: 'Browse available endpoints at GET /v1/endpoints' }, 404);
  }

  // Provider keys are NOT restricted from calling other providers' endpoints.
  // A provider is also a consumer — one key, dual role. Provider scope only
  // applies to management routes (editing endpoints, analytics, etc.).

  // ── Soma Delegation scope check (endpoint + method) ─────────────────────
  const delegationScope = checkDelegationScope(c, endpointId, 'POST');
  if (!delegationScope.allowed) {
    c.header('X-Soma-Delegation-Error', delegationScope.code || 'SCOPE_VIOLATION');
    // Audit-log the rejection so getDelegationMetrics() can count it.
    const rejectedKey = c.get('apiKeyInfo')?.key;
    if (rejectedKey) {
      logAudit({
        entityType: 'delegated_key',
        entityId: rejectedKey,
        action: 'DELEGATE_SCOPE_REJECT',
        actorId: rejectedKey,
        data: { endpointId, method: 'POST', reason: delegationScope.reason },
      });
    }
    return c.json({ requestId, error: delegationScope.reason, code: delegationScope.code || 'SCOPE_VIOLATION' }, 403);
  }

  // ── Parse params ─────────────────────────────────────────────────────────
  let params: Record<string, unknown> = {};
  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await c.req.json();
    params = (rawBody as any).params ?? rawBody ?? {};
  } catch {
    // Allow empty body for endpoints that take no params
  }
  // Strip non-param fields if caller sent them at the top level
  const maxAge: number | undefined = (params as any).maxAge;
  delete (params as any).cache;
  delete (params as any).maxAge;
  delete (params as any).freshness;

  // Agent freshness preference: realtime | fast | relaxed (or legacy cache param)
  // - realtime: skip cache, always fetch live (maps to 'fresh')
  // - fast: serve stale if available + background refresh (maps to 'prefer')
  // - relaxed: full adaptive TTL, best cost savings (maps to 'smart') [default]
  const agentFreshness = (rawBody as any).freshness as string | undefined;
  const legacyCache = (rawBody as any).cache as string | undefined;
  const freshness: CacheFreshness =
    agentFreshness === 'realtime' ? 'fresh' :
    agentFreshness === 'fast'     ? 'prefer' :
    agentFreshness === 'relaxed'  ? 'smart' :
    (legacyCache as CacheFreshness) ?? 'smart';

  // ── Auth + billing ───────────────────────────────────────────────────────
  const keyInfo = c.get('apiKeyInfo');
  const endpointCredits = creditCostForEndpoint(endpoint);

  // ── Soma Delegation chain headers ────────────────────────────────────────
  // If this call came through a delegated key, expose the masked authority
  // chain so upstream providers + agent authors can trace the path.
  const delegationHeaders = buildDelegationChainHeaders(keyInfo.delegatedFrom);
  if (delegationHeaders) {
    for (const [name, value] of Object.entries(delegationHeaders)) {
      c.header(name, value);
    }
  }

  // ── Smart cache check ────────────────────────────────────────────────────
  const key = cacheKey(endpointId, params as Record<string, string>);

  // Provider-declared TTL: 0 means "always fresh / never cache" — skip
  // Soma Check matching and cache serving entirely. Essential for endpoints
  // that return unique data per call (image generation, random content, etc.).
  const freshnessDecl = getEndpointFreshness(endpointId);
  const declaredTtl = freshnessDecl?.declaredTtlSeconds ?? endpoint.cacheTtl ?? null;
  const alwaysFresh = declaredTtl === 0;

  // ── soma-check / x402 Fresh conditional payment ──────────────────────────
  // Agent sends their last known data hash via If-Fresh-Hash (external name)
  // or If-Soma-Hash (alias). If it matches our cache, they already have the
  // latest data — return 0 credits, no data transfer.
  const ifSomaHash =
    c.req.header('If-Fresh-Hash') ||
    c.req.header('If-Soma-Hash') ||
    (rawBody as any).ifSomaHash;
  if (!alwaysFresh && ifSomaHash && typeof ifSomaHash === 'string') {
    const hashInfo = getCacheHashInfo(key);
    if (hashInfo && hashInfo.dataHash === ifSomaHash) {
      // Resolve this provider's Soma Check tier. Tier 0 = shadow (free, no
      // billing yet), Tier 1-2 = active at 90/10 of hit price, Tier 3 = 95/5.
      const somaTier = getProviderSomaCheckTier(endpointId);
      // Compute staleness for dynamic hit pricing: fresher data costs less,
      // staler data costs more (5%/10%/15% of origin based on TTL elapsed).
      const cachedAtMs = new Date(hashInfo.cachedAt).getTime();
      const freshUntilMs = new Date(hashInfo.freshUntil).getTime();
      const ttlMs = freshUntilMs - cachedAtMs;
      const ageMs = hashInfo.age * 1000;
      const split = computeSomaCheckSplit(endpointCredits, true, somaTier,
        ttlMs > 0 ? { ageMs, ttlMs } : undefined);

      // Shadow tier: keep it free to preserve zero-disruption onboarding.
      // Active tiers: charge the hit price (10% of origin) and credit provider.
      const billed = somaTier >= 1;
      const hitPriceCredits = billed ? split.agentPays : 0;

      const durationMs = Date.now() - start;

      if (billed && !keyInfo.isEnvKey) {
        if (keyInfo.credits < hitPriceCredits) {
          return c.json({
            requestId,
            error: 'Insufficient credits',
            code: 'INSUFFICIENT_CREDITS',
            creditsRequired: hitPriceCredits,
            creditsAvailable: keyInfo.credits,
          }, 402);
        }
        // Transactional: deduct agent + credit provider atomically so a mid-
        // flight failure can never leave the agent charged without paying the
        // provider (or vice versa). Concurrent probes serialize at the api_keys
        // row via the atomic UPDATE in deductCredit's WHERE clause.
        try {
          getDb().transaction(() => {
            const deducted = deductCredit(keyInfo.key, hitPriceCredits);
            if (!deducted) throw new Error('INSUFFICIENT_CREDITS');
            trackDelegatedSpend(keyInfo, hitPriceCredits);
            // Provider gets 90% (T1-2) or 95% (T3) of the hit price.
            creditProviderShare(endpointId, hitPriceCredits, {
              cacheHit: true,
              latencyMs: durationMs,
              providerSharePctOverride: cacheHitProviderShareByTier(somaTier),
            });
          })();
        } catch (err) {
          if (err instanceof Error && err.message === 'INSUFFICIENT_CREDITS') {
            return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
          }
          throw err;
        }
      } else if (billed) {
        // Env-key caller (no deduction) — still credit provider.
        creditProviderShare(endpointId, hitPriceCredits, {
          cacheHit: true,
          latencyMs: durationMs,
          providerSharePctOverride: cacheHitProviderShareByTier(somaTier),
        });
      }

      c.header('X-Fresh-Hash', hashInfo.dataHash);
      c.header('X-Soma-Hash', hashInfo.dataHash);
      c.header('X-Fresh-Protocol', 'x402-fresh/1.0');
      c.header('X-Soma-Protocol', 'soma-check/1.0');
      c.header('X-Soma-Tier', String(somaTier));
      c.header('X-Soma-Hit-Price', String(hitPriceCredits));
      c.header('ETag', `"${hashInfo.dataHash}"`);
      // Proof chain: cryptographic evidence a DIY ETag can't produce.
      // Chain hash binds birth cert + cache cert. Platform signature proves
      // an independent third party verified the hash. Birth signature proves
      // who originally produced the data.
      c.header('X-Soma-Chain-Hash', hashInfo.chainHash);
      const fullCert = getCacheCertificate(key);
      if (fullCert) {
        c.header('X-Soma-Platform-Signature', fullCert.cacheCert.signature);
        c.header('X-Soma-Platform-Public-Key', fullCert.cacheCert.publicKey);
        if (fullCert.originalCert.signature) {
          c.header('X-Soma-Birth-Signature', fullCert.originalCert.signature);
        }
        if (fullCert.originalCert.publicKey) {
          c.header('X-Soma-Birth-Public-Key', fullCert.originalCert.publicKey);
        }
      }
      logger.info(
        { requestId, endpointId, protocol: 'soma-check', somaTier, hitPriceCredits },
        billed ? 'soma-check hash match — billed hit' : 'soma-check hash match — shadow (free)'
      );
      logSomaCheckEvent({
        endpointId, requestId, cacheKey: key,
        hash: hashInfo.dataHash, clientIfNoneMatch: ifSomaHash,
        wouldHaveHit: true, wasHit: true,
        originPriceCredits: endpointCredits, hitPriceCredits,
        rail: 'credits', tier: somaTier, shadowMode: !billed,
      });
      return c.json({
        requestId,
        endpointId,
        unchanged: true,
        dataHash: hashInfo.dataHash,
        cachedAt: hashInfo.cachedAt,
        fresh: hashInfo.fresh,
        age: hashInfo.age,
        creditsUsed: hitPriceCredits,
        somaTier,
        durationMs,
        protocol: 'soma-check',
        // Proof chain in body too — agents can verify independently
        proofChain: fullCert ? {
          chainHash: hashInfo.chainHash,
          platformSignature: fullCert.cacheCert.signature,
          platformPublicKey: fullCert.cacheCert.publicKey,
          birthSignature: fullCert.originalCert.signature ?? null,
          birthPublicKey: fullCert.originalCert.publicKey ?? null,
          algorithm: fullCert.cacheCert.algorithm,
        } : null,
      });
    }
    // Hash mismatch or no cache — fall through to normal flow (data has changed)
  }

  const cacheResult = alwaysFresh ? null : await smartCacheGet<unknown>(key, freshness, endpointId, endpointCredits);

  // maxAge filter: if agent requested data fresher than what's cached, skip cache
  const cacheIsFreshEnough = !maxAge || !cacheResult?.fresh || (() => {
    const cert = getCacheCertificate(key);
    if (!cert) return true; // no cert = can't verify age, serve anyway
    const cachedAtMs = new Date(cert.cacheCert.cachedAt).getTime();
    return (Date.now() - cachedAtMs) <= maxAge * 1000;
  })();

  if (cacheResult?.fresh && cacheIsFreshEnough) {
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
    // Provider gets 50% of cache revenue (pure profit — their server wasn't touched)
    const durationMs = Date.now() - start;
    const cacheProviderShare = creditProviderShare(endpointId, cacheCredits, { cacheHit: true, latencyMs: durationMs });

    // Certified Cache: serve the cache certificate alongside the data
    const cacheCert = getCacheCertificate(key);

    // soma-check / x402 Fresh: include data hash so agents can use
    // If-Fresh-Hash (or If-Soma-Hash alias) on next request.
    if (cacheCert) {
      c.header('X-Fresh-Hash', cacheCert.cacheCert.dataHash);
      c.header('X-Soma-Hash', cacheCert.cacheCert.dataHash);
      c.header('X-Fresh-Protocol', 'x402-fresh/1.0');
      c.header('X-Soma-Protocol', 'soma-check/1.0');
    }

    // Signal: award agent for cache hit, provider for passive income
    awardSignal({ apiKey: keyInfo.key, action: 'cache_hit_agent', metadata: { endpointId } });
    const cacheProviderId = getEndpointProvider(endpointId);
    if (cacheProviderId) awardSignal({ apiKey: `provider:${cacheProviderId}`, providerId: cacheProviderId, action: 'cache_hit', metadata: { endpointId } });

    recordWarmHit(key); // ROI tracking for keep-warm
    logger.info({ requestId, endpointId, creditsUsed: cacheCredits, hasCacheCert: !!cacheCert }, 'Direct endpoint call — cache hit');
    // Soma Check shadow telemetry: a matching client hash would have skipped
    // a full origin charge. ClawNet cache path always logs as shadow regardless
    // of tier — this is the ClawNet L1/L2 50/50 rail, NOT the Soma Check rail.
    // See internal/cache-layers-distinction.md.
    if (cacheCert) {
      const shadowTier = getProviderSomaCheckTier(endpointId);
      const projectedSplit = computeSomaCheckSplit(endpointCredits, true, shadowTier);
      logSomaCheckEvent({
        endpointId, requestId, cacheKey: key,
        hash: cacheCert.cacheCert.dataHash, clientIfNoneMatch: ifSomaHash ?? null,
        wouldHaveHit: true, wasHit: false,
        originPriceCredits: endpointCredits, hitPriceCredits: projectedSplit.agentPays,
        rail: 'credits', tier: shadowTier, shadowMode: true,
      });
    }

    // Soma Receipt — cache hits are still paid interactions (fire-and-forget)
    createSomaReceipt({
      requestId,
      apiKey: keyInfo.key,
      paymentMethod: 'credits',
      creditsCost: cacheCredits,
      requestData: JSON.stringify({ endpointId, params: c.req.query() }),
      responseData: typeof cacheResult.value === 'string'
        ? cacheResult.value.slice(0, 1000)
        : JSON.stringify(cacheResult.value).slice(0, 1000),
      somaDataHash: cacheCert?.originalCert.dataHash,
      heartbeatIndex: cacheCert?.originalCert.heartbeatIndex ?? undefined,
      cached: true,
      ...extractDualSignReceiptFields(getEndpointProvider(endpointId) ?? undefined),
    }).catch((err) => logger.warn({ requestId, err }, 'Soma receipt failed for cache-hit endpoint call'));

    return c.json({
      requestId,
      endpointId,
      data: cacheResult.value,
      cached: true,
      creditsUsed: cacheCredits,
      durationMs,
      dataHash: cacheCert?.cacheCert.dataHash ?? null,
      freshness: agentFreshness ?? 'relaxed',
      protocol: 'soma-check',
      provenance: cacheCert ? {
        type: 'certified-cache',
        cacheCertId: cacheCert.id,
        originalCert: cacheCert.originalCert,
        cacheCert: cacheCert.cacheCert,
        chainHash: cacheCert.chainHash,
      } : null,
    });
  }

  // ── SWR: stale-while-revalidate ─────────────────────────────────────────
  // Agent gets relaxed/fast freshness AND cache has stale (expired but not evicted) data?
  // Serve it instantly (2ms) and trigger a background refresh. Realtime agents skip this.
  if (cacheResult?.stale && freshness !== 'fresh') {
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

    const durationMs = Date.now() - start;
    creditProviderShare(endpointId, cacheCredits, { cacheHit: true, latencyMs: durationMs });

    const cacheCert = getCacheCertificate(key);
    if (cacheCert) {
      c.header('X-Fresh-Hash', cacheCert.cacheCert.dataHash);
      c.header('X-Soma-Hash', cacheCert.cacheCert.dataHash);
      c.header('X-Soma-Protocol', 'soma-check/1.0');
    }

    // Background refresh — fetches fresh data for the NEXT caller
    const swrApiPath = endpoint.path ?? `/${endpointId}`;
    const swrTtl = declaredTtl ?? endpoint.cacheTtl ?? env.CACHE_TTL_SECONDS;
    if (isClawApisReady()) {
      enqueueRefresh(key, async () => {
        const data = await clawApiCall(swrApiPath, params, endpoint.baseUrl);
        const dataHash = somaHashJson(data);
        await smartCacheSet(key, data, swrTtl, endpointId, endpoint.creditCost ?? endpoint.costPerCall);
        const birthCert = getLastBirthCertificate();
        createCacheCertificate({ cacheKey: key, endpointId, dataHash, ttlSeconds: swrTtl, birthCert: birthCert ?? null });
        return data;
      }, swrTtl);
    }

    const staleAge = Math.round((Date.now() - cacheResult.cachedAt) / 1000);
    logger.info({ requestId, endpointId, creditsUsed: cacheCredits, staleAge, durationMs }, 'Direct endpoint call — SWR (stale served + background refresh)');

    return c.json({
      requestId,
      endpointId,
      data: cacheResult.value,
      cached: true,
      stale: true,
      creditsUsed: cacheCredits,
      durationMs,
      dataHash: cacheCert?.cacheCert.dataHash ?? null,
      age: staleAge,
      freshness: agentFreshness ?? 'relaxed',
      protocol: 'soma-check',
      provenance: cacheCert ? {
        type: 'certified-cache',
        cacheCertId: cacheCert.id,
        originalCert: cacheCert.originalCert,
        cacheCert: cacheCert.cacheCert,
        chainHash: cacheCert.chainHash,
      } : null,
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

  // ── Keep-warm: record demand for auto-enrollment ───────────────────────
  const warmTtl = declaredTtl ?? endpoint.cacheTtl ?? env.CACHE_TTL_SECONDS;
  const warmApiPath = endpoint.path ?? `/${endpointId}`;
  const warmCreditCost = endpoint.creditCost ?? endpoint.costPerCall ?? 0.001;
  recordDemand(endpointId, key, warmTtl, async () => {
    const data = await clawApiCall(warmApiPath, params, endpoint.baseUrl);
    const dataHash = somaHashJson(data);
    await smartCacheSet(key, data, warmTtl, endpointId, warmCreditCost);
    const birthCert = getLastBirthCertificate();
    createCacheCertificate({ cacheKey: key, endpointId, dataHash, ttlSeconds: warmTtl, birthCert: birthCert ?? null });
    return data;
  }, warmCreditCost);

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

    const serialized = JSON.stringify(data);
    // JCS-canonical hash so semantic equality survives key-order variance
    // between upstream provider fetches. See utils/crypto-agility.ts.
    const dataHash = somaHashJson(data);

    // Cache the result + create Certified Cache certificate
    // Skip entirely for alwaysFresh endpoints (unique data per call).
    if (!alwaysFresh && serialized.length <= 1_000_000) {
      const effectiveTtl = declaredTtl ?? endpoint.cacheTtl;
      await smartCacheSet(key, data, effectiveTtl, endpointId, endpoint.creditCost ?? endpoint.costPerCall);
      const birthCert = getLastBirthCertificate();
      createCacheCertificate({
        cacheKey: key,
        endpointId,
        dataHash,
        ttlSeconds: effectiveTtl ?? env.CACHE_TTL_SECONDS,
        birthCert: birthCert ?? null,
      });
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

    // Provider revenue share: 90% to provider on live calls
    const providerShare = creditProviderShare(endpointId, endpointCredits, { cacheHit: false, latencyMs: durationMs });

    // Signal: award provider for live call
    const liveProviderId = getEndpointProvider(endpointId);
    if (liveProviderId) awardSignal({ apiKey: `provider:${liveProviderId}`, providerId: liveProviderId, action: 'endpoint_called', metadata: { endpointId } });

    logger.info({ requestId, endpointId, creditsUsed: endpointCredits, providerShare, durationMs, hasCert: !!birthCertificate }, 'Direct endpoint call — live');
    // Soma Check shadow telemetry: live origin fetch — establishes the hash other clients will match against.
    logSomaCheckEvent({
      endpointId, requestId, cacheKey: key,
      hash: dataHash, clientIfNoneMatch: ifSomaHash ?? null,
      wouldHaveHit: false, wasHit: false,
      originPriceCredits: endpointCredits, hitPriceCredits: 0,
      rail: 'credits', tier: 0, shadowMode: true,
    });

    // soma-check + Soma provenance headers — dataHash serves both trust and conditional payment
    c.header('X-Soma-Hash', dataHash);
    c.header('X-Soma-Protocol', 'soma-check/1.0');
    if (birthCertificate) {
      c.header('X-Soma-Data-Hash', birthCertificate.dataHash);
      c.header('X-Soma-Signature', birthCertificate.signature);
      c.header('X-Soma-Public-Key', birthCertificate.publicKey);
      c.header('X-Soma-Heartbeat-Index', String(birthCertificate.heartbeatIndex));
    }

    // Soma Receipt — cryptographic delivery proof (fire-and-forget)
    // Dual-sign fields auto-populate when upstream provider returns X-Soma-* headers.
    createSomaReceipt({
      requestId,
      apiKey: keyInfo.key,
      paymentMethod: 'credits',
      creditsCost: endpointCredits,
      requestData: JSON.stringify({ endpointId, params: c.req.query() }),
      responseData: typeof data === 'string' ? data.slice(0, 1000) : JSON.stringify(data).slice(0, 1000),
      somaDataHash: birthCertificate?.dataHash,
      heartbeatIndex: birthCertificate?.heartbeatIndex,
      ...extractDualSignReceiptFields(getEndpointProvider(endpointId) ?? undefined),
    }).catch((err) => logger.warn({ requestId, err }, 'Soma receipt failed for endpoint call'));

    return c.json({
      requestId,
      endpointId,
      data,
      cached: false,
      creditsUsed: endpointCredits,
      durationMs,
      dataHash,
      freshness: agentFreshness ?? 'relaxed',
      protocol: 'soma-check',
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
