/**
 * Credit cost calculation — single source of truth.
 *
 * Value-based pricing model (v3 — decimal credits):
 * - Each endpoint can declare an explicit creditCost override (can be fractional)
 * - Without override, auto-priced at 1.5× API cost (COST_MARKUP_FACTOR = 1500)
 * - Guarantees minimum ~33% margin on every API call at $0.001/credit sale price
 * - Orchestration fee (default 2cr) covers LLM intent parsing + synthesis
 * - Cache hits = 0 credits (no flat tax on cached responses)
 * - Fractional credits supported: a $0.0001 endpoint = 0.15 credits (not rounded up to 1)
 *
 * Economics:
 *   Purchase rate: 1 credit = $0.001 (1000 credits/$1 at base Stripe tier)
 *   Cost markup:   1.5× raw API cost → ~33-50% gross margin
 *   Orch fee:      2 credits per query → pure profit (covers LLM ~$0.0004/call)
 *   Payout rate:   $0.00075/credit (25% below buy rate — prevents arbitrage)
 *
 * Example pricing at 1500× markup:
 *   $0.0001 endpoint → 0.15 credits  ($0.00015 revenue, 33% margin)
 *   $0.0005 endpoint → 0.75 credits  ($0.00075 revenue, 33% margin)
 *   $0.001 endpoint  → 1.5 credits   ($0.0015 revenue, 33% margin)
 *   $0.005 endpoint  → 7.5 credits   ($0.0075 revenue, 33% margin)
 *   $0.010 endpoint  → 15 credits    ($0.015 revenue, 33% margin)
 *   $0.050 endpoint  → 75 credits    ($0.075 revenue, 33% margin)
 *
 * x402 surcharge (third-party prompt_template skills):
 *   When a third-party skill triggers x402 API calls, the platform pays those
 *   upstream costs. The surcharge passes that cost through to the caller at the
 *   buy rate (1:1 cost recovery). Creator revenue is unaffected — surcharge is
 *   separate from the 85/15 split.
 *
 */

import { env } from '../config/index';

const CREDITS_PER_USD = env.CREDITS_PER_USD;

/**
 * Cost-to-credit markup factor. At sale price $0.001/credit:
 *   1000 = break-even, 1500 = 33-50% margin, 2000 = 50-100% margin
 * Validated via Zod in src/config/index.ts (min 500, max 10000).
 */
const COST_MARKUP_FACTOR = env.COST_MARKUP_FACTOR;

/**
 * Round a credit value to 6 decimal places to prevent floating-point drift.
 * All credit math should pass through this before DB writes.
 */
export function round6(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Value-based credit cost for a single endpoint invocation.
 * Uses explicit creditCost if set, otherwise auto-prices at COST_MARKUP_FACTOR × costPerCall.
 * Minimum 0.001 credits per endpoint to prevent free-riding.
 */
export function creditCostForEndpoint(endpoint: { creditCost?: number; costPerCall: number }): number {
  if (endpoint.creditCost != null) return endpoint.creditCost;
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
 * Smart cache pricing: 10% of live cost, minimum 0.1 credits.
 *
 * Why proportional:
 * - Flat 1cr was unfair: a $25 bulk endpoint cached for $0.001 (giving it away),
 *   while a $0.0001 endpoint cached for $0.001 (barely a discount).
 * - 10% of live = consistent 90% savings for users, proportional revenue for platform.
 * - Creator still earns full credit_cost on cache hits (unchanged).
 * - Minimum 0.1 credits ($0.0001) ensures even the cheapest endpoints generate revenue.
 */
const CACHE_DISCOUNT_PCT = 0.10;
const CACHE_MIN_CREDITS = 0.1;

export function cacheCreditCost(liveCreditCost: number): number {
  return round6(Math.max(CACHE_MIN_CREDITS, liveCreditCost * CACHE_DISCOUNT_PCT));
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

  return round6(Math.max(0.001, cost));
}
