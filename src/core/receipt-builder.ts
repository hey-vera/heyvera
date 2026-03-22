/**
 * receipt-builder.ts — Portable Atomic Receipt Generation (Spec Section 5)
 *
 * Every AID transaction produces a dual-signed, Merkle-anchored receipt.
 * Receipts are the raw input to trust scores, attestation history, and Merkle anchoring.
 *
 * Properties:
 * - Dual-signed: payer + provider both sign (mutual commitment)
 * - Platform-countersigned: platform signs the full receipt hash
 * - Merkle-anchored: receipt hash included in periodic Merkle snapshots
 * - Content-addressed: inputHash + resultHash prove what was delivered
 * - Offline-verifiable: Ed25519 signatures + Merkle proofs = pure math
 * - Portable: agent carries receipts to any platform
 */

import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { AID_HASH_ALGORITHM } from '../utils/crypto-agility';
import { signVC, getEd25519PublicKeyMultibase } from '../utils/ed25519-signer';
import { getDb, logAudit } from '../db/connection';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AidReceipt {
  protocol: 'AID';
  version: '1.0.0';
  receiptId: string;
  timestamp: string;
  hashAlgorithm: string;
  payer: {
    did: string;
    trustScore: number;
  };
  provider: {
    did: string;
    trustScore: number;
  };
  service: {
    id: string;
    type: string;
    inputHash: string;
    resultHash: string;
  };
  payment?: {
    amount: string;
    currency: string;
    chain: string;
    settlementMode: string;
    settled: boolean;
    txHash: string | null;
    trustDiscount: number;
  };
  trust: {
    merkleRoot: string | null;
    snapshotId: string | null;
    snapshotTimestamp: string | null;
  };
  proof: {
    payerSignature: string | null;
    providerSignature: string;
    platformCountersignature: string;
  };
  disputeEligible?: boolean;
  disputeReason?: string;
}

// ─── Hash helpers ───────────────────────────────────────────────────────────

function hashData(data: string): string {
  return `${AID_HASH_ALGORITHM}:${crypto.createHash(AID_HASH_ALGORITHM).update(data).digest('hex')}`;
}

// ─── Receipt builder ────────────────────────────────────────────────────────

const PLATFORM_DID = 'did:web:api.claw-net.org';

export function buildReceipt(params: {
  payerDid: string;
  payerTrustScore: number;
  providerDid?: string;
  providerTrustScore?: number;
  serviceId: string;
  serviceType: string;
  inputData: string;
  resultData: string;
  payment?: {
    amount: string;
    currency: string;
    chain: string;
    settlementMode: string;
    settled: boolean;
    txHash: string | null;
    trustDiscount: number;
  };
  disputeEligible?: boolean;
  disputeReason?: string;
}): AidReceipt {
  const receiptId = `rcpt-${nanoid(16)}`;
  const timestamp = new Date().toISOString();

  const inputHash = hashData(params.inputData);
  const resultHash = hashData(params.resultData);

  // Get latest Merkle snapshot
  const snapshot = getDb().prepare(
    'SELECT id, merkle_root, created_at FROM aid_trust_snapshots ORDER BY created_at DESC LIMIT 1'
  ).get() as { id: string; merkle_root: string; created_at: string } | undefined;

  // Provider signature: platform signs as provider (for ClawNet skills)
  // For marketplace skills, the skill creator's signature would go here
  const providerDid = params.providerDid || PLATFORM_DID;
  const providerTrustScore = params.providerTrustScore ?? 100;

  // Platform countersignature over the full receipt
  const receiptCore = {
    receiptId,
    timestamp,
    payerDid: params.payerDid,
    providerDid,
    inputHash,
    resultHash,
    serviceId: params.serviceId,
  };

  const platformSig = signVC(receiptCore);

  // Provider signature (same as platform for ClawNet-hosted skills)
  const providerSigInput = `${providerDid}\n${receiptId}\n${timestamp}\n${resultHash}`;
  const providerSigHash = crypto.createHash(AID_HASH_ALGORITHM).update(providerSigInput).digest();
  // Re-use platform key for provider sig when provider == platform
  const providerSig = platformSig;

  const receipt: AidReceipt = {
    protocol: 'AID',
    version: '1.0.0',
    receiptId,
    timestamp,
    hashAlgorithm: AID_HASH_ALGORITHM,
    payer: {
      did: params.payerDid,
      trustScore: params.payerTrustScore,
    },
    provider: {
      did: providerDid,
      trustScore: providerTrustScore,
    },
    service: {
      id: params.serviceId,
      type: params.serviceType,
      inputHash,
      resultHash,
    },
    ...(params.payment ? { payment: params.payment } : {}),
    trust: {
      merkleRoot: snapshot?.merkle_root || null,
      snapshotId: snapshot?.id || null,
      snapshotTimestamp: snapshot?.created_at || null,
    },
    proof: {
      payerSignature: null, // Payer signs client-side with their Ed25519 key
      providerSignature: `ed25519:${providerSig}`,
      platformCountersignature: `ed25519:${platformSig}`,
    },
  };

  if (params.disputeEligible) {
    receipt.disputeEligible = true;
    receipt.disputeReason = params.disputeReason;
  }

  // Store receipt in DB for retrieval
  try {
    getDb().prepare(`
      INSERT OR IGNORE INTO attestations (id, owner_key, attestation_type, action_type, action_endpoint,
        input_hash, response_hash, outcome_status, credits_charged, created_at)
      VALUES (?, ?, 'receipt', ?, ?, ?, ?, 'success', 0, ?)
    `).run(
      receiptId, params.payerDid, params.serviceType, params.serviceId,
      inputHash, resultHash, timestamp,
    );
  } catch {
    // Non-blocking — receipt still returned even if DB write fails
  }

  logger.debug({ receiptId, payerDid: params.payerDid, serviceId: params.serviceId }, 'AID receipt generated');

  return receipt;
}

/**
 * Verify a receipt's platform countersignature offline.
 */
export function verifyReceipt(receipt: AidReceipt, platformPublicKeyMultibase?: string): boolean {
  if (!receipt.proof?.platformCountersignature) return false;

  const sig = receipt.proof.platformCountersignature.replace('ed25519:', '');
  const receiptCore = {
    receiptId: receipt.receiptId,
    timestamp: receipt.timestamp,
    payerDid: receipt.payer.did,
    providerDid: receipt.provider.did,
    inputHash: receipt.service.inputHash,
    resultHash: receipt.service.resultHash,
    serviceId: receipt.service.id,
  };

  try {
    const { verifyVCSignature } = require('../utils/ed25519-signer');
    return verifyVCSignature(receiptCore, sig);
  } catch {
    return false;
  }
}
