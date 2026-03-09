# ClawNet v3 — Claude Code Briefing
> Paste this into Claude Code (VSCode) to continue the project from where we left off.

---

## What This Project Is

ClawNet is a sovereign AI agent orchestration layer and economy. It is live in production at **claw-net.org**.

**The product:** A pay-per-use API that orchestrates Solana/DeFi data (183 endpoints), X/Twitter sentiment, and AI analysis into a single natural-language response. Users buy credits (Stripe / USDC on Solana). Built on top: a skill marketplace where anyone can publish prompt-powered capabilities and earn 97% of every purchase.

**The moat:** 183 Solana/DeFi endpoints packaged as one API, plus agent-to-agent payment infrastructure (escrow, skills, P2P mesh, discovery) before anyone else has built it cleanly.

---

## ⚠️ Stack Deviations — CRITICAL, Read First

| Roadmap Said | What Was Actually Built | Notes |
|---|---|---|
| Fastify 5 | **Hono 4.6+** | Same concepts, different API. All routes use Hono. Do not add Fastify. |
| Turborepo + pnpm monorepo | **Single repo, npm** | No workspaces. Everything is flat in `claw-net/`. |
| Vite + React SPA dashboard | **Plain HTML files** in `/var/www/claw-net/` | `dashboard.html`, `index.html` etc. Static files, NOT in git. |
| Drizzle ORM | **Raw better-sqlite3** | No ORM. Direct SQL queries. CREATE TABLE IF NOT EXISTS pattern. |
| ERC-8004 agent identity | **Clerk** (production auth) | Centralized for now. ERC-8004 is future on-chain work. |
| x402 / XRP payments | **Stripe + USDC on Solana** | Stripe for card. USDC via Phantom wallet for crypto. |
| Reown AppKit (wallet auth) | **Clerk** for auth, **Phantom** for USDC only | Phantom only for USDC payment, not general auth. |
| pnpm | **npm** | Use npm for all installs. |
| systemd secrets via sops | **.env file** on VPS | Standard dotenv. |
| @libp2p/node | **`libp2p` + `@chainsafe/libp2p-yamux`** | `@libp2p/node` does NOT exist on npm. `@libp2p/mplex` deprecated, use yamux. `kadDHT` requires `ping` service alongside it. libp2p v3 is ESM-only but tsx handles it fine. |
| Vitest | **tests/run.ts** integration tests | Basic tests exist. Vitest is Chunk 14. |
| GitHub Actions CI | **NOT SET UP** | No CI pipeline yet. Chunk 14. |

---

## What's Live in Production

**VPS:** DigitalOcean, Ubuntu 24.04.4, IP 24.199.121.137, Node 22.22.1, Docker 29.3.0
**SSH:** `guardian-vps` (alias for `guardian@24.199.121.137`)
**Deploy:** `deploy` alias — git pull + docker compose up --build + chown

**Backend:** `/home/guardian/claw-net/` — Hono API on port 3402, Docker + Redis
**Frontend:** `/var/www/claw-net/` — static HTML served by Caddy (NOT in git — copy from `site/` after deploy)
**Local repo:** `C:\Users\Josh\Desktop\GitHub\claw-net`

### VPS One-Time Pending Tasks
- `sudo ufw allow 4001/tcp` — open libp2p swarm port (Chunk 5, still pending)
- Ensure `ADMIN_API_KEY` is set in `/home/guardian/claw-net/.env`

---

## Chunk Status

