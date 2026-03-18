/**
 * Cross-verification for agent service outputs.
 *
 * Compares agent service results against known-good ClawNet endpoints
 * when possible. Flags suspicious results and adjusts trust scores.
 *
 * Verifiable data types:
 * - Token prices (compare against clawapis price endpoint)
 * - Token metadata (compare against clawapis token info)
 * - Wallet balances (compare against Solana RPC)
 *
 * NOT verifiable (subjective/predictive):
 * - Sentiment analysis
 * - Price predictions
 * - Risk scores (methodology-dependent)
 * - Trading signals
 */

import { findEndpoint } from '../config/api-registry';
import { isClawApisReady, clawApiCall } from '../providers/clawapis';
import { logger } from '../utils/logger';

export interface VerificationResult {
  verified: boolean;
  confidence: number;     // 0-1, how confident we are in the verification
  source: string;         // what we compared against
  deviation?: number;     // % difference from known-good source
  warning?: string;       // human-readable warning if suspicious
}

// Map of verifiable data types to their reference endpoint IDs
const VERIFICATION_SOURCES: Record<string, {
  endpointId: string;
  extractField: string;     // field to compare in the reference response
  matchField: string;       // field to compare in the agent service response
  tolerance: number;        // max % deviation before flagging (e.g., 0.05 = 5%)
  type: 'numeric' | 'exact' | 'contains';
}> = {
  'token-price': {
    endpointId: 'claw-token-price',
    extractField: 'priceUsd',
    matchField: 'price',
    tolerance: 0.05,         // 5% tolerance for price data
    type: 'numeric',
  },
  'token-metadata': {
    endpointId: 'claw-token-metadata',
    extractField: 'symbol',
    matchField: 'symbol',
    tolerance: 0,
    type: 'exact',
  },
};

/**
 * Resolve a free-text reason/capability string to a verification source key.
 * The reason comes from the LLM intent parser (e.g. "get token price data").
 */
function resolveCapability(reason: string): string | null {
  const lower = reason.toLowerCase();
  // Direct match first
  if (VERIFICATION_SOURCES[lower]) return lower;
  // Keyword matching
  const matchers: Record<string, string[]> = {
    'token-price': ['token price', 'price', 'token-price', 'current price', 'price data', 'pricing'],
    'token-metadata': ['token meta', 'metadata', 'token info', 'token-metadata', 'token detail'],
  };
  for (const [key, keywords] of Object.entries(matchers)) {
    if (keywords.some(kw => lower.includes(kw))) return key;
  }
  return null;
}

/**
 * Attempt to cross-verify an agent service result.
 * Returns null if the data type is not verifiable.
 */
export async function crossVerify(
  capability: string,
  serviceResult: any,
  input: any,
): Promise<VerificationResult | null> {
  const resolvedKey = resolveCapability(capability);
  if (!resolvedKey) return null; // Not a verifiable data type
  const source = VERIFICATION_SOURCES[resolvedKey];

  try {
    const endpoint = findEndpoint(source.endpointId);
    if (!endpoint) return null;

    // Only attempt verification if ClawAPIs is ready (live data available)
    if (!isClawApisReady()) return null;

    const apiPath = endpoint.path;
    if (!apiPath) return null;

    // Build params from the input — pass through as-is for the reference call
    const params = typeof input === 'object' && input !== null ? { ...input } : {};
    const referenceResult = await clawApiCall(apiPath, params, endpoint.baseUrl, AbortSignal.timeout(10_000));
    if (!referenceResult) return null;

    // Compare
    const refValue = (referenceResult as any)[source.extractField];
    const svcValue = findFieldInResult(serviceResult, source.matchField);

    if (refValue === undefined || svcValue === undefined) return null;

    if (source.type === 'numeric') {
      const ref = Number(refValue);
      const svc = Number(svcValue);
      if (isNaN(ref) || isNaN(svc) || ref === 0) return null;

      const deviation = Math.abs(ref - svc) / ref;
      return {
        verified: deviation <= source.tolerance,
        confidence: Math.max(0, 1 - deviation),
        source: source.endpointId,
        deviation: Math.round(deviation * 10000) / 100, // percentage with 2 decimals
        warning: deviation > source.tolerance
          ? `Agent service value ($${svc}) deviates ${(deviation * 100).toFixed(1)}% from reference ($${ref})`
          : undefined,
      };
    }

    if (source.type === 'exact') {
      const match = String(refValue).toLowerCase() === String(svcValue).toLowerCase();
      return {
        verified: match,
        confidence: match ? 1 : 0,
        source: source.endpointId,
        warning: match ? undefined : `Exact match failed: expected "${refValue}", got "${svcValue}"`,
      };
    }

    if (source.type === 'contains') {
      const refStr = String(refValue).toLowerCase();
      const svcStr = String(svcValue).toLowerCase();
      const match = refStr.includes(svcStr) || svcStr.includes(refStr);
      return {
        verified: match,
        confidence: match ? 0.8 : 0.2,
        source: source.endpointId,
        warning: match ? undefined : `Contains match failed: "${refValue}" vs "${svcValue}"`,
      };
    }

    return null;
  } catch (err) {
    // Verification is best-effort — never block the response
    logger.debug({ err, capability }, 'Cross-verification failed (non-blocking)');
    return null;
  }
}

/** Search for a field in a nested object by common field names */
function findFieldInResult(obj: any, fieldName: string): any {
  if (!obj || typeof obj !== 'object') return undefined;

  // Direct match
  if (obj[fieldName] !== undefined) return obj[fieldName];

  // Common aliases
  const aliases: Record<string, string[]> = {
    price: ['price', 'priceUsd', 'price_usd', 'currentPrice', 'current_price', 'usdPrice'],
    symbol: ['symbol', 'ticker', 'token_symbol'],
    volume: ['volume', 'volume24h', 'volume_24h', 'dailyVolume'],
  };

  const names = aliases[fieldName] || [fieldName];
  for (const name of names) {
    if (obj[name] !== undefined) return obj[name];
  }

  // Search one level deep
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      for (const name of names) {
        if ((value as any)[name] !== undefined) return (value as any)[name];
      }
    }
  }

  return undefined;
}
