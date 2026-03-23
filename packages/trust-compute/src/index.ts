/**
 * @aidprotocol/trust-compute — Standalone AID trust scoring library
 *
 * Deterministic trust score computation for AI agents.
 * No dependencies. No database. Pure computation.
 *
 * Given attestation stats, produces a trust score + cryptographic proof hash.
 * Anyone can run this to independently verify scores published by any AID oracle.
 *
 * Uses SHA-384 for proof hashes (quantum-resistant, NIST PQC migration ready).
 * Algorithm-agile: hashAlgorithm field in output enables future migration.
 *
 * @license MIT
 * @see https://claw-net.org
 */

import { createHash } from 'crypto';

/** Hash algorithm used for proof hashes. SHA-384 for quantum resistance. */
export const HASH_ALGORITHM = 'sha384';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrustStats {
  /** Success rate (0-1). From attestation_stats.success_count / total. */
  successRate: number;
  /** Hash-chain integrity percentage (0-1). */
  chainCoverage: number;
  /** Total attestation count. Normalized to 0-1 via min(count/1000, 1). */
  attestationCount: number;
  /** Manifest adherence (0-1). manifest_aligned / (aligned + unaligned). */
  manifestAdherence: number;
}

export interface TrustWeights {
  successRate: number;
  chainCoverage: number;
  volume: number;
  manifestAdherence: number;
}

export interface TrustScoreProof {
  /** Computed trust score (0-100). */
  score: number;
  /** The input stats used for computation. */
  inputs: TrustStats;
  /** The weights applied to each dimension. */
  weights: TrustWeights;
  /** SHA-384 hash of JCS-canonicalized {inputs, weights, score}. */
  proofHash: string;
  /** Formula version identifier. */
  formulaVersion: string;
  /** Hash algorithm used for proof hash (for algorithm agility). */
  hashAlgorithm: string;
}

export type TrustVerdict = 'new' | 'building' | 'caution' | 'standard' | 'trusted' | 'proceed';

export interface TrustVerdictResult {
  verdict: TrustVerdict;
  discount: number;
  settlementMode: 'immediate' | 'standard' | 'batched' | 'deferred';
}

// ─── Signing Interface ──────────────────────────────────────────────────────

/** Supported signing algorithms. Ed25519 is the default. ML-DSA for PQC migration. */
export type SigningAlgorithm = 'Ed25519' | 'ML-DSA-65' | 'SLH-DSA';

/** Supported hash algorithms. SHA-384 is the default. */
export type HashAlgorithm = 'sha384' | 'sha256' | 'sha3-256';

/**
 * Abstract signing interface for AID protocol operations.
 *
 * All AID signing (attestations, manifests, receipts, revocations) goes
 * through this interface. The private key MUST NOT be exposed to the caller.
 *
 * Implementations:
 * - TestSigner: in-memory keys for unit tests (ships with trust-compute)
 * - @aidprotocol/signer-ows: Open Wallet Standard adapter (recommended for production)
 * - Custom: HSM, KMS, TEE, or any other key management
 */
export interface AidSigner {
  /** The agent's DID (derived from public key) */
  readonly did: string;

  /** Which signing algorithm this signer uses */
  readonly algorithm: SigningAlgorithm;

  /** Which hash algorithm this signer uses */
  readonly hashAlgorithm: HashAlgorithm;

  /**
   * Sign canonical bytes. The private key MUST NOT be exposed
   * to the caller. Returns base64url-encoded signature.
   */
  sign(canonicalBytes: Uint8Array): Promise<string>;

  /**
   * Verify a signature against canonical bytes and a public key.
   * Stateless — uses public key only, no private key access needed.
   */
  verify(
    canonicalBytes: Uint8Array,
    signature: string,
    publicKeyMultibase: string,
  ): Promise<boolean>;

  /** Get the public key in multibase format for DID resolution. */
  getPublicKeyMultibase(): string;
}

// ─── Test Signer ────────────────────────────────────────────────────────────

