# Soma Check — HTTP Header Contract

**Status:** canonical header/wire-protocol spec for Soma Check.
**Written 2026-04-05.** Referenced from `soma-check-strategy.md`.

---

## Design principle

**Reuse standard HTTP semantics wherever possible.** Soma Check piggybacks on RFC 9111 (HTTP Caching) conditional-request mechanics — `ETag`, `If-None-Match`, `304 Not Modified`. Custom `X-Soma-*` metadata headers add the Soma-specific info (signer identity, pricing, receipts) without replacing standard headers.

**Why:** universal HTTP client support (browsers, curl, fetch, every language). No new spec to learn. Gradual adoption path — any HTTP cache already understands ETag.

---

## The contract

### Request (from agent)

```http
GET /v1/endpoints/:id/call HTTP/1.1
If-None-Match: "sha256-abc123..."
X-Soma-Check: enabled
```

| Header | Required? | Purpose |
|---|---|---|
| `If-None-Match` | Optional | Previous ETag the client saw. Standard RFC 9111. |
| `X-Soma-Check: enabled` | Optional | Explicitly opt into Soma Check flow. Future: may encode preferences. |

If `If-None-Match` is absent, treat as normal origin call (no conditional behavior).

### Response — Origin (cache miss or no conditional header)

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "sha256-abc123..."
Cache-Control: public, max-age=60
X-Soma-Hash: sha256-abc123...
X-Soma-Freshness-Price: 10
X-Soma-Freshness-Rail: credits
X-Soma-Signer: did:web:api.claw-net.org
X-Soma-Receipt-Id: rcpt_01H...
Content-Length: 1234

{"data": {...}}
```

### Response — Cache Hit (304)

```http
HTTP/1.1 304 Not Modified
ETag: "sha256-abc123..."
Cache-Control: public, max-age=60
X-Soma-Hash: sha256-abc123...
X-Soma-Freshness-Price: 1
X-Soma-Freshness-Rail: credits
X-Soma-Hit: true
X-Soma-Signer: did:web:api.claw-net.org
X-Soma-Receipt-Id: rcpt_01H...

(empty body — per RFC 9110 §15.4.5)
```

---

## Soma-specific headers

| Header | Emitted on | Meaning |
|---|---|---|
| `X-Soma-Hash` | Both 200 and 304 | Content hash (mirrors ETag — provided separately for clients that strip ETag) |
| `X-Soma-Freshness-Price` | Both | Price charged for THIS response, in the unit matching `X-Soma-Freshness-Rail` |
| `X-Soma-Freshness-Rail` | Both | `credits`, `usdc-base`, `usdc-solana`, or `stripe` |
| `X-Soma-Hit` | 304 only | `true` when served as a cache hit (redundant with 304 but explicit) |
| `X-Soma-Signer` | Tier 2+ only | DID of the signing Heart that vouches for the hash |
| `X-Soma-Signature` | Tier 2+ only | Ed25519 signature over `ETag + timestamp + price` (base64) |
| `X-Soma-Receipt-Id` | Both (when receipts active) | Opaque ID for post-call verification / audit |
| `X-Soma-Ttl` | Both (advisory) | Seconds until hash is likely to change (provider hint) |
| `X-Soma-Tier` | Both | Which onboarding tier the provider is at (0-3) |

---

## Hash computation rules

**Input:** response body (the bytes ClawNet would return to the agent).

**Canonicalization:** if body is JSON, apply JCS (JSON Canonicalization Scheme, RFC 8785) BEFORE hashing. Non-JSON bodies hashed as-is.

**Hash:** `SHA-256` over canonicalized bytes. Hex-encode.

**ETag format:** `"sha256-<hex>"` (strong validator, 69 chars including quotes).

**Why JCS:** JSON key ordering is non-deterministic. Two logically identical responses could produce different raw-bytes hashes. JCS eliminates this. Already present in repo (`src/utils/jcs.ts`).

---

## Backward compatibility

- Clients that don't send `If-None-Match` → origin flow, full price. No change from pre-Soma-Check behavior.
- Clients that send `If-None-Match` but server doesn't support Soma Check → standard HTTP 304 with no Soma headers. Client treats as cache hit, no billing adjustment (defaults to full price).
- Clients speaking old `If-Soma-Hash` / `If-Fresh-Hash` header → accepted during v1 for back-compat, logged, and aliased to `If-None-Match` internally. Deprecated in v2.

**Header alias table (v1 only):**
| Deprecated | Canonical |
|---|---|
| `If-Soma-Hash` | `If-None-Match` |
| `If-Fresh-Hash` | `If-None-Match` |
| `X-Fresh-Hash` | `X-Soma-Hash` |
| `X-Freshness-Price` | `X-Soma-Freshness-Price` |

---

## Security considerations

### 1. Replay attack
**Threat:** attacker sends `If-None-Match: <stale_hash>` hoping to get 304 + cheap billing without re-validating.
**Mitigation:** server ALWAYS computes current hash. 304 only if current == client's stated hash. Stale hash → no match → origin response at full price.

### 2. Hash grinding
**Threat:** attacker finds SHA-256 collision to force false 304.
**Mitigation:** SHA-256 is collision-resistant at 128-bit security. Not practical. For paranoia: rotate to SHA3-256 if NIST deprecates.

### 3. Timing leak
**Threat:** 304 response is faster than 200 → attacker infers content state by timing.
**Mitigation:** not a concern — hash state is meant to be discoverable (that's the point). `/check` probe already exposes this explicitly.

### 4. Signer spoofing (Tier 2+)
**Threat:** attacker claims to be provider by faking `X-Soma-Signer`.
**Mitigation:** `X-Soma-Signature` is Ed25519 over `(ETag + timestamp + price)`. Verifier checks signature against DID-resolved public key.

### 5. Signature replay
**Threat:** attacker replays valid (signature, ETag) pair across different requests.
**Mitigation:** signature covers timestamp. Verifiers reject signatures older than N seconds (recommend: 60s).

### 6. Stale cache served as fresh
**Threat:** provider's cache is stale vs upstream origin. Serves 304 for data that has changed at the source.
**Mitigation:** this is an implementation concern, not protocol. Provider defines `Cache-Control: max-age` to bound staleness. Soma Check guarantees "hash matches what you saw last time from THIS endpoint," not "this is the globally freshest data."

---

## Client implementation (agent side)

```typescript
// Pseudocode
const lastSeen = cache.get(endpointId); // { etag, hash, ts }
const headers = {};
if (lastSeen && (Date.now() - lastSeen.ts) < MAX_STALENESS_MS) {
  headers['If-None-Match'] = lastSeen.etag;
}
const res = await fetch(endpoint, { headers });

