# AID Protocol Specification v1.0

**Agent Identity Document — The Trust Layer for Agentic Commerce**

**Status:** Draft
**Version:** 1.0.0
**Date:** March 22, 2026
**Authors:** Josh Mclain (ClawNet)
**License:** Apache 2.0

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

**Reference implementation:** ClawNet (claw-net.org) — production agent orchestration platform with 344 API endpoints, Ed25519 AID system, Merkle-anchored trust snapshots, and 46 documented attack mitigations (Sections 20, 26, 32, 39, 41.4, 43.3, 44.2, 45.2 of the engineering document).

**Open-source scoring library:** `@aidprotocol/trust-compute` (npm, MIT license) — deterministic computation anyone can run independently.

---

## 1. Protocol Overview

### 1.1 Design Principles

1. **Trust is computed, not declared.** Scores derive from verifiable attestation history, not self-reported claims.
2. **Identity is self-certifying.** The public key IS the identifier. No registry lookup required.
3. **Verification is offline.** Ed25519 signatures + Merkle proofs = pure math, zero network calls.
4. **Algorithm-agile.** Every document includes `signatureAlgorithm`, `algorithmVersion`, `hashAlgorithm`. Never hardcode Ed25519 or SHA-384.
5. **Complementary, not competitive.** AID plugs into existing protocols — it does not replace them.
6. **Transparent.** The scoring formula is published, open-source, and independently verifiable.

### 1.2 Protocol Flow

```
Client                                    Server
  │                                         │
  │─── Request + X-AID-DID + X-AID-PROOF ──►│
  │    + X-AID-TIMESTAMP + X-AID-NONCE      │
  │                                         │
  │    Server verifies Ed25519 signature    │
  │    (offline — pure math, no API call)   │
  │                                         │
  │    Server resolves trust score          │
  │    (local DB or cached API lookup)      │
  │                                         │
  │    Server applies trust-gated pricing   │
  │                                         │
  │◄── Response + X-AID-PROVIDER-DID ───────│
  │    + X-AID-PROVIDER-PROOF               │
  │    + X-AID-RECEIPT                      │
  │                                         │
  │    Both parties now have:               │
  │    - Mutual authentication              │
  │    - Dual-signed receipt                │
  │    - Attestation for trust scoring      │
```

---

## 2. Identity

### 2.1 DID Method

AID uses the W3C `did:key` method with Ed25519 (multicodec `0xed`):

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

The public key is encoded directly in the DID using multibase base58btc with the Ed25519 multikey prefix (`0xed 0x01`). Identity is self-certifying: the DID encodes the public key, so verification requires no registry lookup.

### 2.2 Agent Identity Document

Every agent has an AID document containing:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://api.claw-net.org/contexts/aid/v1"
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
    "inputs": { "successRate": 0.95, "chainCoverage": 0.88, "attestationCount": 247, "manifestAdherence": 0.92 },
    "weights": { "successRate": 40, "chainCoverage": 25, "volume": 20, "manifestAdherence": 15 },
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

**Note on DID methods:** Agent identifiers use `did:key` (self-certifying, offline-verifiable). Platform issuers use `did:web` (resolvable, DNS-bound). Offline verification of agent identity requires only the `did:key` and the `proof.platformCountersignature`; the `did:web` issuer is used for trust chain bootstrapping when online.

### 2.3 Crypto-Agility

AID is algorithm-agile by design. The current reference implementation uses Ed25519 for signatures and SHA-384 for trust-layer hashing.

The protocol supports algorithm migration via versioned key types, enabling transition to NIST post-quantum signatures (ML-DSA, FIPS 204) without protocol-level changes. Hybrid Ed25519 + ML-DSA signatures are supported during the migration period.

**Requirements for implementers:**
- All AID documents MUST include `signatureAlgorithm`, `algorithmVersion`, and `hashAlgorithm` fields.
- Verifiers MUST read these fields and dispatch to the correct verification algorithm.
- Implementations MUST NOT hardcode `Ed25519` or `sha384` — always read from the document.

**Migration timeline (NIST IR 8547):**
- **Now:** Ed25519 + SHA-384
- **2027+:** Hybrid Ed25519 + ML-DSA (dual signatures, backwards compatible)
- **2030:** ML-DSA primary (Ed25519 deprecated by NIST)

