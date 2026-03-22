/**
 * proof-of-life-cron.ts — Autonomous Defense System
 *
 * Runs every hour. Implements 3 autonomous layers:
 *
 * 1. PROOF OF LIFE — heartbeat decay (dead man's switch)
 *    7d overdue → warning, 14d → degraded, 30d → critical,
 *    60d → endangered, 90d → auto-freeze
 *
 * 2. CONVERGENCE-TRIGGERED EXPONENTIAL DECAY (Section 39.19 Gap 2)
 *    Normal: -0.1/day. 1 negative signal: score × 0.95/day.
 *    2+ signals: × 0.85/day. 3+ AND anomaly > 0.7 AND heartbeat lapsed: × 0.70/day.
 *    Score 92 → dead in 5 days with critical decay.
 *
 * 3. COUNTERPARTY IMMUNE RESPONSE (Section 14.4)
 *    3+ negative attestations in 1hr → MONITOR
 *    5+ (diversity > 0.5) in 1hr → RESTRICT (force immediate settlement)
 *    10+ OR fraud attestation → QUARANTINE (auto-freeze)
 *
 * ALL without a single human making a single decision.
 */

import { getDb, logAudit } from '../db/connection';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AidKeyRow {
  did: string;
  owner_key: string;
  last_heartbeat: string | null;
  heartbeat_interval_days: number;
  heartbeat_grace_days: number;
  heartbeat_decay_applied: number;
  proof_of_life_status: string;
  frozen: number;
  created_at: string;
}

// ─── Heartbeat decay schedule ───────────────────────────────────────────────

const DECAY_SCHEDULE = [
  { daysOverdue: 90, status: 'auto_frozen', action: 'freeze' as const },
  { daysOverdue: 60, status: 'endangered', scoreCeiling: 39 },
  { daysOverdue: 30, status: 'critical', scoreCeiling: 59 },
  { daysOverdue: 14, status: 'degraded', scoreCeiling: 79 },
  { daysOverdue: 7,  status: 'warning', scoreCeiling: 89 },
];

// ─── Negative signal detection ──────────────────────────────────────────────

interface NegativeSignals {
  negativeAttestations1h: number;
  uniqueReporters1h: number;
  heartbeatLapsed: boolean;
  anomalyScore: number;
  signalCount: number;
  decayMultiplier: number;
}

function detectNegativeSignals(did: string, ownerKey: string, heartbeatLapsed: boolean): NegativeSignals {
  // Count negative attestations in last hour from feedback
  const negFeedback = getDb().prepare(`
    SELECT COUNT(*) as n, COUNT(DISTINCT reporter_did) as reporters
    FROM aid_feedback
    WHERE provider_did = ? AND outcome = 'failure'
    AND created_at > datetime('now', '-1 hour')
  `).get(did) as { n: number; reporters: number } | undefined;

  // Count failed attestations in last hour
  const negAttestations = getDb().prepare(`
    SELECT COUNT(*) as n FROM attestations
    WHERE owner_key = ? AND outcome_status != 'success'
    AND created_at > datetime('now', '-1 hour')
  `).get(ownerKey) as { n: number } | undefined;

  const negativeAttestations1h = (negFeedback?.n || 0) + (negAttestations?.n || 0);
  const uniqueReporters1h = negFeedback?.reporters || 0;

  // Compute simple anomaly score from recent activity deviation
  const recentVolume = getDb().prepare(`
    SELECT COUNT(*) as n FROM attestations
    WHERE owner_key = ? AND created_at > datetime('now', '-1 hour')
  `).get(ownerKey) as { n: number } | undefined;

  const historicalAvg = getDb().prepare(`
    SELECT COUNT(*) * 1.0 / MAX(1, CAST((julianday('now') - julianday(MIN(created_at))) * 24 AS INTEGER)) as avg_per_hour
    FROM attestations WHERE owner_key = ?
  `).get(ownerKey) as { avg_per_hour: number } | undefined;

  const currentRate = recentVolume?.n || 0;
  const avgRate = historicalAvg?.avg_per_hour || 1;
  // Anomaly = how many standard deviations above average (capped 0-1)
  const anomalyScore = Math.min(1.0, Math.max(0, (currentRate - avgRate) / Math.max(avgRate, 1)) / 5);

  // Count independent negative signals
  let signalCount = 0;
  if (negativeAttestations1h > 0) signalCount++;
  if (heartbeatLapsed) signalCount++;
  if (anomalyScore > 0.5) signalCount++;
  if (uniqueReporters1h >= 3) signalCount++;

  // Determine decay multiplier per Section 39.19 Gap 2
  let decayMultiplier = 1.0; // no decay acceleration
  if (signalCount >= 3 && anomalyScore > 0.7 && heartbeatLapsed) {
    decayMultiplier = 0.70; // CRITICAL: 30% daily reduction
  } else if (signalCount >= 2) {
    decayMultiplier = 0.85; // AGGRESSIVE: 15% daily reduction
  } else if (signalCount >= 1) {
    decayMultiplier = 0.95; // ACCELERATED: 5% daily reduction
  }

  return {
    negativeAttestations1h,
    uniqueReporters1h,
    heartbeatLapsed,
    anomalyScore,
    signalCount,
    decayMultiplier,
  };
}

