import { logger } from '../utils/logger';
import { sendAdminAlert } from '../utils/email';
import { getCacheAnalytics } from './warming';

// ─── Cache Health Alerting ───────────────────────────────────────────────────
// Detects sudden drops in cache hit rate and alerts the admin.
// Called at the end of each warming cron cycle.

/** Previous hour's hit rate (0-1 scale). null = no data yet. */
let previousHitRate: number | null = null;

/** Timestamp of the last alert sent — throttle to once per hour. */
let lastAlertAt = 0;

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const DROP_THRESHOLD = 0.20; // 20 percentage points
const LOW_RATE_THRESHOLD = 0.20; // Absolute floor — below this something is wrong

/**
 * Check cache health by comparing the current hourly hit rate against
 * the previous reading. Fires an admin email alert on:
 *   - A drop of >20 percentage points from the previous check
 *   - An absolute hit rate below 20%
 *
 * Safe to call frequently — alerts are throttled to at most once per hour.
 */
export function checkCacheHealth(): void {
  try {
    const analytics = getCacheAnalytics('hour');

    // Need at least some accesses to be meaningful
    if (analytics.totalAccesses < 10) {
      previousHitRate = analytics.hitRate;
      return;
    }

    const currentRate = analytics.hitRate; // 0-1 scale
    const now = Date.now();
    const canAlert = now - lastAlertAt > ALERT_COOLDOWN_MS;

    if (canAlert) {
      // Check for sudden drop
      if (previousHitRate !== null && previousHitRate - currentRate > DROP_THRESHOLD) {
        const prevPct = Math.round(previousHitRate * 100);
        const currPct = Math.round(currentRate * 100);
        const dropPct = Math.round((previousHitRate - currentRate) * 100);

        sendAdminAlert({
          subject: `Cache hit rate dropped ${dropPct}pp (${prevPct}% → ${currPct}%)`,
          body: [
            `Cache hit rate fell from ${prevPct}% to ${currPct}% in the last hour.`,
            `Total accesses: ${analytics.totalAccesses}`,
            `Hits: ${analytics.hitCount}  Misses: ${analytics.missCount}`,
            `Stale served: ${analytics.staleServedCount}`,
            ``,
            `This could indicate: endpoint failures, TTL misconfiguration, or a traffic pattern change.`,
          ].join('\n'),
        }).catch(() => {}); // fire-and-forget

        lastAlertAt = now;
        logger.warn({ prevPct, currPct, dropPct }, 'Cache health alert: hit rate drop');
      }

      // Check absolute floor
      if (currentRate < LOW_RATE_THRESHOLD) {
        const currPct = Math.round(currentRate * 100);

        sendAdminAlert({
          subject: `Cache hit rate critically low (${currPct}%)`,
          body: [
            `Cache hit rate is ${currPct}% over the last hour — well below the 20% floor.`,
            `Total accesses: ${analytics.totalAccesses}`,
            `Hits: ${analytics.hitCount}  Misses: ${analytics.missCount}`,
            ``,
            `Investigate: Redis connection, cache invalidation storms, or new uncacheable traffic.`,
          ].join('\n'),
        }).catch(() => {}); // fire-and-forget

        lastAlertAt = now;
        logger.warn({ currPct }, 'Cache health alert: hit rate below floor');
      }
    }

    previousHitRate = currentRate;
  } catch (err) {
    logger.warn({ err }, 'Cache health check failed');
  }
}
