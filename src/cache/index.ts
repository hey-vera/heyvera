import { logger } from '../utils/logger';
import { setCircuitRedis } from '../core/circuit-breaker';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
import { recordVolatilityCheck, getAdaptiveTtl } from './adaptive-ttl';
import { recordCacheAccess } from './warming';

// ─── Smart Cache Entry ───────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
  contentHash: string;
  cachedAt: number;
  previousHash?: string;
  previousValue?: T;
  endpointId?: string;       // Track which endpoint this belongs to (for tag invalidation)
  accessCount: number;       // LFU: how many times accessed
  creditCost: number;        // For smart eviction weighting
}

// ─── Smart Eviction (LFU-weighted) ──────────────────────────────────────────
// Instead of simple LRU (evict least-recently-used), we weight by:
//   score = accessCount × creditCost
// High-value, frequently-accessed entries survive eviction over cheap, rare ones.

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxItems: number;
  private totalBytes = 0;

  constructor(maxItems: number) {
    this.maxItems = maxItems;
  }

  getEntry<T>(key: string): SmartCacheResult<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.staleUntil) {
      this.store.delete(key);
      return null;
    }

    // Increment access count for LFU
    entry.accessCount++;

    // LRU touch
    this.store.delete(key);
    this.store.set(key, entry);

    const fresh = now <= entry.expiresAt;
    return {
      value: entry.value,
      fresh,
      stale: !fresh,
      contentHash: entry.contentHash,
      previousHash: entry.previousHash,
      previousValue: entry.previousValue,
      cachedAt: entry.cachedAt,
    };
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      if (Date.now() > entry.staleUntil) {
        this.store.delete(key);
      }
      return null;
    }
    entry.accessCount++;
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set<T>(key: string, value: T, ttlSeconds: number, opts?: {
    previousValue?: T;
    previousHash?: string;
    endpointId?: string;
    creditCost?: number;
  }): void {
    // Smart eviction: if at capacity, evict the entry with lowest score
    if (this.store.size >= this.maxItems) {
      this.evictLowest();
    }
    const now = Date.now();
    const hash = contentHash(value);

    // Track memory usage
    const entryBytes = JSON.stringify(value).length + (opts?.previousValue ? JSON.stringify(opts.previousValue).length : 0) + 200; // 200 for metadata overhead
    this.totalBytes += entryBytes;

    this.store.set(key, {
      value,
      expiresAt: now + ttlSeconds * 1000,
      staleUntil: now + ttlSeconds * 1000 * STALE_MULTIPLIER,
      contentHash: hash,
      cachedAt: now,
      previousHash: opts?.previousHash,
      previousValue: opts?.previousValue,
      endpointId: opts?.endpointId,
      accessCount: 1,
      creditCost: opts?.creditCost ?? 0.001,
    });
  }

  /** Smart eviction: remove the entry with lowest score (accessCount × creditCost). */
  private evictLowest(): void {
    let lowestKey: string | null = null;
    let lowestScore = Infinity;
    for (const [key, entry] of this.store) {
      const score = entry.accessCount * Math.max(entry.creditCost, 0.001);
      if (score < lowestScore) {
        lowestScore = score;
        lowestKey = key;
      }
    }
    if (lowestKey) {
      const entry = this.store.get(lowestKey);
      if (entry) {
        this.totalBytes -= JSON.stringify(entry.value).length + (entry.previousValue ? JSON.stringify(entry.previousValue).length : 0) + 200;
      }
      this.store.delete(lowestKey);
    }
  }

  getRaw<T>(key: string): CacheEntry<T> | null {
    return (this.store.get(key) as CacheEntry<T>) ?? null;
  }

  /** Delete a specific key. Returns true if it existed. */
  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (entry) {
      this.totalBytes -= JSON.stringify(entry.value).length + (entry.previousValue ? JSON.stringify(entry.previousValue).length : 0) + 200;
    }
    return this.store.delete(key);
  }

  /** Delete all entries matching an endpoint ID (tag invalidation). */
  deleteByEndpoint(endpointId: string): number {
    let count = 0;
    for (const [key, entry] of this.store) {
      if (entry.endpointId === endpointId) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Get all keys for a given endpoint (for cascade invalidation). */
  getKeysByEndpoint(endpointId: string): string[] {
    const keys: string[] = [];
    for (const [key, entry] of this.store) {
      if (entry.endpointId === endpointId) keys.push(key);
    }
    return keys;
  }

  stats() {
    return { items: this.store.size, maxItems: this.maxItems, totalBytes: this.totalBytes, totalMB: Math.round(this.totalBytes / 1024 / 1024 * 100) / 100 };
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STALE_MULTIPLIER = 3;

/** Only compress values larger than 1KB for Redis storage. */
const COMPRESSION_THRESHOLD_BYTES = 1024;
const MAX_BACKGROUND_REFRESHES = 5;

/** Negative cache TTL: cache failures for this long (seconds). */
const NEGATIVE_CACHE_TTL = 30;

// ─── Singleton ───────────────────────────────────────────────────────────────

let memCache: MemoryCache | null = null;

function getMemCache(): MemoryCache {
  if (!memCache) {
    const maxItems = parseInt(process.env.CACHE_MAX_MEMORY_ITEMS ?? '10000');
    memCache = new MemoryCache(maxItems);
  }
  return memCache;
}

let redisClient: import('ioredis').Redis | null = null;

export async function initRedis(): Promise<void> {
  if (!process.env.REDIS_URL) return;
  try {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
    await redisClient.connect();
    setCircuitRedis(redisClient);
    logger.info('Redis connected');
  } catch (err) {
    logger.warn({ err }, 'Redis connection failed, using memory-only cache');
    redisClient = null;
  }
}

// ─── Content Hash ────────────────────────────────────────────────────────────

export function contentHash(value: unknown): string {
  const json = JSON.stringify(value, Object.keys(value && typeof value === 'object' ? value as Record<string, unknown> : {}).sort());
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

// ─── Semantic Key Normalization ──────────────────────────────────────────────
// "SOL" vs "sol" vs "Solana" should hit the same cache key.
// Normalize common crypto symbols, lowercase all values, trim whitespace.

const SYMBOL_ALIASES: Record<string, string> = {
  solana: 'sol', bitcoin: 'btc', ethereum: 'eth', ether: 'eth',
  ripple: 'xrp', cardano: 'ada', polkadot: 'dot', dogecoin: 'doge',
  chainlink: 'link', avalanche: 'avax', polygon: 'matic',
  litecoin: 'ltc', uniswap: 'uni', cosmos: 'atom',
};

function normalizeParamValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const lower = value.toLowerCase().trim();
  return SYMBOL_ALIASES[lower] ?? lower;
}

function normalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    normalized[key.toLowerCase().trim()] = normalizeParamValue(value);
  }
  return normalized;
}

export function cacheKey(endpointId: string, params: Record<string, unknown>): string {
  const normalized = JSON.stringify({
    endpointId,
    params: Object.fromEntries(Object.entries(normalizeParams(params)).sort()),
  });
  return 'claw:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ─── Request Coalescing (Single-Flight) ─────────────────────────────────────
// If multiple requests for the same key arrive while a fetch is in progress,
// they all wait for the single in-flight request instead of each making
// their own upstream call. Prevents thundering herd.

const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Coalesce concurrent requests for the same cache key.
 * Returns a wrapper that ensures only one upstream call happens at a time.
 */
export async function coalesceRequest<T>(
  key: string,
  fetchFn: () => Promise<T>,
): Promise<T> {
  // Check if there's already an in-flight request for this key
  const existing = inFlightRequests.get(key);
  if (existing) {
    logger.debug({ key }, 'Request coalesced — waiting for in-flight fetch');
    return existing as Promise<T>;
  }

  // Create the fetch promise and register it
  const promise = fetchFn()
    .finally(() => {
      // Remove from in-flight map when done (success or failure)
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, promise);
  return promise;
}

/** Get count of currently in-flight coalesced requests. */
export function getCoalescedCount(): number {
  return inFlightRequests.size;
}

// ─── Negative Caching ───────────────────────────────────────────────────────
// Cache failures briefly to prevent hammering broken endpoints.

const negativeCache = new Map<string, { error: string; expiresAt: number }>();

/**
 * Record a failed endpoint call. Subsequent requests within NEGATIVE_CACHE_TTL
 * will get the cached error instead of hitting the upstream again.
 */
export function cacheNegative(key: string, error: string): void {
  negativeCache.set(key, {
    error,
    expiresAt: Date.now() + NEGATIVE_CACHE_TTL * 1000,
  });
}

/**
 * Check if a key has a cached negative result (recent failure).
 * Returns the error string if cached, null if not.
 */
export function getNegativeCache(key: string): string | null {
  const entry = negativeCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    negativeCache.delete(key);
    return null;
  }
  return entry.error;
}

// Cleanup negative cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of negativeCache) {
    if (now > entry.expiresAt) negativeCache.delete(key);
  }
}, 30_000).unref();

