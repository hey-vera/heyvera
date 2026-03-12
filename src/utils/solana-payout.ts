/**
 * Solana USDC payout utility.
 *
 * Sends USDC from the platform's hot wallet (PLATFORM_PAYOUT_PRIVATE_KEY)
 * to a recipient's Solana address. Used by the payout cron to settle
 * creator earnings from the skill marketplace.
 *
 * USDC mint (mainnet): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { env } from '../config/index';
import { logger } from './logger';

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
 * Send `amountUsdc` USDC from the platform hot wallet to `toWallet`.
 * Resolves to the transaction signature on success.
 * Throws on failure — caller should handle retry logic.
 */
export async function sendSolanaUsdc(toWallet: string, amountUsdc: number): Promise<string> {
  if (amountUsdc <= 0) throw new Error('Amount must be positive');

  const connection = getConnection();
  const payer = getPlatformKeypair();
  const recipient = new PublicKey(toWallet);

  const amountLamports = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));
  if (amountLamports < 1n) throw new Error('Amount too small — minimum 0.000001 USDC');

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

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });

  logger.info({ sig, toWallet, amountUsdc }, 'Solana USDC payout sent');
  return sig;
}
