/**
 * 402index.io Catalog Sync
 *
 * Periodically fetches healthy x402 endpoints from 402index.io
 * and stores them in the indexed_endpoints table. These endpoints
 * become available to the orchestration engine alongside ClawNet's
 * native 390+ APIs via mergeDiscoveredEndpoints().
 *
 * Runs every 4 hours (configurable via INDEX_SYNC_INTERVAL_MS).
 * Only syncs x402 endpoints that are healthy and have known pricing.
 */

import { env } from '../config/index';
import { logger } from '../utils/logger';
import { getDb } from '../db/connection';
import { nanoid } from 'nanoid';
import { mergeDiscoveredEndpoints, type ApiEndpoint } from '../config/api-registry';
import { round6 } from './credits';

const INDEX_API = 'https://402index.io/api/v1/services';
const SYNC_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const PAGE_LIMIT = 200;
const FETCH_TIMEOUT = 15_000; // 15s
const STALE_HOURS = 48;
const MAX_LATENCY_MS = 5000;

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

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startIndexSync(): void {
  if (!env.INDEX_SYNC_ENABLED) {
    logger.info('[index-sync] Disabled (INDEX_SYNC_ENABLED=false)');
    return;
  }

  logger.info('[index-sync] Starting 402index catalog sync (every 4h)');

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

async function syncCatalog(): Promise<void> {
  logger.info('[index-sync] Fetching 402index catalog...');

  let totalSynced = 0;
  let offset = 0;
  const allEndpoints: IndexServiceResponse[] = [];

  // Paginate through all x402 endpoints
  while (true) {
    const url = `${INDEX_API}?protocol=x402&health=healthy&limit=${PAGE_LIMIT}&offset=${offset}&sort=reliability&order=desc`;

    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { 'User-Agent': 'ClawNet/1.0 (orchestration-sync)' },
      });
    } catch (err) {
      logger.warn({ err, offset }, '[index-sync] Fetch failed — stopping pagination');
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

    allEndpoints.push(...services);
    offset += services.length;

    // If we got fewer than limit, we're done
    if (services.length < PAGE_LIMIT) break;

    // Rate limit ourselves — 1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  if (allEndpoints.length === 0) {
    logger.info('[index-sync] No endpoints fetched — skipping DB write');
    return;
  }

  // Upsert each service in a transaction
  const upsertStmt = getDb().prepare(`
    INSERT INTO indexed_endpoints (id, source_id, name, description, url, protocol, price_usd, payment_asset, payment_network, category, provider, health_status, uptime_30d, latency_p50_ms, reliability_score, http_method, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(url, protocol) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      price_usd = excluded.price_usd,
      health_status = excluded.health_status,
      uptime_30d = excluded.uptime_30d,
      latency_p50_ms = excluded.latency_p50_ms,
      reliability_score = excluded.reliability_score,
      last_synced = datetime('now')
  `);

  getDb().transaction(() => {
    for (const svc of allEndpoints) {
      // Skip endpoints without a URL or with very high latency
      if (!svc.url || svc.latency_p50_ms > MAX_LATENCY_MS) continue;

      upsertStmt.run(
        `idx-${nanoid(12)}`,
        String(svc.id),
        (svc.name || '').slice(0, 200),
        (svc.description || '').slice(0, 500),
        svc.url,
        svc.protocol || 'x402',
        svc.price_usd ?? null,
        svc.payment_asset || 'USDC',
        svc.payment_network || 'base',
        (svc.category || 'uncategorized').slice(0, 100),
        (svc.provider || 'unknown').slice(0, 100),
        svc.health_status || 'unknown',
        svc.uptime_30d ?? null,
        svc.latency_p50_ms ?? null,
        svc.reliability_score ?? null,
        svc.http_method || 'GET',
      );
      totalSynced++;
    }
  })();

  // Clean up stale entries (not synced in 48 hours)
  const cleaned = getDb().prepare(
    `DELETE FROM indexed_endpoints WHERE last_synced < datetime('now', '-${STALE_HOURS} hours')`,
  ).run();

  // Merge into the live API registry so orchestration can use them
  mergeIndexedIntoRegistry();

  logger.info(`[index-sync] Synced ${totalSynced} endpoints, cleaned ${cleaned.changes} stale entries`);
}

/**
 * Merge indexed endpoints from the DB into ClawNet's live API registry.
 * Called after each sync and also on startup (if INDEX_SYNC_ENABLED).
 * Endpoints are added with provider='402index' so they can be identified.
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
      id: `402idx-${r.source_id}`,
      provider: r.provider ? `402index/${r.provider}` : '402index',
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

/** Map 402index categories to ClawNet's ApiEndpoint category enum */
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
  };
  return mapping[lower] ?? 'utility';
}
