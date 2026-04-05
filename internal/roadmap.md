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
| **Bazaar** | Verifiable discovery + transitive trust | Design phase (extension 9.5 in groundbreaking-extensions.md) |
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

### Phase 2 — clawapis + dashboard (highest priority)

**What:** Make Soma Check visible to providers via UI + get clawapis.com onboarded as first real external customer.

**Why:** We have telemetry running but zero stakeholders can see it. Need a dashboard to close the loop: telemetry → pitch → signup → case study. clawapis is our reference customer (free forever, case-study rights).

**Todos:**
- [x] Build provider-facing savings dashboard UI under `site/` consuming `/v1/soma/check/stats` — shipped `site/soma-check.html` (commit `90ea3e7`)
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

---

## 8. How to use this doc

- **Adding work:** update Phase 2-4 todos OR future-vision gaps list
- **Completing work:** check the todo box + update section 2 (shipped)
- **Strategic shift:** update section 0 (north star) or section 1 (stack layers)
- **Competitor moves:** update section 5
- **Partnership progress:** update section 6

Each `internal/*.md` file drills into specifics. This doc is the overview.

### Related docs
- `internal/soma-check-strategy.md` — Soma Check specifics
- `internal/soma-check-billing.md` — billing math in detail
- `internal/soma-onboarding-ladder.md` — 4-tier provider migration
- `internal/soma-check-header-spec.md` — header contract
- `internal/cache-layers-distinction.md` — ClawNet L1/L2 cache vs Soma Check (critical distinction)
- `internal/funds-flow.md` — how money actually reaches providers + "is 10% sketchy?" analysis
- `internal/groundbreaking-extensions.md` — extension ideas (Bazaar, etc.)
- `internal/proof-of-delivery-roadmap.md` — Receipt Layer 5-phase plan
- `internal/scale-test-plan.md` — Soma scale test sequencing
- `internal/soma-future-proofing.md` — pause-and-resume strategy
- `internal/brainstorm.md` — raw idea capture log