if (res.status === 304) {
  // Cache hit — reuse previous body, billed at 10% of origin
  return cache.getBody(endpointId);
}

if (res.status === 200) {
  const etag = res.headers.get('ETag');
  const body = await res.json();
  cache.set(endpointId, { etag, body, ts: Date.now() });
  return body;
}
```

---

## Server implementation (ClawNet proxy side, shadow mode)

```typescript
// Pseudocode — src/middleware/soma-check-shadow.ts
app.use(async (c, next) => {
  await next(); // call origin
  const body = await c.res.text();
  const canonical = c.res.headers.get('content-type')?.includes('json')
    ? jcsCanonicalize(body)
    : body;
  const hash = 'sha256-' + sha256(canonical);
  const etag = `"${hash}"`;

  c.header('ETag', etag);
  c.header('X-Soma-Hash', hash);
  c.header('X-Soma-Tier', getProviderTier(endpointId).toString());
  c.header('X-Soma-Freshness-Price', originPrice.toString());
  c.header('X-Soma-Freshness-Rail', detectRail(c));

  // Telemetry (shadow mode — no billing impact yet)
  const clientHash = c.req.header('If-None-Match');
  if (clientHash === etag) {
    logSomaCheckEvent({ endpointId, hash, wouldHaveHit: true });
  } else {
    logSomaCheckEvent({ endpointId, hash, wouldHaveHit: false });
  }

  c.res = new Response(body, c.res); // pass origin response through unchanged
});
```

Tier 1+ enables actual 304 returns. Shadow mode is telemetry-only.

---

## Open decisions

- [ ] `X-Soma-Tier` header: useful to clients? Or internal-only? Leaning include (transparency).
- [ ] Should `X-Soma-Signature` timestamp be RFC 3339 or Unix epoch? Leaning Unix for compactness.
- [ ] Max signature age: 60s feels right. Revisit if clock-skew complaints emerge.
- [ ] Should we emit `Vary` header to signal Soma-Check-specific response variation? Probably not — ETag handles it.

---

## Related docs

- `internal/soma-check-strategy.md` — overall strategy
- `internal/archive/soma-check-billing.md (archived)` — how `X-Soma-Freshness-Price` gets computed
- `internal/archive/soma-onboarding-ladder.md (archived)` — when Tier 2+ headers activate
- RFC 9111 — HTTP Caching
- RFC 9110 §15.4.5 — 304 Not Modified semantics
- RFC 8785 — JSON Canonicalization Scheme (JCS)
