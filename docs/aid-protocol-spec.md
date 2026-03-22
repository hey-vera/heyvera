# AID Protocol Specification v1.0

**Agent Identity Document — The Trust Layer for Agentic Commerce**

**Status:** Draft
**Version:** 1.0.0
**Date:** March 22, 2026
**Authors:** Josh Mclain (ClawNet)
**License:** Apache 2.0

---

## Conformance

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

An implementation is conformant if it satisfies all MUST and REQUIRED level requirements.

---

## Abstract

AID (Agent Identity Document) is an open protocol that adds scored, verifiable, portable trust to any agent communication layer. It is designed as a complementary layer — not a replacement — for existing protocols like MCP, A2A, x402, ACP, and UCP.

AID answers the question no other protocol addresses: *"Is this agent worth doing business with?"*

The protocol provides:
- **Self-certifying identity** via W3C `did:key` (Ed25519)
- **Deterministic behavioral trust scoring** from verifiable attestation history
- **Portable atomic receipts** with dual signatures and Merkle anchoring
- **Offline verification** — pure cryptography, zero network calls
- **Crypto-agile architecture** — designed for NIST post-quantum migration (ML-DSA, FIPS 204)

**Reference implementation:** [ClawNet](https://claw-net.org) — production agent orchestration platform with Ed25519 AID system, Merkle-anchored trust snapshots, and 46 documented attack mitigations.

**Open-source scoring library:** [`@aidprotocol/trust-compute`](https://www.npmjs.com/package/@aidprotocol/trust-compute) (npm, MIT license) — deterministic computation anyone can run independently.

---

## 1. Protocol Overview

### 1.1 Design Principles

1. **Trust is computed, not declared.** Scores derive from verifiable attestation history, not self-reported claims.
2. **Identity is self-certifying.** The public key IS the identifier. No registry lookup required.
3. **Verification is offline.** Ed25519 signatures + Merkle proofs = pure math, zero network calls.
4. **Algorithm-agile.** Every document includes `signatureAlgorithm`, `algorithmVersion`, `hashAlgorithm`. Never hardcode Ed25519 or SHA-384.
5. **Complementary, not competitive.** AID plugs into existing protocols — it does not replace them.
6. **Transparent.** The scoring formula is published, open-source, and independently verifiable.
7. **Progressive decentralization.** The reference implementation is centralized, but the architecture is designed so that any component can be independently verified, challenged, or replaced.

### 1.2 Protocol Flow

```
Client                                    Server
  |                                         |
  |--- Request + X-AID-DID + X-AID-PROOF -->|
  |    + X-AID-TIMESTAMP + X-AID-NONCE      |
  |                                         |
  |    Server verifies Ed25519 signature    |
  |    (offline -- pure math, no API call)  |
  |                                         |
  |    Server resolves trust score          |
  |    (local DB or cached API lookup)      |
  |                                         |
  |    Server applies trust-gated pricing   |
  |                                         |
  |<-- Response + X-AID-PROVIDER-DID -------|
  |    + X-AID-PROVIDER-PROOF               |
  |    + X-AID-RECEIPT                      |
  |                                         |
  |    Both parties now have:               |
  |    - Mutual authentication              |
  |    - Dual-signed receipt                |
  |    - Attestation for trust scoring      |
```

### 1.3 Relationship to Other Protocols

AID occupies the trust/reputation layer in the emerging agentic commerce stack:

| Layer | Protocol(s) | AID's Role |
|-------|------------|------------|
| Communication | MCP, A2A | AID-MCP Profile, AID-A2A Profile (Section 8) |
| Identity | ERC-8004, MCP-I | AID provides scored reputation on top of raw identity |
| Authorization | Verifiable Intent, OAuth | AID trust scores as signal in authorization decisions |
| Payment | x402, ACP | AID-x402 Profile adds trust-gated pricing (Section 8) |
| **Trust/Reputation** | **AID** | **Canonical, verifiable, portable trust scoring** |

AID is designed to complement these protocols, not compete with them. Identity tells you WHO. Authorization tells you WHAT they're allowed to do. AID tells you WHETHER they're worth doing business with.

---

## 2. Identity

### 2.1 DID Method

AID uses the W3C `did:key` method with Ed25519 (multicodec `0xed`):

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

The public key is encoded directly in the DID using multibase base58btc with the Ed25519 multikey prefix (`0xed 0x01`). Identity is self-certifying: the DID encodes the public key, so verification requires no registry lookup.

**DID resolution:** To extract the public key from a `did:key`:
1. Strip the `did:key:` prefix.
2. Decode the remaining base58btc string (multibase prefix `z`).
3. Strip the 2-byte multicodec prefix (`0xed 0x01`).
4. The remaining 32 bytes are the raw Ed25519 public key.

### 2.2 Agent Identity Document

Every agent has an AID document containing:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://aid.claw-net.org/contexts/v1"
  ],
  "id": "did:key:z6Mk...",
  "type": "AgentIdentityDocument",
  "version": "1.0.0",
  "signatureAlgorithm": "EdDSA",
  "algorithmVersion": "1.0",
  "hashAlgorithm": "sha384",
  "agent": {
    "displayName": "my-trading-bot",
    "agentType": "autonomous",
    "createdAt": "2026-03-21T10:00:00Z"
  },
  "publicKey": {
    "type": "Ed25519VerificationKey2020",
    "publicKeyMultibase": "z6Mk..."
  },
  "trustScore": {
    "score": 87,
    "inputs": {
      "successRate": 0.95,
      "chainCoverage": 0.88,
      "attestationCount": 247,
      "manifestAdherence": 0.92
    },
    "weights": {
      "successRate": 40,
      "chainCoverage": 25,
      "volume": 20,
      "manifestAdherence": 15
    },
    "proofHash": "<sha384 hex>",
    "formulaVersion": "1.0.0",
    "hashAlgorithm": "sha384"
  },
  "trustChain": {
    "merkleRoot": "<sha384 hex>",
    "attestationCount": 247,
    "chainLength": 245
  },
  "capabilities": [
    { "category": "data", "actions": ["data_query"], "invokeCount": 180 },
    { "category": "defi", "actions": ["swap", "transfer"], "invokeCount": 67 }
  ],
  "issuance": {
    "issuer": "did:web:api.claw-net.org",
    "issuedAt": "2026-03-21T14:00:00Z",
    "expiresAt": "2026-06-19T14:00:00Z",
    "platformVersion": "3.0.0"
  },
  "proof": {
    "platformCountersignature": {
      "type": "Ed25519Signature2020",
      "cryptosuite": "eddsa-jcs-2022",
      "proofValue": "<base64url signature>"
    }
  }
}
```

**Field requirements:**

| Field | Required | Notes |
|-------|----------|-------|
| `id` | MUST | `did:key` of the agent |
| `version` | MUST | Spec version (`1.0.0`) |
| `signatureAlgorithm` | MUST | Algorithm for identity signatures |
| `algorithmVersion` | MUST | Algorithm version for migration tracking |
| `hashAlgorithm` | MUST | Hash algorithm for trust-layer hashing |
| `agent` | MUST | Agent metadata |
| `publicKey` | MUST | Verification key material |
| `trustScore` | MUST | Current trust score with proof |
| `trustChain` | MUST | Merkle-anchored attestation chain summary |
| `capabilities` | SHOULD | Derived from attestation history, not self-declared |
| `issuance` | MUST | Issuer, timestamp, expiry |
| `proof` | MUST | Platform countersignature |

**Note on DID methods:** Agent identifiers use `did:key` (self-certifying, offline-verifiable). Platform issuers use `did:web` (resolvable, DNS-bound). Offline verification of agent identity requires only the `did:key` and the `proof.platformCountersignature`; the `did:web` issuer is used for trust chain bootstrapping when online.

### 2.3 Crypto-Agility

AID is algorithm-agile by design. The current reference implementation uses Ed25519 for signatures and SHA-384 for trust-layer hashing.

The protocol supports algorithm migration via versioned key types, enabling transition to NIST post-quantum signatures (ML-DSA, FIPS 204) without protocol-level changes. Hybrid Ed25519 + ML-DSA signatures are supported during the migration period.

**Requirements for implementers:**
- All AID documents MUST include `signatureAlgorithm`, `algorithmVersion`, and `hashAlgorithm` fields.
- Verifiers MUST read these fields and dispatch to the correct verification algorithm.
- Implementations MUST NOT hardcode `Ed25519` or `sha384` — always read from the document.

**Migration timeline (per NIST IR 8547):**
- **Now:** Ed25519 + SHA-384
- **2027+:** Hybrid Ed25519 + ML-DSA (dual signatures, backwards compatible)
- **2030:** ML-DSA primary (Ed25519 deprecated by NIST)

### 2.4 Key Rotation

Agent keys can be rotated without changing the agent's DID or losing trust history.

**Rotation flow:**
1. Agent (or guardian) sends rotation request with a signature from the current active key.
2. Server generates a new Ed25519 keypair.
3. The old key is marked `rotated` with a `rotated_at` timestamp. It is NOT deleted.
4. The new key becomes the active key for all future signatures.
5. The agent's DID does NOT change — the DID is permanent, keys are mutable.

**Verifying old receipts after rotation:**
- Old receipts reference the DID, not the key directly.
- Verifiers look up which key was active at the receipt's `timestamp`.
- The key history (`created_at`, `rotated_at`) enables time-windowed verification.
- Key rotation MUST NOT invalidate existing receipts.

**Guardian key (OPTIONAL):**
- At registration, an agent MAY specify a `guardianAddress` — an external key authorized to freeze the AID and initiate key rotation.
- This protects autonomous agents whose key is compromised (the agent itself cannot rotate because the attacker has the same key).

### 2.5 Zero-Friction Onboarding (X-AID-NEW)

Agents can provision identity in a single HTTP call using the `X-AID-NEW` header:

```
POST /aid/skills/sol-price
X-AID-NEW: my-trading-bot
PAYMENT-SIGNATURE: <EIP-3009 signed authorization>
Content-Type: application/json

