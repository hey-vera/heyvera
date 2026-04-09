/**
 * epoch-snapshot.ts — Multi-subtree Merkle tree for Proof-of-Trust-Work epochs
 *
 * Reads pulse tree entries, vouch graph edges, and attestation stats at a
 * point in time and constructs a deterministic four-subtree Merkle tree:
 *
 *   EpochRoot
 *   ├── PulseEntries/    — bilateral pulse tree leaves (Innovation 2)
 *   ├── VouchGraph/      — vouch edges with conservation fields (Innovation 3)
 *   ├── AttestationStats/ — per-agent attestation summaries
 *   └── EpochMetadata/   — epoch number, timestamp, previous root, circuit hash
 *
 * The EpochRoot can be anchored on-chain via ITrustMining.commitSnapshot().
 * Every trust score computed in this epoch references this snapshot — making
 * scoring deterministic and independently verifiable.
 *
 * Phase 1-3: 1-hour epochs (centralized, cheap)
 * Phase 4+:  6-hour epochs (decentralized, balanced)
 */

import { getDb, logAudit } from '../db/connection';
import { buildMerkleTree } from './merkle-anchor';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { round6 } from './credits';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EpochSnapshot {
  epochNumber: number;
  epochTimestamp: string;
  previousEpochRoot: string | null;

  /** Hash of the scoring formula + weights — identifies which circuit version was used */
  scoringCircuitHash: string;

  /** Subtree roots */
  pulseEntriesRoot: string;
  vouchGraphRoot: string;
  attestationStatsRoot: string;
  metadataRoot: string;

  /** Combined root of the 4 subtree roots */
  epochRoot: string;

  /** Stats */
  agentCount: number;
  entryCount: number;
  vouchCount: number;
}

export interface EpochProof {
  epochNumber: number;
  epochRoot: string;
  subtreeProof: { sibling: string; promoted: boolean }[];
  leafProof: { sibling: string; promoted: boolean }[];
}

// ─── Scoring Circuit Hash ───────────────────────────────────────────────────

/**
 * Deterministic hash of the current scoring formula.
 * Changes when dimension weights, identity weights, or conservation parameters change.
 * Governance-controlled: miners must agree on the circuit hash before scoring.
 */
const SCORING_CIRCUIT_V1 = somaHashJson({
  version: '1.0.0',
  dimensionWeights: {
    reliability: 0.25, economic: 0.10, verification: 0.20,
    longevity: 0.10, consistency: 0.15, social: 0.20,
  },
  identityWeights: {
    biometric: 0.35, kyc: 0.25, passport: 0.15,
    behavioral: 0.15, social: 0.10,
  },
  conservation: { costFactor: 1.3, decayFactor: 0.6, revokeReturn: 0.5 },
  circularDiscount: 0.5,
});

// ─── Subtree Builders ───────────────────────────────────────────────────────

/**
 * Build PulseEntries subtree from bilateral pulse tree leaves.
 * Each leaf hash includes the bilateral_ref to prove both parties witnessed the interaction.
 */
function buildPulseEntriesSubtree(since?: string): { root: string; count: number; agentDids: Set<string> } {
  const query = since
    ? `SELECT agent_did, leaf_index, type, heartbeat_index, timestamp, payload_hash, credit_delta, bilateral_ref
       FROM pulse_tree_leaves WHERE timestamp > ? ORDER BY agent_did, leaf_index`
    : `SELECT agent_did, leaf_index, type, heartbeat_index, timestamp, payload_hash, credit_delta, bilateral_ref
       FROM pulse_tree_leaves ORDER BY agent_did, leaf_index`;

  const rows = since
    ? getDb().prepare(query).all(since) as PulseLeafRow[]
    : getDb().prepare(query).all() as PulseLeafRow[];

  const agentDids = new Set<string>();
  const hashes: string[] = [];

  for (const row of rows) {
    agentDids.add(row.agent_did);
    // Deterministic leaf hash — includes bilateral_ref for Innovation 2 linkage
    hashes.push(somaHash(
      `${row.agent_did}:${row.leaf_index}:${row.type}:${row.heartbeat_index}:` +
      `${row.timestamp}:${row.payload_hash}:${row.credit_delta}:${row.bilateral_ref ?? 'none'}`
    ));
  }

  const { root } = buildMerkleTree(hashes);
  return { root, count: rows.length, agentDids };
}

interface PulseLeafRow {
  agent_did: string;
  leaf_index: number;
  type: number;
  heartbeat_index: number;
  timestamp: string;
  payload_hash: string;
  credit_delta: number;
  bilateral_ref: string | null;
}

/**
 * Build VouchGraph subtree from active vouch edges.
 * Each edge hash includes conservation fields (trust_cost, trust_transferred).
 */
