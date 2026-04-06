/**
 * Multi-Source Index Sync — Tiered Polling
 *
 * Fetches x402/L402 endpoints from live registries:
 *   1. 402index.io — community x402 directory (13k+ endpoints) — BULK (4h)
 *   2. Coinbase Bazaar — official x402 facilitator discovery  — HOT (5 min)
 *   3. Satring — curated L402 + x402 directory (600+)         — WARM (30 min)
 *   4. Cascade Surf — pay-per-call APIs (Twitter, Reddit, Web) — HOT (5 min)
 *   5. Provider discovery URLs — registered providers' soma_discovery_url — WARM (30 min)
 *
 * Three polling tiers:
 *   HOT  (5 min)  — small, fast sources (Bazaar, Cascade). Instant-ish.
 *   WARM (30 min) — medium sources (Satring). Near-real-time.
 *   BULK (4 hr)   — large paginated crawls (402index.io). Background sync.
 *
 * Endpoints are stored in the indexed_endpoints table with a `source`
 * tag and become available to the orchestration engine via
 * mergeDiscoveredEndpoints().
 */

import { env } from '../config/index';
import { logger } from '../utils/logger';
import { getDb } from '../db/connection';
import { nanoid } from 'nanoid';
import { mergeDiscoveredEndpoints, type ApiEndpoint } from '../config/api-registry';
import { round6 } from './credits';

const INDEX_API = 'https://402index.io/api/v1/services';
const BAZAAR_API = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const SATRING_URLS = [
  'https://satring.com/api/services',
  'https://satring.com/api/v1/services',
  'https://api.satring.com/services',
];
const CASCADE_OPENAPI_URLS = [
  'https://twitter.surf.cascade.fyi/openapi.json',
  'https://reddit.surf.cascade.fyi/openapi.json',
  'https://web.surf.cascade.fyi/openapi.json',
];
// Dexter (x402.dexter.cash) — REMOVED 2026-04-06: returns 404, site dead
// x402list.fun — REMOVED 2026-04-06: returns 404, site dead

const HOT_INTERVAL  =  5 * 60 * 1000; // 5 minutes — Bazaar, Cascade
const WARM_INTERVAL = 30 * 60 * 1000; // 30 minutes — Satring
const BULK_INTERVAL =  4 * 60 * 60 * 1000; // 4 hours — 402index.io (13k+ paginated)

/** Clean up endpoint names — many sources put descriptions in the name field */
function cleanName(rawName: string, url: string, provider: string): string {
  let name = rawName.trim();
  // If name is too long (>80 chars), it's probably a description
  if (name.length > 80) {
    // Try to extract a meaningful short name
    // Pattern: "ServiceName: long description..." → "ServiceName"
    const colonIdx = name.indexOf(':');
    if (colonIdx > 3 && colonIdx < 60) {
      name = name.slice(0, colonIdx).trim();
    } else {
      // Truncate at first sentence boundary
      const dotIdx = name.indexOf('.');
      if (dotIdx > 5 && dotIdx < 80) {
        name = name.slice(0, dotIdx).trim();
      } else {
        name = name.slice(0, 60).trim() + '...';
      }
    }
  }
  // If name is empty or just a URL, derive from provider + URL path
  if (!name || name.startsWith('http')) {
    try {
      const u = new URL(url);
      const pathPart = u.pathname.split('/').filter(Boolean).slice(-2).join('/');
      name = provider ? `${provider}: ${pathPart}` : pathPart || url;
    } catch { name = provider || url; }
  }
  return name.slice(0, 100);
}
const PAGE_LIMIT = 200;
const FETCH_TIMEOUT = 15_000; // 15s
const BAZAAR_TIMEOUT = 30_000; // 30s — larger dataset
const STALE_HOURS = 48;
const MAX_LATENCY_MS = 5000;

const USER_AGENT = 'ClawNet/1.0 (orchestration-sync)';

export interface IndexedEndpoint {
  id: string;
  source_id: string;
  name: string;
  description: string | null;
  url: string;
  protocol: string;
  price_usd: number | null;
  payment_asset: string;
  payment_network: string | null;
  category: string;
  provider: string | null;
  health_status: string;
  uptime_30d: number | null;
  latency_p50_ms: number | null;
  reliability_score: number | null;
  http_method: string;
  source: string;
  last_synced: string;
}

