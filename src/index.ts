import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { env } from './config/index';
import { logger } from './utils/logger';
import { apiRouter } from './routes/api';
import { initRedis, closeRedis } from './cache/index';

const app = new Hono();

app.use('*', cors());
app.use('*', honoLogger());

app.use('*', async (c, next) => {
  const { nanoid } = await import('nanoid');
  c.header('X-Request-ID', nanoid(12));
  await next();
});

app.get('/', (c) => c.json({
  name: 'ClawNet Orchestrator',
  version: '1.0.0',
  description: 'Universal Workflow Orchestration Layer for ClawAPIs',
  docs: '/v1/registry',
  health: '/v1/health',
}));

app.route('/v1', apiRouter);

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

async function start() {
  await initRedis();
  serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, () => {
    logger.info(`🦀 ClawNet running on port ${env.PORT}`);
    logger.info(`📡 Mode: ${env.NODE_ENV} | Simulation: ${isSimulationMode}`);
    logger.info(`🤖 LLM: ${env.LLM_PROVIDER}`);
  });
}

import { isSimulationMode } from './config/index';

process.on('SIGTERM', async () => { await closeRedis(); process.exit(0); });
process.on('SIGINT', async () => { await closeRedis(); process.exit(0); });

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});