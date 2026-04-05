/**
 * Soma Check billing split calculator (rail-agnostic).
 *
 * Encodes the billing rule from internal/soma-check-billing.md:
 *   - Cache hit price = 10% of origin
 *   - Split 90/10 (provider/ClawNet) at Tiers 0-2, matching origin
 *   - Split 95/5 at Tier 3 (Champion)
 *
 * Same ratios apply to credits, x402 USDC, Stripe. Callers convert
 * origin price into their unit; this helper doesn't care about currency.
 */
import { round6 } from './credits';

/** Soma Check onboarding tier (see internal/soma-onboarding-ladder.md). */
export type SomaCheckTier = 0 | 1 | 2 | 3;

/** Fraction of origin price charged on cache hit. */
export const SOMA_CHECK_HIT_PRICE_RATIO = 0.10;

/** Provider share of cache-hit price by tier. */
export function cacheHitProviderShareByTier(tier: SomaCheckTier): number {
  return tier === 3 ? 0.95 : 0.90;
}

export interface SomaCheckSplit {
  agentPays: number;     // what the caller is charged
  providerGets: number;  // credited to provider
  platformGets: number;  // kept by ClawNet
  isHit: boolean;
  tier: SomaCheckTier;
  hitPriceRatio: number;
}

/**
 * Compute the money flow for a single Soma Check call.
 *
 * @param originPrice Full-fresh call price in the caller's unit (credits, USDC, etc.)
 * @param isHit Whether this call matched a cached hash (304 Not Modified)
 * @param tier Provider's Soma Check onboarding tier (0 = shadow, 3 = Champion)
 */
export function computeSomaCheckSplit(
  originPrice: number,
  isHit: boolean,
  tier: SomaCheckTier = 0,
): SomaCheckSplit {
  if (!isHit) {
    // Origin call — standard 90/10 split. Tier doesn't change origin.
    return {
      agentPays: round6(originPrice),
      providerGets: round6(originPrice * 0.90),
      platformGets: round6(originPrice * 0.10),
      isHit: false,
      tier,
      hitPriceRatio: 1.0,
    };
  }

  const hitPrice = originPrice * SOMA_CHECK_HIT_PRICE_RATIO;
  const providerShare = cacheHitProviderShareByTier(tier);
  return {
    agentPays: round6(hitPrice),
    providerGets: round6(hitPrice * providerShare),
    platformGets: round6(hitPrice * (1 - providerShare)),
    isHit: true,
    tier,
    hitPriceRatio: SOMA_CHECK_HIT_PRICE_RATIO,
  };
}

/**
 * How much the caller saved vs paying origin price.
 * Returns 0 on misses.
 */
export function somaCheckSavings(originPrice: number, isHit: boolean): number {
  if (!isHit) return 0;
  return round6(originPrice * (1 - SOMA_CHECK_HIT_PRICE_RATIO));
}
