import { logger } from '../utils/logger';
import { getWarmingCandidates } from '../cache/warming';
import { smartCacheGet } from '../cache/index';
import { checkCacheHealth } from '../cache/health-alert';

/**
 * Periodically promotes popular cache entries from Redis→L1 before they expire.
 * Runs every 5 minutes, caps at 10 promotions per cycle.
 *
 * We can't re-fetch without the original request params (cache keys are hashed),
 * so instead we read from Redis (L2) which triggers automatic L1 promotion.
 */
export function startCacheWarmingCron(): void {
  const INTERVAL_MS = 5 * 60_000; // 5 minutes
  const MAX_WARMS_PER_CYCLE = 10;

  setInterval(async () => {
    try {
      const candidates = getWarmingCandidates();
      if (candidates.length === 0) return;

      let warmed = 0;
      for (const candidate of candidates.slice(0, MAX_WARMS_PER_CYCLE)) {
        try {
          // Reading with 'prefer' triggers Redis→L1 promotion if the entry exists
          const result = await smartCacheGet(candidate.cacheKey, 'prefer', candidate.endpointId);
          if (result) {
            warmed++;
          }
        } catch {
          // Skip failed warms
        }
      }

      if (warmed > 0) {
        logger.info({ warmed, candidates: candidates.length }, 'Cache warming cycle complete');
      }

      // Piggyback cache health check on each warming cycle
      checkCacheHealth();
    } catch (err) {
      logger.warn({ err }, 'Cache warming cron error');
    }
  }, INTERVAL_MS).unref();

  logger.info('Cache warming cron started (every 5m)');
}