### ✅ CHUNKS 1–4: Core Platform (COMPLETE)
- VPS, Ubuntu, Node, Caddy (auto-TLS), UFW, fail2ban, Docker, swap
- Hono API, Pino logging, Zod validation, rate limiting (60/min/IP)
- SQLite WAL, LRU + Redis L2 cache, Clerk auth
- Intent parser (GPT-4o primary, Claude fallback) → parallel executor → LLM synthesizer
- ClawAPIs x402 integration — 183 endpoints (Solscan Pro 22, Helius 80, X/Twitter 81)
- Stripe live payments — 6 credit packages $5–$1,000
- USDC/Solana — Phantom wallet, on-chain verify, +10% bonus credits
- Credit system: 1 credit = $0.001, deduction = `Math.max(1, Math.ceil(apiCosts * 2000))`
- Resend email, Telegram bot, circuit breaker, admin endpoint
- Frontend: landing page, pricing, USDC modal, dashboard, login, success pages

### ✅ CHUNK 5: P2P Mesh Network (COMPLETE)
- Packages: `libp2p`, `@libp2p/tcp`, `@libp2p/noise`, `@libp2p/kad-dht`, `@libp2p/ping`, `@chainsafe/libp2p-yamux`
- `src/mesh/node.ts` — `startMeshNode()`, `stopMeshNode()`, `getMeshNode()`
- `src/routes/mesh.ts` — `GET /v1/mesh/peers`
- `peers` table in SQLite, `upsertPeer()`, `getPeers()`

### ✅ CHUNK 6: Vector Search & Embeddings (COMPLETE)
- `src/core/embeddings.ts` — ONNX all-MiniLM-L6-v2 via @huggingface/transformers
- `src/core/seed-embeddings.ts` — seeds all 183 endpoints into discovery_cache
- `src/routes/discover.ts` — `POST /v1/discover` (rewired to discovery-engine)
- `skill_embeddings` virtual table (sqlite-vec), `discovery_cache` table

### ✅ CHUNK 7: Escrow & Trustless Hiring (COMPLETE)
- `src/routes/escrow.ts` — full CRUD: create, fund, start, complete, release, dispute, evidence, resolve, GET
- `src/core/escrow-cron.ts` — every 10 min: expired FUNDED→REFUNDED, WIP→DISPUTED
- `escrows` + `audit_log` tables, full state machine, `docs/escrow-design.md`

### ✅ CHUNK 8: Skill System — Part 1 (COMPLETE)
- `src/routes/skills.ts` — POST /v1/skills, GET /list, GET /mine, GET /:id, POST /:id/invoke, PATCH /:id/visibility, DELETE /:id, GET /:id/reputation, GET /:id/metrics
- `skills/token-analysis/skill.json` — first ClawHub skill package
- `docs/SKILL.md` — skill format spec
- Reputation recording on invoke (+0.1 success, -0.05 failure)
- `skill_metrics` recorded per invocation
- Discovery embedding on publish

### ✅ CHUNK 9: Skill System — Part 2 (COMPLETE)
- A/B testing: `POST /v1/skills/:id/fork`, `POST /v1/skills/:id/promote`
- 30% traffic to challenger automatically when `ab_challenger` set
- `src/core/skill-ab-cron.ts` — every 30 min: auto-promote if +10% success rate (min 20 invocations), discard if -10%
- `skill_versions` table, migration columns: version, input_schema_json, output_schema_json, published_at, tags_json, forked_from, ab_challenger

### ✅ CHUNK 10: Discovery Trinity (COMPLETE)
- `src/core/discovery-engine.ts` — semantic (60%) + P2P (25%) + on-chain mock (15%)
- `src/config/discovery.json` — configurable weights, graceful degradation when layers return nothing
- `POST /v1/discover` rewired to trinity engine with `filters.source[]`, `filters.provider`, `weights{}`

### 🟡 CHUNK 11: Dashboard Upgrade (SKIPPED)
- Plain HTML dashboard works fine. Skip React migration unless explicitly requested.