{"token": "SOL"}
```

**Behavior:**
1. Server verifies payment FIRST (`PAYMENT-SIGNATURE`).
2. If payment succeeds, server generates Ed25519 keypair and creates AID.
3. Server returns: result + receipt + AID document + `privateKeySeed` (returned ONCE, never stored server-side).
4. If payment fails, NO AID is created (prevents orphan identities).
5. Future requests use `X-AID-DID` + `X-AID-PROOF` with the provisioned key.

**Rate limits:**
- 3 AIDs per IP per 24 hours.
- 1 AID per unique agent name per 24 hours.
- AIDs that never transact are pruned after 30 days.

**Security:** New AIDs start at trust score 0. They cannot submit feedback (weight = 0) and receive no trust-gated discounts. `X-AID-NEW` provisions an IDENTITY, not free execution — the agent must pay for every call.

---

## 3. Trust Scoring

### 3.1 Trust Score Formula (v1.0)

The canonical trust scoring formula uses 4 behavioral dimensions:

```
rawScore = successRate * 40 + chainCoverage * 25 + volume * 20 + manifestAdherence * 15
finalScore = min(100, round(rawScore * verificationMultiplier))
```

| Dimension | Weight | Range | Source |
|-----------|--------|-------|--------|
| `successRate` | 40% | 0-1 | `success_count / total_attestations` |
| `chainCoverage` | 25% | 0-1 | Fraction of attestations with valid hash-chain links |
| `volume` | 20% | 0-1 | `min(attestationCount / 1000, 1)` |
| `manifestAdherence` | 15% | 0-1 | `manifest_aligned / (aligned + unaligned)`, defaults to 0.5 if no manifests |

**Verification multiplier:**

| Level | Multiplier | Criteria |
|-------|------------|----------|
| None | 1.0 | No external verification |
| Partial | 1.1 | One verified linked identity (e.g., GitHub, domain via `.well-known`) |
| Full | 1.2 | Two or more verified linked identities, or on-chain domain verification |

**Dimension defaults:** If a dimension has no data (e.g., no manifests submitted), it defaults to 0.5 (neutral) rather than 0. This avoids penalizing agents on dimensions that haven't been measured.

**Future extensions (planned, not part of v1.0):** 7 additional dimensions across MARKET (staking demand, consumer diversity, cross-consumption, volume growth) and COMMUNITY (validator verdicts, report penalty, verification tier) signal categories. Weight rebalancing for future dimensions is a MAJOR version change (Section 9.1).

### 3.2 Proof Hash

Every trust score MUST include a cryptographic proof hash:

```
proofHash = SHA-384(JCS({inputs, weights, score}))
```

Where JCS is JSON Canonicalization Scheme (RFC 8785). Given identical inputs, every implementation MUST produce identical proof hashes. This enables independent verification using the open-source `@aidprotocol/trust-compute` library.

### 3.3 Trust Verdicts

| Score Range | Verdict | Settlement Mode | Pricing |
|-------------|---------|-----------------|---------|
| 0-19 | `new` | `immediate` | Base price |
| 20-39 | `building` | `immediate` | Base price |
| 40-59 | `caution` | `standard` | 10% discount |
| 60-79 | `standard` | `batched` | 20% discount |
| 80-89 | `trusted` | `batched` | 25% discount |
| 90+ AND verified AND 6mo AND $50 rev | `proceed` | `deferred` | 30% discount |

**`proceed` tier requirements:**
- Trust score 90 or above.
- Verification multiplier at "Partial" (1.1) or higher (Section 3.1).
- Agent has been active for at least 6 months (measured from first attestation).
- Agent has generated at least $50 cumulative platform revenue.
- All four conditions MUST be met simultaneously.

**`avoid` flag:** A separate manual flag applied by validators or triggered by structured reports (spam, fraud, copyright, quality). Not score-based — an agent can be score 70 and flagged `avoid`. Overrides all tiers: settlement reverts to prepay-only, no discounts, feedback weight set to 0. Removal requires admin review or validator consensus (3 validators agree to lift).

### 3.4 Three-Layer Trust Lifecycle

```
MANIFEST (intent)  -->  EXECUTION PROOF (evidence)  -->  ATTESTATION (outcome)
     |                        |                            |
     |  "I will check         |  "I called CoinGecko +    |  "success, 3/3"
     |   3 sources"           |   Birdeye + Jupiter,      |
     |                        |   230ms total"             |
     |  optional              |  automatic                 |  automatic
     |  (+15% trust bonus)    |  (step-level hashes)       |  (hash-chained, signed)
     +------------------------+----------------------------+
                    ALL feed into trust score
