/**
 * Soma Check billing — flat 10% hit price, 90/10 split.
 *
 * When an agent's If-Soma-Hash matches cached data:
 *   - Agent pays 10% of live price (90% savings)
 *   - Provider gets 90% of that (T0-T2) or 95% (T3 Champion)
 *   - ClawNet gets the remainder (10% or 5%)
 *
 * Rail-agnostic: same ratios for credits, x402 USDC, Stripe.
 */
import { round6 } from './credits';

/** Soma Check onboarding tier (see internal/soma-onboarding-ladder.md). */
export type SomaCheckTier = 0 | 1 | 2 | 3;

/** Base fraction of origin price charged on cache hit (mid-life data). */
export const SOMA_CHECK_HIT_PRICE_RATIO = 0.10;

/**
 * Hit price ratio — flat 10% of origin on every Soma Check hit.
 *
 * Previously had dynamic staleness-aware pricing (5%/10%/15%) but stripped
 * for simplicity. The range was fractions of a penny on typical endpoints —
 * not worth the complexity. See internal/future-pricing-ideas.md for when
 * to revisit dynamic pricing.
 */
export function dynamicHitPriceRatio(_ageMs: number, _ttlMs: number): number {
  return SOMA_CHECK_HIT_PRICE_RATIO; // flat 10%
}

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
 * @param staleness Optional age/TTL for dynamic hit pricing. If omitted, uses flat 10%.
 */
export function computeSomaCheckSplit(
  originPrice: number,
  isHit: boolean,
  tier: SomaCheckTier = 0,
  staleness?: { ageMs: number; ttlMs: number },
  /** Provider's live-call revenue share (1.00 founding, 0.90 post-provenance). */
  providerRevenueSharePct: number = 1.00,
): SomaCheckSplit {
  if (!isHit) {
    // Origin call — use provider's actual revenue share (founding: 100%, post-provenance: 90%).
    const providerPct = Math.min(1.0, Math.max(0, providerRevenueSharePct));
    return {
      agentPays: round6(originPrice),
      providerGets: round6(originPrice * providerPct),
      platformGets: round6(originPrice * (1 - providerPct)),
      isHit: false,
      tier,
      hitPriceRatio: 1.0,
    };
  }

  // Dynamic hit pricing: fresher data costs less (agent gets a better deal),
  // staler data costs more (less certainty it's still valid).
  const ratio = staleness
    ? dynamicHitPriceRatio(staleness.ageMs, staleness.ttlMs)
    : SOMA_CHECK_HIT_PRICE_RATIO;

  const hitPrice = originPrice * ratio;
  const providerShare = cacheHitProviderShareByTier(tier);
  return {
    agentPays: round6(hitPrice),
    providerGets: round6(hitPrice * providerShare),
    platformGets: round6(hitPrice * (1 - providerShare)),
    isHit: true,
    tier,
    hitPriceRatio: ratio,
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
