---
name: claw-net
description: Query 344+ live crypto/DeFi data endpoints and a growing library of AI skills through one API. Orchestrate multi-step agent workflows with natural language — prices, wallets, whales, yields, token analysis. Pay-per-query credits ($0.001 each). New skills and endpoints are added continuously and discoverable at runtime.
metadata:
  openclaw:
    requires:
      env:
        - CLAWNET_API_KEY
    primaryEnv: CLAWNET_API_KEY
---

# ClawNet

One API for crypto data and AI agent workflows. Ask anything about Solana tokens, wallets, whales, or DeFi — ClawNet plans, executes, and returns structured answers using real-time API calls.

The skill and endpoint catalog grows continuously. Always discover what's available at runtime rather than relying on hardcoded lists.

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
- **POST /v1/orchestrate** — Ask anything, get a structured answer. Auto-routes across all available endpoints.
- **POST /v1/batch** — Up to 10 parallel queries in one call.
- **GET /v1/stream/orchestrate?query=...** — SSE streaming response.
- **GET /v1/estimate?query=...** — Estimate cost before running (free, no charge).

### Discover Skills & Endpoints
The catalog changes over time. Always discover what's available before invoking:

- **GET /v1/marketplace/skills** — Browse all skills. Supports `?search=`, `?sort=popular`, `?tag=defi`.
- **GET /v1/skills/:id** — Get a skill's full details including `input_schema` (lists every accepted parameter), `credit_cost`, `skill_type`, and `output_schema`.
- **GET /v1/registry** — All raw API endpoints grouped by category.
- **POST /v1/discover** — Semantic search for skills by natural language description.
- **GET /v1/skills/:id/openapi** — OpenAPI 3.1 spec for any skill.
- **GET /v1/skills/:id/mcp** — MCP tool manifest for any skill.

### Invoke Skills
There are two types of skills. Check `skill_type` from `GET /v1/skills/:id` to know which:

**Data skills** (`skill_type: "data"`) — return raw structured JSON, no LLM involved:
```bash
# Step 1: Get the skill's input_schema to learn accepted params
curl "https://api.claw-net.org/v1/skills/price-oracle-data" \
  -H "X-API-Key: $CLAWNET_API_KEY"
# Response includes: input_schema.properties → { token: { type: "string" } }

# Step 2: Query with those params
curl "https://api.claw-net.org/v1/skills/price-oracle-data/query?token=SOL" \
  -H "X-API-Key: $CLAWNET_API_KEY"
```

**Prompt skills** (`skill_type: "prompt_template"`) — use AI to analyze and synthesize:
```bash
# Step 1: Get the skill's input_schema to learn accepted params
curl "https://api.claw-net.org/v1/skills/token-analysis" \
  -H "X-API-Key: $CLAWNET_API_KEY"
# Response includes: input_schema.properties → { token: {...}, depth: { enum: ["quick","standard","deep"] } }

# Step 2: Invoke with those params
curl -X POST "https://api.claw-net.org/v1/skills/token-analysis/invoke" \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"token": "SOL", "depth": "deep"}}'
```

### Account
- **GET /v1/balance** — Check your credit balance.
- **GET /v1/auth/me** — API key info, tier, usage stats.
- **GET /v1/auth/usage** — Detailed usage breakdown.

## Pricing

1 credit = $0.001. Credits never expire.

- **Skill costs** vary per skill — check `credit_cost` from `GET /v1/skills/:id`
- **Cached responses** cost up to 90% less than live calls
- **Orchestrated queries** vary by complexity + 2 credit orchestration fee
- **Cost estimate** always free via `GET /v1/estimate?query=...`

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
2. **Discover before invoking** — always call `GET /v1/skills/:id` first to read `input_schema` for accepted parameters. Don't guess params.
3. **Use estimates first** — `GET /v1/estimate` is free and tells you the cost before committing.
4. **Check balance** — `GET /v1/balance` before expensive operations.
5. **Use cheapest strategy** — `"pricing": {"strategy": "cheapest"}` minimizes credit usage.
6. **Data skills for structured data** — Use `/query` endpoints when you need raw JSON (faster, cheaper than orchestrate).
7. **Browse for new skills** — `GET /v1/marketplace/skills` returns the live catalog. New skills are added regularly.
8. **Batch queries** — Use `POST /v1/batch` to run up to 10 queries in parallel.