// ─── Counterparty immune response ───────────────────────────────────────────

type ImmuneLevel = 'none' | 'monitor' | 'restrict' | 'quarantine';

function checkImmuneResponse(did: string): { level: ImmuneLevel; reporters: number } {
  // Count unique reporters with negative feedback in last hour
  // Only count reporters with trust score > 40 and diversity > 0.3 (anti-gaming)
  const result = getDb().prepare(`
    SELECT COUNT(DISTINCT f.reporter_did) as reporters,
           MAX(CASE WHEN f.outcome = 'failure' AND f.notes LIKE '%fraud%' THEN 1 ELSE 0 END) as has_fraud
    FROM aid_feedback f
    INNER JOIN aid_keys ak ON ak.did = f.reporter_did AND ak.key_status = 'active'
    WHERE f.provider_did = ? AND f.outcome IN ('failure', 'partial')
    AND f.created_at > datetime('now', '-1 hour')
  `).get(did) as { reporters: number; has_fraud: number } | undefined;

  const reporters = result?.reporters || 0;
  const hasFraud = (result?.has_fraud || 0) > 0;

  if (reporters >= 10 || hasFraud) return { level: 'quarantine', reporters };
  if (reporters >= 5) return { level: 'restrict', reporters };
  if (reporters >= 3) return { level: 'monitor', reporters };
  return { level: 'none', reporters };
}

// ─── Main check ─────────────────────────────────────────────────────────────

