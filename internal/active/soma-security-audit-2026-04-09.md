# Soma Protocol Security Audit — 2026-04-09

**Scope:** Full-stack audit across Soma open-source repo, ClawNet integration code, sense-observer, soma-check, pulse, and all internal design docs.
**Method:** 8 parallel auditor agents — code-level line-by-line review + design review + attack harness gap analysis + online security research with academic sources.
**Prior audit:** Extends `soma-security-audit-2026-04-07.md`. Prior C1 (race condition) FIXED via AsyncLocalStorage. Prior H4 (no Zod on verdict) FIXED. Prior H7 (no rate limits on reads) FIXED.

---

## CRITICAL (5)

### C1. HKDF Is Not HKDF — Bare SHA-256 Truncation
**File:** `Soma/src/core/crypto-provider.ts:163-174`
The `deriveKey()` function is documented as "HKDF" throughout the codebase but is actually `SHA-256(input).slice(0, length)`. No salt, no info context, no domain separation. If `length > 32`, reads uninitialized buffer memory.
**Impact:** Every derived key in the system (vault encryption, HMAC tokens, seed nonces) shares the same KDF with no isolation. Recovering one derived key could relate to others from the same root.
**Fix:** Replace with Node.js `crypto.hkdfSync('sha256', ikm, salt, info, length)` with unique info strings per derivation context.

### C2. Credential Vault Key Has No Domain Separation
**File:** `Soma/src/heart/credential-vault.ts:28`
Vault encryption key is `SHA-256(signingSecretKey)` — identical output to any other `deriveKey(signingSecretKey, 32)` call. The HMAC key derivation in `seed.ts:356-359` uses a weak `"|soma:hmac"` delimiter instead of proper HKDF info.
**Fix:** Use HKDF with info `"soma:vault:v1"` for vault, `"soma:hmac:v1"` for HMAC.

### C3. Revocation Registry Accepts Revocations From Anyone
**File:** `Soma/src/heart/revocation.ts:158-165`
`RevocationRegistry.add()` verifies the signature is cryptographically valid but does NOT verify the issuer had authority over the target credential. Any Ed25519 key can sign a revocation for ANY credential ID. Confirmed in attack test #3 — the test manually checks `issuerDid` match but the registry itself accepts it.
**Impact:** Denial-of-service: attacker who knows a delegation ID forges a revocation with their own key, causing the delegation to appear revoked.
**Fix:** `add()` must accept expected issuer DID and reject mismatches.

### C4. No Domain Separation in Signing Inputs — Cross-Primitive Confusion
**File:** `Soma/src/heart/delegation.ts`, `revocation.ts`, `lineage.ts`
`createDelegation`, `createRevocation`, and `createLineageCertificate` all sign `canonicalJson(payload)` with NO domain prefix. The VRF correctly uses `"soma-vrf-input:v1:"`, mutual-session uses `"soma-mutual-session/1"`, but delegation/revocation/lineage do not. If two different primitive payloads produce the same canonical JSON, signatures become cross-usable.
**Fix:** Prepend domain prefix: `"soma-delegation:v1:" + canonicalJson(payload)`.

### C5. Dead Agent Trees Accept New Leaves — No Death Seal (ClawNet)
**File:** `claw-net/src/core/soma-heartbeat.ts:188-217`
`appendLeaf()` has zero checks for prior DEATH leaves (type 0x07). After `appendDeath()`, the tree is evicted from cache but rebuilt on next access. Any subsequent append succeeds silently — dead agent revived.
**Fix:** Guard in `appendLeaf()` checking for existing DEATH leaf before allowing appends.

---

## HIGH (20)

### Soma Repo — Heart

**H1. Session Key Reused Across Crypto Contexts Without Separation**
`Soma/src/core/channel.ts:92` — X25519 shared secret used directly as secretbox key AND exposed via `channel.sessionKey` for HMAC/seed derivation. Compromise in any context cascades.

