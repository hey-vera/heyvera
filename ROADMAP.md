# ClawNet — Project Roadmap & Briefing

> **Vision:** ClawNet is the sovereign orchestration layer for the x402 and OpenClaw ecosystem — the intelligence router between AI agents, real-time data, and micropayment rails across Solana and beyond.

---

## What This Project Is

**Product:** A pay-per-use API that orchestrates Solana/DeFi data (183 endpoints), X/Twitter sentiment, and AI analysis into a single natural-language response. Users buy credits (Stripe / USDC on Solana). On top: a skill marketplace where anyone can publish prompt-powered capabilities and earn 97% of every purchase.

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
- `sudo ufw allow 4001/tcp` — open libp2p swarm port (Chunk 5)
- Ensure `ADMIN_API_KEY` ≥ 16 chars in `/home/guardian/claw-net/.env`

---

## Chunk Status

### ✅ Chunks 1–4: Core Platform
- Hono API on port 3402, SQLite WAL, Redis L2 cache, Pino logging, Zod env validation
- Intent parser (GPT-4o primary, Claude fallback) → parallel executor → LLM synthesizer
- Circuit breaker per endpoint (CLOSED → OPEN → HALF_OPEN)
- ClawAPIs x402 integration successfull — added more endpoints, simulation mode when no SOLANA_PRIVATE_KEY
- Stripe live payments — 6 credit packages $5–$1,000
- USDC/Solana — Phantom wallet, on-chain verify, +7% bonus credits
- Credit formula: `max(1, ceil(apiCosts * 2000))`, 1 credit = $0.001
- Resend email, Telegram grammY bot, admin dashboard, contact form, referral codes
- Security: HSTS headers, atomic credit deduction (`WHERE credits >= amount`), rate limiting (60/min/IP)

### ✅ Chunk 5: P2P Mesh Network
- `libp2p`, `@libp2p/tcp`, `@libp2p/noise`, `@libp2p/kad-dht`, `@libp2p/ping`, `@chainsafe/libp2p-yamux`
- `src/mesh/node.ts` — `startMeshNode()`, `stopMeshNode()`, `getMeshNode()`
- `src/routes/mesh.ts` — `GET /v1/mesh/peers`
- `peers` table, `upsertPeer()`, `getPeers()`, graceful start/stop in app lifecycle

### ✅ Chunk 6: Vector Search & Embeddings
- `src/core/embeddings.ts` — ONNX all-MiniLM-L6-v2 via @huggingface/transformers, exponential backoff on failure
- `src/core/seed-embeddings.ts` — seeds all available endpoints into discovery_cache
- `src/routes/discover.ts` — `POST /v1/discover` (rewired to discovery-engine)
- `skill_embeddings` virtual table (sqlite-vec), `discovery_cache` table

### ✅ Chunk 7: Escrow & Trustless Hiring
- `src/routes/escrow.ts` — full CRUD: create, fund, start, complete, release, dispute, evidence, resolve
- `src/core/escrow-cron.ts` — every 10 min: expired FUNDED→REFUNDED, WIP→DISPUTED (concurrency guard)
- `escrows` + `audit_log` tables, full state machine, `docs/escrow-design.md`

### ✅ Chunk 8: Skill System — Part 1
- `src/routes/skills.ts` — POST /v1/skills, GET, GET /mine, GET /:id, POST /:id/invoke, PATCH visibility, DELETE
- Revenue share: author earns portion of credits per invocation; skill-level cache
- Reputation recording on invoke (+0.1 success, -0.05 failure)

### ✅ Chunk 9: Skill System — Part 2
- A/B testing: `POST /v1/skills/:id/fork`, `POST /v1/skills/:id/promote`
- 30% traffic to challenger when `ab_challenger` set
- `src/core/skill-ab-cron.ts` — every 30 min: auto-promote if +10% success rate (min 20 invocations), concurrency guard

### ✅ Chunk 10: Discovery Trinity
- `src/core/discovery-engine.ts` — semantic (60%) + P2P (25%) + on-chain mock (15%)
- `src/config/discovery.json` — configurable weights, graceful degradation

