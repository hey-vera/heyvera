/**
 * proof-of-life-cron.ts — Autonomous Defense System: heartbeat decay
 *
 * Runs every hour. Checks all active AID keys for lapsed heartbeats.
 * Applies progressive trust decay per Section 39.18 of the AID plan:
 *
 *   7 days overdue:  proof_of_life_status = 'warning', score ceiling = trusted (89)
 *   14 days overdue: status = 'degraded', score ceiling = standard (79)
 *   30 days overdue: status = 'critical', score ceiling = caution (59)
 *   60 days overdue: status = 'endangered', score ceiling = building (39)
 *   90 days overdue: auto-freeze (no human needed)
 *
 * This is the dead man's switch. If an owner deploys an agent and disappears,
 * the agent's trust progressively decays until it's functionally neutralized.
 * ALL without a single human making a single decision.
 */

import { getDb, logAudit } from '../db/connection';
import { logger } from '../utils/logger';

interface LapsedKey {
  did: string;
  owner_key: string;
  last_heartbeat: string | null;
  heartbeat_interval_days: number;
  heartbeat_grace_days: number;
  proof_of_life_status: string;
  frozen: number;
  created_at: string;
}

/** Decay schedule: days overdue → status + action */
const DECAY_SCHEDULE = [
  { daysOverdue: 90, status: 'auto_frozen', action: 'freeze' },
  { daysOverdue: 60, status: 'endangered', scoreCeiling: 39 },
  { daysOverdue: 30, status: 'critical', scoreCeiling: 59 },
  { daysOverdue: 14, status: 'degraded', scoreCeiling: 79 },
  { daysOverdue: 7,  status: 'warning', scoreCeiling: 89 },
];

export function runProofOfLifeCheck(): { checked: number; decayed: number; frozen: number } {
  let checked = 0;
  let decayed = 0;
  let frozen = 0;

  try {
    // Get all active, unfrozen AID keys
    const keys = getDb().prepare(`
      SELECT did, owner_key, last_heartbeat, heartbeat_interval_days,
             heartbeat_grace_days, proof_of_life_status, frozen, created_at
      FROM aid_keys
      WHERE key_status = 'active' AND frozen = 0
    `).all() as LapsedKey[];

    const now = Date.now();

    for (const key of keys) {
      checked++;

      // Determine the reference time: last heartbeat, or creation time if never heartbeated
      const referenceTime = key.last_heartbeat
        ? new Date(key.last_heartbeat).getTime()
        : new Date(key.created_at).getTime();

      const intervalMs = (key.heartbeat_interval_days || 7) * 86400000;
      const graceMs = (key.heartbeat_grace_days || 3) * 86400000;
      const dueTime = referenceTime + intervalMs;
      const graceDeadline = dueTime + graceMs;

      // If within grace period, no action
      if (now <= graceDeadline) {
        // Reset status if it was previously decayed but heartbeat came in
        if (key.proof_of_life_status !== 'active') {
          getDb().prepare(`
            UPDATE aid_keys SET proof_of_life_status = 'active', heartbeat_decay_applied = 0,
            updated_at = datetime('now') WHERE did = ?
          `).run(key.did);
        }
        continue;
      }

      // Calculate days overdue (past grace period)
      const daysOverdue = Math.floor((now - graceDeadline) / 86400000);

      // Find the applicable decay level
      let newStatus = 'active';
      let shouldFreeze = false;

      for (const level of DECAY_SCHEDULE) {
        if (daysOverdue >= level.daysOverdue) {
          newStatus = level.status;
          if (level.action === 'freeze') shouldFreeze = true;
          break;
        }
      }

      // Skip if status hasn't changed
      if (newStatus === key.proof_of_life_status && !shouldFreeze) continue;

      if (shouldFreeze) {
        // Auto-freeze: 90+ days overdue, no human needed
        getDb().prepare(`
          UPDATE aid_keys SET frozen = 1, frozen_at = datetime('now'), frozen_by = 'proof_of_life_cron',
          proof_of_life_status = 'auto_frozen', updated_at = datetime('now')
          WHERE did = ? AND key_status = 'active'
        `).run(key.did);

        logAudit({
          entityType: 'aid', entityId: key.did, action: 'auto_freeze',
          data: { reason: 'proof_of_life_lapsed', daysOverdue, lastHeartbeat: key.last_heartbeat },
        });

        logger.warn({ did: key.did, daysOverdue }, 'AID auto-frozen: proof of life lapsed 90+ days');
        frozen++;
      } else {
        // Apply decay status
        getDb().prepare(`
          UPDATE aid_keys SET proof_of_life_status = ?, heartbeat_decay_applied = ?,
          updated_at = datetime('now') WHERE did = ?
        `).run(newStatus, daysOverdue, key.did);

        logAudit({
          entityType: 'aid', entityId: key.did, action: 'heartbeat_decay',
          data: { newStatus, daysOverdue, lastHeartbeat: key.last_heartbeat },
        });

        logger.info({ did: key.did, newStatus, daysOverdue }, 'AID proof-of-life decay applied');
        decayed++;
      }
    }
  } catch (err) {
    logger.error({ err }, 'Proof of life check failed');
  }

  return { checked, decayed, frozen };
}

/** Start the proof-of-life cron (runs every hour) */
export function startProofOfLifeCron(): void {
  // Run immediately on startup
  const initial = runProofOfLifeCheck();
  logger.info({ ...initial }, 'Proof of life: initial check complete');

  // Then every hour
  setInterval(() => {
    const result = runProofOfLifeCheck();
    if (result.decayed > 0 || result.frozen > 0) {
      logger.info({ ...result }, 'Proof of life: hourly check complete');
    }
  }, 3600000); // 1 hour
}
