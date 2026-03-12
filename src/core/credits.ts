/**
 * Credit cost calculation — single source of truth.
 *
 * Value-based pricing model (v2):
 * - Each endpoint can declare an explicit creditCost override
 * - Without override, auto-priced at 1.5× API cost (COST_MARKUP_FACTOR = 1500)
 * - Guarantees minimum ~33% margin on every API call at $0.001/credit sale price
 * - Orchestration fee (default 2cr) covers LLM intent parsing + synthesis
 * - Cache hits = 0 credits (no flat tax on cached responses)
 *
 * Economics:
 *   Purchase rate: 1 credit = $0.001 (1000 credits/$1 at base Stripe tier)
 *   Cost markup:   1.5× raw API cost → ~33-50% gross margin
 *   Orch fee:      2 credits per query → pure profit (covers LLM ~$0.0004/call)
 *
 * Example pricing at 1500× markup:
 *   $0.001 endpoint → 2 credits  ($0.002 revenue, 50% margin)
 *   $0.005 endpoint → 8 credits  ($0.008 revenue, 38% margin)
 *   $0.010 endpoint → 15 credits ($0.015 revenue, 33% margin)
 *   $0.050 endpoint → 75 credits ($0.075 revenue, 33% margin)
 *   $0.500 endpoint → 750 credits ($0.75 revenue, 33% margin)
 *
 * Legacy fallback: creditsForApiCost() still available for backward compat.
 */

const CREDITS_PER_USD = parseInt(process.env.CREDITS_PER_USD ?? '2000', 10);

/**
 * Cost-to-credit markup factor. At sale price $0.001/credit:
 *   1000 = break-even, 1500 = 33-50% margin, 2000 = 50-100% margin
 * Override via COST_MARKUP_FACTOR env var for price adjustments without redeploy.
 */
const COST_MARKUP_FACTOR = parseInt(process.env.COST_MARKUP_FACTOR ?? '1500', 10);

/**
 * Legacy formula: derive credits from raw API cost using CREDITS_PER_USD (100% markup).
 * Still used by some callsites during migration; prefer creditCostForEndpoint() for new code.
 */
export function creditsForApiCost(apiCostUsd: number): number {
  return Math.max(1, Math.ceil(apiCostUsd * CREDITS_PER_USD));
}

/**
 * Value-based credit cost for a single endpoint invocation.
 * Uses explicit creditCost if set, otherwise auto-prices at COST_MARKUP_FACTOR × costPerCall.
 * Minimum 1 credit per endpoint to prevent free-riding.
 */
export function creditCostForEndpoint(endpoint: { creditCost?: number; costPerCall: number }): number {
  if (endpoint.creditCost != null) return endpoint.creditCost;
  return Math.max(1, Math.ceil(endpoint.costPerCall * COST_MARKUP_FACTOR));
}

/**
 * Total credit cost for a planned execution (sum of step costs).
 * Does NOT include orchestration fee — caller adds that separately.
 */
export function creditsForPlan(steps: Array<{ creditCost?: number; costPerCall: number }>): number {
  return steps.reduce((sum, step) => sum + creditCostForEndpoint(step), 0);
}

/**
 * Convert credits to estimated USD for transparency.
 * Based on purchase price: 1000 credits = $1.
 */
export function creditsToUsd(credits: number): number {
  return parseFloat((credits / 1000).toFixed(4));
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
  return steps.reduce((sum, step) => {
    if (!step.success || step.cached) return sum;
    const ep = endpointLookup(step.endpointId);
    return sum + (ep ? creditCostForEndpoint(ep) : 1);
  }, 0);
}

/** Expose for health/admin endpoints */
export function getCreditsPerUsd(): number {
  return CREDITS_PER_USD;
}

/** Expose markup factor for admin/debug */
export function getCostMarkupFactor(): number {
  return COST_MARKUP_FACTOR;
}
