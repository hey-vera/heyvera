import { getDb, batchedDelete } from '../db/index';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VolatilityStats {
  endpointId: string;
  cacheKeyPrefix: string;
  checkCount: number;
  changeCount: number;
  volatilityRatio: number;
  currentTtlMultiplier: number;
  lastHash: string | null;
  updatedAt: string;
}

// ─── Volatility Tracking ────────────────────────────────────────────────────

/**
 * Record a volatility check for an endpoint.
 * Upserts into cache_volatility: increments check_count, and if changed
 * increments change_count, updates last_hash.
 */
export function recordVolatilityCheck(
  endpointId: string,
  cacheKeyPrefix: string,
  contentChanged: boolean,
  currentHash: string,
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO cache_volatility (cache_key_prefix, endpoint_id, check_count, change_count, last_hash, updated_at)
         VALUES (?, ?, 1, ?, ?, datetime('now'))
         ON CONFLICT(cache_key_prefix) DO UPDATE SET
           check_count = check_count + 1,
           change_count = change_count + CASE WHEN ? THEN 1 ELSE 0 END,
           last_hash = ?,
           updated_at = datetime('now')`,
      )
      .run(
        cacheKeyPrefix,
        endpointId,
        contentChanged ? 1 : 0,
        currentHash,
        contentChanged ? 1 : 0,
        currentHash,
      );
  } catch (err) {
    logger.warn({ err, endpointId }, 'Failed to record volatility check');
  }
}

// ─── Adaptive TTL ───────────────────────────────────────────────────────────

/**
 * Compute an adaptive TTL based on observed volatility for this endpoint.
 * Returns the base TTL adjusted by a stability factor:
 *   - Very stable (<10% changes): 2.5x TTL
 *   - Mostly stable (<30%): 1.5x TTL
 *   - Moderate (30-70%): 1.0x TTL (no change)
 *   - Volatile (>70%): 0.5x TTL
 *   - Very volatile (>90%): 0.25x TTL
 *
 * Clamped between 30s and baseTtl * 3.
 */
export function getAdaptiveTtl(endpointId: string, baseTtl: number): number {
  try {
    const row = getDb()
      .prepare(
        `SELECT check_count, change_count FROM cache_volatility WHERE endpoint_id = ? LIMIT 1`,
      )
      .get(endpointId) as { check_count: number; change_count: number } | undefined;

    if (!row || row.check_count < 10) return baseTtl; // Not enough data

    const volatilityRatio = row.change_count / row.check_count;

    let stabilityFactor: number;
    if (volatilityRatio > 0.9) {
      stabilityFactor = 0.25;
    } else if (volatilityRatio > 0.7) {
      stabilityFactor = 0.5;
    } else if (volatilityRatio >= 0.3) {
      stabilityFactor = 1.0;
    } else if (volatilityRatio >= 0.1) {
      stabilityFactor = 1.5;
    } else {
      stabilityFactor = 2.5;
    }

    const adapted = Math.round(baseTtl * stabilityFactor);
    return Math.max(30, Math.min(adapted, baseTtl * 3));
  } catch (err) {
    logger.warn({ err, endpointId }, 'Failed to compute adaptive TTL');
    return baseTtl;
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

/**
 * Return all volatility entries sorted by volatility ratio descending.
 */
export function getVolatilityStats(): VolatilityStats[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT endpoint_id, cache_key_prefix, check_count, change_count, last_hash, updated_at
         FROM cache_volatility
         ORDER BY CAST(change_count AS REAL) / CASE WHEN check_count = 0 THEN 1 ELSE check_count END DESC`,
      )
      .all() as Array<{
      endpoint_id: string;
      cache_key_prefix: string;
      check_count: number;
      change_count: number;
      last_hash: string | null;
      updated_at: string;
    }>;

    return rows.map((r) => {
      const ratio = r.check_count > 0 ? r.change_count / r.check_count : 0;
      let multiplier: number;
      if (ratio > 0.9) multiplier = 0.25;
      else if (ratio > 0.7) multiplier = 0.5;
      else if (ratio >= 0.3) multiplier = 1.0;
      else if (ratio >= 0.1) multiplier = 1.5;
      else multiplier = 2.5;

      return {
        endpointId: r.endpoint_id,
        cacheKeyPrefix: r.cache_key_prefix,
        checkCount: r.check_count,
        changeCount: r.change_count,
        volatilityRatio: Math.round(ratio * 10000) / 10000,
        currentTtlMultiplier: multiplier,
        lastHash: r.last_hash,
        updatedAt: r.updated_at,
      };
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to get volatility stats');
    return [];
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Delete volatility entries older than `daysOld` days. Returns count deleted.
 */
export function cleanupOldVolatility(daysOld: number = 30): number {
  try {
    return batchedDelete(
      `DELETE FROM cache_volatility WHERE rowid IN (SELECT rowid FROM cache_volatility WHERE updated_at < datetime('now', '-' || ? || ' days'))`,
      [daysOld]
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to cleanup old volatility data');
    return 0;
  }
}
