import { logger } from '../utils/logger';
import crypto from 'crypto';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxItems: number;

  constructor(maxItems: number) {
    this.maxItems = maxItems;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    if (this.store.size >= this.maxItems) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  stats() {
    return { items: this.store.size, maxItems: this.maxItems };
  }
}

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
    redisClient = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redisClient.connect();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn({ err }, 'Redis connection failed, using memory-only cache');
    redisClient = null;
  }
}

export function cacheKey(endpointId: string, params: Record<string, unknown>): string {
  const normalized = JSON.stringify({ endpointId, params: Object.fromEntries(Object.entries(params).sort()) });
  return 'claw:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const mem = getMemCache().get<T>(key);
  if (mem !== null) return mem;
  if (redisClient) {
    try {
      const val = await redisClient.get(key);
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

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const ttl = parseInt(process.env.CACHE_TTL_SECONDS ?? '300');
  getMemCache().set(key, value, ttl);
  if (redisClient) {
    try {
      await redisClient.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      logger.warn({ err }, 'Redis set failed');
    }
  }
}

export function cacheStats() {
  return { memory: getMemCache().stats(), redisConnected: redisClient !== null };
}

export async function closeRedis(): Promise<void> {
  if (redisClient) await redisClient.quit();
}