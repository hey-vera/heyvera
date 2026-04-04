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
