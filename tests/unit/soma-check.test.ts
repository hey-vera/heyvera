/**
 * x402 Fresh (soma-check) protocol tests.
 *
 * The protocol is content-addressed conditional payment: agents send their
 * last-known data hash via `If-Fresh-Hash` / `If-Soma-Hash`. If it matches
 * the server's cached hash, the call is free. Otherwise it goes through the
 * normal paid path.
 *
 * These tests verify the load-bearing primitives:
 *   - cache key determinism (same params → same key, order-independent)
 *   - data hash determinism (same data → same hash, different data differs)
 *   - cache certificate round-trip (create → read back)
 *   - freshness transitions (TTL, stale serves hash for comparison)
 *   - the skip-charge decision clients will make
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { getDb, initDb } from '../../src/db/connection';
import {
  createCacheCertificate,
  getCacheHashInfo,
} from '../../src/core/cache-certificate';
import { somaHash, somaHashJson } from '../../src/utils/crypto-agility';
import { cacheKey } from '../../src/cache/index';
import { getProviderSomaCheckEarnings, logSomaCheckEvent } from '../../src/db/soma-check';
import { createProvider, registerProviderEndpoint } from '../../src/db/providers';

beforeAll(() => {
  initDb();
});

// ─── Cache key determinism ─────────────────────────────────────────────────

describe('soma-check — cacheKey determinism', () => {
  it('produces identical keys for identical params', () => {
    const k1 = cacheKey('btc-price', { symbol: 'BTC', currency: 'USD' });
    const k2 = cacheKey('btc-price', { symbol: 'BTC', currency: 'USD' });
    expect(k1).toBe(k2);
  });

  it('is order-independent: {a,b} === {b,a}', () => {
    const k1 = cacheKey('ep', { a: '1', b: '2' });
    const k2 = cacheKey('ep', { b: '2', a: '1' });
    expect(k1).toBe(k2);
  });

  it('differs when endpoint id differs', () => {
    const k1 = cacheKey('ep-a', { x: '1' });
    const k2 = cacheKey('ep-b', { x: '1' });
    expect(k1).not.toBe(k2);
  });

  it('differs when params differ', () => {
    const k1 = cacheKey('ep', { x: '1' });
    const k2 = cacheKey('ep', { x: '2' });
    expect(k1).not.toBe(k2);
  });
});

// ─── Data hash determinism ─────────────────────────────────────────────────

describe('soma-check — somaHash determinism', () => {
  it('identical data produces identical hash', () => {
    const data = JSON.stringify({ price: 100, ts: 123 });
    expect(somaHash(data)).toBe(somaHash(data));
  });

  it('single-bit change produces different hash', () => {
    const a = somaHash(JSON.stringify({ price: 100 }));
    const b = somaHash(JSON.stringify({ price: 101 }));
    expect(a).not.toBe(b);
  });

  it('returns 64-char hex for sha256', () => {
    const h = somaHash('anything');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Cache cert round-trip ─────────────────────────────────────────────────

describe('soma-check — cache certificate round-trip', () => {
  it('returns null for a key with no certificate', () => {
    const info = getCacheHashInfo('claw:nonexistent-key-12345');
    expect(info).toBeNull();
  });

  it('creates and reads back a cache certificate', () => {
    const key = cacheKey('test-ep-roundtrip', { foo: 'bar' });
    const dataHash = somaHash(JSON.stringify({ value: 42 }));
    const cert = createCacheCertificate({
      cacheKey: key,
      endpointId: 'test-ep-roundtrip',
      dataHash,
      ttlSeconds: 60,
    });
    expect(cert).not.toBeNull();
    expect(cert!.cacheCert.dataHash).toBe(dataHash);
    expect(cert!.chainHash).toBeDefined();
    expect(cert!.chainHash.length).toBeGreaterThan(0);

    const info = getCacheHashInfo(key);
    expect(info).not.toBeNull();
    expect(info!.dataHash).toBe(dataHash);
    expect(info!.fresh).toBe(true);
    expect(info!.endpointId).toBe('test-ep-roundtrip');
    expect(info!.age).toBeGreaterThanOrEqual(0);
  });

  it('marks cert as stale after TTL expires but still returns hash', () => {
    const key = cacheKey('test-ep-stale', { foo: 'stale' });
    const dataHash = somaHash(JSON.stringify({ value: 99 }));
    const cert = createCacheCertificate({
      cacheKey: key,
      endpointId: 'test-ep-stale',
      dataHash,
      ttlSeconds: -1, // already expired
    });
    expect(cert).not.toBeNull();

    const info = getCacheHashInfo(key);
    expect(info).not.toBeNull();
    expect(info!.fresh).toBe(false);
    // Stale hash is still returned — agents can still compare If-Fresh-Hash
    expect(info!.dataHash).toBe(dataHash);
  });

  it('creating two certs for same key → getCacheHashInfo returns one of them', () => {
    // Implementation detail: when two certs have identical cached_at
    // timestamps (same millisecond), SQLite's ORDER BY is non-deterministic.
    // The protocol contract is just "server returns its current hash" —
    // whichever cert gets picked, the agent compares their hash against it.
    const key = cacheKey('test-ep-two-certs', { q: 'two' });
    const hash1 = somaHash('v1');
    const hash2 = somaHash('v2');
    createCacheCertificate({
      cacheKey: key,
      endpointId: 'test-ep-two-certs',
      dataHash: hash1,
      ttlSeconds: 60,
    });
    createCacheCertificate({
      cacheKey: key,
      endpointId: 'test-ep-two-certs',
      dataHash: hash2,
      ttlSeconds: 60,
    });
    const info = getCacheHashInfo(key);
    expect(info).not.toBeNull();
    // The returned hash is whichever cert SQLite picks first. Both are valid.
    expect([hash1, hash2]).toContain(info!.dataHash);
  });
});

// ─── Skip-charge decision (protocol conformance) ───────────────────────────

describe('soma-check — skip-charge decision', () => {
  it('matching hash → shouldSkipCharge=true', () => {
    const key = cacheKey('skip-match', { req: '1' });
    const dataHash = somaHash(JSON.stringify({ current: 'data' }));
    createCacheCertificate({
      cacheKey: key,
      endpointId: 'skip-match',
      dataHash,
      ttlSeconds: 60,
    });

    // Agent presents their last-known hash; it matches the server cache.
    const agentHash = dataHash;
    const info = getCacheHashInfo(key);
    const shouldSkipCharge = info !== null && info.dataHash === agentHash;
    expect(shouldSkipCharge).toBe(true);
  });

  it('mismatched hash → shouldSkipCharge=false', () => {
    const key = cacheKey('skip-mismatch', { req: '1' });
    const serverHash = somaHash(JSON.stringify({ version: 2 }));
    createCacheCertificate({
      cacheKey: key,
      endpointId: 'skip-mismatch',
      dataHash: serverHash,
      ttlSeconds: 60,
    });

    // Agent's hash is from an older version.
    const agentHash = somaHash(JSON.stringify({ version: 1 }));
    const info = getCacheHashInfo(key);
    const shouldSkipCharge = info !== null && info.dataHash === agentHash;
    expect(shouldSkipCharge).toBe(false);
  });

  it('no cached cert → shouldSkipCharge=false (fetches normally)', () => {
    const info = getCacheHashInfo('claw:no-cert-for-this');
    const shouldSkipCharge = info !== null;
    expect(shouldSkipCharge).toBe(false);
  });

  it('stale cert with matching hash → still skip (data unchanged even if stale)', () => {
    const key = cacheKey('skip-stale-match', { req: '1' });
    const dataHash = somaHash('unchanged-content');
    createCacheCertificate({
      cacheKey: key,
      endpointId: 'skip-stale-match',
      dataHash,
      ttlSeconds: -1,
    });

    const info = getCacheHashInfo(key);
    expect(info).not.toBeNull();
    expect(info!.fresh).toBe(false);
    // Even stale, if hash matches the agent's, we KNOW the content is identical.
    const shouldSkipCharge = info!.dataHash === dataHash;
    expect(shouldSkipCharge).toBe(true);
  });
});

// ─── Hash stability under JCS canonicalization (RFC 8785) ──────────────────
//
// soma-check probes MUST produce identical hashes for semantically identical
// data regardless of how JSON was serialized upstream. If an upstream provider
// reshuffles object keys on a repeat fetch, the cache probe has to still hit.
// These tests lock down the invariants that the serving path + cache-warming
// cron + cache-certificate chain-hash all depend on.

describe('soma-check — somaHashJson stability (JCS)', () => {
  it('is key-order independent: {a,b} === {b,a}', () => {
    const h1 = somaHashJson({ a: 1, b: 2 });
    const h2 = somaHashJson({ b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('is deeply key-order independent for nested objects', () => {
    const h1 = somaHashJson({ x: { a: 1, b: 2 }, y: { c: 3, d: 4 } });
    const h2 = somaHashJson({ y: { d: 4, c: 3 }, x: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
  });

  it('preserves array order (arrays are NOT reordered)', () => {
    const h1 = somaHashJson([1, 2, 3]);
    const h2 = somaHashJson([3, 2, 1]);
    expect(h1).not.toBe(h2);
  });

  it('whitespace in source JSON does not affect hash', () => {
    // JCS strips all whitespace — these two parsings yield the same object,
    // so their canonical forms are identical.
    const a = JSON.parse('{"a":1,"b":2}');
    const b = JSON.parse('{\n  "a": 1,\n  "b": 2\n}');
    expect(somaHashJson(a)).toBe(somaHashJson(b));
  });

  it('different values produce different hashes', () => {
    const h1 = somaHashJson({ price: 100 });
    const h2 = somaHashJson({ price: 101 });
    expect(h1).not.toBe(h2);
  });

  it('returns a 64-char sha256 hex', () => {
    const h = somaHashJson({ anything: true });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles Unicode strings canonically', () => {
    // Same Unicode string via different JS literals → same hash.
    const h1 = somaHashJson({ name: 'caf\u00e9' }); // café
    const h2 = somaHashJson({ name: 'café' });
    expect(h1).toBe(h2);
  });

  it('number precision: integers and equivalent floats compare as JCS dictates', () => {
    // JCS normalizes numbers per RFC 7159 / ECMA-262 "number to string" —
    // JS Number.prototype.toString normalizes 100.0 → "100" so these match.
    const h1 = somaHashJson({ x: 100 });
    const h2 = somaHashJson({ x: 100.0 });
    expect(h1).toBe(h2);
  });

  it('null vs missing key differ', () => {
    const h1 = somaHashJson({ x: null });
    const h2 = somaHashJson({});
    expect(h1).not.toBe(h2);
  });

  it('matches the serving-path hash for the soma-check probe', () => {
    // This is the critical invariant: the hash computed at serving time
    // (endpoints.ts) MUST equal the hash computed by the cache-warm cron
    // MUST equal the hash clients receive. If providers reshuffle keys
    // between fetches, the probe still has to hit.
    const upstreamResponse1 = { price: 100, currency: 'USD', ts: 1700000000 };
    const upstreamResponse2 = { ts: 1700000000, currency: 'USD', price: 100 };
    expect(somaHashJson(upstreamResponse1)).toBe(somaHashJson(upstreamResponse2));
  });
});

// ─── Provider-scoped earnings ──────────────────────────────────────────────

describe('soma-check — getProviderSomaCheckEarnings', () => {
  it('empty provider returns zero totals', () => {
    const prov = createProvider({
      name: 'empty-provider',
      slug: 'empty-prov-' + Date.now(),
      email: 'empty@example.com',
    });
    const earnings = getProviderSomaCheckEarnings(prov.id, 'day');
    expect(earnings.totals.totalCalls).toBe(0);
    expect(earnings.totals.cacheHits).toBe(0);
    expect(earnings.earnings.totalCreditsEarned).toBe(0);
    expect(earnings.endpoints).toEqual([]);
    expect(earnings.tier).toBe(1);
  });

  it('aggregates hits and misses scoped to a single provider', () => {
    const prov = createProvider({
      name: 'aggregate-provider',
      slug: 'agg-prov-' + Date.now(),
      email: 'agg@example.com',
    });
    const epA = 'test-agg-ep-a-' + Date.now();
    const epB = 'test-agg-ep-b-' + Date.now();
    registerProviderEndpoint(prov.id, epA);
    registerProviderEndpoint(prov.id, epB);

    // ep-a: 3 live calls @ 10 credits, 2 cache hits @ 1 credit hit price
    logSomaCheckEvent({ endpointId: epA, hash: 'h1', wouldHaveHit: false, wasHit: false, originPriceCredits: 10, shadowMode: false, tier: 1 });
    logSomaCheckEvent({ endpointId: epA, hash: 'h2', wouldHaveHit: false, wasHit: false, originPriceCredits: 10, shadowMode: false, tier: 1 });
    logSomaCheckEvent({ endpointId: epA, hash: 'h3', wouldHaveHit: false, wasHit: false, originPriceCredits: 10, shadowMode: false, tier: 1 });
    logSomaCheckEvent({ endpointId: epA, hash: 'h4', wouldHaveHit: true, wasHit: true, originPriceCredits: 10, hitPriceCredits: 1, shadowMode: false, tier: 1 });
    logSomaCheckEvent({ endpointId: epA, hash: 'h5', wouldHaveHit: true, wasHit: true, originPriceCredits: 10, hitPriceCredits: 1, shadowMode: false, tier: 1 });

    // ep-b: 1 live call @ 20 credits, 1 cache hit @ 2 credits hit price
    logSomaCheckEvent({ endpointId: epB, hash: 'i1', wouldHaveHit: false, wasHit: false, originPriceCredits: 20, shadowMode: false, tier: 1 });
    logSomaCheckEvent({ endpointId: epB, hash: 'i2', wouldHaveHit: true, wasHit: true, originPriceCredits: 20, hitPriceCredits: 2, shadowMode: false, tier: 1 });

    // A foreign event on an unrelated endpoint must NOT count.
    logSomaCheckEvent({ endpointId: 'someone-elses-ep', hash: 'x1', wouldHaveHit: true, wasHit: true, originPriceCredits: 999, hitPriceCredits: 99, shadowMode: false, tier: 1 });

    const earnings = getProviderSomaCheckEarnings(prov.id, 'day');
    expect(earnings.totals.totalCalls).toBe(7);
    expect(earnings.totals.liveCalls).toBe(4);
    expect(earnings.totals.cacheHits).toBe(3);
    expect(earnings.endpoints).toHaveLength(2);

    // Live share: (3*10 + 1*20) * 0.90 = 50 * 0.90 = 45
    expect(earnings.earnings.liveCreditsEarned).toBeCloseTo(45, 4);
    // Cache share at Tier 0 (default since we didn't touch tier): (2*1 + 1*2) * 0.90 = 4 * 0.90 = 3.6
    expect(earnings.earnings.cacheCreditsEarned).toBeCloseTo(3.6, 4);
    expect(earnings.earnings.totalCreditsEarned).toBeCloseTo(48.6, 4);

    // Agent savings: 2 hits on ep-a saved (10-1)*2 = 18, 1 hit on ep-b saved (20-2)*1 = 18, total 36
    expect(earnings.savings.agentCreditsSaved).toBeCloseTo(36, 4);
  });

  it('shadow-mode rows feed projectedCacheCreditsIfActive', () => {
    const prov = createProvider({
      name: 'shadow-provider',
      slug: 'shadow-prov-' + Date.now(),
      email: 'shadow@example.com',
    });
    const ep = 'test-shadow-ep-' + Date.now();
    registerProviderEndpoint(prov.id, ep);

    // Shadow mode: would_have_hit=1 but was_hit=0 (no billing happened)
    logSomaCheckEvent({ endpointId: ep, hash: 's1', wouldHaveHit: true, wasHit: false, originPriceCredits: 10, shadowMode: true, tier: 0 });
    logSomaCheckEvent({ endpointId: ep, hash: 's2', wouldHaveHit: true, wasHit: false, originPriceCredits: 10, shadowMode: true, tier: 0 });
    logSomaCheckEvent({ endpointId: ep, hash: 's3', wouldHaveHit: false, wasHit: false, originPriceCredits: 10, shadowMode: true, tier: 0 });

    const earnings = getProviderSomaCheckEarnings(prov.id, 'day');
    // No actual hits yet
    expect(earnings.totals.cacheHits).toBe(0);
    expect(earnings.earnings.cacheCreditsEarned).toBe(0);
    // But the "what you'd earn if you flipped" figure is present
    // 2 wouldHaveHits * 10 * 0.10 hit-price * 0.90 share = 1.8
    expect(earnings.earnings.projectedCacheCreditsIfActive).toBeCloseTo(1.8, 4);
  });

  it('Tier 3 providers get 95% share instead of 90%', () => {
    const prov = createProvider({
      name: 'champion-provider',
      slug: 'champ-prov-' + Date.now(),
      email: 'champ@example.com',
    });
    getDb().prepare('UPDATE providers SET soma_check_tier = 3 WHERE id = ?').run(prov.id);

    const ep = 'test-champ-ep-' + Date.now();
    registerProviderEndpoint(prov.id, ep);
    logSomaCheckEvent({ endpointId: ep, hash: 'c1', wouldHaveHit: true, wasHit: true, originPriceCredits: 100, hitPriceCredits: 10, shadowMode: false, tier: 3 });

    const earnings = getProviderSomaCheckEarnings(prov.id, 'day');
    expect(earnings.tier).toBe(3);
    // 10 hit-price * 0.95 = 9.5
    expect(earnings.earnings.cacheCreditsEarned).toBeCloseTo(9.5, 4);
  });

  it('windowHours matches day|week|month', () => {
    const prov = createProvider({
      name: 'window-test-prov',
      slug: 'win-prov-' + Date.now(),
      email: 'w@example.com',
    });
    expect(getProviderSomaCheckEarnings(prov.id, 'day').windowHours).toBe(24);
    expect(getProviderSomaCheckEarnings(prov.id, 'week').windowHours).toBe(24 * 7);
    expect(getProviderSomaCheckEarnings(prov.id, 'month').windowHours).toBe(24 * 30);
  });
});
