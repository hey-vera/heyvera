# AID Open Concerns

> Problems that are fundamentally hard — not "hasn't been built yet."
> Each concern has a real tension, an unknown, or a dependency we can't control.
> Review at the start of every session. If something gets resolved, move to CLOSED with rationale.
> Resist the urge to "solve" these by adding more items to the AIDplan. These are concerns to monitor, not tasks to complete.
> Updated: March 24, 2026. **19 concerns (4 RED, 9 ORANGE, 4 YELLOW, 2 operational) + dependency map.**

---

## SEVERITY LEVELS

- **RED** — Could kill AID's credibility or viability. No known solution that fully resolves it.
- **ORANGE** — Real tension between competing goals. Current approach is a bet, not a proof.
- **YELLOW** — External dependency we can't control. Mitigations exist but don't eliminate the risk.
- **[DIF-BLOCKING]** — Tag applied to concerns that directly affect the DIF submission timeline.

---

## DEPENDENCIES BETWEEN CONCERNS

```
R1 (security conjectured) ←── depends on ──→ O1 (parameters empirical)
   Both need the simulation harness. If it doesn't get built, BOTH stay open.

R2 (deterministic arithmetic) ──→ R3 (single oracle)
   Fraud proofs require deterministic scores. No determinism = no decentralization.

R4 (DIF credibility gap) ──→ R1 + R2 + O7/O9
   DIF presentation assumes simulation results, deterministic spec, and external impl.
   All three are unbuilt.

O5 (guardian accountability) ←── undermined by ──→ R3 (single oracle)
   Guardians scored by the same system they protect. Compromised oracle = compromised guardians.

O6→R4 (standard race) ──→ O9 (no external impl)
   Standard positioning requires multi-implementer interest. Zero external impls = weak DIF case.

O1 (parameters) ──→ each new dimension compounds it
   valueDiversity (Phase 3 candidate) adds another empirically-motivated parameter.
```

---

## RED — Existential / Credibility Risks

### R1: The Security Model Is Conjectured, Not Proven [DIF-BLOCKING]

**The problem:** AID's entire game-theoretic argument rests on estimated detection probabilities (p=0.15/round for Sybil, p=0.95 for bust-out) that have never been measured. The Nash equilibrium proof depends on these numbers. If actual detection rates are lower — say p=0.05 for Sybil — the equilibrium flips and gaming becomes rational.

These specific probabilities appear in BOTH the Nash equilibrium proof AND the per-dimension cost-to-manipulate tables (Part 3 D.3-D.6). If a DIF reviewer asks "where does 0.15 come from?" the honest answer is "we estimated it." Opus Review 3 ranked the simulation harness as the #1 priority and stated: **"presenting a game-theoretic security argument without empirical backing to a room of cryptographers is the one thing that could sink credibility irreversibly."**

**What we've proposed:** Monte Carlo simulation harness (10K agents x 100K rounds). This would turn "we believe" into "we measured."

**Why it's still hard:** Simulation validates the *model*, not *reality*. Real attackers don't follow the strategy space we defined. A simulation that shows p=0.15 under our assumptions doesn't prove p=0.15 in production. The formal security bound remains conjectured even after simulation. We can strengthen the argument but can't close it mathematically without a formal proof — and that proof may not be achievable for a system this complex.

