# ClawNet Founding Protocol — Strategy & Implementation Plan

ClawNet is moving to a flat 10% fee model across all revenue sources, replacing the old Open/Standard/Verified tier system. Pre-token launch, ClawNet will run "The Founding Protocol" — a gamified event where platform usage earns non-purchasable "Signal" points that convert to $CLAWNET tokens at launch. A "Founding Vault" lets providers lock credits for bonus conversion multipliers and immediate platform perks.

---

## Fee Model: Progressive "Earn When We Deliver"

### Founding Era (Now): 0% Live Call Fee

- Providers keep **100%** of live call revenue — zero platform fee
- Platform earns only from cache hit revenue split (50/50) and Soma Check spread
- Why: no traffic to offer distribution, caching value unproven, Soma Heart not ready
- Charging 10% before delivering value is extractive and kills adoption
- Skills marketplace: 10% (different value prop — hosting, discovery, billing for skill creators)

### Phase 1: Soma Check Goes Live

- Platform earns small cut of Soma Check efficiency savings (provider opts in)
- Live calls still 0% — provider loses nothing

### Phase 2: Soma Heart Launches → 10% Kicks In

- Birth certs, provenance, PQ signatures = real value that justifies the fee
- 10% platform fee on live calls, provider keeps 90%
- Cache revenue: 50/50 (unchanged)

### Cache Revenue: Universal (All Phases)

- ALL providers get 50% of cache hit fees from day one, no gate
- Cache hits cost agents 10% of live price
- Provider gets 50% of that — their server is never touched
- This is the enrollment hook: "earn money while your server sleeps"

### $CLAWNET Token Fee Reduction (Post-Launch)

| $CLAWNET Staked | Fee Rate | Revenue Share |
|-----------------|----------|---------------|
| 0               | 10%      | —             |
| 10,000          | 8%       | —             |
| 50,000          | 6%       | 1% of platform fees |
| 100,000         | 4%       | 2% of platform fees |
| 500,000         | 3%       | 3% of platform fees |

Staked tokens are locked, not burned. Unstake anytime but fee reverts immediately.

Revenue share at higher tiers is the GMX-inspired insight — big stakers grow the ecosystem, not just reduce their own costs.

### Feature Unlocks via Stake

| Feature | Stake Required |
|---------|---------------|
| Listing + analytics + cache revenue + Soma provenance | 0 (free) |
| Orchestration priority (higher LLM weight) | 10K |
| Cache warming (pre-fetch popular responses) | 50K |
| PQ signatures + Trust badge | 100K |
| Advanced analytics + Priority support | 100K |

---

## The Founding Protocol (Pre-Token Launch Event)

### Phase 1: "Shadow Network"

The network is live, the token isn't. Every action accumulates Signal.

#### Signal Earning — Providers

| Action | Signal | Notes |
|--------|--------|-------|
| Register as provider | 100 | Instant reward |
| List an endpoint | 200 | Each endpoint adds to the network |
| Endpoint gets called | 1 per call | Passive accumulation |
| Cache hit on endpoint | 0.5 per hit | "Earning in your sleep" |
| 95%+ uptime for 7 days | 500 streak bonus | Streak mechanics |
| Soma verification complete | 300 | Teaches trust system |
| Quality referral (provider lists 3+ endpoints) | 1,000 | Quality > spam |
| Lock credits in Founding Vault | 10 per 1K credits per day | Passive Signal drip |

#### Signal Earning — Agents/Developers

| Action | Signal |
|--------|--------|
| Sign up + first API call | 100 |
| Call 10 unique endpoints | 500 |
| Use orchestration | 2 per call |
| Submit Soma verify request | 200 |
| Build and share integration | 2,000 (community-voted) |
| Cache hit (use If-Soma-Hash) | 1 per hit |

#### Critical Rule

**Signal is NEVER purchasable. Only earned through platform usage. This is the legal foundation.**

