# AID Open Concerns

> Problems that are fundamentally hard — not "hasn't been built yet."
> Each concern has a real tension, an unknown, or a dependency we can't control.
> Review at the start of every session. If something gets resolved, move to CLOSED with rationale.
> Updated: March 24, 2026.

---

## SEVERITY LEVELS

- **RED** — Could kill AID's credibility or viability. No known solution that fully resolves it.
- **ORANGE** — Real tension between competing goals. Current approach is a bet, not a proof.
- **YELLOW** — External dependency we can't control. Mitigations exist but don't eliminate the risk.

---

## RED — Existential / Credibility Risks

### R1: The Security Model Is Conjectured, Not Proven

**The problem:** AID's entire game-theoretic argument rests on estimated detection probabilities (p=0.15/round for Sybil, p=0.95 for bust-out) that have never been measured. The Nash equilibrium proof depends on these numbers. If actual detection rates are lower — say p=0.05 for Sybil — the equilibrium flips and gaming becomes rational.

**What we've proposed:** Monte Carlo simulation harness (10K agents x 100K rounds). This would turn "we believe" into "we measured."

**Why it's still hard:** Simulation validates the *model*, not *reality*. Real attackers don't follow the strategy space we defined. A simulation that shows p=0.15 under our assumptions doesn't prove p=0.15 in production. The formal security bound remains conjectured even after simulation. We can strengthen the argument but can't close it mathematically without a formal proof — and that proof may not be achievable for a system this complex.

