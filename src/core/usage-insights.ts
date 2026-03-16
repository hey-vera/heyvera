/**
 * Platform Usage Intelligence — aggregate usage data for platform health,
 * endpoint heatmaps, and ecosystem stats.
 */

import { getDb } from '../db/index';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlatformHealth {
  activeKeysToday: number;
  activeKeysThisWeek: number;
  totalSkills: number;
  totalTransactionsToday: number;
  totalCreditsSpentToday: number;
  cacheHitRate: number;
  avgResponseTimeMs: number;
  topEndpoints: Array<{ id: string; calls: number }>;
  revenueToday: number;
  revenueThisWeek: number;
}

export interface HeatmapData {
  hours: Array<{ hour: number; endpoints: Record<string, number> }>;
}

export interface EcosystemStats {
  totalSkills: number;
  byType: Record<string, number>;
  totalCreators: number;
  totalRevenuePaid: number;
  avgSkillRating: number;
  mostActiveCreator: { key: string; skillCount: number; revenue: number } | null;
  newestSkills: Array<{ id: string; name: string; createdAt: string }>;
}

// ─── Platform Health ──────────────────────────────────────────────────────────

/**
 * Aggregate platform health metrics: active keys, transactions, cache hit rate,
 * response times, and revenue.
 */
export function getPlatformHealth(): PlatformHealth {
  try {
    const db = getDb();

    const activeToday = db.prepare(`
      SELECT COUNT(DISTINCT from_agent) AS cnt FROM transactions
      WHERE created_at >= datetime('now', '-1 day')
    `).get() as { cnt: number };

    const activeWeek = db.prepare(`
      SELECT COUNT(DISTINCT from_agent) AS cnt FROM transactions
      WHERE created_at >= datetime('now', '-7 days')
    `).get() as { cnt: number };

    const totalSkills = db.prepare(`
      SELECT COUNT(*) AS cnt FROM skills WHERE active = 1
    `).get() as { cnt: number };

    const txToday = db.prepare(`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_credits), 0) AS spent FROM transactions
      WHERE created_at >= datetime('now', '-1 day')
    `).get() as { cnt: number; spent: number };

    // Cache hit rate from cache_access_log
    const cacheStats = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN hit = 1 THEN 1 ELSE 0 END) AS hits
      FROM cache_access_log
      WHERE created_at >= datetime('now', '-1 day')
    `).get() as { total: number; hits: number };

    const cacheHitRate = cacheStats.total > 0
      ? Math.round((cacheStats.hits / cacheStats.total) * 10000) / 10000
      : 0;

    // Average response time from orchestrations
    const avgResponse = db.prepare(`
      SELECT COALESCE(AVG(total_duration_ms), 0) AS avg FROM orchestrations
      WHERE timestamp >= datetime('now', '-1 day')
    `).get() as { avg: number };

    // Top endpoints by call count today (from orchestrations or transactions)
    const topEndpoints = db.prepare(`
      SELECT endpoint_id AS id, COUNT(*) AS calls
      FROM cache_access_log
      WHERE created_at >= datetime('now', '-1 day')
      GROUP BY endpoint_id
      ORDER BY calls DESC
      LIMIT 10
    `).all() as Array<{ id: string; calls: number }>;

    // Revenue: sum of transactions of type 'skill_invoke' or 'skill_purchase' to treasury or creators
    const revenueToday = db.prepare(`
      SELECT COALESCE(SUM(amount_credits), 0) AS total FROM transactions
      WHERE created_at >= datetime('now', '-1 day')
        AND type IN ('skill_purchase', 'skill_invoke', 'orchestration')
    `).get() as { total: number };

    const revenueWeek = db.prepare(`
      SELECT COALESCE(SUM(amount_credits), 0) AS total FROM transactions
      WHERE created_at >= datetime('now', '-7 days')
        AND type IN ('skill_purchase', 'skill_invoke', 'orchestration')
    `).get() as { total: number };

    return {
      activeKeysToday: activeToday.cnt,
      activeKeysThisWeek: activeWeek.cnt,
      totalSkills: totalSkills.cnt,
      totalTransactionsToday: txToday.cnt,
      totalCreditsSpentToday: txToday.spent,
      cacheHitRate,
      avgResponseTimeMs: Math.round(avgResponse.avg),
      topEndpoints,
      revenueToday: revenueToday.total,
      revenueThisWeek: revenueWeek.total,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get platform health');
    return {
      activeKeysToday: 0, activeKeysThisWeek: 0, totalSkills: 0,
      totalTransactionsToday: 0, totalCreditsSpentToday: 0, cacheHitRate: 0,
      avgResponseTimeMs: 0, topEndpoints: [], revenueToday: 0, revenueThisWeek: 0,
    };
  }
}

// ─── Endpoint Usage Heatmap ───────────────────────────────────────────────────

/**
 * Group endpoint usage by hour of day — useful for cache warming strategies.
 */
export function getEndpointUsageHeatmap(hours: number = 24): HeatmapData {
  try {
    const rows = getDb().prepare(`
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) AS hour,
        endpoint_id,
        COUNT(*) AS cnt
      FROM cache_access_log
      WHERE created_at >= datetime('now', '-' || ? || ' hours')
      GROUP BY hour, endpoint_id
      ORDER BY hour ASC
    `).all(hours) as Array<{ hour: number; endpoint_id: string; cnt: number }>;

    // Build hour buckets
    const hourMap = new Map<number, Record<string, number>>();
    for (let h = 0; h < 24; h++) hourMap.set(h, {});

    for (const row of rows) {
      const bucket = hourMap.get(row.hour) ?? {};
      bucket[row.endpoint_id] = row.cnt;
      hourMap.set(row.hour, bucket);
    }

    return {
      hours: Array.from(hourMap.entries()).map(([hour, endpoints]) => ({ hour, endpoints })),
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get endpoint usage heatmap');
    return { hours: [] };
  }
}

// ─── Skill Ecosystem Stats ───────────────────────────────────────────────────

/**
 * Aggregate ecosystem statistics: skill counts by type, creators, revenue, ratings.
 */
export function getSkillEcosystemStats(): EcosystemStats {
  try {
    const db = getDb();

    const totalSkills = db.prepare(`
      SELECT COUNT(*) AS cnt FROM skills WHERE active = 1
    `).get() as { cnt: number };

    const byTypeRows = db.prepare(`
      SELECT skill_type, COUNT(*) AS cnt FROM skills WHERE active = 1 GROUP BY skill_type
    `).all() as Array<{ skill_type: string; cnt: number }>;

    const byType: Record<string, number> = {};
    for (const r of byTypeRows) byType[r.skill_type] = r.cnt;

    const totalCreators = db.prepare(`
      SELECT COUNT(DISTINCT author_key) AS cnt FROM skills WHERE active = 1
    `).get() as { cnt: number };

    const totalRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount_credits), 0) AS total FROM transactions
      WHERE type = 'payout'
    `).get() as { total: number };

    const avgRating = db.prepare(`
      SELECT COALESCE(AVG(avg_rating), 0) AS avg FROM skills
      WHERE active = 1 AND rating_count > 0
    `).get() as { avg: number };

    // Most active creator by skill count + revenue
    const topCreator = db.prepare(`
      SELECT
        s.author_key AS key,
        COUNT(DISTINCT s.id) AS skillCount,
        COALESCE(SUM(t.amount_credits), 0) AS revenue
      FROM skills s
      LEFT JOIN transactions t ON t.to_agent = s.author_key AND t.type IN ('skill_purchase', 'skill_invoke', 'payout')
      WHERE s.active = 1
      GROUP BY s.author_key
      ORDER BY skillCount DESC, revenue DESC
      LIMIT 1
    `).get() as { key: string; skillCount: number; revenue: number } | undefined;

    const newestSkills = db.prepare(`
      SELECT id, name, created_at AS createdAt FROM skills
      WHERE active = 1 AND public = 1
      ORDER BY created_at DESC
      LIMIT 10
    `).all() as Array<{ id: string; name: string; createdAt: string }>;

    return {
      totalSkills: totalSkills.cnt,
      byType,
      totalCreators: totalCreators.cnt,
      totalRevenuePaid: totalRevenue.total,
      avgSkillRating: Math.round(avgRating.avg * 100) / 100,
      mostActiveCreator: topCreator ? { key: topCreator.key, skillCount: topCreator.skillCount, revenue: topCreator.revenue } : null,
      newestSkills,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get ecosystem stats');
    return {
      totalSkills: 0, byType: {}, totalCreators: 0, totalRevenuePaid: 0,
      avgSkillRating: 0, mostActiveCreator: null, newestSkills: [],
    };
  }
}
