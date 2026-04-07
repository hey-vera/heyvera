/**
 * challenge-finalize-cron.ts — Auto-finalize expired challenge windows
 *
 * Runs periodically to:
 *   1. Mark computation certificates as finalized when their challenge window expires
 *      with no active (unresolved) challenges.
 *   2. Auto-expire challenges where the agent failed to respond within deadline.
 */

import { getDb, logAudit } from '../db/connection';
import { logger } from '../utils/logger';
import { calculateSlashAmounts } from './bond-economics';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Finalize certs whose challenge window has passed with no active disputes.
 */
function finalizeCerts(): void {
  const now = new Date().toISOString();

  // Find certs with expired windows that are not yet finalized
  const certs = getDb().prepare(`
    SELECT id FROM computation_certificates
    WHERE finalized = 0
      AND challenge_window_end IS NOT NULL
      AND challenge_window_end < ?
      AND id NOT IN (
        SELECT cert_id FROM computation_challenges
        WHERE state IN ('filed', 'responded', 'bisecting', 'awaiting_reexec')
      )
  `).all(now) as { id: string }[];

  if (certs.length === 0) return;

  const stmt = getDb().prepare('UPDATE computation_certificates SET finalized = 1 WHERE id = ?');
  getDb().transaction(() => {
    for (const cert of certs) {
      stmt.run(cert.id);
    }
  })();

  logger.info({ count: certs.length }, 'Finalized computation certificates (challenge window expired)');
}

/**
 * Auto-expire challenges where agent failed to respond within deadline.
 * Challenger wins by default — agent bond is slashed.
 */
function expireChallenges(): void {
  const now = new Date().toISOString();

  const expired = getDb().prepare(`
    SELECT id, cert_id, agent_bond FROM computation_challenges
    WHERE state = 'filed'
      AND response_deadline IS NOT NULL
      AND response_deadline < ?
  `).all(now) as { id: string; cert_id: string; agent_bond: number }[];

  if (expired.length === 0) return;

  const updateChallenge = getDb().prepare(`
    UPDATE computation_challenges SET
      state = 'expired', resolution = 'no_response', resolution_detail = 'Agent failed to respond within deadline',
      winner = 'challenger', slash_winner = ?, slash_treasury = ?, slash_burned = ?, resolved_at = ?
    WHERE id = ?
  `);
  const markFraud = getDb().prepare('UPDATE computation_certificates SET finalized = 0 WHERE id = ?');

  getDb().transaction(() => {
    for (const ch of expired) {
      const slash = calculateSlashAmounts(ch.agent_bond);
      updateChallenge.run(slash.winner, slash.treasury, slash.burned, now, ch.id);
      markFraud.run(ch.cert_id);

      logAudit({
        entityType: 'computation_challenge',
        entityId: ch.id,
        action: 'expired',
        data: { resolution: 'no_response', slash },
      });
    }
  })();

  logger.info({ count: expired.length }, 'Auto-expired unanswered computation challenges');
}

export function startChallengeFinalizeCron(): void {
  // Run every 5 minutes
  intervalHandle = setInterval(() => {
    try {
      finalizeCerts();
      expireChallenges();
    } catch (err) {
      logger.error({ err }, 'Challenge finalize cron error');
    }
  }, 5 * 60 * 1000);

  // Run once immediately
  try {
    finalizeCerts();
    expireChallenges();
  } catch (err) {
    logger.error({ err }, 'Challenge finalize cron initial run error');
  }
}

export function stopChallengeFinalizeCron(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
