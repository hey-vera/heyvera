# AID-Trust — Build Plan

> Protocol 1: Trust scoring + identity + verification.
> The DIF submission. The "one npm install" protocol.
> Split from AIDplan on March 24, 2026.
> Last audited: March 24, 2026 — cross-referenced every plan item against aid-spec repo contents.

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
- Settlement modes, pricing discounts (that's AID-Settle)
- Guardians, insurance, social graph (that's ClawNet product)

## Crypto Strategy

SHA-256 everywhere now. Migration via `hashAlgorithm` field bump when needed.

**Rationale:** The quantum threat is signatures (Shor breaks Ed25519), not hashes (Grover weakens SHA-256 to 128-bit preimage — still secure). The migration priority is `Ed25519 → ML-DSA`, already designed for via `signatureAlgorithm` + `algorithmVersion` fields. SHA-256 is the DIF/W3C/IETF ecosystem standard. Shorter proof hashes (64 hex vs 96) matter for Merkle proofs at scale. Crypto-agility fields ARE the future-proofing — you don't need SHA-384 now because the switch is a version bump, not a rewrite.

**Migration path:** SHA-256 (now) → SHA-384 or SHA3-256 (when quantum timeline firms up) → field bump + 30-day notice per governance model.

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

## Audit Findings (March 24)

Cross-referenced every plan item against aid-spec repo contents. Found 6 issues in existing work that must be fixed before building new spec content.

### AF-1: SHA-256 alignment incomplete [aid-spec repo]

`test-vectors/signing.json` and `test-vectors/validation-suite.ts` still use SHA-384 from before the v3.0.0 alignment. Spec, trust-compute, and trust-score.json all use SHA-256. These two files contradict the spec and will confuse any implementer.

**Fix:** Update both files to SHA-256. Also fix validation-suite.ts imports — currently reference ClawNet internals (`../../src/utils/jcs`, `../../src/core/credits`, `../../src/utils/crypto-agility`), making the suite non-portable. Should import from `@aidprotocol/trust-compute` instead.

### AF-2: Verification multiplier not in canonical formula [spec + trust-compute]

Spec Section 4.1 says `finalScore = min(100, round(rawScore * verificationMultiplier))`. But `computeTrustScore()` does NOT accept or apply a multiplier. The proof hash covers the base score only — which is correct, because verification status is dynamic (linking/unlinking external identities). If the multiplier were canonical, proof hashes would change with verification state, breaking "same inputs → same hash."

**Fix:** Update spec Section 4.1 to separate clearly. Canonical formula = base score (4-dimension weighted sum → round → clamp). Verification multiplier = separate application-layer adjustment documented in spec but NOT part of proof hash computation. Update spec example in Section 3.2 (currently shows score 87 = round(78.74 × 1.1), should show base score 79 with a note about multiplier adjustment).

### AF-3: Spec example score doesn't match test vectors [spec]

Section 3.2 example shows score 87 for the ts-001 inputs (successRate=0.95, chainCoverage=0.88, attestationCount=247, manifestAdherence=0.92). Test vector ts-001 gives score 79 for identical inputs. The discrepancy is the verification multiplier being silently applied in the example.

**Fix:** Covered by AF-2. Update example to base score 79 or explicitly show the multiplier step.

### AF-4: Abstract error code count wrong [spec]

Spec abstract (line 31) says "6 AID_* error codes" but Section 8.2 table lists 5 (SIGNATURE_INVALID, TRUST_GATE_BLOCKED, VERSION_UNSUPPORTED, NONCE_REPLAY, PROOF_MISSING).

**Fix:** Change abstract to "5 AID_* error codes."

### AF-5: trust-compute leaks AID-Settle concepts [npm package]

`getTrustVerdict()` in `@aidprotocol/trust-compute` returns `{ verdict, discount, settlementMode }`. But composability.md explicitly says "AID-Trust's spec contains NO settlement concepts." The canonical AID-Trust package violates the protocol boundary.

**Fix (short-term):** Add JSDoc noting `discount` and `settlementMode` are convenience defaults from AID-Settle, not AID-Trust spec. Spec Section 4.4 is already clean (no settlement concepts).
**Fix (v4.0.0):** `getTrustVerdict()` returns `{ verdict }` only. Settlement terms move to `@aidprotocol/settle-compute` or a separate export.

### AF-6: validation-suite.ts not portable [aid-spec repo]

Imports reference ClawNet internals (`../../src/utils/jcs`, `../../src/core/credits`, `../../src/utils/crypto-agility`). Cannot run from aid-spec standalone. The spec's own test suite should be self-contained or import from published packages.

**Fix:** Rewrite imports to use `@aidprotocol/trust-compute` (which exports `jcsSerialize`). Trust verdict test should use `getTrustVerdict()` from the package. Crypto agility tests may need a minimal inline implementation or new package export.

## What's Left to Build

### Spec Fixes (from audit — do first)
- [x] AF-1: Fix signing.json + validation-suite.ts SHA-384 → SHA-256 — regenerated signing vector with correct SHA-256 intermediates, March 24
- [x] AF-2: Separate verification multiplier from canonical formula in spec Section 4.1 — added Section 4.1.1 (application layer), clarified proof hash covers base score only, March 24
- [x] AF-3: Fix spec Section 3.2 example to show base score 79 — updated with real proofHash, added note showing verification adjustment to 87, March 24
- [x] AF-4: Fix abstract error code count (6 → 5) — March 24
- [x] AF-5: Clean break on trust-compute `getTrustVerdict()` — returns `{ verdict }` only, removed discount/settlementMode (AID-Settle concerns), bumped to v4.0.0, March 24
- [x] AF-6: Fix validation-suite.ts imports to use `@aidprotocol/trust-compute` — rewrote with SHA-256, portable imports, added protocol boundary test, March 24

### Spec Extraction (populate aid-spec/protocols/aid-trust/spec.md)
- [x] Extract Part 2 A.1-A.10 from AIDplan → spec.md (identity, scoring, mutual auth, anti-gaming) — 715 lines, March 24
- [x] D.1: ABNF headers → spec.md Section 5.2.1. RFC 5234 grammar for all 9 AID-Trust headers + X-AID-NEW, shared rules for date-time-z, base58btc-char, base64url-char. March 24.
- [x] D.2: JSON Schema (TrustScoreResult, HeartbeatResponse, TrustVerdict) → spec.md Section 5.2.2. JSON Schema draft 2020-12, directly executable for validation. March 24.
- [x] D.3: signing input canonical form → spec.md — Section 5.3
- [x] D.5: error semantics → spec.md — Section 8.2 (5 AID-Trust codes, rest are AID-Settle)
- [x] D.6: conformance levels (Level 1 Core, Level 2 Trust) → spec.md — Section 10
- [x] D.7: RFC 9421 alignment → spec.md Section 8.4. Compatibility note: why AID uses purpose-built signing (DID binding, body commitment, mutual auth, simplicity), concept mapping table, migration path to RFC 9421 profile. March 24.
- [x] D.8: protocol/product boundary — covered by spec abstract ("IS / IS NOT" sections) + composability.md cross-protocol design. Marked done in March 24 audit.

### New Spec Content (doesn't exist yet in AIDplan)
- [x] Deterministic arithmetic spec (Opus #16 — CRITICAL for DIF). Added Section 4.1.2 with 6-step numbered algorithm, IEEE 754 binary64 requirement, explicit roundHalfUp mode, left-to-right evaluation order, cross-language implementation table (JS/Python/Rust/Go), worked example showing exact IEEE 754 intermediate values. March 24.
- [ ] Standalone threat model document (Opus #15 — extract from AIDplan Parts 3 A, B, E, F)
- [ ] KERI compatibility note (Opus #10 — spec note, zero code). **Strategic for DIF** — KERI is a DIF project. Showing compatibility = good politics.
- [ ] ACDC interop note (Opus #11). **Strategic for DIF** — ACDCs are DIF/ToIP. Same political value.
- [ ] IPLD encoding note (Opus #12). Lower priority — relevant to Phase 2+ decentralization, not DIF submission.
- [ ] OpenTelemetry mapping note (Opus #13). Lower priority — observability tooling, not differentiating for DIF.
- [ ] Biscuit token evaluation note (Opus #14). Lowest priority — authorization tokens, tangential to trust scoring.
- [ ] Profile registry governance (Opus #17)

### Standards Vocabulary Alignment (Opus audit, March 24)
- [x] IETF RFC 9334 (RATS Architecture) — Appendix B with role mapping (Attester/Verifier/Relying Party/Endorser), data flow mapping (Evidence/Attestation Result/Reference Values), architectural differences (behavioral trust + offline verification). March 24.
- [ ] W3C Data Integrity proof format — compatibility note showing AID trust snapshots expressible as Data Integrity proofs. Moderate priority.
- [ ] NIST SP 800-63 assurance level framing — frame trust tiers (new → proceed) as analogous to Identity Assurance Levels. Moderate priority. Already partially addressed in NIST NCCoE comment doc.
- [ ] DID:webs trust anchoring — align terminology with closest existing DIF work. Strategic but not blocking.

### Validation
- [ ] E2E scenario conformance tests (Opus #18)
- [ ] Run against external harnesses (msaleme v3.6.0, rsbasic mesh, AIWG vectors)
- [x] Concrete test vectors with exact SHA-256 proof hashes — 8 vectors in test-vectors/trust-score.json (March 24)
- [x] Intermediate value test vectors — all 7 positive vectors now include full intermediates: volume, d1, d2, d3, d4, rawScore. IEEE 754 exact values (e.g., d3=4.9399999999999995). Two vectors include jcsCanonical. March 24.
- [ ] Cross-language test vectors (Python + Rust produce identical scores to TS reference)
- [ ] Sensitivity analysis — which parameters matter most, degradation curves if assumptions off by 2x (addresses R1 without requiring formal proof)

## What's Left to Ship (DIF Submission)

- [ ] **⚠️ Submit NIST NCCoE comment — DEADLINE APRIL 2 (9 days).** Document exists at `aid-spec/docs/nist-nccoe-comment.md` (96 lines). Confirm whether submitted or submit immediately.
- [ ] Get 1 external MCP server operator running mcp-trust — **HIGHEST ROI ACTION** (transforms narrative from "one company" to "emerging ecosystem")
- [ ] Rewrite DIF slides — present ONLY what AID-Trust does today (identity, scoring, Merkle verification, mutual auth). Do NOT mention EigenTrust, simulation results, or settlement.
- [ ] Submit AID-Trust to DIF TAAWG as focused spec

### DIF Submission Must-Haves (before submitting)
- [ ] Audit findings AF-1 through AF-6 resolved (existing work must be consistent)
- [x] R2 closed — deterministic arithmetic with intermediate test vectors (Section 4.1.2 + trust-score.json, March 24)
- [x] ABNF (D.1) + JSON Schema (D.2) in spec — Section 5.2.1 + 5.2.2, March 24
- [x] RFC 9421 compatibility note in spec — Section 8.4, March 24
- [ ] At least 1 external implementer (O7)

### DIF Submission Nice-to-Haves (strengthen but don't block)
- [x] RATS vocabulary alignment — Appendix B, March 24
- [ ] Sensitivity analysis for scoring parameters (R1)
- [ ] KERI + ACDC compatibility notes (DIF political value)
- [ ] Cross-language reference implementations
- [ ] Simulation harness results

## Recommended Build Order

1. **Fix AF-1 through AF-6** — prerequisite, existing work must be consistent before building new
2. **Submit NIST NCCoE comment** — deadline April 2, time-sensitive
3. **R2: Deterministic arithmetic** — hardest must-have, unblocks intermediate test vectors
4. **D.1: ABNF headers** — mechanical spec writing, ~30 min
5. **D.2: JSON Schema** — mechanical spec writing, ~30 min
6. **D.7: RFC 9421 note** — mechanical spec writing, ~30 min
7. **O7: External implementer outreach** — parallel, user-driven, highest ROI
8. **Nice-to-haves** — RATS vocabulary first, then KERI/ACDC, then sensitivity analysis

## AIDplan Source Sections

Content to extract from AIDplan:
- Part 2 A (A.1-A.10): Identity + trust scoring + mutual auth
- Part 2 D (D.1-D.8): Formal definitions (ABNF, JSON Schema, signing, errors, conformance)
- Part 3 A: Threat model + attack vectors (trust-relevant subset)
- Part 3 B: Anti-gaming defenses
- Part 3 E: MCP ecosystem security
- Part 3 F: Infrastructure security