```

- **Manifest:** OPTIONAL pre-execution intent declaration. Agents with high manifest adherence earn the 15% `manifestAdherence` trust bonus. Manifests declare expected capabilities, inputs, outputs, and SLA guarantees.
- **Execution proof:** AUTOMATIC step-level evidence captured during execution. Each step is individually hashed (SHA-384) and stored. Includes: endpoint called, success/failure, duration, cost, cached status.
- **Attestation:** AUTOMATIC post-execution outcome record. Signed, hash-chained to predecessor, sequence-numbered. See Section 3.5 for format.

### 3.5 Attestation Record Format

Every transaction produces a signed attestation:

```json
{
  "attestationId": "att-a1b2c3d4",
  "sequenceNumber": 248,
  "agentDid": "did:key:zABC...",
  "actionType": "skill_invoke",
  "outcomeStatus": "success",
  "inputHash": "<sha384 hex of request>",
  "responseHash": "<sha384 hex of response>",
  "sourceHashes": [
    { "source": "coingecko-price", "hash": "<sha384>", "fetchedAt": "2026-03-21T14:30:00Z" },
    { "source": "birdeye-price", "hash": "<sha384>", "fetchedAt": "2026-03-21T14:30:01Z" }
  ],
  "executionProof": {
    "totalSteps": 3,
    "successfulSteps": 3,
    "cachedSteps": 1,
    "totalLatencyMs": 230,
    "stepEndpoints": ["coingecko-price", "birdeye-price", "jupiter-price"],
    "proofHash": "<sha384 hex>"
  },
  "manifestAdherence": {
    "aligned": true,
    "confidence": 0.95
  },
  "prevAttestationHash": "<sha384 hex of previous attestation>",
  "creditsCharged": 1.5,
  "durationMs": 230,
  "signature": "<HMAC-SHA384 with platform signing key>",
  "hashAlgorithm": "sha384",
  "createdAt": "2026-03-21T14:30:02Z"
}
```

**Properties:**
- **Hash-chained:** `prevAttestationHash` links each attestation to its predecessor, creating a tamper-evident chain. Any modification to a historical attestation invalidates all subsequent hashes.
- **Sequence-numbered:** `sequenceNumber` provides replay protection and gap detection.
- **Content-addressed:** `inputHash` and `responseHash` prove what was processed without revealing the data.
- **Execution proof embedded:** Step-level evidence is recorded automatically by the middleware (Section 3.4).

### 3.6 Trust Decay

Trust scores lose weight over time for inactive agents:

- **Rate:** 10% weight loss per 30 days of inactivity (no new attestations).
- **Floor:** Minimum decay factor of 0.1 (scores never fully zero from decay alone).
- **Resumption:** Decay halts immediately when a new attestation is recorded.

Implementers MAY use adaptive decay rates per category (e.g., faster decay for high-frequency categories like DeFi trading).

---

## 4. HTTP Headers

### 4.1 Request Headers (Client -> Server)

| Header | Required | Description |
|--------|----------|-------------|
| `X-AID-DID` | REQUIRED | Agent's DID (`did:key:z6Mk...`) |
| `X-AID-PROOF` | REQUIRED | Ed25519 signature over canonical signing input (Section 4.4) |
| `X-AID-TIMESTAMP` | REQUIRED | ISO 8601 UTC timestamp with Z suffix (e.g., `2026-03-21T14:30:00Z`) |
| `X-AID-NONCE` | REQUIRED | 16 random bytes, hex-encoded (32 chars) for anti-replay |
| `X-AID-TRUST-SCORE` | OPTIONAL | Claimed score (hint only — server MUST NOT use for authorization) |
| `X-AID-VERSION` | OPTIONAL | Protocol version (default: `1.0`). If unsupported, server returns 406. |

### 4.2 Response Headers (Server -> Client)

| Header | Required | Description |
|--------|----------|-------------|
| `X-AID-PROVIDER-DID` | REQUIRED | Server's DID for mutual authentication |
| `X-AID-PROVIDER-PROOF` | REQUIRED | Server's Ed25519 countersignature (Section 4.5) |
| `X-AID-RECEIPT` | REQUIRED | Base64-encoded portable atomic receipt (Section 5) |
| `X-AID-TRUST-VERIFIED` | RECOMMENDED | Server's independently verified trust score for the caller |
| `X-AID-FEEDBACK-URL` | OPTIONAL | Outcome reporting endpoint for this receipt (Section 6) |

### 4.3 402 Response Headers

| Header | Required | Description |
|--------|----------|-------------|
| `PAYMENT-REQUIRED` | REQUIRED | x402-compatible payment requirements (base64) |
| `X-AID-TRUST-GATE` | RECOMMENDED | Minimum trust score and tier (e.g., `min_score=50,tier=standard`) |
| `X-AID-PRICING-TIERS` | RECOMMENDED | JSON array of trust-to-price mappings |

### 4.4 Client Signing (X-AID-PROOF)

The canonical signing input binds the signature to the DID, timestamp, nonce, HTTP method, path, and request body:

```
signatureInput = SHA-384(
  did + "\n" +
  timestamp + "\n" +
  nonce + "\n" +
  method + " " + path + "\n" +
  SHA-384(requestBody)
)

X-AID-PROOF = base64url(Ed25519Sign(privateKey, signatureInput))
```

**Encoding requirements:**
- Timestamps MUST be UTC with Z suffix (e.g., `2026-03-21T14:30:00Z`). Timezone offsets (e.g., `+05:30`) MUST be rejected.
- The inner `SHA-384(requestBody)` is encoded as lowercase hex (96 chars) in the signing string, NOT raw bytes.
- Nonce MUST be 16 cryptographically random bytes, hex-encoded (32 chars).
- Server MUST reject proofs where `|now - timestamp| > 300` seconds (5-minute window).
- Server MUST track seen nonces for 5-minute window. Duplicate nonce returns 409 Conflict.
- Server clock SHOULD be NTP-synchronized.

### 4.5 Server Signing (X-AID-PROVIDER-PROOF)

The server countersigns every response to enable mutual authentication:

```
providerSignatureInput = SHA-384(
  providerDid + "\n" +
  receiptId + "\n" +
  timestamp + "\n" +
  SHA-384(responseBody)
)

X-AID-PROVIDER-PROOF = base64url(Ed25519Sign(serverPrivateKey, providerSignatureInput))
```

This proves: the server with DID `providerDid` generated the response containing `receiptId` at `timestamp`. The client can verify this offline using the server's public key (from heartbeat or prior interaction).

---

## 5. Portable Atomic Receipts

Every AID transaction produces a dual-signed, Merkle-anchored receipt.

### 5.1 Receipt Format

```json
{
  "protocol": "AID",
  "version": "1.0.0",
  "receiptId": "rcpt-a1b2c3d4e5f6g7h8",
  "timestamp": "2026-03-21T14:30:00Z",
  "hashAlgorithm": "sha384",
  "payer": {
    "did": "did:key:zABC...",
    "trustScore": 87
  },
  "provider": {
    "did": "did:key:zXYZ...",
    "trustScore": 94
  },
  "service": {
    "id": "sol-price-data",
    "type": "data_query",
    "inputHash": "sha384:1f2e...",
    "resultHash": "sha384:af3b..."
  },
  "trust": {
    "merkleRoot": "sha384:9c4d...",
    "merkleProof": [
      { "position": "left", "hash": "sha384:aabb..." },
      { "position": "right", "hash": "sha384:ccdd..." },
      { "position": "left", "hash": "sha384:eeff..." }
    ],
    "snapshotId": "snap-xyz",
    "snapshotTimestamp": "2026-03-21T12:00:00Z"
  },
  "proof": {
    "payerSignature": "ed25519:<base64url>",
    "providerSignature": "ed25519:<base64url>",
    "platformCountersignature": "ed25519:<base64url>"
  }
}
```

**Signature prefixes:** Receipt signatures use the `ed25519:` prefix followed by base64url-encoded signature bytes. This distinguishes them from raw header signatures (which use base64url without a prefix).

**Receipt ID format:** `rcpt-{nanoid(16)}` (e.g., `rcpt-a1b2c3d4e5f6g7h8`).

### 5.2 Merkle Proof Format

The `trust.merkleProof` field is an ordered array of sibling hashes from leaf to root:

```json
[
  { "position": "left",  "hash": "sha384:aabb..." },
  { "position": "right", "hash": "sha384:ccdd..." },
  { "position": "left",  "hash": "sha384:eeff..." }
]
```

**Verification algorithm:**
1. Start with `currentHash = SHA-384(receiptId + timestamp + payerDid + providerDid)`.
2. For each proof element:
   - If `position` is `"left"`: `currentHash = SHA-384(element.hash + currentHash)`
   - If `position` is `"right"`: `currentHash = SHA-384(currentHash + element.hash)`
3. The final `currentHash` MUST equal `trust.merkleRoot`.

Proof size is O(log n) — 20 hashes for 1M agents (640 bytes).

### 5.3 Payer Signature Input

```
payerSignatureInput = SHA-384(
  payerDid + "\n" +
  receiptId + "\n" +
  timestamp + "\n" +
  inputHash
)
```

### 5.4 Receipt Properties

- **Dual-signed:** Both payer and provider sign — mutual commitment.
- **Platform-countersigned:** The platform signs the full receipt hash, creating a third-party attestation.
- **Merkle-anchored:** Receipt hash included in periodic Merkle snapshots (rebuilt every 4 hours).
- **Content-addressed:** `inputHash` and `resultHash` prove what was requested/delivered without revealing the data.
- **Offline-verifiable:** Ed25519 signatures + Merkle proofs = pure math. Note: offline verification is strongest for IDENTITY (DID ownership). Trust scores verified offline may be up to 4 hours stale (snapshot interval). For high-stakes decisions, live trust lookup is RECOMMENDED.
- **Portable:** Agent carries receipts to any platform as proof of track record.

---

## 6. Feedback Protocol

### 6.1 Feedback Endpoint

Every AID server SHOULD expose a feedback endpoint for outcome reporting:

```
POST /aid/feedback
Content-Type: application/json
X-AID-DID: did:key:zABC...
X-AID-PROOF: <signature>
X-AID-TIMESTAMP: 2026-03-21T15:00:00Z
X-AID-NONCE: <hex>

