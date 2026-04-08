import * as Sentry from '@sentry/node';
import { nanoid } from 'nanoid';
import { contactRoute } from './routes/contact'
import { dashboardRouter } from './routes/dashboard';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { env, isSimulationMode } from './config/index';
import { logger } from './utils/logger';
import { apiRouter } from './routes/api';
import { initRedis, cacheStats, preloadCache } from './cache/index';
import { checkApiKey } from './middleware/auth';
import { rateLimiter } from './middleware/rate-limit';
import { startHeartbeat } from './core/heartbeat';
import { setupGracefulShutdown, setHttpServer } from './utils/shutdown';
import { feedbackRouter } from './routes/feedback';
import { initTelegram, stopTelegram } from './integrations/telegram';
import { initXmtp, stopXmtp } from './integrations/xmtp';
import { initDb, getDb } from './db/index';
import { registerBuiltinTypes } from './core/computation-types';
import { adminRouter } from './routes/admin';
import { initX402Client } from './providers/x402-client';
import { stripeRouter } from './routes/stripe';
import { clerkWebhookRouter } from './routes/clerk-webhook';
import { solanaRouter } from './routes/solana';
import { billingRouter } from './routes/billing';
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
import { siwxRouter } from './routes/siwx';
import { oauthRouter } from './routes/oauth';
import { contextRouter } from './routes/context';
import { economyRouter } from './routes/economy';
import { validatorsRouter } from './routes/validators';
import { recommendationsRouter } from './routes/recommendations';
import { creatorRouter } from './routes/creator';
import { accountRouter } from './routes/account';
import { costComparisonRouter } from './routes/cost-comparison';
import { openclawCompatRouter } from './routes/openclaw-compat';
import { sponsorshipRouter } from './routes/sponsorship';
import { llmsTxtRouter, skillMdRouter } from './routes/llms';
import { wellKnownRouter } from './routes/well-known';
import { a2aRouter } from './routes/a2a';
import { erc8004Router } from './routes/erc8004';
import { vieRouter } from './routes/vie';
import { manifestRouter } from './routes/manifest';
import { attestRouter } from './routes/attest';
import { identityRouter } from './routes/identity';
import { contextEngineRouter } from './routes/context-engine';
import { agentTrustRouter } from './routes/agent-trust';
import { predictiveAlertsRouter } from './routes/predictive-alerts';
import { bountiesRouter } from './routes/bounties';
import { mcpHttpRouter } from './mcp/http-transport';
import { x402McpRouter } from './mcp/x402-mcp-transport';
import { registerRouter } from './routes/register';
import { signalRouter } from './routes/signal';
import { statsTelemetryRouter } from './routes/stats-telemetry';
import { x402FacilitatorRouter } from './routes/x402-facilitator';
import { skillBuilderRouter } from './routes/skill-builder';
import { challengeRouter } from './routes/soma-challenge';
import { agentLifecycleRouter } from './routes/agent-lifecycle';
import { startChallengeFinalizeCron } from './core/challenge-finalize-cron';
import { startTrustDecayCron } from './core/trust-decay-cron';
import { referralRouter } from './routes/referral';
import { trustQueryRouter } from './routes/trust-query';
import { startEndpointHealthCron } from './core/endpoint-health-cron';
import { startEndpointDiscoveryCron } from './core/endpoint-discovery';
import { signResponse } from './middleware/sign-response';
import { somaProvenance } from './middleware/soma-provenance';
import { runWithProvenance } from './core/request-context';
import { startEscrowCron } from './core/escrow-cron';
import { startSkillAbCron } from './core/skill-ab-cron';
import { startStakeUnlockCron } from './core/stake-unlock-cron';
import { startPayoutCron } from './core/payout-cron';
import { startSkillHealthCron } from './core/skill-health-cron';
import { startSkillSchedulerCron } from './core/skill-scheduler-cron';
import { startCacheWarmingCron } from './core/cache-warming-cron';
import { startProviderCacheWarmCron } from './core/provider-cache-warm-cron';
import { startKeepWarm } from './cache/keep-warm';
import { startIndexSync } from './core/index-sync';
import { startSomaAnchorCron } from './core/soma-anchor-cron';
import { startEasAnchorCron } from './core/eas-anchor-cron';
import { startSignalCron } from './core/signal-cron';
import { startZauthDiscovery } from './core/zauth-discovery';
import { startX402scanDiscovery } from './core/x402scan-discovery';
import { providersRouter } from './routes/providers';
import { somaRouter } from './routes/soma';
import somaCheckRouter from './routes/soma-check';
import vouchRouter from './routes/vouch';
import somaDemoRouter from './routes/soma-demo';
import { startCanaryCron } from './core/canary';
import { getIndexedEndpoints, countIndexedEndpoints, searchIndexedEndpoints, getIndexedEndpointsSyncInfo } from './db/index';
import { startCreatorNotificationsCron } from './core/creator-notifications';
import { cacheStatsRouter } from './routes/cache-stats';
import { onboardRouter } from './routes/onboard';
import { selfOnboardRouter } from './routes/self-onboard';
import { widgetsRouter } from './routes/widgets';
import { startMeshNode } from './mesh/node';
import { loadEmbeddingModel } from './core/embeddings';
import { seedEmbeddings } from './core/seed-embeddings';
import { seedOfficialSkills } from './core/seed-skills';
import { initPaymentGateway } from './payments/index';

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
// no need for rate limit, security headers, body limit, or request logging.
// CORS headers added so the frontend status indicator works cross-origin.
app.get('/health', (c) => {
  const origin = c.req.header('origin') ?? '';
  const allowed = ['https://claw-net.org', 'https://www.claw-net.org', 'https://app.claw-net.org'];
  if (env.NODE_ENV !== 'production' || allowed.includes(origin)) {
    c.header('Access-Control-Allow-Origin', env.NODE_ENV === 'production' ? origin : '*');
  }

  let dbOk = false;
  let schemaVersion: number | null = null;
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    dbOk = row?.ok === 1;
    if (dbOk) {
      const mv = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null } | undefined;
      schemaVersion = mv?.v ?? null;
    }
  } catch { /* db unreachable */ }

  const redis = cacheStats().redisConnected;
  const status = !dbOk ? 'error' : !redis ? 'degraded' : 'ok';

  return c.json({
    status,
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'ok' : 'unreachable',
    redis: redis ? 'connected' : 'disconnected',
    schemaVersion,
  }, dbOk ? 200 : 503);
});

