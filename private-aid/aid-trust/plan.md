# AID-Trust — Build Plan

> Protocol 1 of 3 in the AID family.
> Trust scoring + identity + verification. The DIF submission.
> Split from AIDplan on March 24, 2026.

---

## Table of Contents

- [Status Summary](#status-summary)
- [What AID-Trust IS / IS NOT](#what-aid-trust-is)
- [Crypto Strategy](#crypto-strategy)
- [What's Built (Production)](#whats-built-production)
- [v1.0 Spec Work — COMPLETE](#v10-spec-work--complete)
- [v1.0 Validation — IN PROGRESS](#v10-validation--in-progress)
- [v1.0 DIF Submission — TODO](#v10-dif-submission--todo)
- [v1.1 Roadmap — Behavioral Trust](#v11-roadmap--behavioral-trust)
- [v1.1 Roadmap — Cost-Based Security](#v11-roadmap--cost-based-security)
- [Deferred (not blocking)](#deferred-not-blocking)
- [Audit Findings (March 24)](#audit-findings-march-24)

---

## Status Summary

| Area | Status | Details |
|------|--------|---------|
| **Spec (aid-spec repo)** | ✅ Complete | ~1,230 lines, 10 sections, 6 appendices |
| **Audit fixes (AF-1–AF-6)** | ✅ All resolved | SHA-256 alignment, verification multiplier, trust-compute v4.0.0 |
| **DIF must-haves** | ✅ 5/6 done | R2, ABNF, JSON Schema, RFC 9421, RATS. O7 revised to non-blocking |
| **Nice-to-haves** | ✅ 8/8 done | Sensitivity, threat model, KERI, ACDC, Data Integrity, 800-63, DID:webs, Python validator |
| **Test harness** | ✅ 34 tests written | Pending: run on VPS against ClawNet |
| **DIF submission** | ⬜ Not started | Slides + submit to TAAWG |
| **v1.1 design** | ⬜ Not started | Behavioral trust + cost-based security bound |

---

## What AID-Trust IS

Five headers. One scoring formula. Merkle verification. Offline-verifiable trust scores.

- Self-certifying identity (Ed25519 did:key)
- Trust scoring formula (v1.0: 4 dimensions, v1.1: 5 dimensions)
- Merkle-anchored trust snapshots (4h cron, verifiable offline)
- Heartbeat protocol (service discovery + pricing tiers)
- Mutual authentication (X-AID-PROOF + X-AID-PROVIDER-PROOF)
- Trust tiers + verdicts (new → proceed)
- Anti-gaming mechanisms (decay, diversity, weighted reviews)
- Key rotation + GDPR erasure
- Onboarding (X-AID-NEW auto-provisioning)

## What AID-Trust IS NOT

- Receipts (AID-Receipt)
- Feedback endpoint (AID-Receipt — takes receiptId)
- Settlement modes, pricing discounts (AID-Settle)
- Guardians, insurance, social graph (ClawNet product)

---

## Crypto Strategy

SHA-256 everywhere now. Migration via `hashAlgorithm` field bump when needed.

**Rationale:** Quantum threat is signatures (Shor breaks Ed25519), not hashes (Grover weakens SHA-256 to 128-bit preimage — still secure). Migration priority is `Ed25519 → ML-DSA`. SHA-256 is the DIF/W3C/IETF standard. Crypto-agility fields ARE the future-proofing.

**Path:** SHA-256 (now) → SHA-384 or SHA3-256 (quantum timeline) → field bump + 30-day governance notice.

---

## What's Built (Production)

All running on ClawNet VPS (`guardian@24.199.121.137:3402`):

- `@aidprotocol/trust-compute` v4.0.0 on npm (MIT, SHA-256, clean protocol boundary)
- `@aidprotocol/mcp-trust` v1.1.0 on npm (one-line MCP integration)
- All @aidprotocol packages in `aidprotocol/aid-spec` repo
- Middleware for Hono/Express/Fastify
- Ed25519 signing + JCS + base58btc
- Merkle tree + proof gen/verify
- Offline AID verification
- AID registration + key rotation
- Trust snapshots 4h cron
- Heartbeat endpoint + /.well-known/aid.json
- Trust-gated pricing logic
- Public trust API (GET /v1/aid/:did/trust)
- Pedersen commitment privacy option
- Protocol-level canary
- Trust score explanation API

---

## v1.0 Spec Work — COMPLETE

All spec content is in `aid-spec/protocols/aid-trust/spec.md` (~1,230 lines).

### Audit Fixes (AF-1 through AF-6)
- ✅ AF-1: signing.json + validation-suite.ts SHA-384 → SHA-256
- ✅ AF-2: Verification multiplier separated from canonical formula (new Section 4.1.1)
- ✅ AF-3: Spec example shows base score 79 with real proofHash
- ✅ AF-4: Abstract error code count fixed (6 → 5)
- ✅ AF-5: trust-compute v4.0.0 — `getTrustVerdict()` returns `{ verdict }` only
- ✅ AF-6: validation-suite.ts imports from `@aidprotocol/trust-compute`

### Spec Extraction (from AIDplan)
- ✅ A.1–A.10: Identity, scoring, mutual auth, anti-gaming (715 lines)
- ✅ D.1: ABNF headers (Section 5.2.1, RFC 5234)
- ✅ D.2: JSON Schema (Section 5.2.2, draft 2020-12)
- ✅ D.3: Signing input canonical form (Section 5.3)
- ✅ D.5: Error semantics (Section 8.2, 5 AID_* codes)
- ✅ D.6: Conformance levels (Section 10, Level 1 + Level 2)
- ✅ D.7: RFC 9421 compatibility note (Section 8.4)
- ✅ D.8: Protocol/product boundary (spec abstract + composability.md)

### New Spec Content
- ✅ Deterministic arithmetic (Section 4.1.2) — 6-step algorithm, IEEE 754, roundHalfUp, cross-language table
- ✅ Threat model summary (Appendix E) — attack costs, Nash equilibrium, anti-gaming, known limitations
- ✅ KERI compatibility (Appendix D.1) — key rotation, self-certifying IDs, witness model
- ✅ ACDC interop (Appendix D.2) — trust scores as ACDCs, attestation chains
- ✅ W3C Data Integrity (Appendix D.3) — eddsa-jcs-2022 mapping
- ✅ NIST SP 800-63 (Appendix D.4) — verdict-to-IAL framing
- ✅ DID:webs (Appendix D.5) — evolution path from did:key to did:webs
- ✅ Sensitivity analysis (Appendix C) — weight ±5 tables, robustness summary
- ✅ RATS vocabulary (Appendix B) — RFC 9334 role + data flow mapping

### Test Vectors
- ✅ 8 concrete vectors with SHA-256 proof hashes (trust-score.json)
- ✅ Full intermediate values (volume, d1–d4, rawScore, jcsCanonical)
- ✅ Signing vector regenerated for SHA-256 (signing.json)
- ✅ Python cross-language validator (trust-score-validate.py)

---

## v1.0 Validation — IN PROGRESS

### Security Test Harness (34 tests)

Built as `aid_trust_harness.py` inside msaleme's `red-team-blue-team-agent-fabric` (cloned locally).

| Category | Tests | Spec Coverage |
|----------|-------|---------------|
| **identity** (6) | AID-001–006 | 3.1, 3.2, 3.4, 3.5, 6.1, 6.2 |
| **scoring** (10) | AID-010–019 | 4.1, 4.1.1, 4.1.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.1 |
| **mutual_auth** (6) | AID-020–025 | 5.3, 5.4, 6.3, 8.2 |
| **anti_gaming** (3) | AID-060–062 | 3.5 rate limits, E.3 self-feedback, C.3 Sybil |
| **privacy** (2) | AID-030–031 | 7.1 public, 7.2 owner-only |
| **error_semantics** (3) | AID-040–042 | 8.2 (all 5 AID_* codes) |
| **gdpr** (1) | AID-070 | 7.4 erasure |
| **crypto** (1) | AID-050 | 3.3 agility |

**Not testable externally:** Section 2 (design principles), Section 4.2 (trust input hierarchy — needs AID-Receipt).

### Validation Status
- ✅ Harness written (34 tests, 8 categories)
- ✅ Registered in msaleme CLI as `aid-trust` module
- ⬜ Run against ClawNet on VPS
- ⬜ Run msaleme's existing modules (identity, mcp, x402) against ClawNet
- ⬜ Run Python cross-language validator on VPS
- ⬜ Analyze results, fix any failures

---

## v1.0 DIF Submission — TODO

- ⬜ Rewrite DIF slides — present ONLY what AID-Trust delivers today
- ⬜ Submit AID-Trust to DIF TAAWG as focused spec
- ⬜ Submit NIST NCCoE comment (document at `aid-spec/docs/nist-nccoe-comment.md`)
- ⬜ O7: External implementer — revised to non-blocking for initial submission. Outreach during review period is stronger leverage.

---

## v1.1 Roadmap — Behavioral Trust

> The Satoshi insight: don't try to detect bad actors — make badness physically impossible to fake.

v1.0 trust is based on DECLARED behavior (attestation counts, success rates). v1.1 adds EMERGENT behavioral signals that are unfakeable because they're side effects of actual computation.

### 5th Dimension: Behavioral Authenticity

Five signals, measured at the protocol level:

1. **Latency plausibility** — if you claim to call 3 APIs, your response time must be ≥ sum of those API latencies. You can't be faster than the speed of light. Unfakeable by physics.
2. **Output entropy** — real data follows Zipf's law and domain-specific distributions. Fake responses have different entropy. Measurable without seeing the actual content (hash-based entropy estimation).
3. **Interaction topology** — honest agents form power-law interaction graphs. Sybil networks form dense clusters. The SHAPE of your interaction graph reveals what you are.
4. **Temporal fingerprint** — real services have circadian patterns. Bots run flat 24/7. Temporal autocorrelation is a behavioral signature expensive to fake over months.
5. **Cross-signal correlation** — any ONE signal can be faked. Faking ALL simultaneously is computationally intractable. Like an animal reading posture + heart rate + pupil dilation + movement — the correlation IS the detection.

### Why This Matters

Current v1.0 security argument: "gaming costs $80 to reach score 80, which is irrational given detection probability p > 0.002."

v1.1 argument: "gaming requires faking correlated behavioral signals that emerge from actual computation. The cost of faking is not dollars — it's doing the actual work, which defeats the purpose of gaming."

### Implementation Notes

- Attestations already record `totalLatencyMs` and `stepEndpoints` — latency plausibility is measurable TODAY
- `counterpartyDiversity` (v1.1 5th dimension from AIDplan) measures interaction topology
- Temporal patterns measurable from existing attestation timestamps
- No changes to v1.0 protocol needed — v1.1 adds dimensions, doesn't break existing

---

## v1.1 Roadmap — Cost-Based Security Bound

> The equilibrium doesn't depend on detection probability. It depends on the cost of building trust.

### The Math

Current spec says equilibrium holds for p > 0.088. But the real bound is:

```
p_min = benefit_per_round / (cost_to_rebuild + NPV_future_earnings)
p_min = $2.40 / ($80 + $1,140) = $2.40 / $1,220 = 0.002
```

The equilibrium holds for **p > 0.2%** — a 75x safety margin over the estimated p=0.15.

**Why:** The trust score IS the stake. Building it costs real money and time ($80+ over months). Gaming risks losing all of it. The security comes from the COST of building trust, not from detecting attackers.

### Spec Addition (Section 8.5)

Add "Cost-Based Security Bound" to aid-spec spec.md:
- Formal proof that equilibrium holds for p > 0.002
- Independent of detection mechanism — pure economic argument
- Shows 75x safety margin
- No new code — just math that strengthens the existing spec

---

## Deferred (not blocking DIF submission)

- ⬜ IPLD encoding note — relevant to Phase 2+ decentralization
- ⬜ OpenTelemetry mapping — observability, not protocol
- ⬜ Biscuit token evaluation — tangential to trust scoring
- ⬜ Profile registry governance — wait until profiles exist to govern
- ⬜ Simulation harness (10K agents × 100K rounds) — sensitivity analysis is sufficient for DIF
- ⬜ Rust cross-language validator — defer until external demand

---

## Audit Findings (March 24)

> All 6 findings resolved. Preserved here for reference.

<details>
<summary>AF-1 through AF-6 (click to expand)</summary>

### AF-1: SHA-256 alignment incomplete
`signing.json` and `validation-suite.ts` used SHA-384. Fixed: regenerated with SHA-256, verified intermediates.

### AF-2: Verification multiplier in canonical formula
Spec and implementation disagreed. Fixed: separated base score (canonical, in proof hash) from verification adjustment (application layer, Section 4.1.1).

### AF-3: Spec example score mismatch
Section 3.2 showed score 87 (with multiplier). Fixed: shows base score 79 with real proofHash, note explains multiplier adjustment.

### AF-4: Error code count
Abstract said 6, table had 5. Fixed: abstract says 5.

### AF-5: trust-compute settlement leak
`getTrustVerdict()` returned `{ verdict, discount, settlementMode }`. Fixed: returns `{ verdict }` only. v4.0.0.

### AF-6: validation-suite.ts not portable
Imported ClawNet internals. Fixed: imports from `@aidprotocol/trust-compute`.

</details>
