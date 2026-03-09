import * as Sentry from '@sentry/node';
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
import { initDb, getApiKeyBalance } from './db/index';
import { adminRouter } from './routes/admin';
import { initClawApis } from './providers/clawapis';
import { stripeRouter } from './routes/stripe';
import { solanaRouter } from './routes/solana';
import { meshRouter } from './routes/mesh';
import { referralRouter } from './routes/referral';
import { skillsRouter } from './routes/skills';
import { endpointsRouter } from './routes/endpoints';
import { discoverRouter } from './routes/discover';
import { statsRouter } from './routes/stats';
import { escrowRouter } from './routes/escrow';
import { marketplaceRouter } from './routes/marketplace';
import { startEscrowCron } from './core/escrow-cron';
import { startSkillAbCron } from './core/skill-ab-cron';
import { startMeshNode } from './mesh/node';
import { loadEmbeddingModel } from './core/embeddings';
import { seedEmbeddings } from './core/seed-embeddings';
import { seedOfficialSkills } from './core/seed-skills';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' });
}

const app = new Hono();

app.use('*', cors());
app.use('*', honoLogger());
app.use('*', rateLimiter);

app.use('*', (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return next();
});

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
  health: '/health',
}));

app.get('/health', (c) => c.json({ status: 'ok', version: '1.0.0', uptime: Math.floor(process.uptime()) }));

// app routing
app.route('/v1/webhooks', stripeRouter);
app.route('/v1/solana', solanaRouter);
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
app.route('/v1/mesh', meshRouter);
app.route('/v1/referral', referralRouter);
app.route('/v1/skills', skillsRouter);
app.route('/v1/endpoints', endpointsRouter);
app.route('/v1/discover', discoverRouter);
app.route('/v1/stats', statsRouter);
app.route('/v1/escrow', escrowRouter);
app.route('/v1/marketplace', marketplaceRouter);
app.route('/v1', apiRouter);

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

async function start() {
  initDb();
  seedOfficialSkills();
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
  await startMeshNode();
  startEscrowCron();
  startSkillAbCron();

  // Load embedding model + seed in background — don't block server startup
  loadEmbeddingModel()
    .then(() => seedEmbeddings())
    .catch((err) => logger.warn({ err }, 'Embedding init failed'));

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