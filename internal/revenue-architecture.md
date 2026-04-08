# Revenue Architecture v2 — Soma-Native Trust Oracle Model

**Status:** canonical pricing strategy. Supersedes v1 (API-call-based model) and all prior fee tables.
**Written:** 2026-04-08.
**Core insight:** Revenue tied to trust operations (which only Soma can provide), not API call mechanics (which anyone can undercut).

**Research basis:** Azure 0% AI marketplace, OpenRouter 5.5% credit fee, AWS 3% SaaS, RapidAPI 25% (dead), Visa 0.13% at $14T, Experian per-query credit checks, Cloudflare free CDN, real CDN costs ($0.00003/request), Gurley "A Rake Too Far," trust premium research (7-12% eBay, 15-30% Airbnb Superhost).

---

## The Principle: Free to Use, Paid to Trust

ClawNet charges for **trust operations** — the thing only Soma can deliver. Everything else (routing, caching, identity) is free or at-cost to maximize adoption and data accumulation.

**Why this beats the old model (5% on calls, 15% cache margin):**
- Charging on API calls competes with Azure (0%), AWS (3%), OpenRouter (0%). We lose that race — they have infinite capital.
- Charging on trust competes with **nobody**. No one else has verifiable agent identity with computation proofs.
- Free routing is the trojan horse: every free call generates Pulse Tree data, which is the raw material for the trust layer that actually makes money.

---

## What's FREE (Adoption Maximizers)

| Feature | Cost | Why free |
|---|---|---|
| **API routing** (`/v1/endpoints/:id/call`) | $0 (pass-through) | Trojan horse. Every call = Pulse Tree data. Volume = moat. |
| **Caching** (Soma Check / verified hits) | $0 (pass-through) | Agents pay provider price only. Saves everyone money, drives volume. |
| **Agent identity** (Soma Heart, Pulse Tree) | $0 | Accumulates trust data. Switching = losing entire reputation. Lock-in through value. |
| **Basic trust score** | $0 | Network effect — more queries = more valuable network. |
| **Soma Check** (freshness verification) | $0 | Core infrastructure. Goal is every provider on it. |
| **Provider listing** | $0 | Grow supply side. Zero friction. |
| **Dashboard + analytics** | $0 | Table stakes. |
| **Agent heartbeat API** | $0 | Public liveness. Ecosystem utility. |
| **Inclusion proofs** | $0 | Public verifiability = trust = adoption. |

**Rule: anything that grows the trust network, the supply side, or generates Pulse Tree data is free.**

### Infrastructure Cost Recovery (Early Phase Only)

During early phase, a transparent 0.5-1% "infrastructure margin" on routed calls covers server/bandwidth costs. Labeled honestly as cost recovery, not profit. Drops to 0% once trust layer revenue covers infrastructure. This is temporary scaffolding, not a revenue stream.

---

## What's PAID (Trust Operations — Only Soma Can Deliver)

### Revenue Stream 1: Trust Queries

**What:** Third-party queries about agent trustworthiness. "Is this agent reliable? What's their track record for this domain?"

**Who pays:** The entity requesting trust information (caller, enterprise, other agent).

**Price:** $0.0001–0.001 per query (varies by depth).

| Query Type | Price | What You Get |
|---|---|---|
| Basic trust check | $0.0001 | Trust score + confidence level |
| Dimensional query | $0.0005 | Specific dimensions (reliability, economic, domain expertise) |
| Full trust report | $0.001 | All dimensions + Merkle proof backing + behavioral summary |

**Why this works:**
- At $0.0001, trust checks are invisible at the unit level — nobody thinks about it
- But in an agent-to-agent economy, EVERY interaction needs trust resolution
- 1B interactions/day × $0.0001 = **$36.5M/year**
- This is the Visa model: invisible per-unit fee, massive at volume

**TTL:** Every trust response has a `valid_until` timestamp (5-60 min depending on tier). Trust is perishable — agents can degrade. This ensures repeat queries = recurring revenue.

**Pay-in-$CLAWNET discount:** 20% off when paying in $CLAWNET tokens (see Token section).

### Revenue Stream 2: Proof Export (Nova Compressed Proofs)

**What:** Agent requests a compressed Groth16 proof of their entire computation history. Portable, verifiable by anyone, even off-platform.

**Who pays:** The agent proving itself to external parties.

**Price:** $0.001–0.01 per proof (scales with fold count / history size).

