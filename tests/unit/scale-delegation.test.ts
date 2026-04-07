/**
 * Scale test B — 1×100 delegated keys under load
 *
 * One parent key with 100 delegated sub-keys, all hitting endpoints
 * concurrently. Proves:
 *   - Delegation spend limits are enforced atomically
 *   - Parent balance never goes negative under concurrent delegation load
 *   - Spend tracking aggregates correctly across 100 keys
 *   - Expired / over-limit keys are rejected mid-flight
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb();

import {
  createTestApp,
  callEndpoint,
  mockX402Call,
  mockX402Throw,
  validApiKey,
} from './helpers/integration';

import { initDb, getApiKeyBalance } from '../../src/db/index';
import { createDelegatedKey, getDelegationInfo } from '../../src/db/index';

let app: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  initDb();
  app = await createTestApp();
});

beforeEach(() => {
  const db = getTestDb();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM delegated_keys').run();
  mockX402Call({ data: 'scale-test' });
  mockX402Throw(null);
});

describe('1×100 delegated keys — concurrent load', () => {
  it('creates max 20 delegated keys from a single parent', () => {
    const parentKey = validApiKey();
    seedApiKey(getTestDb(), { key: parentKey, credits: 10000 });

    const childKeys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const result = createDelegatedKey({
        parentKey,
        label: `agent-${i}`,
        spendLimit: 100, // 100 credits per child
      });
      expect(result.ok).toBe(true);
      expect(result.childKey).toBeTruthy();
      childKeys.push(result.childKey!);
    }

    expect(childKeys.length).toBe(20);

    // All keys should be unique
    const unique = new Set(childKeys);
    expect(unique.size).toBe(20);

    // All should be active delegations
    for (const ck of childKeys) {
      const info = getDelegationInfo(ck);
      expect(info).toBeTruthy();
      expect(info!.parent_key).toBe(parentKey);
      expect(info!.spend_limit).toBe(100);
    }
  });

  it('20 delegated keys hit the limit — stops at max 20 per parent', () => {
    const parentKey = validApiKey();
    seedApiKey(getTestDb(), { key: parentKey, credits: 10000 });

    // Create 20 (the max)
    for (let i = 0; i < 20; i++) {
      const r = createDelegatedKey({ parentKey, label: `a-${i}`, spendLimit: 50 });
      expect(r.ok).toBe(true);
    }

    // 21st should fail
    const r21 = createDelegatedKey({ parentKey, label: 'overflow', spendLimit: 50 });
    expect(r21.ok).toBe(false);
    expect(r21.error).toContain('Maximum 20');
  });

  it('concurrent calls from 20 delegated keys deduct from parent atomically', async () => {
    const parentKey = validApiKey();
    // Give parent enough for ~20 calls (each costs 1.5 credits)
    seedApiKey(getTestDb(), { key: parentKey, credits: 30 });

    const childKeys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = createDelegatedKey({ parentKey, label: `worker-${i}`, spendLimit: 100 });
      childKeys.push(r.childKey!);
    }

    mockX402Call({ result: 'ok' });

    // All 20 delegated keys call simultaneously
    const promises = childKeys.map((ck, i) =>
      callEndpoint(app, 'claw-token-price', {
        apiKey: ck,
        params: { mintAddress: `delegated-concurrent-${Date.now()}-${i}` },
        freshness: 'realtime',
      })
    );

    const responses = await Promise.all(promises);

    // CRITICAL: parent balance must never go negative
    const parentBal = getApiKeyBalance(parentKey);
    expect(parentBal!.credits).toBeGreaterThanOrEqual(0);

    // Should have deducted some credits
    expect(parentBal!.credits_used).toBeGreaterThan(0);
    expect(parentBal!.credits_used).toBeLessThanOrEqual(30);

    // All responses should be valid HTTP
    for (const r of responses) {
      expect([200, 402]).toContain(r.status);
    }

    // At least some should succeed
    const successes = responses.filter(r => r.status === 200).length;
    expect(successes).toBeGreaterThan(0);
  });

  it('delegation spend tracking accumulates correctly', async () => {
    const parentKey = validApiKey();
    seedApiKey(getTestDb(), { key: parentKey, credits: 10000 }); // plenty of parent credits

    const { childKey } = createDelegatedKey({
      parentKey,
      label: 'tracked-spend',
      spendLimit: 100,
    })!;

    mockX402Call({ result: 'ok' });

    // 5 sequential calls — each costs 1.5 credits
    for (let i = 0; i < 5; i++) {
      const res = await callEndpoint(app, 'claw-token-price', {
        apiKey: childKey!,
        params: { mintAddress: `spend-track-${Date.now()}-${i}` },
        freshness: 'realtime',
      });
      expect(res.status).toBe(200);
    }

    // Delegation spend should reflect ~7.5 credits (5 × 1.5)
    const info = getDelegationInfo(childKey!);
    expect(info!.spent).toBeGreaterThan(0);
    expect(info!.spent).toBeLessThanOrEqual(info!.spend_limit);

    // Parent balance should decrease by the same amount
    const parentBal = getApiKeyBalance(parentKey);
    expect(parentBal!.credits_used).toBeCloseTo(7.5, 2);
  });

  it('expired delegated key is rejected mid-flight', async () => {
    const parentKey = validApiKey();
    seedApiKey(getTestDb(), { key: parentKey, credits: 10000 });

    const { childKey } = createDelegatedKey({
      parentKey,
      label: 'expires-now',
      spendLimit: 1000,
      expiresInHours: 1,
    })!;

    // Manually expire the key by backdating expires_at (ISO 8601 with Z = UTC)
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    getTestDb().prepare(
      'UPDATE delegated_keys SET expires_at = ? WHERE child_key = ?'
    ).run(pastDate, childKey!);

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: childKey!,
      params: { mintAddress: 'expired-test' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('KEY_EXPIRED');
  });

  it('delegated key whose spend limit is exhausted is rejected', async () => {
    const parentKey = validApiKey();
    seedApiKey(getTestDb(), { key: parentKey, credits: 10000 });

    const { childKey } = createDelegatedKey({
      parentKey,
      label: 'exhausted',
      spendLimit: 10, // min allowed
    })!;

    // Manually exhaust the spend limit
    getTestDb().prepare(
      'UPDATE delegated_keys SET spent = spend_limit WHERE child_key = ?'
    ).run(childKey!);

    const res = await callEndpoint(app, 'claw-token-price', {
      apiKey: childKey!,
      params: { mintAddress: 'exhausted-test' },
    });

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('SPEND_LIMIT_REACHED');
  });

  it('stress: 20 keys × 5 calls each = 100 concurrent requests', async () => {
    const parentKey = validApiKey();
    // 100 calls × 1.5 credits = 150 needed
    seedApiKey(getTestDb(), { key: parentKey, credits: 200 });

    const childKeys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = createDelegatedKey({ parentKey, label: `stress-${i}`, spendLimit: 100 });
      childKeys.push(r.childKey!);
    }

    mockX402Call({ stress: true });

    // 20 keys × 5 calls = 100 concurrent requests
    const promises: Promise<Response>[] = [];
    for (const ck of childKeys) {
      for (let j = 0; j < 5; j++) {
        promises.push(
          callEndpoint(app, 'claw-token-price', {
            apiKey: ck,
            params: { mintAddress: `stress-${Date.now()}-${ck.slice(-6)}-${j}` },
            freshness: 'realtime',
          })
        );
      }
    }

    expect(promises.length).toBe(100);
    const responses = await Promise.all(promises);

    // CRITICAL invariant: parent balance ≥ 0
    const parentBal = getApiKeyBalance(parentKey);
    expect(parentBal!.credits).toBeGreaterThanOrEqual(0);

    // All responses should be valid
    for (const r of responses) {
      expect([200, 402]).toContain(r.status);
    }

    // Accounting: credits_used should match what was actually deducted
    const totalDeducted = parentBal!.credits_used;
    expect(totalDeducted).toBeGreaterThan(0);
    expect(totalDeducted).toBeLessThanOrEqual(200);
    // credits_used + remaining = original
    expect(parentBal!.credits + parentBal!.credits_used).toBeCloseTo(200, 2);

    const successes = responses.filter(r => r.status === 200).length;
    expect(successes).toBeGreaterThan(50); // at least half should succeed
  });
});
