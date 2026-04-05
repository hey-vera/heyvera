/**
 * dual-sign-state.ts — Thread-local-ish state for dual-sign results.
 *
 * Same pattern as _lastBirthCert in clawapis.ts and _lastGenerationProvenance
 * in soma.ts: store the most recent dual-sign result so the provenance
 * middleware can attach headers without threading the result through
 * every call site.
 *
 * Get-and-clear prevents stale data leaking to the next request.
 */

import type { DualSignResult } from './dual-sign';

let _lastDualSignResult: DualSignResult | null = null;

/** Store a dual-sign result for the middleware to pick up. */
export function setLastDualSignResult(result: DualSignResult): void {
  _lastDualSignResult = result;
}

/** Get and clear the last dual-sign result. Clearing prevents stale data. */
export function getLastDualSignResult(): DualSignResult | null {
  const result = _lastDualSignResult;
  _lastDualSignResult = null;
  return result;
}

/** Peek at the last dual-sign result without clearing. Used by code paths
 *  that need to consume the result multiple times in the same request
 *  (e.g. response headers AND receipt creation). */
export function peekLastDualSignResult(): DualSignResult | null {
  return _lastDualSignResult;
}

/**
 * Extract dual-sign fields for a Soma receipt, if a result is present.
 * Returns an object suitable for spreading into `createSomaReceipt()` input.
 * Returns an empty object if no dual-sign state exists.
 *
 * Does NOT clear state — the response-header middleware also needs to
 * consume it. The state is cleared when the middleware runs `getLastDualSignResult`.
 */
export function extractDualSignReceiptFields(providerId?: string): {
  providerId?: string;
  providerSignature?: string;
  providerPublicKey?: string;
  providerDataHash?: string;
  providerHeartbeatIndex?: number;
} {
  const result = peekLastDualSignResult();
  if (!result) return {};
  return {
    providerId: providerId ?? 'upstream',
    providerSignature: result.provider.signature,
    providerPublicKey: result.provider.publicKey,
    providerDataHash: result.provider.dataHash,
    providerHeartbeatIndex: result.provider.heartbeatIndex,
  };
}
