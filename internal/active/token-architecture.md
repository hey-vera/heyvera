# $CLAWNET Token Architecture — Trust Gas Model

**Status:** design doc. Token NOT launched. Build first, token second.
**Model:** Trust gas — token is consumed for trust operations, not routing.
**Revenue:** Free routing funnel, trust products as revenue, dual-proof burns.
**Launch trigger:** $50-100K monthly platform revenue (product-market fit first).

---

## 0. Core Thesis

**Routing is the funnel. Trust is the product. $CLAWNET is the gas.**

```
FREE ROUTING (maximum funnel):
  Every agent routes through ClawNet at raw cost.
  Provider gets 100%. Platform takes $0 from routing.
  No reason NOT to use ClawNet. Maximum adoption.

TRUST PRODUCTS (real revenue):
  Trust scoring, proofs, attestations, compliance.
  Agents need trust to operate. It's not optional.
  Every trust operation generates revenue.

$CLAWNET BURNS (the flywheel):
  Trust operations burn $CLAWNET.
  Nova folds burn micro-amounts on every action.
  Groth16 proofs burn macro-amounts monthly.
  More agents = more trust demand = more burns = scarcity.
```

---

## 1. Why Free Routing

With per-call infrastructure fee:
- Agent: "ClawNet charges 5% more than direct API. I'll cherry-pick."
- Result: leaky funnel, partial adoption

With free routing:
- Agent: "ClawNet costs exactly the same as direct. But I also get trust + Soma."
- Result: every agent routes everything through ClawNet

This is the AWS strategy. S3 has near-zero margin on storage. Revenue comes from compute, analytics, and services built on top. Storage is the funnel.

For ClawNet: free routing = funnel. Trust = product. Token = flywheel.

---

## 2. Revenue Sources (No Routing Fees)

| Source | Price | Revenue To |
|--------|-------|-----------|
| Endpoint routing | FREE (raw cost) | $0 — it's the funnel |
| Cache / Soma Check | 5% of live cost | Provider gets 100% |
| Transfers | FREE | $0 |
| Orchestration | FREE | $0 |
| Custody | FREE | $0 |
| Basic trust query | FREE | $0 |
| **Dimensional trust** | **0.03cr** | **Platform** |
| **Full trust query** | **0.05cr** | **Platform** |
| **Nova IVC fold** | **micro $CLAWNET burn** | **Token burn** |
| **Groth16 proof** | **25cr + $CLAWNET burn** | **Platform + burn** |
| **Subscriptions** | **$100-1000/yr** | **Platform** |
| **Premium trust features** | **TBD** | **Platform** |

### Trust Revenue at Scale

```
10M trust queries/day × 0.04cr avg = $400/day ($12K/month)
100M queries/day = $4,000/day ($120K/month)
1B queries/day = $40,000/day ($1.2M/month)

Plus proofs:
100K Groth16/month × 25cr = $2,500/month
1M proofs/month = $25,000/month

Plus subscriptions:
1,000 subs × $300/yr avg = $300K/year

Plus premium features as Soma expands:
Cross-platform trust portability, compliance, SLAs, monitoring...
```

Revenue grows as Soma grows. Every new trust primitive = new revenue stream = new burn source.

---

## 3. $CLAWNET Token Utility

### A. Trust Gas (primary — architectural necessity)

Trust operations consume real compute. $CLAWNET denominates that cost:

```
Trust score computation → burn $CLAWNET
Merkle root anchoring → burn $CLAWNET
Vouch graph updates → burn $CLAWNET
Agent identity registration → burn $CLAWNET
On-chain attestation (EAS) → burn $CLAWNET
```

**Why it's necessary (not artificial):** Trust computation costs real resources — oracle execution, Merkle tree construction, on-chain gas. Without the token, these costs fall entirely on ClawNet as a cost center. With the token, the cost is distributed and the burn creates a self-sustaining incentive loop.

**Price-independent:** If $CLAWNET = $0.001, agents burn more tokens per operation. If $CLAWNET = $1.00, they burn fewer. Trust layer works at ANY price. This is the Ethereum gas model.

### B. Dual-Proof Burns (Nova + Groth16)

ClawNet runs TWO proof systems. Both burn $CLAWNET.

**Nova IVC micro-burns (continuous, every action):**
```
Every heartbeat folds a leaf into a running Nova proof.
Every fold burns a micro-amount of $CLAWNET (~0.0001cr equiv).
Cheap individually. At scale, significant:

  1M folds/day    → 100cr burned ($0.10/day)
  100M folds/day  → 10,000cr burned ($10/day)
  1B folds/day    → 100,000cr burned ($100/day)
  10B folds/day   → 1,000,000cr burned ($1,000/day)
```

