/**
 * bond-economics.ts — Bond Tier Calculation + Challenge Economics
 *
 * Implements the tiered bond system from heartbeat-fraud-proofs.md Section 5.
 * Bond sizing is proportional to value at risk, not just API call price.
 *
 * Tier 0: < 10 credits   → No bond, spot-checks only
 * Tier 1: 10-100 credits  → 5x call cost, 24h window
 * Tier 2: 100-1000 credits → 10x call cost, 48h window
 * Tier 3: > 1000 credits  → max(20x call cost, 10% value), 72h window + real-money
 */

import { round6 } from './credits';

// ─── Types ──────────────────────────────────────────────────────────────────

export type BondTier = 0 | 1 | 2 | 3;

export interface BondRequirement {
  tier: BondTier;
  bondAmount: number;
  bondCurrency: 'credits' | 'SOL' | 'USDC';
  challengeWindowHours: number;
  requiresRealMoney: boolean;
}

export interface ChallengeEconomics {
  challengerBond: number;
  correctChallengeReward: number;
  platformFeePercent: number;
  slashDistribution: {
    winnerPercent: number;
    treasuryPercent: number;
    burnPercent: number;
  };
}

export type ChallengeState =
  | 'filed'          // Challenger filed, bond locked
  | 'responded'      // Agent responded with checkpoint proof
  | 'bisecting'      // Bisection rounds in progress
  | 'awaiting_reexec' // Narrowed to single step, awaiting re-execution
  | 'resolved_valid'  // Computation was correct, challenger loses bond
  | 'resolved_fraud'  // Computation was fraudulent, agent loses bond
  | 'expired';        // No response within deadline, auto-resolve

// ─── Bond Tier Calculation ─────────────────────────────────────────────────

/**
 * Determine the bond tier and requirements based on credit cost.
 * Throws on NaN/Infinity — caller must validate inputs.
 */
export function calculateBondRequirement(creditsCost: number): BondRequirement {
  if (!Number.isFinite(creditsCost)) {
    throw new Error(`calculateBondRequirement: non-finite creditsCost "${creditsCost}"`);
  }
  if (creditsCost < 10) {
    return {
      tier: 0,
      bondAmount: 0,
      bondCurrency: 'credits',
      challengeWindowHours: 0,
      requiresRealMoney: false,
    };
  }

  if (creditsCost < 100) {
    return {
      tier: 1,
      bondAmount: round6(creditsCost * 5),
      bondCurrency: 'credits',
      challengeWindowHours: 24,
      requiresRealMoney: false,
    };
  }

  if (creditsCost < 1000) {
    return {
      tier: 2,
      bondAmount: round6(creditsCost * 10),
      bondCurrency: 'credits',
      challengeWindowHours: 48,
      requiresRealMoney: false,
    };
  }

  // Tier 3: max(20x call cost, 10% of value) — real-money component
  const bondAmount = round6(Math.max(creditsCost * 20, creditsCost * 0.1));
  return {
    tier: 3,
    bondAmount,
    bondCurrency: 'USDC',  // Real money required
    challengeWindowHours: 72,
    requiresRealMoney: true,
  };
}

/**
 * Calculate the challenge window end time from now.
 */
export function challengeWindowEnd(windowHours: number): string {
  const end = new Date(Date.now() + windowHours * 60 * 60 * 1000);
  return end.toISOString();
}

/**
 * Check if a challenge window is still open.
 */
export function isChallengeWindowOpen(windowEndIso: string): boolean {
  return new Date(windowEndIso).getTime() > Date.now();
}

// ─── Challenge Economics ───────────────────────────────────────────────────

/**
 * Calculate challenge economics for a given computation's credit cost.
 */
export function calculateChallengeEconomics(creditsCost: number): ChallengeEconomics {
  return {
    challengerBond: round6(creditsCost * 1),    // 1x call cost
    correctChallengeReward: round6(creditsCost * 3), // 3x challenger bond
    platformFeePercent: 5,
    slashDistribution: {
      winnerPercent: 60,
      treasuryPercent: 35,
      burnPercent: 5,
    },
  };
}

/**
 * Calculate slash amounts when a dispute is resolved.
 * Returns the amounts distributed to winner, treasury, and burned.
 * Throws on NaN/Infinity — caller must validate inputs.
 */
export function calculateSlashAmounts(loserBond: number): {
  winner: number;
  treasury: number;
  burned: number;
} {
  if (!Number.isFinite(loserBond)) {
    throw new Error(`calculateSlashAmounts: non-finite loserBond "${loserBond}"`);
  }
  return {
    winner: round6(loserBond * 0.60),
    treasury: round6(loserBond * 0.35),
    burned: round6(loserBond * 0.05),
  };
}

// ─── State Machine ─────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<ChallengeState, ChallengeState[]> = {
  filed:             ['responded', 'expired', 'resolved_valid', 'resolved_fraud'],
  responded:         ['bisecting', 'resolved_valid', 'resolved_fraud'],
  bisecting:         ['awaiting_reexec', 'resolved_valid', 'resolved_fraud'],
  awaiting_reexec:   ['resolved_valid', 'resolved_fraud'],
  resolved_valid:    [],
  resolved_fraud:    [],
  expired:           [],
};

/**
 * Check if a challenge state transition is allowed.
 */
export function canChallengeTransition(from: ChallengeState, to: ChallengeState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
