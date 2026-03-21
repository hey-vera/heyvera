/**
 * Multi-facilitator x402 abstraction.
 *
 * Supports Coinbase and PayAI as x402 facilitators with automatic failover.
 * The FacilitatorPool tries the primary facilitator first, then falls back
 * to the secondary on failure. Health is tracked with a simple consecutive-
 * failure counter: 3 failures marks a facilitator unhealthy, and it is
 * re-checked after a 60-second cooldown.
 *
 * Usage:
 *   import { getFacilitatorPool } from '../providers/x402-facilitator';
 *   const pool = getFacilitatorPool();
 *   const result = await pool.verify(paymentPayload);
 *   const settled = await pool.settle(paymentPayload);
 */

import { env } from '../config/index';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface X402Facilitator {
  /** Human-readable facilitator name */
  name: string;
  /** Facilitator base URL */
  url: string;
  /** Verify a payment proof is valid */
  verify(paymentPayload: unknown): Promise<{ valid: boolean; txHash?: string; error?: string }>;
  /** Settle (finalize) a payment */
  settle(paymentPayload: unknown): Promise<{ settled: boolean; txHash: string; error?: string }>;
  /** Check if the facilitator is reachable */
  isHealthy(): Promise<boolean>;
}

interface HealthState {
  consecutiveFailures: number;
  markedUnhealthyAt: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CONSECUTIVE_FAILURES = 3;
const UNHEALTHY_COOLDOWN_MS = 60_000; // 60 seconds before re-checking an unhealthy facilitator
const REQUEST_TIMEOUT_MS = 10_000;

// ─── Coinbase Facilitator ────────────────────────────────────────────────────

class CoinbaseFacilitator implements X402Facilitator {
  readonly name = 'coinbase';
  readonly url: string;

  constructor(url?: string) {
    this.url = url ?? env.X402_FACILITATOR_URL;
  }

