/**
 * aid-builder.ts — Build AID documents and portable trust chains
 *
 * Generates Ed25519 keypairs, assembles Agent Identity Documents (AIDs),
 * builds portable trust chains with Merkle proofs, and computes
 * cryptographically verifiable trust scores.
 *
 * Uses shared JCS/base58btc from utils/jcs.ts, Ed25519 signing from
 * ed25519-signer.ts, and Merkle tree utilities from merkle-anchor.ts.
 */

import crypto from 'crypto';
import { getDb } from '../db/connection';
import { signVC, getEd25519PublicKeyMultibase } from '../utils/ed25519-signer';
import { buildMerkleTree, getMerkleProof } from './merkle-anchor';
import { jcsSerialize, base58btcEncode } from '../utils/jcs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrustStats {
  successRate: number;
  chainCoverage: number;
  attestationCount: number;
}

export interface TrustScoreProof {
  score: number;
  inputs: TrustStats;
  weights: { successRate: number; chainCoverage: number; volume: number };
  proofHash: string;
}

export interface AIDDocument {
  '@context': string[];
  id: string;
  type: 'AgentIdentityDocument';
  version: '1.0.0';
  agent: { displayName?: string; agentType: string; createdAt: string };
  publicKey: { type: string; publicKeyMultibase: string };
  did: string;
  trustChain: {
    merkleRoot: string;
    attestationCount: number;
    chainLength: number;
    stats: TrustStats;
    anchorTxHash?: string;
  };
  capabilities: Array<{ category: string; actions: string[]; invokeCount: number }>;
  trustScore: TrustScoreProof;
  issuance: { issuer: string; issuedAt: string; expiresAt: string; platformVersion: string };
  platformAttestations: Array<{ platform: string; attestationCount: number; successRate: number; firstSeen: string }>;
  proof: { agentSignature?: object; platformCountersignature: object };
}

export interface PortableTrustChain {
  did: string;
  snapshotId: string;
  merkleRoot: string;
  platformPublicKey: string;
  trustScore: TrustScoreProof;
  attestations: Array<{
    id: string;
    actionType: string;
    outcomeStatus: string;
    createdAt: string;
    signature?: string;
    prevAttestationHash?: string;
    merkleProof: { sibling: string; promoted: boolean }[] | null;
  }>;
  snapshotSignature: string;
  exportedAt: string;
}

// ─── Action type -> category mapping ────────────────────────────────────────

const ACTION_CATEGORY_MAP: Record<string, string> = {
  orchestrate: 'data',
  data_query: 'data',
  skill_invoke: 'skills',
  swap: 'defi',
  transfer: 'defi',
  trade_executed: 'trading',
  manifest_check: 'verification',
  attest: 'attestation',
};

