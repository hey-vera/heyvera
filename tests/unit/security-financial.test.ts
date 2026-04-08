/**
 * Security: Financial math edge cases
 *
 * Production-grade tests for:
 *   - round6() with NaN, Infinity, -Infinity, negative zero, subnormals
 *   - Floating-point accumulation drift over 10k operations
 *   - Credit deduction guards (negative amounts, zero, boundary)
 *   - Bond calculation with pathological inputs (NaN, Infinity, negative)
 *   - Slash math invariant holds for extreme values
 *   - Dynamic pricing boundary conditions (surge cap, discount cap, off-peak)
 *   - Trust-gated pricing discount bounds
 *   - Cache pricing never goes below minimum
 *   - creditCostForEndpoint minimum floor enforcement
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import {
  round6,
  creditCostForEndpoint,
  creditsToUsd,
  cacheCreditCost,
  dynamicCreditCost,
  trustGatedCreditCost,
  creditsForExecution,
  x402SurchargeCredits,
} from '../../src/core/credits';
import {
  calculateBondRequirement,
  calculateSlashAmounts,
  calculateChallengeEconomics,
} from '../../src/core/bond-economics';
import { deductCredit, topUpCredits } from '../../src/db/credits';
import { registerBuiltinTypes } from '../../src/core/computation-types';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

// ─── round6() Edge Cases ──────────────────────────────────────────────────

describe('round6 edge cases', () => {
  it('NaN throws (catches bugs upstream)', () => {
    expect(() => round6(NaN)).toThrow('non-finite');
  });

  it('Infinity throws', () => {
    expect(() => round6(Infinity)).toThrow('non-finite');
  });

  it('-Infinity throws', () => {
    expect(() => round6(-Infinity)).toThrow('non-finite');
  });

  it('negative zero → 0 (numeric equality)', () => {
    // round6(-0) returns -0 per IEEE 754 (Math.round preserves sign of zero)
    // -0 === 0 is true in JS, so numeric equality holds
    expect(round6(-0) === 0).toBe(true);
    expect(round6(-0)).toBe(-0); // toBe uses Object.is, so -0 === -0
    // The important guarantee: -0 cannot corrupt credit math
    expect(round6(-0) + 100).toBe(100);
  });

  it('very small subnormal → 0', () => {
    expect(round6(Number.MIN_VALUE)).toBe(0);
    expect(round6(5e-7)).toBe(0.000001); // exactly at 6th decimal
    expect(round6(4.9e-7)).toBe(0);      // below 6th decimal threshold
  });

  it('preserves 6 decimal places', () => {
    expect(round6(1.123456789)).toBe(1.123457);
    expect(round6(0.000001)).toBe(0.000001);
    expect(round6(0.0000001)).toBe(0);
  });

  it('large numbers stay precise', () => {
    expect(round6(999999.999999)).toBe(999999.999999);
    expect(round6(1000000.1234567)).toBe(1000000.123457);
  });

  it('negative values work correctly', () => {
    expect(round6(-1.5)).toBe(-1.5);
    expect(round6(-0.000001)).toBe(-0.000001);
  });
});

// ─── Floating-Point Accumulation Drift ────────────────────────────────────

describe('floating-point accumulation', () => {
  it('10,000 additions of 0.1 without round6 drifts', () => {
    let raw = 0;
    for (let i = 0; i < 10_000; i++) raw += 0.1;
    // Raw floating point drifts: 0.1 * 10000 !== 1000 exactly
    expect(raw).not.toBe(1000);
  });

  it('10,000 additions with round6 at each step stays precise', () => {
    let safe = 0;
    for (let i = 0; i < 10_000; i++) safe = round6(safe + 0.1);
    expect(safe).toBe(1000);
  });

  it('1,000 credit deductions accumulate correctly', () => {
    let balance = 1000;
    const cost = 0.001; // minimum credit cost
    for (let i = 0; i < 1000; i++) {
      balance = round6(balance - cost);
    }
    expect(balance).toBe(999);
  });

  it('alternating add/subtract returns to zero', () => {
    let val = 0;
    for (let i = 0; i < 1000; i++) {
      val = round6(val + 0.333333);
      val = round6(val - 0.333333);
    }
    expect(val).toBe(0);
  });
});

// ─── Credit Deduction Guards ──────────────────────────────────────────────

describe('credit deduction guards', () => {
  function createTestKey(credits: number): string {
    const key = `cn-test-${Math.random().toString(36).slice(2)}`;
    getDb().prepare(`
      INSERT OR REPLACE INTO api_keys (key, email, credits, credits_used, active)
      VALUES (?, ?, ?, 0, 1)
    `).run(key, `${key}@test.local`, credits);
    return key;
  }

  it('negative deduction throws', () => {
    const key = createTestKey(100);
    expect(() => deductCredit(key, -1)).toThrow();
    expect(() => deductCredit(key, -0.001)).toThrow();
  });

  it('zero deduction is a no-op (returns true)', () => {
    const key = createTestKey(100);
    expect(deductCredit(key, 0)).toBe(true);
    const row = getDb().prepare('SELECT credits FROM api_keys WHERE key = ?').get(key) as any;
    expect(row.credits).toBe(100);
  });

  it('deduction exceeding balance fails', () => {
    const key = createTestKey(10);
    expect(deductCredit(key, 10.001)).toBe(false);
    const row = getDb().prepare('SELECT credits FROM api_keys WHERE key = ?').get(key) as any;
    expect(row.credits).toBe(10); // unchanged
  });

  it('exact balance deduction succeeds', () => {
    const key = createTestKey(10);
    expect(deductCredit(key, 10)).toBe(true);
    const row = getDb().prepare('SELECT credits FROM api_keys WHERE key = ?').get(key) as any;
    expect(row.credits).toBe(0);
  });

  it('deduction on inactive key fails', () => {
    const key = createTestKey(100);
    getDb().prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(key);
    expect(deductCredit(key, 1)).toBe(false);
  });

  it('deduction on nonexistent key fails', () => {
    expect(deductCredit('cn-nonexistent-key', 1)).toBe(false);
  });

  it('negative topup throws', () => {
    const key = createTestKey(0);
    expect(() => topUpCredits(key, -100)).toThrow();
  });
});

// ─── Bond Calculation Edge Cases ──────────────────────────────────────────

describe('bond calculation pathological inputs', () => {
  it('NaN creditsCost throws (catches bugs upstream)', () => {
    expect(() => calculateBondRequirement(NaN)).toThrow('non-finite');
  });

  it('Infinity creditsCost throws', () => {
    expect(() => calculateBondRequirement(Infinity)).toThrow('non-finite');
  });

  it('negative creditsCost → Tier 0', () => {
    const req = calculateBondRequirement(-100);
    expect(req.tier).toBe(0);
    expect(req.bondAmount).toBe(0);
  });

  it('very large creditsCost → Tier 3 with correct bond', () => {
    const req = calculateBondRequirement(1_000_000);
    expect(req.tier).toBe(3);
    expect(req.bondAmount).toBe(20_000_000); // 20x
    expect(req.requiresRealMoney).toBe(true);
  });

  it('fractional creditsCost near tier boundary', () => {
    expect(calculateBondRequirement(9.999999).tier).toBe(0);
    expect(calculateBondRequirement(10.000001).tier).toBe(1);
    expect(calculateBondRequirement(99.999999).tier).toBe(1);
    expect(calculateBondRequirement(100.000001).tier).toBe(2);
  });
});

// ─── Slash Math Extreme Values ────────────────────────────────────────────

describe('slash math extremes', () => {
  it('very small bond (0.000001) still sums correctly', () => {
    const slash = calculateSlashAmounts(0.000001);
    const total = round6(slash.winner + slash.treasury + slash.burned);
    expect(total).toBe(0.000001);
  });

  it('very large bond (10M) still sums correctly', () => {
    const slash = calculateSlashAmounts(10_000_000);
    const total = round6(slash.winner + slash.treasury + slash.burned);
    expect(total).toBe(10_000_000);
  });

  it('NaN bond throws', () => {
    expect(() => calculateSlashAmounts(NaN)).toThrow('non-finite');
  });

  it('Infinity bond throws', () => {
    expect(() => calculateSlashAmounts(Infinity)).toThrow('non-finite');
  });

  it('invariant holds across 1000 random bond amounts (within 3e-6)', () => {
    for (let i = 0; i < 1000; i++) {
      const bond = round6(Math.random() * 100_000);
      const slash = calculateSlashAmounts(bond);
      const total = round6(slash.winner + slash.treasury + slash.burned);
      // Three round6 calls (60%, 35%, 5%) each can drift by ±0.5e-6
      // Plus the final round6 on the sum. Max observed drift ≈ 2e-6
      expect(Math.abs(total - bond), `bond=${bond}`).toBeLessThanOrEqual(0.000003);
    }
  });
});

// ─── Dynamic Pricing Boundaries ───────────────────────────────────────────

describe('dynamic pricing boundaries', () => {
  it('null config returns base cost', () => {
    expect(dynamicCreditCost(10, null, 0, 0, 12)).toBe(10);
    expect(dynamicCreditCost(10, undefined, 0, 0, 12)).toBe(10);
  });

  it('surge capped at 5x regardless of multiplier', () => {
    const config = { surge: { thresholdPerHour: 10, multiplier: 100, maxMultiplier: 999 } };
    const cost = dynamicCreditCost(10, config, 1000, 0, 12);
    expect(cost).toBeLessThanOrEqual(50); // 10 * 5x cap
  });

  it('discount capped at 50%', () => {
    const config = { volumeDiscounts: [{ minCalls: 1, discountPct: 99 }] };
    const cost = dynamicCreditCost(10, config, 0, 100, 12);
    expect(cost).toBeGreaterThanOrEqual(5); // 10 * 50% floor
  });

  it('off-peak discount capped at 50%', () => {
    const config = { offPeak: { utcHoursStart: 0, utcHoursEnd: 24, discountPct: 80 } };
    const cost = dynamicCreditCost(10, config, 0, 0, 12);
    expect(cost).toBeGreaterThanOrEqual(5);
  });

  it('surge overrides off-peak (never stack)', () => {
    const config = {
      surge: { thresholdPerHour: 10, multiplier: 2 },
      offPeak: { utcHoursStart: 0, utcHoursEnd: 24, discountPct: 20 },
    };
    // Demand above threshold → surge, not off-peak discount
    const cost = dynamicCreditCost(10, config, 20, 0, 12);
    expect(cost).toBeGreaterThan(10); // surge should increase price
  });

  it('minimum 0.001 credits always enforced', () => {
    const config = { volumeDiscounts: [{ minCalls: 1, discountPct: 50 }] };
    const cost = dynamicCreditCost(0.001, config, 0, 100, 12);
    expect(cost).toBeGreaterThanOrEqual(0.001);
  });
});

// ─── Trust-Gated Pricing ──────────────────────────────────────────────────

describe('trust-gated pricing', () => {
  it('trust 100 → 30% discount', () => {
    expect(trustGatedCreditCost(100, 100)).toBe(70);
  });

  it('trust 0 → no discount', () => {
    expect(trustGatedCreditCost(100, 0)).toBe(100);
  });

  it('negative trust → no discount', () => {
    expect(trustGatedCreditCost(100, -50)).toBe(100);
  });

  it('discount never goes below 0.001', () => {
    expect(trustGatedCreditCost(0.001, 100)).toBe(0.001);
  });
});

// ─── Cache Pricing ────────────────────────────────────────────────────────

describe('cache pricing', () => {
  it('always 10% of live cost', () => {
    expect(cacheCreditCost(10)).toBe(1);
    expect(cacheCreditCost(1)).toBe(0.1);
    expect(cacheCreditCost(0.1)).toBe(0.01);
  });

  it('minimum floor 0.001', () => {
    expect(cacheCreditCost(0.001)).toBe(0.001);
    expect(cacheCreditCost(0.0001)).toBe(0.001);
  });
});

// ─── creditCostForEndpoint ────────────────────────────────────────────────

describe('creditCostForEndpoint', () => {
  it('explicit creditCost used when present', () => {
    expect(creditCostForEndpoint({ creditCost: 5, costPerCall: 0.001 })).toBe(5);
  });

  it('minimum floor 0.001 even with zero explicit cost', () => {
    expect(creditCostForEndpoint({ creditCost: 0, costPerCall: 0 })).toBe(0.001);
  });

  it('auto-pricing from costPerCall', () => {
    // COST_MARKUP_FACTOR is env-dependent, just verify it's above the floor
    const cost = creditCostForEndpoint({ costPerCall: 0.001 });
    expect(cost).toBeGreaterThanOrEqual(0.001);
  });
});

// ─── x402 Surcharge ───────────────────────────────────────────────────────

describe('x402 surcharge', () => {
  it('zero or negative → 0', () => {
    expect(x402SurchargeCredits(0)).toBe(0);
    expect(x402SurchargeCredits(-1)).toBe(0);
  });

  it('positive amount converts at buy rate', () => {
    const credits = x402SurchargeCredits(0.001);
    expect(credits).toBeGreaterThan(0);
  });
});

// ─── creditsForExecution ──────────────────────────────────────────────────

describe('creditsForExecution', () => {
  const lookup = (id: string) => ({ costPerCall: 0.001 });

  it('cached steps cost 0', () => {
    const cost = creditsForExecution(
      [{ endpointId: 'ep1', success: true, cached: true }],
      lookup,
    );
    expect(cost).toBe(0);
  });

  it('failed steps cost 0', () => {
    const cost = creditsForExecution(
      [{ endpointId: 'ep1', success: false, cached: false }],
      lookup,
    );
    expect(cost).toBe(0);
  });

  it('unknown endpoint fallback to 0.001', () => {
    const cost = creditsForExecution(
      [{ endpointId: 'unknown', success: true, cached: false }],
      () => undefined,
    );
    expect(cost).toBe(0.001);
  });
});
