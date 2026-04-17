# Trust Network Foundation Reconciliation

Status: active internal planning packet
Created: 2026-04-16
Scope: docs-only reconciliation, evidence ledger, and slice planning

This packet reconciles pre-system ClawNet/Soma trust-network, orchestration, cache, provider, provenance, and related implementation surfaces into an ordered foundation path. It is not an implementation plan by itself, not canonical shipped truth, and not authorization to change Soma protocol semantics.

Use this packet to decide the next 3-5 safe slices for this work chat. Work4 is handling Soma credential rotation separately and is not a dependency for this packet.

## Ground Rules

- Do not implement from this packet directly.
- Do not change package/API surfaces, production behavior, deploy flow, or Soma protocol semantics.
- Do not do Pulse work here.
- Do not do tokenomics, staking, trust mining implementation, or ClawNet token/proof-mining design.
- Treat old or salvaged work as `partial-foundation` until it reaches a terminal condition.
- Promote durable truth through `docs/proposals/` and `docs/decisions/` before implementation.

## Current State Snapshot

### Local repo state verified

- Branch: `main`.
- Local status before this packet: `main...origin/main`, with pre-existing local changes to `internal/idea-triage-index.md` and untracked `internal/backlog/clawnet-trust-resolution-moat-thesis.md`.
- This packet intentionally does not alter those pre-existing files.

### Live PR state verified

GitHub PR state was checked on 2026-04-16.

| PR | State | Title | Planning effect |
|---|---|---|---|
| #44 | open | `chore(deps): bump hono from 4.12.12 to 4.12.14` | unrelated dependency PR; do not mix foundation reconciliation into it. |
| #62 / work4 | separate work chat | user clarified work4 is handling Soma credential rotation | out of scope for this packet; do not inspect or coordinate unless the user explicitly asks. |
| #43 | merged on 2026-04-15 | `feat(rotation): migration v2 + transactional adoption primitive (G7.2)` | no longer paused-open PR state; remaining work2 context should be migrated, not resumed blindly. |

### Accepted docs and boundaries

| Artifact | Status | Relevant rule |
|---|---|---|
| `AGENTS.md` | repo operating rule | Pre-system/salvaged work needs an evidence ledger before build-ready status. |
| `docs/overview.md` | canonical | ClawNet owns runtime/platform truth, not Soma protocol or Pulse product truth. |
| `docs/reference/repo-surfaces.md` | canonical | `docs/` is canonical; `internal/` is supporting/non-canonical. |
| `docs/decisions/ADR-0003-cross-repo-source-of-truth.md` | accepted | Soma owns protocol truth; ClawNet owns runtime/platform truth; Pulse owns product-specific truth. |
| `docs/decisions/ADR-0004-foundation-first-mainline.md` | accepted | Move through small, foundation-first PRs on `main`; do not land fork-era rewrites wholesale. |
| `docs/decisions/ADR-0005-keep-first-class-platform-surfaces-together-for-now.md` | accepted | Keep broad ClawNet surfaces together but make them legible. |
| `docs/decisions/ADR-0006-soma-rotation-first-consumer.md` | accepted | Soma rotation semantics are fixed inputs; Gate 7 excludes cutover, admin mint, wallet rotation, and production rollout. |
| `docs/proposals/credential-rotation-first-consumer.md` | proposed | Cross-repo rotation proposal; ClawNet is first consumer only. |

### Known pre-system implementation areas

Targeted inspection found that current `main` has a smaller runtime than some canonical docs describe:

