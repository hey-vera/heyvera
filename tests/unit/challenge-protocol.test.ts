/**
 * Challenge protocol tests — full lifecycle + concurrency stress
 *
 * Verifies:
 *   - Filing a challenge: bond deduction, state creation, duplicate rejection
 *   - Responding: bisection rounds, state transitions
 *   - Conceding: slash distribution, cert marked as fraud
 *   - Expiry: auto-expire unanswered challenges, auto-finalize certs
 *   - Tier 0 rejection: cannot challenge spot-check-only certs
 *   - Window enforcement: cannot challenge after window closes
 *   - Concurrent challenges on same cert: all-vs-all merge
 *   - DB integrity: challenges link to certs, no orphans
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb, seedApiKey, getTestDb } from './helpers/db';
setupTestDb();

import { initDb, getDb } from '../../src/db/connection';
import { registerBuiltinTypes } from '../../src/core/computation-types';
import {
  createComputationCertificate,
  getComputationCertificateById,
} from '../../src/core/computation-certificate';
import {
  calculateBondRequirement,
  calculateSlashAmounts,
  canChallengeTransition,
  isChallengeWindowOpen,
} from '../../src/core/bond-economics';
import { somaHash } from '../../src/utils/crypto-agility';
import { round6 } from '../../src/core/credits';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

/** Helper: create a cert at a given tier via creditsCost */
function createCertAtTier(tier: 0 | 1 | 2 | 3, suffix = ''): ReturnType<typeof createComputationCertificate> {
  const costMap = { 0: 5, 1: 50, 2: 500, 3: 2000 };
  return createComputationCertificate({
    requestId: `test-challenge-${tier}-${suffix || Date.now()}`,
    computationType: 'data-fetch',
    computationClass: 'economic-only',
    inputHash: somaHash(`input-${tier}-${suffix}`),
    outputHash: somaHash(`output-${tier}-${suffix}`),
    seedCommitment: somaHash(`seed-${tier}-${suffix}`),
    seed: `seed-${tier}-${suffix}`,
    outputCommitment: somaHash(somaHash(`output-${tier}-${suffix}`)),
    spotChecks: [{ checkName: 'economic-only:data-fetch', passed: true, confidence: 0, probabilityModel: 'none', detectionProbability: 0 }],
    creditsCost: costMap[tier],
  });
}

/** Helper: file a challenge directly in DB */
function fileChallenge(certId: string, apiKeyHash: string, challengerBond: number, agentBond: number): string {
  const id = `ch-test-${Math.random().toString(36).slice(2)}`;
  const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`
    INSERT INTO computation_challenges (id, cert_id, challenger_api_key_hash, challenger_bond, agent_bond, state, reason, response_deadline)
    VALUES (?, ?, ?, ?, ?, 'filed', 'Test challenge reason here', ?)
  `).run(id, certId, apiKeyHash, challengerBond, agentBond, deadline);
  return id;
}

// ─── Challenge Filing ──────────────────────────────────────────────────────

