# ClawNet

**Sovereign AI Agent Orchestration — powered by x402 & ClawAPIs**

ClawNet is an intelligent API orchestration layer that turns natural language queries into multi-step agent workflows. Ask it anything about Solana tokens, wallets, sentiment, or on-chain data — it plans, executes, and synthesizes an answer using real-time API calls.

Built to be the reference implementation for [x402](https://x402.org) micropayment-gated AI services and the backbone of the [OpenClaw](https://openclaw.io) skill ecosystem.

---

## What it does

```
User query: "Is this Solana token safe to buy right now?"

ClawNet:
  1. Parses intent → selects relevant API endpoints
  2. Executes steps in parallel where possible
  3. Synthesizes results via LLM into a clear, actionable answer
  4. Returns scores, suggested actions, and cost breakdown
```

All of this is cached, rate-limited, circuit-broken, and billed per credit.

---

## Quick Start

```bash
# 1. Get an API key at claw-net.org
# 2. Make your first query

curl -X POST https://api.claw-net.org/v1/orchestrate \
  -H "X-API-Key: cn-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the top trending Solana tokens right now?"}'
```

Response:
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

---

## Authentication

All protected endpoints require `X-API-Key: cn-your-key` in the header.

Get a key at [claw-net.org](https://claw-net.org). Keys are tied to a credit balance — no subscription required to start.

| Action | Endpoint |
|---|---|
| Check balance | `GET /v1/balance` |
| View dashboard | [claw-net.org/dashboard.html](https://claw-net.org/dashboard.html) |

---

## API Reference

### Core

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/orchestrate` | Natural language → multi-step agent execution |
| `GET` | `/v1/balance` | Check credit balance |
| `GET` | `/v1/registry` | List available API endpoints |
| `GET` | `/health` | Health check (uptime, version) |

### ClawHub Skills

Skills are reusable, shareable orchestration templates with `{{variable}}` placeholders. Build once, share with the community, earn revenue share when others use your skill.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/skills` | Create a skill |
| `GET` | `/v1/skills` | Browse public skills |
| `GET` | `/v1/skills/mine` | Your skills |
| `GET` | `/v1/skills/:id` | Skill details |
| `POST` | `/v1/skills/:id/invoke` | Run a skill |
| `PATCH` | `/v1/skills/:id/visibility` | Publish / unpublish |
| `DELETE` | `/v1/skills/:id` | Delete a skill |

**Create a skill:**
```bash
curl -X POST https://api.claw-net.org/v1/skills \
  -H "X-API-Key: cn-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "token-risk-check",
    "description": "Full risk analysis for any Solana token",
    "promptTemplate": "Analyze {{mintAddress}} for rug pull risk, holder concentration, and social sentiment",
    "public": true,
    "creditCost": 10
  }'
```

**Invoke a skill:**
```bash
curl -X POST https://api.claw-net.org/v1/skills/SKILL_ID/invoke \
  -H "X-API-Key: cn-your-key" \
  -H "Content-Type: application/json" \
  -d '{"variables": {"mintAddress": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"}}'
```

### Dashboard

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/dashboard/me` | Clerk JWT | Account info + masked key |
| `POST` | `/v1/dashboard/reveal-key` | Clerk JWT | Get full API key |
| `POST` | `/v1/dashboard/regenerate-key` | Clerk JWT | Rotate key (keeps credits) |
| `POST` | `/v1/dashboard/claim-session` | Clerk JWT | Link Stripe purchase to account |

### Payments

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/webhooks/stripe` | Stripe one-time purchase webhook |
| `POST` | `/v1/webhooks/stripe-subscriptions` | Stripe subscription webhook |
| `POST` | `/v1/solana/verify` | USDC on-chain payment verification |
| `GET` | `/v1/solana/packages` | USDC package list + receiving wallet (Clerk JWT) |
| `POST` | `/v1/solana/build-tx` | Build unsigned USDC transfer for Phantom (Clerk JWT) |
| `GET` | `/v1/session/:sessionId` | Retrieve API key after Stripe checkout |
| `POST` | `/v1/resend-key` | Resend API key to email |
| `GET` | `/v1/usage` | API key usage statistics |

### Social

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/v1/contact` | Contact form |
| `POST` | `/v1/feedback` | Submit query rating |
| `GET/POST` | `/v1/referral` | Referral code generation + redemption |

### Mesh (P2P)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/mesh/peers` | API key | Known libp2p peers |

---

## Credits & Pricing

Credits are the unit of account. 1 credit ≈ $0.001 in API cost.

| Package | Price | Credits | Per Dollar |
|---|---|---|---|
| Starter | $5 | 5,000 | 1,000/$ |
| Builder | $20 | 21,000 | 1,050/$ |
| Pro | $50 | 54,000 | 1,080/$ |
| Growth | $100 | 112,000 | 1,120/$ |
| Scale | $500 | 600,000 | 1,200/$ |
| Enterprise | $1,000 | 1,300,000 | 1,300/$ |
| ClawNet Scout (sub) | $29/mo | 40,000/mo | 1,379/$ |

Credits never expire. Subscriptions top up monthly on top of your existing balance.

**Solana/USDC payments** receive an automatic +10% bonus on all tiers.

---

## ClawHub Skills — Revenue Share

When you publish a skill and other users invoke it:
- They pay the credit cost you set (+ actual API cost)
- You earn **10% of credits consumed** automatically
- Credits are deposited to your key immediately after each invocation

This creates a marketplace where the best skills earn passively.

---

## Architecture

```
Request → Rate Limit → Auth → Intent Parser (LLM)
                                    ↓
                          Execution Plan (parallel groups)
                                    ↓
                    ClawAPIs (x402 micropayments) ← Circuit Breaker
                                    ↓
                          Response Synthesis (LLM)
                                    ↓
                              Cache + Return
```

**Stack:**
- Runtime: Node.js + TypeScript + [Hono](https://hono.dev)
- Database: SQLite via `better-sqlite3` (no ORM)
- Cache: Redis (L2) + in-memory (L1)
- Auth: [Clerk](https://clerk.com) (dashboard) + API key (orchestration)
- Payments: Stripe + USDC/Solana via x402
- P2P: libp2p (Kademlia DHT, TCP, Noise, Yamux)
- LLM: Anthropic Claude / OpenAI / OpenClaw
- Email: Resend
- Deploy: Single VPS, systemd, Nginx reverse proxy

---

## Self-Hosting

```bash
git clone https://github.com/your-org/claw-net
cd claw-net
npm install
cp .env.example .env
# Fill in .env (see config/index.ts for all vars)
npm run dev
```

Required env vars:
```
ANTHROPIC_API_KEY=sk-ant-...
CLAWAPIS_API_KEY=your-key
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
CLERK_SECRET_KEY=sk_...
```

Optional:
```
SOLANA_PRIVATE_KEY=...        # Enable x402 micropayments
ADMIN_API_KEY=...              # Admin dashboard key
TELEGRAM_BOT_TOKEN=...         # Telegram intelligence feed
```

---

## Community

- Website: [claw-net.org](https://claw-net.org)
- Support: [hello@claw-net.org](mailto:hello@claw-net.org)
- GitHub Discussions: [github.com/your-org/claw-net/discussions](https://github.com/your-org/claw-net/discussions)
- Sponsor: [claw-net.org](https://claw-net.org)

---

## License

MIT — build on it, extend it, publish skills.
