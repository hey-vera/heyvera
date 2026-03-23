# x402 Extension: `agent-trust`

> Transport-layer agent identity and trust scoring for x402 payments.

## Summary

This extension adds optional agent identity verification and trust scoring to x402 payment flows. Agents can prove their identity using DIDs, and servers can require minimum trust scores before accepting payments — enabling trust-gated pricing and counterparty verification.

## Motivation

x402 enables agent-to-agent payments, but currently provides no mechanism for agents to:

1. **Verify counterparty identity** — a paying agent has no way to prove *who* it is beyond its wallet address
2. **Assess counterparty trustworthiness** — a server has no signal about whether a paying agent is reliable, new, or potentially malicious
3. **Offer trust-based pricing** — servers cannot offer discounts to trusted agents or require deposits from new ones
4. **Provide mutual authentication** — clients cannot verify the server is who it claims to be

The `agent-trust` extension solves these by adding DID-based identity proofs and trust score exchange to the existing x402 payment flow.

## Specification

### Extension Key

`agent-trust`

### PaymentRequired (Server → Client)

The server advertises trust requirements in the 402 response:

```json
{
  "extensions": {
    "agent-trust": {
      "info": {
        "providerDid": "did:key:z6MkServer...",
        "minTrustScore": 50,
        "trustEndpoint": "https://api.example.com/v1/trust/:did",
        "pricingTiers": [
          { "minScore": 80, "discount": 0.15 },
          { "minScore": 50, "discount": 0.05 },
          { "minScore": 0, "discount": 0 }
        ],
        "supportedMethods": ["did:key"],
        "signatureAlgorithm": "Ed25519",
        "newAgentPolicy": {
          "maxCalls": 5,
          "maxValuePerCall": "0.01"
        }
      },
      "schema": {
        "type": "object",
        "properties": {
          "providerDid": { "type": "string" },
          "minTrustScore": { "type": "number", "minimum": 0, "maximum": 100 },
          "trustEndpoint": { "type": "string", "format": "uri" },
          "newAgentPolicy": {
            "type": "object",
            "description": "OPTIONAL. Server policy for cold-start agents with no trust history. Allows low-value first interactions without requiring a minimum trust score.",
            "properties": {
              "maxCalls": { "type": "integer", "description": "Max requests before trust score is required" },
              "maxValuePerCall": { "type": "string", "description": "Max USD value per call during trial period" }
            }
          },
          "pricingTiers": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "minScore": { "type": "number" },
                "discount": { "type": "number" }
              }
            }
          },
          "supportedMethods": { "type": "array", "items": { "type": "string" } },
          "signatureAlgorithm": { "type": "string" }
        },
        "required": ["providerDid", "supportedMethods", "signatureAlgorithm"],
        "description": "pricingTiers is OPTIONAL and informational — servers MAY use trust scores for internal pricing decisions without advertising tiers"
      }
    }
  }
}
```

### PaymentPayload (Client → Server)

The client includes its identity proof alongside the payment:

```json
{
  "extensions": {
    "agent-trust": {
      "did": "did:key:z6MkClient...",
      "proof": "base64url-encoded-Ed25519-signature",
      "timestamp": "2026-03-23T17:00:00Z",
      "nonce": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
    }
  }
}
```

**Proof construction:**

The client signs a canonical message using its DID's private key:

```
SHA-256(did + "\n" + timestamp + "\n" + nonce + "\n" + method + " " + path)
```

The server verifies the signature against the DID's public key (extractable from `did:key`).

### SettlementResponse (Server → Client)

The server returns its own identity proof for mutual authentication:

```json
{
  "extensions": {
    "agent-trust": {
      "providerDid": "did:key:z6MkServer...",
      "providerProof": "base64url-encoded-Ed25519-signature",
      "trustScore": 82,
      "trustVerified": true,
      "receiptId": "receipt-uuid"
    }
  }
}
```

## Trust Score

Trust scores are integers from 0 to 100, computed deterministically from:

- **Behavioral signals:** success rate, response latency, uptime
- **Attestation signals:** counterparty feedback, guardian endorsements
- **Manifest adherence:** does the agent do what it claims?

The trust computation algorithm MUST be deterministic — the same inputs always produce the same score. This enables independent verification by any party.

Trust scores MAY be resolved via the `trustEndpoint` advertised in `PaymentRequired`, or computed locally using a compatible scoring library.

## Security Considerations

1. **Replay protection:** The `nonce` MUST be unique per request, scoped per-provider (each server maintains its own nonce set). Servers MUST reject duplicate nonces within a configurable time window (recommended: 5 minutes). A global nonce registry is not required — per-provider scoping is sufficient and practical at scale.

2. **Timestamp validation:** The `timestamp` MUST be within ±5 minutes of the server's clock. Servers SHOULD reject stale timestamps.

3. **Trust score manipulation:** Servers SHOULD NOT rely solely on client-reported trust scores. Scores SHOULD be independently verified via the `trustEndpoint` or a local scoring library.

4. **DID method support:** This extension uses `did:key` (Ed25519) as the baseline. Servers MAY support additional DID methods. The `supportedMethods` field in `PaymentRequired` advertises which methods the server accepts.

5. **Crypto agility:** The `signatureAlgorithm` field allows migration to post-quantum algorithms (e.g., ML-DSA) without protocol changes.

## Compatibility

This extension is additive and backwards-compatible:

- Servers that don't support `agent-trust` simply omit it from `PaymentRequired`
- Clients that don't support `agent-trust` ignore it and pay normally
- The extension composes with other extensions (`reputation`, `sign-in-with-x`, etc.)

### ERC-8004 Interoperability

Agents registered on ERC-8004's Identity Registry can include their `agentId` in the trust payload:

```json
{
  "extensions": {
    "agent-trust": {
      "did": "did:key:z6Mk...",
      "proof": "...",
      "erc8004": { "chainId": 8453, "agentId": 36118 }
    }
  }
}
```

This enables cross-referencing between on-chain identity (ERC-8004) and transport-layer trust scoring.

## Reference Implementation

- **Scoring library:** [`@aidprotocol/trust-compute`](https://www.npmjs.com/package/@aidprotocol/trust-compute) v2.0.0 (npm, MIT license) — deterministic trust scoring, standalone, zero platform dependencies
- **MCP middleware:** [`@aidprotocol/mcp-trust`](https://www.npmjs.com/package/@aidprotocol/mcp-trust) v1.1.0 (npm, MIT license) — trust verification for MCP servers
- **Production deployment:** ClawNet (claw-net.org) — 12,000+ API endpoints with trust-gated pricing

## Authors

- Josh Fair (@1xmint)
