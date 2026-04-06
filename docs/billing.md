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
| **Cache hit** | 10% of live | **50%** | 50% | ClawNet serves 100% of infra. Provider's server untouched. |
| **Soma Check (ETag)** | 5-15% of live | **10%** | 90% | ClawNet runs hash verification + proof chain. |
| **Orchestration** | +2 credits | **100%** | n/a | LLM endpoint selection — pure platform service. |

**Why cache 50/50:** Provider contributed $0 of infrastructure to serve cached responses. Cache revenue is purely additive — without ClawNet, provider earns $0 from cache. 50% of something > 100% of nothing.

**Why Soma Check 90/10:** Provider earns 90% of a revenue stream that doesn't exist without ClawNet's verification infra. The 10% platform cut is on an already-discounted price (5-15% of live).

### Phase 2 — When Soma Provenance Ships → 10% Live Call Fee

| Path | Agent Pays | Platform Cut | Provider Gets | Justification |
|------|-----------|-------------|--------------|---------------|
| **Live call** | Full price | **10%** | 90% | Birth certs, PQ signatures, trust scoring, independent verification. |
| **Cache hit** | 10% of live | **50%** | 50% | Unchanged — same infrastructure. |
| **Soma Check** | 5-15% of live | **10%** | 90% | Unchanged — same verification. |

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

Cache hits cost agents 10% of live price. Dynamic staleness pricing adjusts:
- Fresh (<20% TTL): 5% of origin — agent gets near-live data cheap
- Mid (20-70%): 10% of origin — standard rate
- Stale (>70%): 15% of origin — data aging, less certainty

`cacheCreditCost()` computes the base; `dynamicHitPriceRatio()` adjusts by staleness.
`creditProviderShare()` handles both live and cache paths. Soma Check uses `computeSomaCheckSplit()`.

### Soma Check Tiers (Independent of Fee Tiers)

| Tier | Name | Provider Share | Ranking Boost | Status |
|------|------|---------------|---------------|--------|
| T0 | Shadow | n/a (free) | 1.00x | Active — telemetry + projections |
| T1 | Active | 90% | 1.15x | Active — billing on hash match |
| T2 | Verified | 90% | 1.25x | Manual — identity verification planned |
| T3 | Champion | 95% | 1.30x | Manual — volume + referral criteria planned |

Soma Check is a core feature for ALL providers, not premium/gated. Every provider starts at T0 (shadow) automatically.
