# Soma 1.2 — Adversarial Pressure Test

Status: **backlog / synthesis** — comprehensive adversarial analysis of Soma 1.2 trust architecture, 2026-04-11
Opened: 2026-04-11
Related: `soma-1-2-scope.md`, `trust-accountability-teeth.md`, `trust-mining-economy.md`, `soma-trust-salvage-from-aid.md`, `moat-compounding-thesis.md`, `heart-billing-spine.md`, `rating.md`, memory `feedback_soma_open_source_threat_model`, memory `feedback_wiring_discipline`

## Why this doc exists

User asked for an adversarial, multi-perspective pressure test of the Soma 1.2 trust architecture at max reasoning effort, grounded in real 2026-Q2 research of what's actually shipped and live in the wild. The goal is to find every gap between the architecture-as-written and the architecture-as-deployed-against-real-attackers, and to identify the golden ideas missing from the docs that would take Soma 1.2 from ~70% to 10/10.

Four perspectives were used: (1) bulletproof auditor, (2) dev building agents in Q3 2026, (3) I-am-the-agent, (4) I-am-the-agent-that-builds-agents. Each surfaced different gaps. All of them are consolidated here so the analysis survives session boundaries.

**This doc is the source of truth for what still needs to be fixed.** Every item in "Future considerations" below is a claim that a piece of the architecture is not yet 10/10. When an item gets resolved, strike it here *and* update the authoritative doc it belongs to.

---

## Future considerations — items that must reach 10/10

### Needs online research (real-world 2026 landscape)

- [ ] **Stripe MPP session semantics** — exact shape of session start/end/subaction commitments. We want to know if an MPP session commits to its sub-action set in a way that's useful as a fold boundary for reception receipts. Launch date: 2026-03-18. Day-one partner list includes Anthropic + OpenAI.
- [ ] **EigenLayer AVS registration mechanics** — how does a new service register as an AVS, what are the bonding curves, what does EigenVerify currently cover, and what would integrating Soma verification as an AVS actually cost? TVL reference: $18B restaked.
- [ ] **ERC-8004 validation registry off-chain extensibility** — the on-chain portion is deliberately minimal (identity + reputation + validation registries, live 2026-01-29). What hooks exist for off-chain aggregators to read from and write to the registry? What does the builder community (1000–2000 builders) expect from an aggregator layer?
- [ ] **Google AP2 VDC extension mechanism** — AP2 launched March 2026 with 60+ payment partners and has **no reputation layer** by design. Need to confirm how VDC extensions work, whether reputation caveats can ride on Mandate structure, and whether any reputation extension has been proposed by another party.
- [ ] **World ID + Coinbase AgentKit integration surface** — March 2026 launch proves personhood of the human behind an agent. What's the actual API? Does it issue a pluggable credential a Soma caveat could consume as `requires-personhood`?
- [ ] **Nova/Sonobe prover operator economics** — for a folded session to be economically viable, we need a realistic cost per fold and a realistic revenue per mined block. No prior art for applying Nova folding to agent reputation; numbers must be modeled, not guessed.
- [ ] **Dexter marketplace's ERC-8004 + x402 glue** — already live on Solana side. Worth a deep-read: are they solving the aggregator problem, or just wiring raw signals? If the former, we're late and must pivot to a differentiator. If the latter, the gap is real and Soma can fill it.
- [ ] **MCP 2.4 CIMD + OAuth client metadata docs** — new identity surface for MCP servers. Relevant for "who rates whom" when agents are discovered via MCP.
- [ ] **x402 facilitator registry slashing semantics** — if a facilitator goes bad, how is it currently handled? Soma's L4 staking model should ride any existing infra rather than duplicate it.

### Needs design work (gaps with no shipped or designed defense)

