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

import { initDb } from '../../src/db/connection';
import {
  createCacheCertificate,
  getCacheHashInfo,
} from '../../src/core/cache-certificate';
import { somaHash } from '../../src/utils/crypto-agility';
import { cacheKey } from '../../src/cache/index';

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
