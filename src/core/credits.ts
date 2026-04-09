/**
 * Credit cost calculation — single source of truth.
 *
 * Additive pricing model (v4 — fee spine):
 * - Each endpoint can declare an explicit creditCost override (can be fractional)
 * - Without override, auto-priced at 1:1 raw cost (COST_MARKUP_FACTOR = 1000)
 * - Platform revenue comes from additive infrastructure fee (see fee-spine.ts)
 * - Orchestration: free (discovery is infrastructure)
 * - Cache hits: 5% of live cost (95% savings for agents)
 * - Fractional credits supported: a $0.0001 endpoint = 0.1 credits
 *
 * Economics:
 *   Purchase rate: 1 credit = $0.001 (1000 credits/$1)
 *   Auto-pricing:  1:1 raw API cost → provider price (no platform markup)
 *   Infra fee:     5% additive, trust-scaled to 2% (fee-spine.ts)
 *   Payout rate:   $0.00095/credit (5% spread — covers Stripe + tx costs)
 *
 * Example pricing at 1000× factor (raw cost):
 *   $0.0001 endpoint → 0.1 credits   (provider price, +5% infra fee)
 *   $0.001 endpoint  → 1.0 credits   (provider price, +5% infra fee)
 *   $0.010 endpoint  → 10 credits    (provider price, +5% infra fee)
 *   $0.050 endpoint  → 50 credits    (provider price, +5% infra fee)
 *
 * x402 surcharge (third-party prompt_template skills):
 *   When a third-party skill triggers x402 API calls, the platform pays those
 *   upstream costs. The surcharge passes that cost through at the buy rate
 *   (1:1 cost recovery). Creator revenue is unaffected.
 *
 */

import { env } from '../config/index';

const CREDITS_PER_USD = env.CREDITS_PER_USD;

/**
 * Cost-to-credit conversion factor. At 1000:
 *   rawCost × 1000 = credit price (1:1 at $0.001/credit)
 * Platform revenue comes from the additive infrastructure fee
 * (fee-spine.ts), not from markup on this factor.
 * Providers set explicit creditCost for custom margins.
 */
const COST_MARKUP_FACTOR = env.COST_MARKUP_FACTOR;

/**
 * Round a credit value to 6 decimal places to prevent floating-point drift.
 * All credit math should pass through this before DB writes.
 *
 * Throws on NaN/Infinity — a non-finite value in the billing pipeline
 * means a bug upstream (e.g., dividing by zero, missing price data).
 * Silently returning 0 would mask the bug and corrupt financial records.
 */
