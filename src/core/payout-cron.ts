/**
 * Automated Solana USDC Payout Cron
 *
 * Runs every 4 hours. Picks up all PENDING payout_requests and sends USDC
 * from the platform's hot wallet to each creator's Solana address.
 *
 * 2-Wallet Architecture:
 *   RECEIVING — public address only, users send USDC here to buy credits
 *   HOT WALLET — single key for x402 API calls + creator payouts
 *              (SOLANA_PRIVATE_KEY and PLATFORM_PAYOUT_PRIVATE_KEY = same key)
 *
 * - Payout rate: PAYOUT_USDC_PER_CREDIT (default $0.00075/credit — 25% below buy rate)
 * - Minimum payout: 1 USDC (requests below this stay PENDING until they accumulate)
 * - On success: status → PAID, tx_hash recorded
 * - On failure: status → REJECTED, notes recorded (admin can re-queue manually)
 * - Sends admin email alert after each run with a summary
 * - Checks hot wallet balances (USDC + SOL gas) and alerts if low
 *
 * To enable: set PLATFORM_PAYOUT_PRIVATE_KEY in env (bs58 Solana private key).
 */

import cron from 'node-cron';
import { getAllPendingPayouts, markPayoutPaid, updatePayoutStatus, getTreasuryBalance, deductTreasuryForSweep, recordTransaction, getAllAutoPayoutConfigs, getCreatorEarnedBalance, createPayoutRequest, logAudit, topUpCredits } from '../db/index';
import { sendSolanaUsdc, getHotWalletUsdcBalance, getPayoutWalletSolBalance } from '../utils/solana-payout';
import { sendAdminAlert } from '../utils/email';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { env } from '../config/index';

const PAYOUT_INTERVAL = '0 */4 * * *'; // every 4 hours
const MIN_PAYOUT_USDC = 1.0;           // hold requests below $1 until they accumulate

let cronTask: ReturnType<typeof cron.schedule> | null = null;
let _running = false;

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

    // Email admin about treasury sweep
    sendAdminAlert({
      subject: `Treasury sweep: $${amountUsdc.toFixed(4)} USDC sent`,
      body: [
        'Treasury auto-sweep completed',
        '',
        `Credits swept : ${balance.toLocaleString()}`,
        `USDC sent     : $${amountUsdc.toFixed(4)}`,
        `To wallet     : ${env.TREASURY_SWEEP_WALLET}`,
        `Transaction   : ${txHash}`,
      ].join('\n'),
    }).catch(() => {});

    return { swept: true, credits: balance, usdc: amountUsdc, txHash };
  } catch (err) {
    // Re-credit treasury on send failure so credits aren't lost
    const { topUpCredits } = await import('../db/index');
    topUpCredits('clawhub-treasury', balance);
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, balance, amountUsdc }, 'Treasury sweep: send failed — credits re-credited');

    sendAdminAlert({
      subject: 'FAILED: Treasury sweep',
      body: [
        'Treasury sweep FAILED — credits have been re-credited',
        '',
        `Credits      : ${balance.toLocaleString()}`,
        `USDC amount  : $${amountUsdc.toFixed(4)}`,
        `Error        : ${errMsg}`,
      ].join('\n'),
    }).catch(() => {});

    return { swept: false, credits: balance, error: errMsg };
  }
}

/**
 * Check hot wallet balances (USDC + SOL gas) and return alerts for any that are low.
 * In the 2-wallet setup, SOLANA_PRIVATE_KEY and PLATFORM_PAYOUT_PRIVATE_KEY are the
 * same key, so we only need to check one wallet.
 */
