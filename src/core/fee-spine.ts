/**
 * fee-spine.ts — Unified Transparent Fee System
 *
 * Every credit that flows through ClawNet passes through ONE function
 * that produces a transparent breakdown. The breakdown becomes a pulse
 * tree ECONOMIC leaf — auditable, on-chain, verifiable.
 *
 * One function. One formula. Every fee proven. Even zero fees.
 *
 * Three principles:
 *   1. Infrastructure rate: 5% base, trust-scaled down to 2%
 *   2. Products priced transparently (fixed, published)
 *   3. Zero hidden fees (transfers, routing, basic trust = free)
 *
 * The fee formula is public: GET /v1/fees/formula
 * The proof is on-chain: every breakdown is a pulse tree leaf
 */

import { round6 } from './credits';
import { somaHashJson } from '../utils/crypto-agility';
import { appendEconomic } from './soma-heartbeat';
import { logger } from '../utils/logger';

// ─── Fee Formula Version ────────────────────────────────────────────────────

export const FEE_FORMULA_VERSION = 'v1';

// ─── Infrastructure Rate ────────────────────────────────────────────────────

/** Base infrastructure rate — what ClawNet charges for hosting, billing,
 *  trust oracle, Soma provenance, marketplace, and escrow management. */
export const BASE_INFRASTRUCTURE_RATE = 0.05; // 5%

/**
 * Trust multiplier table — higher trust = lower infrastructure fee.
 * Sovereign agents (90+) pay 2% instead of 5%.
 */
const TRUST_MULTIPLIERS: Array<{ minTrust: number; multiplier: number }> = [
  { minTrust: 90, multiplier: 0.40 },  // 2.0% effective
  { minTrust: 80, multiplier: 0.45 },  // 2.25% effective
  { minTrust: 60, multiplier: 0.55 },  // 2.75% effective
  { minTrust: 40, multiplier: 0.70 },  // 3.5% effective
  { minTrust: 20, multiplier: 0.85 },  // 4.25% effective
  { minTrust: 0,  multiplier: 1.00 },  // 5.0% effective
];

/** Resolve trust multiplier for a given trust score. */
export function getTrustMultiplier(trustScore: number): number {
  for (const tier of TRUST_MULTIPLIERS) {
    if (trustScore >= tier.minTrust) return tier.multiplier;
  }
  return 1.0;
}

// ─── Fee Breakdown Types ────────────────────────────────────────────────────

export type FeeType =
  | 'endpoint_call'      // Live API call to provider
  | 'cache_hit'          // ClawNet served cached data
  | 'soma_check_hit'     // Agent's hash matched (304, no data transfer)
  | 'skill_invoke'       // Marketplace skill invocation
  | 'transfer'           // Agent-to-agent credit transfer
  | 'trust_query'        // Trust oracle query (our product)
  | 'proof_generation'   // Groth16 proof (our compute)
  | 'orchestration'      // LLM routing (free)
  | 'custody_event'      // Data custody (free)
  | 'deposit'            // Credit purchase
  | 'payout';            // Credit withdrawal

export interface FeeBreakdown {
  version: string;           // FEE_FORMULA_VERSION
  type: FeeType;
  amount: number;            // total credits charged to agent
  providerShare: number;     // credits to provider/creator
  platformFee: number;       // credits to ClawNet
  platformRate: number;      // effective rate applied (0.0 - 0.05)
  trustScore: number;        // agent's trust at time of transaction
  trustMultiplier: number;   // multiplier applied
  formula: 'infrastructure' | 'product_fixed' | 'zero_fee';
  hash: string;              // H(breakdown) for proof
}

// ─── Core Fee Computation ───────────────────────────────────────────────────

/**
 * Compute fee breakdown for an infrastructure-rate transaction.
 * Used when someone ELSE provides value through ClawNet:
 * endpoint calls, cache hits, soma check hits, skill invocations.
 *
 * Platform takes: amount × BASE_RATE × trustMultiplier
 * Provider gets: amount - platformFee
 */
export function computeInfrastructureFee(
  type: FeeType,
  amount: number,
  trustScore: number,
): FeeBreakdown {
  const multiplier = getTrustMultiplier(trustScore);
  const effectiveRate = round6(BASE_INFRASTRUCTURE_RATE * multiplier);
  const platformFee = round6(Math.max(0, amount * effectiveRate));
  const providerShare = round6(amount - platformFee);

  const breakdown: FeeBreakdown = {
    version: FEE_FORMULA_VERSION,
    type,
    amount: round6(amount),
    providerShare,
    platformFee,
    platformRate: effectiveRate,
    trustScore,
    trustMultiplier: multiplier,
    formula: 'infrastructure',
    hash: '', // filled below
  };
  breakdown.hash = somaHashJson(breakdown);
  return breakdown;
}

/**
 * Compute fee breakdown for a zero-fee transaction.
 * Used for: transfers, orchestration routing, custody events, deposits.
 * Platform takes NOTHING. This breakdown PROVES it.
 */