### ✅ CHUNK 12: Marketplace & Economics (COMPLETE)
- `src/routes/marketplace.ts` — GET /skills, GET /skills/:id, POST /skills/:id/purchase, GET /transactions, POST /stake, POST /unstake/:id, GET /stakes, GET /creator/stats
- `src/core/seed-skills.ts` — seeds 3 official skills on startup: token-analysis (5cr), social-sentiment (3cr), portfolio-optimizer (8cr)
- `site/marketplace.html` — full 4-tab UI: Browse, Publish, My Skills, How It Works
- Purchase flow: buy + invoke in one modal step → result shown immediately
- `transactions` + `stakes` tables, `getCreatorStats()`, `getSkillsByAuthor()`
- 3% platform fee, 97% to creator, atomic SQLite transactions

---

## ✅ CHUNK 13: Swarms, Governance & Creator Payouts (COMPLETE)

### 13A — Creator Payout System ✅
- `payout_requests` table + `POST /v1/marketplace/creator/withdraw` (min 1000cr, queues USDC payout)
- `GET /v1/marketplace/creator/withdrawals` — payout history
- `GET /v1/admin/payouts` + `PATCH /v1/admin/payouts/:id` — admin processes payouts manually
- `site/marketplace.html` My Skills tab: Withdraw Credits button + withdrawal history

### 13B — Swarm Task Decomposition ✅
- `swarms` table + `POST /v1/swarm/task` (202 async) + `GET /v1/swarm/:id`
- LLM decomposes → parallel skill invocations → LLM synthesis

### 13C — ClawGuard + Governance ✅
- `src/middleware/sign-response.ts` — HMAC-SHA256 `X-ClawNet-Signature` on all orchestrate + skill responses
- `proposals` + `votes` tables + full governance routes
- Reputation gating: skills < -1.0 auto-unpublished in skill-ab-cron

---

## ✅ CHUNK 14: Testing, Docs & Launch Hardening
**Status: COMPLETE**

### ✅ Done
- `site/docs.html` — full public API reference (all routes, auth, credits, errors, code examples, ClawGuard)
- Nav updated: How It Works → Pricing → Contact → API Docs → Marketplace → Endpoints
- Live endpoint counts on homepage (fetched from /v1/endpoints)
- Provider status accuracy (CoinGecko/CoinMarketCap shown as Live)
- Terminal + API docs slideshows on index.html
- Vitest suite — 48 tests across credit, escrow, governance, skills (`npm run test:unit`)
  - `tests/unit/helpers/db.ts` — vi.mock + importOriginal pattern, in-memory SQLite
  - `tests/unit/credit.test.ts` — deductCredit, topUpCredits, atomicity
  - `tests/unit/escrow.test.ts` — state machine, fundEscrow, releaseEscrow
  - `tests/unit/governance.test.ts` — castVote, duplicates, closed proposals, auto-expire
  - `tests/unit/skills.test.ts` — createSkill, listPublicSkills, deleteSkill, revenue share
- Production monitoring: UptimeRobot configured on /v1/health (5-min polling)
- Runbook: `docs/RUNBOOK.md` — SQLite locks, mesh crashes, escrow timeouts, disk full, Redis down
- OWASP Top 10 security checklist — 7 patches applied (prior chunks)

### 📋 Deferred to Roadmap
- Load test: 100 concurrent agents against /v1/orchestrate (Chunk 15+)
- GitHub Actions CI pipeline (Chunk 15+)

---

## Product Viability Notes (read before building)

**The beachhead:** Solana/DeFi data + AI analysis packaged as a pay-per-use API. 183 endpoints, no subscription. This is the wedge.

**The flywheel:** Paying orchestration users → marketplace traffic → skill creators join → more skills → more buyers → more creators.

**What needs to happen before the flywheel starts:**
1. Creator payouts (USDC withdrawal) — serious creators won't build without real money out
2. 10–20 real paying orchestration users (not marketplace, just the API)
3. 10–15 high-quality skills in the marketplace (currently 3)
4. Real results from the 3 seeded skills (test them and tune prompts)

**The long-game:** Agent-to-agent payments. AI agents discover skills via P2P mesh, pay via credits, escrow for trust. ClawNet becomes infrastructure for the agentic web.

---

## Key File Paths

