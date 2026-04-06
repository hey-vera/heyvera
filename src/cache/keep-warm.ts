/**
 * keep-warm.ts — Adaptive demand-driven cache warming.
 *
 * Uses exponential moving average (EMA) demand scoring instead of fixed
 * thresholds. Each endpoint adapts to its own TTL and traffic pattern.
 *
 * Key properties:
 *   - Self-tuning: enrollment thresholds scale with TTL automatically
 *   - Hysteresis: wide gap between enroll/unenroll prevents thrashing
 *   - Cost-capped: total warming limited by per-hour credit budget
 *   - Graceful decay: demand decays exponentially, not cliff-edge
 *   - ROI gating: endpoints that cost more to warm than they save get dropped
 *   - Priority eviction: lowest-demand endpoint yields its slot to higher demand
 *   - Zero cost at rest: nothing warms until traffic proves it worthwhile
 *
 * How it works:
 *   1. Every endpoint call updates an EMA demand score:
 *      score = score × exp(-elapsed × ln2 / halfLife) + 1
 *   2. Half-life = TTL × 2 (each endpoint decays at its own natural rate)
 *   3. When score > enrollThreshold(ttl) → auto-enroll
 *   4. Background refresh at 80% of TTL (before expiry)
 *   5. When score < enrollThreshold(ttl) × 0.3 → auto-unenroll (hysteresis)
 *   6. ROI check: if hitsPerRefresh < 1.0 after 5+ refreshes → auto-unenroll
 *   7. Hard caps: max endpoints, max cost/hour, max consecutive failures
 *
 * No DB tables, no migrations — pure in-memory state (resets on restart).
 */

import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

interface DemandScore {
  endpointId: string;
  cacheKey: string;
  ttlSeconds: number;
  creditCost: number;
  score: number;
  lastUpdated: number;        // ms timestamp
  fetchFn: () => Promise<unknown>;
}

interface WarmEntry extends DemandScore {
  enrolledAt: number;         // ms timestamp
  lastRefreshed: number;      // ms timestamp
  refreshCount: number;
  hitsSinceEnroll: number;    // cache hits while enrolled (for ROI)
  failCount: number;
}

// ── Adaptive Constants ─────────────────────────────────────────────────────

/** Half-life multiplier: demand decays with half-life = TTL × this. */
const HALF_LIFE_MULTIPLIER = 2;

/** Refresh at 80% of TTL elapsed (20% lead time). */
const REFRESH_AT_PCT = 0.8;

/** Background tick interval. */
const CHECK_INTERVAL_MS = 10_000;

/**
 * Hysteresis ratio: unenroll threshold = enrollThreshold × this.
 * 0.3 means demand must drop to 30% of enrollment level before unenrolling.
 * Prevents thrashing for bursty agents.
 */
const HYSTERESIS_RATIO = 0.3;

/** Hard safety cap on enrolled endpoints. Cost budget is the real limiter. */
const MAX_WARM_ENDPOINTS = 50;

/** Max warming cost per hour in credits. Prevents runaway spending. */
const MAX_HOURLY_COST_CREDITS = 2.0;

/** Unenroll after this many consecutive refresh failures. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Minimum refreshes before ROI check kicks in (give it a chance). */
const MIN_REFRESHES_FOR_ROI = 5;

/** Minimum hits-per-refresh ratio to stay enrolled. Below this, warming isn't worth it. */
const MIN_ROI = 1.0;

/** Max demand trackers in memory (prevent unbounded growth from scanning bots). */
const MAX_TRACKERS = 5000;

// ── State ──────────────────────────────────────────────────────────────────

const warmMap = new Map<string, WarmEntry>();
const demandMap = new Map<string, DemandScore>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Hourly cost tracking
let hourlyCostCredits = 0;
let hourlyResetAt = Date.now() + 3_600_000;

// Lifetime stats (since last restart)
let totalEnrollments = 0;
let totalUnenrollments = 0;
let totalRefreshes = 0;

// ── EMA Math ───────────────────────────────────────────────────────────────