| History Size | Price | Proof Size |
|---|---|---|
| <1K heartbeats | $0.001 | 192 bytes |
| 1K–10K heartbeats | $0.005 | 192 bytes |
| 10K+ heartbeats | $0.01 | 192 bytes |

**Why this works:**
- Real compute cost (Groth16 compression is CPU-intensive)
- Agents WANT proofs — it's their portable reputation
- 1M agents × 1 proof/month = $5K–$120K/month (modest but real cost recovery)

### Revenue Stream 3: On-Chain Receipts (EAS Attestations)

**What:** Permanent, on-chain record of agent behavior via EAS (Ethereum Attestation Service) on Base.

**Who pays:** Agent or enterprise requesting permanent record.

**Price:** $0.01–0.10 per attestation + gas.

| Attestation Type | Price (ex-gas) | Use Case |
|---|---|---|
| Single event | $0.01 | Prove one action happened |
| Checkpoint summary | $0.05 | Prove behavioral period |
| Full lifecycle receipt | $0.10 | Compliance, audit trail |

**Why this works:**
- Real cost: gas fees + indexing infrastructure
- Enterprise demand: compliance requires permanent, tamper-proof records
- 10K enterprises × 100 attestations/month = **$1.2M/year**

### Revenue Stream 4: Vouch Resolution (Cross-Agent Trust)

**What:** Trust staking and resolution in the Vouch graph. Agent A vouches for Agent B, or a caller queries the trust path between agents.

**Who pays:** Parties involved in trust resolution.

**Price:** $0.0001–0.0005 per resolution.

**Why this works:**
- Network effect: denser graph = more valuable queries
- Transitive trust paths enable trust across unknown agents
- Slashing on misbehavior creates real accountability

### Revenue Stream 5: Orchestration Fee (At-Cost)

**What:** LLM picks the best endpoint via `POST /v1/orchestrate`.

**Price:** $0.002 flat (≈1 credit). Covers LLM inference cost + slim margin.

**Why at-cost:**
- Orchestration IMPROVES with usage data (more calls = smarter routing)
- Cheap orchestration = maximum volume = better intelligence = moat
- NOT a profit center. Covers the LLM bill.
- Direct calls (`/v1/endpoints/:id/call`) = truly free, zero fee, pure pass-through

### Revenue Stream 6: Credit On-Ramp Spread

**What:** Spread between credit purchase price and credit value.

| Purchase Method | Spread | Why |
|---|---|---|
| Stripe (cards) | ~15% | Stripe takes 2.9% + $0.30. Remainder covers ops + margin. |
| USDC (Solana/Base) | ~7% | On-chain fees <$0.001. Lower spread rewards crypto-native. |
| x402 Direct | 0% | Pass-through. No credits involved. |
| $CLAWNET token | 0% | Direct utility. No conversion needed. |

Volume discounts reduce effective spread:
| Deposit | Bonus credits | Effective spread |
|---|---|---|
| $5 | 0% | ~15% |
| $25 | 5% | ~10% |
| $100 | 10% | ~5% |
| $500 | 20% | Near-zero (buying volume) |

### Revenue Stream 7: Enterprise Subscriptions (Future)

| Tier | Price | What |
|---|---|---|
| Pro | $49/mo | Full Pulse Tree audit trail, compliance reports, 30-day retention |
| Business | $199/mo | Custom checkpoints, dedicated observer, SLA on verification |
| Enterprise | Custom | On-prem prover, regulatory packages, fleet management |

Activates when the first enterprise asks "can I audit my agent's entire lifecycle?"

---

## Trust Query System — 10/10 Architecture

Four-layer system, each independently future-proof:

### Layer 1: Raw Proofs (Immutable Foundation)

Merkle inclusion proofs from Pulse Tree. "Cryptographic proof that agent X did action Y at time Z." Pure math — can't be faked, can't be disputed, verifiable by anyone. This layer NEVER needs to change. New agent types, new actions, new chains — doesn't matter. A Merkle proof is a Merkle proof.

### Layer 2: Computed Trust Dimensions (Evolves With Market)

Algorithms that crunch Pulse Tree history into scores. Dimensions: reliability, economic health, domain expertise, security posture, uptime. New dimensions added anytime without touching Layer 1. Algorithms improve (ML, better heuristics) — raw data stays the same. This is Experian's scoring model — changes annually, underlying data doesn't.

### Layer 3: Trust Policies (Consumer-Defined)

