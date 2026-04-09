/**
 * soma-heartbeat.ts — Heart integration for the Soma Pulse Tree
 *
 * Manages per-agent Pulse Trees: heartbeat index tracking, typed leaf appends,
 * DB persistence (peaks-only compact state + full leaves for proof generation).
 *
 * Every agent action flows through here to produce an append-only,
 * cryptographically-committed lifecycle record.
 */

import { nanoid } from 'nanoid';
import { hkdfSync } from 'crypto';
import { getDb, logAudit } from '../db/connection';
import { somaHash, somaHashJson } from '../utils/crypto-agility';
import { derivePlatformSeed } from '../utils/ed25519-signer';
import { getNovaBridge } from './nova-bridge';
import { slashVouches } from './vouch-graph';
import { createAgentIdentity } from './soma-wallet';
import { logger } from '../utils/logger';
import {
  PulseTree,
  PulseLeaf,
  PULSE_TYPE,
  type PulseType,
  type PulseTreeState,
  type PulseInclusionProof,
} from './pulse-tree';

// ─── DID Resolution ───────────────────────────────────────────────────────

/** Derive agent DID from an API key (same derivation as agent-lifecycle routes). */
export function resolveAgentDid(apiKey: string): string {
  const platformSeed = derivePlatformSeed('agent-roots');
  const rootSeed = Buffer.from(hkdfSync('sha256', platformSeed, '', `agent:${somaHash(apiKey)}`, 32));
  return createAgentIdentity(rootSeed).did;
}

let _platformDid: string | null = null;

/** Deterministic DID for ClawNet's own heart — the platform itself as an agent. */
export function getPlatformDid(): string {
  if (_platformDid) return _platformDid;
  const platformSeed = derivePlatformSeed('agent-roots');
  const rootSeed = Buffer.from(hkdfSync('sha256', platformSeed, '', 'platform:clawnet', 32));
  _platformDid = createAgentIdentity(rootSeed).did;
  return _platformDid;
}

// ─── In-Memory Tree Cache ─────────────────────────────────────────────────

const treeCache = new Map<string, PulseTree>();

// ─── DB Helpers ───────────────────────────────────────────────────────────

/** Get or create the heartbeat index for an agent. Returns current index. */
export function getHeartbeatIndex(agentDid: string): number {
  const row = getDb()
    .prepare('SELECT heartbeat_index FROM agent_pulse_state WHERE agent_did = ?')
    .get(agentDid) as { heartbeat_index: number } | undefined;
  return row?.heartbeat_index ?? 0;
}

/** Increment heartbeat index atomically. Returns the NEW index. */
function incrementHeartbeat(agentDid: string): number {
  const db = getDb();
  db.prepare(`
    INSERT INTO agent_pulse_state (agent_did, heartbeat_index, leaf_count, total_credits, root_hash, peaks_json, updated_at)
    VALUES (?, 1, 0, 0, '', '[]', datetime('now'))
    ON CONFLICT(agent_did) DO UPDATE SET
      heartbeat_index = heartbeat_index + 1,
      updated_at = datetime('now')
  `).run(agentDid);

  const row = db
    .prepare('SELECT heartbeat_index FROM agent_pulse_state WHERE agent_did = ?')
    .get(agentDid) as { heartbeat_index: number };
  return row.heartbeat_index;
}

/** Persist tree state (peaks) + update heartbeat index. */
function persistTreeState(agentDid: string, tree: PulseTree): void {
  const state = tree.exportState();
  getDb()
    .prepare(`
      UPDATE agent_pulse_state SET
        leaf_count = ?,
        total_credits = ?,
        root_hash = ?,
        peaks_json = ?,
        updated_at = datetime('now')
      WHERE agent_did = ?
    `)
    .run(
      state.leafCount,
      state.totalCredits,
      state.root,
      JSON.stringify(state.peaks),
      agentDid,
    );
}