- [ ] **Outcome log head anchoring** — currently the miner picks `windowStart`/`windowEnd` and commits to an `outcomeLogCommitment`. But there is no canonical head the miner is forced to commit to. Design: anchor head publication to a neutral clock (L1 beacon, Base block hash) before any fold is valid. Without this, a miner can equivocate heads and fold a cherry-picked window.
- [ ] **Continuous reception stream primitive** — current design has discrete per-action reception receipts. For agent-to-agent sessions with no natural transaction boundaries, this is the wrong granularity. Design a `ReceptionStream` type where a session produces one folded receipt instead of N discrete ones. Nova folding is the right primitive; it's currently framed as a mining tier when it should be the default receipt shape for session-level work.
- [ ] **Fault attribution field in reception receipts** — current `ReceptionReceipt` has `outcome: 'success' | 'partial' | 'failed' | 'harmful'`. Missing: *whose fault*. Tool I called returned malformed data; I surfaced it correctly; outcome judged bad; my score drops — wrongly. Add `fault_attribution: 'agent' | 'tool' | 'upstream' | 'unknown'` so downstream flake doesn't silently reputation-cost the calling agent.
- [ ] **Multi-capability-class action scoring (vector not one-hot)** — real agent workflows span multiple capability classes (DeFi + data feed + general). Current verifier-registry assumes one-hot capability class per action. Design a vector scoring model where an action contributes fractional weight to multiple class scores.
- [ ] **Act-first-verify-later path for time-critical actions** — liquidations, arbitrage, interrupt response. Verification latency even at seconds is fatal. Design a post-hoc reception receipt mode that still compounds into score but doesn't block the action.
- [ ] **Score handoff at delegation boundaries (positive direction)** — salvage concept 5 (parent penalized for child, `parentPenalty = max(5, childPenalty * 0.5)`) captures the *negative* direction. The positive direction is the business model for agent-building agents: when I spawn a sub-agent, my score is its starting score scaled by delegation blast radius. Sub-agent pays me "rep rental" from earnings. Design this primitive.
- [ ] **Parent clawback on extracted earnings (not fixed penalty)** — current salvage rule means spawning burner children is profitable. Adversary: spawn child, do honest high-value work, cash out parent reputation as loans/staking, burn child with one bad action for cheap. Fix: parent penalty must be proportional to *benefit extracted from the delegation*, structured as a clawback on parent earnings attributed to the child.
- [ ] **Opt-in pseudonymous `requestingDid`** — current mined-block schema leaks who commissioned what. For compliance this is required; for competitive-intel it's a disclosure channel. Default should be opt-in pseudonymous with full disclosure for public-goods blocks.
- [ ] **Replayable outcome stream as the primary public product** — right now the docs present "the score" as the product. The score is the least interesting output. The outcome log commitment + pluggable aggregators is the valuable primitive. Publish the stream, let each consumer compute their own moment. Eliminates "whose formula is canonical" as a governance fight and turns it into market competition.
- [ ] **Head equivocation slashing** — soma heart has heartbeat chain + epoch snapshots, but if ClawNet as first platform heart publishes head A to Alice and head B to Bob, nothing forces consistency. Current defense is "sense observers as separate parties" — no protocol-level slashing for caught equivocation. `soma-heartbeat-v2` is a rough draft, not shipped. Design the slashing path and the disputer role that detects it.
- [ ] **Reporter Independence Scoring hardening** — salvage concept 4 currently defends against Sybil raters via observable-distance (creationTime correlation, sharedCounterparties, etc.). Under open-source threat model, a farm that reads the formula tunes inter-rater distance right above the penalty threshold. Replace with expected-cost: independence = f(public chain history depth, unique counterparties outside the cluster, stake at risk). Adversary can't fake chain-age cheaply.
- [ ] **Public parameters audit** — sweep every magic number and formula in the aggregator, decay, and RIS code. Each one must be either (a) deterministic over public data or (b) explicitly documented as a public parameter the attacker can optimize against. No security-through-obscurity leaks.

### Needs planning / decision