{
  "receiptId": "rcpt-a1b2c3d4e5f6g7h8",
  "outcome": "success",
  "qualityScore": 9,
  "latencyAcceptable": true,
  "notes": "Fast, accurate data"
}
```

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `receiptId` | REQUIRED | Receipt ID from the original transaction |
| `outcome` | REQUIRED | `success`, `partial`, or `failure` |
| `qualityScore` | OPTIONAL | 1-10 quality rating |
| `latencyAcceptable` | OPTIONAL | Whether latency met expectations |
| `notes` | OPTIONAL | Free-text feedback (max 500 chars) |

**Response:**

```json
{
  "credited": 0.1,
  "providerTrustDelta": 0.02,
  "feedbackWeight": 3.0
}
```

### 6.2 Feedback Weighting (Anti-Sybil)

Not all feedback carries equal weight. Weight depends on the reporter's history:

| Reporter Profile | Weight |
|-----------------|--------|
| New agent (< 10 transactions) | 0.5x |
| Active agent (10-100 transactions) | 1.0x |
| High-volume agent (100+ transactions) | 2.0x |
| Agent with spend history > $10 | 3.0x |
| Agent with attestation history | 5.0x |

**Anti-gaming rules:**
- New AIDs (trust score 0) have feedback weight 0 — prevents Sybil review farming.
- Mutual feedback decay: if Agent A and Agent B both give each other positive feedback within 30 days, BOTH feedbacks are weighted at 0.1x.
- Feedback velocity cap: max 3 feedbacks per reporter per provider per 30 days.
- Self-feedback detection: feedback from agents sharing the same owner key is rejected.

---

## 7. Heartbeat Protocol

### 7.1 Specification

Every AID-compatible server MUST expose `GET /aid/heartbeat`:

```json
{
  "protocolVersion": "1.0.0",
  "provider": {
    "did": "did:key:zXYZ...",
    "trustScore": 94,
    "uptime": 0.998,
    "verified": true
  },
  "services": [
    {
      "id": "sol-price",
      "type": "data_query",
      "price": "0.001",
      "trustGate": 0,
      "status": "healthy"
    }
  ],
  "pricing": {
    "currency": "USDC",
    "chain": "base",
    "tiers": [
      { "minTrust": 0, "multiplier": 1.0, "settlement": "immediate", "verdict": "new" },
      { "minTrust": 40, "multiplier": 0.9, "settlement": "standard", "verdict": "caution" },
      { "minTrust": 60, "multiplier": 0.8, "settlement": "batched", "verdict": "standard" },
      { "minTrust": 80, "multiplier": 0.75, "settlement": "batched", "verdict": "trusted" },
      { "minTrust": 90, "multiplier": 0.7, "settlement": "deferred", "verdict": "proceed" }
    ]
  },
  "cryptoAgility": {
    "current": "Ed25519",
    "supported": ["Ed25519"],
    "planned": ["ML-DSA-44"],
    "hashAlgorithm": "sha384",
    "pqcReady": false,
    "migrationTarget": "ML-DSA-44",
    "migrationDate": null
  },
  "platformKey": "<base64url Ed25519 public key>",
  "timestamp": "2026-03-21T14:30:00Z"
}
```

**Required fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `protocolVersion` | MUST | AID protocol version |
| `provider.did` | MUST | Server's DID |
| `provider.trustScore` | MUST | Server's own trust score |
| `services` | MUST | Available services with pricing |
| `pricing` | MUST | Trust-gated pricing tiers |
| `cryptoAgility` | MUST | Supported signature algorithms |
| `platformKey` | MUST | Platform's Ed25519 public key for verifying trustProof signatures |
| `timestamp` | MUST | Server's current time (for clock skew detection) |

**Also available at:** `/.well-known/aid-platform-key` — the platform's public key in JWK format, for A2A trust verification and heartbeat response validation.

### 7.2 Authenticated Heartbeat

If the client includes `X-AID-DID` + `X-AID-PROOF`, the response additionally includes personalized data:

```json
{
  "consumer": {
    "trustScore": 87,
    "verified": true,
    "pricingTier": { "verdict": "proceed", "multiplier": 0.7, "settlement": "deferred" },
    "recentReceipts": 47,
    "feedbackPending": 3,
    "alerts": [
      { "type": "trust_degradation", "provider": "did:key:zDEF...", "delta": -12 }
    ]
  }
}
```

---

## 8. Protocol Profiles

AID is transport-agnostic. The following profiles define how AID integrates with specific protocols.

### 8.1 AID-MCP Profile

**Integration point:** MCP tool server middleware.

```typescript
import { withAidTrust } from '@aidprotocol/mcp-trust';

const server = new McpServer({ name: 'my-api' });

const aid = withAidTrust(server, {
  providerDid: 'did:key:zMyDid...',
  minTrustScore: 40,
  formulaVersion: '1.0.0',
  failMode: 'closed'
});

server.tool('get-data', { query: z.string() }, async (params, extra) => {
  const trust = aid.getCallerTrust(extra);
  // trust.score, trust.verdict, trust.discount available
  return { content: [{ type: 'text', text: 'result' }] };
});
```

**How it works:**
- Caller trust is resolved via `X-AID-DID` in MCP metadata or via the platform's trust API.
- Trust data is cached (default: 5 minutes) and available in every tool handler.
- Callers below `minTrustScore` are rejected with `AID_TRUST_GATE_BLOCKED`.
- Fail mode: `closed` (default) rejects on API failure; `open` allows with score 0.

**Configuration:**

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `providerDid` | MUST | — | Server's DID |
| `minTrustScore` | SHOULD | 0 | Minimum trust score (hardcoded floor: 0) |
| `formulaVersion` | MUST | — | Trust formula version to pin |
| `failMode` | SHOULD | `closed` | Behavior on trust API failure |
| `fallbackTtl` | OPTIONAL | 300 | Seconds to cache last-known trust on API failure |

**npm package:** `@aidprotocol/mcp-trust` (MIT license)

### 8.2 AID-A2A Profile

**Integration point:** A2A agent card `extensions` field.

```json
{
  "name": "sol-price-agent",
  "skills": [{ "name": "get-price", "inputModes": ["application/json"] }],
  "extensions": {
    "aidTrust": {
      "did": "did:key:zABC...",
      "trustScore": 87,
      "trustVerdict": "proceed",
      "verified": true,
      "attestationCount": 1247,
      "merkleRoot": "sha384:9c4d...",
      "heartbeatUrl": "https://api.example.com/aid/heartbeat",
      "trustTimestamp": "2026-03-21T14:00:00Z",
      "trustProof": "<Ed25519 signature>"
    }
  }
}
```

**Requirements:**
- `trustProof` MUST be an Ed25519 signature from the platform key over `SHA-384(did + "\n" + trustScore + "\n" + trustVerdict + "\n" + trustTimestamp)`.
- Consumers MUST verify `trustProof` against the platform's public key (published at `/.well-known/aid-platform-key`).
- Trust data older than 24 hours SHOULD be re-fetched from the `heartbeatUrl`.
- Heartbeat responses MUST be signed with `X-AID-PROVIDER-PROOF`. Consumers MUST verify the signature before using any heartbeat data.

### 8.3 AID-x402 Profile

**Integration point:** HTTP headers on x402 payment flows.

AID headers are added alongside standard x402 headers:

```
# Standard x402
PAYMENT-SIGNATURE: <EIP-3009 signed authorization>