/** Store a leaf in the DB for later proof generation. */
function storeLeaf(agentDid: string, leaf: PulseLeaf, position: number, root: string): void {
  getDb()
    .prepare(`
      INSERT INTO pulse_tree_leaves (id, agent_did, leaf_index, position, type, heartbeat_index, timestamp, payload_hash, credit_delta, root_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      nanoid(16),
      agentDid,
      leaf.heartbeatIndex - 1, // leaf_index is 0-based
      position,
      leaf.type,
      leaf.heartbeatIndex,
      leaf.timestamp,
      leaf.payloadHash,
      leaf.creditDelta,
      root,
    );
}

// ─── Tree Management ──────────────────────────────────────────────────────

/**
 * Get or rebuild the in-memory PulseTree for an agent.
 * On first access, replays all stored leaves to reconstruct the tree.
 */
export function getAgentTree(agentDid: string): PulseTree {
  if (treeCache.has(agentDid)) return treeCache.get(agentDid)!;

  const tree = new PulseTree();

  // Replay all leaves from DB in order
  const leaves = getDb()
    .prepare('SELECT * FROM pulse_tree_leaves WHERE agent_did = ? ORDER BY leaf_index ASC')
    .all(agentDid) as Array<{
      type: number;
      heartbeat_index: number;
      timestamp: string;
      payload_hash: string;
      credit_delta: number;
    }>;

  for (const row of leaves) {
    tree.append({
      type: row.type as PulseType,
      heartbeatIndex: row.heartbeat_index,
      timestamp: row.timestamp,
      payloadHash: row.payload_hash,
      creditDelta: row.credit_delta,
    });
  }

  treeCache.set(agentDid, tree);
  return tree;
}

/** Clear cached tree (e.g. after death certificate). */
export function evictTreeCache(agentDid: string): void {
  treeCache.delete(agentDid);
}

// ─── Typed Append Functions ───────────────────────────────────────────────

interface AppendResult {
  heartbeatIndex: number;
  position: number;
  root: string;
}

/**
 * Core append: increment heartbeat, append leaf, persist, return result.
 * All typed append functions delegate here.
 *
 * After persisting, fires an async Nova IVC fold (non-blocking).
 * The fold incrementally proves this leaf was correctly appended to the tree.
 * If the prover is unavailable, the append still succeeds (graceful degradation).
 */
function appendLeaf(agentDid: string, type: PulseType, payloadHash: string, creditDelta: number): AppendResult {
  // Entire append is atomic: heartbeat increment + tree mutation + DB persist.
  // Prevents race condition where concurrent requests corrupt the pulse tree.
  const result = getDb().transaction(() => {
    const heartbeatIndex = incrementHeartbeat(agentDid);
    const tree = getAgentTree(agentDid);

    const leaf: PulseLeaf = {
      type,
      heartbeatIndex,
      timestamp: new Date().toISOString(),
      payloadHash,
      creditDelta,
    };

    const { position, root } = tree.append(leaf);
    storeLeaf(agentDid, leaf, position, root);
    persistTreeState(agentDid, tree);

    return { heartbeatIndex, position, root };
  })();

  // Fire-and-forget Nova IVC fold — non-blocking, non-fatal
  novaFold(agentDid, payloadHash, result.heartbeatIndex).catch(() => {});

  return result;
}

/**
 * Fold a leaf into the running Nova IVC instance.
 * Real Nova: ~50-100ms proof generation per fold.
 * Groth16 compression happens separately via novaCompress().
 */
async function novaFold(agentDid: string, leafHash: string, heartbeatIndex: number): Promise<void> {
  const bridge = getNovaBridge();
  if (!bridge.ready) return;

  try {
    await bridge.fold(agentDid, leafHash, heartbeatIndex);
  } catch (err) {
    logger.warn({ err, agentDid, heartbeatIndex }, 'Nova fold failed (non-fatal)');
  }
}

/**
 * Compress the current Nova instance into a Groth16 proof.
 * Call this periodically (e.g., every N heartbeats or on checkpoint).
 * Returns null if prover is unavailable.
 */
export async function novaCompress(agentDid: string): Promise<{
  proof: string;
  proofSizeBytes: number;
  foldCount: number;
} | null> {
  const bridge = getNovaBridge();
  if (!bridge.ready) return null;

  try {
    const result = await bridge.compress(agentDid);
    // Record the proof as a ZK_PROOF leaf
    appendZkProof(agentDid, {
      proofType: 'groth16',
      proofHash: somaHash(result.proof),
      stepCount: result.fold_count,
    });
    return {
      proof: result.proof,
      proofSizeBytes: result.proof_size_bytes,
      foldCount: result.fold_count,
    };
  } catch (err) {
    logger.warn({ err, agentDid }, 'Nova compress failed');
    return null;
  }
}

/**
 * Append an ACTION leaf — agent performed an API call, LLM inference, tool use.
 */
export function appendAction(
  agentDid: string,
  payload: { endpointId: string; success: boolean; durationMs: number; cached: boolean },
  creditCost: number,
): AppendResult {
  const payloadHash = somaHashJson(payload);
  return appendLeaf(agentDid, PULSE_TYPE.ACTION, payloadHash, creditCost);
}

/**
 * Append an ECONOMIC leaf — credit spend, deposit, bond, payment.
 */
export function appendEconomic(
  agentDid: string,
  payload: { action: string; amount: number; ref?: string },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  return appendLeaf(agentDid, PULSE_TYPE.ECONOMIC, payloadHash, payload.amount);
}

/**
 * Append a CHECKPOINT leaf — periodic behavioral summary.
 */
export function appendCheckpoint(
  agentDid: string,
  payload: { summary: string; actionsSinceLastCheckpoint: number; prevCheckpointHash?: string },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  return appendLeaf(agentDid, PULSE_TYPE.CHECKPOINT, payloadHash, 0);
}

/**
 * Append a ZK_PROOF leaf — Nova IVC fold or Groth16 proof stored.
 */
export function appendZkProof(
  agentDid: string,
  payload: { proofType: 'nova_fold' | 'groth16'; proofHash: string; stepCount?: number },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  const result = appendLeaf(agentDid, PULSE_TYPE.ZK_PROOF, payloadHash, 0);

  // Track Groth16 proofs separately for proof tier detection
  if (payload.proofType === 'groth16') {
    getDb().prepare(
      "UPDATE agent_pulse_state SET last_groth16_at = datetime('now') WHERE agent_did = ?"
    ).run(agentDid);
  }

  return result;
}

/**
 * Append a WALLET leaf — new wallet derived from Heart root.
 */
export function appendWallet(
  agentDid: string,
  payload: { chain: string; index: number; address: string },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  return appendLeaf(agentDid, PULSE_TYPE.WALLET, payloadHash, 0);
}

/**
 * Append a BURNER leaf — burner agent created, revoked, or slashed.
 */
export function appendBurner(
  agentDid: string,
  payload: { action: 'create' | 'revoke' | 'slash'; burnerId: string; bondAmount: number },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  const creditDelta = payload.action === 'create' ? -payload.bondAmount : payload.bondAmount;
  return appendLeaf(agentDid, PULSE_TYPE.BURNER, payloadHash, creditDelta);
}

/**
 * Append a CUSTODY leaf — data custody event (accept/access/release).
 * Proves how an agent handles custodied data: when it was accepted,
 * every time it was accessed, and when it was crypto-shredded.
 */
export function appendCustody(
  agentDid: string,
  payload: {
    event: 'accept' | 'access' | 'release';
    subjectId: string;
    dekFingerprint?: string;
    destructionProof?: string;
    fieldsAccessed?: string[];
    reason?: string;
  },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  return appendLeaf(agentDid, PULSE_TYPE.CUSTODY, payloadHash, 0);
}

/**
 * Append a DEATH leaf — final event, seals the tree forever.
 */
export function appendDeath(
  agentDid: string,
  payload: { reason: string; successorDid?: string; finalBalance: number },
): AppendResult {
  const payloadHash = somaHashJson(payload);
  const result = appendLeaf(agentDid, PULSE_TYPE.DEATH, payloadHash, payload.finalBalance);

  // Evict from cache — tree is sealed, no more appends
  evictTreeCache(agentDid);

  // Auto-slash all vouches — dead agents can't honor trust
  const slashed = slashVouches(agentDid, 'agent_death');
  if (slashed > 0) {
    logger.info({ agentDid, slashed }, 'auto-slashed vouches on agent death');
  }

  logAudit({
    entityType: 'pulse_tree',
    entityId: agentDid,
    action: 'death_sealed',
    data: { root: result.root, heartbeatIndex: result.heartbeatIndex, vouchesSlashed: slashed },
  });

  return result;
}

// ─── Query Functions ──────────────────────────────────────────────────────

/** Get the current Pulse Tree state for an agent. */
export function getAgentPulseState(agentDid: string): {
  heartbeatIndex: number;
  leafCount: number;
  totalCredits: number;
  root: string;
} | null {
  const row = getDb()
    .prepare('SELECT heartbeat_index, leaf_count, total_credits, root_hash FROM agent_pulse_state WHERE agent_did = ?')
    .get(agentDid) as { heartbeat_index: number; leaf_count: number; total_credits: number; root_hash: string } | undefined;

  if (!row) return null;
  return {
    heartbeatIndex: row.heartbeat_index,
    leafCount: row.leaf_count,
    totalCredits: row.total_credits,
    root: row.root_hash,
  };
}

/** Generate an inclusion proof for a specific leaf. */
export function generatePulseProof(agentDid: string, leafIndex: number): PulseInclusionProof {
  const tree = getAgentTree(agentDid);
  return tree.generateProof(leafIndex);
}

// ─── Platform Self-Registration ──────────────────────────────────────────

/**
 * Bootstrap ClawNet's platform DID as the first identity-verified agent.
 * Called once on server startup. Ensures the platform appears in its own
 * trust oracle, pulse tree, and identity system — eating its own dogfood.
 *
 * This makes ClawNet the living proof that Soma works:
 *   - Platform DID has a Pulse Tree (every orchestration is an ACTION leaf)
 *   - Platform DID has identity signals (behavioral + social from real traffic)
 *   - Platform DID has a trust score from the trust oracle
 *   - When Nova prover runs: platform actions fold into IVC → Groth16 on-chain
 */
export function bootstrapPlatformIdentity(): void {
  const platformDid = getPlatformDid();

  // Ensure pulse state row exists (so trust oracle can score us)
  const existing = getDb().prepare(
    'SELECT 1 FROM agent_pulse_state WHERE agent_did = ?'
  ).get(platformDid);

  if (!existing) {
    getDb().prepare(`
      INSERT OR IGNORE INTO agent_pulse_state
        (agent_did, heartbeat_index, leaf_count, total_credits, root_hash, peaks_json, updated_at)
      VALUES (?, 0, 0, 0, '', '[]', datetime('now'))
    `).run(platformDid);
  }

  // Ensure identity signals table has a record for behavioral signal
  // (The composite scoring reads from this + derives behavioral/social from trust dimensions)
  // Platform doesn't get biometric/kyc/passport automatically — those require
  // the operator to link their own verifications. But we seed the row so the
  // composite scorer can find us.
  const identityExists = getDb().prepare(
    'SELECT 1 FROM agent_identity_composite WHERE agent_did = ?'
  ).get(platformDid);

  if (!identityExists) {
    getDb().prepare(`
      INSERT OR IGNORE INTO agent_identity_composite
        (agent_did, composite_score, effective_multiplier, biometric_signal, kyc_signal,
         passport_signal, behavioral_signal, social_signal, signal_count, last_recomputed)
      VALUES (?, 0, 0.5, 0, 0, 0, 0, 0, 0, datetime('now'))
    `).run(platformDid);
  }

  // Register an agent identity record if none exists
  const agentIdentity = getDb().prepare(
    'SELECT 1 FROM agent_identities WHERE id = ? OR api_key_hash = ?'
  ).get(platformDid, somaHash(platformDid));

  if (!agentIdentity) {
    getDb().prepare(`
      INSERT OR IGNORE INTO agent_identities
        (id, api_key_hash, display_name, description, agent_type, capabilities_json,
         owner_verified, public_profile, created_at, updated_at)
      VALUES (?, ?, 'ClawNet Platform', 'Sovereign AI agent orchestration layer — the first Soma implementation',
              'autonomous', '["orchestration","trust-oracle","soma-check","identity-verification","vouch-graph"]',
              1, 1, datetime('now'), datetime('now'))
    `).run(platformDid, somaHash(platformDid));
  }

  logger.info({ platformDid }, 'Platform identity bootstrapped — ClawNet is its own first verified agent');
}

/** Get recent leaves for an agent (most recent first). */
export function getRecentLeaves(agentDid: string, limit = 20): Array<{
  type: number;
  heartbeatIndex: number;
  timestamp: string;
  payloadHash: string;
  creditDelta: number;
  rootAfter: string;
}> {
  return getDb()
    .prepare(`
      SELECT type, heartbeat_index, timestamp, payload_hash, credit_delta, root_after
      FROM pulse_tree_leaves
      WHERE agent_did = ?
      ORDER BY leaf_index DESC
      LIMIT ?
    `)
    .all(agentDid, limit) as any[];
}
