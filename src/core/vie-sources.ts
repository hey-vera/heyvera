/**
 * VIE Data Source Fetching Layer — Verified Intelligence Engine
 *
 * Fetches raw data from 5 categories in parallel, each with a primary + fallback
 * endpoint. Uses the same x402Call pattern as the executor for x402 providers
 * and direct fetch for free/external endpoints.
 *
 * Categories:
 *   1. Contract Safety     — rugmunch-risk → claw-token-risk
 *   2. Holder Distribution — rugmunch-holder-analysis → claw-token-holders
 *   3. Historical Pattern  — apollo-osint → moltalyzer-token-intel
 *   4. Social Signal       — claw-x-mentions → twitsh-search
 *   5. On-Chain Activity   — dexscreener-token → claw-token-price
 */

import { findEndpoint, type ApiEndpoint } from '../config/api-registry';
import { isX402Ready, x402Call } from '../providers/x402-client';
import { round6 } from './credits';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NormalizedSignal {
  signal_name: string;
  value: number;        // 0-1 normalized
  weight: number;       // relative importance within category
  direction: 'positive' | 'negative' | 'neutral';
  raw_data: unknown;
  source_id: string;
  fetched_at: string;
}

export interface CategoryData {
  category: string;
  signals: NormalizedSignal[];
  source_id: string;
  fallback_used: boolean;
  fetch_duration_ms: number;
  error?: string;
}

export interface VieRawData {
  contract_safety: CategoryData | null;
  holder_distribution: CategoryData | null;
  historical_pattern: CategoryData | null;
  social_signal: CategoryData | null;
  onchain_activity: CategoryData | null;
  fetch_duration_ms: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;

// ─── Endpoint Calling ───────────────────────────────────────────────────────

/**
 * Call a registry endpoint by ID. Uses x402Call for x402 provider endpoints,
 * direct fetch for free external APIs (DexScreener, etc.).
 */
async function callEndpoint(
  endpointId: string,
  params: Record<string, string>,
): Promise<unknown> {
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) throw new Error(`Endpoint not found: ${endpointId}`);

  const path = endpoint.path;
  if (!path) throw new Error(`Endpoint ${endpointId} has no path`);

  // For endpoints with baseUrl that are NOT x402-paid (costPerCall === 0),
  // use direct fetch (e.g. DexScreener)
  if (endpoint.baseUrl && endpoint.costPerCall === 0) {
    return directFetch(endpoint, params);
  }

  // x402 provider call
  if (!isX402Ready()) {
    throw new Error('x402 client not initialized');
  }

  return x402Call(path, params, endpoint.baseUrl, AbortSignal.timeout(FETCH_TIMEOUT_MS));
}

/**
 * Direct fetch for free external APIs (no x402 payment required).
 * Handles path interpolation for patterns like /latest/dex/tokens/{address}.
 */
async function directFetch(
  endpoint: ApiEndpoint,
  params: Record<string, string>,
): Promise<unknown> {
  let path = endpoint.path ?? '';
  const queryParams: Record<string, string> = {};

  // Interpolate path parameters (e.g. {address})
  for (const [key, value] of Object.entries(params)) {
    if (path.includes(`{${key}}`)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    } else {
      queryParams[key] = value;
    }
  }

  const url = new URL(path, endpoint.baseUrl);
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`${endpoint.id} returned ${res.status}`);
  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSignal(
  name: string,
  value: number,
  weight: number,
  direction: 'positive' | 'negative' | 'neutral',
  rawData: unknown,
  sourceId: string,
): NormalizedSignal {
  return {
    signal_name: name,
    value: round6(Math.max(0, Math.min(1, value))),
    weight,
    direction,
    raw_data: rawData,
    source_id: sourceId,
    fetched_at: new Date().toISOString(),
  };
}

function signalDirection(value: number): 'positive' | 'negative' | 'neutral' {
  if (value >= 0.6) return 'positive';
  if (value <= 0.4) return 'negative';
  return 'neutral';
}

/**
 * Try primary endpoint, then fallback on failure. Returns null if both fail.
 */
