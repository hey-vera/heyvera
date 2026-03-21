/**
 * ClawAPIs Auto-Discovery — polls clawapis.com/api/pricing and merges
 * all discovered endpoints into the live registry.
 *
 * Runs on startup (30s delay) and every 4 hours. New endpoints are
 * auto-registered with computed credit costs. Existing endpoints get
 * their costPerCall updated if the upstream price changed.
 */

import cron from 'node-cron';
import { env } from '../config/index';
import {
  type ApiEndpoint,
  mergeDiscoveredEndpoints,
  getRegistryStats,
} from '../config/api-registry';
import { logger } from '../utils/logger';

// ─── ClawAPIs Response Types ────────────────────────────────────────────────

interface ClawApisPricingEntry {
  price: string;       // "$0.05"
  description: string;
}

interface ClawApisPricingResponse {
  totalEndpoints?: number;
  x?: Record<string, ClawApisPricingEntry>;
  helius?: Record<string, ClawApisPricingEntry>;
  solscan?: Record<string, ClawApisPricingEntry>;
  [key: string]: unknown;
}

// ─── Category Classification ────────────────────────────────────────────────

/** Map discovered endpoints to ClawNet categories based on keyword analysis */
function classifyCategory(
  api: 'x' | 'helius' | 'solscan',
  key: string,
  description: string,
): ApiEndpoint['category'] {
  const desc = description.toLowerCase();
  const k = key.toLowerCase();

  if (api === 'helius') {
    if (desc.includes('token') || desc.includes('asset') || desc.includes('nft')) return 'solana';
    if (desc.includes('transaction') || desc.includes('block')) return 'solana';
    return 'infrastructure';
  }

  if (api === 'solscan') {
    if (desc.includes('token') || desc.includes('nft')) return 'solana';
    if (desc.includes('market') || desc.includes('defi')) return 'defi';
    return 'solana';
  }

  // X/Twitter
  if (desc.includes('dm') || desc.includes('direct message')) return 'social';
  if (desc.includes('tweet') || desc.includes('post') || desc.includes('search')) return 'social';
  if (desc.includes('follow') || desc.includes('like') || desc.includes('retweet')) return 'social';
  if (desc.includes('trend')) return 'intelligence';
  if (desc.includes('compliance') || desc.includes('usage')) return 'utility';
  if (k.includes('stream')) return 'social';
  return 'social';
}

