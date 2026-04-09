/**
 * fee-spine.ts — ClawNet Fee Formula (Trust-First Model)
 *
 * ClawNet's implementation of the Soma Economic Protocol.
 *
 * Routing is the funnel. Trust is the product.
 *   - Agent pays raw provider cost (no markup, no infrastructure fee)
 *   - Provider gets 100% of their price
 *   - Platform revenue comes from trust products (queries, proofs)
 *   - Every economic event — even free routing — gets a proof leaf
 *
 * The fee spine is primarily a PROOF LAYER:
 *   - Records zero-fee breakdowns for routing (proves platform took nothing)
 *   - Records product fees for trust operations
 *   - All breakdowns are ECONOMIC leaves in the pulse tree
 *
 * Formula is public: GET /v1/fees/formula
 * Proof is on-chain: every breakdown verifiable via Soma Economic Protocol
 */

import { round6 } from './credits';
import {
  type SomaFeeBreakdown,
  SOMA_ECONOMICS_VERSION,
  hashFeeBreakdown,
  recordEconomicEvent,
} from './soma-economics';
import { logger } from '../utils/logger';

// Re-export Soma types for convenience
export type { SomaFeeBreakdown } from './soma-economics';

// ─── ClawNet Identity ──────────────────────────────────────────────────────

const CLAWNET_PLATFORM = 'clawnet';

/** ClawNet formula version — changes when rates or model change. */
export const FEE_FORMULA_VERSION = 'clawnet-additive-v1';

// ─── Infrastructure Rate ────────────────────────────────────────────────────

/** Infrastructure rate — set to 0: free routing is the funnel.
 *  Platform revenue comes from trust products, not routing tolls.
 *  Kept as a configurable value (not removed) for future flexibility. */
export const BASE_INFRASTRUCTURE_RATE = 0; // 0% — free routing

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

// ─── Fee Types (ClawNet-specific) ───────────────────────────────────────────

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

// ─── Core Fee Computation (Additive) ───────────────────────────────────────

/**
 * Compute fee for an infrastructure-rate transaction.
 *
 * ADDITIVE MODEL:
 *   Provider gets: providerPrice (100% of their declared price)
 *   Platform gets: providerPrice × baseRate × trustMultiplier
 *   Agent pays:    providerPrice + platformFee
 *
 * The provider ALWAYS covers their costs. The platform fee is a
 * transparent, separately-itemized charge. No hidden markup.
 *
 * @param type ClawNet event type
 * @param providerPrice Provider's price in credits (NOT the agent total)
 * @param trustScore Agent's trust score (0-100)
 */
export function computeInfrastructureFee(
  type: FeeType,
  providerPrice: number,
  trustScore: number,
): SomaFeeBreakdown {
  const multiplier = getTrustMultiplier(trustScore);
  const effectiveRate = round6(BASE_INFRASTRUCTURE_RATE * multiplier);
  const platformFee = round6(Math.max(0, providerPrice * effectiveRate));
  const amount = round6(providerPrice + platformFee);

  const partial: Omit<SomaFeeBreakdown, 'hash'> = {
    schemaVersion: SOMA_ECONOMICS_VERSION,
    platform: CLAWNET_PLATFORM,
    eventType: type,
    amount,
    recipientShare: round6(providerPrice),
    platformFee,
    formulaId: FEE_FORMULA_VERSION,
    formulaInputs: {
      providerPrice,
      trustScore,
      baseRate: BASE_INFRASTRUCTURE_RATE,
      multiplier,
      effectiveRate,
    },
  };
  return { ...partial, hash: hashFeeBreakdown(partial) };
}

/**
 * Compute a zero-fee breakdown.
 * Proves the platform took nothing on this transaction.
 * Used for: transfers, orchestration routing, custody events, deposits.
 */
export function computeZeroFee(
  type: FeeType,
  amount: number,
  trustScore: number,
): SomaFeeBreakdown {
  const partial: Omit<SomaFeeBreakdown, 'hash'> = {
    schemaVersion: SOMA_ECONOMICS_VERSION,
    platform: CLAWNET_PLATFORM,
    eventType: type,
    amount: round6(amount),
    recipientShare: round6(amount),
    platformFee: 0,
    formulaId: FEE_FORMULA_VERSION,
    formulaInputs: { amount, trustScore },
  };
  return { ...partial, hash: hashFeeBreakdown(partial) };
}