interface IndexServiceResponse {
  id: number;
  name: string;
  description: string;
  url: string;
  protocol: string;
  price_usd: number | null;
  payment_asset: string;
  payment_network: string;
  category: string;
  provider: string;
  health_status: string;
  uptime_30d: number;
  latency_p50_ms: number;
  reliability_score: number;
  http_method: string;
}

/** Normalized endpoint ready for DB upsert */
interface NormalizedEndpoint {
  source_id: string;
  name: string;
  description: string;
  url: string;
  protocol: string;
  price_usd: number | null;
  payment_asset: string;
  payment_network: string | null;
  category: string;
  provider: string;
  health_status: string;
  uptime_30d: number | null;
  latency_p50_ms: number | null;
  reliability_score: number | null;
  http_method: string;
  source: string;
}

const timers: ReturnType<typeof setInterval>[] = [];

export function startIndexSync(): void {
  if (!env.INDEX_SYNC_ENABLED) {
    logger.info('[index-sync] Disabled (INDEX_SYNC_ENABLED=false)');
    return;
  }

  logger.info('[index-sync] Starting tiered catalog sync (hot=5m, warm=30m, bulk=4h)');

  // ── Initial run: all tiers on startup (stagger to avoid thundering herd) ──
  setTimeout(() => syncTier('hot').catch(e => logger.error({ err: e }, '[index-sync] hot init')), 5_000);
  setTimeout(() => syncTier('warm').catch(e => logger.error({ err: e }, '[index-sync] warm init')), 15_000);
  setTimeout(() => syncTier('bulk').catch(e => logger.error({ err: e }, '[index-sync] bulk init')), 30_000);

  // ── Recurring timers ──
  const hot = setInterval(() => syncTier('hot').catch(e => logger.error({ err: e }, '[index-sync] hot')), HOT_INTERVAL);
  const warm = setInterval(() => syncTier('warm').catch(e => logger.error({ err: e }, '[index-sync] warm')), WARM_INTERVAL);
  const bulk = setInterval(() => syncTier('bulk').catch(e => logger.error({ err: e }, '[index-sync] bulk')), BULK_INTERVAL);

  hot.unref(); warm.unref(); bulk.unref();
  timers.push(hot, warm, bulk);
}

export function stopIndexSync(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}

// ─── Tiered sync orchestrator ────────────────────────────────────────────────

type SyncTier = 'hot' | 'warm' | 'bulk';

async function syncTier(tier: SyncTier): Promise<void> {
  const jobs: { name: string; fn: () => Promise<number> }[] = [];

  if (tier === 'hot') {
    jobs.push({ name: 'bazaar', fn: syncFromBazaar });
    jobs.push({ name: 'cascade', fn: syncFromCascade });
  } else if (tier === 'warm') {
    jobs.push({ name: 'satring', fn: syncFromSatring });
    jobs.push({ name: 'provider-urls', fn: syncProviderDiscoveryUrls });
  } else {
    jobs.push({ name: '402index', fn: syncFrom402Index });
  }

  const results = await Promise.allSettled(jobs.map(j => j.fn()));
  let totalSynced = 0;

  for (const [i, result] of results.entries()) {
    const { name } = jobs[i];
    if (result.status === 'fulfilled') {
      if (result.value > 0) logger.info(`[index-sync:${tier}] ${name}: ${result.value} endpoints`);
      totalSynced += result.value;
    } else {
      logger.warn(`[index-sync:${tier}] ${name}: failed - ${result.reason}`);
    }
  }

  if (totalSynced === 0) return;

  // Only clean stale entries on bulk cycle (avoid hammering DB every 5 min)
  if (tier === 'bulk') {
    const cleaned = getDb().prepare(
      `DELETE FROM indexed_endpoints WHERE last_synced < datetime('now', '-${STALE_HOURS} hours')`,
    ).run();
    if (cleaned.changes > 0) logger.info(`[index-sync] Cleaned ${cleaned.changes} stale entries`);
  }

  // Merge into the live API registry so orchestration can use them
  mergeIndexedIntoRegistry();
}

// ─── Shared upsert helper ────────────────────────────────────────────────────

