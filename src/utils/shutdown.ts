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

    // Give in-flight requests 10 seconds to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

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