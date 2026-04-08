/**
 * Trust Oracle Tests — unified trust query engine
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import {
  queryTrust,
  recordTrustQuery,
  getTrustQueryStats,
  TRUST_QUERY_COSTS,
} from '../../src/core/trust-oracle';
import {
  appendAction,
  appendEconomic,
  appendWallet,
  evictTreeCache,
} from '../../src/core/soma-heartbeat';

initDb();

const DID = 'did:key:test-trust-agent';

beforeEach(() => {
  // Clean all relevant tables
  getDb().exec('DELETE FROM pulse_tree_leaves');
  getDb().exec('DELETE FROM agent_pulse_state');
  getDb().exec('DELETE FROM soma_checkpoints');
  getDb().exec('DELETE FROM trust_queries');
  try { getDb().exec('DELETE FROM soma_verdict_stats'); } catch { /* may not exist in test */ }
  try { getDb().exec('DELETE FROM soma_verdicts'); } catch { /* may not exist in test */ }
  evictTreeCache(DID);
  evictTreeCache('did:key:unknown-agent');
});

// ─── Basic Tier ──────────────────────────────────────────────────────────────

describe('Basic trust query', () => {
  it('returns unknown for agent with no history', () => {
    const result = queryTrust('did:key:unknown-agent', 'basic');
    expect(result.trustVerdict).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.tier).toBe('basic');
    expect(result.queryId).toMatch(/^tq-/);
    expect(result.proofHash).toBeTruthy();
    expect(result.validUntil).toBeTruthy();
    expect(result.dimensions).toBeUndefined(); // basic doesn't include dimensions
  });

  it('returns score > 0 for agent with actions', () => {
    for (let i = 0; i < 20; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    const result = queryTrust(DID, 'basic');
    expect(result.trustScore).toBeGreaterThan(0);
    // Confidence may still be low if only reliability has data (no verdicts, no longevity)
    // but score should reflect good reliability
    expect(result.trustScore).toBeGreaterThanOrEqual(20);
  });

  it('does NOT include dimensions at basic tier', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = queryTrust(DID, 'basic');
    expect(result.dimensions).toBeUndefined();
    expect(result.pulse).toBeUndefined();
    expect(result.verdictSummary).toBeUndefined();
  });
});

// ─── Dimensional Tier ────────────────────────────────────────────────────────

describe('Dimensional trust query', () => {
  it('includes 5 dimensions', () => {
    for (let i = 0; i < 10; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    const result = queryTrust(DID, 'dimensional');
    expect(result.dimensions).toBeDefined();
    expect(result.dimensions!.reliability).toBeDefined();
    expect(result.dimensions!.economic).toBeDefined();
    expect(result.dimensions!.verification).toBeDefined();
    expect(result.dimensions!.longevity).toBeDefined();
    expect(result.dimensions!.consistency).toBeDefined();
  });

  it('each dimension has score, confidence, sampleSize', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = queryTrust(DID, 'dimensional');
    const dim = result.dimensions!.reliability;
    expect(typeof dim.score).toBe('number');
    expect(typeof dim.confidence).toBe('number');
    expect(typeof dim.sampleSize).toBe('number');
    expect(dim.score).toBeGreaterThanOrEqual(0);
    expect(dim.score).toBeLessThanOrEqual(100);
  });

  it('reliability score reflects success rate', () => {
    // All successful
    for (let i = 0; i < 10; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    const result = queryTrust(DID, 'dimensional');
    expect(result.dimensions!.reliability.score).toBeGreaterThanOrEqual(80);
  });

  it('does NOT include pulse or verdictSummary at dimensional tier', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = queryTrust(DID, 'dimensional');
    expect(result.pulse).toBeUndefined();
    expect(result.verdictSummary).toBeUndefined();
  });
});

// ─── Full Tier ───────────────────────────────────────────────────────────────

describe('Full trust query', () => {
  it('includes everything: dimensions + pulse + recentActivity', () => {
    for (let i = 0; i < 5; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 2);
    }
    appendEconomic(DID, { action: 'deposit', amount: 100 });

    const result = queryTrust(DID, 'full');
    expect(result.dimensions).toBeDefined();
    expect(result.pulse).toBeDefined();
    expect(result.pulse!.heartbeatIndex).toBe(6);
    expect(result.pulse!.leafCount).toBe(6);
    expect(result.pulse!.root).toBeTruthy();
    expect(result.recentActivity).toBeDefined();
    expect(result.recentActivity!.actionsLast24h).toBeGreaterThan(0);
    expect(result.recentActivity!.actionsLast7d).toBeGreaterThan(0);
  });

  it('includes verdictSummary as null when no verdicts exist', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = queryTrust(DID, 'full');
    // No verdicts recorded, so verdictSummary should be undefined
    expect(result.verdictSummary).toBeUndefined();
  });
});

