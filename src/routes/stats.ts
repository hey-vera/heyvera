import { Hono } from 'hono';
import { getDbStats, getActiveUserCount } from '../db/index';
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

export { statsRouter };
