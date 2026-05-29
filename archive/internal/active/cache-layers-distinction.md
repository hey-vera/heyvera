# Cache Layers — ClawNet Internal Cache vs Soma Check

**Written 2026-04-05.** Companion to `archive/soma-check-billing.md` (archived).

There are **TWO distinct cache layers** in ClawNet. They are not interchangeable, not competing, and not redundant. Internal docs/comms must keep them straight.

---

## The two layers at a glance

| Axis | ClawNet Cache (L1/L2) | Soma Check (ETag) |
|---|---|---|
| **What it is** | Our proprietary proxy cache | Standard HTTP conditional request protocol |
| **Code** | `src/cache/index.ts` | `src/routes/soma-check.ts` + `soma-check-billing.ts` |
| **Storage** | Memory (L1) + Redis (L2) full response bodies | Client-side ETag only |
| **Origin touched on hit?** | **No** — ClawNet serves from memory | **Yes** — origin validates hash, returns 304 |
| **Semantic dedup?** | **Yes** — `"SOL" = "sol" = "solana"` via `SYMBOL_ALIASES` | **No** — byte-exact JCS hash |
| **Key derivation** | `endpointId + normalized(params)` | Content hash of response body |
| **Stale-while-revalidate** | Yes (`expiresAt` + `staleUntil`) | No (hit/miss only) |
| **Smart eviction** | LFU × creditCost | LRU (client-side) |
| **Request coalescing** | Yes (single-flight) | No |
| **Works without ClawNet?** | No — our infra | Yes — any HTTP ETag origin |
| **Spec compliance** | Proprietary | RFC 9111 |
| **Latency** | ~2ms (Redis) | ~50-500ms (origin roundtrip) |
| **Revenue split on hit** | **50/50** provider/platform | **90/10** provider/platform |
| **Provider work on hit** | **Zero** — server untouched | Lookup + hash compute |

---

## Why the revenue split differs

**It's not arbitrary — it tracks provider workload.**

- **ClawNet cache hit: 50/50.** Provider's server wasn't even touched. This is **pure profit** for the provider — they get 50% of the 10% cache-hit price for doing literally nothing. The 50% we keep funds the Redis infra, warming crons, adaptive-TTL tuning, and semantic normalization tables that made the hit possible.

- **Soma Check hit: 90/10.** Provider did real work — they received the request, looked up current state, computed the JCS hash, compared to client's ETag, and returned 304. The 90% matches the origin split because the provider's workload matches (minus body serialization). The 10% we keep funds hash validation, telemetry, receipt anchoring, and the dispute/audit layer.

**The elevator pitch for each:**

| Layer | Pitch to provider |
|---|---|
| ClawNet cache | "Free revenue. Your server is asleep and we're sending you 50% of a 10% call. It's gravy on top of your normal business." |
| Soma Check | "Same 90/10 as origin — your rev share never drops. You do almost the same work (lookup + hash) but skip body serialization." |

---

## Do they stack?

**Yes.** For any request to a ClawNet-proxied endpoint, the waterfall is:

```
Agent → ClawNet
  │
  ├─ If request has If-None-Match header:
  │    ├─ ClawNet-hosted demo endpoints: check pre-computed hash → 304 (Soma Check path)
  │    └─ Proxied external endpoints: forward If-None-Match to origin → origin 304 (Soma Check path)
  │
  ├─ If no ETag match or no header:
  │    ├─ Check ClawNet L1/L2 cache by semantic key → serve if fresh (ClawNet cache path)
  │    └─ Else: forward to origin, pay full, populate both layers
  │
  └─ Return response to agent
```

**So a single call can flow through both layers depending on client behavior.** Soma Check is the **outer** layer (closest to the agent). ClawNet cache is the **inner** layer (closest to the origin).

---

## When to talk about which layer

**In pitches / external comms:**

| Audience | Lead with |
|---|---|
| **Providers** | Soma Check (90/10 is more attractive) + "and you get passive cache revenue too" |
| **Agents / developers** | Soma Check client SDK (drop-in fetch wrapper) |
| **x402 spec / standards bodies** | Soma Check (it's RFC-compliant, portable) |
| **VCs / strategy** | "5-layer stack" — don't drill into cache internals |
| **Operators / infra** | ClawNet cache (L1/L2, adaptive TTL, warming crons) |

**In internal docs:**
- Always specify which layer you mean. Say "ClawNet L1/L2 cache" or "Soma Check (ETag)" — never ambiguous "cache hit" without context.
- Billing docs must disambiguate: `docs/reference/billing.md` talks about the ClawNet cache (50/50); `internal/archive/soma-check-billing.md (archived)` talks about Soma Check (90/10).

---

## Historical note

The term "cache hit" in `docs/reference/billing.md` (written before Soma Check existed) refers to **ClawNet's internal cache only**. When reading old docs or code comments:

- "cache hit" + 50/50 split + `cacheCreditCost()` → **ClawNet cache**
- "cache hit" + 90/10 or 95/5 split + `computeSomaCheckSplit()` → **Soma Check**
- "ETag" / "If-None-Match" / "X-Soma-Hash" / "304" → **Soma Check**
- "Redis" / "L2" / "stale-while-revalidate" / "SYMBOL_ALIASES" → **ClawNet cache**

---

## Open questions

- [ ] When both layers hit on the same call (client sends If-None-Match AND we have fresh Redis copy), which path wins billing-wise? Currently: Soma Check runs first (outer), so 90/10 applies. Confirm this is the desired policy.
- [ ] Should we expose ClawNet cache stats to providers in the savings dashboard alongside Soma Check stats, or keep them separate screens to avoid conflation?
- [ ] Is it worth renaming `cacheCreditCost()` → `clawnetCacheCreditCost()` in code to make the distinction explicit?

---

## Related docs

- `docs/reference/billing.md` — ClawNet cache economics (50/50, `creditProviderShare()`)
- `internal/archive/soma-check-billing.md (archived)` — Soma Check economics (90/10, `computeSomaCheckSplit()`)
- `internal/soma-check-header-spec.md` — ETag + X-Soma-* header contract
- `src/cache/index.ts` — L1/L2 implementation with semantic normalization
- `src/routes/soma-check.ts` — Soma Check protocol handler
