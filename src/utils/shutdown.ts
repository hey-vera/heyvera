import { logger } from './logger';
import { closeDb } from '../db/index';
import { closeRedis } from '../cache/index';
import { stopHeartbeat } from '../core/heartbeat';
import { stopMeshNode } from '../mesh/node';
import { stopEscrowCron } from '../core/escrow-cron';

let isShuttingDown = false;

export function setupGracefulShutdown() {
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Shutdown signal received');

    stopHeartbeat();
    stopEscrowCron();
    closeDb();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      await closeRedis();
    } catch (err) {
      logger.warn({ err }, 'Error closing Redis');
    }

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

    logger.info('Shutdown complete');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}