function upsertEndpoints(endpoints: NormalizedEndpoint[]): number {
  if (endpoints.length === 0) return 0;

  const upsertStmt = getDb().prepare(`
    INSERT INTO indexed_endpoints (id, source_id, name, description, url, protocol, price_usd, payment_asset, payment_network, category, provider, health_status, uptime_30d, latency_p50_ms, reliability_score, http_method, source, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(url, protocol) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      price_usd = excluded.price_usd,
      health_status = excluded.health_status,
      uptime_30d = excluded.uptime_30d,
      latency_p50_ms = excluded.latency_p50_ms,
      reliability_score = excluded.reliability_score,
      source = excluded.source,
      last_synced = datetime('now')
  `);

  let count = 0;
  getDb().transaction(() => {
    for (const ep of endpoints) {
      if (!ep.url) continue;

      upsertStmt.run(
        `idx-${nanoid(12)}`,
        ep.source_id,
        ep.name.slice(0, 200),
        ep.description.slice(0, 500),
        ep.url,
        ep.protocol,
        ep.price_usd,
        ep.payment_asset,
        ep.payment_network,
        ep.category.slice(0, 100),
        ep.provider.slice(0, 100),
        ep.health_status,
        ep.uptime_30d,
        ep.latency_p50_ms,
        ep.reliability_score,
        ep.http_method,
        ep.source,
      );
      count++;
    }
  })();

  return count;
}

// ─── Source 1: 402index.io ───────────────────────────────────────────────────

async function syncFrom402Index(): Promise<number> {
  let offset = 0;
  const allEndpoints: NormalizedEndpoint[] = [];

  while (true) {
    const url = `${INDEX_API}?protocol=x402&health=healthy&limit=${PAGE_LIMIT}&offset=${offset}&sort=reliability&order=desc`;

    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
    } catch (err) {
      logger.warn({ err, offset }, '[index-sync] 402index fetch failed — stopping pagination');
      break;
    }

    if (!res.ok) {
      logger.warn(`[index-sync] 402index returned ${res.status} at offset ${offset}`);
      break;
    }

    let data: { services?: IndexServiceResponse[] };
    try {
      data = await res.json() as { services?: IndexServiceResponse[] };
    } catch {
      logger.warn('[index-sync] Failed to parse 402index response');
      break;
    }

    const services = data.services ?? [];
    if (services.length === 0) break;

    for (const svc of services) {
      if (!svc.url || svc.latency_p50_ms > MAX_LATENCY_MS) continue;
      allEndpoints.push({
        source_id: String(svc.id),
        name: cleanName(svc.name || '', svc.url, svc.provider || ''),
        description: svc.description || '',
        url: svc.url,
        protocol: svc.protocol || 'x402',
        price_usd: svc.price_usd ?? null,
        payment_asset: svc.payment_asset || 'USDC',
        payment_network: svc.payment_network || 'base',
        category: svc.category || 'uncategorized',
        provider: svc.provider || 'unknown',
        health_status: svc.health_status || 'unknown',
        uptime_30d: svc.uptime_30d ?? null,
        latency_p50_ms: svc.latency_p50_ms ?? null,
        reliability_score: svc.reliability_score ?? null,
        http_method: svc.http_method || 'GET',
        source: '402index',
      });
    }

    offset += services.length;
    if (services.length < PAGE_LIMIT) break;

    // Rate limit ourselves — 1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  return upsertEndpoints(allEndpoints);
}

// ─── Source 2: Coinbase Bazaar ───────────────────────────────────────────────
// Actual response shape (verified 2026-04-06):
//   { items: [{ resource: "https://...", type: "http", x402Version: 1,
//     accepts: [{ resource, description, maxAmountRequired, network, asset,
//                 payTo, scheme, extra: { name, version }, outputSchema }] }] }

interface BazaarItem {
  resource?: string;
  type?: string;
  x402Version?: number;
  lastUpdated?: string;
  accepts?: Array<{
    resource?: string;
    description?: string;
    maxAmountRequired?: string;
    network?: string;
    asset?: string;
    payTo?: string;
    scheme?: string;
    mimeType?: string;
    extra?: { name?: string; version?: string };
    outputSchema?: {
      input?: { method?: string; discoverable?: boolean; type?: string; bodyFields?: Record<string, unknown> };
      output?: Record<string, unknown>;
    };
  }>;
}