async function fetchWithFallback(
  category: string,
  primaryId: string,
  fallbackId: string,
  params: Record<string, string>,
  normalize: (data: unknown, sourceId: string) => NormalizedSignal[],
): Promise<CategoryData | null> {
  const start = Date.now();

  // Try primary
  try {
    const data = await callEndpoint(primaryId, params);
    const signals = normalize(data, primaryId);
    return {
      category,
      signals,
      source_id: primaryId,
      fallback_used: false,
      fetch_duration_ms: Date.now() - start,
    };
  } catch (err) {
    const primaryError = err instanceof Error ? err.message : String(err);
    logger.warn({ category, endpointId: primaryId, error: primaryError }, 'VIE primary source failed, trying fallback');
  }

  // Try fallback
  try {
    const data = await callEndpoint(fallbackId, params);
    const signals = normalize(data, fallbackId);
    return {
      category,
      signals,
      source_id: fallbackId,
      fallback_used: true,
      fetch_duration_ms: Date.now() - start,
    };
  } catch (err) {
    const fallbackError = err instanceof Error ? err.message : String(err);
    logger.error({ category, primaryId, fallbackId, error: fallbackError }, 'VIE both sources failed');
    return null;
  }
}

// ─── Category Fetchers ──────────────────────────────────────────────────────

/**
 * Contract Safety — primary: rugmunch-risk, fallback: claw-token-risk
 */
async function fetchContractSafety(target: string, chain: string): Promise<CategoryData | null> {
  return fetchWithFallback(
    'contract_safety',
    'rugmunch-risk',
    'claw-token-risk',
    { address: target, chain },
    (data: unknown, sourceId: string) => {
      const d = data as Record<string, unknown>;
      const signals: NormalizedSignal[] = [];

      if (sourceId === 'rugmunch-risk') {
        // Full risk response — normalize each field
        const verifiedSource = Boolean(d.verifiedSource ?? d.verified_source);
        signals.push(makeSignal('verified_source', verifiedSource ? 1.0 : 0.0, 0.20, verifiedSource ? 'positive' : 'negative', verifiedSource, sourceId));

        const isProxy = Boolean(d.isProxy ?? d.is_proxy);
        const proxyVal = isProxy ? 0.0 : 1.0;
        signals.push(makeSignal('is_proxy', proxyVal, 0.15, signalDirection(proxyVal), isProxy, sourceId));

        const mintRevoked = Boolean(d.mintAuthorityRevoked ?? d.mint_authority_revoked ?? !d.mintAuthority);
        signals.push(makeSignal('mint_authority_revoked', mintRevoked ? 1.0 : 0.0, 0.20, mintRevoked ? 'positive' : 'negative', mintRevoked, sourceId));

        const freezeAuth = Boolean(d.freezeAuthority ?? d.freeze_authority);
        const freezeVal = freezeAuth ? 0.0 : 1.0;
        signals.push(makeSignal('freeze_authority', freezeVal, 0.15, signalDirection(freezeVal), freezeAuth, sourceId));

        const ageDays = Number(d.contractAgeDays ?? d.contract_age_days ?? 0);
        const ageVal = round6(Math.min(ageDays / 365, 1.0));
        signals.push(makeSignal('contract_age_days', ageVal, 0.15, signalDirection(ageVal), ageDays, sourceId));

        const honeypot = Boolean(d.honeypot ?? d.isHoneypot);
        signals.push(makeSignal('honeypot', honeypot ? 0.0 : 1.0, 0.15, honeypot ? 'negative' : 'positive', honeypot, sourceId));
      } else {
        // claw-token-risk fallback — less granular, map what we can
        const riskScore = Number(d.riskScore ?? 50);
        const safetyVal = round6(1.0 - riskScore / 100);
        signals.push(makeSignal('overall_safety', safetyVal, 0.40, signalDirection(safetyVal), riskScore, sourceId));

        const mintAuth = Boolean(d.mintAuthority);
        signals.push(makeSignal('mint_authority_revoked', mintAuth ? 0.0 : 1.0, 0.20, mintAuth ? 'negative' : 'positive', mintAuth, sourceId));

        const freezeAuth = Boolean(d.freezeAuthority);
        const freezeVal = freezeAuth ? 0.0 : 1.0;
        signals.push(makeSignal('freeze_authority', freezeVal, 0.15, signalDirection(freezeVal), freezeAuth, sourceId));

        const lpLocked = Boolean(d.lpLocked);
        signals.push(makeSignal('liquidity_locked', lpLocked ? 1.0 : 0.0, 0.25, lpLocked ? 'positive' : 'negative', lpLocked, sourceId));
      }

      return signals;
    },
  );
}

