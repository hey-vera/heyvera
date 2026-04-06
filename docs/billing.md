# Billing & Credit Math

Reference: `src/core/credits.ts`

## Functions

```typescript
round6(n)                        // ALWAYS use — prevents floating-point drift
creditCostForEndpoint(ep)        // Explicit creditCost OR round6(max(0.001, cost * 1500))
creditsForExecution(steps, lookup) // Sum of live step costs (0 for cached/failed)
x402SurchargeCredits(usdAmount)  // 1:1 cost recovery → credited to clawhub-treasury
cacheCreditCost(liveCost)        // round6(max(0.1, liveCost * 0.10))
dynamicCreditCost(...)           // Surge (up to 5x) + volume discounts + off-peak
```

## Rates & Splits

- **Credit rate:** CREDITS_PER_USD=1000 → $0.001/credit, fractional supported (min 0.001)
- **Revenue split (skills):** 90% creator / 10% platform (uses `round6()`, not `Math.floor()`)
- **Revenue split (registry endpoints):** 100% platform (~33% margin via COST_MARKUP_FACTOR)
- **Deduction guard:** `WHERE credits >= amount` + DB trigger
- **Delegated billing:** auth resolves child→parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` across 20+ billing sites

## Provider Fee Model: "Earn the Fee Before You Charge It"

ClawNet's cut matches the infrastructure it provides. No flat tax — each path is justified.

### Phase 1 — Founding Era (NOW)

| Path | Agent Pays | Platform Cut | Provider Gets | Justification |
|------|-----------|-------------|--------------|---------------|
| **Live call** | Full price | **0%** | 100% | No provenance yet → no fee. Earn trust first. |
| **Cache hit** | 10% of live | **10%** | 90% | 10% rule — consistent across all paths. |
| **Soma Check (ETag)** | 10% of live (flat) | **10%** | 90% | ClawNet runs hash verification + proof chain. |
| **Orchestration** | +2 credits | **100%** | n/a | LLM endpoint selection — pure platform service. |

**Why cache 90/10:** Same 10% rule as everywhere else. Maximum transparency. Provider earns passive income while their server sleeps. ClawNet's 10% covers cache infrastructure (L1/L2/Redis/warming).

**Why Soma Check 90/10:** Provider earns 90% of a revenue stream that doesn't exist without ClawNet's verification infra. The 10% platform cut is on an already-discounted price (10% of live).

### Phase 2 — When Soma Provenance Ships → 10% Live Call Fee

| Path | Agent Pays | Platform Cut | Provider Gets | Justification |
|------|-----------|-------------|--------------|---------------|
| **Live call** | Full price | **10%** | 90% | Birth certs, PQ signatures, trust scoring, independent verification. |
| **Cache hit** | 10% of live | **10%** | 90% | Unchanged — same 10% rule. |
| **Soma Check** | 10% of live (flat) | **10%** | 90% | Unchanged — same verification. |

10% is half what RapidAPI charges (25%), competitive with OpenRouter (5.5%), and justified by cryptographic provenance no competitor offers.

### Phase 3 — Token Staking Reduces Fee

| $CLAWNET Staked | Live Call Fee |
|-----------------|--------------|
| 0               | 10%          |
| 10,000          | 8%           |
| 50,000          | 6%           |
| 100,000         | 4%           |
| 500,000         | 3%           |

### Cache Economics (All Phases)

Cache hits cost agents 10% of live price (flat rate, minimum 0.1 credits).
Soma Check hits also cost 10% of live price (flat). Dynamic staleness-aware pricing
is deferred — see `internal/future-pricing-ideas.md` for when to revisit.

`cacheCreditCost()` computes the cache base. `computeSomaCheckSplit()` handles Soma Check billing.
`creditProviderShare()` handles both live and cache paths.

### Soma Check Tiers (Independent of Fee Tiers)

| Tier | Name | Provider Share | Ranking Boost | Status |
|------|------|---------------|---------------|--------|
| T0 | Shadow | n/a (free) | 1.00x | Active — telemetry + projections |
| T1 | Active | 90% | 1.15x | Active — billing on hash match |
| T2 | Verified | 90% | 1.25x | Manual — identity verification planned |
| T3 | Champion | 95% | 1.30x | Manual — volume + referral criteria planned |

Soma Check is a core feature for ALL providers, not premium/gated. Every provider starts at T0 (shadow) automatically.