// ─── Smart Cache Result ──────────────────────────────────────────────────────

export interface SmartCacheResult<T> {
  value: T;
  fresh: boolean;
  stale: boolean;
  contentHash: string;
  previousHash?: string;
  previousValue?: T;
  cachedAt: number;
}

export type CacheFreshness = 'prefer' | 'fresh' | 'smart';

// ─── Smart Cache Get ─────────────────────────────────────────────────────────

export async function smartCacheGet<T>(
  key: string,
  freshness: CacheFreshness = 'smart',
  endpointId?: string,
  creditCost?: number,
): Promise<SmartCacheResult<T> | null> {
  // Cache hits save 90% of the live credit cost (user pays 10% via cacheCreditCost)
  const savings = creditCost ? Math.round(creditCost * 0.9 * 1_000_000) / 1_000_000 : 0;

  if (freshness === 'fresh') {
    if (endpointId) {
      recordCacheAccess({ cacheKey: key, endpointId, hit: false, staleServed: false, creditsSaved: 0 });
    }
    return null;
  }

  const memEntry = getMemCache().getEntry<T>(key);
  if (memEntry) {
    if (endpointId) {
      recordCacheAccess({
        cacheKey: key, endpointId, hit: memEntry.fresh, staleServed: memEntry.stale,
        creditsSaved: (memEntry.fresh || memEntry.stale) ? savings : 0,
      });
    }
    if (freshness === 'prefer') return memEntry;
    return memEntry;
  }

  if (redisClient) {
    try {
      const isGzipped = await redisClient.get(`${key}:gz`);
      let val: string | null;
      if (isGzipped) {
        const compressed = await redisClient.getBuffer(key);
        if (compressed) {
          const decompressed = await gunzip(compressed);
          val = decompressed.toString();
        } else {
          val = null;
        }
      } else {
        val = await redisClient.get(key);
      }
      const meta = await redisClient.get(`${key}:meta`);
      if (val) {
        const parsed = JSON.parse(val) as T;
        const metaParsed = meta ? JSON.parse(meta) as { contentHash: string; cachedAt: number; previousHash?: string } : null;
        const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? '300');

        getMemCache().set(key, parsed, ttl, { endpointId });

        if (endpointId) {
          recordCacheAccess({ cacheKey: key, endpointId, hit: true, staleServed: false, creditsSaved: savings });
        }

        return {
          value: parsed,
          fresh: true,
          stale: false,
          contentHash: metaParsed?.contentHash ?? contentHash(parsed),
          previousHash: metaParsed?.previousHash,
          cachedAt: metaParsed?.cachedAt ?? Date.now(),
        };
      }
    } catch (err) {
      logger.warn({ err }, 'Redis get failed');
    }
  }

  if (endpointId) {
    recordCacheAccess({ cacheKey: key, endpointId, hit: false, staleServed: false, creditsSaved: 0 });
  }

  return null;
}