/**
 * Holder Distribution — primary: rugmunch-holder-analysis, fallback: claw-token-holders
 */
async function fetchHolderDistribution(target: string, chain: string): Promise<CategoryData | null> {
  return fetchWithFallback(
    'holder_distribution',
    'rugmunch-holder-analysis',
    'claw-token-holders',
    { address: target, chain },
    (data: unknown, sourceId: string) => {
      const d = data as Record<string, unknown>;
      const signals: NormalizedSignal[] = [];

      if (sourceId === 'rugmunch-holder-analysis') {
        const top10Pct = Number(d.top10Pct ?? d.top10_concentration ?? 50);
        const concVal = round6(1.0 - top10Pct / 100);
        signals.push(makeSignal('top10_concentration', concVal, 0.30, signalDirection(concVal), top10Pct, sourceId));

        const liqLocked = Boolean(d.liquidityLocked ?? d.liquidity_locked);
        signals.push(makeSignal('liquidity_locked', liqLocked ? 1.0 : 0.0, 0.25, liqLocked ? 'positive' : 'negative', liqLocked, sourceId));

        const lockDays = Number(d.lockDurationDays ?? d.lock_duration_days ?? 0);
        const lockVal = round6(Math.min(lockDays / 365, 1.0));
        signals.push(makeSignal('lock_duration_days', lockVal, 0.20, signalDirection(lockVal), lockDays, sourceId));

        const holders = Number(d.holderCount ?? d.totalHolders ?? d.unique_holders ?? 0);
        const holderVal = round6(Math.min(holders / 10000, 1.0));
        signals.push(makeSignal('unique_holders', holderVal, 0.15, signalDirection(holderVal), holders, sourceId));

        const devPct = Number(d.devWalletPct ?? d.dev_wallet_pct ?? 0);
        const devVal = round6(1.0 - Math.min(devPct / 20, 1.0));
        signals.push(makeSignal('dev_wallet_pct', devVal, 0.10, signalDirection(devVal), devPct, sourceId));
      } else {
        // claw-token-holders fallback
        const top10 = Number(d.top10Concentration ?? 50);
        const concVal = round6(1.0 - top10 / 100);
        signals.push(makeSignal('top10_concentration', concVal, 0.40, signalDirection(concVal), top10, sourceId));

        const holders = Number(d.totalHolders ?? 0);
        const holderVal = round6(Math.min(holders / 10000, 1.0));
        signals.push(makeSignal('unique_holders', holderVal, 0.30, signalDirection(holderVal), holders, sourceId));

        // top25 as supplementary signal
        const top25 = Number(d.top25Concentration ?? 50);
        const top25Val = round6(1.0 - top25 / 100);
        signals.push(makeSignal('top25_concentration', top25Val, 0.30, signalDirection(top25Val), top25, sourceId));
      }

      return signals;
    },
  );
}

/**
 * Historical Pattern — primary: apollo-osint, fallback: moltalyzer-token-intel
 */
async function fetchHistoricalPattern(target: string, chain: string): Promise<CategoryData | null> {
  return fetchWithFallback(
    'historical_pattern',
    'apollo-osint',
    'moltalyzer-token-intel',
    { target, chain, depth: 'shallow' },
    (data: unknown, sourceId: string) => {
      const d = data as Record<string, unknown>;
      const signals: NormalizedSignal[] = [];

      if (sourceId === 'apollo-osint') {
        const pastRugs = Number(d.deployerPastRugs ?? d.deployer_past_rugs ?? 0);
        signals.push(makeSignal('deployer_past_rugs', pastRugs > 0 ? 0.0 : 1.0, 0.40, pastRugs > 0 ? 'negative' : 'positive', pastRugs, sourceId));

        const successfulTxns = Number(d.successfulInteractions ?? d.successful_interactions ?? 0);
        const txnVal = round6(Math.min(successfulTxns / 10000, 1.0));
        signals.push(makeSignal('successful_interactions', txnVal, 0.30, signalDirection(txnVal), successfulTxns, sourceId));

        const incidents = Number(d.incidentCount ?? d.incident_count ?? 0);
        const incidentVal = round6(Math.max(0, 1.0 - incidents * 0.2));
        signals.push(makeSignal('incident_count', incidentVal, 0.30, signalDirection(incidentVal), incidents, sourceId));
      } else {
        // moltalyzer-token-intel fallback
        const legitimacy = Number(d.legitimacyScore ?? d.legitimacy_score ?? 50);
        const legVal = round6(Math.min(legitimacy / 100, 1.0));
        signals.push(makeSignal('legitimacy_score', legVal, 0.40, signalDirection(legVal), legitimacy, sourceId));

        const insiderActivity = Boolean(d.insiderActivity ?? d.insider_activity);
        signals.push(makeSignal('insider_activity', insiderActivity ? 0.0 : 1.0, 0.30, insiderActivity ? 'negative' : 'positive', insiderActivity, sourceId));

        const washScore = Number(d.washTradingScore ?? d.wash_trading_score ?? 0);
        const washVal = round6(Math.max(0, 1.0 - washScore / 100));
        signals.push(makeSignal('wash_trading', washVal, 0.30, signalDirection(washVal), washScore, sourceId));
      }

      return signals;
    },
  );
}