/**
 * Compute exponential decay factor.
 * Returns the fraction of score remaining after `elapsedMs`.
 */
function decay(elapsedMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 0;
  return Math.exp(-elapsedMs * Math.LN2 / halfLifeMs);
}

/**
 * Compute enrollment threshold based on TTL.
 * Short TTLs → lower threshold (frequent calls are meaningful at small counts).
 * Long TTLs → higher threshold (hourly refreshes are expensive, need more evidence).
 *
 *   30s TTL  → 2.0  (enrolls after ~3 calls in quick succession)
 *   60s TTL  → 2.4
 *   300s TTL → 5.5  (enrolls after ~8 calls)
 *   3600s TTL → 19   (enrolls after ~25 calls)
 */
function enrollThreshold(ttlSeconds: number): number {
  return Math.max(2.0, Math.sqrt(ttlSeconds / 10));
}

/** Unenroll threshold = enrollment threshold × hysteresis ratio. */
function unenrollThreshold(ttlSeconds: number): number {
  return enrollThreshold(ttlSeconds) * HYSTERESIS_RATIO;
}

/** Half-life in ms for a given TTL. */
function halfLifeMs(ttlSeconds: number): number {
  return ttlSeconds * 1000 * HALF_LIFE_MULTIPLIER;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Record that an endpoint was accessed. Call on every endpoint call (live + cache hit).
 * Lightweight — updates an in-memory EMA score.
 *
 * @param creditCost - endpoint cost in credits (for budget calculation)
 * @param fetchFn - closure to re-fetch data. Keep-warm calls this during
 *   background refresh. Must NOT include billing/auth logic.
 */
export function recordDemand(
  endpointId: string,
  cacheKey: string,
  ttlSeconds: number,
  fetchFn: () => Promise<unknown>,
  creditCost: number = 0.001,
): void {
  const now = Date.now();

  // ── Already enrolled: bump score + track hit ─────────────────────────
  const warm = warmMap.get(cacheKey);
  if (warm) {
    const elapsed = now - warm.lastUpdated;
    warm.score = warm.score * decay(elapsed, halfLifeMs(ttlSeconds)) + 1;
    warm.lastUpdated = now;
    warm.fetchFn = fetchFn;
    warm.hitsSinceEnroll++;
    return;
  }

  // ── Not enrolled: update demand tracker ──────────────────────────────
  const existing = demandMap.get(cacheKey);
  if (existing) {
    const elapsed = now - existing.lastUpdated;
    existing.score = existing.score * decay(elapsed, halfLifeMs(ttlSeconds)) + 1;
    existing.lastUpdated = now;
    existing.fetchFn = fetchFn;
    existing.creditCost = creditCost;
  } else {
    // Bounded: evict oldest tracker if at capacity
    if (demandMap.size >= MAX_TRACKERS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of demandMap) {
        if (v.lastUpdated < oldestTime) { oldestTime = v.lastUpdated; oldestKey = k; }
      }
      if (oldestKey) demandMap.delete(oldestKey);
    }

    demandMap.set(cacheKey, {
      endpointId,
      cacheKey,
      ttlSeconds,
      creditCost,
      score: 1,
      lastUpdated: now,
      fetchFn,
    });
    return; // First call — can't enroll yet (score = 1, threshold ≥ 2)
  }

  // ── Check enrollment ─────────────────────────────────────────────────
  const tracker = demandMap.get(cacheKey)!;
  if (tracker.score >= enrollThreshold(ttlSeconds)) {
    enroll(tracker);
    demandMap.delete(cacheKey);
  }
}

/**
 * Record that a cache hit was served for a warm endpoint.
 * Used for ROI tracking — call from cache hit path.
 */
export function recordWarmHit(cacheKey: string): void {
  const warm = warmMap.get(cacheKey);
  if (warm) warm.hitsSinceEnroll++;
}

// ── Enrollment ─────────────────────────────────────────────────────────────

