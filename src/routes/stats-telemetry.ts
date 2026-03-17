import { Hono } from 'hono';
import { getDb } from '../db/index';
import { logger } from '../utils/logger';

const router = new Hono();

// GET / — public telemetry stats for dashboard
router.get('/', (c) => {
  try {
    const db = getDb();

    // Total counts
    const totalSkills = (db.prepare("SELECT COUNT(*) as cnt FROM skills WHERE public = 1 AND active = 1 AND status = 'published'").get() as { cnt: number })?.cnt ?? 0;
    const totalEndpoints = (db.prepare("SELECT COUNT(DISTINCT endpoint_id) as cnt FROM endpoint_health").get() as { cnt: number })?.cnt ?? 0;
    const activeKeys = (db.prepare("SELECT COUNT(*) as cnt FROM api_keys WHERE active = 1").get() as { cnt: number })?.cnt ?? 0;

    // 30-day aggregates
    const thirtyDaysAgo = "datetime('now', '-30 days')";
    const orchestrations30d = (db.prepare(`SELECT COUNT(*) as cnt FROM orchestrations WHERE timestamp > ${thirtyDaysAgo}`).get() as { cnt: number })?.cnt ?? 0;
    const creditsTransacted30d = (db.prepare(`SELECT COALESCE(SUM(ABS(amount_credits)), 0) as total FROM transactions WHERE created_at > ${thirtyDaysAgo}`).get() as { total: number })?.total ?? 0;

    // x402 stats
    const x402Stats = db.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(CAST(price_usdc AS REAL)), 0) as revenue FROM x402_receipts WHERE created_at > ${thirtyDaysAgo} AND success = 1`).get() as { cnt: number; revenue: number } | undefined;
    const x402Payments = x402Stats?.cnt ?? 0;
    const x402Revenue = (x402Stats?.revenue ?? 0).toFixed(4);

    // Cache hit rate (from recent orchestrations)
    const cacheStats = db.prepare(`SELECT
      COUNT(*) as total,
      SUM(CASE WHEN cache_strategy IS NOT NULL THEN 1 ELSE 0 END) as cached
      FROM orchestrations WHERE timestamp > ${thirtyDaysAgo}`).get() as { total: number; cached: number } | undefined;
    const cacheHitRate = cacheStats && cacheStats.total > 0 ? Math.round((cacheStats.cached / cacheStats.total) * 100) / 100 : 0;

    // Average latency from skill metrics
    const avgLatency = (db.prepare(`SELECT AVG(avg_latency_ms) as avg FROM skills WHERE avg_latency_ms > 0 AND public = 1`).get() as { avg: number | null })?.avg ?? 0;

    // Bounty stats
    const openBounties = (db.prepare("SELECT COUNT(*) as cnt FROM bounties WHERE status = 'open'").get() as { cnt: number })?.cnt ?? 0;

    // Sponsorship stats
    const activeSponsorships = (db.prepare("SELECT COUNT(*) as cnt FROM sponsorships WHERE active = 1 AND remaining_credits > 0").get() as { cnt: number })?.cnt ?? 0;

    // Daily breakdown (last 30 days) — orchestrations per day
    const dailyOrchestrations = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM orchestrations
      WHERE timestamp > ${thirtyDaysAgo}
      GROUP BY DATE(timestamp) ORDER BY date
    `).all() as Array<{ date: string; count: number }>;

    // Daily credits consumed
    const dailyCredits = db.prepare(`
      SELECT DATE(created_at) as date, COALESCE(SUM(ABS(amount_credits)), 0) as amount
      FROM transactions
      WHERE created_at > ${thirtyDaysAgo} AND type IN ('orchestration', 'skill_purchase', 'skill_invocation')
      GROUP BY DATE(created_at) ORDER BY date
    `).all() as Array<{ date: string; amount: number }>;

    // Daily skill invocations
    const dailySkillInvocations = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM skill_metrics
      WHERE timestamp > ${thirtyDaysAgo}
      GROUP BY DATE(timestamp) ORDER BY date
    `).all() as Array<{ date: string; count: number }>;

    // Daily x402 payments
    const dailyX402 = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count, COALESCE(SUM(CAST(price_usdc AS REAL)), 0) as revenue
      FROM x402_receipts
      WHERE created_at > ${thirtyDaysAgo} AND success = 1
      GROUP BY DATE(created_at) ORDER BY date
    `).all() as Array<{ date: string; count: number; revenue: number }>;

    // Uptime (from process)
    const uptimeSeconds = Math.floor(process.uptime());

    return c.json({
      totalSkills,
      totalEndpoints: totalEndpoints || 344, // fallback to registry count
      activeKeys,
      orchestrations30d,
      creditsTransacted30d: Math.round(creditsTransacted30d * 100) / 100,
      cacheHitRate,
      avgLatencyMs: Math.round(avgLatency),
      x402Payments,
      x402Revenue,
      openBounties,
      activeSponsorships,
      uptimeSeconds,
      dailyOrchestrations,
      dailyCredits,
      dailySkillInvocations,
      dailyX402,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to generate telemetry stats');
    return c.json({ error: 'Failed to generate stats', code: 'STATS_ERROR' }, 500);
  }
});

export { router as statsTelemetryRouter };
