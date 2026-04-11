/**
 * soma-checkpoint.ts — Periodic behavioral checkpoints
 *
 * Every N actions (or on-demand), Heart appends a CHECKPOINT leaf to the Pulse Tree.
 * Checkpoints bind: previous checkpoint hash, current MMR root, behavioral summary.
 * Forms a hash chain within the tree — tamper-evident behavioral attestation.
 */

import { getDb } from '../db/connection';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { logger } from '../utils/logger';
import {
  appendCheckpoint,
  getAgentPulseState,
  getRecentLeaves,
  getHeartbeatIndex,
} from './soma-heartbeat';

// ─── Configuration ────────────────────────────────────────────────────────

/** Default: create a checkpoint every N actions. */
export const CHECKPOINT_INTERVAL = 50;

// ─── Types ────────────────────────────────────────────────────────────────

export interface CheckpointData {
  agentDid: string;
  checkpointIndex: number;       // sequential checkpoint number
  heartbeatStart: number;        // first heartbeat covered
  heartbeatEnd: number;          // last heartbeat covered
  actionCount: number;           // actions in this window
  successCount: number;          // successful actions
  totalCreditsDelta: number;     // net credits in this window
  prevCheckpointHash: string;    // hash chain link (empty for first)
  pulseRoot: string;             // MMR root at time of checkpoint
  summary: string;               // behavioral summary
  checkpointHash: string;        // H(all fields above)
}

// ─── DB Helpers ───────────────────────────────────────────────────────────

/** Get the latest checkpoint for an agent. */
export function getLatestCheckpoint(agentDid: string): CheckpointData | null {
  const row = getDb()
    .prepare(`
      SELECT * FROM soma_checkpoints
      WHERE agent_did = ?
      ORDER BY checkpoint_index DESC
      LIMIT 1
    `)
    .get(agentDid) as any;

  if (!row) return null;
  return {
    agentDid: row.agent_did,
    checkpointIndex: row.checkpoint_index,
    heartbeatStart: row.heartbeat_start,
    heartbeatEnd: row.heartbeat_end,
    actionCount: row.action_count,
    successCount: row.success_count,
    totalCreditsDelta: row.total_credits_delta,
    prevCheckpointHash: row.prev_checkpoint_hash,
    pulseRoot: row.pulse_root,
    summary: row.summary,
    checkpointHash: row.checkpoint_hash,
  };
}

