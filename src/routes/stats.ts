import { Hono } from 'hono';
import { getDb, getDbStats } from '../db/index';
import { apiRegistry } from '../config/api-registry';
import { getCircuitStats } from '../core/circuit-breaker';

const statsRouter = new Hono();

// Public — no auth required. Backs the live stats bar on the homepage.
statsRouter.get('/', (c) => {
  const db = getDbStats();
  const circuits = getCircuitStats();

  const endpointCount = apiRegistry.length;
  const operationalCount = apiRegistry.filter((ep) => {
    const s = circuits[ep.id]?.state ?? 'CLOSED';
    return s === 'CLOSED' || s === 'HALF_OPEN';
  }).length;

  const costs = apiRegistry.map((ep) => ep.costPerCall);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;

  const { activeUsers } = getDb()
    .prepare(`SELECT COUNT(*) as activeUsers FROM api_keys WHERE active = 1 AND credits >= 1`)
    .get() as { activeUsers: number };

  return c.json({
    totalCalls: db.totalOrchestrations,
    avgDurationMs: db.avgDurationMs,
    successRate: db.successRate,
    totalRevenue: db.totalRevenue,
    activeUsers,
    endpoints: {
      total: endpointCount,
      operational: operationalCount,
      minCostUsd: +minCost.toFixed(4),
      maxCostUsd: +maxCost.toFixed(4),
      avgCostUsd: +avgCost.toFixed(4),
    },
    updatedAt: new Date().toISOString(),
  });
});

export { statsRouter };
