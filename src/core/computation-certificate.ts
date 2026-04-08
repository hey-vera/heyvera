/**
 * computation-certificate.ts — Computation Certificate
 *
 * New certificate type that binds spot-check results + commit-reveal proof
 * to the original birth certificate. Follows the same hash-chaining pattern
 * as cache-certificate.ts.
 *
 * A computation certificate proves:
 *   1. The platform committed randomness BEFORE the computation
 *   2. The agent committed output BEFORE the seed was revealed
 *   3. Spot-checks ran with the committed seed and all passed
 *   4. The certificate is signed by the platform's Ed25519 key
 *
 * Ref: internal/heartbeat-fraud-proofs.md §7
 */

import { nanoid } from 'nanoid';
import nacl from 'tweetnacl';
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { somaHash } from '../utils/crypto-agility';
import { jcsSerialize } from '../utils/jcs';
import { derivePlatformSeed } from '../utils/ed25519-signer';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';
import type { ComputationClass, ProbabilityModel } from './computation-types';
import type { SpotCheckResult } from './spot-check';
import { calculateBondRequirement, challengeWindowEnd } from './bond-economics';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ComputationCertificate {
  id: string;
  requestId: string;

  // Computation description
  computationType: string;
  computationClass: ComputationClass;
  inputHash: string;
  outputHash: string;

  // Commit-reveal attestation
  seedCommitment: string;
  seed: string;
  outputCommitment: string;

  // Spot-check results
  spotChecks: SpotCheckResult[];
  allSpotChecksPassed: boolean;

  // Birth cert binding
  birthCertHash: string | null;

  // Platform signature
  signature: string;
  publicKey: string;
  algorithm: string;

  // Chain hash (binds everything together)
  chainHash: string;

  // Economic — tiered bonds per heartbeat-fraud-proofs.md §5
  bondTier: 0 | 1 | 2 | 3;
  bondAmount: number;
  bondCurrency: 'credits' | 'SOL' | 'USDC';
  challengeWindowEnd: string | null;
  finalized: boolean;

  // Timing
  createdAt: string;
}

export interface CreateComputationCertOpts {
  requestId: string;
  computationType: string;
  computationClass: ComputationClass;
  inputHash: string;
  outputHash: string;
  seedCommitment: string;
  seed: string;
  outputCommitment: string;
  spotChecks: SpotCheckResult[];
  birthCertHash?: string | null;
  /** Credits cost for bond tier calculation. Defaults to 0 (Tier 0). */
  creditsCost?: number;
}

// ─── Certificate Creation ───────────────────────────────────────────────────

/**
 * Create a computation certificate — platform signs the spot-check attestation.
 * Returns null if any spot-check failed (refuse to certify bad computation).
 */
