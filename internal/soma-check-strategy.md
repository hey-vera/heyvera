# Soma Check — strategy, roadmap, value capture

**Status:** internal strategy doc. Do NOT publish publicly — contains pricing analysis, competitive positioning, named-partner context.

**Last updated:** 2026-04-05. Supersedes `x402-etag-strategy.md`.

---

## TL;DR

**Soma Check** is the conditional-payment layer of the Soma Protocol Stack. Clients send a content hash; if unchanged, server returns `304 Not Modified` with a signed receipt — billed at **10% of origin** (the "availability rent"). Works with any payment rail (ClawNet credits, x402 USDC, Stripe).

External compatibility tagline: **"works with x402"** — not our product name. Soma Check is the noun; x402 is an adjective describing a compatible rail.

Provider keeps **90%** of every call — origin OR cache hit. ClawNet keeps 10%. Upgrades to **95/5 (Champion Tier)** for high-volume referrers.

Immediate targets:
1. Dogfood on 6 free-public-API demo endpoints ("Soma reference endpoints")
2. Onboard clawapis via Path A (ClawNet-proxied shadow mode, zero clawapis effort)
3. Submit Soma Check as an x402 spec extension to Linux Foundation

---

## Who benefits from what

### Providers (clawapis, Helius, x.com, any x402 API)

| Gain | How |
|---|---|
| Revenue continuity | 90% share never changes — origin OR cache hit |
| Profit from inaction | Cache hits are 100% margin (serve nothing, earn 9% of origin) |
| Volume upside | Agents poll 5-10× more often when hits are cheap → more total revenue |
| Trust badge | "Soma-verified" signals identity + freshness guarantees |
| Zero integration (Path A) | ClawNet proxy runs middleware — provider does nothing |
| Low integration (Path B) | 50-line middleware wrap for direct customers |
| Champion Tier | Upgrade to 95% share on hits via volume/referrals |

### AI agents (consumers)

| Gain | How |
|---|---|
| 90% cost reduction on cache hits | `If-None-Match` → 304 → bill at 10% |
| Predictable spend | Cost scales with data-change rate, not poll frequency |
| Fresher data without cost spiral | Can poll 10× more often for same budget |
| Cryptographic audit trail | Every skip-charge gets a Soma-signed receipt |
| Rail-agnostic | Works whether agent uses credits or x402 wallet |

### ClawNet (reference implementation + platform)

| Gain | How |
|---|---|
| Category definition | First conditional-payment protocol for paid APIs |
| Protocol ownership | Soma spec lives with us; reference impl is ours |
| Data flywheel | See hit rates across 14k+ endpoints in registry |
| Network effects | Every enabled endpoint makes Soma Vouch more valuable |
| Trust anchor | Soma cert chain backs the hash — "server can't lie about unchanged" |
| Revenue (direct) | 10% share of hit price = 1% of origin at scale |
| Revenue (indirect) | Hit traffic drives agents into Vouch + Identity + Receipt layers |
| Spec leverage | Submit to Linux Foundation alongside x402 V2 |

---

## Billing model (locked 2026-04-05)

**Cache hit price = 10% of origin.** Split 90/10 (provider/ClawNet) matching origin split.

| Endpoint list price | Origin call | Cache hit |
|---|---|---|
| 10 credits | agent pays 10, provider gets 9, ClawNet 1 | agent pays 1, provider 0.9, ClawNet 0.1 |
| $0.01 USDC (x402) | same split via facilitator | same split via facilitator |

**Why 90/10 (not 50/50 or 80/20):**
- Consistent with established ClawNet origin split — no trust damage
- Simple pitch: "your rev share never changes, just volume"
- Provider recommends peers because story is boring-in-a-good-way
- Leaves room to upsell to 95/5 Champion Tier

**Champion Tier (95/5 on cache hits):** volume threshold + case-study willingness + 3+ provider referrals.

**Rail-agnostic:** same ratios apply to credits, x402 USDC, future Stripe integrations. Split logic lives in ClawNet's x402 facilitator + credit settlement module.