// ─── Legacy Cache Get ────────────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
  const mem = getMemCache().get<T>(key);
  if (mem !== null) return mem;
  if (redisClient) {
    try {
      const isGzipped = await redisClient.get(`${key}:gz`);
      let val: string | null;
      if (isGzipped) {
        const compressed = await redisClient.getBuffer(key);
        if (compressed) {
          const decompressed = await gunzip(compressed);
          val = decompressed.toString();
        } else {
          val = null;
        }
      } else {
        val = await redisClient.get(key);
      }
      if (val) {
        const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? '300');
        const parsed = JSON.parse(val) as T;
        getMemCache().set(key, parsed, ttl);
        return parsed;
      }
    } catch (err) {
      logger.warn({ err }, 'Redis get failed');
    }
  }
  return null;
}

// ─── Smart Cache Set ─────────────────────────────────────────────────────────

export async function smartCacheSet<T>(
  key: string,
  value: T,
  ttlSeconds?: number,
  endpointId?: string,
  creditCost?: number,
): Promise<{ contentChanged: boolean; previousHash?: string; previousValue?: T }> {
  const baseTtl = ttlSeconds ?? parseInt(process.env.CACHE_TTL_SECONDS ?? '300');
  const ttl = endpointId ? getAdaptiveTtl(endpointId, baseTtl) : baseTtl;
  const newHash = contentHash(value);

  const previous = getMemCache().getRaw<T>(key);
  const prevHash = previous?.contentHash;
  const prevValue = previous?.value;
  const changed = prevHash != null && prevHash !== newHash;

  if (endpointId) {
    recordVolatilityCheck(endpointId, key, changed, newHash);
  }

  getMemCache().set(key, value, ttl, {
    previousValue: changed ? prevValue : undefined,
    previousHash: prevHash,
    endpointId,
    creditCost,
  });

  if (redisClient) {
    try {
      const jsonStr = JSON.stringify(value);
      if (jsonStr.length > COMPRESSION_THRESHOLD_BYTES) {
        const compressed = await gzip(Buffer.from(jsonStr));
        await redisClient.set(key, compressed, 'EX', ttl * STALE_MULTIPLIER);
        await redisClient.set(`${key}:gz`, '1', 'EX', ttl * STALE_MULTIPLIER);
      } else {
        await redisClient.set(key, jsonStr, 'EX', ttl * STALE_MULTIPLIER);
      }
      await redisClient.set(`${key}:meta`, JSON.stringify({
        contentHash: newHash,
        cachedAt: Date.now(),
        previousHash: prevHash,
        endpointId,
      }), 'EX', ttl * STALE_MULTIPLIER);
    } catch (err) {
      logger.warn({ err }, 'Redis set failed');
    }
  }

  return { contentChanged: changed, previousHash: prevHash, previousValue: changed ? prevValue : undefined };
}

