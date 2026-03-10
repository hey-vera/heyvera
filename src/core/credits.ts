/**
 * Credit cost calculation — single source of truth.
 *
 * Pricing model:
 * - 1 credit = $0.0005 operator cost (API calls)
 * - 1 credit = $0.001 user purchase price (sold at 1000 credits/$)
 * - Markup: 2x on raw API cost (default multiplier = 2000)
 * - Override via CREDITS_PER_USD env var without code deploy
 * - Minimum: 1 credit per operation (prevents free-riding on cached results)
 */
const CREDITS_PER_USD = parseInt(process.env.CREDITS_PER_USD ?? '2000', 10);

export function creditsForApiCost(apiCostUsd: number): number {
  return Math.max(1, Math.ceil(apiCostUsd * CREDITS_PER_USD));
}

/** Expose for health/admin endpoints */
export function getCreditsPerUsd(): number {
  return CREDITS_PER_USD;
}
