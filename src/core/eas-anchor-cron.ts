/**
 * EAS Receipt Anchor Cron
 *
 * Periodically anchors a batch of Soma Receipt EAS UIDs on Base via
 * Merkle-root timestamping. One Base transaction timestamps all receipts
 * in the batch, regardless of batch size (~$0.001).
 *
 * Flow:
 *   1. Query soma_receipts with anchored_at IS NULL and eas_uid IS NOT NULL
 *   2. Build a Merkle tree from receipt hashes
 *   3. Timestamp the Merkle root on Base via EAS multiTimestamp
 *   4. Mark all included receipts as anchored
 *
 * Cost: ~$0.001 per batch on Base. At once/hour = ~$0.024/day.
 *
 * Opt-in via EAS_ANCHOR_ENABLED=true.
 */

import { buildMerkleTree } from './merkle-anchor';
import { somaHash } from '../utils/crypto-agility';
import { getUnanchoredReceipts, markReceiptsAnchored } from './soma-receipt';
import { getDb, logAudit } from '../db/connection';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { batchTimestamp } from '../utils/eas';
import { randomUUID } from 'crypto';

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Run one anchor cycle: gather un-anchored receipts, build Merkle tree,
 * timestamp on Base via EAS.
 */
export async function runEasAnchorCycle(): Promise<{
  anchored: boolean;
  anchorId?: string;
  receiptCount?: number;
  merkleRoot?: string;
  baseTxHash?: string;
  error?: string;
}> {
  const receipts = getUnanchoredReceipts(10_000);

  if (receipts.length === 0) {
    logger.debug('EAS anchor: no un-anchored receipts — skipping');
    return { anchored: false };
  }

  // Build Merkle tree from receipt+EAS UID hashes
  const hashes = receipts.map(r => somaHash(`${r.id}|${r.easUid}`));
  const { root } = buildMerkleTree(hashes);

  const anchorId = `eas-${randomUUID()}`;

  // Timestamp on Base via EAS
  let baseTxHash: string | null;
  try {
    baseTxHash = await batchTimestamp(receipts.map(r => r.easUid));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, anchorId, receiptCount: receipts.length }, 'EAS anchor: Base timestamp failed');
    return { anchored: false, anchorId, receiptCount: receipts.length, merkleRoot: root, error: errMsg };
  }

  if (!baseTxHash) {
    logger.warn({ anchorId, receiptCount: receipts.length }, 'EAS anchor: timestamp returned null — EAS may not be configured');
    return { anchored: false, anchorId, receiptCount: receipts.length, merkleRoot: root, error: 'EAS not configured or timestamp failed' };
  }

  // Mark receipts as anchored
  markReceiptsAnchored(receipts.map(r => r.id), anchorId);

  logAudit({
    entityType: 'eas_receipt_anchor',
    entityId: anchorId,
    action: 'EAS_ANCHOR_CONFIRMED',
    data: { merkleRoot: root, receiptCount: receipts.length, baseTxHash },
  });

  logger.info({
    anchorId,
    merkleRoot: root,
    receiptCount: receipts.length,
    baseTxHash,
  }, 'EAS anchor: receipts timestamped on Base');

  return {
    anchored: true,
    anchorId,
    receiptCount: receipts.length,
    merkleRoot: root,
    baseTxHash,
  };
}

/**
 * Start the EAS receipt anchor cron.
 */
export function startEasAnchorCron(): void {
  if (!env.EAS_ANCHOR_ENABLED) {
    logger.info('EAS anchor cron disabled — set EAS_ANCHOR_ENABLED=true to enable');
    return;
  }

  if (!env.EVM_PRIVATE_KEY) {
    logger.warn('EAS anchor cron enabled but EVM_PRIVATE_KEY not set — skipping');
    return;
  }

  if (!env.EAS_SCHEMA_UID) {
    logger.warn('EAS anchor cron enabled but EAS_SCHEMA_UID not set — skipping');
    return;
  }

  const intervalMs = env.EAS_ANCHOR_INTERVAL_MS;

  _interval = setInterval(() => {
    if (_running) return;
    _running = true;
    runEasAnchorCycle()
      .catch((err) => logger.error({ err }, 'EAS anchor cron unhandled error'))
      .finally(() => { _running = false; });
  }, intervalMs);

  logger.info({ intervalMs }, 'EAS receipt anchor cron started (Base chain)');
}

export function stopEasAnchorCron(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
