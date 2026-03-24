/**
 * crypto-agility.ts — Algorithm-agile cryptographic primitives for AID trust layer
 *
 * Centralizes all AID hashing and signature verification so that migrating
 * from Ed25519/SHA-256 to post-quantum algorithms (ML-DSA/SHA-3-256) is a
 * configuration change, not a rewrite.
 *
 * NIST timeline: Ed25519-class crypto deprecated 2030, disallowed 2035.
 * AID is designed for algorithm migration from day one.
 *
 * Phase 1 (now): SHA-256 for all AID trust hashes, Ed25519 for signatures.
 * Phase 2 (future): Hybrid Ed25519 + ML-DSA dual signatures, SHA-3-256 hashing.
 * Phase 3 (future): ML-DSA-only when did:key gets standardized multicodec.
 *
 * HashAlgorithm = "SHA-256" | "SHA-3-256" (union type, extensible)
 * SigningAlgorithm = "Ed25519" | "ML-DSA-65" (union type, extensible)
 */

import crypto from 'crypto';

// ─── Algorithm constants ─────────────────────────────────────────────────────

/** Current AID hash algorithm — SHA-256. Matches Solana, x402, ERC-8004, W3C VC ecosystem. */
export const AID_HASH_ALGORITHM = 'sha256';

/** Hash output length in hex characters (SHA-256 = 64 hex chars). */
export const AID_HASH_HEX_LENGTH = 64;

/** Hash prefix used in portable receipts and attestation hashes. */
export const AID_HASH_PREFIX = 'sha256';

/** Current AID signature algorithm identifier. */
export const AID_SIGNATURE_ALGORITHM = 'EdDSA';

/** Current AID signature algorithm version. */
export const AID_ALGORITHM_VERSION = '1.0';

/** HMAC algorithm for attestation signing. */
export const AID_HMAC_ALGORITHM = 'sha256';

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 hash for AID trust primitives (Merkle trees, attestations, receipts, proofs).
 * Returns the raw hex digest.
 *
 * Use this for ALL AID trust-layer hashing. This is the ONLY place hash
 * algorithms are called directly — everything else goes through aidHash().
 */
export function aidHash(data: string | Buffer): string {
  return crypto.createHash(AID_HASH_ALGORITHM).update(data).digest('hex');
}

/**
 * SHA-256 hash with the standard AID prefix (e.g. "sha256:abc123...").
 * Used in receipt hashes and attestation source hashes.
 */
export function aidHashPrefixed(data: string | Buffer): string {
  return `${AID_HASH_PREFIX}:${aidHash(data)}`;
}

/**
 * HMAC-SHA256 for attestation signing.
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
    supported: ALLOWED_ALGORITHMS,
    planned: ['ML-DSA-44'],
    hashAlgorithm: AID_HASH_ALGORITHM,
    pqcReady: false,
    migrationTarget: 'ML-DSA-44',
    migrationDate: null,
  };
}

// ─── Algorithm whitelist (Spec Section 12.2.4) ──────────────────────────────

/**
 * Allowed signature algorithms for AID verification.
 * Prevents algorithm confusion/downgrade attacks (Vector 59).
 * Default: ["EdDSA"]. Operators explicitly add "ML-DSA-44" when ready.
 */
export const ALLOWED_ALGORITHMS: readonly string[] = ['EdDSA', 'Ed25519'];

/**
 * Check if an algorithm is in the allowed whitelist.
 * Returns false for unknown algorithms — verifiers MUST reject documents
 * claiming unsupported algorithms rather than attempting verification.
 */
export function isAlgorithmAllowed(algorithm: string): boolean {
  return ALLOWED_ALGORITHMS.includes(algorithm);
}

/**
 * Negotiate the best mutually-supported algorithm between two parties.
 * Returns the strongest algorithm both support, or null if no overlap.
 *
 * Algorithm strength order (strongest first):
 *   ML-DSA-44 > Ed25519+ML-DSA (hybrid) > EdDSA/Ed25519
 */
export function negotiateAlgorithm(
  localSupported: readonly string[],
  remoteSupported: readonly string[],
): string | null {
  const PREFERENCE_ORDER = ['ML-DSA-44', 'Ed25519+ML-DSA', 'EdDSA', 'Ed25519'];

  for (const algo of PREFERENCE_ORDER) {
    if (localSupported.includes(algo) && remoteSupported.includes(algo)) {
      return algo;
    }
  }
  return null;
}

/**
 * PQC migration status per NIST IR 8547 timeline.
 * Phase 1 (now): Ed25519 only
 * Phase 2 (2027-28): dual-signing Ed25519 + ML-DSA
 * Phase 3 (2029+): ML-DSA required for score 80+
 * Phase 4 (2030+): Ed25519 deprecated
 */
export function getPQCMigrationStatus(): {
  currentPhase: number;
  description: string;
  eddsaStatus: string;
  mldsaStatus: string;
} {
  return {
    currentPhase: 1,
    description: 'Ed25519 only — ML-DSA planned',
    eddsaStatus: 'active',
    mldsaStatus: 'planned',
  };
}