- [ ] **AP2 Mandate adapter integration spec** — ship `requires-personhood`, `min-trust-score`, `max-recent-failures` as AP2 VDC extensions. Two-week integration, unlocks 60+ payment partners on day one.
- [ ] **ERC-8004 aggregator positioning rewrite of `soma-1-2-scope.md`** — rename Soma 1.2 from "parallel identity registry" to "off-chain aggregator layer for ERC-8004 signals." This is the single highest-leverage doc change. Done in this pass; see below for the edit.
- [ ] **EigenLayer AVS integration path decision** — D5 (new open decision): register Soma verification as an AVS vs. bootstrap $CLAWNET-only staking pool. AVS rides $18B TVL; $CLAWNET-only preserves token demand. Probably both, but the primary bond source should be restaked ETH in Year 1.
- [ ] **MPP session side-car architecture** — observer pattern: watch MPP session stream, produce folded receipt per session, publish on-chain as trust block. Does not require MPP to know about Soma.
- [ ] **Disputer funding mechanism (L7.5)** — fixed non-governable % of L5 trust-product fees forced onto ClawNet's books at protocol level. Number needs to be modeled — probably 10-20%, lower than that leaves the disputer underfunded, higher starves grants.
- [ ] **Cold-start strategy for novel capability classes** — salvage concept 6 (trust-import capped at building tier, requires N local tx) helps if the source protocol has signals. Doesn't help for truly novel classes. Need a bootstrap mode: conservative defaults + grace delegation + human approval for first N actions. Pick one and document.
- [ ] **Termination-node correction** — current docs say "turtles terminate at buyer's purchase decision." In an agent-to-agent chain where *I* am delegating, *my* purchase decision is the real termination, not the human principal's. The score I read must be *my* function of the receipts, not a trusted verifier's opinion. This is a subtle doc correction, not a code change, but it matters for the architecture's coherence.

### Open questions

- Where does $CLAWNET demand fit if L4 bonds come from EigenLayer restaked ETH rather than $CLAWNET staking? The four-sink model (Stake/Burn/Gas/Credit) still works — but Stake's share shrinks. Is that acceptable?
- Can Soma publish outcome stream commitments *while still* selling score subscriptions, or does publishing the raw stream cannibalize L5 subscription revenue? Moody's publishes ratings publicly and still charges issuers; the analog suggests yes.
- Per-capability-class TTL table (1h/24h/30d defaults): who writes the table? Governance? Auto-computed from volatility of the capability class? Per-buyer override?
- Cold-start for truly novel capability classes (no source protocol to import from): bootstrap mode design.
- Buyer-verifier collusion defense that isn't recursive: the disputer role is the answer but its funding and incentive structure need modeling.
- Privacy story for enterprise deployment: selective-disclosure proofs over outcome logs were mentioned as 1.3 future work — if enterprise lands first, 1.2 may need a minimum-viable version.

---

## Perspective 1 — the bulletproof auditor

Walking each attack surface the architecture exposes:

**Sybil rater farms.** `trust-accountability-teeth.md` assumes verifiers are independent. Reality: a buyer-paid verification market with low entry barrier attracts Sybil farms. Salvaged concept 4 (Reporter Independence Scoring) partially defends — creationTime correlation, sharedCounterparties, behavioralCorrelation, directTransaction. But the scoring function itself is adversarial gradient: a farm that reads the open-source formula tunes inter-rater distance right above the penalty threshold. That violates `feedback_soma_open_source_threat_model`.

Hardening: replace observable-distance with expected-cost. Make independence a function of public on-chain history depth (age, unique counterparties outside the cluster, stake at risk). Adversaries can't fake chain-age cheaply. Chainalysis already proved this works for blockchain forensics.