/**
 * Social Signal — primary: claw-x-mentions, fallback: twitsh-search
 */
async function fetchSocialSignal(target: string, chain: string): Promise<CategoryData | null> {
  return fetchWithFallback(
    'social_signal',
    'claw-x-mentions',
    'twitsh-search',
    { query: `${target} crypto`, max_results: '50' },
    (data: unknown, sourceId: string) => {
      const d = data as Record<string, unknown>;
      const signals: NormalizedSignal[] = [];

      if (sourceId === 'claw-x-mentions') {
        const sentiment = Number(d.sentimentScore ?? d.sentiment_score ?? 0.5);
        signals.push(makeSignal('sentiment_score', sentiment, 0.30, signalDirection(sentiment), sentiment, sourceId));

        const botPct = Number(d.botPercentage ?? d.bot_percentage ?? 0);
        const botVal = round6(1.0 - botPct / 100);
        signals.push(makeSignal('bot_percentage', botVal, 0.30, signalDirection(botVal), botPct, sourceId));

        const mentions = Number(d.mentionCount ?? d.mention_count ?? 0);
        const mentionVal = round6(Math.min(mentions / 1000, 1.0));
        signals.push(makeSignal('mention_count', mentionVal, 0.15, signalDirection(mentionVal), mentions, sourceId));

        const organic = Boolean(d.organicGrowth ?? d.organic_growth);
        signals.push(makeSignal('organic_growth', organic ? 1.0 : 0.0, 0.25, organic ? 'positive' : 'negative', organic, sourceId));
      } else {
        // twitsh-search fallback — less structured, extract what we can
        const tweets = Array.isArray(d.tweets) ? d.tweets : [];
        const count = Number(d.count ?? tweets.length ?? 0);
        const mentionVal = round6(Math.min(count / 1000, 1.0));
        signals.push(makeSignal('mention_count', mentionVal, 0.40, signalDirection(mentionVal), count, sourceId));

        // Derive engagement signal from tweet metrics
        let totalEngagement = 0;
        for (const tweet of tweets.slice(0, 50)) {
          const t = tweet as Record<string, unknown>;
          totalEngagement += Number(t.likes ?? 0) + Number(t.retweets ?? 0);
        }
        const engagementVal = round6(Math.min(totalEngagement / 10000, 1.0));
        signals.push(makeSignal('engagement', engagementVal, 0.30, signalDirection(engagementVal), totalEngagement, sourceId));

        // Volume as proxy for organic interest
        const volumeVal = round6(Math.min(count / 500, 1.0));
        signals.push(makeSignal('volume_proxy', volumeVal, 0.30, signalDirection(volumeVal), count, sourceId));
      }

      return signals;
    },
  );
}

/**
 * On-Chain Activity — primary: dexscreener-token, fallback: claw-token-price
 */
