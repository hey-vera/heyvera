/**
 * Registry & Health Routes
 *
 * GET /v1/registry          — list all API endpoints with optional search/filter
 * GET /v1/registry/health   — live uptime/latency for monitored endpoints
 * GET /v1/registry/:id      — single endpoint detail
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { apiRegistry } from '../config/api-registry';
import { getEndpointHealth } from '../db/index';

export const registryRouter = new Hono();

// ─── GET /v1/registry — browse endpoint catalog ───────────────────────────────

const ListQuery = z.object({
  q:        z.string().optional(),
  category: z.string().optional(),
  provider: z.string().optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
});

registryRouter.get('/', (c) => {
  let q: z.infer<typeof ListQuery>;
  try { q = ListQuery.parse(c.req.query()); } catch { return c.json({ error: 'Invalid query params', code: 'VALIDATION_ERROR' }, 400); }

  let endpoints = apiRegistry;

  if (q.category) {
    endpoints = endpoints.filter((e) => e.category === q.category);
  }
  if (q.provider) {
    const pLower = q.provider.toLowerCase();
    endpoints = endpoints.filter((e) => e.provider.toLowerCase().includes(pLower));
  }
  if (q.q) {
    const search = q.q.toLowerCase();
    endpoints = endpoints.filter((e) =>
      e.name.toLowerCase().includes(search) ||
      e.description.toLowerCase().includes(search) ||
      e.provider.toLowerCase().includes(search) ||
      e.id.includes(search)
    );
  }

  const total = endpoints.length;
  const page = endpoints.slice(q.offset, q.offset + q.limit);

  return c.json({
    total,
    offset: q.offset,
    limit: q.limit,
    endpoints: page.map((e) => ({
      id: e.id,
      provider: e.provider,
      name: e.name,
      description: e.description,
      category: e.category,
      costPerCall: e.costPerCall,
      latencyMs: e.latencyMs,
      baseUrl: e.baseUrl,
      path: e.path,
      inputSchema: e.inputSchema,
      outputFields: e.outputFields,
    })),
    categories: [...new Set(apiRegistry.map((e) => e.category))].sort(),
    providers: [...new Set(apiRegistry.map((e) => e.provider))].sort(),
  });
});

// ─── GET /v1/registry/health — endpoint health status ────────────────────────

registryRouter.get('/health', (c) => {
  const healthRecords = getEndpointHealth();
  const healthMap = new Map(healthRecords.map((h) => [h.endpoint_id, h]));

  // Merge with full registry to show all endpoints (even unmonitored ones)
  const all = apiRegistry.map((ep) => {
    const h = healthMap.get(ep.id);
    return {
      id: ep.id,
      provider: ep.provider,
      name: ep.name,
      category: ep.category,
      status: h?.last_status ?? 'unknown',
      uptimePct: h ? parseFloat(h.uptime_pct.toFixed(1)) : null,
      avgLatencyMs: h?.avg_latency_ms ?? null,
      lastChecked: h?.last_checked ?? null,
      lastError: h?.last_error ?? null,
      monitored: !!h,
    };
  });

  const monitored = all.filter((e) => e.monitored);
  const upCount = monitored.filter((e) => e.status === 'up').length;
  const downCount = monitored.filter((e) => e.status === 'down').length;
  const degradedCount = monitored.filter((e) => e.status === 'degraded').length;

  return c.json({
    summary: {
      total: all.length,
      monitored: monitored.length,
      up: upCount,
      degraded: degradedCount,
      down: downCount,
      unknown: all.length - monitored.length,
      overallHealth: monitored.length > 0
        ? `${Math.round((upCount / monitored.length) * 100)}%`
        : 'n/a',
    },
    endpoints: all,
    lastUpdated: monitored.length > 0
      ? monitored.reduce((latest, e) => e.lastChecked && e.lastChecked > latest ? e.lastChecked : latest, '')
      : null,
  });
});

// ─── GET /v1/registry/:id — single endpoint detail ───────────────────────────

registryRouter.get('/:id', (c) => {
  const { id } = c.req.param();
  const ep = apiRegistry.find((e) => e.id === id);
  if (!ep) return c.json({ error: 'Endpoint not found', code: 'NOT_FOUND' }, 404);

  const [health] = getEndpointHealth(id);
  return c.json({
    ...ep,
    health: health ? {
      status: health.last_status,
      uptimePct: parseFloat(health.uptime_pct.toFixed(1)),
      avgLatencyMs: health.avg_latency_ms,
      successCount: health.success_count,
      failureCount: health.failure_count,
      lastChecked: health.last_checked,
      lastError: health.last_error,
    } : null,
  });
});