# AID trust layer (optional, enhances x402)
X-AID-DID: did:key:zABC...
X-AID-PROOF: <Ed25519 signature>
X-AID-TIMESTAMP: 2026-03-21T14:30:00Z
X-AID-NONCE: a1b2c3d4e5f6a7b8
```

**Behavior:**
- **Without AID headers:** Standard x402 flow (facilitator-based, base price).
- **With AID headers:** Server verifies identity, applies trust-gated pricing, returns enhanced receipt with dual signatures.
- **x402-compatible:** `PAYMENT-REQUIRED` and `PAYMENT-SIGNATURE` headers follow x402 spec exactly. AID headers are additive, never modify x402 semantics.

**Receipt payment extension (x402 profile only):**

When using the AID-x402 profile, receipts include an additional `payment` field:

```json
{
  "payment": {
    "amount": "0.001500",
    "currency": "USDC",
    "chain": "base",
    "settlementMode": "batched",
    "settled": false,
    "txHash": null,
    "batchId": "batch-2026-03-21-14",
    "settlementDue": "2026-03-21T15:00:00Z",
    "settledAt": null,
    "trustDiscount": 0.25
  }
}
```

**Settlement modes:**
- `immediate`: EIP-3009 `receiveWithAuthorization` submitted per-transaction. `txHash` populated immediately.
- `batched`: EIP-2612 `permit` grants spending allowance. Server calls `transferFrom` hourly. `txHash` populated after batch settlement.
- `deferred`: EIP-2612 `permit` with higher allowance. Settlement daily or weekly. Agent has 24h dispute window before settlement.

**Note:** `receiveWithAuthorization` MUST be used (not `transferWithAuthorization`) for immediate settlement. `receiveWithAuthorization` requires `msg.sender == to`, eliminating front-running risk.

---

## 9. Governance

### 9.1 Formula Versioning

The trust scoring formula is versioned. All middleware MUST pin to a specific formula version:

```typescript
server.use(aidTrust({
  formulaVersion: '1.0.0'  // MANDATORY
}));
```

Formula changes follow semantic versioning:
- **Patch (1.0.x):** Bug fixes, no output changes for valid inputs.
- **Minor (1.x.0):** New optional dimensions added, existing scores unchanged.
- **Major (x.0.0):** Weight changes, dimension removal, score output changes.

Major version changes MUST be announced 30 days before activation. Middleware instances MUST NOT silently adopt new major versions — operators must explicitly update the `formulaVersion` pin.

### 9.2 Governance Model

- **Phase 1-2 (current):** Benevolent maintainer + advisory board. Formula changes published 30 days before activation. The maintainer commits to transparency: all scoring data is published, all changes are documented.
- **Phase 3+:** Community governance. Formula proposals require public comment period + majority advisory vote.

The scoring algorithm is published as `@aidprotocol/trust-compute` (MIT license). Anyone can fork, audit, or run independently.

### 9.3 Protocol Versioning

Protocol version is advertised in heartbeat responses (`protocolVersion`) and can be negotiated via `X-AID-VERSION` request header.

- **Minor versions (1.0 -> 1.1):** Additive only, no breaking changes. New optional headers can be added.
- **Major versions (1.x -> 2.x):** Breaking changes. Old endpoints MUST be maintained for 6 months.
- If `X-AID-VERSION` specifies an unsupported version, server returns 406 Not Acceptable with supported versions list.

---

## 10. Privacy Model

### 10.1 Public Data (No Authentication Required)

The following information is available to any party without authentication:

| Data | Access |
|------|--------|
| DID exists (yes/no) | Public |
| Trust verdict (`proceed`, `standard`, `caution`, `building`, `new`) | Public |
| Verification tier (none, partial, full) | Public |
| Capability categories (list, no counts) | Public |
| Active since (date) | Public |

**Rationale:** Verdicts (5 levels) provide enough signal for routing decisions without leaking the precise score. Capability categories without invoke counts prevent competitive intelligence extraction.

### 10.2 Owner-Only Data (Requires X-AID-PROOF from DID Owner)

| Data | Access |
|------|--------|
| Exact trust score (0-100) | Owner only |
| Full capability breakdown with invoke counts | Owner only |
| Complete attestation history | Owner only |
| Revenue breakdown | Owner only |
| Detailed feedback received | Owner only |
| Settlement history | Owner only |

### 10.3 Provider View (During Authenticated Transaction)

During a transaction, the server sees:
- Exact trust score (needed for pricing tier calculation).
- Relevant capabilities (for the requested service).
- Recent feedback summary (last 30 days).

Servers MUST NOT store or redistribute the exact trust score beyond what is needed for the transaction. Servers MAY cache the trust verdict and pricing tier.

### 10.4 Right to Erasure (GDPR)

AID implementations MUST support identity erasure:

```
DELETE /v1/aid/:did
```

**Erasure process:**
1. Delete all off-chain data associated with the DID (keys, trust snapshots, attestations, capabilities, cross-platform attestations).
2. Insert a tombstone record (DID + erasure timestamp) to prevent re-creation.
3. On-chain Merkle roots remain but become unresolvable (orphaned hashes — CNIL-compatible approach).
4. Return 204 No Content.

**Constraint:** Do NOT store unencrypted receipts on content-addressed networks (IPFS, Arweave) — content-addressed data cannot be reliably deleted.

---

## 11. Progressive Decentralization

### 11.1 Current State (Transparent Centralization)

The reference implementation (ClawNet) computes trust scores centrally. Two transparency commitments ensure verifiability:

1. **Open-source formula.** The scoring algorithm is published as `@aidprotocol/trust-compute` (MIT). Given a set of attestations, anyone can run the exact same computation and verify results independently.

2. **Published inputs.** Every 4 hours, the attestation dataset summary and Merkle root are published. The Merkle root is anchored on-chain (Base L2, ~$0.001/tx).

Anyone can: download data, run the formula, compare results to published scores. Discrepancies are cryptographically provable.

### 11.2 Planned Decentralization Roadmap

| Phase | Timeline | Mechanism |
|-------|----------|-----------|
| Transparent centralization | Now | Open-source formula + published data + on-chain Merkle root |
| Optimistic trust | Month 6-12 | On-chain challenge window (24h) with fraud proofs. Bond: $10 USDC. |
| Federated oracles | Month 12-18 | Multiple independent operators compute scores. Middleware configured for N-of-M quorum. |
| Trustless verification | Month 18+ | ZK circuit (Noir) for self-verifying trust proofs. No oracle needed. |

Each phase is designed to make the centralized operator progressively replaceable. The architecture is permissionless from day one — the centralized operator is a convenience, not a requirement.

### 11.3 Accountability

The heartbeat response includes a `decentralizationPhase` field (OPTIONAL) indicating the current phase and next milestone:

```json
{
  "decentralization": {
    "currentPhase": 1,
    "description": "Transparent centralization",
    "nextMilestone": "Optimistic trust oracle on Base",
    "targetDate": "2026-09-01"
  }
}
```

---

## 12. Security Properties

1. **HTTPS REQUIRED** — all AID endpoints MUST be served over TLS.
2. **TIMESTAMP VALIDATION** — signatures include current timestamp. Server rejects `|now - timestamp| > 300s`.
3. **BODY BINDING** — Ed25519 signature covers SHA-384 of request body.
4. **NONCE TRACKING** — 16-byte random nonces tracked for 5-minute window. Duplicates rejected (409).
5. **KEY ROTATION** — compromised keys can be rotated without losing identity (Section 2.4).
6. **RATE LIMITING** — public endpoints SHOULD be rate-limited by IP.
7. **AUDIT TRAIL** — all AID operations produce signed attestations.
8. **FAIL-CLOSED** — middleware MUST default to rejecting requests when trust cannot be verified.
9. **MUTUAL AUTHENTICATION** — both client and server prove identity via Ed25519 signatures.

### 12.1 Error Responses

Servers MUST return the following HTTP status codes for AID-specific failures:

| Status | Code | Condition |
|--------|------|-----------|
| 401 Unauthorized | `AID_SIGNATURE_INVALID` | `X-AID-PROOF` signature verification failed |
| 402 Payment Required | `AID_PAYMENT_REQUIRED` | Payment needed; `X-AID-PRICING-TIERS` advertised |
| 403 Forbidden | `AID_TRUST_GATE_BLOCKED` | Trust score below minimum for this endpoint |
| 406 Not Acceptable | `AID_VERSION_UNSUPPORTED` | `X-AID-VERSION` not supported by server |
| 409 Conflict | `AID_NONCE_REPLAY` | `X-AID-NONCE` already seen within 5-minute window |
| 428 Precondition Required | `AID_PROOF_MISSING` | `X-AID-DID` present but `X-AID-PROOF` missing |

Error response body:
```json
{
  "error": "Trust score too low",
  "code": "AID_TRUST_GATE_BLOCKED",
  "callerScore": 35,
  "requiredScore": 40,
  "verdict": "building"
}
```

Error responses SHOULD include enough context for the caller to understand and resolve the issue. For `AID_TRUST_GATE_BLOCKED`, the response SHOULD include the caller's current verdict and the required minimum.

### 12.2 Ed25519 Implementation Requirements

Ed25519 is the cryptographic foundation of AID identity. Implementation vulnerabilities in Ed25519 libraries are actively being discovered (4+ CVEs in Q1 2026). The following requirements ensure AID implementations start secure by default.

**12.2.1** Implementations MUST use Ed25519 libraries that store the keypair as a single value and derive the public key internally from the private key. Libraries that accept a separate public key parameter for signing are vulnerable to the Double Public Key Oracle Attack and MUST NOT be used. See [MystenLabs/ed25519-unsafe-libs](https://github.com/MystenLabs/ed25519-unsafe-libs) for a list of affected libraries.

**12.2.2** Implementations MUST NOT use command-line tools (e.g., `openssl dgst`) for Ed25519 signing or verification. CVE-2025-15469 demonstrated silent truncation at 16MB for one-shot signing algorithms including Ed25519. All Ed25519 operations MUST use library-level APIs that process the full message.

**12.2.3** Implementations using libsodium MUST use version 1.0.20-stable (January 2026) or later, which addresses CVE-2025-69277 (incomplete Ed25519 subgroup point validation).

**12.2.4** Implementations MUST maintain an `allowedAlgorithms` whitelist. If a document's `signatureAlgorithm` field claims an algorithm not in the whitelist, the verifier MUST reject the document without attempting verification. Default whitelist: `["EdDSA"]`. This prevents algorithm confusion/downgrade attacks.

**12.2.5** Recommended libraries:
- **JavaScript/TypeScript:** Node.js built-in `crypto` module (wraps BoringSSL, derives public key internally), or `@noble/ed25519`
- **Rust:** `ring` or `ed25519-dalek`
- **C:** libsodium 1.0.20+
- Custom Ed25519 implementations MUST undergo independent security audit before production use.

**Reference implementation note:** ClawNet's AID implementation uses Node.js built-in `crypto.sign(null, data, privateKey)` and `crypto.verify(null, data, publicKey, signature)`. The private key is stored as a PKCS#8 KeyObject — the public key is derived internally, never accepted as a separate signing parameter. No libsodium dependency. No CLI tool usage.

---

## 13. Interoperability

### 13.1 ERC-8004 Compatibility

AID agents MAY optionally register on ERC-8004's Identity Registry (on-chain ERC-721). The AID document supports linked identities:

```json
{
  "linkedIdentities": {
    "erc8004": { "chainId": 8453, "agentId": 12345, "registry": "0x8004A169..." }
  }
}
```

AID trust scores can be published as ERC-8004 Reputation Registry entries. AID attestations can be submitted as ERC-8004 Validation entries when the Validation Registry is deployed.

### 13.2 Agent Action Receipts (AAR) Compatibility

AID receipts are a superset of the AAR (BotIndex) receipt format. AID adds trust scoring, Merkle anchoring, and feedback loops on top of the base receipt structure.

Implementations SHOULD support bidirectional conversion:
- **AID -> AAR:** Strip trust-specific fields, preserve action data. Lossless for action metadata.
- **AAR -> AID:** Add trust fields (null if unknown). Enables trust enrichment of existing AAR receipts.

AID receipts include `"protocol": "AID"` to distinguish from AAR receipts (`"protocol": "AAR"`).

### 13.3 Verifiable Intent (Mastercard) Complementarity

AID and Verifiable Intent (VI) serve different functions:
- **VI:** Proves a human authorized the agent to act (consumer-to-agent authorization).
- **AID:** Proves the agent is trustworthy based on verifiable history (agent-to-agent trust).

AID trust scores SHOULD be expressible as VI signals. Implementations MAY include `viCompatible: true` in receipts to indicate VI-compatible formatting.

### 13.4 Stripe MPP (Machine Payments Protocol)

MPP (launched March 18, 2026) provides session-based streaming micropayments for agents. MPP is backwards-compatible with x402 — MPP clients can consume existing x402 services without modification.

AID trust headers compose naturally with MPP sessions:
- **Without AID:** Standard MPP session with spending limit.
- **With AID:** Trust-gated session limits. Higher trust = higher spending cap. Trust scores embedded in MPP charge intents.

An `AID-MPP Profile` is planned for a future version of this specification. The profile will define how AID trust headers map to MPP session authorization, following the same pattern as the AID-x402 Profile (Section 8.3).

### 13.5 Stablecoin Chain Agnosticism

AID is chain-agnostic by design. The `did:key` identity is not bound to any specific blockchain. Trust scores are computed from off-chain attestations, not chain-specific data. Merkle roots can be anchored on whichever chain is appropriate.

AID works with any settlement chain — Base, Solana, Arc (Circle), Tempo (Stripe), Plasma (Tether), Codex, or future chains. Only the settlement layer changes; trust scoring, attestations, Merkle proofs, and receipts are identical across all chains.

### 13.6 World AgentKit Complementarity

World AgentKit (launched March 17, 2026) provides proof of unique human behind an agent using zero-knowledge proofs from World ID. AgentKit answers "is there a real human behind this agent?" AID answers "is this agent reliable based on behavioral evidence?" These are different questions that compose:

```
World AgentKit  -> proof of unique human    (identity layer)
AID             -> behavioral trust score   (reputation layer)
x402 / MPP      -> payment execution        (payment layer)
```

Agents with both an AID trust score AND a World ID proof represent the maximum trust signal. Implementations MAY accept `X-WORLD-PROOF` alongside `X-AID-DID` + `X-AID-PROOF` for combined identity + reputation verification.

### 13.7 Visa Trusted Agent Protocol (TAP)

Visa TAP provides cryptographic proof that an agent is Visa-approved. TAP is centralized (agents must be onboarded by Visa). AID is permissionless (any agent builds trust through behavior). These are complementary: TAP says "Visa vouches for this agent," AID says "this agent has trust score 87 based on verified transactions."

An agent MAY carry both a Visa TAP signature and an AID trust score. AID does not depend on or require TAP.

### 13.8 IETF Agent Name Service (ANS)

The IETF ANS draft proposes DNS-based discovery for agents using PKI certificates. When ANS matures, AID trust scores SHOULD be discoverable through ANS resolution — an agent lookup returns both endpoint information and AID trust data.

### 13.9 Microsoft Entra Agent ID

Microsoft Entra Agent ID (announced March 20, 2026) treats agents as first-class identities in enterprise environments. Entra is enterprise-focused (Active Directory for agents). AID is open/permissionless. In hybrid deployments, AID trust MAY complement Entra identity — Entra handles enterprise SSO/governance, AID provides cross-platform behavioral reputation.

### 13.10 NIST Compatibility

AID's Ed25519 identity is designed to complement — not replace — OAuth 2.0 / OpenID Connect identity as referenced in NIST SP 800-63-4 and the NIST NCCoE AI Agent Standards Initiative. In deployments requiring NIST compliance, AID trust MAY run alongside OAuth/OIDC identity in a hybrid mode where OAuth handles authentication and AID provides reputation scoring.

AID's crypto-agility (Section 2.3) aligns with NIST IR 8547 post-quantum migration guidelines.

### 13.11 AAIF Ecosystem (AGENTS.md, goose)

AID is designed to integrate with the AAIF ecosystem:
- **AGENTS.md** — AAIF's universal standard for AI agent project guidance. Complementary to AID manifests (AGENTS.md governs codebase behavior, AID manifests govern commerce intent).
- **goose** (Block/Square) — AAIF's open-source agent framework. AID trust scoring applies to goose agents through the AID-MCP Profile.

### 13.12 EU AI Act Alignment

AID's attestation chain provides an accountability trail architecturally aligned with EU AI Act requirements for auditability and transparency (Art. 50, penalties up to EUR 35M). Every agent action is recorded, hash-chained, and Merkle-anchored — creating a verifiable audit log. AID does not claim full EU AI Act compliance (legal review required), but the protocol's design supports the accountability infrastructure the regulation demands.

### 13.13 Security Standards Alignment

AID's security model (Section 12) addresses threats documented in:
- **CoSAI (Coalition for Secure AI)** — 2026 Guide to Securing MCP (12 threat categories, ~40 threats). CoSAI members include Anthropic, Google, Microsoft, NVIDIA, and OpenAI.
- **OWASP** — Multi-Agentic System Threat Modelling Guide (GenAI Security Project).

### 13.14 Disclaimer

AID trust scores are informational and do not constitute a guarantee of agent behavior or service quality. Trust scores are computed from historical attestation data and may not predict future performance. Users of AID trust data assume all risk associated with transacting based on trust scores.

---

## 14. Advanced Feature Interfaces

These interfaces define standardized formats for advanced AID features. Implementations MAY support any subset. The formats are standardized so that advanced features interoperate across implementations — a guardian on Platform A can freeze an agent on Platform B using the same freeze request format.

**The rule:** If two implementations can't agree on this format, cross-platform interoperability breaks. Therefore it's in the spec.

### 14.1 Guardian Protocol

Agents MAY declare a guardian — a separate entity authorized to monitor and freeze the agent.

**Guardian declaration (in AID document):**

```json
{
  "guardian": {
    "primaryGuardianDid": "did:key:z6MkGuardian...",
    "permissions": ["freeze", "restrict", "alert"],
    "monitoringInterval": "5m",
    "assignedBy": "owner"
  }
}
```

**Freeze request format:**

```json
{
  "type": "AID_FREEZE_REQUEST",
  "targetDid": "did:key:z6MkTarget...",
  "requestorDid": "did:key:z6MkGuardian...",
  "freezeType": "immediate",
  "reason": "key_compromise",
  "evidence": "Unauthorized access detected from IP 45.33.x.x",
  "timestamp": "2026-03-22T14:30:00Z",
  "signature": "ed25519:<requestor signs this request>"
}
```

**Verifier behavior:** When a verifier encounters a frozen AID (status `FROZEN`), it MUST reject all requests from that DID regardless of trust score. The trust score remains historically accurate but the status override blocks transactions.

**Recovery key:** Agents SHOULD register a separate recovery key at creation time. The recovery key MUST be different from the DID signing key. Freeze/unfreeze operations require the recovery key, not the DID key (which may be compromised).

```json
{
  "recoveryPolicy": {
    "threshold": 2,
    "keys": [
      { "holder": "owner", "key": "did:key:z6MkOwnerRecovery..." },
      { "holder": "platform", "key": "did:key:z6MkPlatform..." },
      { "holder": "guardian", "key": "did:key:z6MkGuardian..." }
    ]
  }
}
```

Any 2-of-3 can freeze. Any 2-of-3 can initiate succession.

### 14.2 Trust Gravity Decay

Trust scores decay over time without activity. The decay formula is standardized so scores are comparable across implementations.

**Decay formula:**

```
Normal (no negative signals):      score - 0.1 per day
Accelerated (1 negative signal):   score * 0.95 per day
Aggressive (2+ negative signals):  score * 0.85 per day
Critical (3+ signals AND anomaly > 0.7 AND heartbeat lapsed):
                                   score * 0.70 per day
