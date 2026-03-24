# AID External Feedback Tracker

> **ARCHIVED March 24, 2026.** Replaced by per-protocol feedback files:
> - `aid-trust/external-feedback.md`
> - `aid-receipt/external-feedback.md`
> - `aid-settle/external-feedback.md`
>
> Original content kept below for reference.

> Tracks concerns raised by external reviewers (GitHub issue responses) against the AIDplan.
> Each concern gets: status, where it's addressed, honest assessment, and action required.
> Updated: March 24, 2026.

## Source

GitHub issue on `coinbase/x402` — 18+ responses from: msaleme, toplyr-narfur, rsbasic, FransDevelopment, and others.

## Overall Assessment

**Coverage: ~90% of feedback is addressed in the plan.** The remaining 10% are presentation/documentation gaps, not architectural problems. None are ship-blocking for DIF.

---

## SOLIDLY COVERED (No action needed — plan already handles these)

| Concern | Raised By | Where Addressed in Plan |
|---------|-----------|------------------------|
| Sybil resistance | msaleme #1, toplyr-narfur #6, rsbasic | Part 2 A.5 (counterpartyDiversity 15%), Part 3 B.1 (graph analysis, mutual decay, velocity caps), 10/10 Day 3 (EigenTrust) |
| Dynamic trust / transaction-time checks | msaleme #2 | Vector 55 (TOCTOU, Part 3 F.9), continuous scoring for >$5 txs |
| Cold-start / bootstrapping rejection | toplyr-narfur #2 | newAgentAllowance removed (Sybil vector), graduated trust, manifest bonus +15% |
| Nonce scope | toplyr-narfur #2 | Per-provider, 5-min window, Part 2 A.10 + Part 3 F.6 |
| Score portability / determinism | toplyr-narfur #3 | Deterministic by design, trustScope rejected (principled) |
| Facilitator orthogonality | toplyr-narfur #5 | Trust in extension headers, payment flow untouched (Part 2 A.3) |
| Recency weighting (88% discount blind spot) | rsbasic | Exponential decay 30d half-life (Part 2 A.5 v1.1), convergence decay (Part 3 C Gap 2) |
| Fail-closed default | rsbasic | Vector 28 (Part 3 F.1), degraded modes, X-AID-VERIFICATION-MODE header |
| Proof of life / absent owner | rsbasic | Autonomous defense system (Part 3 C — 5 layers, no human needed) |

---

## GAPS REQUIRING ACTION (7 items)

### Gap 1: Hard Inputs vs Soft Inputs Framing
- **Raised by:** toplyr-narfur #6, msaleme #5
- **Status:** `DO THIS WEEK` (30 min — reorganize existing content)
- **The concern:** Plan has DSIR trust input hierarchy (1.0 → 0.1) but it's not framed in the "hard vs soft" vocabulary the community uses. No single section says "here's how scoring inputs resist fabrication."
- **What exists:** DSIR hierarchy (Part 2 B.1), dual-party commitment logs (Part 2 B.4), EigenTrust (10/10 Day 3), counterpartyDiversity
- **Action:** Add "Input Integrity Model" subsection to Part 2 A.5 that maps existing mechanisms to hard/soft framework. One paragraph, explicit statement that hard inputs dominate scoring.
- **Added to AIDplan:** Section A.5.1 (March 24, 2026)

### Gap 2: Cold-Start Policy Discovery
- **Raised by:** toplyr-narfur #4
- **Status:** `DO THIS WEEK` (10 min — spec note)
- **The concern:** Heartbeat shows `trustGate: 0` and pricing tiers, but no explicit "here's our new-agent policy" field. Agent doesn't know if there's a tx count limit, value cap, etc.
- **What exists:** Heartbeat ServiceListing shows minTrust + pricing tiers. Implicitly communicates "we accept score 0."
- **Action:** Add note to heartbeat spec: cold-start policy is intentionally server-side with rationale. Optional `coldStartPolicy` extension field for providers who want to advertise constraints.
- **Added to AIDplan:** Section C.4 note (March 24, 2026)