/**
 * In-memory Ed25519 signer for testing. Keys are held in plain memory.
 * DO NOT use in production — no key protection.
 *
 * @example
 * ```typescript
 * const signer = TestSigner.generate();
 * const sig = await signer.sign(new TextEncoder().encode('hello'));
 * const valid = await signer.verify(
 *   new TextEncoder().encode('hello'),
 *   sig,
 *   signer.getPublicKeyMultibase()
 * );
 * ```
 */
export class TestSigner implements AidSigner {
  readonly did: string;
  readonly algorithm: SigningAlgorithm = 'Ed25519';
  readonly hashAlgorithm: HashAlgorithm = 'sha384';
  private readonly privateKey: ReturnType<typeof import('crypto').createPrivateKey>;
  private readonly publicKeyRaw: Buffer;

  private constructor(
    privateKey: ReturnType<typeof import('crypto').createPrivateKey>,
    publicKeyRaw: Buffer,
  ) {
    this.privateKey = privateKey;
    this.publicKeyRaw = publicKeyRaw;
    // did:key with Ed25519 multicodec prefix (0xed01)
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), publicKeyRaw]);
    this.did = 'did:key:z' + base58btcEncode(multicodec);
  }

  /** Generate a new random Ed25519 keypair for testing. */
  static generate(): TestSigner {
    const { generateKeyPairSync, createPrivateKey } = require('crypto') as typeof import('crypto');
    const keypair = generateKeyPairSync('ed25519');
    const privateKey = keypair.privateKey;
    // Extract raw 32-byte public key from DER
    const spki = keypair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const publicKeyRaw = spki.subarray(spki.length - 32);
    return new TestSigner(privateKey, publicKeyRaw);
  }

  /** Create from an existing seed (deterministic for test reproducibility). */
  static fromSeed(seed: Buffer): TestSigner {
    const { createPrivateKey, createPublicKey } = require('crypto') as typeof import('crypto');
    // Ed25519 PKCS8 DER prefix for a 32-byte seed
    const pkcs8Prefix = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
      0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ]);
    const der = Buffer.concat([pkcs8Prefix, seed.subarray(0, 32)]);
    const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const publicKey = createPublicKey(privateKey);
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const publicKeyRaw = spki.subarray(spki.length - 32);
    return new TestSigner(privateKey, publicKeyRaw);
  }

  async sign(canonicalBytes: Uint8Array): Promise<string> {
    const { sign } = require('crypto') as typeof import('crypto');
    const sig = sign(null, Buffer.from(canonicalBytes), this.privateKey);
    return base64urlEncode(sig);
  }

  async verify(
    canonicalBytes: Uint8Array,
    signature: string,
    publicKeyMultibase: string,
  ): Promise<boolean> {
    const { verify, createPublicKey } = require('crypto') as typeof import('crypto');
    const decoded = base58btcDecode(publicKeyMultibase.slice(1)); // remove 'z' prefix
    const rawKey = decoded.subarray(2); // remove multicodec prefix (0xed01)
    // Build SPKI DER for Ed25519
    const spkiPrefix = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const spki = Buffer.concat([spkiPrefix, rawKey]);
    const pubkey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return verify(null, Buffer.from(canonicalBytes), pubkey, base64urlDecode(signature));
  }

  getPublicKeyMultibase(): string {
    const multicodec = Buffer.concat([Buffer.from([0xed, 0x01]), this.publicKeyRaw]);
    return 'z' + base58btcEncode(multicodec);
  }
}

// ─── Encoding Utilities ─────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58btcEncode(data: Buffer): string {
  let num = BigInt('0x' + data.toString('hex'));
  let result = '';
  while (num > 0n) {
    const mod = Number(num % 58n);
    result = BASE58_ALPHABET[mod] + result;
    num = num / 58n;
  }
  for (let i = 0; i < data.length && data[i] === 0; i++) {
    result = '1' + result;
  }
  return result || '1';
}

function base58btcDecode(str: string): Buffer {
  let num = 0n;
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(2, '0');
  const bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  let leadingZeros = 0;
  for (const char of str) {
    if (char !== '1') break;
    leadingZeros++;
  }
  return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
}

