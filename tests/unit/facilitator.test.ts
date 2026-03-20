/**
 * Unit tests — x402 Facilitator Pool
 *
 * Tests the FacilitatorPool failover, health tracking, and recovery logic.
 * Uses mock facilitator implementations to avoid real HTTP calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FacilitatorPool, type X402Facilitator } from '../../src/providers/x402-facilitator';

// Mock logger to suppress output
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/** Create a mock facilitator with configurable behavior */
function makeMockFacilitator(
  name: string,
  opts: {
    verifyResult?: { valid: boolean; txHash?: string; error?: string };
    settleResult?: { settled: boolean; txHash: string; error?: string };
    shouldThrow?: boolean;
    throwError?: string;
  } = {},
): X402Facilitator {
  const verifyResult = opts.verifyResult ?? { valid: true, txHash: 'tx-abc' };
  const settleResult = opts.settleResult ?? { settled: true, txHash: 'tx-abc' };

  return {
    name,
    url: `https://${name}.example.com`,
    verify: vi.fn(async () => {
      if (opts.shouldThrow) throw new Error(opts.throwError ?? `${name} verify error`);
      return verifyResult;
    }),
    settle: vi.fn(async () => {
      if (opts.shouldThrow) throw new Error(opts.throwError ?? `${name} settle error`);
      return settleResult;
    }),
    isHealthy: vi.fn(async () => !opts.shouldThrow),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Primary facilitator used first ──────────────────────────────────────────

describe('primary facilitator', () => {
  it('uses primary facilitator when healthy', async () => {
    const primary = makeMockFacilitator('primary');
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.verify({ test: true });

    expect(result.valid).toBe(true);
    expect(result.facilitator).toBe('primary');
    expect(primary.verify).toHaveBeenCalledTimes(1);
    expect(fallback.verify).not.toHaveBeenCalled();
  });

  it('settle uses primary facilitator when healthy', async () => {
    const primary = makeMockFacilitator('primary');
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.settle({ test: true });

    expect(result.settled).toBe(true);
    expect(result.facilitator).toBe('primary');
    expect(primary.settle).toHaveBeenCalledTimes(1);
    expect(fallback.settle).not.toHaveBeenCalled();
  });
});

// ─── Fallback on failure ─────────────────────────────────────────────────────

describe('fallback behavior', () => {
  it('falls back to secondary when primary throws', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.verify({ test: true });

    expect(result.valid).toBe(true);
    expect(result.facilitator).toBe('fallback');
    expect(primary.verify).toHaveBeenCalledTimes(1);
    expect(fallback.verify).toHaveBeenCalledTimes(1);
  });

  it('falls back to secondary when primary returns server error', async () => {
    const primary = makeMockFacilitator('primary', {
      verifyResult: { valid: false, error: 'Coinbase facilitator returned 500: Internal Server Error' },
    });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.verify({ test: true });

    expect(result.valid).toBe(true);
    expect(result.facilitator).toBe('fallback');
  });

  it('does NOT fall back for client-side rejection (invalid payment)', async () => {
    const primary = makeMockFacilitator('primary', {
      verifyResult: { valid: false, error: 'Payment signature invalid' },
    });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.verify({ test: true });

    // Should return the primary's rejection without trying fallback
    expect(result.valid).toBe(false);
    expect(result.facilitator).toBe('primary');
    expect(fallback.verify).not.toHaveBeenCalled();
  });

  it('settle falls back when primary fails', async () => {
    const primary = makeMockFacilitator('primary', {
      settleResult: { settled: false, txHash: '', error: 'Primary settle failed' },
    });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.settle({ test: true });

    expect(result.settled).toBe(true);
    expect(result.facilitator).toBe('fallback');
  });

  it('returns error when both facilitators fail', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback', { shouldThrow: true });
    const pool = new FacilitatorPool([primary, fallback]);

    const result = await pool.verify({ test: true });

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Health tracking ─────────────────────────────────────────────────────────

describe('health tracking', () => {
  it('marks facilitator unhealthy after 3 consecutive failures', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    // 3 calls to trigger unhealthy marking
    await pool.verify({});
    await pool.verify({});
    await pool.verify({});

    const status = pool.getStatus();
    const primaryStatus = status.find(s => s.name === 'primary');
    expect(primaryStatus!.consecutiveFailures).toBe(3);
    expect(primaryStatus!.healthy).toBe(false);
  });

  it('success resets failure counter', async () => {
    const callCount = { n: 0 };
    const primary: X402Facilitator = {
      name: 'primary',
      url: 'https://primary.example.com',
      verify: vi.fn(async () => {
        callCount.n++;
        if (callCount.n <= 2) throw new Error('temporary failure');
        return { valid: true, txHash: 'tx-ok' };
      }),
      settle: vi.fn(async () => ({ settled: true, txHash: 'tx-ok' })),
      isHealthy: vi.fn(async () => true),
    };
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    // 2 failures (primary fails, fallback succeeds)
    await pool.verify({});
    await pool.verify({});

    let status = pool.getStatus();
    expect(status.find(s => s.name === 'primary')!.consecutiveFailures).toBe(2);

    // 3rd call: primary succeeds now
    await pool.verify({});

    status = pool.getStatus();
    expect(status.find(s => s.name === 'primary')!.consecutiveFailures).toBe(0);
  });
});

// ─── Unhealthy recovery after cooldown ───────────────────────────────────────

describe('unhealthy recovery', () => {
  it('recovers after 60-second cooldown', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    // Make primary unhealthy (3 failures)
    await pool.verify({});
    await pool.verify({});
    await pool.verify({});

    let status = pool.getStatus();
    expect(status.find(s => s.name === 'primary')!.healthy).toBe(false);

    // Advance 61 seconds — should allow primary to be retried
    vi.advanceTimersByTime(61_000);

    // Now make primary work again
    (primary.verify as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true, txHash: 'tx-recovered' });

    const result = await pool.verify({});
    // Primary should be retried after cooldown
    expect(primary.verify).toHaveBeenCalled();
  });

  it('stays unhealthy before cooldown expires', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback');
    const pool = new FacilitatorPool([primary, fallback]);

    // Make primary unhealthy
    await pool.verify({});
    await pool.verify({});
    await pool.verify({});

    // Reset call counts
    (primary.verify as ReturnType<typeof vi.fn>).mockClear();
    (fallback.verify as ReturnType<typeof vi.fn>).mockClear();

    // Advance only 30 seconds — still in cooldown
    vi.advanceTimersByTime(30_000);

    await pool.verify({});
    // Primary should be skipped, only fallback called
    expect(primary.verify).not.toHaveBeenCalled();
    expect(fallback.verify).toHaveBeenCalledTimes(1);
  });
});

