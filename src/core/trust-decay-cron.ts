/**
 * trust-decay-cron.ts — Trust score decay for inactive agents (Cherry 7)
 *
 * Runs every 24 hours. Agents who don't transact gradually lose trust score.
 * The decay rate is adaptive per-category:
 *
 *   DeFi/trading agents:  10% per 7 days  (stale trust is dangerous)
 *   Data feed agents:     10% per 14 days (moderate frequency expected)
 *   General agents:       10% per 30 days (standard decay)
 *   Rare-use agents:      10% per 90 days (infrequent use is normal)
 *
 * Decay is applied to the trust score stored in attestation_stats.
 * The decay factor is: score × (0.9 ^ (days_inactive / decay_period))
 *
 * Trust decay is the "gravity well" — score WANTS to decay.
 * Requires constant energy (successful transactions) to maintain.
 */

import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

// ─── Decay Periods by Category ──────────────────────────────────────────────

const DECAY_PERIODS: Record<string, number> = {
  defi: 7,
  trading: 7,
  data: 14,
  skills: 30,
  verification: 30,
  attestation: 30,
  general: 30,
  compute: 14,
};

const DEFAULT_DECAY_PERIOD = 30;
const DECAY_RATE = 0.10; // 10% weight loss per period
const MIN_SCORE_AFTER_DECAY = 0;

// ─── Decay Logic ────────────────────────────────────────────────────────────

/**
 * Run trust decay for all agents.
 * Called by the cron every 24 hours.
 */
export function runTrustDecay(): { checked: number; decayed: number } {
  let checked = 0;
  let decayed = 0;

  try {
    // Get all agents with their last attestation time and primary category
    const agents = getDb().prepare(`
      SELECT
        ast.owner_key,
        ast.success_count,
        ast.total_attestations,
        (SELECT MAX(created_at) FROM attestations WHERE owner_key = ast.owner_key) as last_activity,
        (SELECT action_type FROM attestations WHERE owner_key = ast.owner_key
         ORDER BY created_at DESC LIMIT 1) as last_action_type
      FROM attestation_stats ast
      WHERE ast.total_attestations > 0
    `).all() as Array<{
      owner_key: string;
      success_count: number;
      total_attestations: number;
      last_activity: string | null;
      last_action_type: string | null;
    }>;

    const now = Date.now();

    for (const agent of agents) {
      checked++;

      if (!agent.last_activity) continue;

      const lastActivityMs = new Date(agent.last_activity).getTime();
      const inactiveDays = (now - lastActivityMs) / 86_400_000;

      // Determine decay period based on agent's primary category
      const category = inferCategory(agent.last_action_type);
      const decayPeriod = DECAY_PERIODS[category] || DEFAULT_DECAY_PERIOD;

      // Only decay if inactive longer than the decay period
      if (inactiveDays < decayPeriod) continue;

      // Calculate decay factor: 0.9 ^ (inactive_periods)
      const periods = inactiveDays / decayPeriod;
      const decayFactor = Math.pow(1 - DECAY_RATE, periods);

      // Apply decay by reducing the effective success count proportionally
      // This reduces the trust score without deleting actual attestation records
      const decayedSuccessCount = Math.max(0, Math.floor(agent.success_count * decayFactor));

      if (decayedSuccessCount < agent.success_count) {
        getDb().prepare(`
          UPDATE attestation_stats
          SET success_count = ?,
              last_decay_at = datetime('now'),
              decay_factor = ?
          WHERE owner_key = ?
        `).run(decayedSuccessCount, decayFactor, agent.owner_key);

        decayed++;

        if (decayed <= 5) {
          logger.debug({
            ownerKey: agent.owner_key.slice(0, 8),
            inactiveDays: Math.floor(inactiveDays),
            category,
            decayFactor: decayFactor.toFixed(3),
            oldSuccess: agent.success_count,
            newSuccess: decayedSuccessCount,
          }, 'Trust decay applied');
        }
      }
    }

    if (decayed > 0) {
      logger.info({ checked, decayed }, 'Trust decay cycle complete');
    }
  } catch (err) {
    logger.error({ err }, 'Trust decay cron failed');
  }

  return { checked, decayed };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function inferCategory(actionType: string | null): string {
  if (!actionType) return 'general';
  const lower = actionType.toLowerCase();
  if (lower.includes('swap') || lower.includes('trade')) return 'defi';
  if (lower.includes('price') || lower.includes('data') || lower.includes('query')) return 'data';
  if (lower.includes('compute') || lower.includes('analyze')) return 'compute';
  if (lower.includes('verify') || lower.includes('attest')) return 'verification';
  return 'general';
}

// ─── DB schema addition ─────────────────────────────────────────────────────

// Requires these columns on attestation_stats (added via migration v117):
//   last_decay_at TEXT
//   decay_factor REAL DEFAULT 1.0

// ─── Cron Setup ─────────────────────────────────────────────────────────────

let decayTimer: ReturnType<typeof setInterval> | null = null;

export function startTrustDecayCron(): void {
  // Run every 24 hours
  decayTimer = setInterval(() => {
    runTrustDecay();
  }, 24 * 60 * 60 * 1000);

  // Initial run after 1 hour (let other crons initialize first)
  setTimeout(() => runTrustDecay(), 3_600_000);

  logger.info('Trust decay cron started (every 24h)');
}

export function stopTrustDecayCron(): void {
  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
  }
}
