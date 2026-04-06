// src/core/signal-cron.ts — Daily vault Signal drip + unlock processing + milestone tracking
import { processVaultSignalDrip, processVaultUnlocks, seedMilestones, updateMilestoneProgress } from '../db/signal';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

const VAULT_INTERVAL = 24 * 60 * 60 * 1000; // 24h

// ── Milestone Auto-Tracking ──────────────────────────────────────────────────

function trackMilestones(): void {
  const db = getDb();

  const queries: Array<{ id: string; sql: string }> = [
    { id: 'ms-providers-100',  sql: `SELECT COUNT(*) as v FROM providers WHERE status != 'rejected'` },
    { id: 'ms-endpoints-1000', sql: `SELECT COUNT(*) as v FROM endpoints WHERE status = 'active'` },
    { id: 'ms-calls-10k',     sql: `SELECT COUNT(*) as v FROM orchestrations WHERE timestamp >= datetime('now', '-1 day')` },
    { id: 'ms-soma-100',      sql: `SELECT COUNT(*) as v FROM soma_verdicts` },
    { id: 'ms-revenue-10k',   sql: `SELECT COALESCE(SUM(total_revenue_usdc), 0) as v FROM providers` },
  ];

  for (const q of queries) {
    try {
      const row = db.prepare(q.sql).get() as { v: number } | undefined;
      const value = row?.v ?? 0;
      const justReached = updateMilestoneProgress(q.id, value);
      if (justReached) {
        logger.info({ milestoneId: q.id, value }, 'Milestone reached!');
      }
    } catch (err) {
      logger.warn({ err, milestoneId: q.id }, 'Milestone tracking query failed (non-fatal)');
    }
  }
}

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

    // Track milestone progress
    try {
      trackMilestones();
    } catch (err) {
      logger.warn({ err }, 'Milestone tracking failed (non-fatal)');
    }
  }, VAULT_INTERVAL);

  logger.info('Signal cron started (24h vault drip + unlocks + milestone tracking)');
}