**What would close it:** Either (a) formal proof (unlikely — reputation systems don't have clean security reductions like crypto protocols), or (b) 12+ months of production data showing actual detection rates match or exceed estimates. The simulation is necessary but not sufficient.

**AIDplan refs:** Part 3 D.6-D.7, Opus #1, 10/10 Day 5

---

### R2: Deterministic Arithmetic Across Implementations

**The problem:** JavaScript `64-bit float` produces different intermediate results than Rust `f64` or Python `Decimal`. If two honest implementations compute different trust scores for the same inputs, fraud proofs collapse — the entire optimistic oracle architecture (Phase 2 decentralization) breaks because you can't prove a score is "wrong" if there's no canonical "right."

**What we've proposed:** Fixed-point arithmetic with 6 decimal places, integer weights (3500 = 35.00%), reference test vectors with exact intermediate values.

**Why it's still hard:** Fixed-point solves the representation problem but not the computation order problem. `(a * b) + (c * d)` vs `(a * b + c * d)` can differ at the 6th decimal due to intermediate rounding. The spec must prescribe exact computation ORDER, not just representation. This is why IEEE 754 exists and why financial systems use specialized libraries. We're essentially building a financial computation standard — that's hard to get right and harder to get adopted consistently across npm, pip, and Rust crates.

**What would close it:** Publish reference implementation in all 3 languages (TS/Python/Rust) with test vectors that include every intermediate value. If all three produce identical outputs for 1000 test cases, the spec is sound. But maintaining cross-language determinism over time (library updates, platform changes) is an ongoing burden.

**AIDplan refs:** Opus #16 (CRITICAL), 10/10 cross-cutting

---

### R3: ClawNet Is Still the Only Trust Oracle

**The problem:** Despite the decentralization roadmap, AID trust scores are currently computed exclusively by ClawNet. All four decentralization phases are deferred. If ClawNet goes down, gets compromised, or acts maliciously, there's no alternative oracle. This is the exact single-point-of-failure that blockchain protocols exist to solve, and we haven't solved it.

**What we've proposed:** Progressive decentralization: Phase 1 (publish data + Merkle root on-chain), Phase 2 (optimistic oracle with fraud proofs), Phase 3 (federated oracles), Phase 4 (ZK proofs).

**Why it's still hard:** Phase 2 (optimistic oracle) only works if someone actually runs a challenger. If nobody bothers, the system is de facto centralized forever — a "decentralized" system that nobody participates in is worse than an honest centralized one because it provides false assurance. Phase 3 (federated oracles) requires 3-5 independent operators who are economically motivated to run infrastructure — but without a token, what's their incentive? Phase 4 (ZK) requires circuit development expertise we don't have.

**The deeper tension:** Decentralizing trust computation is fundamentally harder than decentralizing transactions. Bitcoin validators check simple rules (valid signatures, unspent outputs). Trust oracle validators must run a complex scoring formula over a large dataset. The computational and data requirements create natural centralization pressure.

**What would close it:** Phase 1 (data publication) is achievable and genuinely useful — it makes ClawNet auditable even while centralized. But full decentralization may require a token for oracle operator incentives, which creates securities risk (R5). Catch-22.

**AIDplan refs:** Part 5 D (Progressive Decentralization), Flaw 1, Flaw 7

---

## ORANGE — Real Tensions / Unproven Bets

### O1: All Scoring Parameters Are Empirically Motivated

**The problem:** Every key parameter in the trust formula is a judgment call with no principled derivation:
- counterpartyDiversity weight: 15% (why not 10% or 20%?)
- Dispute rate exponent: 2 (why not 1.5 or 3?)
- Exponential decay half-life: 30 days (why not 14 or 60?)
- Verification multiplier: 1.0/1.1/1.2 (why these steps?)
- Trust input hierarchy: 1.0/0.7/0.5/0.3/0.1 (why these weights?)

Each parameter has a plausible argument but none has a mathematical derivation. We chose "goldilocks" values between obvious extremes and called it empirical motivation.

**Why it's hard:** Reputation systems don't have first-principles parameter derivation. Unlike cryptographic systems where key sizes derive from computational hardness assumptions, trust scoring parameters derive from... intuition about what "feels right" for commerce. Credit bureaus (FICO) calibrated their weights over decades of outcome data. We have zero outcome data.

**The tension:** If we publish exact parameters in the DIF spec, they become carved in stone. If we keep them configurable, "deterministic scoring" breaks (every operator picks different weights). The governance model (formula versioning with 30-day announcement) is a process answer to a mathematical question.

**What would help:** The simulation harness (R1) would at least show which parameters are sensitive (small changes in weight = large changes in gaming cost) vs robust (parameter doesn't matter much). That narrows the problem even if it doesn't solve it. Long-term: production outcome data calibrates parameters, like FICO did over 30 years.

**AIDplan refs:** Part 2 A.5, Part 3 D.5

---

### O2: EigenTrust Convergence Under Adversarial Graphs

**The problem:** EigenTrust assumes the interaction graph has a large spectral gap (well-connected, no dominant clusters). Real agent networks may not have this property — especially early on with <500 nodes, or under Sybil attack where adversarial structure is specifically designed to degrade convergence.

**What we've proposed:** Smooth bootstrap transition (guardian seeds blend with algorithmic), convergence fallback to direct scoring (v1.0) if delta > 1e-6 after 50 iterations, spectral gap monitoring.

**Why it's still hard:** The fallback to v1.0 means that under adversarial conditions, we silently lose Sybil suppression — exactly when we need it most. The spectral gap threshold (0.01) is empirically chosen. The seed rotation (every 500 nodes) is an arbitrary threshold. And the smooth transition function eliminates the hard cutoff exploit but introduces a new question: what's the optimal transition curve? We don't know.

**The deeper issue:** EigenTrust was designed for P2P file sharing (Kamvar et al. 2003), not financial commerce. The adversary model is different — P2P attackers provide bad files; commerce attackers perform well for months then defect. EigenTrust has no temporal dimension. We've bolted exponential decay onto it, but the interaction between EigenTrust graph weights and temporal decay is unexplored territory.

**What would help:** Run EigenTrust on synthetic adversarial graphs (part of the simulation harness, R1). If convergence fails on plausible attack topologies, we need a different graph algorithm — not just parameter tuning.

**AIDplan refs:** 10/10 Day 3, Part 3 D.3, Opus #2

---

### O3: Commitment Log Completeness Depends on Cooperation

**The problem:** Dual-party commitment logs are the core integrity mechanism — they make selective receipt omission detectable. But detection requires cross-referencing BOTH parties' logs. If one party goes offline permanently, their log is lost. If both parties collude, they can jointly omit a receipt. The system detects unilateral cheating but not bilateral collusion.

**What we've proposed:** Bloom filter summaries (O(1) cross-reference), epoch compaction (storage bounds), liveness grace period (0-24h unconfirmed, 24-72h late, >72h omitted).

**Why it's still hard:** The liveness grace period penalties (0.9x for late, 0.5x for omitted) are empirically chosen with no model of legitimate vs malicious downtime distributions. A legitimate server with 99.9% uptime still has ~8.7 hours of downtime/year — enough to trigger multiple "late" entries and integrity penalties. The system punishes reliability failures and malicious omission with the same mechanism, just different thresholds.

**The deeper tension:** Strong completeness guarantees require on-chain anchoring of EVERY receipt (expensive, ~$0.001 each at scale). Weak guarantees (periodic Merkle roots) leave a window for omission between snapshots. We've chosen weak guarantees with cross-referencing as a compromise, but it's a compromise — not a solution.

**What would close it:** On-chain anchoring at the commitment log level (not just trust score level) would make omission impossible. But at 10K receipts/day that's $10/day in gas just for commitment anchoring. The economics don't work until rollup costs drop further or a dedicated AID chain exists.

**AIDplan refs:** Part 2 B.4-B.5, 10/10 Day 1, Opus #3 and #6

---

### O4: Privacy vs Fingerprinting

**The problem:** A trust score of 87 with 1,247 attestations from 340 unique counterparties is a unique fingerprint. Anyone seeing these numbers can correlate across platforms and deanonymize the agent. But making scores less precise (verdict-only: "trusted") reduces their utility for pricing and routing decisions.

**What we've proposed:** Three privacy modes: open (full score), shielded (verdict tier only, 10-point anonymity set), ZK (Phase 3+, prove "score > 60" without revealing value).

**Why it's still hard:** Shielded mode destroys the granular pricing advantage — all agents in the "trusted" tier (80-89) pay the same price, eliminating the incentive to improve from 80 to 89. ZK range proofs are Phase 3+ and require circuit development. And even shielded mode leaks information: the transition from "standard" to "trusted" reveals you crossed 80. Over time, observing tier transitions reconstructs an approximate score trajectory.

**The deeper tension:** AID's entire value proposition is "scored, verifiable, portable trust." Privacy works against all three. Scoring requires data. Verifiability requires transparency. Portability requires sharing. The protocol inherently trades privacy for utility. We can mitigate but not eliminate this tension.

**What would help:** ZK range proofs would let agents prove tier membership without exact scores. But ZK adoption in agent commerce is speculative — no other protocol has shipped this for trust scores. It's a research bet.

**AIDplan refs:** Vector 53, Part 3 E.4, Cherry 13 (Pedersen commitments)

---

### O5: Guardian Accountability (Who Watches the Watchers?)

**The problem:** Guardian agents can freeze other agents. Guardian precision tracking (correct_freezes / total_freezes) helps, but guardians can collude with each other or be bribed. The protocol-assigned secondary guardian mitigates single-guardian compromise, but if the guardian pool is small (say, 10 guardians), collusion between 2-3 is plausible.

**What we've proposed:** Anti-concentration rules (max 10% per guardian, max 15% related, max 30% top-3), precision tracking with demotion at <0.8 and removal at <0.5, protocol-assigned rotating secondary guardian.

**Why it's still hard:** "Correct freeze" is defined as "not overturned within appeal window" — but who adjudicates the appeal? If guardians form the adjudication committee, we have circularity. If ClawNet adjudicates, we're back to centralization. The precision metric also has a cold-start problem: a new guardian with 2 correct freezes out of 2 has precision 1.0 but very low confidence.

**The deeper tension:** Autonomous containment (Part 3 C) is AID's most novel feature — "agents watching agents." But autonomous systems need meta-governance. Bitcoin solved this with proof-of-work (physics-backed). AID doesn't have an equivalent anchoring mechanism for guardian accountability. It's turtles (almost) all the way down.

**What would help:** Guardian staking (economic bond at risk) would add skin-in-the-game. But that requires a token (R3 catch-22) or USDC staking (regulatory complexity). No clean solution exists yet.

**AIDplan refs:** Part 3 C (Gap 1, 7), Opus #9, Section 39.20

---

### O6: The Standard vs Product Race

**The problem:** AID positions as a standard ("SMTP"), not a product ("Gmail"). But Mnemom has shipping ZK proofs, npm/pip packages, and OpenClaw integration today. PayCrow has live x402 escrow with trust scoring. If either gets enough adoption before AID's DIF submission gains traction, the "standard" positioning becomes irrelevant — nobody adopts a standard after the market has already picked a product.

**Why it's hard:** Standards adoption depends on ecosystem buy-in, which depends on credibility, which depends on implementations, which depends on adoption. Chicken-and-egg. The DIF submission is the leverage point, but DIF moves slowly (6-18 months to ratification). Mnemom could ship 10 more features in that time.

**The bet we're making:** That protocol-agnostic profiles (MCP, A2A, x402, MPP) + DIF/NIST engagement + no token dependency gives AID a structural advantage over products. That enterprises will choose a standard over a product when both exist. That the 20,000 MCP servers with zero trust create a distribution opportunity that products can't fill as efficiently.

**What could invalidate it:** Mnemom gets DIF engagement. PayCrow gets absorbed by Coinbase. Google ships trust scoring as part of A2A v2. Any of these would undercut the "only standard" positioning.

**This isn't solvable — it's a strategic bet.** The mitigation is speed: ship the DIF submission, get external implementations, build the coalition. But the outcome depends on competitors' moves, not just ours.

**AIDplan refs:** Part 4 A (Strategic Positioning), Part 4 D (Competitive Steal Playbook)

---

## YELLOW — External Dependencies We Can't Control

### Y1: Regulatory Classification of Trust Scores

**The problem:** If trust scores determine pricing and access, they may be classified as "high-risk AI" under EU AI Act (Annex III 5b) or trigger FCRA obligations in the US. We have a legal disclaimer but no legal opinion. A disclaimer doesn't stop a regulator.

**What we can do:** Submit NIST comment (positions AID favorably). Design transparency features (explain API, dispute mechanism). Monitor regulatory developments. But the classification decision is made by regulators, not by us.

**Why it matters:** FCRA compliance would require adverse action notices, dispute rights, accuracy obligations, and limits on access — fundamentally changing the protocol's openness. EU AI Act could require conformity assessments before deployment.

**What would help:** Actual legal counsel review ($5K-20K). Regulatory sandbox enrollment (Wyoming, UK FCA). But these cost money we may not have yet.

**AIDplan refs:** Part 5 E.5 (Section 33.5)

---

### Y2: Money Transmitter Risk on Creator Payouts

**The problem:** Collecting USDC from agents, keeping 15%, and paying 85% to creators may constitute money transmission under FinCEN. The "pull-based withdrawal" mitigation is a legal theory — no authority has confirmed it works.

**What we can do:** Use pull-based withdrawals (creator initiates). Explore smart contract escrow (ClawNet never touches funds). Research regulatory sandboxes.

**Why it matters:** Operating as an unlicensed MSB is a federal crime. State-by-state licensing costs $50K-200K+. This could shut down the entire payout system.

**AIDplan refs:** Part 5 E.1 (Section 33.1), Flaw 12

---

### Y3: Base L2 Single Point of Failure

**The problem:** All Merkle anchoring targets Base (Coinbase-operated sequencer). If Base has an extended outage, trust snapshots can't be anchored, and the "verifiable computation" property degrades to "trust ClawNet." We've proposed dual-chain anchoring (Base + Ethereum mainnet) but it's not built.

**What we can do:** Build dual-chain anchoring (Phase 1 item, low effort). But even dual-chain doesn't help if both chains are congested simultaneously. And Ethereum mainnet anchoring is expensive ($0.50-5 per tx).

**Why it matters:** Base had a 2-hour sequencer outage in 2024. If that happens during a high-volume period, trust verification degrades for all AID-enabled services simultaneously.

**AIDplan refs:** Part 3 F.11 (Vector 58)

---

### Y4: USDC Pause Risk

**The problem:** Circle can pause USDC globally. If USDC is paused for days or weeks, all batched/deferred settlements fail. The 5% insurance reserve partially compensates but doesn't make agents whole.

**What we can do:** Detect pause (USDC.paused() check), revert to immediate mode, freeze batches. But we can't settle during a pause — that's Circle's unilateral power over the entire x402/AID ecosystem.

**Why it matters:** USDC has never been paused globally, but it HAS been paused on specific chains. As stablecoin regulation tightens (EU MiCA, US stablecoin bills), the probability of compliance-driven pauses increases.

**AIDplan refs:** Part 3 F.7 (Vector 35)

---

### Y5: Gas Price Volatility on Settlement

**The problem:** Settlement economics assume Base L2 gas at ~0.005 gwei ($0.001/tx). During congestion, gas can spike 100x+. The gas circuit breaker (pause at 10x 7-day average) helps but means settlement stops during spikes — which may be exactly when it's most needed (high-volume events).

**What we can do:** Circuit breaker, batch settlement (amortize across fewer txs), maintain gas buffer. But we can't control Base gas prices.

**Why it matters:** A $100/month gas budget at normal rates becomes $10,000/month during a sustained spike. The protocol becomes economically unviable for micropayments during congestion.

**AIDplan refs:** Part 3 F.15 (Vector 43), Part 5 A

---

## CLOSED

*Nothing here yet. When a concern is resolved, move it here with the date and rationale.*

*Example format:*
*### [C1] Former concern title*
*Closed: 2026-XX-XX. Reason: [what changed]. See AIDplan Section X.*
