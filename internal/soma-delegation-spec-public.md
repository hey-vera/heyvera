# Soma Delegation

**A minimal, implementable primitive for scoped, bounded, auditable, revocable agent-to-agent authority transfer.**

**Status:** v0.1 draft · **License:** CC BY 4.0 · **Reference impl:** [ClawNet](https://github.com/1xmint/claw-net)

---

## The problem

Multi-agent systems delegate authority. A parent agent spawns children; children spawn grandchildren. Today's practice (CrewAI, AutoGen, MetaGPT, LangGraph) just hands children the parent's full API key. That's unsafe:

- One rogue child can drain the parent's wallet — no per-branch spend cap.
- No way to narrow scope ("child may call X but not Y").
- No depth limit — chains grow unbounded.
- No cascade revoke — killing parent does not kill descendants.
- No intent declaration — providers can't distinguish a research agent from an attacker.

**Soma Delegation** formalizes:
- **Depth limits** — how far a chain may extend.
- **Scope narrowing** — child scope MUST be a strict subset of parent's.
- **Spend caps** (total + per-branch) — bounded blast radius.
- **Cascade revoke** — parent revocation kills the whole subtree.
- **Signed intent** — declared purpose, auditable if misused.

---

## Concepts

### Delegation Key
A secondary credential issued by a parent credential, bound to constraints:

| Constraint | Meaning |
|---|---|
| `depth` | current depth in chain (root = 0) |
| `max_depth` | how many further delegations child may issue |
| `scope` | subset of parent's permissions (endpoints, methods, per-call cost) |
| `spend_cap_usd` | total value child + descendants may consume |
| `branch_spend_cap_usd` | per-immediate-child ceiling |
| `intent` | signed declaration of purpose + data domain |
| `ttl` | wall-clock expiry |
| `parent_id` | cryptographic link to issuing key |

### Cascade
Parent revocation invalidates all descendants recursively. Parent expiry expires all descendants.

### Scope Narrowing
A child's scope MUST be a strict subset of its parent's. A child cannot grant itself permissions the parent lacks. Enforced at issue time AND at serving time.

### Intent Declaration
Signed statement at key creation: "this delegation exists to perform task T with data domain D." Providers may use this for pricing, rate-limiting, or refusal. Intent is advisory — but signed, so misrepresentation is attributable.

---

## Delegation Key Structure

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

## Semantics

### Depth
- Root keys have `depth = 0`.
- A delegation increments depth: `child.depth = parent.depth + 1`.
- If `child.depth > parent.max_depth`, delegation is **rejected**.
- `max_depth` MAY only decrease down a chain (`child.max_depth ≤ parent.max_depth - 1`).

### Scope Narrowing
For each scope dimension:
```
child.scope ⊆ parent.scope
```
- `child.scope.endpoints` is a subset (by glob) of `parent.scope.endpoints`.
- `child.scope.methods` is a subset of `parent.scope.methods`.
- `child.scope.max_cost_per_call_usd ≤ parent.scope.max_cost_per_call_usd`.

Issuance with broadened scope is **rejected at creation time**. Scope is ALSO enforced at serving time — calls that don't match the child's scope get `403 SCOPE_VIOLATION`.

### Spend Caps
Two caps apply simultaneously:

- **Total cap (`spend_cap_usd`):** hard limit on this key's cumulative spend including all descendants. Checked every call.
- **Branch cap (`branch_spend_cap_usd`):** per-immediate-child ceiling. When this key issues a child, that child's `spend_cap_usd ≤ branch_spend_cap_usd`.

Both caps roll up: a grandchild's spend counts toward the parent's and grandparent's `spend_used_usd`.

### Cascade Revoke
When a key is revoked:
1. Its `revoked` flag flips to true.
2. All keys with `parent_id = revoked_key_id` are revoked recursively.
3. Implementations SHOULD use a transaction or recursive SQL query for consistency.

Soma-compliant servers MUST refuse calls from any key in the revoked subtree.

### Intent Declaration
`intent.declaration` is a free-text description signed by the parent at creation. `intent.data_domain` is a structured enum:

```
public-chain-data | private-user-data | model-output | training-data | other
```

Providers MAY price differently per intent, rate-limit per intent, or refuse certain intents.

---

## HTTP Wire Format

### Request headers

| Header | Required | Value |
|---|---|---|
| `Authorization` | yes | `Bearer <key_id>` |
| `X-Soma-Delegation-Chain` | optional | JSON array of ancestor key_ids (oldest first) |
| `X-Soma-Intent` | optional | Repeat of `intent.declaration` for quick policy match |

### Response headers (on successful delegated call)

| Header | Value |
|---|---|
| `X-Soma-Delegation-Chain` | Comma-separated masked key_ids, leaf first |
| `X-Soma-Delegation-Depth` | Leaf's `depth` integer |
| `X-Soma-Delegation-Hops` | Number of delegation hops (chain length) |
| `X-Soma-Delegation-Root` | Masked root API key |
| `X-Soma-Delegation-Intent` | Leaf's `intent.declaration` (if set) |

Key IDs MUST be masked (first 4 + last 4 chars) to preserve least-privilege disclosure.

### Response headers (on rejection)

| Header | Value |
|---|---|
| `X-Soma-Delegation-Error` | One of: `DEPTH_EXCEEDED`, `SCOPE_VIOLATION`, `SPEND_CAP_EXCEEDED`, `BRANCH_CAP_EXCEEDED`, `REVOKED`, `EXPIRED`, `INTENT_REJECTED` |

### HTTP status codes

| Status | Meaning |
|---|---|
| `401 Unauthorized` | key_id unknown or revoked |
| `402 Payment Required` | spend cap exhausted (x402 semantics) |
| `403 Forbidden` | scope violation or intent rejection |
| `410 Gone` | key expired |

---

## Examples

### CrewAI-style three-level chain

```
Root (user)        depth=0, max_depth=3, spend_cap=$100, scope=*
  └─ Crew Manager  depth=1, max_depth=2, spend_cap=$50, branch_cap=$10
       └─ Researcher  depth=2, max_depth=0, spend_cap=$10, scope={read-only}
```

- If Researcher tries to spawn a child → rejected (`max_depth=0`).
- If Researcher exhausts $10 → no more calls.
- If user revokes Root → Crew Manager and Researcher instantly revoked.

### Adversarial scenario — rogue child

```
Root             spend_cap=$100, branch_cap=$10
  └─ Child (rogue)  spend_cap=$10 ← capped by branch_cap
```

Child burns $10 trying to DOS parent's wallet. Parent's remaining $90 is safe because `branch_cap=$10` was enforced at child creation.

---

## Comparison with prior art

| Feature | IETF draft-klrc | OAuth 2.0 | Capability systems | **Soma Delegation** |
|---|---|---|---|---|
| Auth token | yes | yes | yes | yes |
| Scope narrowing | partial | yes | yes | **yes (enforced at issue + serving)** |
| Depth limits | no | no | rare | **yes** |
| Spend caps | no | no | no | **yes** |
| Branch caps | no | no | no | **yes** |
| Cascade revoke | no | no | partial | **yes** |
| Intent declaration | no | no | no | **yes** |

**Soma Delegation's contribution:** the first standard with **spend-bounded delegation + cascade revoke + intent declaration** as first-class primitives.

---

## Reference implementation

Soma Delegation is implemented in production in [ClawNet](https://github.com/1xmint/claw-net):

- **Database migration 149** — `depth`, `max_depth`, `branch_spend_limit`, `intent_declaration`, `data_domain`, `scope_endpoints_glob`, `scope_methods_csv`, `revoked_at` columns
- **Recursive cascade revoke** — BFS subtree traversal
- **Issuer API** — `POST/GET/DELETE /v1/economy/keys/delegated*` + `GET .../chain`
- **Proxy enforcement** — chain headers + scope checks on every call

Reference implementation coverage as of v0.1:
- ✅ Depth enforcement
- ✅ Branch cap enforcement
- ✅ Scope narrowing (issue + serving time)
- ✅ Cascade revoke
- ✅ Chain walking
- ✅ Response headers (`X-Soma-Delegation-*`)
- ⚠️ Glob-subset check simplified to prefix-matching
- ⚠️ Intent rejection at provider side not yet wired
- ⚠️ Cross-issuer trust registry pending

---

## Open questions

1. **Intent rejection:** should providers return the reason in headers or keep it opaque?
2. **Scope glob syntax:** shell-glob vs regex vs URI template? Leaning shell-glob.
3. **Spend cap visibility:** should children see parent's remaining cap? Leaning own-only (least privilege).
4. **Cascade revoke performance:** at depth > 10 with fan-out > 100, consider lazy mark-and-sweep.
5. **Cross-platform delegation:** cross-issuer trust registry required for interop.
6. **Key rotation:** if parent rotates, do children need re-issuance?

---

## Roadmap

- **v0.2** — formal glob subset semantics, cross-issuer trust registry design
- **v0.3** — reference client SDK (`@soma/delegation` npm package)
- **v1.0** — IETF submission as input to `draft-klrc-aiagent-auth`

---

## Contributing

Soma Delegation is MIT-licensed / CC BY 4.0 / open-protocol. Implementations and derivative specs are encouraged.

Open an issue or PR at [github.com/1xmint/soma-delegation-spec](https://github.com/1xmint/soma-delegation-spec).