**Scale math:** 100M calls/day, 50% cache-hit rate, $0.01 avg origin → ClawNet earns $55K/day from Soma Check alone (most from origin share; hit-layer adds $5K/day). Combined with other 4 Soma layers (Vouch listing, Identity certification, Receipt anchoring, Pay facilitation) → sustainable at scale.

Full spec: `internal/soma-check-billing.md`.

---

## Provider onboarding ladder (4 tiers)

| Tier | Provider effort | Customer impact | Revenue share (origin/hit) | Unlocks |
|---|---|---|---|---|
| **0. Shadow** | None (ClawNet proxy runs middleware) | Zero | 90/90 (same as origin) | Savings dashboard only |
| **1. Passive** | Flip flag on ClawNet side | Only opt-in clients see 304s | 90/90 | Revenue from cache hits |
| **2. Verified** | Generate Soma heart, sign responses | Invisible (header-only) | 90/90 | Soma Vouch listing + trust badge |
| **3. Champion** | Volume + referrals + case study | Invisible | 90/95 | Priority ranking + co-marketing + kickbacks |

Full spec: `internal/soma-onboarding-ladder.md`.

---

## Competitive moat — why this is defensible

1. **Protocol ownership** — Soma = stack, ClawNet = reference impl. Competitors either adopt Soma (we win) or build incompatibly (they cold-start from zero).
2. **Soma cert chain** — cryptographic provenance on every hash. Competitors can copy headers; they can't copy the identity layer.
3. **Distribution moat** — 14k+ endpoints already in ClawNet registry get hashes via certified cache layer.
4. **Rail-agnostic** — works with credits, x402, Stripe. Not locked to any payment ecosystem.
5. **5-layer flywheel** — Check → Identity → Vouch → Pay → Receipt. Each layer pulls adopters into the next.
6. **x402 alignment** — submit as x402 extension. Even if Coinbase rejects, we're "the team that proposed conditional payment to x402."

**Defensive actions:**
- Claim `soma.dev` domain + host spec there
- Ship Soma Check reference implementation first (first-mover)
- Submit extension to Linux Foundation x402 working group within 30 days
- Publish savings case study from clawapis pilot

---

## Clawapis outreach plan

Two paths — ship Path A first, don't wait on them to act.

### Path A (ClawNet-proxied, zero effort for clawapis)
1. Profile clawapis's registered endpoints for content volatility (24h probe)
2. Enable shadow mode on stable endpoints only
3. Run 14-day silent telemetry gathering
4. Export "you would have saved $X" report with anonymized agent traffic
5. Send clawapis the report → convert to Tier 1 activation

### Path B (direct clawapis integration)
After Path A proves savings, pitch: "add the middleware to clawapis.com directly for your non-ClawNet customers."

**Offer:**
- Free forever (no fees, ever)
- ClawNet writes + runs all integration
- Co-published case study with savings numbers
- First "Soma Check certified" provider badge
- Featured as reference partner in outreach to Helius, x.com