### ✅ Chunk 12: Marketplace & Economics
- `src/routes/marketplace.ts` — GET /skills, GET /:id, POST /:id/purchase, GET /transactions, POST /stake, POST /unstake, GET /stakes, GET /creator/stats
- Purchase flow: buy + invoke in one call → result shown immediately (single charge, no double-billing)
- `transactions` + `stakes` tables, 3% platform fee, 97% to creator, atomic SQLite transactions
- `site/marketplace.html` — full marketplace UI with hash routing, skill detail pages, star/unstar, security badges, category filters

### ✅ Chunk 13: Swarms, Governance & Creator Payouts
- **13A** — `payout_requests` table, `POST /v1/marketplace/creator/withdraw` (min 1000cr), admin payout management
- **13B** — `swarms` table, `POST /v1/swarm/task` (202 async), `GET /v1/swarm/:id`; LLM decomposes → parallel skill invocations → LLM synthesis; `maxBudget` cap (pre-allocated per subtask), `X-Swarm-Depth` recursion guard
- **13C** — `src/middleware/sign-response.ts` — HMAC-SHA256 `X-ClawNet-Signature`; proposals + votes tables + governance routes

### ✅ Chunk 14: Testing, Docs & Launch Hardening
- `site/docs.html` — full public API reference
- 48 Vitest unit tests across credit, escrow, governance, skills (`npm run test:unit`)
- `docs/RUNBOOK.md` — SQLite locks, mesh crashes, escrow timeouts, disk full, Redis down
- GitHub Actions CI — `.github/workflows/ci.yml` (typecheck + unit tests on push/PR)

---

## ✅ Batches 1–8: Registry Expansion & Protocol Layer

| Batch | What Was Built |
|---|---|
| **1** | API registry: 75 → 158 endpoints, 15 categories (solana/social/utility/defi/intelligence/oracle/scraping/discovery/infrastructure/search/media/enrichment/weather/ai-ml/security) |
| **2** | `src/routes/x402-skills.ts` — serve skills as x402 payable endpoints (Base/USDC). Uses `require('@x402/hono')` CJS workaround. Activates only if `X402_RECIPIENT_ADDRESS` set. |
| **3** | `src/mcp/server.ts` — MCP server for Claude Code/Cursor/VSCode. 6 tools: list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits. `npm run mcp` |
| **4** | `src/routes/llm.ts` — LLM proxy: `GET /v1/llm/models` (23 models), `POST /v1/llm/chat` (OpenAI-compat), `/embeddings`, `/code/run`; 15% markup |
| **5** | DB migration v25: `category` column on skills. 12 category pills in marketplace.html. |
| **6** | `src/core/endpoint-health-cron.ts` — HEAD-pings 12 providers every 5 min; `endpoint_health` table (migration v29); `GET /v1/registry`, `/v1/registry/health`, `/v1/registry/:id` |
| **7** | `skill_type` / `proxy_url` / `proxy_method` columns (migrations v26-v28); API proxy invoke path (no LLM, 15s timeout) — credits deducted only on `proxyRes.ok` |
| **8** | `EVM_PRIVATE_KEY` optional env var for Base/EVM x402 payments |

---

## ✅ Marketplace Security Audit — ALL COMPLETE

| Fix | Detail |
|---|---|
| **Treasury fee routing** | 3% fee credited to `clawhub-treasury` key. `ensureTreasuryKey()` in `seed-skills.ts` creates it on boot. `marketplacePurchase()` credits `feeCredits` to treasury row. |
| **Pre-validate before payment** | Template variables validated BEFORE `marketplacePurchase()` — no unnecessary refund transactions |
| **Refund on failed execution** | `marketplaceRefund()` in `db/index.ts`. Reverses buyer deduction, seller credit, treasury fee. Records `SKILL_REFUND`. |
| **Self-purchase prevention** | `marketplacePurchase()` rejects if buyer/seller emails match (prevents secondary-key attack) |
| **Admin endpoints** | `GET /v1/admin/treasury`, `GET /v1/admin/revenue` |

