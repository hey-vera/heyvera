---
name: claw-net
description: AI agent orchestration with 13,000+ API endpoints (274 built-in + auto-discovered via 402index, clawapis, ag0, zauth), 4 crypto data skills, Soma-verified execution, and x402 micropayments. Ask anything in natural language — get provenance-backed answers. Pay-per-query credits ($0.001 each). Wallet auth (SIWX) or API key. ERC-8004 on-chain identity.
metadata:
  homepage: https://claw-net.org
  source: https://github.com/1xmint/claw-net
  soma: https://api.claw-net.org/.well-known/soma.json
  erc8004:
    chain: base
    agentId: 36119
    soma_agentId: 37696
  openclaw:
    requires:
      env:
        - CLAWNET_API_KEY
    primaryEnv: CLAWNET_API_KEY
  tags:
    - orchestration
    - x402
    - soma
    - identity
    - provenance
    - data-skills
---

# ClawNet

Ask anything. Get verified answers from 13,000+ data sources. Crypto prices, social data, market intelligence — one query, one answer. Every response includes cryptographic provenance via [Soma](https://github.com/1xmint/Soma).

## Setup

1. Get an API key at https://claw-net.org/dashboard (or connect a wallet — no key needed)
2. Set `CLAWNET_API_KEY` in your environment
3. Base URL: `https://api.claw-net.org`

## Quick Start

```bash
curl -X POST https://api.claw-net.org/v1/orchestrate \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the price of SOL right now?"}'
```

Response includes provenance headers automatically:
```
X-Soma-Protocol: soma/1.0
X-Soma-Data-Hash: a1b2c3...
X-Soma-Signature: <ed25519>
X-Soma-Heartbeat-Index: 42
X-Soma-Genome-Hash: d4e5f6...
```

```json
{
  "answer": "SOL is currently trading at ...",
  "costBreakdown": { "creditsUsed": 8, "costUsd": 0.008 },
  "provenance": {
    "protocol": "soma",
    "certificates": [...],
    "heartDid": "...",
    "discovery": "/.well-known/soma.json"
  }
}
```

## Data Skills (4 built-in)

Structured JSON data — no LLM, fast, cheap:

| Skill | Cost | What it returns |
|---|---|---|
| `price-oracle-data` | 1 credit | Real-time price, 24h change, volume, market cap |
| `trending-tokens-data` | 2 credits | Top trending tokens by volume/social buzz |
| `whale-tracker-data` | 2 credits | Whale movements, holder changes, net flow |
| `defi-yield-data` | 2 credits | DeFi yield opportunities, APY, TVL, risk tier |

```bash
# Query a data skill
curl "https://api.claw-net.org/v1/skills/price-oracle-data/query?token=SOL" \
  -H "X-API-Key: $CLAWNET_API_KEY"
```

## Soma — Cryptographic Provenance

Every response includes birth certificates (data hash + Ed25519 signature + heartbeat chain entry) proving what data was fetched and from where. No extra steps needed — provenance is automatic.

**Discovery:** `GET /.well-known/soma.json` — genome commitment, heartbeat chain status, public key, ERC-8004 reference.

**Verification verdicts:** Independent observers running [soma-sense](https://www.npmjs.com/package/soma-sense) can verify ClawNet's model usage. Verdicts are anchored on-chain via Merkle trees.

**Public trust API:** `GET /v1/soma/:did/trust` — free, no auth, rate-limited. Returns verification history for any agent.

**On-chain identity:** ERC-8004 on Base Mainnet — ClawNet (agentId [36119](https://basescan.org/nft/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/36119)), Soma protocol (agentId [37696](https://basescan.org/nft/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/37696)).

## Manifest — Verify Data Before Acting

Cross-reference any data against independent sources. Check reasoning. Pre-flight actions.

```bash
curl -X POST https://api.claw-net.org/v1/manifest \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "standard",
    "verify": {
      "claims": [{ "type": "price", "subject": "SOL", "value": 150.00 }]
    }
  }'
```

Tiers: `quick` (0.5cr), `standard` (2cr), `deep` (5cr).

## Core Endpoints

| Endpoint | Auth | Cost | Description |
|---|---|---|---|
| `POST /v1/orchestrate` | Key | 2cr+ | Natural language query across 13,000+ sources |
| `GET /v1/skills/:id/query` | Key | 1-2cr | Query a data skill (structured JSON) |
| `POST /v1/manifest` | Key | 0.5-5cr | Verify data, assess reasoning, pre-flight |
| `GET /v1/soma/:did/trust` | None | Free | Soma verification history (public) |
| `GET /v1/soma/:did/verdicts` | None | Free | Recent verdicts for an agent |
| `GET /v1/marketplace/skills` | None | Free | Browse skill catalog |
| `GET /v1/skills/:id` | None | Free | Skill details + input schema |
| `POST /v1/discover` | None | Free | Semantic search for skills |
| `GET /v1/estimate?query=...` | None | Free | Cost estimate before running |
| `GET /v1/balance` | Key | Free | Check credit balance |
| `GET /.well-known/soma.json` | None | Free | Soma identity + provenance discovery |

## Endpoint Discovery

ClawNet auto-discovers endpoints from 7 sources every 4 hours:

| Source | What |
|---|---|
| Built-in registry | 274 hardcoded, curated endpoints |
| [ClawAPIs](https://clawapis.com) | Dynamic provider discovery |
| [402index](https://402index.io) | Community x402 directory (15k+) |
| [Coinbase Bazaar](https://cdp.coinbase.com) | Official x402 facilitator discovery |
| [Zauth](https://zauthx402.com) | Pre-verified x402 endpoints (only WORKING status) |
| [Dexter](https://x402.dexter.cash) | x402 facilitator marketplace |
| [x402list](https://x402list.fun) | Services directory (17k+) |

All discovered endpoints are indexed, classified, and available to the orchestration engine automatically.

## x402 (Pay with USDC)

All endpoints also available via x402 protocol — pay per call with USDC on Base, no API key needed. Every x402 response includes `X-Soma-*` provenance headers.

```bash
# Requires x402-compatible wallet
POST https://api.claw-net.org/x402/orchestrate
POST https://api.claw-net.org/x402/skills/{id}
POST https://api.claw-net.org/x402/query/{id}
```

## Pricing

1 credit = $0.001. Credits never expire. Buy at https://claw-net.org (Stripe or USDC).

## Error Codes

| Code | Status | Meaning |
|---|---|---|
| `INSUFFICIENT_CREDITS` | 402 | Out of credits |
| `INVALID_API_KEY` | 401 | Bad or missing key |
| `RATE_LIMITED` | 429 | Too many requests |
| `SOURCE_ERROR` | 502 | Upstream API failed |

## Recommended Workflow

1. `GET /v1/balance` — confirm you have credits
2. `GET /v1/marketplace/skills` — find the right skill
3. `GET /v1/skills/:id` — read input schema
4. `GET /v1/estimate?query=...` — preview cost (free)
5. `POST /v1/orchestrate` — ask your question (provenance included automatically)
6. `POST /v1/manifest` — verify the answer if needed
7. Check `X-Soma-*` response headers or `provenance` field for cryptographic proof
