/**
 * Soma Check telemetry — logs hash-match events for shadow mode + billing paths.
 *
 * Shadow mode (Tier 0): every call logs the hash + would_have_hit flag.
 * Active mode (Tier 1+): logs actual 304 responses and the billed split.
 *
 * Data feeds the provider savings dashboard and the "you would have saved $X"
 * conversion pitches per internal/soma-onboarding-ladder.md.
 */
import { getDb } from './connection';
import { logger } from '../utils/logger';

export interface SomaCheckEvent {
  endpointId: string;
  requestId?: string;
  cacheKey?: string;
  hash: string;
  clientIfNoneMatch?: string | null;
  wouldHaveHit: boolean;
  wasHit: boolean;
  originPriceCredits?: number;
  hitPriceCredits?: number;
  rail?: 'credits' | 'usdc-base' | 'usdc-solana' | 'stripe';
  tier?: number;
  shadowMode?: boolean;
}

/** Fire-and-forget. Failures are logged but never thrown. */
export function logSomaCheckEvent(ev: SomaCheckEvent): void {
  try {
    getDb().prepare(`
      INSERT INTO soma_check_events (
        endpoint_id, request_id, cache_key, hash, client_if_none_match,
        would_have_hit, was_hit, origin_price_credits, hit_price_credits,
        rail, tier, shadow_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ev.endpointId,
      ev.requestId ?? null,
      ev.cacheKey ?? null,
      ev.hash,
      ev.clientIfNoneMatch ?? null,
      ev.wouldHaveHit ? 1 : 0,
      ev.wasHit ? 1 : 0,
      ev.originPriceCredits ?? null,
      ev.hitPriceCredits ?? null,
      ev.rail ?? 'credits',
      ev.tier ?? 0,
      ev.shadowMode === false ? 0 : 1,
    );
  } catch (err) {
    logger.warn({ err, endpointId: ev.endpointId }, 'logSomaCheckEvent failed');
  }
}

export interface SomaCheckEndpointStats {
  endpointId: string;
  totalCalls: number;
  wouldHaveHits: number;
  wouldHaveHitRate: number;
  actualHits: number;
  actualHitRate: number;
  creditsSavedProjected: number;
  creditsSavedActual: number;
}

/** Aggregate Soma Check events over a time window (default: last 24h). */
export function getSomaCheckStats(opts: {
  endpointId?: string;
  sinceHours?: number;
} = {}): SomaCheckEndpointStats[] {
  const sinceHours = opts.sinceHours ?? 24;
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  const where: string[] = ['created_at >= ?'];
  const params: any[] = [since];
  if (opts.endpointId) {
    where.push('endpoint_id = ?');
    params.push(opts.endpointId);
  }

  const rows = getDb().prepare(`
    SELECT
      endpoint_id                                                       AS endpointId,
      COUNT(*)                                                          AS totalCalls,
      SUM(would_have_hit)                                               AS wouldHaveHits,
      SUM(was_hit)                                                      AS actualHits,
      SUM(CASE WHEN would_have_hit = 1 THEN COALESCE(origin_price_credits,0) * 0.9 ELSE 0 END) AS creditsSavedProjected,
      SUM(CASE WHEN was_hit = 1        THEN COALESCE(origin_price_credits,0) - COALESCE(hit_price_credits,0) ELSE 0 END) AS creditsSavedActual
    FROM soma_check_events
    WHERE ${where.join(' AND ')}
    GROUP BY endpoint_id
    ORDER BY totalCalls DESC
  `).all(...params) as any[];

  return rows.map(r => ({
    endpointId: r.endpointId,
    totalCalls: r.totalCalls,
    wouldHaveHits: r.wouldHaveHits ?? 0,
    wouldHaveHitRate: r.totalCalls > 0 ? (r.wouldHaveHits ?? 0) / r.totalCalls : 0,
    actualHits: r.actualHits ?? 0,
    actualHitRate: r.totalCalls > 0 ? (r.actualHits ?? 0) / r.totalCalls : 0,
    creditsSavedProjected: r.creditsSavedProjected ?? 0,
    creditsSavedActual: r.creditsSavedActual ?? 0,
  }));
}

// ─── Provider-scoped earnings ───────────────────────────────────────────────

/**
 * Soma Check earnings window options.
 *   day   = last 24h
 *   week  = last 7 days
 *   month = last 30 days
 */
export type SomaCheckWindow = 'day' | 'week' | 'month';

const WINDOW_HOURS: Record<SomaCheckWindow, number> = {
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
};

export interface ProviderSomaCheckEarnings {
  providerId: string;
  window: SomaCheckWindow;
  windowHours: number;
  tier: number;
  totals: {
    totalCalls: number;
    liveCalls: number;
    cacheHits: number;
    wouldHaveHits: number; // shadow-mode projection
    hitRate: number;
    wouldHaveHitRate: number;
  };
  earnings: {
    // Provider's slice of origin (live) calls, in credits
    liveCreditsEarned: number;
    // Provider's slice of cache-hit calls, in credits (Tier 1+ only)
    cacheCreditsEarned: number;
    // Sum of the above — what actually hit the provider's ledger
    totalCreditsEarned: number;
    // If running in shadow mode, this is the credits they WOULD have earned
    // from cache hits if they flipped to Tier 1+
    projectedCacheCreditsIfActive: number;
  };
  savings: {
    // Credits agents saved by using Soma Check vs full-fresh calls
    agentCreditsSaved: number;
  };
  endpoints: Array<{
    endpointId: string;
    totalCalls: number;
    cacheHits: number;
    wouldHaveHits: number;
    hitRate: number;
    cacheCreditsEarned: number;
  }>;
}

/**
 * Per-provider Soma Check earnings for a window.
 *
 * Joins soma_check_events → provider_endpoints. Only counts rows whose
 * endpoint_id is registered to this provider. Splits the credited share
 * using the provider's current soma_check_tier (Tier 0 = shadow, no
 * credit; Tier 1-2 = 90%; Tier 3 = 95%).
 */
export function getProviderSomaCheckEarnings(
  providerId: string,
  window: SomaCheckWindow = 'day',
): ProviderSomaCheckEarnings {
  const windowHours = WINDOW_HOURS[window];
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();

  // Current tier governs the share for rows billed during this window.
  const tierRow = getDb().prepare(
    'SELECT soma_check_tier FROM providers WHERE id = ? LIMIT 1',
  ).get(providerId) as { soma_check_tier: number } | undefined;
  const tier = tierRow?.soma_check_tier ?? 0;
  const providerShareOnHit = tier === 3 ? 0.95 : 0.90; // Tier 0 still projects at 90%

  // Per-endpoint aggregates, restricted to this provider's endpoints.
  const rows = getDb().prepare(`
    SELECT
      e.endpoint_id                                                                     AS endpointId,
      COUNT(*)                                                                          AS totalCalls,
      SUM(e.was_hit)                                                                    AS cacheHits,
      SUM(e.would_have_hit)                                                             AS wouldHaveHits,
      SUM(CASE WHEN e.was_hit = 1 THEN COALESCE(e.hit_price_credits, 0) ELSE 0 END)     AS hitCreditsTotal,
      SUM(CASE WHEN e.was_hit = 0 THEN COALESCE(e.origin_price_credits, 0) ELSE 0 END)  AS originCreditsTotal,
      SUM(CASE WHEN e.was_hit = 1
               THEN COALESCE(e.origin_price_credits, 0) - COALESCE(e.hit_price_credits, 0)
               ELSE 0 END)                                                              AS agentSavings,
      SUM(CASE WHEN e.would_have_hit = 1 AND e.was_hit = 0
               THEN COALESCE(e.origin_price_credits, 0) * 0.10
               ELSE 0 END)                                                              AS projectedHitCreditsShadow
    FROM soma_check_events e
    INNER JOIN provider_endpoints pe ON pe.endpoint_id = e.endpoint_id
    WHERE pe.provider_id = ? AND e.created_at >= ?
    GROUP BY e.endpoint_id
    ORDER BY totalCalls DESC
  `).all(providerId, since) as Array<{
    endpointId: string;
    totalCalls: number;
    cacheHits: number | null;
    wouldHaveHits: number | null;
    hitCreditsTotal: number | null;
    originCreditsTotal: number | null;
    agentSavings: number | null;
    projectedHitCreditsShadow: number | null;
  }>;

  let totalCalls = 0;
  let cacheHits = 0;
  let wouldHaveHits = 0;
  let hitCreditsTotal = 0;
  let originCreditsTotal = 0;
  let agentSavings = 0;
  let projectedHitCreditsShadow = 0;

  const endpoints = rows.map(r => {
    const eCacheHits = r.cacheHits ?? 0;
    const eWouldHits = r.wouldHaveHits ?? 0;
    const eHitCredits = r.hitCreditsTotal ?? 0;

    totalCalls += r.totalCalls;
    cacheHits += eCacheHits;
    wouldHaveHits += eWouldHits;
    hitCreditsTotal += eHitCredits;
    originCreditsTotal += r.originCreditsTotal ?? 0;
    agentSavings += r.agentSavings ?? 0;
    projectedHitCreditsShadow += r.projectedHitCreditsShadow ?? 0;

    return {
      endpointId: r.endpointId,
      totalCalls: r.totalCalls,
      cacheHits: eCacheHits,
      wouldHaveHits: eWouldHits,
      hitRate: r.totalCalls > 0 ? eCacheHits / r.totalCalls : 0,
      cacheCreditsEarned: eHitCredits * providerShareOnHit,
    };
  });

  const liveCalls = totalCalls - cacheHits;
  const hitRate = totalCalls > 0 ? cacheHits / totalCalls : 0;
  const wouldHaveHitRate = totalCalls > 0 ? wouldHaveHits / totalCalls : 0;

  // Live calls pay 90/10 (provider/platform) in the standard billing path.
  const liveCreditsEarned = originCreditsTotal * 0.90;
  const cacheCreditsEarned = hitCreditsTotal * providerShareOnHit;
  const projectedCacheCreditsIfActive = projectedHitCreditsShadow * providerShareOnHit;

  return {
    providerId,
    window,
    windowHours,
    tier,
    totals: {
      totalCalls,
      liveCalls,
      cacheHits,
      wouldHaveHits,
      hitRate,
      wouldHaveHitRate,
    },
    earnings: {
      liveCreditsEarned,
      cacheCreditsEarned,
      totalCreditsEarned: liveCreditsEarned + cacheCreditsEarned,
      projectedCacheCreditsIfActive,
    },
    savings: {
      agentCreditsSaved: agentSavings,
    },
    endpoints,
  };
}

/** Totals across all endpoints for dashboard top-line. */
export function getSomaCheckSummary(opts: { sinceHours?: number } = {}) {
  const stats = getSomaCheckStats({ sinceHours: opts.sinceHours });
  const totalCalls = stats.reduce((s, r) => s + r.totalCalls, 0);
  const wouldHits = stats.reduce((s, r) => s + r.wouldHaveHits, 0);
  const actualHits = stats.reduce((s, r) => s + r.actualHits, 0);
  const savedProj = stats.reduce((s, r) => s + r.creditsSavedProjected, 0);
  const savedActual = stats.reduce((s, r) => s + r.creditsSavedActual, 0);
  return {
    windowHours: opts.sinceHours ?? 24,
    endpoints: stats.length,
    totalCalls,
    wouldHaveHits: wouldHits,
    wouldHaveHitRate: totalCalls > 0 ? wouldHits / totalCalls : 0,
    actualHits,
    actualHitRate: totalCalls > 0 ? actualHits / totalCalls : 0,
    creditsSavedProjected: savedProj,
    creditsSavedActual: savedActual,
  };
}
