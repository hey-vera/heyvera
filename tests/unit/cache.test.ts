import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cacheGet,
  cacheKey,
  cacheSet,
  cacheStats,
} from '../../src/cache/index';

describe('cache/index current minimal behavior', () => {
  const originalTtl = process.env.CACHE_TTL_SECONDS;
  const originalMaxItems = process.env.CACHE_MAX_MEMORY_ITEMS;

  beforeEach(() => {
    process.env.CACHE_TTL_SECONDS = '1';
    process.env.CACHE_MAX_MEMORY_ITEMS = '100';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTtl === undefined) {
      delete process.env.CACHE_TTL_SECONDS;
    } else {
      process.env.CACHE_TTL_SECONDS = originalTtl;
    }
    if (originalMaxItems === undefined) {
      delete process.env.CACHE_MAX_MEMORY_ITEMS;
    } else {
      process.env.CACHE_MAX_MEMORY_ITEMS = originalMaxItems;
    }
  });

  it('cacheKey is stable across top-level parameter insertion order', () => {
    const a = cacheKey('claw-token-price', {
      mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      limit: 20,
    });
    const b = cacheKey('claw-token-price', {
      limit: 20,
      mintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    });

    expect(a).toBe(b);
    expect(a).toMatch(/^claw:[a-f0-9]{16}$/);
  });

  it('cacheKey includes endpoint id in the key material', () => {
    const params = { query: 'BONK' };
    expect(cacheKey('claw-news-search', params)).not.toBe(
      cacheKey('claw-reddit-sentiment', params),
    );
  });

  it('cacheSet and cacheGet round-trip JSON-compatible values', async () => {
    const key = `unit-cache:${crypto.randomUUID()}`;
    const value = {
      nested: { ok: true },
      items: ['sol', 'bonk'],
    };

    await cacheSet(key, value);

    await expect(cacheGet<typeof value>(key)).resolves.toEqual(value);
  });

  it('cacheGet returns null after TTL expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00.000Z'));
    const key = `unit-cache-expiry:${crypto.randomUUID()}`;

    await cacheSet(key, { status: 'fresh' });
    await expect(cacheGet<{ status: string }>(key)).resolves.toEqual({
      status: 'fresh',
    });

    vi.advanceTimersByTime(1_001);

    await expect(cacheGet<{ status: string }>(key)).resolves.toBeNull();
  });

  it('cacheStats exposes memory stats and Redis connection state', () => {
    const stats = cacheStats();

    expect(stats.redisConnected).toBe(false);
    expect(stats.memory).toEqual(
      expect.objectContaining({
        items: expect.any(Number),
        maxItems: expect.any(Number),
      }),
    );
  });
});