/** Generate a stable endpoint ID from the API + key */
function makeEndpointId(api: string, key: string): string {
  // "GET /x/2/tweets/*" → "clawapis-x-tweets"
  // "getBalance" → "clawapis-helius-getbalance"
  // "GET /solscan/account/tokens" → "clawapis-solscan-account-tokens"
  const cleaned = key
    .replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '')
    .replace(/^\//, '')
    .replace(/\*/g, '')
    .replace(/[^a-zA-Z0-9/]/g, '')
    .replace(/\//g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/g, '')
    .toLowerCase();

  return `clawapis-${api}-${cleaned}`;
}

/** Extract the API path from the pricing key */
function extractPath(api: string, key: string): string {
  if (api === 'helius') {
    // Helius uses JSON-RPC method names — route via base helius path
    return '/helius/';
  }
  // "GET /x/2/tweets/*" → "/x/2/tweets/"
  // "GET /solscan/account/tokens" → "/solscan/account/tokens"
  const match = key.match(/^(?:GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i);
  return match ? match[1].replace(/\*/g, '') : `/${api}/`;
}

/** Extract HTTP method from key, default POST for helius */
function extractMethod(api: string, key: string): string {
  if (api === 'helius') return 'POST'; // JSON-RPC
  const match = key.match(/^(GET|POST|PUT|DELETE|PATCH)\s/i);
  return match ? match[1].toUpperCase() : 'GET';
}

/** Parse "$0.05" → 0.05 */
function parsePrice(priceStr: string): number {
  const num = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0.01 : num;
}

/** Estimate latency based on API type and endpoint complexity */
function estimateLatency(api: string, costPerCall: number): number {
  if (api === 'helius' && costPerCall <= 0.001) return 200;  // standard RPC
  if (api === 'helius') return 500;  // DAS/enhanced
  if (api === 'solscan') return 300;
  if (costPerCall >= 1) return 2000;  // bulk endpoints
  if (costPerCall >= 0.10) return 1000;
  return 500;  // X API standard
}

/** Generate appropriate output fields based on description */
function inferOutputFields(api: string, description: string): string[] {
  const desc = description.toLowerCase();
  if (api === 'helius') {
    if (desc.includes('balance')) return ['balance', 'lamports'];
    if (desc.includes('asset')) return ['id', 'content', 'authorities', 'compression'];
    if (desc.includes('transaction')) return ['signature', 'slot', 'blockTime', 'meta'];
    return ['result'];
  }
  if (api === 'solscan') {
    if (desc.includes('token')) return ['address', 'symbol', 'name', 'price', 'volume'];
    if (desc.includes('account')) return ['address', 'balance', 'tokens'];
    return ['data'];
  }
  // X/Twitter
  if (desc.includes('tweet')) return ['id', 'text', 'author_id', 'created_at', 'public_metrics'];
  if (desc.includes('user')) return ['id', 'name', 'username', 'public_metrics'];
  if (desc.includes('dm')) return ['id', 'text', 'sender_id', 'created_at'];
  return ['data'];
}

/** Generate input schema based on API type and path */
function inferInputSchema(api: string, key: string, description: string): Record<string, string> {
  const desc = description.toLowerCase();

  if (api === 'helius') {
    const method = key; // helius keys are just method names
    if (method.includes('Asset')) return { id: 'Asset ID or mint address' };
    if (method.includes('Balance') || method.includes('Account')) return { address: 'Solana wallet address' };
    if (method.includes('Transaction') || method.includes('Signature')) return { signature: 'Transaction signature' };
    return { params: 'JSON-RPC params array' };
  }

  if (api === 'solscan') {
    if (desc.includes('token')) return { address: 'Token mint address' };
    if (desc.includes('account')) return { address: 'Account address' };
    if (desc.includes('transaction')) return { signature: 'Transaction signature' };
    return { address: 'Address or identifier' };
  }

  // X/Twitter — extract from path patterns
  if (desc.includes('tweet') && desc.includes('search')) return { query: 'Search query string', max_results: 'Max results (10-100)' };
  if (desc.includes('tweet')) return { id: 'Tweet ID' };
  if (desc.includes('user')) return { id: 'User ID or username' };
  if (desc.includes('dm')) return { participant_id: 'DM participant user ID' };
  if (desc.includes('follow') || desc.includes('like') || desc.includes('retweet')) return { target_id: 'Target user/tweet ID' };
  return { id: 'Resource identifier' };
}

// ─── Capability Group Classification ────────────────────────────────────────

/** Map discovered endpoints into capability groups for the pricing optimizer */
function inferCapabilityGroup(api: string, key: string, description: string): string | null {
  const desc = description.toLowerCase();
  const k = key.toLowerCase();

  // Helius
  if (api === 'helius') {
    if (k.includes('getbalance') || k.includes('getaccount')) return 'wallet-portfolio';
    if (k.includes('gettransaction') || k.includes('getsignature')) return null; // unique capability
    if (k.includes('getasset')) return null; // unique DAS capability
    return null;
  }

  // SolScan
  if (api === 'solscan') {
    if (desc.includes('token') && desc.includes('meta')) return 'token-price';
    if (desc.includes('holder')) return 'holder-analysis';
    return null;
  }

  // X/Twitter — mostly unique, some overlap with existing social endpoints
  if (desc.includes('tweet') && desc.includes('search')) return 'social-sentiment';
  if (desc.includes('trend')) return 'social-sentiment';
  return null;
}

// ─── Discovery Engine ───────────────────────────────────────────────────────

let _running = false;
let _lastDiscovery: { timestamp: string; added: number; updated: number; total: number } | null = null;

export function getLastDiscoveryResult() { return _lastDiscovery; }

async function fetchClawApisPricing(): Promise<ClawApisPricingResponse | null> {
  const baseUrl = env.CLAWAPIS_BASE_URL ?? 'https://clawapis.com';
  const url = `${baseUrl}/api/pricing`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn({ status: res.status }, 'ClawAPIs /api/pricing returned non-200');
      return null;
    }

    return await res.json() as ClawApisPricingResponse;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch ClawAPIs /api/pricing');
    return null;
  }
}

