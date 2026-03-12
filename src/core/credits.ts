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
 *   separate from the 97/3 split.
 *
 * Legacy fallback: creditsForApiCost() still available for backward compat.
 */

const CREDITS_PER_USD = parseInt(process.env.CREDITS_PER_USD ?? '1000', 10);

/**
 * Cost-to-credit markup factor. At sale price $0.001/credit:
 *   1000 = break-even, 1500 = 33-50% margin, 2000 = 50-100% margin
 * Override via COST_MARKUP_FACTOR env var for price adjustments without redeploy.
 */
const COST_MARKUP_FACTOR = parseInt(process.env.COST_MARKUP_FACTOR ?? '1500', 10);

/**
 * Round a credit value to 6 decimal places to prevent floating-point drift.
 * All credit math should pass through this before DB writes.
 */
export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Legacy formula: derive credits from raw API cost using CREDITS_PER_USD.
 * Now returns fractional credits (e.g. 0.1 credits for a $0.0001 call).
 */
export function creditsForApiCost(apiCostUsd: number): number {
  return round6(Math.max(0.001, apiCostUsd * CREDITS_PER_USD));
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
 * Total credit cost for a planned execution (sum of step costs).
 * Does NOT include orchestration fee — caller adds that separately.
 */
export function creditsForPlan(steps: Array<{ creditCost?: number; costPerCall: number }>): number {
  return round6(steps.reduce((sum, step) => sum + creditCostForEndpoint(step), 0));
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

/** Expose for health/admin endpoints */
export function getCreditsPerUsd(): number {
  return CREDITS_PER_USD;
}

/** Expose markup factor for admin/debug */
export function getCostMarkupFactor(): number {
  return COST_MARKUP_FACTOR;
}