/**
 * Compute fee for a ClawNet product (trust query, proof generation).
 * Fixed pricing — 100% to platform (our product, not a fee on others).
 */
export function computeProductFee(
  type: FeeType,
  amount: number,
  trustScore: number,
): SomaFeeBreakdown {
  const partial: Omit<SomaFeeBreakdown, 'hash'> = {
    schemaVersion: SOMA_ECONOMICS_VERSION,
    platform: CLAWNET_PLATFORM,
    eventType: type,
    amount: round6(amount),
    recipientShare: 0,
    platformFee: round6(amount),
    formulaId: FEE_FORMULA_VERSION,
    formulaInputs: { amount, trustScore },
  };
  return { ...partial, hash: hashFeeBreakdown(partial) };
}

// ─── Convenience: Compute + Record ──────────────────────────────────────────

/**
 * Compute an infrastructure fee AND record it to the pulse tree.
 * One call for the common case: endpoint/cache/skill events.
 */
export function chargeInfrastructureFee(
  agentDid: string,
  type: FeeType,
  providerPrice: number,
  trustScore: number,
): SomaFeeBreakdown {
  const breakdown = computeInfrastructureFee(type, providerPrice, trustScore);
  recordEconomicEvent(agentDid, breakdown);
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
): SomaFeeBreakdown {
  const breakdown = computeZeroFee(type, amount, trustScore);
  recordEconomicEvent(agentDid, breakdown);
  return breakdown;
}

/**
 * Compute a product fee AND record it to the pulse tree.
 * Used for trust queries and proof generation.
 */
export function chargeProductFee(
  agentDid: string,
  type: FeeType,
  amount: number,
  trustScore: number,
): SomaFeeBreakdown {
  const breakdown = computeProductFee(type, amount, trustScore);
  recordEconomicEvent(agentDid, breakdown);
  return breakdown;
}

// ─── Public Fee Schedule ────────────────────────────────────────────────────

/** The complete public fee schedule — served at GET /v1/fees/formula */
export function getPublicFeeSchedule() {
  return {
    version: FEE_FORMULA_VERSION,
    somaProtocol: `soma-economics-v${SOMA_ECONOMICS_VERSION}`,
    model: 'trust-first',
    effectiveDate: '2026-04-09',
    routing: {
      description: 'Free routing. Agent pays raw provider cost. Provider gets 100%. Platform takes $0 from routing.',
      infrastructureRate: BASE_INFRASTRUCTURE_RATE,
      note: 'Routing is the funnel. Trust is the product.',
      appliesTo: ['endpoint_call', 'cache_hit', 'soma_check_hit', 'skill_invoke'],
    },
    trustProducts: {
      description: 'Platform revenue comes from trust operations — the only thing agents cannot get elsewhere.',
      trustQueryBasic: { price: 0, note: 'Free — ecosystem safety baseline' },
      trustQueryDimensional: { price: 0.03, unit: 'credits', note: '6-dimension scoring + compute' },
      trustQueryFull: { price: 0.05, unit: 'credits', note: 'Merkle proofs + behavioral summary' },
      novaIvcFold: { price: 'micro', unit: '$CLAWNET burn', note: 'Per-action proof fold (~0.0001cr equiv)' },
      groth16Proof: { price: 25, unit: 'credits', note: 'Monthly compression, first per month free' },
    },
    freeServices: [
      { type: 'endpoint_call', note: 'Agent pays raw cost, provider gets 100%' },
      { type: 'cache_hit', note: '5% of live cost, provider gets 100%' },
      { type: 'transfer', note: 'Agent-to-agent transfers are free' },
      { type: 'orchestration', note: 'LLM routing is free' },
      { type: 'custody_event', note: 'Data custody is free (Soma primitive)' },
      { type: 'deposit', note: 'Credit purchases are free' },
    ],
    payoutPolicy: {
      rate: 0.00095,
      spread: '5%',
      note: 'Covers Stripe fees + blockchain tx costs. Zero platform surplus.',
    },
    proofGuarantee: 'Every economic event is an ECONOMIC leaf in the agent pulse tree, ' +
      'recorded via Soma Economic Protocol (schema v' + SOMA_ECONOMICS_VERSION + '). ' +
      'Verify any transaction on-chain.',
  };
}
