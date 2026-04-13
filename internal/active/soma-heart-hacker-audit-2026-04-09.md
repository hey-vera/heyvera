# Soma Heart — Hacker's Attack Playbook

**Date:** 2026-04-09
**Threat model:** soma-heart is open source. Any attacker can `npm install soma-heart`, read every line of code, run a local instance, reverse-engineer the protocol, and attempt to exploit it against production hearts.
**Companion doc:** `soma-security-audit-2026-04-09.md` (broader protocol audit)

---

## Part 1: Attack Surface Map

An installed soma-heart exposes these surfaces:

| Surface | Entry point | What attacker touches |
|---|---|---|
| Handshake | `createSession()` / `completeHandshake()` | Ephemeral key exchange, genome verification |
| Token stream | `generate()` / `callTool()` / `fetchData()` | HMAC-per-token, encrypted channel |
| Delegation | `createDelegation()` / `attenuateDelegation()` | Capability tokens, caveats |
| Revocation | `RevocationRegistry.add()` | Revocation events |
| Lineage | `createLineageCertificate()` | Parent-child identity chain |
| Persistence | `saveHeartState()` / `loadHeartState()` | Encrypted blob on disk |
| Credential vault | `CredentialVault.store()` / `.retrieve()` | API keys, tool credentials |
| Heartbeat chain | `HeartbeatChain.record()` / `.restore()` | Tamper-evident computation log |
| Threshold signing | `SigningCeremony` / `thresholdSign()` | Secret reconstruction |
| Selective disclosure | `createDisclosureProof()` | Partial claim reveal |
| Gossip | `GossipTransport.publish()` | Revocation propagation |
| Remote attestation | `AttestationDocument` | TEE binding |

---

## Part 2: Exploit Chains (Ordered by Severity)

### EXPLOIT 1: Revocation Forgery — Any Key Can Kill Any Credential
**Severity:** CRITICAL | **Difficulty:** Trivial | **Files:** `revocation.ts:158-165`

**The bug:** `RevocationRegistry.add()` verifies the revocation signature is *cryptographically valid* but does NOT verify the signer had *authority* over the target credential. The code even has a comment acknowledging this:

```
NOTE: this does NOT verify the issuer had authority over the target
```