**Official skills (10 total):** token-analysis (5cr), social-sentiment (3cr), portfolio-optimizer (8cr), wallet-profiler (6cr), trending-tokens (4cr), whale-tracker (5cr), defi-yield-scanner (5cr), token-launch-radar (4cr), price-oracle (3cr), nft-collection-intel (5cr). All v2.0.0. `seedOfficialSkills()` runs update pass on every boot.

---

## ✅ Money Flow Integrity Audit — ALL COMPLETE

| # | Severity | Bug | Fix |
|---|---|---|---|
| 1 | CRITICAL | `solana.ts`: `tryClaimSolanaSignature` permanently locked sig on verify failure | Added `releaseClaimSolanaSignature()`, call on all non-success paths |
| 2 | CRITICAL | `stripe.ts`: subscription `topUpCredits` + `markStripeEventProcessed` not atomic | Wrapped `invoice.payment_succeeded` in one `getDb().transaction()` with INSERT OR IGNORE |
| 3 | HIGH | `db/index.ts`: `topUpCreditsForClerk` didn't update `amount_paid` | Added `amount_paid = amount_paid + ?`, pass `expectedUsd` from call sites |
| 4 | HIGH | `solana.ts`: packages advertised `+10%` but granted `+7%` | Corrected string to `'+7%'` |
| 5 | MEDIUM | `swarm.ts`: pre-flight checked `credits >= maxBudget` but SWARM_BASE_FEE=20 deducted on top | Changed to `credits >= maxBudget + SWARM_BASE_FEE` |

---

## ✅ Quality Fix Audit (Current Session)

| Chunk | Fixes |
|---|---|
| **1 — Financial** | API proxy credits deducted only on `proxyRes.ok`; swarm uses pre-allocated `budgetPerSubtask` (no shared mutable state); marketplace pre-validates variables before payment |
| **2 — Cron Safety** | `_running` concurrency guard in escrow-cron, skill-ab-cron, endpoint-health-cron; embedding model exponential backoff on repeated load failures |
| **3 — Frontend** | `marketplace.html`: `encodeURIComponent()` on skill IDs in `nav()` onclick; `dashboard.html`: optional chaining on all `Clerk?.session?.getToken()` calls; USDC state reset in `closeUSDCModal()` |
| **4 — DB Hardening** | `CREATE INDEX idx_skills_public_active ON skills(public, active)`; `cleanupOldAuditLogs(90)`, `cleanupOldSkillMetrics(90)`, `cleanupOldSolanaSigs(30)` — wired to endpoint-health-cron (daily guard) |
| **5 — API Consistency** | `src/utils/mask.ts` → `maskApiKey()` (first4+••••+last4); replaced all ad-hoc masking in marketplace.ts, admin.ts, api.ts; email required in `POST /v1/solana/verify` |
| **6 — Code Polish** | Circuit breaker `MAX_CIRCUITS=500` hard cap in cleanup interval; logger redact paths expanded with `**.credentials`, `**.credential` |

---

## ✅ Fintech & Billing Backlog — ALL COMPLETE

- **A2** — USDC bonus +10% → +7% (capped at Stripe fee savings)
- **C1** — Fallback Solana RPC via `SOLANA_RPC_FALLBACK` env var
- **D3** — Rate limit tier documented (lifetime `amount_paid` basis)
- **D4** — `POST /v1/dashboard/billing-portal` — Stripe Customer Portal redirect
- **E3** — Subscription rollover capped at 3× monthly credits
- **F4** — `scripts/loadtest.sh` — 100 concurrent requests, p50/p95/p99 report
- **G1** — Free trial code built + disabled (`FREE_TRIAL_CREDITS=0` default)
- **G2** — `GET /v1/estimate?query=` — intent-only, no credits charged
- **G3** — Annual pricing slots via `STRIPE_ANNUAL_PRICE_*` env vars
- **G4** — Per-endpoint pricing table in `site/docs.html`; in OpenAPI spec
- **H2** — 64KB webhook payload size guard
- **H3** — Stripe secret rotation procedure in `docs/RUNBOOK.md`
- **H4** — `logAudit(PAYOUT_STATUS)` on admin payout PATCH

