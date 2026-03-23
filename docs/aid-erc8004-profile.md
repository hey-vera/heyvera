# AID–ERC-8004 Integration Profile

> How AID trust scoring composes with ERC-8004 on-chain agent identity.

## Overview

ERC-8004 provides on-chain agent identity (ERC-721 NFTs), basic reputation (feedback ratings), and validation registries on EVM chains. AID provides transport-layer trust scoring with behavioral analysis, divergence detection, and cryptographic verification.

They operate at different layers and complement each other:

| Layer | ERC-8004 | AID |
|-------|----------|-----|
| **Identity** | On-chain ERC-721 NFT (agentId) | Off-chain DID (`did:key`, Ed25519) |
| **Discovery** | Agent cards with service endpoints | Trust endpoint (`/v1/aid/:did/trust`) |
| **Reputation** | Feedback ratings (accuracy, timeliness, reliability) | Weighted behavioral trust score (0-100, 4 dimensions: successRate, chainCoverage, volume, manifestAdherence) |
| **Validation** | TEE attestation (planned) | Manifest-attestation divergence detection |
| **Chain** | EVM-native (Base, Ethereum) | Transport-agnostic (works on any chain or no chain) |

An agent can have both: an ERC-8004 identity for on-chain discovery and basic feedback, plus an AID identity for deep trust scoring and transport-layer verification.

## Architecture

```
┌─────────────────────────────────────────┐
│            Agent Commerce               │
├─────────────────────────────────────────┤
│  AID Trust Layer                        │
│  - Behavioral scoring (0-100)           │
│  - Divergence detection                 │
│  - Anti-collusion analysis              │
│  - Mutual authentication                │
│  - Transport-layer proofs (Ed25519)     │
├─────────────────────────────────────────┤
│  ERC-8004 Identity Layer                │
│  - On-chain ERC-721 agent NFT           │
│  - Agent card (services, capabilities)  │
│  - Feedback ratings                     │
│  - Wallet binding                       │
├─────────────────────────────────────────┤
│  x402 Payment Layer                     │
│  - HTTP 402 payment flow                │
│  - EVM + Solana settlement              │
│  - Facilitator verification             │
└─────────────────────────────────────────┘
```

## Integration Points

### 1. Agent Card → AID Endpoint

An ERC-8004 agent card includes AID as a service endpoint:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Example Agent",
  "services": [
    { "name": "A2A", "endpoint": "https://agent.example/.well-known/agent-card.json" },
    { "name": "AID", "endpoint": "https://agent.example/v1/aid", "version": "1.0.0" }
  ]
}
```

Any ERC-8004 consumer can discover the agent's AID trust endpoint from the agent card.

### 2. AID Document → ERC-8004 Link

An AID document MAY reference its ERC-8004 on-chain identity via an optional `linkedIdentities` extension field (proposed addition to the AID manifest schema):

```json
{
  "id": "did:key:z6MkAgent...",
  "linkedIdentities": {
    "erc8004": {
      "chainId": 8453,
      "agentId": 36118,
      "registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    }
  }
}
```

> Note: `linkedIdentities` is a proposed extension, not yet in the core AID spec.

### 3. ERC-8004 Reputation ← AID Trust Scores

AID trust scores can be published to ERC-8004's Reputation Registry:

```solidity
// Submit AID trust score as ERC-8004 reputation entry
reputationRegistry.submit(
    agentId,           // ERC-8004 agent ID
    "aid-trust-score", // feedback type
    trustScoreURI      // URI to the full AID trust computation
);
```

The Reputation Registry stores the URI; the AID trust computation is verifiable by any party using `@aidprotocol/trust-compute`.

### 4. x402 Payment Flow

During an x402 payment, both layers can be active:

```
Client                          Server
  │                               │
  │──── GET /resource ──────────→ │
  │                               │
  │←── 402 PaymentRequired ────── │
  │    extensions:                │
  │      agent-trust:             │  ← AID trust requirements
  │        minTrustScore: 50      │
  │        providerDid: did:key:… │
  │      reputation:              │  ← ERC-8004 reputation
  │        agentId: 36119         │
  │                               │
  │──── Payment + AID proof ───→  │
  │    extensions:                │
  │      agent-trust:             │
  │        did: did:key:z6Mk…     │
  │        proof: base64url(sig)  │
  │        erc8004:               │
  │          agentId: 42          │  ← Client's ERC-8004 ID
  │                               │
  │←── 200 + mutual auth ──────  │
  │    extensions:                │
  │      agent-trust:             │
  │        trustScore: 82         │  ← AID score
  │        providerProof: …       │  ← Mutual auth
  │      reputation:              │
  │        receiptURI: ipfs://…   │  ← ERC-8004 receipt
```

## What AID Adds to ERC-8004

ERC-8004's Reputation Registry provides basic feedback aggregation. AID adds:

| Capability | ERC-8004 Reputation | AID Trust Scoring |
|------------|--------------------|--------------------|
| Feedback collection | Structured ratings (accuracy, timeliness, reliability) | Weighted multi-dimensional (4 dimensions: success rate 40%, chain coverage 25%, volume 20%, manifest adherence 15%) |
| Score computation | Off-chain indexer aggregation | Deterministic algorithm (independently verifiable) |
| Temporal weighting | None | Exponential decay (recent behavior weighted more) |
| Collusion detection | None | Clique detection, burst detection, reciprocity analysis |
| Manifest verification | None | Divergence scoring (does agent do what it claims?) |
| Sybil resistance | None | Issuer diversity requirements, guardian system |
| Mutual authentication | None | Ed25519 server proofs on every response |
| Crypto agility | Tied to EVM signatures | Ed25519 → ML-DSA migration without protocol change |

## Packages

```bash
# Trust scoring (MIT, standalone, no dependencies on ClawNet)
npm install @aidprotocol/trust-compute

# x402 middleware with trust verification
npm install @aidprotocol/x402-enhanced

# Framework middleware (Express, Fastify, Hono)
npm install @aidprotocol/middleware
```

## On-Chain Registrations

| Entity | Chain | Registry | Agent ID |
|--------|-------|----------|----------|
| AID Protocol | Base (8453) | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 | 36118 |
| ClawNet | Base (8453) | 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 | 36119 |

## Standards Alignment

| Body | Status |
|------|--------|
| ERC-8004 | Compatible (registered, agent IDs 36118 + 36119) |
| W3C | Aligned (did:key, VC 2.0, Bitstring Status List) |
| IETF | Aligned (RFC 9421 HTTP Signatures, RFC 8785 JCS) |
| DIF | TAAWG membership pending |
| NIST | NCCoE comment submitted (AI Agent Standards Initiative) |

## License

AID Protocol specification: Apache 2.0
@aidprotocol/trust-compute: MIT
