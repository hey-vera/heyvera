/**
 * Vouch ranking — trust-weighted provider scoring for Soma Vouch.
 *
 * Positioning: industry is converging on "bazaar/directory" as the commodity
 * discovery layer (A2A Protocol, MCP bazaar, x402 self-propagation). Discovery
 * is table-stakes. The unsolved problem is *which* discovered provider to
 * trust. Vouch is the trust-attestation layer that sits on top of any
 * directory — we rank providers by signals nobody else has: verdict history,
 * delegation lineage, Soma tier, observer attestations.
 *
 * Formula (each factor normalized 0..1, then combined):
 *   base = 0.40*trust + 0.20*volume + 0.20*tenure + 0.10*freshness + 0.10*hits
 *   score = base * soma_bonus   (1.00 plain / 1.15 soma_enabled / 1.25 verified / 1.30 champion)
 *
 * Returns 0..100 so callers can display directly.
 */

export interface VouchRankInputs {
  trustScore: number;          // provider.trust_score (0..100, default 50)
  totalCalls: number;          // lifetime calls
  totalCacheHits: number;      // lifetime cache hits
  createdAt: string;           // ISO timestamp of provider registration
  lastCallAt: string | null;   // most recent call, null if never called
  somaEnabled: boolean;
  verified: boolean;
  somaCheckTier: number;       // 0..3
}

export interface VouchRankResult {
  score: number;          // 0..100
  factors: {
    trust: number;
    volume: number;
    tenure: number;
    freshness: number;
    hits: number;
    somaBonus: number;
  };
}

const DAY_MS = 86_400_000;

export function rankProvider(inp: VouchRankInputs): VouchRankResult {
  const trust = clamp01((inp.trustScore || 50) / 100);

  // Volume: saturates at 10K calls.
  const volume = clamp01(inp.totalCalls / 10_000);

  // Tenure: saturates at 90 days of history.
  const ageDays = Math.max(0, (Date.now() - new Date(inp.createdAt).getTime()) / DAY_MS);
  const tenure = clamp01(ageDays / 90);

  // Freshness: 1.0 if called within last 24h, decays over 14 days, 0 after 14d.
  // If never called, score = 0.
  let freshness = 0;
  if (inp.lastCallAt) {
    const staleDays = Math.max(0, (Date.now() - new Date(inp.lastCallAt).getTime()) / DAY_MS);
    freshness = staleDays <= 1 ? 1 : clamp01(1 - (staleDays - 1) / 13);
  }

  // Hit-rate: saturates at 50%. Rewards providers whose content actually
  // benefits from Soma Check (= volatile-but-cacheable).
  const hitRate = inp.totalCalls > 0 ? inp.totalCacheHits / inp.totalCalls : 0;
  const hits = clamp01(hitRate / 0.5);

  const base = 0.40 * trust + 0.20 * volume + 0.20 * tenure + 0.10 * freshness + 0.10 * hits;

  // Soma bonus: reward providers who've actively engaged the protocol.
  let somaBonus = 1.00;
  if (inp.somaEnabled) somaBonus = 1.15;
  if (inp.verified) somaBonus = 1.25;
  if (inp.somaCheckTier >= 3) somaBonus = 1.30;

  const raw = base * somaBonus;
  const score = Math.round(Math.min(1, raw) * 10000) / 100;

  return {
    score,
    factors: { trust, volume, tenure, freshness, hits, somaBonus },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1 ? 1 : n;
}
