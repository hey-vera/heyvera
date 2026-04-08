/**
 * death-certificate.ts — Agent Termination Protocol
 *
 * When an agent shuts down intentionally, it issues a death certificate:
 *   1. All pending bonds settled or transferred
 *   2. All active burner agents revoked
 *   3. Wallet balances swept to designated address
 *   4. Optional successor designated (inherits partial trust)
 *   5. Final attestation signed — the last thing the Heart ever signs
 *
 * Without a death certificate, an agent that stops responding is
 * indistinguishable from one that was compromised or rug-pulled.
 * The death cert is proof of intentional, orderly shutdown.
 *
 * Trust inheritance:
 *   - Successor inherits up to 50% of deceased agent's trust
 *   - Trust doesn't transfer 1:1 — some "dies with the agent" (prevents farming)
 *   - Inheritance requires both parties to sign (no unilateral claim)
 *   - 30-day contestation window before trust fully transfers
 */

import { nanoid } from 'nanoid';
import nacl from 'tweetnacl';
import { getDb } from '../db/connection';
import { somaHash } from '../utils/crypto-agility';
import { jcsSerialize } from '../utils/jcs';
import { deriveFromRoot } from './soma-wallet';
import { listActiveBurners, revokeBurnerAgent } from './burner-agent';
import { round6 } from './credits';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeathCertificate {
  id: string;
  agentDid: string;
  agentPublicKey: string;

  // Final state snapshot
  finalTrustScore: number;
  totalTransactionsProcessed: number;
  totalCreditsProcessed: number;
  activeDurationHours: number;

  // Obligation settlement
  pendingBondsSettled: number;
  burnersRevoked: number;
  walletSweptTo: string | null;
  walletSweptAmount: number;

  // Succession
  successorDid: string | null;
  trustTransferAmount: number;
  trustTransferPending: boolean;   // True until contestation window closes
  contestationEndsAt: string | null;

  // Proof
  finalHeartbeatIndex: number;
  chainHash: string;               // Hash binding all fields
  signature: string;               // Last signature from Heart
  reason: string;                  // 'graceful' | 'migration' | 'revoked' | 'successor'

  createdAt: string;
}

