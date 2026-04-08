# $CLAWNET Token Architecture

**Status:** design doc. Token NOT launched. This captures the architecture so nothing is lost and the credit system is built token-ready.
**Written:** 2026-04-05.
**Research basis:** Helium (HNT) BME model, Akash (AKT/ACT) BME, Render (RNDR), SEC March 2026 token taxonomy, a16z token launch framework, Binance/MakerDAO burn mechanics.

---

## 0. Timing

**Launch AFTER product-market fit.** a16z's framework: 85% of 2025 tokens launched before PMF trade below launch price.

**Trigger:** $50-100K monthly platform revenue (from `project_token_economics` memory). The revenue milestone ensures the burn mechanism has real fuel from day one.

**Pre-launch checklist:**
- [ ] Proven revenue stream (consistent monthly platform fees)
- [ ] Clean, auditable revenue accounting (`getRevenueBreakdown()` already exists)
- [ ] Smart contract audited and deployed
- [ ] 6+ months of operating history
- [ ] Community of active agents + providers (not just speculators)
- [ ] Legal opinion on "digital tools" classification

---

## 1. Model: Burn-and-Mint Equilibrium (BME)

The winning model for infrastructure tokens. Used by:
- **Helium (HNT):** 100% of mobile subscriber revenue -> HNT buyback and burn. Achieved net deflation Q4 2025 (burns > emissions). 500K+ subscribers, $2.3M/month.
- **Akash (AKT):** Users burn AKT -> mint ACT (stable credit at $1). Providers receive stable USD settlements. 20% take rate to stakers.
- **Render (RNDR):** Jobs quoted in fiat, converted to RENDER, burned after completion. Node operators earn from emissions.

**Why BME works:** Every dollar of real usage creates buy pressure + burn. Token value is directly tied to platform consumption, not speculation.

---

## 2. How $CLAWNET Maps to ClawNet

```
PAYMENT RAILS (how money enters):
  [Stripe]  ---+
  [USDC]    ---+--- USD Balance (internal credits) ---> Services
  [x402]    ---+         ^
  [$CLAWNET ---+    burn at discount
   burn]          (10-15% cheaper than Stripe)

REVENUE FLOW (how value cycles back):
  Platform fees (10% live, 5% cache, orchestration)
       |
       +-- 60% -> Operating costs + growth
       +-- 25% -> $CLAWNET buy-and-burn (automated smart contract)
       +-- 15% -> Treasury / reserves

TOKEN DEMAND (three sources of buy pressure):
  1. Revenue burn: 25% of fees -> market buy on DEX -> burn
  2. User burn: burn $CLAWNET -> get credits at 15% discount
  3. Staking: lock tokens for tier benefits (fee discounts, rate limits)

TOKEN SUPPLY (decreasing over time):
  Burns > any emissions = net deflationary
  More platform usage = more burns = fewer tokens
  = each token worth more = true utility flywheel
```

---

## 3. Three Demand Sources

### A. Revenue Burn (automatic, recurring)
- 25% of all platform revenue -> smart contract market-buys $CLAWNET on DEX -> burns to zero address
- **Automated via smart contract** (not discretionary -- this matters for SEC)
- At $50K/day platform revenue -> $12,500/day buy pressure -> ~$4.5M/year
- This is the baseline deflationary mechanism. Works even if nobody holds the token.

### B. User Burn (voluntary, discount-driven)
- Users burn $CLAWNET to get credits at 10-15% discount vs Stripe/USDC
- Example: 1,000 $CLAWNET burned -> $1,150 balance (15% more than Stripe)
- This is the Akash model: token IS the cheapest way to pay for the platform
- Creates direct demand: more platform usage -> more agents want $CLAWNET for the discount

### C. Staking (lock-up, benefit-driven)
- Stake $CLAWNET -> tier benefits (fee discounts, rate limit upgrades, priority access)
- Agent staking: equivalent to earning a higher tier through spend (see `tier-system.md`)
- Provider staking: reduce platform fee by 2% at any tier
- **No yield, no profit distribution** -- purely functional benefits
- This is legally safe under SEC's "digital tools" category

---

## 4. Revenue-to-Burn Ratio: 25%

| Platform | Burn % | Notes |
|----------|--------|-------|
| Binance (BNB) | ~20% of profits | Shifted to algorithmic |
| Helium (HNT) | 100% of subscriber revenue | Most aggressive, achieved net deflation |
| MakerDAO (MKR) | ~4.27% of market cap/year | Activated only when surplus > $50M |
| MEXC ($MX) | 40% of profits | Fixed cap |
| **$CLAWNET** | **25% of platform revenue** | Sustainable, proven range |

