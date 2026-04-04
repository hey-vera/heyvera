/**
 * provider-cache-warm-cron.ts — Proactive cache warming for provider endpoints.
 *
 * Providers can mark endpoints for proactive cache warming. This cron
 * re-fetches data from upstream BEFORE the cache expires, so agents
 * always get fresh cache hits with zero wait.
 *
 * How it works:
 *   1. Provider sets `cache_warm = true` + `update_frequency_seconds` on their endpoint
 *   2. This cron checks the cache_warm_schedule table every 30s
 *   3. When an endpoint is due, it fetches fresh data via clawApiCall()
 *   4. Data is cached + a new Certified Cache certificate is created
 *   5. Agents hitting this endpoint always get a fresh, certified cache hit
 *
 * This eliminates the latency argument entirely:
 *   - Cache hits are faster than direct calls (~10ms)
 *   - Data is proactively fresh (no stale cache misses)
 *   - Every response has a Certified Cache certificate
 */

import { getDb } from '../db/connection';
import { findEndpoint } from '../config/api-registry';
import { isClawApisReady, clawApiCall, getLastBirthCertificate } from '../providers/clawapis';
import { smartCacheSet, cacheKey } from '../cache/index';
import { createCacheCertificate, getCacheHashInfo } from './cache-certificate';
import { somaHash } from '../utils/crypto-agility';
import { env } from '../config/index';
import { logger } from '../utils/logger';

let _cronTimer: ReturnType<typeof setInterval> | null = null;

interface WarmScheduleRow {
  endpoint_id: string;
  provider_id: string;
  frequency_seconds: number;
  last_warmed_at: string | null;
  next_warm_at: string | null;
  consecutive_failures: number;
  enabled: number;
}

/**
 * Sync provider_endpoints with cache_warm_schedule.
 * Called on cron startup and periodically to pick up new warm-enabled endpoints.
 */
function syncWarmSchedule(): void {
  // Add new warm-enabled endpoints to schedule
  getDb().prepare(`
    INSERT OR IGNORE INTO cache_warm_schedule (endpoint_id, provider_id, frequency_seconds, next_warm_at, enabled)
    SELECT endpoint_id, provider_id, COALESCE(update_frequency_seconds, 60), datetime('now'), 1
    FROM provider_endpoints
    WHERE cache_warm = 1
  `).run();

  // Disable endpoints that are no longer warm-enabled
  getDb().prepare(`
    UPDATE cache_warm_schedule SET enabled = 0
    WHERE endpoint_id NOT IN (SELECT endpoint_id FROM provider_endpoints WHERE cache_warm = 1)
  `).run();
}

/**
 * Get endpoints that are due for a warm fetch.
 * Only warms endpoints with enough recent demand to justify the cost.
 * Minimum 10 cache hits in the last 24h — otherwise warming is a net loss.
 */
function getDueEndpoints(limit: number = 5): WarmScheduleRow[] {
  return getDb().prepare(`
    SELECT s.* FROM cache_warm_schedule s
    WHERE s.enabled = 1 AND (s.next_warm_at IS NULL OR s.next_warm_at <= datetime('now'))
    AND s.consecutive_failures < 5
    AND (
      SELECT COUNT(*) FROM cache_access_log
      WHERE endpoint_id = s.endpoint_id AND hit = 1 AND created_at >= datetime('now', '-1 day')
    ) >= 10
    ORDER BY s.next_warm_at ASC
    LIMIT ?
  `).all(limit) as WarmScheduleRow[];
}

/**
 * Warm a single endpoint: fetch fresh data, cache it, create certificate.
 *
 * Soma Check optimization: after fetching, compare new dataHash to existing cert.
 * If data didn't change, skip cache write + cert creation (saves CPU/disk).
 * The x402 payment still happens (we had to fetch to check). Full savings
 * require upstream Soma Check support (If-Soma-Hash → 304, no payment).
 */
async function warmEndpoint(schedule: WarmScheduleRow): Promise<boolean> {
  const endpoint = findEndpoint(schedule.endpoint_id);
  if (!endpoint) return false;

  try {
    const apiPath = endpoint.path ?? `/${schedule.endpoint_id}`;
    const data = await clawApiCall(apiPath, {}, endpoint.baseUrl);

    const key = cacheKey(schedule.endpoint_id, {});
    const serialized = JSON.stringify(data);
    const dataHash = somaHash(serialized);
    const ttl = schedule.frequency_seconds * 2; // Cache for 2x the update frequency

    // Soma Check: check if data actually changed since last warm
    const existingHash = getCacheHashInfo(key);
    const dataChanged = !existingHash || existingHash.dataHash !== dataHash;

    if (dataChanged) {
      // Data changed — full cache set + new certificate
      await smartCacheSet(key, data, ttl, schedule.endpoint_id, endpoint.creditCost ?? endpoint.costPerCall);

      const birthCert = getLastBirthCertificate();
      createCacheCertificate({
        cacheKey: key,
        endpointId: schedule.endpoint_id,
        dataHash,
        ttlSeconds: ttl,
        birthCert: birthCert ?? null,
      });
    } else {
      // Data unchanged — just extend the TTL on the existing cert
      getDb().prepare(`
        UPDATE cache_certificates SET fresh_until = datetime('now', '+' || ? || ' seconds')
        WHERE cache_key = ? AND cache_data_hash = ?
        ORDER BY cached_at DESC LIMIT 1
      `).run(ttl, key, dataHash);
    }

    // Mark success
    getDb().prepare(`
      UPDATE cache_warm_schedule
      SET last_warmed_at = datetime('now'),
          next_warm_at = datetime('now', '+' || ? || ' seconds'),
          consecutive_failures = 0
      WHERE endpoint_id = ?
    `).run(schedule.frequency_seconds, schedule.endpoint_id);

    if (!dataChanged) {
      logger.debug({ endpointId: schedule.endpoint_id }, 'Cache warm: data unchanged (Soma Check skip)');
    }

    return true;
  } catch (err) {
    // Increment failure counter
    getDb().prepare(`
      UPDATE cache_warm_schedule
      SET consecutive_failures = consecutive_failures + 1,
          next_warm_at = datetime('now', '+60 seconds')
      WHERE endpoint_id = ?
    `).run(schedule.endpoint_id);

    logger.warn({ endpointId: schedule.endpoint_id, err }, 'Cache warm fetch failed');
    return false;
  }
}

export function startProviderCacheWarmCron(): void {
  const INTERVAL_MS = 30_000; // Check every 30 seconds

  // Initial sync
  try { syncWarmSchedule(); } catch { /* DB might not be ready */ }

  _cronTimer = setInterval(async () => {
    if (!isClawApisReady()) return;

    try {
      // Periodic sync (every ~5 minutes worth of cycles)
      if (Math.random() < 0.1) syncWarmSchedule();

      const due = getDueEndpoints(5);
      if (due.length === 0) return;

      let warmed = 0;
      for (const schedule of due) {
        const ok = await warmEndpoint(schedule);
        if (ok) warmed++;
      }

      if (warmed > 0) {
        logger.info({ warmed, due: due.length }, 'Provider cache warm cycle');
      }
    } catch (err) {
      logger.warn({ err }, 'Provider cache warm cron error');
    }
  }, INTERVAL_MS);
  _cronTimer.unref();

  logger.info('Provider cache warm cron started (every 30s)');
}

export function stopProviderCacheWarmCron(): void {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}
