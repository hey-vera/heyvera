/**
 * x402 Fresh — provider-side middleware example.
 *
 * Wrap your API handler to add content-hashing. Consumers who send
 * `If-Fresh-Hash` with a matching hash get a 304-style "unchanged" response
 * and pay nothing; you skip the expensive upstream call and save bandwidth.
 *
 * Framework-agnostic: works anywhere you can intercept request/response.
 * Adapters for Express, Fastify, Hono, and raw http.createServer at the bottom.
 *
 * Internal protocol ID: soma-check. External name: x402 Fresh.
 */
import { createHash } from 'node:crypto';

// ─── Core middleware (framework-agnostic) ──────────────────────────────────

export interface FreshRequest {
  /** Lower-case header map (standard for Node's http) */
  headers: Record<string, string | undefined>;
  /** Parsed JSON body */
  body: { params?: Record<string, unknown> } | null;
}

export interface FreshResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface FreshOpts {
  /** How long cached hashes remain authoritative, in seconds. Default 60. */
  ttlSeconds?: number;
  /** Credits/cents/cost charged on a full fetch. Default 1. */
  fullCost?: number;
  /** Custom hash function — default is sha256. */
  hash?: (data: unknown) => string;
}

function defaultHash(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

interface CacheEntry {
  hash: string;
  data: unknown;
  expiresAt: number;
}

/**
 * Wrap a handler so it participates in x402 Fresh.
 *
 * Returns a new handler: given a parsed request, returns a FreshResponse with
 * either `{ unchanged: true, ... }` (no upstream call) or `{ data, ... }`.
 */
export function withFresh(inner: Handler, opts: FreshOpts = {}) {
  const ttl = (opts.ttlSeconds ?? 60) * 1000;
  const cost = opts.fullCost ?? 1;
  const hashFn = opts.hash ?? defaultHash;
  const cache = new Map<string, CacheEntry>();

  return async function wrapped(req: FreshRequest): Promise<FreshResponse> {
    const params = req.body?.params ?? {};
    const cacheKey = JSON.stringify(
      Object.fromEntries(Object.entries(params).sort()),
    );
    const now = Date.now();
    const cached = cache.get(cacheKey);

    const ifHash =
      req.headers['if-fresh-hash'] ?? req.headers['if-soma-hash'] ?? null;

    // Short-circuit: client's hash matches our fresh cache entry.
    if (
      cached &&
      ifHash &&
      cached.hash === ifHash &&
      cached.expiresAt > now
    ) {
      return {
        statusCode: 200,
        headers: {
          'X-Fresh-Hash': cached.hash,
          'X-Soma-Hash': cached.hash,
          'X-Fresh-Protocol': 'x402-fresh/1.0',
        },
        body: {
          unchanged: true,
          dataHash: cached.hash,
          creditsUsed: 0,
          protocol: 'x402-fresh',
        },
      };
    }

    // Cache miss or mismatch: do the real work.
    const data = await inner(params);
    const hash = hashFn(data);
    cache.set(cacheKey, { hash, data, expiresAt: now + ttl });

    return {
      statusCode: 200,
      headers: {
        'X-Fresh-Hash': hash,
        'X-Soma-Hash': hash,
        'X-Fresh-Protocol': 'x402-fresh/1.0',
      },
      body: {
        data,
        dataHash: hash,
        creditsUsed: cost,
        protocol: 'x402-fresh',
      },
    };
  };
}

// ─── Example handler (replace with your real endpoint logic) ───────────────

async function exampleTweetLookup(
  params: Record<string, unknown>,
): Promise<unknown> {
  const tweetId = String(params.id ?? '');
  // In real code: call the X API, return the tweet.
  return {
    id: tweetId,
    text: `sample tweet ${tweetId}`,
    author: 'clawapis-user',
    createdAt: '2026-04-01T12:00:00Z',
  };
}

export const tweetHandler = withFresh(exampleTweetLookup, {
  ttlSeconds: 30,
  fullCost: 2,
});

// ─── Framework adapters ────────────────────────────────────────────────────

/** Express / connect-style adapter. */
export function expressAdapter(handler: ReturnType<typeof withFresh>) {
  return async (req: any, res: any) => {
    const result = await handler({
      headers: req.headers,
      body: req.body,
    });
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    res.status(result.statusCode).json(result.body);
  };
}

/** Hono-style adapter (ClawNet uses this). */
export function honoAdapter(handler: ReturnType<typeof withFresh>) {
  return async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    const headers: Record<string, string> = {};
    for (const [k, v] of c.req.raw.headers) headers[k.toLowerCase()] = v;
    const result = await handler({ headers, body });
    for (const [k, v] of Object.entries(result.headers)) c.header(k, v);
    return c.json(result.body, result.statusCode);
  };
}

// ─── Standalone demo ───────────────────────────────────────────────────────

async function demo() {
  console.log('x402 Fresh provider demo');
  console.log('========================');

  // Simulate first call — cache miss
  const first = await tweetHandler({
    headers: {},
    body: { params: { id: '12345' } },
  });
  console.log('First call:', first.body);
  const firstHash = (first.body as any).dataHash;

  // Simulate second call with matching hash — skip
  const second = await tweetHandler({
    headers: { 'if-fresh-hash': firstHash },
    body: { params: { id: '12345' } },
  });
  console.log('Second call (hash match):', second.body);

  // Simulate third call with stale hash — cache miss path
  const third = await tweetHandler({
    headers: { 'if-fresh-hash': 'stale-hash-from-before' },
    body: { params: { id: '12345' } },
  });
  console.log('Third call (stale hash):', third.body);
}

demo().catch(console.error);