---

## 3. Trust Scoring

### 3.1 Trust Score Formula (v1.0)

The canonical trust scoring formula uses 4 behavioral dimensions:

```
rawScore = successRate × 40 + chainCoverage × 25 + volume × 20 + manifestAdherence × 15
finalScore = min(100, round(rawScore × verificationMultiplier))
```

| Dimension | Weight | Range | Source |
|-----------|--------|-------|--------|
| `successRate` | 40% | 0–1 | `success_count / total_attestations` |
| `chainCoverage` | 25% | 0–1 | Fraction of attestations with valid hash-chain links |
| `volume` | 20% | 0–1 | `min(attestationCount / 1000, 1)` |
| `manifestAdherence` | 15% | 0–1 | `manifest_aligned / (aligned + unaligned)`, defaults to 0.5 if no manifests |

**Verification multiplier:** 1.0 (none) | 1.1 (partial) | 1.2 (full verification)

**Future extensions (Phase 3):** 7 additional dimensions across MARKET and COMMUNITY signal categories. These are not part of v1.0.

### 3.2 Proof Hash

Every trust score includes a cryptographic proof hash:

```
proofHash = SHA-384(JCS({inputs, weights, score}))
```

Where JCS is JSON Canonicalization Scheme (RFC 8785). Given identical inputs, every implementation MUST produce identical proof hashes. This enables independent verification using the open-source `@aidprotocol/trust-compute` library.

### 3.3 Trust Verdicts

| Score Range | Verdict | Settlement Mode | Pricing |
|-------------|---------|-----------------|---------|
| 0–19 | `new` | `immediate` | Base price |
| 20–39 | `building` | `immediate` | Base price |
| 40–59 | `caution` | `standard` | 10% discount |
| 60–79 | `standard` | `batched` | 20% discount |
| 80–89 | `trusted` | `batched` | 25% discount |
| 90+ AND verified AND 6mo AND $50 rev | `proceed` | `deferred` | 30% discount |

**`avoid` flag:** A separate manual flag applied by validators or triggered by structured reports. Not score-based — an agent can be score 70 and flagged `avoid`. Overrides all tiers to prepay-only.

### 3.4 Three-Layer Trust Lifecycle

```
MANIFEST (intent)  →  EXECUTION PROOF (evidence)  →  ATTESTATION (outcome)
     │                        │                            │
     │  "I will check         │  "I called CoinGecko ✓    │  "success, 3/3"
     │   3 sources"           │   Birdeye ✓ Jupiter ✓     │
     │                        │   230ms total"             │
     │  optional              │  automatic                 │  automatic
     │  (+15% trust bonus)    │  (step-level hashes)       │  (hash-chained, signed)
     └────────────────────────┴────────────────────────────┘
                    ALL feed into trust score
```

- **Manifest:** Optional pre-execution intent declaration. Agents with high manifest adherence earn the 15% `manifestAdherence` trust bonus.
- **Execution proof:** Automatic step-level evidence captured during execution. Each step is individually hashed (SHA-384) into `source_hashes_json`.
- **Attestation:** Automatic post-execution outcome record. HMAC-SHA384 signed, hash-chained to predecessor attestation, sequence-numbered for replay protection.

---

## 4. HTTP Headers

### 4.1 Request Headers (Client → Server)

| Header | Required | Description |
|--------|----------|-------------|
| `X-AID-DID` | Yes | Agent's DID (`did:key:z6Mk...`) |
| `X-AID-PROOF` | Yes | Ed25519 signature over canonical signing input (base64url) |
| `X-AID-TIMESTAMP` | Yes | ISO 8601 UTC timestamp (`2026-03-21T14:30:00Z`) |
| `X-AID-NONCE` | Yes | 16 random bytes, hex-encoded (anti-replay) |
| `X-AID-TRUST-SCORE` | No | Claimed score (hint only — server NEVER trusts this) |
| `X-AID-VERSION` | No | Protocol version (default: `1.0`) |

### 4.2 Response Headers (Server → Client)

| Header | Required | Description |
|--------|----------|-------------|
| `X-AID-PROVIDER-DID` | Yes | Server's DID for mutual authentication |
| `X-AID-PROVIDER-PROOF` | Yes | Server's Ed25519 countersignature |
| `X-AID-RECEIPT` | Yes | Base64-encoded portable atomic receipt |
| `X-AID-FEEDBACK-URL` | No | Outcome reporting endpoint for this receipt |

