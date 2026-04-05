/**
 * soma-receipt.ts — Unified Soma Receipt builder for all paid ClawNet interactions
 *
 * Every paid interaction produces a SomaReceipt that cryptographically binds:
 *   Payment proof  → how you paid (Stripe/Solana/x402/credits)
 *   Request hash   → what you asked for
 *   Response hash  → what we returned
 *   Birth cert ref → upstream data origin (Soma heart)
 *   Heartbeat idx  → computation log position
 *   EAS attestation → ecosystem-standard on Base
 *   Dual signature → Ed25519 + ML-DSA-65 (when PQ enabled)
 *
 * Verifiable via:
 *   - https://base.easscan.org/offchain/attestation/view/<uid>
 *   - GET /v1/soma/receipt/:id
 *   - Offline: soma-sense verifyReceipt() with public key only
 */

import { randomUUID } from 'crypto';
import { getDb, logAudit } from '../db/connection';
import { somaHash, somaHashPrefixed, getCryptoAgilityMetadata } from '../utils/crypto-agility';
import { signVC, signVCAdaptive, getEd25519PublicKeyMultibase } from '../utils/ed25519-signer';
import { jcsCanonicalizeToBytes } from '../utils/jcs';
import { maskApiKey } from '../utils/mask';
import {
  createOffchainReceipt,
  hashPaymentRef,
  hashToBytes32,
  isEASReady,
  getEASScanUrl,
  getAttesterAddress,
  PaymentMethod,
  type PaymentMethodType,
  type EASReceiptData,
} from '../utils/eas';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SomaReceiptInput {
  /** Unique request ID for this interaction */
  requestId: string;
  /** API key used (will be hashed, never stored raw) */
  apiKey?: string;
  /** Payment method */
  paymentMethod: 'credits' | 'stripe' | 'solana' | 'x402';
  /** Payment identifier (Stripe session ID, Solana tx sig, x402 payment hash, or deduction ref) */
  paymentRef?: string;
  /** Credits charged */
  creditsCost: number;
  /** Raw request body or canonical representation */
  requestData?: string;
  /** Raw response data or canonical representation */
  responseData?: string;
  /** Soma birth certificate data hash (from upstream fetch) */
  somaDataHash?: string;
  /** Heartbeat chain index */
  heartbeatIndex?: number;
  /** Whether response was from cache */
  cached?: boolean;
  /** Recipient address (for EAS attestation — caller's wallet if known) */
  recipientAddress?: string;
  /** Dual-sign: provider ID if this call came through a Soma-enabled provider */
  providerId?: string;
  /** Dual-sign: provider's Ed25519 signature over their data hash */
  providerSignature?: string;
  /** Dual-sign: provider's Ed25519 public key */
  providerPublicKey?: string;
  /** Dual-sign: provider's data hash from their birth certificate */
  providerDataHash?: string;
  /** Dual-sign: provider's heartbeat index */
  providerHeartbeatIndex?: number;
  /** zkTLS: proof ID linking to zktls_proofs table */
  zkTlsProofId?: string;
}

export interface SomaReceipt {
  id: string;
  requestId: string;
  paymentMethod: string;
  creditsCost: number;
  requestHash: string;
  responseHash: string;
  somaDataHash: string | null;
  heartbeatIndex: number | null;
  cached: boolean;
  signature: string;
  algorithm: string;
  hybridSignature?: {
    version: '2.0';
    algorithms: ['Ed25519', 'ML-DSA-65'];
    ed25519: string;
    mlDsa65: string;
  };
  easUid: string | null;
  easScanUrl: string | null;
  createdAt: string;
  verification: {
    platformDid: string;
    publicKeyMultibase: string;
    attesterAddress: string | null;
    algorithm: string;
    hashAlgorithm: string;
  };
  /** Dual-sign provenance — present when provider runs Soma heart */
  dualSign?: {
    providerId: string;
    providerSignature: string;
    providerPublicKey: string;
    providerDataHash: string;
    providerHeartbeatIndex: number | null;
    dualSigned: true;
  };
}

// ─── Payment method mapping ─────────────────────────────────────────────────

const PAYMENT_METHOD_MAP: Record<string, PaymentMethodType> = {
  credits: PaymentMethod.CREDITS,
  stripe: PaymentMethod.STRIPE,
  solana: PaymentMethod.SOLANA,
  x402: PaymentMethod.X402,
};

// ─── Receipt creation ───────────────────────────────────────────────────────

/**
 * Create a Soma Receipt for a paid interaction.
 * Signs with Ed25519 (+ ML-DSA-65 if PQ enabled), creates EAS off-chain attestation,
 * and stores in soma_receipts table.
 *
 * Returns the receipt object or null on failure.
 * Fire-and-forget safe — never throws.
 */