function enroll(tracker: DemandScore): void {
  if (warmMap.has(tracker.cacheKey)) return;

  // At capacity? Try to evict lowest-score enrolled endpoint
  if (warmMap.size >= MAX_WARM_ENDPOINTS) {
    const lowestKey = findLowestScoreEntry();
    if (lowestKey) {
      const lowest = warmMap.get(lowestKey)!;
      // Only evict if new endpoint has higher demand
      if (tracker.score > lowest.score) {
        unenroll(lowestKey, `evicted for higher-demand endpoint (${tracker.endpointId})`);
      } else {
        logger.debug({ endpointId: tracker.endpointId, score: tracker.score }, 'Keep-warm: at capacity, demand too low to evict');
        return;
      }
    } else {
      return;
    }
  }

  const now = Date.now();
  warmMap.set(tracker.cacheKey, {
    ...tracker,
    enrolledAt: now,
    lastRefreshed: now, // Treat as just-refreshed (data was just fetched by the live call)
    refreshCount: 0,
    hitsSinceEnroll: 0,
    failCount: 0,
  });

  totalEnrollments++;
  logger.info(
    {
      endpointId: tracker.endpointId,
      score: Math.round(tracker.score * 100) / 100,
      threshold: Math.round(enrollThreshold(tracker.ttlSeconds) * 100) / 100,
      ttl: tracker.ttlSeconds,
      enrolled: warmMap.size,
    },
    'Keep-warm: auto-enrolled',
  );
}

function unenroll(cacheKey: string, reason: string): void {
  const entry = warmMap.get(cacheKey);
  if (!entry) return;
  warmMap.delete(cacheKey);
  totalUnenrollments++;
  const roi = entry.refreshCount > 0 ? (entry.hitsSinceEnroll / entry.refreshCount).toFixed(1) : 'n/a';
  logger.info(
    { endpointId: entry.endpointId, reason, refreshCount: entry.refreshCount, roi, enrolled: warmMap.size },
    'Keep-warm: auto-unenrolled',
  );
}

function findLowestScoreEntry(): string | null {
  let lowestKey: string | null = null;
  let lowestScore = Infinity;
  const now = Date.now();
  for (const [key, entry] of warmMap) {
    // Decay score to current time for fair comparison
    const elapsed = now - entry.lastUpdated;
    const currentScore = entry.score * decay(elapsed, halfLifeMs(entry.ttlSeconds));
    if (currentScore < lowestScore) {
      lowestScore = currentScore;
      lowestKey = key;
    }
  }
  return lowestKey;
}