### 4.3 402 Response Headers

| Header | Description |
|--------|-------------|
| `PAYMENT-REQUIRED` | x402-compatible payment requirements |
| `X-AID-TRUST-GATE` | Minimum trust score and tier for this endpoint |
| `X-AID-PRICING-TIERS` | JSON array of trust → price mappings |

### 4.4 Canonical Signing Input

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
- Timestamps MUST be UTC with Z suffix. Timezone offsets MUST be rejected.
- Inner `SHA-384(requestBody)` is lowercase hex (96 chars) in the signing string.
- Nonce is 16 random bytes, hex-encoded (32 chars).
- Server rejects proofs with `|now - timestamp| > 300` seconds.
- Server tracks seen nonces for 5-minute window. Duplicate nonce → 409 Conflict.

---

## 5. Portable Atomic Receipts

Every AID transaction produces a dual-signed, Merkle-anchored receipt:

```json
{
  "protocol": "AID",
  "version": "1.0.0",
  "receiptId": "rcpt-a1b2c3d4e5f6g7h8",
  "timestamp": "2026-03-21T14:30:00Z",
  "hashAlgorithm": "sha384",
  "payer": {
    "did": "did:key:zABC...",
    "trustScore": 87,
    "signature": "ed25519:..."
  },
  "provider": {
    "did": "did:key:zXYZ...",
    "trustScore": 94,
    "signature": "ed25519:..."
  },
  "service": {
    "id": "sol-price-data",
    "type": "data_query",
    "inputHash": "sha384:1f2e...",
    "resultHash": "sha384:af3b..."
  },
  "trust": {
    "merkleRoot": "sha384:9c4d...",
    "merkleProof": ["..."],
    "snapshotId": "snap-xyz"
  },
  "proof": {
    "payerSignature": "ed25519:...",
    "providerSignature": "ed25519:...",
    "platformCountersignature": "ed25519:..."
  }
}
```

**Note:** Payment details (amount, currency, settlementMode, txHash) are protocol-specific and defined in the corresponding profile (e.g., AID-x402 Profile, Section 8.3). The receipt format above shows the trust-layer fields common to all profiles.

**Properties:**
- **Dual-signed:** Both payer and provider sign — mutual commitment.
- **Merkle-anchored:** Receipt hash included in periodic Merkle snapshots (rebuilt every 4 hours).
- **Content-addressed:** `inputHash` and `resultHash` prove what was requested/delivered without revealing the data.
- **Offline-verifiable:** Ed25519 signatures + Merkle proofs = pure math.
- **Portable:** Agent carries receipts to any platform as proof of track record.

---

## 6. Heartbeat Protocol

Every AID-compatible server MUST expose `GET /aid/heartbeat`:

```json
{
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
      { "minTrust": 0, "multiplier": 1.0, "settlement": "immediate" },
      { "minTrust": 40, "multiplier": 0.9, "settlement": "standard" },
      { "minTrust": 60, "multiplier": 0.8, "settlement": "batched" },
      { "minTrust": 80, "multiplier": 0.75, "settlement": "batched" },
      { "minTrust": 90, "multiplier": 0.7, "settlement": "deferred" }
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
  "timestamp": "2026-03-21T14:30:00Z"
}
```

**Authenticated heartbeat:** If the client includes `X-AID-DID` + `X-AID-PROOF`, the response additionally includes the consumer's trust score, pricing tier, and personalized alerts.

---

## 7. Security Properties

1. **HTTPS REQUIRED** — all AID endpoints MUST be served over TLS.
2. **TIMESTAMP VALIDATION** — signatures include current timestamp (±5 min window).
3. **BODY BINDING** — Ed25519 signature covers SHA-384 of request body.
4. **NONCE TRACKING** — 16-byte random nonces tracked for 5-min window. Duplicates rejected.
5. **KEY ROTATION** — compromised keys can be rotated without losing identity (DID is permanent).
6. **RATE LIMITING** — public endpoints rate-limited by IP.
7. **AUDIT TRAIL** — all AID operations produce signed attestations.
8. **FAIL-CLOSED** — middleware defaults to rejecting requests when trust cannot be verified.

