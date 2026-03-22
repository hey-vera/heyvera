/**
 * aid-verifier.ts — Offline verification of AID documents and portable trust chains
 *
 * Pure cryptographic verification with ZERO database calls and no network I/O.
 * Only depends on Node.js crypto module + shared JCS/base58btc utilities.
 */

import crypto from 'crypto';
import { jcsSerialize, base58btcDecode } from './jcs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  trustScore: number;
  warnings: string[];
  details: {
    platformSignature: boolean;
    merkleRoot: boolean;
    trustScoreMatch: boolean;
    chainIntegrity: boolean;
    expired: boolean;
    attestationsVerified: number;
  };
}

export interface TrustChainVerifyResult {
  valid: boolean;
  attestationsVerified: number;
  merkleRootMatch: boolean;
  chainContiguous: boolean;
  warnings: string[];
}

export interface TrustScoreVerifyResult {
  valid: boolean;
  computedScore: number;
  claimedScore: number;
}

// ─── Merkle proof verification (standalone, matches merkle-anchor.ts) ──────

function hashPair(a: string, b: string): string {
  const [left, right] = a < b ? [a, b] : [b, a];
  return crypto.createHash('sha256').update(left + right).digest('hex');
}

function verifyMerkleProof(
  hash: string,
  proof: { sibling: string; promoted: boolean }[],
  root: string,
): boolean {
  if (proof.length === 0) return hash === root;

  let current = hash;
  for (const step of proof) {
    if (step.promoted) continue;
    current = hashPair(current, step.sibling);
  }
  return current === root;
}

/**
 * Attempt to verify an Ed25519 signature on JCS-canonicalized data.
 * Returns true if verified, false if verification fails or key is invalid.
 */
