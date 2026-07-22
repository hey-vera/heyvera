/**
 * Wave 12c — pure x402 gate helper (FE mirror of BE X402_ENABLED).
 *
 * Production facilitator is not implemented. Default remains off.
 * Prefer server GET /v1/social/x402/status for runtime truth; this helper
 * is for local/env honesty and unit tests.
 */

/**
 * True only when env value is exactly `"1"` (same contract as BE `is_x402_enabled`).
 * Accepts a string or a small env bag so tests stay pure.
 */
export function isX402Enabled(
  env: string | null | undefined | { X402_ENABLED?: string | null },
): boolean {
  if (env == null) return false;
  if (typeof env === 'string') return env === '1';
  return env.X402_ENABLED === '1';
}

/** Honest UI copy when payments are disabled (default). */
export const X402_DISABLED_NOTE =
  'x402 agent micropayments scaffold is off unless X402_ENABLED=1. No live settlement or facilitator.';

/** Honest UI copy when shape-only mode is on. */
export const X402_SHAPE_ONLY_NOTE =
  'x402 shape-only scaffold enabled — still not real payments (no facilitator settlement).';