async function syncFromBazaar(): Promise<number> {
  let res: Response;
  try {
    res = await fetch(BAZAAR_API, {
      signal: AbortSignal.timeout(BAZAAR_TIMEOUT),
      headers: { 'User-Agent': USER_AGENT },
    });
  } catch (err) {
    logger.warn({ err }, '[index-sync] Bazaar fetch failed');
    return 0;
  }

  if (!res.ok) {
    logger.warn(`[index-sync] Bazaar returned ${res.status}`);
    return 0;
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    logger.warn('[index-sync] Failed to parse Bazaar response');
    return 0;
  }

  const items = extractArray(data, ['items', 'resources', 'data']);
  if (items.length === 0) {
    logger.info('[index-sync] Bazaar returned 0 resources');
    return 0;
  }

  const endpoints: NormalizedEndpoint[] = [];
  for (const raw of items) {
    const item = raw as BazaarItem;
    const url = item.resource;
    if (!url || typeof url !== 'string') continue;

    // Each item can have multiple accepts entries (different networks/prices).
    // Take the first one with a description for metadata, lowest price for cost.
    const accepts = item.accepts ?? [];
    const first = accepts[0];
    if (!first) continue;

    // Price is maxAmountRequired as a string (e.g. "0.001")
    let priceUsd: number | null = null;
    for (const a of accepts) {
      const p = parseFloat(a.maxAmountRequired ?? '');
      if (!isNaN(p) && (priceUsd === null || p < priceUsd)) priceUsd = p;
    }

    const description = first.description || first.extra?.name || '';
    const method = first.outputSchema?.input?.method?.toUpperCase() || 'GET';

    endpoints.push({
      source_id: `bazaar-${nanoid(8)}`,
      name: cleanName(first.extra?.name || description.split('.')[0] || url, url, 'Coinbase Bazaar'),
      description: description.slice(0, 500),
      url,
      protocol: 'x402',
      price_usd: priceUsd,
      payment_asset: first.asset || 'USDC',
      payment_network: first.network || 'base',
      category: 'uncategorized',
      provider: 'Coinbase Bazaar',
      health_status: 'healthy',
      uptime_30d: null,
      latency_p50_ms: null,
      reliability_score: null,
      http_method: method,
      source: 'bazaar',
    });
  }

  return upsertEndpoints(endpoints);
}

// ─── Source 3: Satring ───────────────────────────────────────────────────────
// Actual response shape (verified 2026-04-06):
//   { services: [{ name, slug, protocol: "L402", pricing_model: "per-request",
//     pricing_sats: 10, categories: ["energy"], domain_verified: bool,
//     avg_rating, hit_count_30d, created_at }], total: 600, page, page_size }
// NOTE: Satring is L402 (Lightning), not x402 (USDC). We index them anyway —
// ClawNet can proxy the payment rail.

interface SatringService {
  name?: string;
  slug?: string;
  url?: string;
  endpoint?: string;
  description?: string;
  protocol?: string;
  pricing_model?: string;
  pricing_sats?: number;
  price_usd?: number;
  categories?: string[];
  domain_verified?: boolean;
  avg_rating?: number;
  hit_count_30d?: number;
  created_at?: string;
}

// 1 sat ≈ $0.0006 at ~$60K BTC (rough, updated periodically)
const SATS_TO_USD = 0.0006;

async function syncFromSatring(): Promise<number> {
  const allEndpoints: NormalizedEndpoint[] = [];
  let page = 1;
  const pageSize = 20; // Satring default

  for (const baseUrl of SATRING_URLS) {
    try {
      // Paginate through all results
      while (true) {
        const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
          headers: { 'User-Agent': USER_AGENT },
        });

        if (!res.ok) break;

        let data: unknown;
        try { data = await res.json(); } catch { break; }

        const services = extractArray(data, ['services', 'data', 'items']);
        if (services.length === 0) break;

        for (const raw of services) {
          const s = raw as SatringService;
          // Satring may not have a URL field — construct from slug if needed
          const epUrl = s.url || s.endpoint || (s.slug ? `https://satring.com/api/s/${s.slug}` : null);
          if (!epUrl) continue;

          // Convert sats to USD, or use price_usd if available
          let priceUsd: number | null = null;
          if (s.price_usd != null) priceUsd = s.price_usd;
          else if (s.pricing_sats != null) priceUsd = round6(s.pricing_sats * SATS_TO_USD);

          const category = (s.categories?.[0] || 'uncategorized').slice(0, 100);

          allEndpoints.push({
            source_id: `satring-${s.slug || nanoid(8)}`,
            name: cleanName(s.name || s.slug || epUrl, epUrl, 'Satring'),
            description: (s.description || s.name || '').slice(0, 500),
            url: epUrl,
            protocol: s.protocol || 'L402',
            price_usd: priceUsd,
            payment_asset: 'BTC',
            payment_network: 'lightning',
            category,
            provider: 'Satring',
            health_status: s.domain_verified ? 'healthy' : 'unknown',
            uptime_30d: null,
            latency_p50_ms: null,
            reliability_score: s.avg_rating != null ? round6(s.avg_rating * 20) : null, // 0-5 → 0-100
            http_method: 'GET',
            source: 'satring',
          });
        }

        // Check if there are more pages
        const total = (data as any)?.total ?? 0;
        if (page * pageSize >= total || services.length < pageSize) break;
        page++;

        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }

      if (allEndpoints.length > 0) {
        logger.info(`[index-sync] Satring: found ${allEndpoints.length} services at ${baseUrl}`);
        return upsertEndpoints(allEndpoints);
      }
    } catch {
      continue;
    }
  }

  logger.info('[index-sync] Satring: no working API found — skipping');
  return 0;
}