function verifyEd25519Signature(
  data: Record<string, unknown>,
  proofValue: string,
  publicKeyMultibase: string,
): boolean {
  try {
    // Decode multibase (z prefix = base58btc)
    if (!publicKeyMultibase.startsWith('z')) return false;
    const decoded = base58btcDecode(publicKeyMultibase.slice(1));

    // Multikey prefix for Ed25519: 0xed 0x01
    if (decoded.length < 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) return false;
    const rawPub = decoded.subarray(2);

    // Build SPKI DER: 12-byte header + 32-byte key
    const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
    const spki = Buffer.concat([spkiHeader, rawPub]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    // JCS canonicalize -> SHA-256 -> verify Ed25519
    const canonical = Buffer.from(jcsSerialize(data), 'utf8');
    const hash = crypto.createHash('sha256').update(canonical).digest();
    return crypto.verify(null, hash, pubKey, Buffer.from(proofValue, 'base64url'));
  } catch {
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Verify an AID document offline. Pure cryptographic verification.
 * Checks: platform signature, Merkle root format, trust score computation, expiry.
 *
 * If platformPublicKey is provided, the platform countersignature is verified
 * cryptographically. Without it, signature verification is skipped with a warning.
 */
export function verifyAIDDocument(aidDoc: any, platformPublicKey?: string): VerifyResult {
  const warnings: string[] = [];
  const details = {
    platformSignature: false,
    merkleRoot: false,
    trustScoreMatch: false,
    chainIntegrity: false,
    expired: false,
    attestationsVerified: 0,
  };

  if (!aidDoc || typeof aidDoc !== 'object') {
    return { valid: false, trustScore: 0, warnings: ['Invalid AID document'], details };
  }

  // Check document type
  if (aidDoc.type !== 'AgentIdentityDocument') {
    warnings.push('Unexpected document type: ' + aidDoc.type);
  }

  // Check expiry
  if (aidDoc.issuance?.expiresAt) {
    const expiry = new Date(aidDoc.issuance.expiresAt);
    if (expiry <= new Date()) {
      details.expired = true;
      warnings.push('AID document has expired');
    }
  } else {
    warnings.push('No expiry date found');
  }

  // Verify platform countersignature
  const proof = aidDoc.proof?.platformCountersignature;
  if (proof?.proofValue) {
    // Reconstruct the document without proof for signature verification
    const docWithoutProof = { ...aidDoc };
    delete docWithoutProof.proof;

    if (platformPublicKey) {
      details.platformSignature = verifyEd25519Signature(
        docWithoutProof, proof.proofValue, platformPublicKey,
      );
      if (!details.platformSignature) {
        warnings.push('Platform signature verification failed');
      }
    } else {
      // Cannot verify without the platform public key
      warnings.push('Platform public key not provided; signature not verified');
    }
  } else {
    warnings.push('No platform countersignature found');
  }

  // Verify Merkle root format (64 hex chars = SHA-256)
  const merkleRoot = aidDoc.trustChain?.merkleRoot;
  if (typeof merkleRoot === 'string' && /^[0-9a-f]{64}$/.test(merkleRoot)) {
    details.merkleRoot = true;
  } else {
    warnings.push('Invalid or missing Merkle root');
  }

  // Verify trust score computation
  const trustScore = aidDoc.trustScore;
  const chainStats = aidDoc.trustChain?.stats;
  if (trustScore && chainStats) {
    const verification = verifyTrustScore(trustScore);
    details.trustScoreMatch = verification.valid;
    if (!verification.valid) {
      warnings.push(
        `Trust score mismatch: claimed ${verification.claimedScore}, computed ${verification.computedScore}`
      );
    }
  } else {
    warnings.push('Missing trust score or chain stats');
  }

  // Check chain integrity (attestationCount > 0 with chainLength > 0)
  const attCount = aidDoc.trustChain?.attestationCount ?? 0;
  const chainLen = aidDoc.trustChain?.chainLength ?? 0;
  if (attCount > 0) {
    details.chainIntegrity = chainLen >= 0 && chainLen <= attCount;
    details.attestationsVerified = attCount;
    if (chainLen > attCount) {
      warnings.push('Chain length exceeds attestation count');
    }
  } else {
    details.chainIntegrity = true; // No attestations is valid for new agents
  }

  // Valid requires: not expired, valid Merkle root, matching trust score, chain integrity
  // Platform signature is checked but NOT required for validity (supports offline/cross-platform)
  const valid = !details.expired && details.merkleRoot && details.trustScoreMatch && details.chainIntegrity;

  return {
    valid,
    trustScore: trustScore?.score ?? 0,
    warnings,
    details,
  };
}

/**
 * Verify a portable trust chain offline.
 * Checks: Merkle proofs for each attestation, chain contiguity, root matches.
 */
export function verifyPortableTrustChain(chain: any): TrustChainVerifyResult {
  const warnings: string[] = [];
  let attestationsVerified = 0;
  let merkleRootMatch = true;
  let chainContiguous = true;

  if (!chain || typeof chain !== 'object') {
    return { valid: false, attestationsVerified: 0, merkleRootMatch: false, chainContiguous: false, warnings: ['Invalid trust chain'] };
  }

  const attestations = chain.attestations;
  if (!Array.isArray(attestations) || attestations.length === 0) {
    return { valid: true, attestationsVerified: 0, merkleRootMatch: true, chainContiguous: true, warnings: ['No attestations in chain'] };
  }

  const merkleRoot = chain.merkleRoot;
  if (!merkleRoot || typeof merkleRoot !== 'string') {
    warnings.push('Missing Merkle root');
    merkleRootMatch = false;
  }

  // Verify Merkle proofs for each attestation
  for (const att of attestations) {
    if (att.merkleProof && merkleRoot) {
      const hash = crypto.createHash('sha256').update(att.id).digest('hex');
      const proofValid = verifyMerkleProof(hash, att.merkleProof, merkleRoot);
      if (proofValid) {
        attestationsVerified++;
      } else {
        merkleRootMatch = false;
        warnings.push(`Merkle proof failed for attestation ${att.id}`);
      }
    } else if (!att.merkleProof) {
      warnings.push(`No Merkle proof for attestation ${att.id}`);
    }
  }

  // Check chain contiguity: each attestation's prevAttestationHash should reference
  // the hash of the previous attestation in the chain (by creation order).
  // Attestations are ordered DESC (most recent first), so reverse for contiguity check.
  const ordered = [...attestations].reverse();
  for (let i = 1; i < ordered.length; i++) {
    const current = ordered[i];
    const previous = ordered[i - 1];
    if (current.prevAttestationHash) {
      const expectedHash = crypto.createHash('sha256').update(previous.id).digest('hex');
      if (current.prevAttestationHash !== expectedHash && current.prevAttestationHash !== previous.id) {
        chainContiguous = false;
        warnings.push(`Chain break at attestation ${current.id}: prevAttestationHash does not match previous`);
      }
    }
  }

  const valid = merkleRootMatch && chainContiguous;

  return { valid, attestationsVerified, merkleRootMatch, chainContiguous, warnings };
}

/**
 * Recompute trust score from inputs and verify it matches.
 */
export function verifyTrustScore(trustScore: any): TrustScoreVerifyResult {
  if (!trustScore || typeof trustScore !== 'object' || !trustScore.inputs) {
    return { valid: false, computedScore: 0, claimedScore: 0 };
  }

  const { inputs, weights, score: claimedScore } = trustScore;
  const successRate = inputs.successRate ?? 0;
  const chainCoverage = inputs.chainCoverage ?? 0;
  const attestationCount = inputs.attestationCount ?? 0;
  const manifestAdherence = inputs.manifestAdherence ?? 0;

  const wSuccessRate = weights?.successRate ?? 40;
  const wChainCoverage = weights?.chainCoverage ?? 25;
  const wVolume = weights?.volume ?? 20;
  const wManifestAdherence = weights?.manifestAdherence ?? 15;

  const volumeScore = Math.min(attestationCount / 1000, 1);
  // manifestAdherence defaults to 0.5 (neutral) if no manifests checked
  const manifestScore = (manifestAdherence > 0 || attestationCount > 0) ? manifestAdherence : 0.5;

  const computedScore = Math.round(
    successRate * wSuccessRate +
    chainCoverage * wChainCoverage +
    Math.min(volumeScore, 1) * wVolume +
    manifestScore * wManifestAdherence
  );

  // Also verify proofHash if present
  let proofHashValid = true;
  if (trustScore.proofHash) {
    const proofData = {
      inputs: { successRate, chainCoverage, attestationCount, manifestAdherence },
      weights: { successRate: wSuccessRate, chainCoverage: wChainCoverage, volume: wVolume, manifestAdherence: wManifestAdherence },
      score: computedScore,
    };
    const canonical = jcsSerialize(proofData);
    const expectedHash = crypto.createHash('sha256').update(canonical).digest('hex');
    if (expectedHash !== trustScore.proofHash) {
      proofHashValid = false;
    }
  }

  const valid = computedScore === claimedScore && proofHashValid;

  return { valid, computedScore, claimedScore };
}
