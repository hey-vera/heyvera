/**
 * ClawAPIs Auto-Discovery — polls clawapis.com/api/pricing and merges
 * ALL discovered endpoints into the live registry.
 *
 * Dynamically discovers every provider in the response — no hardcoded
 * provider list. When ClawAPIs adds new providers, they appear automatically.
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

/** Response is a flat object: each key is a provider name, value is its endpoints.
 *  Special keys (totalEndpoints, meta, etc.) are skipped during iteration. */
type ClawApisPricingResponse = Record<string, unknown>;

// Keys in the response that are metadata, not provider endpoint maps
const METADATA_KEYS = new Set(['totalEndpoints', 'total', 'meta', 'version', 'updatedAt', 'timestamp']);

// ─── Category Classification ────────────────────────────────────────────────

/** Known provider → category overrides. Unknown providers use keyword analysis. */
const PROVIDER_CATEGORY_HINTS: Record<string, ApiEndpoint['category']> = {
  helius: 'solana',
  solscan: 'solana',
  jupiter: 'defi',
  raydium: 'defi',
  orca: 'defi',
  marinade: 'defi',
  dexscreener: 'defi',
  birdeye: 'defi',
  coingecko: 'enrichment',
  coinmarketcap: 'enrichment',
  messari: 'enrichment',
  x: 'social',
  twitter: 'social',
  reddit: 'social',
  farcaster: 'social',
  neynar: 'social',
  alchemy: 'infrastructure',
  quicknode: 'infrastructure',
  infura: 'infrastructure',
};

/** Map discovered endpoints to ClawNet categories based on provider hints + keyword analysis */
function classifyCategory(
  api: string,
  key: string,
  description: string,
): ApiEndpoint['category'] {
  // Check provider-level hint first
  const hint = PROVIDER_CATEGORY_HINTS[api.toLowerCase()];
  const desc = description.toLowerCase();
  const k = key.toLowerCase();

  // Keyword-based overrides (more specific than provider-level)
  if (desc.includes('token') && (desc.includes('price') || desc.includes('market'))) return 'enrichment';
  if (desc.includes('swap') || desc.includes('liquidity') || desc.includes('yield') || desc.includes('defi')) return 'defi';
  if (desc.includes('nft')) return 'solana';
  if (desc.includes('tweet') || desc.includes('post') || desc.includes('social') || desc.includes('follow')) return 'social';
  if (desc.includes('sentiment') || desc.includes('trend') || desc.includes('analysis')) return 'intelligence';
  if (desc.includes('dm') || desc.includes('direct message') || desc.includes('email') || desc.includes('notify')) return 'social';
  if (desc.includes('wallet') || desc.includes('balance') || desc.includes('account')) return 'solana';
  if (desc.includes('transaction') || desc.includes('block') || desc.includes('signature')) return 'solana';
  if (desc.includes('search') || desc.includes('scrape') || desc.includes('crawl')) return 'utility';
  if (desc.includes('image') || desc.includes('generate') || desc.includes('ai')) return 'ai-ml';
  if (k.includes('stream')) return 'social';

  // Fall back to provider hint, then 'utility'
  return hint ?? 'utility';
}

