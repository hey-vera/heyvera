# Roadmap — what, why, todos

**Last updated:** 2026-04-05 (Phase 2 mid-sprint progress: dashboard + SDK + zauth pivot shipped)
**Scope:** Soma Protocol Stack + ClawNet, full forward-looking view
**Status:** living doc — update on every Phase milestone

This is the single canonical doc for "what are we building, why, what's next." All other `internal/*.md` files drill into specific subsystems. If a doc conflicts with this one, this one wins.

---

## 0. North star

**Build the trust + billing layer that x402 should have been.**

x402 is a payment primitive: HTTP 402 + USDC settlement. That's it. It punts on:
- Polling tax (no conditional payment)
- Delivery guarantees (reputation-only trust)
- Identity (no signed provenance)
- Subscriptions (single-use auths only)
- Streaming (no mid-stream settlement)
- Multi-hop splits (single `payTo`)
- Dispute resolution (extensions only, not canonical)

Soma Protocol Stack = **x402 core + the 15 things x402 punts on.**
ClawNet = **reference implementation of Soma + the agent economy built on top.**

**Why this framing matters:** when x402 wins, we win (we're complementary, not competitive). When x402 providers hit a limitation, they come to us. We don't need x402 to fail.

---

## 1. Soma Protocol Stack — 5 layers

| Layer | Purpose | Status |
|---|---|---|
| **Vouch** | Trust-weighted discovery (sits on top of any directory) | **MVP shipped** (2026-04-05) |
| **Check** | Conditional payment via content-addressed hashing | **Phase 1 shipped** (2026-04-05) |
| **Pay** | Rail-agnostic billing (credits / USDC / Stripe / SOL) | Shipped (rail abstraction in place) |
| **Identity** | Heart + Sense verification | Heart live; Sense experimental |
| **Receipt** | EAS-anchored delivery proofs on Base | Design phase (5-phase plan in project memory) |

**Why 5 layers:** each layer solves a distinct unsolved x402 problem. Stackable = composable = each provider picks which layers matter for their use case.

---

## 2. Shipped so far

### Soma Check Phase 0 (docs) ✓
- `internal/soma-check-strategy.md` — canonical strategy, decisions locked
- `internal/soma-onboarding-ladder.md` — 4-tier provider migration spec
- `internal/soma-check-billing.md` — 90/10 split, volume paradox math
- `internal/soma-check-header-spec.md` — ETag + X-Soma-* header contract

### Soma Check Phase 1 (build) ✓ (commit `27eb8e3` + `459f491`)
- Migration 147: `soma_check_events` telemetry table + indexes
- `src/core/soma-check-billing.ts` — rail-agnostic split calculator (90/10, 95/5 Champion)
- `src/db/soma-check.ts` — telemetry logger + aggregation
- `GET /v1/soma/check/stats[/:endpointId]` — savings dashboard API
- `GET /v1/soma/demo/*` — 6 free-API reference endpoints (CoinGecko, Open-Meteo, FX, GitHub, chain stats, HN) with ETag + 304 + telemetry
- Telemetry wired into `POST /v1/endpoints/:id/call` at all three branches

### Other shipped primitives
- Birth certificates (Soma Heart, provider-side signatures)
- zkTLS origin proofs (Reclaim Protocol integration)
- PQ hybrid signatures (Ed25519 + ML-DSA-65)
- Provider tiers (Open/Standard/Elite with revenue splits)
- Delegation keys (subscription-shaped API keys)
- Soma verdicts (agent trust bureau)
- Merkle anchoring on Base

---

## 3. Near-term roadmap (next 2-4 weeks)

> **2026-04-05 re-prioritization:** see `internal/soma-readiness-strategy.md` for full gap analysis. The sub-phases below are re-sequenced to activate what's already built (Gap A, Gap C) **before** investing in new code. The 90-day critical path is driven by the competitive clock (A2A Protocol, Mastercard Verifiable Intent, IETF draft-klrc) — §5 below.

### Phase 2.6 — Activate Soma Check on proxy path (Gap A — P0, highest ROI) ✓ SHIPPED 2026-04-05

**What:** Wire `computeSomaCheckSplit()` + tier awareness on `POST /v1/endpoints/:id/call` so every real call (not just 6 demo endpoints) honors `If-None-Match`, bills at hit-price 90/10, and logs non-shadow `soma_check_events` rows.

**Why:** The Soma Check billing calculator (`src/core/soma-check-billing.ts`) was never called on real traffic. The proxy path had 80% of the logic but returned `creditsUsed: 0` and logged everything as shadow.

**Todos:**
- [x] Migration 148 — `providers.soma_check_tier INTEGER NOT NULL DEFAULT 0`
- [x] Add `getProviderSomaCheckTier(endpointId): SomaCheckTier` + `setProviderSomaCheckTier()` in `src/db/providers.ts`
- [x] Extend `creditProviderShare()` with `providerSharePctOverride?: number` option
- [x] Wire `computeSomaCheckSplit()` into the 304 hash-match path in `src/routes/endpoints.ts` — charges hit price, credits provider 90% (T1-2) or 95% (T3), un-shadows telemetry when tier ≥ 1
- [x] Tier 0 remains free (shadow mode preserves zero-disruption onboarding)
- [x] Added `X-Soma-Tier`, `X-Soma-Hit-Price`, and `ETag` response headers
- [x] ClawNet cache-hit shadow telemetry now logs actual projected tier + hit-price split
- [x] `npm run test:unit` green (202/202) with migration 148 applied

**Next (outside this phase):** promote clawapis endpoints from Tier 0 → Tier 1 once they agree, run real-traffic N≥10K, pitch case study. Tracked in Phase 2 dashboard section.

### Phase 2.7 — On-chain receipts (Gap C — P0, flip the switch)

**What:** Activate EAS anchoring on Base so Soma Receipts become cryptographically verifiable on-chain, not just SQLite rows.

**Why:** All crypto code exists. All flags are `false`. **We're one env-var flip from shipping on-chain audit trails.** Mastercard Verifiable Intent (Jan 2026) is building this for enterprise SOC2/HIPAA demand. Zero design work required.

**Todos:**
- [ ] Register EAS schema on Base (one-time, ~$0.10 gas): fields request_hash, response_hash, payment_method, amount_usd, timestamp, signer
- [ ] Set `EAS_SCHEMA_UID` in VPS `.env`
- [ ] Fund Base wallet with ~$5 USDC for gas headroom
- [ ] Flip `EAS_ANCHOR_ENABLED=true` on staging first, monitor 24h
- [ ] Promote to prod, announce as Receipt Layer milestone
- [ ] Add public endpoint: `GET /v1/soma/receipt/:id/onchain` returns EAS tx hash

### Phase 2 — clawapis + dashboard (highest priority)

**What:** Make Soma Check visible to providers via UI + get clawapis.com onboarded as first real external customer.

**Why:** We have telemetry running but zero stakeholders can see it. Need a dashboard to close the loop: telemetry → pitch → signup → case study. clawapis is our reference customer (free forever, case-study rights).

**Todos:**
- [x] Build provider-facing savings dashboard UI under `site/` consuming `/v1/soma/check/stats` — shipped `site/soma-check.html` (commit `90ea3e7`)
- [x] Build provider-scoped earnings dashboard — shipped `site/provider-dashboard.html` + `GET /v1/providers/:id/soma-check?window=day|week|month` (2026-04-05)
- [x] JCS canonicalization on all three hash sites (serving path + cache warm cron + chain hash) so key-reorder no longer breaks `If-Soma-Hash` probes (2026-04-05)
- [x] Dual-sign wired into SomaReceipts — `peekLastDualSignResult()` + `extractDualSignReceiptFields()` flow provider cert fields into every receipt that passed through a Soma-emitting upstream (2026-04-05)
- [ ] Enable shadow mode on clawapis-registered endpoints (Path A = proxy-side, zero provider effort)
- [ ] **Telemetry run: compressed from 14 days → "N≥10K calls AND ≥5 weekday+2 weekend days, whichever comes first"**
  - **Why 14 days was arbitrary:** no hard requirement behind it, just a "silent observation" placeholder
  - **Real goals:** (a) statistical sample N≥10K for believable pitch numbers, (b) weekday/weekend polling variance, (c) telemetry-bug detection before scaling
  - **Compression paths (pick 1-2):**
    - Synthetic load against demo endpoints (10K calls/hr achievable) → **2 hours** to N=10K
    - Our own poller bot 24/7 against clawapis endpoints → **24-48h** to N=10K
    - A/B live: flip telemetry on for 5 real clawapis endpoints → **3-5 days** real numbers
    - Hybrid: synthetic load (validate infra 48h) + real traffic (validate numbers 5d) = **~1 week**
  - **Recommended:** hybrid — synthetic today to prove dashboard renders, real-traffic telemetry on clawapis concurrently
- [ ] Export CSV + "you would have saved $X" pitch packet
- [ ] Publish first real savings numbers as case study
- [ ] Add demo endpoints catalog link to public site nav

### Phase 2.5 — x402 discovery pivot (blocker fix)

**What:** Replace dead `zauth-discovery.ts` with working x402scan integration.

**Why:** `src/core/zauth-discovery.ts` queries `zauthx402.com/api/*` URLs that return 404 (verified 2026-04-05). We've had ZERO endpoints discovered from zauth since deploy. x402scan (github.com/Merit-Systems/x402scan) is the real x402 explorer — Messari-profiled, actually works.

**Todos:**
- [ ] Audit what `indexed_endpoints` rows exist with `source='zauth'` (expect 0)
- [x] Decide: delete zauth-discovery.ts OR rename to `x402scan-discovery.ts` and rewrite against x402scan API — decided: **preserve both** (zauth flag-gated OFF for partnership restoration, x402scan stub added). Commit `90ea3e7`.
- [x] If rewrite: contact Merit Systems / read x402scan API docs — API surface documented in `src/core/x402scan-discovery.ts`
- [ ] Wire x402 client-side payment signing so x402scan cron can actually poll ($0.01/call blocker)
- [ ] Update `docs/architecture.md` discovery section

### Phase 3 — ecosystem wedge (parallel to Phase 2)

**What:** Get Soma Check into the x402 spec conversation + build agent client helpers.

**Why:** We need spec-level recognition to make Soma Check a default assumption, not a ClawNet feature. And we need zero-friction client adoption — every extra line of code agents must write is a barrier.

**Todos:**
- [x] Ship `@clawnet/soma-check` npm package (client helper: automatic ETag caching, If-None-Match on every call) — shipped `packages/soma-check/` v0.1.0 (commit `444c654`). Ready for `npm publish --access public`.
- [ ] Submit x402 spec extension PR to `coinbase/x402`
- [ ] Outreach: 3-5 target providers (Helius, x.com API, Messari, QuickNode, Elsa AI)
- [ ] Blog post: "We shipped conditional payment in x402 and saved agents 78%" (after real numbers)
- [ ] Example repo: minimal agent using `@clawnet/soma-check` against demo endpoints
- [ ] Submit Soma Check as x402 Foundation extension candidate

### Phase 4 — monetization (after Phase 2-3)

**What:** Activate Champion Tier (95/5 split) + bake Soma Check into default agent tooling.

**Why:** 95/5 upgrade is the provider loyalty hook — once a provider has savings data they'll fight for the Champion badge. Auto-injection in `@clawnet/mcp` means every MCP agent gets Soma Check for free.

**Todos:**
- [ ] Champion Tier UI + eligibility rules (volume + referrals)
- [ ] Auto-inject Soma Check headers in `@clawnet/mcp` client
- [ ] Security audit of hash layer (replay windows, signature spoofing, JCS edge cases)
- [ ] Signed responses (`X-Soma-Signer` + `X-Soma-Signature`) on origin calls → ties Check to Identity layer

---

## 3.9 — Soma Delegation Spec (Gap B — P1, the strategic moat)

**What:** Formalize scoped-delegation primitive (depth limits, per-branch spend caps, cascade revoke, intent declaration). Published at `github.com/1xmint/soma-delegation-spec` as open standard. Spec drafted in `internal/soma-delegation-spec.md`.

**Why:** This is our biggest strategic whitespace. `trackDelegatedSpend()` is production code (2026-Q1) — no competitor has this. **IETF `draft-klrc-aiagent-auth-01` is standardizing agent auth NOW**. If adopted first, Soma Delegation becomes a ClawNet feature instead of the reference implementation of a standard. 8-week race.

**Phase 1 — core DB + runtime (SHIPPED 2026-04-05):**
- [x] Migration 149: `depth`, `max_depth`, `branch_spend_limit`, `intent_declaration`, `data_domain`, `scope_endpoints_glob`, `scope_methods_csv`, `revoked_at` columns on `delegated_keys` (correct table name)
- [x] Recursive cascade revoke in `src/db/transfers.ts:revokeDelegatedKey()` — BFS subtree
- [x] Depth + branch-cap + (conservative) scope-narrowing at creation time in `createDelegatedKey()`
- [x] New v0.1 fields on `DelegatedKey` interface
- [x] 7 new delegation tests (209/209 pass)

**Phase 2 — public HTTP surface (SHIPPED 2026-04-05):**
- [x] `POST /v1/economy/keys/delegate` accepts full v0.1 body (maxDepth, branchSpendLimit, intentDeclaration, dataDomain, scopeEndpointsGlob, scopeMethodsCsv) + typed error codes (DEPTH_EXCEEDED, BRANCH_CAP_EXCEEDED, SCOPE_VIOLATION)
- [x] `GET /v1/economy/keys/delegated` returns all v0.1 fields in the list response
- [x] `GET /v1/economy/keys/delegated/:childKey/chain` — walks lineage leaf→root with per-hop scope/budget/intent (masked keys); caller must appear in chain
- [x] `DELETE /v1/economy/keys/delegated/:childKey` — returns `{ cascade: true, revokedCount }` reflecting subtree revoke
- [x] `getDelegationChain()` in `src/db/transfers.ts` with cycle guard (32-hop cap) + 4 new unit tests
- [x] §5.1 "Issuer API (reference implementation)" added to spec doc

**Phase 3 — publish + wire (SHIPPED 2026-04-05):**
- [x] Publish `soma-delegation-spec.md` to `github.com/1xmint/Soma/blob/master/SOMA-DELEGATION-SPEC.md` (co-located with SOMA-CHECK-SPEC)
- [x] Wire `X-Soma-Delegation-{Chain,Depth,Hops,Root,Intent}` response headers on the proxy path via `buildDelegationChainHeaders()` in `src/utils/billing.ts`
- [x] Enforce scope_endpoints_glob + scope_methods_csv at serving time via `checkDelegationScope()` in `src/middleware/auth.ts` (returns 403 + X-Soma-Delegation-Error:SCOPE_VIOLATION)
- [x] x402 extension proposal drafted at `internal/x402-delegation-issue.md` — HELD until production evidence accumulates (multi-agent chains + cascade revoke observed + public metrics)

**Phase 4 — standardize (pending production evidence):**
- [x] `getDelegationMetrics()` + `GET /v1/stats/delegation` — active chain count, depth distribution, fanout, 24h cascade revokes, 24h SCOPE_VIOLATION count, intent distribution. Audit-logs SCOPE_VIOLATION as `DELEGATE_SCOPE_REJECT` so it's countable. Tests in `tests/unit/delegation.test.ts` (29 pass).
- [ ] Dogfood: run CrewAI-style multi-agent demo through ClawNet producing real chains depth ≥ 2, observe cascade revoke, capture metrics snapshot
- [ ] Open issue on `coinbase/x402` proposing as x402 extension (after metrics show real traffic)
- [ ] Parse `X-Soma-Intent` request headers on the proxy path, enforce intent vs dataDomain
- [ ] Submit to IETF draft-klrc working group as reference-implementation input
- [ ] Reference client in `@clawnet/soma-delegation` npm package

---

## 3.95 — Vouch MVP (Gap E — P1, A2A defense) ✓ MVP SHIPPED 2026-04-05

**What:** `GET /v1/soma/vouch/search` trust-weighted provider discovery. A2A-compatible agent-card.json per provider.

**Why:** A2A Protocol (Google + LF, 50+ partners), MCP bazaar, and x402 self-propagation are all building agent discovery right now. Discovery is table-stakes; trust is the moat. Vouch sits on top of any directory (A2A/MCP/x402) and answers "which of these should I pay?" using signals they don't have (`soma_verdicts`, delegation lineage, Soma tier).

**Phase 1 — MVP (SHIPPED 2026-04-05):**
- [x] Ranking formula in `src/core/vouch-ranking.ts`: `(0.40*trust + 0.20*volume + 0.20*tenure + 0.10*freshness + 0.10*hits) * somaBonus` where bonus is 1.0/1.15/1.25/1.30 by tier
- [x] Search query in `src/db/vouch.ts` filtering by q / category / verified / somaEnabled / minTier
- [x] `GET /v1/soma/vouch/search` endpoint
- [x] `GET /v1/soma/vouch/providers/:slug` detail endpoint
- [x] `GET /v1/soma/vouch/providers/:slug/agent-card.json` — A2A schemaVersion 0.2 compatible with `x-vouch` extension fields
- [x] 7 ranking tests (216/216 pass)

**Phase 2 — enhancements (next):**
- [ ] Add Vouch tab to `site/soma-check.html` (public browsing UI)
- [ ] Wire verdict data from `soma_verdicts` into trust_score (currently a standalone column)
- [ ] Transitive trust v1: 2-hop verdict graph walk, weight by signer reputation
- [ ] Publish `/.well-known/agent-card.json` aggregate index pointing at all providers
- [ ] Adapter endpoint: `POST /v1/soma/vouch/score` accepts external agent-card JSON, returns Vouch score — makes Vouch consumable from A2A/MCP/x402 directories

---

## 4. Future-vision gaps — what AI agents of 2027+ will need

These are NOT yet on the build queue. They're the 10/10 expansion surface. Each one is a gap x402 doesn't address that we could own.

**Ranked by strategic weight:**

### A. Pay-per-chunk streaming (LLM tokens, video, live data)

**What:** Mid-stream settlement signatures — sign every N tokens/bytes, pay incrementally.

**Why:** x402's `upto` scheme explicitly excludes multi-settlement streaming. LLM inference is the fastest-growing paid API category. If we own streaming settlement, we own the LLM provider market.

**Why not yet:** Requires new cryptographic primitive (chunk-signing). Design-phase only.

**Todos (when activated):**
- [ ] Design `X-Soma-Stream-Ticks` header + settlement cadence
- [ ] Propose to x402 spec WG
- [ ] Prototype with one LLM provider

### B. Semantic caching for generative content

**What:** Cache key = input hash (for deterministic mode) OR embedding similarity (for stochastic). LLM outputs dedup on input, not output.

**Why:** Soma Check bytewise hash fails for stochastic outputs. Same prompt → different output → always a "miss." Industry has no solution. First mover wins.

**Todos (when activated):**
- [ ] Design `X-Soma-Input-Hash` header alongside `X-Soma-Hash`
- [ ] Define embedding similarity threshold policy
- [ ] Prototype with an LLM demo endpoint

### C. Quality oracle + receipt-backed automatic refunds

**What:** If delivered bytes fail schema validation / quality check, auto-refund from escrow. Soma Receipts anchor the proof.

**Why:** x402 admits its trust model is reputation-only. This is the single most-cited unsolved pain point. Our Receipt Layer is already half-built; this is the consumer-facing payoff. Anti-rug moat.

**Todos (when activated):**
- [ ] Define quality check policy schema (required fields, error detection, min size)
- [ ] Build escrow release/refund state machine on Base
- [ ] Integrate with Soma Receipts (EAS attestations)

### D. Multi-hop atomic settlement

**What:** One signed authorization splits payment across `agent → aggregator → provider` chain in a single transaction.

**Why:** x402 punts entirely on multi-party flows. We have delegation keys (60% there). Formalizing this unlocks aggregator business models.

### E. Subscription primitive

**What:** Weekly/monthly pre-funded wallets with auto-top-up. Not per-call delegations.

**Why:** Agents hate managing 1,000 per-call signatures. Every enterprise customer asks for subscriptions.

### F. Intent-declared pricing

**What:** Caller declares stakes ("$10M trade incoming"), provider prices accordingly. Price scales with caller's declared use case.

**Why:** Freshness tiers hint at this; make it explicit. Differentiates high-stakes calls from research/backtest queries.

### G. Agent reputation portability

**What:** Export soma-verdicts in a standard format, carry reputation across platforms.

**Why:** Soma verdicts + Identity layer partially address; formalize export schema.

### H. Negotiation protocol

**What:** Agent proposes price, provider accepts/counters. Bargaining replaces take-it-or-leave-it.

**Why:** Future agent economies require price discovery primitives.

### I. Recursive provenance chains

**What:** "This data came from X which came from Y." Birth certs give one hop; walk the chain.

**Why:** Data gets transformed 3-5 times through pipelines. Agents need to verify sources-of-sources.

### J. Failure insurance

**What:** Small premium upfront → auto-refund on bad delivery. Complements Receipt Layer.

### K. Cross-agent memory market

**What:** Agent A learns something, sells the insight to Agent B. Not data but **learned context**.

**Why:** No one has this. Agent-native market primitive that doesn't exist anywhere.

### L. Time-discount pricing tier

**What:** Data older than T seconds worth Y% less. Stale-but-cheap rail beyond binary hit/miss.

---

## 5. Competitive landscape (2026-04-05 snapshot)

**Strategic threats requiring response in the next 90 days:**

| Threat | What they do | Status | Our counter | Deadline |
|---|---|---|---|---|
| **A2A Protocol** (Google + LF, 50+ partners) | Agent Cards, capability discovery | Already shipping | Vouch MVP with A2A-compatible agent-cards (§3.95) | Q2 2026 |
| **Mastercard Verifiable Intent** | Enterprise agent attestations | Jan 2026 launch | Flip EAS_ANCHOR_ENABLED=true, publish Receipt spec (§2.7) | Q2 2026 |
| **IETF draft-klrc-aiagent-auth** | Agent auth/delegation | Draft pending adoption | Publish Soma Delegation Spec v0.1 (§3.9) | **8 weeks** |
| **IETF draft-sharif-agent-payment-trust** | Payment trust attestations | Draft pending adoption | Link Soma Identity terminology to this draft | Q3 2026 |
| **x402 Foundation** (Coinbase + Cloudflare) | Payment standardization | Tailwind | Push clawapis onto x402 stack | ongoing |
| **MCP 2026 roadmap** | Audit trails, task lifecycle | Q2-Q4 2026 | Position Soma as MCP audit layer | Q3 2026 |

**Complementary / partnership targets:**

| Player | What they do | Our relationship |
|---|---|---|
| **Coinbase x402 / Linux Foundation** | Core protocol (payment primitive) | Complementary — we build on top |
| **x402scan (Merit Systems)** | x402 explorer + analytics | **Partner target** — real discovery source |
| **zauth / zauthx402.com** | AI-agent endpoint pentesting (pump.fun origin, anon team, $5.6M mcap) | **Partnership target, not data source** — their public API doesn't exist |
| **RelAI** | x402 facilitator | Partners with zauth; potential partner for us |
| **x402r** | Refund protocol extension | Overlaps with our Receipt Layer |
| **x402Disputes** | Arbitration API | Adjacent to quality oracle (gap C) |
| **offer-and-receipt extension** | Signed receipts | Overlaps with our Receipt Layer |
| **Sponge (YC W26)** | Agent wallet distribution | Partner target (per March event intel) |

**Why this map matters:** know who's complementary vs overlapping. Receipt Layer competes with x402r/offer-and-receipt — we need to differentiate on PQ signatures + 5-layer stack.

---

## 6. Partnership pipeline

### Active / near-term
- **clawapis.com** — reference customer (first case study)
- **x402scan** — replace dead zauth discovery integration

### Outreach queue (ranked)
1. **zauth** — co-branded dashboard, Soma Check savings feed to their registry (asymmetric, low effort)
2. **Helius** — Solana RPC provider, highest-volume polling target
3. **x.com API** — Twitter data, ideal for Soma Check (high polling, low change rate)
4. **Messari** — crypto data, aligns with existing relationships (diran_li)
5. **QuickNode** — RPC infrastructure
6. **OpenRouter** — LLM routing, ideal for future streaming (gap A)
7. **RelAI** — facilitator partnership, bridge to zauth ecosystem

**Why pipeline order:** Soma Check shines on high-poll, low-change data. Crypto/RPC/social are the best fits. LLM routing (OpenRouter) is gap A wedge, parked until streaming is built.

---

## 7. Open questions / decisions needed

- [ ] **Receipt Layer priority:** currently blocked by Soma scale test. Reorder to unblock quality oracle (gap C)?
- [ ] **zauth dead code:** delete outright or pivot to x402scan? (Recommend pivot.)
- [ ] **Champion Tier activation criteria:** volume? referrals? time-based? Needs spec.
- [ ] **Streaming gap A:** target ship Q3 2026, or wait for LLM provider demand signal?
- [ ] **Submission to Linux Foundation x402 WG:** when + who presents?
- [ ] **6th Soma layer candidate:** Safety-Interlock vs. Intent Declaration — which do we claim first? See `soma-readiness-strategy.md` §4.
- [ ] **A2A interop:** ship agent-card.json matching A2A format, or publish our own and link? (Leaning interop.)
- [ ] **EAS schema registration on Base:** who holds the wallet that registers the schema? Ops decision before Phase 2.7.

---

## 8. How to use this doc

- **Adding work:** update Phase 2-4 todos OR future-vision gaps list
- **Completing work:** check the todo box + update section 2 (shipped)
- **Strategic shift:** update section 0 (north star) or section 1 (stack layers)
- **Competitor moves:** update section 5
- **Partnership progress:** update section 6

Each `internal/*.md` file drills into specifics. This doc is the overview.

### Related docs
- `internal/soma-readiness-strategy.md` — **gap analysis + 90-day critical path (read first for strategy)**
- `internal/soma-delegation-spec.md` — **Soma Delegation v0.1 draft spec (Gap B deliverable)**
- `internal/soma-check-strategy.md` — Soma Check specifics
- `internal/soma-check-billing.md` — billing math in detail
- `internal/soma-onboarding-ladder.md` — 4-tier provider migration
- `internal/soma-check-header-spec.md` — header contract
- `internal/cache-layers-distinction.md` — ClawNet L1/L2 cache vs Soma Check (critical distinction)
- `internal/funds-flow.md` — how money actually reaches providers + "is 10% sketchy?" analysis
- `internal/groundbreaking-extensions.md` — extension ideas (Vouch origin spec as Extension 9.5, etc.)
- `internal/proof-of-delivery-roadmap.md` — Receipt Layer 5-phase plan
- `internal/scale-test-plan.md` — Soma scale test sequencing
- `internal/soma-future-proofing.md` — pause-and-resume strategy
- `internal/brainstorm.md` — raw idea capture log
