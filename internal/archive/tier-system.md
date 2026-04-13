> **ARCHIVED** — Partially superseded on 2026-04-08
> **Outcome:** Shadow tier removed, revenue model changed to free routing. The earned-not-bought tier philosophy and agent tier design (spend-based rate limits) are still directionally valid. Provider tiers need rethinking now that routing is free and revenue comes from trust queries.
> **See instead:** `active/revenue-architecture.md`, `active/founding-protocol.md`

# Tier System — Unified Agent + Provider Tiers

**Status:** proposed redesign. Current code has three overlapping tier systems. This doc unifies them into two clean ladders.
**Written:** 2026-04-05.

---

## Problem: Three Confusing Systems

Current state (in code):

1. **Agent tiers** (lifetime spend -> rate limits): Free / Active / Power / Enterprise
2. **Provider registration tiers** (unclear assignment): Open / Standard / Verified
3. **Provider Soma Check tiers** (earned metrics): Tier 0 / 1 / 2 / 3

This is confusing. Providers navigate two separate ladders. Agents have rate limit tiers AND trust-gated discounts AND a subscription option.

---

## Design Principle

**Tiers are earned, not bought.**

Research confirms: subscription-gated tiers create churn and resentment. Earned tiers based on usage metrics reward real engagement and map cleanly to future token staking (stake = commitment signal, same as spend).

---

## 1. Agent Tiers (Simplified)

| Tier | How You Earn It | Rate Limit | Discount | Future: $CLAWNET Stake Alternative |
|------|----------------|------------|----------|-------------------------------------|
| **Starter** | Sign up | 30/min | 0% | -- |
| **Builder** | $25+ lifetime spend | 60/min | 5% | OR stake 500 $CLAWNET |
| **Pro** | $250+ lifetime spend | 150/min | 10% | OR stake 5,000 $CLAWNET |
| **Scale** | $2,500+ lifetime spend | 500/min | 15% | OR stake 25,000 $CLAWNET |
| **Enterprise** | Custom contract | Custom | Custom | OR stake 100,000 $CLAWNET |

### Key Decisions

- **No monthly subscription for tier access.** The $29/mo credit pack can still exist as a convenience product (auto-top-up), but it does NOT determine tier. Tier is based on cumulative spend.
- **Lifetime spend, not subscription:** rewards real engagement, no churn/billing complexity, one-time purchasers aren't penalized.
- **Token staking is additive:** when $CLAWNET launches, staking provides an ALTERNATIVE path to the same tier benefits. It doesn't replace spend-based progression.
- **Tier check function:** `getEffectiveTier(agentId)` checks spend-based tier first, then (future) token stake tier, returns the HIGHER of the two.

### Trust-Gated Discounts (Preserved)

Separate from tier system. AID trust score provides additional discounts:

| Trust Score | Discount | Settlement |
|-------------|----------|------------|
| 90+ | 30% | Deferred |
| 80-89 | 25% | Batched |
| 60-79 | 20% | Batched |
| 40-59 | 10% | Standard |
| 0-39 | 0% | Immediate |

These stack with tier discounts but are separate. Trust is earned through interaction history, not spend.

---

## 2. Provider Tiers (Unified — Merge Two Systems Into One)

Current: providers have BOTH a registration tier (Open/Standard/Verified) AND a Soma Check tier (0/1/2/3). Merge into one ladder:

| Tier | How You Earn It | Platform Fee (Live) | Cache Hit Split | Trust Badge |
|------|----------------|--------------------|-----------------| ------------|
| **Listed** | Submit endpoints | 10% | No cache revenue | None |
| **Active** | Opt into Soma Check (flag flip), >=25% hit rate | 10% live, 5% cache | 95/5 provider/platform | "Soma Check" |
| **Verified** | Generate Soma Heart + identity verification | 8% live, 5% cache | 95/5 | "Soma Verified" |
| **Champion** | 100K calls/mo + 3 referrals + case study + 90d at Verified | 5% live, 3% cache | 97/3 | "Champion" + co-marketing |