function actionToCategory(actionType: string): string {
  return ACTION_CATEGORY_MAP[actionType] || 'general';
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Generate a new Ed25519 keypair for an agent.
 * Returns { publicKeyMultibase, privateKeySeed (hex), did }.
 * The private key seed is returned ONCE and never stored.
 */
export function generateAgentKeypair(): { publicKeyMultibase: string; privateKeySeed: string; did: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  // Extract raw 32-byte public key from SPKI DER (12-byte header + 32-byte key)
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPub = Buffer.from(spki.subarray(12));

  // Multikey prefix for Ed25519 public key: 0xed 0x01
  const prefixed = Buffer.concat([Buffer.from([0xed, 0x01]), rawPub]);
  const publicKeyMultibase = 'z' + base58btcEncode(prefixed);

  // Extract raw 32-byte seed from PKCS#8 DER (16-byte header + 32-byte seed)
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const seed = Buffer.from(pkcs8.subarray(16, 48));
  const privateKeySeed = seed.toString('hex');

  // Self-certifying DID: public key IS the identifier
  const did = `did:clawnet:${publicKeyMultibase}`;

  return { publicKeyMultibase, privateKeySeed, did };
}

/**
 * Build a full AID document for an agent.
 * Queries aid_keys by DID, then pulls attestation/trust data via owner_key.
 */
export function buildAIDDocument(did: string): AIDDocument | null {
  // Primary lookup via aid_keys
  const aidKey = getDb().prepare(
    'SELECT * FROM aid_keys WHERE did = ? AND key_status = ?'
  ).get(did, 'active') as any;
  if (!aidKey) return null;

  const ownerKey = aidKey.owner_key;

  // Get latest trust snapshot
  const snapshot = getDb().prepare(
    'SELECT * FROM aid_trust_snapshots WHERE did = ? ORDER BY created_at DESC LIMIT 1'
  ).get(did) as any;

  // Derive capabilities from attestation history
  const capabilities = deriveCapabilities(ownerKey);

  // Get cross-platform attestations grouped by platform
  const xplatRows = getDb().prepare(
    'SELECT platform, COUNT(*) as cnt, MIN(created_at) as first_created FROM aid_cross_platform_attestations WHERE did = ? GROUP BY platform ORDER BY first_created ASC'
  ).all(did) as any[];

  // Build attestation stats
  const stats = getDb().prepare(
    'SELECT * FROM attestation_stats WHERE api_key_hash = ?'
  ).get(ownerKey) as any;

  const totalAttestations = stats?.total_attestations ?? 0;
  const successCount = stats?.success_count ?? 0;
  const successRate = totalAttestations > 0 ? successCount / totalAttestations : 0;

  // Chain coverage: fraction of attestations that have prev_attestation_hash
  const chainedCount = (getDb().prepare(
    'SELECT COUNT(*) as cnt FROM attestations WHERE api_key_hash = ? AND prev_attestation_hash IS NOT NULL'
  ).get(ownerKey) as any)?.cnt ?? 0;
  const chainCoverage = totalAttestations > 0 ? chainedCount / totalAttestations : 0;

  const trustStats: TrustStats = { successRate, chainCoverage, attestationCount: totalAttestations };
  const trustScore = computeTrustScoreWithProof(trustStats);

  const merkleRoot = snapshot?.merkle_root || crypto.createHash('sha256').update('').digest('hex');
  const chainLength = snapshot?.chain_length ?? 0;

  const platformAttestations = (xplatRows || []).map((r: any) => {
    const platformStats = getDb().prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_cnt,
       MIN(created_at) as first_seen
       FROM aid_cross_platform_attestations WHERE did = ? AND platform = ?`
    ).get(did, r.platform) as any;
    return {
      platform: r.platform,
      attestationCount: platformStats?.total ?? 0,
      successRate: platformStats?.total > 0 ? (platformStats?.verified_cnt ?? 0) / platformStats.total : 0,
      firstSeen: platformStats?.first_seen ?? r.first_created,
    };
  });

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days

  const aidDoc: Omit<AIDDocument, 'proof'> = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://api.claw-net.org/contexts/aid/v1',
    ],
    id: did,
    type: 'AgentIdentityDocument',
    version: '1.0.0',
    agent: {
      displayName: aidKey.display_name || undefined,
      agentType: 'autonomous',
      createdAt: aidKey.created_at,
    },
    publicKey: {
      type: 'Ed25519VerificationKey2020',
      publicKeyMultibase: aidKey.public_key_multibase,
    },
    did,
    trustChain: {
      merkleRoot,
      attestationCount: totalAttestations,
      chainLength,
      stats: trustStats,
      anchorTxHash: snapshot?.anchor_tx_hash || undefined,
    },
    capabilities,
    trustScore,
    issuance: {
      issuer: 'did:web:api.claw-net.org',
      issuedAt: now,
      expiresAt,
      platformVersion: '3.0.0',
    },
    platformAttestations,
  };

  // Sign with platform Ed25519 key (eddsa-jcs-2022 pattern)
  const proofValue = signVC(aidDoc as unknown as Record<string, unknown>);
  const platformCountersignature = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: now,
    verificationMethod: 'did:web:api.claw-net.org#key-1',
    proofPurpose: 'assertionMethod',
    proofValue,
  };

  return {
    ...aidDoc,
    proof: { platformCountersignature },
  } as AIDDocument;
}

/**
 * Build a portable trust chain export.
 * Includes recent attestations with Merkle proofs, platform public key,
 * trust score proof, and signatures.
 */
export function buildPortableTrustChain(did: string, maxAttestations: number = 50): PortableTrustChain | null {
  const aidKey = getDb().prepare(
    'SELECT * FROM aid_keys WHERE did = ? AND key_status = ?'
  ).get(did, 'active') as any;
  if (!aidKey) return null;

  const ownerKey = aidKey.owner_key;

  // Get latest trust snapshot
  const snapshot = getDb().prepare(
    'SELECT * FROM aid_trust_snapshots WHERE did = ? ORDER BY created_at DESC LIMIT 1'
  ).get(did) as any;
  if (!snapshot) return null;

  // Get recent attestations
  const attestations = getDb().prepare(
    `SELECT id, action_type, outcome_status, created_at, signature, prev_attestation_hash
     FROM attestations WHERE api_key_hash = ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(ownerKey, maxAttestations) as any[];

  // Build Merkle tree from all attestation hashes to generate proofs
  const allAttestationHashes = getDb().prepare(
    'SELECT id FROM attestations WHERE api_key_hash = ? ORDER BY created_at ASC'
  ).all(ownerKey) as any[];

  const hashes = allAttestationHashes.map((a: any) =>
    crypto.createHash('sha256').update(a.id).digest('hex')
  );
  const { tree } = buildMerkleTree(hashes);

  // Build trust stats
  const stats = getDb().prepare(
    'SELECT * FROM attestation_stats WHERE api_key_hash = ?'
  ).get(ownerKey) as any;

  const totalAttestations = stats?.total_attestations ?? 0;
  const successRate = totalAttestations > 0 ? (stats?.success_count ?? 0) / totalAttestations : 0;
  const chainedCount = (getDb().prepare(
    'SELECT COUNT(*) as cnt FROM attestations WHERE api_key_hash = ? AND prev_attestation_hash IS NOT NULL'
  ).get(ownerKey) as any)?.cnt ?? 0;
  const chainCoverage = totalAttestations > 0 ? chainedCount / totalAttestations : 0;

  const trustScore = computeTrustScoreWithProof({
    successRate, chainCoverage, attestationCount: totalAttestations,
  });

  // Generate Merkle proofs for the exported attestations
  const exportedAttestations = attestations.map((a: any) => {
    const hash = crypto.createHash('sha256').update(a.id).digest('hex');
    const merkleProof = getMerkleProof(hash, tree);
    return {
      id: a.id,
      actionType: a.action_type,
      outcomeStatus: a.outcome_status,
      createdAt: a.created_at,
      signature: a.signature || undefined,
      prevAttestationHash: a.prev_attestation_hash || undefined,
      merkleProof,
    };
  });

  return {
    did,
    snapshotId: snapshot.id,
    merkleRoot: snapshot.merkle_root,
    platformPublicKey: getEd25519PublicKeyMultibase(),
    trustScore,
    attestations: exportedAttestations,
    snapshotSignature: snapshot.platform_signature,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Build and store a trust chain snapshot (called by cron).
 * Computes Merkle root over all attestations, signs it, stores in aid_trust_snapshots.
 */
export function buildTrustSnapshot(did: string, ownerKey: string): string | null {
  // Get all attestation IDs for this agent
  const attestations = getDb().prepare(
    'SELECT id, prev_attestation_hash FROM attestations WHERE api_key_hash = ? ORDER BY created_at ASC'
  ).all(ownerKey) as any[];

  // Build Merkle tree from attestation ID hashes
  const hashes = attestations.map((a: any) =>
    crypto.createHash('sha256').update(a.id).digest('hex')
  );
  const { root } = buildMerkleTree(hashes);

  // Compute chain length (number of contiguous hash-chained attestations from latest)
  let chainLength = 0;
  for (let i = attestations.length - 1; i >= 0; i--) {
    if (attestations[i].prev_attestation_hash) {
      chainLength++;
    } else {
      break;
    }
  }

  // Compute trust stats
  const stats = getDb().prepare(
    'SELECT * FROM attestation_stats WHERE api_key_hash = ?'
  ).get(ownerKey) as any;

  const totalAttestations = stats?.total_attestations ?? 0;
  const successRate = totalAttestations > 0 ? (stats?.success_count ?? 0) / totalAttestations : 0;
  const chainedCount = (getDb().prepare(
    'SELECT COUNT(*) as cnt FROM attestations WHERE api_key_hash = ? AND prev_attestation_hash IS NOT NULL'
  ).get(ownerKey) as any)?.cnt ?? 0;
  const chainCoverage = totalAttestations > 0 ? chainedCount / totalAttestations : 0;

  const trustStats: TrustStats = { successRate, chainCoverage, attestationCount: totalAttestations };

  // Sign the snapshot with platform Ed25519 key
  const snapshotData = {
    did,
    merkleRoot: root,
    attestationCount: attestations.length,
    chainLength,
    stats: trustStats,
    timestamp: new Date().toISOString(),
  };
  const agentSignature = signVC(snapshotData as unknown as Record<string, unknown>);
  const platformSignature = signVC({
    ...snapshotData,
    agentSignature,
  } as unknown as Record<string, unknown>);

  const snapshotId = crypto.randomUUID();

  getDb().prepare(`
    INSERT INTO aid_trust_snapshots (id, identity_id, did, merkle_root, attestation_count, chain_length, stats_json, agent_signature, platform_signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId, ownerKey, did, root, attestations.length,
    chainLength, JSON.stringify(trustStats), agentSignature, platformSignature,
  );

  return snapshotId;
}

/**
 * Compute trust score from attestation stats with proof.
 * Returns the score, inputs, weights, and a proof hash.
 */
export function computeTrustScoreWithProof(stats: TrustStats): TrustScoreProof {
  const weights = { successRate: 50, chainCoverage: 30, volume: 20 };
  const volumeScore = Math.min(stats.attestationCount / 1000, 1);

  const score = Math.round(
    stats.successRate * weights.successRate +
    stats.chainCoverage * weights.chainCoverage +
    Math.min(volumeScore, 1) * weights.volume
  );

  // Proof hash = SHA-256 of canonical JSON of inputs + weights + score
  const proofData = {
    inputs: stats,
    weights,
    score,
  };
  const canonical = jcsSerialize(proofData);
  const proofHash = crypto.createHash('sha256').update(canonical).digest('hex');

  return { score, inputs: stats, weights, proofHash };
}

/**
 * Derive capabilities from attestation history.
 * Maps action_types to categories and counts.
 * Takes ownerKey (api_key_hash) to look up attestations.
 */
export function deriveCapabilities(ownerKey: string): Array<{ category: string; actions: string[]; invokeCount: number }> {
  if (!ownerKey) return [];

  // Group attestations by action_type
  const rows = getDb().prepare(
    'SELECT action_type, COUNT(*) as cnt FROM attestations WHERE api_key_hash = ? GROUP BY action_type'
  ).all(ownerKey) as any[];

  // Aggregate by category
  const categoryMap = new Map<string, { actions: Set<string>; invokeCount: number }>();

  for (const row of rows) {
    const category = actionToCategory(row.action_type);
    const existing = categoryMap.get(category);
    if (existing) {
      existing.actions.add(row.action_type);
      existing.invokeCount += row.cnt;
    } else {
      categoryMap.set(category, {
        actions: new Set([row.action_type]),
        invokeCount: row.cnt,
      });
    }
  }

  return Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    actions: Array.from(data.actions).sort(),
    invokeCount: data.invokeCount,
  }));
}