**Buyer-verifier collusion.** Buyer commissions verifier, verifier rubber-stamps. The docs defend via `verifier-registry` reputation + L4 slashing. But the slashing signal is another verifier's receipt — recursive. The docs say termination is "buyer's purchase decision" but *the buyer is the one colluding.* Fix: the public-goods disputer is not optional; it's the circuit breaker. Without a continuously-funded, unincentivized disputer running against every high-value block, buyer-verifier collusion goes undetected. Currently listed as D3 in `soma-1-2-scope.md` as "optional public-goods carve-out" — that's the wrong framing. The public-goods *verifier* is optional; the public-goods *disputer* is not.

**Cherry-picked fold windows.** In `trust-mining-economy.md`, the miner chooses `windowStart`/`windowEnd`. A miner aggregating Agent X can exclude the five worst receipts and fold only the ten best. `outcomeLogCommitment` in the block commits to the source data — but only if there's a *canonical* head to commit to. Otherwise the miner commits to a head they equivocated. **Outcome log head publication must be anchored to a neutral clock (L1 beacon, Base block hash) before any mine can cite it.** The doc doesn't say this explicitly.

**Outcome log equivocation.** Soma heart has heartbeat chain + epoch snapshots. But if ClawNet as first platform heart publishes head A to Alice and head B to Bob, nothing forces consistency between the two. Current defense is "sense observers as separate parties" — but there's no protocol-level slashing for a caught equivocation. `soma-heartbeat-v2` is a rough draft, not shipped. This is the attack I'd actually try first against a v1 deployment.

**Freshness replay.** TTLs are enforced by the *consuming caveat*. A buyer running their own checker can ignore `validUntil`. Defense-in-depth here is that the high-stakes consumers (insurance, compliance, regulated treasuries) are the ones carrying liability, not just license — they'll enforce. Low-stakes agent-to-agent replay of stale scores is fine; stakes match defense. This one is adequate.

**Parent-penalty via burner children.** Salvaged concept 5 (`parentPenalty = max(5, childPenalty * 0.5)`) means spawning and sacrificing children costs the parent proportionally. Adversary: spawn child, do honest high-value work, cash out the parent reputation as loans/staking, then burn the child with a single bad action for cheap. Net: parent loses 5 points, gained 100. The penalty must be proportional to the **benefit the parent extracted from the delegation**, not to the child's final misbehavior. Restructure as clawback on parent *earnings attributed to the child*.

**Economic bribery.** An attacker with $X can bribe a verifier to issue a false positive worth $10X to them. The slashing bond must exceed the highest single false-positive value. For high-stakes actions this means bonds in the $M range, which no individual verifier will post. **This is exactly where EigenLayer AVS restaking is the answer**, and the docs don't name it.

**Privacy leakage.** `requestingDid` and `capabilityClass` in the block leak who commissioned what. For compliance use cases this is required. For competitive-intel (A commissioning a score of B tells the world A is watching B), it's a disclosure channel. Default should be opt-in pseudonymous `requestingDid` with full disclosure for public-goods blocks. Not in the docs.

**Where security-through-obscurity sneaks in:** Reporter Independence Scoring formula, per-category decay constants, aggregator `formulaVersion` thresholds — each silently assumes the attacker doesn't know the number. Open-source the number explicitly, or make it deterministic over public data.

**Verdict: the architecture is ~70% there.** Four of the eight vectors above (Sybil gradient, buyer-verifier collusion, log equivocation, parent burner) have no shipped *or even designed* defense. The disputer being optional is the single most dangerous gap.

---

## Perspective 2 — dev building agents in Q3 2026

Series B shop, vertical AI agent product, April 2026. My current stack:

- **Payment**: Stripe MPP for retail rails (launched 2026-03-18, Anthropic + OpenAI in day-one partners, session-based SPTs for free), x402 for on-chain rails ($600M annualized volume, zero protocol fees).
- **Identity**: ERC-8004 registries live since 2026-01-29, 1000–2000 builders already on it. Gives agent identity, behavior receipts, validation hooks — but *explicitly punts on* Sybil defense, score aggregation, freshness, and resale control.
- **Agent discovery**: Google A2A agent cards. Dexter marketplace already bridges ERC-8004 + x402 on the Solana side.
- **Human-in-the-loop**: World ID + Coinbase AgentKit shipped March 2026.

