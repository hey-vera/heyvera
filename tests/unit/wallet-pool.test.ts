/**
 * Unit tests — Hot Wallet Pool
 *
 * Tests the wallet pool selection, health tracking, and recovery logic.
 * Mocks @solana/web3.js and env to avoid real key parsing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @solana/web3.js before importing wallet-pool
vi.mock('@solana/web3.js', () => {
  let counter = 0;
  class MockKeypair {
    publicKey: { toBase58: () => string };
    constructor() {
      counter++;
      this.publicKey = { toBase58: () => `wallet-pub-${counter}` };
    }
    static fromSecretKey(_bytes: Uint8Array): MockKeypair {
      return new MockKeypair();
    }
  }
  class MockPublicKey {
    constructor(public key: string) {}
    toBase58() { return this.key; }
  }
  return { Keypair: MockKeypair, PublicKey: MockPublicKey };
});

// Mock bs58 to return valid-length bytes
vi.mock('bs58', () => ({
  default: {
    decode: (_s: string) => new Uint8Array(64), // 64 bytes for Ed25519
  },
}));

// Mock env to control wallet configuration
vi.mock('../../src/config/index', () => ({
  env: {
    PLATFORM_PAYOUT_PRIVATE_KEY: 'primary-key-bs58',
    HOT_WALLET_POOL: '',
  },
}));

// Mock logger to suppress output
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getNextWallet,
  markWalletBusy,
  markWalletFree,
  markWalletFailure,
  markWalletSuccess,
  getPoolStatus,
  _resetPool,
} from '../../src/utils/wallet-pool';

beforeEach(() => {
  _resetPool();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Basic selection ─────────────────────────────────────────────────────────

describe('getNextWallet', () => {
  it('returns primary wallet when no pool configured', () => {
    const wallet = getNextWallet();
    expect(wallet).not.toBeNull();
    expect(wallet!.publicKey).toBeDefined();
    expect(wallet!.healthy).toBe(true);
  });

  it('returns the same wallet on repeated calls (idempotent init)', () => {
    const w1 = getNextWallet();
    const w2 = getNextWallet();
    expect(w1).not.toBeNull();
    expect(w1!.publicKey).toBe(w2!.publicKey);
  });
});

// ─── Busy/Free tracking ─────────────────────────────────────────────────────

describe('markWalletBusy / markWalletFree', () => {
  it('tracks pending transaction count correctly', () => {
    const wallet = getNextWallet()!;
    const pubkey = wallet.publicKey;

    expect(wallet.pendingTxCount).toBe(0);

    markWalletBusy(pubkey);
    expect(wallet.pendingTxCount).toBe(1);

    markWalletBusy(pubkey);
    expect(wallet.pendingTxCount).toBe(2);

    markWalletFree(pubkey);
    expect(wallet.pendingTxCount).toBe(1);

    markWalletFree(pubkey);
    expect(wallet.pendingTxCount).toBe(0);
  });

  it('does not go below zero pending count', () => {
    const wallet = getNextWallet()!;
    markWalletFree(wallet.publicKey); // already 0
    expect(wallet.pendingTxCount).toBe(0);
  });

  it('updates lastUsed on markWalletBusy', () => {
    const wallet = getNextWallet()!;
    expect(wallet.lastUsed).toBe(0);

    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    markWalletBusy(wallet.publicKey);
    expect(wallet.lastUsed).toBeGreaterThan(0);
  });
});

// ─── Failure tracking and health ─────────────────────────────────────────────

describe('markWalletFailure', () => {
  it('marks wallet unhealthy after 3 consecutive failures', () => {
    const wallet = getNextWallet()!;
    const pubkey = wallet.publicKey;

    markWalletFailure(pubkey);
    expect(wallet.healthy).toBe(true);
    expect(wallet.consecutiveFailures).toBe(1);

    markWalletFailure(pubkey);
    expect(wallet.healthy).toBe(true);
    expect(wallet.consecutiveFailures).toBe(2);

    markWalletFailure(pubkey);
    expect(wallet.healthy).toBe(false);
    expect(wallet.consecutiveFailures).toBe(3);
    expect(wallet.unhealthySince).toBeGreaterThan(0);
  });

  it('success resets failure counter', () => {
    const wallet = getNextWallet()!;
    const pubkey = wallet.publicKey;

    markWalletFailure(pubkey);
    markWalletFailure(pubkey);
    expect(wallet.consecutiveFailures).toBe(2);

    markWalletSuccess(pubkey);
    expect(wallet.consecutiveFailures).toBe(0);
  });
});

// ─── Recovery ────────────────────────────────────────────────────────────────

describe('unhealthy wallet recovery', () => {
  it('recovers after 60 seconds', () => {
    const wallet = getNextWallet()!;
    const pubkey = wallet.publicKey;

    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    // Make unhealthy
    markWalletFailure(pubkey);
    markWalletFailure(pubkey);
    markWalletFailure(pubkey);
    expect(wallet.healthy).toBe(false);

    // Advance 59 seconds — still unhealthy
    vi.advanceTimersByTime(59_000);
    // getNextWallet triggers recovery checks
    const still = getNextWallet()!;
    // With single wallet, it falls back to primary even if unhealthy
    // but the wallet object itself should still be unhealthy
    expect(wallet.healthy).toBe(false);

    // Advance to 60 seconds total
    vi.advanceTimersByTime(1_000);
    getNextWallet(); // triggers recovery check
    expect(wallet.healthy).toBe(true);
    expect(wallet.consecutiveFailures).toBe(0);
  });
});

// ─── getPoolStatus ───────────────────────────────────────────────────────────

describe('getPoolStatus', () => {
  it('returns correct counts for single wallet', () => {
    getNextWallet(); // ensure initialized
    const status = getPoolStatus();

    expect(status.total).toBe(1);
    expect(status.healthy).toBe(1);
    expect(status.busy).toBe(0);
    expect(status.wallets).toHaveLength(1);
  });

  it('reflects busy state after markWalletBusy', () => {
    const wallet = getNextWallet()!;
    markWalletBusy(wallet.publicKey);

    const status = getPoolStatus();
    expect(status.busy).toBe(1);
    expect(status.wallets[0].pendingTxCount).toBe(1);
  });

  it('reflects unhealthy state after failures', () => {
    const wallet = getNextWallet()!;
    markWalletFailure(wallet.publicKey);
    markWalletFailure(wallet.publicKey);
    markWalletFailure(wallet.publicKey);

    const status = getPoolStatus();
    expect(status.healthy).toBe(0);
    expect(status.wallets[0].healthy).toBe(false);
  });
});

// ─── LRU selection ───────────────────────────────────────────────────────────

describe('LRU selection', () => {
  it('prefers least recently used wallet', () => {
    // With single wallet, it always returns the same one.
    // This test validates the lastUsed tracking mechanism.
    const wallet = getNextWallet()!;
    expect(wallet.lastUsed).toBe(0); // never used

    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));
    markWalletBusy(wallet.publicKey);
    markWalletFree(wallet.publicKey);

    // lastUsed should be updated
    expect(wallet.lastUsed).toBeGreaterThan(0);
  });
});