async function checkWalletBalances(): Promise<string[]> {
  const warnings: string[] = [];

  if (!env.PLATFORM_PAYOUT_PRIVATE_KEY) return warnings;

  // ─── Hot wallet USDC ─────────────────────────────────────────────────────
  try {
    const usdcBalance = await getHotWalletUsdcBalance();
    if (usdcBalance < env.HOT_WALLET_LOW_BALANCE_USDC) {
      warnings.push(`Hot wallet USDC low: $${usdcBalance.toFixed(2)} (threshold: $${env.HOT_WALLET_LOW_BALANCE_USDC})`);
      logger.warn({ usdcBalance, threshold: env.HOT_WALLET_LOW_BALANCE_USDC }, 'Hot wallet USDC low');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to check hot wallet USDC balance');
  }

  // ─── Hot wallet SOL (gas) ────────────────────────────────────────────────
  try {
    const solBalance = await getPayoutWalletSolBalance();
    if (solBalance < env.HOT_WALLET_LOW_SOL) {
      warnings.push(`Hot wallet SOL low: ${solBalance.toFixed(4)} SOL (threshold: ${env.HOT_WALLET_LOW_SOL} SOL) — transactions will fail`);
      logger.warn({ solBalance, threshold: env.HOT_WALLET_LOW_SOL }, 'Hot wallet SOL (gas) low');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to check hot wallet SOL balance');
  }

  return warnings;
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

      // Email admin for each successful payout
      sendAdminAlert({
        subject: `Payout sent: $${amountUsdc.toFixed(4)} USDC to creator`,
        body: [
          'Creator payout completed',
          '',
          `Payout ID   : ${req.id}`,
          `Credits     : ${req.amount_credits.toLocaleString()}`,
          `USDC sent   : $${amountUsdc.toFixed(4)}`,
          `To wallet   : ${req.usdc_wallet}`,
          `Transaction : ${txHash}`,
        ].join('\n'),
      }).catch(() => {});
    } catch (err) {
      const notes = err instanceof Error ? err.message : String(err);
      updatePayoutStatus(req.id, 'REJECTED', notes);
      topUpCredits(req.agent_key, req.amount_credits);
      logAudit({ entityType: 'payout', entityId: req.id, action: 'PAYOUT_CREDITS_RESTORED', data: { amount: req.amount_credits } });
      failed++;
      logger.error({ id: req.id, err }, 'Payout failed — credits restored');

      // Email admin for failed payouts
      sendAdminAlert({
        subject: `FAILED payout: $${amountUsdc.toFixed(4)} USDC to ${req.usdc_wallet.slice(0, 8)}...`,
        body: [
          'Creator payout FAILED — status set to REJECTED',
          '',
          `Payout ID   : ${req.id}`,
          `Credits     : ${req.amount_credits.toLocaleString()}`,
          `USDC amount : $${amountUsdc.toFixed(4)}`,
          `To wallet   : ${req.usdc_wallet}`,
          `Error       : ${notes}`,
          '',
          'Action: Review in admin panel. Re-queue manually if needed.',
        ].join('\n'),
      }).catch(() => {});
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

  // ─── 3. Wallet balance checks (USDC + SOL gas) ────────────────────────────
  const walletWarnings = await checkWalletBalances();

  // ─── 4. Summary email ─────────────────────────────────────────────────────
  const lines: string[] = [];
  const hasActivity = pending.length > 0 || sweep.swept || autoTriggered > 0;

  if (hasActivity) {
    lines.push('Payout cron completed');
    lines.push('');
    if (autoTriggered > 0) {
      lines.push(`Auto-payouts triggered: ${autoTriggered}`);
    }
    if (pending.length > 0) {
      lines.push(`Creators — Paid: ${paid} | Failed: ${failed} | Skipped (< $${MIN_PAYOUT_USDC}): ${skipped}`);
      lines.push(`Total USDC sent to creators: $${totalUsdc.toFixed(4)}`);
    }
    if (sweep.swept) {
      lines.push(`Treasury sweep: ${sweep.credits} credits → $${sweep.usdc!.toFixed(4)} USDC (tx: ${sweep.txHash!.slice(0, 12)}...)`);
    } else if (sweep.error) {
      lines.push(`Treasury sweep FAILED: ${sweep.error}`);
    }
  }

  if (walletWarnings.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('WALLET BALANCE ALERTS:');
    lines.push(...walletWarnings);

    // Send separate urgent email for wallet warnings
    sendAdminAlert({
      subject: `Wallet balance alert — ${walletWarnings.length} warning(s)`,
      body: [
        'One or more platform wallets are below threshold:',
        '',
        ...walletWarnings,
        '',
        'Action: Top up the affected wallet(s) to prevent failed transactions.',
      ].join('\n'),
    }).catch(() => {});
  }

  logger.info({ paid, failed, skipped, totalUsdc, autoTriggered, sweep: sweep.swept ? sweep.usdc : null, walletWarnings: walletWarnings.length }, 'Payout cron complete');

  // Send summary email only if there was activity
  if (hasActivity && lines.length > 0) {
    sendAdminAlert({
      subject: `Payout summary — ${paid} paid, $${totalUsdc.toFixed(2)} USDC sent`,
      body: lines.join('\n'),
    }).catch(() => {});
  }
}

export function startPayoutCron(): void {
  if (!env.PLATFORM_PAYOUT_PRIVATE_KEY) {
    logger.info('Payout cron disabled — set PLATFORM_PAYOUT_PRIVATE_KEY to enable automated USDC payouts');
    return;
  }

  cronTask = cron.schedule(PAYOUT_INTERVAL, () => {
    if (_running) return;
    _running = true;
    runPayoutCron()
      .catch((err) => logger.error({ err }, 'Payout cron unhandled error'))
      .finally(() => { _running = false; });
  });

  logger.info({ interval: PAYOUT_INTERVAL, rate: env.PAYOUT_USDC_PER_CREDIT }, 'Payout cron started');
}

export function stopPayoutCron(): void {
  cronTask?.stop();
  cronTask = null;
}
