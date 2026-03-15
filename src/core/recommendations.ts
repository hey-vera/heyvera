/**
 * Usage-Driven Skill Recommendations — collaborative filtering flywheel.
 *
 * "Agents who used X also used Y" — mines the transactions table
 * for co-usage patterns to drive discovery.
 */

import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Recommendation {
  skillId: string;
  name: string;
  coUsageCount: number;
  coUsageRate: number;
  creditCost: number;
  avgRating: number;
}

export interface PopularSkill {
  skillId: string;
  name: string;
  usageCount: number;
  uniqueUsers: number;
  avgRating: number;
  trend: 'up' | 'down' | 'stable';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodToSql(period: 'day' | 'week' | 'month'): string {
  switch (period) {
    case 'day':   return "datetime('now', '-1 day')";
    case 'week':  return "datetime('now', '-7 days')";
    case 'month': return "datetime('now', '-30 days')";
  }
}

function previousPeriodSql(period: 'day' | 'week' | 'month'): [string, string] {
  switch (period) {
    case 'day':   return ["datetime('now', '-2 days')", "datetime('now', '-1 day')"];
    case 'week':  return ["datetime('now', '-14 days')", "datetime('now', '-7 days')"];
    case 'month': return ["datetime('now', '-60 days')", "datetime('now', '-30 days')"];
  }
}

// ─── Recommendations ─────────────────────────────────────────────────────────

/**
 * Collaborative filter: find skills frequently co-used with `skillId`.
 *
 * SQL strategy: find all api_keys that transacted on skillId, then find
 * other skills those keys also transacted, ranked by frequency.
 */
export function getRecommendationsForSkill(skillId: string, limit: number = 5): Recommendation[] {
  try {
    const rows = getDb().prepare(`
      SELECT
        t2.skill_id   AS skillId,
        s.name         AS name,
        COUNT(*)       AS coUsageCount,
        s.credit_cost  AS creditCost,
        s.avg_rating   AS avgRating
      FROM transactions t1
      JOIN transactions t2 ON t1.from_agent = t2.from_agent
      JOIN skills s ON t2.skill_id = s.id
      WHERE t1.skill_id = ?
        AND t2.skill_id != ?
        AND t2.skill_id IS NOT NULL
        AND s.active = 1
        AND s.public = 1
      GROUP BY t2.skill_id
      ORDER BY coUsageCount DESC
      LIMIT ?
    `).all(skillId, skillId, limit) as Array<{
      skillId: string; name: string; coUsageCount: number; creditCost: number; avgRating: number;
    }>;

    // Compute co-usage rate: what fraction of skillId users also used the recommended skill
    const totalUsers = getDb().prepare(`
      SELECT COUNT(DISTINCT from_agent) AS cnt
      FROM transactions
      WHERE skill_id = ?
    `).get(skillId) as { cnt: number } | undefined;

    const userCount = totalUsers?.cnt ?? 1;

    return rows.map((r) => ({
      skillId: r.skillId,
      name: r.name,
      coUsageCount: r.coUsageCount,
      coUsageRate: Math.round((r.coUsageCount / Math.max(userCount, 1)) * 100) / 100,
      creditCost: r.creditCost,
      avgRating: r.avgRating,
    }));
  } catch (err) {
    logger.error({ err, skillId }, 'Failed to get skill recommendations');
    return [];
  }
}

/**
 * Personalised recommendations: find skills the agent hasn't tried, based on
 * overlap with agents that share 3+ skills in common.
 */
export function getRecommendationsForAgent(apiKey: string, limit: number = 10): Recommendation[] {
  try {
    const rows = getDb().prepare(`
      WITH my_skills AS (
        SELECT DISTINCT skill_id FROM transactions WHERE from_agent = ? AND skill_id IS NOT NULL
      ),
      similar_agents AS (
        SELECT t.from_agent, COUNT(DISTINCT t.skill_id) AS overlap
        FROM transactions t
        JOIN my_skills ms ON t.skill_id = ms.skill_id
        WHERE t.from_agent != ?
        GROUP BY t.from_agent
        HAVING overlap >= 3
      ),
      candidate_skills AS (
        SELECT t.skill_id, COUNT(*) AS freq
        FROM transactions t
        JOIN similar_agents sa ON t.from_agent = sa.from_agent
        WHERE t.skill_id IS NOT NULL
          AND t.skill_id NOT IN (SELECT skill_id FROM my_skills)
        GROUP BY t.skill_id
      )
      SELECT
        cs.skill_id    AS skillId,
        s.name         AS name,
        cs.freq        AS coUsageCount,
        s.credit_cost  AS creditCost,
        s.avg_rating   AS avgRating
      FROM candidate_skills cs
      JOIN skills s ON cs.skill_id = s.id
      WHERE s.active = 1 AND s.public = 1
      ORDER BY cs.freq DESC
      LIMIT ?
    `).all(apiKey, apiKey, limit) as Array<{
      skillId: string; name: string; coUsageCount: number; creditCost: number; avgRating: number;
    }>;

    return rows.map((r) => ({
      skillId: r.skillId,
      name: r.name,
      coUsageCount: r.coUsageCount,
      coUsageRate: 0, // not applicable for agent-level recommendations
      creditCost: r.creditCost,
      avgRating: r.avgRating,
    }));
  } catch (err) {
    logger.error({ err }, 'Failed to get agent recommendations');
    return [];
  }
}

/**
 * Most-used skills in the given period, with trend vs previous period.
 */
export function getPopularSkills(period: 'day' | 'week' | 'month' = 'week', limit: number = 10): PopularSkill[] {
  try {
    const since = periodToSql(period);
    const [prevStart, prevEnd] = previousPeriodSql(period);

    // Current period stats
    const currentRows = getDb().prepare(`
      SELECT
        t.skill_id      AS skillId,
        s.name           AS name,
        COUNT(*)         AS usageCount,
        COUNT(DISTINCT t.from_agent) AS uniqueUsers,
        s.avg_rating     AS avgRating
      FROM transactions t
      JOIN skills s ON t.skill_id = s.id
      WHERE t.skill_id IS NOT NULL
        AND t.created_at >= ${since}
        AND s.active = 1
        AND s.public = 1
      GROUP BY t.skill_id
      ORDER BY usageCount DESC
      LIMIT ?
    `).all(limit) as Array<{
      skillId: string; name: string; usageCount: number; uniqueUsers: number; avgRating: number;
    }>;

    // Previous period counts for trend calculation
    const prevRows = getDb().prepare(`
      SELECT skill_id AS skillId, COUNT(*) AS cnt
      FROM transactions
      WHERE skill_id IS NOT NULL
        AND created_at >= ${prevStart}
        AND created_at < ${prevEnd}
      GROUP BY skill_id
    `).all() as Array<{ skillId: string; cnt: number }>;

    const prevMap = new Map(prevRows.map((r) => [r.skillId, r.cnt]));

    return currentRows.map((r) => {
      const prev = prevMap.get(r.skillId) ?? 0;
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (prev === 0 && r.usageCount > 0) trend = 'up';
      else if (prev > 0) {
        const change = (r.usageCount - prev) / prev;
        if (change > 0.1) trend = 'up';
        else if (change < -0.1) trend = 'down';
      }
      return {
        skillId: r.skillId,
        name: r.name,
        usageCount: r.usageCount,
        uniqueUsers: r.uniqueUsers,
        avgRating: r.avgRating,
        trend,
      };
    });
  } catch (err) {
    logger.error({ err, period }, 'Failed to get popular skills');
    return [];
  }
}

/**
 * Skills with the highest week-over-week growth (min 5 uses this week).
 */
export function getTrendingSkills(limit: number = 10): PopularSkill[] {
  try {
    const rows = getDb().prepare(`
      WITH this_week AS (
        SELECT skill_id, COUNT(*) AS cnt, COUNT(DISTINCT from_agent) AS users
        FROM transactions
        WHERE skill_id IS NOT NULL AND created_at >= datetime('now', '-7 days')
        GROUP BY skill_id
        HAVING cnt >= 5
      ),
      last_week AS (
        SELECT skill_id, COUNT(*) AS cnt
        FROM transactions
        WHERE skill_id IS NOT NULL
          AND created_at >= datetime('now', '-14 days')
          AND created_at < datetime('now', '-7 days')
        GROUP BY skill_id
      )
      SELECT
        tw.skill_id   AS skillId,
        s.name         AS name,
        tw.cnt         AS usageCount,
        tw.users       AS uniqueUsers,
        s.avg_rating   AS avgRating,
        COALESCE(lw.cnt, 0) AS lastWeekCount
      FROM this_week tw
      JOIN skills s ON tw.skill_id = s.id
      LEFT JOIN last_week lw ON tw.skill_id = lw.skill_id
      WHERE s.active = 1 AND s.public = 1
      ORDER BY
        CASE WHEN COALESCE(lw.cnt, 0) = 0 THEN 999999
             ELSE CAST(tw.cnt AS REAL) / lw.cnt END DESC
      LIMIT ?
    `).all(limit) as Array<{
      skillId: string; name: string; usageCount: number; uniqueUsers: number;
      avgRating: number; lastWeekCount: number;
    }>;

    return rows.map((r) => ({
      skillId: r.skillId,
      name: r.name,
      usageCount: r.usageCount,
      uniqueUsers: r.uniqueUsers,
      avgRating: r.avgRating,
      trend: 'up' as const,
    }));
  } catch (err) {
    logger.error({ err }, 'Failed to get trending skills');
    return [];
  }
}
