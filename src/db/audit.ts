import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb } from './connection';

// ─── Audit Log ────────────────────────────────────────────────────────────────

export function writeAuditLog(params: {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | null;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(`INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, data_json)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        nanoid(16), params.entityType, params.entityId, params.action,
        params.actorId ?? null,
        params.data ? JSON.stringify(params.data) : null
      );
  } catch (err) {
    logger.error({ err }, 'Failed to write audit log');
  }
}

export function getAuditLog(entityType: string, entityId: string, limit = 200): {
  id: string; action: string; actor_id: string | null; data_json: string | null; timestamp: string;
}[] {
  return getDb()
    .prepare('SELECT id, action, actor_id, data_json, timestamp FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC LIMIT ?')
    .all(entityType, entityId, limit) as { id: string; action: string; actor_id: string | null; data_json: string | null; timestamp: string; }[];
}

// ─── Batched Delete Helper ────────────────────────────────────────────────────

/**
 * Delete rows in batches to avoid holding the SQLite write lock for seconds.
 * At 100K+ rows, a single DELETE locks the database for the entire duration.
 * Batched deletes (5000 per iteration) keep each lock under ~50ms.
 */
function batchedDelete(sql: string, params: unknown[], batchSize = 5000): number {
  const db = getDb();
  const stmt = db.prepare(sql + ` LIMIT ?`);
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = stmt.run(...params, batchSize);
    total += result.changes;
    if (result.changes < batchSize) break;
  }
  return total;
}

// ─── Retention / Cleanup (batched) ───────────────────────────────────────────

export function cleanupOldAuditLogs(daysToKeep = 90): number {
  return batchedDelete(
    `DELETE FROM audit_log WHERE rowid IN (SELECT rowid FROM audit_log WHERE timestamp < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldSkillMetrics(daysToKeep = 90): number {
  return batchedDelete(
    `DELETE FROM skill_metrics WHERE rowid IN (SELECT rowid FROM skill_metrics WHERE timestamp < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldSolanaSigs(daysToKeep = 30): number {
  return batchedDelete(
    `DELETE FROM solana_processed_sigs WHERE rowid IN (SELECT rowid FROM solana_processed_sigs WHERE processed_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldOrchestrations(daysToKeep = 180): number {
  return batchedDelete(
    `DELETE FROM orchestrations WHERE rowid IN (SELECT rowid FROM orchestrations WHERE timestamp < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldFeedback(daysToKeep = 365): number {
  return batchedDelete(
    `DELETE FROM feedback WHERE rowid IN (SELECT rowid FROM feedback WHERE timestamp < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldEmailLog(daysToKeep = 30): number {
  return batchedDelete(
    `DELETE FROM email_send_log WHERE rowid IN (SELECT rowid FROM email_send_log WHERE sent_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupStalePeers(daysToKeep = 7): number {
  return batchedDelete(
    `DELETE FROM peers WHERE rowid IN (SELECT rowid FROM peers WHERE last_seen < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldStripeSessions(daysToKeep = 90): number {
  return batchedDelete(
    `DELETE FROM stripe_processed_sessions WHERE rowid IN (SELECT rowid FROM stripe_processed_sessions WHERE processed_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupOldStripeEvents(daysToKeep = 90): number {
  return batchedDelete(
    `DELETE FROM stripe_processed_events WHERE rowid IN (SELECT rowid FROM stripe_processed_events WHERE processed_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

export function cleanupExpiredClaimTokens(): number {
  return batchedDelete(
    `DELETE FROM claim_tokens WHERE rowid IN (SELECT rowid FROM claim_tokens WHERE expires_at < datetime('now'))`,
    []
  );
}

// ─── New Cleanup Functions for Previously Unbounded Tables ───────────────────

/** Clean completed/failed tasks older than retention period */
export function cleanupOldTasks(daysToKeep = 90): number {
  return batchedDelete(
    `DELETE FROM tasks WHERE rowid IN (SELECT rowid FROM tasks WHERE status IN ('COMPLETED','FAILED','CANCELLED') AND completed_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

/** Clean completed/failed swarm tasks older than retention period */
export function cleanupOldSwarms(daysToKeep = 90): number {
  return batchedDelete(
    `DELETE FROM swarms WHERE rowid IN (SELECT rowid FROM swarms WHERE status IN ('COMPLETED','FAILED') AND completed_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

/** Clean reputation events older than retention period */
export function cleanupOldReputationEvents(daysToKeep = 365): number {
  return batchedDelete(
    `DELETE FROM reputation_events WHERE rowid IN (SELECT rowid FROM reputation_events WHERE timestamp < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

/** Clean transactions older than retention period (financial records — 2 years) */
export function cleanupOldTransactions(daysToKeep = 730): number {
  return batchedDelete(
    `DELETE FROM transactions WHERE rowid IN (SELECT rowid FROM transactions WHERE created_at < datetime('now', '-' || ? || ' days'))`,
    [daysToKeep]
  );
}

/** Clean votes on closed proposals older than retention period */
export function cleanupOldVotes(daysToKeep = 365): number {
  return batchedDelete(
    `DELETE FROM votes WHERE rowid IN (SELECT rowid FROM votes WHERE proposal_id IN (SELECT id FROM proposals WHERE status != 'OPEN' AND created_at < datetime('now', '-' || ? || ' days')))`,
    [daysToKeep]
  );
}
