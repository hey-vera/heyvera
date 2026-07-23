/**
 * Wave 12c / 14m/o — pure x402 gate helpers (FE mirror of BE X402_ENABLED).
 *
 * Prefer server GET /v1/social/x402/status for runtime truth (mode, network, payTo).
 * This helper is for local/env honesty and unit tests.
 *
 * Modes: disabled | shape_only | facilitator (see heyvera/docs/X402.md).
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
  'x402 agent micropayments are off unless X402_ENABLED=1. No settlement or facilitator.';

/** Honest UI copy when shape-only mode is on (no facilitator URL). */
export const X402_SHAPE_ONLY_NOTE =
  'x402 shape_only: payload shape + receipt pending — not facilitator settlement.';

/** Honest UI copy when facilitator mode is configured. */
export const X402_FACILITATOR_NOTE =
  'x402 facilitator mode: verify posts to X402_FACILITATOR_URL; private keys never handled by this API.';

/** Badge label from status.mode (falls back for older servers). */
export function x402ModeLabel(
  status: { enabled?: boolean; mode?: string | null } | null | undefined,
): string {
  if (!status) return 'Unknown';
  const mode = status.mode;
  if (mode === 'facilitator') return 'Facilitator';
  if (mode === 'shape_only') return 'Shape-only';
  if (mode === 'disabled') return 'Disabled';
  if (status.enabled) return 'Enabled (shape-only)';
  return 'Disabled';
}

/**
 * Wave 14o — show "Test paid action" only when server reports x402 enabled.
 * Pure helper so Settings/AI stay honest and unit-testable.
 */
export function showX402PaidAction(
  status: { enabled?: boolean; mode?: string | null } | null | undefined,
): boolean {
  if (!status) return false;
  if (status.enabled === true) return true;
  // Older/odd payloads: mode may imply enabled without the boolean.
  return status.mode === 'shape_only' || status.mode === 'facilitator';
}

/** Format a paid-ping result for UI honesty (pure). */
export function formatX402PaidPingResult(result: {
  ok?: boolean;
  settled?: boolean;
  mode?: string | null;
  verified?: boolean;
  status?: string | null;
  reason?: string | null;
  message?: string | null;
  note?: string | null;
  receiptId?: string | null;
}): string {
  if (!result.ok) {
    const why = result.reason ?? result.message ?? result.note ?? 'rejected';
    return `Failed: ${why}${result.mode ? ` (mode=${result.mode})` : ''}`;
  }
  const settle = result.settled
    ? 'settled'
    : result.mode === 'shape_only'
      ? 'not settled (shape_only)'
      : 'not settled';
  const rid = result.receiptId ? ` · receipt ${result.receiptId}` : '';
  return `OK · ${settle}${result.mode ? ` · mode=${result.mode}` : ''}${rid}`;
}