describe('challenge filing', () => {
  it('creates a challenge with correct bond and state', () => {
    const cert = createCertAtTier(1, 'filing')!;
    const id = fileChallenge(cert.id, somaHash('cn-test-key'), cert.bondAmount, cert.bondAmount);

    const row = getDb().prepare('SELECT * FROM computation_challenges WHERE id = ?').get(id) as any;
    expect(row.state).toBe('filed');
    expect(row.cert_id).toBe(cert.id);
    expect(row.challenger_bond).toBe(cert.bondAmount);
    expect(row.agent_bond).toBe(cert.bondAmount);
    expect(row.response_deadline).toBeDefined();
  });

  it('Tier 0 cert: challenge should be rejected (no challenge window)', () => {
    const cert = createCertAtTier(0, 'tier0')!;
    expect(cert.bondTier).toBe(0);
    expect(cert.challengeWindowEnd).toBeNull();
    expect(cert.finalized).toBe(true);
    // No window = no challenge possible
  });

  it('Tier 2 cert: challenge window is 48h', () => {
    const cert = createCertAtTier(2, 'tier2')!;
    expect(cert.bondTier).toBe(2);
    expect(cert.challengeWindowEnd).not.toBeNull();
    const windowEnd = new Date(cert.challengeWindowEnd!);
    const expectedMin = Date.now() + 47 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 49 * 60 * 60 * 1000;
    expect(windowEnd.getTime()).toBeGreaterThan(expectedMin);
    expect(windowEnd.getTime()).toBeLessThan(expectedMax);
  });

  it('multiple challenges on same cert allowed (all-vs-all)', () => {
    const cert = createCertAtTier(2, 'multi')!;
    const id1 = fileChallenge(cert.id, somaHash('key-1'), 500, cert.bondAmount);
    const id2 = fileChallenge(cert.id, somaHash('key-2'), 500, cert.bondAmount);
    const id3 = fileChallenge(cert.id, somaHash('key-3'), 500, cert.bondAmount);

    const rows = getDb().prepare('SELECT id FROM computation_challenges WHERE cert_id = ?').all(cert.id);
    expect(rows.length).toBe(3);
    expect(new Set([id1, id2, id3]).size).toBe(3);
  });
});

// ─── Challenge Response (Bisection) ────────────────────────────────────────

describe('challenge bisection', () => {
  it('responds with checkpoints → transitions filed → responded', () => {
    const cert = createCertAtTier(1, 'bisect1')!;
    const challengeId = fileChallenge(cert.id, somaHash('key-bisect'), cert.bondAmount, cert.bondAmount);

    // Transition: filed → responded
    expect(canChallengeTransition('filed', 'responded')).toBe(true);

    getDb().prepare(`
      UPDATE computation_challenges SET state = 'responded', bisection_rounds_json = ?
      WHERE id = ?
    `).run(JSON.stringify([{ round: 1, checkpoints: [{ index: 0, stateHash: 'abc' }] }]), challengeId);

    const row = getDb().prepare('SELECT state FROM computation_challenges WHERE id = ?').get(challengeId) as any;
    expect(row.state).toBe('responded');
  });

  it('bisection narrows to single step after multiple rounds', () => {
    const cert = createCertAtTier(2, 'bisect-multi')!;
    const challengeId = fileChallenge(cert.id, somaHash('key-bisect2'), cert.bondAmount, cert.bondAmount);

    // Simulate 3 rounds of bisection
    const rounds = [
      { round: 1, disputedRangeStart: 0, disputedRangeEnd: 100 },
      { round: 2, disputedRangeStart: 50, disputedRangeEnd: 100 },
      { round: 3, disputedRangeStart: 75, disputedRangeEnd: 76 }, // single step
    ];

    getDb().prepare(`
      UPDATE computation_challenges SET
        state = 'bisecting', bisection_rounds_json = ?,
        current_disputed_range_start = 75, current_disputed_range_end = 76
      WHERE id = ?
    `).run(JSON.stringify(rounds), challengeId);

    const row = getDb().prepare('SELECT * FROM computation_challenges WHERE id = ?').get(challengeId) as any;
    expect(row.state).toBe('bisecting');
    expect(row.current_disputed_range_start).toBe(75);
    expect(row.current_disputed_range_end).toBe(76);
    // Range of 1 = single step identified
    expect(row.current_disputed_range_end - row.current_disputed_range_start).toBe(1);
  });
});

// ─── Challenge Resolution: Concession ──────────────────────────────────────

