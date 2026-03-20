/**
 * Solana USDC payout utility.
 *
 * Multi-Wallet Architecture:
 *   RECEIVING — public address only (SOLANA_RECEIVING_WALLET), users send USDC here
 *   HOT WALLET POOL — primary key (PLATFORM_PAYOUT_PRIVATE_KEY = SOLANA_PRIVATE_KEY)
 *                      + optional additional wallets (HOT_WALLET_POOL, comma-separated)
 *                      Round-robin LRU selection, auto-unhealthy after 3 failures.
 *
 * Sends USDC from a pool wallet to a recipient's Solana address.
 * Used by the payout cron to settle creator earnings from the skill marketplace.
 *
 * USDC mint (mainnet): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { env } from '../config/index';
import { logger } from './logger';
import {
  getNextWallet,
  markWalletBusy,
  markWalletFree,
  markWalletSuccess,
  markWalletFailure,
  getAllPoolWallets,
} from './wallet-pool';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

function getConnection(): Connection {
  return new Connection(env.SOLANA_RPC_URL, { commitment: 'confirmed' });
}

function getPlatformKeypair(): Keypair {
  const raw = env.PLATFORM_PAYOUT_PRIVATE_KEY;
  if (!raw) throw new Error('PLATFORM_PAYOUT_PRIVATE_KEY not set');
  const decoded = bs58.decode(raw);
  return Keypair.fromSecretKey(decoded);
}

/**
 * Send `amountUsdc` USDC from a pool wallet to `toWallet`.
 * Uses the wallet pool for round-robin selection when available,
 * falls back to the primary wallet if the pool is empty or all wallets are unhealthy.
 * Resolves to the transaction signature on success.
 * Throws on failure — caller should handle retry logic.
 */
export async function sendSolanaUsdc(toWallet: string, amountUsdc: number): Promise<string> {
  if (amountUsdc <= 0) throw new Error('Amount must be positive');

  const connection = getConnection();
  const recipient = new PublicKey(toWallet);

  const amountLamports = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
  if (amountLamports < 1n) throw new Error('Amount too small — minimum 0.000001 USDC');

  // Select wallet from pool (falls back to primary if pool not configured)
  const walletInfo = getNextWallet();
  const payer = walletInfo ? walletInfo.keypair : getPlatformKeypair();
  const walletPubkey = walletInfo ? walletInfo.publicKey : payer.publicKey.toBase58();

  if (walletInfo) {
    markWalletBusy(walletPubkey);
  }

  try {
    // Get or create the sender's USDC token account
    const senderAta = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);

    // Get or create the recipient's USDC token account (platform pays for ATA creation)
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      USDC_MINT,
      recipient,
    );

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        senderAta,
        USDC_MINT,
        recipientAta.address,
        payer.publicKey,
        amountLamports,
        USDC_DECIMALS,
      )
    );

    const sig = await Promise.race([
      sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Solana transaction timeout (30s)')), 30_000)),
    ]);

    if (walletInfo) {
      markWalletSuccess(walletPubkey);
    }

    logger.info({ sig, toWallet, amountUsdc, fromWallet: walletPubkey }, 'Solana USDC payout sent');
    return sig;
  } catch (err) {
    if (walletInfo) {
      markWalletFailure(walletPubkey);
    }
    throw err;
  } finally {
    if (walletInfo) {
      markWalletFree(walletPubkey);
    }
  }
}

/**
 * Check the USDC balance of the primary hot wallet (PLATFORM_PAYOUT_PRIVATE_KEY).
 * Used by the payout cron to alert when balance is low.
 * Returns balance in USDC (e.g. 42.50).
 */
export async function getHotWalletUsdcBalance(): Promise<number> {
  const connection = getConnection();
  const payer = getPlatformKeypair();
  const ata = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);

  try {
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 10 ** USDC_DECIMALS;
  } catch {
    // ATA doesn't exist yet — balance is 0
    return 0;
  }
}

/**
 * Check USDC + SOL balances of ALL wallets in the pool.
 * Returns per-wallet balances for health monitoring.
 */
export async function getAllWalletBalances(): Promise<Array<{
  publicKey: string;
  usdcBalance: number;
  solBalance: number;
}>> {
  const connection = getConnection();
  const wallets = getAllPoolWallets();

  // If no pool wallets, fall back to primary
  if (wallets.length === 0) {
    try {
      const payer = getPlatformKeypair();
      const ata = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
      let usdcBalance = 0;
      try {
        const account = await getAccount(connection, ata);
        usdcBalance = Number(account.amount) / 10 ** USDC_DECIMALS;
      } catch { /* ATA doesn't exist */ }
      const solBalance = await connection.getBalance(payer.publicKey) / LAMPORTS_PER_SOL;
      return [{ publicKey: payer.publicKey.toBase58(), usdcBalance, solBalance }];
    } catch {
      return [];
    }
  }

  const results: Array<{ publicKey: string; usdcBalance: number; solBalance: number }> = [];

  for (const w of wallets) {
    try {
      const pubkey = new PublicKey(w.publicKey);
      const ata = await getAssociatedTokenAddress(USDC_MINT, pubkey);
      let usdcBalance = 0;
      try {
        const account = await getAccount(connection, ata);
        usdcBalance = Number(account.amount) / 10 ** USDC_DECIMALS;
      } catch { /* ATA doesn't exist */ }
      const solBalance = await connection.getBalance(pubkey) / LAMPORTS_PER_SOL;
      results.push({ publicKey: w.publicKey, usdcBalance, solBalance });
    } catch (err) {
      logger.error({ publicKey: w.publicKey, err }, 'Failed to check wallet balance');
      results.push({ publicKey: w.publicKey, usdcBalance: 0, solBalance: 0 });
    }
  }

  return results;
}

/**
 * Check the SOL balance of any Solana wallet.
 * SOL is needed for transaction fees (gas). Returns balance in SOL.
 */
export async function getWalletSolBalance(publicKey: PublicKey): Promise<number> {
  const connection = getConnection();
  const lamports = await connection.getBalance(publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Check SOL balance of the hot wallet.
 */
export async function getPayoutWalletSolBalance(): Promise<number> {
  const payer = getPlatformKeypair();
  return getWalletSolBalance(payer.publicKey);
}

/**
 * Check SOL balance of the operations wallet (SOLANA_PRIVATE_KEY).
 * In the 2-wallet setup this is the same key as PLATFORM_PAYOUT_PRIVATE_KEY.
 * Returns null if SOLANA_PRIVATE_KEY is not configured.
 */
export async function getOperationsWalletSolBalance(): Promise<number | null> {
  const raw = env.SOLANA_PRIVATE_KEY;
  if (!raw) return null;
  try {
    const decoded = bs58.decode(raw);
    const keypair = Keypair.fromSecretKey(decoded);
    return getWalletSolBalance(keypair.publicKey);
  } catch {
    return null;
  }
}
