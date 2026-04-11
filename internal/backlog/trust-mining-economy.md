# Trust Mining Economy — Commissioned Mining, On-Chain Blocks, Cross-Sell Defense

Status: **backlog / design** — rough, not ratified. New architectural framing.
Opened: 2026-04-11
Related: `moat-compounding-thesis.md`, `soma-1-2-scope.md`, `heart-billing-spine.md`, `trust-accountability-teeth.md`, memory `project_smart_contracts` (Groth16 verifier on Base via Sonobe)

## Core shift: ClawNet profits at mine-time, not read-time

Traditional "sell a trust score" thinking is SaaS-shaped: sell once, lose revenue on resale. **That's wrong for this domain.** The right mental model is closer to ASIC mining or credit-bureau issuance:

> A trust score is produced at a moment in time by a miner who gets paid for that specific production event. After issuance, the score is public. Resale is free and actively good — it expands the index's reach without costing anything, because revenue was collected up front.

This inverts the cross-sell concern. Fear: *"people buy a score and share it, ClawNet doesn't profit."* Reality: ClawNet profits **when the score is mined**. Sharing is data-network-effect fuel — it pulls more eyes onto the index, which pulls more mining requests, which fund more mining revenue.

This is structurally the Moody's model: ratings are published, widely cited, freely resold via Bloomberg and news wires. Moody's makes its money when the obligor commissions the rating, not when Reuters reprints it.

## Three-tier mining market

Mirrors the seven-layer fee stack in `heart-billing-spine.md` but makes the mining structure explicit:

| Tier | What the buyer gets | Compute | Price anchor | Stack layer |
|---|---|---|---|---|
| **Query** | Lookup of current aggregator output | ~0 | 0.03–0.05 cr | L3 |
| **Proof** | Groth16 proof over a specific trust claim | Seconds on a prover | 25 cr | L5 |
| **Folded Session** | Nova-folded recursive proof aggregating N receipts into one compact mined block | Minutes on a prover pool | Market rate per block | L5+ (new) |

A **folded session** is the novel tier. Nova recursion (Sonobe) lets us aggregate a batch of reception receipts into one succinct proof. The output is posted on-chain as a single *trust block*. The buyer paid to commission the mining of that block; afterward, the block is public and anyone can cite it.

## Commissioned mining flow

1. Buyer wants a fresh trust score for Agent X for capability class Y. Buyer pays OpenClaw (or another reference miner) via x402 for tier = Folded Session.
2. Miner responds: *"Estimated readiness at T+Nmin. Fee locked."*
3. Miner pulls recent outcome-log entries for Agent X, runs the reputation aggregator, folds the window into a Nova proof, signs the result.
4. Miner posts the mined block on-chain (Base L2 via Sonobe Groth16 verifier — see memory `project_smart_contracts`).
5. Mined block contains: `agentDid`, `capabilityClass`, `windowStart`, `windowEnd`, `minedAt`, `validUntil`, `requestingDid`, `aggregatorVersion`, `proof`, `outcomeLogCommitment`.
6. Buyer reads the block on-chain (free, public) and makes their decision.

**Revenue event for ClawNet:** step 1 (buyer pays miner, L1 heart-metering fee captured in the x402 payment envelope) and step 4 (Base gas + optional L5 tier fee). Both events happen regardless of how many later parties read the block.

## Freshness binding — the TTL defense

Resale is fine but a *stale* score cited forever is not. Every mined block carries `minedAt` and `validUntil`. Default TTLs by use case:

- Trading / financial decisions: **1 hour**
- Routine delegation: **24 hours**
- Long-lived identity assertions (*does this agent exist?*): **30 days**

Stale scores are still readable but caveats like `min-trust-score` refuse to accept them past `validUntil`. Buyers who need a fresh read commission a new mine. **This is the primary revenue ratchet — freshness, not access control.**

## Context binding — the "for what" defense

A mined block carries `requestingDid` and `capabilityClass`. Resale is permitted, but downstream buyers see *"this was mined for Alice's delegation of `tool:code-review`"* and can judge relevance. If the downstream buyer needs a different capability class, a caveat can refuse to accept the cross-context score.

Moody's-style: ratings are issued *to* specific obligors for specific instruments. A rating of a utility bond doesn't cleanly transfer to a high-yield bond even though both are the same issuer.

Critically, **this is not DRM.** Anyone can read and cite any block. The binding is informational — it lets consumers and caveats intelligently refuse stale-for-purpose data without relying on secrecy.

## Termination of "miners mining miners"

Verifiers are themselves scored by an outcome log (`trust-accountability-teeth.md` §4). Who scores the scorers? The buyer's **purchase decision** is the terminal node. A purchase is not a rating — it's a revealed preference, a fact in the world. Facts don't need verification. **This is the floor at which recursion stops.**

Operationally: a miner's reputation is derived from "how many buyers commissioned a second mine from this miner." Buyers who were disappointed silently stop buying; that absence shows up in the miner's volume, which shows up in the miner's own aggregator score. No additional recursive rater needed.