- Present in source: basic orchestration (`src/routes/api.ts`, `src/core/executor.ts`), L1/L2 cache wrapper (`src/cache/index.ts`), static API registry (`src/config/api-registry.ts`), LLM provider fallback (`src/providers/llm.ts`), API-key rotation backend and G7.2 adoption wrapper (`src/core/api-key-rotation.ts`, `src/core/rotation-adoption.ts`).
- Not found in source during targeted inspection: `src/core/soma.ts`, `src/routes/endpoints.ts`, `src/routes/soma.ts`, `src/routes/providers.ts`, `src/routes/soma-check.ts`, `src/core/soma-receipt.ts`, `src/core/dual-sign.ts`, `src/core/cache-certificate.ts`, `src/core/zktls.ts`, `src/db/providers.ts`, `src/db/soma-check.ts`.
- Therefore, docs that describe Soma receipts, provider umbrella, Soma Check route surfaces, dual-sign, zkTLS, and certified cache as "built" are not sufficient evidence that those surfaces exist on current `main`.

This mismatch is the core foundation issue: old docs, brainstorms, merged partials, and current source need a careful ledger before implementation resumes.

## Evidence Ledger

| Surface | Current status | Vision fit | Security exposure | Upstream dependencies | Missing evidence | Blocks current work | Next gate | Terminal condition |
|---|---|---|---|---|---|---|---|---|
| Soma Check freshness evidence binding | separate / out of scope here | High if it binds conditional-payment claims to durable evidence without redefining Soma | Medium-high: payment avoidance, stale-data claims, provenance headers | Work4 owns its active credential-rotation context; Soma Check wire semantics still require accepted docs before local implementation | Current packet does not inspect that work | No for this chat | Leave to work4 or a fresh user-directed review | Merged/closed in its own workstream, or explicitly brought back by the user |
| Soma integration / verified execution | partial-foundation | High: ClawNet should be a first real consumer of Soma accountability | High: identity, signatures, request authenticity | Soma owns protocol/package semantics; `soma-heart@0.4.0` now declared in package.json | Confirm actual import/wiring on `main`; canonical docs overclaim missing paths | Yes, because many downstream trust claims depend on it | Focused foundation audit of named Soma paths only | Shipped only when runtime wiring, tests, docs, and rollout evidence agree |
| API-key rotation first-consumer | partial-foundation | High for credential continuity and first-consumer proof | High: auth/credential storage | ADR-0006, Soma rotation semantics, `soma-heart/credential-rotation` package | G7.3 shadow-check status; production caller absence; rollout readiness | Yes for auth-related trust work; no for Soma Check unless coupled | Finish/review post-#43 Gate 7 state before new auth slices | Default-off shadow-check merged, tested, documented; cutover remains separate ADR |
| Orchestration | shipped-minimal / partial-foundation | Medium-high as adoption wedge and agent routing surface | Medium: request planning, external API calls, billing estimates | LLM provider config, API registry, cache | Tests, docs that match current simplified runtime, cost/billing correctness | No, except as context for future trust/provenance attachment | Cleanup/test PR, not redesign | Current behavior documented and tested; future trust hooks proposed separately |
| Semantic cache / L1-L2 cache | shipped-minimal / partial-foundation | High as ClawNet platform wedge and freshness memory | Medium: stale data, pricing, cache poisoning | Redis availability; cache policy docs | Current code lacks many documented features: SWR, LFU, semantic aliases, certificate chaining | No, unless used by Soma Check/freshness slice | Cache reality reconciliation PR or proposal | Docs match implementation, tests cover cache key/TTL/hit behavior, advanced claims moved to proposal/backlog |
| Certified cache / cache certificates | proposal / stale-doc claim | High if used as provenance chain | Medium-high: signed cache truth can mislead if wrong | Soma cert semantics; cache storage | Named files/tables not present on current `main` | No | Proposal/ADR before code | Accepted proposal plus first minimal migration/API slice, or archived as stale |
| Trust/provenance records | proposal / partial-doc claim | High for trust-resolution moat | High: public trust claims, privacy, false confidence | Soma evidence primitives; ClawNet receipt/provenance model | Existing source support missing; brainstorm proposes `DerivationCert` and DAG but is not accepted | No for immediate code; yes for trust-query design | Proposal packet split from provenance brainstorm | Accepted proposal/ADR with non-goals and privacy/security model |
| Provider registration/onboarding | proposal / stale-doc claim | High adoption wedge if providers run Soma Heart | High: provider auth, scoped keys, revenue share | Payment/billing model, provider identity, Soma provider certs | `src/routes/providers.ts` and `src/db/providers.ts` not found; canonical docs overclaim | No | Provider onboarding proposal or doc cleanup | Minimal provider registry shipped with tests/docs, or stale claims archived |
| Payment/x402 integration | partial-foundation / mixed | High as settlement layer and external agent compatibility | High: money movement, overcharge, receipt evidence | External x402 spec stability; billing spine; wallet/env config | Current source lacks named x402 facilitator routes found in docs; `x402 upto` note is research only | No unless a payment slice starts | Research-to-proposal after external spec stabilizes | Accepted proposal with rail boundaries; implementation only in small payment-client/server slice |
| Soma receipts / EAS anchoring | proposal / stale-doc claim | Medium-high if paid interactions need durable audit | High: payment proof, public attestations, privacy | EAS/Base config, Soma receipt semantics | Named files/routes not present; docs claim built without current source evidence | No | Proposal/ADR or doc correction | Receipt MVP merged with tests and public verification docs, or stale docs corrected |
| Trust query ideas | proposal-seed | High long-term if ClawNet resolves trust evidence | High: reputation, false trust, privacy | Provenance records, provider identities, Soma semantics | No accepted product proposal, no current source | No | Narrow product proposal: "read-only trust query v0" | Accepted proposal with inputs, non-goals, abuse model, and no mining/token coupling |
| Trust mining ideas | brainstorm / explicitly parked | Possible long-term moat, but too broad | Very high: staking, slashing, public state, Sybil incentives | Trust query, public evidence model, economics, token decisions | Everything implementation-grade; current notes are strategic only | No | Leave in backlog; maybe research packet later | Archived, superseded, or promoted only after trust revenue/evidence prerequisites |
| Pulse-related trust usage | referenced only | Product-specific downstream proof surface | Medium-high if it affects user actions | Pulse repo ownership and product plans | No ClawNet implementation need now | No | Do not plan Pulse work here | Remains cross-reference only unless Pulse asks for a ClawNet integration proposal |
| ClawNet trust-resolution moat thesis | brainstorm / proposal-seed | High strategic framing | High if implemented prematurely | Soma evidence, provider adoption, query product, privacy model | Pressure-test, owner split, first artifact | No | Split into small proposal seeds only | Specific sub-proposals accepted/rejected; thesis remains non-executable |

