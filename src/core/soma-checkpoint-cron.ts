/**
 * Soma Checkpoint Cron
 *
 * Periodically advances the behavioral checkpoint chain for active agents.
 * Without this cron, `maybeCreateCheckpoint` is dead code — the chain never
 * advances and `trust-oracle.computeConsistency` always sees an empty
 * `soma_checkpoints` table, collapsing that dimension to the neutral floor.
 *
 * Active agents = every row in `agent_pulse_state`. For each, call
 * `maybeCreateCheckpoint`, which no-ops if the agent is below the
 * CHECKPOINT_INTERVAL threshold.
 */

import { getDb } from '../db/connection';
import { maybeCreateCheckpoint } from './soma-checkpoint';
import { logger } from '../utils/logger';

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function runSomaCheckpointCycle(): { checked: number; created: number } {
  const agents = getDb()
    .prepare('SELECT agent_did FROM agent_pulse_state')
    .all() as Array<{ agent_did: string }>;

  let created = 0;
  for (const { agent_did } of agents) {
    try {
      const cp = maybeCreateCheckpoint(agent_did);
      if (cp) created++;
    } catch (err) {
      logger.warn({ err, agentDid: agent_did }, 'Soma checkpoint cron: maybeCreateCheckpoint failed');
    }
  }

  if (created > 0) {
    logger.info({ checked: agents.length, created }, 'Soma checkpoint cron: checkpoints advanced');
  }
  return { checked: agents.length, created };
}

export function startSomaCheckpointCron(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (_interval) {
    logger.warn('startSomaCheckpointCron called twice — ignoring');
    return;
  }
  _interval = setInterval(() => {
    if (_running) return;
    _running = true;
    try {
      runSomaCheckpointCycle();
    } catch (err) {
      logger.error({ err }, 'Soma checkpoint cron unhandled error');
    } finally {
      _running = false;
    }
  }, intervalMs);
  logger.info({ intervalMs }, 'Soma checkpoint cron started');
}

export function stopSomaCheckpointCron(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
