---
name: claw-net
description: Unified crypto/DeFi API with a growing library of AI skills and hundreds of data endpoints. Orchestrate multi-step agent workflows with natural language — prices, wallets, whales, yields, token analysis. Pay-per-query credits ($0.001 each). New skills and endpoints are added continuously and discoverable at runtime.
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

## Authentication

Some endpoints are public (no key needed), others require your API key:

| Auth | Endpoints |
|---|---|
| **None** | `GET /v1/marketplace/skills`, `GET /v1/skills/:id`, `GET /v1/registry`, `GET /v1/estimate`, `POST /v1/discover`, `GET /v1/stats` |
| **API key** | `POST /v1/orchestrate`, `POST /v1/batch`, `GET /v1/stream/orchestrate`, `POST /v1/skills/:id/invoke`, `GET /v1/skills/:id/query`, `GET /v1/balance` |

## Rate Limits

60 requests per minute per IP. If you receive a `429` status, back off and retry after a few seconds.

## Quick Start — Natural Language Query

The fastest way to get data. Just describe what you want:

```bash
curl -X POST https://api.claw-net.org/v1/orchestrate \
  -H "X-API-Key: $CLAWNET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the top trending Solana tokens right now?"}'
```

The response shape varies by query but always includes:
```json
{
  "requestId": "abc123",
  "answer": "Human-readable answer to your query...",
  "costBreakdown": { "creditsUsed": 8, "costUsd": 0.008 },
  "metadata": { "stepsExecuted": 3, "cacheHits": 1, "totalDurationMs": 1240 }
}
```

Depending on the query, the response may also include structured fields like `opportunityScore`, `riskScore`, `suggestedActions`, `data`, etc.

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
- **POST /v1/orchestrate** — Ask anything, get a structured answer. Auto-routes across all available endpoints and skills.
- **POST /v1/batch** — Up to 10 parallel queries in one call. Body: `{ "queries": ["query 1", "query 2", ...] }`.
- **GET /v1/stream/orchestrate?query=...** — SSE streaming response.
- **GET /v1/estimate?query=...** — Estimate cost before running (free, no auth needed).

### Discover Skills & Endpoints
The catalog changes over time. Always discover what's available before invoking:

- **GET /v1/marketplace/skills** — Browse all skills. Supports `?search=`, `?sort=popular`, `?tag=defi`. No auth needed.
- **GET /v1/skills/:id** — Get a skill's full details including `input_schema` (lists every accepted parameter), `credit_cost`, `skill_type`, and `output_schema`. No auth needed.
- **GET /v1/registry** — All raw API endpoints grouped by category. No auth needed.
- **POST /v1/discover** — Semantic search for skills by natural language description. No auth needed.
- **GET /v1/skills/:id/openapi** — OpenAPI 3.1 spec for any skill.
- **GET /v1/skills/:id/mcp** — MCP tool manifest for any skill.

### Invoke Skills
There are two types of skills. Check `skill_type` from `GET /v1/skills/:id` to know which:

**Data skills** (`skill_type: "data"`) — return raw structured JSON, no LLM involved:
```bash
# Step 1: Get the skill's input_schema to learn accepted params (no auth needed)
curl "https://api.claw-net.org/v1/skills/price-oracle-data"
# Response includes: input_schema.properties → { token: { type: "string" } }

# Step 2: Query with those params (auth required)
curl "https://api.claw-net.org/v1/skills/price-oracle-data/query?token=SOL" \
  -H "X-API-Key: $CLAWNET_API_KEY"
```

**Prompt skills** (`skill_type: "prompt_template"`) — use AI to analyze and synthesize:
```bash
# Step 1: Get the skill's input_schema to learn accepted params (no auth needed)
curl "https://api.claw-net.org/v1/skills/token-analysis"
# Response includes: input_schema.properties → { token: {...}, depth: { enum: ["quick","standard","deep"] } }

# Step 2: Invoke with those params (auth required)
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

1 credit = $0.001. Credits never expire. Purchase at https://claw-net.org/dashboard (Stripe or USDC/Solana).

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

| Code | Status | Meaning |
|---|---|---|
| `INSUFFICIENT_CREDITS` | 402 | Out of credits — purchase more at claw-net.org/dashboard |
| `INVALID_API_KEY` | 401 | Bad or missing API key |
| `RATE_LIMITED` | 429 | Too many requests — wait and retry |
| `SOURCE_ERROR` | 502 | Upstream data source failed — try a different query or param |

## Recommended Workflow for Agents

1. **Check balance** — `GET /v1/balance` to confirm you have credits
2. **Discover** — `GET /v1/marketplace/skills` or `POST /v1/discover` to find the right skill
3. **Read schema** — `GET /v1/skills/:id` to get `input_schema` and `credit_cost`
4. **Estimate** — `GET /v1/estimate?query=...` to preview the cost (free)
5. **Execute** — `POST /v1/orchestrate` for natural language, or invoke the skill directly
6. **Handle errors** — check `code` field, never retry on 402 (need more credits)

## Tips

- **Start with orchestrate** — it handles routing automatically. Only use specific skill endpoints when you need precise control.
- **Discover before invoking** — always call `GET /v1/skills/:id` first to read `input_schema`. Don't guess params.
- **Use cheapest strategy** — `"pricing": {"strategy": "cheapest"}` minimizes credit usage.
- **Data skills for structured data** — `/query` endpoints return raw JSON (faster, cheaper than orchestrate).
- **Batch queries** — `POST /v1/batch` runs up to 10 queries in parallel.