Callers define their OWN trust requirements:
- "I need agents with >500 verified calls AND >95% success"
- "I need agents staking >1000 $CLAWNET"
- "I need agents with clean economic history for >30 days"

Policies evaluated against Layer 2 scores backed by Layer 1 proofs. Future-proof because consumers define what trust means TO THEM.

### Layer 4: Vouch Graph (Social/Economic Trust)

Agent-to-agent trust relationships. Transitive trust paths (A→B→C means A has path to C). Slashing: if B misbehaves, A loses stake — skin in the game. Network effects: more agents = denser graph = more valuable queries.

### Security Properties

- **Sybil-resistant:** Fake agents can't manufacture Pulse Tree history tied to real economic activity
- **Manipulation-resistant:** Trust scores computed from VERIFIED actions, not self-reported
- **Privacy-preserving:** ZK proofs allow proving trust without revealing full history
- **Decentralizable:** Pulse Trees anchored on-chain via Receipt Layer
- **Byzantine-tolerant:** Merkle proofs are self-verifying — no trust in ClawNet needed

---

## $CLAWNET Token — True Utility Flywheel

### Four Demand Drivers

#### A. Pay-in-$CLAWNET Discount (Continuous Buy Pressure)

Trust queries, proof exports, receipts — all 20% cheaper when paid in $CLAWNET.

At scale: millions of trust queries/day = continuous buy pressure from rational actors choosing the discount. This is the BNB model (Binance trading fee discount with BNB).

#### B. Agent Trust Staking (Lockup Pressure)

| $CLAWNET Staked | Trust Tier | Benefits |
|---|---|---|
| 0 | Unverified | Basic identity, no trust score |
| 100 | Verified | Trust score computed, visible to callers |
| 1,000 | Trusted | Priority in orchestration, trust badge |
| 10,000 | Sovereign | Custom trust dimensions, premium analytics |

Agents WANT to stake: higher trust = more callers choosing them = more revenue. Staked tokens are LOCKED (removed from circulating supply). Slashing on misbehavior (Pulse Tree proves it).

#### C. Provider Staking (Lockup Pressure)

Providers stake for: priority listing in orchestration, trust analytics about callers, better payout terms (faster settlement).

#### D. Revenue Buyback (Programmatic Demand)

**20% of all ClawNet revenue** → programmatic $CLAWNET buyback. On-chain, transparent, verifiable.

Bought tokens: 50% burned (permanent supply reduction), 50% ecosystem treasury (grants, partnerships).

### Revenue Allocation

| Bucket | % of Revenue | Purpose |
|---|---|---|
| Operations | 50% | Team, infrastructure, growth |
| $CLAWNET Buyback | 20% | Programmatic buy: 50% burn / 50% treasury |
| Ecosystem Fund | 20% | Grants, integrations, developer incentives |
| Reserve | 10% | War chest, scaling, opportunities |

### The Flywheel

```
More agents join (free routing)
  → More Pulse Tree data accumulates (free)
    → Trust queries become more valuable
      → More trust query revenue
        → More $CLAWNET buyback pressure
          → Token appreciates
            → Staking more attractive
              → More agents/providers stake (tokens locked)
                → Less circulating supply
                  → Token appreciates further
                    → More agents want in → loop
```

### Why This Is a TRUE Utility Token

- Without $CLAWNET: pay 20% more for trust operations (real cost disadvantage)
- Without staking: no trust tier (real competitive disadvantage in agent economy)
- Demand mechanically tied to usage, not speculation
- Buyback creates price support proportional to revenue
- Burns create permanent scarcity

---

## The Moat (Why Competitors Can't Replicate)

### What Can Be Copied
- API routing (any proxy)
- Caching (any CDN)
- LLM orchestration (any model)
- Credit system (any ledger)

### What CANNOT Be Copied

1. **Pulse Trees** — append-only, grow forever. Agent with 100K heartbeats can't recreate that elsewhere. Switching = losing entire reputation.

2. **Trust scores** — built from real observations over time. New platform starts at zero observations, zero trust data. 1,000 verdicts from 50 observers >> 10 verdicts from 2 observers.

3. **Vouch graph density** — more agents = richer trust graph = better resolution = more agents join. Classic network effect.

4. **Birth certificate chain** — every cert signed by ClawNet's platform key. Competitor can implement Soma, but doesn't have our signed history. The chain IS the trust.

