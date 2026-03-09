/**
 * Credit cost calculation — single source of truth.
 *
 * Pricing model:
 * - 1 credit = $0.0005 operator cost (API calls)
 * - 1 credit = $0.001 user purchase price (sold at 1000 credits/$)
 * - Markup: 2x on raw API cost (built into the 2000 multiplier)
 * - Minimum: 1 credit per operation (prevents free-riding on cached results)
 */
export function creditsForApiCost(apiCostUsd: number): number {
  return Math.max(1, Math.ceil(apiCostUsd * 2000));
}