function base64urlEncode(data: Buffer): string {
  return data.toString('base64url');
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Current formula version. Middleware MUST pin to this. */
export const FORMULA_VERSION = '1.0.0';

/** Default weights for the 4-dimension trust formula. */
export const DEFAULT_WEIGHTS: TrustWeights = {
  successRate: 40,
  chainCoverage: 25,
  volume: 20,
  manifestAdherence: 15,
};

// ─── JCS Canonicalization (RFC 8785) ────────────────────────────────────────

/**
 * JSON Canonicalization Scheme (RFC 8785): deterministic JSON serialization.
 * - Object keys sorted lexicographically (Unicode code point order)
 * - No whitespace
 * - Numbers serialized per ES2015 Number.toString()
 * - undefined values omitted
 */
export function jcsSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('JCS: non-finite numbers not supported');
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(jcsSerialize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter(k => obj[k] !== undefined)
      .sort();
    const entries = keys.map(k => JSON.stringify(k) + ':' + jcsSerialize(obj[k]));
    return '{' + entries.join(',') + '}';
  }
  return '';
}

// ─── Core Computation ───────────────────────────────────────────────────────

/**
 * Compute trust score from attestation stats with cryptographic proof.
 *
 * This is the canonical AID trust scoring function. Given identical inputs,
 * every implementation MUST produce identical outputs. The proof hash
 * enables independent verification.
 *
 * @param stats - Attestation statistics (successRate, chainCoverage, attestationCount, manifestAdherence)
 * @param weights - Optional custom weights (defaults to DEFAULT_WEIGHTS)
 * @returns Trust score (0-100), inputs, weights, and SHA-384 proof hash
 */
export function computeTrustScore(
  stats: TrustStats,
  weights: TrustWeights = DEFAULT_WEIGHTS,
): TrustScoreProof {
  // Normalize volume: min(attestationCount / 1000, 1)
  const volumeScore = Math.min(stats.attestationCount / 1000, 1);

  // manifestAdherence defaults to 0.5 (neutral) if no manifests checked
  const manifestScore =
    stats.manifestAdherence > 0 || stats.attestationCount > 0
      ? stats.manifestAdherence
      : 0.5;

  // Weighted sum, rounded to integer
  const score = Math.round(
    stats.successRate * weights.successRate +
    stats.chainCoverage * weights.chainCoverage +
    Math.min(volumeScore, 1) * weights.volume +
    manifestScore * weights.manifestAdherence,
  );

  // Clamp to 0-100
  const clampedScore = Math.max(0, Math.min(100, score));

  // Proof hash = SHA-384 of JCS-canonicalized {inputs, weights, score}
  const proofData = { inputs: stats, weights, score: clampedScore };
  const canonical = jcsSerialize(proofData);
  const proofHash = createHash(HASH_ALGORITHM).update(canonical).digest('hex');

  return {
    score: clampedScore,
    inputs: stats,
    weights,
    proofHash,
    formulaVersion: FORMULA_VERSION,
    hashAlgorithm: HASH_ALGORITHM,
  };
}

/**
 * Derive trust verdict from score.
 * Verdicts determine pricing tier and settlement mode.
 */
export function getTrustVerdict(score: number): TrustVerdictResult {
  if (score >= 90) return { verdict: 'proceed', discount: 0.30, settlementMode: 'deferred' };
  if (score >= 80) return { verdict: 'trusted', discount: 0.25, settlementMode: 'batched' };
  if (score >= 60) return { verdict: 'standard', discount: 0.20, settlementMode: 'batched' };
  if (score >= 40) return { verdict: 'caution', discount: 0.10, settlementMode: 'standard' };
  if (score >= 20) return { verdict: 'building', discount: 0, settlementMode: 'immediate' };
  return { verdict: 'new', discount: 0, settlementMode: 'immediate' };
}

/**
 * Verify a trust score proof hash.
 * Recomputes the score from inputs and checks the proof hash matches.
 *
 * @returns true if the proof is valid (score was computed correctly from inputs)
 */
export function verifyTrustProof(proof: TrustScoreProof): boolean {
  const recomputed = computeTrustScore(proof.inputs, proof.weights);
  return recomputed.proofHash === proof.proofHash && recomputed.score === proof.score;
}
