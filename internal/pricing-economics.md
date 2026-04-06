# Pricing & Economics — The Professional Model

**Status:** canonical pricing decisions. Supersedes ad-hoc pricing in other docs where conflicts exist.
**Written:** 2026-04-05.
**Research basis:** denomination effect (Raghubir & Srivastava, 2009), Metronome 2025 field research, Gurley "A Rake Too Far," a16z marketplace metrics, CDN pricing analysis (Cloudflare, AWS, Fastly), OpenAI cached token pricing.

---

## 1. Credit Denomination: Kill the Game Currency

### Problem

Current: 1 credit = $0.001. Users accumulate millions of credits. This feels like a casino.

Research findings:
- 78% of developers reject tools with unclear pricing (Stack Overflow 2023)
- 67% abandon tools after discovering hidden costs (DevGraph 2022)
- V-Bucks ($0.01 each) and Robux ($0.0125 each) deliberately use non-round exchange rates to prevent mental conversion back to dollars — this is the OPPOSITE of B2B trust
- "Our finance team likes credits. Our customers don't know what a credit does." (Metronome 2025)
- "In 2025 the pendulum swung toward credits, in 2026 it'll swing back toward simplicity" (Ibbaka)

### Decision: Display in USD, Keep Credits as Plumbing

| Current (gambling feel) | Proposed (professional) |
|------------------------|----------------------|
| "Balance: 47,500 credits" | "Balance: $47.50" |
| "This call costs 1.5 credits" | "This call costs $0.0015" |
| "Buy 5,000 credits for $5" | "Add $5 to your balance" |
| "Provider earned 90,000 credits" | "Provider earned $90.00" |

**Implementation:** Frontend/display change only. Every API response and dashboard multiplies `credits * $0.001` before displaying. Internal credit accounting unchanged. All DB columns stay as credit amounts. `round6()` still operates on credits.

**Precedent:** Twilio doesn't sell "credits" — you add "$20 to your account" and each SMS costs "$0.0079." Stripe shows dollars, not "Stripe points."

---

## 2. Take Rates

### Evidence

| Platform | Take Rate | Status |
|----------|-----------|--------|
| RapidAPI | 25% | Dead (sold to Nokia, 82% layoff) |
| AgenticTrade | 10% (6% premium) | Active |
| OpenAI ACP | 4% | Growing |
| AWS Marketplace | 3-5% | Stable |
| Stripe | 2.9% + $0.30 | Dominant |
| Booking.com | 10% | Won by undercutting 30% competitors |

**Gurley's research:** Optimal take rate is almost always LOWER than what maximizes short-term revenue. Booking.com at 10% destroyed competitors at 30%. oDesk cut from 30% to 10% and became market leader.

### Decided Rates

| Call type | Agent pays | Provider gets | Platform gets |
|-----------|-----------|---------------|---------------|
| **Origin (live call)** | 100% of price | 90% | **10%** |
| **Orchestrated call** | Price + $0.002 flat | 90% of price | 10% of price + $0.002 |
| **Soma Check hit (T1-2)** | 5-15% of origin (staleness-based) | 95% of hit price | 5% of hit price |
| **Soma Check hit (T3 Champion)** | 5-15% of origin (staleness-based) | 97% of hit price | 3% of hit price |
| **Soma Check hit (T0 Shadow)** | $0 (free) | $0 | $0 |
| **L1/L2 cache hit (transparent)** | Full price | 90% | 10% |

### Cache Hit Economics: Why 95/5 (or 0% Platform)

**Two options under consideration:**

**Option A (95/5):** Platform takes 5% of cache hit revenue.
- Pro: Small but meaningful revenue at scale ($2.5K/day at 100M calls)
- Pro: Funds cache infrastructure
- Con: Gives providers a reason to consider going direct