export function round6(n: number): number {
  if (!Number.isFinite(n)) {
    throw new Error(`round6: non-finite value "${n}" in credit math — this is a bug upstream`);
  }
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Value-based credit cost for a single endpoint invocation.
 * Uses explicit creditCost if set, otherwise auto-prices at COST_MARKUP_FACTOR × costPerCall.
 * Minimum 0.001 credits per endpoint to prevent free-riding.
 */
export function creditCostForEndpoint(endpoint: { creditCost?: number; costPerCall: number }): number {
  if (endpoint.creditCost != null) return round6(Math.max(0.001, endpoint.creditCost));
  return round6(Math.max(0.001, endpoint.costPerCall * COST_MARKUP_FACTOR));
}

/**
 * Convert credits to estimated USD for transparency.
 * Based on purchase price: CREDITS_PER_USD credits = $1.
 */
export function creditsToUsd(credits: number): number {
  return parseFloat((credits / CREDITS_PER_USD).toFixed(6));
}

/**
 * Calculate total credits for an executed plan from step results.
 * Cache hits = 0 credits. Failed steps = 0 credits.
 * Only successful, non-cached steps incur cost.
 */
export function creditsForExecution(
  steps: Array<{ endpointId: string; success: boolean; cached: boolean }>,
  endpointLookup: (id: string) => { creditCost?: number; costPerCall: number } | undefined,
): number {
  return round6(steps.reduce((sum, step) => {
    if (!step.success || step.cached) return sum;
    const ep = endpointLookup(step.endpointId);
    return sum + (ep ? creditCostForEndpoint(ep) : 0.001);
  }, 0));
}

/**
 * x402 surcharge: convert raw USD API cost to credits at the buy rate.
 * This is 1:1 cost recovery — the platform charges exactly what it paid upstream.
 * Only applied to third-party prompt_template skills where the platform pays x402 costs.
 *
 * Returns 0 if apiCostUsd is 0 or negative (e.g. all steps cached).
 */
export function x402SurchargeCredits(apiCostUsd: number): number {
  if (apiCostUsd <= 0) return 0;
  return round6(apiCostUsd * CREDITS_PER_USD);
}

/**
 * Cache pricing: 5% of live cost. Agent saves 95%.
 *
 * Cached responses cost nearly nothing (Redis/SQLite lookup).
 * Pass the savings to agents. A 1.0cr endpoint caches at 0.05cr.
 */
const CACHE_DISCOUNT_PCT = 0.05;

export function cacheCreditCost(liveCreditCost: number): number {
  return round6(Math.max(0.001, liveCreditCost * CACHE_DISCOUNT_PCT));
}

// ─── Dynamic Pricing ────────────────────────────────────────────────────────

export interface DynamicPricingConfig {
  surge?: { thresholdPerHour: number; multiplier: number; maxMultiplier?: number };
  volumeDiscounts?: Array<{ minCalls: number; discountPct: number }>;
  offPeak?: { utcHoursStart: number; utcHoursEnd: number; discountPct: number };
}

/**
 * Apply dynamic pricing modifiers to a base credit cost.
 * Surge and off-peak don't stack — surge takes priority.
 * Volume discount always applies on top.
 * Anti-abuse: surge capped at 5x, discounts capped at 50%.
 */
export function dynamicCreditCost(
  baseCost: number,
  config: DynamicPricingConfig | null | undefined,
  currentDemand: number,
  callerUsageCount: number,
  currentHourUtc: number,
): number {
  if (!config) return baseCost;

  let cost = baseCost;

  // 1. Surge pricing (overrides off-peak)
  if (config.surge && currentDemand >= config.surge.thresholdPerHour) {
    const ratio = currentDemand / config.surge.thresholdPerHour;
    const rawMultiplier = 1 + (config.surge.multiplier - 1) * Math.min(ratio, 3);
    const maxMult = Math.min(config.surge.maxMultiplier ?? 5, 5);
    cost = baseCost * Math.min(rawMultiplier, maxMult);
  } else if (config.offPeak) {
    // 2. Off-peak discount (only when no surge)
    const { utcHoursStart, utcHoursEnd, discountPct } = config.offPeak;
    const inWindow = utcHoursStart < utcHoursEnd
      ? currentHourUtc >= utcHoursStart && currentHourUtc < utcHoursEnd
      : currentHourUtc >= utcHoursStart || currentHourUtc < utcHoursEnd;
    if (inWindow) {
      const discount = Math.min(discountPct, 50) / 100;
      cost = baseCost * (1 - discount);
    }
  }

  // 3. Volume discount (always applies on top)
  if (config.volumeDiscounts && config.volumeDiscounts.length > 0 && callerUsageCount > 0) {
    const sorted = [...config.volumeDiscounts].sort((a, b) => b.minCalls - a.minCalls);
    const tier = sorted.find(t => callerUsageCount >= t.minCalls);
    if (tier) {
      const discount = Math.min(tier.discountPct, 50) / 100;
      cost = cost * (1 - discount);
    }
  }

  // Cap total discount at 50% — cost can never drop below half of baseCost
  cost = Math.max(baseCost * 0.5, cost);

  return round6(Math.max(0.001, cost));
}

// ─── AID Trust-Gated Pricing ────────────────────────────────────────────────

/**
 * Trust tier definition per AID Protocol Specification Section 3.3.
 */
export interface TrustTier {
  minTrust: number;
  verdict: string;
  discount: number;       // 0.0–0.30 (0% to 30%)
  settlement: string;
}

/** Canonical trust pricing tiers (spec Section 3.3, hardened in Section 39.6). */
export const AID_TRUST_TIERS: TrustTier[] = [
  { minTrust: 90, verdict: 'proceed',  discount: 0.30, settlement: 'deferred' },
  { minTrust: 80, verdict: 'trusted',  discount: 0.25, settlement: 'batched' },
  { minTrust: 60, verdict: 'standard', discount: 0.20, settlement: 'batched' },
  { minTrust: 40, verdict: 'caution',  discount: 0.10, settlement: 'standard' },
  { minTrust: 20, verdict: 'building', discount: 0.00, settlement: 'immediate' },
  { minTrust: 0,  verdict: 'new',      discount: 0.00, settlement: 'immediate' },
];

/**
 * Resolve the trust tier for a given trust score.
 * Returns the highest tier the agent qualifies for.
 */
export function resolveTrustTier(trustScore: number): TrustTier {
  for (const tier of AID_TRUST_TIERS) {
    if (trustScore >= tier.minTrust) return tier;
  }
  return AID_TRUST_TIERS[AID_TRUST_TIERS.length - 1];
}

/**
 * Apply trust-gated pricing discount to a credit cost.
 * Returns the discounted cost (never below 0.001 credits).
 *
 * Note: "proceed" tier (30% discount) requires additional checks beyond
 * trust score alone (verified, 6mo activity, $50 revenue). Callers should
 * verify those conditions separately before allowing the proceed discount.
 */
export function trustGatedCreditCost(baseCost: number, trustScore: number): number {
  const tier = resolveTrustTier(trustScore);
  const discounted = baseCost * (1 - tier.discount);
  return round6(Math.max(0.001, discounted));
}
