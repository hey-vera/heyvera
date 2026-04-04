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
- **Revenue split (providers):** 90% provider / 10% platform on live calls; 0% provider on cache hits (server not touched)
- **Revenue split (registry endpoints):** 100% platform (~33% margin via COST_MARKUP_FACTOR)
- **Deduction guard:** `WHERE credits >= amount` + DB trigger
- **Delegated billing:** auth resolves child→parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` across 20+ billing sites