function parseApiEndpoints(
  api: 'x' | 'helius' | 'solscan',
  entries: Record<string, ClawApisPricingEntry>,
): { endpoints: ApiEndpoint[]; capabilities: Map<string, string[]> } {
  const endpoints: ApiEndpoint[] = [];
  const capabilities = new Map<string, string[]>();

  for (const [key, entry] of Object.entries(entries)) {
    const id = makeEndpointId(api, key);
    const costPerCall = parsePrice(entry.price);
    const method = extractMethod(api, key);
    const path = extractPath(api, key);

    const endpoint: ApiEndpoint = {
      id,
      provider: 'ClawAPIs',
      path,
      name: `ClawAPIs ${api.toUpperCase()}: ${entry.description.split('.')[0].slice(0, 60)}`,
      description: `[${method}] ${entry.description}`,
      category: classifyCategory(api, key, entry.description),
      costPerCall,
      latencyMs: estimateLatency(api, costPerCall),
      inputSchema: inferInputSchema(api, key, entry.description),
      outputFields: inferOutputFields(api, entry.description),
      cacheTtl: api === 'helius' && costPerCall <= 0.001 ? 30 : 300,
    };

    endpoints.push(endpoint);

    // Track capability groups
    const group = inferCapabilityGroup(api, key, entry.description);
    if (group) {
      const existing = capabilities.get(group) ?? [];
      existing.push(id);
      capabilities.set(group, existing);
    }
  }

  return { endpoints, capabilities };
}

export async function runEndpointDiscovery(): Promise<void> {
  if (_running) return;
  _running = true;

  try {
    const pricing = await fetchClawApisPricing();
    if (!pricing) {
      logger.info('Endpoint discovery: skipped (no response from ClawAPIs)');
      return;
    }

    const allEndpoints: ApiEndpoint[] = [];
    const allCapabilities = new Map<string, string[]>();

    for (const api of ['x', 'helius', 'solscan'] as const) {
      const entries = pricing[api];
      if (!entries || typeof entries !== 'object') continue;

      const { endpoints, capabilities } = parseApiEndpoints(api, entries as Record<string, ClawApisPricingEntry>);
      allEndpoints.push(...endpoints);

      for (const [group, ids] of capabilities) {
        const existing = allCapabilities.get(group) ?? [];
        existing.push(...ids);
        allCapabilities.set(group, existing);
      }
    }

    if (allEndpoints.length === 0) {
      logger.info('Endpoint discovery: no endpoints found in ClawAPIs response');
      return;
    }

    const { added, updated } = mergeDiscoveredEndpoints(allEndpoints, allCapabilities);
    const stats = getRegistryStats();

    _lastDiscovery = {
      timestamp: new Date().toISOString(),
      added,
      updated,
      total: stats.total,
    };

    logger.info({
      discovered: allEndpoints.length,
      added,
      updated,
      totalRegistry: stats.total,
      byProvider: stats.byProvider,
    }, 'Endpoint discovery complete');
  } catch (err) {
    logger.error({ err }, 'Endpoint discovery failed');
  } finally {
    _running = false;
  }
}

// ─── Cron ───────────────────────────────────────────────────────────────────

let discoveryTask: ReturnType<typeof cron.schedule> | null = null;

export function startEndpointDiscoveryCron(): void {
  // Every 4 hours
  discoveryTask = cron.schedule('0 */4 * * *', () => {
    runEndpointDiscovery().catch((err) => logger.error({ err }, 'Discovery cron error'));
  });

  // Run on startup with 30s delay (let server warm up first)
  setTimeout(() => {
    runEndpointDiscovery().catch((err) => logger.error({ err }, 'Initial discovery error'));
  }, 30_000);

  logger.info('Endpoint discovery cron started (every 4h)');
}

export function stopEndpointDiscoveryCron(): void {
  discoveryTask?.stop();
  discoveryTask = null;
}