/** Get all checkpoints for an agent. */
export function getCheckpoints(agentDid: string, limit = 20): CheckpointData[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM soma_checkpoints
      WHERE agent_did = ?
      ORDER BY checkpoint_index DESC
      LIMIT ?
    `)
    .all(agentDid, limit) as any[];

  return rows.map(row => ({
    agentDid: row.agent_did,
    checkpointIndex: row.checkpoint_index,
    heartbeatStart: row.heartbeat_start,
    heartbeatEnd: row.heartbeat_end,
    actionCount: row.action_count,
    successCount: row.success_count,
    totalCreditsDelta: row.total_credits_delta,
    prevCheckpointHash: row.prev_checkpoint_hash,
    pulseRoot: row.pulse_root,
    summary: row.summary,
    checkpointHash: row.checkpoint_hash,
  }));
}

/** Count actions since last checkpoint. */
export function actionsSinceLastCheckpoint(agentDid: string): number {
  const latest = getLatestCheckpoint(agentDid);
  const currentHeartbeat = getHeartbeatIndex(agentDid);
  return currentHeartbeat - (latest?.heartbeatEnd ?? 0);
}

// ─── Checkpoint Creation ──────────────────────────────────────────────────

/**
 * Create a behavioral checkpoint for an agent.
 * Summarizes activity since the last checkpoint and appends a CHECKPOINT leaf.
 */
export function createCheckpoint(agentDid: string): CheckpointData {
  const prev = getLatestCheckpoint(agentDid);
  const pulseState = getAgentPulseState(agentDid);

  if (!pulseState || pulseState.heartbeatIndex === 0) {
    throw new Error('Cannot create checkpoint — no actions recorded');
  }

  const heartbeatStart = prev ? prev.heartbeatEnd + 1 : 1;
  const heartbeatEnd = pulseState.heartbeatIndex;

  if (heartbeatEnd < heartbeatStart) {
    throw new Error('No new actions since last checkpoint');
  }

  // Count actions and successes in the window.
  // `success` column is populated by appendAction from payload.success —
  // see src/db/connection.ts migration 199.
  const leaves = getDb()
    .prepare(`
      SELECT type, credit_delta, success FROM pulse_tree_leaves
      WHERE agent_did = ? AND heartbeat_index >= ? AND heartbeat_index <= ?
      ORDER BY leaf_index ASC
    `)
    .all(agentDid, heartbeatStart, heartbeatEnd) as Array<{ type: number; credit_delta: number; success: number }>;

  const actionCount = leaves.filter(l => l.type === 0x01).length;
  const successCount = leaves.filter(l => l.type === 0x01 && l.success === 1).length;
  const totalCreditsDelta = leaves.reduce((sum, l) => sum + l.credit_delta, 0);

  const checkpointIndex = prev ? prev.checkpointIndex + 1 : 0;
  const prevCheckpointHash = prev?.checkpointHash ?? '';

  const summary = `Checkpoint #${checkpointIndex}: ${actionCount} actions, ${totalCreditsDelta.toFixed(2)} credits delta, heartbeats ${heartbeatStart}-${heartbeatEnd}`;

  // Compute checkpoint hash — binds all fields including prev hash chain
  const checkpointHash = somaHashJson({
    agentDid,
    checkpointIndex,
    heartbeatStart,
    heartbeatEnd,
    actionCount,
    successCount,
    totalCreditsDelta,
    prevCheckpointHash,
    pulseRoot: pulseState.root,
    summary,
  });

  const checkpoint: CheckpointData = {
    agentDid,
    checkpointIndex,
    heartbeatStart,
    heartbeatEnd,
    actionCount,
    successCount,
    totalCreditsDelta,
    prevCheckpointHash,
    pulseRoot: pulseState.root,
    summary,
    checkpointHash,
  };

  // Persist + append CHECKPOINT leaf to Pulse Tree
  getDb().transaction(() => {
    getDb()
      .prepare(`
        INSERT INTO soma_checkpoints
        (agent_did, checkpoint_index, heartbeat_start, heartbeat_end, action_count, success_count, total_credits_delta, prev_checkpoint_hash, pulse_root, summary, checkpoint_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        agentDid,
        checkpointIndex,
        heartbeatStart,
        heartbeatEnd,
        actionCount,
        successCount,
        totalCreditsDelta,
        prevCheckpointHash,
        pulseState.root,
        summary,
        checkpointHash,
      );
  })();

  // Append CHECKPOINT leaf to Pulse Tree (outside transaction — appendCheckpoint has its own)
  appendCheckpoint(agentDid, {
    summary,
    actionsSinceLastCheckpoint: actionCount,
    prevCheckpointHash,
  });

  logger.info({ agentDid, checkpointIndex, actionCount, heartbeatStart, heartbeatEnd }, 'Checkpoint created');

  return checkpoint;
}

/**
 * Check if an agent is due for a checkpoint and create one if so.
 * Returns the checkpoint if created, null otherwise.
 */
export function maybeCreateCheckpoint(agentDid: string): CheckpointData | null {
  const pending = actionsSinceLastCheckpoint(agentDid);
  if (pending >= CHECKPOINT_INTERVAL) {
    return createCheckpoint(agentDid);
  }
  return null;
}

/**
 * Verify the hash chain integrity of an agent's checkpoints.
 * Returns true if all checkpoint hashes chain correctly.
 */
export function verifyCheckpointChain(agentDid: string): { valid: boolean; chainLength: number; error?: string } {
  const checkpoints = getDb()
    .prepare(`
      SELECT * FROM soma_checkpoints
      WHERE agent_did = ?
      ORDER BY checkpoint_index ASC
    `)
    .all(agentDid) as any[];

  if (checkpoints.length === 0) return { valid: true, chainLength: 0 };

  for (let i = 0; i < checkpoints.length; i++) {
    const cp = checkpoints[i];
    const expectedPrev = i === 0 ? '' : checkpoints[i - 1].checkpoint_hash;

    if (cp.prev_checkpoint_hash !== expectedPrev) {
      return {
        valid: false,
        chainLength: i,
        error: `Chain break at checkpoint #${cp.checkpoint_index}: expected prev hash ${expectedPrev.slice(0, 16)}..., got ${cp.prev_checkpoint_hash.slice(0, 16)}...`,
      };
    }

    // Recompute and verify checkpoint hash
    const recomputed = somaHashJson({
      agentDid: cp.agent_did,
      checkpointIndex: cp.checkpoint_index,
      heartbeatStart: cp.heartbeat_start,
      heartbeatEnd: cp.heartbeat_end,
      actionCount: cp.action_count,
      successCount: cp.success_count,
      totalCreditsDelta: cp.total_credits_delta,
      prevCheckpointHash: cp.prev_checkpoint_hash,
      pulseRoot: cp.pulse_root,
      summary: cp.summary,
    });

    if (recomputed !== cp.checkpoint_hash) {
      return {
        valid: false,
        chainLength: i,
        error: `Hash mismatch at checkpoint #${cp.checkpoint_index}: recomputed ${recomputed.slice(0, 16)}..., stored ${cp.checkpoint_hash.slice(0, 16)}...`,
      };
    }
  }

  return { valid: true, chainLength: checkpoints.length };
}
