import { contactRoute } from './routes/contact'
import { dashboardRouter } from './routes/dashboard';
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
import { initDb, closeDb, getApiKeyBalance } from './db/index';
import { adminRouter } from './routes/admin';
import { initClawApis } from './providers/clawapis';
import { stripeRouter } from './routes/stripe';

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

// app routing
app.route('/v1/webhooks', stripeRouter);
app.route('/v1/dashboard', dashboardRouter);
app.route('/', contactRoute)

// Balance check — no credit deduction
app.get('/v1/balance', async (c) => {
  const key = c.req.header('X-API-Key');
  if (!key) return c.json({ error: 'Missing X-API-Key header', code: 'INVALID_API_KEY' }, 401);
  const balance = getApiKeyBalance(key);
  if (!balance) return c.json({ error: 'Invalid or inactive key', code: 'INVALID_API_KEY' }, 401);
  return c.json({
    credits: balance.credits,
    creditsUsed: balance.credits_used,
    memberSince: balance.created_at,
  });
});

app.use('/v1/orchestrate', checkApiKey);
app.route('/v1/feedback', feedbackRouter);
app.route('/v1/admin', adminRouter);
app.route('/v1', apiRouter);

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

async function start() {
  initDb();
  await initRedis();

  const clawReady = await initClawApis();
  if (clawReady) {
    logger.info('ClawAPIs x402: ready for real API calls');
  } else {
    logger.info('ClawAPIs x402: no SOLANA_PRIVATE_KEY set, simulation mode active');
  }

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