// Lightweight liveness probe — directories like 402index ping this.
// No middleware, no auth, minimal overhead.
app.get('/health/live', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Request-scoped provenance store — replaces module-level singletons that
// caused race conditions under concurrent requests (audit finding C1).
app.use('*', (c, next) => runWithProvenance(next));

app.use('*', cors({
  origin: env.NODE_ENV === 'production'
    ? ['https://claw-net.org', 'https://www.claw-net.org', 'https://app.claw-net.org']
    : '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-PAYMENT', 'PAYMENT-SIGNATURE'],
  exposeHeaders: ['X-Request-ID', 'X-ClawNet-Signature', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  maxAge: 86400,
}));
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
    requestId: c.res.headers.get('X-Request-ID'),
  }, `${c.req.method} ${c.req.path}`);
});
app.use('*', rateLimiter);

app.use('*', (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Portal serves a full SPA — needs permissive CSP. API routes stay locked down.
  if (c.req.path.startsWith('/dashboard') || c.req.path.startsWith('/portal')) {
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://*.clerk.accounts.dev https://clerk.claw-net.org https://challenges.cloudflare.com 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https://img.clerk.com; connect-src 'self' https://*.clerk.accounts.dev https://clerk.claw-net.org https://api.claw-net.org; frame-src https://*.clerk.accounts.dev https://clerk.claw-net.org https://challenges.cloudflare.com; worker-src 'self' blob:");
  } else {
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    c.header('Pragma', 'no-cache');
  }
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

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message, path: c.req.path, method: c.req.method }, 'Unhandled route error');
  if (env.NODE_ENV === 'production') {
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
  return c.json({ error: message, code: 'INTERNAL_ERROR' }, 500);
});

app.get('/', (c) => c.json({
  name: 'ClawNet Orchestrator',
  version: '1.0.0',
  description: 'Sovereign AI agent orchestration layer — Soma-verified execution, x402 payments',
  docs: '/v1/endpoints',
  health: '/health',
}));