**H2. Delegation Chain Depth Unbounded**
`Soma/src/heart/delegation.ts` — `attenuateDelegation()` has no depth counter or `max_depth` enforcement despite the spec defining it. Enables DoS via 10K-deep chains.

**H3. Birth Certificates Have No Expiry**
`Soma/src/heart/birth-certificate.ts` — `bornAt` exists but no `expiresAt`. Certs signed by pre-rotation compromised keys remain valid forever.

**H4. Threshold Signing Reconstructs Full Secret In Memory**
`Soma/src/heart/threshold-signing.ts:211-240` — `secretKey.fill(0)` in finally block, but JS GC may have copied data. Intermediate arrays in `reconstructSecret()`/`evalPoly()` never scrubbed. NOT FROST.

**H5. No Delegation Chain Verification Function**
`Soma/src/heart/delegation.ts` — `verifyDelegation()` checks a single link. No function verifies full chain (parent signatures, subject continuity, monotonic capability narrowing, caveat accumulation).

### Soma Repo — Sensorium

**H6. Profile Poisoning During Embryonic Phase**
`Soma/src/sensorium/matcher.ts:196-207` — First 10 observations forced to AMBER. Attacker who controls initial interactions establishes poisoned baseline; subsequent legitimate observations trigger RED.

**H7. Signal Tap Processes Unverified Messages**
`Soma/src/mcp/signal-tap.ts:113-168` — `tap()` extracts phenotypic signals from ANY JSON-RPC message with no HMAC verification. Malicious MCP server can craft responses to bias all senses.

**H8. Heart Presence Auto-Sets Verification Flags**
`Soma/src/mcp/soma-session.ts:153-157` — `heartSeedVerified` and `birthCertificateChain` set to `true` because `this.heart !== null`, not because anything was verified. Violates "origin is not truth."

**H9. No Token-Level HMAC Verification In Observer Path**
`Soma/src/mcp/soma-session.ts:143-182` — Session extracts signals and updates phenotypic profile but never verifies per-token HMACs. Poisoned data flows into classification.

**H10. MCP Handshake Can Be Silently Downgraded**
`Soma/src/mcp/soma-session.ts:102-119` — If client's `initialize` lacks `_soma` metadata, session enters DEGRADED permanently. MITM who strips `_soma` forces unencrypted, unverified mode.

**H11. Channel MITM via Unsigned Ephemeral Keys**
`Soma/src/core/channel.ts:70` — `establishChannel()` verifies genome commitment but ephemeral X25519 key is NOT signed by identity key. Active MITM substitutes ephemeral keys, establishes two channels.

### Soma Repo — Research Findings

