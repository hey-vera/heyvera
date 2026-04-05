# @clawnet/soma-check

Drop-in `fetch` wrapper for **Soma Check** (aka x402 ETag) — automatic HTTP conditional requests that skip payment when data hasn't changed.

## Why

Agents polling x402-gated APIs pay for every byte — even when the data is identical to last call. Soma Check / x402 ETag lets origins return `304 Not Modified` instead of re-billing. This SDK makes that free for agents: just use `client.fetch` and it handles `ETag` + `If-None-Match` automatically.

- **Zero config.** Works with any origin that emits standard HTTP `ETag` headers.
- **Zero deps.** Native `fetch` only.
- **Works everywhere.** Node 18+, Deno, Bun, browsers, Cloudflare Workers.

## Install

```bash
npm install @clawnet/soma-check
```

## Usage

```typescript
import { SomaCheckClient } from '@clawnet/soma-check';

const client = new SomaCheckClient();

// First call: full fetch, stores ETag
const r1 = await client.fetch('https://api.claw-net.org/v1/soma/demo/btc-price');
console.log(r1.somaCached); // false

// Second call: sends If-None-Match, gets 304, serves from cache — no payment
const r2 = await client.fetch('https://api.claw-net.org/v1/soma/demo/btc-price');
console.log(r2.somaCached); // true
console.log(await r2.json()); // same data, zero network cost

console.log(client.stats());
// { hits: 1, misses: 1, hitRate: 0.5, bytesSaved: 812, cacheEntries: 1, ... }
```

One-liner with the default singleton:

```typescript
import { somaFetch } from '@clawnet/soma-check';

const res = await somaFetch('https://api.claw-net.org/v1/soma/demo/btc-price');
```

## Options

```typescript
new SomaCheckClient({
  maxEntries: 1000,           // LRU cap (default 1000)
  maxAgeMs: 24 * 3600 * 1000, // evict after 24h (default)
  sendSomaHashHeader: true,   // also send legacy If-Soma-Hash alias (default true)
  cacheKey: (url, init) => `${init.method} ${url}`, // custom key derivation
  fetchImpl: customFetch,     // bring your own fetch
});
```

## Persisting cache across restarts

```typescript
// Save
const snapshot = client.dump();
fs.writeFileSync('cache.json', JSON.stringify(snapshot));

// Restore
client.restore(JSON.parse(fs.readFileSync('cache.json', 'utf8')));
```

## How it works

1. First request to a URL → you get the full response, SDK stores `ETag` + body.
2. Next request → SDK adds `If-None-Match: <etag>` header.
3. If origin data is unchanged → origin returns `304 Not Modified` (empty body, no billing on Soma-aware providers).
4. SDK serves the cached body. Your code sees a normal `Response`.

On Soma Check origins, the 304 path skips payment settlement entirely. Provider still gets a smaller fee for the freshness guarantee (90/10 split on cache hits — see [Soma Check billing](https://claw-net.org/soma-check.html)).

## Compat

- Works with **any** HTTP server that emits standard ETag headers (RFC 9111) — not Soma-specific.
- Soma-aware origins additionally honor `X-Soma-Hash` / `If-Soma-Hash` aliases.

## License

MIT
