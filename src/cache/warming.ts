import { getDb } from '../db/connection';
import { batchedDelete } from '../db/audit';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HotKey {
  cacheKey: string;
  endpointId: string;
  accessCount: number;
  hitRate: number;
  avgCreditsSaved: number;
}

export interface WarmingCandidate {
  cacheKey: string;
  endpointId: string;
  accessCount: number;
  priority: number;
}

export interface CacheAnalytics {
  totalAccesses: number;
  hitCount: number;
  missCount: number;
  staleServedCount: number;
  hitRate: number;
  totalCreditsSaved: number;
  topEndpoints: Array<{ endpointId: string; accesses: number; hitRate: number }>;
  unchangedDataCount: number;
}

// ─── Insert counter for bounded cleanup ─────────────────────────────────────

let insertCounter = 0;

// ─── Record Access ──────────────────────────────────────────────────────────

/**
 * Record a cache access event into cache_access_log.
 * Every 1000 inserts, prunes entries older than 7 days to keep the table bounded.
 */
export function recordCacheAccess(data: {
  cacheKey: string;
  endpointId: string;
  hit: boolean;
  staleServed: boolean;
  contentChanged?: boolean;
  creditsSaved: number;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO cache_access_log (cache_key, endpoint_id, hit, stale_served, content_changed, credits_saved)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.cacheKey,
        data.endpointId,
        data.hit ? 1 : 0,
        data.staleServed ? 1 : 0,
        data.contentChanged != null ? (data.contentChanged ? 1 : 0) : null,
        data.creditsSaved,
      );

    insertCounter++;
    if (insertCounter >= 1000) {
      insertCounter = 0;
      cleanupAccessLog(7);
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to record cache access');
  }
}

// ─── Hot Keys ───────────────────────────────────────────────────────────────

/**
 * Find hot cache keys — keys with >= minAccessCount accesses in the last windowHours.
 */
export function getHotKeys(minAccessCount: number = 5, windowHours: number = 1): HotKey[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT cache_key, endpoint_id,
                COUNT(*) AS access_count,
                ROUND(CAST(SUM(hit) AS REAL) / COUNT(*), 4) AS hit_rate,
                ROUND(AVG(credits_saved), 6) AS avg_credits_saved
         FROM cache_access_log
         WHERE created_at > datetime('now', '-' || ? || ' hours')
         GROUP BY cache_key
         HAVING COUNT(*) >= ?
         ORDER BY access_count DESC`,
      )
      .all(windowHours, minAccessCount) as Array<{
      cache_key: string;
      endpoint_id: string;
      access_count: number;
      hit_rate: number;
      avg_credits_saved: number;
    }>;

    return rows.map((r) => ({
      cacheKey: r.cache_key,
      endpointId: r.endpoint_id,
      accessCount: r.access_count,
      hitRate: r.hit_rate,
      avgCreditsSaved: r.avg_credits_saved,
    }));
  } catch (err) {
    logger.warn({ err }, 'Failed to get hot keys');
    return [];
  }
}

// ─── Warming Candidates ─────────────────────────────────────────────────────

/**
 * Find hot keys that are candidates for cache warming.
 * Returns up to 50 candidates sorted by priority (access count).
 */
export function getWarmingCandidates(): WarmingCandidate[] {
  try {
    // Hot keys from the last hour with at least 3 accesses
    const rows = getDb()
      .prepare(
        `SELECT cache_key, endpoint_id,
                COUNT(*) AS access_count
         FROM cache_access_log
         WHERE created_at > datetime('now', '-1 hours')
         GROUP BY cache_key
         HAVING COUNT(*) >= 3
         ORDER BY access_count DESC
         LIMIT 50`,
      )
      .all() as Array<{
      cache_key: string;
      endpoint_id: string;
      access_count: number;
    }>;

    return rows.map((r, i) => ({
      cacheKey: r.cache_key,
      endpointId: r.endpoint_id,
      accessCount: r.access_count,
      priority: rows.length - i, // Higher access count = higher priority
    }));
  } catch (err) {
    logger.warn({ err }, 'Failed to get warming candidates');
    return [];
  }
}

// ─── Cache Analytics ────────────────────────────────────────────────────────

/**
 * Aggregate cache_access_log for the given period.
 */
export function getCacheAnalytics(period: 'hour' | 'day' | 'week'): CacheAnalytics {
  const windowMap = { hour: '-1 hours', day: '-1 days', week: '-7 days' };
  const window = windowMap[period];

  try {
    const summary = getDb()
      .prepare(
        `SELECT
           COUNT(*) AS total_accesses,
           SUM(hit) AS hit_count,
           SUM(CASE WHEN hit = 0 THEN 1 ELSE 0 END) AS miss_count,
           SUM(stale_served) AS stale_served_count,
           COALESCE(SUM(credits_saved), 0) AS total_credits_saved,
           SUM(CASE WHEN content_changed = 0 THEN 1 ELSE 0 END) AS unchanged_data_count
         FROM cache_access_log
         WHERE created_at > datetime('now', ?)`,
      )
      .get(window) as {
      total_accesses: number;
      hit_count: number;
      miss_count: number;
      stale_served_count: number;
      total_credits_saved: number;
      unchanged_data_count: number;
    };

    const topEndpoints = getDb()
      .prepare(
        `SELECT endpoint_id,
                COUNT(*) AS accesses,
                ROUND(CAST(SUM(hit) AS REAL) / COUNT(*), 4) AS hit_rate
         FROM cache_access_log
         WHERE created_at > datetime('now', ?)
         GROUP BY endpoint_id
         ORDER BY accesses DESC
         LIMIT 10`,
      )
      .all(window) as Array<{
      endpoint_id: string;
      accesses: number;
      hit_rate: number;
    }>;

    const total = summary.total_accesses || 0;
    return {
      totalAccesses: total,
      hitCount: summary.hit_count || 0,
      missCount: summary.miss_count || 0,
      staleServedCount: summary.stale_served_count || 0,
      hitRate: total > 0 ? Math.round(((summary.hit_count || 0) / total) * 10000) / 10000 : 0,
      totalCreditsSaved: summary.total_credits_saved || 0,
      topEndpoints: topEndpoints.map((r) => ({
        endpointId: r.endpoint_id,
        accesses: r.accesses,
        hitRate: r.hit_rate,
      })),
      unchangedDataCount: summary.unchanged_data_count || 0,
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to get cache analytics');
    return {
      totalAccesses: 0,
      hitCount: 0,
      missCount: 0,
      staleServedCount: 0,
      hitRate: 0,
      totalCreditsSaved: 0,
      topEndpoints: [],
      unchangedDataCount: 0,
    };
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Delete access log entries older than `daysOld` days. Returns count deleted.
 */
export function cleanupAccessLog(daysOld: number = 7): number {
  try {
    return batchedDelete(
      `DELETE FROM cache_access_log WHERE rowid IN (SELECT rowid FROM cache_access_log WHERE created_at < datetime('now', '-' || ? || ' days'))`,
      [daysOld]
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to cleanup access log');
    return 0;
  }
}
