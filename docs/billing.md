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
- **Revenue split (skills):** 85% creator / 15% platform (uses `round6()`, not `Math.floor()`)
- **Revenue split (providers, tiered):**
  - Open: 0% fee — 100% provider on live calls, no cache revenue
  - Standard: 5% fee — 95% provider on live, 50% of cache revenue (pure profit)
  - Verified: 10% fee — 90% provider on live, 50% of cache revenue + cache warming + priority
- **Revenue split (registry endpoints):** 100% platform (~33% margin via COST_MARKUP_FACTOR)
- **Cache economics:** Cache hits cost agents 10% of live price. Provider gets 50% of that (pure profit — their server untouched). Platform keeps 50%. `creditProviderShare()` handles both paths.
- **Deduction guard:** `WHERE credits >= amount` + DB trigger
- **Delegated billing:** auth resolves child→parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` across 20+ billing sites