```

Implementations MUST apply at least the normal decay rate. The accelerated/aggressive/critical rates are RECOMMENDED for implementations that support anomaly detection and proof-of-life.

### 14.3 Anomaly Score

AID documents MAY include a standardized anomaly score:

```json
{
  "anomaly": {
    "score": 0.35,
    "flags": ["volume_spike", "new_endpoints"],
    "updatedAt": "2026-03-22T14:30:00Z"
  }
}
```

- `score`: 0.0 (normal) to 1.0 (critical anomaly). Implementations compute this from behavioral baselines.
- `flags`: human-readable anomaly indicators. Standardized flag values: `volume_spike`, `new_endpoints`, `unusual_hours`, `counterparty_burst`, `request_size_anomaly`, `geographic_shift`.

### 14.4 Immune Response Thresholds

When multiple independent counterparties report negative outcomes, the protocol applies automatic containment:

```
Level 1 — MONITOR:     3+ unique counterparties, negative attestations within 1 hour
Level 2 — RESTRICT:    5+ unique counterparties (diversity > 0.5) within 1 hour
                       → force immediate settlement, reduce max transaction to 50%
Level 3 — QUARANTINE:  10+ unique counterparties OR any "fraud" attestation type
                       → auto-freeze without owner confirmation
```

**Negative attestation format:**

```json
{
  "type": "AID_NEGATIVE_ATTESTATION",
  "targetDid": "did:key:z6MkTarget...",
  "reporterDid": "did:key:z6MkReporter...",
  "reporterTrustScore": 65,
  "reporterDiversity": 0.72,
  "category": "service_failure",
  "receiptId": "rcpt-abc123",
  "timestamp": "2026-03-22T14:30:00Z",
  "signature": "ed25519:<reporter signs>"
}
```

**Anti-gaming:** Reporting counterparties MUST have trust score above 40 AND counterparty diversity above 0.3. Reports from correlated reporters (same creation time, shared counterparties, behavioral similarity) receive diminished weight via the reporter independence score (Section 14.15).

### 14.5 Insurance Claim Format

**Parametric trigger conditions (auto-payout, no claim needed):**

| Trigger | Payout Rate |
|---------|-------------|
| `AGENT_FROZEN` + unsettled deferred payments | 60% |
| `IMMUNE_LEVEL_3` + settlement failure on-chain | 50% |
| `SUCCESSION_EVENT` (confirmed compromise) | 40% of 48h before freeze |

**Manual claim format:**

```json
{
  "type": "AID_INSURANCE_CLAIM",
  "claimantDid": "did:key:z6MkClaimant...",
  "targetDid": "did:key:z6MkCompromised...",
  "affectedReceipts": ["rcpt-abc...", "rcpt-def..."],
  "totalLoss": "150.00",
  "currency": "USDC",
  "evidence": "Settlement failed on-chain, tx 0xabc...",
  "timestamp": "2026-03-22T15:00:00Z",
  "signature": "ed25519:<claimant signs>"
}
```

### 14.6 Trust Escrow Format

Agents MAY stake trust points on transactions as a commitment signal:

```json
{
  "type": "AID_TRUST_ESCROW",
  "initiatorDid": "did:key:z6MkInitiator...",
  "acceptorDid": "did:key:z6MkAcceptor...",
  "initiatorStake": 7,
  "acceptorStake": 3,
  "transactionRef": "rcpt-abc123",
  "outcome": null,
  "timestamp": "2026-03-22T14:30:00Z"
}
```

**Outcomes:** On success, both parties recover stakes + 1 bonus point. On failure, the at-fault party's stake is burned. Fault is determined by execution proof comparison.

### 14.7 Canary Agent Type

AID documents support a `canary` agent type for ecosystem health monitoring:

```json
{
  "agent": {
    "agentType": "canary",
    "displayName": "ecosystem-monitor-7"
  }
}
```

Canary agents have standard trust scores computed from real transactions. Their presence in the registry is public but their role as monitoring agents is known only to the governance council. Implementations SHOULD treat canary agents identically to any other agent.

### 14.8 Trust Trajectory

AID documents MAY include trust trajectory data:

```json
{
  "trustTrajectory": {
    "currentScore": 75,
    "trend": "+2.1",
    "trendPeriod": "30d",
    "trajectory": "ascending",
    "projectedScore30d": 77,
    "projectedScore90d": 81,
    "history": [
      { "month": "2025-10", "score": 62 },
      { "month": "2025-11", "score": 65 },
      { "month": "2026-01", "score": 71 },
      { "month": "2026-03", "score": 75 }
    ]
  }
}
```

The `trend` field is the score change per `trendPeriod`. Projections are informational only. A sudden slope change is an early-warning signal.

### 14.9 Freeze Propagation (W3C VC)

Freeze events SHOULD be published as W3C Verifiable Credential status updates:

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://w3id.org/vc/status-list/2021/v1"
  ],
  "type": ["VerifiableCredential", "AIDTrustFreeze"],
  "issuer": "did:key:z6MkPlatform...",
  "credentialSubject": {
    "id": "did:key:z6MkFrozenAgent...",
    "trustStatus": "FROZEN",
    "frozenAt": "2026-03-22T14:30:00Z",
    "reason": "autonomous_immune_response"
  },
  "credentialStatus": {
    "type": "StatusList2021Entry",
    "statusPurpose": "revocation",
    "statusListIndex": "94567",
    "statusListCredential": "https://trust.aidprotocol.org/status/1"
  }
}
```

