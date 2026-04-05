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