// ── Background Tick ────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const now = Date.now();

  // Reset hourly cost counter
  if (now > hourlyResetAt) {
    hourlyCostCredits = 0;
    hourlyResetAt = now + 3_600_000;
  }

  for (const [key, entry] of warmMap) {
    const ttlMs = entry.ttlSeconds * 1000;
    const timeSinceRefresh = now - entry.lastRefreshed;

    // ── Decay score to current time ────────────────────────────────────
    const elapsed = now - entry.lastUpdated;
    const currentScore = entry.score * decay(elapsed, halfLifeMs(entry.ttlSeconds));

    // ── Auto-unenroll: demand decayed below hysteresis threshold ───────
    if (currentScore < unenrollThreshold(entry.ttlSeconds)) {
      unenroll(key, `demand decayed (score ${currentScore.toFixed(2)} < ${unenrollThreshold(entry.ttlSeconds).toFixed(2)})`);
      continue;
    }

    // ── Auto-unenroll: too many consecutive failures ───────────────────
    if (entry.failCount >= MAX_CONSECUTIVE_FAILURES) {
      unenroll(key, `${entry.failCount} consecutive refresh failures`);
      continue;
    }

    // ── Auto-unenroll: ROI too low (after enough refreshes to judge) ──
    if (entry.refreshCount >= MIN_REFRESHES_FOR_ROI) {
      const hitsPerRefresh = entry.hitsSinceEnroll / entry.refreshCount;
      if (hitsPerRefresh < MIN_ROI) {
        unenroll(key, `low ROI (${hitsPerRefresh.toFixed(1)} hits/refresh, need ${MIN_ROI})`);
        continue;
      }
    }

    // ── Hourly cost budget check ───────────────────────────────────────
    if (hourlyCostCredits >= MAX_HOURLY_COST_CREDITS) {
      continue; // Skip refresh, don't unenroll — budget resets next hour
    }

    // ── Refresh: when 80% of TTL elapsed since last refresh ────────────
    const refreshThreshold = ttlMs * REFRESH_AT_PCT;
    if (timeSinceRefresh >= refreshThreshold) {
      try {
        const data = await entry.fetchFn();
        if (data != null) {
          entry.lastRefreshed = Date.now();
          entry.refreshCount++;
          entry.failCount = 0;
          hourlyCostCredits += entry.creditCost;
          totalRefreshes++;
          logger.debug(
            { endpointId: entry.endpointId, score: currentScore.toFixed(2), hourlyCost: hourlyCostCredits.toFixed(3) },
            'Keep-warm: refreshed',
          );
        }
      } catch (err) {
        entry.failCount++;
        logger.warn(
          { endpointId: entry.endpointId, err, failCount: entry.failCount },
          'Keep-warm: refresh failed',
        );
      }
    }
  }

  // ── Clean up decayed demand trackers ─────────────────────────────────
  for (const [key, tracker] of demandMap) {
    const elapsed = now - tracker.lastUpdated;
    const currentScore = tracker.score * decay(elapsed, halfLifeMs(tracker.ttlSeconds));
    // Remove trackers that have decayed to near-zero (< 0.01)
    if (currentScore < 0.01) {
      demandMap.delete(key);
    }
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

export function startKeepWarm(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    tick().catch(err => logger.warn({ err }, 'Keep-warm tick failed'));
  }, CHECK_INTERVAL_MS);
  intervalHandle.unref();
  logger.info(
    {
      intervalMs: CHECK_INTERVAL_MS,
      maxEndpoints: MAX_WARM_ENDPOINTS,
      maxHourlyCost: MAX_HOURLY_COST_CREDITS,
      hysteresis: HYSTERESIS_RATIO,
    },
    'Keep-warm started (adaptive EMA)',
  );
}

export function stopKeepWarm(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

// ── Stats (for admin/debug) ────────────────────────────────────────────────

export function getKeepWarmStats() {
  const now = Date.now();
  const entries = Array.from(warmMap.values()).map(e => {
    const elapsed = now - e.lastUpdated;
    const currentScore = e.score * decay(elapsed, halfLifeMs(e.ttlSeconds));
    const threshold = enrollThreshold(e.ttlSeconds);
    const unenrollAt = unenrollThreshold(e.ttlSeconds);
    const roi = e.refreshCount > 0 ? e.hitsSinceEnroll / e.refreshCount : null;

    return {
      endpointId: e.endpointId,
      cacheKey: e.cacheKey,
      ttlSeconds: e.ttlSeconds,
      creditCost: e.creditCost,
      currentScore: Math.round(currentScore * 100) / 100,
      enrollThreshold: Math.round(threshold * 100) / 100,
      unenrollThreshold: Math.round(unenrollAt * 100) / 100,
      roi: roi !== null ? Math.round(roi * 10) / 10 : null,
      refreshCount: e.refreshCount,
      hitsSinceEnroll: e.hitsSinceEnroll,
      failCount: e.failCount,
      lastAccessedAgo: Math.round((now - e.lastUpdated) / 1000),
      lastRefreshedAgo: Math.round((now - e.lastRefreshed) / 1000),
      enrolledAgo: Math.round((now - e.enrolledAt) / 1000),
    };
  });

  return {
    enrolled: warmMap.size,
    maxEndpoints: MAX_WARM_ENDPOINTS,
    pendingTrackers: demandMap.size,
    hourlyCostCredits: Math.round(hourlyCostCredits * 1000) / 1000,
    hourlyBudget: MAX_HOURLY_COST_CREDITS,
    lifetime: { totalEnrollments, totalUnenrollments, totalRefreshes },
    entries,
  };
}