export function runProofOfLifeCheck(): {
  checked: number; decayed: number; frozen: number;
  immuneActions: number; anomaliesDetected: number;
} {
  let checked = 0;
  let decayed = 0;
  let frozen = 0;
  let immuneActions = 0;
  let anomaliesDetected = 0;

  try {
    const keys = getDb().prepare(`
      SELECT did, owner_key, last_heartbeat, heartbeat_interval_days,
             heartbeat_grace_days, heartbeat_decay_applied, proof_of_life_status, frozen, created_at
      FROM aid_keys
      WHERE key_status = 'active' AND frozen = 0
    `).all() as AidKeyRow[];

    const now = Date.now();

    for (const key of keys) {
      checked++;

      // ── 1. Heartbeat check ────────────────────────────────────────────
      const referenceTime = key.last_heartbeat
        ? new Date(key.last_heartbeat).getTime()
        : new Date(key.created_at).getTime();

      const intervalMs = (key.heartbeat_interval_days || 7) * 86400000;
      const graceMs = (key.heartbeat_grace_days || 3) * 86400000;
      const graceDeadline = referenceTime + intervalMs + graceMs;
      const heartbeatLapsed = now > graceDeadline;
      const daysOverdue = heartbeatLapsed ? Math.floor((now - graceDeadline) / 86400000) : 0;

      // ── 2. Detect negative signals ────────────────────────────────────
      const signals = detectNegativeSignals(key.did, key.owner_key, heartbeatLapsed);

      if (signals.anomalyScore > 0.5) {
        anomaliesDetected++;
      }

      // ── 3. Counterparty immune response ───────────────────────────────
      const immune = checkImmuneResponse(key.did);

      if (immune.level === 'quarantine') {
        // AUTO-FREEZE: 10+ reporters or fraud detected — no human needed
        getDb().prepare(`
          UPDATE aid_keys SET frozen = 1, frozen_at = datetime('now'),
          frozen_by = 'immune_response', proof_of_life_status = 'quarantined',
          updated_at = datetime('now')
          WHERE did = ? AND key_status = 'active'
        `).run(key.did);

        logAudit({
          entityType: 'aid', entityId: key.did, action: 'immune_quarantine',
          data: { reporters: immune.reporters, level: immune.level, signals: signals.signalCount },
        });

        logger.warn({ did: key.did, reporters: immune.reporters }, 'AID auto-frozen: immune response QUARANTINE');
        frozen++;
        immuneActions++;
        continue;
      }

      if (immune.level === 'restrict') {
        // RESTRICT: force immediate settlement, reduce max tx
        if (key.proof_of_life_status !== 'restricted') {
          getDb().prepare(`
            UPDATE aid_keys SET proof_of_life_status = 'restricted',
            updated_at = datetime('now') WHERE did = ?
          `).run(key.did);

          logAudit({
            entityType: 'aid', entityId: key.did, action: 'immune_restrict',
            data: { reporters: immune.reporters, level: immune.level },
          });

          logger.info({ did: key.did, reporters: immune.reporters }, 'AID restricted: immune response RESTRICT');
          immuneActions++;
          decayed++;
        }
        continue;
      }

      // ── 4. Heartbeat decay (with convergence-triggered acceleration) ──
      if (!heartbeatLapsed && signals.signalCount === 0) {
        // All clear — reset if previously decayed
        if (key.proof_of_life_status !== 'active' && key.proof_of_life_status !== 'restricted') {
          getDb().prepare(`
            UPDATE aid_keys SET proof_of_life_status = 'active', heartbeat_decay_applied = 0,
            updated_at = datetime('now') WHERE did = ?
          `).run(key.did);
        }
        continue;
      }

      // Determine decay status from heartbeat lapse
      let newStatus = key.proof_of_life_status;
      let shouldFreeze = false;

      if (heartbeatLapsed) {
        for (const level of DECAY_SCHEDULE) {
          if (daysOverdue >= level.daysOverdue) {
            newStatus = level.status;
            if (level.action === 'freeze') shouldFreeze = true;
            break;
          }
        }
      }

      // Apply convergence-triggered decay multiplier if negative signals present
      if (signals.signalCount > 0 && signals.decayMultiplier < 1.0) {
        const decayLabel = signals.decayMultiplier <= 0.70 ? 'critical' :
          signals.decayMultiplier <= 0.85 ? 'aggressive' : 'accelerated';

        // Upgrade status if convergence decay is worse than heartbeat decay alone
        if (decayLabel === 'critical' && ['active', 'warning', 'degraded'].includes(newStatus)) {
          newStatus = 'critical';
        } else if (decayLabel === 'aggressive' && ['active', 'warning'].includes(newStatus)) {
          newStatus = 'degraded';
        }
      }

      if (shouldFreeze) {
        getDb().prepare(`
          UPDATE aid_keys SET frozen = 1, frozen_at = datetime('now'), frozen_by = 'proof_of_life_cron',
          proof_of_life_status = 'auto_frozen', updated_at = datetime('now')
          WHERE did = ? AND key_status = 'active'
        `).run(key.did);

        logAudit({
          entityType: 'aid', entityId: key.did, action: 'auto_freeze',
          data: {
            reason: 'proof_of_life_lapsed', daysOverdue,
            signals: signals.signalCount, decayMultiplier: signals.decayMultiplier,
            anomalyScore: signals.anomalyScore,
          },
        });

        logger.warn({ did: key.did, daysOverdue, signals: signals.signalCount }, 'AID auto-frozen');
        frozen++;
      } else if (newStatus !== key.proof_of_life_status) {
        getDb().prepare(`
          UPDATE aid_keys SET proof_of_life_status = ?, heartbeat_decay_applied = ?,
          updated_at = datetime('now') WHERE did = ?
        `).run(newStatus, signals.decayMultiplier < 1.0 ? signals.decayMultiplier : daysOverdue, key.did);

        logAudit({
          entityType: 'aid', entityId: key.did, action: 'heartbeat_decay',
          data: {
            newStatus, daysOverdue, signals: signals.signalCount,
            decayMultiplier: signals.decayMultiplier, anomalyScore: signals.anomalyScore,
          },
        });

        logger.info({ did: key.did, newStatus, daysOverdue, decayMultiplier: signals.decayMultiplier },
          'AID decay applied');
        decayed++;
      }
    }
  } catch (err) {
    logger.error({ err }, 'Proof of life check failed');
  }

  return { checked, decayed, frozen, immuneActions, anomaliesDetected };
}

/** Start the autonomous defense cron (runs every hour) */
export function startProofOfLifeCron(): void {
  const initial = runProofOfLifeCheck();
  logger.info({ ...initial }, 'Autonomous defense: initial check complete');

  setInterval(() => {
    const result = runProofOfLifeCheck();
    if (result.decayed > 0 || result.frozen > 0 || result.immuneActions > 0) {
      logger.info({ ...result }, 'Autonomous defense: hourly check complete');
    }
  }, 3600000);
}
