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

### Decided Rates — Golden Model (2026-04-06)

**Founding Era (NOW — 0% live call fee until Soma provenance ships):**

| Call type | Agent pays | Provider gets | Platform gets |
|-----------|-----------|---------------|---------------|
| **Origin (live call)** | 100% of price | **100%** | **0%** |
| **Orchestrated call** | Price + $0.002 flat | 100% of per-step price | $0.002 fee only |
| **Soma Check hit (T1-2)** | 10% of origin (flat) | 90% of hit price | 10% of hit price |
| **Soma Check hit (T3 Champion)** | 10% of origin (flat) | 95% of hit price | 5% of hit price |
| **Soma Check hit (T0 Shadow)** | $0 (free) | $0 | $0 |
| **L1/L2 cache hit** | 10% of live (min 0.1cr) | **90%** | **10%** |
| **Skill marketplace** | Skill price | **90%** | **10%** |

**Post-Provenance (when Soma Heart + birth certs are production-proven):**

| Call type | Agent pays | Provider gets | Platform gets |
|-----------|-----------|---------------|---------------|
| **Origin (live call)** | 100% of price | **90%** | **10%** |
| All other paths | Unchanged | Unchanged | Unchanged |

### Cache Hit Economics: Why 90/10 (Decided)

Cache hits charge agents 10% of live price. That 10% is split **90/10** — same as every other path.

**Why 90/10 (not 50/50):**
- Consistency: "ClawNet takes 10%. Always. Everywhere." One rule, zero confusion.
- Provider earns 90% of cache passive income — stronger enrollment hook than 50%.
- At scale, 10% of massive cache volume covers infrastructure easily.
- No perverse incentives: ClawNet earns same % from cache and live calls.
- Providers are more incentivized to optimize caching (higher earnings per hit).
- "Earn money while your server sleeps" — 90% is a much better pitch than 50%.

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

## 5. Dynamic Pricing

### Staleness-Based Hit Pricing — DEFERRED

Stripped to flat 10% for simplicity. The 5-15% range on typical endpoints was fractions of a penny.
`dynamicHitPriceRatio()` exists in `soma-check-billing.ts` but returns flat 10%.
See `internal/future-pricing-ideas.md` for when to revisit.

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
| Cache hit split (50/50) | Transaction | **Now** |
| Soma Check platform cut (10%) | Transaction | **Now** |
| Orchestration fee ($0.002 flat) | Transaction | **Now** |
| Volume discount spread | Float | **Now** |
| Buy/sell spread (15%) | Float | **Now** |
| Skill marketplace (10%) | Transaction | **Now** |
| Origin call take rate (10%) | Transaction | **Post-provenance** |
| Premium trust (PQ, compliance, SLA) | Subscription | Q3 2026 |
| $CLAWNET staking + burn mechanics | Token economics | At revenue milestone |

---

## Related Docs

- `internal/golden-plan.md` — master strategic vision
- `internal/tier-system.md` — unified agent + provider tiers
- `internal/token-architecture.md` — $CLAWNET design
- `internal/soma-check-billing.md` — per-call billing math (specific to Soma Check)
- `docs/billing.md` — public billing documentation