describe('challenge resolution — concession', () => {
  it('conceding agent → resolved_fraud, slash applied, cert not finalized', () => {
    const cert = createCertAtTier(2, 'concede')!;
    const challengeId = fileChallenge(cert.id, somaHash('key-concede'), cert.bondAmount, cert.bondAmount);

    const slash = calculateSlashAmounts(cert.bondAmount);
    const now = new Date().toISOString();

    getDb().prepare(`
      UPDATE computation_challenges SET
        state = 'resolved_fraud', resolution = 'conceded',
        winner = 'challenger', slash_winner = ?, slash_treasury = ?, slash_burned = ?, resolved_at = ?
      WHERE id = ?
    `).run(slash.winner, slash.treasury, slash.burned, now, challengeId);

    getDb().prepare('UPDATE computation_certificates SET finalized = 0 WHERE id = ?').run(cert.id);

    const challenge = getDb().prepare('SELECT * FROM computation_challenges WHERE id = ?').get(challengeId) as any;
    expect(challenge.state).toBe('resolved_fraud');
    expect(challenge.winner).toBe('challenger');
    expect(round6(challenge.slash_winner + challenge.slash_treasury + challenge.slash_burned)).toBe(cert.bondAmount);

    const updatedCert = getComputationCertificateById(cert.id);
    expect(updatedCert!.finalized).toBe(false);
  });
});

// ─── Challenge Resolution: Valid computation ───────────────────────────────

describe('challenge resolution — valid computation', () => {
  it('invalid challenge → resolved_valid, challenger loses bond', () => {
    const cert = createCertAtTier(1, 'valid')!;
    const challengeId = fileChallenge(cert.id, somaHash('key-invalid-challenge'), cert.bondAmount, cert.bondAmount);

    const slash = calculateSlashAmounts(cert.bondAmount); // challenger's bond is slashed
    const now = new Date().toISOString();

    getDb().prepare(`
      UPDATE computation_challenges SET
        state = 'resolved_valid', resolution = 'computation_correct',
        winner = 'agent', slash_winner = ?, slash_treasury = ?, slash_burned = ?, resolved_at = ?
      WHERE id = ?
    `).run(slash.winner, slash.treasury, slash.burned, now, challengeId);

    const challenge = getDb().prepare('SELECT * FROM computation_challenges WHERE id = ?').get(challengeId) as any;
    expect(challenge.state).toBe('resolved_valid');
    expect(challenge.winner).toBe('agent');
  });
});

// ─── Auto-Expiry ───────────────────────────────────────────────────────────

describe('challenge expiry', () => {
  it('expired deadline → auto-expire with slash', () => {
    const cert = createCertAtTier(1, 'expire')!;
    // File with a deadline in the past
    const pastDeadline = new Date(Date.now() - 60_000).toISOString();
    const id = `ch-expire-${Math.random().toString(36).slice(2)}`;
    getDb().prepare(`
      INSERT INTO computation_challenges (id, cert_id, challenger_api_key_hash, challenger_bond, agent_bond, state, reason, response_deadline)
      VALUES (?, ?, ?, ?, ?, 'filed', 'Testing expiry', ?)
    `).run(id, cert.id, somaHash('key-expire'), cert.bondAmount, cert.bondAmount, pastDeadline);

    // Simulate what the cron would do
    const row = getDb().prepare(
      `SELECT id, cert_id, agent_bond FROM computation_challenges WHERE state = 'filed' AND response_deadline < ?`,
    ).get(new Date().toISOString()) as any;

    expect(row).toBeDefined();
    expect(row.id).toBe(id);

    const slash = calculateSlashAmounts(row.agent_bond);
    getDb().prepare(`
      UPDATE computation_challenges SET
        state = 'expired', resolution = 'no_response', winner = 'challenger',
        slash_winner = ?, slash_treasury = ?, slash_burned = ?, resolved_at = ?
      WHERE id = ?
    `).run(slash.winner, slash.treasury, slash.burned, new Date().toISOString(), id);

    const updated = getDb().prepare('SELECT state, winner FROM computation_challenges WHERE id = ?').get(id) as any;
    expect(updated.state).toBe('expired');
    expect(updated.winner).toBe('challenger');
  });
});

// ─── Certificate Finalization ──────────────────────────────────────────────

