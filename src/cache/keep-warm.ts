/**
 * keep-warm.ts — Demand-driven cache warming with auto-enroll/unenroll.
 *
 * Zero cost at rest. Only warms endpoints that are actually being used.
 *
 * How it works:
 *   1. Every endpoint call records demand via recordDemand()
 *   2. If an endpoint gets ENROLL_THRESHOLD+ calls within one TTL window → auto-enroll
 *   3. Enrolled endpoints get re-fetched ~80% through their TTL (before expiry)
 *   4. If an enrolled endpoint gets 0 calls for UNENROLL_MULTIPLIER × TTL → auto-unenroll
 *   5. Hard cap on MAX_WARM_ENDPOINTS prevents runaway costs
 *   6. Total hourly cost tracking — auto-pause if costs exceed budget
 *
 * Safety guarantees:
 *   - Max 10 enrolled endpoints at any time
 *   - Max 100 upstream fetches per hour ($0 at founding era, capped later)
 *   - Auto-unenroll within 2 × TTL of last access
 *   - No DB tables, no migrations — pure in-memory state (resets on restart)
 */

import { logger } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

interface WarmEntry {
  endpointId: string;
  cacheKey: string;
  ttlSeconds: number;
  fetchFn: () => Promise<unknown>;
  lastAccessed: number;     // ms timestamp
  lastRefreshed: number;    // ms timestamp
  enrolledAt: number;       // ms timestamp
  refreshCount: number;
  failCount: number;
}

interface DemandTracker {
  endpointId: string;
  cacheKey: string;
  ttlSeconds: number;
  count: number;
  windowStart: number;      // ms timestamp
  fetchFn: () => Promise<unknown>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_WARM_ENDPOINTS = 10;
const ENROLL_THRESHOLD = 5;           // calls within 1 TTL → enroll
const UNENROLL_MULTIPLIER = 2;        // 0 calls in 2 × TTL → unenroll
const REFRESH_AT_PCT = 0.8;           // refresh when 80% of TTL elapsed
const CHECK_INTERVAL_MS = 10_000;     // tick every 10s
const MAX_REFRESHES_PER_HOUR = 100;
const MAX_CONSECUTIVE_FAILURES = 3;   // unenroll after 3 consecutive failures

// ── State ──────────────────────────────────────────────────────────────────

const warmMap = new Map<string, WarmEntry>();
const demandMap = new Map<string, DemandTracker>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Hourly cost tracking
let hourlyRefreshCount = 0;
let hourlyResetAt = Date.now() + 3_600_000;

// Lifetime stats (since last restart)
let totalEnrollments = 0;
let totalUnenrollments = 0;
let totalRefreshes = 0;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Record that an endpoint was accessed. Call this on every endpoint call.
 * Lightweight — just increments an in-memory counter.
 *
 * @param fetchFn - closure that re-fetches the endpoint data. Must return the
 *   raw data (will be passed to smartCacheSet by the caller). Keep-warm calls
 *   this function during background refresh — do NOT include billing/auth logic.
 */
export function recordDemand(
  endpointId: string,
  cacheKey: string,
  ttlSeconds: number,
  fetchFn: () => Promise<unknown>,
): void {
  const now = Date.now();

  // If already enrolled, just bump lastAccessed
  const existing = warmMap.get(cacheKey);
  if (existing) {
    existing.lastAccessed = now;
    // Update fetchFn in case params changed (same cache key = same params, but closure may differ)
    existing.fetchFn = fetchFn;
    return;
  }

  // Track demand for enrollment decision
  const tracker = demandMap.get(cacheKey);
  const ttlMs = ttlSeconds * 1000;

  if (!tracker || (now - tracker.windowStart) > ttlMs) {
    // New window — start counting
    demandMap.set(cacheKey, {
      endpointId,
      cacheKey,
      ttlSeconds,
      count: 1,
      windowStart: now,
      fetchFn,
    });
  } else {
    tracker.count++;
    tracker.fetchFn = fetchFn; // Keep latest closure

    if (tracker.count >= ENROLL_THRESHOLD && warmMap.size < MAX_WARM_ENDPOINTS) {
      enroll(tracker);
      demandMap.delete(cacheKey);
    }
  }
}

// ── Enrollment ─────────────────────────────────────────────────────────────

function enroll(tracker: DemandTracker): void {
  if (warmMap.has(tracker.cacheKey)) return;
  if (warmMap.size >= MAX_WARM_ENDPOINTS) {
    logger.debug({ endpointId: tracker.endpointId }, 'Keep-warm: at capacity, skipping enrollment');
    return;
  }

  const now = Date.now();
  warmMap.set(tracker.cacheKey, {
    endpointId: tracker.endpointId,
    cacheKey: tracker.cacheKey,
    ttlSeconds: tracker.ttlSeconds,
    fetchFn: tracker.fetchFn,
    lastAccessed: now,
    lastRefreshed: now, // Pretend just refreshed — real data was just fetched by the call
    enrolledAt: now,
    refreshCount: 0,
    failCount: 0,
  });

  totalEnrollments++;
  logger.info(
    { endpointId: tracker.endpointId, enrolled: warmMap.size, max: MAX_WARM_ENDPOINTS },
    'Keep-warm: auto-enrolled (demand threshold reached)',
  );
}

function unenroll(cacheKey: string, reason: string): void {
  const entry = warmMap.get(cacheKey);
  if (!entry) return;
  warmMap.delete(cacheKey);
  totalUnenrollments++;
  logger.info(
    { endpointId: entry.endpointId, reason, refreshCount: entry.refreshCount, enrolled: warmMap.size },
    'Keep-warm: auto-unenrolled',
  );
}

// ── Background Tick ────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const now = Date.now();