export function createComputationCertificate(
  opts: CreateComputationCertOpts,
): ComputationCertificate | null {
  const allPassed = opts.spotChecks.every(sc => sc.passed);

  if (!allPassed) {
    logger.warn({
      requestId: opts.requestId,
      computationType: opts.computationType,
      failedChecks: opts.spotChecks.filter(sc => !sc.passed).map(sc => sc.checkName),
    }, 'Spot-check failed — refusing to issue computation certificate');
    return null;
  }

  const id = nanoid();
  const now = new Date().toISOString();

  // Build chain hash: binds all fields together canonically
  const chainPayload = jcsSerialize({
    requestId: opts.requestId,
    computationType: opts.computationType,
    computationClass: opts.computationClass,
    inputHash: opts.inputHash,
    outputHash: opts.outputHash,
    seedCommitment: opts.seedCommitment,
    outputCommitment: opts.outputCommitment,
    spotChecksPassed: allPassed,
    birthCertHash: opts.birthCertHash ?? null,
  });
  const chainHash = somaHash(chainPayload);

  // Platform signs the chain hash
  const keyPair = getPlatformKeyPair();
  const chainHashBytes = Buffer.from(chainHash, 'hex');
  const signature = Buffer.from(
    nacl.sign.detached(new Uint8Array(chainHashBytes), keyPair.secretKey),
  ).toString('hex');
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');

  // Calculate bond requirement from credit cost
  const bondReq = calculateBondRequirement(opts.creditsCost ?? 0);
  const windowEnd = bondReq.challengeWindowHours > 0
    ? challengeWindowEnd(bondReq.challengeWindowHours)
    : null;

  const cert: ComputationCertificate = {
    id,
    requestId: opts.requestId,
    computationType: opts.computationType,
    computationClass: opts.computationClass,
    inputHash: opts.inputHash,
    outputHash: opts.outputHash,
    seedCommitment: opts.seedCommitment,
    seed: opts.seed,
    outputCommitment: opts.outputCommitment,
    spotChecks: opts.spotChecks,
    allSpotChecksPassed: allPassed,
    birthCertHash: opts.birthCertHash ?? null,
    signature,
    publicKey,
    algorithm: 'Ed25519',
    chainHash,
    bondTier: bondReq.tier,
    bondAmount: bondReq.bondAmount,
    bondCurrency: bondReq.bondCurrency,
    challengeWindowEnd: windowEnd,
    finalized: bondReq.tier === 0, // Tier 0 = instant finality (spot-checks only)
    createdAt: now,
  };

  // Persist to DB
  try {
    getDb().prepare(`
      INSERT INTO computation_certificates (
        id, request_id, computation_type, computation_class,
        input_hash, output_hash, seed_commitment, seed, output_commitment,
        spot_checks_json, all_passed, birth_cert_hash,
        signature, public_key, algorithm, chain_hash,
        bond_tier, bond_amount, bond_currency,
        challenge_window_end, finalized, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cert.id, cert.requestId, cert.computationType, cert.computationClass,
      cert.inputHash, cert.outputHash, cert.seedCommitment, cert.seed, cert.outputCommitment,
      JSON.stringify(cert.spotChecks), cert.allSpotChecksPassed ? 1 : 0, cert.birthCertHash,
      cert.signature, cert.publicKey, cert.algorithm, cert.chainHash,
      cert.bondTier, cert.bondAmount, cert.bondCurrency,
      cert.challengeWindowEnd, cert.finalized ? 1 : 0, cert.createdAt,
    );
  } catch (err) {
    logger.error({ err, requestId: opts.requestId }, 'Failed to persist computation certificate');
  }

  return cert;
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify a computation certificate's platform signature and chain hash.
 * Does NOT re-run spot-checks — that requires the original input/output data.
 */
export function verifyComputationCertificate(cert: ComputationCertificate): {
  signatureValid: boolean;
  chainHashValid: boolean;
  seedCommitmentValid: boolean;
} {
  // Reconstruct chain hash
  const chainPayload = jcsSerialize({
    requestId: cert.requestId,
    computationType: cert.computationType,
    computationClass: cert.computationClass,
    inputHash: cert.inputHash,
    outputHash: cert.outputHash,
    seedCommitment: cert.seedCommitment,
    outputCommitment: cert.outputCommitment,
    spotChecksPassed: cert.allSpotChecksPassed,
    birthCertHash: cert.birthCertHash,
  });
  const expectedChainHash = somaHash(chainPayload);
  const chainHashValid = expectedChainHash === cert.chainHash;

  // Verify platform signature over chain hash (Node native crypto — OpenSSL-backed)
  let signatureValid = false;
  try {
    const chainHashBytes = Buffer.from(cert.chainHash, 'hex');
    const sig = Buffer.from(cert.signature, 'hex');
    const pubKey = Buffer.from(cert.publicKey, 'hex');
    signatureValid = nativeEd25519Verify(chainHashBytes, sig, pubKey);
  } catch {
    signatureValid = false;
  }

  // Verify seed commitment: H(seed) === commitment
  const seedCommitmentValid = somaHash(cert.seed) === cert.seedCommitment;

  return { signatureValid, chainHashValid, seedCommitmentValid };
}

// ─── Lookup ─────────────────────────────────────────────────────────────────

/** Get a computation certificate by request ID. */
export function getComputationCertificate(requestId: string): ComputationCertificate | null {
  const row = getDb().prepare(
    'SELECT * FROM computation_certificates WHERE request_id = ? ORDER BY created_at DESC LIMIT 1',
  ).get(requestId) as any;
  if (!row) return null;

  return {
    id: row.id,
    requestId: row.request_id,
    computationType: row.computation_type,
    computationClass: row.computation_class,
    inputHash: row.input_hash,
    outputHash: row.output_hash,
    seedCommitment: row.seed_commitment,
    seed: row.seed,
    outputCommitment: row.output_commitment,
    spotChecks: JSON.parse(row.spot_checks_json || '[]'),
    allSpotChecksPassed: !!row.all_passed,
    birthCertHash: row.birth_cert_hash,
    signature: row.signature,
    publicKey: row.public_key,
    algorithm: row.algorithm,
    chainHash: row.chain_hash,
    bondTier: row.bond_tier,
    bondAmount: row.bond_amount,
    bondCurrency: row.bond_currency ?? 'credits',
    challengeWindowEnd: row.challenge_window_end ?? null,
    finalized: !!row.finalized,
    createdAt: row.created_at,
  };
}

/** Get a computation certificate by its ID (not request ID). */
export function getComputationCertificateById(certId: string): ComputationCertificate | null {
  const row = getDb().prepare(
    'SELECT * FROM computation_certificates WHERE id = ? LIMIT 1',
  ).get(certId) as any;
  if (!row) return null;

  return {
    id: row.id,
    requestId: row.request_id,
    computationType: row.computation_type,
    computationClass: row.computation_class,
    inputHash: row.input_hash,
    outputHash: row.output_hash,
    seedCommitment: row.seed_commitment,
    seed: row.seed,
    outputCommitment: row.output_commitment,
    spotChecks: JSON.parse(row.spot_checks_json || '[]'),
    allSpotChecksPassed: !!row.all_passed,
    birthCertHash: row.birth_cert_hash,
    signature: row.signature,
    publicKey: row.public_key,
    algorithm: row.algorithm,
    chainHash: row.chain_hash,
    bondTier: row.bond_tier,
    bondAmount: row.bond_amount,
    bondCurrency: row.bond_currency ?? 'credits',
    challengeWindowEnd: row.challenge_window_end ?? null,
    finalized: !!row.finalized,
    createdAt: row.created_at,
  };
}

// ─── Platform Key (cached) ──────────────────────────────────────────────────

let _cachedKeyPair: nacl.SignKeyPair | null = null;

function getPlatformKeyPair(): nacl.SignKeyPair {
  if (_cachedKeyPair) return _cachedKeyPair;
  const seed = derivePlatformSeed('ed25519-platform');
  _cachedKeyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
  return _cachedKeyPair;
}

// DER prefix for Ed25519 SPKI public key
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify Ed25519 signature using Node native crypto (OpenSSL-backed).
 * ~10x faster than TweetNaCl pure-JS verification.
 */
function nativeEd25519Verify(message: Buffer, sig: Buffer, pubKeyRaw: Buffer): boolean {
  const spkiKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, pubKeyRaw]),
    format: 'der',
    type: 'spki',
  });
  return cryptoVerify(null, message, spkiKey, sig);
}