export function computeZeroFee(
  type: FeeType,
  amount: number,
  trustScore: number,
): FeeBreakdown {
  const breakdown: FeeBreakdown = {
    version: FEE_FORMULA_VERSION,
    type,
    amount: round6(amount),
    providerShare: round6(amount),
    platformFee: 0,
    platformRate: 0,
    trustScore,
    trustMultiplier: 0,
    formula: 'zero_fee',
    hash: '',
  };
  breakdown.hash = somaHashJson(breakdown);
  return breakdown;
}

/**
 * Compute fee breakdown for a ClawNet product (trust query, proof gen).
 * Fixed pricing — 100% to platform (it's our product, not a fee on others).
 */
export function computeProductFee(
  type: FeeType,
  amount: number,
  trustScore: number,
): FeeBreakdown {
  const breakdown: FeeBreakdown = {
    version: FEE_FORMULA_VERSION,
    type,
    amount: round6(amount),
    providerShare: 0,
    platformFee: round6(amount),
    platformRate: 1.0,
    trustScore,
    trustMultiplier: 1.0,
    formula: 'product_fixed',
    hash: '',
  };
  breakdown.hash = somaHashJson(breakdown);
  return breakdown;
}

// ─── Record Fee Breakdown to Pulse Tree ─────────────────────────────────────

/**
 * Record a fee breakdown as an ECONOMIC leaf in the agent's pulse tree.
 * This is the proof — the breakdown is hashed, appended, and eventually
 * compressed into a monthly Groth16 proof anchored on-chain.
 *
 * Called after every economic event. Even zero-fee events get recorded
 * to prove ClawNet took nothing.
 */
export function recordFeeBreakdown(agentDid: string, breakdown: FeeBreakdown): void {
  try {
    appendEconomic(agentDid, {
      action: `fee:${breakdown.type}`,
      amount: breakdown.amount,
      ref: breakdown.hash,
    });
  } catch (err) {
    // Non-fatal — fee recording should never block the transaction
    logger.warn({ err, agentDid, type: breakdown.type }, 'Failed to record fee breakdown (non-fatal)');
  }
}

// ─── Convenience: Compute + Record ──────────────────────────────────────────

/**
 * Compute an infrastructure fee breakdown AND record it to the pulse tree.
 * One call for the common case: endpoint/cache/skill events.
 */
export function chargeInfrastructureFee(
  agentDid: string,
  type: FeeType,
  amount: number,
  trustScore: number,
): FeeBreakdown {
  const breakdown = computeInfrastructureFee(type, amount, trustScore);
  recordFeeBreakdown(agentDid, breakdown);
  return breakdown;
}

/**
 * Record a zero-fee event to the pulse tree.
 * Proves ClawNet took nothing on this transaction.
 */
export function recordZeroFeeEvent(
  agentDid: string,
  type: FeeType,
  amount: number,
  trustScore: number,
): FeeBreakdown {
  const breakdown = computeZeroFee(type, amount, trustScore);
  recordFeeBreakdown(agentDid, breakdown);
  return breakdown;
}

/**
 * Compute a product fee breakdown AND record it to the pulse tree.
 * Used for trust queries and proof generation.
 */
export function chargeProductFee(
  agentDid: string,
  type: FeeType,
  amount: number,
  trustScore: number,
): FeeBreakdown {
  const breakdown = computeProductFee(type, amount, trustScore);
  recordFeeBreakdown(agentDid, breakdown);
  return breakdown;
}

// ─── Public Fee Schedule ────────────────────────────────────────────────────

/** The complete public fee schedule — served at GET /v1/fees/formula */
export function getPublicFeeSchedule() {
  return {
    version: FEE_FORMULA_VERSION,
    effectiveDate: '2026-04-09',
    infrastructure: {
      baseRate: BASE_INFRASTRUCTURE_RATE,
      trustMultipliers: TRUST_MULTIPLIERS.map(t => ({
        minTrust: t.minTrust,
        multiplier: t.multiplier,
        effectiveRate: round6(BASE_INFRASTRUCTURE_RATE * t.multiplier),
      })),
      appliesTo: ['endpoint_call', 'cache_hit', 'soma_check_hit', 'skill_invoke'],
      description: 'Platform infrastructure: hosting, billing, trust oracle, Soma provenance, marketplace',
    },
    products: {
      orchestration: { price: 0, note: 'Free — discovery is infrastructure' },
      trustQueryBasic: { price: 0, note: 'Free — ecosystem safety baseline' },
      trustQueryDimensional: { price: 0.03, unit: 'credits' },
      trustQueryFull: { price: 0.05, unit: 'credits' },
      groth16Proof: { price: 25, unit: 'credits', note: 'First proof per month free' },
      custodyEvent: { price: 0, note: 'Free — Soma protocol primitive' },
    },
    zeroFees: [
      { type: 'transfer', note: 'Agent-to-agent transfers are free' },
      { type: 'orchestration', note: 'LLM routing is free' },
      { type: 'custody_event', note: 'Data custody is free' },
      { type: 'deposit', note: 'Credit purchases are free' },
    ],
    payoutPolicy: {
      method: 'Face value minus actual transaction costs',
      platformMargin: 0,
      note: 'Zero platform spread on payouts — only real tx costs deducted',
    },
    proofGuarantee: 'Every fee breakdown is an ECONOMIC leaf in the agent pulse tree, ' +
      'compressed into monthly Groth16 proofs on Base. Verify any transaction on-chain.',
  };
}