// Webhook body size guard — 64KB max, enforced on the body stream itself
// (not just content-length header, which is absent with chunked encoding)
app.use('/v1/webhooks/*', bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' }, 413),
}));

// app routing
app.route('/v1/webhooks', stripeRouter);
app.route('/v1/webhooks', clerkWebhookRouter);
app.route('/v1/solana', solanaRouter);
app.route('/v1/billing', billingRouter);
app.route('/v1/dashboard', dashboardRouter);
app.route('/', contactRoute)

app.use('/v1/orchestrate', checkApiKey);
app.use('/v1/estimate', checkApiKey); // Requires API key — calls LLM (parseIntent), costs real money
app.use('/v1/balance', checkApiKey);
app.use('/v1/endpoints/*/call', checkApiKey); // Direct endpoint invocation — requires API key for billing
// AID trust enrichment — optional, fail-through. If caller sends X-AID-DID alongside
app.use('/v1/orchestrate', somaProvenance);
app.use('/v1/orchestrate', signResponse);
app.use('/v1/skills/*/invoke', somaProvenance);
app.use('/v1/skills/*/invoke', signResponse);
app.use('/v1/endpoints/*/call', somaProvenance);
app.use('/v1/endpoints/*/call', signResponse);
app.use('/v1/batch', signResponse);
app.use('/v1/balance', signResponse);
app.use('/v1/tasks', signResponse);
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
app.route('', openapiRouter); // Also serve OpenAPI at /openapi.json (x402scan discovery)
app.route('/v1', apiRouter);
app.use('/x402/*', somaProvenance);
app.route('/x402', x402SkillsRouter);
app.route('/v1/llm', llmRouter);
app.route('/v1/registry', registryRouter);
app.route('/v1/tasks', tasksRouter);
app.route('/v1/auth', authRouter);
app.route('/v1/auth/siwx', siwxRouter);
app.route('/v1/oauth', oauthRouter);
app.route('/v1/context', contextRouter);
app.route('/v1/economy', economyRouter);
app.route('/v1/validators', validatorsRouter);
app.route('/v1/vie', vieRouter);
app.route('/v1/manifest', manifestRouter);
app.route('/v1/attest', attestRouter);
app.route('/v1/identity', identityRouter);
app.route('/v1/intel/context', contextEngineRouter);
app.route('/v1/intel/trust', agentTrustRouter);
app.route('/v1/intel/alerts', predictiveAlertsRouter);
app.route('/v1/recommendations', recommendationsRouter);
app.route('/v1/creator', creatorRouter);
app.route('/v1/cache', cacheStatsRouter);
app.route('/v1/onboard', onboardRouter);
app.route('/v1/self-onboard', selfOnboardRouter);
app.route('/v1/widgets', widgetsRouter);
app.route('/v1/account', accountRouter);
app.route('/v1/compare', costComparisonRouter);
app.route('/v1/openclaw-compat', openclawCompatRouter);
app.route('/v1/sponsorships', sponsorshipRouter);
app.route('/v1/bounties', bountiesRouter);
app.route('/llms.txt', llmsTxtRouter);
app.route('/v1/skill.md', skillMdRouter);
app.route('/.well-known', wellKnownRouter);
app.route('/a2a', a2aRouter);
app.route('/v1/erc8004', erc8004Router);
app.route('/mcp', mcpHttpRouter);
app.route('/mcp/x402', x402McpRouter);
app.route('/v1/stats/telemetry', statsTelemetryRouter);
app.route('/v1/register', registerRouter);
app.route('/v1/soma', somaRouter);
app.route('/v1/soma/check', somaCheckRouter);
app.route('/v1/soma/vouch', vouchRouter);
app.route('/v1/soma/demo', somaDemoRouter);
app.route('/v1/soma/challenge', challengeRouter);
app.route('/v1/agent', agentLifecycleRouter);
app.route('/v1/providers', providersRouter);
app.route('/v1/signal', signalRouter);
app.route('/x402/facilitator', x402FacilitatorRouter);
app.route('/v1/skills', skillBuilderRouter);
app.route('/v1/referral', referralRouter);
app.route('/v1/trust', trustQueryRouter);