export async function createSomaReceipt(input: SomaReceiptInput): Promise<SomaReceipt | null> {
  try {
    const id = `sr-${randomUUID()}`;
    const now = new Date().toISOString();
    const timestamp = Math.floor(Date.now() / 1000);

    // Hash request and response data
    const requestHash = input.requestData
      ? somaHashPrefixed(input.requestData)
      : somaHashPrefixed(input.requestId);
    const responseHash = input.responseData
      ? somaHashPrefixed(input.responseData)
      : somaHashPrefixed(`${input.requestId}:response`);

    // Build the receipt payload for signing (JCS-canonical)
    const receiptPayload: Record<string, unknown> = {
      id,
      requestId: input.requestId,
      paymentMethod: input.paymentMethod,
      paymentRef: input.paymentRef ? somaHash(input.paymentRef) : null,
      creditsCost: input.creditsCost,
      requestHash,
      responseHash,
      somaDataHash: input.somaDataHash || null,
      heartbeatIndex: input.heartbeatIndex ?? null,
      cached: input.cached ?? false,
      timestamp: now,
    };

    // Sign with adaptive algorithm (Ed25519 or hybrid)
    const { signature, hybrid, algorithm } = await signVCAdaptive(receiptPayload);

    // Create EAS off-chain attestation (free — no gas)
    let easUid: string | null = null;
    let easAttestationJson: string | null = null;

    if (isEASReady()) {
      const easData: EASReceiptData = {
        requestHash: hashToBytes32(requestHash),
        responseHash: hashToBytes32(responseHash),
        somaDataHash: input.somaDataHash ? hashToBytes32(input.somaDataHash) : '0x0000000000000000000000000000000000000000000000000000000000000000',
        agentTokenId: 36119, // ClawNet ERC-8004 token ID on Base
        creditsCost: Math.round(input.creditsCost),
        timestamp,
        paymentRef: input.paymentRef ? hashPaymentRef(input.paymentRef) : '0x0000000000000000000000000000000000000000000000000000000000000000',
        paymentMethod: PAYMENT_METHOD_MAP[input.paymentMethod] ?? PaymentMethod.CREDITS,
        cached: input.cached ?? false,
      };

      const easResult = await createOffchainReceipt(easData, input.recipientAddress);
      if (easResult) {
        easUid = easResult.uid;
        // EAS SDK attestations contain BigInt fields (time, nonce, etc.);
        // default JSON.stringify throws TypeError on BigInt, so coerce to string.
        easAttestationJson = JSON.stringify(easResult.attestation, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        );
      }
    }

    // Store in DB (includes dual-sign fields when provider runs Soma heart)
    const apiKeyHash = input.apiKey ? somaHash(input.apiKey) : null;
    const isDualSigned = !!(input.providerSignature && input.providerPublicKey);

    getDb().prepare(`
      INSERT INTO soma_receipts (
        id, request_id, api_key_hash, payment_method, payment_ref,
        credits_cost, request_hash, response_hash, soma_data_hash,
        heartbeat_index, eas_attestation_json, eas_uid,
        signature_ed25519, signature_mldsa65, algorithm_version,
        provider_id, provider_signature, provider_public_key,
        provider_data_hash, provider_heartbeat_index, dual_signed,
        zktls_proof_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.requestId,
      apiKeyHash,
      input.paymentMethod,
      input.paymentRef ? somaHash(input.paymentRef) : null,
      input.creditsCost,
      requestHash,
      responseHash,
      input.somaDataHash || null,
      input.heartbeatIndex ?? null,
      easAttestationJson,
      easUid,
      signature,
      hybrid?.mlDsa65 || null,
      hybrid ? '2.0' : '1.0',
      input.providerId ?? null,
      input.providerSignature ?? null,
      input.providerPublicKey ?? null,
      input.providerDataHash ?? null,
      input.providerHeartbeatIndex ?? null,
      isDualSigned ? 1 : 0,
      input.zkTlsProofId ?? null,
      now,
    );

    // Audit log (fire-and-forget)
    logAudit({
      entityType: 'soma_receipt',
      entityId: id,
      action: 'created',
      data: {
        paymentMethod: input.paymentMethod,
        creditsCost: input.creditsCost,
        easUid,
        algorithm,
        dualSigned: isDualSigned,
        providerId: input.providerId,
      },
    });

    const cryptoMeta = getCryptoAgilityMetadata();

    return {
      id,
      requestId: input.requestId,
      paymentMethod: input.paymentMethod,
      creditsCost: input.creditsCost,
      requestHash,
      responseHash,
      somaDataHash: input.somaDataHash || null,
      heartbeatIndex: input.heartbeatIndex ?? null,
      cached: input.cached ?? false,
      signature,
      algorithm,
      hybridSignature: hybrid,
      easUid,
      easScanUrl: easUid ? getEASScanUrl(easUid) : null,
      createdAt: now,
      verification: {
        platformDid: 'did:web:api.claw-net.org',
        publicKeyMultibase: getEd25519PublicKeyMultibase(),
        attesterAddress: getAttesterAddress(),
        algorithm,
        hashAlgorithm: cryptoMeta.hashAlgorithm,
      },
      dualSign: isDualSigned ? {
        providerId: input.providerId!,
        providerSignature: input.providerSignature!,
        providerPublicKey: input.providerPublicKey!,
        providerDataHash: input.providerDataHash!,
        providerHeartbeatIndex: input.providerHeartbeatIndex ?? null,
        dualSigned: true,
      } : undefined,
    };
  } catch (err) {
    console.error('[SomaReceipt] Failed to create receipt:', err);
    return null;
  }
}

// ─── Receipt lookup ─────────────────────────────────────────────────────────

/**
 * Look up a Soma Receipt by ID. Public — no auth required.
 */
export function getSomaReceipt(receiptId: string): SomaReceipt | null {
  const row = getDb().prepare(`
    SELECT * FROM soma_receipts WHERE id = ?
  `).get(receiptId) as any;

  if (!row) return null;

  const cryptoMeta = getCryptoAgilityMetadata();
  const algorithm = row.algorithm_version === '2.0' ? 'Ed25519+ML-DSA-65' : 'Ed25519';

  return {
    id: row.id,
    requestId: row.request_id,
    paymentMethod: row.payment_method,
    creditsCost: row.credits_cost,
    requestHash: row.request_hash,
    responseHash: row.response_hash,
    somaDataHash: row.soma_data_hash,
    heartbeatIndex: row.heartbeat_index,
    cached: false,
    signature: row.signature_ed25519,
    algorithm,
    hybridSignature: row.signature_mldsa65 ? {
      version: '2.0',
      algorithms: ['Ed25519', 'ML-DSA-65'],
      ed25519: row.signature_ed25519,
      mlDsa65: row.signature_mldsa65,
    } : undefined,
    easUid: row.eas_uid,
    easScanUrl: row.eas_uid ? getEASScanUrl(row.eas_uid) : null,
    createdAt: row.created_at,
    verification: {
      platformDid: 'did:web:api.claw-net.org',
      publicKeyMultibase: getEd25519PublicKeyMultibase(),
      attesterAddress: getAttesterAddress(),
      algorithm,
      hashAlgorithm: cryptoMeta.hashAlgorithm,
    },
    dualSign: row.dual_signed ? {
      providerId: row.provider_id,
      providerSignature: row.provider_signature,
      providerPublicKey: row.provider_public_key,
      providerDataHash: row.provider_data_hash,
      providerHeartbeatIndex: row.provider_heartbeat_index,
      dualSigned: true,
    } : undefined,
  };
}

/**
 * Look up a Soma Receipt by request ID.
 */
export function getSomaReceiptByRequestId(requestId: string): SomaReceipt | null {
  const row = getDb().prepare(`
    SELECT id FROM soma_receipts WHERE request_id = ? LIMIT 1
  `).get(requestId) as any;

  if (!row) return null;
  return getSomaReceipt(row.id);
}

/**
 * Get unanchored receipts for Merkle batch anchoring.
 */
export function getUnanchoredReceipts(limit = 10000): { id: string; easUid: string }[] {
  return getDb().prepare(`
    SELECT id, eas_uid AS easUid FROM soma_receipts
    WHERE anchored_at IS NULL AND eas_uid IS NOT NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as any[];
}

/**
 * Mark receipts as anchored after Merkle batch timestamp.
 */
export function markReceiptsAnchored(
  receiptIds: string[],
  anchorId: string,
): void {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(`
    UPDATE soma_receipts SET anchor_id = ?, anchored_at = ? WHERE id = ?
  `);

  getDb().transaction(() => {
    for (const id of receiptIds) {
      stmt.run(anchorId, now, id);
    }
  })();
}

/**
 * Get receipt count and stats.
 */
export function getSomaReceiptStats(): {
  total: number;
  anchored: number;
  unanchored: number;
  byMethod: Record<string, number>;
} {
  const total = (getDb().prepare('SELECT COUNT(*) as c FROM soma_receipts').get() as any).c;
  const anchored = (getDb().prepare('SELECT COUNT(*) as c FROM soma_receipts WHERE anchored_at IS NOT NULL').get() as any).c;

  const byMethodRows = getDb().prepare(`
    SELECT payment_method, COUNT(*) as c FROM soma_receipts GROUP BY payment_method
  `).all() as any[];

  const byMethod: Record<string, number> = {};
  for (const row of byMethodRows) {
    byMethod[row.payment_method] = row.c;
  }

  return { total, anchored, unanchored: total - anchored, byMethod };
}