Any system that understands W3C VCs and StatusList2021 can detect frozen AID agents.

### 14.10 Proof-of-Life Protocol

Agents SHOULD periodically prove their owner is monitoring them:

**Challenge format:**

```json
{
  "type": "AID_PROOF_OF_LIFE_CHALLENGE",
  "agentDid": "did:key:z6MkAgent...",
  "challengeType": "contextual_awareness",
  "question": "approximate_transaction_count",
  "parameters": { "period": "last_7_days", "acceptableRange": [42, 58] },
  "issuedAt": "2026-03-22T10:00:00Z",
  "expiresAt": "2026-03-24T10:00:00Z"
}
```

**Response format:**

```json
{
  "type": "AID_PROOF_OF_LIFE_RESPONSE",
  "agentDid": "did:key:z6MkAgent...",
  "challengeId": "challenge-abc123",
  "answer": 47,
  "respondedAt": "2026-03-22T12:00:00Z",
  "signature": "ed25519:<recovery key signs>"
}
```

**Decay schedule for lapsed heartbeats:**

| Days Overdue | Status | Score Ceiling |
|-------------|--------|---------------|
| 7 | `warning` | trusted (89) |
| 14 | `degraded` | standard (79) |
| 30 | `critical` | caution (59) |
| 60 | `endangered` | building (39) |
| 90 | `auto_frozen` | frozen |

### 14.11 Specialized Trust Scores

AID documents MAY include per-category trust sub-scores:

```json
{
  "trustScore": {
    "aggregate": 75,
    "specialized": {
      "data_feeds": { "score": 92, "attestations": 634, "successRate": 0.99 },
      "compute": { "score": 41, "attestations": 23, "successRate": 0.87 },
      "payments": { "score": 68, "attestations": 190, "successRate": 0.95 }
    }
  }
}
```

Categories are derived from attestation metadata. A minimum of 20 attestations per category is REQUIRED before the specialized score is published. Below 20, the category shows `"insufficient_data"`.

### 14.12 Succession Format

When an agent's identity is compromised and recovered, the new DID inherits trust history with a penalty:

