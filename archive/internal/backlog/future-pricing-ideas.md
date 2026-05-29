# Future Pricing Ideas

Ideas for dynamic pricing that could be added once we have real usage data.
None of these are active — current model is flat 10% on all Soma Check hits.

---

## Dynamic Soma Check Hit Pricing (Staleness-Aware)

**Concept:** Adjust the 10% hit price based on how old the cached data is relative to its TTL.

| Data Age | Rate | Rationale |
|----------|------|-----------|
| Fresh (<20% TTL) | 15% | Near-live quality, high confidence — worth more |
| Mid (20-70% TTL) | 10% | Standard rate |
| Stale (>70% TTL) | 5% | Data aging, less certainty — worth less to agent |

**Why deferred:** The 5-15% range on a 2-credit endpoint is 0.10-0.30 credits — fractions of a penny. Not worth the complexity for first provider onboarding. Simplicity wins.

**When to revisit:** When a provider asks "why am I getting the same rate for stale data as fresh?" or when we have data showing agents behave differently based on data age.

**Implementation note:** `dynamicHitPriceRatio()` exists in `soma-check-billing.ts` but is no longer called. Can be re-wired if needed.

---

## Volume-Based Soma Check Discounts

**Concept:** Agents making 100K+ ETag checks/month get a lower hit rate (8% instead of 10%).

| Monthly Hits | Rate |
|-------------|------|
| < 10K | 10% |
| 10K-100K | 9% |
| 100K-1M | 8% |
| 1M+ | 7% |

**Why deferred:** No volume to discount yet. Dynamic pricing engine (`dynamicCreditCost`) already handles volume discounts on live calls — could extend to ETag path.

---

## Provider Confidence Scoring

**Concept:** Endpoints with higher uptime and lower data volatility get a premium on Soma Check hits (agents pay more because the verification is more trustworthy).

**Why deferred:** Requires months of provider data to compute meaningful confidence scores.

---

## Token-Adjusted ETag Splits

**Concept:** $CLAWNET stakers get better ETag splits (like live call fee reduction).

| Staked | ETag Split |
|--------|-----------|
| 0 | 90/10 (provider/platform) |
| 10K | 92/8 |
| 50K | 95/5 |
| 100K+ | 97/3 |

**Why deferred:** Token doesn't exist yet. Architecture supports this — `cacheHitProviderShareByTier()` is the injection point.

---

## Time-of-Day Pricing

**Concept:** Off-peak Soma Check hits cost less (incentivize spreading load).

**Why deferred:** Single VPS, no load concerns yet. `dynamicCreditCost()` already has off-peak logic for live calls.

---

## Competitive Response Levers

If a competitor offers cheaper ETag-like checks:
- Drop hit price from 10% to 7% (still profitable at scale)
- Increase provider share from 90% to 95% (match T3 for everyone)
- Bundle: first 1K ETag checks/month free (try before you pay)
- Moat: ClawNet ETags are Soma-verified (proof chain) — competitors can't match without building the same infra

---

## Cache Hit Tiered Pricing

Currently cache hits are flat 50/50. Future options:
- High-demand endpoints: 60/40 platform (platform does more work warming/serving)
- Low-demand endpoints: 40/60 provider (incentivize listing niche APIs)
- Auto-adjust based on cache hit rate (high hit rate = more platform value)

**Why deferred:** 50/50 is simple and fair. Adjust when a provider complains or data justifies it.