---

## ✅ Marketplace Quality Batch (Latest Session)

### Bug Fixes
- **Tab switching root cause fixed** — Added missing `.tab-panel { display: none }` / `.tab-panel.active { display: block }` CSS rules. All main tabs (Browse/Publish/My Skills/Starred/How It Works) were showing simultaneously.
- **OFFICIAL set expanded** — Frontend's `OFFICIAL` Set updated from 3 → 10 skills (all Batch B skills added).
- **Double-encoding fixed** — `decodeURIComponent` in `handleRoute` prevents double-encoding when `nav()` and `loadSkillDetail` both called `encodeURIComponent`.
- **License info section** — Added to publish form: descriptions for MIT, MIT-0, Apache 2.0, GPL 3.0, Proprietary. Accept-terms checkbox moved inside the license info block.

### Security — Prompt Injection Scanner
- `src/core/skill-scanner.ts` — 14 regex patterns detect: prompt injection, system marker override, credential extraction, code execution, base64 obfuscation, XSS, SQL injection, env access.
- Wire in `skills.ts` POST create handler — every new user skill scanned on publish. Sets `security_status` to `CLEAN` or `SUSPICIOUS`. Official skills bypass scanner (seed sets `VERIFIED`).
- `updateSkillSecurityStatus()` DB helper added to `db/index.ts`.

### Security — Community Reporting
- DB migration v30: `skill_reports` table (`skill_id`, `reporter_key`, `reason`, `UNIQUE(skill_id, reporter_key)`).
- `reportSkill()` — one report per user per skill. Auto-flags skill (`FLAGGED`) at 3+ reports if not already `VERIFIED`.
- `POST /v1/marketplace/skills/:id/report` — requires auth, returns report count.
- Report button added to skill detail view in marketplace.html.

### Fee Model Fixes
- **Official skills fee-exempt** — `marketplacePurchase()` and `calcFee()` return `feeCredits = 0` when `sellerKey === 'clawhub-official'`. Moving credits between platform-owned keys is pointless.
- **Minimum 1-credit fee** — Third-party skills priced ≥10 credits pay at least 1 credit fee (prevents `Math.floor` rounding to 0 for cheap skills).
- **Cost breakdown in detail view updated** — Now shows correct fee and seller-receives for official vs. third-party skills.
- **`calcFee()` helper** — centralizes fee logic so both GET detail and POST purchase use same rules.

### Marketplace Enhancements
- **Official skills → VERIFIED** — `seed-skills.ts` INSERT and UPDATE queries now set `security_status = 'VERIFIED'`, `scanned_at = datetime('now')`. Applies on every boot (update pass).
- **VERIFIED badge CSS** — `.sec.verified` and `.sec.suspicious` added. `secCls`/`secTxt` JS maps updated in both card and detail views.
- **Version history tab** — `History` tab in skill detail page. Lazy-loads from `GET /v1/marketplace/skills/:id/versions` on first click. Renders version, changelog, and date.
- **`GET /v1/marketplace/skills/:id/versions`** — Returns version history from `skill_versions` table (changelog column from migration v24).
- **`GET /v1/marketplace/search?q=`** — Marketplace text search endpoint.
- `getSkillVersionHistory()` and `reportSkill()` exported from `db/index.ts`.

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

### Chunk 10B — Discovery Trinity Enhancements
- Capability broadcast — nodes announce supported skills/endpoints
- Intent routing — queries routed to best-equipped peer
- Reputation DHT — peer ratings in Kademlia, keyed by peer ID

### Chunk 11 — Webhook Subscriptions
- `POST /v1/webhooks/subscribe` — register URL for events
- Events: `token.alert`, `wallet.activity`, `sentiment.spike`, `skill.invoked`
- Delivery retry with exponential backoff, HMAC signature on outbound

