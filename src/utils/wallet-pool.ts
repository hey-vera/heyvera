/**
 * Hot Wallet Pool — round-robin multi-wallet support for Solana payouts.
 *
 * By default, only the primary wallet (PLATFORM_PAYOUT_PRIVATE_KEY) is used.
 * Set HOT_WALLET_POOL to a comma-separated list of bs58-encoded private keys
 * to add additional wallets for parallelism and rate-limit distribution.
 *
 * Selection: least-recently-used among healthy, non-busy wallets.
 * Health: a wallet is marked unhealthy after 3 consecutive failures and
 *         automatically recovers after 60 seconds.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { env } from '../config/index';
import { logger } from './logger';

export interface WalletInfo {
  publicKey: string;
  keypair: Keypair;
  pendingTxCount: number;
  lastUsed: number;
  healthy: boolean;
  consecutiveFailures: number;
  unhealthySince: number;      // timestamp when marked unhealthy (0 if healthy)
}

const UNHEALTHY_COOLDOWN_MS = 60_000;  // 60 seconds
const MAX_CONSECUTIVE_FAILURES = 3;

let pool: WalletInfo[] = [];
let initialized = false;

/**
 * Parse a bs58 private key into a WalletInfo entry.
 * Returns null if the key is invalid.
 */
function parseWallet(privateKeyBs58: string, label: string): WalletInfo | null {
  try {
    const decoded = bs58.decode(privateKeyBs58.trim());
    const keypair = Keypair.fromSecretKey(decoded);
    return {
      publicKey: keypair.publicKey.toBase58(),
      keypair,
      pendingTxCount: 0,
      lastUsed: 0,
      healthy: true,
      consecutiveFailures: 0,
      unhealthySince: 0,
    };
  } catch (err) {
    logger.error({ label, err }, 'Failed to parse wallet key — skipping');
    return null;
  }
}

/**
 * Initialize the wallet pool. Called lazily on first access.
 * Safe to call multiple times (idempotent after first init).
 */
function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  // Wallet #1: primary hot wallet (always present if configured)
  const primaryKey = env.PLATFORM_PAYOUT_PRIVATE_KEY;
  if (primaryKey) {
    const primary = parseWallet(primaryKey, 'primary');
    if (primary) {
      pool.push(primary);
      logger.info({ publicKey: primary.publicKey }, 'Wallet pool: primary wallet loaded');
    }
  }

  // Additional wallets from HOT_WALLET_POOL
  const poolKeys = env.HOT_WALLET_POOL;
  if (poolKeys) {
    const keys = poolKeys.split(',').map(k => k.trim()).filter(Boolean);
    const primaryPubkey = pool[0]?.publicKey;

    for (let i = 0; i < keys.length; i++) {
      const wallet = parseWallet(keys[i], `pool[${i}]`);
      if (wallet) {
        // Skip duplicates (same public key as primary or already in pool)
        if (wallet.publicKey === primaryPubkey || pool.some(w => w.publicKey === wallet.publicKey)) {
          logger.warn({ publicKey: wallet.publicKey }, 'Wallet pool: duplicate key — skipping');
          continue;
        }
        pool.push(wallet);
        logger.info({ publicKey: wallet.publicKey, index: pool.length }, 'Wallet pool: additional wallet loaded');
      }
    }
  }

  logger.info({ totalWallets: pool.length }, 'Wallet pool initialized');
}

/**
 * Check if an unhealthy wallet has cooled down and should be retried.
 */
function maybeRecover(wallet: WalletInfo): void {
  if (!wallet.healthy && wallet.unhealthySince > 0) {
    if (Date.now() - wallet.unhealthySince >= UNHEALTHY_COOLDOWN_MS) {
      wallet.healthy = true;
      wallet.consecutiveFailures = 0;
      wallet.unhealthySince = 0;
      logger.info({ publicKey: wallet.publicKey }, 'Wallet pool: wallet recovered after cooldown');
    }
  }
}

