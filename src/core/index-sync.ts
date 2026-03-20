/**
 * Multi-Source Index Sync
 *
 * Periodically fetches x402/L402 endpoints from three registries:
 *   1. 402index.io — community x402 directory
 *   2. Coinbase Bazaar — official x402 facilitator discovery
 *   3. Satring — curated L402 + x402 directory
 *
 * Endpoints are stored in the indexed_endpoints table with a `source`
 * tag and become available to the orchestration engine via
 * mergeDiscoveredEndpoints().
 *
 * Runs every 4 hours (configurable via INDEX_SYNC_INTERVAL_MS).
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

const SYNC_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
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

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startIndexSync(): void {
  if (!env.INDEX_SYNC_ENABLED) {
    logger.info('[index-sync] Disabled (INDEX_SYNC_ENABLED=false)');
    return;
  }

  logger.info('[index-sync] Starting multi-source catalog sync (every 4h)');

  // Run immediately on startup, then every 4h
  syncCatalog().catch(err => logger.error({ err }, '[index-sync] Initial sync failed'));
  syncTimer = setInterval(() => {
    syncCatalog().catch(err => logger.error({ err }, '[index-sync] Sync failed'));
  }, SYNC_INTERVAL);
  syncTimer.unref();
}

export function stopIndexSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

// ─── Main sync orchestrator ──────────────────────────────────────────────────

async function syncCatalog(): Promise<void> {
  logger.info('[index-sync] Fetching catalogs from all sources...');

  const results = await Promise.allSettled([
    syncFrom402Index(),
    syncFromBazaar(),
    syncFromSatring(),
  ]);

  const sourceNames = ['402index', 'bazaar', 'satring'];
  let totalSynced = 0;

  for (const [i, result] of results.entries()) {
    const source = sourceNames[i];
    if (result.status === 'fulfilled') {
      logger.info(`[index-sync] ${source}: synced ${result.value} endpoints`);
      totalSynced += result.value;
    } else {
      logger.warn(`[index-sync] ${source}: failed - ${result.reason}`);
    }
  }

  if (totalSynced === 0) {
    logger.info('[index-sync] No endpoints synced from any source — skipping cleanup');
    return;
  }

  // Clean up stale entries (not synced in 48 hours)
  const cleaned = getDb().prepare(
    `DELETE FROM indexed_endpoints WHERE last_synced < datetime('now', '-${STALE_HOURS} hours')`,
  ).run();

  // Merge into the live API registry so orchestration can use them
  mergeIndexedIntoRegistry();

  logger.info(`[index-sync] Total: ${totalSynced} endpoints synced, ${cleaned.changes} stale entries cleaned`);
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
        name: svc.name || '',
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

interface BazaarResource {
  url?: string;
  resource_url?: string;
  endpoint?: string;
  name?: string;
  title?: string;
  description?: string;
  price?: number | string | { amount?: number | string; currency?: string };
  network?: string;
  asset?: string;
  facilitator?: string;
  category?: string;
  provider?: string;
  method?: string;
  http_method?: string;
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

  // Handle various response shapes: { resources: [...] }, { data: [...] }, or direct array
  const resources = extractArray(data, ['resources', 'data', 'items', 'results']);
  if (resources.length === 0) {
    logger.info('[index-sync] Bazaar returned 0 resources');
    return 0;
  }

  const endpoints: NormalizedEndpoint[] = [];
  for (const raw of resources) {
    const r = raw as BazaarResource;
    const url = r.url || r.resource_url || r.endpoint;
    if (!url || typeof url !== 'string') continue;

    // Extract price — could be number, string, or { amount, currency }
    let priceUsd: number | null = null;
    if (typeof r.price === 'number') {
      priceUsd = r.price;
    } else if (typeof r.price === 'string') {
      priceUsd = parseFloat(r.price) || null;
    } else if (r.price && typeof r.price === 'object') {
      priceUsd = typeof r.price.amount === 'number' ? r.price.amount
        : typeof r.price.amount === 'string' ? parseFloat(r.price.amount) || null
        : null;
    }

    endpoints.push({
      source_id: `bazaar-${nanoid(8)}`,
      name: (r.name || r.title || url).slice(0, 200),
      description: (r.description || '').slice(0, 500),
      url,
      protocol: 'x402',
      price_usd: priceUsd,
      payment_asset: r.asset || 'USDC',
      payment_network: r.network || 'base',
      category: (r.category || 'uncategorized').slice(0, 100),
      provider: (r.provider || r.facilitator || 'coinbase-bazaar').slice(0, 100),
      health_status: 'healthy', // Bazaar only lists active resources
      uptime_30d: null,
      latency_p50_ms: null,
      reliability_score: null,
      http_method: r.method || r.http_method || 'GET',
      source: 'bazaar',
    });
  }

  return upsertEndpoints(endpoints);
}

// ─── Source 3: Satring ───────────────────────────────────────────────────────

interface SatringService {
  url?: string;
  endpoint?: string;
  api_url?: string;
  name?: string;
  title?: string;
  description?: string;
  price?: number | string;
  price_usd?: number | string;
  protocol?: string;
  network?: string;
  asset?: string;
  category?: string;
  provider?: string;
  method?: string;
  http_method?: string;
  status?: string;
  health?: string;
}

async function syncFromSatring(): Promise<number> {
  // Try common API patterns — Satring's exact API shape is unknown
  for (const url of SATRING_URLS) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!res.ok) continue;

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        continue;
      }

      const services = extractArray(data, ['services', 'data', 'items', 'results', 'endpoints']);
      if (services.length === 0) continue;

      const endpoints: NormalizedEndpoint[] = [];
      for (const raw of services) {
        const s = raw as SatringService;
        const epUrl = s.url || s.endpoint || s.api_url;
        if (!epUrl || typeof epUrl !== 'string') continue;

        let priceUsd: number | null = null;
        const rawPrice = s.price_usd ?? s.price;
        if (typeof rawPrice === 'number') priceUsd = rawPrice;
        else if (typeof rawPrice === 'string') priceUsd = parseFloat(rawPrice) || null;

        endpoints.push({
          source_id: `satring-${nanoid(8)}`,
          name: (s.name || s.title || epUrl).slice(0, 200),
          description: (s.description || '').slice(0, 500),
          url: epUrl,
          protocol: s.protocol || 'x402',
          price_usd: priceUsd,
          payment_asset: s.asset || 'USDC',
          payment_network: s.network || null,
          category: (s.category || 'uncategorized').slice(0, 100),
          provider: (s.provider || 'satring').slice(0, 100),
          health_status: s.status || s.health || 'unknown',
          uptime_30d: null,
          latency_p50_ms: null,
          reliability_score: null,
          http_method: s.method || s.http_method || 'GET',
          source: 'satring',
        });
      }

      const count = upsertEndpoints(endpoints);
      if (count > 0) {
        logger.info(`[index-sync] Satring: found API at ${url}`);
        return count;
      }
    } catch {
      continue;
    }
  }

  logger.info('[index-sync] Satring: no working API found — skipping');
  return 0;
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

  const endpoints: ApiEndpoint[] = rows
    .filter(r => r.price_usd != null && r.price_usd > 0)
    .map(r => ({
      id: `${r.source}-${r.source_id}`,
      provider: r.provider ? `${r.source}/${r.provider}` : r.source,
      baseUrl: r.url,
      name: r.name,
      description: r.description || r.name,
      category: mapCategory(r.category),
      costPerCall: r.price_usd!,
      latencyMs: r.latency_p50_ms ?? 1000,
      inputSchema: {},
      outputFields: [],
      creditCost: round6(Math.max(0.001, r.price_usd! * 1500)),
    }));

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
  };
  return mapping[lower] ?? 'utility';
}
