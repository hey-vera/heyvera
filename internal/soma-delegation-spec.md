# Soma Delegation Spec v0.1 (draft)

**Status:** internal draft — published as [SOMA-DELEGATION-SPEC.md in the Soma repo](https://github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md) (2026-04-05). Iteration continues here; publish deltas upstream as they stabilize.
**Authors:** ClawNet team
**Date:** 2026-04-05
**Prior art:** ClawNet `delegation_keys` table + `trackDelegatedSpend()` implementation (production since 2026-Q1)

---

## 1. Motivation

Multi-agent systems delegate authority. A parent agent spawns children; children spawn grandchildren. Current practice (CrewAI, AutoGen, MetaGPT, LangGraph): **children inherit the parent's full API key**. This is unsafe:

- One rogue child can drain parent's wallet — no per-branch spend cap.
- No way to narrow scope ("child may call X but not Y").
- No depth limit — delegation chains can grow unbounded.
- No cascade revoke — killing parent does not kill descendants.
- No intent declaration — receiving providers cannot distinguish a research agent from an attack.

Per *Grantex: State of Agent Security 2026*, delegation is the single most-cited unsolved pain in multi-agent literature. IETF `draft-klrc-aiagent-auth-01` is attempting to standardize agent auth but does not fully address scoped spend delegation.

**Soma Delegation** formalizes a minimal, implementable primitive for scoped, bounded, auditable, revocable agent-to-agent authority transfer.

---

## 2. Concepts

### Delegation Key
A secondary credential issued by a parent credential, bound to one or more constraints:
- **Depth** — how many further delegations the child may issue
- **Scope** — subset of parent's permissions
- **Spend cap** — maximum value the child (and its descendants) may consume
- **Intent** — signed declaration of what the child exists to do
- **TTL** — wall-clock expiry
- **Parent pointer** — cryptographic link to the issuing key

### Cascade
A parent revocation invalidates all descendants recursively. A parent expiry expires all descendants.

### Scope Narrowing
A child's scope MUST be a strict subset of its parent's. A child cannot grant itself permissions the parent lacks.

### Intent Declaration
A signed statement at key creation: "this delegation exists to perform task T with data domain D." Providers may use this for pricing, rate-limiting, or refusal.

---

## 3. Delegation Key Structure

```json
{
  "key_id": "dlg_8f2a...",
  "parent_id": "dlg_3c1e... | root_xyz",
  "depth": 2,
  "max_depth": 3,
  "scope": {
    "endpoints": ["helius.rpc.*", "claw.solscan.*"],
    "methods": ["GET", "POST"],
    "max_cost_per_call_usd": 0.05
  },
  "spend_cap_usd": 10.00,
  "spend_used_usd": 2.43,
  "branch_spend_cap_usd": 2.00,
  "intent": {
    "declaration": "Research agent: summarize daily DeFi TVL changes on Solana",
    "data_domain": "public-chain-data",
    "ttl_hours": 24
  },
  "expires_at": "2026-04-06T18:00:00Z",
  "issued_at": "2026-04-05T18:00:00Z",
  "issued_by_sig": "ed25519:3f8a...",
  "revoked": false
}
```

---

## 4. Semantics

### 4.1 Depth

- Root keys have `depth = 0`.
- A delegation increments depth: `child.depth = parent.depth + 1`.
- If `child.depth > parent.max_depth`, delegation is **rejected**.
- `max_depth` MAY only decrease down a chain (`child.max_depth ≤ parent.max_depth - 1`).

### 4.2 Scope Narrowing

For each scope dimension (endpoints, methods, price caps), the child's value MUST satisfy:
```
child.scope ⊆ parent.scope
```

Specifically:
- `child.scope.endpoints` is a subset (by glob) of `parent.scope.endpoints`.
- `child.scope.methods` is a subset of `parent.scope.methods`.
- `child.scope.max_cost_per_call_usd ≤ parent.scope.max_cost_per_call_usd`.

Issuance with broadened scope is **rejected at creation time**. This is checked at the issuing server (ClawNet or equivalent).

### 4.3 Spend Caps

Two caps apply simultaneously:

**Total cap (`spend_cap_usd`):** hard limit on this key's cumulative spend including all descendants. Enforced at every call: `spend_used_usd + call_cost ≤ spend_cap_usd`.

**Branch cap (`branch_spend_cap_usd`):** per-immediate-child ceiling. When this key issues a child, that child's `spend_cap_usd ≤ branch_spend_cap_usd`.

Both caps roll up: a grandchild's spend counts toward the parent's and grandparent's `spend_used_usd`.

### 4.4 Cascade Revoke

When a key is revoked:
1. Its `revoked` flag flips to true.
2. All keys with `parent_id = revoked_key_id` are revoked (recursively).
3. Implementation SHOULD use a transaction or recursive SQL query for consistency.

Soma-compliant servers MUST refuse calls from any key in the revoked subtree.

### 4.5 Intent Declaration

`intent.declaration` is a free-text description signed by the parent at creation. `intent.data_domain` is a structured enum: `public-chain-data | private-user-data | model-output | training-data | other`.

Providers MAY:
- Price differently per intent (`data_domain = training-data` may carry premium)
- Rate-limit per intent (declared "production" keys get higher quota than "research")
- Refuse to serve certain intents (e.g., adversarial probing)

Intent is advisory — providers enforce their own policy. But intent is signed, so misrepresentation is attributable.

---

## 5. HTTP Wire Format

### Request headers

| Header | Required | Value |
|---|---|---|
| `Authorization` | yes | `Bearer <key_id>` |
| `X-Soma-Delegation-Chain` | optional | JSON array of ancestor key_ids (oldest first) |
| `X-Soma-Intent` | optional | Repeat of `intent.declaration` for quick policy match |

### Response headers (on successful delegation call)

The issuing server SHOULD attach these headers on responses when the caller is using a delegated key, so upstream providers + the caller can trace authority:

| Header | Value |
|---|---|
| `X-Soma-Delegation-Chain` | Comma-separated masked key_ids, leaf first (e.g. `dlg_8f2a••••a1c9,dlg_3c1e••••44d0`) |
| `X-Soma-Delegation-Depth` | Leaf's `depth` integer |
| `X-Soma-Delegation-Hops` | Number of delegation hops (chain length) |
| `X-Soma-Delegation-Root` | Masked root API key (parent of the oldest delegation) |
| `X-Soma-Delegation-Intent` | Leaf's `intent.declaration` (if set) |

Key IDs MUST be masked (first 4 + last 4 chars) to preserve least-privilege disclosure — upstream providers learn the shape of the chain without gaining credentials.

### Response headers (on delegation rejection)

| Header | Value |
|---|---|
| `X-Soma-Delegation-Error` | One of: `DEPTH_EXCEEDED`, `SCOPE_VIOLATION`, `SPEND_CAP_EXCEEDED`, `BRANCH_CAP_EXCEEDED`, `REVOKED`, `EXPIRED`, `INTENT_REJECTED` |

### HTTP status codes

- `401 Unauthorized` — key_id unknown or revoked
- `402 Payment Required` — spend cap exhausted (standard x402 semantics)
- `403 Forbidden` — scope violation or intent rejection
- `410 Gone` — key expired

### 5.1 Issuer API (reference implementation)

ClawNet's reference implementation exposes these endpoints at `/v1/economy/keys/*` (API-key auth):

#### `POST /v1/economy/keys/delegate` — issue delegation

Request body:
```json
{
  "label": "research-swarm-1",
  "spendLimit": 100,
  "expiresInHours": 24,
  "permissions": ["invoke", "query"],
  "maxDepth": 2,
  "branchSpendLimit": 25,
  "intentDeclaration": "price-oracle polling for backtest analysis",
  "dataDomain": "public-chain-data",
  "scopeEndpointsGlob": ["helius.rpc.*", "coingecko.prices.*"],
  "scopeMethodsCsv": "GET,POST"
}
```

Response (201):
```json
{ "ok": true, "childKey": "cn-...", ... }
```

Error codes: `DEPTH_EXCEEDED`, `BRANCH_CAP_EXCEEDED`, `SCOPE_VIOLATION`, `INVALID_DATA_DOMAIN`, `INVALID_MAX_DEPTH`, `INTENT_TOO_LONG`.

#### `GET /v1/economy/keys/delegated` — list children of caller

Returns all active delegations where `parent_key = caller` with full v0.1 fields (depth, maxDepth, branchSpendLimit, intentDeclaration, dataDomain, scopeEndpointsGlob, scopeMethodsCsv).

#### `GET /v1/economy/keys/delegated/:childKey/chain` — walk lineage

Returns the full chain from `childKey` up to the root key (masked). Useful for parent agents auditing deep subtrees. Caller must appear somewhere in the chain (parent or descendant) OR be the leaf itself.

```json
{
  "protocol": "soma-delegation/0.1",
  "leaf": "cn-...",
  "root": "cn-...",
  "depth": 2,
  "hops": 3,
  "chain": [ /* leaf delegation first, root-adjacent last */ ]
}
```

#### `DELETE /v1/economy/keys/delegated/:childKey` — cascade revoke

Revokes `childKey` AND all descendants (BFS). Returns `{ ok, revoked, cascade: true, revokedCount }`.

---

## 6. Examples

### 6.1 CrewAI-style three-level chain

```
Root (user)        depth=0, max_depth=3, spend_cap=$100, scope=*
  └─ Crew Manager  depth=1, max_depth=2, spend_cap=$50, branch_cap=$10
       └─ Researcher  depth=2, max_depth=0, spend_cap=$10, scope={read-only, public-data}
```

If Researcher tries to spawn a child → rejected (`max_depth=0`).
If Researcher runs through $10 → no more calls.
If user revokes Root → Crew Manager and Researcher instantly revoked.

### 6.2 AutoGen-style peer spawning

```
Root (app)         depth=0, max_depth=2, spend_cap=$200
  ├─ Planner       depth=1, max_depth=1, spend_cap=$50, intent="plan execution"
  ├─ Executor A    depth=1, max_depth=0, spend_cap=$30, intent="run subtask"
  └─ Executor B    depth=1, max_depth=0, spend_cap=$30, intent="run subtask"
```

If Planner reaches `spend_cap=$50` first, Planner stops but Executors A/B still run until their own caps.

### 6.3 Adversarial scenario — rogue child

```
Root             spend_cap=$100, branch_cap=$10
  └─ Child (goes rogue)  spend_cap=$10 ← capped by branch_cap
```

Child burns $10 in 1 minute trying to DOS parent's wallet. Parent's remaining $90 is safe because `branch_cap=$10` was enforced at child creation.

---

## 7. Relationship to ClawNet implementation

ClawNet's `delegated_keys` table (as of 2026-Q1) has partial implementation:
- ✓ `parent_key` column
- ✓ `spend_limit` cap + `trackDelegatedSpend()` per-call enforcement
- ✓ TTL via `expires_at`
- ✓ **Migration 149 (2026-04-05):** `depth`, `max_depth`, `branch_spend_limit`, `intent_declaration`, `data_domain`, `scope_endpoints_glob`, `scope_methods_csv`, `revoked_at` columns added
- ✓ **Recursive cascade revoke** — `revokeDelegatedKey()` BFS-traverses and revokes entire subtree (`src/db/transfers.ts`)
- ✓ **Depth-aware creation** — `createDelegatedKey()` enforces `max_depth`, `branch_spend_limit`, and (conservative shell-glob) scope narrowing at issue time
- ✓ **Public HTTP surface (2026-04-05)** — `POST/GET/DELETE /v1/economy/keys/delegated*` + `GET .../chain` for lineage walk (`src/routes/economy.ts`)
- ✓ **Chain response headers (2026-04-05)** — `X-Soma-Delegation-Chain/Depth/Hops/Root/Intent` attached on proxy path (`src/routes/endpoints.ts` via `buildDelegationChainHeaders()` in `src/utils/billing.ts`)
- ⚠ Glob-subset check is simplified to prefix-matching — good enough for v0.1, formal subset semantics pending
- ⚠ Intent rejection at provider serving side not yet wired
- ⚠ Cross-issuer trust registry (cross-platform delegation) not implemented

---

## 8. Open questions

1. **Intent rejection:** should providers return the reason in headers or keep it opaque (security trade-off)?
2. **Scope glob syntax:** shell-glob or regex or URI template? Leaning shell-glob for simplicity.
3. **Spend cap roll-up visibility:** should children see their parent's remaining cap, or only their own? Leaning own-only (least privilege).
4. **Cascade revoke performance:** at depth > 10 with fan-out > 100, recursive revoke may be slow. Consider lazy mark-and-sweep.
5. **Cross-platform delegation:** if Key A is issued by ClawNet and Key B is issued by another Soma implementer, how do providers verify the chain? Requires cross-issuer trust registry.
6. **Key rotation:** if parent rotates its signing key, do children need re-issuance?

---

## 9. Comparison with prior art

| Feature | IETF draft-klrc | OAuth 2.0 | Capability-based systems | **Soma Delegation** |
|---|---|---|---|---|
| Auth token | yes | yes | yes | yes |
| Scope narrowing | partial | yes (scopes) | yes | **yes (enforced at issue)** |
| Depth limits | no | no | rare | **yes** |
| Spend caps | no | no | no | **yes** |
| Branch caps | no | no | no | **yes** |
| Cascade revoke | no | no | partial | **yes** |
| Intent declaration | no | no | no | **yes** |
| Wire format | TBD | HTTP Bearer | various | HTTP + X-Soma-* |

**Soma Delegation's contribution:** the first standard with **spend-bounded delegation + cascade revoke + intent declaration** as first-class primitives.

---

## 10. Next steps

**Phase 1 (Spec + core DB/runtime) — SHIPPED 2026-04-05:**
- [x] Draft this doc (v0.1)
- [x] Migration 149 adding `depth/max_depth/branch_spend_limit/intent_declaration/data_domain/scope_endpoints_glob/scope_methods_csv/revoked_at` to `delegated_keys`
- [x] Recursive cascade revoke in `src/db/transfers.ts:revokeDelegatedKey()`
- [x] Depth + branch-cap + (conservative) scope-narrowing enforcement at issue time in `createDelegatedKey()`

**Phase 2 (Issuer API + wire) — SHIPPED 2026-04-05:**
- [x] POST /v1/economy/keys/delegate accepting the new v0.1 fields (depth/maxDepth/branchSpendLimit/intentDeclaration/dataDomain/scopeEndpointsGlob/scopeMethodsCsv)
- [x] GET /v1/economy/keys/delegated returning all v0.1 fields
- [x] GET /v1/economy/keys/delegated/:childKey/chain for lineage walking with auth check
- [x] DELETE /v1/economy/keys/delegated/:childKey with cascade + revokedCount
- [x] `X-Soma-Delegation-Chain/Depth/Hops/Root/Intent` response headers on proxy path (POST /v1/endpoints/:id/call)
- [x] Chain helper tests (getDelegationChain + buildDelegationChainHeaders)

**Phase 3 (Publish + standardize) — pending:**
- [x] Publish this doc to `github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md` (2026-04-05)
- [ ] Open issue on `coinbase/x402` proposing this as x402 extension
- [ ] Enforce intent declaration + scope on the serving path (not just creation)
- [ ] Add wire-format tests against the spec examples in §6
- [ ] Submit to IETF as input to `draft-klrc-aiagent-auth` working group
- [ ] Write reference client in `@clawnet/soma-delegation` package

---

## License

CC BY 4.0 — implementations and derivative specs encouraged.