// ─── Both unhealthy = force-retry primary ────────────────────────────────────

describe('all unhealthy fallback', () => {
  it('force-retries primary when all facilitators are unhealthy', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback', { shouldThrow: true });
    const pool = new FacilitatorPool([primary, fallback]);

    // Make both unhealthy (3 failures each)
    await pool.verify({});
    await pool.verify({});
    await pool.verify({});

    const status = pool.getStatus();
    expect(status.every(s => !s.healthy)).toBe(true);

    // Reset mock to track new calls
    (primary.verify as ReturnType<typeof vi.fn>).mockClear();
    (primary.verify as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true, txHash: 'tx-forced' });

    // Next call should force-retry primary
    const result = await pool.verify({});
    expect(primary.verify).toHaveBeenCalled();
    expect(result.valid).toBe(true);
  });

  it('returns error when force-retried primary also fails', async () => {
    const primary = makeMockFacilitator('primary', { shouldThrow: true });
    const fallback = makeMockFacilitator('fallback', { shouldThrow: true });
    const pool = new FacilitatorPool([primary, fallback]);

    // Make both unhealthy
    await pool.verify({});
    await pool.verify({});
    await pool.verify({});

    // Force retry — primary still throws
    const result = await pool.verify({});
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─── Pool with no facilitators ───────────────────────────────────────────────

describe('empty pool', () => {
  it('verify returns error with no facilitators configured', async () => {
    const pool = new FacilitatorPool([]);
    const result = await pool.verify({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No x402 facilitators configured');
  });

  it('settle returns error with no facilitators configured', async () => {
    const pool = new FacilitatorPool([]);
    const result = await pool.settle({});
    expect(result.settled).toBe(false);
    expect(result.error).toContain('No x402 facilitators configured');
  });
});

// ─── getStatus / getUrls ─────────────────────────────────────────────────────

describe('pool metadata', () => {
  it('getStatus returns all facilitators with health info', () => {
    const primary = makeMockFacilitator('coinbase');
    const fallback = makeMockFacilitator('payai');
    const pool = new FacilitatorPool([primary, fallback]);

    const status = pool.getStatus();
    expect(status).toHaveLength(2);
    expect(status[0].name).toBe('coinbase');
    expect(status[0].healthy).toBe(true);
    expect(status[0].consecutiveFailures).toBe(0);
    expect(status[1].name).toBe('payai');
  });

  it('getUrls returns URLs in priority order', () => {
    const primary = makeMockFacilitator('coinbase');
    const fallback = makeMockFacilitator('payai');
    const pool = new FacilitatorPool([primary, fallback]);

    const urls = pool.getUrls();
    expect(urls).toEqual([
      'https://coinbase.example.com',
      'https://payai.example.com',
    ]);
  });

  it('getPrimaryUrl returns first available URL', () => {
    const primary = makeMockFacilitator('coinbase');
    const fallback = makeMockFacilitator('payai');
    const pool = new FacilitatorPool([primary, fallback]);

    expect(pool.getPrimaryUrl()).toBe('https://coinbase.example.com');
  });
});

// ─── checkHealth ─────────────────────────────────────────────────────────────

describe('checkHealth', () => {
  it('returns health status for all facilitators', async () => {
    const primary = makeMockFacilitator('coinbase');
    const fallback = makeMockFacilitator('payai', { shouldThrow: true });
    const pool = new FacilitatorPool([primary, fallback]);

    const health = await pool.checkHealth();
    expect(health.coinbase.healthy).toBe(true);
    expect(health.coinbase.consecutiveFailures).toBe(0);
    // payai isHealthy returns false since shouldThrow is true
    expect(health.payai.healthy).toBe(false);
  });
});