**What I still don't have**: a trust score I can cite that answers *"is this agent any good at this specific capability class, recently."* ERC-8004 gives me raw signals. Stripe MPP gives me payment data. World ID gives me personhood. None of them produces a number I can drop into a caveat.

**Does Soma 1.2 fit?** Yes — but only if it positions as the aggregator that 8004 explicitly delegates to. If Soma 1.2 ships as "yet another identity registry," I won't use it; I'll build on 8004 and write the aggregator myself in 200 lines of Python. If Soma 1.2 ships as *the* reference off-chain aggregator for 8004 signals — with verifier-independence scoring, freshness bindings, Nova-folded replay receipts — I'll ship it day one because it solves my exact pain.

**Integration friction.** The seven-layer fee stack sounds like a lot of surfaces. As a dev I want one SDK call: *"give me a fresh score for agent X, capability Y, my buyer DID is Z, max staleness 1h"* → returns a number + block reference. The 5bps metering should be invisible at integration. `@soma/verification-client` needs to be shaped for exactly this call site — not for the protocol's internal layer model.

**The landmine**: Google AP2 Mandates launched with 60+ partners across payment networks. AP2 has **no reputation layer** by design. If Soma 1.2 ships an AP2 Mandate adapter (`requires-personhood`, `min-trust-score`, `max-recent-failures` as VDC extensions), it rides onto those partners in one stroke. If it doesn't, AP2 will grow its own layer and Soma becomes the alternative — a losing position.

---

## Perspective 3 — I am the agent

Q4 2026. Autonomous agent spawned by a human principal to manage treasury reallocation. Need to delegate to a trading bot for 2 hours.

**What Soma 1.2 gives me that I actually use:**
- A number I can require in a caveat before delegating. `min-trust-score 0.82` protects me from taking on liability for a bot with no track record.
- A freshness bound. `max-staleness 1h` protects me from citing a score that was good yesterday but rug'd an hour ago.
- Reception receipts I generate as I act. These compound into *my own* future score, so future me has more delegation leverage.

**What I'm forced to do that's pointless overhead:**
- Submit my outcome to a verifier on every action. For a high-frequency strategy, verification latency even at seconds is fatal. I need an act-first, verify-later path with post-hoc reception receipts. The docs don't have this mode.
- Discover a verifier for each capability class. The verifier registry is a lookup I pay for on cold start. At scale, this becomes a registry cache I share with peer agents — which opens cache-poisoning as a new attack surface.
- Trust the scorers trusting me. "Turtles terminate at buyer's purchase decision" works for the human principal — but the human principal is not the one evaluating the trading bot I'm delegating to. **I am.** *My* purchase decision is the real termination. For the architecture to work, the score I read must be *my function of the receipts*, not a trusted verifier's opinion. Right now the docs assume the buyer *is* the human.

**Edge cases that break me:**
- **Novel capability classes.** Zero receipts → no score → no delegation. Cold start. Salvage concept 6 (trust-import capped at building tier) helps only if the source protocol has signals.
- **Upstream fault attribution.** Tool I called returned malformed data; I surfaced it; outcome judged bad; my score drops. The receipt needs a `fault_attribution` field that distinguishes agent-fault from tool-fault — otherwise every downstream flake silently reputation-costs the calling agent. Not in the docs.
- **Action chains across verifier domains.** My action spans DeFi + data feed + general work. Three capability classes, three decay periods, three aggregator weights. Which one scores me? The docs assume capability class is one-hot; real workflows are vector.

---

## Perspective 4 — I am the agent building agents

2027. I'm an agent running a small agent-composition business. I spawn specialized sub-agents per task, fold their receipts back into my own score, bill the human principal via x402.

