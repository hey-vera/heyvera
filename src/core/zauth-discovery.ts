/**
 * Zauth Auto-Discovery — DEPRECATED as of 2026-04-05.
 *
 * zauthx402.com's public REST API at /api/services|endpoints|directory|verify
 * returns HTTP 404 — verified directly against their live Next.js site. They
 * never shipped a public consumer API; their only real product is an inbound
 * provider SDK (`@zauthx402/sdk` on npm) that collects telemetry FROM providers.
 *
 * Cron is now env-flagged OFF by default (`ZAUTH_DISCOVERY_ENABLED=false`).
 * This file is kept for partnership restoration — if zauth ships a real
 * public API, flip the flag. Meanwhile discovery is being pivoted to x402scan
 * (see src/core/x402scan-discovery.ts).
 *
 * Original design:
 *   1. Query zauth REST API for verified endpoints
 *   2. Filter to WORKING status only
 *   3. Merge into ClawNet's indexed_endpoints (source='zauth')
 *   4. Optionally pre-screen endpoints before spending credits
 */

import { env } from '../config/index';
import { logger } from '../utils/logger';
import { getDb } from '../db/connection';
import { nanoid } from 'nanoid';
import { mergeDiscoveredEndpoints, type ApiEndpoint } from '../config/api-registry';
import { round6 } from './credits';

const ZAUTH_API = 'https://zauthx402.com/api';
const ZAUTH_DISCOVERY_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _lastSync: { timestamp: string; discovered: number; working: number; merged: number } | null = null;

export function getLastZauthSync() { return _lastSync; }

// ─── Zauth API Response Types ────────────────────────────────────────────────

interface ZauthEndpoint {
  url: string;
  name?: string;
  description?: string;
  status: 'WORKING' | 'FAILING' | 'FLAKY' | 'UNTESTED';
  successRate?: number;
  latencyMs?: number;
  priceUsdc?: number;
  network?: string;
  lastVerified?: string;
  category?: string;
  provider?: string;
}

interface ZauthDirectoryResponse {
  endpoints?: ZauthEndpoint[];
  services?: ZauthEndpoint[];
  data?: ZauthEndpoint[];
  total?: number;
}

// ─── Endpoint Classification ─────────────────────────────────────────────────

function classifyCategory(ep: ZauthEndpoint): ApiEndpoint['category'] {
  const desc = (ep.description ?? ep.name ?? ep.url).toLowerCase();

  if (desc.includes('price') || desc.includes('market') || desc.includes('token')) return 'enrichment';
  if (desc.includes('swap') || desc.includes('defi') || desc.includes('yield')) return 'defi';
  if (desc.includes('nft') || desc.includes('solana') || desc.includes('wallet')) return 'solana';
  if (desc.includes('social') || desc.includes('tweet') || desc.includes('reddit')) return 'social';
  if (desc.includes('ai') || desc.includes('llm') || desc.includes('generate')) return 'ai-ml';
  if (desc.includes('search') || desc.includes('scrape')) return 'utility';
  return 'utility';
}

function makeEndpointId(url: string): string {
  const cleaned = url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `zauth-${cleaned}`;
}

// ─── Zauth API Fetching ──────────────────────────────────────────────────────

async function fetchZauthDirectory(): Promise<ZauthEndpoint[]> {
  // Try multiple possible API shapes (zauth is early-stage, API may evolve)
  const urls = [
    `${ZAUTH_API}/services`,
    `${ZAUTH_API}/endpoints`,
    `${ZAUTH_API}/directory`,
    `${ZAUTH_API}/v1/services`,
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'ClawNet/1.0' },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const data = await res.json() as ZauthDirectoryResponse;

      // Normalize: zauth might return endpoints under different keys
      const endpoints = data.endpoints ?? data.services ?? data.data ?? [];
      if (Array.isArray(endpoints) && endpoints.length > 0) {
        logger.info({ url, count: endpoints.length }, 'Zauth directory fetched');
        return endpoints;
      }
    } catch {
      // Try next URL
      continue;
    }
  }

  logger.debug('Zauth discovery: no response from any endpoint');
  return [];
}

/**
 * Verify a single endpoint's status via zauth (for pre-flight checks).
 * Returns the endpoint status or null if zauth can't verify it.
 */
