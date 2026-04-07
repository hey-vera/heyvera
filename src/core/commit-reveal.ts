/**
 * commit-reveal.ts — Commit-Reveal Seed Protocol
 *
 * Prevents self-verification gaming by separating randomness commitment
 * from computation. The platform commits H(seed) before the agent computes,
 * then reveals the seed after the agent commits H(output). The agent cannot
 * predict which elements will be spot-checked.
 *
 * Protocol:
 *   1. Platform generates random seed → commits H(seed)
 *   2. Agent receives task + H(seed) (cannot derive seed)
 *   3. Agent computes result → commits H(output)
 *   4. Platform reveals seed
 *   5. Spot-checks run using seed as PRNG state
 *   6. If any check fails → computation rejected
 *   7. If all pass → certificate signed
 *
 * Ref: internal/heartbeat-fraud-proofs.md §2 (Layer 1)
 */

import { randomBytes, createHmac } from 'crypto';
import { somaHash } from '../utils/crypto-agility';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SeedCommitment {
  /** The commitment H(seed) — shared with the agent before computation */
  commitment: string;
  /** The raw seed — kept secret until after output is committed */
  seed: string;
  /** Timestamp of commitment creation */
  createdAt: string;
}

export interface RevealedSeed {
  /** The original commitment (for verification) */
  commitment: string;
  /** The revealed seed */
  seed: string;
  /** The agent's committed output hash (captured before reveal) */
  outputCommitment: string;
  /** Timestamp of reveal */
  revealedAt: string;
  /** Whether the commitment verified correctly */
  verified: boolean;
}

// ─── Seed Generation ────────────────────────────────────────────────────────

/**
 * Generate a cryptographic seed and its commitment.
 * The commitment is H(seed) where H is the Soma hash function (SHA-256).
 * The seed uses 32 bytes of CSPRNG entropy.
 */
export function generateSeedCommitment(): SeedCommitment {
  const seed = randomBytes(32).toString('hex');
  const commitment = somaHash(seed);
  return {
    commitment,
    seed,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Verify that a revealed seed matches its commitment.
 * This is the agent's check that the platform didn't change the seed post-hoc.
 */
export function verifySeedCommitment(seed: string, commitment: string): boolean {
  return somaHash(seed) === commitment;
}

/**
 * Reveal the seed after the agent has committed their output hash.
 * Returns the full reveal record for audit.
 */
export function revealSeed(
  seedCommitment: SeedCommitment,
  outputCommitment: string,
): RevealedSeed {
  const verified = verifySeedCommitment(seedCommitment.seed, seedCommitment.commitment);
  return {
    commitment: seedCommitment.commitment,
    seed: seedCommitment.seed,
    outputCommitment,
    revealedAt: new Date().toISOString(),
    verified,
  };
}

// ─── Deterministic Selection ────────────────────────────────────────────────

/**
 * Derive deterministic spot-check indices from the revealed seed.
 * Uses HMAC-SHA256(seed, domain) to derive a sub-key, then generates
 * indices mod N. This is a deterministic PRNG seeded by the committed seed.
 *
 * @param seed    — The revealed seed (32 bytes hex)
 * @param domain  — Domain separator (e.g., 'sort-check', 'freivalds-trial-0')
 * @param count   — Number of indices to generate
 * @param max     — Exclusive upper bound (indices are 0..max-1)
 * @returns Array of deterministic indices
 */
export function deriveCheckIndices(
  seed: string,
  domain: string,
  count: number,
  max: number,
): number[] {
  if (max <= 0) return [];
  const indices: number[] = [];
  for (let i = 0; i < count; i++) {
    // HMAC-SHA256(seed, domain:i) → 32 bytes → take first 8 bytes as uint64 → mod max
    const hmac = createHmac('sha256', Buffer.from(seed, 'hex'))
      .update(`${domain}:${i}`)
      .digest();
    // Read first 6 bytes as a 48-bit unsigned int (safe for Number precision)
    const val = hmac.readUIntBE(0, 6);
    indices.push(val % max);
  }
  return indices;
}

/**
 * Derive a random vector element for Freivalds verification.
 * Returns a value in [1, prime-1] for field arithmetic.
 *
 * @param seed    — The revealed seed
 * @param trial   — Trial index (0, 1, 2, ...)
 * @param index   — Vector element index
 * @param prime   — Field prime (default: 2^31 - 1 = Mersenne prime)
 */
export function deriveFreivaldsRandom(
  seed: string,
  trial: number,
  index: number,
  prime = 2147483647, // 2^31 - 1
): number {
  const hmac = createHmac('sha256', Buffer.from(seed, 'hex'))
    .update(`freivalds:${trial}:${index}`)
    .digest();
  const val = hmac.readUIntBE(0, 6);
  // Map to [1, prime-1] — zero would make the check trivially pass
  return (val % (prime - 1)) + 1;
}
