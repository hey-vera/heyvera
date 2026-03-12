import * as Sentry from '@sentry/node';
import { nanoid } from 'nanoid';
import { contactRoute } from './routes/contact'
import { dashboardRouter } from './routes/dashboard';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { bodyLimit } from 'hono/body-limit';
import { env, isSimulationMode } from './config/index';
import { logger } from './utils/logger';
import { apiRouter } from './routes/api';
import { initRedis, cacheStats } from './cache/index';
import { checkApiKey } from './middleware/auth';
import { rateLimiter } from './middleware/rate-limit';
import { startHeartbeat } from './core/heartbeat';
import { setupGracefulShutdown, setHttpServer } from './utils/shutdown';
import { feedbackRouter } from './routes/feedback';
import { initTelegram, stopTelegram } from './integrations/telegram';
import { initDb, getDb } from './db/index';
import { adminRouter } from './routes/admin';
import { initClawApis } from './providers/clawapis';
import { stripeRouter } from './routes/stripe';
import { clerkWebhookRouter } from './routes/clerk-webhook';
import { solanaRouter } from './routes/solana';
import { meshRouter } from './routes/mesh';
import { skillsRouter } from './routes/skills';
import { endpointsRouter } from './routes/endpoints';
import { discoverRouter } from './routes/discover';
import { statsRouter } from './routes/stats';
import { escrowRouter } from './routes/escrow';
import { marketplaceRouter } from './routes/marketplace';
import { swarmRouter } from './routes/swarm';
import { governanceRouter } from './routes/governance';
import { batchRouter } from './routes/batch';
import { streamRouter } from './routes/stream';
import { openclawRouter } from './routes/openclaw';
import { openapiRouter } from './routes/openapi';
import { x402SkillsRouter } from './routes/x402-skills';
import { llmRouter } from './routes/llm';
import { registryRouter } from './routes/registry';
import { tasksRouter } from './routes/tasks';
import { authRouter } from './routes/auth-tokens';
import { contextRouter } from './routes/context';
import { startEndpointHealthCron } from './core/endpoint-health-cron';
import { signResponse } from './middleware/sign-response';
import { startEscrowCron } from './core/escrow-cron';
import { startSkillAbCron } from './core/skill-ab-cron';
import { startStakeUnlockCron } from './core/stake-unlock-cron';
import { startMeshNode } from './mesh/node';
import { loadEmbeddingModel } from './core/embeddings';
import { seedEmbeddings } from './core/seed-embeddings';
import { seedOfficialSkills } from './core/seed-skills';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV ?? 'development' });
}

// Global safety net — catch unhandled promise rejections and exceptions before they silently crash the process.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection — potential data loss risk');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — exiting to prevent corrupt state');
  process.exit(1);
});

const app = new Hono();

// Health check BEFORE middleware — monitoring/Docker hits this every few seconds,
// no need for CORS, rate limit, security headers, body limit, or request logging.
app.get('/health', (c) => {
  let dbOk = false;
  try {
    const row = getDb().prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    dbOk = row?.ok === 1;
  } catch { /* db unreachable */ }

  const redis = cacheStats().redisConnected;
  const status = !dbOk ? 'error' : !redis ? 'degraded' : 'ok';

  return c.json({
    status,
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'ok' : 'unreachable',
    redis: redis ? 'connected' : 'disconnected',
  }, dbOk ? 200 : 503);
});

app.use('*', cors({
  origin: env.NODE_ENV === 'production'
    ? ['https://claw-net.org', 'https://www.claw-net.org', 'https://app.claw-net.org']
    : '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposeHeaders: ['X-Request-ID', 'X-ClawNet-Signature', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
  maxAge: 86400,
}));
app.use('*', honoLogger());
app.use('*', rateLimiter);

app.use('*', (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return next();
});

app.use('*', (c, next) => {
  c.header('X-Request-ID', nanoid(12));
  return next();
});

// Global body size limit — 256KB for all non-webhook routes
// (webhooks have their own tighter 64KB guard applied before signature reads)
app.use('*', bodyLimit({
  maxSize: 256 * 1024,
  onError: (c) => c.json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413),
}));

app.get('/', (c) => c.json({
  name: 'ClawNet Orchestrator',
  version: '1.0.0',
  description: 'Universal Workflow Orchestration Layer for ClawAPIs',
  docs: '/v1/endpoints',
  health: '/health',
}));

// Webhook body size guard — 64KB max, applied before signature reads
app.use('/v1/webhooks/*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') ?? '0', 10);
  if (contentLength > 65536) {
    return c.json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413);
  }
  return next();
});

// app routing
app.route('/v1/webhooks', stripeRouter);
app.route('/v1/webhooks', clerkWebhookRouter);
app.route('/v1/solana', solanaRouter);
app.route('/v1/dashboard', dashboardRouter);
app.route('/', contactRoute)

app.use('/v1/orchestrate', checkApiKey);
app.route('/v1/feedback', feedbackRouter);
app.route('/v1/admin', adminRouter);
app.route('/v1/mesh', meshRouter);
app.route('/v1/skills', skillsRouter);
app.route('/v1/endpoints', endpointsRouter);
app.route('/v1/discover', discoverRouter);
app.route('/v1/stats', statsRouter);
app.route('/v1/escrow', escrowRouter);
app.route('/v1/marketplace', marketplaceRouter);
app.route('/v1/swarm', swarmRouter);
app.route('/v1/governance', governanceRouter);
app.route('/v1/batch', batchRouter);
app.route('/v1/stream', streamRouter);
app.route('/v1/openclaw', openclawRouter);
app.route('/v1', openapiRouter);
app.use('/v1/orchestrate', signResponse);
app.use('/v1/skills/*/invoke', signResponse);
app.use('/v1/batch', signResponse);
app.use('/v1/balance', signResponse);
app.use('/v1/tasks', signResponse);
app.route('/v1', apiRouter);
app.route('/x402', x402SkillsRouter);
app.route('/v1/llm', llmRouter);
app.route('/v1/registry', registryRouter);
app.route('/v1/tasks', tasksRouter);
app.route('/v1/auth', authRouter);
app.route('/v1/context', contextRouter);

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

  // Non-critical services: isolate failures so the HTTP server still starts
  try { await initTelegram(); } catch (err) {
    logger.error({ err }, 'Telegram init failed — continuing without bot');
  }
  try { await startMeshNode(); } catch (err) {
    logger.error({ err }, 'Mesh node init failed — continuing without P2P');
  }

  startEscrowCron();
  startEndpointHealthCron();
  startSkillAbCron();
  startStakeUnlockCron();

  // Load embedding model + seed in background — don't block server startup
  loadEmbeddingModel()
    .then(() => seedEmbeddings())
    .catch((err) => logger.error({ err }, 'Embedding model failed to load — /v1/discover will return 503'));

  const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, () => {
    logger.info({
      port: env.PORT,
      env: env.NODE_ENV,
      simulation: isSimulationMode,
      llm: env.LLM_PROVIDER,
      redis: !!env.REDIS_URL,
      signing: !!env.PLATFORM_SIGNING_SECRET,
      x402: !!env.X402_RECIPIENT_ADDRESS,
      freeTrial: env.FREE_TRIAL_CREDITS,
      rateLimit: env.RATE_LIMIT_PER_MIN,
    }, 'ClawNet started');
  });
  setHttpServer(server);
}

start().catch(async (err) => {
  logger.error({ err }, 'Failed to start server');
  await stopTelegram();
  process.exit(1);
});