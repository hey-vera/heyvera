/**
 * Unit tests — credit deduction & top-up
 *
 * Tests the core credit accounting functions:
 * - deductCredit never goes below zero
 * - topUpCredits applies correctly
 * - Atomic deduction (concurrent-safe via SQLite transactions)
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, getTestDb, seedApiKey } from './helpers/db';

setupTestDb(); // must be called before any src import

import { initDb, deductCredit, topUpCredits, getApiKeyBalance } from '../../src/db/index';

beforeAll(() => {
  initDb();
});

beforeEach(() => {
  // Clean api_keys between tests
  getTestDb().prepare('DELETE FROM api_keys').run();
});

describe('deductCredit', () => {
  it('deducts credits when balance is sufficient', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 500 });

    const ok = deductCredit(key, 100);

    expect(ok).toBe(true);
    const bal = getApiKeyBalance(key);
    expect(bal?.credits).toBe(400);
    expect(bal?.credits_used).toBe(100);
  });

  it('returns false and does NOT deduct when credits are insufficient', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 50 });

    const ok = deductCredit(key, 100);

    expect(ok).toBe(false);
    const bal = getApiKeyBalance(key);
    expect(bal?.credits).toBe(50); // unchanged
    expect(bal?.credits_used).toBe(0);
  });

  it('returns false for an unknown key', () => {
    const ok = deductCredit('cn-does-not-exist', 1);
    expect(ok).toBe(false);
  });

  it('returns false for an inactive key', () => {
    const db = getTestDb();
    const { key } = seedApiKey(db, { credits: 500 });
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(key);

    const ok = deductCredit(key, 1);
    expect(ok).toBe(false);
  });

  it('allows deducting exactly the full balance', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 10 });

    const ok = deductCredit(key, 10);

    expect(ok).toBe(true);
    expect(getApiKeyBalance(key)?.credits).toBe(0);
  });

  it('accumulates credits_used across multiple deductions', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    deductCredit(key, 10);
    deductCredit(key, 25);
    deductCredit(key, 5);

    const bal = getApiKeyBalance(key);
    expect(bal?.credits).toBe(60);
    expect(bal?.credits_used).toBe(40);
  });

  it('defaults to deducting 1 credit', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 100 });
    deductCredit(key);
    expect(getApiKeyBalance(key)?.credits).toBe(99);
  });
});

describe('topUpCredits', () => {
  it('adds credits to an existing key', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    topUpCredits(key, 500);

    expect(getApiKeyBalance(key)?.credits).toBe(600);
  });

  it('can top up a key with zero credits', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 0 });

    topUpCredits(key, 1000);

    expect(getApiKeyBalance(key)?.credits).toBe(1000);
  });
});

describe('credit atomicity', () => {
  it('simultaneous deductions never result in negative balance', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    // Fire 20 deductions of 10 credits synchronously (SQLite serialises them)
    const results = Array.from({ length: 20 }, () => deductCredit(key, 10));

    const successful = results.filter(Boolean).length;
    const bal = getApiKeyBalance(key);

    // Exactly 10 should succeed, balance must be exactly 0
    expect(successful).toBe(10);
    expect(bal?.credits).toBe(0);
    expect(bal?.credits_used).toBe(100);
  });
});