// ─── Source 4: Cascade Surf (OpenAPI discovery) ─────────────────────────────

interface CascadeOpenAPIPath {
  summary?: string;
  description?: string;
  operationId?: string;
}

async function syncFromCascade(): Promise<number> {
  const allEndpoints: NormalizedEndpoint[] = [];

  for (const openapiUrl of CASCADE_OPENAPI_URLS) {
    try {
      const res = await fetch(openapiUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!res.ok) continue;

      let spec: { paths?: Record<string, Record<string, CascadeOpenAPIPath>>; servers?: Array<{ url: string }> };
      try {
        spec = await res.json() as typeof spec;
      } catch { continue; }

      if (!spec.paths) continue;

      const baseUrl = spec.servers?.[0]?.url || openapiUrl.replace('/openapi.json', '');
      // Derive service type from URL (twitter, reddit, web)
      const serviceType = openapiUrl.includes('twitter') ? 'twitter'
        : openapiUrl.includes('reddit') ? 'reddit'
        : 'web';

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, details] of Object.entries(methods)) {
          if (['get', 'post', 'put', 'delete', 'patch'].indexOf(method.toLowerCase()) === -1) continue;
          const fullUrl = `${baseUrl}${path}`;
          const name = details.summary || details.operationId || `${serviceType}: ${path}`;

          allEndpoints.push({
            source_id: `cascade-${serviceType}-${path.replace(/\//g, '-')}`,
            name: cleanName(name, fullUrl, 'Cascade'),
            description: (details.description || name).slice(0, 500),
            url: fullUrl,
            protocol: 'x402',
            price_usd: serviceType === 'web' ? 0.005 : 0.001,
            payment_asset: 'USDC',
            payment_network: 'base',
            category: serviceType === 'web' ? 'search' : 'social',
            provider: 'Cascade',
            health_status: 'healthy',
            uptime_30d: null,
            latency_p50_ms: serviceType === 'web' ? 1200 : 800,
            reliability_score: null,
            http_method: method.toUpperCase(),
            source: 'cascade',
          });
        }
      }
    } catch {
      continue;
    }
  }

  return upsertEndpoints(allEndpoints);
}

// Sources 5 (Dexter) and 6 (x402list.fun) removed 2026-04-06 — both return 404.

// ─── Provider Discovery URL Polling ─────────────────────────────────────────
// Registered providers can set soma_discovery_url. We poll it on the WARM
// tier (30 min) and merge any new endpoints into the live registry.
// Expected response: { endpoints: [{ name, url, description?, category?, method?, price? }] }
// or a flat array of the same shape.

