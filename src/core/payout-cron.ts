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
import { getAllPendingPayouts, markPayoutPaid, updatePayoutStatus, getTreasuryBalance, deductTreasuryForSweep, recordTransaction, getAllAutoPayoutConfigs, getCreatorEarnedBalance, createPayoutRequest, logAudit } from '../db/index';
import { sendSolanaUsdc, getHotWalletUsdcBalance } from '../utils/solana-payout';
import { sendTelegramAlert } from '../integrations/telegram';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { env } from '../config/index';

const PAYOUT_INTERVAL = '0 */4 * * *'; // every 4 hours
const MIN_PAYOUT_USDC = 1.0;           // hold requests below $1 until they accumulate

let cronTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Sweep accumulated treasury credits to the owner's Solana wallet.
 * Only fires when TREASURY_SWEEP_WALLET is set and balance >= TREASURY_SWEEP_MIN.
 */
async function sweepTreasury(): Promise<{ swept: boolean; credits?: number; usdc?: number; txHash?: string; error?: string }> {
  if (!env.TREASURY_SWEEP_WALLET) return { swept: false };

  const balance = getTreasuryBalance();
  if (balance < env.TREASURY_SWEEP_MIN) {
    logger.debug({ balance, min: env.TREASURY_SWEEP_MIN }, 'Treasury sweep: below minimum — skipping');
    return { swept: false };
  }

  const amountUsdc = balance * env.PAYOUT_USDC_PER_CREDIT;
  if (amountUsdc < MIN_PAYOUT_USDC) {
    logger.debug({ balance, amountUsdc }, 'Treasury sweep: USDC amount below $1 minimum — skipping');
    return { swept: false };
  }

  // Deduct first — if send fails, credits stay deducted (we'll re-credit on failure)
  if (!deductTreasuryForSweep(balance)) {
    logger.warn({ balance }, 'Treasury sweep: deduction failed — balance may have changed');
    return { swept: false, error: 'Deduction failed' };
  }

  try {
    const txHash = await sendSolanaUsdc(env.TREASURY_SWEEP_WALLET, amountUsdc);

    // Record in transactions ledger for full audit trail
    recordTransaction({
      fromAgent: 'clawhub-treasury',
      amountCredits: balance,
      type: 'TREASURY_SWEEP',
      metadata: { txHash, amountUsdc, wallet: env.TREASURY_SWEEP_WALLET },
    });

    logger.info({ txHash, credits: balance, amountUsdc, wallet: env.TREASURY_SWEEP_WALLET }, 'Treasury sweep: USDC sent');
    return { swept: true, credits: balance, usdc: amountUsdc, txHash };
  } catch (err) {
    // Re-credit treasury on send failure so credits aren't lost
    const { topUpCredits } = await import('../db/index');
    topUpCredits('clawhub-treasury', balance);
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, balance, amountUsdc }, 'Treasury sweep: send failed — credits re-credited');
    return { swept: false, credits: balance, error: errMsg };
  }
}

/**
 * Check hot wallet USDC balance and alert if below threshold.
 */
async function checkHotWalletBalance(): Promise<string | null> {
  if (!env.PLATFORM_PAYOUT_PRIVATE_KEY) return null;

  try {
    const balance = await getHotWalletUsdcBalance();
    if (balance < env.HOT_WALLET_LOW_BALANCE_USDC) {
      const msg = `⚠️ Hot wallet low: $${balance.toFixed(2)} USDC (threshold: $${env.HOT_WALLET_LOW_BALANCE_USDC}).\nTop up the PLATFORM_PAYOUT_PRIVATE_KEY wallet to continue automated payouts.`;
      logger.warn({ balance, threshold: env.HOT_WALLET_LOW_BALANCE_USDC }, 'Hot wallet balance low');
      return msg;
    }
    logger.debug({ balance }, 'Hot wallet balance OK');
  } catch (err) {
    logger.error({ err }, 'Failed to check hot wallet balance');
  }
  return null;
}

async function runPayoutCron(): Promise<void> {
  if (!env.PLATFORM_PAYOUT_PRIVATE_KEY) return; // silently skip — cron still registered but is a no-op

  // ─── 1. Process creator payouts ───────────────────────────────────────────
  const pending = getAllPendingPayouts();

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

  // ─── 1b. Auto-payout threshold checks ────────────────────────────────────
  let autoTriggered = 0;
  try {
    const autoConfigs = getAllAutoPayoutConfigs();
    for (const config of autoConfigs) {
      const earned = getCreatorEarnedBalance(config.agent_key);
      if (earned >= config.threshold_credits) {
        const result = createPayoutRequest({
          agentKey: config.agent_key,
          amountCredits: earned,
          usdcWallet: config.usdc_wallet,
        });
        if (result.ok) {
          autoTriggered++;
          logAudit({ entityType: 'payout', entityId: result.id!, action: 'AUTO_PAYOUT_TRIGGERED', actorId: 'system',
            data: { threshold: config.threshold_credits, amount: earned } });
          logger.info({ agentKey: maskApiKey(config.agent_key), earned, threshold: config.threshold_credits }, 'Auto-payout triggered');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Auto-payout threshold check failed');
  }

  // ─── 2. Treasury auto-sweep ───────────────────────────────────────────────
  const sweep = await sweepTreasury();

  // ─── 3. Hot wallet balance check ──────────────────────────────────────────
  const walletWarning = await checkHotWalletBalance();

  // ─── 4. Telegram summary ──────────────────────────────────────────────────
  const lines: string[] = [];

  if (pending.length > 0 || sweep.swept || autoTriggered > 0) {
    lines.push('💰 Payout cron complete');
    if (autoTriggered > 0) {
      lines.push(`Auto-payouts triggered: ${autoTriggered}`);
    }
    if (pending.length > 0) {
      lines.push(`Creators — Paid: ${paid} | Failed: ${failed} | Skipped (< $${MIN_PAYOUT_USDC}): ${skipped}`);
      lines.push(`Total sent to creators: $${totalUsdc.toFixed(4)} USDC`);
    }
    if (sweep.swept) {
      lines.push(`Treasury sweep: ${sweep.credits} credits → $${sweep.usdc!.toFixed(4)} USDC (tx: ${sweep.txHash!.slice(0, 12)}...)`);
    } else if (sweep.error) {
      lines.push(`Treasury sweep FAILED: ${sweep.error}`);
    }
  }

  if (walletWarning) lines.push('', walletWarning);

  logger.info({ paid, failed, skipped, totalUsdc, autoTriggered, sweep: sweep.swept ? sweep.usdc : null }, 'Payout cron complete');

  if (lines.length > 0) {
    await sendTelegramAlert(lines.join('\n')).catch(() => undefined);
  }
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
