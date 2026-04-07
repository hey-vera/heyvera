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
import { somaHash } from '../utils/crypto-agility';
import { jcsSerialize } from '../utils/jcs';
import { derivePlatformSeed } from '../utils/ed25519-signer';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';
import type { ComputationClass, ProbabilityModel } from './computation-types';
import type { SpotCheckResult } from './spot-check';

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

  // Economic (Phase C — stubs for now)
  bondTier: 0 | 1 | 2 | 3;
  bondCredits: number;

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
    bondTier: 0,
    bondCredits: 0,
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
        bond_tier, bond_credits, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cert.id, cert.requestId, cert.computationType, cert.computationClass,
      cert.inputHash, cert.outputHash, cert.seedCommitment, cert.seed, cert.outputCommitment,
      JSON.stringify(cert.spotChecks), cert.allSpotChecksPassed ? 1 : 0, cert.birthCertHash,
      cert.signature, cert.publicKey, cert.algorithm, cert.chainHash,
      cert.bondTier, cert.bondCredits, cert.createdAt,
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

  // Verify platform signature over chain hash
  let signatureValid = false;
  try {
    const chainHashBytes = Buffer.from(cert.chainHash, 'hex');
    const sig = Buffer.from(cert.signature, 'hex');
    const pubKey = Buffer.from(cert.publicKey, 'hex');
    signatureValid = nacl.sign.detached.verify(
      new Uint8Array(chainHashBytes),
      new Uint8Array(sig),
      new Uint8Array(pubKey),
    );
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
    bondCredits: row.bond_credits,
    createdAt: row.created_at,
  };
}

// ─── Platform Key ───────────────────────────────────────────────────────────

function getPlatformKeyPair(): nacl.SignKeyPair {
  const seed = derivePlatformSeed('ed25519-platform');
  return nacl.sign.keyPair.fromSeed(new Uint8Array(seed));
}