### Gap 3: Local Weightings as Documented Pattern
- **Raised by:** toplyr-narfur #4
- **Status:** `DO THIS WEEK` (15 min — expand one-sentence note to a paragraph)
- **The concern:** Provider might want to apply local weightings (e.g., "weight recency 2x for DeFi"). This is a smart pattern that strengthens portable-score argument.
- **What exists:** "One-sentence doc note in x402 extension" (acknowledged but minimal)
- **Action:** Add "Local Policy Overlay" recommended pattern section. Shows how provider adjusts on top of canonical score without breaking verifiability.
- **Added to AIDplan:** Section A.5.2 (March 24, 2026)

### Gap 4: OATR Composability
- **Raised by:** FransDevelopment (responses 7-16)
- **Status:** `DO THIS WEEK` (10 min — add to competitive table + composability note)
- **The concern:** OATR is real, live (7 issuers, Ed25519, FROST planning, Agent Identity WG with 6 impls). Plan doesn't mention it. They're asking how OATR composes with AID.
- **What exists:** MCP-I in competitive table. OATR not mentioned.
- **Action:** Add OATR to competitive landscape table. Map OATR verification → AID verificationTier (basic/verified). Ally, not competitor.
- **Added to AIDplan:** Part 4 B table + composability note (March 24, 2026)

### Gap 5: Context Field for Authorized Testing
- **Raised by:** rsbasic (msaleme flagged attack surface)
- **Status:** `DOCUMENT AS DEFERRED` (spec note)
- **The concern:** Security testing against AID endpoints looks like attacks to the scoring system. No way to distinguish authorized pentest from actual attack.
- **What exists:** Nothing — not addressed.
- **Action:** Add spec note: testing DIDs with `purpose: testing` in manifest, excluded from production scoring, no trust-gated discounts. Providers SHOULD maintain testing DID allowlist.
- **Added to AIDplan:** Section A.8 addition (March 24, 2026)

### Gap 6: Value Diversity as Scoring Signal
- **Raised by:** rsbasic
- **Status:** `DOCUMENT AS DEFERRED` (Phase 3 candidate)
- **The concern:** Transaction count alone is gameable. Value diversity (variance in tx amounts) is harder to fake — Sybils generate uniform $0.001 txs, real agents have realistic distribution.
- **What exists:** Volume (tx count), exponential decay (time), counterpartyDiversity (unique DIDs). No value diversity.
- **Action:** Add `valueDiversity` as Phase 3 candidate sub-signal within volume dimension. Spec note acknowledging the signal.
- **Added to AIDplan:** Part 2 A.5 Phase 3 expansion note (March 24, 2026)

### Gap 7: External Harness Integration
- **Raised by:** msaleme, rsbasic, FransDevelopment
- **Status:** `DO THIS WEEK` (5 min response + checklist item)
- **The concern:** Three external test suites exist: msaleme v3.6.0 (43 tests), rsbasic mesh harness (62 tests), Agent Identity WG conformance vectors (6 impls). Free adversarial validation being offered.
- **What exists:** x402 security harness mentioned (17/20, 85%). No commitment to external harnesses.
- **Action:** Add commitment to run against external harnesses during 10/10 plan. Reference specific harnesses. Respond in GitHub thread.
- **Added to AIDplan:** 10/10 cross-cutting items (March 24, 2026)

---

## GITHUB THREAD RESPONSE TEMPLATE

For responding to the thread with a summary of how AID addresses the feedback:

```
Key points for response:
- Input integrity: "AID's DSIR hierarchy weights agreed receipts at 1.0 and self-declared at 0.1 —
  that's the hard/soft separation as protocol-level input hierarchy."
- Simulation: "Monte Carlo harness (10K agents × 100K rounds) is in the build plan.
  Happy to publish results as spec appendix."
- External harnesses: "Will run against msaleme v3.6.0 + rsbasic mesh harness once
  reference endpoint is up."
- OATR: "Complementary — OATR verification maps to AID's verificationTier multiplier.
  An OATR-verified agent at score 0 gets 1.1x multiplier vs 1.0x unverified."
- Cold-start: "Heartbeat tiers implicitly communicate new-agent policy. Adding optional
  coldStartPolicy extension field for providers who want explicit constraints."
```