## Candidate Surfaces To Classify

The next planning pass should classify only the surfaces below, using named docs/source paths and current PRs. Do not expand into a repo-wide audit.

1. Soma Check freshness evidence binding
2. Soma integration and verified execution
3. API-key rotation first-consumer state after PR #43
4. Orchestration as a free/adoption wedge
5. ClawNet semantic cache and query cache
6. Certified cache and cache-certificate claims
7. Trust/provenance records and derivation-chain proposal material
8. Provider registration/onboarding
9. Payment/x402 integration, including `upto` only as research
10. Trust query ideas
11. Trust mining ideas, explicitly parked
12. Pulse-related trust usage, only as boundary context

## Ordered Foundation Path

### 1. Reconcile canonical docs against current `main`

The safest next PR for this chat is a docs-only reconciliation PR that fixes overclaims in current architecture/reference docs or adds a small "current implementation status" note. This PR should not implement missing Soma receipts, provider routes, Soma Check routes, dual-sign, or zkTLS.

Own:
- `docs/reference/soma-integration.md`
- `docs/architecture/runtime.md`
- `docs/reference/current-trust-surfaces.md`

Must not touch:
- `src/**`
- package files
- Soma semantics

### 2. Finish Gate 7 rotation clarity separately

PR #43 is merged, and `src/core/rotation-adoption.ts` now exists on `main`. Work2 should not resume a paused branch as if #43 were open. Migrate any remaining notes into a fresh Gate 7 follow-up chat only after checking what G7.3 needs.

