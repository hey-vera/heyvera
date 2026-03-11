# ClawNet

**Sovereign AI Agent Orchestration — powered by x402 & ClawAPIs**

ClawNet is an intelligent API orchestration layer that turns natural language queries into multi-step agent workflows. Ask it anything about Solana tokens, wallets, sentiment, or on-chain data — it plans, executes, and synthesizes an answer using real-time API calls.

Built as the reference implementation for [x402](https://x402.org) micropayment-gated AI services and the backbone of the [OpenClaw](https://openclaw.io) skill ecosystem.

---

## Quick Start

```bash
curl -X POST https://api.claw-net.org/v1/orchestrate \
  -H "X-API-Key: cn-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the top trending Solana tokens right now?"}'
```

```json
{
  "requestId": "abc123",
  "answer": "BONK is leading volume with...",
  "opportunityScore": 72,
  "riskScore": 31,
  "suggestedActions": ["Monitor LP depth", "Watch whale wallet 7xK..."],
  "costBreakdown": { "costUsd": 0.004, "creditsUsed": 8 },
  "metadata": { "stepsExecuted": 3, "cacheHits": 1, "totalDurationMs": 1240 }
}
```

Get a key at [claw-net.org](https://claw-net.org). Full OpenAPI spec at `GET /v1/openapi.json`.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript + [Hono](https://hono.dev) |
| Database | SQLite via `better-sqlite3` (WAL mode, no ORM) |
| Cache | Redis (L2) + in-memory (L1) |
| Auth | [Clerk](https://clerk.com) (dashboard JWT) + API key (orchestration) |
| Payments | Stripe + USDC/Solana + x402 (Base/Solana) |
| P2P | libp2p (Kademlia DHT, TCP, Noise, Yamux) |
| LLM | Anthropic Claude / OpenAI (two-model: fast intent + smart synthesis) |
| Email | Resend |
| Monitoring | Sentry (optional), Pino structured logging |
| CI | GitHub Actions (typecheck + 48 Vitest unit tests) |

**Critical stack rules:**
| Use | NOT |
|---|---|
| `Hono` | Fastify |
| `npm` | pnpm |
| `better-sqlite3` raw SQL | Drizzle/any ORM |
| Single flat repo | Turborepo/monorepo |
| Plain HTML (`site/`) | Vite/React SPA |
| Clerk + Phantom | Reown AppKit |
| `libp2p` + `@chainsafe/libp2p-yamux` | `@libp2p/node` (doesn't exist) |

---

## Architecture

```
Request → Rate Limit (60/min/IP) → Auth (X-API-Key or Clerk JWT)
                                        ↓
                              Intent Parser (fast LLM or regex template)
                                        ↓
                              Execution Plan (parallel groups)
                                        ↓
                    ClawAPIs (163 endpoints, x402 micropayments) ← Circuit Breaker
                                        ↓
                              Response Synthesis (smart LLM) + Cache
                                        ↓
                              Signed Response → Client
```

---

## API Reference

All protected endpoints require `X-API-Key: cn-your-key` header.

### Core Orchestration

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/orchestrate` | API key | Natural language → multi-step execution |
| `POST` | `/v1/batch` | API key | Up to 10 parallel queries |
| `GET` | `/v1/stream/orchestrate?query=` | API key | SSE streaming orchestration |
| `GET` | `/v1/estimate?query=` | None | Estimate credit cost (no charge) |
| `GET` | `/v1/balance` | API key | Check credit balance |

### Skills

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/skills` | API key | Create a skill |
| `GET` | `/v1/skills` | None | Browse public skills (paginated) |
| `GET` | `/v1/skills/mine` | API key | Your skills |
| `GET` | `/v1/skills/:id` | None | Skill details |
| `POST` | `/v1/skills/:id/invoke` | API key | Execute a skill |
| `POST` | `/v1/skills/:id/test` | API key | Owner-only dry run (free) |
| `POST` | `/v1/skills/:id/fork` | API key | Fork as A/B challenger |
| `PATCH` | `/v1/skills/:id/visibility` | API key | Publish/unpublish |
| `DELETE` | `/v1/skills/:id` | API key | Delete a skill |

### Marketplace

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/marketplace/skills` | None | Browse marketplace (search, sort, filter) |
| `GET` | `/v1/marketplace/skills/:id` | None | Skill detail + ratings |
| `POST` | `/v1/marketplace/skills/:id/purchase` | API key | Purchase + execute |
| `POST` | `/v1/marketplace/skills/:id/rate` | API key | Rate (verified buyers only) |
| `POST` | `/v1/marketplace/stake` | API key | Stake credits on a skill |
| `GET` | `/v1/marketplace/creator/stats` | API key | Creator earnings dashboard |
| `POST` | `/v1/marketplace/creator/withdraw` | API key | Request credit withdrawal |

### Tasks

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/tasks` | API key | Submit async skill task (webhook support) |
| `GET` | `/v1/tasks` | API key | List your tasks |
| `GET` | `/v1/tasks/:id` | API key | Task status + result |
| `POST` | `/v1/tasks/:id/cancel` | API key | Cancel pending task |
| `POST` | `/v1/tasks/:id/rate` | API key | Rate a completed task |

### Account & Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/auth/me` | API key | Key info, tier, usage |
| `GET` | `/v1/auth/usage` | API key | Usage breakdown |
| `GET` | `/v1/auth/estimate?skillId=` | API key | Estimate skill cost |
| `GET` | `/v1/dashboard/me` | Clerk JWT | Account info + masked key |
| `POST` | `/v1/dashboard/reveal-key` | Clerk JWT | Get full API key |
| `POST` | `/v1/dashboard/regenerate-key` | Clerk JWT | Rotate key (keeps credits) |
| `POST` | `/v1/dashboard/billing-portal` | Clerk JWT | Stripe billing portal |

### Discovery & Registry

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/registry` | None | All 163 endpoints by category |
| `GET` | `/v1/registry/health` | None | Endpoint health status |
| `POST` | `/v1/discover` | None | Semantic skill search (embedding similarity) |
| `GET` | `/v1/mesh/peers` | None | P2P mesh network peers |

### Governance

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/governance/proposals` | None | List proposals (filter by status) |
| `POST` | `/v1/governance/propose` | API key | Create proposal (100+ credits) |
| `POST` | `/v1/governance/proposals/:id/vote` | API key | Vote FOR/AGAINST |

### Other

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/openclaw/invoke` | API key | OpenClaw universal gateway (query/skill/discover/swarm) |
| `POST` | `/v1/swarm/task` | API key | Multi-skill swarm (async) |
| `GET` | `/v1/llm/models` | None | Available LLM models |
| `POST` | `/v1/llm/chat` | API key | LLM proxy (OpenAI-compatible) |
| `POST` | `/v1/contact` | Clerk JWT | Contact form |
| `POST` | `/v1/feedback` | None | Query rating feedback |
| `GET` | `/v1/openapi.json` | None | OpenAPI 3.0 spec |
| `GET` | `/health` | None | Health check |
| `GET` | `/v1/stats` | None | Public platform stats |

### Payments

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/webhooks/stripe` | Stripe sig | One-time purchase webhook |
| `POST` | `/v1/webhooks/stripe-subscriptions` | Stripe sig | Subscription webhook |
| `POST` | `/v1/solana/verify` | Clerk JWT | USDC on-chain payment verify |
| `GET` | `/v1/solana/packages` | Clerk JWT | USDC package list |
| `POST` | `/v1/solana/build-tx` | Clerk JWT | Build unsigned USDC transfer |
| `GET` | `/v1/session/:sessionId` | None | Retrieve key after Stripe checkout |
| `POST` | `/v1/resend-key` | None | Resend API key to email |

---

## Credits & Pricing

1 credit ≈ $0.001. Credits never expire.

| Package | Price | Credits | Bonus |
|---|---|---|---|
| Starter | $5 | 5,000 | — |
| Builder | $20 | 21,000 | +5% |
| Pro | $50 | 54,000 | +8% |
| Growth | $100 | 112,000 | +12% |
| Scale | $500 | 600,000 | +20% |
| Enterprise | $1,000 | 1,300,000 | +30% |
| Scout (sub) | $29/mo | 40,000/mo | — |

**USDC/Solana payments** receive +7% bonus on all tiers.

Revenue share on skills: **97% to creator**, 3% platform fee.

---

## Self-Hosting

```bash
git clone https://github.com/your-org/claw-net
cd claw-net
npm install
cp .env.example .env  # fill in values
npm run dev            # development
npm run mcp            # MCP server for Claude Code/Cursor
npm run test:unit      # 48 unit tests
```

### Required Environment Variables

```
PORT=3402
NODE_ENV=production
LLM_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
OPENAI_INTENT_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=
CLAWAPIS_BASE_URL=https://clawapis.com
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=
RESEND_FROM=noreply@claw-net.org
CLERK_SECRET_KEY=sk_...
SOLANA_RECEIVING_WALLET=
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
ADMIN_API_KEY=           # min 16 chars, required in production
PLATFORM_SIGNING_SECRET= # 32-byte hex for response HMAC signing
```

### Optional

```
SOLANA_PRIVATE_KEY=      # enables x402 API calls, disables simulation mode
EVM_PRIVATE_KEY=         # Base/EVM wallet for x402 payments
X402_RECIPIENT_ADDRESS=  # enables x402 provider mode
TELEGRAM_BOT_TOKEN=      # Telegram intelligence bot
TELEGRAM_CHANNEL_ID=
ADMIN_EMAIL=
SENTRY_DSN=
FREE_TRIAL_CREDITS=0
DAILY_SPEND_CAP=0        # 0=disabled
ANOMALY_THRESHOLD=5000
```

---

## Infrastructure

| | |
|---|---|
| **VPS** | DigitalOcean, Ubuntu 24.04.4, `24.199.121.137` |
| **SSH** | `guardian-vps` → `guardian@24.199.121.137` |
| **Deploy** | `deploy` alias → git pull + docker compose up --build |
| **Backend** | `/home/guardian/claw-net/` — port 3402, Docker + Redis |
| **Frontend** | `/var/www/claw-net/` — static HTML served by Caddy |
| **Database** | `data/orchestrator.db` (SQLite WAL, 41 migrations) |

---

## Frontend Pages (`site/`)

| Page | Purpose |
|---|---|
| `index.html` | Landing page, pricing, Stripe/USDC payments |
| `dashboard.html` | Clerk auth, API key management, credits |
| `marketplace.html` | Browse/publish/starred/purchases, ratings, featured |
| `docs.html` | API reference, per-endpoint pricing |
| `endpoints.html` | Searchable endpoint catalog |
| `success.html` | Payment confirmation + API key reveal |
| `admin.html` | Admin dashboard (ADMIN_API_KEY gated) |
| `contact-section.html` | Contact form |

Design: muted dark theme, teal accent (#10b981), Inter + JetBrains Mono.

---

## MCP Server

ClawNet exposes skills as MCP tools for Claude Code, Cursor, and VSCode.

6 tools: `list-skills`, `get-skill`, `invoke-skill`, `search-registry`, `orchestrate`, `get-credits`

```json
{
  "mcpServers": {
    "clawnet": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "env": { "CLAWNET_API_KEY": "cn-...", "CLAWNET_BASE_URL": "https://api.claw-net.org" }
    }
  }
}
```

---

## Community

- Website: [claw-net.org](https://claw-net.org)
- Support: [support@claw-net.org](mailto:support@claw-net.org)

## License

MIT