**What would close it:** Either (a) formal proof (unlikely — reputation systems don't have clean security reductions like crypto protocols), or (b) 12+ months of production data showing actual detection rates match or exceed estimates. The simulation is necessary but not sufficient.

**AIDplan refs:** Part 3 D.6-D.7, Opus #1 (CRITICAL), 10/10 Day 5

---

### R2: Deterministic Arithmetic Across Implementations [DIF-BLOCKING]

**The problem:** JavaScript `64-bit float` produces different intermediate results than Rust `f64` or Python `Decimal`. If two honest implementations compute different trust scores for the same inputs, fraud proofs collapse — the entire optimistic oracle architecture (Phase 2 decentralization) is **architecturally broken**, not just inconvenient. Without determinism, you can't prove a score is "wrong" because there's no canonical "right."

**What we've proposed:** Fixed-point arithmetic with 6 decimal places, integer weights (3500 = 35.00%), reference test vectors with exact intermediate values. Listed as Opus #16 CRITICAL.

**Why it's still hard:** Fixed-point solves the representation problem but not the computation order problem. `(a * b) + (c * d)` vs `(a * b + c * d)` can differ at the 6th decimal due to intermediate rounding. The spec must prescribe exact computation ORDER, not just representation. This is why IEEE 754 exists and why financial systems use specialized libraries.

**Immediate credibility risk:** The current `@aidprotocol/trust-compute@2.0.0` on npm presumably uses JavaScript floats. If someone installs the published package today and gets different results than the spec describes, that's a credibility problem on day one — the published implementation contradicts the proposed spec before DIF even sees it.

**What would close it:** Publish reference implementation in all 3 languages (TS/Python/Rust) with test vectors that include every intermediate value. If all three produce identical outputs for 1000 test cases, the spec is sound. But maintaining cross-language determinism over time (library updates, platform changes) is an ongoing burden.

**AIDplan refs:** Opus #16 (CRITICAL), 10/10 cross-cutting

---

### R3: ClawNet Is Still the Only Trust Oracle

**The problem:** Despite the decentralization roadmap, AID trust scores are currently computed exclusively by ClawNet. All four decentralization phases are deferred. If ClawNet goes down, gets compromised, or acts maliciously, there's no alternative oracle.

**What we've proposed:** Progressive decentralization: Phase 1 (publish data + Merkle root on-chain), Phase 2 (optimistic oracle with fraud proofs), Phase 3 (federated oracles), Phase 4 (ZK proofs).

**Why it's still hard:** Phase 2 only works if someone actually runs a challenger. Phase 3 requires 3-5 independent operators economically motivated to run infrastructure — but without a token, what's their incentive? Phase 4 requires circuit development expertise we don't have. Decentralizing trust computation is fundamentally harder than decentralizing transactions because validators must run a complex formula over a large dataset.

**The bootstrap paradox within the paradox:** Even after publishing `@aidprotocol/trust-compute` as open-source, someone must actually RUN it independently against published attestation data and compare results. Every decentralization roadmap in crypto stalls at Phase 1 because "anyone CAN verify" doesn't mean "anyone DOES verify." If we ship Phase 1 and nobody runs trust-compute independently for 6 months, the "trust-minimized" claim is marketing, not a technical property.

**Verification threshold:** If fewer than 3 independent parties have run trust-compute against published data within 6 months of Phase 1 launch, escalate this to RED-CRITICAL.

**What would close it:** Phase 1 (data publication) makes ClawNet auditable. Full decentralization may require a token for oracle incentives, which creates securities risk. Catch-22.

**AIDplan refs:** Part 5 D (Progressive Decentralization), Flaw 1, Flaw 7

---

### R4: DIF Credibility Gap — Slides Promise What Isn't Built [DIF-BLOCKING]

**The problem:** The entire 10/10 plan is 100% unchecked. Every item is ⬜. This includes DSIRs (Day 1), receipt-primary scoring (Day 2), EigenTrust (Day 3), trust vector APIs (Day 4), reputational staking (Day 5), AND all cross-cutting items (deterministic arithmetic, simulation harness, threat model doc, E2E tests). Meanwhile, the DIF presentation slides assume these exist: Slide 1 is "Show me the receipts — DSIRs vs attestations," Slide 3 is "EigenTrust — sybil suppression via linear algebra," Slide 4 references simulation results.

**The 57% completion rate is misleading.** The completed items are mostly infrastructure (Ed25519 signing, Merkle trees, attestation system, middleware). The uncompleted items ARE the protocol's differentiating features. Presenting infrastructure as protocol innovation would be dishonest; presenting unbuilt features as capabilities would be worse.

**Why it's hard:** Building all of this to spec quality takes weeks. The plan says "DIF window is DAYS, not weeks." You can't present unbuilt features as protocol capabilities, but presenting without them makes AID look like "x402 with identity headers" rather than "the trust standard."

**What would help:** Triage ruthlessly. Minimum honest DIF set is probably: (1) deterministic arithmetic spec (1 day), (2) standalone threat model extraction (1 day of editing), (3) rewrite slides to match what's actually built. Present the 10/10 plan as "our roadmap" not "our implementation." Say "designed and specified, implementation in progress" — and mean it. Accept that Opus Review 3's Slide 4 (simulation results) cannot be presented as data.

**AIDplan refs:** 10/10 Plan (all days), Opus Review 3 priority order, BUILD PROGRESS CHECKLIST

---

## ORANGE — Real Tensions / Unproven Bets

### O1: All Scoring Parameters Are Empirically Motivated

**The problem:** Every key parameter in the trust formula is a judgment call with no principled derivation:
- counterpartyDiversity weight: 15% (why not 10% or 20%?)
- Dispute rate exponent: 2 (why not 1.5 or 3?)
- Exponential decay half-life: 30 days (why not 14 or 60?)
- Verification multiplier: 1.0/1.1/1.2 (why these steps?)
- Trust input hierarchy: 1.0/0.7/0.5/0.3/0.1 (why these weights?)
- valueDiversity coefficient of variation threshold (Phase 3 candidate — adds another)

Each parameter has a plausible argument but none has a mathematical derivation. Each new dimension added compounds the calibration problem.

**Why it's hard:** Reputation systems don't have first-principles parameter derivation. Credit bureaus (FICO) calibrated weights over decades of outcome data. We have zero outcome data.

**The tension:** If we publish exact parameters in the DIF spec, they become carved in stone. If we keep them configurable, "deterministic scoring" breaks. The governance model (formula versioning with 30-day announcement) is a process answer to a mathematical question.

**What would help:** The simulation harness (R1) would show which parameters are sensitive vs robust. **But R1 and O1 share the same dependency** — if the simulation doesn't get built, BOTH stay unresolved.

**AIDplan refs:** Part 2 A.5, Part 3 D.5

---

### O2: EigenTrust Convergence Under Adversarial Graphs

**The problem:** EigenTrust assumes the interaction graph has a large spectral gap. Real agent networks may not have this property — especially early on with <500 nodes, or under Sybil attack.

**What we've proposed:** Smooth bootstrap transition, convergence fallback to direct scoring (v1.0) if delta > 1e-6 after 50 iterations, spectral gap monitoring.

**Why it's still hard:** The fallback to v1.0 means that under adversarial conditions, we silently lose Sybil suppression — exactly when we need it most. The spectral gap threshold (0.01) and seed rotation interval (500 nodes) are empirically chosen — same problem as O1 but for a different subsystem.

**Current status:** The entire EigenTrust implementation is ⬜ unchecked in the 10/10 plan. The convergence hardening (smooth transition, fallback) is designed but **not built or tested**. We're presenting design as capability.

**The deeper issue:** EigenTrust was designed for P2P file sharing (Kamvar 2003), not financial commerce. Commerce attackers perform well for months then defect. EigenTrust has no temporal dimension. We've bolted exponential decay onto it, but the interaction between graph weights and temporal decay is unexplored territory.

**What would help:** Run EigenTrust on synthetic adversarial graphs (part of the simulation harness, R1). If convergence fails on plausible attack topologies, we need a different graph algorithm.

**AIDplan refs:** 10/10 Day 3, Part 3 D.3, Opus #2

---

### O3: Commitment Log Completeness Depends on Cooperation

**The problem:** Dual-party commitment logs make selective receipt omission detectable. But detection requires cross-referencing BOTH parties' logs. If one party goes offline permanently, their log is lost. If both parties collude, they can jointly omit a receipt.

**What we've proposed:** Bloom filter summaries (O(1) cross-reference), epoch compaction (storage bounds), liveness grace period (0-24h unconfirmed, 24-72h late, >72h omitted).

**Why it's still hard:** The liveness penalties (0.9x for late, 0.5x for omitted) are empirically chosen. A server with 99.9% uptime still has ~8.7h downtime/year — enough for multiple "late" entries. The system punishes reliability failures and malicious omission with the same mechanism, just different thresholds.

**The deeper tension:** Strong completeness requires on-chain anchoring of EVERY receipt (~$0.001 each). Weak guarantees (periodic Merkle roots) leave a window for omission. We chose weak guarantees with cross-referencing — a compromise, not a solution.

**AIDplan refs:** Part 2 B.4-B.5, 10/10 Day 1, Opus #3 and #6

---

### O4: Privacy vs Fingerprinting

**The problem:** A trust score of 87 with 1,247 attestations from 340 counterparties is a unique fingerprint. But making scores less precise reduces their utility for pricing.

**What we've proposed:** Three privacy modes: open, shielded (verdict-only, 10-point anonymity set), ZK (Phase 3+).

**The deeper tension:** AID's value proposition is "scored, verifiable, portable trust." Privacy works against all three. The protocol inherently trades privacy for utility. We can mitigate but not eliminate this.

**AIDplan refs:** Vector 53, Part 3 E.4, Cherry 13

---

### O5: Guardian Accountability (Who Watches the Watchers?)

**The problem:** Guardian agents can freeze other agents. Guardian precision tracking (correct_freezes / total_freezes, Opus #9) helps, but guardians can collude or be bribed. The protocol-assigned secondary guardian mitigates single-guardian compromise, but a small guardian pool (say 10) makes collusion between 2-3 plausible.

**What we've proposed:** Anti-concentration rules (max 10%/15%/30%), precision tracking with demotion at <0.8 and removal at <0.5 (Opus #9), protocol-assigned rotating secondary guardian.

**Why it's still hard:** "Correct freeze" = "not overturned within appeal window" — but who adjudicates? If guardians adjudicate, circularity. If ClawNet adjudicates, centralization. The precision metric also has a cold-start problem (2/2 = perfect, low confidence).

**The deeper circularity:** Guardians are scored by the same trust system they protect. If the trust oracle is compromised (R3), guardian scores can be manipulated to suppress legitimate guardians. This means O5 is partially dependent on R3 being resolved.

**What would help:** Guardian staking (economic bond). But that requires a token (R3 catch-22) or USDC staking (regulatory complexity).

**AIDplan refs:** Part 3 C (Gap 1, 7), Opus #9, Section 39.20

---

### O6: The Standard vs Product Race → Upgraded to RED-Adjacent [DIF-BLOCKING]

**The problem:** AID positions as a standard. Mnemom has shipping ZK proofs (SP1, $0.005/proof), npm/pip packages, and OpenClaw integration today. PayCrow has live x402 escrow with trust scoring. If either gets enough adoption before AID's DIF submission gains traction, the "standard" positioning collapses from "the trust standard" to "another trust product competing with Mnemom."

**Why this is worse than ORANGE:** The DIF TAAWG submission is still ⬜ unchecked. The plan says "DIF window is DAYS, not weeks" — repeated with urgent language. The DIF Newsletter #59 shows the new Executive Director made AI agent identity the primary direction for 2026, meaning the window is open but competitive. Mnemom doesn't need DIF approval to ship. Every month the standard takes to ratify, products gain more adoption.

**The bet we're making:** Protocol-agnostic profiles + DIF/NIST engagement + no token dependency gives AID a structural advantage. That enterprises will choose a standard over a product.

**What could invalidate it:** Mnemom gets DIF engagement. PayCrow gets absorbed by Coinbase. Google ships trust scoring as part of A2A v2.

**This isn't solvable — it's a strategic bet with a closing window.** The mitigation is speed: ship the DIF submission, get external implementations, build the coalition. But the outcome depends on competitors' moves AND DIF's pace, not just ours.

**AIDplan refs:** Part 4 A, Part 4 D, DIF Newsletter #59

---

### O7: No External Implementation (Broader Than DSIR) [DIF-BLOCKING]

**The problem:** DSIRs need two parties (bilateral receipts are unilateral if ClawNet signs both sides). But the broader issue is that the external implementation commitment strategy (Part 5 H) "hasn't produced results yet." The plan explicitly states the need for at least ONE external implementation before DIF: "If ClawNet is the only implementation when presenting to DIF, it looks like 'one company proposing its own protocol.'" The deliverable was "AID trust scoring is... in evaluation by [external operator name]." That bracket is still empty.

**Why it's distinct from just DSIR:** This is about DIF social credibility. Standards bodies expect multi-implementer interest. A DIF reviewer asking "who else implements this?" gets "nobody yet" — regardless of how elegant the spec is.

**What would help:** ONE external party running `@aidprotocol/mcp-trust` and providing a testimonial. The plan identifies three targets (MCP server operator, x402 community member, DIF TAAWG member). This is potentially the highest-ROI action available — one week of outreach could transform DIF reception.

**AIDplan refs:** 10/10 Day 1 (DSIR), Part 2 B.1-B.4, Part 5 H (external implementation strategy)

---

### O8: Autonomous Defense System Needs Critical Mass

**The problem:** The 5-layer autonomous defense system is designed for 10K+ agents. At current scale (0 on the protocol path), every layer has minimum viable ecosystem sizes that aren't met:

| Defense Layer | Threshold | Min Agents Required |
|---|---|---|
| Proof of life | 1 agent | Works at any scale |
| Immune response (Level 1: MONITOR) | 3 unique counterparties reporting in 1hr | ~50+ active agents |
| Immune response (Level 3: QUARANTINE) | 10 unique counterparties | ~200+ active agents |
| Guardian anti-concentration (10% cap) | Meaningful only with 10+ guardians | ~500+ agents (to attract 10 guardians) |
| Gravity well scoring | Needs tx volume for meaningful decay signals | ~100+ daily active agents |
| EigenTrust Sybil suppression | Needs connected graph for spectral analysis | ~500+ agents with diverse interactions |

At small scale, thresholds are either too sensitive (false positives) or too insensitive (attacks undetected).

**The tension:** We need the autonomous defense system to establish differentiation from competitors. But we can't validate it without scale, and we can't get scale without differentiation.

**What would help:** Simulation with synthetic agent populations (ties into R1). Be explicit at DIF about which layers work at which scale.

**AIDplan refs:** Part 3 C, Section 39.18-39.20

---

### O9: Regulatory Classification of Trust Scores (Upgraded from Y1)

**The problem:** The plan's own Section 33.5 labels this CRITICAL. The trust API is literally called a "credit bureau endpoint." If trust scores determine pricing and access, they may trigger FCRA obligations (adverse action notices, dispute rights, accuracy obligations) or EU AI Act Annex III 5(b) high-risk classification (conformity assessments before deployment). Either would fundamentally change the protocol's openness.

**What we've proposed:** Legal disclaimer, explain API, dispute mechanism, public scoring formula.

**Why this is ORANGE, not YELLOW:** The mitigations are bets that regulators will accept them — not confirmed legal positions. No lawyer has reviewed any of this. The classification decision is partly external (regulators) but also partly within our control (how we frame and deploy the product). Calling this "external" was hiding from the fact that our own language ("credit bureau endpoint") invites regulatory scrutiny.

**What would help:** A single fintech attorney consultation ($500-2K) covering FCRA applicability + MSB classification would dramatically reduce uncertainty.

**AIDplan refs:** Part 5 E.5 (Section 33.5)

---

### O10: Money Transmitter Risk (Upgraded from Y2)

**The problem:** Collecting USDC from agents, keeping 15%, and paying 85% to creators may constitute money transmission under FinCEN. The plan's own Section 33.1 calls this "HIGH RISK — exists TODAY" and notes operating as an unlicensed MSB is a federal crime. The "pull-based withdrawal" mitigation is "a legal theory — no authority has confirmed it works."

**Why this is ORANGE, not YELLOW:** This isn't purely external — the revenue model itself creates the risk. Pull-based withdrawals vs push-based payouts is an architectural choice with untested legal consequences. The plan lists 5 options (MSB registration, licensed partner, pull-based, smart contract, sandbox) but none are confirmed. The Wyoming DAO LLC sandbox research is still ⬜.

**AIDplan refs:** Part 5 E.1 (Section 33.1), Flaw 12

---

## ORANGE — Operational

### O11: Bus Factor = 1 (Upgraded from Note) [DIF-BLOCKING]

**The problem:** One-person project where every concern above compounds. DIF engagement specifically requires sustained multi-week presence: attending working group calls, responding to spec review comments, participating in interop discussions, building relationships with 3-5 allied members, iterating on feedback. The plan says "build allies: 3-5 aligned members BEFORE contentious votes."

**Why this is ORANGE, not a note:** At bootstrapping stage, bus factor = 1 is theoretical. But DIF engagement is imminent, the 10/10 plan is 100% unbuilt, and the DIF submission is pending. The single-person constraint is actively blocking parallel workstreams (code + spec reviews + community outreach + DIF calls), not a hypothetical future risk. One person cannot simultaneously write DSIRs, respond to spec reviews, attend calls across time zones, and do MCP server outreach.

**What would help:** Identify the ONE thing that only you can do (DIF relationship building) and ruthlessly defer everything else. Or find one collaborator for any workstream.

---

## YELLOW — External Dependencies We Can't Control

### Y1: No Legal Counsel Engaged (Cross-Cutting)

**The problem:** At least four concerns require legal review that hasn't happened: O9 (FCRA/EU AI Act, est. $5-20K), O10 (MSB classification), Section 33.2 (securities law on bonding curves), and trust-as-currency IOUs (promissory notes). No legal budget is allocated. No lawyer is engaged. The plan acknowledges "we have a legal disclaimer but no legal opinion."

**Why it matters:** Multiple revenue-generating features (creator payouts, trust-gated pricing, deferred settlement) operate in legal grey areas. A single regulatory action could shut down the payout system (O10) or require FCRA compliance that fundamentally changes the protocol (O9). These risks compound without counsel.

**What would help:** Even a single consultation ($500-2K) with a fintech attorney covering MSB + FCRA would dramatically reduce uncertainty. The Wyoming DAO LLC sandbox research (⬜) is also low-cost, high-value.

---

### Y2: Base L2 Single Point of Failure

**The problem:** All Merkle anchoring targets Base (Coinbase-operated sequencer). If Base has an extended outage, the "verifiable computation" property degrades to "trust ClawNet." Dual-chain anchoring (Base + Ethereum mainnet) is proposed but not built.

**What we can do:** Build dual-chain anchoring (low effort). But even dual-chain doesn't help if both chains are congested. Ethereum mainnet is expensive ($0.50-5/tx).

**AIDplan refs:** Part 3 F.11 (Vector 58)

---

### Y3: USDC Pause Risk

**The problem:** Circle can pause USDC globally. All batched/deferred settlements fail. The 5% insurance reserve partially compensates but doesn't make agents whole.

**What we can do:** Detect pause, revert to immediate mode, freeze batches. But we can't settle during a pause — that's Circle's unilateral power.

**AIDplan refs:** Part 3 F.7 (Vector 35)

---

### Y4: Gas Price Volatility on Settlement

**The problem:** Settlement economics assume Base L2 gas at ~0.005 gwei. During congestion, gas can spike 100x+. The circuit breaker helps but means settlement stops during spikes.

**AIDplan refs:** Part 3 F.15 (Vector 43), Part 5 A

---

## CLOSED

*Nothing here yet. When a concern is resolved, move it here with the date and rationale.*

*Example format:*
*### [C1] Former concern title*
*Closed: 2026-XX-XX. Reason: [what changed]. See AIDplan Section X.*
