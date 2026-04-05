/**
 * @clawnet/soma-check — client SDK for conditional x402 payments.
 *
 * Wraps `fetch` with automatic ETag caching. On first call to a URL the SDK
 * stores the response ETag + body. On subsequent calls it sends
 * `If-None-Match: <etag>` — if the origin returns 304 Not Modified, the SDK
 * serves the cached body and (on Soma-enabled origins) the provider skips
 * payment settlement. Clean cache hit = no charge, no bytes transferred.
 *
 * Zero dependencies. Works with native fetch (Node 18+, browsers, Deno, Bun).
 *
 * @example
 *   import { SomaCheckClient } from '@clawnet/soma-check';
 *
 *   const client = new SomaCheckClient();
 *   const res1 = await client.fetch('https://api.claw-net.org/v1/soma/demo/btc-price');
 *   const res2 = await client.fetch('https://api.claw-net.org/v1/soma/demo/btc-price'); // 304 → cached
 *   console.log(client.stats()); // { hits: 1, misses: 1, bytesSaved: 812, ... }
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CacheEntry {
  etag: string;
  body: string;
  headers: Record<string, string>;
  status: number;
  storedAt: number;
  lastHitAt: number;
  hitCount: number;
  byteSize: number;
}

export interface SomaCheckStats {
  hits: number;
  misses: number;
  revalidations: number;
  errors: number;
  bytesSaved: number;
  hitRate: number;
  cacheEntries: number;
}

export interface SomaCheckOptions {
  /** Max entries kept in memory (LRU). Default: 1000. */
  maxEntries?: number;
  /** Max age of a cache entry in ms before it's evicted. Default: 24h. */
  maxAgeMs?: number;
  /** If true, also send legacy `If-Soma-Hash` header alongside `If-None-Match`. Default: true. */
  sendSomaHashHeader?: boolean;
  /** Custom cache key derivation. Default: method + url + body-hash. */
  cacheKey?: (input: RequestInfo | URL, init?: RequestInit) => string;
  /** Forward this to the underlying fetch (useful for Node 18 polyfills, custom agents, etc.) */
  fetchImpl?: typeof fetch;
}

export interface SomaCheckResponse extends Response {
  /** True if this response came from the SDK's cache (served on 304). */
  somaCached: boolean;
  /** The cache entry used, if any. */
  somaEntry?: CacheEntry;
}

