import { logger } from './logger';
import { closeDb } from '../db/index';
import { closeRedis } from '../cache/index';
import { stopHeartbeat } from '../core/heartbeat';
import { stopMeshNode } from '../mesh/node';
import { stopEscrowCron } from '../core/escrow-cron';
import { stopSkillAbCron } from '../core/skill-ab-cron';
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

    // 1. Stop accepting new connections
    if (httpServer) {
      httpServer.close();
      logger.info('HTTP server closed — no new connections');
    }

    // 2. Drain in-flight requests before stopping anything (5s grace period)
    await new Promise((resolve) => setTimeout(resolve, 5_000));

    // 3. Stop cron jobs and heartbeat
    stopHeartbeat();
    stopEscrowCron();
    stopSkillAbCron();

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
      await closeRedis();
    } catch (err) {
      logger.warn({ err }, 'Error closing Redis');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
