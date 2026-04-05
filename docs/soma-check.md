# x402 Fresh

**Conditional payment for paid APIs — ETag for x402.**

Send your last-known data hash with the request. If the data hasn't changed, the server returns `unchanged: true` and charges you nothing. You save money; providers save bandwidth.

*Internal protocol ID: `soma-check`. External name: x402 Fresh.*

---

## Why

x402 made HTTP 402 real — paid endpoints, crypto settlement, no API keys. But every call costs you whether the data changed or not. Polling BTC price every 10 seconds while the price moves once a minute means you're paying for 50 unnecessary calls per minute.

x402 Fresh adds the HTTP 304 Not Modified pattern to x402:

1. You send a hash you already have (`If-Fresh-Hash`).
2. The server checks its cache.
3. Same hash → `{ unchanged: true, creditsUsed: 0 }`. You keep your local data.
4. Different hash → normal x402 flow, normal charge.

If 60% of your polls return unchanged data, your spend drops by ~60%.

---

## For consumers (agent side)

### Conditional call

```typescript
const response = await fetch('https://api.clawnet.com/v1/endpoints/btc-price/call', {
  method: 'POST',
  headers: {
    'X-API-Key': process.env.CLAWNET_API_KEY!,
    'Content-Type': 'application/json',
    ...(lastKnownHash ? { 'If-Fresh-Hash': lastKnownHash } : {}),
  },
  body: JSON.stringify({ params: { currency: 'USD' } }),
});

const body = await response.json();
if (body.unchanged) {
  // $0 charged — use your local copy
} else {
  lastKnownHash = body.dataHash; // update cache
  // process body.data
}
```

### Free probe (no API key, no payment)

```typescript
const qs = new URLSearchParams({ currency: 'USD' }).toString();
const probe = await fetch(`https://api.clawnet.com/v1/endpoints/btc-price/check?${qs}`);
const { dataHash, fresh, age } = await probe.json();
// Compare to your last-known hash — decide whether to issue a paid call.
```

See [`examples/soma-check-client.ts`](../examples/soma-check-client.ts) for the full pattern.

---

## For providers (server side)

Wrap your handler to add content-hashing. Two contracts:

- **Accept:** `If-Fresh-Hash` request header (or `If-Soma-Hash` — alias, backward-compat)
- **Emit:** `X-Fresh-Hash` response header on every call, plus `X-Fresh-Protocol: x402-fresh/1.0`

When `If-Fresh-Hash` matches your cached hash:

```json
{ "unchanged": true, "dataHash": "...", "creditsUsed": 0 }
```

See [`examples/soma-check-provider.ts`](../examples/soma-check-provider.ts) for a framework-agnostic middleware (≈50 lines).

---

## Headers

| Header              | Direction | Meaning                         |
|---------------------|-----------|---------------------------------|
| `If-Fresh-Hash`     | request   | client's last-known hash        |
| `If-Soma-Hash`      | request   | alias (backward-compat)         |
| `X-Fresh-Hash`      | response  | current content hash            |
| `X-Soma-Hash`       | response  | alias (backward-compat)         |
| `X-Fresh-Protocol`  | response  | `x402-fresh/1.0`                |

---

## Response shapes

**Cache hit (no charge):**
```json
{
  "requestId": "...",
  "endpointId": "btc-price",
  "unchanged": true,
  "dataHash": "a1b2c3...",
  "fresh": true,
  "age": 12,
  "creditsUsed": 0,
  "protocol": "soma-check"
}
```

**Cache miss (normal charge):**
```json
{
  "requestId": "...",
  "endpointId": "btc-price",
  "data": { "price": 68234.12, "currency": "USD" },
  "dataHash": "d4e5f6...",
  "creditsUsed": 1,
  "protocol": "soma-check"
}
```

---

## When NOT to use

- **Real-time write-through data.** If you need the absolute latest on every call, use `freshness: "realtime"` in the request body instead.
- **Non-deterministic responses.** Endpoints that return random IDs, timestamps, or server-ephemeral fields will produce new hashes every call. Strip those server-side before hashing.
- **Tiny responses.** If your payload is 200 bytes, the savings are negligible.

---

## Savings math

Typical polling workloads see hit rates in this range:

| Workload                          | Repeat rate | Savings |
|-----------------------------------|-------------|---------|
| Crypto price feeds (1s poll)      | 60–80%      | ~70%    |
| User profile lookups              | 70–90%      | ~80%    |
| Social follower counts            | 80–95%      | ~85%    |
| Tweet/post history (stable past)  | 95%+        | ~95%    |
| Live bid/ask books                | 0–10%       | ~5%     |

---

## Support matrix

- **Clients:** any HTTP client — nothing to install. Just add the header.
- **Providers:** drop-in middleware (see example), ~50 lines of code.
- **ClawNet-hosted endpoints:** all 14k+ discovered endpoints get hashes automatically via the certified cache layer.
