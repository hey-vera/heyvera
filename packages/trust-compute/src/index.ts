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