// ─── Client ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SomaCheckClient {
  private cache = new Map<string, CacheEntry>();
  private opts: Required<Omit<SomaCheckOptions, 'cacheKey' | 'fetchImpl'>> & Pick<SomaCheckOptions, 'cacheKey' | 'fetchImpl'>;
  private _hits = 0;
  private _misses = 0;
  private _revalidations = 0;
  private _errors = 0;
  private _bytesSaved = 0;

  constructor(options: SomaCheckOptions = {}) {
    this.opts = {
      maxEntries: options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
      sendSomaHashHeader: options.sendSomaHashHeader ?? true,
      cacheKey: options.cacheKey,
      fetchImpl: options.fetchImpl,
    };
  }

  /**
   * Perform a fetch with automatic ETag caching. Drop-in replacement for `fetch`.
   */
  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<SomaCheckResponse> {
    const key = this.keyFor(input, init);
    const cached = this.getValidEntry(key);

    // Build headers with If-None-Match if we have a cached etag
    const headers = new Headers(init.headers);
    if (cached) {
      headers.set('If-None-Match', cached.etag);
      if (this.opts.sendSomaHashHeader) {
        // Legacy alias supported by Soma-aware origins
        headers.set('If-Soma-Hash', cached.etag);
      }
    }

    const fetchImpl = this.opts.fetchImpl ?? fetch;

    let res: Response;
    try {
      res = await fetchImpl(input, { ...init, headers });
    } catch (err) {
      this._errors++;
      throw err;
    }

    // 304 Not Modified → serve cached body
    if (res.status === 304 && cached) {
      this._hits++;
      this._bytesSaved += cached.byteSize;
      cached.lastHitAt = Date.now();
      cached.hitCount++;
      return this.toSomaResponse(cached, true);
    }

    // 200 (or other success) → store/update cache if ETag present
    if (res.ok) {
      const etag = res.headers.get('etag') ?? res.headers.get('ETag');
      const body = await res.clone().text();

      if (etag) {
        const wasCached = !!cached;
        const entry: CacheEntry = {
          etag,
          body,
          headers: this.headersToObject(res.headers),
          status: res.status,
          storedAt: Date.now(),
          lastHitAt: Date.now(),
          hitCount: 0,
          byteSize: byteLength(body),
        };
        this.store(key, entry);
        if (wasCached) this._revalidations++;
        else this._misses++;
      } else {
        this._misses++;
      }

      // Return the original response (body already consumed, but .text()/json() still work on clone chain)
      return this.wrapResponse(res, body, false);
    }

    // Non-2xx, non-304 → just pass through
    this._misses++;
    return this.wrapResponse(res, null, false);
  }

  /**
   * Preload a cache entry (e.g., hydrating from disk across restarts).
   */
  preload(url: string, entry: CacheEntry): void {
    this.store(url, entry);
  }

  /** Snapshot all cache entries as a serializable object. */
  dump(): Record<string, CacheEntry> {
    const out: Record<string, CacheEntry> = {};
    for (const [k, v] of this.cache) out[k] = v;
    return out;
  }

  /** Restore a previously dumped cache. */
  restore(entries: Record<string, CacheEntry>): void {
    for (const [k, v] of Object.entries(entries)) this.store(k, v);
  }

  /** Clear the entire cache. */
  clear(): void {
    this.cache.clear();
  }

  /** Return current cache-hit stats. */
  stats(): SomaCheckStats {
    const total = this._hits + this._misses + this._revalidations;
    return {
      hits: this._hits,
      misses: this._misses,
      revalidations: this._revalidations,
      errors: this._errors,
      bytesSaved: this._bytesSaved,
      hitRate: total > 0 ? this._hits / total : 0,
      cacheEntries: this.cache.size,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private keyFor(input: RequestInfo | URL, init: RequestInit): string {
    if (this.opts.cacheKey) return this.opts.cacheKey(input, init);
    const method = (init.method ?? 'GET').toUpperCase();
    const url = input instanceof URL ? input.toString()
              : typeof input === 'string' ? input
              : input.url;
    // Include body hash for POST/PUT so cache key is body-sensitive
    const bodyPart = init.body ? `:${simpleHash(String(init.body))}` : '';
    return `${method} ${url}${bodyPart}`;
  }

  private getValidEntry(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.opts.maxAgeMs) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  private store(key: string, entry: CacheEntry): void {
    this.cache.delete(key); // ensure move-to-end for LRU
    this.cache.set(key, entry);
    // Evict oldest if over capacity
    while (this.cache.size > this.opts.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private headersToObject(h: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    h.forEach((v, k) => { out[k] = v; });
    return out;
  }

  private toSomaResponse(entry: CacheEntry, cached: boolean): SomaCheckResponse {
    const res = new Response(entry.body, {
      status: entry.status,
      headers: entry.headers,
    });
    return this.wrapResponse(res, entry.body, cached, entry);
  }

  private wrapResponse(
    res: Response,
    _body: string | null,
    cached: boolean,
    entry?: CacheEntry,
  ): SomaCheckResponse {
    const wrapped = res as SomaCheckResponse;
    wrapped.somaCached = cached;
    wrapped.somaEntry = entry;
    return wrapped;
  }
}

// ─── Functional helper ──────────────────────────────────────────────────────

let _default: SomaCheckClient | undefined;

/**
 * Default client singleton. Convenience for one-liner usage:
 *   import { somaFetch } from '@clawnet/soma-check';
 *   const res = await somaFetch('https://api.claw-net.org/...');
 */
export function somaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<SomaCheckResponse> {
  if (!_default) _default = new SomaCheckClient();
  return _default.fetch(input, init);
}

export function defaultClient(): SomaCheckClient {
  if (!_default) _default = new SomaCheckClient();
  return _default;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function byteLength(str: string): number {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(str, 'utf8');
  return new TextEncoder().encode(str).length;
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
