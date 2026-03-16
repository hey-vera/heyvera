import { getDb } from '../db/index';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { getVolatilityStats } from './adaptive-ttl';
import { getCacheAnalytics } from './warming';

// ─── Cache Cost Optimizer ────────────────────────────────────────────────────
// Analyzes cache patterns and suggests TTL improvements + budget advice.

export interface TTLSuggestion {
  endpointId: string;
  currentTtl: number;
  suggestedTtl: number;
  reason: string;
  estimatedSavingsPerDay: number; // credits
}

export interface BudgetAdvice {
  currentBehavior: string;
  suggestion: string;
  estimatedMonthlySavings: number; // credits
  confidence: 'high' | 'medium' | 'low';
}

// ─── TTL Suggestions ─────────────────────────────────────────────────────────

/**
 * Analyze volatility and access patterns to suggest optimal TTLs.
 * Only suggests for endpoints with >= 20 accesses in the last week.
 */
export function getTTLSuggestions(): TTLSuggestion[] {
  try {
    const volatilityEntries = getVolatilityStats();
    const baseTtl = env.CACHE_TTL_SECONDS;

    // Get per-endpoint access counts + hit rates from the last week
    const accessRows = getDb().prepare(`
      SELECT endpoint_id,
             COUNT(*) as total_accesses,
             SUM(hit) as hits,
             SUM(CASE WHEN hit = 0 THEN 1 ELSE 0 END) as misses,
             ROUND(AVG(credits_saved), 6) as avg_credits_saved
      FROM cache_access_log
      WHERE created_at > datetime('now', '-7 days')
      GROUP BY endpoint_id
      HAVING COUNT(*) >= 20
    `).all() as Array<{
      endpoint_id: string;
      total_accesses: number;
      hits: number;
      misses: number;
      avg_credits_saved: number;
    }>;

    const accessMap = new Map(accessRows.map((r) => [r.endpoint_id, r]));
    const suggestions: TTLSuggestion[] = [];

    for (const entry of volatilityEntries) {
      const access = accessMap.get(entry.endpointId);
      if (!access) continue; // Not enough accesses

      const hitRate = access.total_accesses > 0 ? access.hits / access.total_accesses : 0;
      const currentTtl = Math.round(baseTtl * entry.currentTtlMultiplier);

      // Already optimal — high hit rate
      if (hitRate > 0.95) continue;

      if (entry.volatilityRatio < 0.1) {
        // Data rarely changes — increase TTL significantly
        const suggestedTtl = Math.min(currentTtl * 3, baseTtl * 7.5); // Cap at 7.5x base
        const missesPerDay = (access.misses / 7); // Weekly → daily
        const avgLiveCost = Math.max(access.avg_credits_saved, 0.1);
        const estimatedSavings = Math.round(missesPerDay * avgLiveCost * 0.9 * 100) / 100;

        suggestions.push({
          endpointId: entry.endpointId,
          currentTtl,
          suggestedTtl: Math.round(suggestedTtl),
          reason: `Data changes only ${Math.round(entry.volatilityRatio * 100)}% of the time — TTL can be much longer`,
          estimatedSavingsPerDay: estimatedSavings,
        });
      } else if (entry.volatilityRatio > 0.8) {
        // Data changes constantly — shorter TTL avoids stale data, caching is mostly wasted
        const suggestedTtl = Math.max(30, Math.round(currentTtl * 0.3));

        suggestions.push({
          endpointId: entry.endpointId,
          currentTtl,
          suggestedTtl,
          reason: `Data changes ${Math.round(entry.volatilityRatio * 100)}% of the time — caching is mostly wasted, reduce TTL to serve fresher data`,
          estimatedSavingsPerDay: 0, // No credit savings — this is about freshness
        });
      } else if (entry.volatilityRatio < 0.3 && hitRate < 0.6) {
        // Moderately stable but poor hit rate — bump TTL
        const suggestedTtl = Math.min(currentTtl * 2, baseTtl * 5);
        const missesPerDay = (access.misses / 7);
        const avgLiveCost = Math.max(access.avg_credits_saved, 0.1);
        const estimatedSavings = Math.round(missesPerDay * avgLiveCost * 0.5 * 100) / 100;

        suggestions.push({
          endpointId: entry.endpointId,
          currentTtl,
          suggestedTtl: Math.round(suggestedTtl),
          reason: `Low volatility (${Math.round(entry.volatilityRatio * 100)}%) but hit rate is only ${Math.round(hitRate * 100)}% — longer TTL would improve cache effectiveness`,
          estimatedSavingsPerDay: estimatedSavings,
        });
      }
    }

    // Sort by estimated savings descending
    suggestions.sort((a, b) => b.estimatedSavingsPerDay - a.estimatedSavingsPerDay);
    return suggestions;
  } catch (err) {
    logger.warn({ err }, 'Failed to generate TTL suggestions');
    return [];
  }
}