Nova micro-burns are the killer feature: every single agent action across the entire platform — even on free-routed calls — generates a tiny, steady burn. Agents barely notice it (sub-penny). At scale, it's a constant supply drain.

**Groth16 macro-burns (periodic, monthly compression):**
```
Compresses entire Nova instance into 192-byte proof.
Each compression burns meaningful $CLAWNET:

  25cr ($0.025) per proof
  × 10,000 agents/month   = $250/month burned
  × 100,000 agents/month  = $2,500/month
  × 1,000,000 agents      = $25,000/month
```

Less frequent but each burn is substantial. The "receipt" that an agent's entire month is cryptographically proven on-chain.

**Together:**
```
Action → Action → Action → ... → Compress
  ↓        ↓        ↓              ↓
Nova     Nova     Nova          Groth16
micro    micro    micro         macro
burn     burn     burn          burn
```

Two-layer deflationary pressure: continuous micro-drip + periodic macro-events.

### C. Revenue Burn (automatic, smart contract)

25% of all platform revenue (trust queries, proofs, subscriptions):
- Smart contract market-buys $CLAWNET on DEX
- Burns to zero address
- Automated, non-discretionary
- Auditable via SomaFeeBreakdown on-chain proofs

```
At $50K/month platform revenue:
  $12,500/month buy pressure → burn
  = $150K/year

At $500K/month:
  $125K/month buy pressure
  = $1.5M/year
```

### D. Burn-for-Credits (discount, voluntary)

```
Stripe:    $100 → 100,000 credits
USDC:      $100 → 100,000 credits
$CLAWNET:  $85 worth burned → 100,000 credits (15% discount)
```

Funded by: no Stripe fees (3.2% saved) + deflationary economics.
Agent saves money. Token supply shrinks. Both win.

### E. Staking (functional benefits, no yield)

```
Tier 1 (1,000 tokens):  10% off trust query costs
Tier 2 (10,000 tokens): 25% off trust + priority proof generation
Tier 3 (50,000 tokens): 50% off trust + priority + premium features

Provider staking:
Tier 1 (5,000 tokens):  Featured in marketplace
Tier 2 (25,000 tokens): Priority routing + analytics dashboard
```

**No yield. No revenue share. No APY.** Purely functional benefits.
SEC "digital tools" classification — legally clean.

---

## 4. The Trust-First Flywheel

```
Agent joins ClawNet (free — zero barrier)
  → Routes ALL API calls through ClawNet (free = no reason not to)
  → Builds usage history in pulse tree (Nova folds burning micro-$CLAWNET)
  → Needs trust score to interact with other agents
  → Burns $CLAWNET for trust computation
  → Trust score rises → other agents trust them → more transactions
  → More transactions → more Nova folds → more micro-burns
  → Monthly Groth16 compression → macro-burn
  → Supply permanently decreases
  → 25% of trust revenue → revenue burn → more supply removed
  → Token value tracks real trust demand
  → Validators earn $CLAWNET for running trust computation
  → More validators = more decentralized = more trustworthy
  → More trustworthy = more agents join the funnel
  → ∞
```

---

## 5. Smart Contract Architecture (Base)

Deploy on Base (same chain as USDC settlement + EAS attestations):

```solidity
// IClawNetToken — core token with burn mechanics

interface IClawNetToken {
  // --- Burn for Credits ---
  // Burn tokens, receive credits at 15% discount
  function burnForCredits(uint256 tokenAmount) external returns (uint256 creditAmount);

  // --- Revenue Burn ---
  // Platform deposits revenue, contract auto-buys and burns
  function depositRevenue(uint256 usdcAmount) external;
  // Automated: swaps USDC → $CLAWNET on DEX → burns
  // Non-discretionary, verifiable on-chain

  // --- Trust Gas ---
  // Burn for trust operations (called by ClawNet backend)
  function burnTrustGas(address agent, uint256 amount, bytes32 operationType) external;
  // operationType: TRUST_QUERY, NOVA_FOLD, GROTH16_PROOF, MERKLE_ANCHOR, EAS_ATTEST

  // --- Staking ---
  function stake(uint256 amount) external;
  function unstake() external; // 7-day cooldown
  function stakedBalance(address account) external view returns (uint256);
  function stakeTier(address account) external view returns (uint8); // 0-3
}
```

### Revenue Burn Flow

```
Trust query executed on ClawNet
  → SomaFeeBreakdown recorded (ECONOMIC leaf, on-chain proof)
  → Revenue accumulates in smart contract
  → At threshold: swap USDC → $CLAWNET on Uniswap/Aerodrome
  → Burn to 0x000...dead
  → Emit BurnEvent(amount, revenueSource, breakdownHash)
  → Anyone can verify: breakdown hash → pulse tree → burn tx
```

### Nova Micro-Burn Flow

