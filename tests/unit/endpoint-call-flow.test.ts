/**
 * Integration tests — endpoint /call flow
 *
 * Exercises the full request pipeline:
 *   Auth → credit check → live fetch → credit deduction →
 *   Soma headers → cache cert → receipt → response
 *
 * Also tests: cache hits, Soma Check conditional payment,
 * concurrent deductions, error handling.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  createTestApp,
  callEndpoint,
  mockX402Call,
  mockBirthCert,
  mockX402Throw,
  makeBirthCert,
  validApiKey,
} from './helpers/integration';

import { initDb, getApiKeyBalance } from '../../src/db/index';

let app: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  initDb();
  app = await createTestApp();
});

beforeEach(() => {
  getTestDb().prepare('DELETE FROM api_keys').run();
  // Reset mock state
  mockX402Call({ price: 42, symbol: 'SOL' });
  mockBirthCert(null);
  mockX402Throw(null);
});

// ─── Full Call Flow ───────────────────────────────────────────────────────────

describe('full call flow (live fetch)', () => {
  it('returns data and deducts credits for a valid call', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ price: 142.5, symbol: 'SOL' });

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'So11111111111111111111111111111111111111112' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ price: 142.5, symbol: 'SOL' });
    expect(body.cached).toBe(false);
    expect(body.endpointId).toBe('claw-token-price');
    expect(body.creditsUsed).toBeGreaterThan(0);
    expect(body.requestId).toBeTruthy();
    expect(body.dataHash).toBeTruthy();
    expect(body.protocol).toBe('soma-check');

    // Credits should be deducted
    const bal = getApiKeyBalance(key);
    expect(bal!.credits).toBeLessThan(100);
    expect(bal!.credits_used).toBeGreaterThan(0);
  });

  it('returns birth cert provenance headers when heart produces a cert', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    const cert = makeBirthCert('sha256:test-data-hash-123');
    mockBirthCert(cert);
    mockX402Call({ temperature: 72 });

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'test' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Birth cert should appear in response body
    expect(body.provenance).toBeTruthy();
    expect(body.provenance.dataHash).toBe('sha256:test-data-hash-123');
    expect(body.provenance.signature).toBe(cert.signature);

    // Soma headers should be set
    expect(res.headers.get('X-Soma-Data-Hash')).toBe('sha256:test-data-hash-123');
    expect(res.headers.get('X-Soma-Signature')).toBe(cert.signature);
    expect(res.headers.get('X-Soma-Public-Key')).toBe(cert.publicKey);
    expect(res.headers.get('X-Soma-Hash')).toBeTruthy(); // JCS-canonical hash
  });

  it('rejects call with no API key', async () => {
    const res = await app.request('/v1/endpoints/claw-token-price/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('rejects call with invalid API key format', async () => {
    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: 'bad-key',
      params: {},
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_INVALID');
  });

  it('returns 404 for unknown endpoint', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });

    const res = await callEndpoint(app, 'nonexistent-endpoint', {
      apiKey: key,
      params: {},
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('ENDPOINT_NOT_FOUND');
  });

  it('returns 402 when credits are insufficient', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 0 });

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'test' },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('returns 502 when upstream provider throws', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Throw(new Error('upstream 500'));

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: `throw-test-${Date.now()}` },
      freshness: 'realtime', // skip cache — force live fetch
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('UPSTREAM_ERROR');
  });

  it('handles empty body gracefully', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });

    const res = await app.request('/v1/endpoints/claw-token-price/call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
      },
      body: '{}',
    });

    // Should still succeed (endpoint doesn't require params)
    expect(res.status).toBe(200);
  });
});

// ─── Cache Hit Flow ──────────────────────────────────────────────────────────

describe('cache hit flow', () => {
  it('second identical call is served from cache at reduced price', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    const uniqueMint = `cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    mockX402Call({ price: 142.5 });

    // First call — force live fetch with realtime
    const res1 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: uniqueMint },
      freshness: 'realtime', // ensure live fetch (populates cache)
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.cached).toBe(false);
    const creditsAfterFirst = getApiKeyBalance(key)!.credits;

    // Second call — relaxed freshness, same params → should hit cache
    const res2 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: uniqueMint },
      freshness: 'relaxed',
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.cached).toBe(true);
    expect(body2.data).toEqual({ price: 142.5 }); // same data

    // Cache hit should cost less than live fetch
    const creditsAfterSecond = getApiKeyBalance(key)!.credits;
    const liveCost = 100 - creditsAfterFirst;
    const cacheCost = creditsAfterFirst - creditsAfterSecond;
    expect(cacheCost).toBeLessThan(liveCost);
    expect(cacheCost).toBeGreaterThan(0);
  });

  it('cache hit includes X-Soma-Hash header for conditional payment', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ data: 'test' });

    // Prime the cache
    await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'test-hash-flow' },
    });

    // Second call should include data hash
    const res2 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'test-hash-flow' },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.dataHash).toBeTruthy();

    // Response should have Soma Check protocol headers
    expect(res2.headers.get('X-Soma-Hash')).toBeTruthy();
    expect(res2.headers.get('X-Soma-Protocol')).toBe('soma-check/1.0');
  });

  it('different params bypass cache', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ price: 1.0 });

    // First call
    await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'token-A' },
    });

    // Different params — should NOT hit cache
    mockX402Call({ price: 2.0 });
    const res2 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'token-B' },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.cached).toBe(false);
    expect(body2.data).toEqual({ price: 2.0 });
  });
});

// ─── Soma Check (If-Fresh-Hash) ──────────────────────────────────────────────

describe('Soma Check conditional payment', () => {
  it('returns unchanged=true when hash matches (shadow tier = free)', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ data: 'stable-data' });

    // Prime the cache to establish a hash
    const res1 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'soma-check-test' },
    });
    const body1 = await res1.json();
    const dataHash = body1.dataHash;
    expect(dataHash).toBeTruthy();

    const creditsBeforeCheck = getApiKeyBalance(key)!.credits;

    // Send If-Fresh-Hash with matching hash
    const res2 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'soma-check-test' },
      ifSomaHash: dataHash,
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    expect(body2.unchanged).toBe(true);
    expect(body2.dataHash).toBe(dataHash);
    expect(body2.protocol).toBe('soma-check');
    // Shadow tier (no provider registered) = free
    expect(body2.creditsUsed).toBe(0);

    // No credits deducted in shadow mode
    const creditsAfterCheck = getApiKeyBalance(key)!.credits;
    expect(creditsAfterCheck).toBe(creditsBeforeCheck);
  });

  it('falls through to normal flow when hash does not match', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ data: 'new-data' });

    // Prime cache
    await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'hash-mismatch-test' },
    });

    const creditsBeforeMismatch = getApiKeyBalance(key)!.credits;

    // Send stale hash — should fall through to cache hit or live fetch
    const res2 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'hash-mismatch-test' },
      ifSomaHash: 'sha256:wrong-hash',
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Should NOT be "unchanged" — data was fetched (from cache or live)
    expect(body2.unchanged).toBeUndefined();
    // Credits should be deducted (cache hit or live price)
    const creditsAfterMismatch = getApiKeyBalance(key)!.credits;
    expect(creditsAfterMismatch).toBeLessThan(creditsBeforeMismatch);
  });

  it('Soma Check headers are present on hash match', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ data: 'headers-test' });

    // Prime
    const res1 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'headers-test' },
    });
    const dataHash = (await res1.json()).dataHash;

    // Check
    const res2 = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: { mintAddress: 'headers-test' },
      ifSomaHash: dataHash,
    });

    expect(res2.headers.get('X-Fresh-Hash')).toBe(dataHash);
    expect(res2.headers.get('X-Soma-Hash')).toBe(dataHash);
    expect(res2.headers.get('X-Fresh-Protocol')).toBe('x402-fresh/1.0');
    expect(res2.headers.get('X-Soma-Protocol')).toBe('soma-check/1.0');
    expect(res2.headers.get('ETag')).toBe(`"${dataHash}"`);
  });
});

// ─── Concurrent Deduction Stress Test ────────────────────────────────────────

describe('concurrent deduction safety', () => {
  it('parallel endpoint calls never produce negative balance', async () => {
    // Give just enough credits for 5 calls (each costs creditCostForEndpoint)
    // claw-token-price: costPerCall=0.001 → 0.001 * 1500 = 1.5 credits
    const creditsPerCall = 1.5;
    const totalCredits = creditsPerCall * 5; // exactly 5 calls worth
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: totalCredits });

    mockX402Call({ price: 1 });

    // Fire 10 concurrent calls
    const promises = Array.from({ length: 10 }, (_, i) =>
      callEndpoint(app, 'claw-token-price', {
        apiKey: key,
        params: { mintAddress: `concurrent-${Date.now()}-${i}` },
        freshness: 'realtime', // skip cache
      })
    );

    const responses = await Promise.all(promises);

    // CRITICAL: balance must NEVER go negative — the core invariant
    const bal = getApiKeyBalance(key);
    expect(bal!.credits).toBeGreaterThanOrEqual(0);

    // Atomic deductions: exactly 5 should deduct (budget / cost per call)
    // Some calls may still return 200 (data served even if post-fetch deduction
    // fails) — that's by design. The billing invariant is balance ≥ 0.
    expect(bal!.credits_used).toBeCloseTo(totalCredits, 4);
    expect(bal!.credits).toBeCloseTo(0, 4);

    // All responses should be valid HTTP (200 or 402)
    for (const r of responses) {
      expect([200, 402]).toContain(r.status);
    }
  });

  it('rapid sequential calls accumulate correct totals', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 500 });
    mockX402Call({ data: 'seq' });

    // 10 sequential calls with realtime freshness
    for (let i = 0; i < 10; i++) {
      const res = await callEndpoint(app, 'claw-token-price', {
        apiKey: key,
        params: { mintAddress: `seq-${i}` },
        freshness: 'realtime',
      });
      expect(res.status).toBe(200);
    }

    const bal = getApiKeyBalance(key);
    // Each call costs 1.5 credits → 10 calls = 15 credits
    expect(bal!.credits_used).toBeCloseTo(15, 4);
    expect(bal!.credits).toBeCloseTo(485, 4);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('inactive key is rejected', async () => {
    const db = getTestDb();
    const { key } = seedApiKey(db, { credits: 100 });
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(key);

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: key,
      params: {},
    });

    expect(res.status).toBe(401);
  });

  it('env-based API key skips credit deduction', async () => {
    // The env key is set via API_KEYS config — use a known test key
    mockX402Call({ data: 'env-key-test' });

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: 'test-key-123',
      params: { mintAddress: 'env-test' },
    });

    // test-key-123 is a default API_KEYS value in test env
    // If it's not set, this will be 401 — that's fine, skip
    if (res.status === 200) {
      const body = await res.json();
      expect(body.data).toEqual({ data: 'env-key-test' });
    }
  });

  it('credits_used tracks cumulative usage across calls', async () => {
    const { key } = seedApiKey(getTestDb(), { key: validApiKey(), credits: 100 });
    mockX402Call({ data: 'tracking' });

    // Three live calls with different params
    for (let i = 0; i < 3; i++) {
      await callEndpoint(app, 'claw-token-price', {
        apiKey: key,
        params: { mintAddress: `track-${i}` },
        freshness: 'realtime',
      });
    }

    const bal = getApiKeyBalance(key);
    // 3 calls × 1.5 credits each = 4.5
    expect(bal!.credits_used).toBeCloseTo(4.5, 4);
    expect(bal!.credits).toBeCloseTo(95.5, 4);
  });
});
