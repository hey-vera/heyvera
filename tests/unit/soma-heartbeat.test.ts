/**
 * Soma Heartbeat Integration Tests — Pulse Tree wired to Heart
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import {
  appendAction,
  appendEconomic,
  appendCheckpoint,
  appendWallet,
  appendBurner,
  appendDeath,
  getAgentPulseState,
  getHeartbeatIndex,
  getAgentTree,
  generatePulseProof,
  getRecentLeaves,
  evictTreeCache,
} from '../../src/core/soma-heartbeat';
import { PulseTree, PULSE_TYPE } from '../../src/core/pulse-tree';

// Init DB once, clear pulse tables + caches per test
initDb();

beforeEach(() => {
  getDb().exec('DELETE FROM pulse_tree_leaves');
  getDb().exec('DELETE FROM agent_pulse_state');
  evictTreeCache('did:key:test-agent-1');
  evictTreeCache('did:key:test-agent-2');
});

// ─── Heartbeat Index ──────────────────────────────────────────────────────

describe('Heartbeat index tracking', () => {
  it('starts at 0 for unknown agent', () => {
    expect(getHeartbeatIndex('did:key:unknown')).toBe(0);
  });

  it('increments with each append', () => {
    const did = 'did:key:test-agent-1';
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    expect(getHeartbeatIndex(did)).toBe(1);

    appendAction(did, { endpointId: 'ep-2', success: true, durationMs: 30, cached: true }, 0);
    expect(getHeartbeatIndex(did)).toBe(2);

    appendEconomic(did, { action: 'deposit', amount: 100 });
    expect(getHeartbeatIndex(did)).toBe(3);
  });
});

// ─── Typed Appends ────────────────────────────────────────────────────────

describe('Typed leaf appends', () => {
  const did = 'did:key:test-agent-1';

  it('appends ACTION leaves', () => {
    const result = appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 100, cached: false }, 2.5);
    expect(result.heartbeatIndex).toBe(1);
    expect(result.position).toBe(0);
    expect(result.root).toBeDefined();
    expect(result.root.length).toBe(64); // SHA-256 hex
  });

  it('appends ECONOMIC leaves with credit delta', () => {
    const result = appendEconomic(did, { action: 'deposit', amount: 50 });
    expect(result.heartbeatIndex).toBe(1);

    const state = getAgentPulseState(did);
    expect(state).toBeDefined();
    expect(state!.totalCredits).toBe(50);
  });

  it('appends CHECKPOINT leaves', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = appendCheckpoint(did, { summary: 'test checkpoint', actionsSinceLastCheckpoint: 1 });
    expect(result.heartbeatIndex).toBe(2);
  });

  it('appends WALLET leaves', () => {
    const result = appendWallet(did, { chain: 'solana', index: 0, address: '7abc...' });
    expect(result.heartbeatIndex).toBe(1);
  });

  it('appends BURNER leaves with bond credit delta', () => {
    const create = appendBurner(did, { action: 'create', burnerId: 'b-1', bondAmount: 5 });
    expect(create.heartbeatIndex).toBe(1);

    const revoke = appendBurner(did, { action: 'revoke', burnerId: 'b-1', bondAmount: 5 });
    expect(revoke.heartbeatIndex).toBe(2);

    // Bond out (-5) then back in (+5) = 0 net
    const state = getAgentPulseState(did);
    expect(state!.totalCredits).toBe(0);
  });

  it('appends DEATH leaf and evicts cache', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = appendDeath(did, { reason: 'graceful', finalBalance: 42 });
    expect(result.heartbeatIndex).toBe(2);

    const state = getAgentPulseState(did);
    expect(state!.leafCount).toBe(2);
  });
});

// ─── Pulse State ──────────────────────────────────────────────────────────

describe('Agent pulse state', () => {
  const did = 'did:key:test-agent-1';

  it('returns null for unknown agent', () => {
    expect(getAgentPulseState('did:key:unknown')).toBeNull();
  });

  it('tracks leaf count and root', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    appendAction(did, { endpointId: 'ep-2', success: true, durationMs: 30, cached: false }, 2);

    const state = getAgentPulseState(did);
    expect(state!.leafCount).toBe(2);
    expect(state!.heartbeatIndex).toBe(2);
    expect(state!.totalCredits).toBe(3);
    expect(state!.root.length).toBe(64);
  });

  it('root changes with each append', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const root1 = getAgentPulseState(did)!.root;

    appendAction(did, { endpointId: 'ep-2', success: true, durationMs: 30, cached: false }, 2);
    const root2 = getAgentPulseState(did)!.root;

    expect(root1).not.toBe(root2);
  });
});

// ─── Tree Replay ──────────────────────────────────────────────────────────

describe('Tree replay from DB', () => {
  const did = 'did:key:test-agent-1';

  it('reconstructs tree from stored leaves', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    appendAction(did, { endpointId: 'ep-2', success: true, durationMs: 30, cached: false }, 2);
    appendEconomic(did, { action: 'spend', amount: -0.5 });

    const rootBefore = getAgentTree(did).getRoot();

    // Evict cache — force replay
    evictTreeCache(did);

    const rootAfter = getAgentTree(did).getRoot();
    expect(rootAfter).toBe(rootBefore);
  });
});

// ─── Inclusion Proofs ─────────────────────────────────────────────────────

describe('Pulse proof generation', () => {
  const did = 'did:key:test-agent-1';

  it('generates valid proof for first leaf', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);

    const proof = generatePulseProof(did, 0);
    expect(proof.leafIndex).toBe(0);
    expect(proof.root.length).toBe(64);
  });

  it('generates valid proofs for multiple leaves', () => {
    for (let i = 0; i < 5; i++) {
      appendAction(did, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, i);
    }

    for (let i = 0; i < 5; i++) {
      const proof = generatePulseProof(did, i);
      expect(proof.leafIndex).toBe(i);
      expect(proof.root.length).toBe(64);
    }
  });

  it('throws on out-of-range index', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    expect(() => generatePulseProof(did, 5)).toThrow();
  });
});

// ─── Recent Leaves ────────────────────────────────────────────────────────

describe('Recent leaves query', () => {
  const did = 'did:key:test-agent-1';

  it('returns empty for unknown agent', () => {
    expect(getRecentLeaves('did:key:unknown')).toEqual([]);
  });

  it('returns leaves in reverse order', () => {
    appendAction(did, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    appendEconomic(did, { action: 'deposit', amount: 100 });
    appendAction(did, { endpointId: 'ep-2', success: true, durationMs: 30, cached: true }, 0);

    const leaves = getRecentLeaves(did, 10);
    expect(leaves).toHaveLength(3);
    // Most recent first
    expect(leaves[0].type).toBe(PULSE_TYPE.ACTION);
    expect(leaves[1].type).toBe(PULSE_TYPE.ECONOMIC);
    expect(leaves[2].type).toBe(PULSE_TYPE.ACTION);
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      appendAction(did, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    expect(getRecentLeaves(did, 3)).toHaveLength(3);
  });
});

// ─── Multi-Agent Isolation ────────────────────────────────────────────────

describe('Multi-agent isolation', () => {
  it('agents have independent pulse states', () => {
    const did1 = 'did:key:test-agent-1';
    const did2 = 'did:key:test-agent-2';

    appendAction(did1, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 10);
    appendAction(did2, { endpointId: 'ep-2', success: true, durationMs: 30, cached: false }, 20);

    const state1 = getAgentPulseState(did1);
    const state2 = getAgentPulseState(did2);

    expect(state1!.heartbeatIndex).toBe(1);
    expect(state2!.heartbeatIndex).toBe(1);
    expect(state1!.totalCredits).toBe(10);
    expect(state2!.totalCredits).toBe(20);
    expect(state1!.root).not.toBe(state2!.root);
  });
});