### 7.1 Error Responses

Servers MUST return the following HTTP status codes for AID-specific failures:

| Status | Code | Condition |
|--------|------|-----------|
| 401 Unauthorized | `AID_SIGNATURE_INVALID` | `X-AID-PROOF` signature verification failed |
| 403 Forbidden | `AID_TRUST_GATE_BLOCKED` | Trust score below `X-AID-TRUST-GATE` minimum |
| 409 Conflict | `AID_NONCE_REPLAY` | `X-AID-NONCE` already seen within 5-minute window |
| 406 Not Acceptable | `AID_VERSION_UNSUPPORTED` | `X-AID-VERSION` not supported by server |
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
});

server.tool('get-data', { query: z.string() }, async (params, extra) => {
  const trust = aid.getCallerTrust(extra);
  // trust.score, trust.verdict, trust.discount available
  return { content: [{ type: 'text', text: 'result' }] };
});
```

**How it works:**
- Caller trust is resolved via `X-AID-DID` in MCP metadata or via ClawNet's trust API.
- Trust data is cached (default: 5 minutes) and available in every tool handler.
- Callers below `minTrustScore` are rejected with `AID_TRUST_GATE_BLOCKED`.
- Fail mode: `closed` (default) rejects on API failure; `open` allows with score 0.

**npm package:** `@aidprotocol/mcp-trust` (MIT license, published)

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
      "trustProof": "<Ed25519 signature from platform key>"
    }
  }
}
```

**Requirements:**
- `trustProof` MUST be an Ed25519 signature from the platform key over `SHA-384(did + trustScore + trustVerdict + trustTimestamp)`.
- Consumers MUST verify `trustProof` against the platform's public key (published at `/.well-known/aid-platform-key`).
- Trust data older than 24 hours SHOULD be re-fetched from the `heartbeatUrl`.

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
- **x402-compatible:** `PAYMENT-REQUIRED` and `PAYMENT-SIGNATURE` headers follow x402 spec exactly. AID headers are additive.

**Trust-gated pricing:** Agents with higher trust scores pay less for the same service. Pricing tiers are advertised in the heartbeat response and `X-AID-PRICING-TIERS` header.

---

## 9. Governance

### 9.1 Formula Versioning

The trust scoring formula is versioned. All middleware MUST pin to a specific formula version:

```typescript
// Middleware pins to formula version
server.use(aidTrust({
  formulaVersion: '1.0.0'  // MANDATORY
}));
```

Formula changes follow semantic versioning:
- **Patch (1.0.x):** Bug fixes, no output changes for valid inputs.
- **Minor (1.x.0):** New optional dimensions, existing scores unchanged.
- **Major (x.0.0):** Weight changes, dimension removal, score output changes.

### 9.2 Governance Model

- **Phase 1–2 (current):** Benevolent maintainer + advisory board. Formula changes published 30 days before activation.
- **Phase 3+:** Community governance. Formula proposals require public comment period + majority advisory vote.

The scoring algorithm is published as `@aidprotocol/trust-compute` (MIT license). Anyone can fork, audit, or run independently.

---

## 10. References

- W3C DID Core v1.1: https://www.w3.org/TR/did-core/
- W3C `did:key` Method: https://w3c-ccg.github.io/did-method-key/
- JSON Canonicalization Scheme (RFC 8785): https://www.rfc-editor.org/rfc/rfc8785
- DIF Trusted AI Agents Working Group: https://identity.foundation/working-groups/trusted-agents.html
- NIST FIPS 204 (ML-DSA): https://csrc.nist.gov/pubs/fips/204/final
- NIST IR 8547 (PQC Migration): https://csrc.nist.gov/pubs/ir/8547/final
- NIST SP 800-63-4: Digital Identity Guidelines
- NIST SP 800-207: Zero Trust Architecture
- SPIFFE Specification: https://spiffe.io/docs/latest/spiffe-about/overview/
- AID Trust Scoring Library: https://www.npmjs.com/package/@aidprotocol/trust-compute
- AID MCP Trust Middleware: https://www.npmjs.com/package/@aidprotocol/mcp-trust
- ERC-8004 (Agent Identity): https://eips.ethereum.org/EIPS/eip-8004
- x402 Protocol: https://github.com/coinbase/x402
