/**
 * dual-sign-state.ts — Request-scoped dual-sign state.
 *
 * Now delegates to AsyncLocalStorage (request-context.ts) instead of
 * module-level singletons. This eliminates the race condition where
 * concurrent requests could swap dual-sign results (audit C1).
 *
 * Exports are preserved for backward compatibility — all importers
 * continue to work without changes.
 */

import { getProvenance, setProvenance } from './request-context';

export interface DualSignResult {
  provider: {
    dataHash: string;
    signature: string;
    publicKey: string;
    heartbeatIndex?: number;
    genomeHash?: string;
  };
  platform: {
    dataHash: string;
    signature: string;
    heartbeatIndex: number | null;
    publicKey: string;
  };
  providerVerified: boolean;
  chainHash: string;
  timestamp: string;
}

/** Store dual-sign result for the current request. */
export function setLastDualSignResult(result: DualSignResult | null): void {
  setProvenance('dualSign', result);
}

/** Get and clear dual-sign result for the current request. */
export function getLastDualSignResult(): DualSignResult | null {
  const ds = getProvenance('dualSign') as DualSignResult | null;
  setProvenance('dualSign', null);
  return ds;
}

/** Peek at the dual-sign result without clearing it. */
export function peekLastDualSignResult(): DualSignResult | null {
  return getProvenance('dualSign') as DualSignResult | null;
}

/**
 * Extract dual-sign fields for Soma receipt creation.
 * Returns empty object if no dual-sign result is available for this request.
 */
export function extractDualSignReceiptFields(providerId?: string): Record<string, any> {
  const ds = getProvenance('dualSign') as DualSignResult | null;
  if (!ds) return {};
  return {
    dualSignChainHash: ds.chainHash,
    providerVerified: ds.providerVerified,
    providerId: providerId ?? 'upstream',
    providerSignature: ds.provider.signature,
    providerPublicKey: ds.provider.publicKey,
    providerDataHash: ds.provider.dataHash,
    providerHeartbeatIndex: ds.provider.heartbeatIndex ?? null,
  };
}
