/**
 * crypto-agility.ts — Algorithm-agile cryptographic primitives for Soma verification layer
 *
 * Centralizes all hashing and signature verification so that migrating
 * from Ed25519/SHA-256 to post-quantum algorithms (ML-DSA/SHA-3-256) is a
 * configuration change, not a rewrite.
 *
 * NIST timeline: Ed25519-class crypto deprecated 2030, disallowed 2035.
 * Designed for algorithm migration from day one.
 *
 * Phase 1 (now): SHA-256 for all hashes, Ed25519 for signatures.
 * Phase 2 (future): Hybrid Ed25519 + ML-DSA dual signatures, SHA-3-256 hashing.
 * Phase 3 (future): ML-DSA-only when did:key gets standardized multicodec.
 */

import crypto from 'crypto';

// ─── Algorithm constants ─────────────────────────────────────────────────────

/** Current hash algorithm — SHA-256. Matches Solana, x402, ERC-8004, W3C VC ecosystem. */
export const SOMA_HASH_ALGORITHM = 'sha256';

/** Hash output length in hex characters (SHA-256 = 64 hex chars). */
export const SOMA_HASH_HEX_LENGTH = 64;

/** Hash prefix used in portable receipts and attestation hashes. */
export const SOMA_HASH_PREFIX = 'sha256';

/** Current signature algorithm identifier. */
export const SOMA_SIGNATURE_ALGORITHM = 'EdDSA';

/** Current algorithm version. */
export const SOMA_ALGORITHM_VERSION = '1.0';

/** HMAC algorithm for attestation signing. */
export const SOMA_HMAC_ALGORITHM = 'sha256';

// Legacy aliases — kept for any code that still references the old names
export const AID_HASH_ALGORITHM = SOMA_HASH_ALGORITHM;
export const AID_HASH_HEX_LENGTH = SOMA_HASH_HEX_LENGTH;
export const AID_SIGNATURE_ALGORITHM = SOMA_SIGNATURE_ALGORITHM;
export const AID_HMAC_ALGORITHM = SOMA_HMAC_ALGORITHM;

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash for Soma trust primitives (Merkle trees, verdicts, receipts, proofs).
 * Returns the raw hex digest.
 *
 * Use this for ALL trust-layer hashing. This is the ONLY place hash
 * algorithms are called directly — everything else goes through somaHash().
 */
export function somaHash(data: string | Buffer): string {
  return crypto.createHash(SOMA_HASH_ALGORITHM).update(data).digest('hex');
}

/** Legacy alias */
export const aidHash = somaHash;

/**
 * SHA-256 hash with the standard prefix (e.g. "sha256:abc123...").
 * Used in receipt hashes and attestation source hashes.
 */
export function somaHashPrefixed(data: string | Buffer): string {
  return `${SOMA_HASH_PREFIX}:${somaHash(data)}`;
}

/** Legacy alias */
export const aidHashPrefixed = somaHashPrefixed;

/**
 * HMAC-SHA256 for attestation signing.
 */
export function somaHmac(secret: string, data: string): string {
  return crypto.createHmac(SOMA_HMAC_ALGORITHM, secret).update(data).digest('hex');
}

/** Legacy alias */
export const aidHmac = somaHmac;

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
    default:
      throw new Error(`Unsupported signature algorithm: ${algorithm}`);
  }
}

/**
 * Sign data using the specified algorithm.
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

// ─── Document fields ─────────────────────────────────────────────────────────

/**
 * Standard crypto-agility fields to include in every document and receipt.
 */
export function getCryptoAgilityMetadata() {
  return {
    signatureAlgorithm: SOMA_SIGNATURE_ALGORITHM,
    algorithmVersion: SOMA_ALGORITHM_VERSION,
    hashAlgorithm: SOMA_HASH_ALGORITHM,
  };
}

/**
 * Crypto-agility block for heartbeat responses.
 */
export function getCryptoAgilityHeartbeat() {
  return {
    current: 'Ed25519',
    supported: ALLOWED_ALGORITHMS,
    planned: ['ML-DSA-44'],
    hashAlgorithm: SOMA_HASH_ALGORITHM,
    pqcReady: false,
    migrationTarget: 'ML-DSA-44',
    migrationDate: null,
  };
}

// ─── Algorithm whitelist ─────────────────────────────────────────────────────

/**
 * Allowed signature algorithms for verification.
 * Prevents algorithm confusion/downgrade attacks.
 */
export const ALLOWED_ALGORITHMS: readonly string[] = ['EdDSA', 'Ed25519'];

export function isAlgorithmAllowed(algorithm: string): boolean {
  return ALLOWED_ALGORITHMS.includes(algorithm);
}

/**
 * Negotiate the best mutually-supported algorithm between two parties.
 */
export function negotiateAlgorithm(
  localSupported: readonly string[],
  remoteSupported: readonly string[],
): string | null {
  const PREFERENCE_ORDER = ['ML-DSA-44', 'Ed25519+ML-DSA', 'EdDSA', 'Ed25519'];
  for (const algo of PREFERENCE_ORDER) {
    if (localSupported.includes(algo) && remoteSupported.includes(algo)) return algo;
  }
  return null;
}

/**
 * PQC migration status per NIST IR 8547 timeline.
 */
export function getPQCMigrationStatus() {
  return {
    currentPhase: 1,
    description: 'Ed25519 only — ML-DSA planned',
    eddsaStatus: 'active',
    mldsaStatus: 'planned',
  };
}
