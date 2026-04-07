/**
 * Bond economics tests — Heartbeat Fraud Proofs Phase B
 *
 * Verifies:
 *   - Bond tier calculation: boundaries, amounts, currencies
 *   - Challenge economics: bonds, rewards, slash distribution
 *   - Slash math invariant: winner + treasury + burned = loserBond
 *   - State machine: all valid + invalid transitions
 *   - Challenge window time calculations
 *   - Computation certificate bond integration
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setupTestDb } from './helpers/db';
setupTestDb();

import { initDb } from '../../src/db/connection';

import {
  calculateBondRequirement,
  calculateChallengeEconomics,
  calculateSlashAmounts,
  canChallengeTransition,
  challengeWindowEnd,
  isChallengeWindowOpen,
  type BondTier,
  type ChallengeState,
} from '../../src/core/bond-economics';

import { round6 } from '../../src/core/credits';

import {
  createComputationCertificate,
  verifyComputationCertificate,
  getComputationCertificateById,
} from '../../src/core/computation-certificate';

import { registerBuiltinTypes } from '../../src/core/computation-types';

import { somaHash } from '../../src/utils/crypto-agility';

beforeEach(() => {
  initDb();
  registerBuiltinTypes();
});

// ─── Bond Tier Calculation ─────────────────────────────────────────────────

describe('calculateBondRequirement', () => {
  it('Tier 0: < 10 credits → no bond, no window', () => {
    for (const cost of [0, 0.5, 1, 5, 9.99]) {
      const req = calculateBondRequirement(cost);
      expect(req.tier).toBe(0);
      expect(req.bondAmount).toBe(0);
      expect(req.bondCurrency).toBe('credits');
      expect(req.challengeWindowHours).toBe(0);
      expect(req.requiresRealMoney).toBe(false);
    }
  });

  it('Tier 1: 10-99 credits → 5x bond, 24h window', () => {
    const req = calculateBondRequirement(10);
    expect(req.tier).toBe(1);
    expect(req.bondAmount).toBe(50);
    expect(req.challengeWindowHours).toBe(24);
    expect(req.requiresRealMoney).toBe(false);

    const req50 = calculateBondRequirement(50);
    expect(req50.tier).toBe(1);
    expect(req50.bondAmount).toBe(250);
  });

  it('Tier 2: 100-999 credits → 10x bond, 48h window', () => {
    const req = calculateBondRequirement(100);
    expect(req.tier).toBe(2);
    expect(req.bondAmount).toBe(1000);
    expect(req.challengeWindowHours).toBe(48);
    expect(req.requiresRealMoney).toBe(false);

    const req500 = calculateBondRequirement(500);
    expect(req500.tier).toBe(2);
    expect(req500.bondAmount).toBe(5000);
  });

  it('Tier 3: >= 1000 credits → 20x bond, 72h, real money', () => {
    const req = calculateBondRequirement(1000);
    expect(req.tier).toBe(3);
    expect(req.bondAmount).toBe(20000); // max(20x, 10%) = 20x = 20000
    expect(req.bondCurrency).toBe('USDC');
    expect(req.challengeWindowHours).toBe(72);
    expect(req.requiresRealMoney).toBe(true);
  });

  it('boundary precision: exactly at tier boundaries', () => {
    expect(calculateBondRequirement(9.999999).tier).toBe(0);
    expect(calculateBondRequirement(10).tier).toBe(1);
    expect(calculateBondRequirement(99.999999).tier).toBe(1);
    expect(calculateBondRequirement(100).tier).toBe(2);
    expect(calculateBondRequirement(999.999999).tier).toBe(2);
    expect(calculateBondRequirement(1000).tier).toBe(3);
  });

  it('negative and zero credit costs → Tier 0', () => {
    expect(calculateBondRequirement(0).tier).toBe(0);
    expect(calculateBondRequirement(-5).tier).toBe(0);
  });
});

// ─── Challenge Economics ───────────────────────────────────────────────────

describe('calculateChallengeEconomics', () => {
  it('challenger bond = 1x call cost', () => {
    const econ = calculateChallengeEconomics(50);
    expect(econ.challengerBond).toBe(50);
  });

  it('correct challenge reward = 3x call cost', () => {
    const econ = calculateChallengeEconomics(50);
    expect(econ.correctChallengeReward).toBe(150);
  });

  it('platform fee is 5%', () => {
    expect(calculateChallengeEconomics(100).platformFeePercent).toBe(5);
  });

  it('slash distribution is 60/35/5', () => {
    const econ = calculateChallengeEconomics(100);
    expect(econ.slashDistribution.winnerPercent).toBe(60);
    expect(econ.slashDistribution.treasuryPercent).toBe(35);
    expect(econ.slashDistribution.burnPercent).toBe(5);
  });
});

// ─── Slash Math Invariant ──────────────────────────────────────────────────

describe('calculateSlashAmounts', () => {
  it('winner + treasury + burned = loserBond (100 credits)', () => {
    const slash = calculateSlashAmounts(100);
    const total = round6(slash.winner + slash.treasury + slash.burned);
    expect(total).toBe(100);
    expect(slash.winner).toBe(60);
    expect(slash.treasury).toBe(35);
    expect(slash.burned).toBe(5);
  });

  it('invariant holds for fractional bonds', () => {
    for (const bond of [0.001, 1.5, 42.37, 999.99, 50000]) {
      const slash = calculateSlashAmounts(bond);
      const total = round6(slash.winner + slash.treasury + slash.burned);
      expect(total).toBe(bond);
    }
  });

  it('zero bond → zero slash', () => {
    const slash = calculateSlashAmounts(0);
    expect(slash.winner).toBe(0);
    expect(slash.treasury).toBe(0);
    expect(slash.burned).toBe(0);
  });
});

// ─── State Machine ─────────────────────────────────────────────────────────

describe('canChallengeTransition', () => {
  const VALID_TRANSITIONS: [ChallengeState, ChallengeState][] = [
    ['filed', 'responded'],
    ['filed', 'expired'],
    ['filed', 'resolved_valid'],
    ['filed', 'resolved_fraud'],
    ['responded', 'bisecting'],
    ['responded', 'resolved_valid'],
    ['responded', 'resolved_fraud'],
    ['bisecting', 'awaiting_reexec'],
    ['bisecting', 'resolved_valid'],
    ['bisecting', 'resolved_fraud'],
    ['awaiting_reexec', 'resolved_valid'],
    ['awaiting_reexec', 'resolved_fraud'],
  ];

  const TERMINAL_STATES: ChallengeState[] = ['resolved_valid', 'resolved_fraud', 'expired'];

  it('all valid transitions are allowed', () => {
    for (const [from, to] of VALID_TRANSITIONS) {
      expect(canChallengeTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it('terminal states have no outgoing transitions', () => {
    const ALL_STATES: ChallengeState[] = [
      'filed', 'responded', 'bisecting', 'awaiting_reexec',
      'resolved_valid', 'resolved_fraud', 'expired',
    ];
    for (const terminal of TERMINAL_STATES) {
      for (const target of ALL_STATES) {
        expect(canChallengeTransition(terminal, target), `${terminal} → ${target}`).toBe(false);
      }
    }
  });

  it('cannot skip states (filed → bisecting)', () => {
    expect(canChallengeTransition('filed', 'bisecting')).toBe(false);
    expect(canChallengeTransition('filed', 'awaiting_reexec')).toBe(false);
    expect(canChallengeTransition('responded', 'expired')).toBe(false);
  });
});

// ─── Challenge Window ──────────────────────────────────────────────────────

describe('challenge window', () => {
  it('challengeWindowEnd returns future ISO date', () => {
    const end = challengeWindowEnd(24);
    const endDate = new Date(end);
    expect(endDate.getTime()).toBeGreaterThan(Date.now());
    expect(endDate.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 1000);
  });

  it('isChallengeWindowOpen returns true for future date', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isChallengeWindowOpen(future)).toBe(true);
  });

  it('isChallengeWindowOpen returns false for past date', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isChallengeWindowOpen(past)).toBe(false);
  });

  it('zero-hour window returns past date (Tier 0)', () => {
    const end = challengeWindowEnd(0);
    // 0 hours from now = now, which is past by the time we check
    expect(new Date(end).getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });
});

// ─── Computation Certificate Bond Integration ──────────────────────────────

describe('computation certificate bond tiers', () => {
  it('Tier 0 cert is instantly finalized', () => {
    const cert = createComputationCertificate({
      requestId: 'test-tier0',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [{ checkName: 'economic-only:data-fetch', passed: true, confidence: 0, probabilityModel: 'none', detectionProbability: 0 }],
      creditsCost: 5, // Tier 0
    });

    expect(cert).not.toBeNull();
    expect(cert!.bondTier).toBe(0);
    expect(cert!.bondAmount).toBe(0);
    expect(cert!.finalized).toBe(true);
    expect(cert!.challengeWindowEnd).toBeNull();
  });

  it('Tier 1 cert has 24h challenge window, not finalized', () => {
    const cert = createComputationCertificate({
      requestId: 'test-tier1',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [{ checkName: 'economic-only:data-fetch', passed: true, confidence: 0, probabilityModel: 'none', detectionProbability: 0 }],
      creditsCost: 50, // Tier 1
    });

    expect(cert!.bondTier).toBe(1);
    expect(cert!.bondAmount).toBe(250); // 5x
    expect(cert!.finalized).toBe(false);
    expect(cert!.challengeWindowEnd).not.toBeNull();
    expect(isChallengeWindowOpen(cert!.challengeWindowEnd!)).toBe(true);
  });

  it('Tier 3 cert requires real money (USDC)', () => {
    const cert = createComputationCertificate({
      requestId: 'test-tier3',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input'),
      outputHash: somaHash('output'),
      seedCommitment: somaHash('seed'),
      seed: 'seed',
      outputCommitment: somaHash(somaHash('output')),
      spotChecks: [{ checkName: 'economic-only:data-fetch', passed: true, confidence: 0, probabilityModel: 'none', detectionProbability: 0 }],
      creditsCost: 2000, // Tier 3
    });

    expect(cert!.bondTier).toBe(3);
    expect(cert!.bondCurrency).toBe('USDC');
    expect(cert!.bondAmount).toBe(40000); // 20x
    expect(cert!.finalized).toBe(false);
  });

  it('cert persists and retrieves with bond fields', () => {
    const cert = createComputationCertificate({
      requestId: 'test-persist-bond',
      computationType: 'data-fetch',
      computationClass: 'economic-only',
      inputHash: somaHash('input2'),
      outputHash: somaHash('output2'),
      seedCommitment: somaHash('seed2'),
      seed: 'seed2',
      outputCommitment: somaHash(somaHash('output2')),
      spotChecks: [{ checkName: 'economic-only:data-fetch', passed: true, confidence: 0, probabilityModel: 'none', detectionProbability: 0 }],
      creditsCost: 150, // Tier 2
    });

    const loaded = getComputationCertificateById(cert!.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.bondTier).toBe(2);
    expect(loaded!.bondAmount).toBe(1500); // 10x
    expect(loaded!.bondCurrency).toBe('credits');
    expect(loaded!.finalized).toBe(false);
    expect(loaded!.challengeWindowEnd).not.toBeNull();
  });
});