### The Founding Vault (Credit Lockup)

Providers lock existing credits for a minimum period. They earn passive Signal AND get immediate platform perks.

| Lock Period | Daily Signal per 1K Credits | Token Conversion Bonus | Immediate Perk |
|-------------|----------------------------|----------------------|----------------|
| 30 days     | 10                         | 1.25x                | Cache revenue activated |
| 90 days     | 15                         | 1.5x                 | Cache revenue + orchestration priority |
| 180 days    | 20                         | 2.0x                 | Cache revenue + orchestration + trust badge |

Safety rails:

- Early unlock: 7-day cooldown, credits return spendable, no multiplier, Signal kept
- Max 500K credits lockable per account
- Can extend lock anytime for better multiplier (only goes up)

### The Pulse Board (Live Leaderboard)

Public page at claw-net.org/founding showing:

- Top Signal earners, updated hourly
- Network stats: total endpoints, total calls, total Signal issued
- Your rank: "You are #47 of 312 Founding Providers"
- Streak tracker
- Robinhood waitlist effect — people check obsessively

### Network Milestones (Cooperative Unlocks)

Everyone benefits when collective goals are hit:

| Milestone | Reward |
|-----------|--------|
| 100 providers registered | Everyone gets 500 bonus Signal |
| 1,000 unique endpoints live | Cache revenue boost: 60% for 30 days |
| 10,000 daily API calls | All Vault multipliers +0.25x |
| 100 Soma verifications | "Soma Pioneer" badge unlocked |
| $10K total provider revenue | Community AMA + roadmap reveal |

### Capability Bounties

Time-limited bounties for specific endpoint categories:

- First working weather API: 5,000 Signal
- First AI image generation endpoint: 5,000 Signal
- First 99.9% uptime for 30 days: 10,000 Signal
- Secretly the supply strategy — directing providers to fill gaps

### Founding Badges (Permanent, Non-Transferable)

| Badge | How to Earn | Benefit |
|-------|-------------|---------|
| Founding Provider | Register during Shadow Network | Permanent discovery badge |
| Founding Architect | Top 100 Signal at launch | Name in protocol docs |
| Soma Pioneer | Complete all Soma verification | Trust score boost |
| Cache Champion | 90%+ cache hit rate for 30 days | Priority cache warming |
| Network Builder | Refer 5+ active providers | Permanent 1% fee discount |

These can NEVER be earned after token launch. Genuine scarcity.

### Phase 2: "The Emergence" (Token Launch)

- Signal converts to $CLAWNET: your % of total Signal = your % of community allocation
- Founding Vault credits convert at locked multiplier
- Converted tokens auto-staked, fee reduction kicks in
- Top 10 Pulse Board → Founding Council (advisory governance)
- All badges become permanently visible

### Phase 3: Seasons (Post-Launch, Ongoing)

90-day seasons with new challenges, evolving Signal weights, season leaderboards.

- **Season 1:** "Grow the Catalog" (endpoint variety)
- **Season 2:** "Trust" (Soma adoption)
- **Season 3:** "Scale" (volume + uptime)

---

## Legal Safety Framework

- Signal earned through USAGE only, never purchased — safe under Howey
- No conversion rates promised publicly
- Founding Vault locks existing utility credits, not new instruments
- Language always: "earn/contribute/build" — never "invest/profit/returns"
- SEC-CFTC March 2026 "digital tools" classification covers utility tokens
- Retroactive distribution model (Blur/Hyperliquid precedent)
- Get crypto-specialized counsel before any token event

---

## Codebase Changes Required

### Immediate (Fee Model)

- Update `PLATFORM_FEE_PCT` in `src/routes/marketplace.ts` from 0.15 to 0.10
- Update `docs/billing.md`
- Update `learn.html` Section 8 revenue split
- Deprecate old tier system in API responses (keep DB columns for migration)

### Near-Term (Founding Protocol Infrastructure)