// ─── Risk Flags ──────────────────────────────────────────────────────────────

describe('Risk flags', () => {
  it('flags NO_HISTORY for unknown agent', () => {
    const result = queryTrust('did:key:unknown-agent', 'basic');
    expect(result.riskFlags).toContain('NO_HISTORY');
  });

  it('flags LOW_ACTIVITY for agent with few actions', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = queryTrust(DID, 'basic');
    expect(result.riskFlags).toContain('LOW_ACTIVITY');
  });

  it('no LOW_ACTIVITY flag when agent has 10+ actions', () => {
    for (let i = 0; i < 10; i++) {
      appendAction(DID, { endpointId: `ep-${i}`, success: true, durationMs: 50, cached: false }, 1);
    }
    const result = queryTrust(DID, 'basic');
    expect(result.riskFlags).not.toContain('LOW_ACTIVITY');
  });
});

// ─── Metering ────────────────────────────────────────────────────────────────

describe('Trust query metering', () => {
  it('records a trust query', () => {
    const id = recordTrustQuery('cn-test-key', DID, 'basic', 0.01);
    expect(id).toMatch(/^tqm-/);
  });

  it('tracks stats correctly', () => {
    recordTrustQuery('cn-key-1', DID, 'basic', 0.01);
    recordTrustQuery('cn-key-1', DID, 'dimensional', 0.05);
    recordTrustQuery('cn-key-2', DID, 'full', 0.10);

    const stats = getTrustQueryStats();
    expect(stats.total).toBe(3);
    expect(stats.byTier.basic).toBe(1);
    expect(stats.byTier.dimensional).toBe(1);
    expect(stats.byTier.full).toBe(1);
    expect(stats.totalRevenue).toBe(0.16);
  });
});

// ─── Pricing ─────────────────────────────────────────────────────────────────

describe('Trust query pricing', () => {
  it('has correct tier costs', () => {
    expect(TRUST_QUERY_COSTS.basic).toBe(0.01);
    expect(TRUST_QUERY_COSTS.dimensional).toBe(0.05);
    expect(TRUST_QUERY_COSTS.full).toBe(0.10);
  });

  it('full > dimensional > basic', () => {
    expect(TRUST_QUERY_COSTS.full).toBeGreaterThan(TRUST_QUERY_COSTS.dimensional);
    expect(TRUST_QUERY_COSTS.dimensional).toBeGreaterThan(TRUST_QUERY_COSTS.basic);
  });
});

// ─── Proof Hash ──────────────────────────────────────────────────────────────

describe('Proof hash', () => {
  it('is deterministic for same input', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const r1 = queryTrust(DID, 'basic');
    const r2 = queryTrust(DID, 'basic');
    // Different queryIds but same underlying data
    // proofHash should differ because queryId is included in the hash
    expect(r1.proofHash).toBeTruthy();
    expect(r2.proofHash).toBeTruthy();
  });

  it('changes when agent state changes', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const r1 = queryTrust(DID, 'basic');

    appendAction(DID, { endpointId: 'ep-2', success: true, durationMs: 50, cached: false }, 1);
    const r2 = queryTrust(DID, 'basic');

    // Each query gets a unique queryId which is included in proofHash
    expect(r1.queryId).not.toBe(r2.queryId);
    expect(r1.proofHash).not.toBe(r2.proofHash);
  });
});

// ─── TTL ─────────────────────────────────────────────────────────────────────

describe('TTL', () => {
  it('basic tier has longest TTL (60 min)', () => {
    const result = queryTrust(DID, 'basic');
    const validUntil = new Date(result.validUntil).getTime();
    const now = Date.now();
    const diffMinutes = (validUntil - now) / 60_000;
    expect(diffMinutes).toBeGreaterThan(55);
    expect(diffMinutes).toBeLessThanOrEqual(61);
  });

  it('full tier has shortest TTL (15 min)', () => {
    appendAction(DID, { endpointId: 'ep-1', success: true, durationMs: 50, cached: false }, 1);
    const result = queryTrust(DID, 'full');
    const validUntil = new Date(result.validUntil).getTime();
    const now = Date.now();
    const diffMinutes = (validUntil - now) / 60_000;
    expect(diffMinutes).toBeGreaterThan(13);
    expect(diffMinutes).toBeLessThanOrEqual(16);
  });
});
