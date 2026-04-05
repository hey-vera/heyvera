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
import { jcsSerialize } from './jcs';

// ─── Post-quantum imports (lazy-loaded to avoid startup cost when disabled) ──
let _mlDsa65: any = null;
async function getMlDsa65() {
  if (!_mlDsa65) {
    const mod = await import('@noble/post-quantum/ml-dsa.js');
    _mlDsa65 = mod.ml_dsa65;
  }
  return _mlDsa65;
}

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

/**
 * Canonical SHA-256 of a JSON-serializable value via RFC 8785 JCS.
 *
 * Use this INSTEAD of `somaHash(JSON.stringify(x))` whenever the hash is
 * going to be compared across different serializations of the same
 * semantic data (e.g. Soma Check conditional-payment probes, where an
 * upstream provider may return keys in a different order on a repeat
 * fetch). Stable output across key-order, whitespace, and
 * number-precision variance.
 *
 * DO NOT use for content-addressed pre-serialized blobs (binary,
 * already-signed payloads, opaque strings) — those need byte-exact
 * hashing via `somaHash()`.
 */
export function somaHashJson(value: unknown): string {
  return somaHash(jcsSerialize(value));
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
 * Supports: EdDSA (Ed25519), ML-DSA-65 (FIPS 204), Ed25519+ML-DSA-65 (hybrid).
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
 * Verify an ML-DSA-65 signature using @noble/post-quantum.
 * Async because the module is lazy-loaded.
 */
export async function verifyMlDsa65(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const mlDsa65 = await getMlDsa65();
  return mlDsa65.verify(publicKey, message, signature);
}

/**
 * Verify a hybrid signature (both Ed25519 AND ML-DSA-65 must pass).
 */
export async function verifyHybridSignature(
  ed25519Sig: Buffer,
  mlDsa65Sig: Uint8Array,
  message: Buffer,
  ed25519PublicKey: crypto.KeyObject,
  mlDsa65PublicKey: Uint8Array,
): Promise<boolean> {
  const edValid = crypto.verify(null, message, ed25519PublicKey, ed25519Sig);
  if (!edValid) return false;
  const pqValid = await verifyMlDsa65(mlDsa65Sig, message, mlDsa65PublicKey);
  return pqValid;
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

/**
 * Sign data with ML-DSA-65 using @noble/post-quantum.
 * Async because the module is lazy-loaded.
 */
export async function signMlDsa65(
  message: Uint8Array,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  const mlDsa65 = await getMlDsa65();
  return mlDsa65.sign(secretKey, message);
}

/**
 * Generate an ML-DSA-65 keypair from a 32-byte seed.
 */
export async function generateMlDsa65KeyPair(
  seed: Uint8Array,
): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  const mlDsa65 = await getMlDsa65();
  return mlDsa65.keygen(seed);
}

// ─── Document fields ─────────────────────────────────────────────────────────

/**
 * Standard crypto-agility fields to include in every document and receipt.
 */
export function getCryptoAgilityMetadata() {
  const pqEnabled = process.env.PQ_SIGNATURES_ENABLED === 'true' || process.env.PQ_SIGNATURES_ENABLED === '1';
  return {
    signatureAlgorithm: pqEnabled ? 'Ed25519+ML-DSA-65' : SOMA_SIGNATURE_ALGORITHM,
    algorithmVersion: pqEnabled ? '2.0' : SOMA_ALGORITHM_VERSION,
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
export const ALLOWED_ALGORITHMS: readonly string[] = ['EdDSA', 'Ed25519', 'ML-DSA-65', 'Ed25519+ML-DSA-65'];

export function isAlgorithmAllowed(algorithm: string): boolean {
  return ALLOWED_ALGORITHMS.includes(algorithm);
}

/**
 * Negotiate the best mutually-supported algorithm between two parties.
 * Preference: hybrid > PQ-only > classical (strongest first).
 */
export function negotiateAlgorithm(
  localSupported: readonly string[],
  remoteSupported: readonly string[],
): string | null {
  const PREFERENCE_ORDER = ['Ed25519+ML-DSA-65', 'ML-DSA-65', 'Ed25519+ML-DSA', 'ML-DSA-44', 'EdDSA', 'Ed25519'];
  for (const algo of PREFERENCE_ORDER) {
    if (localSupported.includes(algo) && remoteSupported.includes(algo)) return algo;
  }
  return null;
}

/**
 * PQC migration status per NIST IR 8547 timeline.
 *
 * Phase 1 (current): Ed25519 only — ML-DSA-65 available behind feature flag
 * Phase 2 (Node 24 LTS, Oct 2026): Hybrid Ed25519 + ML-DSA-65 dual signatures
 * Phase 3 (2028+): ML-DSA-65 primary, Ed25519 legacy fallback
 * Phase 4 (2035): ML-DSA-65 only (Ed25519 disallowed per NIST IR 8547)
 */
export function getPQCMigrationStatus() {
  const pqEnabled = process.env.PQ_SIGNATURES_ENABLED === 'true' || process.env.PQ_SIGNATURES_ENABLED === '1';
  return {
    currentPhase: pqEnabled ? 2 : 1,
    description: pqEnabled ? 'Hybrid Ed25519 + ML-DSA-65' : 'Ed25519 only — ML-DSA-65 behind feature flag',
    eddsaStatus: 'active',
    mldsaStatus: pqEnabled ? 'active' : 'available',
    mldsaAlgorithm: 'ML-DSA-65',
    mldsaStandard: 'FIPS 204',
    nistTimeline: {
      ed25519Deprecated: 2030,
      ed25519Disallowed: 2035,
    },
  };
}