async function fetchOnChainActivity(target: string, chain: string): Promise<CategoryData | null> {
  return fetchWithFallback(
    'onchain_activity',
    'dexscreener-token',
    'claw-token-price',
    { address: target, mintAddress: target },
    (data: unknown, sourceId: string) => {
      const d = data as Record<string, unknown>;
      const signals: NormalizedSignal[] = [];

      if (sourceId === 'dexscreener-token') {
        // DexScreener returns { pairs: [...] } — use the first/primary pair
        const pairs = Array.isArray(d.pairs) ? d.pairs : [];
        const pair = (pairs[0] ?? {}) as Record<string, unknown>;

        const volume = pair.volume as Record<string, unknown> | undefined;
        const vol24h = Number(volume?.h24 ?? 0);
        const volVal = round6(Math.min(vol24h / 1_000_000, 1.0));
        signals.push(makeSignal('volume_24h', volVal, 0.25, signalDirection(volVal), vol24h, sourceId));

        const liquidity = pair.liquidity as Record<string, unknown> | undefined;
        const liqUsd = Number(liquidity?.usd ?? 0);
        const liqVal = round6(Math.min(liqUsd / 500_000, 1.0));
        signals.push(makeSignal('liquidity_usd', liqVal, 0.25, signalDirection(liqVal), liqUsd, sourceId));

        const txns = pair.txns as Record<string, unknown> | undefined;
        const h24 = txns?.h24 as Record<string, unknown> | undefined;
        const buys = Number(h24?.buys ?? 0);
        const sells = Number(h24?.sells ?? 0);
        const ratio = sells > 0 ? buys / sells : 1.0;
        const ratioVal = round6(Math.max(0, 1.0 - Math.abs(ratio - 1.0)));
        signals.push(makeSignal('buy_sell_ratio', ratioVal, 0.25, signalDirection(ratioVal), ratio, sourceId));

        const priceChange = pair.priceChange as Record<string, unknown> | undefined;
        const change24h = Number(priceChange?.h24 ?? 0);
        // Extreme changes (>50% either direction) are negative signals
        const changeAbs = Math.abs(change24h);
        const changeVal = round6(Math.max(0, 1.0 - changeAbs / 100));
        signals.push(makeSignal('price_change_24h', changeVal, 0.25, changeAbs > 20 ? 'negative' : signalDirection(changeVal), change24h, sourceId));
      } else {
        // claw-token-price fallback — less DEX-specific data
        const vol24h = Number(d.volume24h ?? 0);
        const volVal = round6(Math.min(vol24h / 1_000_000, 1.0));
        signals.push(makeSignal('volume_24h', volVal, 0.30, signalDirection(volVal), vol24h, sourceId));

        const liqUsd = Number(d.liquidity ?? 0);
        const liqVal = round6(Math.min(liqUsd / 500_000, 1.0));
        signals.push(makeSignal('liquidity_usd', liqVal, 0.30, signalDirection(liqVal), liqUsd, sourceId));

        const change24h = Number(d.change24h ?? 0);
        const changeAbs = Math.abs(change24h);
        const changeVal = round6(Math.max(0, 1.0 - changeAbs / 100));
        signals.push(makeSignal('price_change_24h', changeVal, 0.40, changeAbs > 20 ? 'negative' : signalDirection(changeVal), change24h, sourceId));
      }

      return signals;
    },
  );
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Fetch all 5 VIE data categories in parallel.
 * Each category has a primary + fallback endpoint.
 * Returns null for any category where both sources fail.
 */
export async function fetchAllSources(
  target: string,
  targetType: string,
  chain: string,
): Promise<VieRawData> {
  const start = Date.now();

  logger.info({ target, targetType, chain }, 'VIE: fetching all sources');

  const results = await Promise.allSettled([
    fetchContractSafety(target, chain),
    fetchHolderDistribution(target, chain),
    fetchHistoricalPattern(target, chain),
    fetchSocialSignal(target, chain),
    fetchOnChainActivity(target, chain),
  ]);

  const extract = (r: PromiseSettledResult<CategoryData | null>): CategoryData | null => {
    if (r.status === 'fulfilled') return r.value;
    logger.error({ error: r.reason }, 'VIE: category fetcher threw unexpectedly');
    return null;
  };

  const rawData: VieRawData = {
    contract_safety: extract(results[0]),
    holder_distribution: extract(results[1]),
    historical_pattern: extract(results[2]),
    social_signal: extract(results[3]),
    onchain_activity: extract(results[4]),
    fetch_duration_ms: Date.now() - start,
  };

  const succeeded = [rawData.contract_safety, rawData.holder_distribution, rawData.historical_pattern, rawData.social_signal, rawData.onchain_activity].filter(Boolean).length;
  logger.info({ succeeded, total: 5, durationMs: rawData.fetch_duration_ms }, 'VIE: source fetch complete');

  return rawData;
}