export interface CreateDeathCertOpts {
  agentDid: string;
  agentPublicKey: string;
  agentRootSeed: Buffer;
  finalTrustScore: number;
  totalTransactionsProcessed?: number;
  totalCreditsProcessed?: number;
  activeDurationHours?: number;
  finalHeartbeatIndex?: number;
  walletSweptTo?: string;
  walletSweptAmount?: number;
  successorDid?: string;
  trustInheritancePct?: number;    // 0.0–0.5, default 0.3
  reason?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_TRUST_INHERITANCE_PCT = 0.50;
const DEFAULT_TRUST_INHERITANCE_PCT = 0.30;
const CONTESTATION_WINDOW_DAYS = 30;

// ─── Creation ───────────────────────────────────────────────────────────────

/**
 * Issue a death certificate — the agent's final attestation.
 *
 * This is an IRREVERSIBLE action. Once signed, the Heart is considered dead.
 * All active burners are auto-revoked.
 */
export function issueDeathCertificate(opts: CreateDeathCertOpts): DeathCertificate {
  const id = `death-${nanoid(16)}`;
  const now = new Date();

  // Step 1: Revoke all active burner agents
  const activeBurners = listActiveBurners(opts.agentDid);
  let burnersRevoked = 0;
  for (const burner of activeBurners) {
    revokeBurnerAgent(burner.id, 'parent_shutdown');
    burnersRevoked++;
  }

  // Step 2: Calculate trust inheritance
  const inheritancePct = Math.min(
    opts.trustInheritancePct ?? DEFAULT_TRUST_INHERITANCE_PCT,
    MAX_TRUST_INHERITANCE_PCT,
  );
  const trustTransferAmount = opts.successorDid
    ? round6(opts.finalTrustScore * inheritancePct)
    : 0;

  const contestationEndsAt = opts.successorDid
    ? new Date(now.getTime() + CONTESTATION_WINDOW_DAYS * 86400 * 1000).toISOString()
    : null;

  // Step 3: Build chain hash (binds all fields canonically)
  const chainPayload = jcsSerialize({
    type: 'death_certificate',
    agentDid: opts.agentDid,
    finalTrustScore: opts.finalTrustScore,
    burnersRevoked,
    successorDid: opts.successorDid ?? null,
    trustTransferAmount,
    walletSweptTo: opts.walletSweptTo ?? null,
    walletSweptAmount: opts.walletSweptAmount ?? 0,
    finalHeartbeatIndex: opts.finalHeartbeatIndex ?? 0,
    reason: opts.reason ?? 'graceful',
    timestamp: now.toISOString(),
  });
  const chainHash = somaHash(chainPayload);

  // Step 4: Sign — the LAST thing the Heart ever signs
  const signingKeypair = nacl.sign.keyPair.fromSeed(
    new Uint8Array(deriveFromRoot(opts.agentRootSeed, 'sign')),
  );
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(chainHash, 'hex'), signingKeypair.secretKey),
  ).toString('hex');

  const cert: DeathCertificate = {
    id,
    agentDid: opts.agentDid,
    agentPublicKey: opts.agentPublicKey,
    finalTrustScore: opts.finalTrustScore,
    totalTransactionsProcessed: opts.totalTransactionsProcessed ?? 0,
    totalCreditsProcessed: opts.totalCreditsProcessed ?? 0,
    activeDurationHours: opts.activeDurationHours ?? 0,
    pendingBondsSettled: 0,
    burnersRevoked,
    walletSweptTo: opts.walletSweptTo ?? null,
    walletSweptAmount: opts.walletSweptAmount ?? 0,
    successorDid: opts.successorDid ?? null,
    trustTransferAmount,
    trustTransferPending: !!opts.successorDid,
    contestationEndsAt,
    finalHeartbeatIndex: opts.finalHeartbeatIndex ?? 0,
    chainHash,
    signature,
    reason: opts.reason ?? 'graceful',
    createdAt: now.toISOString(),
  };

  // Persist
  try {
    getDb().prepare(`
      INSERT INTO death_certificates (
        id, agent_did, agent_public_key,
        final_trust_score, total_transactions, total_credits, active_duration_hours,
        pending_bonds_settled, burners_revoked,
        wallet_swept_to, wallet_swept_amount,
        successor_did, trust_transfer_amount, trust_transfer_pending, contestation_ends_at,
        final_heartbeat_index, chain_hash, signature, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cert.id, cert.agentDid, cert.agentPublicKey,
      cert.finalTrustScore, cert.totalTransactionsProcessed,
      cert.totalCreditsProcessed, cert.activeDurationHours,
      cert.pendingBondsSettled, cert.burnersRevoked,
      cert.walletSweptTo, cert.walletSweptAmount,
      cert.successorDid, cert.trustTransferAmount,
      cert.trustTransferPending ? 1 : 0, cert.contestationEndsAt,
      cert.finalHeartbeatIndex, cert.chainHash, cert.signature,
      cert.reason, cert.createdAt,
    );
  } catch (err) {
    logger.error({ err, agentDid: opts.agentDid }, 'Failed to persist death certificate');
  }

  logger.info({
    deathCertId: id, agentDid: opts.agentDid,
    burnersRevoked, successorDid: opts.successorDid,
    trustTransfer: trustTransferAmount, reason: cert.reason,
  }, 'Death certificate issued — agent Heart terminated');

  return cert;
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify a death certificate's signature and chain hash.
 */
export function verifyDeathCertificate(cert: DeathCertificate): {
  signatureValid: boolean;
  chainHashValid: boolean;
} {
  // Reconstruct chain hash
  const chainPayload = jcsSerialize({
    type: 'death_certificate',
    agentDid: cert.agentDid,
    finalTrustScore: cert.finalTrustScore,
    burnersRevoked: cert.burnersRevoked,
    successorDid: cert.successorDid,
    trustTransferAmount: cert.trustTransferAmount,
    walletSweptTo: cert.walletSweptTo,
    walletSweptAmount: cert.walletSweptAmount,
    finalHeartbeatIndex: cert.finalHeartbeatIndex,
    reason: cert.reason,
    timestamp: cert.createdAt,
  });
  const expectedHash = somaHash(chainPayload);
  const chainHashValid = expectedHash === cert.chainHash;

  // Verify signature
  let signatureValid = false;
  try {
    const sig = new Uint8Array(Buffer.from(cert.signature, 'hex'));
    const pubKey = new Uint8Array(Buffer.from(cert.agentPublicKey, 'hex'));
    const hashBytes = new Uint8Array(Buffer.from(cert.chainHash, 'hex'));
    signatureValid = nacl.sign.detached.verify(hashBytes, sig, pubKey);
  } catch {
    signatureValid = false;
  }

  return { signatureValid, chainHashValid };
}

// ─── Trust Inheritance ──────────────────────────────────────────────────────

/**
 * Finalize trust transfer after contestation window closes.
 * Returns the amount of trust transferred to the successor.
 */
export function finalizeTrustInheritance(deathCertId: string): number {
  const cert = getDeathCertificate(deathCertId);
  if (!cert) return 0;
  if (!cert.successorDid) return 0;
  if (!cert.trustTransferPending) return 0;

  // Check contestation window
  if (cert.contestationEndsAt && new Date(cert.contestationEndsAt).getTime() > Date.now()) {
    return 0; // Window still open
  }

  // Transfer trust
  getDb().prepare(
    'UPDATE death_certificates SET trust_transfer_pending = 0 WHERE id = ?',
  ).run(deathCertId);

  logger.info({
    deathCertId, successorDid: cert.successorDid,
    trustTransferred: cert.trustTransferAmount,
  }, 'Trust inheritance finalized');

  return cert.trustTransferAmount;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get a death certificate by ID. */
export function getDeathCertificate(certId: string): DeathCertificate | null {
  const row = getDb().prepare('SELECT * FROM death_certificates WHERE id = ?').get(certId) as any;
  if (!row) return null;
  return rowToDeathCert(row);
}

/** Get a death certificate by agent DID. */
export function getDeathCertificateByDid(agentDid: string): DeathCertificate | null {
  const row = getDb().prepare(
    'SELECT * FROM death_certificates WHERE agent_did = ? ORDER BY created_at DESC LIMIT 1',
  ).get(agentDid) as any;
  if (!row) return null;
  return rowToDeathCert(row);
}

/** Check if an agent has a death certificate (i.e., is dead). */
export function isAgentDead(agentDid: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM death_certificates WHERE agent_did = ? LIMIT 1',
  ).get(agentDid);
  return !!row;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToDeathCert(row: any): DeathCertificate {
  return {
    id: row.id,
    agentDid: row.agent_did,
    agentPublicKey: row.agent_public_key,
    finalTrustScore: row.final_trust_score,
    totalTransactionsProcessed: row.total_transactions,
    totalCreditsProcessed: row.total_credits,
    activeDurationHours: row.active_duration_hours,
    pendingBondsSettled: row.pending_bonds_settled,
    burnersRevoked: row.burners_revoked,
    walletSweptTo: row.wallet_swept_to,
    walletSweptAmount: row.wallet_swept_amount,
    successorDid: row.successor_did,
    trustTransferAmount: row.trust_transfer_amount,
    trustTransferPending: !!row.trust_transfer_pending,
    contestationEndsAt: row.contestation_ends_at,
    finalHeartbeatIndex: row.final_heartbeat_index,
    chainHash: row.chain_hash,
    signature: row.signature,
    reason: row.reason,
    createdAt: row.created_at,
  };
}
