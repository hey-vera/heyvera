/**
 * gas-circuit-breaker.ts — Gas price circuit breaker for batch settlement (Vector 43)
 *
 * Prevents batch settlements from executing when gas prices spike,
 * protecting the hot wallet from unexpected costs.
 *
 * Thresholds (Base L2):
 *   Normal:  < 0.1 gwei  → proceed
 *   Warning: 0.1 - 1 gwei → proceed with logging
 *   High:    1 - 10 gwei  → delay non-urgent settlements
 *   Spike:   > 10 gwei    → block all settlements, queue for retry
 *
 * The circuit breaker has 3 states:
 *   CLOSED  — normal operation
 *   OPEN    — gas too high, blocking settlements
 *   HALF    — testing if gas has dropped, allow one settlement
 */

import { logger } from './logger';

// ─── Types ──────────────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half_open';

interface GasCircuitBreaker {
  state: CircuitState;
  lastGasPrice: number | null; // in gwei
  lastChecked: number; // timestamp ms
  openedAt: number | null;
  failCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const GAS_THRESHOLDS = {
  normal: 0.1,    // gwei — Base L2 normal
  warning: 1.0,   // gwei — elevated
  high: 10.0,     // gwei — block non-urgent
  spike: 50.0,    // gwei — block everything
};

const CHECK_INTERVAL_MS = 60_000; // Check gas every 60 seconds
const COOLDOWN_MS = 300_000; // 5 minutes before retrying after open

// ─── State ──────────────────────────────────────────────────────────────────

const breaker: GasCircuitBreaker = {
  state: 'closed',
  lastGasPrice: null,
  lastChecked: 0,
  openedAt: null,
  failCount: 0,
};

// ─── Gas Price Fetching ─────────────────────────────────────────────────────

/**
 * Fetch current gas price from Base L2.
 * Uses eth_gasPrice RPC call (free, no API key needed for public RPCs).
 */
async function fetchGasPrice(): Promise<number | null> {
  const rpcUrl = process.env.BASE_RPC_URL || process.env.SOLANA_RPC_URL;
  if (!rpcUrl || !rpcUrl.includes('eth') && !rpcUrl.includes('base')) {
    return null; // No Base RPC configured
  }

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json() as { result?: string };
    if (!data.result) return null;

    // Convert hex wei to gwei
    const gasPriceWei = parseInt(data.result, 16);
    return gasPriceWei / 1e9;
  } catch {
    return null;
  }
}

// ─── Circuit Breaker Logic ──────────────────────────────────────────────────

/**
 * Check if settlement should proceed based on gas conditions.
 *
 * @param urgent - If true, only blocks at spike level (>50 gwei)
 * @returns { allowed: boolean, gasPrice: number | null, state: CircuitState }
 */
export async function checkGasCircuitBreaker(urgent: boolean = false): Promise<{
  allowed: boolean;
  gasPrice: number | null;
  state: CircuitState;
  reason?: string;
}> {
  const now = Date.now();

  // Rate limit gas checks
  if (now - breaker.lastChecked < CHECK_INTERVAL_MS && breaker.lastGasPrice !== null) {
    // Use cached gas price
    return evaluateGas(breaker.lastGasPrice, urgent);
  }

  // Fetch fresh gas price
  const gasPrice = await fetchGasPrice();
  breaker.lastChecked = now;

  if (gasPrice === null) {
    // Can't check gas — allow by default (fail-open for gas checks)
    // This is the opposite of trust verification (fail-closed)
    // because blocking settlements is worse than overpaying gas
    return { allowed: true, gasPrice: null, state: breaker.state, reason: 'Gas price unavailable, proceeding' };
  }

  breaker.lastGasPrice = gasPrice;
  return evaluateGas(gasPrice, urgent);
}

function evaluateGas(gasPrice: number, urgent: boolean): {
  allowed: boolean;
  gasPrice: number;
  state: CircuitState;
  reason?: string;
} {
  const now = Date.now();

  // Check if we're in cooldown from an open circuit
  if (breaker.state === 'open' && breaker.openedAt) {
    if (now - breaker.openedAt < COOLDOWN_MS) {
      return {
        allowed: false,
        gasPrice,
        state: 'open',
        reason: `Circuit breaker open, cooling down (${Math.round((COOLDOWN_MS - (now - breaker.openedAt)) / 1000)}s remaining)`,
      };
    }
    // Cooldown expired — move to half-open
    breaker.state = 'half_open';
  }

  // Evaluate gas price against thresholds
  if (gasPrice >= GAS_THRESHOLDS.spike) {
    breaker.state = 'open';
    breaker.openedAt = now;
    breaker.failCount++;
    logger.warn({ gasPrice, threshold: GAS_THRESHOLDS.spike }, 'Gas circuit breaker OPEN — spike detected');
    return { allowed: false, gasPrice, state: 'open', reason: `Gas price ${gasPrice.toFixed(3)} gwei exceeds spike threshold` };
  }

  if (gasPrice >= GAS_THRESHOLDS.high && !urgent) {
    // Block non-urgent settlements
    return { allowed: false, gasPrice, state: breaker.state, reason: `Gas price ${gasPrice.toFixed(3)} gwei — delaying non-urgent settlement` };
  }

  if (gasPrice >= GAS_THRESHOLDS.warning) {
    logger.debug({ gasPrice }, 'Gas price elevated');
  }

  // Gas is acceptable
  if (breaker.state === 'half_open') {
    breaker.state = 'closed';
    breaker.failCount = 0;
    logger.info({ gasPrice }, 'Gas circuit breaker CLOSED — gas price normalized');
  }

  return { allowed: true, gasPrice, state: breaker.state };
}

/**
 * Get the current circuit breaker status.
 */
export function getGasCircuitBreakerStatus(): {
  state: CircuitState;
  lastGasPrice: number | null;
  lastChecked: string | null;
  failCount: number;
  thresholds: typeof GAS_THRESHOLDS;
} {
  return {
    state: breaker.state,
    lastGasPrice: breaker.lastGasPrice,
    lastChecked: breaker.lastChecked ? new Date(breaker.lastChecked).toISOString() : null,
    failCount: breaker.failCount,
    thresholds: GAS_THRESHOLDS,
  };
}

/**
 * Manually reset the circuit breaker (admin operation).
 */
export function resetGasCircuitBreaker(): void {
  breaker.state = 'closed';
  breaker.lastGasPrice = null;
  breaker.lastChecked = 0;
  breaker.openedAt = null;
  breaker.failCount = 0;
  logger.info('Gas circuit breaker manually reset');
}