// ─── Legacy Cache Set ────────────────────────────────────────────────────────

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  await smartCacheSet(key, value, ttlSeconds);
}

// ─── Multi-Layer Invalidation ────────────────────────────────────────────────
// Cascade delete across L1 (memory), L2 (Redis), and L3 (agent context SQLite).

/**
 * Invalidate a specific cache key across all layers.
 */
export async function invalidateKey(key: string): Promise<void> {
  // Grab entry metadata before deleting (need endpointId for L3)
  const entry = getMemCache().getRaw(key);

  // L1: Memory
  getMemCache().delete(key);

  // L2: Redis
  if (redisClient) {
    try {
      await redisClient.del(key, `${key}:meta`, `${key}:gz`);
    } catch (err) {
      logger.warn({ err }, 'Redis invalidation failed');
    }
  }

  // L3: Agent context — clear matching entries across all agents by endpoint
  if (entry?.endpointId) {
    try {
      const { clearAgentContextByEndpoint } = await import('../db/contexts');
      const cleared = clearAgentContextByEndpoint(entry.endpointId);
      if (cleared > 0) {
        logger.debug({ key, endpointId: entry.endpointId, cleared }, 'L3 agent context invalidated');
      }
    } catch {
      // agent_contexts table may not exist yet — safe to ignore
    }
  }

  logger.debug({ key }, 'Cache key invalidated (L1+L2+L3)');
}

/**
 * Invalidate all cache entries for a given endpoint (tag invalidation).
 * Clears L1 by endpoint tag, L2 by scanning (if Redis available).
 */
export async function invalidateByEndpoint(endpointId: string): Promise<number> {
  // L1: Memory — delete by endpoint tag
  const count = getMemCache().deleteByEndpoint(endpointId);

  // L2: Redis — we can't efficiently scan by endpoint in Redis without a secondary index
  // But the L1 entries will expire naturally. For critical invalidation, the memory layer
  // is the primary cache for hot data anyway.

  logger.info({ endpointId, entriesInvalidated: count }, 'Cache invalidated by endpoint');
  return count;
}

// ─── Delta/Diff ──────────────────────────────────────────────────────────────

export interface DiffResult {
  changed: Record<string, { from: unknown; to: unknown }>;
  added: Record<string, unknown>;
  removed: string[];
}