function buildVouchGraphSubtree(): { root: string; count: number } {
  const rows = getDb().prepare(`
    SELECT voucher_did, vouchee_did, stake_amount, trust_cost, trust_transferred, created_at
    FROM vouch_stakes WHERE status = 'active'
    ORDER BY voucher_did, vouchee_did
  `).all() as Array<{
    voucher_did: string; vouchee_did: string; stake_amount: number;
    trust_cost: number; trust_transferred: number; created_at: string;
  }>;

  const hashes: string[] = [];
  for (const row of rows) {
    hashes.push(somaHash(
      `${row.voucher_did}→${row.vouchee_did}:${row.stake_amount}:` +
      `${round6(row.trust_cost)}:${round6(row.trust_transferred)}:${row.created_at}`
    ));
  }

  const { root } = buildMerkleTree(hashes);
  return { root, count: rows.length };
}

/**
 * Build AttestationStats subtree — per-agent attestation summaries.
 */
function buildAttestationStatsSubtree(): { root: string; count: number } {
  const rows = getDb().prepare(`
    SELECT api_key_hash, total_attestations, success_count, failure_count,
           manifest_aligned, manifest_unaligned, decay_factor, last_attestation_at
    FROM attestation_stats
    ORDER BY api_key_hash
  `).all() as Array<{
    api_key_hash: string; total_attestations: number; success_count: number;
    failure_count: number; manifest_aligned: number; manifest_unaligned: number;
    decay_factor: number | null; last_attestation_at: string | null;
  }>;

  const hashes: string[] = [];
  for (const row of rows) {
    hashes.push(somaHash(
      `${row.api_key_hash}:${row.total_attestations}:${row.success_count}:${row.failure_count}:` +
      `${row.manifest_aligned}:${row.manifest_unaligned}:${row.decay_factor ?? 1.0}:${row.last_attestation_at ?? 'never'}`
    ));
  }

  const { root } = buildMerkleTree(hashes);
  return { root, count: rows.length };
}

/**
 * Build EpochMetadata subtree — 4 fixed leaves that identify this epoch.
 */
function buildMetadataSubtree(
  epochNumber: number,
  epochTimestamp: string,
  previousEpochRoot: string | null,
  scoringCircuitHash: string,
): string {
  const hashes = [
    somaHash(`epoch_number:${epochNumber}`),
    somaHash(`epoch_timestamp:${epochTimestamp}`),
    somaHash(`previous_epoch_root:${previousEpochRoot ?? 'genesis'}`),
    somaHash(`scoring_circuit_hash:${scoringCircuitHash}`),
  ];

  return buildMerkleTree(hashes).root;
}

// ─── Epoch Builder ──────────────────────────────────────────────────────────

/**
 * Build a complete epoch snapshot.
 *
 * Reads all relevant data from the DB at a point in time, constructs
 * four subtrees, and combines them into a single EpochRoot.
 *
 * The epoch is deterministic: given the same DB state, the same EpochRoot
 * is produced regardless of which machine runs it.
 */
