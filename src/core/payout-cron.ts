/**
 * Automated Solana USDC Payout Cron (Option A)
 *
 * Runs every 4 hours. Picks up all PENDING payout_requests and sends USDC
 * from the platform's hot wallet (PLATFORM_PAYOUT_PRIVATE_KEY) to each
 * creator's Solana address.
 *
 * - Payout rate: PAYOUT_USDC_PER_CREDIT (default $0.00075/credit — 25% below buy rate)
 * - Minimum payout: 1 USDC (requests below this stay PENDING until they accumulate)
 * - On success: status → PAID, tx_hash recorded
 * - On failure: status → REJECTED, notes recorded (admin can re-queue manually)
 * - Sends Telegram alert after each run with a summary
 *
 * To enable: set PLATFORM_PAYOUT_PRIVATE_KEY in env (bs58 Solana private key).
 */

import cron from 'node-cron';
import { getAllPendingPayouts, markPayoutPaid, updatePayoutStatus } from '../db/index';
import { sendSolanaUsdc } from '../utils/solana-payout';
import { sendTelegramAlert } from '../integrations/telegram';
import { logger } from '../utils/logger';
import { env } from '../config/index';

const PAYOUT_INTERVAL = '0 */4 * * *'; // every 4 hours
const MIN_PAYOUT_USDC = 1.0;           // hold requests below $1 until they accumulate

let cronTask: ReturnType<typeof cron.schedule> | null = null;

async function runPayoutCron(): Promise<void> {
  if (!env.PLATFORM_PAYOUT_PRIVATE_KEY) return; // silently skip — cron still registered but is a no-op

  const pending = getAllPendingPayouts();
  if (pending.length === 0) return;

  logger.info({ count: pending.length }, 'Payout cron: processing pending requests');

  let paid = 0;
  let failed = 0;
  let skipped = 0;
  let totalUsdc = 0;

  for (const req of pending) {
    const amountUsdc = req.amount_credits * env.PAYOUT_USDC_PER_CREDIT;

    if (amountUsdc < MIN_PAYOUT_USDC) {
      skipped++;
      logger.debug({ id: req.id, amountUsdc }, 'Payout below minimum — skipping until accumulated');
      continue;
    }

    try {
      const txHash = await sendSolanaUsdc(req.usdc_wallet, amountUsdc);
      markPayoutPaid(req.id, txHash);
      paid++;
      totalUsdc += amountUsdc;
      logger.info({ id: req.id, txHash, amountUsdc, wallet: req.usdc_wallet }, 'Payout sent');
    } catch (err) {
      const notes = err instanceof Error ? err.message : String(err);
      updatePayoutStatus(req.id, 'REJECTED', notes);
      failed++;
      logger.error({ id: req.id, err }, 'Payout failed');
    }
  }

  const summary = `Payout cron complete\nPaid: ${paid} | Failed: ${failed} | Skipped (< $${MIN_PAYOUT_USDC}): ${skipped}\nTotal sent: $${totalUsdc.toFixed(4)} USDC`;
  logger.info({ paid, failed, skipped, totalUsdc }, 'Payout cron complete');
  await sendTelegramAlert(summary).catch(() => undefined);
}

export function startPayoutCron(): void {
  if (!env.PLATFORM_PAYOUT_PRIVATE_KEY) {
    logger.info('Payout cron disabled — set PLATFORM_PAYOUT_PRIVATE_KEY to enable automated USDC payouts');
    return;
  }

  cronTask = cron.schedule(PAYOUT_INTERVAL, () => {
    runPayoutCron().catch((err) => logger.error({ err }, 'Payout cron unhandled error'));
  });

  logger.info({ interval: PAYOUT_INTERVAL, rate: env.PAYOUT_USDC_PER_CREDIT }, 'Payout cron started');
}

export function stopPayoutCron(): void {
  cronTask?.stop();
  cronTask = null;
}
