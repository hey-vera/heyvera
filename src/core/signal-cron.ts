// src/core/signal-cron.ts — Daily vault Signal drip + unlock processing
import { processVaultSignalDrip, processVaultUnlocks, seedMilestones } from '../db/signal';
import { logger } from '../utils/logger';

const VAULT_INTERVAL = 24 * 60 * 60 * 1000; // 24h

export function startSignalCron(): void {
  // Seed milestones on first run
  try { seedMilestones(); } catch (err) {
    logger.warn({ err }, 'Milestone seed failed (non-fatal)');
  }

  setInterval(() => {
    try {
      const signalAwarded = processVaultSignalDrip();
      const unlocked = processVaultUnlocks();
      if (signalAwarded > 0 || unlocked > 0) {
        logger.info({ signalAwarded, vaultsUnlocked: unlocked }, 'Signal cron: vault drip + unlocks');
      }
    } catch (err) {
      logger.error({ err }, 'Signal cron failed');
    }
  }, VAULT_INTERVAL);

  logger.info('Signal cron started (24h vault drip + unlocks)');
}
