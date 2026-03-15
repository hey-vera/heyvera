import { Hono } from 'hono';
import { getDbStats, getActiveUserCount, getRevenueBreakdown } from '../db/index';
import { apiRegistry, getRegistryStats } from '../config/api-registry';
import { getLastDiscoveryResult } from '../core/endpoint-discovery';

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
      split: { burn: 40, buybackLp: 25, treasury: 20, rewards: 15 },
    },
    updatedAt: new Date().toISOString(),
  });
});

export { statsRouter };