export function buildEpochSnapshot(): EpochSnapshot {
  const epochTimestamp = new Date().toISOString();

  // Get previous epoch for chain linkage
  const prev = getDb().prepare(
    'SELECT epoch_number, epoch_root FROM epoch_snapshots ORDER BY epoch_number DESC LIMIT 1'
  ).get() as { epoch_number: number; epoch_root: string } | undefined;

  const epochNumber = prev ? prev.epoch_number + 1 : 0;
  const previousEpochRoot = prev?.epoch_root ?? null;
  const scoringCircuitHash = SCORING_CIRCUIT_V1;

  // Determine "since" for incremental pulse entries
  // First epoch: include all entries. Subsequent: entries since last epoch timestamp.
  const prevTimestamp = prev
    ? (getDb().prepare('SELECT epoch_timestamp FROM epoch_snapshots WHERE epoch_number = ?')
        .get(prev.epoch_number) as { epoch_timestamp: string } | undefined)?.epoch_timestamp
    : undefined;

  // Build all 4 subtrees
  const pulseEntries = buildPulseEntriesSubtree(prevTimestamp);
  const vouchGraph = buildVouchGraphSubtree();
  const attestationStats = buildAttestationStatsSubtree();
  const metadataRoot = buildMetadataSubtree(epochNumber, epochTimestamp, previousEpochRoot, scoringCircuitHash);

  // Combine subtree roots into EpochRoot
  const subtreeRoots = [
    pulseEntries.root,
    vouchGraph.root,
    attestationStats.root,
    metadataRoot,
  ];
  const { root: epochRoot, tree: epochTree } = buildMerkleTree(subtreeRoots);

  const snapshot: EpochSnapshot = {
    epochNumber,
    epochTimestamp,
    previousEpochRoot,
    scoringCircuitHash,
    pulseEntriesRoot: pulseEntries.root,
    vouchGraphRoot: vouchGraph.root,
    attestationStatsRoot: attestationStats.root,
    metadataRoot,
    epochRoot,
    agentCount: pulseEntries.agentDids.size,
    entryCount: pulseEntries.count,
    vouchCount: vouchGraph.count,
  };

  // Persist to DB
  getDb().prepare(`
    INSERT INTO epoch_snapshots
      (epoch_number, epoch_timestamp, previous_epoch_root, scoring_circuit_hash,
       pulse_entries_root, vouch_graph_root, attestation_stats_root, metadata_root,
       epoch_root, agent_count, entry_count, vouch_count, tree_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.epochNumber, snapshot.epochTimestamp, snapshot.previousEpochRoot,
    snapshot.scoringCircuitHash, snapshot.pulseEntriesRoot, snapshot.vouchGraphRoot,
    snapshot.attestationStatsRoot, snapshot.metadataRoot, snapshot.epochRoot,
    snapshot.agentCount, snapshot.entryCount, snapshot.vouchCount,
    JSON.stringify(epochTree),
  );

  logAudit({
    entityType: 'epoch_snapshot',
    entityId: `epoch-${snapshot.epochNumber}`,
    action: 'epoch_built',
    data: {
      epochRoot: snapshot.epochRoot,
      agents: snapshot.agentCount,
      entries: snapshot.entryCount,
      vouches: snapshot.vouchCount,
    },
  });

  logger.info({
    epoch: snapshot.epochNumber,
    root: snapshot.epochRoot.slice(0, 16),
    agents: snapshot.agentCount,
    entries: snapshot.entryCount,
    vouches: snapshot.vouchCount,
  }, 'Epoch snapshot built');

  return snapshot;
}

// ─── Query Functions ────────────────────────────────────────────────────────

/** Get the latest epoch snapshot. */
export function getLatestEpoch(): EpochSnapshot | null {
  const row = getDb().prepare(
    'SELECT * FROM epoch_snapshots ORDER BY epoch_number DESC LIMIT 1'
  ).get() as EpochRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

/** Get a specific epoch by number. */
export function getEpoch(epochNumber: number): EpochSnapshot | null {
  const row = getDb().prepare(
    'SELECT * FROM epoch_snapshots WHERE epoch_number = ?'
  ).get(epochNumber) as EpochRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

/** Get the current epoch number (0 if no epochs exist). */
export function getCurrentEpochNumber(): number {
  const row = getDb().prepare(
    'SELECT MAX(epoch_number) as n FROM epoch_snapshots'
  ).get() as { n: number | null };
  return row.n ?? 0;
}

/** Get epoch count and latest root (for status endpoints). */
export function getEpochStatus(): { epochCount: number; latestRoot: string | null; latestTimestamp: string | null } {
  const row = getDb().prepare(
    'SELECT COUNT(*) as count, MAX(epoch_number) as latest FROM epoch_snapshots'
  ).get() as { count: number; latest: number | null };

  if (row.latest === null) {
    return { epochCount: 0, latestRoot: null, latestTimestamp: null };
  }

  const latest = getDb().prepare(
    'SELECT epoch_root, epoch_timestamp FROM epoch_snapshots WHERE epoch_number = ?'
  ).get(row.latest) as { epoch_root: string; epoch_timestamp: string };

  return {
    epochCount: row.count,
    latestRoot: latest.epoch_root,
    latestTimestamp: latest.epoch_timestamp,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface EpochRow {
  epoch_number: number;
  epoch_timestamp: string;
  previous_epoch_root: string | null;
  scoring_circuit_hash: string;
  pulse_entries_root: string;
  vouch_graph_root: string;
  attestation_stats_root: string;
  metadata_root: string;
  epoch_root: string;
  agent_count: number;
  entry_count: number;
  vouch_count: number;
}

function rowToSnapshot(row: EpochRow): EpochSnapshot {
  return {
    epochNumber: row.epoch_number,
    epochTimestamp: row.epoch_timestamp,
    previousEpochRoot: row.previous_epoch_root,
    scoringCircuitHash: row.scoring_circuit_hash,
    pulseEntriesRoot: row.pulse_entries_root,
    vouchGraphRoot: row.vouch_graph_root,
    attestationStatsRoot: row.attestation_stats_root,
    metadataRoot: row.metadata_root,
    epochRoot: row.epoch_root,
    agentCount: row.agent_count,
    entryCount: row.entry_count,
    vouchCount: row.vouch_count,
  };
}
