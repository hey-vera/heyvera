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
import { round6, creditCostForEndpoint, creditsForExecution } from '../../src/core/credits';

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

describe('decimal credits', () => {
  it('deducts fractional credits correctly', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 10 });

    const ok = deductCredit(key, 0.75);

    expect(ok).toBe(true);
    const bal = getApiKeyBalance(key);
    expect(bal?.credits).toBeCloseTo(9.25, 6);
    expect(bal?.credits_used).toBeCloseTo(0.75, 6);
  });

  it('tops up fractional credits correctly', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 0 });

    topUpCredits(key, 0.15);

    expect(getApiKeyBalance(key)?.credits).toBeCloseTo(0.15, 6);
  });

  it('accumulates fractional deductions without drift', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 1 });

    // 10 deductions of 0.1 each = 1.0 total
    for (let i = 0; i < 10; i++) deductCredit(key, 0.1);

    const bal = getApiKeyBalance(key);
    expect(bal?.credits).toBeCloseTo(0, 6);
    expect(bal?.credits_used).toBeCloseTo(1, 6);
  });

  it('rejects fractional deduction that exceeds balance', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 0.5 });

    const ok = deductCredit(key, 0.75);

    expect(ok).toBe(false);
    expect(getApiKeyBalance(key)?.credits).toBeCloseTo(0.5, 6);
  });

  it('allows deducting zero credits (no-op)', () => {
    const { key } = seedApiKey(getTestDb(), { credits: 100 });

    const ok = deductCredit(key, 0);

    expect(ok).toBe(true);
    expect(getApiKeyBalance(key)?.credits).toBe(100);
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

describe('core credit functions (decimal)', () => {
  it('round6 prevents floating-point drift', () => {
    expect(round6(0.1 + 0.2)).toBe(0.3);
    expect(round6(1.0000001)).toBe(1);
    expect(round6(0.123456789)).toBe(0.123457);
  });

  it('creditCostForEndpoint returns fractional credits for cheap endpoints', () => {
    // $0.0001 endpoint × 1500 markup = 0.15 credits
    expect(creditCostForEndpoint({ costPerCall: 0.0001 })).toBe(0.15);
    // $0.0005 endpoint × 1500 markup = 0.75 credits
    expect(creditCostForEndpoint({ costPerCall: 0.0005 })).toBe(0.75);
    // $0.001 endpoint × 1500 markup = 1.5 credits
    expect(creditCostForEndpoint({ costPerCall: 0.001 })).toBe(1.5);
  });

  it('creditCostForEndpoint uses explicit creditCost when set', () => {
    expect(creditCostForEndpoint({ costPerCall: 0.01, creditCost: 5 })).toBe(5);
    expect(creditCostForEndpoint({ costPerCall: 0.01, creditCost: 0.5 })).toBe(0.5);
  });

  it('creditCostForEndpoint enforces minimum 0.001', () => {
    expect(creditCostForEndpoint({ costPerCall: 0 })).toBe(0.001);
    expect(creditCostForEndpoint({ costPerCall: 0.0000001 })).toBe(0.001);
  });

  it('creditsForExecution sums fractional costs correctly', () => {
    const steps = [
      { endpointId: 'a', success: true, cached: false },
      { endpointId: 'b', success: true, cached: false },
      { endpointId: 'c', success: true, cached: true }, // cached = 0
    ];
    const lookup = (id: string) => {
      if (id === 'a') return { costPerCall: 0.0001 }; // 0.15 credits
      if (id === 'b') return { costPerCall: 0.0005 }; // 0.75 credits
      return { costPerCall: 0.001 }; // won't count (cached)
    };
    expect(creditsForExecution(steps, lookup)).toBeCloseTo(0.9, 6);
  });
});
