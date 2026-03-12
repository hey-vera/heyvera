import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { listAgentContexts, getAgentContextStats, clearAgentContext } from '../db/index';

const contextRouter = new Hono();

// All context routes require API key auth
contextRouter.use('*', checkApiKey);

/**
 * GET /v1/context — list agent's context entries (summary, no payload data)
 */
contextRouter.get('/', (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100'), 500);
  const entries = listAgentContexts(keyInfo.key, limit);
  return c.json({ entries, count: entries.length });
});

/**
 * GET /v1/context/stats — namespace stats (total entries, size, categories)
 */
contextRouter.get('/stats', (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const stats = getAgentContextStats(keyInfo.key);
  return c.json({
    ...stats,
    limits: {
      maxEntries: 500,
      maxSizeBytes: 5 * 1024 * 1024,
      ttlMultiplier: 3,
    },
  });
});

/**
 * DELETE /v1/context — clear all context entries for the agent
 */
contextRouter.delete('/', (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const deleted = clearAgentContext(keyInfo.key);
  return c.json({ deleted });
});

/**
 * DELETE /v1/context/:endpointId — clear context for a specific endpoint
 */
contextRouter.delete('/:endpointId', (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const endpointId = c.req.param('endpointId');
  const deleted = clearAgentContext(keyInfo.key, endpointId);
  return c.json({ deleted, endpointId });
});

export { contextRouter };