```
Agent action triggers Nova IVC fold
  → Prover computes fold (~50-100ms)
  → Micro-burn: ~0.0001cr worth of $CLAWNET
  → Burn recorded as part of ECONOMIC leaf
  → Happens millions of times per day across all agents
  → Steady, constant deflationary pressure
```

---

## 6. Why This Is NOT a Pump.fun Coin

Three structural differences:

**1. Necessity:** Trust computation requires burns. Remove the token and trust operations need an alternative funding mechanism. The trust layer NEEDS fuel — $CLAWNET is that fuel.

**2. Sequencing:** Token launches AFTER platform has real revenue, real agents, real burn demand. The trigger is $50-100K monthly revenue. Not "launch and hope."

**3. Provability:** Every burn is tied to a SomaFeeBreakdown on-chain. Total burn demand = verifiable platform usage. No fake volume, no wash trading — the pulse tree proves it.

**The test:** If $CLAWNET goes to zero, does the trust layer still need burns to function? **Yes.** Agents burn more tokens at lower prices. The trust layer works at any token price. That's real utility.

---

## 7. Regulatory Safety

SEC March 2026 "Digital Tools" classification:

| Requirement | $CLAWNET |
|------------|----------|
| Value from functionality | Yes — trust gas, proof computation, staking benefits |
| No passive yield | Yes — burns reduce supply, don't distribute revenue |
| Automated execution | Yes — smart contract burns, non-discretionary |
| Functional utility | Yes — consumed for real computation |

**Safe:** Burns are consumption (like ETH gas). Staking provides functional benefits. No dividends, no revenue sharing, no APY.

**Avoid:** Revenue distribution to holders. Price appreciation promises. Discretionary buybacks. Yield-bearing staking.

---

## 8. Token Supply

Leaning fixed cap (like BNB 200M → targeting 100M via burns):

```
Total supply: 1,000,000,000 $CLAWNET
Distribution:
  40% Community (earned through participation, not purchased)
  20% Treasury (DAO-governed, 12-month lock)
  15% Team (4-year vest, 1-year cliff)
  15% Ecosystem grants (validators, oracle operators, skill creators)
  10% Initial liquidity (DEX pool on Base)

Burn trajectory:
  Year 1: ~5% burned (early adoption)
  Year 3: ~15% burned (growth phase)
  Year 5: ~30% burned (mature network)
  Long-term: approaching 50% burned (Binance precedent)
```

---

## 9. Launch Checklist

**Pre-launch (build first):**
- [x] Payment rail abstraction (Stripe, USDC, x402 all produce credits)
- [x] Revenue accounting (SomaFeeBreakdown tracks all flows)
- [x] Trust products live (dimensional, full queries, Groth16)
- [x] Soma Economic Protocol (on-chain fee provability)
- [x] Nova IVC + Groth16 prover operational
- [ ] $50-100K monthly platform revenue
- [ ] 6+ months operating history
- [ ] Legal opinion on "digital tools" classification
- [ ] Smart contract audited
- [ ] Community of active agents + providers

**Launch sequence:**
1. Deploy token contract on Base
2. Seed liquidity pool (Uniswap/Aerodrome)
3. Enable burn-for-credits (15% discount)
4. Enable trust gas burns
5. Enable Nova micro-burns
6. Enable revenue burn (25% auto-buy-and-burn)
7. Enable staking tiers
8. Publish contract address on claw-net.org/token + GitHub + verified socials

---

## 10. What to Build NOW (Token-Ready Prep)

### Already Done
1. Payment rail abstraction (`topUpCredits()` accepts any source)
2. Revenue accounting (SomaFeeBreakdown, pulse tree ECONOMIC leaves)
3. Trust product pricing (dimensional 0.03, full 0.05, Groth16 25)
4. Nova IVC prover + Groth16 compression
5. Soma Economic Protocol (platform-agnostic schema)

### Build Soon
6. Post-payment event hook (feeds future burn accounting)
7. Tier config as data (so staking tiers can be added alongside spend tiers)
8. Smart contract interface definition (design only, not deploy)
9. Nova fold cost tracking (measure real compute cost per fold)

### Do NOT Build Yet
- Token contract code
- Staking mechanism
- DEX integration
- Token-specific UI
- Any marketing referencing $CLAWNET

---

## 11. Open Questions

- [ ] Chain: Base (same as USDC settlement + EAS) vs Solana (existing wallet infra)?
  Leaning Base — everything is already there (USDC, EAS, proof anchoring).
- [ ] Nova micro-burn amount: fixed or dynamic based on fold compute cost?
- [ ] Burn discount rate: fixed 15% or dynamic based on token price?
- [ ] Staking cooldown: 7 days? 14 days?
- [ ] Community allocation mechanism: Signal points → token conversion?
- [ ] When to engage legal counsel for "digital tools" opinion?
