/**
 * Soma Check public API — shadow telemetry dashboard.
 *
 *   GET /v1/soma/check/stats            — summary top-line across all endpoints
 *   GET /v1/soma/check/stats/:endpointId — per-endpoint breakdown
 *
 * Data source: soma_check_events (migration 147).
 * Savings numbers are projections based on the 90% cache-hit discount ratio
 * from internal/soma-check-billing.md.
 */
import { Hono } from 'hono';
import { getSomaCheckStats, getSomaCheckSummary } from '../db/soma-check';

const somaCheckRouter = new Hono();

somaCheckRouter.get('/stats', (c) => {
  const sinceHours = parseInt(c.req.query('sinceHours') ?? '24', 10) || 24;
  const summary = getSomaCheckSummary({ sinceHours });
  const perEndpoint = getSomaCheckStats({ sinceHours });
  return c.json({
    protocol: 'soma-check/1.0',
    summary,
    endpoints: perEndpoint,
  });
});

somaCheckRouter.get('/stats/:endpointId', (c) => {
  const endpointId = c.req.param('endpointId');
  const sinceHours = parseInt(c.req.query('sinceHours') ?? '24', 10) || 24;
  const rows = getSomaCheckStats({ endpointId, sinceHours });
  if (rows.length === 0) {
    return c.json({
      protocol: 'soma-check/1.0',
      endpointId,
      windowHours: sinceHours,
      totalCalls: 0,
      message: 'No Soma Check events recorded for this endpoint in the window.',
    });
  }
  return c.json({
    protocol: 'soma-check/1.0',
    windowHours: sinceHours,
    ...rows[0],
  });
});

export default somaCheckRouter;
