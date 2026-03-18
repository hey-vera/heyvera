/**
 * Context Engine — ClawNet Intelligence Skill #2
 *
 * Answers: "What does this mean?" Takes any crypto entity and returns:
 *   - Normalized profile (consistent schema regardless of data source)
 *   - Current state with key metrics
 *   - Anomaly detection against historical baselines
 *   - LLM-enriched narrative explaining what's happening and why
 *
 * Data sources: claw-token-price, claw-token-metadata, claw-token-holders,
 *   coingecko-price, coingecko-history, coinank-fear-greed, claw-x-mentions,
 *   gloria-news
 *
 * All math uses round6() to prevent floating-point drift.
 */

import { findEndpoint, type ApiEndpoint } from '../config/api-registry';
import { isClawApisReady, clawApiCall } from '../providers/clawapis';
import { round6 } from './credits';
import { llmComplete, type LlmMessage } from '../providers/llm';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContextResult {
  entity: {
    address: string;
    type: string;
    chain: string;
    name?: string;
    symbol?: string;
  };
  state: {
    price_usd: number | null;
    price_change_24h: number | null;
    volume_24h: number | null;
    market_cap: number | null;
    holders: number | null;
    liquidity_usd: number | null;
  };
  anomalies: Array<{
    metric: string;
    current: number;
    baseline_30d: number;
    deviation_pct: number;
    severity: 'info' | 'warning' | 'critical';
    description: string;
  }>;
  context_score: number;       // 0-100 (higher = more noteworthy/anomalous activity)
  confidence: number;          // 0.0-1.0
  summary: string;             // 1-line context summary
  enrichment?: string;         // LLM-generated narrative (Standard/Deep tier)
  related_vie_score?: number;  // from intel_scores if available
  data_sources: string[];
}

interface RawStateData {
  price_usd: number | null;
  price_change_24h: number | null;
  volume_24h: number | null;
  market_cap: number | null;
  holders: number | null;
  liquidity_usd: number | null;
  name: string | null;
  symbol: string | null;
  fear_greed: number | null;
  fear_greed_label: string | null;
  mention_count: number | null;
  sentiment_score: number | null;
  sentiment_label: string | null;
  news_sentiment: string | null;
  top_headline: string | null;
  sources: string[];
}