// ─── Budget Advisor ──────────────────────────────────────────────────────────

/**
 * Analyze an agent's orchestration history and suggest cache behavior improvements.
 */
export function getBudgetAdvice(apiKey: string): BudgetAdvice[] {
  try {
    const advice: BudgetAdvice[] = [];

    // 1. Check cache strategy distribution from orchestrations
    const strategyRows = getDb().prepare(`
      SELECT cache_strategy, COUNT(*) as cnt, SUM(credits_used) as total_credits
      FROM orchestrations
      WHERE api_key = ? AND created_at > datetime('now', '-30 days')
      GROUP BY cache_strategy
    `).all(apiKey) as Array<{ cache_strategy: string | null; cnt: number; total_credits: number }>;

    const totalQueries = strategyRows.reduce((sum, r) => sum + r.cnt, 0);
    if (totalQueries < 10) return advice; // Not enough data

    const freshRow = strategyRows.find((r) => r.cache_strategy === 'fresh');
    const freshPct = freshRow ? freshRow.cnt / totalQueries : 0;

    if (freshPct > 0.5) {
      const freshCredits = freshRow?.total_credits ?? 0;
      const estimatedSavings = Math.round(freshCredits * 0.3); // ~30% could be saved with smart caching

      advice.push({
        currentBehavior: `${Math.round(freshPct * 100)}% of your queries use cache:'fresh' (bypass cache)`,
        suggestion: "Switch to cache:'smart' for queries where real-time freshness isn't critical — you'll still get fresh data when content changes, but save credits on unchanged data.",
        estimatedMonthlySavings: estimatedSavings,
        confidence: 'high',
      });
    }

    // 2. Check for repeated identical queries within short windows
    const repeatedRows = getDb().prepare(`
      SELECT skill_id, COUNT(*) as cnt,
             MIN(created_at) as first_at, MAX(created_at) as last_at
      FROM orchestrations
      WHERE api_key = ? AND created_at > datetime('now', '-7 days')
        AND skill_id IS NOT NULL
      GROUP BY skill_id, strftime('%Y-%m-%d %H', created_at)
      HAVING COUNT(*) > 10
      ORDER BY cnt DESC
      LIMIT 5
    `).all(apiKey) as Array<{ skill_id: string; cnt: number; first_at: string; last_at: string }>;

    if (repeatedRows.length > 0) {
      const top = repeatedRows[0];
      const avgCostRow = getDb().prepare(`
        SELECT AVG(credits_used) as avg_cost
        FROM orchestrations
        WHERE api_key = ? AND skill_id = ? AND created_at > datetime('now', '-7 days')
      `).get(apiKey, top.skill_id) as { avg_cost: number } | undefined;

      const avgCost = avgCostRow?.avg_cost ?? 1;
      const wastedPerHour = Math.max(0, (top.cnt - 3)) * avgCost; // 3 queries/hr is reasonable
      const estimatedSavings = Math.round(wastedPerHour * 24 * 30);

      advice.push({
        currentBehavior: `You query "${top.skill_id}" ~${top.cnt} times/hour — most responses are likely identical`,
        suggestion: `Reduce polling frequency to every 2-3 minutes. The endpoint's adaptive TTL already serves cached data for rapid queries, so you're paying for redundant calls.`,
        estimatedMonthlySavings: estimatedSavings,
        confidence: 'medium',
      });
    }

    // 3. Check overall cache hit rate
    const cacheRow = getDb().prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN cache_hits > 0 THEN 1 ELSE 0 END) as cached
      FROM orchestrations
      WHERE api_key = ? AND created_at > datetime('now', '-30 days')
    `).get(apiKey) as { total: number; cached: number } | undefined;

    if (cacheRow && cacheRow.total > 20) {
      const hitRate = cacheRow.cached / cacheRow.total;
      if (hitRate < 0.2) {
        advice.push({
          currentBehavior: `Your cache hit rate is only ${Math.round(hitRate * 100)}% — most queries miss the cache`,
          suggestion: 'Your queries may use highly unique parameters that prevent cache reuse. Consider normalizing inputs (e.g., lowercase token symbols, remove trailing slashes) or using broader query patterns.',
          estimatedMonthlySavings: 0,
          confidence: 'low',
        });
      }
    }

    return advice;
  } catch (err) {
    logger.warn({ err, apiKey: maskApiKey(apiKey) }, 'Failed to generate budget advice');
    return [];
  }
}
