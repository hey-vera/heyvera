/**
 * crypto-agility.ts — Algorithm-agile cryptographic primitives for AID trust layer
 *
 * Centralizes all AID hashing and signature verification so that migrating
 * from Ed25519/SHA-256 to post-quantum algorithms (ML-DSA/SHA-384) is a
 * configuration change, not a rewrite.
 *
 * NIST timeline: Ed25519-class crypto deprecated 2030, disallowed 2035.
 * AID is designed for algorithm migration from day one.
 *
 * Phase 1 (now): SHA-384 for AID trust hashes, Ed25519 for signatures.
 * Phase 2 (future): Hybrid Ed25519 + ML-DSA dual signatures.
 * Phase 3 (future): ML-DSA-only when did:key gets standardized multicodec.
 */

import crypto from 'crypto';

// ─── Algorithm constants ─────────────────────────────────────────────────────

/** Current AID hash algorithm — SHA-384 for quantum resistance on trust primitives. */
export const AID_HASH_ALGORITHM = 'sha384';

/** Hash output length in hex characters (SHA-384 = 96 hex chars). */
export const AID_HASH_HEX_LENGTH = 96;

/** Hash prefix used in portable receipts and attestation hashes. */
export const AID_HASH_PREFIX = 'sha384';

/** Current AID signature algorithm identifier. */
export const AID_SIGNATURE_ALGORITHM = 'EdDSA';

/** Current AID signature algorithm version. */
export const AID_ALGORITHM_VERSION = '1.0';

/** HMAC algorithm for attestation signing. */
export const AID_HMAC_ALGORITHM = 'sha384';

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * SHA-384 hash for AID trust primitives (Merkle trees, attestations, receipts, proofs).
 * Returns the raw hex digest.
 *
 * Use this for ALL AID trust-layer hashing. Do NOT use for cache keys or
 * internal non-trust operations — those stay SHA-256 (no quantum concern).
 */
export function aidHash(data: string | Buffer): string {
  return crypto.createHash(AID_HASH_ALGORITHM).update(data).digest('hex');
}

/**
 * SHA-384 hash with the standard AID prefix (e.g. "sha384:abc123...").
 * Used in receipt hashes and attestation source hashes.
 */
export function aidHashPrefixed(data: string | Buffer): string {
  return `${AID_HASH_PREFIX}:${aidHash(data)}`;
}

/**
 * HMAC-SHA384 for attestation signing.
 */
export function aidHmac(secret: string, data: string): string {
  return crypto.createHmac(AID_HMAC_ALGORITHM, secret).update(data).digest('hex');
}

// ─── Signature verification dispatch ─────────────────────────────────────────

/**
 * Verify a signature using the algorithm specified in the document.
 * This is the algorithm-agile entry point — dispatches based on algorithm field.
 *
 * Currently supports: EdDSA (Ed25519).
 * Future: ML-DSA-44 (FIPS 204), hybrid Ed25519+ML-DSA.
 */
export function verifySignature(
  algorithm: string,
  signature: Buffer,
  message: Buffer,
  publicKey: crypto.KeyObject,
): boolean {
  switch (algorithm) {
    case 'EdDSA':
    case 'Ed25519':
      return crypto.verify(null, message, publicKey, signature);
    // Future: case 'ML-DSA-44': return verifyMLDSA(signature, message, publicKey);
    default:
      throw new Error(`Unsupported signature algorithm: ${algorithm}`);
  }
}

/**
 * Sign data using the specified algorithm.
 * Currently supports: EdDSA (Ed25519).
 */
export function signWithAlgorithm(
  algorithm: string,
  message: Buffer,
  privateKey: crypto.KeyObject,
): Buffer {
  switch (algorithm) {
    case 'EdDSA':
    case 'Ed25519':
      return Buffer.from(crypto.sign(null, message, privateKey));
    default:
      throw new Error(`Unsupported signature algorithm: ${algorithm}`);
  }
}

// ─── AID document fields ─────────────────────────────────────────────────────

/**
 * Standard crypto-agility fields to include in every AID document and receipt.
 */
export function getCryptoAgilityMetadata() {
  return {
    signatureAlgorithm: AID_SIGNATURE_ALGORITHM,
    algorithmVersion: AID_ALGORITHM_VERSION,
    hashAlgorithm: AID_HASH_ALGORITHM,
  };
}

/**
 * Crypto-agility block for heartbeat responses.
 */
export function getCryptoAgilityHeartbeat() {
  return {
    current: 'Ed25519',
    supported: ['Ed25519'],
    planned: ['ML-DSA-44'],
    hashAlgorithm: AID_HASH_ALGORITHM,
    pqcReady: false,
    migrationTarget: 'ML-DSA-44',
    migrationDate: null,
  };
}