interface HistoricalBaseline {
  price_avg: number | null;
  price_std: number | null;
  volume_avg: number | null;
  volume_std: number | null;
  market_cap_avg: number | null;
  market_cap_std: number | null;
  mention_avg: number | null;
  mention_std: number | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;

const ANOMALY_THRESHOLD_WARNING = 2.0;   // 2 standard deviations
const ANOMALY_THRESHOLD_CRITICAL = 3.5;  // 3.5 standard deviations

// ─── Endpoint Calling ───────────────────────────────────────────────────────

async function callEndpoint(
  endpointId: string,
  params: Record<string, string>,
): Promise<unknown> {
  const endpoint = findEndpoint(endpointId);
  if (!endpoint) throw new Error(`Endpoint not found: ${endpointId}`);

  const path = endpoint.path;
  if (!path) throw new Error(`Endpoint ${endpointId} has no path`);

  // Free external APIs (costPerCall === 0 with a baseUrl) — direct fetch
  if (endpoint.baseUrl && endpoint.costPerCall === 0) {
    return directFetch(endpoint, params);
  }

  // x402/ClawAPIs
  if (!isClawApisReady()) {
    throw new Error('ClawAPIs x402 not initialized');
  }

  return clawApiCall(path, params, endpoint.baseUrl, AbortSignal.timeout(FETCH_TIMEOUT_MS));
}

async function directFetch(
  endpoint: ApiEndpoint,
  params: Record<string, string>,
): Promise<unknown> {
  let path = endpoint.path ?? '';
  const queryParams: Record<string, string> = {};

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

// ─── Safe Fetcher (never throws) ────────────────────────────────────────────

async function safeFetch(endpointId: string, params: Record<string, string>): Promise<unknown | null> {
  try {
    return await callEndpoint(endpointId, params);
  } catch (err) {
    logger.warn({ endpointId, error: err instanceof Error ? err.message : String(err) }, 'Context Engine: source fetch failed');
    return null;
  }
}

// ─── Data Fetching (parallel) ───────────────────────────────────────────────

async function fetchCurrentState(
  target: string,
  targetType: string,
  chain: string,
): Promise<RawStateData> {
  const sources: string[] = [];

  // Fire all fetches in parallel
  const [
    priceData,
    metaData,
    holdersData,
    coingeckoData,
    fearGreedData,
    socialData,
    newsData,
  ] = await Promise.all([
    safeFetch('claw-token-price', { mintAddress: target }),
    safeFetch('claw-token-metadata', { mintAddress: target }),
    safeFetch('claw-token-holders', { mintAddress: target, limit: '20' }),
    safeFetch('coingecko-price', { ids: target, vs_currencies: 'usd' }),
    safeFetch('coinank-fear-greed', { days: '1' }),
    safeFetch('claw-x-mentions', { query: target, limit: '30' }),
    safeFetch('gloria-news', { query: target, limit: '5' }),
  ]);

  // Extract price — prefer claw-token-price, fall back to coingecko
  let price_usd: number | null = null;
  let price_change_24h: number | null = null;
  let volume_24h: number | null = null;
  let market_cap: number | null = null;
  let liquidity_usd: number | null = null;

  if (priceData) {
    const d = priceData as Record<string, unknown>;
    price_usd = safeNum(d.priceUsd ?? d.price_usd ?? d.price);
    price_change_24h = safeNum(d.change24h ?? d.price_change_24h);
    volume_24h = safeNum(d.volume24h ?? d.volume_24h);
    market_cap = safeNum(d.marketCap ?? d.market_cap);
    liquidity_usd = safeNum(d.liquidity ?? d.liquidity_usd);
    sources.push('claw-token-price');
  }

  if (coingeckoData && price_usd === null) {
    const d = coingeckoData as Record<string, unknown>;
    // coingecko returns { [id]: { usd: ..., usd_market_cap: ..., usd_24h_vol: ..., usd_24h_change: ... } }
    const inner = (d[target] ?? Object.values(d)[0]) as Record<string, unknown> | undefined;
    if (inner) {
      price_usd = safeNum(inner.usd);
      price_change_24h = safeNum(inner.usd_24h_change);
      volume_24h = safeNum(inner.usd_24h_vol);
      market_cap = safeNum(inner.usd_market_cap);
      sources.push('coingecko-price');
    }
  } else if (coingeckoData) {
    sources.push('coingecko-price');
  }

  // Extract metadata
  let name: string | null = null;
  let symbol: string | null = null;

  if (metaData) {
    const d = metaData as Record<string, unknown>;
    name = typeof d.name === 'string' ? d.name : null;
    symbol = typeof d.symbol === 'string' ? d.symbol : null;
    sources.push('claw-token-metadata');
  }

  // Extract holders
  let holders: number | null = null;

  if (holdersData) {
    const d = holdersData as Record<string, unknown>;
    holders = safeNum(d.totalHolders ?? d.total_holders ?? d.holderCount);
    sources.push('claw-token-holders');
  }

  // Extract fear & greed
  let fear_greed: number | null = null;
  let fear_greed_label: string | null = null;

  if (fearGreedData) {
    const d = fearGreedData as Record<string, unknown>;
    fear_greed = safeNum(d.value ?? d.score);
    fear_greed_label = typeof d.classification === 'string' ? d.classification : null;
    sources.push('coinank-fear-greed');
  }

  // Extract social
  let mention_count: number | null = null;
  let sentiment_score: number | null = null;
  let sentiment_label: string | null = null;

  if (socialData) {
    const d = socialData as Record<string, unknown>;
    mention_count = safeNum(d.mentionCount ?? d.mention_count);
    sentiment_score = safeNum(d.sentimentScore ?? d.sentiment_score);
    sentiment_label = typeof (d.sentimentLabel ?? d.sentiment_label) === 'string'
      ? (d.sentimentLabel ?? d.sentiment_label) as string : null;
    sources.push('claw-x-mentions');
  }

  // Extract news
  let news_sentiment: string | null = null;
  let top_headline: string | null = null;

  if (newsData) {
    const d = newsData as Record<string, unknown>;
    const breakdown = d.sentimentBreakdown as Record<string, unknown> | undefined;
    if (breakdown) {
      const pos = safeNum(breakdown.positive) ?? 0;
      const neg = safeNum(breakdown.negative) ?? 0;
      news_sentiment = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
    }
    const headlines = d.topHeadlines as unknown[] | undefined;
    if (Array.isArray(headlines) && headlines.length > 0) {
      const first = headlines[0] as Record<string, unknown>;
      top_headline = typeof first.title === 'string' ? first.title : null;
    }
    sources.push('gloria-news');
  }

  return {
    price_usd,
    price_change_24h,
    volume_24h,
    market_cap,
    holders,
    liquidity_usd,
    name,
    symbol,
    fear_greed,
    fear_greed_label,
    mention_count,
    sentiment_score,
    sentiment_label,
    news_sentiment,
    top_headline,
    sources,
  };
}

// ─── Historical Baselines (from intel_events, last 30 days) ─────────────────

function fetchHistoricalBaseline(target: string, chain: string): HistoricalBaseline {
  const defaults: HistoricalBaseline = {
    price_avg: null, price_std: null,
    volume_avg: null, volume_std: null,
    market_cap_avg: null, market_cap_std: null,
    mention_avg: null, mention_std: null,
  };

  try {
    const { getIntelEvents } = require('../db/intel');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const events: Array<{ payload_json: string }> = getIntelEvents(target, chain, {
      skillId: 'context',
      eventType: 'STATE_SNAPSHOT',
      limit: 200,
      since: thirtyDaysAgo,
    });

    if (events.length < 3) return defaults;

    const prices: number[] = [];
    const volumes: number[] = [];
    const caps: number[] = [];
    const mentions: number[] = [];

    for (const evt of events) {
      try {
        const payload = JSON.parse(evt.payload_json);
        if (payload.price_usd != null) prices.push(Number(payload.price_usd));
        if (payload.volume_24h != null) volumes.push(Number(payload.volume_24h));
        if (payload.market_cap != null) caps.push(Number(payload.market_cap));
        if (payload.mention_count != null) mentions.push(Number(payload.mention_count));
      } catch {
        // skip malformed events
      }
    }

    return {
      price_avg: prices.length >= 3 ? round6(avg(prices)) : null,
      price_std: prices.length >= 3 ? round6(stdDev(prices)) : null,
      volume_avg: volumes.length >= 3 ? round6(avg(volumes)) : null,
      volume_std: volumes.length >= 3 ? round6(stdDev(volumes)) : null,
      market_cap_avg: caps.length >= 3 ? round6(avg(caps)) : null,
      market_cap_std: caps.length >= 3 ? round6(stdDev(caps)) : null,
      mention_avg: mentions.length >= 3 ? round6(avg(mentions)) : null,
      mention_std: mentions.length >= 3 ? round6(stdDev(mentions)) : null,
    };
  } catch (err) {
    logger.warn({ err, target, chain }, 'Context Engine: failed to load historical baselines');
    return defaults;
  }
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────

interface Anomaly {
  metric: string;
  current: number;
  baseline_30d: number;
  deviation_pct: number;
  severity: 'info' | 'warning' | 'critical';
  description: string;
}

function detectAnomalies(
  state: RawStateData,
  baseline: HistoricalBaseline,
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  const checks: Array<{
    metric: string;
    current: number | null;
    avg: number | null;
    std: number | null;
    label: string;
  }> = [
    { metric: 'price_usd', current: state.price_usd, avg: baseline.price_avg, std: baseline.price_std, label: 'Price' },
    { metric: 'volume_24h', current: state.volume_24h, avg: baseline.volume_avg, std: baseline.volume_std, label: '24h Volume' },
    { metric: 'market_cap', current: state.market_cap, avg: baseline.market_cap_avg, std: baseline.market_cap_std, label: 'Market Cap' },
    { metric: 'mention_count', current: state.mention_count, avg: baseline.mention_avg, std: baseline.mention_std, label: 'Social Mentions' },
  ];

  for (const check of checks) {
    if (check.current === null || check.avg === null || check.std === null) continue;
    if (check.std === 0) continue; // no variance — cannot detect anomalies

    const deviation = round6(Math.abs(check.current - check.avg) / check.std);
    const deviation_pct = check.avg !== 0
      ? round6(((check.current - check.avg) / Math.abs(check.avg)) * 100)
      : 0;

    if (deviation >= ANOMALY_THRESHOLD_WARNING) {
      const direction = check.current > check.avg ? 'above' : 'below';
      const severity: Anomaly['severity'] = deviation >= ANOMALY_THRESHOLD_CRITICAL ? 'critical' : 'warning';

      anomalies.push({
        metric: check.metric,
        current: check.current,
        baseline_30d: check.avg,
        deviation_pct,
        severity,
        description: `${check.label} is ${Math.abs(deviation_pct).toFixed(1)}% ${direction} the 30-day average (${deviation.toFixed(1)} standard deviations)`,
      });
    }
  }

  // Special anomaly: extreme 24h price change (no baseline needed)
  if (state.price_change_24h !== null && Math.abs(state.price_change_24h) > 20) {
    const direction = state.price_change_24h > 0 ? 'up' : 'down';
    const severity: Anomaly['severity'] = Math.abs(state.price_change_24h) > 50 ? 'critical' : 'warning';
    anomalies.push({
      metric: 'price_change_24h',
      current: state.price_change_24h,
      baseline_30d: 0,
      deviation_pct: state.price_change_24h,
      severity,
      description: `Price moved ${Math.abs(state.price_change_24h).toFixed(1)}% ${direction} in the last 24 hours`,
    });
  }

  return anomalies;
}

// ─── Context Score ──────────────────────────────────────────────────────────

function computeContextScore(anomalies: Anomaly[], state: RawStateData): number {
  // Base score: 50 = normal, nothing remarkable
  let score = 50;

  // Add points per anomaly based on severity
  for (const a of anomalies) {
    switch (a.severity) {
      case 'info':     score += 5;  break;
      case 'warning':  score += 12; break;
      case 'critical': score += 20; break;
    }
  }

  // Boost for extreme fear/greed (market context)
  if (state.fear_greed !== null) {
    if (state.fear_greed <= 20 || state.fear_greed >= 80) {
      score += 5;
    }
  }

  // Boost for negative news sentiment
  if (state.news_sentiment === 'negative') {
    score += 5;
  }

  return clamp(Math.round(score), 0, 100);
}

// ─── Confidence ─────────────────────────────────────────────────────────────

function computeConfidence(state: RawStateData, hasBaseline: boolean): number {
  let confidence = 0;

  // +0.15 per available data point
  if (state.price_usd !== null) confidence = round6(confidence + 0.15);
  if (state.volume_24h !== null) confidence = round6(confidence + 0.10);
  if (state.market_cap !== null) confidence = round6(confidence + 0.10);
  if (state.holders !== null) confidence = round6(confidence + 0.10);
  if (state.liquidity_usd !== null) confidence = round6(confidence + 0.10);
  if (state.mention_count !== null) confidence = round6(confidence + 0.10);
  if (state.fear_greed !== null) confidence = round6(confidence + 0.05);
  if (state.news_sentiment !== null) confidence = round6(confidence + 0.05);
  if (state.name !== null) confidence = round6(confidence + 0.05);

  // +0.20 if historical baseline exists (anomaly detection is meaningful)
  if (hasBaseline) confidence = round6(confidence + 0.20);

  return Math.round(clamp(confidence, 0, 1) * 100) / 100;
}

// ─── Summary Builder (algorithmic) ──────────────────────────────────────────

function buildSummary(
  target: string,
  state: RawStateData,
  anomalies: Anomaly[],
  contextScore: number,
): string {
  const name = state.name ?? state.symbol ?? target;
  const parts: string[] = [];

  // Price context
  if (state.price_usd !== null) {
    parts.push(`$${formatNum(state.price_usd)}`);
    if (state.price_change_24h !== null) {
      const dir = state.price_change_24h >= 0 ? '+' : '';
      parts.push(`(${dir}${state.price_change_24h.toFixed(1)}% 24h)`);
    }
  }

  // Anomaly context
  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const warningCount = anomalies.filter(a => a.severity === 'warning').length;

  if (criticalCount > 0) {
    parts.push(`${criticalCount} critical anomal${criticalCount === 1 ? 'y' : 'ies'} detected`);
  } else if (warningCount > 0) {
    parts.push(`${warningCount} unusual metric${warningCount === 1 ? '' : 's'}`);
  } else {
    parts.push('activity within normal range');
  }

  // Market sentiment
  if (state.fear_greed !== null && state.fear_greed_label) {
    parts.push(`market: ${state.fear_greed_label.toLowerCase()}`);
  }

  return `${name}: ${parts.join(' | ')}`;
}

// ─── LLM Enrichment (Standard/Deep tier) ────────────────────────────────────

const CONTEXT_SYSTEM_PROMPT = `You are a crypto market analyst. Given current metrics and anomaly data for a crypto entity, produce a concise narrative explaining what is happening and why.

Rules:
- Lead with the most important observation
- Reference specific numbers from the data
- Explain potential causes for any anomalies
- Note market-wide context (fear/greed, news) if relevant
- Keep it under 200 words
- Be objective — do not give financial advice
- Do not hallucinate data — only reference what is provided`;

async function synthesizeEnrichment(
  target: string,
  targetType: string,
  state: RawStateData,
  anomalies: Anomaly[],
  contextScore: number,
  tier: 'standard' | 'deep',
): Promise<string | null> {
  const sections: string[] = [
    `Produce a market context analysis for ${targetType} "${state.name ?? target}" (${state.symbol ?? target}):`,
    '',
  ];

  // Current state
  sections.push('Current State:');
  if (state.price_usd !== null) sections.push(`  Price: $${formatNum(state.price_usd)}`);
  if (state.price_change_24h !== null) sections.push(`  24h Change: ${state.price_change_24h.toFixed(2)}%`);
  if (state.volume_24h !== null) sections.push(`  24h Volume: $${formatNum(state.volume_24h)}`);
  if (state.market_cap !== null) sections.push(`  Market Cap: $${formatNum(state.market_cap)}`);
  if (state.holders !== null) sections.push(`  Holders: ${state.holders.toLocaleString()}`);
  if (state.liquidity_usd !== null) sections.push(`  Liquidity: $${formatNum(state.liquidity_usd)}`);
  sections.push('');

  // Anomalies
  if (anomalies.length > 0) {
    sections.push('Detected Anomalies:');
    for (const a of anomalies) {
      sections.push(`  [${a.severity.toUpperCase()}] ${a.description}`);
    }
    sections.push('');
  }

  // Market context
  if (state.fear_greed !== null) {
    sections.push(`Market Fear & Greed: ${state.fear_greed}/100 (${state.fear_greed_label ?? 'unknown'})`);
  }
  if (state.sentiment_label !== null) {
    sections.push(`Social Sentiment: ${state.sentiment_label} (${state.mention_count ?? 0} mentions)`);
  }
  if (state.top_headline) {
    sections.push(`Top News: "${state.top_headline}"`);
  }
  if (state.news_sentiment) {
    sections.push(`News Sentiment: ${state.news_sentiment}`);
  }

  sections.push('');
  sections.push(`Context Score: ${contextScore}/100`);

  const messages: LlmMessage[] = [
    { role: 'system', content: CONTEXT_SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n') },
  ];

  // Deep tier gets the more capable model (synthesis=sonnet), standard gets haiku
  const role = tier === 'deep' ? 'synthesis' : 'intent';

  try {
    const response = await llmComplete(messages, role);

    logger.info({
      target,
      tier,
      model: role === 'synthesis' ? 'sonnet' : 'haiku',
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    }, 'Context Engine: LLM enrichment complete');

    return response.content;
  } catch (err) {
    logger.warn({ err, target }, 'Context Engine: LLM enrichment failed — skipping');
    return null;
  }
}

// ─── VIE Cross-Reference ────────────────────────────────────────────────────

function getRelatedVieScore(target: string, chain: string): number | null {
  try {
    const { getIntelScore } = require('../db/intel');
    const vieScore = getIntelScore(target, chain, 'vie');
    return vieScore?.score_value ?? null;
  } catch {
    return null;
  }
}

// ─── Intel Table Writes (fire-and-forget) ───────────────────────────────────

function writeToIntelTables(
  target: string,
  targetType: string,
  chain: string,
  result: ContextResult,
  state: RawStateData,
): void {
  try {
    const { upsertIntelEntity, upsertIntelScore, appendIntelEvent } = require('../db/intel');

    const entityId = upsertIntelEntity(target, targetType, chain, state.name ?? undefined);

    upsertIntelScore(
      entityId, target, chain, 'context',
      result.context_score, result.confidence, contextScoreLevel(result.context_score),
      result.summary,
      {
        anomaly_count: result.anomalies.length,
        critical_count: result.anomalies.filter(a => a.severity === 'critical').length,
        state: result.state,
      },
    );

    // Snapshot current state for future baseline calculations
    appendIntelEvent(
      entityId, target, chain, 'context', 'STATE_SNAPSHOT', 'info',
      {
        price_usd: state.price_usd,
        volume_24h: state.volume_24h,
        market_cap: state.market_cap,
        mention_count: state.mention_count,
        holders: state.holders,
        context_score: result.context_score,
      },
    );

    // Log anomaly events separately for alerting
    for (const anomaly of result.anomalies) {
      if (anomaly.severity === 'warning' || anomaly.severity === 'critical') {
        appendIntelEvent(
          entityId, target, chain, 'context', 'ANOMALY_DETECTED', anomaly.severity,
          {
            metric: anomaly.metric,
            current: anomaly.current,
            baseline_30d: anomaly.baseline_30d,
            deviation_pct: anomaly.deviation_pct,
            description: anomaly.description,
          },
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Context Engine: intel table write failed — non-blocking');
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function generateContext(
  target: string,
  targetType: string,
  chain: string,
  tier: 'summary' | 'standard' | 'deep',
): Promise<ContextResult> {
  const start = Date.now();
  logger.info({ target, targetType, chain, tier }, 'Context Engine: generating context');

  // 1. Fetch current data in parallel
  const state = await fetchCurrentState(target, targetType, chain);

  // 2. Read historical baselines from intel_events (last 30 days)
  const baseline = fetchHistoricalBaseline(target, chain);
  const hasBaseline = baseline.price_avg !== null || baseline.volume_avg !== null;

  // 3. Detect anomalies
  const anomalies = detectAnomalies(state, baseline);

  // 4. Compute context score
  const contextScore = computeContextScore(anomalies, state);

  // 5. Compute confidence
  const confidence = computeConfidence(state, hasBaseline);

  // 6. Build algorithmic summary
  const summary = buildSummary(target, state, anomalies, contextScore);

  // 7. LLM enrichment (Standard/Deep tier only)
  let enrichment: string | undefined;
  if (tier === 'standard' || tier === 'deep') {
    const llmResult = await synthesizeEnrichment(target, targetType, state, anomalies, contextScore, tier);
    if (llmResult) enrichment = llmResult;
  }

  // 8. Cross-reference VIE score
  const related_vie_score = getRelatedVieScore(target, chain) ?? undefined;

  // 9. Build result
  const result: ContextResult = {
    entity: {
      address: target,
      type: targetType,
      chain,
      name: state.name ?? undefined,
      symbol: state.symbol ?? undefined,
    },
    state: {
      price_usd: state.price_usd,
      price_change_24h: state.price_change_24h,
      volume_24h: state.volume_24h,
      market_cap: state.market_cap,
      holders: state.holders,
      liquidity_usd: state.liquidity_usd,
    },
    anomalies,
    context_score: contextScore,
    confidence,
    summary,
    enrichment,
    related_vie_score,
    data_sources: state.sources,
  };

  // 10. Write to intel tables (fire-and-forget)
  writeToIntelTables(target, targetType, chain, result, state);

  const durationMs = Date.now() - start;
  logger.info({
    target, tier, contextScore, confidence,
    anomalyCount: anomalies.length,
    sourceCount: state.sources.length,
    durationMs,
  }, 'Context Engine: generation complete');

  return result;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function safeNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function contextScoreLevel(score: number): string {
  if (score >= 80) return 'HIGHLY_ANOMALOUS';
  if (score >= 65) return 'NOTABLE';
  if (score >= 45) return 'NORMAL';
  return 'QUIET';
}