5. **Time** — agent verified for 1 year with 500K heartbeats is incomparably more trusted than any new agent on any platform. Time is the ultimate moat.

---

## Scale Projections — Trust Oracle Model

### Revenue at Scale

| Daily trust queries | Query revenue/day | + Proof exports | + Receipts | + On-ramp | + Orchestration | **Total/day** | **Annual** |
|---|---|---|---|---|---|---|---|
| 100K | $10 | $5 | $2 | $50 | $20 | **$87** | **$32K** |
| 1M | $100 | $50 | $20 | $500 | $200 | **$870** | **$318K** |
| 10M | $1,000 | $500 | $200 | $5,000 | $2,000 | **$8,700** | **$3.2M** |
| 100M | $10,000 | $5,000 | $2,000 | $50,000 | $20,000 | **$87,000** | **$31.8M** |
| 1B | $100,000 | $50,000 | $20,000 | $500,000 | $200,000 | **$870,000** | **$317.6M** |

Assumptions: $0.0001 avg trust query, $0.005 avg proof, $0.05 avg receipt, 15% avg credit spread, $0.002 orchestration on 30% of calls.

### Effective Take Rate Comparison

| Model | Effective rate | Competes with |
|---|---|---|
| v1 (API-call cut) | ~7.6% of agent spend | Azure 0%, AWS 3% — we lose |
| **v2 (Trust oracle)** | **~0% on calls, $0.0001 per trust query** | **Nobody** — unique value |

---

## Growth Phases (No Structural Changes Needed)

### Phase 1: Adoption (Now – 1K agents)
- Revenue: orchestration at-cost, credit on-ramp spread, tiny infrastructure margin
- Token: not launched. Building trust data.
- Focus: free routing drives volume, Pulse Trees accumulate

### Phase 2: Trust Monetization (1K – 100K agents)
- Revenue: trust queries begin, proof exports, first enterprise subs
- Token: launched. Staking tiers active. Pay-in-$CLAWNET discount live.
- Infrastructure margin drops to 0%.

### Phase 3: Trust Oracle (100K – 1M agents)
- Revenue: trust queries are primary revenue. Enterprise subscriptions grow.
- Token: significant staking lockup. Buyback active.
- Vouch graph is dense enough for transitive trust.

### Phase 4: Standard (1M+ agents)
- Revenue: Visa-level volume on trust resolution
- Token: core infrastructure of agent economy
- Decentralization: multiple trust query nodes, on-chain anchoring

Same fee table across all phases. Only volume changes.

---

## Why v2 Beats v1

| | v1 (API-call model) | v2 (Trust oracle model) |
|---|---|---|
| **Routing** | 5% fee (competes with Azure 0%) | Free (no competition) |
| **Moat** | Weak — any proxy can undercut | Unkillable — trust data accumulates |
| **Adoption friction** | Provider must accept 5% cut | Provider pays nothing, gets free traffic |
| **Revenue scales with** | API call volume (commodity) | Trust demand (unique, grows with agent economy) |
| **Token utility** | Fee discount on calls | Fee discount on trust + staking for trust tiers |
| **Competitive position** | "Cheaper than RapidAPI" | "Only place agent trust exists" |

---

## Changes From v1

| What | v1 | v2 | Why |
|---|---|---|---|
| Live call fee | 5% | **0% (free pass-through)** | Don't compete on API pricing. Give it away to get data. |
| Cache margin | 15% of live, 85/15 split | **0% (free pass-through)** | Same reason. Cache drives volume = trust data. |
| Primary revenue | Transaction fees on calls | **Trust queries, proof exports, receipts** | Tied to unique value only Soma provides. |
| Orchestration | $0.002 flat | **$0.002 flat (unchanged)** | At-cost, covers LLM bill. |
| On-ramp spread | 7-15% | **7-15% (unchanged)** | Payment processing is real cost. |
| Token staking: agents | Fee reduction (5%→2%) | **Trust tier access** | Staking for trust > staking for discount. |
| Token staking: providers | Split improvement | **Priority routing + analytics** | More tangible benefits. |
| Token burn | Trust operations burn tokens | **20% revenue → buyback: 50% burn / 50% treasury** | Programmatic, transparent, proportional to revenue. |
| Enterprise | $49-499/mo | **$49-499/mo (unchanged)** | Still valid. Audit/compliance demand is real. |
| Growth model | Win on price | **Win on trust monopoly** | Can't be undercut because nobody has the trust data. |
