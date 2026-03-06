import { logger } from './logger';
import { closeRedis } from '../cache/index';
import { stopHeartbeat } from '../core/heartbeat';

let isShuttingDown = false;

export function setupGracefulShutdown() {
  async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Shutdown signal received');

    stopHeartbeat();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      await closeRedis();
    } catch (err) {
      logger.warn({ err }, 'Error closing Redis');
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