// ─── JSON-LD Context — W3C VC attestation vocabulary ────────────────────────
import { getAttestationContext } from './utils/vc-envelope';
app.get('/contexts/attestation/v1', (c) => {
  return c.json(getAttestationContext(), 200, { 'Content-Type': 'application/ld+json' });
});

// ─── RSS 2.0 Feed — public skill marketplace feed for aggregators ────────────
app.get('/feed.xml', (c) => {
  const typeFilter = c.req.query('type');
  const tagFilter = c.req.query('tag');

  const validTypes = ['data', 'api_proxy', 'prompt_template', 'composite'];
  const conditions = [
    'active = 1',
    'public = 1',
    "security_status != 'FLAGGED'",
  ];
  const params: string[] = [];

  if (typeFilter && validTypes.includes(typeFilter)) {
    conditions.push('skill_type = ?');
    params.push(typeFilter);
  }
  if (tagFilter) {
    // Sanitize LIKE wildcards to prevent pattern injection
    const sanitizedTag = tagFilter.replace(/[%_]/g, '');
    if (sanitizedTag) {
      conditions.push('tags_json LIKE ?');
      params.push(`%"${sanitizedTag}"%`);
    }
  }

  const sql = `SELECT id, name, description, skill_type, credit_cost, proxy_url, created_at, tags_json
    FROM skills WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC LIMIT 50`;

  interface FeedSkillRow {
    id: string;
    name: string;
    description: string;
    skill_type: string;
    credit_cost: number;
    proxy_url: string | null;
    created_at: string;
    tags_json: string | null;
  }

  const skills = getDb().prepare(sql).all(...params) as FeedSkillRow[];

  const escXml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const items = skills.map((s) => {
    const protocol = s.proxy_url ? 'x402' : 'credits';
    const pubDate = new Date(s.created_at).toUTCString();
    return `    <item>
      <title>${escXml(s.name)}</title>
      <link>https://claw-net.org/skill?id=${encodeURIComponent(s.id)}</link>
      <description>${escXml(s.description)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">clawnet-skill-${escXml(s.id)}</guid>
      <clawnet:creditCost>${s.credit_cost}</clawnet:creditCost>
      <clawnet:skillType>${escXml(s.skill_type)}</clawnet:skillType>
      <clawnet:protocol>${protocol}</clawnet:protocol>
    </item>`;
  }).join('\n');

  const lastBuild = new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:clawnet="https://claw-net.org/rss">
  <channel>
    <title>ClawNet Skill Marketplace</title>
    <link>https://claw-net.org/marketplace</link>
    <description>AI agent skills — data, orchestration, and composites</description>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>`;

  c.header('Content-Type', 'application/rss+xml');
  return c.body(xml);
});

// ─── Public indexed endpoints catalog (multi-source sync) ───────────────────
app.get('/v1/indexed', (c) => {
  const category = c.req.query('category') || undefined;
  const source = c.req.query('source') || undefined; // Filter by source: 402index, bazaar, satring
  const q = c.req.query('q') || undefined;
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10) || 0);

  let endpoints;
  let total: number;

  if (q) {
    endpoints = searchIndexedEndpoints(q, limit);
    // Apply source filter to search results if specified
    if (source) {
      endpoints = endpoints.filter((ep: { source?: string }) => ep.source === source);
    }
    total = endpoints.length;
  } else {
    endpoints = getIndexedEndpoints(category, limit, offset, source);
    total = countIndexedEndpoints(category, source);
  }

  const syncInfo = getIndexedEndpointsSyncInfo();

  return c.json({
    endpoints,
    total,
    limit,
    offset,
    sources: ['402index', 'bazaar', 'satring'],
    lastSynced: syncInfo.lastSynced,
  });
});

// ─── React Dashboard — static SPA at /dashboard/* ─────────────────────────────
import path from 'path';
import fs from 'fs';

const dashCandidates = [
  path.resolve(process.cwd(), 'dashboard', 'dist'),
  '/app/dashboard/dist',
  '/home/guardian/claw-net/dashboard/dist',
];
const dashRoot = dashCandidates.find((p) => { try { return fs.statSync(path.join(p, 'index.html')).isFile(); } catch { return false; } }) ?? dashCandidates[0];
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

// Redirect old /portal URLs
app.get('/portal', (c) => c.redirect('/dashboard/', 301));
app.get('/portal/*', (c) => c.redirect(c.req.path.replace('/portal', '/dashboard'), 301));

function serveDashboard(c: any) {
  const urlPath = c.req.path.replace(/^\/dashboard\/?/, '') || 'index.html';
  const filePath = path.join(dashRoot, urlPath);
  if (!filePath.startsWith(dashRoot)) return c.json({ error: 'Forbidden' }, 403);
  try {
    if (fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      c.header('Content-Type', MIME[ext] ?? 'application/octet-stream');
      if (ext !== '.html') c.header('Cache-Control', 'public, max-age=31536000, immutable');
      return c.body(fs.readFileSync(filePath));
    }
  } catch { /* SPA fallback */ }
  try {
    return c.html(fs.readFileSync(path.join(dashRoot, 'index.html'), 'utf-8'));
  } catch {
    return c.json({ error: 'Dashboard not built', code: 'NOT_FOUND' }, 404);
  }
}
app.get('/dashboard', (c) => c.redirect('/dashboard/'));
app.get('/dashboard/', serveDashboard);
app.get('/dashboard/*', serveDashboard);

app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404));

async function start() {
  const startTime = Date.now();

  initDb();
  registerBuiltinTypes();
  try { seedOfficialSkills(); } catch (e) { logger.warn({ err: e }, 'Failed to seed official skills — continuing'); }
  initPaymentGateway();
  await initRedis();
  await preloadCache();

  const clawReady = await initX402Client();
  if (clawReady) {
    logger.info('x402 client: ready for real API calls');
  } else {
    logger.info('x402 client: no SOLANA_PRIVATE_KEY set, simulation mode active');
  }

  // Soma Heart — cryptographic provenance on outbound x402 fetches
  try {
    const { initHeart } = await import('./core/soma');
    await initHeart();
  } catch (err) {
    logger.warn({ err }, 'Soma Heart init failed — continuing without provenance');
  }

  setupGracefulShutdown();
  startHeartbeat();

  // Non-critical services: isolate failures so the HTTP server still starts
  let meshActive = false;
  try { await initTelegram(); } catch (err) {
    logger.error({ err }, 'Telegram init failed — continuing without bot');
  }
  try { await initXmtp(); } catch (err) {
    logger.error({ err }, 'XMTP init failed — continuing without bot');
  }
  try { await startMeshNode(); meshActive = true; } catch (err) {
    logger.error({ err }, 'Mesh node init failed — continuing without P2P');
  }

  let cronsStarted = 0;
  startEscrowCron();              cronsStarted++;
  startEndpointHealthCron();      cronsStarted++;
  startEndpointDiscoveryCron();   cronsStarted++;
  startSkillAbCron();             cronsStarted++;
  startStakeUnlockCron();         cronsStarted++;
  startPayoutCron();              cronsStarted++;
  startSkillHealthCron();         cronsStarted++;
  startSkillSchedulerCron();      cronsStarted++;
  startCacheWarmingCron();        cronsStarted++;
  startProviderCacheWarmCron();   cronsStarted++;
  startKeepWarm();               cronsStarted++;
  startCreatorNotificationsCron(); cronsStarted++;
  startIndexSync();                cronsStarted++;
  startSomaAnchorCron();             cronsStarted++;
  startEasAnchorCron();              cronsStarted++;
  startZauthDiscovery();             cronsStarted++;
  startX402scanDiscovery();          cronsStarted++;
  startCanaryCron();               cronsStarted++;
  startTrustDecayCron();           cronsStarted++;
  startSignalCron();               cronsStarted++;
  startChallengeFinalizeCron();     cronsStarted++;

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
      rateLimit: env.RATE_LIMIT_PER_MIN,
      meshActive,
      cronsStarted,
      startupMs: Date.now() - startTime,
    }, 'ClawNet started');
  });
  setHttpServer(server);
}

start().catch(async (err) => {
  logger.error({ err }, 'Failed to start server');
  await stopTelegram();
  await stopXmtp();
  process.exit(1);
});
