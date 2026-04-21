import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { env } from './config/index';
import { logger } from './utils/logger';
import { apiRouter } from './routes/api';
import { initRedis } from './cache/index';
import { initDb } from './db/index';
import { checkApiKey } from './middleware/auth';
import { rotationShadowCheck } from './middleware/rotation-shadow-check';
import { rateLimiter } from './middleware/rate-limit';
import { startHeartbeat } from './core/heartbeat';
import { setupGracefulShutdown } from './utils/shutdown';
import { oauthRouter } from './routes/oauth';
import { authRouter } from './routes/auth';
import { economyRouter } from './routes/economy';
import { authnRouter } from './routes/authn';
import { ceremonyRouter } from './routes/ceremony';
import { initSomaHeart } from './core/soma-heart';

const app = new Hono();

app.use('*', cors());
app.use('*', honoLogger());

const readDeployMeta = (): Record<string, unknown> | null => {
  try {
    const deployMetaPath = path.resolve(process.cwd(), 'deploy-meta.json');
    if (!fs.existsSync(deployMetaPath)) return null;
    return JSON.parse(fs.readFileSync(deployMetaPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'claw-net',
  deploy: readDeployMeta(),
}));

app.get('/api/deploy-info', (c) => c.json({
  status: 'ok',
  service: 'claw-net',
  deploy: readDeployMeta(),
}));

app.get('/v1/health', (c) => c.json({
  status: 'ok',
  service: 'claw-net',
  deploy: readDeployMeta(),
}));

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
app.use('/v1/orchestrate', rotationShadowCheck);

app.route('/v1', apiRouter);
app.route('/v1/oauth', oauthRouter);
app.route('/v1/auth', authRouter);
app.route('/v1/economy', economyRouter);

// WebAuthn authenticator registry (§4)
app.route('/api/authn', authnRouter);

// WebAuthn ceremony flow (§5.2) — manual in Phase 1
app.route('/api/ceremony', ceremonyRouter);

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

async function start() {
  initDb();
  await initRedis();
  await initSomaHeart();
  setupGracefulShutdown();
  startHeartbeat();

  serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, () => {
    logger.info(`ClawNet running on port ${env.PORT}`);
    logger.info(`Mode: ${env.NODE_ENV}`);
    logger.info(`LLM: ${env.LLM_PROVIDER}`);
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