### Chunk 12B — Agent Identity (DID)
- Each ClawNet key gets a DID on Solana
- Skills signed by author DID — verifiable provenance
- DID resolution via libp2p DHT

---

## Planned: Long Term

### Chunk 15 — Multi-Chain Expansion
- Ethereum/Base USDC payments via x402
- Cross-chain portfolio views
- Bridge monitoring (Wormhole, deBridge alerts)

### Chunk 16 — Enterprise Features
- Team API keys (org-level billing, member key management)
- SSO / SAML for enterprise dashboards
- SLA tiers, dedicated nodes, usage exports (CSV/JSON)

---

## Key File Paths

```
src/
  index.ts                    — Hono app, route registration, startup
  db/index.ts                 — ALL tables + helpers (no ORM); migrations run in runMigrations()
  config/index.ts             — Zod env validation
  config/api-registry.ts      — 158 endpoint definitions
  config/discovery.json       — Trinity weights
  middleware/auth.ts          — X-API-Key checkApiKey middleware
  middleware/clerk-auth.ts    — Clerk JWT clerkAuth middleware
  middleware/rate-limit.ts    — 60 req/min/IP
  utils/mask.ts               — maskApiKey() helper (first4+••••+last4)
  utils/shutdown.ts           — SIGTERM/SIGINT handlers
  utils/logger.ts             — pino logger with redact paths
  routes/
    api.ts                    — POST /v1/orchestrate, GET /v1/estimate
    openclaw.ts               — POST /v1/openclaw/invoke (universal gateway)
    skills.ts                 — skill CRUD + invoke + A/B
    marketplace.ts            — marketplace + staking + creator stats
    escrow.ts                 — escrow state machine
    discover.ts               — POST /v1/discover (trinity)
    mesh.ts                   — GET /v1/mesh/peers
    swarm.ts                  — POST /v1/swarm/task
    llm.ts                    — GET /v1/llm/models, POST /v1/llm/chat, /embeddings, /code/run
    registry.ts               — GET /v1/registry, /health, /:id
    x402-skills.ts            — POST /x402/skills/:id, GET /x402/skills, GET /x402
    admin.ts, dashboard.ts, stripe.ts, solana.ts, stats.ts
    batch.ts, stream.ts, feedback.ts, referral.ts, contact.ts
  mcp/server.ts               — MCP server (npm run mcp)
  core/
    endpoint-health-cron.ts   — HEAD-pings providers every 5 min + daily retention cleanup
    escrow-cron.ts            — 10 min: expired escrow cleanup
    skill-ab-cron.ts          — 30 min: A/B auto-promote
    discovery-engine.ts       — trinity aggregation
    embeddings.ts             — ONNX embed() with backoff
    seed-skills.ts            — seeds 10 official skills on startup
    seed-embeddings.ts        — seeds 158 endpoints into discovery_cache
    formatter.ts, intent-parser.ts, executor.ts, credits.ts
    circuit-breaker.ts        — MAX_CIRCUITS=500 cap
  mesh/node.ts                — libp2p startMeshNode/stopMeshNode
  integrations/telegram.ts
site/
  index.html, marketplace.html, dashboard.html, docs.html
  login.html, success.html, admin.html, endpoints.html
docs/
  RUNBOOK.md, escrow-design.md, SKILL.md
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
SOLANA_RPC_FALLBACK=<optional>
TELEGRAM_BOT_TOKEN=<set>
TELEGRAM_CHANNEL_ID=<set>
ADMIN_API_KEY=<set, min 16 chars>
PLATFORM_SIGNING_SECRET=<32-byte hex>
# Optional:
# CLERK_WEBHOOK_SECRET=whsec_...
# FREE_TRIAL_CREDITS=100
# STRIPE_ANNUAL_PRICE_100=price_...
# X402_RECIPIENT_ADDRESS=0x...
# EVM_PRIVATE_KEY=<Base/EVM wallet>
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
5. **Simulation mode always works** — no `SOLANA_PRIVATE_KEY` = mock data, server still runs
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