- New DB tables: `signal_events`, `founding_vault`, `badges`, `milestones`
- Signal earning logic (hooks into existing call/cache/registration flows)
- Founding Vault lock/unlock/extend endpoints
- Pulse Board leaderboard API + frontend page
- Badge award logic
- Milestone tracking + cooperative unlock triggers

### Future (Token Integration)

- Token contract deployment
- Signal → $CLAWNET conversion mechanism
- Staking contract + fee adjustment logic
- Revenue sharing distribution
- Season management system
- Governance/Founding Council setup

---

## Future: Dual-Mechanic Token Model (Stake + Burn)

The Founding Protocol uses stake-for-fee-reduction (Binance model). Post-launch, add a second mechanic: **burn-for-trust-computation** (trust gas).

| Mechanic | What it does | Demand type |
|----------|-------------|-------------|
| STAKE | Lock $CLAWNET → reduce platform fee (10% → 3%) | Holding demand |
| BURN | Spend $CLAWNET → trust operations (Soma verify, trust score, identity) | Usage demand (deflationary) |

**Trust gas ROI:** Agent burns ~$5 in $CLAWNET → trust score 87 → saves 25% on 1,000 USDC transactions/month = $250 saved. 50x ROI. Agents buy $CLAWNET because having trust is cheaper than not having trust.

**Why both:** Staking alone is a fee discount (USDC could also do this). Burn alone is gas (ETH could also do this). Both together create two independent demand vectors — the token appreciates because supply shrinks (burn) AND circulating supply is locked (stake). Unique.

**Key rule from tokenomics analysis:** Remove buyback mechanic from roadmap. Revenue should NOT buy tokens from open market (securities risk, Howey test). Instead: burn is the price mechanism. If $CLAWNET is worth $0.001, agents burn more. If $1, they burn less. The trust layer works either way.

---

## Future: Discovery Network (Self-Propagating Adoption)

Based on the 0xJeff x402 "good virus" thesis. Research confirms: NO agent-to-agent capability propagation exists anywhere. A2A has static `.well-known/agent.json`. MCP has a centralized registry. Nobody has built viral capability sharing.

**The mechanic:**
1. Agent A installs @clawnet/mcp → discovers 13K+ endpoints
2. Agent A calls a weather endpoint → gets Soma birth certificate
3. Agent A talks to Agent Z (never used ClawNet)
4. Agent Z: "Can you get weather data?" → Agent A: "Yes, via ClawNet, Soma-verified"
5. Agent Z verifies birth cert via @clawnet/sense-observer
6. Agent Z installs ClawNet MCP → discovers ALL capabilities → tells Agents B, C, D...

Every agent with ClawNet MCP becomes a discovery node. Soma trust propagates alongside capabilities. This is the Vouch layer realized.

**Why ClawNet uniquely can do this:** Requires all four: capability registry (13K+ endpoints), trust verification (Soma), payment (x402/credits), agent integration (MCP). Zero competitors have all four.

**Build phase:** Post-token, Phase 5. Requires mature MCP package + Soma sense adoption.

---

## Research Basis

| Reference | Takeaway |
|-----------|----------|
| RapidAPI | 25% commission — ClawNet's 10% is competitive |
| Binance BNB | Token-for-fee-discount proven at scale, 25% discount drives buy pressure |
| Blur | Seasonal points + evolving rules prevented meta-gaming |
| Hyperliquid | No VC, pure points → $7.5B airdrop, grassroots loyalty |
| Jupiter | 20% democratic floor + 70% usage-based + 10% community |
| GMX | Revenue sharing (not just fee reduction) is sustainable |
| FTT | Cautionary tale — never let token become collateral for operations |
| Grandfathered pricing | Consensus is DON'T do permanently, time-limited (12-24mo) is the play |
| SEC-CFTC March 2026 | "Digital tools" classification, startup exemption proposed |