### Key Decisions

- **One ladder, not two.** Providers understand one progression path.
- **Platform fee DECREASES as you prove value.** Gurley: reward supply-side loyalty. The more a provider contributes, the less they pay.
- **Progression is one-way up, earned not bought.** Can't buy Champion -- must demonstrate volume, quality, and community.
- **Revocation:** Champion drops to Verified if volume falls below 50K/month for 2 consecutive months. No other penalties.

### Future: $CLAWNET Stake Bonus

When token launches, staking provides ADDITIONAL benefit at any tier:
- Stake X $CLAWNET -> reduce platform fee by 2% at current tier
- Example: Active at 10% -> 8% with stake
- This is additive, not replacement. You still earn your tier through metrics.
- **Legally safe:** SEC's March 2026 "digital tools" category covers staking for functional benefits (fee discounts, access). No yield, no profit distribution.

### Champion Tier Qualification (unchanged from soma-check-billing.md)

ALL required:
- Volume: >=100K Soma Check calls/month
- Referrals: >=3 other providers onboarded at Tier 1+ via introduction
- Case study: published with savings numbers + provider quote
- Tenure: >=90 days at Verified tier

Benefits:
- 97/3 split on cache hits (5% live platform fee)
- Referral kickback: 5% of first-year Soma Check revenue from referred providers
- Top-3 placement in Soma Vouch for their category
- Co-branded content on soma.dev
- Early access to new Soma layer releases

---

## 3. Migration Path (Current Code -> New System)

### Agent Tiers

| Current | Maps To |
|---------|---------|
| Free ($0, 30/min) | Starter |
| Active ($20+, 60/min) | Builder (threshold moves from $20 to $25) |
| Power ($100+, 120/min) | Pro (threshold moves from $100 to $250, rate limit from 120 to 150) |
| Enterprise ($500+, 300/min) | Scale (threshold moves from $500 to $2,500, rate limit from 300 to 500) |

Existing users: grandfather at their current tier. No downgrades.

### Provider Tiers

| Current Registration | Current Soma Check | Maps To |
|---------------------|-------------------|---------|
| Open (0% fee) | Tier 0 (Shadow) | Listed |
| Standard (5% fee) | Tier 1 (Passive) | Active |
| Verified (10% fee) | Tier 2 (Verified) | Verified |
| -- | Tier 3 (Champion) | Champion |

**Key change:** Provider registration tier and Soma Check tier collapse into one. No more dual-tracking.

---

## 4. Implementation Notes

### Database Changes Needed

```sql
-- Agent tiers: rename rateTier() thresholds
-- Provider tiers: add unified tier column, deprecate separate soma_check_tier + registration tier
ALTER TABLE providers ADD COLUMN tier TEXT NOT NULL DEFAULT 'listed';
-- tier values: 'listed', 'active', 'verified', 'champion'
-- Migrate: map existing tier combinations to new unified tier
```

### Code Changes Needed

1. `src/config/index.ts:rateTier()` — update thresholds to new values
2. `src/db/providers.ts` — add unified `tier` column, migration to consolidate
3. `src/core/soma-check-billing.ts` — update `cacheHitProviderShareByTier()` to use new tier names
4. `src/routes/providers.ts` — update registration to use new tier system
5. Dashboard — display new tier names

### NOT changing:
- Internal credit accounting (stays as-is)
- Soma Check billing math (formula unchanged, just tier inputs different)
- Delegation system (unaffected by tier changes)

---

## Related Docs

- `internal/golden-plan.md` — master strategic vision
- `internal/pricing-economics.md` — take rates and volume pricing
- `internal/token-architecture.md` — $CLAWNET staking integration
- `internal/soma-onboarding-ladder.md` — detailed provider onboarding flow (update to match new tiers)
- `internal/soma-check-billing.md` — billing math per tier