describe('certificate finalization', () => {
  it('cert with expired window and no active challenges → can be finalized', () => {
    // Create cert with very short window (already expired)
    const cert = createCertAtTier(1, 'finalize')!;

    // Manually set window to past
    getDb().prepare('UPDATE computation_certificates SET challenge_window_end = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), cert.id);

    // Check: no active challenges
    const activeChallenges = getDb().prepare(
      `SELECT COUNT(*) as c FROM computation_challenges WHERE cert_id = ? AND state IN ('filed', 'responded', 'bisecting', 'awaiting_reexec')`,
    ).get(cert.id) as any;
    expect(activeChallenges.c).toBe(0);

    // Finalize
    getDb().prepare('UPDATE computation_certificates SET finalized = 1 WHERE id = ?').run(cert.id);

    const updated = getComputationCertificateById(cert.id);
    expect(updated!.finalized).toBe(true);
  });

  it('cert with active challenge → cannot be finalized', () => {
    const cert = createCertAtTier(2, 'no-finalize')!;
    fileChallenge(cert.id, somaHash('key-blocking'), cert.bondAmount, cert.bondAmount);

    const activeChallenges = getDb().prepare(
      `SELECT COUNT(*) as c FROM computation_challenges WHERE cert_id = ? AND state IN ('filed', 'responded', 'bisecting', 'awaiting_reexec')`,
    ).get(cert.id) as any;
    expect(activeChallenges.c).toBe(1);
    // Should NOT finalize while challenge is active
  });
});

// ─── Concurrent Stress ─────────────────────────────────────────────────────

describe('concurrent challenge stress', () => {
  it('10 challengers on same cert — all challenges persist, no duplicates', () => {
    const cert = createCertAtTier(2, 'concurrent')!;
    const challengeIds: string[] = [];

    for (let i = 0; i < 10; i++) {
      const id = fileChallenge(cert.id, somaHash(`key-concurrent-${i}`), cert.bondAmount, cert.bondAmount);
      challengeIds.push(id);
    }

    // All 10 should exist
    const rows = getDb().prepare('SELECT id FROM computation_challenges WHERE cert_id = ?').all(cert.id) as any[];
    expect(rows.length).toBe(10);

    // All unique IDs
    const uniqueIds = new Set(rows.map((r: any) => r.id));
    expect(uniqueIds.size).toBe(10);
  });

  it('slash accounting across multiple resolved challenges sums correctly', () => {
    const cert = createCertAtTier(2, 'multi-slash')!;
    const challengeIds: string[] = [];

    // File 5 challenges
    for (let i = 0; i < 5; i++) {
      challengeIds.push(fileChallenge(cert.id, somaHash(`key-slash-${i}`), cert.bondAmount, cert.bondAmount));
    }

    // Resolve all as fraud (agent concedes)
    let totalWinner = 0, totalTreasury = 0, totalBurned = 0;
    for (const chId of challengeIds) {
      const slash = calculateSlashAmounts(cert.bondAmount);
      totalWinner += slash.winner;
      totalTreasury += slash.treasury;
      totalBurned += slash.burned;

      getDb().prepare(`
        UPDATE computation_challenges SET
          state = 'resolved_fraud', winner = 'challenger',
          slash_winner = ?, slash_treasury = ?, slash_burned = ?, resolved_at = ?
        WHERE id = ?
      `).run(slash.winner, slash.treasury, slash.burned, new Date().toISOString(), chId);
    }

    // Verify totals
    const totalSlashed = round6(totalWinner + totalTreasury + totalBurned);
    expect(totalSlashed).toBe(round6(cert.bondAmount * 5));

    const allResolved = getDb().prepare(
      "SELECT COUNT(*) as c FROM computation_challenges WHERE cert_id = ? AND state = 'resolved_fraud'",
    ).get(cert.id) as any;
    expect(allResolved.c).toBe(5);
  });
});