**Attack steps:**
1. Read a delegation ID from public logs, API responses, or gossip traffic (IDs like `dg-xxxx` are included in verification chains)
2. Generate a fresh Ed25519 keypair (`nacl.sign.keyPair()`)
3. Create a RevocationEvent with `targetId = victim's delegation ID`, sign with your fresh key
4. Submit to any RevocationRegistry that accepts events (e.g., via gossip or direct API)
5. Registry calls `verifyRevocation()` — signature is valid (it's YOUR valid signature)
6. `this.byTarget.set(event.targetId, event)` — revocation accepted
7. Any service checking `isRevoked(targetId)` now returns `true`

**Result:** Permanent denial of service. The legitimate delegation is dead. The victim must create an entirely new delegation chain.

**Why this is devastating:** Delegation IDs are not secrets — they appear in chain verification, audit logs, and gossip traffic. The attacker needs zero privileged access.

**Fix required:** `add()` must accept the expected issuer DID and reject revocations from unauthorized signers. OR: revocation events must include the original delegation's issuerDid, and the registry must cross-check.

---

### EXPLOIT 2: Channel MITM via Unsigned Ephemeral Keys
**Severity:** CRITICAL | **Difficulty:** Medium (requires network position) | **Files:** `channel.ts:70-92`

**The bug:** `establishChannel()` verifies the remote genome commitment (identity), but the ephemeral X25519 public key in the handshake is NOT signed by the identity key. The ephemeral key is just a raw base64 string in the HandshakePayload.

**Attack steps:**
1. Mallory positions between Alice (heart) and Bob (observer) on the network
2. Alice sends HandshakePayload: `{did: "did:soma:alice", genomeCommitment: {...}, ephemeralPublicKey: "alice_ephem"}`
3. Mallory intercepts, generates her own X25519 keypair
4. Mallory forwards to Bob: `{did: "did:soma:alice", genomeCommitment: {...}, ephemeralPublicKey: "mallory_ephem_1"}`
5. Bob sends his HandshakePayload back — Mallory intercepts again, substitutes her second ephemeral key
6. Both Alice and Bob verify genome commitments (which are genuinely Alice's and Bob's) — PASS
7. But the derived shared keys are: Alice-Mallory and Mallory-Bob
8. Mallory decrypts all traffic, can modify tokens in transit, re-encrypts for the other side

**Compounding factor (H9):** The signal tap in `soma-session.ts` processes MCP messages for phenotypic sensing WITHOUT verifying per-token HMACs. Even if the heart generates valid HMACs, Mallory can strip/replace them because the observer never checks.

**Result:** Complete breach of channel confidentiality + integrity. Observer's phenotypic profile of the heart is poisoned by Mallory's modifications.

**Fix required:** Ephemeral key must be signed by identity key: `sign(ephemeralPublicKey, signingSecretKey)`, included in handshake, verified before key exchange.

---

### EXPLOIT 3: Key Universe Collapse via Fake HKDF
**Severity:** CRITICAL | **Difficulty:** Analytical | **Files:** `crypto-provider.ts:170-172`, `credential-vault.ts:27-28`, `seed.ts:356-359`

**The bug:** `deriveKey()` is `SHA-256(input).slice(0, length)` — not HKDF. No salt, no info parameter, no domain separation. Every call with the same input produces the identical output regardless of purpose.

**Attack chain:**
1. Vault encryption key = `SHA-256(signingSecretKey)` (credential-vault.ts:27)
2. HMAC key = derived from `sessionKey || "|soma:hmac"` (seed.ts) — but sessionKey itself may be used in other derivations
3. If an attacker discovers ANY derived key from a given input, they know ALL derived keys from that input
4. Specifically: if the HMAC key derivation path is `SHA-256(sessionKey + delimiter)`, and the attacker can observe enough HMAC outputs to narrow the key space...
5. The vault key is `SHA-256(signingSecretKey)` — if any OTHER derivation also takes `signingSecretKey` as input with no salt/info, they produce the same key

**Buffer overread:** If `length > 32`, the code does `new Uint8Array(digest.buffer, digest.byteOffset, length)` — this reads past the 32-byte SHA-256 digest into uninitialized Buffer pool memory. In Node.js, `Buffer.allocUnsafe()` recycles memory — the overread could contain fragments of other operations (private keys, API tokens, etc.).

**Result:** All key derivation in the protocol shares a single SHA-256 call with no isolation. Any break in one context cascades to all.

---

### EXPLOIT 4: Cross-Primitive Signature Confusion
**Severity:** HIGH | **Difficulty:** Medium | **Files:** `delegation.ts:120`, `revocation.ts:95`, `lineage.ts:103`

**The bug:** `createDelegation`, `createRevocation`, and `createLineageCertificate` all sign `canonicalJson(payload)` with NO domain prefix. The signing input is just `TextEncoder.encode(canonicalJson(payload))`.

Meanwhile, selective-disclosure correctly uses `"soma-disclosure/1"` as a domain prefix, and VRF uses `"soma-vrf-input:v1:"`. The three most critical primitives lack this protection.

**Attack scenario:** If an attacker can craft two different primitive payloads that produce identical canonical JSON, a signature for one is valid for the other. While field names differ between types (delegation has `subjectDid`, revocation has `targetId`), the canonical JSON serializer is deterministic — the attack requires field-name collision, which is unlikely today but becomes possible if new fields are added.

**More practical variant:** An attacker with a signed delegation can study whether any subset of the delegation's canonical JSON, when reinterpreted as a different primitive type, passes that primitive's verification. Since verification functions destructure `{ signature, ...payload }` and re-canonicalize, the attack surface is the intersection of field names.

**Fix required:** All signing inputs must be prefixed: `"soma-delegation:v1:" + canonicalJson(payload)`, `"soma-revocation:v1:" + ...`, etc.

---

### EXPLOIT 5: Delegation Chain Depth Bomb + Missing Chain Verification
**Severity:** HIGH | **Difficulty:** Easy | **Files:** `delegation.ts:133-165`

**The bug:** Two compounding issues:
1. `attenuateDelegation()` has no depth counter or `max_depth` enforcement
2. No function exists to verify a full delegation chain (parent-to-child continuity, monotonic capability narrowing, caveat accumulation)

**Attack steps:**
1. Create root delegation A→B
2. Attenuate: B→C, C→D, D→E... to depth 100,000
3. Submit the chain to a verifier
4. Since `verifyDelegation()` only checks a single link, the verifier must walk the chain manually
5. With 100K links, this is a DoS on verification CPU/memory
6. Worse: since no chain verification function exists, most integrators will only verify the leaf — missing any capability escalation in intermediate links

**Capability escalation variant:**
1. Root grants B: `capabilities: ['tool:search']`
2. B attenuates to C with `capabilities: ['tool:search', 'tool:admin']` — this should fail the subset check
3. BUT `attenuateDelegation()` only checks `opts.parent.capabilities.includes(cap)` on the PARENT delegation
4. If B creates a fresh delegation (not via attenuate) claiming parentId=A's ID, there's no chain verification to catch the broadening

---

### EXPLOIT 6: Persistence Blob Offline Brute-Force
**Severity:** HIGH | **Difficulty:** Medium (requires file access) | **Files:** `persistence.ts:217-258`

**The bug:** The encrypted blob's outer envelope exposes KDF parameters in plaintext (`kdf`, `N`, `r`, `p`). While these parameters can't be downgraded (changing them produces wrong key = decryption fails), they DO tell the attacker exactly how expensive brute-force will be.

**Attack steps:**
1. Gain read access to the heart state file (compromised backup, stolen device, cloud storage breach)
2. Read the blob JSON: scrypt N=2^17, r=8, p=1 (OWASP minimum)
3. At OWASP minimum params, one scrypt eval takes ~130ms on CPU
4. With a GPU cluster: ~10K evals/second on a single RTX 4090
5. If password has < 40 bits of entropy (common): cracked in under 24 hours
6. Extracted state contains: `signingKeyPair` (full identity theft), `boxKeyPair`, `genomeHash`, vault contents
7. Vault encryption key = `SHA-256(signingSecretKey)` — automatically derived, no additional password

**Result:** Full identity takeover. Attacker can sign delegations, lineage certs, revocations as the victim. Can decrypt the credential vault (API keys, tokens).

**Compounding factor:** `loadHeartState` supports legacy PBKDF2 blobs (`kdf: "pbkdf2-sha256"`) — if any hearts were saved with PBKDF2 before the scrypt migration, those blobs are drastically easier to brute-force.

---

### EXPLOIT 7: Session ID Prediction via Math.random()
**Severity:** HIGH | **Difficulty:** Medium | **Files:** `runtime.ts:644`

**The bug:** Session ID = `sha256(${did}|${remoteDid}|${Date.now()}|${Math.random()})`. Both `did` and `remoteDid` are public. `Date.now()` is millisecond precision and observable. `Math.random()` uses V8's xorshift128+ PRNG, which can be fully reversed from 4 consecutive outputs.

**Attack steps:**
1. Open multiple sessions with a target heart in quick succession
2. Observe session IDs returned (they're sent back to the caller)
3. Since `did`, `remoteDid` are known and `Date.now()` is narrowed to a few milliseconds, the unknown is only `Math.random()`
4. From 4 observed session IDs, reverse the xorshift128+ internal state
5. Predict future session IDs
6. Pre-inject entries into the sessions Map (if any code path allows it) or front-run session operations

**Result:** Session hijacking. An attacker who can predict session IDs can race the legitimate party to complete handshakes or inject heartbeat records.

**Fix required:** Use `crypto.randomUUID()` or `crypto.getRandomValues()` instead of `Math.random()`.

---

### EXPLOIT 8: Heartbeat Chain Tampering via Restore Trust
**Severity:** HIGH | **Difficulty:** Easy (requires file access) | **Files:** `heartbeat.ts:121-128`

**The bug:** `HeartbeatChain.restore()` accepts a chain array and trusts it completely. The comment says "The caller is responsible for verifying integrity first via HeartbeatChain.verify()." But `loadSomaHeart()` calls `restore()` WITHOUT calling `verify()` first.

**Attack steps:**
1. Gain write access to the persisted heart state
2. Modify the heartbeat chain: inject fake records, delete incriminating records, alter timestamps
3. Heart loads the tampered state, calls `restore()` on the modified chain
4. Chain is accepted as-is — no integrity verification
5. Future heartbeats chain off the tampered tail

**Result:** Tamper-evident log is silently tampered. An agent that misbehaved can scrub the evidence from its heartbeat chain.

---

### EXPLOIT 9: Ed25519 Signature Malleability (S < L)
**Severity:** HIGH | **Difficulty:** Easy | **Files:** `crypto-provider.ts:132-134` (tweetnacl)

**The bug:** `nacl.sign.detached.verify()` does not enforce S < L (scalar less than group order). Given a valid signature (R, S), an attacker computes (R, S + L) which also passes verification.

**Impact on birth certificate chains:** Birth cert parent hash = `sha256(cert.receiverSignature)`. If the signature is malleable, two different parent hashes can reference the same original cert. An attacker can:
1. Take a legitimate birth cert with signature S
2. Compute S' = S + L (malleable variant)
3. Create a new cert with `parentHash = sha256(S')`
4. The new cert claims to descend from the original, but through a different hash path
5. This creates a fork in the birth cert chain — two different lineages branching from the same root

**Impact on deduplication:** Any system tracking "seen signatures" via hash will treat (R, S) and (R, S+L) as different signatures for the same message. Replay protection based on signature hashing is broken.

**Fix required:** Replace `nacl.sign.detached.verify()` with Node.js native `crypto.verify('ed25519', ...)` which enforces RFC 8032 S < L check.

---

### EXPLOIT 10: Custom Caveat Bypass — Fail-Open by Design
**Severity:** HIGH | **Difficulty:** Trivial | **Files:** `delegation.ts:269-271`

**The bug:** The `checkCaveats()` function has a `case 'custom': break;` — custom caveats are silently skipped with no verification whatsoever.

**Attack scenario:**
1. An organization issues a delegation with custom caveats: `{ kind: 'custom', key: 'require-mfa', value: 'true' }` and `{ kind: 'custom', key: 'geo-fence', value: 'US' }`
2. The issuer believes these caveats restrict usage to MFA-authenticated, US-based invocations
3. `checkCaveats()` hits `case 'custom': break;` — both caveats pass with zero checks
4. The delegation is usable from anywhere, with no MFA, because custom caveats are decorative

**Result:** Any security policy expressed as custom caveats is unenforced. The delegation system has an invisible escape hatch.

**Fix required:** Custom caveats must either: (a) fail-closed (reject unless an evaluator function is registered for that key), or (b) be passed to a user-provided callback that returns accept/reject.

---

### EXPLOIT 11: Threshold Signing — Memory Exfiltration
**Severity:** HIGH | **Difficulty:** Requires coordinator compromise | **Files:** `threshold-signing.ts:211-240`, `key-escrow.ts:76-83`

**The bug:** Shamir share reconstruction reassembles the full 64-byte Ed25519 secret key in memory. While `secretKey.fill(0)` runs in the `finally` block, JavaScript's garbage collector may have already copied the Uint8Array during heap compaction. Additionally, the `evalPoly()` and `lagrangeInterpolateAtZero()` functions create intermediate arrays that are NEVER scrubbed.

**Attack steps:**
1. Compromise the machine running the `SigningCeremony` coordinator
2. Wait for a signing ceremony (shares submitted asynchronously)
3. During `thresholdSign()`: dump process memory (V8 heap snapshot, core dump, /proc/pid/mem)
4. Search for 64-byte sequences that look like Ed25519 secret keys (first 32 bytes are seed, last 32 are public key)
5. Even after `fill(0)`, GC copies persist until the page is reused

**Compounding factor:** The share metadata (`secretId`, `threshold`, `totalShares`, `secretLength`) is transmitted in plaintext. An attacker who intercepts a single share learns the full topology of the share scheme.

**Result:** The "M-of-N" guarantee is broken. A coordinator compromise yields the full signing key, defeating the entire purpose of threshold signing.

---

### EXPLOIT 12: Selective Disclosure — Field Name Leakage
**Severity:** MEDIUM | **Difficulty:** Passive observation | **Files:** `selective-disclosure.ts:279`

**The bug:** `undisclosedCommitments` in a DisclosureProof includes field NAMES as keys, even for withheld fields. The verifier sees: `{ "hiv_status": "a8f2...", "criminal_record": "b3c1...", "ssn": "d4e5..." }` — values are hidden but names are exposed.

**Attack scenario:** A holder presents a proof to a service revealing only `kyc-tier`. The service learns the holder's document ALSO contains fields named `income`, `debt_ratio`, `nationality` — information the holder explicitly chose not to reveal.

**Fix required:** Use positional indices or random identifiers instead of field names for undisclosed commitments. The verifier reconstructs the root from disclosed field commitments + opaque commitment hashes (no names needed).

---

### EXPLOIT 13: Gossip Network — Unauthenticated Revocation Flood
**Severity:** MEDIUM | **Difficulty:** Easy | **Files:** `gossip.ts:43-55`, `revocation.ts:158-165`

**The bug:** Combines two weaknesses:
1. `GossipMessage` has no authentication — any peer can publish any message
2. `RevocationRegistry.add()` accepts revocations from any signer (Exploit 1)

**Attack steps (when real transport is deployed):**
1. Join the gossip network (subscribe to `"soma/revocations/v1"`)
2. Generate 10,000 fresh keypairs
3. For each known delegation ID, sign a revocation with a fresh key
4. Publish all 10,000 revocations to the gossip network
5. Every subscriber's registry accepts all of them (valid signatures, no authority check)
6. Mass credential invalidation across the entire network

**Current mitigation (accidental):** Only `InMemoryTransport` ships, so this attack requires a custom transport. But once any real transport is deployed, this becomes immediately exploitable.

---

### EXPLOIT 14: Profile Poisoning During Embryonic Phase
**Severity:** MEDIUM | **Difficulty:** Easy (requires timing) | **Files:** `sensorium/matcher.ts:196-207`

**The bug:** The first 10 observations of a heart are forced to AMBER status (embryonic phase). An attacker who controls these initial interactions establishes a poisoned behavioral baseline.

**Attack steps:**
1. Be the first observer to interact with a new heart
2. During embryonic phase, craft inputs that produce a specific behavioral pattern (token timing, structure, vocabulary)
3. Baseline is now "attacker-controlled behavior = normal"
4. When legitimate users interact with the heart, their patterns differ from the poisoned baseline
5. Legitimate interactions trigger RED (anomaly) verdicts

**Result:** The trust system is inverted. Real behavior looks suspicious, attacker-controlled behavior looks normal.

---

### EXPLOIT 15: X25519 Small-Subgroup Attack
**Severity:** MEDIUM | **Difficulty:** Medium | **Files:** `crypto-provider.ts:145-147`

**The bug:** `nacl.box.before()` performs X25519 key exchange without checking if the result is the all-zeros point. Certain crafted public keys (small-subgroup elements) force the shared secret to a known value.

**Attack steps:**
1. During handshake, send a small-subgroup X25519 public key as `ephemeralPublicKey`
2. `nacl.box.before(smallSubgroupKey, localSecret)` returns all-zeros (or a predictable low-order point)
3. The shared session key is now known to the attacker
4. All channel encryption uses this predictable key
5. Attacker can decrypt all traffic without MITM — just passive observation

**Mitigation note:** Curve25519 has cofactor 8, so there are only a few small-subgroup elements. A simple check `if (sharedKey.every(b => b === 0)) throw` would catch the most common case.

---

## Part 3: Attack Categorization Matrix

| # | Attack | Needs | Breaks | Difficulty |
|---|--------|-------|--------|------------|
| 1 | Revocation forgery | Delegation ID (public) | Availability | Trivial |
| 2 | Channel MITM | Network position | Confidentiality + Integrity | Medium |
| 3 | Key universe collapse | Analytical | All derived keys | Analytical |
| 4 | Cross-primitive confusion | Signed artifact | Integrity | Medium |
| 5 | Delegation depth bomb | Nothing | Verifier availability | Easy |
| 6 | Persistence brute-force | File access | Full identity | Medium |
| 7 | Session ID prediction | 4 session IDs | Session hijack | Medium |
| 8 | Heartbeat tampering | File access | Audit integrity | Easy |
| 9 | Signature malleability | Valid signature | Dedup + chain forks | Easy |
| 10 | Custom caveat bypass | Valid delegation | Authorization | Trivial |
| 11 | Threshold memory exfil | Coordinator access | M-of-N guarantee | Hard |
| 12 | Field name leakage | Disclosure proof | Privacy | Passive |
| 13 | Gossip revocation flood | Network access | Mass availability | Easy |
| 14 | Profile poisoning | Timing (first observer) | Trust classification | Easy |
| 15 | Small-subgroup attack | Nothing | Channel confidentiality | Medium |

---

## Part 4: OpenClaw Test Agent Designs

These adversarial test agents run against a deployed soma-heart + sense-observer setup. Each agent acts like a specific class of attacker, probing a category of vulnerabilities systematically.

### Agent 1: "Forger" — Credential Forgery Agent

**Purpose:** Test whether forged, malformed, or unauthorized credentials are accepted.

**Test matrix:**

| Test | What it does | Expected result |
|---|---|---|
| `forge-revocation-unauthorized` | Generate fresh keypair, sign revocation for known delegation ID, submit to registry | MUST reject (currently ACCEPTS — Exploit 1) |
| `forge-delegation-broadened-caps` | Create child delegation with capabilities not in parent | MUST reject at chain level |
| `forge-lineage-wrong-parent-sig` | Create lineage cert signed by non-parent key | MUST reject |
| `replay-malleable-signature` | Take valid sig (R,S), compute (R, S+L), submit as new | MUST reject or dedup (currently ACCEPTS) |
| `cross-primitive-sig-reuse` | Take delegation signature, apply to crafted revocation payload | MUST reject |
| `custom-caveat-enforcement` | Create delegation with custom caveats, invoke without satisfying them | MUST reject (currently ACCEPTS — Exploit 10) |
| `depth-bomb-10k-chain` | Create 10,000-deep delegation chain, attempt verification | MUST reject or bound |
| `expired-lineage-use` | Use lineage cert past its TTL | MUST reject |
| `zero-budget-invocation` | Invoke delegation with budget=0, creditsSpent=1 | MUST reject |
| `max-invocations-exceeded` | Invoke delegation past max-invocations count | MUST reject |

**Data collected:** Accept/reject for each test, timing data, error messages, any crashes.

### Agent 2: "Interceptor" — MITM & Channel Attack Agent

**Purpose:** Test channel establishment integrity and resistance to interception.

**Test matrix:**

| Test | What it does | Expected result |
|---|---|---|
| `mitm-ephemeral-swap` | Substitute ephemeral keys during handshake, relay traffic | MUST fail handshake (currently SUCCEEDS — Exploit 2) |
| `mitm-strip-soma-metadata` | Forward handshake without `_soma` field in MCP initialize | Session should fail-closed, not degrade |
| `mitm-token-modification` | Intercept encrypted tokens, decrypt, modify, re-encrypt | Per-token HMAC MUST catch modification |
| `mitm-replay-handshake` | Replay a captured handshake payload to a different heart | MUST reject (ephemeral keys should be one-time) |
| `small-subgroup-key` | Send small-subgroup X25519 key as ephemeral | MUST reject (currently ACCEPTS — Exploit 15) |
| `all-zeros-shared-key` | Force shared key to all-zeros via crafted key | MUST reject |
| `channel-reuse-after-destroy` | Use channel methods after heart.destroy() | MUST throw |
| `nonce-reuse-detection` | Send two messages with the same nonce | MUST reject or detect |

**Data collected:** Whether MITM succeeds, what data is visible, timing of failure detection.

### Agent 3: "Bomber" — Denial of Service Agent

**Purpose:** Test resource exhaustion and degradation under adversarial load.

**Test matrix:**

| Test | What it does | Expected result |
|---|---|---|
| `session-flood-10k` | Open 10,000 sessions without completing handshakes | MUST limit sessions or degrade gracefully |
| `delegation-chain-bomb` | Submit 100K-deep delegation chain for verification | MUST bound verification depth |
| `revocation-flood` | Submit 100K revocations from random keys | MUST reject unauthorized + rate-limit |
| `heartbeat-spam` | Record millions of heartbeat entries | MUST limit chain length or use windowing |
| `malformed-handshake-flood` | Send 10K malformed HandshakePayload objects | MUST reject cheaply without allocating |
| `large-credential-store` | Store 10K credentials in vault | MUST bound or handle gracefully |
| `gossip-storm` | Publish 100K gossip messages per second | MUST rate-limit subscribers |
| `ceremony-stall` | Start signing ceremony, contribute 1 of 3 shares, never finish | MUST timeout |

**Data collected:** Memory usage, CPU usage, response latency at each scale, point of failure.

### Agent 4: "Mimic" — Identity Theft Agent

**Purpose:** Test whether an attacker can steal or impersonate a heart's identity.

**Test matrix:**

| Test | What it does | Expected result |
|---|---|---|
| `session-id-prediction` | Open 10 sessions rapidly, attempt to predict 11th session ID | MUST be unpredictable (currently PREDICTABLE — Exploit 7) |
| `persistence-bruteforce` | Brute-force saved blob with common passwords | Measure time-to-crack at various password strengths |
| `vault-key-from-hmac` | Derive vault encryption key from HMAC key | MUST be impossible (currently EQUIVALENT — Exploit 3) |
| `destroyed-heart-revival` | Call methods on destroyed heart | MUST throw on every method |
| `key-rotation-replay` | Use pre-rotation key to sign new credentials | MUST reject |
| `clone-heart-from-state` | Load same persistence blob on two machines simultaneously | Both should work but... identity is now split |
| `share-metadata-info-leak` | Inspect a single Shamir share for key topology info | Shares SHOULD NOT reveal threshold/totalShares |
| `heartbeat-restore-no-verify` | Load tampered heartbeat chain | MUST verify before accepting (currently DOES NOT — Exploit 8) |

**Data collected:** What identity information leaks, time-to-crack metrics, which safety checks hold.

### Agent 5: "Poisoner" — Trust Classification Attack Agent

**Purpose:** Test whether the sensorium's trust classification can be manipulated.

**Test matrix:**

| Test | What it does | Expected result |
|---|---|---|
| `embryonic-poisoning` | Control first 10 interactions to set adversarial baseline | Baseline MUST be resistant to poisoning |
| `signal-tap-injection` | Send crafted MCP messages to bias phenotypic signals | Signals MUST verify HMACs before processing |
| `verdict-flip-green-to-red` | Establish GREEN trust, then shift behavior to trigger RED | Measure sensitivity — should be gradual, not binary |
| `verdict-flip-red-to-green` | Start with adversarial behavior, shift to mimic legitimate | MUST NOT quickly flip to GREEN (sticky reputation) |
| `noop-attestation` | Submit attestation via NoopVerifier in "production" mode | MUST reject NoopVerifier outside dev |
| `mock-tee-attestation` | Submit MockTeeVerifier attestation | MUST reject mock verifier outside test |
| `unverified-hmac-tokens` | Stream tokens with invalid HMACs | Observer MUST detect and reject |

**Data collected:** Trust verdict timelines, signal weights, classification accuracy under adversarial conditions.

### Agent 6: "Auditor" — Cryptographic Compliance Agent

**Purpose:** Systematically verify that cryptographic invariants hold across the entire codebase.

**Test matrix:**

| Test | What it does | Expected result |
|---|---|---|
| `kdf-domain-separation` | Derive keys for vault, HMAC, seed with same input — compare | All MUST differ (currently IDENTICAL — Exploit 3) |
| `signing-domain-prefixes` | Check all sign() calls for domain prefix | delegation/revocation/lineage MUST have prefixes |
| `timing-safe-comparisons` | Verify all secret comparisons use timingSafeEqual | No `===` on secrets |
| `scrypt-params-owasp` | Check all scrypt calls meet OWASP 2024 minimums | N >= 2^17, r >= 8, p >= 1 |
| `nonce-uniqueness` | Generate 100K nonces, check for collisions | Zero collisions (24-byte random nonces) |
| `key-scrubbing-coverage` | List all places where secret keys are created/used/destroyed | All MUST have .fill(0) |
| `certificate-expiry` | Check all cert/delegation types have expiry enforcement | Birth certs MUST have expiry (currently MISSING) |
| `s-less-than-l` | Verify Ed25519 signature verification checks S < L | MUST check (currently DOES NOT) |

**Data collected:** Pass/fail matrix for each invariant, exact file:line for each failure.

---

## Part 5: Priority Fix Order

Based on attacker ROI (impact / difficulty):

| Priority | Fix | Why first |
|---|---|---|
| **P0** | Revocation authority check | Trivial to exploit, permanent DoS, zero access needed |
| **P0** | Sign ephemeral keys in handshake | MITM completely breaks channel trust model |
| **P0** | Replace fake HKDF with real HKDF | All key derivation is broken, affects every subsystem |
| **P1** | Domain-separate signing inputs | Cross-primitive confusion is a ticking time bomb |
| **P1** | Replace Math.random() with CSPRNG | Session ID prediction enables session hijacking |
| **P1** | Replace tweetnacl verify with node:crypto | S < L malleability breaks dedup and chain integrity |
| **P1** | Verify heartbeat chain on restore | Tampered chains destroy audit trail integrity |
| **P2** | Custom caveat fail-closed | Any custom security policy is currently decorative |
| **P2** | Delegation chain depth limit | Unbounded chains enable DoS on verification |
| **P2** | Birth certificate expiry field | Certs from compromised keys live forever |
| **P2** | X25519 all-zeros check | Small-subgroup yields predictable session keys |
| **P2** | Field name anonymization in selective disclosure | Metadata leakage undermines privacy claim |
| **P3** | Threshold signing memory scrub (FROST migration) | Requires coordinator compromise — higher bar |
| **P3** | Gossip message authentication | No real transport exists yet — fix when deploying |
| **P3** | Production TEE verifiers | Remote attestation is theoretical until verifiers ship |

---

## Part 6: What the OpenClaw Test Agents Should Measure

Beyond pass/fail, these agents should collect quantitative data that drives protocol hardening:

### Metrics to collect per test run:

1. **Time-to-exploit (TTE):** Clock time from "attacker starts" to "exploit succeeds." Establishes a security budget — if TTE < 1 second, it's automatable.

2. **Detection latency:** If the exploit IS detected, how long after exploitation does detection occur? If > 0, there's a window of vulnerability.

3. **Blast radius:** How many other credentials/sessions/chains are affected by a single exploit? Revocation forgery has blast radius = 1 (per delegation). Fake HKDF has blast radius = ALL derived keys.

4. **Recovery cost:** After exploitation, what does the victim need to do? Regenerate one delegation (low)? Rotate entire identity (high)? Impossible to recover (critical)?

5. **Regression signal:** Run the full test matrix on every commit. Any test that flips from REJECT to ACCEPT is an instant regression alarm.

### Data format:

```json
{
  "agent": "Forger",
  "test": "forge-revocation-unauthorized",
  "timestamp": "2026-04-09T14:30:00Z",
  "result": "ACCEPTED",
  "expected": "REJECTED",
  "tte_ms": 12,
  "detection_latency_ms": null,
  "blast_radius": 1,
  "recovery_cost": "regenerate-delegation-chain",
  "soma_version": "0.1.1",
  "notes": "Registry accepted revocation signed by random key for known delegation ID"
}
```

### CI integration:

- Run Forger + Auditor on every PR (fast, deterministic)
- Run Interceptor + Bomber weekly (slower, resource-intensive)
- Run Mimic + Poisoner on release candidates (requires deployed environment)
- Any `result != expected` blocks merge
- Dashboard at `/portal/openclaw-results` shows historical trends

---

## Part 7: Recommendations for Soma Repo Changes

### Immediate (before any production deployment):

1. **`crypto-provider.ts`** — Replace `deriveKey()` with real HKDF:
   ```typescript
   deriveKey(ikm: Uint8Array, length: number, salt: Uint8Array, info: string): Uint8Array {
     return new Uint8Array(hkdfSync('sha256', ikm, salt, info, length));
   }
   ```
   Update ALL callers to pass domain-specific `info` strings.

2. **`revocation.ts`** — Add authority check to `RevocationRegistry.add()`:
   ```typescript
   add(event: RevocationEvent, expectedIssuerDid: string): boolean {
     if (event.issuerDid !== expectedIssuerDid) return false;
     // ... existing checks
   }
   ```

3. **`channel.ts`** — Sign ephemeral keys:
   ```typescript
   // In HandshakePayload, add:
   ephemeralKeySignature: string; // identity key signs ephemeral key
   // In establishChannel(), verify the signature before key exchange
   ```

4. **`delegation.ts`, `revocation.ts`, `lineage.ts`** — Add domain prefixes:
   ```typescript
   const signingInput = new TextEncoder().encode(
     "soma-delegation:v1:" + canonicalJson(payload)
   );
   ```

5. **`runtime.ts:644`** — Replace `Math.random()`:
   ```typescript
   import { randomUUID } from 'node:crypto';
   const sessionId = randomUUID();
   ```

### Short-term (before multi-node deployment):

6. Add `verifyDelegationChain()` function with depth limit (max 20)
7. Add birth certificate expiry field + enforcement
8. Custom caveat evaluator callback (fail-closed)
9. Heartbeat chain verify-before-restore
10. Replace tweetnacl Ed25519 verify with `crypto.verify('ed25519', ...)`

### Medium-term (before threshold/gossip production use):

11. Migrate threshold signing to FROST (RFC 9591)
12. Add gossip message signing + rate limiting
13. Ship at least one real TEE verifier (AWS Nitro is most accessible)
14. Selective disclosure: anonymize undisclosed field names
15. X25519 all-zeros shared key check
