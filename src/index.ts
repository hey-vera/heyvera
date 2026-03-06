import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { env, isSimulationMode } from './config/index';
import { logger } from './utils/logger';
import { apiRouter } from './routes/api';
import { initRedis } from './cache/index';
import { checkApiKey } from './middleware/auth';
import { rateLimiter } from './middleware/rate-limit';
import { startHeartbeat } from './core/heartbeat';
import { setupGracefulShutdown } from './utils/shutdown';
import { feedbackRouter } from './routes/feedback';
import { initTelegram, stopTelegram } from './integrations/telegram';
import { initDb, closeDb } from './db/index';
import { adminRouter } from './routes/admin';

const app = new Hono();

app.use('*', cors());
app.use('*', honoLogger());
app.use('*', rateLimiter);

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

// Auth only on orchestrate endpoint
app.use('/v1/orchestrate', checkApiKey);
app.route('/v1/feedback', feedbackRouter);
app.route('/v1/admin', adminRouter);

app.route('/v1', apiRouter);

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

async function start() {
  initDb();
  await initRedis();
  setupGracefulShutdown();
  startHeartbeat();
  await initTelegram();

  serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, () => {
    logger.info(`ClawNet running on port ${env.PORT}`);
    logger.info(`Mode: ${env.NODE_ENV} | Simulation: ${isSimulationMode}`);
    logger.info(`LLM: ${env.LLM_PROVIDER}`);
  });
}

start().catch(async (err) => {
  logger.error({ err }, 'Failed to start server');
  await stopTelegram();
  process.exit(1);
});