```
src/
  index.ts                    — Hono app, route registration, startup
  db/index.ts                 — ALL tables + helpers (no ORM)
  config/index.ts             — Zod env validation
  config/api-registry.ts      — 183 endpoint definitions
  config/discovery.json       — Trinity weights
  middleware/auth.ts          — X-API-Key checkApiKey middleware
  middleware/clerk-auth.ts    — Clerk JWT clerkAuth middleware
  middleware/rate-limit.ts    — 60 req/min/IP
  routes/
    api.ts                    — POST /v1/orchestrate
    skills.ts                 — skill CRUD + invoke + A/B
    marketplace.ts            — marketplace + staking + creator stats
    escrow.ts                 — escrow state machine
    discover.ts               — POST /v1/discover (trinity)
    mesh.ts                   — GET /v1/mesh/peers
    stats.ts                  — GET /v1/stats (public)
    admin.ts                  — admin routes (ADMIN_API_KEY)
    stripe.ts, solana.ts      — payment routes
    dashboard.ts, feedback.ts, referral.ts, endpoints.ts, contact.ts
  core/
    discovery-engine.ts       — trinity aggregation
    embeddings.ts             — ONNX embed()
    seed-embeddings.ts        — seeds 183 endpoints
    seed-skills.ts            — seeds 3 official skills on startup
    escrow-cron.ts            — 10min: expired escrow cleanup
    skill-ab-cron.ts          — 30min: A/B auto-promote
    heartbeat.ts
  mesh/node.ts                — libp2p startMeshNode/stopMeshNode
  utils/shutdown.ts           — SIGTERM/SIGINT handlers
  integrations/telegram.ts
site/
  index.html                  — landing page (copy to /var/www/claw-net/ after deploy)
  marketplace.html            — skill marketplace (4 tabs)
  dashboard.html              — user dashboard
  endpoints.html, login.html, success.html, admin.html
skills/token-analysis/        — official skill package
docs/
  escrow-design.md
  SKILL.md
```

---

## Code Patterns

```typescript
// Route pattern (always Hono)
import { Hono } from 'hono'
const router = new Hono()
router.post('/path', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') // { key, credits, ... }
  return c.json({ ok: true })
})
export { router }

// DB pattern (no ORM, always raw SQL)
import { getDb } from '../db/index'
const row = getDb().prepare('SELECT * FROM table WHERE id = ?').get(id)
const tx = getDb().transaction(() => { /* atomic */ })()

// Register route in src/index.ts (before app.notFound())
app.route('/v1/something', someRouter)
// Start background service in start() function
// Stop in src/utils/shutdown.ts setupGracefulShutdown()

// Audit log (use for all state changes)
writeAuditLog({ entityType: 'x', entityId: id, action: 'ACTION', actorId: key })

// nanoid for IDs
const { nanoid } = await import('nanoid')
const id = nanoid(16)
```

---

## Environment Variables (VPS .env)

```
PORT=3402
NODE_ENV=production
LLM_PROVIDER=openai
OPENAI_API_KEY=<set>
ANTHROPIC_API_KEY=<set>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
CLAWAPIS_BASE_URL=https://api.clawapis.com
CLAWAPIS_API_KEY=<set>
REDIS_URL=redis://redis:6379
MARKUP_PERCENT=15
RATE_LIMIT_PER_MIN=60
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=<set>
RESEND_FROM=noreply@claw-net.org
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA
SOLANA_RECEIVING_WALLET=H6xbRyGEyoTdfBEShSt2H3oHJxL3gaJjVGdL5MLKwHN7
TELEGRAM_BOT_TOKEN=<set>
TELEGRAM_CHANNEL_ID=<set>
ADMIN_API_KEY=<set>
PLATFORM_SIGNING_SECRET=<32-byte hex — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

---

## Where to Start
**Next = Chunk 13.** Build sub-goals in order: 13A (creator payouts) → 13B (swarm tasks) → 13C (ClawGuard + governance).