Likely next Gate 7 slice:
- review G7.2 merged state and decide whether G7.3 shadow-check is still the next rotation PR.

Must not combine with:
- Soma Check
- provider onboarding
- trust query
- payment/x402

### 3. Make cache/orchestration reality testable

Once docs no longer overclaim, create a small cleanup/test PR around the existing orchestration/cache behavior:
- cache key determinism;
- TTL/memory/Redis fallback behavior;
- query-cache behavior in `/v1/orchestrate`;
- doc update distinguishing shipped minimal cache from proposed semantic/certified cache.

This turns the actual wedge into reliable foundation without trying to build the whole trust network.

### 4. Promote exactly one trust proposal

After the foundation cleanup, choose one proposal, not all:
- read-only trust query v0; or
- provider onboarding v0; or
- provenance/derivation records v0.

Recommended first proposal: provider onboarding v0, because trust evidence needs real providers and identities before trust queries or mining are meaningful.

Trust mining and token/staking stay in backlog until there is shipped evidence, usage, and an accepted trust-query/product proposal.

## Next 3-5 Concrete Slices

1. `docs: reconcile trust surface claims with main`
   - Docs-only. Mark missing current-main files as proposed/stale where needed.
2. `test(cache/orchestrate): lock current minimal behavior`
   - Tests-only or tiny docs cleanup; no Soma/protocol/payment work.
3. `docs: Gate 7 post-#43 rotation status and G7.3 decision`
   - Docs-only planning note or ADR update if needed.
4. `proposal: provider onboarding v0`
   - Proposal only; define identity, registration, review, non-goals, and no trust-score/mining.
5. `proposal: provenance records v0`
   - Proposal only; derive from the provenance brainstorm, but keep v0 narrow and privacy-aware.

## Work-Chat Allocation Plan

| Future chat | Owns | Must not touch |
|---|---|---|
| Docs reconciliation chat | Update canonical docs so they match current `main`; classify stale/built/proposal claims | No source/package/API edits; no Soma semantics |
| Rotation migration chat | Migrate work2 context after #43; decide G7.3 shadow-check plan from current main | No resuming old branch blindly; no cutover/admin mint/wallet rotation |
| Cache/orchestration test chat | Add focused tests for existing cache/orchestration behavior | No semantic cache redesign; no certified cache; no provider onboarding |
| Proposal chat | Draft provider onboarding v0 or provenance records v0 | No implementation; no trust mining; no Pulse work; no tokenomics |

Recommendation: for this chat, skip PR-review coordination with work4 and continue with docs reconciliation against current `main`.

## Stop Conditions

Stop and ask before continuing if any of these happen:

- An active PR conflicts with the planned file set or branch base.
- `main` diverges from `origin/main` or local uncommitted user changes overlap the target files.
- Live GitHub state contradicts the work snapshot in a way that changes dependency order.
- Current implementation contradicts accepted docs or ADRs and the fix is not docs-only.
- A proposed change would alter Soma protocol semantics, credential trust semantics, or package/API surface.
- Security-sensitive behavior exists without tests and a follow-up would need source edits.
- ClawNet economics, token, staking, or proof-mining ideas start leaking into Soma or protocol docs.
- Pulse-specific behavior becomes more than a boundary reference.
- Payment/x402 work depends on unstable external specs.
- A docs reconciliation would require declaring a surface shipped when only brainstorm/stale docs support it.

## Recommendation

Treat the current trust-network foundation as real but uneven:

- Keep: minimal orchestration, minimal cache, G7 rotation foundation, Soma-as-first-consumer direction.
- Reconcile: canonical docs that overclaim missing current-main implementation.
- Pause: provider umbrella, certified cache, receipts, dual-sign, zkTLS, trust queries until they have focused proposals or source evidence.
- Park: trust mining, token/staking, Pulse trust usage.
- Migrate: work2/#43 context into a fresh Gate 7 chat only after current main is checked.

The next PR for this chat should be docs-only reconciliation of trust surface claims against `main`, not another implementation slice.
