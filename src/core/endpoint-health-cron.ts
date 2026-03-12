/**
 * Endpoint Health Monitor Cron
 *
 * Pings a sample of API registry endpoints every 5 minutes and records
 * uptime/latency in the endpoint_health table.
 *
 * Only pings endpoints that have public health-check URLs (no auth required).
 * Uses a lightweight HEAD/GET to the provider's base URL, not a real API call.
 */

import cron from 'node-cron';
import { apiRegistry } from '../config/api-registry';
import {
  recordEndpointHealth,
  cleanupOldAuditLogs, cleanupOldSkillMetrics, cleanupOldSolanaSigs,
  cleanupOldOrchestrations, cleanupOldFeedback, cleanupOldEmailLog,
  cleanupStalePeers, cleanupOldStripeSessions, cleanupOldStripeEvents,
  cleanupExpiredClaimTokens, cleanupOldTasks, cleanupOldSwarms,
  cleanupOldReputationEvents, cleanupOldTransactions, cleanupOldVotes,
  cleanupDeactivatedKeys, purgeExpiredContexts,
  getDb,
} from '../db/index';
import { logger } from '../utils/logger';

// Track last cleanup date to run at most once per day
let _lastCleanupDay = '';

// Endpoints to ping: use base URL + a simple path that responds quickly.
// We check the provider's base URL rather than the actual endpoint (avoids auth/payment).
const HEALTH_CHECK_URLS: Record<string, string> = {
  'firecrawl-scrape':    'https://api.firecrawl.dev',
  'jina-search':         'https://s.jina.ai',
  'tavily-search':       'https://api.tavily.com',
  'neynar-search':       'https://hub-api.neynar.com',
  'coingecko-price':     'https://api.coingecko.com',
  'x402list-search':     'https://x402list.fun',
  'x402scan-tx':         'https://x402scan.xyz',
  'x402station-monitor': 'https://x402station.io',
  'x402engine-gpt4o':    'https://x402-gateway-production.up.railway.app',
  'pinata-retrieve':     'https://402.pinata.cloud',
  'perplexity-search':   'https://api.perplexity.ai',
  'precip-weather':      'https://api.precip.earth',
};

async function pingEndpoint(endpointId: string, url: string): Promise<{ status: 'up' | 'down' | 'degraded'; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.status < 500) {
      return { status: latencyMs > 3000 ? 'degraded' : 'up', latencyMs };
    }
    return { status: 'degraded', latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = (err as Error).message ?? String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { status: 'down', latencyMs: 5000, error: 'Timeout after 5s' };
    }
    return { status: 'down', latencyMs, error: msg.slice(0, 200) };
  }
}

let _running = false;

async function runHealthChecks(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
  const entries = Object.entries(HEALTH_CHECK_URLS);
  logger.debug({ count: entries.length }, 'Running endpoint health checks');

  // Run checks with concurrency limit of 5
  const batchSize = 5;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ([endpointId, url]) => {
        const ep = apiRegistry.find((e) => e.id === endpointId);
        if (!ep) return;
        const result = await pingEndpoint(endpointId, url);
        recordEndpointHealth({
          endpointId,
          provider: ep.provider,
          status: result.status,
          latencyMs: result.latencyMs,
          error: result.error,
        });
      })
    );
  }

  // Daily retention cleanup — at most once per calendar day
  const today = new Date().toISOString().slice(0, 10);
  if (_lastCleanupDay !== today) {
    _lastCleanupDay = today;
    // Existing cleanup (now batched — each delete is LIMIT 5000 per iteration)
    const auditDel        = cleanupOldAuditLogs(90);
    const metricsDel      = cleanupOldSkillMetrics(90);
    const solDel          = cleanupOldSolanaSigs(30);
    const orchDel         = cleanupOldOrchestrations(180);
    const feedDel         = cleanupOldFeedback(365);
    const emailDel        = cleanupOldEmailLog(30);
    const peersDel        = cleanupStalePeers(7);
    const stripeSessDel   = cleanupOldStripeSessions(90);
    const stripeEvtDel    = cleanupOldStripeEvents(90);
    const claimDel        = cleanupExpiredClaimTokens();
    // Ch02: previously unbounded tables now cleaned
    const tasksDel        = cleanupOldTasks(90);
    const swarmsDel       = cleanupOldSwarms(90);
    const repDel          = cleanupOldReputationEvents(365);
    const txDel           = cleanupOldTransactions(730);  // 2-year financial record retention
    const votesDel        = cleanupOldVotes(365);
    const keysDel         = cleanupDeactivatedKeys(90);  // Q9: purge deactivated keys with zero balance
    const ctxDel          = purgeExpiredContexts();       // Agent context layer: expired entries
    const total = auditDel + metricsDel + solDel + orchDel + feedDel + emailDel + peersDel + stripeSessDel + stripeEvtDel + claimDel + tasksDel + swarmsDel + repDel + txDel + votesDel + keysDel + ctxDel;
    if (total > 0) {
      logger.info({ auditDel, metricsDel, solDel, orchDel, feedDel, emailDel, peersDel, stripeSessDel, stripeEvtDel, claimDel, tasksDel, swarmsDel, repDel, txDel, votesDel, keysDel, ctxDel }, 'Daily retention cleanup');
    }
    // WAL checkpoint after bulk deletes — prevents WAL bloat
    try { getDb().pragma('wal_checkpoint(PASSIVE)'); } catch { /* non-critical */ }
  }
  } finally {
    _running = false;
  }
}

let healthTask: ReturnType<typeof cron.schedule> | null = null;

export function startEndpointHealthCron(): void {
  // Run every 5 minutes
  healthTask = cron.schedule('*/5 * * * *', () => {
    runHealthChecks().catch((err) => logger.error({ err }, 'Health check cron error'));
  });

  // Run immediately on startup (with a short delay to not block server init)
  setTimeout(() => {
    runHealthChecks().catch((err) => logger.error({ err }, 'Initial health check error'));
  }, 10_000);

  logger.info('Endpoint health cron started (every 5 min)');
}

export function stopEndpointHealthCron(): void {
  healthTask?.stop();
  healthTask = null;
}