## OpenClaw as first consumer-level miner (dual role)

Nova (ClawAPIs / HeyDATA) is already named as the first reference **verifier** (`soma-1-2-scope.md` §"Nova as reference verifier"). The proposal here: **the same agent runs as the first reference miner.** Dual role:

- **Verifier role** — called by buyers with `requires-verification` caveats to produce reception receipts for individual actions.
- **Miner role** — called by buyers who want a folded trust block for a target agent, aggregating receipts from the outcome log into a Nova proof.

The two roles reinforce each other:

- A verifier with good reputation is naturally trusted as a miner because its receipt-production history is already public.
- Miners who produce useful blocks drive more buyers to use the verifier side.
- Same DID, same heart, same staking position — just two product surfaces on top of the same primitives.

This is the OpenClaw product shape: an x402-native agent that both verifies actions and mines trust blocks, whose revenue flows through the heart billing spine, and whose own reputation is computed by the same system it serves.

## Smart contract alignment

Sonobe + Groth16 verifier on Base (memory `project_smart_contracts`) is the canonical landing spot for folded-session blocks. The missing link between that memory and this mining architecture is the **per-block revenue event**. Each mined block is a discrete payment:

- Buyer pays miner in x402 envelope (heart metering spine takes L1 fee)
- Miner pays Base gas to post block (negligible, ~$0.001)
- Miner optionally pays L5 trust-product fee to ClawNet protocol treasury in the same on-chain call
- Block is a standing reference anyone can cite

The Groth16 verifier contract on Base should expose a `mintTrustBlock(proof, metadata)` entry point that checks the proof and the L5 fee in the same transaction. Sonobe folding lets us batch arbitrarily many receipts into one on-chain call — critical for amortizing gas across receipt volume.

## What this lets us say to buyers

*"You don't buy a trust score — you commission a mining session. We compute, fold, and anchor a proof on Base. The proof is yours to cite, share, resell. The next time you need fresh data, you commission another session. We get paid for the mining, not for access."*

That framing is dramatically cleaner than subscription or per-query pricing, and it matches the way insurance underwriters and compliance teams already think about third-party risk data.

## Open questions

1. **Who runs the Nova prover pool?** Options:
   - (a) ClawNet runs first-party provers at cost — contradicts D3 neutrality in `soma-1-2-scope.md`
   - (b) Ecosystem grants bootstrap independent prover operators
   - (c) Heart operators opt in as provers and earn emissions for proving work
   - **Default: (c)** — aligns with "Supply side: heart operators earn $CLAWNET for publishing outcome log heads and serving as gossip peers" in `heart-billing-spine.md`.

2. **What TTL is defensible?** 1h for trading feels tight but accurate; 24h for routine delegation is comfortable; 30d for identity assertions may be too loose. Needs modeling against the specific use cases OpenClaw will see in Year 1.

3. **On-chain window: commitment or full data?** A commitment is cheaper and still verifiable (the miner serves the window off-chain for challenge-response). Probably commitment-only at launch, window-on-chain as an optional premium tier later.

4. **How does this interact with L4 staking?** Miners who produce provably bad blocks (dispute succeeds) should be slashed in the same way verifiers who issue bad receipts are slashed. The staking pool and slashing mechanism can be shared across roles.

5. **Public-goods miner?** Analogous to D3's public-goods verifier carve-out — should ClawNet run a public-goods Nova prover for open-source supply-chain trust blocks at cost? Same risks (drift to profit) apply. Default to strict neutrality unless a specific champion appears.

## What this does NOT depend on

- Does not depend on OpenClaw shipping specifically; any agent with a heart can be the first miner. OpenClaw is the first candidate because of existing HeyDATA alignment.
- Does not depend on Nova/Sonobe winning the ZK landscape; any folding-capable proof system works. Sonobe is the concrete first pick.
- Does not depend on trust scores being a consumer product. The same infrastructure serves B2B compliance (regulatory) and insurance actuarial (Year 3+) use cases.

## Kill metric

Parallels the `moat-compounding-thesis.md` kill metric: **if 18 months after the first mining tier launches, fewer than 10 independent miners exist AND less than $100K/month in mining revenue flows through reference hearts, the commissioned-mining model is broken.** Pivot target: trust scores as a flat subscription service (less interesting, but validated in credit bureaus).

## Next steps (design, not yet build)

1. Ratify the three-tier model and per-tier revenue events into `soma-1-2-scope.md` billing-spine section.
2. Add `mintTrustBlock` entry point to the smart-contracts plan.
3. Decide the prover-operator question (Open Q#1) before writing any prover code.
4. Draft the folded-session output schema so Nova folding has a target format.
5. Cross-link with `trust-accountability-teeth.md` so reputation-aggregator output and mined-block output use the same canonical struct — one aggregator produces both a query-tier number and a folded-session proof.