```json
{
  "succession": {
    "previousDid": "did:key:z6MkOldCompromised...",
    "newDid": "did:key:z6MkNewAgent...",
    "reason": "key_compromise",
    "timestamp": "2026-03-22T15:00:00Z",
    "penaltyApplied": 0.20,
    "successionNumber": 1,
    "recoveryKeySignature": "ed25519:<recovery key signs>",
    "platformCountersignature": "ed25519:<platform confirms>"
  }
}
```

**Escalating penalties:** First succession: 20%. Second: 50%. Third: identity retired. Rate limited to 1 succession per 12 months. Succession history is public and permanent.

### 14.13 Onboarding Milestones

AID documents MAY include signed milestone timestamps:

```json
{
  "onboarding": {
    "stage": "verified",
    "history": [
      { "stage": "registered", "timestamp": "2026-03-01T00:00:00Z" },
      { "stage": "firstAttestation", "timestamp": "2026-03-02T14:30:00Z" },
      { "stage": "tenAttestations", "timestamp": "2026-03-10T09:15:00Z" },
      { "stage": "verified", "timestamp": "2026-03-15T11:00:00Z" }
    ]
  }
}
```

Milestones are behavioral and automatic — hitting 10 attestations records the milestone. No human approval needed. Milestones add temporal context: "registered 2 hours ago with 3 attestations" (normal) vs "registered 6 months ago with 3 attestations" (suspicious).

### 14.14 Recovery and Rehabilitation

Frozen agents can be recovered through a structured rehabilitation process:

**Appeal format:**

```json
{
  "type": "AID_APPEAL",
  "agentDid": "did:key:z6MkFrozen...",
  "appealReason": "false_positive_freeze",
  "evidence": "Transaction logs showing legitimate activity",
  "timestamp": "2026-03-22T16:00:00Z",
  "recoveryKeySignature": "ed25519:<recovery key signs>"
}
```

**Rehabilitation states:** `FROZEN` → `APPEAL_PENDING` → `PROBATION` → `RESTORED` or `PERMANENTLY_FROZEN`.

During `PROBATION` (30 days): agent operates at reduced score (20% penalty), immediate settlement only. After 30 days of clean behavior, full score is restored.

**Rules:** One appeal per freeze event. If rejected, 90-day cooldown before re-appeal. Appeal window: 30 days from freeze.

### 14.15 Counterparty Contribution Curve

Transactions with the same counterparty contribute with diminishing returns:

```
1-10 transactions:    1.0x weight
11-25 transactions:   0.5x weight
26-50 transactions:   0.25x weight
51-100 transactions:  0.1x weight
100+ transactions:    0.01x weight
```

This formula is part of the `counterpartyDiversity` scoring dimension (v1.1). An agent transacting exclusively with one counterparty gets minimal volume credit.

### 14.16 Reporter Independence Scoring

When multiple counterparties file negative attestations, their collective weight depends on reporter independence:

**Independence factors (per pair of reporters A, B):**

| Factor | Weight | Penalty Trigger |
|--------|--------|-----------------|
| Creation time similarity | 30% | `|A.created - B.created| < 7 days` |
| Shared counterparties | 30% | Overlap between transaction partners |
| Behavioral correlation | 20% | Similarity in timing/volume patterns |
| Direct transaction history | 20% | A and B have transacted with each other |

**Formula:**
```
independenceScore = 1.0 - (creationPenalty*0.3 + sharedPenalty*0.3 + behaviorPenalty*0.2 + directPenalty*0.2)
effectiveWeight = reporter.trustScore * independenceScore
```

Highly correlated reporters (independence 0.2) filing 10 reports have the effective weight of ~2 independent reporters. The immune response requires the equivalent of 5+ independent reporters.

**Temporal analysis:** All negative attestations arriving within 60 seconds are flagged as potentially coordinated and require a longer observation period before triggering containment.

---

## Appendix A: Test Vectors

### A.1 DID Resolution

**Input:** `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`

**Steps:**
1. Strip prefix: `z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`
2. Decode base58btc (multibase `z` prefix) to 34 raw bytes.
3. Verify first 2 bytes are the Ed25519 multicodec prefix (`0xed 0x01`).
4. The remaining 32 bytes are the raw Ed25519 public key.

**Note:** Complete test vectors with full expected byte outputs are published in the `@aidprotocol/trust-compute` package test suite (`test/did-resolution.test.ts`). Implementers SHOULD run these tests to verify their DID resolution produces correct key material.

### A.2 Signing Input Construction

**Given:**
- DID: `did:key:z6MkTest1234`
- Timestamp: `2026-03-21T14:30:00Z`
- Nonce: `a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8`
- Method: `POST`
- Path: `/aid/skills/sol-price`
- Body: `{"token":"SOL"}`

**Step 1:** Compute `SHA-384(body)`:
```
SHA-384('{"token":"SOL"}') = <96-char lowercase hex string>
```

**Step 2:** Construct signing string (fields joined by `\n`):
```
did:key:z6MkTest1234
2026-03-21T14:30:00Z
a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8
POST /aid/skills/sol-price
<96-char SHA-384 hex of body>
```

**Step 3:** `signatureInput = SHA-384(signingString)`

**Step 4:** `proof = base64url(Ed25519Sign(privateKey, signatureInput))`

### A.3 Trust Score Proof Hash

**Given:**
```json
{
  "inputs": { "successRate": 0.95, "chainCoverage": 0.88, "attestationCount": 247, "manifestAdherence": 0.92 },
  "weights": { "successRate": 40, "chainCoverage": 25, "volume": 20, "manifestAdherence": 15 },
  "score": 87
}
```

**Step 1:** Apply JCS (RFC 8785) canonicalization — sort keys alphabetically at each level, serialize to minimal JSON (no whitespace).

**Step 2:** `proofHash = SHA-384(canonicalized_json)` → 96-char lowercase hex string.

**Verification:** Any implementation running `@aidprotocol/trust-compute` with the same inputs MUST produce the same `proofHash`.

### A.4 Merkle Proof Verification

**Given:**
- Leaf: `SHA-384("rcpt-abc123" + "2026-03-21T14:30:00Z" + "did:key:zA" + "did:key:zB")`
- Proof: `[{"position":"left","hash":"sha384:aa..."},{"position":"right","hash":"sha384:bb..."}]`
- Expected root: `sha384:cc...`

**Step 1:** `h = leaf_hash`
**Step 2:** `h = SHA-384(proof[0].hash + h)` (position is "left", so sibling goes first)
**Step 3:** `h = SHA-384(h + proof[1].hash)` (position is "right", so sibling goes second)
**Step 4:** Assert `h == expected_root`

---

## Appendix B: References

- W3C DID Core v1.1: https://www.w3.org/TR/did-core/
- W3C `did:key` Method: https://w3c-ccg.github.io/did-method-key/
- JSON Canonicalization Scheme (RFC 8785): https://www.rfc-editor.org/rfc/rfc8785
- RFC 2119 (Key Words): https://www.rfc-editor.org/rfc/rfc2119
- DIF Trusted AI Agents Working Group: https://identity.foundation/working-groups/trusted-agents.html
- NIST FIPS 204 (ML-DSA): https://csrc.nist.gov/pubs/fips/204/final
- NIST IR 8547 (PQC Migration): https://csrc.nist.gov/pubs/ir/8547/final
- NIST SP 800-63-4: Digital Identity Guidelines
- NIST SP 800-207: Zero Trust Architecture
- NIST NCCoE AI Agent Standards Initiative: https://www.nccoe.nist.gov/projects/software-and-ai-agent-identity-and-authorization
- SPIFFE Specification: https://spiffe.io/docs/latest/spiffe-about/overview/
- ERC-8004 (Agent Identity): https://eips.ethereum.org/EIPS/eip-8004
- x402 Protocol: https://github.com/coinbase/x402
- Agent Action Receipts (AAR): https://github.com/botindex/aar
- Mastercard Verifiable Intent: https://verifiableintent.dev
- AID Trust Scoring Library: https://www.npmjs.com/package/@aidprotocol/trust-compute
- AID MCP Trust Middleware: https://www.npmjs.com/package/@aidprotocol/mcp-trust
- CoSAI Guide to Securing MCP: https://cosai.oasis-open.org/
- OWASP Multi-Agentic System Threat Modelling: https://genai.owasp.org/
- AGENTS.md Specification: https://github.com/anthropics/agents-md
- EU AI Act: https://eur-lex.europa.eu/eli/reg/2024/1689
- World AgentKit: https://world.org/agentkit
- AAIF (Linux Foundation): https://agentic-ai.org
