Always commit and push after big updates, I will do the deploy.

# ClawNet — Project Roadmap & System Reference

> **Vision:** ClawNet is the sovereign orchestration layer for the x402 and OpenClaw ecosystem — the intelligence router between AI agents, real-time data, and micropayment rails across Solana and beyond.

---

## What This Project Is

**Product:** A pay-per-use API that orchestrates Solana/DeFi data (163 endpoints), X/Twitter sentiment, and AI analysis into a single natural-language response. Users buy credits (Stripe / USDC on Solana). On top: a skill marketplace where anyone can publish prompt-powered capabilities and earn 97% of every purchase.

**The real moat:** The infinite-endpoint registry (aggregation effort, API key costs, active maintenance) + agent-to-agent payment infrastructure (escrow, skills, P2P mesh, discovery).

**Public interface:** `POST /v1/openclaw/invoke` — the OpenClaw Gateway. 4 actions: `query`, `skill`, `discover`, `swarm`. All routing logic stays private.

---

## ⚠️ Stack — CRITICAL

| Use | NOT |
|---|---|
| `Hono` | Fastify |
| `npm` | pnpm |
| `better-sqlite3` raw SQL | Drizzle ORM |
| Single flat repo | Turborepo/monorepo |
| Plain HTML at `/var/www/claw-net/` (not in git) | Vite/React SPA |
| Clerk (auth) + Phantom (USDC only) | Reown AppKit |
| `.env` file on VPS | sops/systemd secrets |
| `libp2p` + `@chainsafe/libp2p-yamux` | `@libp2p/node` (doesn't exist) |

**libp2p gotchas:** Config key is `connectionEncrypters` (not `connectionEncryption`). `@libp2p/mplex` deprecated — use yamux. `kadDHT` requires `ping` service registered alongside it. libp2p v3 is ESM-only but tsx handles it.

---

## Infrastructure

**VPS:** DigitalOcean, Ubuntu 24.04.4, IP 24.199.121.137, Node 22.22.1, Docker 29.3.0
**SSH alias:** `guardian-vps` (`guardian@24.199.121.137`)
**Deploy alias:** `deploy` — git pull + docker compose up --build + chown
**Backend:** `/home/guardian/claw-net/` — Hono API on port 3402, Docker + Redis
**Frontend:** `/var/www/claw-net/` — static HTML served by Caddy (NOT in git — copy from `site/` after deploy)
**Local repo:** `C:\Users\Josh\Desktop\GitHub\claw-net`

**VPS pending one-time tasks:**
- `sudo ufw allow 4001/tcp` — open libp2p swarm port

---

## Current System — Complete Feature Set

### Core Platform
- Hono API on port 3402, SQLite WAL mode, Redis L2 cache, Pino logging, Zod env validation
- Intent parser with plan templates (regex-match ~60-80% of queries, skips LLM) → parallel executor → LLM synthesizer
- Two-model LLM strategy: fast model for intent parsing (`claude-haiku-4-5-20251001` / `gpt-4o-mini`), smart model for synthesis (`claude-sonnet-4-20250514` / `gpt-4o`)
- Circuit breaker per endpoint (CLOSED → OPEN → HALF_OPEN), MAX_CIRCUITS=500 cap, 7-day auto-reset for stuck states
- Smart cache TTLs per endpoint (metadata 24h, prices 60s, holders 30min, social 10min, default 300s)
- `isSimulationMode = !env.SOLANA_PRIVATE_KEY` — blocks `prompt_template` skills when no x402 payment provider, `api_proxy` skills still work
- Batch orchestration: `POST /v1/batch` (up to 10 parallel queries), SSE streaming: `GET /v1/stream/orchestrate`
- OpenAPI spec: `GET /v1/openapi.json`

### API Registry
- 163 endpoints across 15 categories: solana, social, utility, defi, intelligence, oracle, scraping, discovery, infrastructure, search, media, enrichment, weather, ai-ml, security
- Per-endpoint `cacheTtl` overrides, health monitoring (HEAD pings every 5 min)
- Endpoint health table + `GET /v1/registry`, `/v1/registry/health`, `/v1/registry/:id`

### Payments & Credits
- **Stripe:** 6 credit packages ($5–$1,000), subscriptions (Scout $29/mo → 40K credits), annual pricing slots
- **USDC/Solana:** Phantom wallet, on-chain signature verify, +7% bonus over Stripe pricing
- **x402 provider mode:** Serve skills as x402 payable endpoints on Base/USDC (requires `X402_RECIPIENT_ADDRESS`)
- **x402 consumer mode:** Pay for ClawAPIs endpoints via x402 on Solana (requires `SOLANA_PRIVATE_KEY`)
- Credit formula: `max(1, ceil(apiCosts * 2000))`, 1 credit = $0.001
- Billing portal: `POST /v1/dashboard/billing-portal`, cost estimate: `GET /v1/estimate?query=`
- Free trial built but disabled (`FREE_TRIAL_CREDITS=0` default)

### Skill System
- Skill CRUD: `POST /v1/skills`, GET, GET /mine, GET /:id, POST /:id/invoke, PATCH visibility, DELETE
- Skill types: `prompt_template` (LLM pipeline) and `api_proxy` (direct proxy, no LLM, 15s timeout)
- Execution plans: `execution_plan_json` on skills — deterministic endpoint routing bypasses LLM intent parser
- `POST /v1/skills/:id/test` — owner-only dry run, no credit charge
- A/B testing: fork, promote, 30% traffic to challenger, auto-promote cron (30min, +10% success rate threshold)
- Revenue share: 97% to creator, 3% platform fee (official skills fee-exempt). Min 1-credit fee for third-party skills ≥10cr
- Reputation: +0.1 success / -0.05 failure per invocation
- Security scanner: 14 regex patterns on publish (prompt injection, XSS, SQL injection, etc.)
- Community reports: auto-flag at 3+ reports. Security statuses: CLEAN, SUSPICIOUS, VERIFIED, FLAGGED

### Skill Marketplace
- Browse, search, purchase, rate, stake, featured skills, version history
- Purchase = invoke in single call (result shown immediately, single charge)
- Ratings: verified buyers only (checks `SKILL_SALE` transaction), 1-5 stars + text
- Featured skills: admin-toggled, displayed at top of browse
- Stats: invocations, success rate, avg latency, rating distribution
- Creator tools: `GET /v1/marketplace/creator/stats`, `POST /v1/marketplace/creator/withdraw` (min 1000cr)
- Staking: `POST /v1/marketplace/stake`, `/unstake`, `GET /v1/marketplace/stakes`
- Admin: `GET /v1/admin/treasury`, `GET /v1/admin/revenue`, `PATCH /v1/marketplace/admin/feature/:id`

### Official Skills (10 total, seeded on boot by `clawhub-official`)
| Skill | Credits | Endpoints |
|---|---|---|
| Token Analyst Pro | 5 | price + risk + holders + x-mentions |
| Social Sentiment | 3 | x-mentions + reddit |
| Portfolio Optimizer | 8 | wallet-portfolio + tx-history |
| Wallet Profiler | 6 | wallet-portfolio + tx-history + wallet-risk |
| Trending Tokens | 4 | trending-tokens + x-mentions |
| Whale Tracker | 5 | price + holders + whales |
| DeFi Yield Scanner | 5 | apollo-defi-yields + diamondclaws-yield |
| Token Launch Radar | 4 | trending-tokens + rootdata-hot-x |
| Price Oracle | 3 | price + coinank-kline |
| NFT Collection Intel | 5 | price + holders |

All v2.0.0 with deterministic execution plans. `seedOfficialSkills()` runs update pass every boot. Security status: VERIFIED.

### Task API
- `POST /v1/tasks` — submit skill task (idempotency-key dedup, A/B routing, credit deduction, webhook)
- `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/tasks/:id/cancel`, `POST /v1/tasks/:id/rate`
- `GET /v1/auth/me`, `GET /v1/auth/estimate?skillId=`, `GET /v1/auth/usage`

### P2P Mesh Network
- libp2p node: TCP transport, Noise encryption, Yamux muxer, Kademlia DHT
- `src/mesh/node.ts` — `startMeshNode()`, `stopMeshNode()`, `getMeshNode()`
- `GET /v1/mesh/peers` — node ID, listening addrs, known peers
- `peers` table with `upsertPeer()`, `getPeers()`
- Connection manager: max 50 connections (DoS protection)

### Vector Search & Discovery
- ONNX all-MiniLM-L6-v2 via @huggingface/transformers, exponential backoff on load failure
- Discovery Trinity: semantic 60% + P2P 25% + on-chain mock 15% (configurable via `discovery.json`)
- `POST /v1/discover` — rewired to discovery engine
- `skill_embeddings` virtual table (sqlite-vec), `discovery_cache` table

### Escrow & Trustless Hiring
- Full state machine: create → fund → start → complete → release → dispute → evidence → resolve
- Cron (10min): expired FUNDED→REFUNDED, WIP→DISPUTED (concurrency guard)
- `escrows` + `audit_log` tables, `docs/escrow-design.md`

### Swarms
- `POST /v1/swarm/task` (202 async), `GET /v1/swarm/:id`
- LLM decomposes → parallel skill invocations → LLM synthesis
- `maxBudget` cap with pre-allocated `budgetPerSubtask`, `X-Swarm-Depth` recursion guard
- Upfront SWARM_BASE_FEE=20 credit deduction before background task spawns

### Governance
- Proposals + votes tables, governance routes
- `castVote` FOR/AGAINST, duplicate prevention, auto-expire on closed proposals

### LLM Proxy Gateway
- `GET /v1/llm/models` (23 models), `POST /v1/llm/chat` (OpenAI-compatible), `/embeddings`, `/code/run`
- 15% markup on all LLM calls via x402engine

### MCP Server
- `src/mcp/server.ts` — 6 tools: list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits
- Run: `npm run mcp`

### Telegram Bot
- User-driven model — queries run ONLY when a user types a command (no auto-queries)
- 12h global cooldown — 1 heavy query per 12h shared across all users
- Broadcast: any user's query result pushed to all subscribers
- Commands: `/demo`, `/trending`, `/analyze`, `/wallet`, `/sentiment`, `/news`, `/ask`, `/about`, `/price`, `/skill`, `/skills`, `/subscribe`, `/unsubscribe`
- `/price` exempt from global cooldown (per-user 1/min)
- `/skill` shows info but does NOT invoke (prevents free credit bypass)
- `sanitizeInput()` on all user args, Solana address regex validation on `/wallet`
- Subscribers in SQLite `telegram_subscribers` table (migration v31)
- `broadcastBatched()`: parallel batches of 5, 100ms between batches
- Heartbeat: lightweight health pulse, logs uptime hourly to `data/heartbeat.jsonl`, rotates at 1000 lines

### Security & Auth
- Clerk JWT auth (`clerkAuth` middleware), API key auth (`checkApiKey` middleware)
- Admin auth: `requireAdmin()` in `src/middleware/admin-auth.ts` — timing-safe SHA-256 normalized comparison, `X-Admin-Key` only (used by all admin routes)
- `ADMIN_API_KEY` required in production (process.exit(1) if missing)
- HSTS headers, rate limiting (60/min/IP, IPv6 private ranges trusted)
- Response signing: HMAC-SHA256 `X-ClawNet-Signature` (when `PLATFORM_SIGNING_SECRET` set)
- `maskApiKey()` from `src/utils/mask.ts` for all key display — never inline
- Atomic credit deduction (`WHERE credits >= amount`)
- 64KB webhook payload size guard
- Stripe idempotency: `stripe_refunded_charges` table tracks cumulative refund amounts
- Proportional refund credit calc: `round((refundedUsd / amount_paid) × totalGranted)`
- Treasury credit in `marketplacePurchase()` validated: throws if treasury key missing/inactive
- `marketplaceRefund()` logs CRITICAL on failure; marketplace route reports honest refund status
- Process error handlers: `unhandledRejection` (log + continue), `uncaughtException` (log + exit)
- Solana signature claim: `releaseClaimSolanaSignature()` on all non-success verification paths
- Stake unlock: preserves stake row if API key missing (credits recoverable by admin)

### Testing & CI
- 48 Vitest unit tests: credit, escrow, governance, skills (`npm run test:unit`)
- GitHub Actions CI: `.github/workflows/ci.yml` (typecheck + unit tests on push/PR)
- `docs/RUNBOOK.md` — SQLite locks, mesh crashes, escrow timeouts, disk full, Redis down

### Frontend (10 pages in `site/`)
- `index.html` — landing page (hero, pipeline, API demo, pricing, Stripe/USDC payments)
- `dashboard.html` — Clerk auth, API key management, credit display
- `marketplace.html` — browse/publish/my-skills/starred/purchases tabs, rich result display, endpoint picker, test panel, ratings, featured, USD pricing
- `docs.html` — API reference, per-endpoint pricing
- `endpoints.html` — searchable endpoint catalog with category/status filters
- `login.html` — Clerk auth card
- `success.html` — payment confirmation with API key reveal + curl quick-start
- `admin.html` — admin dashboard (ADMIN_API_KEY gated)
- `admin-vps.html` — VPS admin panel
- `contact-section.html` — contact form with honeypot + validation

Design system: Linear/Vercel/Stripe aesthetic — muted dark theme, teal accent (#10b981), Inter + JetBrains Mono, 8px spacing, `clamp()` responsive typography.

---

## Database

**Engine:** better-sqlite3, WAL mode, no ORM
**Path:** `data/orchestrator.db`
**Migrations:** 38 total (v1–v38), run in `runMigrations()` inside `initDb()`
**Retention:** daily cleanup — audit_log (90d), skill_metrics (90d), solana_sigs (30d)

Key tables: `api_keys`, `transactions`, `skills`, `skill_metrics`, `skill_ratings`, `skill_versions`, `skill_reports`, `stakes`, `escrows`, `audit_log`, `proposals`, `votes`, `tasks`, `task_ratings`, `peers`, `discovery_cache`, `skill_embeddings`, `endpoint_health`, `telegram_subscribers`, `stripe_refunded_charges`, `payout_requests`, `swarms`

---

## Key File Paths

```
src/
  index.ts                    — Hono app, route registration, startup
  db/index.ts                 — ALL tables + helpers (no ORM); 38 migrations
  config/index.ts             — Zod env validation
  config/api-registry.ts      — 163 endpoint definitions
  config/discovery.json       — Trinity weights
  middleware/auth.ts           — X-API-Key checkApiKey middleware
  middleware/clerk-auth.ts     — Clerk JWT clerkAuth middleware
  middleware/rate-limit.ts     — 60 req/min/IP
  middleware/admin-auth.ts     — requireAdmin() timing-safe check (X-Admin-Key only)
  middleware/sign-response.ts  — HMAC-SHA256 response signing
  utils/mask.ts               — maskApiKey() helper (first4+••••+last4)
  utils/shutdown.ts            — SIGTERM/SIGINT handlers
  utils/logger.ts              — pino logger with redact paths
  providers/llm.ts             — llmComplete() with two-model strategy
  routes/
    api.ts                    — POST /v1/orchestrate, GET /v1/estimate
    openclaw.ts               — POST /v1/openclaw/invoke (universal gateway)
    skills.ts                 — skill CRUD + invoke + test + A/B
    marketplace.ts            — marketplace + staking + ratings + featured + creator stats
    tasks.ts                  — Task API (submit, list, cancel, rate)
    auth-tokens.ts            — GET /v1/auth/me, /estimate, /usage
    escrow.ts                 — escrow state machine
    governance.ts             — proposals + voting
    discover.ts               — POST /v1/discover (trinity)
    mesh.ts                   — GET /v1/mesh/peers
    swarm.ts                  — POST /v1/swarm/task
    llm.ts                    — LLM proxy gateway (23 models)
    registry.ts               — GET /v1/registry, /health, /:id
    x402-skills.ts            — x402 payable skill endpoints (Base/USDC)
    openapi.ts                — GET /v1/openapi.json
    admin.ts                  — admin endpoints
    dashboard.ts              — dashboard + billing portal
    stripe.ts                 — Stripe webhooks + subscriptions
    solana.ts                 — USDC/Solana verify
    clerk-webhook.ts          — Clerk webhook handler
    stats.ts, batch.ts, stream.ts, feedback.ts, referral.ts
    contact.ts, endpoints.ts
  core/
    intent-parser.ts          — LLM intent parsing (fast model)
    plan-templates.ts         — 12 regex templates (skip LLM for common queries)
    skill-executor.ts         — buildIntentFromPlan() for deterministic execution
    executor.ts               — parallel API execution with per-endpoint cache TTLs
    formatter.ts              — LLM synthesis (smart model) + cache
    credits.ts                — credit calculation
    circuit-breaker.ts        — per-endpoint circuit breaker, MAX_CIRCUITS=500
    discovery-engine.ts       — trinity aggregation
    embeddings.ts             — ONNX embed() with backoff
    skill-scanner.ts          — 14-pattern security scanner
    seed-skills.ts            — seeds 10 official skills on startup
    seed-embeddings.ts        — seeds 163 endpoints into discovery_cache
    endpoint-health-cron.ts   — HEAD-pings providers every 5 min + daily retention cleanup
    escrow-cron.ts            — 10 min: expired escrow cleanup
    skill-ab-cron.ts          — 30 min: A/B auto-promote
    stake-unlock-cron.ts      — stake unlock checker
    heartbeat.ts              — hourly health pulse to data/heartbeat.jsonl
  mesh/node.ts                — libp2p startMeshNode/stopMeshNode
  mcp/server.ts               — MCP server (npm run mcp)
  integrations/telegram.ts    — grammY bot with 12h cooldown + broadcast
site/
  index.html, marketplace.html, dashboard.html, docs.html
  endpoints.html, login.html, success.html, admin.html
  admin-vps.html, contact-section.html
docs/
  README.md, RUNBOOK.md, SKILL.md, escrow-design.md
```

---

## Code Patterns

```typescript
// Route pattern (always Hono)
import { Hono } from 'hono'
const router = new Hono()
router.post('/path', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') // { key, credits, isEnvKey, ... }
  return c.json({ ok: true })
})
export { router }

// DB pattern (no ORM, raw SQL)
import { getDb } from '../db/index'
const row = getDb().prepare('SELECT * FROM table WHERE id = ?').get(id)
const tx = getDb().transaction(() => { /* atomic */ })()

// Register route in src/index.ts (before app.notFound())
app.route('/v1/something', someRouter)
// Start in start() function; stop in src/utils/shutdown.ts

// Audit log (fire-and-forget, never throws)
logAudit({ entityType: 'x', entityId: id, action: 'ACTION', actorId: key, data: {} })

// Key masking (always use this — never slice directly)
import { maskApiKey } from '../utils/mask'
maskApiKey(key) // → "cn12••••abcd"

// Cron concurrency guard pattern
let _running = false
function runJob() {
  if (_running) return
  _running = true
  try { /* work */ } catch (err) { logger.error({ err }, '...') } finally { _running = false }
}
```

---

## Environment Variables (VPS .env)

```
PORT=3402
NODE_ENV=production
LLM_PROVIDER=openai
OPENAI_API_KEY=<set>
OPENAI_MODEL=gpt-4o
OPENAI_INTENT_MODEL=gpt-4o-mini
ANTHROPIC_API_KEY=<set>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_INTENT_MODEL=claude-haiku-4-5-20251001
CLAWAPIS_BASE_URL=https://clawapis.com
REDIS_URL=redis://redis:6379
MARKUP_PERCENT=15
RATE_LIMIT_PER_MIN=60
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=<set>
RESEND_FROM=noreply@claw-net.org
CLERK_SECRET_KEY=sk_live_...
SOLANA_RECEIVING_WALLET=H6xbRyGEyoTdfBEShSt2H3oHJxL3gaJjVGdL5MLKwHN7
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TELEGRAM_BOT_TOKEN=<set>
TELEGRAM_CHANNEL_ID=<set>
ADMIN_API_KEY=<set, min 16 chars>
PLATFORM_SIGNING_SECRET=<32-byte hex>
ADMIN_EMAIL=<optional>
SENTRY_DSN=<optional>
# Optional:
# SOLANA_PRIVATE_KEY=<set to enable x402 API calls, disables simulation mode>
# SOLANA_RPC_FALLBACK=<fallback RPC>
# EVM_PRIVATE_KEY=<Base/EVM wallet for x402 payments>
# X402_RECIPIENT_ADDRESS=0x... (enables x402 provider mode)
# CLERK_WEBHOOK_SECRET=whsec_...
# FREE_TRIAL_CREDITS=100
# STRIPE_ANNUAL_PRICE_100=price_...
# DAILY_SPEND_CAP=0 (0=disabled)
# ANOMALY_THRESHOLD=5000
```

---

## Credit Pricing

**Stripe:**
| Amount | Credits | Bonus |
|---|---|---|
| $5 | 5,000 | — |
| $20 | 21,000 | +5% |
| $50 | 54,000 | +8% |
| $100 | 112,000 | +12% |
| $500 | 600,000 | +20% |
| $1,000 | 1,300,000 | +30% |
| Scout sub $29/mo | 40,000/mo | — |

**USDC (+7% over Stripe):** $20→22.5K, $50→58K, $100→120K, $500→642K, $1000→1.39M

---

## Technical Principles (never break)

1. **No ORM** — raw SQL only (`better-sqlite3`), schema in `src/db/index.ts`
2. **No monorepo** — single flat repo, single deploy unit
3. **SQLite-first** — all persistent state in SQLite, Redis is cache only (lossy OK)
4. **Credits, not subscriptions** — subscriptions just top up credits monthly
5. **Simulation mode always works** — no `SOLANA_PRIVATE_KEY` = prompt_template skills blocked, server still runs
6. **One VPS** — scale vertically first
7. **API registry is the single source of truth** — adding an endpoint = add to registry; everything else picks it up
8. **maskApiKey() for all key display** — never slice directly

---

## Ecosystem Flywheel

```
ClawAPIs.com adds new endpoint
  → api-registry.ts updated
  → Intent parser can now use it
  → Community publishes skills using it on ClawHub
  → OpenClaw agents discover and invoke those skills
  → Revenue flows back to skill authors (97%)
  → More revenue → more endpoints maintained
```

The flywheel doesn't self-start. Both sides (creators and consumers) need to be manually seeded.

---

## Next Priority: User Acquisition

**The platform is technically complete. The constraint is users, not code.**

**Phase 0 (NOW):** Get 5 paying API users via direct outreach
- Target: Solana dev communities (Superteam, Solana Discord, DeFi builder Telegram groups)
- Offer: $20 in free starter credits
- Watch: what queries they run, what fails, what's slow
- Success signal: a user returns after week 1 and tops up

Do not publish to external marketplaces until 10+ paying users return after week 1.

**Distribution channels:**
| Channel | Purpose | Timing |
|---|---|---|
| Direct API (claw-net.org) | Primary revenue | **NOW** |
| ClawHub | Discovery / credibility | After 10+ paying users |
| claw-net.org Marketplace | Creator economy | After 10+ third-party skills |

**Top mistakes to avoid:**
1. Publishing to ClawHub before having paying users
2. Putting routing logic in skill definitions
3. Treating ClawHub free-tier clicks as demand signal
4. Building marketplace features before having marketplace supply
5. Underpricing — upstream API costs are real
6. Over-engineering skill packaging before testing the API directly

---

## Planned: Medium Term

### Discovery Trinity Enhancements
- Capability broadcast — nodes announce supported skills/endpoints
- Intent routing — queries routed to best-equipped peer
- Reputation DHT — peer ratings in Kademlia, keyed by peer ID

### Webhook Subscriptions
- `POST /v1/webhooks/subscribe` — register URL for events
- Events: `token.alert`, `wallet.activity`, `sentiment.spike`, `skill.invoked`
- Delivery retry with exponential backoff, HMAC signature on outbound

### Agent Identity (DID)
- Each ClawNet key gets a DID on Solana
- Skills signed by author DID — verifiable provenance
- DID resolution via libp2p DHT

---

## Planned: Long Term

### Multi-Chain Expansion
- Ethereum/Base USDC payments via x402
- Cross-chain portfolio views
- Bridge monitoring (Wormhole, deBridge alerts)

### Enterprise Features
- Team API keys (org-level billing, member key management)
- SSO / SAML for enterprise dashboards
- SLA tiers, dedicated nodes, usage exports (CSV/JSON)

---

## Deferred (out of scope for now)
- Double-entry ledger
- API token SHA-256 hashing
- BullMQ async queue
- Org/team keys
- DID-based signing