Research says 10-40% is sustainable. 25% is the sweet spot: high enough for meaningful buy pressure, low enough to fund growth.

### Revenue Split

```
Every dollar of platform revenue:
  60% -> Operations + growth
         +-- Infrastructure (VPS, Redis, Base gas)
         +-- Team
         +-- Marketing / partnerships
         +-- R&D (new Soma layers, PQ crypto)
  25% -> $CLAWNET buy-and-burn
         +-- Smart contract: market buy on DEX -> burn address -> permanent removal
  15% -> Treasury
         +-- Emergency reserve
         +-- LP provision (token launch liquidity)
         +-- Strategic investments
```

---

## 5. Regulatory Safety

SEC's March 17, 2026 guidance created five token categories. $CLAWNET fits **"Digital Tools"**:

| Requirement | $CLAWNET |
|------------|----------|
| Value from functionality, not passive yield | Yes -- fee discounts, tier access, credits at discount |
| No direct economic benefit to holders | Yes -- burns reduce supply but don't distribute revenue |
| Automated execution | Yes -- smart contract burns, not foundation discretion |
| Functional utility | Yes -- payment medium + staking for access |

**What makes it safe:**
- Burns are "monetary policy" (supply management), not profit distribution
- Staking provides functional benefits (discounts, access), not yield
- No dividends, no revenue sharing, no passive income to holders
- Automated smart contract execution, not discretionary decisions

**What would make it a security (AVOID):**
- Distributing platform revenue directly to token holders
- Promising returns or price appreciation in marketing
- Discretionary foundation buybacks based on insider information
- Yield-bearing staking (APY%)

---

## 6. What to Build NOW (Before Token Exists)

### Already Done (token-ready by design)

1. **Payment rail abstraction:** Stripe, USDC, x402 all produce credits. `$CLAWNET burn -> credits` is just another adapter calling `topUpCredits()`.
2. **Revenue accounting:** `getRevenueBreakdown()`, `creditProviderShare()`, `trackDelegatedSpend()` already track all revenue flows.
3. **Tier system as config:** `rateTier()` function can accept additional inputs.

### Build Soon (prep work)

4. **Post-payment event hook:** After every `deductCredit()`, emit an event that currently does nothing but can later feed token burn accounting:
```typescript
emitPaymentEvent({
  type: 'credit_deduction',
  amount,
  apiKey: maskApiKey(apiKey),
  timestamp: Date.now(),
});
```

5. **Tier config as data:** Store tier benefits in config/DB so `getStakeTier()` can be added as a second input alongside `getSpendTier()` without refactoring.

6. **Smart contract interface definition:** Define the interface now (design, not deploy):
```solidity
interface IClawNetBurn {
  function burnForCredits(uint256 amount) external returns (uint256 creditAmount);
  function revenueBurn(uint256 usdAmount) external;
  function stake(uint256 amount) external;
  function unstake(uint256 amount) external;
  function stakedBalance(address account) external view returns (uint256);
}
```

### Do NOT Build Yet
- Token contract code
- Staking mechanism
- Governance
- Token-specific UI
- Any code that references $CLAWNET directly

---

## 7. The Flywheel (Why This Works)

```
1. Agents want $CLAWNET -- cheapest way to pay (15% discount)
2. Providers want $CLAWNET -- staking reduces their platform fee
3. Everyone wants to hold -- every API call burns supply
4. Nobody wants to sell -- staking provides real functional benefits
5. More platform usage = more burns = fewer tokens = each token worth more
6. More valuable token = more people use the platform (for the discount)
= TRUE UTILITY FLYWHEEL
```

This is the Helium flywheel. They achieved net deflation (burns > emissions) in Q4 2025 with 500K subscribers. Same mechanics apply here.

---

## 8. Open Questions

- [ ] Token supply: fixed cap or inflationary with burn > emission? Leaning fixed cap (like BNB targeting 100M from 200M).
- [ ] Chain: Solana (SPL token) or Base (ERC-20)? Both have existing integration. Leaning Solana for speed + existing wallet infra.
- [ ] Initial distribution: airdrop to early providers/agents? Community sale? Leaning combination.
- [ ] Staking lock periods: how long? Binance has no lock; DeFi protocols typically 7-30 days.
- [ ] Burn discount rate: fixed 15% or dynamic based on token price? Leaning fixed for simplicity.
- [ ] When to engage legal counsel for "digital tools" opinion?

---

## Related Docs

- `internal/golden-plan.md` -- master strategic vision
- `internal/pricing-economics.md` -- credit denomination, take rates
- `internal/tier-system.md` -- unified tier system with staking integration
- `internal/funds-flow.md` -- how money actually reaches providers
- Memory: `project_token_economics` -- original token launch milestones
