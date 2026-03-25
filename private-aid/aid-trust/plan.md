# AID-Trust — Build Plan

> Protocol 1: Trust scoring + identity + verification.
> The DIF submission. The "one npm install" protocol.
> Split from AIDplan on March 24, 2026.

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

- Receipts (that's AID-Receipt)
- Feedback endpoint (that's AID-Receipt — takes receiptId)
- Settlement modes (that's AID-Settle)
- Guardians, insurance, social graph (that's ClawNet product)

## What's Built (~80%)

- `@aidprotocol/trust-compute` on npm (v3.0.0, MIT, SHA-256 aligned)
- `@aidprotocol/mcp-trust` on npm (v1.1.0, one-line MCP integration)
- All @aidprotocol packages moved to `aidprotocol/aid-spec` repo (March 24)
- Middleware for Hono/Express/Fastify (`aid-spec/packages/middleware/`)
- Ed25519 signing + JCS + base58btc (production in ClawNet)
- Merkle tree + proof gen/verify (production)
- Offline AID verification (production)
- AID registration + key rotation (production)
- Trust snapshots 4h cron (production)
- Heartbeat endpoint (production)
- Trust-gated pricing logic (production)
- Public trust API — GET /v1/aid/:did/trust (production)
- Pedersen commitment privacy option (production)
- Protocol-level canary (production)
- Trust score explanation API (production)
- /.well-known/aid.json + aid-platform-key (production)

## What's Left to Build

### Spec Extraction (populate aid-spec/protocols/aid-trust/spec.md)
- [x] Extract Part 2 A.1-A.10 from AIDplan → spec.md (identity, scoring, mutual auth, anti-gaming) — 715 lines, March 24
- [ ] Extract Part 2 D.1 ABNF headers → spec.md (have header tables, need formal ABNF grammar)
- [ ] Extract Part 2 D.2 CDDL (ScoreResult, TrustVector, HeartbeatResponse) → spec.md
- [x] Extract Part 2 D.3 signing input canonical form → spec.md — Section 5.3
- [x] Extract Part 2 D.5 error semantics → spec.md — Section 8.2 (5 AID-Trust codes, rest are AID-Settle)
- [x] Extract Part 2 D.6 conformance levels (Level 1 Core, Level 2 Trust) → spec.md — Section 10
- [ ] Extract Part 2 D.7 RFC 9421 alignment → spec.md
- [ ] Extract Part 2 D.8 protocol/product boundary → spec.md (partially in composability.md)

### New Spec Content (doesn't exist yet in AIDplan)
- [ ] Deterministic arithmetic spec (Opus #16 — CRITICAL for DIF). Specify computation as numbered algorithm with explicit rounding at each step. Include every intermediate value in test vectors so cross-language divergence is pinpointed to exact step.
- [ ] Standalone threat model document (Opus #15 — extract from AIDplan Parts 3 A, B, E, F)
- [ ] KERI compatibility note (Opus #10 — spec note, zero code)
- [ ] ACDC interop note (Opus #11)
- [ ] IPLD encoding note (Opus #12)
- [ ] OpenTelemetry mapping note (Opus #13)
- [ ] Biscuit token evaluation note (Opus #14)
- [ ] Profile registry governance (Opus #17)

### Standards Vocabulary Alignment (Opus audit, March 24)
- [ ] IETF RFC 9334 (RATS Architecture) — use RATS terminology for attestation/evidence/appraisal where it maps to trust scoring pipeline. DIF reviewers already agreed on this vocabulary.
- [ ] W3C Data Integrity proof format — compatibility note showing AID trust snapshots expressible as Data Integrity proofs. Don't adopt full stack, just show the mapping.
- [ ] NIST SP 800-63 assurance level framing — frame trust tiers (new → proceed) as analogous to Identity Assurance Levels. Gives DIF reviewers a familiar mental model.
- [ ] DID:webs trust anchoring — align terminology with closest existing DIF work to reduce friction.

### Validation
- [ ] E2E scenario conformance tests (Opus #18)
- [ ] Run against external harnesses (msaleme v3.6.0, rsbasic mesh, AIWG vectors)
- [x] Concrete test vectors with exact SHA-256 proof hashes — 8 vectors in test-vectors/trust-score.json (March 24)
- [ ] Intermediate value test vectors — every step of the computation (multiply, round, accumulate) with exact values so cross-language divergence is pinpointed
- [ ] Cross-language test vectors (Python + Rust produce identical scores to TS reference)
- [ ] Sensitivity analysis — which parameters matter most, degradation curves if assumptions off by 2x (addresses R1 without requiring formal proof)

## What's Left to Ship (DIF Submission)

- [ ] Get 1 external MCP server operator running mcp-trust — **HIGHEST ROI ACTION** (transforms narrative from "one company" to "emerging ecosystem")
- [ ] Rewrite DIF slides — present ONLY what AID-Trust does today (identity, scoring, Merkle verification, mutual auth). Do NOT mention EigenTrust, simulation results, or settlement.
- [ ] Submit AID-Trust to DIF TAAWG as focused spec
- [ ] Submit NIST NCCoE comment (deadline April 2)

### DIF Submission Must-Haves (before submitting)
- [ ] R2 closed — deterministic arithmetic with intermediate test vectors
- [ ] ABNF (D.1) + CDDL (D.2) in spec — standards reviewers read these first
- [ ] RFC 9421 compatibility note in spec
- [ ] At least 1 external implementer (O7)

### DIF Submission Nice-to-Haves (strengthen but don't block)
- [ ] Sensitivity analysis for scoring parameters (R1)
- [ ] RATS vocabulary alignment
- [ ] Cross-language reference implementations
- [ ] Simulation harness results

## AIDplan Source Sections

Content to extract from AIDplan:
- Part 2 A (A.1-A.10): Identity + trust scoring + mutual auth
- Part 2 D (D.1-D.8): Formal definitions (ABNF, CDDL, signing, errors, conformance)
- Part 3 A: Threat model + attack vectors (trust-relevant subset)
- Part 3 B: Anti-gaming defenses
- Part 3 E: MCP ecosystem security
- Part 3 F: Infrastructure security
