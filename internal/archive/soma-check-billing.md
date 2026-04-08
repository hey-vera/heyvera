> **ARCHIVED** — Superseded on 2026-04-08
> **Outcome:** Doc describes 90/10 provider/platform split, but code now gives 100% to provider (`cacheHitProviderShareByTier() => 1.0`). ClawNet takes $0 from Soma Check — revenue comes only from trust queries. Scale projections for Soma Check volume are still directionally useful.
> **See instead:** `active/revenue-architecture.md`, `src/core/soma-check-billing.ts` (code is truth)

# Soma Check — Billing Model + Scale Projections

**Status:** canonical billing spec for Soma Check.
**Written 2026-04-05.** Referenced from `soma-check-strategy.md` and `soma-onboarding-ladder.md`.

---

## The rule (one sentence)

**Cache hit price = 10% of origin price, split 90/10 (provider/ClawNet) at Tiers 0-2, 95/5 at Tier 3 (Champion).**

---

## Per-call math

Let `P` = origin list price (in credits or USDC).

| Call type | Agent pays | Provider gets | ClawNet gets |
|---|---|---|---|
| Origin (cache miss) | `P` | `0.9 × P` | `0.1 × P` |
| Cache hit, Tier 0-2 | `0.1 × P` | `0.09 × P` | `0.01 × P` |
| Cache hit, Tier 3 (Champion) | `0.1 × P` | `0.095 × P` | `0.005 × P` |

**Example: 10-credit endpoint**

| Call type | Agent | Provider | ClawNet |
|---|---|---|---|
| Origin | 10 | 9.0 | 1.0 |
| Cache hit (Tier 1-2) | 1 | 0.9 | 0.1 |
| Cache hit (Tier 3) | 1 | 0.95 | 0.05 |

**Example: $0.01 x402 USDC endpoint** (same ratios, different currency)

| Call type | Agent | Provider | ClawNet |
|---|---|---|---|
| Origin | $0.01 | $0.009 | $0.001 |
| Cache hit (Tier 1-2) | $0.001 | $0.0009 | $0.0001 |
| Cache hit (Tier 3) | $0.001 | $0.00095 | $0.00005 |

---

## Rail abstraction

Same ratios apply to every payment rail. Settlement differs:

| Rail | Where split happens | Settlement code |
|---|---|---|
| ClawNet credits | `deductCredit()` + `creditProviderShare()` | existing billing module |
| x402 USDC | `src/routes/x402-facilitator.ts` on settle | add hit-price detection |
| Stripe (future) | Stripe Connect transfers | TBD |

**Constraint:** split logic must be isolated into one function (`computeSomaCheckSplit(origin_price, tier, is_hit) → { agent, provider, platform }`) that all rails call.

---

## Why 90/10 matching origin (not 50/50 or 80/20)

Rejected alternatives:

| Option | Provider share of hit | Why rejected |
|---|---|---|
| 50/50 | 5% of origin | Provider sees share DROP vs origin → trust damage |
| 80/20 | 8% of origin | Better, but still asymmetric with origin split |
| 100/0 | 10% of origin | Platform earns nothing → can't fund hash infra |
| **90/10** | **9% of origin** | **Matches origin — no asymmetry, no trust damage** |

**The evangelism test:** how does a provider pitch this to peers?

| Option | Provider's elevator pitch |
|---|---|
| 50/50 | "I get something for nothing" (weak) |
| 80/20 | "My margin went UP on hits" (good but confusing) |
| **90/10** | **"My rev share never changes — origin or hit, I always keep 90%"** (strong, simple) |
| 95/5 (Champion) | "Champion tier gives me MORE than origin share" (viral) |

**Winner:** 90/10 is boring-in-a-good-way. Boring = trustworthy. Champion Tier upgrade to 95/5 creates aspirational headroom.

---

## Scale projections

**Assumptions:** $0.01 avg origin price, 50% cache-hit rate.

### Per 1M calls/day (500K origin + 500K hits)

| Flow | Volume | Provider earns | ClawNet earns |
|---|---|---|---|
| Origin calls | 500K × $0.01 = $5,000 | $4,500 | $500 |
| Cache hits (Tier 1-2) | 500K × $0.001 = $500 | $450 | $50 |
| **Daily total** | — | **$4,950** | **$550** |

