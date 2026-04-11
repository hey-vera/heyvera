/**
 * Soma Checkpoint Tests — behavioral checkpoints with hash chain
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import { appendAction, evictTreeCache } from '../../src/core/soma-heartbeat';
import {
  createCheckpoint,
  getLatestCheckpoint,
  getCheckpoints,
  actionsSinceLastCheckpoint,
  maybeCreateCheckpoint,
  verifyCheckpointChain,
  CHECKPOINT_INTERVAL,
} from '../../src/core/soma-checkpoint';

const DID = 'did:key:checkpoint-test';

initDb();

beforeEach(() => {
  getDb().exec('DELETE FROM pulse_tree_leaves');
  getDb().exec('DELETE FROM agent_pulse_state');
  getDb().exec('DELETE FROM soma_checkpoints');
  evictTreeCache(DID);
});

// ─── Basic Checkpoint ─────────────────────────────────────────────────────

describe('Checkpoint creation', () => {
  it('creates a checkpoint after actions', () => {
    // Add some actions
    for (let i = 0; i < 5; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }

    const cp = createCheckpoint(DID);
    expect(cp.checkpointIndex).toBe(0);
    expect(cp.heartbeatStart).toBe(1);
    expect(cp.heartbeatEnd).toBe(5);
    expect(cp.actionCount).toBe(5);
    expect(cp.totalCreditsDelta).toBe(5);
    expect(cp.prevCheckpointHash).toBe('');
    expect(cp.checkpointHash.length).toBe(64);
    expect(cp.pulseRoot.length).toBe(64);
  });

  it('successCount reflects actual action outcome, not raw count', () => {
    // Mix of successful and failed actions. The previous implementation
    // hardcoded successCount = actionCount, so failing this test proves the
    // success column from migration 199 is actually being consulted.
    appendAction(DID, { endpointId: 'ep-ok-1', success: true, durationMs: 50, cached: false }, 1);
    appendAction(DID, { endpointId: 'ep-fail-1', success: false, durationMs: 120, cached: false }, 1);
    appendAction(DID, { endpointId: 'ep-ok-2', success: true, durationMs: 40, cached: false }, 1);
    appendAction(DID, { endpointId: 'ep-fail-2', success: false, durationMs: 200, cached: false }, 1);
    appendAction(DID, { endpointId: 'ep-ok-3', success: true, durationMs: 30, cached: false }, 1);

    const cp = createCheckpoint(DID);
    expect(cp.actionCount).toBe(5);
    expect(cp.successCount).toBe(3); // 3 successes, 2 failures
  });

  it('throws when no actions exist', () => {
    expect(() => createCheckpoint(DID)).toThrow('no actions recorded');
  });

  it('second checkpoint only covers the checkpoint leaf itself', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const cp0 = createCheckpoint(DID);
    // The checkpoint leaf itself incremented heartbeat, so a 2nd checkpoint covers that
    const cp1 = createCheckpoint(DID);
    expect(cp1.checkpointIndex).toBe(1);
    expect(cp1.prevCheckpointHash).toBe(cp0.checkpointHash);
  });
});

// ─── Hash Chain ───────────────────────────────────────────────────────────

describe('Checkpoint hash chain', () => {
  it('chains checkpoints via prevCheckpointHash', () => {
    // First window of actions
    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 2);
    }
    const cp0 = createCheckpoint(DID);

    // Second window
    for (let i = 0; i < 4; i++) {
      appendAction(DID, { endpointId: `ep-${i + 3}`, success: true, durationMs: 30, cached: false }, 1);
    }
    const cp1 = createCheckpoint(DID);

    expect(cp1.checkpointIndex).toBe(1);
    expect(cp1.prevCheckpointHash).toBe(cp0.checkpointHash);
    // cp1 starts after cp0's heartbeatEnd + 1 (the checkpoint leaf)
    expect(cp1.heartbeatStart).toBe(cp0.heartbeatEnd + 1);
  });

  it('verifyCheckpointChain passes for valid chain', () => {
    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    createCheckpoint(DID);

    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i + 3}`, success: true, durationMs: 50, cached: false }, 1);
    }
    createCheckpoint(DID);

    const result = verifyCheckpointChain(DID);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(2);
  });

  it('empty chain is valid', () => {
    const result = verifyCheckpointChain(DID);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(0);
  });
});

// ─── Queries ──────────────────────────────────────────────────────────────

describe('Checkpoint queries', () => {
  it('getLatestCheckpoint returns most recent', () => {
    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    createCheckpoint(DID);

    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    const cp1 = createCheckpoint(DID);

    const latest = getLatestCheckpoint(DID);
    expect(latest).toBeDefined();
    expect(latest!.checkpointIndex).toBe(1);
    expect(latest!.checkpointHash).toBe(cp1.checkpointHash);
  });

  it('getCheckpoints returns in reverse order', () => {
    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    createCheckpoint(DID);

    for (let i = 0; i < 3; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    createCheckpoint(DID);

    const cps = getCheckpoints(DID);
    expect(cps).toHaveLength(2);
    expect(cps[0].checkpointIndex).toBe(1); // most recent first
    expect(cps[1].checkpointIndex).toBe(0);
  });

  it('actionsSinceLastCheckpoint counts correctly', () => {
    expect(actionsSinceLastCheckpoint(DID)).toBe(0);

    for (let i = 0; i < 5; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    expect(actionsSinceLastCheckpoint(DID)).toBe(5);

    createCheckpoint(DID);
    // After checkpoint, the checkpoint leaf itself added 1 more heartbeat
    // but actionsSinceLastCheckpoint uses heartbeatEnd from checkpoint
    const pending = actionsSinceLastCheckpoint(DID);
    // Should be 1 (the checkpoint leaf itself incremented heartbeat)
    expect(pending).toBe(1);
  });
});

// ─── Auto-Checkpoint ──────────────────────────────────────────────────────

describe('Auto-checkpoint', () => {
  it('maybeCreateCheckpoint creates when threshold reached', () => {
    for (let i = 0; i < CHECKPOINT_INTERVAL; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 10, cached: false }, 0.01);
    }

    const cp = maybeCreateCheckpoint(DID);
    expect(cp).not.toBeNull();
    expect(cp!.checkpointIndex).toBe(0);
    expect(cp!.actionCount).toBe(CHECKPOINT_INTERVAL);
  });

  it('maybeCreateCheckpoint returns null when below threshold', () => {
    for (let i = 0; i < CHECKPOINT_INTERVAL - 2; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 10, cached: false }, 0.01);
    }

    expect(maybeCreateCheckpoint(DID)).toBeNull();
  });
});