export async function checkEndpointViaZauth(endpointUrl: string): Promise<{
  status: string;
  successRate?: number;
  latencyMs?: number;
} | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${ZAUTH_API}/verify?url=${encodeURIComponent(endpointUrl)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'ClawNet/1.0' },
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = await res.json() as { status?: string; successRate?: number; latencyMs?: number };
    return data.status ? { status: data.status, successRate: data.successRate, latencyMs: data.latencyMs } : null;
  } catch {
    return null;
  }
}

// ─── Discovery Engine ────────────────────────────────────────────────────────

export async function runZauthDiscovery(): Promise<void> {
  if (_running) return;
  _running = true;

  try {
    const allEndpoints = await fetchZauthDirectory();

    if (allEndpoints.length === 0) {
      _lastSync = { timestamp: new Date().toISOString(), discovered: 0, working: 0, merged: 0 };
      return;
    }

    // Filter to WORKING endpoints only
    const working = allEndpoints.filter(ep => ep.status === 'WORKING');

    if (working.length === 0) {
      logger.info({ total: allEndpoints.length }, 'Zauth discovery: no WORKING endpoints');
      _lastSync = { timestamp: new Date().toISOString(), discovered: allEndpoints.length, working: 0, merged: 0 };
      return;
    }

    // Convert to ClawNet ApiEndpoint format
    const clawEndpoints: ApiEndpoint[] = working.map(ep => ({
      id: makeEndpointId(ep.url),
      provider: ep.provider ?? 'Zauth',
      path: new URL(ep.url).pathname || '/',
      name: ep.name ?? `Zauth: ${new URL(ep.url).hostname}`,
      description: ep.description ?? `Verified x402 endpoint (${Math.round((ep.successRate ?? 0) * 100)}% success rate)`,
      category: classifyCategory(ep),
      costPerCall: ep.priceUsdc ?? 0.002,
      latencyMs: ep.latencyMs ?? 1000,
      inputSchema: { params: 'Request parameters' },
      outputFields: ['data'],
      cacheTtl: 300,
    }));

    // Also store in indexed_endpoints with source='zauth'
    const stmt = getDb().prepare(`
      INSERT OR REPLACE INTO indexed_endpoints (id, name, description, url, category, price_usd, health_status, protocol, source, last_synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'zauth', datetime('now'))
    `);

    let indexed = 0;
    getDb().transaction(() => {
      for (const ep of working) {
        const id = `zauth-${nanoid(8)}`;
        stmt.run(
          id,
          ep.name ?? new URL(ep.url).hostname,
          ep.description ?? 'Zauth-verified x402 endpoint',
          ep.url,
          classifyCategory(ep),
          ep.priceUsdc ?? 0.002,
          ep.status.toLowerCase(),
          ep.network?.includes('solana') ? 'solana' : 'x402',
        );
        indexed++;
      }
    })();

    // Also merge into the live API registry
    const { added, updated } = mergeDiscoveredEndpoints(clawEndpoints, new Map());

    _lastSync = {
      timestamp: new Date().toISOString(),
      discovered: allEndpoints.length,
      working: working.length,
      merged: added + updated,
    };

    logger.info({
      discovered: allEndpoints.length,
      working: working.length,
      indexed,
      merged: added + updated,
    }, 'Zauth discovery: endpoints synced');

  } catch (err) {
    logger.error({ err }, 'Zauth discovery failed');
  } finally {
    _running = false;
  }
}

// ─── Cron ────────────────────────────────────────────────────────────────────

export function startZauthDiscovery(): void {
  // Flag-gated: DEPRECATED until zauth ships a real public consumer API.
  if (!env.ZAUTH_DISCOVERY_ENABLED) {
    logger.info('Zauth discovery cron skipped (ZAUTH_DISCOVERY_ENABLED=false, deprecated — see x402scan-discovery)');
    return;
  }

  // Initial run after 60s (after other discovery crons have settled)
  setTimeout(() => {
    runZauthDiscovery().catch(err => logger.error({ err }, 'Zauth initial discovery failed'));
  }, 60_000);

  _interval = setInterval(() => {
    runZauthDiscovery().catch(err => logger.error({ err }, 'Zauth discovery cron failed'));
  }, ZAUTH_DISCOVERY_INTERVAL);

  logger.warn({ intervalMs: ZAUTH_DISCOVERY_INTERVAL }, 'Zauth discovery cron started (DEPRECATED — zauthx402.com/api returns 404)');
}

export function stopZauthDiscovery(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
