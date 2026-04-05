/**
 * x402scan Discovery — x402 endpoint explorer by Merit Systems.
 *
 * x402scan (www.x402scan.com, github.com/Merit-Systems/x402scan) is the real
 * x402 endpoint explorer. Messari-profiled. Replaces the dead zauth integration.
 *
 * Status: STUB / FLAG-GATED OFF.
 *
 * Why gated: x402scan's public API requires x402 payment ($0.01/call on Base)
 * via an `X-Payment` header with a signed EIP-712 payload. ClawNet doesn't yet
 * have x402-client payment signing wired on the *caller* side for arbitrary
 * x402-gated endpoints, so automatic polling would fail. Activate once:
 *   1. x402 client-side payment signer is wired (see src/core/x402-client.ts TODO)
 *   2. Budget decision made: ~$0.01 per poll × 24h interval = $0.04/day sustained
 *   3. Alternative: SIWX wallet auth for free registry writes (x402scan supports
 *      both read-paid + write-free-with-wallet-signature modes)
 *
 * API surface (verified from x402scan repo):
 *   GET  /api/x402/resources?page=0&page_size=10&chain=base|solana   ($0.01)
 *   GET  /api/x402/resources/search?q=...                            ($0.02)
 *   GET  /api/x402/registry/origin?url=...                           (free)
 *   POST /api/x402/registry/register                                 (SIWX auth, free)
 *
 * Enable via env: X402SCAN_DISCOVERY_ENABLED=true
 * See internal/roadmap.md §3 Phase 2.5 for activation checklist.
 */

import { env } from '../config/index';
import { logger } from '../utils/logger';

const X402SCAN_API = 'https://www.x402scan.com/api/x402';
const X402SCAN_DISCOVERY_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours (cost-conscious)

let _interval: ReturnType<typeof setInterval> | null = null;
let _lastSync: { timestamp: string; discovered: number; merged: number } | null = null;

export function getLastX402scanSync() { return _lastSync; }

// ─── x402scan API Response Types ─────────────────────────────────────────────

export interface X402scanResource {
  url: string;
  origin?: string;
  name?: string;
  description?: string;
  chain?: 'base' | 'solana';
  price_usdc?: number;
  category?: string;
  last_seen?: string;
  success_rate?: number;
}

interface X402scanResourcesResponse {
  resources?: X402scanResource[];
  total?: number;
  page?: number;
  page_size?: number;
}

// ─── Discovery Stub ──────────────────────────────────────────────────────────

/**
 * Fetch resources from x402scan.
 * STUB: returns empty array until x402 payment signing is wired.
 * The signed X-Payment header construction lives in src/core/x402-client.ts.
 */
export async function fetchX402scanResources(): Promise<X402scanResource[]> {
  // TODO: once x402-client payment signing is wired, implement:
  //   1. Build x402 payment payload for $0.01 USDC on Base
  //   2. Sign with EVM_PRIVATE_KEY
  //   3. GET /api/x402/resources?page=0&page_size=100 with X-Payment header
  //   4. Parse X-Payment-Response for settlement confirmation
  //   5. Normalize + return resources

  logger.debug({ url: `${X402SCAN_API}/resources` }, 'x402scan fetch: payment signing not yet wired');
  return [];
}

export async function runX402scanDiscovery(): Promise<void> {
  try {
    const resources = await fetchX402scanResources();

    if (resources.length === 0) {
      _lastSync = { timestamp: new Date().toISOString(), discovered: 0, merged: 0 };
      return;
    }

    // TODO: convert to ApiEndpoint, merge into indexed_endpoints with source='x402scan',
    // call mergeDiscoveredEndpoints(). Mirror the zauth pattern once payment is wired.

    _lastSync = {
      timestamp: new Date().toISOString(),
      discovered: resources.length,
      merged: 0,
    };

    logger.info({ discovered: resources.length }, 'x402scan discovery: sync complete');
  } catch (err) {
    logger.error({ err }, 'x402scan discovery failed');
  }
}

// ─── Cron ────────────────────────────────────────────────────────────────────

export function startX402scanDiscovery(): void {
  if (!env.X402SCAN_DISCOVERY_ENABLED) {
    logger.info('x402scan discovery cron skipped (X402SCAN_DISCOVERY_ENABLED=false — payment signing not wired)');
    return;
  }

  // Initial run after 90s
  setTimeout(() => {
    runX402scanDiscovery().catch(err => logger.error({ err }, 'x402scan initial discovery failed'));
  }, 90_000);

  _interval = setInterval(() => {
    runX402scanDiscovery().catch(err => logger.error({ err }, 'x402scan discovery cron failed'));
  }, X402SCAN_DISCOVERY_INTERVAL);

  logger.info({ intervalMs: X402SCAN_DISCOVERY_INTERVAL }, 'x402scan discovery cron started ($0.01/poll via x402 payment)');
}

export function stopX402scanDiscovery(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
