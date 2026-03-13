---
name: clawnet
description: Query 344+ live crypto/DeFi data endpoints and 17 AI skills through one API. Orchestrate multi-step agent workflows with natural language — prices, wallets, whales, yields, token analysis. Pay-per-query credits ($0.001 each), 97% creator revenue share.
metadata:
  openclaw:
    requires:
      env:
        - CLAWNET_API_KEY
    primaryEnv: CLAWNET_API_KEY
---

# ClawNet

One API for crypto data and AI agent workflows. Ask anything about Solana tokens, wallets, whales, or DeFi — ClawNet plans, executes, and returns structured answers using real-time API calls.

## Setup

1. Get an API key at https://claw-net.org/dashboard
2. Set `CLAWNET_API_KEY` in your environment
3. All requests use header: `X-API-Key: YOUR_KEY`

Base URL: `https://api.claw-net.org`

## Quick Start — Natural Language Query

The fastest way to get data. Just describe what you want:

```bash
curl -X POST https://api.claw-net.org/v1/orchestrate \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the top trending Solana tokens right now?"}'
```

Response:
```json
{
  "answer": "BONK is leading volume with...",
  "opportunityScore": 72,
  "riskScore": 31,
  "suggestedActions": ["Monitor LP depth", "Watch whale wallet 7xK..."],
  "costBreakdown": { "creditsUsed": 8 },
  "metadata": { "stepsExecuted": 3, "cacheHits": 1 }
}
```

You can control cost and strategy:
```json
{
  "query": "Analyze SOL price action",
  "pricing": { "maxCredits": 5, "strategy": "cheapest" }
}
```

Strategies: `cheapest`, `balanced`, `fastest`, `reliable`.

## Core Endpoints

### Orchestrate (Natural Language)
- **POST /v1/orchestrate** — Ask anything, get a structured answer. Auto-routes across 344+ endpoints.
- **POST /v1/batch** — Up to 10 parallel queries in one call.
- **GET /v1/stream/orchestrate?query=...** — SSE streaming response.
- **GET /v1/estimate?query=...** — Estimate cost before running (free, no charge).

### Skills (Pre-built Tools)
- **GET /v1/marketplace/skills** — Browse all available skills. Supports `?search=`, `?sort=popular`, `?tag=defi`.
- **GET /v1/skills/:id** — Get skill details, input schema, pricing.
- **POST /v1/skills/:id/invoke** — Run a prompt-template skill.
- **GET /v1/skills/:id/query?params** — Query a data skill (structured JSON response).

### Data Skills (Real-Time Structured Data)
These return clean JSON — no LLM involved, just live data:

| Skill ID | What It Returns | Credits | Example Query |
|---|---|---|---|
| `price-oracle-data` | Token price, volume, market cap | 1 cr | `?token=SOL` |
| `trending-tokens-data` | Top trending tokens | 2 cr | `?chain=solana&limit=10` |
| `whale-tracker-data` | Large wallet movements | 2 cr | `?token=SOL&minUsd=50000` |
| `defi-yield-data` | DeFi yield rates | 2 cr | `?protocol=marinade` |
| `token-analysis-data` | On-chain token metrics | 2 cr | `?token=BONK` |
| `wallet-profiler-data` | Wallet holdings & history | 2 cr | `?address=7xK...` |
| `token-launch-data` | New token launches | 1 cr | `?chain=solana&period=24h` |

Example:
```bash
curl "https://api.claw-net.org/v1/skills/price-oracle-data/query?token=SOL" \
  -H "X-API-Key: $CLAWNET_API_KEY"
```

### AI Skills (LLM-Powered Analysis)
These use AI to analyze and synthesize:

| Skill ID | What It Does | Credits |
|---|---|---|
| `token-analysis` | Deep token analysis with risk/opportunity scoring | 5 cr |
| `social-sentiment` | Social media sentiment analysis | 3 cr |
| `portfolio-optimizer` | Portfolio optimization suggestions | 8 cr |
| `whale-tracker` | Whale movement analysis with context | 5 cr |
| `wallet-profiler` | Wallet behavior profiling | 6 cr |
| `trending-tokens` | Trending token discovery and ranking | 4 cr |
| `defi-yield-scanner` | DeFi yield opportunities across protocols | 5 cr |
| `token-launch-radar` | New token launch detection and analysis | 4 cr |
| `price-oracle` | Token price analysis and context | 3 cr |
| `nft-collection-intel` | NFT collection analysis | 5 cr |

Example:
```bash
curl -X POST https://api.claw-net.org/v1/skills/token-analysis/invoke \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"token": "SOL", "depth": "deep"}}'
```

### Account
- **GET /v1/balance** — Check your credit balance.
- **GET /v1/auth/me** — API key info, tier, usage stats.
- **GET /v1/auth/usage** — Detailed usage breakdown.

### Discovery
- **GET /v1/endpoints** — Search the full endpoint registry (344+ endpoints).
- **GET /v1/registry** — All endpoints grouped by category.
- **POST /v1/discover** — Semantic search for skills by description.
- **GET /v1/skills/:id/openapi** — OpenAPI 3.1 spec for any skill.
- **GET /v1/skills/:id/mcp** — MCP tool manifest for any skill.

## Pricing

1 credit = $0.001. Credits never expire.

- **Data skill queries:** 1–2 credits per call (cached responses cost 90% less)
- **AI skill invocations:** 3–8 credits per call (see tables above for exact pricing)
- **Orchestrated queries:** varies by complexity + 2 credit orchestration fee
- **Cost estimate:** Always free via `GET /v1/estimate?query=...`

## Error Handling

All errors return a consistent shape:
```json
{
  "error": "Description of what went wrong",
  "code": "SNAKE_CASE_CODE",
  "creditsCharged": 0,
  "hint": "Actionable suggestion to fix the issue"
}
```

Common codes: `INSUFFICIENT_CREDITS` (402), `INVALID_API_KEY` (401), `RATE_LIMITED` (429), `SOURCE_ERROR` (502).

## Tips for Agents

1. **Start with orchestrate** — it handles routing automatically. Only use specific skill endpoints when you need precise control.
2. **Use estimates first** — `GET /v1/estimate` is free and tells you the cost before committing.
3. **Check balance** — `GET /v1/balance` before expensive operations.
4. **Use cheapest strategy** — `"pricing": {"strategy": "cheapest"}` minimizes credit usage.
5. **Data skills for structured data** — Use `/query` endpoints when you need raw JSON (faster, cheaper than orchestrate).
6. **Browse available skills** — `GET /v1/marketplace/skills` to discover what's available. This list updates automatically as new skills are added.
7. **Batch queries** — Use `POST /v1/batch` to run up to 10 queries in parallel.
