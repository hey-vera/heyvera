/**
 * @aidprotocol/x402-enhanced — Add AID trust to any x402 server
 *
 * Wraps x402 payment middleware with AID trust verification.
 * Agents with higher trust scores pay less via trust-gated pricing.
 *
 * @example
 * ```typescript
 * import { createServer } from 'http';
 * import { withAidTrust } from '@aidprotocol/x402-enhanced';
 *
 * const aid = withAidTrust({
 *   basePriceUsd: 0.001,       // base price per request
 *   recipientAddress: '0x...',  // your USDC address
 * });
 *
 * createServer(async (req, res) => {
 *   const result = await aid.checkRequest(req);
 *
 *   if (result.trustVerified) {
 *     // Agent has AID — apply trust-gated pricing
 *     console.log(result.adjustedPrice); // discounted price
 *   }
 *
 *   // Serve the resource
 *   res.end(JSON.stringify({ data: '...' }));
 * }).listen(3000);
 * ```
 *
 * @license MIT
 */

import { getTrustVerdict } from '@aidprotocol/trust-compute';
import type { TrustVerdictResult } from '@aidprotocol/trust-compute';

export type { TrustVerdictResult };

// ─── Configuration ──────────────────────────────────────────────────────────

export interface X402EnhancedConfig {
  /** Base price in USD per request (e.g., 0.001 = $0.001) */
  basePriceUsd: number;

  /** USDC recipient address (your wallet) */
  recipientAddress: string;

  /** Chain for USDC settlement (default: 'base') */
  chain?: string;

  /** ClawNet API URL for trust resolution (default: https://api.claw-net.org) */
  apiUrl?: string;

  /** Trust score cache TTL in seconds (default: 300) */
  cacheTtlSeconds?: number;

  /** Custom pricing tiers (override defaults) */
  pricingTiers?: PricingTier[];

  /** Called when trust-gated pricing is applied */
  onTrustPriced?: (did: string, basePriceUsd: number, adjustedPriceUsd: number, verdict: string) => void;
}

export interface PricingTier {
  minTrust: number;
  multiplier: number;
  verdict: string;
}

export interface RequestCheckResult {
  /** Whether AID headers were present and verified */
  trustVerified: boolean;
  /** Agent DID (if verified) */
  did: string | null;
  /** Trust score (0-100) */
  trustScore: number;
  /** Trust verdict */
  verdict: string;
  /** Base price (before trust discount) */
  basePriceUsd: number;
  /** Adjusted price (after trust discount) */
  adjustedPriceUsd: number;
  /** Discount percentage applied */
  discountPct: number;
  /** x402 payment requirement header value */
  paymentRequired: string;
  /** Whether the score was from cache */
  cached: boolean;
}

// ─── Default Pricing Tiers (matching AID spec Section 2.3) ──────────────────

const DEFAULT_TIERS: PricingTier[] = [
  { minTrust: 90, multiplier: 0.70, verdict: 'proceed' },
  { minTrust: 80, multiplier: 0.75, verdict: 'trusted' },
  { minTrust: 60, multiplier: 0.80, verdict: 'standard' },
  { minTrust: 40, multiplier: 0.90, verdict: 'caution' },
  { minTrust: 20, multiplier: 1.00, verdict: 'building' },
  { minTrust: 0,  multiplier: 1.00, verdict: 'new' },
];

// ─── Trust Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  score: number;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 10_000;

function getCached(did: string): number | null {
  const entry = cache.get(did);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(did);
    return null;
  }
  return entry.score;
}