**Option B (0% platform):** Provider keeps 100% of cache hits. Platform gets $0.
- Pro: Eliminates ALL incentive for providers to leave
- Pro: Aligns with CDN industry (Cloudflare doesn't charge for cache bandwidth)
- Pro: OpenAI gives 50-90% discount on cached tokens — caching should be cheaper
- Con: ~$5K/day less revenue at 100M calls/day scale
- Con: Platform incentive misalignment (we'd profit from lower cache hit rates)

**Current leaning: Option A (95/5) with path to Option B as scale proves viable.** Start generous, get more generous. Never raise the take on cache hits.

**CDN industry evidence:** Major CDNs do NOT charge differently for cache hits vs misses. Cloudflare bundles bandwidth into flat-rate plans. The developer-beloved model is "caching makes things cheaper, not more expensive."

### Volume Paradox (preserved from soma-check-billing.md)

Without Soma Check: agent polls 10x/hour at $0.01 = $0.10/hour, provider earns $0.09.
With Soma Check: agent polls 50x/hour (10 origin + 40 hits):
- Provider total: $0.126/hour (+40% vs baseline)
- Agent spend: $0.14/hour (+40% but got 5x more polls)
- ClawNet: $0.014/hour (+180%)

**Cache hits are NET NEW revenue, not a tax.** This is the pitch.

---

## 3. Volume Pricing (Cleaned Up)

| Deposit | Bonus | Effective rate |
|---------|-------|----------------|
| $5 | 0% | $0.001/unit |
| $25 | 5% | $0.00095/unit |
| $100 | 10% | $0.00091/unit |
| $500 | 20% | $0.00083/unit |
| $2,000 | 30% | $0.00077/unit |
| USDC (any amount) | 7% | $0.00093/unit |

Fewer tiers than current. Cleaner math. Dashboard always shows dollar balance.

---

## 4. Provider Payouts

| Rail | Rate | Frequency |
|------|------|-----------|
| USDC (Base/Solana) | $0.00085/unit (15% below buy) | Every 4 hours |
| x402 Direct | 1:1 (no conversion) | Instant on-chain |

**Change from current:** Reduced buy/sell spread from 25% to 15%. The 25% felt like a hidden tax. 15% covers operational costs while feeling fair. Can compress further at scale.

---

## 5. Dynamic Pricing (Already Built)

### Staleness-Based Hit Pricing

| Data freshness | Hit price (% of origin) |
|----------------|------------------------|
| Fresh (< 20% TTL elapsed) | 5% |
| Mid (20-70% elapsed) | 10% |
| Stale (> 70% elapsed) | 15% |

Implemented in `src/core/soma-check-billing.ts:dynamicHitPriceRatio()`.

### Adaptive TTL

Already wired in `src/cache/adaptive-ttl.ts`. Auto-tunes from observed hash volatility:
- Very stable (<10% changes): 2.5x TTL multiplier
- Stable (10-30%): 1.5x
- Normal (30-50%): 1.0x
- Volatile (50-70%): 0.5x
- Very volatile (>70%): 0.25x

---

## 6. Future: $CLAWNET Token Integration

See `internal/token-architecture.md` for full design.

**Key pricing implication:** When $CLAWNET launches, users can burn tokens to get credits at 10-15% discount vs Stripe/USDC. This creates a third price tier:
- Stripe: base rate ($0.001/unit)
- USDC: 7% bonus ($0.00093/unit)
- $CLAWNET burn: 15% bonus ($0.00085/unit) — cheapest path

Token staking also provides tier benefits (fee discounts, rate limit upgrades). See `internal/tier-system.md`.

---

## 7. Revenue Model Summary

| Source | Type | When |
|--------|------|------|
| Origin call take rate (10%) | Transaction | Now |
| Orchestration fee ($0.002 flat) | Transaction | Now |
| Volume discount spread | Float | Now |
| Buy/sell spread (15%) | Float | Now |
| Premium trust (PQ, compliance, SLA) | Subscription | Q3 2026 |
| Demand signals & analytics | Subscription | Q3 2026 |
| Enterprise features | Contract | Q4 2026 |
| $CLAWNET buy-and-burn (25% of revenue) | Token economics | At revenue milestone |

---

## Related Docs

- `internal/golden-plan.md` — master strategic vision
- `internal/tier-system.md` — unified agent + provider tiers
- `internal/token-architecture.md` — $CLAWNET design
- `internal/soma-check-billing.md` — per-call billing math (specific to Soma Check)
- `docs/billing.md` — public billing documentation