  async verify(paymentPayload: unknown): Promise<{ valid: boolean; txHash?: string; error?: string }> {
    const res = await fetch(`${this.url}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      return { valid: false, error: `Coinbase facilitator returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const result = await res.json() as Record<string, unknown>;
    const valid = !!(result.valid || result.verified);
    return {
      valid,
      txHash: (result.txHash ?? result.transactionHash) as string | undefined,
      error: valid ? undefined : (result.error as string | undefined) ?? 'Verification failed',
    };
  }

  async settle(paymentPayload: unknown): Promise<{ settled: boolean; txHash: string; error?: string }> {
    const res = await fetch(`${this.url}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      return { settled: false, txHash: '', error: `Coinbase settle returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const result = await res.json() as Record<string, unknown>;
    return {
      settled: !!(result.settled || result.success),
      txHash: (result.txHash ?? result.transactionHash ?? '') as string,
      error: result.error as string | undefined,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(this.url, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok || res.status === 404; // 404 on root is fine — server is alive
    } catch {
      return false;
    }
  }
}

// ─── PayAI Facilitator ───────────────────────────────────────────────────────

class PayAIFacilitator implements X402Facilitator {
  readonly name = 'payai';
  readonly url: string;
  private readonly apiKeyId?: string;
  private readonly apiKeySecret?: string;

  constructor(url?: string, apiKeyId?: string, apiKeySecret?: string) {
    this.url = url ?? env.X402_PAYAI_URL ?? 'https://facilitator.payai.network';
    this.apiKeyId = apiKeyId ?? env.X402_PAYAI_API_KEY_ID;
    this.apiKeySecret = apiKeySecret ?? env.X402_PAYAI_API_KEY_SECRET;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKeyId && this.apiKeySecret) {
      // PayAI uses API key auth via headers
      headers['X-API-Key-Id'] = this.apiKeyId;
      headers['X-API-Key-Secret'] = this.apiKeySecret;
    }
    return headers;
  }

  async verify(paymentPayload: unknown): Promise<{ valid: boolean; txHash?: string; error?: string }> {
    const res = await fetch(`${this.url}/verify`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(paymentPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      return { valid: false, error: `PayAI facilitator returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const result = await res.json() as Record<string, unknown>;
    const valid = !!(result.valid || result.verified);
    return {
      valid,
      txHash: (result.txHash ?? result.transactionHash) as string | undefined,
      error: valid ? undefined : (result.error as string | undefined) ?? 'Verification failed',
    };
  }

  async settle(paymentPayload: unknown): Promise<{ settled: boolean; txHash: string; error?: string }> {
    const res = await fetch(`${this.url}/settle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(paymentPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      return { settled: false, txHash: '', error: `PayAI settle returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const result = await res.json() as Record<string, unknown>;
    return {
      settled: !!(result.settled || result.success),
      txHash: (result.txHash ?? result.transactionHash ?? '') as string,
      error: result.error as string | undefined,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(this.url, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }
}

// ─── Skyfire Facilitator ─────────────────────────────────────────────────────

class SkyfireFacilitator implements X402Facilitator {
  readonly name = 'skyfire';
  readonly url: string;
  private readonly apiKey?: string;

  constructor(url?: string, apiKey?: string) {
    this.url = url ?? env.X402_SKYFIRE_URL ?? 'https://api.skyfire.xyz/v1/x402';
    this.apiKey = apiKey ?? env.X402_SKYFIRE_API_KEY;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async verify(paymentPayload: unknown): Promise<{ valid: boolean; txHash?: string; error?: string }> {
    const res = await fetch(`${this.url}/verify`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(paymentPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      return { valid: false, error: `Skyfire facilitator returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const result = await res.json() as Record<string, unknown>;
    const valid = !!(result.valid || result.verified);
    return {
      valid,
      txHash: (result.txHash ?? result.transactionHash) as string | undefined,
      error: valid ? undefined : (result.error as string | undefined) ?? 'Verification failed',
    };
  }

  async settle(paymentPayload: unknown): Promise<{ settled: boolean; txHash: string; error?: string }> {
    const res = await fetch(`${this.url}/settle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(paymentPayload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => 'unknown');
      return { settled: false, txHash: '', error: `Skyfire settle returned ${res.status}: ${body.slice(0, 200)}` };
    }

    const result = await res.json() as Record<string, unknown>;
    return {
      settled: !!(result.settled || result.success),
      txHash: (result.txHash ?? result.transactionHash ?? '') as string,
      error: result.error as string | undefined,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(this.url, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }
}

// ─── Facilitator Pool ────────────────────────────────────────────────────────

export class FacilitatorPool {
  private readonly facilitators: X402Facilitator[];
  private readonly health: Map<string, HealthState> = new Map();

  constructor(facilitators: X402Facilitator[]) {
    this.facilitators = facilitators;
    for (const f of facilitators) {
      this.health.set(f.name, { consecutiveFailures: 0, markedUnhealthyAt: null });
    }
  }

  /** Get ordered list: primary first, then fallbacks (skipping unhealthy unless cooldown expired) */
  private getAvailable(): X402Facilitator[] {
    const now = Date.now();
    return this.facilitators.filter((f) => {
      const state = this.health.get(f.name);
      if (!state) return true;
      if (state.markedUnhealthyAt === null) return true;
      // Allow retry after cooldown
      if (now - state.markedUnhealthyAt >= UNHEALTHY_COOLDOWN_MS) {
        state.markedUnhealthyAt = null; // reset for retry
        return true;
      }
      return false;
    });
  }

  private recordSuccess(name: string): void {
    const state = this.health.get(name);
    if (state) {
      state.consecutiveFailures = 0;
      state.markedUnhealthyAt = null;
    }
  }

  private recordFailure(name: string): void {
    const state = this.health.get(name);
    if (!state) return;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.markedUnhealthyAt = Date.now();
      logger.warn(
        { facilitator: name, failures: state.consecutiveFailures },
        `x402 facilitator marked unhealthy after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — will retry in ${UNHEALTHY_COOLDOWN_MS / 1000}s`,
      );
    }
  }

  /** Verify a payment proof — tries primary, falls back to secondary */
  async verify(paymentPayload: unknown): Promise<{ valid: boolean; txHash?: string; error?: string; facilitator?: string }> {
    const available = this.getAvailable();
    if (available.length === 0) {
      // All facilitators unhealthy — force-try the first one anyway
      const first = this.facilitators[0];
      if (first) {
        logger.warn({ facilitator: first.name }, 'All x402 facilitators unhealthy — force-retrying primary');
        available.push(first);
      } else {
        return { valid: false, error: 'No x402 facilitators configured' };
      }
    }

    let lastError = 'No facilitators available';
    for (const facilitator of available) {
      try {
        const result = await facilitator.verify(paymentPayload);
        if (result.valid) {
          this.recordSuccess(facilitator.name);
          logger.debug({ facilitator: facilitator.name }, 'x402 payment verified');
          return { ...result, facilitator: facilitator.name };
        }
        // 4xx-style rejection (valid: false with no network error) — don't retry with fallback
        // The payment itself was rejected, not a facilitator failure
        if (!result.error?.includes('returned 5')) {
          this.recordSuccess(facilitator.name); // facilitator worked, payment was just invalid
          return { ...result, facilitator: facilitator.name };
        }
        // Server error — try fallback
        lastError = result.error ?? 'Verification failed';
        this.recordFailure(facilitator.name);
        logger.warn({ facilitator: facilitator.name, error: lastError }, 'x402 facilitator verify failed — trying fallback');
      } catch (err) {
        lastError = `${facilitator.name}: ${String(err)}`;
        this.recordFailure(facilitator.name);
        logger.warn({ facilitator: facilitator.name, err }, 'x402 facilitator verify error — trying fallback');
      }
    }

    return { valid: false, error: lastError };
  }

  /** Settle a payment — tries primary, falls back to secondary */
  async settle(paymentPayload: unknown): Promise<{ settled: boolean; txHash: string; error?: string; facilitator?: string }> {
    const available = this.getAvailable();
    if (available.length === 0) {
      const first = this.facilitators[0];
      if (first) {
        available.push(first);
      } else {
        return { settled: false, txHash: '', error: 'No x402 facilitators configured' };
      }
    }

    let lastError = 'No facilitators available';
    for (const facilitator of available) {
      try {
        const result = await facilitator.settle(paymentPayload);
        if (result.settled) {
          this.recordSuccess(facilitator.name);
          logger.debug({ facilitator: facilitator.name, txHash: result.txHash }, 'x402 payment settled');
          return { ...result, facilitator: facilitator.name };
        }
        lastError = result.error ?? 'Settlement failed';
        this.recordFailure(facilitator.name);
        logger.warn({ facilitator: facilitator.name, error: lastError }, 'x402 facilitator settle failed — trying fallback');
      } catch (err) {
        lastError = `${facilitator.name}: ${String(err)}`;
        this.recordFailure(facilitator.name);
        logger.warn({ facilitator: facilitator.name, err }, 'x402 facilitator settle error — trying fallback');
      }
    }

    return { settled: false, txHash: '', error: lastError };
  }

  /** Check health of all facilitators */
  async checkHealth(): Promise<Record<string, { healthy: boolean; consecutiveFailures: number }>> {
    const results: Record<string, { healthy: boolean; consecutiveFailures: number }> = {};
    for (const facilitator of this.facilitators) {
      const state = this.health.get(facilitator.name);
      try {
        const healthy = await facilitator.isHealthy();
        if (healthy && state) {
          state.consecutiveFailures = 0;
          state.markedUnhealthyAt = null;
        }
        results[facilitator.name] = {
          healthy,
          consecutiveFailures: state?.consecutiveFailures ?? 0,
        };
      } catch {
        results[facilitator.name] = {
          healthy: false,
          consecutiveFailures: state?.consecutiveFailures ?? 0,
        };
      }
    }
    return results;
  }

  /** Get the primary facilitator's URL (for HTTPFacilitatorClient in x402-skills) */
  getPrimaryUrl(): string {
    const available = this.getAvailable();
    return (available[0] ?? this.facilitators[0])?.url ?? env.X402_FACILITATOR_URL;
  }

  /** Get all facilitator URLs in priority order (for existing fallback arrays) */
  getUrls(): string[] {
    return this.facilitators.map(f => f.url);
  }

  /** Get status summary for admin/debug endpoints */
  getStatus(): Array<{ name: string; url: string; consecutiveFailures: number; healthy: boolean }> {
    return this.facilitators.map(f => {
      const state = this.health.get(f.name);
      return {
        name: f.name,
        url: f.url,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        healthy: state?.markedUnhealthyAt === null,
      };
    });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let poolInstance: FacilitatorPool | null = null;

/**
 * Get the global FacilitatorPool singleton.
 * Builds the pool on first call based on env vars:
 *   - X402_FACILITATOR_PRIMARY controls ordering ('coinbase', 'payai', or 'skyfire')
 *   - All three facilitators are always registered; primary just goes first
 */
export function getFacilitatorPool(): FacilitatorPool {
  if (poolInstance) return poolInstance;

  const coinbase = new CoinbaseFacilitator(env.X402_FACILITATOR_URL);
  const payai = new PayAIFacilitator(
    env.X402_PAYAI_URL,
    env.X402_PAYAI_API_KEY_ID,
    env.X402_PAYAI_API_KEY_SECRET,
  );
  const skyfire = new SkyfireFacilitator(
    env.X402_SKYFIRE_URL,
    env.X402_SKYFIRE_API_KEY,
  );

  const primary = env.X402_FACILITATOR_PRIMARY;
  const facilitators: X402Facilitator[] =
    primary === 'skyfire'
      ? [skyfire, coinbase, payai]
      : primary === 'payai'
        ? [payai, coinbase, skyfire]
        : [coinbase, payai, skyfire];

  poolInstance = new FacilitatorPool(facilitators);

  logger.info(
    {
      primary: facilitators[0].name,
      fallbacks: facilitators.slice(1).map(f => f.name),
      primaryUrl: facilitators[0].url,
    },
    'x402 facilitator pool initialized',
  );

  return poolInstance;
}

/** Reset the singleton (for testing) */
export function _resetFacilitatorPool(): void {
  poolInstance = null;
}

// Re-export classes for direct construction in tests
export { CoinbaseFacilitator, PayAIFacilitator, SkyfireFacilitator };