async function syncProviderDiscoveryUrls(): Promise<number> {
  let rows: Array<{ id: string; name: string; slug: string; soma_discovery_url: string }>;
  try {
    rows = getDb().prepare(
      "SELECT id, name, slug, soma_discovery_url FROM providers WHERE soma_discovery_url IS NOT NULL AND soma_discovery_url != '' AND status = 'active'"
    ).all() as any[];
  } catch {
    return 0;
  }

  if (rows.length === 0) return 0;

  let totalAdded = 0;

  for (const provider of rows) {
    try {
      const res = await fetch(provider.soma_discovery_url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) continue;

      let data: unknown;
      try { data = await res.json(); } catch { continue; }

      const eps = extractArray(data, ['endpoints', 'services', 'data', 'items']);
      if (eps.length === 0) continue;

      const slug = provider.slug || provider.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      for (const raw of eps) {
        const ep = raw as { name?: string; url?: string; endpoint?: string; description?: string; category?: string; method?: string; price?: number; costPerCall?: number };
        const epUrl = ep.url || ep.endpoint;
        if (!ep.name || !epUrl) continue;

        const nameSlug = ep.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const endpointId = `${slug}-${nameSlug}`;

        const existing = getDb().prepare('SELECT id FROM endpoints WHERE id = ?').get(endpointId);
        if (!existing) {
          getDb().prepare(`
            INSERT INTO endpoints (id, provider, provider_id, base_url, name, description, category, cost_per_call, status, source, http_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'provider', ?)
          `).run(
            endpointId, provider.name, provider.id, epUrl, ep.name,
            ep.description || '', mapCategory(ep.category || 'utility'),
            ep.price ?? ep.costPerCall ?? 0.001, ep.method || 'GET',
          );
          totalAdded++;
        }
      }

      if (totalAdded > 0) {
        logger.info({ providerId: provider.id, name: provider.name, added: totalAdded }, 'Provider discovery URL synced');
      }
    } catch {
      continue;
    }
  }

  return totalAdded;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract an array from a response that may be an array directly or an object with a known key */
function extractArray(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const val = (data as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val;
    }
  }
  return [];
}

// ─── Registry merge ──────────────────────────────────────────────────────────

/**
 * Merge indexed endpoints from the DB into ClawNet's live API registry.
 * Called after each sync and also on startup (if INDEX_SYNC_ENABLED).
 * Endpoints are tagged with their source for identification.
 */
export function mergeIndexedIntoRegistry(): { added: number; updated: number } {
  let rows: IndexedEndpoint[];
  try {
    rows = getDb()
      .prepare("SELECT * FROM indexed_endpoints WHERE health_status = 'healthy'")
      .all() as IndexedEndpoint[];
  } catch {
    // Table might not exist yet (migration not run)
    return { added: 0, updated: 0 };
  }

  if (rows.length === 0) return { added: 0, updated: 0 };

  // Include all healthy endpoints — use a sensible default cost for those without pricing
  const DEFAULT_COST_USD = 0.001;
  const endpoints: ApiEndpoint[] = rows.map(r => {
    const costUsd = (r.price_usd != null && r.price_usd > 0) ? r.price_usd : DEFAULT_COST_USD;
    return {
      id: `${r.source}-${r.source_id}`,
      provider: r.provider ? `${r.source}/${r.provider}` : r.source,
      baseUrl: r.url,
      name: r.name,
      description: r.description || r.name,
      category: mapCategory(r.category),
      costPerCall: costUsd,
      latencyMs: r.latency_p50_ms ?? 1000,
      inputSchema: {},
      outputFields: [],
      creditCost: round6(Math.max(0.001, costUsd * 1500)),
    };
  });

  const result = mergeDiscoveredEndpoints(endpoints);
  if (result.added > 0 || result.updated > 0) {
    logger.info(`[index-sync] Merged into registry: ${result.added} added, ${result.updated} updated`);
  }
  return result;
}

/** Map external categories to ClawNet's ApiEndpoint category enum */
function mapCategory(cat: string): ApiEndpoint['category'] {
  const lower = (cat || '').toLowerCase();
  const mapping: Record<string, ApiEndpoint['category']> = {
    crypto: 'solana',
    blockchain: 'solana',
    defi: 'defi',
    social: 'social',
    weather: 'weather',
    search: 'search',
    media: 'media',
    security: 'security',
    ai: 'ai-ml',
    'ai-ml': 'ai-ml',
    ml: 'ai-ml',
    intelligence: 'intelligence',
    oracle: 'oracle',
    scraping: 'scraping',
    infrastructure: 'infrastructure',
    enrichment: 'enrichment',
    finance: 'defi',
    payments: 'utility',
    data: 'enrichment',
    compute: 'infrastructure',
    twitter: 'social',
    reddit: 'social',
    web: 'search',
    llm: 'ai-ml',
    inference: 'ai-ml',
    discovery: 'discovery',
    marketplace: 'discovery',
  };
  return mapping[lower] ?? 'utility';
}