**Ask:**
- Permission to enable shadow mode on ClawNet-proxied calls (doesn't touch clawapis server)
- Permission to publish anonymized hit-rate + savings data
- Named as reference customer

**Timing:** Path A can ship immediately (no clawapis permission needed for telemetry on ClawNet's own proxy layer — already routing their traffic). Formal pitch goes out after 14-day data.

---

## Build order

**Phase 0 (docs, today):**
- Rebrand strategy doc (this file) ✓
- Write onboarding ladder + billing + header specs
- Add Soma Protocol Stack reference to groundbreaking-extensions.md

**Phase 1 (dogfood) — SHIPPED 2026-04-05 (commit `27eb8e3`):**
- ✓ Migration 147: `soma_check_events` table + 3 indexes
- ✓ `src/core/soma-check-billing.ts` — rail-agnostic split calculator
- ✓ `src/db/soma-check.ts` — telemetry logger + stats aggregation
- ✓ `GET /v1/soma/check/stats[/:endpointId]` — dashboard data
- ✓ `GET /v1/soma/demo/*` — 6 free-API reference endpoints with standard ETag + X-Soma-* headers + 304 on match
- ✓ Telemetry wired into `POST /v1/endpoints/:id/call` at all three branches
- Open: 72h shadow run on VPS, publish internal savings numbers

**Phase 2 (clawapis, next):**
- Provider-facing savings dashboard UI under `site/` (consumes `/v1/soma/check/stats`)
- Enable shadow on clawapis-registered endpoints (Path A stays proxy-side, zero provider effort)
- 14-day silent telemetry window
- Export CSV + "you would have saved $X" pitch packet
- Tier 1 (Passive) upgrade path: direct provider ETag stamping, still matches 90/10
- Add demo endpoints to `docs/architecture.md` catalog

**Phase 3 (ecosystem, parallel + after):**
- Public case study (first real provider savings numbers)
- Submit x402 spec extension / contribute to Linux Foundation x402 WG
- Outreach: Helius, x.com, next 3-5 providers
- Ship `@clawnet/soma-check` npm package (client helper: automatic ETag caching, If-None-Match on every call)
- Blog post + example repo

**Phase 4 (monetization):**
- Champion Tier activation + dashboard (95/5 upgrade)
- Agent SDK auto-injection in `@clawnet/mcp`
- Security audit of hash layer (replay windows, signature spoofing, JCS edge cases)
- Signed responses (`X-Soma-Signer` + `X-Soma-Signature`) on origin calls — ties Check to Identity layer

---

## Revenue model options (stackable)

| Model | Mechanism | Who pays |
|---|---|---|
| **Hit share** (primary) | 10% share of every cache-hit settlement | Agent (via hit price) |
| **Vouch listing** | $X/mo for premium placement | Provider |
| **Champion Tier invite** | Earned via volume/referrals, no fee | — |
| **Analytics API** | $Z/mo for hit-rate + freshness data | Provider/agent |
| **Soma Identity certification** | Per-endpoint fee for verified cert | Provider |
| **Receipt anchoring** | Gas + margin on EAS attestations | Consumer or provider |

Clawapis + first 3-5 adopters = free forever (reference customers).

---

## Decisions locked in (2026-04-05)

- **Protocol positioning:** Soma Check is a layer of Soma Protocol Stack, not a ClawNet-specific feature
- **External name:** "Soma Check" (drops "x402 ETag" — demoted to compat tagline)
- **Headers:** standard HTTP `ETag` + `If-None-Match` + `304`, plus `X-Soma-*` metadata (full spec: `soma-check-header-spec.md`)
- **Billing:** 90/10 hit split matching origin; 95/5 Champion Tier for upgrades
- **Rail abstraction:** same split math for credits + x402 USDC + Stripe
- **Rollout:** Path A (proxy-side shadow) ships first, Path B later
- **Reference customer:** clawapis free forever in exchange for case study rights
- **First wedge:** 6 free-API demo endpoints (crypto, weather, FX, GitHub, chain, news)

---

## Open questions

- [ ] Domain: `soma.dev` vs `soma-protocol.org`? Preference toward `.dev` for credibility.
- [ ] Should Soma Check probe endpoint (`/check`) remain free-public or require auth? Currently free.
- [ ] When submitting to x402 spec working group, do we fork or propose as extension? Extension first.
- [ ] Should `@clawnet/soma-check` middleware be open-source (MIT) or ClawNet-only? Open-source favored for protocol adoption.
- [ ] Cache Pioneer Bonus (first-caller rebate): v2 or never?

---

## Related docs

- `internal/soma-onboarding-ladder.md` — 4-tier provider migration spec
- `internal/soma-check-billing.md` — billing math + scale projections
- `internal/soma-check-header-spec.md` — HTTP header contract
- `internal/groundbreaking-extensions.md` — full Soma stack (Ext 9.5 Soma Vouch origin spec)
- `internal/scale-test-plan.md` — blocks identity layer, orthogonal to Soma Check
- `internal/brainstorm.md` — running log