### Per 100M calls/day (same split)

| Flow | Volume | Provider earns | ClawNet earns |
|---|---|---|---|
| Origin calls | 50M × $0.01 = $500,000 | $450,000 | $50,000 |
| Cache hits (Tier 1-2) | 50M × $0.001 = $50,000 | $45,000 | $5,000 |
| **Daily total** | — | **$495,000** | **$55,000** |

### At 1B calls/day (future AI-agent economy)

ClawNet from Soma Check alone: **$550,000/day** (~$200M/year).

**Important:** this is ONLY the Soma Check layer. Revenue from other 4 Soma layers (Vouch listings, Identity certification, Receipt anchoring, Pay facilitation fees) stacks on top.

---

## The volume paradox (why providers earn MORE with Soma Check)

Without Soma Check, an agent polling 10×/hour at $0.01 = $0.10/hour, provider earns $0.09/hour.

With Soma Check, same agent polls 50×/hour (because hits are cheap): 10 origin + 40 hits.
- Origin revenue: $0.10, provider gets $0.09
- Hit revenue: $0.04, provider gets $0.036
- **Provider total: $0.126/hour (+40% vs baseline)**
- Agent spend: $0.14/hour (+40% but got 5× more polls → better freshness per dollar)
- ClawNet: $0.014/hour (+180% vs baseline)

**Everyone wins because polling economics change.** Cheap hits make agents poll more often → more origin calls overall (even as % drops) → provider revenue climbs.

---

## Champion Tier qualification

Criteria (ALL required):
- Volume: ≥100K Soma Check calls/month on this provider's endpoints
- Referrals: ≥3 other providers onboarded at Tier 1+ via this provider's introduction
- Case study: published with savings numbers + provider quote
- Tenure: ≥90 days at Tier 2

Benefits:
- 95/5 split on cache hits (provider gets 9.5% of origin vs 9%)
- Referral kickback: 5% of first-year Soma Check revenue from providers they referred
- Top-3 placement in Soma Vouch for their category
- Co-branded content on soma.dev
- Early access to Soma layer releases (Vouch, Receipts, etc.)

Revocation: Champion status drops to Tier 2 if volume falls below 50K/month for 2 consecutive months. No penalty beyond the tier change.

---

## Cache Pioneer Bonus (v2, not v1)

**Concept:** first agent to populate a cache in a TTL window gets small rebate on their origin call from subsequent hits.

**Example:** agent A calls origin (pays 10), populating cache. Agents B, C, D each hit cache within TTL (pay 1 each). Agent A gets 1% × 3 = 0.3 credits rebate.

**Why deferred:** adds complexity to settlement. Prove v1 works first, then introduce if data shows cache-warming concentration among few agents.

**Trigger to revisit:** if top 10% of agents account for >50% of cache populations, Pioneer Bonus becomes fair redistribution.

---

## Implementation checklist (for code)

- [ ] `computeSomaCheckSplit(origin_price, tier, is_hit)` helper function in `src/core/billing/soma-check.ts`
- [ ] All settlement paths (credits, x402) call this helper — no duplicated math
- [ ] Tier stored on `providers` table (default: 0)
- [ ] Cache hit events logged to `soma_check_events` table for telemetry
- [ ] Champion Tier qualification check runs as daily cron
- [ ] Auto-demote from Champion if volume drops (cron)
- [ ] Admin override for manual tier changes

---

## Open decisions

- [ ] Should Tier 0 shadow mode be opt-OUT (auto-enrolled) or opt-IN (provider explicitly agrees)? Leaning auto-enrolled since no billing/response impact.
- [ ] Referral tracking: via unique promo codes or inferred from dashboard clicks?
- [ ] Champion kickback: 5% for year 1 only, or renewing annually?
- [ ] Should agents see their own cache-hit stats (transparency) or only dashboard-level aggregates?

---

## Related docs

- `internal/soma-check-strategy.md` — overall strategy
- `internal/soma-onboarding-ladder.md` — tier descriptions
- `internal/soma-check-header-spec.md` — HTTP contract
- `docs/billing.md` — ClawNet's existing billing module (where splits integrate)
