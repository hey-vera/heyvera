/**
 * Request-scoped context via AsyncLocalStorage.
 *
 * Replaces module-level singletons (_lastBirthCert, _lastDualSignResult,
 * _lastGenerationProvenance) that caused race conditions under concurrent
 * requests. Each request now gets its own isolated provenance store.
 *
 * Usage:
 *   - Hono middleware calls `runWithProvenance(next)` early in the pipeline
 *   - Providers call `setProvenance('birthCert', cert)` during data fetching
 *   - Middleware calls `getProvenance('birthCert')` to attach headers
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestProvenance {
  birthCert: any | null;
  dualSign: any | null;
  generationProvenance: any | null;
}

const store = new AsyncLocalStorage<RequestProvenance>();

/** Run a callback with an isolated provenance store. Use as Hono middleware. */
export function runWithProvenance<T>(fn: () => T): T {
  return store.run({ birthCert: null, dualSign: null, generationProvenance: null }, fn);
}

/** Set a provenance value for the current request. No-op if called outside a request. */
export function setProvenance<K extends keyof RequestProvenance>(key: K, value: RequestProvenance[K]): void {
  const ctx = store.getStore();
  if (ctx) ctx[key] = value;
}

/** Get a provenance value for the current request. Returns null if outside a request. */
export function getProvenance<K extends keyof RequestProvenance>(key: K): RequestProvenance[K] | null {
  return store.getStore()?.[key] ?? null;
}
