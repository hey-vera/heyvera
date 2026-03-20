/**
 * Merkle Root Anchor Cron
 *
 * Periodically anchors a Merkle root of recent attestations on Solana via the
 * SPL Memo program. This makes attestation hashes permanently verifiable
 * on-chain, even if the local SQLite DB is lost.
 *
 * Flow:
 *   1. Query attestations with anchor_id IS NULL (un-anchored)
 *   2. Build a Merkle tree from their input_hash values
 *   3. Send a Solana memo transaction containing the Merkle root
 *   4. Record the anchor in attestation_anchors table
 *   5. Mark all included attestations with the anchor_id + timestamp
 *
 * Cost: ~0.000005 SOL per anchor (~$0.001). At once/hour = ~$0.024/day.
 *
 * Opt-in via MERKLE_ANCHOR_ENABLED=true (costs SOL per anchor).
 */

import { nanoid } from 'nanoid';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getDb } from '../db/connection';
import { logAudit } from '../db/index';
import { buildMerkleTree } from './merkle-anchor';
import { env } from '../config/index';
import { logger } from '../utils/logger';

// SPL Memo Program v2
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;

interface UnanchoredRow {
  id: string;
  input_hash: string;
}

/**
 * Get all attestations that haven't been anchored yet.
 */
function getUnanchoredAttestations(): UnanchoredRow[] {
  return getDb().prepare(
    'SELECT id, input_hash FROM attestations WHERE anchor_id IS NULL ORDER BY created_at ASC'
  ).all() as UnanchoredRow[];
}

/**
 * Send a Solana memo transaction with the Merkle root.
 * Returns the transaction signature.
 */
async function sendMemoTransaction(merkleRoot: string, attestationCount: number): Promise<string> {
  const raw = env.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY not set — cannot anchor on Solana');

  const connection = new Connection(env.SOLANA_RPC_URL, { commitment: 'confirmed' });
  const payer = Keypair.fromSecretKey(bs58.decode(raw));

  const memoText = JSON.stringify({
    protocol: 'clawnet-attestation-anchor',
    version: 1,
    merkle_root: merkleRoot,
    attestation_count: attestationCount,
    timestamp: new Date().toISOString(),
  });

  const memoInstruction = new TransactionInstruction({
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoText, 'utf-8'),
  });

  const tx = new Transaction().add(memoInstruction);

  const sig = await Promise.race([
    sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Solana memo transaction timeout (30s)')), 30_000)
    ),
  ]);

  return sig;
}

/**
 * Run one anchor cycle: gather un-anchored attestations, build tree, anchor on-chain.
 */
export async function runAnchorCycle(): Promise<{
  anchored: boolean;
  anchorId?: string;
  attestationCount?: number;
  merkleRoot?: string;
  solanaHash?: string;
  error?: string;
}> {
  const unanchored = getUnanchoredAttestations();

  if (unanchored.length === 0) {
    logger.debug('Merkle anchor: no un-anchored attestations — skipping');
    return { anchored: false };
  }

  const hashes = unanchored.map((r) => r.input_hash);
  const { root, tree } = buildMerkleTree(hashes);
  const anchorId = `anc-${nanoid(16)}`;
  const now = new Date().toISOString();

  // Store anchor record as pending first
  getDb().prepare(`
    INSERT INTO attestation_anchors (id, merkle_root, attestation_count, anchored_at, status, tree_json)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(anchorId, root, unanchored.length, now, JSON.stringify(tree));

  // Send the Solana memo transaction
  let solanaHash: string;
  try {
    solanaHash = await sendMemoTransaction(root, unanchored.length);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, anchorId, attestationCount: unanchored.length }, 'Merkle anchor: Solana memo failed');

    // Mark anchor as failed
    getDb().prepare(
      "UPDATE attestation_anchors SET status = 'failed' WHERE id = ?"
    ).run(anchorId);

    return { anchored: false, anchorId, attestationCount: unanchored.length, merkleRoot: root, error: errMsg };
  }

  // Update anchor with tx hash + mark confirmed
  getDb().prepare(
    "UPDATE attestation_anchors SET solana_tx_hash = ?, status = 'confirmed' WHERE id = ?"
  ).run(solanaHash, anchorId);

  // Mark all included attestations as anchored (batched for performance)
  const ids = unanchored.map((r) => r.id);
  const BATCH_SIZE = 500;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    getDb().prepare(
      `UPDATE attestations SET anchor_id = ?, anchored_at = ? WHERE id IN (${placeholders})`
    ).run(anchorId, now, ...batch);
  }

  logAudit({
    entityType: 'attestation_anchor',
    entityId: anchorId,
    action: 'MERKLE_ANCHOR_CONFIRMED',
    data: { merkleRoot: root, attestationCount: unanchored.length, solanaTxHash: solanaHash },
  });

  logger.info({
    anchorId,
    merkleRoot: root,
    attestationCount: unanchored.length,
    solanaTxHash: solanaHash,
  }, 'Merkle anchor: attestations anchored on Solana');

  return {
    anchored: true,
    anchorId,
    attestationCount: unanchored.length,
    merkleRoot: root,
    solanaHash,
  };
}

/**
 * Start the anchor cron. Runs at MERKLE_ANCHOR_INTERVAL_MS (default 1 hour).
 */
export function startAnchorCron(): void {
  if (!env.MERKLE_ANCHOR_ENABLED) {
    logger.info('Merkle anchor cron disabled — set MERKLE_ANCHOR_ENABLED=true to enable on-chain anchoring');
    return;
  }

  if (!env.SOLANA_PRIVATE_KEY) {
    logger.warn('Merkle anchor cron enabled but SOLANA_PRIVATE_KEY not set — skipping');
    return;
  }

  const intervalMs = env.MERKLE_ANCHOR_INTERVAL_MS;

  _interval = setInterval(() => {
    if (_running) return;
    _running = true;
    runAnchorCycle()
      .catch((err) => logger.error({ err }, 'Merkle anchor cron unhandled error'))
      .finally(() => { _running = false; });
  }, intervalMs);

  logger.info({ intervalMs }, 'Merkle anchor cron started');
}

/**
 * Stop the anchor cron.
 */
export function stopAnchorCron(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
