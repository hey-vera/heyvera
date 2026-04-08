# x402 Extension Proposal: Soma Delegation — scoped, bounded, auditable agent delegation

**Status:** RFC  
**Proposed as:** x402 extension (like Bazaar, Discovery)  
**Reference impl:** [github.com/1xmint/claw-net](https://github.com/1xmint/claw-net) (production since 2026-Q1)  
**Spec:** [github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md](https://github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md) (v0.1)

> **DO NOT FILE YET.** This draft is ready but should not be opened as a GitHub
> issue until we have production evidence to cite. Target state before filing:
> (1) real multi-agent traffic through ClawNet with delegation chains depth ≥ 2,
> (2) at least one cascade revoke incident observed end-to-end,
> (3) publicly-accessible metrics page showing chain counts + revocation latency.
> Proposing a spec is weak. Proposing a spec + "here are N production chains
> enforcing it, here's the dashboard" is the adoption pitch.
>
> **Metrics endpoint wired (2026-04-05):** `GET /v1/stats/delegation` returns
> active chain count, depth distribution, fanout, 24h cascade-revoke count, 24h
> `SCOPE_VIOLATION` rejection rate, and intent-distribution breakdown. This is
> the evidence URL to embed when filing. Blocker is now real multi-agent traffic
> (dogfooding), not tooling.

---

## Motivation

x402 solves agent-to-server payment. But x402 doesn't say anything about agent-to-agent authority transfer — which is where multi-agent systems (CrewAI, AutoGen, MetaGPT, LangGraph) are silently accumulating security debt.

Today, when a parent agent spawns children, standard practice is to hand children the parent's full API key. That's broken:

1. **No blast radius control** — one rogue child can drain the parent's wallet.
2. **No scope narrowing** — children inherit every permission their parent has.
3. **No depth limits** — delegation chains grow unbounded.
4. **No cascade revoke** — killing a parent doesn't kill descendants.
5. **No intent declaration** — providers can't distinguish a research agent from an attacker.

IETF `draft-klrc-aiagent-auth-01` is attempting to standardize agent auth but does not address scoped spend delegation. This proposal fills that gap as an x402 extension.

---

## Proposal

Add **Soma Delegation** as an x402 extension defining:

- **Delegation Key** — a secondary credential issued by a parent credential with `depth`, `max_depth`, `scope`, `spend_cap`, `branch_spend_cap`, `intent`, `ttl`, `parent_id`.
- **Scope narrowing** — child.scope ⊆ parent.scope, enforced at issue AND serving time.
- **Spend caps** — total + per-branch, with roll-up to ancestors.
- **Cascade revoke** — parent revocation kills the entire subtree (BFS).
- **Intent declaration** — signed purpose statement for provider-side policy.
- **HTTP wire format** — `X-Soma-Delegation-{Chain,Depth,Hops,Root,Intent}` response headers, `X-Soma-Delegation-Error` on rejection.

This is a natural superset of x402's `402 Payment Required` semantics — spend-cap-exhausted keys return 402, scope-violation keys return 403, etc.

---

## Why this fits x402

x402 is payment-over-HTTP. Soma Delegation is **bounded authority delegation for systems that do payment-over-HTTP**. The two are orthogonal but synergistic:

- x402 says: "here's how a server bills an agent per-call."
- Soma Delegation says: "here's how a parent agent gives a child permission to make billed calls, with safety rails."

Together, they let a user give an agent $100, and give the agent's sub-sub-agent a scoped $5 with zero risk to the remaining $95.

---

## Relationship to existing x402 extensions

| x402 extension | Purpose | Relationship to Soma Delegation |
|---|---|---|
| Bazaar | Discovery | Orthogonal — Soma Delegation works on any bazaared endpoint |
| Discovery (PROTOCOL_DISCOVERY.md) | Self-propagation | Complementary — delegation headers can piggyback on discovery |
| Facilitator | Payment settlement | Complementary — spend caps settle at facilitator level |

---

## Reference implementation

Already in production in ClawNet (since 2026-Q1):

- `POST /v1/economy/keys/delegate` — issues delegation with all v0.1 fields
- `GET /v1/economy/keys/delegated/:childKey/chain` — lineage walk with cycle guard
- `DELETE /v1/economy/keys/delegated/:childKey` — cascade revoke
- Response headers on every proxied call through `POST /v1/endpoints/:id/call`
- Scope + depth + branch-cap enforcement at issue AND serving time
- 23 unit tests covering backward compat, depth chains, cascade revoke, chain walk, scope enforcement, response headers

Full spec: [github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md](https://github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md)

---

## Asks

1. Feedback on the primitive set — are `depth`, `scope`, `spend_cap`, `branch_cap`, `intent` the right five?
2. Feedback on the header namespace — `X-Soma-Delegation-*` or `X-402-Delegation-*`?
3. Input on glob-subset semantics — shell-glob vs regex vs URI template for `scope.endpoints`?
4. Willingness to fold into x402 extensions as `@x402/extensions/delegation` (name TBD)?

Happy to open a PR with the initial spec draft, wire-format tests, and a `@coinbase/x402-delegation` reference client.

/cc @coinbase/x402-maintainers