function setCache(did: string, score: number, ttlMs: number): void {
  cache.set(did, { score, expiresAt: Date.now() + ttlMs });
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// ─── Trust Resolution ───────────────────────────────────────────────────────

async function fetchTrustScore(did: string, apiUrl: string): Promise<number | null> {
  try {
    const res = await fetch(`${apiUrl}/v1/aid/${encodeURIComponent(did)}/trust`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.trustScore ?? data.score ?? 0;
  } catch {
    return null;
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Create an AID-enhanced x402 trust middleware.
 *
 * Checks incoming requests for X-AID-DID headers, resolves trust scores,
 * and adjusts x402 pricing based on trust tiers. Agents with higher trust
 * pay less — creating economic incentive to build AID reputation.
 */
export function withAidTrust(config: X402EnhancedConfig) {
  const {
    basePriceUsd,
    recipientAddress,
    chain = 'base',
    apiUrl = 'https://api.claw-net.org',
    cacheTtlSeconds = 300,
    pricingTiers = DEFAULT_TIERS,
    onTrustPriced,
  } = config;

  const cacheTtlMs = cacheTtlSeconds * 1000;

  // Sort tiers by minTrust descending for matching
  const sortedTiers = [...pricingTiers].sort((a, b) => b.minTrust - a.minTrust);

  function getMultiplier(score: number): { multiplier: number; verdict: string } {
    for (const tier of sortedTiers) {
      if (score >= tier.minTrust) {
        return { multiplier: tier.multiplier, verdict: tier.verdict };
      }
    }
    return { multiplier: 1.0, verdict: 'new' };
  }

  return {
    /**
     * Check a request for AID trust headers and compute trust-gated pricing.
     *
     * @param headers - Request headers (object or function)
     * @returns Trust check result with adjusted pricing
     */
    async checkRequest(
      headers: Record<string, string | string[] | undefined> | ((name: string) => string | undefined),
    ): Promise<RequestCheckResult> {
      const getHeader = typeof headers === 'function'
        ? headers
        : (name: string) => {
            const val = (headers as Record<string, string | string[] | undefined>)[name] ??
                        (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
            return Array.isArray(val) ? val[0] : val;
          };

      const did = getHeader('X-AID-DID') || getHeader('x-aid-did');

      // No AID headers — base price
      if (!did) {
        return {
          trustVerified: false,
          did: null,
          trustScore: 0,
          verdict: 'new',
          basePriceUsd,
          adjustedPriceUsd: basePriceUsd,
          discountPct: 0,
          paymentRequired: buildPaymentRequired(basePriceUsd, recipientAddress, chain),
          cached: false,
        };
      }

      // Check cache first
      let score: number;
      let cached = false;
      const cachedScore = getCached(did);

      if (cachedScore !== null) {
        score = cachedScore;
        cached = true;
      } else {
        const apiScore = await fetchTrustScore(did, apiUrl);
        score = apiScore ?? 0;
        setCache(did, score, cacheTtlMs);
      }

      const { multiplier, verdict } = getMultiplier(score);
      const adjustedPriceUsd = Number((basePriceUsd * multiplier).toFixed(6));
      const discountPct = Math.round((1 - multiplier) * 100);

      if (onTrustPriced) {
        onTrustPriced(did, basePriceUsd, adjustedPriceUsd, verdict);
      }

      return {
        trustVerified: true,
        did,
        trustScore: score,
        verdict,
        basePriceUsd,
        adjustedPriceUsd,
        discountPct,
        paymentRequired: buildPaymentRequired(adjustedPriceUsd, recipientAddress, chain),
        cached,
      };
    },

    /** Generate x402 402 response headers with trust-gated pricing */
    build402Headers(result: RequestCheckResult): Record<string, string> {
      const headers: Record<string, string> = {
        'PAYMENT-REQUIRED': result.paymentRequired,
      };
      if (result.trustVerified) {
        headers['X-AID-TRUST-GATE'] = `min_score=0,tier=${result.verdict}`;
        headers['X-AID-PRICING-TIERS'] = JSON.stringify(
          sortedTiers.map(t => ({
            min: t.minTrust,
            price: (basePriceUsd * t.multiplier).toFixed(6),
            verdict: t.verdict,
          }))
        );
      }
      return headers;
    },

    /** Clear the trust score cache */
    clearCache(): void {
      cache.clear();
    },

    /** Get current config */
    config: { basePriceUsd, recipientAddress, chain, tiers: sortedTiers },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildPaymentRequired(priceUsd: number, recipient: string, chain: string): string {
  return Buffer.from(JSON.stringify({
    amount: priceUsd.toFixed(6),
    currency: 'USDC',
    chain,
    recipient,
    protocol: 'x402',
    aidEnhanced: true,
  })).toString('base64');
}
