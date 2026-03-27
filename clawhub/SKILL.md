---
name: claw-net
description: AI agent orchestration with 12,000+ API endpoints, 4 crypto data skills, Manifest verification, and Attestation proofs. Ask anything in natural language — get verified answers. Pay-per-query credits ($0.001 each). Wallet auth (SIWX) or API key.
metadata:
  homepage: https://claw-net.org
  source: https://github.com/1xmint/claw-net
  openclaw:
    requires:
      env:
        - CLAWNET_API_KEY
    primaryEnv: CLAWNET_API_KEY
---

# ClawNet

Ask anything. Get verified answers from 12,000+ data sources. Crypto prices, social data, market intelligence — one query, one answer.

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

Response:
```json
{
  "answer": "SOL is currently $142.57, up 3.2% in 24h...",
  "costBreakdown": { "creditsUsed": 8, "costUsd": 0.008 },
  "metadata": { "stepsExecuted": 3, "totalDurationMs": 1240 }
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

## Manifest — Verify Data Before Acting

Cross-reference any data against independent sources. Check reasoning. Pre-flight actions.

```bash
curl -X POST https://api.claw-net.org/v1/manifest \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "standard",
    "verify": {
      "claims": [{ "type": "price", "subject": "SOL", "value": 142.57 }]
    }
  }'
```

Tiers: `quick` (0.5cr), `standard` (2cr), `deep` (5cr).

## Attestation — Prove What Your Agent Did

Every action creates a signed, tamper-proof record. W3C Verifiable Credential format. On-chain Merkle anchoring.

```bash
# Create attestation (0.25 credits)
curl -X POST https://api.claw-net.org/v1/attest \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action_type": "swap", "input_data": "...", "outcome": "success"}'

# Verify (free, no auth)
curl https://api.claw-net.org/v1/attest/verify/att-abc123

# W3C VC format (free, no auth)
curl https://api.claw-net.org/v1/attest/verify/att-abc123?format=vc
```

## Core Endpoints

| Endpoint | Auth | Cost | Description |
|---|---|---|---|
| `POST /v1/orchestrate` | Key | 2cr+ | Natural language query across 12K+ sources |
| `GET /v1/skills/:id/query` | Key | 1-2cr | Query a data skill (structured JSON) |
| `POST /v1/manifest` | Key | 0.5-5cr | Verify data, assess reasoning, pre-flight actions |
| `POST /v1/attest` | Key | 0.25cr | Create signed attestation |
| `GET /v1/attest/verify/:id` | None | Free | Verify attestation (public) |
| `GET /v1/marketplace/skills` | None | Free | Browse skill catalog |
| `GET /v1/skills/:id` | None | Free | Skill details + input schema |
| `POST /v1/discover` | None | Free | Semantic search for skills |
| `GET /v1/estimate?query=...` | None | Free | Cost estimate before running |
| `GET /v1/balance` | Key | Free | Check credit balance |

## x402 (Pay with USDC)

All endpoints also available via x402 protocol — pay per call with USDC on Base, no API key needed:

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
5. `POST /v1/orchestrate` — ask your question
6. `POST /v1/manifest` — verify the answer if needed