export function computeDiff(previous: unknown, current: unknown): DiffResult | null {
  if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') {
    return null;
  }

  const prev = previous as Record<string, unknown>;
  const curr = current as Record<string, unknown>;
  const diff: DiffResult = { changed: {}, added: {}, removed: [] };

  for (const key of Object.keys(curr)) {
    if (!(key in prev)) {
      diff.added[key] = curr[key];
    } else if (JSON.stringify(prev[key]) !== JSON.stringify(curr[key])) {
      diff.changed[key] = { from: prev[key], to: curr[key] };
    }
  }

  for (const key of Object.keys(prev)) {
    if (!(key in curr)) {
      diff.removed.push(key);
    }
  }

  if (Object.keys(diff.changed).length === 0 && Object.keys(diff.added).length === 0 && diff.removed.length === 0) {
    return null;
  }

  return diff;
}

// ─── SWR Background Refresh Queue ────────────────────────────────────────────

type RefreshFn = () => Promise<unknown>;

interface PendingRefresh {
  key: string;
  refreshFn: RefreshFn;
  ttl: number;
}

const refreshQueue: PendingRefresh[] = [];
let refreshRunning = 0;

export function enqueueRefresh(key: string, refreshFn: RefreshFn, ttl: number): void {
  if (refreshQueue.some(r => r.key === key)) return;
  if (refreshQueue.length >= 100) return;

  refreshQueue.push({ key, refreshFn, ttl });
  drainRefreshQueue();
}

async function drainRefreshQueue(): Promise<void> {
  while (refreshQueue.length > 0 && refreshRunning < MAX_BACKGROUND_REFRESHES) {
    const item = refreshQueue.shift();
    if (!item) break;

    refreshRunning++;
    item.refreshFn()
      .then(async (data) => {
        if (data != null) {
          await smartCacheSet(item.key, data, item.ttl);
          logger.debug({ key: item.key }, 'SWR background refresh complete');
        }
      })
      .catch((err) => {
        logger.warn({ key: item.key, err }, 'SWR background refresh failed');
      })
      .finally(() => {
        refreshRunning--;
        drainRefreshQueue();
      });
  }
}

// ─── Startup Preloading ──────────────────────────────────────────────────────

/**
 * Pre-warm the cache with the most popular queries from the access log.
 * Called once on server startup to eliminate cold-start penalty after deploys.
 * Uses the warming module's hot key data — doesn't make upstream calls,
 * just ensures L1 is warm from L2 Redis data if available.
 */
export async function preloadCache(): Promise<number> {
  if (!redisClient) {
    logger.info('Cache preload skipped — no Redis connection');
    return 0;
  }

  try {
    const { getHotKeys } = await import('./warming');
    const hotKeys = getHotKeys(3, 24); // Keys accessed 3+ times in last 24h
    let loaded = 0;

    for (const hotKey of hotKeys.slice(0, 50)) {
      try {
        const val = await redisClient.get(hotKey.cacheKey);
        if (val) {
          const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? '300');
          const parsed = JSON.parse(val);
          getMemCache().set(hotKey.cacheKey, parsed, ttl, { endpointId: hotKey.endpointId });
          loaded++;
        }
      } catch {
        // Skip individual failures
      }
    }

    logger.info({ loaded, candidates: hotKeys.length }, 'Cache preloaded from Redis');
    return loaded;
  } catch (err) {
    logger.warn({ err }, 'Cache preload failed');
    return 0;
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function cacheStats() {
  return {
    memory: getMemCache().stats(),
    redisConnected: redisClient?.status === 'ready',
    pendingRefreshes: refreshQueue.length,
    activeRefreshes: refreshRunning,
    coalescedRequests: getCoalescedCount(),
    negativeCacheSize: negativeCache.size,
  };
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    setCircuitRedis(null);
    await redisClient.quit();
  }
}

// ─── Atomic Increment (rate limiting) ────────────────────────────────────────

const incrStore = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of incrStore) {
    if (now > entry.resetAt) incrStore.delete(key);
  }
}, 60_000).unref();

export async function cacheIncr(key: string, ttlSeconds: number): Promise<number> {
  if (redisClient) {
    try {
      const results = await redisClient.multi()
        .incr(key)
        .expire(key, ttlSeconds)
        .exec();
      const incrResult = results?.[0];
      if (Array.isArray(incrResult) && typeof incrResult[1] === 'number') return incrResult[1];
      return 1;
    } catch (err) {
      logger.warn({ err }, 'Redis incr failed, falling back to memory');
    }
  }
  const now = Date.now();
  const entry = incrStore.get(key);
  if (!entry || now > entry.resetAt) {
    incrStore.set(key, { count: 1, resetAt: now + ttlSeconds * 1000 });
    return 1;
  }
  entry.count++;
  return entry.count;
}