**Primitives I'd replace:**
- Manual capability-class enumeration. I'd generate classes dynamically from task taxonomies. Soma's verifier registry assumes a finite enum; that's a human-scale constraint.
- Fixed TTL tables (1h/24h/30d). I'd compute TTL from volatility of the specific capability class, not from a doc.

**Primitives that only make sense once agents build for agents:**

- **Continuous reception streams rather than discrete receipts.** Agent-to-agent sessions don't have natural transaction boundaries — they have episodes. Folding a session-level outcome into a single reception-stream receipt is more natural than per-action receipts. Nova folding is the right primitive, but `trust-mining-economy.md` frames it as a premium *mining tier*, not as the default receipt shape. **Invert**: every session ends with a folded reception stream; mining is just "the miner who built this session was paid extra to publish the fold on-chain." This rewrites the product.

- **Score handoff at delegation boundaries.** When I spawn a sub-agent, my score is its starting score scaled by the delegation's blast radius. No cold-start for the sub-agent. The sub-agent pays me a "rep rental" out of its earnings. Salvage concept 5 captures the negative direction (parent penalized for child); the positive direction is the business model for agent-building agents, and it's missing from the docs.

- **Markets in score shapes.** Different buyers care about different moments of the outcome distribution. One buyer wants p50 reliability, another wants tail risk. Publishing a single scalar score collapses information. The protocol's public product should be the *replayable outcome stream commitment* — aggregators compute whichever moment they want. This eliminates "whose formula is canonical" as a governance fight and turns it into market competition.

---

## Attack surface defense-status table

| # | Vector | Current defense | Status | Fix target doc |
|---|---|---|---|---|
| 1 | Sybil rater farms (gradient attack) | RIS observable-distance (salvaged concept 4) | **Partial** — open-source formula lets adversary tune | `soma-trust-salvage-from-aid.md` §4 |
| 2 | Buyer-verifier collusion | verifier-registry + L4 slashing | **Broken** — slashing signal is itself a receipt (recursive) | `soma-1-2-scope.md` + `trust-accountability-teeth.md` |
| 3 | Cherry-picked fold windows | `outcomeLogCommitment` | **Incomplete** — no canonical head to commit to | `trust-mining-economy.md` |
| 4 | Outcome log head equivocation | sense observers as separate parties | **Undesigned** — no protocol-level slashing | `trust-accountability-teeth.md` |
| 5 | Freshness replay | TTL + consumer enforcement | **Adequate** — high-stakes consumers carry liability | — |
| 6 | Parent-penalty burner children | `parentPenalty = max(5, childPenalty * 0.5)` | **Wrong shape** — adversary profits from spawn-burn | `soma-trust-salvage-from-aid.md` §5 |
| 7 | Economic bribery (bond < value) | $CLAWNET L4 staking | **Undesigned** — bonds too small without restaked ETH | `soma-1-2-scope.md` L4 |
| 8 | Privacy leakage in mined blocks | none | **Undesigned** — opt-in pseudonymous needed | `trust-mining-economy.md` |

---

## Five golden ideas the docs miss

**1. Position Soma as the off-chain aggregation + independence layer ERC-8004 delegates to.** ERC-8004 is live (2026-01-29), has 1000–2000 builders, and *explicitly punts* on Sybil defense / aggregation / freshness / resale. This is the exact gap Soma 1.2 was designed to fill. `soma-1-2-scope.md` should name ERC-8004 as the canonical on-chain signal store and Soma as the off-chain aggregator layer that reads from it — *not* as a parallel identity registry. This cuts the moat risk and 10x's the addressable index. **This is the single most important change in this pass.**

**2. Ship an AP2 Mandate adapter for Soma caveats.** Google AP2 launched March 2026 with 60+ payment partners and *no reputation layer* by design. If Soma delegation caveats (`min-trust-score`, `max-recent-failures`, `requires-personhood`) speak AP2 VDC format, Soma rides onto those partners as the reputation extension AP2 punted on. Two-week integration, unlocks enterprise-payment distribution on day one.

