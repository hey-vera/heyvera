/**
 * Soma Verdict Anchor Cron
 *
 * Periodically anchors a Merkle root of recent Soma verdicts on Solana via the
 * SPL Memo program. This makes verification verdicts permanently verifiable
 * on-chain, even if the local SQLite DB is lost.
 *
 * Flow:
 *   1. Query soma_verdicts with anchor_id IS NULL (un-anchored)
 *   2. Build a Merkle tree from verdict hashes (subject + observer + verdict + genome)
 *   3. Send a Solana memo transaction containing the Merkle root
 *   4. Record the anchor in soma_verdict_anchors table
 *   5. Mark all included verdicts with the anchor_id + timestamp
 *
 * Cost: ~0.000005 SOL per anchor (~$0.001). At once/hour = ~$0.024/day.
 *
 * Opt-in via MERKLE_ANCHOR_ENABLED=true (same flag as legacy attestation anchor).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { buildMerkleTree } from './merkle-anchor';
import { somaHash } from '../utils/crypto-agility';
import {
  getUnanchoredVerdicts,
  createVerdictAnchor,
  markVerdictsAnchored,
  confirmVerdictAnchor,
} from '../db/soma-verdicts';
import { getDb, logAudit } from '../db/connection';
import { env } from '../config/index';
import { logger } from '../utils/logger';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Hash a verdict into a leaf for the Merkle tree.
 * Deterministic: same verdict always produces the same hash.
 */
function verdictLeafHash(v: { id: string; verdict: string; subjectDid: string; observerDid: string; confidence: number; createdAt: string }): string {
  return somaHash(`${v.id}|${v.subjectDid}|${v.observerDid}|${v.verdict}|${v.confidence}|${v.createdAt}`);
}

/**
 * Send a Solana memo transaction with the Soma verdict Merkle root.
 */
async function sendMemoTransaction(merkleRoot: string, verdictCount: number): Promise<string> {
  const raw = env.SOLANA_PRIVATE_KEY;
  if (!raw) throw new Error('SOLANA_PRIVATE_KEY not set — cannot anchor on Solana');

  const connection = new Connection(env.SOLANA_RPC_URL, { commitment: 'confirmed' });
  const payer = Keypair.fromSecretKey(bs58.decode(raw));

  const memoText = JSON.stringify({
    protocol: 'soma-verdict-anchor',
    version: 1,
    merkle_root: merkleRoot,
    verdict_count: verdictCount,
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
 * Run one anchor cycle: gather un-anchored verdicts, build tree, anchor on-chain.
 */
export async function runSomaAnchorCycle(): Promise<{
  anchored: boolean;
  anchorId?: string;
  verdictCount?: number;
  merkleRoot?: string;
  solanaHash?: string;
  error?: string;
}> {
  const verdicts = getUnanchoredVerdicts(10_000);

  if (verdicts.length === 0) {
    logger.debug('Soma anchor: no un-anchored verdicts — skipping');
    return { anchored: false };
  }

  // Build Merkle tree from verdict hashes
  const hashes = verdicts.map(verdictLeafHash);
  const { root, tree } = buildMerkleTree(hashes);

  // Create anchor record + mark verdicts in one transaction
  const anchorId = getDb().transaction(() => {
    const id = createVerdictAnchor(root, verdicts.length, JSON.stringify(tree));
    markVerdictsAnchored(verdicts.map(v => v.id), id);
    return id;
  })();

  // Send Solana memo (outside DB transaction — async I/O)
  let solanaHash: string;
  try {
    solanaHash = await sendMemoTransaction(root, verdicts.length);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, anchorId, verdictCount: verdicts.length }, 'Soma anchor: Solana memo failed');

    getDb().prepare("UPDATE soma_verdict_anchors SET status = 'failed' WHERE id = ?").run(anchorId);

    return { anchored: false, anchorId, verdictCount: verdicts.length, merkleRoot: root, error: errMsg };
  }

  // Confirm anchor with tx hash
  confirmVerdictAnchor(anchorId, solanaHash);

  logAudit({
    entityType: 'soma_verdict_anchor',
    entityId: anchorId,
    action: 'SOMA_ANCHOR_CONFIRMED',
    data: { merkleRoot: root, verdictCount: verdicts.length, solanaTxHash: solanaHash },
  });

  logger.info({
    anchorId,
    merkleRoot: root,
    verdictCount: verdicts.length,
    solanaTxHash: solanaHash,
  }, 'Soma anchor: verdicts anchored on Solana');

  return {
    anchored: true,
    anchorId,
    verdictCount: verdicts.length,
    merkleRoot: root,
    solanaHash,
  };
}

/**
 * Start the Soma verdict anchor cron.
 */
export function startSomaAnchorCron(): void {
  if (!env.MERKLE_ANCHOR_ENABLED) {
    logger.info('Soma anchor cron disabled — set MERKLE_ANCHOR_ENABLED=true to enable');
    return;
  }

  if (!env.SOLANA_PRIVATE_KEY) {
    logger.warn('Soma anchor cron enabled but SOLANA_PRIVATE_KEY not set — skipping');
    return;
  }

  const intervalMs = env.MERKLE_ANCHOR_INTERVAL_MS;

  _interval = setInterval(() => {
    if (_running) return;
    _running = true;
    runSomaAnchorCycle()
      .catch((err) => logger.error({ err }, 'Soma anchor cron unhandled error'))
      .finally(() => { _running = false; });
  }, intervalMs);

  logger.info({ intervalMs }, 'Soma verdict anchor cron started');
}

export function stopSomaAnchorCron(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
