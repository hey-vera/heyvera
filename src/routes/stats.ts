import { Hono } from 'hono';
import { getDb, getDbStats, getActiveUserCount, getRevenueBreakdown } from '../db/index';
import { apiRegistry, getRegistryStats } from '../config/api-registry';
import { getLastDiscoveryResult } from '../core/endpoint-discovery';
import { round6 } from '../core/credits';

const statsRouter = new Hono();

// Public — no auth required. Backs the live stats bar on the homepage.
// NOTE: Do NOT expose circuit breaker state (operational vs down endpoints)
// on this unauthenticated endpoint — it reveals which providers are failing,
// which is useful to attackers and competitors.
statsRouter.get('/', (c) => {
  const db = getDbStats();
  const endpointCount = apiRegistry.length;
  const activeUsers = getActiveUserCount();

  const registryStats = getRegistryStats();
  const lastDiscovery = getLastDiscoveryResult();

  return c.json({
    totalCalls: db.totalOrchestrations,
    avgDurationMs: db.avgDurationMs,
    successRate: db.successRate,
    activeUsers,
    endpoints: {
      total: endpointCount,
      static: endpointCount - registryStats.discovered,
      discovered: registryStats.discovered,
      byProvider: registryStats.byProvider,
    },
    discovery: lastDiscovery ?? { status: 'pending' },
    updatedAt: new Date().toISOString(),
  });
});

// ─── Public Roadmap Stats ─────────────────────────────────────────────────────
// Powers the roadmap page progress bar. No auth required.
// Exposes only aggregate revenue — no breakdown, no per-user data.

const MILESTONES = [
  { name: 'Checkpoint 1',   target: 25_000, description: 'Early traction — proving product-market fit' },
  { name: 'Checkpoint 2',   target: 50_000, description: 'Sustainable growth — ready for token infrastructure' },
  { name: 'Launch',         target: 100_000, description: 'Full launch with real liquidity, marketing + exchange listings' },
];

statsRouter.get('/roadmap', (c) => {
  const rev = getRevenueBreakdown();
  // Use PLATFORM FEES (actual earned revenue), not gross customer payments.
  // payments.totalUsd = what customers paid us (gross).
  // totalPlatformUsdEquiv = what the platform actually earned (net revenue from fees).
  // The roadmap tracks NET revenue — what we actually earned, not what customers deposited.
  const totalRevenueUsd = rev.totalPlatformUsdEquiv;
  const platformCreditsEarned = rev.totalPlatformCredits;
  const users = rev.payments.keyCount;

  const launchTarget = 100_000;
  const currentMilestone = MILESTONES.find(m => totalRevenueUsd < m.target) ?? MILESTONES[MILESTONES.length - 1];
  const progress = Math.min(100, Math.round((totalRevenueUsd / launchTarget) * 10000) / 100);

  return c.json({
    revenue: {
      totalUsd: Math.round(totalRevenueUsd * 100) / 100,
      platformFeesCredits: platformCreditsEarned,
      platformFeesUsd: Math.round(totalRevenueUsd * 100) / 100,
      users,
    },
    milestones: MILESTONES.map(m => ({
      name: m.name,
      targetUsd: m.target,
      reached: totalRevenueUsd >= m.target,
      description: m.description,
    })),
    current: {
      milestone: currentMilestone.name,
      targetUsd: currentMilestone.target,
      progressPct: progress,
    },
    tokenLaunch: {
      status: totalRevenueUsd >= 100_000 ? 'READY' : totalRevenueUsd >= 50_000 ? 'VIABLE' : 'BUILDING',
      split: { burn: 50, buybackLp: 20, treasury: 15, rewards: 15 },
    },
    updatedAt: new Date().toISOString(),
  });
});

// ─── Public Skill Health Metrics ─────────────────────────────────────────────
// No auth — designed for 402index.io and similar directories to crawl.
// Exposes health data already collected by skill-health-cron (every 15m).

interface HealthSkillRow {
  id: string;
  name: string;
  skill_type: string;
  health_status: string;
  health_checked_at: string | null;
  avg_latency_ms: number;
  success_rate: number;
  avg_rating: number;
  rating_count: number;
  proxy_url: string | null;
}

statsRouter.get('/health/skills', (c) => {
  const skills = getDb().prepare(
    `SELECT id, name, skill_type, health_status, health_checked_at,
            avg_latency_ms, success_rate, avg_rating, rating_count, proxy_url
     FROM skills
     WHERE active = 1 AND public = 1 AND security_status != 'FLAGGED'
     ORDER BY health_status ASC, name ASC
     LIMIT 500`
  ).all() as HealthSkillRow[];

  const total = skills.length;
  const healthy = skills.filter(s => s.health_status === 'HEALTHY').length;
  const degraded = skills.filter(s => s.health_status === 'DEGRADED').length;
  const down = total - healthy - degraded;
  const uptimePct = total > 0 ? round6((healthy / total) * 100) : 100;

  const overallStatus = down > total * 0.5 ? 'major_outage'
    : degraded + down > total * 0.25 ? 'partial_outage'
    : degraded > 0 ? 'degraded'
    : 'operational';

  return c.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checkIntervalMinutes: 15,
    summary: {
      total,
      healthy,
      degraded,
      down,
      uptimePct,
    },
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      status: s.health_status,
      avgLatencyMs: Math.round(s.avg_latency_ms),
      successRate: round6(s.success_rate / 100), // stored as 0-100, expose as 0-1
      avgRating: round6(s.avg_rating),
      ratingCount: s.rating_count,
      lastChecked: s.health_checked_at ?? null,
      protocol: s.proxy_url ? 'x402' : s.skill_type === 'prompt_template' ? 'credits' : 'credits',
      skillType: s.skill_type,
    })),
  });
});

export { statsRouter };