/** Generate a stable endpoint ID from the API + key */
function makeEndpointId(api: string, key: string): string {
  const cleaned = key
    .replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/i, '')
    .replace(/^\//, '')
    .replace(/\*/g, '')
    .replace(/[^a-zA-Z0-9/]/g, '')
    .replace(/\//g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/g, '')
    .toLowerCase();

  return `clawapis-${api.toLowerCase()}-${cleaned}`;
}

/** Extract the API path from the pricing key */
function extractPath(api: string, key: string): string {
  // If it looks like a JSON-RPC method name (no spaces, no slashes), route via base path
  if (!key.includes('/') && !key.includes(' ')) {
    return `/${api.toLowerCase()}/`;
  }
  const match = key.match(/^(?:GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/i);
  return match ? match[1].replace(/\*/g, '') : `/${api.toLowerCase()}/`;
}

/** Extract HTTP method from key, default GET */
function extractMethod(api: string, key: string): string {
  // JSON-RPC style keys (no spaces) → POST
  if (!key.includes(' ') && !key.includes('/')) return 'POST';
  const match = key.match(/^(GET|POST|PUT|DELETE|PATCH)\s/i);
  return match ? match[1].toUpperCase() : 'GET';
}

/** Parse "$0.05" → 0.05 */
function parsePrice(priceStr: string): number {
  const num = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
  return isNaN(num) ? 0.01 : num;
}

/** Estimate latency based on cost and description keywords */
function estimateLatency(api: string, costPerCall: number, description: string): number {
  const desc = description.toLowerCase();
  // Fast lookups
  if (desc.includes('rpc') || desc.includes('balance') || desc.includes('getblock')) return 200;
  if (costPerCall <= 0.001) return 300;
  // Medium
  if (desc.includes('search') || desc.includes('list') || desc.includes('query')) return 800;
  if (costPerCall <= 0.01) return 500;
  // Heavier ops
  if (desc.includes('bulk') || desc.includes('batch') || desc.includes('analysis')) return 2000;
  if (costPerCall >= 1) return 2000;
  if (costPerCall >= 0.10) return 1000;
  return 500;
}

/** Generate appropriate output fields based on description keywords */
function inferOutputFields(_api: string, description: string): string[] {
  const desc = description.toLowerCase();
  if (desc.includes('balance')) return ['balance', 'amount'];
  if (desc.includes('token') && desc.includes('price')) return ['price', 'symbol', 'volume', 'change'];
  if (desc.includes('transaction')) return ['signature', 'slot', 'blockTime', 'meta'];
  if (desc.includes('asset') || desc.includes('nft')) return ['id', 'content', 'authorities'];
  if (desc.includes('tweet') || desc.includes('post')) return ['id', 'text', 'author_id', 'created_at'];
  if (desc.includes('user') || desc.includes('profile')) return ['id', 'name', 'username'];
  if (desc.includes('swap') || desc.includes('quote')) return ['inAmount', 'outAmount', 'route', 'priceImpact'];
  if (desc.includes('holder')) return ['address', 'amount', 'percentage'];
  if (desc.includes('search')) return ['results', 'total'];
  return ['data'];
}

/** Generate input schema based on description keywords */
function inferInputSchema(_api: string, key: string, description: string): Record<string, string> {
  const desc = description.toLowerCase();

  if (desc.includes('search') || desc.includes('query')) return { query: 'Search query string' };
  if (desc.includes('balance') || desc.includes('account') || desc.includes('wallet')) return { address: 'Wallet or account address' };
  if (desc.includes('token') && (desc.includes('price') || desc.includes('info'))) return { address: 'Token mint/contract address' };
  if (desc.includes('transaction') || desc.includes('signature')) return { signature: 'Transaction signature/hash' };
  if (desc.includes('asset') || desc.includes('nft')) return { id: 'Asset ID or mint address' };
  if (desc.includes('tweet') || desc.includes('post')) return { id: 'Tweet/post ID' };
  if (desc.includes('user') || desc.includes('profile')) return { id: 'User ID or username' };
  if (desc.includes('swap') || desc.includes('quote')) return { inputMint: 'Input token address', outputMint: 'Output token address', amount: 'Amount in smallest unit' };
  if (desc.includes('holder')) return { address: 'Token mint address' };

  // Fall back: if key looks like a path with an ID param, use 'id'
  if (key.includes(':') || key.includes('{')) return { id: 'Resource identifier' };
  return { params: 'Request parameters' };
}

// ─── Capability Group Classification ────────────────────────────────────────

/** Map discovered endpoints into capability groups for the pricing optimizer */
function inferCapabilityGroup(_api: string, key: string, description: string): string | null {
  const desc = description.toLowerCase();
  const k = key.toLowerCase();

  if (desc.includes('balance') || desc.includes('portfolio') || k.includes('getbalance') || k.includes('getaccount')) return 'wallet-portfolio';
  if (desc.includes('token') && (desc.includes('price') || desc.includes('market'))) return 'token-price';
  if (desc.includes('holder') || desc.includes('distribution')) return 'holder-analysis';
  if (desc.includes('sentiment') || desc.includes('trend') || (desc.includes('tweet') && desc.includes('search'))) return 'social-sentiment';
  if (desc.includes('swap') || desc.includes('quote') || desc.includes('route')) return 'dex-swap';
  if (desc.includes('nft') && (desc.includes('list') || desc.includes('collection'))) return 'nft-data';
  if (desc.includes('risk') || desc.includes('audit') || desc.includes('score')) return 'risk-analysis';
  return null;
}

// ─── Discovery Engine ───────────────────────────────────────────────────────

let _running = false;
let _lastDiscovery: { timestamp: string; added: number; updated: number; total: number; providers: string[] } | null = null;

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

/** Check if a value looks like an endpoint map: { "key": { price: "...", description: "..." } } */
function isEndpointMap(value: unknown): value is Record<string, ClawApisPricingEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.values(value);
  if (entries.length === 0) return false;
  // Check first entry has price + description
  const first = entries[0];
  return first != null && typeof first === 'object' && 'price' in first && 'description' in first;
}

function parseApiEndpoints(
  api: string,
  entries: Record<string, ClawApisPricingEntry>,
): { endpoints: ApiEndpoint[]; capabilities: Map<string, string[]> } {
  const endpoints: ApiEndpoint[] = [];
  const capabilities = new Map<string, string[]>();

  for (const [key, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== 'object' || !entry.price || !entry.description) continue;

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
      latencyMs: estimateLatency(api, costPerCall, entry.description),
      inputSchema: inferInputSchema(api, key, entry.description),
      outputFields: inferOutputFields(api, entry.description),
      cacheTtl: costPerCall <= 0.001 ? 30 : 300,
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
    const discoveredProviders: string[] = [];

    // Iterate over ALL keys in the response — discover any provider dynamically
    for (const [apiKey, value] of Object.entries(pricing)) {
      if (METADATA_KEYS.has(apiKey)) continue;
      if (!isEndpointMap(value)) continue;

      discoveredProviders.push(apiKey);

      const { endpoints, capabilities } = parseApiEndpoints(apiKey, value);
      allEndpoints.push(...endpoints);

      Array.from(capabilities.entries()).forEach(([group, ids]) => {
        const existing = allCapabilities.get(group) ?? [];
        existing.push(...ids);
        allCapabilities.set(group, existing);
      });
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
      providers: discoveredProviders,
    };

    logger.info({
      discoveredProviders,
      providerCount: discoveredProviders.length,
      endpointsDiscovered: allEndpoints.length,
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
