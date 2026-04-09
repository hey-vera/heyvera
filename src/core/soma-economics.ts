/**
 * Soma Economic Protocol — platform-agnostic fee provability.
 *
 * Any platform can prove fair fees using this protocol:
 * 1. Record economic events as ECONOMIC leaves in pulse trees
 * 2. Publish fee formulas for public audit
 * 3. Let agents verify any charge against the published formula
 *
 * This is the PROVABILITY layer, not the business logic layer.
 * Specific fee rates and formulas are platform decisions.
 * Soma provides the standard schema so agents can compare and verify
 * across any platform that implements this protocol.
 *
 * Protocol: schema v1.0
 * Leaf type: ECONOMIC (0x02) in pulse tree
 */

import { somaHashJson } from '../utils/crypto-agility';
import { appendEconomic } from './soma-heartbeat';
import { logger } from '../utils/logger';

export const SOMA_ECONOMICS_VERSION = '1.0';

// ─── Standard Schema ────────────────────────────────────────────────────────

/**
 * Platform-agnostic economic event schema.
 *
 * Every economic event — regardless of platform — uses this format.
 * Agents compare fees across platforms using identical fields.
 * Auditors verify any charge by recomputing from formulaInputs.
 *
 * The schema does NOT dictate what fees to charge. It dictates
 * what information must be recorded to PROVE what was charged.
 */
export interface SomaFeeBreakdown {
  /** Soma economics protocol version */
  schemaVersion: string;
  /** Platform identifier (DID, name, or domain) */
  platform: string;
  /** Event type (platform-defined, e.g., 'endpoint_call', 'cache_hit') */
  eventType: string;
  /** Total charged to agent */
  amount: number;
  /** Amount to service provider / recipient */
  recipientShare: number;
  /** Amount kept by platform */
  platformFee: number;
  /** Platform's published formula identifier (e.g., 'clawnet-additive-v1') */
  formulaId: string;
  /** All inputs to the formula — enables independent recomputation */
  formulaInputs: Record<string, number>;
  /** H(breakdown) — becomes ECONOMIC leaf payload in pulse tree */
  hash: string;
}

// ─── Hashing ────────────────────────────────────────────────────────────────

/**
 * Compute canonical hash for a fee breakdown.
 *
 * Used by platforms when building breakdowns, and by agents/auditors
 * when independently verifying that a breakdown matches its hash.
 */
export function hashFeeBreakdown(breakdown: Omit<SomaFeeBreakdown, 'hash'>): string {
  return somaHashJson(breakdown);
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify a fee breakdown's integrity by recomputing its hash.
 *
 * Step 1 of verification: does the hash match the contents?
 * Step 2 (caller's responsibility): does this hash exist as an
 * ECONOMIC leaf in the agent's pulse tree?
 *
 * Together, these prove: the platform recorded THIS exact breakdown
 * in the agent's tamper-evident history.
 */
export function verifyFeeBreakdown(breakdown: SomaFeeBreakdown): boolean {
  const { hash, ...rest } = breakdown;
  return hashFeeBreakdown(rest) === hash;
}

// ─── Recording ──────────────────────────────────────────────────────────────

/**
 * Record an economic event to an agent's pulse tree as an ECONOMIC leaf.
 *
 * The breakdown hash is the leaf payload. Any auditor who obtains
 * the breakdown can verify it exists in the tree (tamper-evident)
 * and recompute the hash from formulaInputs (transparent).
 *
 * Non-fatal: recording failures never block the transaction.
 * The economic event still happened — it just lacks a proof leaf.
 */
export function recordEconomicEvent(
  agentDid: string,
  breakdown: SomaFeeBreakdown,
): void {
  try {
    appendEconomic(agentDid, {
      action: `econ:${breakdown.eventType}`,
      amount: breakdown.amount,
      ref: breakdown.hash,
    });
  } catch (err) {
    logger.warn({ err, agentDid, eventType: breakdown.eventType }, 'Failed to record economic event (non-fatal)');
  }
}
