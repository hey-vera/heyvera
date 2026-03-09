import { Hono } from 'hono';
import { apiRegistry } from '../config/api-registry';
import { getCircuitStats } from '../core/circuit-breaker';

const endpointsRouter = new Hono();

// Public — no auth required. Used by the endpoints catalog page.
endpointsRouter.get('/', (c) => {
  const circuits = getCircuitStats();

  const data = apiRegistry.map((ep) => {
    const circuit = circuits[ep.id];
    const state = circuit?.state ?? 'CLOSED';
    const failures = circuit?.failures ?? 0;

    const status: 'operational' | 'degraded' | 'down' =
      state === 'CLOSED'    ? 'operational' :
      state === 'HALF_OPEN' ? 'degraded'    : 'down';

    return {
      id:           ep.id,
      provider:     ep.provider,
      name:         ep.name,
      description:  ep.description,
      category:     ep.category,
      costPerCall:  ep.costPerCall,
      latencyMs:    ep.latencyMs,
      inputSchema:  ep.inputSchema,
      outputFields: ep.outputFields,
      rateLimit:    ep.rateLimit ?? null,
      status,
      circuitState: state,
      failures,
    };
  });

  const total = data.length;
  const operational = data.filter((e) => e.status === 'operational').length;
  const providers = [...new Set(data.map((e) => e.provider))].length;
  const avgCost = data.reduce((s, e) => s + e.costPerCall, 0) / total;
  const avgLatency = Math.round(data.reduce((s, e) => s + e.latencyMs, 0) / total);

  return c.json({
    meta: { total, operational, providers, avgCost: +avgCost.toFixed(4), avgLatency },
    endpoints: data,
    generatedAt: new Date().toISOString(),
  });
});

export { endpointsRouter };
