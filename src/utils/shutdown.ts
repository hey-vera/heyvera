import { logger } from './logger';
import { closeDb } from '../db/index';
import { closeRedis } from '../cache/index';
import { stopHeartbeat } from '../core/heartbeat';
import { stopMeshNode } from '../mesh/node';
import { stopEscrowCron } from '../core/escrow-cron';
import { stopSkillAbCron } from '../core/skill-ab-cron';
import { stopStakeUnlockCron } from '../core/stake-unlock-cron';
import { stopEndpointHealthCron } from '../core/endpoint-health-cron';
import { stopEndpointDiscoveryCron } from '../core/endpoint-discovery';
import { stopPayoutCron } from '../core/payout-cron';
let isShuttingDown = false;
let httpServer: { close: () => void } | null = null;

/** Call after serve() to register the server for graceful shutdown. */
export function setHttpServer(server: { close: () => void }) {
  httpServer = server;
}

export function setupGracefulShutdown() {
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Shutdown signal received');

    // Hard deadline: force exit after 30s if graceful shutdown hangs
    const forceTimer = setTimeout(() => {
      logger.error('Shutdown timeout (30s) — force exiting');
      process.exit(1);
    }, 30_000);
    forceTimer.unref();

    // 1. Stop accepting new connections
    if (httpServer) {
      httpServer.close();
      logger.info('HTTP server closed — no new connections');
    }

    // 2. Drain in-flight requests before stopping anything (15s grace period)
    // SSE streams can run 30s+ and batch queries take 10-20s — 5s was too aggressive.
    // 15s covers the vast majority of in-flight work while keeping deploys snappy.
    await new Promise((resolve) => setTimeout(resolve, 15_000));

    // 3. Stop cron jobs and heartbeat
    stopHeartbeat();
    stopEscrowCron();
    stopSkillAbCron();
    stopStakeUnlockCron();
    stopEndpointHealthCron();
    stopEndpointDiscoveryCron();
    stopPayoutCron();

    // 4. Stop external services (after drain — they may still use DB)
    try {
      await stopMeshNode();
    } catch (err) {
      logger.warn({ err }, 'Error stopping mesh node');
    }

    try {
      const { stopTelegram } = await import('../integrations/telegram');
      await stopTelegram();
    } catch (err) {
      logger.warn({ err }, 'Error stopping Telegram');
    }

    // 5. Close DB and Redis last
    closeDb();

    try {
      await Promise.race([
        closeRedis(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Redis close timeout')), 5_000)
        ),
      ]);
    } catch (err) {
      logger.warn({ err }, 'Error closing Redis');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
