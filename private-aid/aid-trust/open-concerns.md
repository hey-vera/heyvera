# AID-Trust — Open Concerns

> Concerns specific to Protocol 1 (trust scoring + identity + verification).
> Full text lives here. Master file (docs/open-concerns.md) is the index + dependency map.
> Updated: March 24, 2026.

---

## RED

### R1: The Security Model Is Conjectured, Not Proven [DIF-BLOCKING]

**The problem:** AID's entire game-theoretic argument rests on estimated detection probabilities (p=0.15/round for Sybil, p=0.95 for bust-out) that have never been measured. The Nash equilibrium proof depends on these numbers. If actual detection rates are lower — say p=0.05 for Sybil — the equilibrium flips and gaming becomes rational.

These specific probabilities appear in BOTH the Nash equilibrium proof AND the per-dimension cost-to-manipulate tables (Part 3 D.3-D.6). If a DIF reviewer asks "where does 0.15 come from?" the honest answer is "we estimated it." Opus Review 3 ranked the simulation harness as the #1 priority and stated: **"presenting a game-theoretic security argument without empirical backing to a room of cryptographers is the one thing that could sink credibility irreversibly."**

**What we've proposed:** Monte Carlo simulation harness (10K agents x 100K rounds). This would turn "we believe" into "we measured."

**Why it's still hard:** Simulation validates the *model*, not *reality*. Real attackers don't follow the strategy space we defined. A simulation that shows p=0.15 under our assumptions doesn't prove p=0.15 in production. The formal security bound remains conjectured even after simulation. We can strengthen the argument but can't close it mathematically without a formal proof — and that proof may not be achievable for a system this complex.