**H12. TweetNaCl Ed25519 Malleability (S < L)**
[GitHub Issue #253](https://github.com/dchest/tweetnacl-js/issues/253) — `nacl.sign.detached.verify()` doesn't check S < L (group order). Given valid (R, S), attacker computes (R, S+L) which also verifies. Affects dedup/replay tracking via `sha256(cert.receiverSignature)` — malleable signatures produce different parent hashes.
**Fix:** Replace with Node.js native `crypto.verify('ed25519', ...)` which enforces S < L.

**H13. Hybrid Signature Stripping / Downgrade**
`Soma/src/heart/hybrid-signing.ts` — `signVCAdaptive()` returns `{ signature: hybrid.ed25519, hybrid }` — the `signature` field is always Ed25519-only for backward compat. Consumers reading only `signature` get Ed25519-only, defeating PQ hybrid.
**Fix:** Bind signatures: sign `H(ed25519_sig || message)` with ML-DSA, making stripping invalidate both.

### Soma Repo — Design

**H14. Revocation Propagation Is Local-Only**
`Soma/src/heart/gossip.ts` — Only `InMemoryTransport` ships. No libp2p/NATS/Redis adapter. Revocations never reach remote verifiers. Revoked credentials remain valid everywhere except the local process.

**H15. Nova IVC Does Not Exist**
No prover binary in Soma or claw-net repos. The "192-byte proof, 5ms verify" headline and the token architecture both depend on a Rust binary that has not been started. Multiple internal docs mark it as "done."

### ClawNet Integration

**H16. Challenge Response No Authorization Check**
`claw-net/src/routes/soma-challenge.ts:187-202` — Any API key holder can concede any challenge, triggering bond slashing against the computation owner.

**H17. Wallet Ownership Proof Verifies Wrong Key**
`claw-net/src/core/soma-wallet.ts:200-250` — Signs with HKDF domain `'sign'`, verifies against `'identity'`. Different keys. All proofs fail external verification.

**H18. Pulse Returns verified=true On Hash Mismatch**
`pulse/src/intelligence/soma-verify.ts:66-79` — Hash mismatch returns `{ verified: true }` with soft warning. Combined with H19, Pulse verification is decorative.

**H19. Pulse Does Not Verify Ed25519 Signatures**
`pulse/src/intelligence/soma-verify.ts:51-52` — Only checks signature/publicKey are truthy strings. Never calls crypto verification.

**H20. Soma Check Stats Routes — No Auth, Unbounded Query**
`claw-net/src/routes/soma-check.ts:15-45` — No auth, no rate limit, no cap on `sinceHours`. DoS via full table scan.

---

## MEDIUM (25)

### Soma Repo

| # | Finding | File |
|---|---------|------|
| M1 | Temporal sense carries 88.5% of classifier weight — timing proxy defeats it | `sensorium/senses/index.ts:61-66` |
| M2 | Custom caveats silently ignored during verification | `heart/delegation.ts:269-271` |
| M3 | Date.now() used everywhere, time oracle never integrated | Multiple heart files |
| M4 | Gossip peer drops out-of-order entries silently — revocations missed | `heart/gossip.ts:189-197` |
| M5 | InProcessBackend stores secret keys in plain Map | `heart/signing-backend.ts:103-106` |
| M6 | No forward secrecy rotation in MCP sessions | `mcp/soma-session.ts:194-218` |
| M7 | No transcript binding in encrypted messages — reorder/replay possible | `mcp/soma-session.ts:283-294` |
| M8 | smartFetch has no SSRF protection | `sensorium/smart-fetch.ts:134-138` |
| M9 | smartFetch body cache unbounded — OOM | `sensorium/smart-fetch.ts:109` |
| M10 | Landscape observationTimestamps grows without bound | `sensorium/landscape.ts:130` |
| M11 | Profile persistence every 10 observations creates I/O storms at scale | `mcp/soma-session.ts:185-189` |
| M12 | Receipt verification has no replay protection | `sensorium/receipt-verifier.ts:152-225` |
| M13 | Supply chain release log has no timestamp monotonicity check | `supply-chain/release-log.ts:162-169` |
| M14 | X25519 all-zeros shared key not checked | `core/channel.ts` |
| M15 | @noble/post-quantum is unaudited, no side-channel protection | `(research finding)` |
| M16 | Genome canonicalize.ts vs genome.ts use different algorithms (shallow vs deep sort) | `core/genome.ts:48-50` |
| M17 | Atlas classification margin threshold hardcoded at 0.5 | `sensorium/matcher.ts:276` |
| M18 | ProfileStore has no concurrent access protection | `mcp/profile-store.ts:33-59` |

### ClawNet Integration

| # | Finding | File |
|---|---------|------|
| M19 | Bilateral commitment non-atomic — silent Sybil resistance degradation | `soma-heartbeat.ts:287-311` |
| M20 | Checkpoint TOCTOU race between DB and Pulse Tree | `soma-checkpoint.ts:108-202` |
| M21 | Custody destruction proof not validated | `soma-custody.ts:208-248` |
| M22 | Tree cache unbounded — OOM at scale | `soma-heartbeat.ts:51` |
| M23 | Receipt verify broken for receipts with paymentRef | `routes/soma.ts:468-508` |
| M24 | MCP ephemeral key never rotated | `mcp/soma-mcp-wrapper.ts:25-32` |
| M25 | BirthCertificate type mismatch between packages (pulse vs sense-observer) | Cross-package |

---

## DESIGN-LEVEL STRATEGIC FINDINGS

### D1. Revenue Model Incoherence — 3 Conflicting Versions
- `founding-protocol.md`: 10% flat fee after Soma ships
- `token-architecture.md`: Free routing, $0 platform cut
- `golden-plan.md`: 5-10% on live calls

### D2. Heart Is a Signer, Not a Runtime (ClawNet Integration)
Philosophy claims "agents compute THROUGH the heart." ClawNet calls upstream providers directly via `clawapis.ts`, then signs with heart. Heart is a signing module, not a compute runtime. Sensorium behavioral verification is irrelevant in production.

### D3. Two Overlapping Delegation Specs
`SOMA-CAPABILITIES-SPEC.md` (Ed25519 tokens + caveats + audience) and `SOMA-DELEGATION-SPEC.md` (HTTP headers + server enforcement) solve the same problem in incompatible ways. No shared wire format.

### D4. Trust Farming — No Defenses Built
Agent makes 1K cheap calls over 90 days, builds trust, executes one high-value fraud. No anomaly detection, no value-proportional bonding, no EigenTrust. Bilateral commitment and conservation-of-trust are "PROPOSED, not yet in code."

### D5. SQLite Scaling Cliff
Trust-mining doc projects 100M folds/day at 1M agents. Single-writer SQLite WAL cannot handle this.

### D6. 10 Legacy Senses Ship But Score Below 15% Accuracy
`sensorium/senses/` exports adversarial, calibration, capability-boundary, consistency, context-utilization, entropy, logprob, multiturn alongside the 3 focused senses. Dead code that bloats attack surface.

### D7. No Real TEE Verifiers
`remote-attestation.ts` ships `NoopVerifier` and `MockTeeVerifier` only. No SGX, SEV, Nitro, TrustZone. Tier 2 deployment described as if real — it's not.

---

## ATTACK TEST GAPS (Missing Tests #16-24)

| # | Attack | Target | Severity |
|---|--------|--------|----------|
| 16 | Sybil flood on AttestationRegistry | `attestation.ts` | High |
| 17 | Gossip eclipse / partition | `gossip.ts` | High |
| 18 | Channel MITM via unsigned ephemeral keys | `channel.ts` | High |
| 19 | Key rotation split-brain verifier | `key-rotation.ts` | High |
| 20 | Credential vault cross-key oracle | `credential-vault.ts` | Medium |
| 21 | Delegation chain depth bomb (10K deep) | `delegation.ts` | Medium |
| 22 | Selective disclosure salt brute-force | `selective-disclosure.ts` | Medium |
| 23 | Spend receipt negative amount injection | `spend-receipts.ts` | High |
| 24 | VRF last-revealer withholding in beacon | `vrf.ts` | Medium |

### Weak Existing Test Assertions
- Attack #3: Registry ACCEPTS third-party revocations — test only catches it via manual app-level check
- Attack #6: `detectDoubleSpend` returns null but test doesn't verify the specific reason
- Attack #10: Shamir reconstruction with bogus share succeeds silently — test documents gap, doesn't defend
- Experiment replay: Detection is just `seedsDiffer` (random keys always differ) — no actual verification

---

## ONLINE RESEARCH — GOLDEN IDEAS

### Adopt Now (Low Effort, High Impact)
| Idea | Source | Fix |
|------|--------|-----|
| Replace tweetnacl verify with Node native `crypto.verify('ed25519')` | [tweetnacl#253](https://github.com/dchest/tweetnacl-js/issues/253) | Fixes S < L malleability |
| X25519 all-zeros check after key exchange | [RFC 7748](https://www.rfc-editor.org/rfc/rfc7748) | One-line addition to channel.ts |
| Length-prefixed HMAC messages instead of pipe delimiter | Standard practice | Prevents delimiter injection in token HMACs |
| Composite signature binding (IETF draft) | [draft-ietf-lamps-pq-composite-sigs](https://datatracker.ietf.org/doc/draft-ietf-lamps-pq-composite-sigs/) | Prevents hybrid stripping |

### Adopt Later (Design Work Required)
| Idea | Source | Benefit |
|------|--------|---------|
| FROST threshold Ed25519 (no secret reconstruction) | [RFC 9591](https://www.rfc-editor.org/rfc/rfc9591) | Eliminates threshold attack surface |
| @noble/curves to replace tweetnacl | [npm](https://www.npmjs.com/package/@noble/curves) | Audited, maintained, Ristretto255, S < L enforced |
| Semantically conditioned watermarks | [arxiv 2505.16723](https://arxiv.org/html/2505.16723v2) | More robust than behavioral prompt injection |
| Feldman/Pedersen VSS for share verification | [ZKDocs](https://www.zkdocs.com/docs/zkdocs/protocol-primitives/verifiable-secret-sharing/) | Detect dealer cheating in key escrow |

### Key Research Context
- AI fingerprinting can be defeated by adaptive adversarial attacks ([arxiv 2509.26598](https://arxiv.org/abs/2509.26598)) — validates Soma's "advisory, not primary" positioning
- ML-DSA-65 (FIPS 204) is finalized but @noble/post-quantum is unaudited — defer PQ production use
- LLM stylometric fingerprinting achieves 88-98% accuracy ([arxiv 2507.00838](https://arxiv.org/html/2507.00838v2)) — validates the approach but adversarial robustness is weak
- TweetNaCl has 23M+ weekly downloads but hasn't been updated in 6 years

---

## PRIORITY ACTION MATRIX

### Immediate (blocks credibility)
| # | Finding | Effort |
|---|---------|--------|
| C1 | Real HKDF in crypto-provider.ts | 2hr |
| C2 | Domain-separated vault key | 30min (after C1) |
| C3 | Revocation issuer authority check | 1hr |
| C4 | Domain prefixes on delegation/revocation/lineage signing | 1hr |
| C5 | Death seal enforcement in appendLeaf | 1hr |
| H12 | Replace tweetnacl verify with Node native | 2hr |
| H16 | Challenge auth check in ClawNet | 30min |

### This week
| # | Finding | Effort |
|---|---------|--------|
| H2 | Delegation depth limit | 1hr |
| H3 | Birth certificate expiry field | 2hr |
| H5 | Chain verification function | 4hr |
| H8 | Decouple heart flags from observer verdict | 2hr |
| H9 | HMAC verification before signal extraction | 3hr |
| H10 | Require _soma in handshake (fail-closed) | 1hr |
| H11 | Sign ephemeral keys with identity key | 2hr |
| H14 | X25519 all-zeros check | 15min |
| H18+H19 | Fix Pulse verification (real crypto checks) | 3hr |
| H20 | Stats route auth + sinceHours cap | 30min |

### This sprint
| # | Finding | Effort |
|---|---------|--------|
| M2 | Custom caveats fail-closed | 1hr |
| M4 | Gossip out-of-order buffering | 3hr |
| M6 | Session key ratcheting | 4hr |
| M7 | Transcript hash binding | 2hr |
| M8 | SSRF blocklist in smartFetch | 1hr |
| M12 | Receipt replay protection (nonce tracking) | 2hr |
| M19 | Atomic bilateral commits (ClawNet) | 2hr |
| M23 | Receipt verify paymentRef fix (ClawNet) | 1hr |

### Design debt
| # | Finding | Impact |
|---|---------|--------|
| D1 | Revenue model reconciliation | Provider trust |
| D2 | Heart-as-runtime vs heart-as-signer | Philosophy integrity |
| D3 | Merge delegation specs | Developer clarity |
| D4 | Trust farming defenses / EigenTrust | Protocol security at scale |
| H15 | Nova IVC — build or stop claiming | Strategic credibility |
