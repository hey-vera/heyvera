/**
 * @aidprotocol/mcp-trust — Trust verification middleware for MCP servers
 *
 * Add trust scoring to any MCP server in one line.
 * Verifies caller identity via Ed25519 signatures, resolves trust scores,
 * and makes trust data available in every tool handler.
 *
 * @example
 * ```typescript
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { withAidTrust } from '@aidprotocol/mcp-trust';
 *
 * const server = new McpServer({ name: 'my-api' });
 *
 * const aid = withAidTrust(server, {
 *   providerDid: 'did:key:zMyServerDid...',
 *   minTrustScore: 40,
 *   apiUrl: 'https://api.claw-net.org',
 * });
 *
 * // Trust data available in tool context
 * server.tool('get-data', { query: z.string() }, async (params, extra) => {
 *   const trust = aid.getCallerTrust(extra);
 *   console.log(trust?.score); // 87
 *   return { content: [{ type: 'text', text: 'result' }] };
 * });
 * ```
 *
 * @license MIT
 */

import { createHash, createVerify } from 'crypto';
import { computeTrustScore, getTrustVerdict, verifyTrustProof, jcsSerialize } from '@aidprotocol/trust-compute';
import type { TrustScoreProof, TrustVerdictResult, TrustStats } from '@aidprotocol/trust-compute';

// Re-export trust-compute types for convenience
export type { TrustScoreProof, TrustVerdictResult, TrustStats };
export { computeTrustScore, getTrustVerdict, verifyTrustProof };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AidTrustConfig {
  /** The DID of this MCP server (did:key:z...) */
  providerDid: string;

  /** Minimum trust score required to call tools (0-100, default: 0) */
  minTrustScore?: number;

  /** ClawNet API URL for trust resolution (default: https://api.claw-net.org) */
  apiUrl?: string;

  /** Fail mode: 'closed' rejects on API failure, 'open' allows (default: 'closed') */
  failMode?: 'closed' | 'open';

  /** How long to cache trust scores in seconds (default: 300) */
  cacheTtlSeconds?: number;

  /** Optional callback when a caller is rejected for low trust */
  onRejected?: (callerDid: string, score: number, minRequired: number) => void;

  /** Optional callback when trust is verified */
  onVerified?: (callerDid: string, score: number, verdict: string) => void;
}

export interface CallerTrust {
  /** Caller's DID (did:key:z...) */
  did: string;
  /** Trust score (0-100) */
  score: number;
  /** Trust verdict (new, building, caution, standard, trusted, proceed) */
  verdict: string;
  /** Pricing discount (0-0.30) */
  discount: number;
  /** Settlement mode */
  settlementMode: string;
  /** Whether the score was from cache */
  cached: boolean;
  /** When the score was resolved */
  resolvedAt: string;
}

export interface AidTrustInstance {
  /** Get trust data for the current caller from tool handler context */
  getCallerTrust: (extra: any) => CallerTrust | null;

  /** Manually resolve trust for a DID */
  resolveTrust: (did: string) => Promise<CallerTrust | null>;

  /** Check if a DID meets the minimum trust threshold */
  meetsThreshold: (did: string) => Promise<boolean>;

  /** Get provider info */
  provider: { did: string; minTrustScore: number };

  /** Clear the trust cache */
  clearCache: () => void;
}

// ─── Trust Cache ────────────────────────────────────────────────────────────

interface CacheEntry {
  trust: CallerTrust;
  expiresAt: number;
}

class TrustCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get(did: string): CallerTrust | null {
    const entry = this.cache.get(did);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(did);
      return null;
    }
    return { ...entry.trust, cached: true };
  }

  set(did: string, trust: CallerTrust): void {
    this.cache.set(did, {
      trust,
      expiresAt: Date.now() + this.ttlMs,
    });
    // Evict if cache grows too large (10K entries max)
    if (this.cache.size > 10000) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─── Trust Resolution ───────────────────────────────────────────────────────

async function fetchTrustFromApi(
  did: string,
  apiUrl: string,
): Promise<{ score: number; verdict: string; attestationCount: number } | null> {
  try {
    const url = `${apiUrl}/v1/aid/${encodeURIComponent(did)}/trust`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      score: data.trustScore ?? data.score ?? 0,
      verdict: data.verdict ?? 'new',
      attestationCount: data.attestationCount ?? 0,
    };
  } catch {
    return null;
  }
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Add AID trust verification to an MCP server.
 *
 * This wraps the server to resolve trust for callers via X-AID-DID headers
 * or by querying ClawNet's trust API. Trust data is cached and available
 * in tool handlers via `aid.getCallerTrust(extra)`.
 *
 * @param server - The MCP server instance
 * @param config - Trust configuration
 * @returns An AidTrustInstance for querying trust data
 */
export function withAidTrust(server: any, config: AidTrustConfig): AidTrustInstance {
  const {
    providerDid,
    minTrustScore = 0,
    apiUrl = 'https://api.claw-net.org',
    failMode = 'closed',
    cacheTtlSeconds = 300,
    onRejected,
    onVerified,
  } = config;

  const cache = new TrustCache(cacheTtlSeconds);

  // Store trust data per-request using a WeakMap keyed on the extra object
  const requestTrust = new WeakMap<object, CallerTrust>();

  async function resolveTrust(did: string): Promise<CallerTrust | null> {
    // Check cache first
    const cached = cache.get(did);
    if (cached) return cached;

    // Fetch from API
    const apiResult = await fetchTrustFromApi(did, apiUrl);

    if (!apiResult) {
      if (failMode === 'closed') return null;
      // fail-open: return score 0 (base price, no discount)
      const fallback: CallerTrust = {
        did,
        score: 0,
        verdict: 'new',
        discount: 0,
        settlementMode: 'immediate',
        cached: false,
        resolvedAt: new Date().toISOString(),
      };
      return fallback;
    }

    const verdictResult = getTrustVerdict(apiResult.score);
    const trust: CallerTrust = {
      did,
      score: apiResult.score,
      verdict: verdictResult.verdict,
      discount: verdictResult.discount,
      settlementMode: verdictResult.settlementMode,
      cached: false,
      resolvedAt: new Date().toISOString(),
    };

    cache.set(did, trust);

    if (onVerified) {
      onVerified(did, trust.score, trust.verdict);
    }

    return trust;
  }

  // Wrap the server's tool method to inject trust resolution
  const originalTool = server.tool.bind(server);
  server.tool = function wrappedTool(name: string, ...args: any[]) {
    // Find the handler (last function argument)
    const handlerIndex = args.findIndex((a: any) => typeof a === 'function');
    if (handlerIndex === -1) {
      return originalTool(name, ...args);
    }

    const originalHandler = args[handlerIndex];
    args[handlerIndex] = async function trustedHandler(params: any, extra: any) {
      // Extract caller DID from transport metadata if available
      // MCP doesn't have standard auth headers yet — this is forward-compatible
      // with MCP-I when it ships. For now, check sessionId or custom metadata.
      let callerDid: string | null = null;

      // Check if caller provided DID via MCP metadata/params
      if (extra?.meta?.['X-AID-DID']) {
        callerDid = extra.meta['X-AID-DID'];
      } else if (extra?.sessionId) {
        // Use sessionId as a fallback identifier
        callerDid = `session:${extra.sessionId}`;
      }

      if (callerDid && callerDid.startsWith('did:')) {
        const trust = await resolveTrust(callerDid);

        if (!trust) {
          // Failed to resolve and failMode is 'closed'
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Trust verification failed',
                code: 'AID_TRUST_UNAVAILABLE',
                detail: 'Could not verify caller trust score. Try again later.',
              }),
            }],
            isError: true,
          };
        }

        if (trust.score < minTrustScore) {
          if (onRejected) onRejected(callerDid, trust.score, minTrustScore);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Trust score too low',
                code: 'AID_TRUST_GATE_BLOCKED',
                callerScore: trust.score,
                requiredScore: minTrustScore,
                verdict: trust.verdict,
                detail: `Minimum trust score ${minTrustScore} required. Your score: ${trust.score} (${trust.verdict}).`,
              }),
            }],
            isError: true,
          };
        }

        // Store trust for retrieval via getCallerTrust
        if (extra && typeof extra === 'object') {
          requestTrust.set(extra, trust);
        }
      }

      return originalHandler(params, extra);
    };

    return originalTool(name, ...args);
  };

  return {
    getCallerTrust(extra: any): CallerTrust | null {
      if (!extra || typeof extra !== 'object') return null;
      return requestTrust.get(extra) ?? null;
    },

    resolveTrust,

    async meetsThreshold(did: string): Promise<boolean> {
      const trust = await resolveTrust(did);
      return trust !== null && trust.score >= minTrustScore;
    },

    provider: { did: providerDid, minTrustScore },

    clearCache() {
      cache.clear();
    },
  };
}