/**
 * Get the next available wallet using least-recently-used selection.
 * Prefers healthy, non-busy wallets. Falls back to primary if all are busy/unhealthy.
 * Returns null only if no wallets are configured at all.
 */
export function getNextWallet(): WalletInfo | null {
  ensureInitialized();
  if (pool.length === 0) return null;

  // Try to recover unhealthy wallets
  for (const w of pool) maybeRecover(w);

  // Find the least-recently-used healthy wallet with lowest pending count
  let best: WalletInfo | null = null;
  for (const w of pool) {
    if (!w.healthy) continue;
    if (best === null) {
      best = w;
      continue;
    }
    // Prefer fewer pending transactions, then least-recently-used
    if (w.pendingTxCount < best.pendingTxCount ||
        (w.pendingTxCount === best.pendingTxCount && w.lastUsed < best.lastUsed)) {
      best = w;
    }
  }

  // Fall back to primary wallet (index 0) if all are unhealthy
  if (!best && pool.length > 0) {
    logger.warn('Wallet pool: all wallets unhealthy — falling back to primary');
    best = pool[0];
  }

  return best;
}

/**
 * Mark a wallet as busy (transaction in flight).
 */
export function markWalletBusy(pubkey: string): void {
  ensureInitialized();
  const wallet = pool.find(w => w.publicKey === pubkey);
  if (wallet) {
    wallet.pendingTxCount++;
    wallet.lastUsed = Date.now();
  }
}

/**
 * Mark a wallet as free (transaction completed or failed).
 */
export function markWalletFree(pubkey: string): void {
  ensureInitialized();
  const wallet = pool.find(w => w.publicKey === pubkey);
  if (wallet && wallet.pendingTxCount > 0) {
    wallet.pendingTxCount--;
  }
}

/**
 * Record a successful transaction for a wallet (resets failure count).
 */
export function markWalletSuccess(pubkey: string): void {
  ensureInitialized();
  const wallet = pool.find(w => w.publicKey === pubkey);
  if (wallet) {
    wallet.consecutiveFailures = 0;
  }
}

/**
 * Record a failed transaction for a wallet.
 * After MAX_CONSECUTIVE_FAILURES, the wallet is marked unhealthy for UNHEALTHY_COOLDOWN_MS.
 */
export function markWalletFailure(pubkey: string): void {
  ensureInitialized();
  const wallet = pool.find(w => w.publicKey === pubkey);
  if (wallet) {
    wallet.consecutiveFailures++;
    if (wallet.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && wallet.healthy) {
      wallet.healthy = false;
      wallet.unhealthySince = Date.now();
      logger.warn({ publicKey: pubkey, failures: wallet.consecutiveFailures }, 'Wallet pool: wallet marked unhealthy');
    }
  }
}

/**
 * Get the current status of the wallet pool.
 */
export function getPoolStatus(): { total: number; healthy: number; busy: number; wallets: Array<{ publicKey: string; healthy: boolean; pendingTxCount: number }> } {
  ensureInitialized();
  // Check for recoveries
  for (const w of pool) maybeRecover(w);

  return {
    total: pool.length,
    healthy: pool.filter(w => w.healthy).length,
    busy: pool.filter(w => w.pendingTxCount > 0).length,
    wallets: pool.map(w => ({
      publicKey: w.publicKey,
      healthy: w.healthy,
      pendingTxCount: w.pendingTxCount,
    })),
  };
}

/**
 * Get all wallet public keys in the pool (for balance checks).
 * Returns Keypair objects so callers can derive token accounts.
 */
export function getAllPoolWallets(): Array<{ publicKey: string; keypair: Keypair }> {
  ensureInitialized();
  return pool.map(w => ({ publicKey: w.publicKey, keypair: w.keypair }));
}

/**
 * Reset pool state (for testing).
 */
export function _resetPool(): void {
  pool = [];
  initialized = false;
}