  // Reset hourly counter
  if (now > hourlyResetAt) {
    hourlyRefreshCount = 0;
    hourlyResetAt = now + 3_600_000;
  }

  for (const [key, entry] of warmMap) {
    const ttlMs = entry.ttlSeconds * 1000;
    const timeSinceAccess = now - entry.lastAccessed;
    const timeSinceRefresh = now - entry.lastRefreshed;

    // ── Auto-unenroll: no access in UNENROLL_MULTIPLIER × TTL ──────────
    if (timeSinceAccess > ttlMs * UNENROLL_MULTIPLIER) {
      unenroll(key, `no access in ${Math.round(timeSinceAccess / 1000)}s (limit: ${entry.ttlSeconds * UNENROLL_MULTIPLIER}s)`);
      continue;
    }

    // ── Auto-unenroll: too many consecutive failures ───────────────────
    if (entry.failCount >= MAX_CONSECUTIVE_FAILURES) {
      unenroll(key, `${entry.failCount} consecutive failures`);
      continue;
    }

    // ── Hourly refresh budget check ────────────────────────────────────
    if (hourlyRefreshCount >= MAX_REFRESHES_PER_HOUR) {
      continue; // Skip, don't unenroll — budget will reset next hour
    }

    // ── Refresh: when REFRESH_AT_PCT of TTL has elapsed since last refresh
    const refreshThreshold = ttlMs * REFRESH_AT_PCT;
    if (timeSinceRefresh >= refreshThreshold) {
      try {
        const data = await entry.fetchFn();
        if (data != null) {
          entry.lastRefreshed = Date.now();
          entry.refreshCount++;
          entry.failCount = 0;
          hourlyRefreshCount++;
          totalRefreshes++;
          logger.debug(
            { endpointId: entry.endpointId, cacheKey: key, hourlyCount: hourlyRefreshCount },
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

  // ── Clean up stale demand trackers ───────────────────────────────────
  for (const [key, tracker] of demandMap) {
    const ttlMs = tracker.ttlSeconds * 1000;
    if (now - tracker.windowStart > ttlMs * UNENROLL_MULTIPLIER) {
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
    { intervalMs: CHECK_INTERVAL_MS, maxEndpoints: MAX_WARM_ENDPOINTS, enrollThreshold: ENROLL_THRESHOLD },
    'Keep-warm started',
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
  const entries = Array.from(warmMap.values()).map(e => ({
    endpointId: e.endpointId,
    cacheKey: e.cacheKey,
    ttlSeconds: e.ttlSeconds,
    refreshCount: e.refreshCount,
    failCount: e.failCount,
    lastAccessedAgo: Math.round((now - e.lastAccessed) / 1000),
    lastRefreshedAgo: Math.round((now - e.lastRefreshed) / 1000),
    enrolledAgo: Math.round((now - e.enrolledAt) / 1000),
  }));

  return {
    enrolled: warmMap.size,
    maxEndpoints: MAX_WARM_ENDPOINTS,
    pendingTrackers: demandMap.size,
    hourlyRefreshCount,
    hourlyBudget: MAX_REFRESHES_PER_HOUR,
    lifetime: { totalEnrollments, totalUnenrollments, totalRefreshes },
    entries,
  };
}
