# Soma Heart — Deep Cryptographic & Implementation Audit

**Date:** 2026-04-09
**Scope:** crypto internals, runtime lifecycle, research-backed attack vectors
**Companion:** `soma-heart-hacker-audit-2026-04-09.md` (exploit chains + test agents)

This audit covers findings that go DEEPER than the hacker playbook — subtle crypto weaknesses, timing side channels, protocol-level design gaps, and attack patterns from published CVEs and academic research.

---

## Severity Guide

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Silently broken, exploitable without privileged access |
| **HIGH** | Wrong behavior, requires specific conditions to exploit |
| **MEDIUM** | Correctness issue, future risk, or defense-in-depth gap |
| **LOW** | Code quality, minor inconsistency, theoretical |

---

## 1. Cryptographic Internals

### 1.1 Non-Constant-Time Shamir GF(256) — Side Channel (CRITICAL)
**File:** `Soma/src/heart/key-escrow.ts:62-64`

```typescript
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}
```

Table lookups into `GF_LOG[]` and `GF_EXP[]` are not constant-time. Array index access in V8 varies by cache line, enabling timing side-channel extraction of polynomial coefficients. This is the same class as CVE-2023-25000 (Hashicorp Vault's Shamir SSS timing leak).

**Why this matters for soma-heart:** `splitSecret()` calls `evalPoly()` which calls `gfMul()` for every coefficient of the polynomial at every share point. An attacker who can measure timing of share generation (co-located process, shared CPU cache, or many network requests) can extract the polynomial and recover the secret without collecting threshold shares.

**Compounding:** The early-return `if (a === 0 || b === 0) return 0` leaks whether either operand is zero — zero coefficients in the polynomial reveal structural information about the secret.

**Fix:** Use constant-time GF(256) multiplication (bitwise operations without branches), or migrate to a vetted library like `@noble/curves` which implements constant-time field arithmetic.

### 1.2 Birth Certificate Parent Hash Canonicalization (CRITICAL)
**File:** `Soma/src/heart/birth-certificate.ts:334`

```typescript
.some(c => sha256(c.receiverSignature, p) === parentHash);
```

Parent hash = `sha256(c.receiverSignature)` — it hashes ONLY the signature string, not the canonical certificate content. Combined with Ed25519 S >= L malleability (hacker audit exploit 9), an attacker can:

1. Take a legitimate cert with signature S
2. Compute S' = S + L (still valid for same message)
3. `sha256(S) !== sha256(S')` — two different parent hashes for the same cert
4. Fork the birth certificate chain through the same root cert

**Even without malleability:** Hashing only the signature means two certificates with identical content but different signatures (e.g., signed by different parties) produce different parent hashes. The identity of a certificate should be its CONTENT hash, not its signature hash.

**Fix:** `parentHash = sha256(canonicalizeCertContent(cert))` — hash the canonical content, which is deterministic regardless of signature value.

### 1.3 Fake HKDF — Buffer Overread When length > 32 (CRITICAL)
**File:** `Soma/src/core/crypto-provider.ts:170-172`

```typescript
deriveKey(input: Uint8Array, length: number): Uint8Array {
  const digest = createHash("sha256").update(input).digest();
  return new Uint8Array(digest.buffer, digest.byteOffset, length);
}
```

The hacker audit covers the missing salt/info problem. This finding adds: **if `length > 32`, the code reads past the 32-byte SHA-256 digest into the underlying ArrayBuffer.**

In Node.js, `Buffer.from(createHash(...).digest())` may share an underlying `ArrayBuffer` with other Buffers from the pool (`Buffer.allocUnsafe()` recycles memory). Bytes 33+ could contain fragments of previous cryptographic operations — private keys, session keys, plaintext.

No current caller passes `length > 32`, but there's no guard. Any future caller or dependency update that requests more bytes gets an information leak instead of an error.

**Fix (immediate):** `if (length > 32) throw new Error('SHA-256 output is 32 bytes')`. Fix properly with real HKDF-SHA256.

### 1.4 Seed Derivation Uses Same Fake HKDF (HIGH)
**File:** `Soma/src/heart/seed.ts:100`

```typescript
const nonce = p.hashing.deriveKey(material, 32);
```

`deriveSeed()` passes through to the same `SHA-256(input).slice(0, length)` function. The seed system is the behavioral fingerprinting core — if two different sessions derive colliding nonces, the behavioral modification is identical and the observer cannot distinguish the sessions.

Since there's no salt or info parameter, nonce uniqueness depends entirely on the input bytes differing. If `sessionKey` is reused (e.g., session key derived from static keys without ephemeral randomness), all derived nonces collide.

### 1.5 Proof-of-Possession Challenge Doesn't Bind Timestamp (HIGH)
**File:** `Soma/src/heart/proof-of-possession.ts:76`

```typescript
function proofPayload(nonceB64: string, delegationId: string): Uint8Array {
  return new TextEncoder().encode(`soma-pop:${nonceB64}:${delegationId}`);
}
```

The `issuedAt` field is set on the Challenge object but NOT included in the signed payload. A captured proof-of-possession response can be replayed indefinitely — the verifier has no way to know the proof was created for a recent challenge vs. a challenge from weeks ago.

**Fix:** Include timestamp: `soma-pop:${nonceB64}:${delegationId}:${issuedAt}`. Verifier rejects if `issuedAt` is too old.

### 1.6 Wildcard Capability Attenuation Asymmetry (HIGH)
**File:** `Soma/src/heart/delegation.ts:145`

```typescript
if (!opts.parent.capabilities.includes(cap)) {
  throw new Error(`Cannot attenuate: ${cap} not in parent delegation`);
}
```

`attenuateDelegation()` uses literal `Array.includes()` — no wildcard matching. But `verifyDelegation()` (line 213-217) DOES match wildcards with `endsWith(':*')`.

**Result:** A parent with `['tool:*']` cannot attenuate to `['tool:read']` because `includes('tool:read')` is false. The only way to attenuate is to pass through `['tool:*']` unchanged — defeating the entire purpose of attenuation.

**Worse:** If someone patches around this by skipping the check, they create a capability ESCALATION path. The asymmetry between creation and verification is a design landmine.

**Fix:** Extract the wildcard matching logic into a shared `capabilityCovers(parent, child)` function and use it in both `attenuateDelegation()` and `verifyDelegation()`.

### 1.7 Wildcard Matching Allows Prefix Confusion (MEDIUM)
**File:** `Soma/src/heart/delegation.ts:216`

```typescript
if (cap.endsWith(':*') && ctx.capability.startsWith(cap.slice(0, -1))) return true;
```

`cap.slice(0, -1)` on `"tool:*"` produces `"tool:"`. `startsWith("tool:")` is correct. But on `"t:*"` it produces `"t:"`, and `"t:ool:admin:destroy".startsWith("t:")` is true. Short wildcard prefixes match unexpectedly broad sets.

More subtly: `"data:*"` matches `"data::hidden"` (double colon) and `"data:"` (empty suffix). Whether these are valid capabilities depends on the application's naming scheme, but the wildcard logic doesn't enforce any structure.

**Fix:** Validate capability names against a format regex (e.g., `^[a-z][a-z0-9]*:[a-z][a-z0-9:]*$`). Require minimum prefix length for wildcards.

---

## 2. Runtime & Lifecycle

### 2.1 Heartbeat Chain Restore Skips Verification (CRITICAL)
**File:** `Soma/src/heart/runtime.ts:213-214`, `Soma/src/heart/heartbeat.ts:121-127`

```typescript
// runtime.ts — constructor calls restore without verify
this.heartbeatChain = config.restoreHeartbeats
  ? HeartbeatChain.restore(config.restoreHeartbeats, this.provider)
  : new HeartbeatChain(this.provider);
```

```typescript
// heartbeat.ts — restore blindly trusts input
static restore(chain: Heartbeat[], provider?: CryptoProvider): HeartbeatChain {
  const hc = new HeartbeatChain(provider);
  if (chain.length === 0) return hc;
  hc.chain = [...chain];
  hc.sequence = chain.length;
  hc.currentHash = chain[chain.length - 1].hash;
  return hc;
}
```

`HeartbeatChain.verify()` exists (line 134) but is never called during restore. A tampered heartbeat chain is loaded as-is. Sequence numbers, hashes, and timestamps are all trusted from the input.

**Attack:** Modify persisted state → inject/delete heartbeat records → heart loads tampered chain → all future heartbeats chain off tampered state → audit trail is silently corrupted.

### 2.2 Heartbeat Equivocation — Parallel Chain Forking (HIGH)

No mechanism prevents a heart from maintaining two parallel heartbeat chains with different histories. A malicious agent can:

1. Start chain A: record legitimate behavior for observer X
2. Fork chain B from the same genesis: record different behavior for observer Y
3. Each observer sees a valid, internally-consistent chain
4. The agent presents whichever chain benefits it

Without a global heartbeat registry or equivocation detection (checking that sequence N has a unique hash across all observers), split-brain heartbeats are undetectable.

**Fix:** Heartbeats should be signed with the identity key AND include a commitment to the chain head. Observers who share heartbeat heads can detect equivocation (same sequence number, different hash).

### 2.3 Session Map Unbounded Growth (HIGH)
**File:** `Soma/src/heart/runtime.ts:200`

```typescript
private readonly sessions: Map<string, HeartSession> = new Map();
```

Sessions are added via `createSession()` but never evicted. A long-running heart accumulates sessions without bound. Each session holds an `ephemeralKeyPair` (64 bytes), a `HeartbeatChain` (growing), and a `Channel` (with encryption keys).

**Attack:** Open thousands of sessions without completing handshakes → memory exhaustion → heart process killed → availability DoS.

**Fix:** Add session TTL. Evict incomplete sessions after timeout. Cap max concurrent sessions.

### 2.4 `destroy()` Doesn't Scrub Session Keys (HIGH)
**File:** `Soma/src/heart/runtime.ts`

`SomaHeart.destroy()` sets `this.alive = false` and calls `this.vault.destroy()`, but:
- Session ephemeral keys remain in the `sessions` Map
- `signingKeyPair` remains in memory
- `boxKeyPair` (if present) remains in memory
- Heartbeat chain contents (which include hashes of session interactions) persist

Even after `destroy()`, a heap dump yields all identity material.

**Fix:** Zero all key material in `destroy()`: iterate sessions and fill ephemeral keys, fill signing key pair. (Note: JS GC limits make this defense-in-depth, not a guarantee — see 3.3.)

### 2.5 Birth Certificate Has No Expiry (MEDIUM)
**File:** `Soma/src/heart/birth-certificate.ts`

Birth certificates have `bornAt` but no `expiresAt`. A cert issued for a compromised key lives forever. There's no mechanism to say "this identity was valid from time X to time Y."

In a long-lived system, this means old birth certificates from deprecated or compromised agents remain valid indefinitely, cluttering verification chains and allowing revived use of dead identities.

**Fix:** Add optional `expiresAt` field. Verifiers reject expired certs. For permanent identities, set expiry to far-future.

---

## 3. Research-Backed Attack Vectors

### 3.1 Ed25519 S >= L Malleability — tweetnacl (HIGH)
**CVE class:** CVE-2026-33895 (conceptual — tweetnacl-js doesn't check S < L)

`nacl.sign.detached.verify()` does not enforce that the scalar S is less than the group order L. Given a valid signature `(R, S)`, anyone can compute `(R, S + L)` which also passes verification.

**Impact on soma-heart:**
- **Signature deduplication breaks:** A system tracking "seen signatures" treats `(R, S)` and `(R, S+L)` as different
- **Birth cert parent hash forking:** Since parent hash = `sha256(receiverSignature)`, malleable signatures create alternate parent hashes (compounds with 1.2)
- **Replay protection bypass:** Any replay check based on signature hash is defeated

**Fix:** Replace `nacl.sign.detached.verify()` with Node.js native `crypto.verify('ed25519', ...)` which implements RFC 8032 strict verification including S < L check. Available since Node.js 15+.

### 3.2 X25519 Zero-Key / Small-Subgroup (HIGH)
**File:** `Soma/src/core/crypto-provider.ts:145-147` (via `nacl.box.before`)

Curve25519 has cofactor 8. Certain crafted public keys (the 8 small-subgroup points, including all-zeros) produce a predictable shared secret. An attacker who sends an all-zeros ephemeral key during handshake forces the shared secret to all-zeros — the session key is known.

**Unlike MITM (hacker audit exploit 2):** This attack works with PASSIVE observation. No network interception needed — just send a bad ephemeral key, and all traffic is encrypted with a known key.

**Fix:**
```typescript
const sharedKey = nacl.box.before(remoteKey, localSecret);
if (sharedKey.every(b => b === 0)) throw new Error('Invalid remote key: small subgroup');
```

### 3.3 JavaScript Memory Erasure Limits (MEDIUM)

`secretKey.fill(0)` appears in `thresholdSign()` and `destroy()`. But JavaScript offers no guarantee that `fill(0)` actually erases the original memory:

1. **V8 GC copies:** During heap compaction, V8 copies objects to new memory locations. The old location retains the secret until the physical page is reused.
2. **JIT optimization:** V8 may optimize away `fill(0)` if it detects the array is never read after zeroing (dead store elimination).
3. **Buffer pool reuse:** `Buffer.allocUnsafe()` returns uninitialized memory from a shared pool. If crypto keys were stored in pooled Buffers, fragments persist.

**This is a known limitation of ALL JavaScript crypto.** It cannot be fully fixed without native code. But it CAN be mitigated:
- Use `Uint8Array` (not Buffer) for all key material — avoids pool reuse
- Mark key arrays with `@__PURE__` annotations to prevent dead-store elimination
- Consider WebAssembly for key operations (Wasm linear memory is not GC'd)

### 3.4 NaCl Secretbox Key Commitment — Invisible Salamanders (MEDIUM)

NaCl's `secretbox` (XSalsa20-Poly1305) is not key-committing. A single ciphertext can decrypt to two different plaintexts under two different keys. This enables "invisible salamander" attacks:

**Scenario in soma-heart:** An agent encrypts a message that decrypts to "approve transaction" under key K1 and "deny transaction" under key K2. If two observers hold different session keys (possible in a delegation chain), they see contradictory messages from the same ciphertext.

**Current risk:** Low — soma-heart sessions are bilateral (one shared key per channel). But if multi-observer channels or broadcast encryption are added, this becomes exploitable.

**Fix (when needed):** Add key commitment: `ciphertext || HMAC(key, ciphertext)`. Alternatively, migrate to AES-256-GCM-SIV which is key-committing.

### 3.5 JSON Canonicalization Edge Cases (MEDIUM)

Soma-heart uses JCS (`canonicalJson()`) for deterministic serialization before signing. JCS handles most cases well, but has known edge cases:

1. **Unicode normalization:** JCS does NOT normalize Unicode. `"\u00e9"` (precomposed) and `"e\u0301"` (decomposed) produce different canonical forms for visually identical strings. A cert containing "Caf\u00e9" is different from "Cafe\u0301" — a verifier with a different string representation will fail to verify a valid signature.

2. **Number precision:** JCS specifies IEEE 754 double-precision serialization. Numbers like `0.1 + 0.2` produce `0.30000000000000004`. If cert fields contain computed floating-point numbers, different platforms may serialize differently.

3. **Property order stability:** JCS sorts by code point. This is deterministic but can surprise integrators who expect insertion order. Not a bug, but a documentation gap.

**Fix:** Document that all string fields MUST be NFC-normalized before signing. Avoid floating-point numbers in signed payloads (use integer cents, not dollar amounts). Add a canonicalization test suite with adversarial Unicode inputs.

### 3.6 Legacy PBKDF2 Persistence Fallback (MEDIUM)
**File:** `Soma/src/heart/persistence.ts`

`loadHeartState()` supports legacy blobs encrypted with `kdf: "pbkdf2-sha256"`. PBKDF2-SHA256 with 100K iterations takes ~50ms on CPU vs scrypt's ~130ms. On GPU, PBKDF2 is ~100x faster to brute-force than scrypt.

Any heart that was ever saved with PBKDF2 (before scrypt was the default) has a weaker blob in backups, logs, or old filesystem snapshots.

**Fix:** On successful load of a PBKDF2 blob, immediately re-encrypt with scrypt and overwrite. Log a warning. Consider removing PBKDF2 support entirely after a migration period.

### 3.7 Gossip Transport — Eclipse and Partition Attacks (LOW)

`InMemoryTransport` is the only shipped transport. When a real network transport is deployed, the gossip layer is vulnerable to:

1. **Eclipse attack:** Surround a node with attacker-controlled peers. The node only sees attacker's view of revocations. Legitimate revocations are hidden.
2. **Selective forwarding:** Relay all messages EXCEPT revocations for a specific delegation, keeping a revoked credential alive in the target's view.
3. **Amplification:** No message deduplication. Same revocation event forwarded through different peers arrives multiple times.

**Fix (when deploying real transport):** Authenticated peer connections. Minimum peer diversity requirement. Message deduplication by content hash. Periodic state reconciliation (Bloom filter exchange).

---

## 4. Fix Priority Matrix

| # | Finding | Severity | Effort | Priority |
|---|---------|----------|--------|----------|
| 1.1 | Non-constant-time Shamir GF(256) | CRITICAL | 4h | **P0** |
| 1.2 | Birth cert parent hash canonicalization | CRITICAL | 1h | **P0** |
| 1.3 | Fake HKDF buffer overread (length > 32) | CRITICAL | 30min | **P0** |
| 2.1 | Heartbeat restore skips verification | CRITICAL | 30min | **P0** |
| 1.4 | Seed derivation uses fake HKDF | HIGH | 30min | **P1** |
| 1.5 | PoP challenge no timestamp binding | HIGH | 30min | **P1** |
| 1.6 | Wildcard attenuation asymmetry | HIGH | 1h | **P1** |
| 2.2 | Heartbeat equivocation (parallel chains) | HIGH | Design | **P1** |
| 2.3 | Session map unbounded growth | HIGH | 1h | **P1** |
| 2.4 | destroy() doesn't scrub session keys | HIGH | 30min | **P1** |
| 3.1 | Ed25519 S >= L malleability | HIGH | 1h | **P1** |
| 3.2 | X25519 zero-key / small-subgroup | HIGH | 30min | **P1** |
| 1.7 | Wildcard prefix confusion | MEDIUM | 1h | **P2** |
| 2.5 | Birth certificate no expiry | MEDIUM | 1h | **P2** |
| 3.3 | JS memory erasure limits | MEDIUM | 2h | **P2** |
| 3.4 | Secretbox not key-committing | MEDIUM | Design | **P2** |
| 3.5 | JSON canonicalization edge cases | MEDIUM | 2h | **P2** |
| 3.6 | Legacy PBKDF2 persistence fallback | MEDIUM | 1h | **P2** |
| 3.7 | Gossip eclipse / partition attacks | LOW | Design | **P3** |

---

## 5. Cross-Reference with Hacker Audit

Findings that COMPOUND with exploits from `soma-heart-hacker-audit-2026-04-09.md`:

| This finding | + Hacker exploit | = Combined impact |
|---|---|---|
| 1.2 (parent hash canon) | Exploit 9 (S >= L malleability) | Birth cert chain forkable through same root |
| 1.3 (buffer overread) | Exploit 3 (fake HKDF) | Key derivation both weak AND leaks memory |
| 1.6 (wildcard asymmetry) | Exploit 5 (depth bomb) | Attenuation broken + unlimited depth = escalation |
| 2.1 (restore no verify) | Exploit 8 (heartbeat tamper) | Tampered chain loads AND extends without detection |
| 2.3 (unbounded sessions) | Exploit 13 (gossip flood) | Two DoS vectors — sessions + revocations |
| 3.1 (S >= L) | Exploit 9 (same) | Deepened analysis: dedup + chain fork + replay |
| 3.2 (zero-key) | Exploit 15 (small subgroup) | Deepened analysis: passive vs active attack paths |

---

## 6. Recommended Fix Order

### Phase 1 — Crypto Foundation (before any production use)

1. **Replace fake HKDF** with real `hkdfSync('sha256', ikm, salt, info, length)` — fixes 1.3, 1.4, compounds with hacker exploit 3
2. **Replace tweetnacl verify** with `crypto.verify('ed25519', ...)` — fixes 3.1, compounds with hacker exploit 9
3. **Add X25519 zero-check** after `nacl.box.before()` — fixes 3.2
4. **Constant-time Shamir** — replace table lookups with bitwise GF(256) — fixes 1.1
5. **Parent hash = content hash** not signature hash — fixes 1.2

### Phase 2 — Runtime Hardening (before multi-agent deployment)

6. **Verify heartbeat chain on restore** — fixes 2.1
7. **Session TTL + max concurrent sessions** — fixes 2.3
8. **Timestamp in PoP signed payload** — fixes 1.5
9. **Shared wildcard matching function** — fixes 1.6, 1.7
10. **Birth certificate expiry field** — fixes 2.5
11. **Scrub keys in destroy()** — fixes 2.4

### Phase 3 — Protocol Completeness (before gossip/broadcast deployment)

12. **Heartbeat equivocation detection** (signed chain heads, observer cross-check) — fixes 2.2
13. **Re-encrypt PBKDF2 blobs to scrypt on load** — fixes 3.6
14. **Unicode NFC normalization before signing** — fixes 3.5
15. **Key-committing encryption if multi-observer channels added** — fixes 3.4
16. **Authenticated gossip transport** — fixes 3.7

---

## 7. Test Coverage Gaps

These findings need dedicated tests that don't exist yet:

| Finding | Test needed |
|---|---|
| 1.1 | Timing test: measure `gfMul` variance across input values |
| 1.2 | Create two certs with same content, different signatures — parent hash should match |
| 1.3 | Call `deriveKey(input, 64)` — should throw, not overread |
| 1.5 | Replay a PoP proof with a different challenge timestamp — should reject |
| 1.6 | Parent with `['tool:*']`, attenuate to `['tool:read']` — should succeed |
| 2.1 | Load tampered heartbeat chain — should reject |
| 2.2 | Same heart, two chains, same sequence — should be detectable |
| 2.3 | Open 10K sessions — should hit limit and reject |
| 3.1 | Signature (R, S+L) — should reject |
| 3.2 | Handshake with all-zeros ephemeral key — should reject |
| 3.5 | Sign with NFC string, verify with NFD — document expected behavior |