**What would close it:** Either (a) formal proof (unlikely — reputation systems don't have clean security reductions), or (b) 12+ months of production data showing actual detection rates match estimates. The simulation is necessary but not sufficient.

**Reframing (Opus audit, March 24):** No reputation system has a formal security proof — not FICO, not eBay, not EigenTrust in practice. The question isn't proving p=0.15, it's presenting the argument maturely. What DIF will actually accept: clearly stated threat model with explicit assumptions, sensitivity analysis showing degradation curves if assumptions are wrong by 2x, and a roadmap for empirical validation. Frame as "we've analyzed sensitivity" not "we proved security." The simulation harness is valuable but should NOT block submission — ship analytical sensitivity analysis first.

**Depends on:** O1 (shares the simulation harness dependency — if it doesn't get built, both stay open).

---

### R2: Deterministic Arithmetic Across Implementations [DIF-BLOCKING]

**The problem:** JavaScript `64-bit float` produces different intermediate results than Rust `f64` or Python `Decimal`. If two honest implementations compute different trust scores for the same inputs, fraud proofs collapse — the entire optimistic oracle architecture (Phase 2 decentralization) is **architecturally broken**, not just inconvenient.

**What we've proposed:** Fixed-point arithmetic with 6 decimal places, integer weights (3500 = 35.00%), reference test vectors with exact intermediate values. Listed as Opus #16 CRITICAL.

**Why it's still hard:** Fixed-point solves the representation problem but not the computation order problem. `(a * b) + (c * d)` vs `(a * b + c * d)` can differ at the 6th decimal due to intermediate rounding. The spec must prescribe exact computation ORDER, not just representation.

**Immediate credibility risk (partially mitigated):** `@aidprotocol/trust-compute` was bumped to v3.0.0 (March 24) — SHA-384→SHA-256 aligned with spec and ClawNet production. 8 concrete test vectors with exact expected hashes published. The hash mismatch is fixed, but the underlying float determinism problem remains for cross-language implementations.

**Resolution path (Opus audit, March 24):** Specify computation as a numbered algorithm with explicit rounding at each step (step 1: multiply X by weight W, step 2: round to 6 decimal places toward zero, step 3: ...). Test vectors must include every intermediate value — not just inputs and final output. If a Python implementation diverges, intermediates pinpoint exactly which step. This is how financial protocols handle it. Estimated 2-3 days of work to close for DIF submission.

**What would fully close it:** Publish reference implementation in all 3 languages (TS/Python/Rust) with test vectors that include every intermediate value.

**Blocks:** R3 (fraud proofs require deterministic scores — no determinism = no decentralization).

---

### R4: DIF Credibility Gap — Slides Promise What Isn't Built [DIF-BLOCKING]

**The problem:** The entire 10/10 plan is 100% unchecked (that's now AID-Receipt territory). But the DIF presentation slides for AID-Trust still reference simulation results, EigenTrust, and DSIRs that aren't built.

**The 57% completion rate is misleading.** Completed items are mostly infrastructure. Uncompleted items ARE the differentiating features.

**Why it's hard:** Building to spec quality takes weeks. DIF window is days. You can't present unbuilt features as capabilities, but presenting without them makes AID look like "x402 with identity headers."

**What would help:** Triage ruthlessly. For AID-Trust specifically: (1) deterministic arithmetic spec (1 day), (2) standalone threat model extraction (1 day), (3) rewrite slides to present only what AID-Trust delivers today — trust scoring + verification + identity. Don't promise AID-Receipt features in AID-Trust slides.

**Depends on:** R1 + R2 + O7 (DIF presentation assumes all three are resolved).

---

## ORANGE

### O1: All Scoring Parameters Are Empirically Motivated

**The problem:** Every key parameter in the trust formula is a judgment call with no principled derivation:
- counterpartyDiversity weight: 15% (why not 10% or 20%?)
- Dispute rate exponent: 2 (why not 1.5 or 3?)
- Exponential decay half-life: 30 days (why not 14 or 60?)
- Verification multiplier: 1.0/1.1/1.2 (why these steps?)
- Trust input hierarchy: 1.0/0.7/0.5/0.3/0.1 (why these weights?)
- valueDiversity CV threshold (Phase 3 candidate — adds another)

Each parameter has a plausible argument but none has a mathematical derivation. Each new dimension compounds the calibration problem.

**Why it's hard:** Reputation systems don't have first-principles parameter derivation. FICO calibrated over decades of outcome data. We have zero.

**The tension:** Publish exact parameters = carved in stone. Keep configurable = determinism breaks.

**Resolution path (Opus audit, March 24):** Separate the algorithm (fixed in spec) from the parameters (fixed per version, updatable through governance). Publish sensitivity analysis showing which parameters are robust vs fragile. This doesn't require simulation — analytical sensitivity (what happens if weight shifts ±5%?) is sufficient for DIF. The mature response: acknowledge parameters are empirical, publish them transparently, define a governance process for updating them based on production data.

**What would help:** Simulation harness (R1) shows which parameters are sensitive vs robust. **But R1 and O1 share the same dependency.**

---

### O4: Privacy vs Fingerprinting

**The problem:** A trust score of 87 with 1,247 attestations from 340 counterparties is a unique fingerprint. But making scores less precise reduces their utility for pricing.

**What we've proposed:** Three privacy modes: open, shielded (verdict-only, 10-point anonymity set), ZK (Phase 3+).

**The deeper tension:** AID's value proposition is "scored, verifiable, portable trust." Privacy works against all three. The protocol inherently trades privacy for utility. We can mitigate but not eliminate this.

---

### O6: The Standard vs Product Race [DIF-BLOCKING]

**The problem:** AID positions as a standard. Mnemom has shipping ZK proofs (SP1, $0.005/proof), npm/pip packages, and OpenClaw integration today. If they get enough adoption before AID-Trust's DIF submission gains traction, the "standard" positioning collapses.

**Why this is worse than ORANGE:** The DIF TAAWG submission is still unchecked. Mnemom doesn't need DIF approval to ship. Every month the standard takes to ratify, products gain more adoption.

**The bet:** Protocol-agnostic profiles + DIF/NIST engagement + no token dependency = structural advantage.

**What could invalidate it:** Mnemom gets DIF engagement. Google ships trust scoring in A2A v2.

**This isn't solvable — it's a strategic bet with a closing window.**

**Implication (Opus audit, March 24):** You can't out-ship a competitor by perfecting a spec. Every week the spec isn't submitted is a week Mnemom gains adoption without needing DIF approval. Submit what you have, iterate in public, don't wait for perfection. Standards are living documents — the first submission needs to be credible, not final.

---

### O7: No External Implementation [DIF-BLOCKING]

**The problem:** Zero external parties running `@aidprotocol/mcp-trust`. "One company proposing its own protocol." Standards bodies expect multi-implementer interest.

**What would help:** ONE external MCP server operator running mcp-trust + testimonial. Potentially the highest-ROI action available — one week of outreach could transform DIF reception.

---

## YELLOW

### Y2: Base L2 Single Point of Failure

**The problem:** All Merkle anchoring targets Base (Coinbase-operated sequencer). If Base has an extended outage, "verifiable computation" degrades to "trust ClawNet." Dual-chain anchoring proposed, not built.

**What we can do:** Build dual-chain anchoring (low effort). But even dual-chain doesn't help if both chains congested.

---

## CLOSED

*Nothing yet.*