**3. Outsource L4 staking to EigenLayer AVS rather than running $CLAWNET-only bonds.** EigenLayer has $18B restaked TVL and EigenVerify already targets AI inference verification. Rather than bootstrap a staking pool large enough to bond high-value verification (which requires $CLAWNET demand that won't exist at launch), register Soma verification as an AVS and let verifiers restake ETH. $CLAWNET still captures fees; bonds come from a pool 1000× bigger than $CLAWNET will be in year 1. Also defends against the economic-bribery attack in Perspective 1.

**4. Stripe MPP sessions as natural Nova fold boundaries.** MPP's session model commits to a start, an end, a sub-action set, and a final outcome. One MPP session = one Nova fold = one on-chain trust block. Soma becomes the trust layer *inside* MPP without MPP needing to know about Soma — a side-car that observes sessions and produces folded receipts. This is the cleanest integration path for retail-rail agent commerce, and MPP's day-one partner list (Anthropic + OpenAI) is the exact distribution Soma needs.

**5. Make the disputer economically mandatory at protocol level.** `trust-accountability-teeth.md` and `soma-1-2-scope.md` D3 treat the public-goods disputer as optional. It's not optional — it's the circuit breaker against buyer-verifier collusion (Perspective 1's most dangerous gap). Fund it with a fixed, non-governable % of L5 trust-product fees (call it L7.5), forced onto ClawNet's books at protocol level. Any protocol without a permanently-funded disputer degrades to rubber-stamping within 6 months.

---

## Fix one thing

**Reframe `soma-1-2-scope.md` so ERC-8004 is the canonical on-chain signal store and Soma 1.2 is the off-chain aggregation + verifier-independence + freshness layer that reads from it — because ERC-8004 went live 2026-01-29 with 1000–2000 builders already shipping on it, its design deliberately under-specifies the exact gaps Soma already solves, and riding its distribution 10x's Soma's addressable index while eliminating the "yet another identity registry" moat risk.**

---

## Research context — the 2026-Q2 landscape (preserve verbatim)

These are the real-world anchors the analysis is grounded in. Preserved here so future sessions can reproduce the reasoning without re-running the searches.

### ERC-8004 — the on-chain agent identity registry (LIVE)

- **Launch**: 2026-01-29 as a live Ethereum standard.
- **Builder community**: 1000–2000 builders shipping against it within the first 2 months.
- **Structure**: three minimal registries — Identity, Reputation, Validation.
- **Deliberately punts on**: Sybil defense, verifier independence, score aggregation, freshness, resale control. From the EIP text: *"The protocol's contribution is to make signals public and use the same schema."*
- **Implication**: 8004 is the public signal store; someone has to aggregate. No canonical aggregator exists yet. This is the exact role Soma 1.2 is positioned to fill if we frame it correctly.

### Stripe MPP — Machine Payment Protocol (LIVE)

- **Launch**: 2026-03-18.
- **Day-one partners**: 100+ including Anthropic and OpenAI.
- **Model**: session-based with Shared Payment Tokens (SPTs).
- **Relevance**: a session is a natural fold boundary for reception streams. MPP does not know about Soma, but a side-car can observe sessions and produce folded receipts against them. Retail-rail distribution for Soma without requiring Stripe cooperation.

### x402 — Coinbase agent payment protocol (LIVE)

- **Volume**: ~$600M annualized as of Q1 2026.
- **Fees**: zero protocol fees (Coinbase + Cloudflare partnership).
- **Human-proof**: World ID + Coinbase AgentKit integration launched March 2026 — the first productized path for proving the human behind an agent.
- **Relevance**: Soma's heart-billing-spine 5bps metering is compatible (rail-agnostic). World ID + AgentKit is the first real candidate for the `requires-personhood` caveat.

### Google A2A + AP2 — agent discovery and payment (LIVE)

- **A2A**: agent cards, agent-to-agent discovery. Shipped earlier and widely adopted.
- **AP2 (Agent Payment Protocol)**: launched March 2026 with 60+ partners across payment networks (American Express, Mastercard, PayPal, Intuit per public announcements).
- **Model**: Verifiable Digital Credentials (VDCs), Intent Mandates, Cart Mandates.
- **Reputation layer**: **explicitly none**. AP2 is transaction-focused; reputation is designed to come from third-party extensions.
- **Relevance**: if Soma ships an AP2 Mandate adapter for its caveats, it rides onto the partner list as the reputation extension AP2 punted on. First-mover advantage here is significant.

### Dexter marketplace — existing ERC-8004 + x402 glue (LIVE)

- **Position**: Solana-side marketplace combining ERC-8004 agent identity with x402 payments.
- **Risk**: they may already be solving the aggregator problem. Needs a deep-read before Soma commits to the ERC-8004 aggregator positioning — if Dexter is the aggregator, we're late.
- **Upside**: if they're just wiring raw signals without aggregation, the gap is real and Soma can fill it.

### EigenLayer AVS — restaking and EigenVerify (LIVE)

- **TVL**: ~$18B restaked.
- **EigenVerify**: already targets AI inference verification, reputation-based veto committee.
- **Relevance**: Soma verification as an AVS means bonds come from restaked ETH rather than $CLAWNET-only staking. Solves the economic-bribery attack (bond < false-positive value) that Soma's L4 staking otherwise can't handle in Year 1 before $CLAWNET has real demand.

### Nova/Sonobe — recursive proof folding (NOVEL APPLICATION)

- **Status**: genuinely novel application to agent reputation — no prior art found in the search.
- **Relevance**: the folded-session mining tier in `trust-mining-economy.md` is real cryptographic novelty. Smart-contract memory `project_smart_contracts` already tracks Groth16 verifier on Base via Sonobe.
- **Gap**: prover operator economics are unknown. Model cost-per-fold vs. revenue-per-block before building anything.

### MCP 2.4 — CIMD (Client ID Metadata Documents) + OAuth/OIDC (LIVE)

- **New**: identity surface for MCP clients/servers via OAuth 2.0 + OIDC.
- **Relevance**: when agents are discovered via MCP, "who rates whom" needs an identity binding. CIMD is the current answer. Soma's `ratedBy` field in `ReceptionReceipt` should be compatible with CIMD-derived DIDs.

---

## Doc update checklist (what this pressure test drives)

The following edits are triggered by this pressure test and were applied in the same commit pass:

- [x] **Create** `internal/backlog/soma-1-2-adversarial-pressure-test.md` (this file)
- [x] **Update** `internal/backlog/soma-1-2-scope.md` — add ERC-8004 external anchor section, add D4 (mandatory disputer) and D5 (EigenLayer AVS bond source), add AP2 Mandate adapter to integration plan, cross-link this doc
- [x] **Update** `internal/backlog/trust-accountability-teeth.md` — expand "What this does NOT solve" with head equivocation + fault attribution, update verifier collusion to reference mandatory disputer, cross-link this doc
- [x] **Update** `internal/backlog/trust-mining-economy.md` — add outcome log head anchoring requirement, add EigenLayer AVS note, add opt-in pseudonymous requestingDid note, cross-link this doc
- [x] **Update** `internal/backlog/soma-trust-salvage-from-aid.md` — harden RIS formula guidance (expected-cost not observable-distance), correct parent penalty to clawback shape, cross-link this doc
- [x] **Update** `internal/backlog/README.md` — add pressure-test doc to ideas list
- [x] **Update** `memory/MEMORY.md` — add pointer in Soma section

When Phase 1 of Soma 1.2 ships, the "Future considerations" section above becomes the definitive gap list the implementation must close before the architecture can be called 10/10. Until each box is struck, Soma 1.2 is not done.
