# ClawNet v3 — Claude Code Briefing
> Paste this into Claude Code (VSCode) to continue the project from where we left off.

---

## What This Project Is

ClawNet is a sovereign AI agent orchestration layer and economy. It is live in production at **claw-net.org**.

**The product:** A pay-per-use API that orchestrates Solana/DeFi data (183 endpoints), X/Twitter sentiment, and AI analysis into a single natural-language response. Users buy credits (Stripe / USDC on Solana). Built on top: a skill marketplace where anyone can publish prompt-powered capabilities and earn 97% of every purchase.

**The real moat:** The 183-endpoint registry (aggregation effort, API key costs, active maintenance) + agent-to-agent payment infrastructure (escrow, skills, P2P mesh, discovery). The routing logic alone is replicable; the registry and payment rails are not.

**The public interface:** `POST /v1/openclaw/invoke` — the OpenClaw Gateway. This IS the product for external agents. 4 actions: `query`, `skill`, `discover`, `swarm`. All routing logic stays private.

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
| Vitest | **tests/run.ts** integration tests | Basic tests exist. Vitest added in Chunk 14. |
| GitHub Actions CI | **NOT SET UP** | No CI pipeline yet. Deferred to Chunk 15+. |

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
- Ensure `ADMIN_API_KEY` is set in `/home/guardian/claw-net/.env` (min 16 chars — now enforced by Zod)

---

## Chunk Status

### ✅ CHUNKS 1–4: Core Platform (COMPLETE)
- VPS, Ubuntu, Node, Caddy (auto-TLS), UFW, fail2ban, Docker, swap
- Hono API, Pino logging, Zod validation, rate limiting (60/min/IP)
- SQLite WAL, LRU + Redis L2 cache, Clerk auth
- Intent parser (GPT-4o primary, Claude fallback) → parallel executor → LLM synthesizer
- ClawAPIs x402 integration — 183 endpoints (Solscan Pro 22, Helius 80, X/Twitter 81)
- Stripe live payments — 6 credit packages $5–$1,000
- USDC/Solana — Phantom wallet, on-chain verify, +7% bonus credits (capped at Stripe fee savings)
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
- `skills/token-analysis/skill.json` — first official skill package
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
- `site/marketplace.html` — full marketplace UI with hash routing, skill detail pages, star/unstar, security badges, category filters
- Purchase flow: buy + invoke in one call → result shown immediately (single charge, no double-billing)
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
- `maxBudget` cap + `X-Swarm-Depth` recursion guard

### 13C — ClawGuard + Governance ✅
- `src/middleware/sign-response.ts` — HMAC-SHA256 `X-ClawNet-Signature` on all orchestrate + skill responses
- `proposals` + `votes` tables + full governance routes
- Reputation gating: skills < -1.0 auto-unpublished in skill-ab-cron

---

## ✅ CHUNK 14: Testing, Docs & Launch Hardening (COMPLETE)

- `site/docs.html` — full public API reference (all routes, auth, credits, errors, code examples, ClawGuard)
- Vitest suite — 48 tests across credit, escrow, governance, skills (`npm run test:unit`)
  - `tests/unit/helpers/db.ts` — vi.mock + importOriginal pattern, in-memory SQLite
  - `tests/unit/credit.test.ts` — deductCredit, topUpCredits, atomicity
  - `tests/unit/escrow.test.ts` — state machine, fundEscrow, releaseEscrow
  - `tests/unit/governance.test.ts` — castVote, duplicates, closed proposals, auto-expire
  - `tests/unit/skills.test.ts` — createSkill, listPublicSkills, deleteSkill, revenue share
- Production monitoring: UptimeRobot configured on /v1/health (5-min polling)
- Runbook: `docs/RUNBOOK.md` — SQLite locks, mesh crashes, escrow timeouts, disk full, Redis down

## ✅ Security Audits — Rounds 1–10 (ALL COMPLETE, 48/48 unit tests pass)

**Round 10 fixes:** `stripe.ts` crash-safe atomic claim+grant transaction; `db/index.ts` `isStripeSessionClaimed()` read-only helper; `ADMIN_API_KEY` ≥ 16 chars enforced; `marketplace.ts` usdcWallet validated as Solana base58.

## ✅ Fintech & Billing Audit — ALL COMPLETE

- **A2** — USDC bonus reduced +10% → +7% (`src/routes/solana.ts`)
- **C1** — Fallback Solana RPC via `SOLANA_RPC_FALLBACK` env var (`src/routes/solana.ts`)
- **D3** — Rate limit tier policy documented in `src/routes/api.ts` (lifetime `amount_paid` basis)
- **D4** — `POST /v1/dashboard/billing-portal` — Stripe Customer Portal redirect (`src/routes/dashboard.ts`)
- **E3** — Subscription rollover capped at 3× monthly credits in `invoice.payment_succeeded` (`src/routes/stripe.ts`)
- **F4** — `scripts/loadtest.sh` — 100 concurrent requests, p50/p95/p99 report, pass/fail targets
- **G1** — Free trial code built + disabled (`FREE_TRIAL_CREDITS=0` default); activate via env var when ready
- **G2** — `GET /v1/estimate?query=` — intent-only, no credits charged, per-step breakdown (`src/routes/api.ts`)
- **G3** — Annual pricing slots via `STRIPE_ANNUAL_PRICE_100/500/1000` env vars; +15% credits over monthly
- **G4** — Per-endpoint pricing table in `site/docs.html`; `/v1/estimate` in OpenAPI spec
- **H2** — 64KB webhook payload size guard on `/v1/webhooks/*` (`src/index.ts`)
- **H3** — Stripe secret rotation procedure in `docs/RUNBOOK.md` §12
- **H4** — `logAudit(PAYOUT_STATUS)` on admin payout PATCH; audit query guide in `docs/RUNBOOK.md` §13

## ✅ Money Flow Integrity Audit — ALL COMPLETE

Comprehensive audit of all money-touching code paths (Stripe, Solana/USDC, credits, marketplace, escrow, swarm, batch). 5 bugs found and fixed:

| # | Severity | File | Bug | Fix |
|---|---|---|---|---|
| 1 | CRITICAL | `solana.ts` | `tryClaimSolanaSignature` permanently locks sig on ANY verification failure (tx not found, RPC error, amount mismatch) — user who paid USDC can never retry | Added `releaseClaimSolanaSignature()` in `db/index.ts`; call it before all non-success returns after the claim (tx not found, on-chain fail, amount mismatch, RPC error) |
| 2 | CRITICAL | `stripe.ts` | Subscription handler: `topUpCredits` + `upsertSubscription` not atomic with `markStripeEventProcessed` — Stripe retry after crash between them grants double credits | Wrapped entire `invoice.payment_succeeded` handler in one `getDb().transaction()` with INSERT OR IGNORE idempotency inside |
| 3 | HIGH | `db/index.ts` | `topUpCreditsForClerk` didn't update `amount_paid` column — repeat USDC purchases never accumulated toward tier tracking | Added `amount_paid = amount_paid + ?` to the UPDATE; added `amountPaid` param (default 0) to function signature; updated call site in `solana.ts` to pass `expectedUsd` |
| 4 | HIGH | `solana.ts` | `GET /v1/solana/packages` returned `bonusVsStripe: '+10%'` but USDC packages actually grant +7% | Changed string to `'+7%'` to match actual credit amounts |
| 5 | MEDIUM | `swarm.ts` | Pre-flight checked `credits >= maxBudget` but then deducted `SWARM_BASE_FEE=20` on top — user with exactly maxBudget credits would fail the base fee deduction | Changed required to `maxBudget + SWARM_BASE_FEE`; updated error message and hint accordingly |

**Confirmed safe (no bugs):**
- `deductCredit()` — `WHERE credits >= amount` atomic, race-safe ✅
- `marketplacePurchase()` — deduct buyer + credit seller + insert tx in one `db.transaction()` ✅
- `fundEscrow()`, `releaseEscrow()`, `refundEscrow()`, `resolveEscrow()` — all atomic ✅
- `stakeCredits()`, `unstakeCredits()` — both atomic ✅
- `claimStripeSession()` inside `getDb().transaction()` in one-time purchase handler ✅
- Batch pre-flight uses stale credits but actual protection is per-query atomic `deductCredit` ✅

---

## ✅ Marketplace Security Audit + Official Skills (COMPLETE)

### Marketplace Audit — Batch A (Security & Money Flow)
Full 26-finding audit performed. Critical fixes applied:

| Fix | Detail |
|---|---|
| **Treasury fee routing** | 3% platform fee now credited to `clawhub-treasury` key (was burned). `ensureTreasuryKey()` in `seed-skills.ts` creates it on boot. `marketplacePurchase()` in `db/index.ts` credits `feeCredits` to treasury row. |
| **Refund on failed execution** | New `marketplaceRefund()` in `db/index.ts`. Called on both failure paths in `POST /v1/marketplace/skills/:id/purchase`: missing template variables AND execution error. Reverses buyer deduction, seller credit, and treasury fee. Records `SKILL_REFUND` transaction. |
| **Self-purchase prevention (secondary key)** | `marketplacePurchase()` now queries both buyer and seller emails and rejects if they match — prevents owning two keys and buying your own skill. |
| **Price immutability** | Confirmed by architecture — no update endpoint for `credit_cost` exists. Set at creation only. |
| **Admin treasury endpoint** | `GET /v1/admin/treasury` — shows treasury balance, official creator balance, recent fee transactions, recent refunds. |

### Marketplace Audit — Batch B (7 New Official Skills)
Added to `src/core/seed-skills.ts`. All author_key = `clawhub-official`.

| ID | Name | Credits | Purpose |
|---|---|---|---|
| `wallet-profiler` | Wallet Profiler | 6 | PnL, holdings, whale classification |
| `trending-tokens` | Trending Tokens | 4 | Volume surge, social buzz, momentum |
| `whale-tracker` | Whale Tracker | 5 | Smart money movements, sentiment |
| `defi-yield-scanner` | DeFi Yield Scanner | 5 | LP APYs, lending rates, risk-adjusted |
| `token-launch-radar` | Token Launch Radar | 4 | Presales, IDOs, red flag scoring |
| `price-oracle` | Price Oracle | 3 | RSI/MACD, support/resistance, signals |
| `nft-collection-intel` | NFT Collection Intel | 5 | Floor trends, wash trading, recommendations |

### Batch C (Skill Template Upgrades)
Original 3 skills upgraded to v2.0.0 templates — richer prompts, structured numbered steps, more output fields.

| ID | Old Name | New Name | Key Upgrades |
|---|---|---|---|
| `token-analysis` | Token Analyst | Token Analyst Pro | Added liquidity depth, rug pull flags, BUY/HOLD/AVOID, `timeframe` input, `liquidityScore`+`recommendation` outputs |
| `social-sentiment` | Social Sentiment | Social Sentiment Scanner | Added Telegram/Discord, platform filter, momentum tracking, contrarian alert |
| `portfolio-optimizer` | Portfolio Optimizer | Portfolio Optimizer Pro | Added Herfindahl concentration, correlation analysis, beta vs SOL, `includeStables` input, `swaps` array output |

`seedOfficialSkills()` now also runs an **update pass** on every boot — idempotently updates name, description, prompt_template, schemas, version for all existing official skill rows (won't re-insert, just UPDATE WHERE author_key = 'clawhub-official').

**Total official skills: 10.** All verified with `tsc --noEmit` clean + 48/48 unit tests passing.

---

## ✅ BATCHES 1–8: Registry Expansion & Protocol Layer (COMPLETE)

### Batch 1 — API Registry Expansion ✅
- `src/config/api-registry.ts` — 75 → **158 endpoints**, 15 categories
- New categories: `solana | social | utility | defi | intelligence | oracle | scraping | discovery | infrastructure | search | media | enrichment | weather | ai-ml | security`
- New providers: Pinata, Firecrawl, cnvrt.ing, didit, TextBelt, Chronos, AgentMail, Jina, Tavily, Sybil, Zyte, Notte, ScrapeGraph, Nansen, Zapper, BlockSec, Dome, Spraay, dTelecom, AIBeats, Genbase, Freepik, Bittensor, QuiverAI, Tavus, Apollo, Hunter, CoreSignal, Precip, x402engine (images/audio/LLM/web/travel/IPFS), and more

### Batch 2 — x402 Provider Mode ✅
- `src/routes/x402-skills.ts` — serve ClawNet skills as x402-payable HTTP endpoints
- `POST /x402/skills/:id` — execute skill after x402 USDC payment (no credit charge)
- `GET /x402/skills` — list public skills with USDC pricing
- `GET /x402` — discovery/info endpoint
- Uses `require('@x402/hono')` CJS workaround (ESM-only package); activates only if `X402_RECIPIENT_ADDRESS` set
- `DynamicPrice` function reads skill's `credit_cost` × `X402_USDC_PER_CREDIT` from DB at request time

### Batch 3 — MCP Server ✅
- `src/mcp/server.ts` — MCP server exposing ClawNet skills as native tools for Claude Code/Cursor/VSCode
- 6 tools: `list-skills`, `get-skill`, `invoke-skill`, `search-registry`, `orchestrate`, `get-credits`
- `npm run mcp` script; `CLAWNET_BASE_URL` + `CLAWNET_API_KEY` env vars
- TS2589 deep generic suppressed with `// @ts-expect-error` on `server.tool()` calls

### Batch 4 — LLM Proxy Gateway ✅
- `src/routes/llm.ts` — OpenAI-compatible LLM proxy via x402engine
- `GET /v1/llm/models` — 23 models across OpenAI/Anthropic/Google/xAI/DeepSeek/Meta/Qwen/Mistral/Perplexity/MiniMax
- `POST /v1/llm/chat` — standard messages array, 15% markup, 5-min response cache
- `POST /v1/llm/embeddings` — 2 credits/call
- `POST /v1/llm/code/run` — sandboxed Python/JS/TS execution, 10 credits

### Batch 5 — Skill Category Taxonomy ✅
- DB migration v25: `category TEXT NOT NULL DEFAULT 'general'` on skills table
- 12 categories: `general | defi | security | social | ai | search | media | enrichment | utility | infrastructure | weather | analytics`
- `site/marketplace.html` — category pill filters with icons, card badges, publish form category select
- `src/routes/skills.ts` `CreateSkillSchema` — `category` enum field

### Batch 6 — Endpoint Health Dashboard ✅
- `src/core/endpoint-health-cron.ts` — HEAD-pings 12 provider base URLs every 5 min, rolling avg latency
- DB migration v29: `endpoint_health` table (`endpoint_id`, `last_status`, `avg_latency_ms`, `uptime_pct`, `success_count`, `failure_count`, `last_checked`, `last_error`)
- `src/routes/registry.ts` — `GET /v1/registry` (search/filter 158 endpoints), `GET /v1/registry/health` (live status + summary), `GET /v1/registry/:id`

### Batch 7 — API Proxy Skill Type ✅
- DB migrations v26–v28: `skill_type`, `proxy_url`, `proxy_method` columns on skills
- `src/routes/skills.ts` — `CreateSkillSchema` accepts `skillType` / `proxyUrl` / `proxyMethod`
- Invoke handler: if `skill_type === 'api_proxy'`, fetches `proxy_url` directly with variables as body (no LLM pipeline); 15s timeout

### Batch 8 — Multi-chain x402 Config ✅
- `src/config/index.ts` — `EVM_PRIVATE_KEY` optional env var (Base/EVM wallet for paying x402 APIs on Base chain)

---

## ✅ CHUNK 15+: Deferred (Next Priorities)

- `scripts/loadtest.sh` exists — run it against production when ready (target: p95 < 5s, 0 server errors)
- GitHub Actions CI pipeline — not yet set up
- **User acquisition** (see Distribution Strategy below — this is the actual next step)

---

## Distribution & Product Strategy (Read Before Building Features)

> This section captures hard-won strategic thinking. Read it before deciding what to build next.

### What the Actual Moat Is

The routing logic (intent parser → executor → formatter) is replicable in a weekend. The real moat candidates, in order:
1. **183-endpoint registry** — aggregation effort, upstream API keys, cost tracking, maintenance
2. **Credit/payment infrastructure** — Stripe + USDC, already working in production
3. **Agent-to-agent payment rails** — escrow, skills economy, built but unused
4. **Creator network effects** — foundation set (10 official skills live, 0 third-party creators yet)

### The Correct Next Step: Get Paying Users, Not More Features

The platform is technically complete. The constraint is users, not code. Before any distribution decision:

**Phase 0 (NOW):** Get 5 paying API users via direct outreach
- Target: Solana dev communities (Superteam, Solana Discord, DeFi builder Telegram groups)
- Offer: $20 in free starter credits
- Watch: what queries they run, what fails, what's slow, what costs too much
- Success signal: a user returns after week 1 and tops up credits

**Do not** publish to external marketplaces until you have 10+ paying users who return after week 1.

### Distribution Channel Strategy

| Channel | Purpose | Timing | What Gets Listed |
|---|---|---|---|
| Direct API (claw-net.org) | Primary revenue | **NOW** | Full OpenClaw gateway |
| ClawHub | Discovery / credibility signal | After 10+ paying users | Thin wrapper skill only |
| claw-net.org Marketplace | Creator economy showcase | After 10+ third-party skills | Featured first-party skill |

### The OpenClaw Gateway IS the Public Interface

`POST /v1/openclaw/invoke` is already the right architecture. It is the thin, stable public contract. Do not build a separate skill wrapper until someone asks for it. The interface:

```typescript
// Input (already validated by InvokeSchema)
{ action: "query",    query: string }
{ action: "skill",   skillId: string, variables?: Record<string, string> }
{ action: "discover", query: string, limit?: number }
{ action: "swarm",   task: string, skills?: string[], maxSubTasks?: number }

// Output (always the envelope)
{ ok: true, requestId, action, result, credits: { used, remaining }, meta }
```

### What Stays Private (Never Expose)

- Intent parsing prompts and logic (`src/core/intent-parser.ts`)
- Endpoint selection algorithms (`src/core/executor.ts`)
- API registry with upstream keys (`src/config/api-registry.ts`)
- Credit formulas and pricing engine (`src/core/credits.ts`)
- Caching strategies, A/B logic, all DB schemas

### ClawHub Strategy (When the Time Comes)

- Skill should be a 20-line prompt template that calls `/v1/openclaw/invoke` — zero logic in the skill
- Free tier: 100 credits for first-time ClawHub users (acquisition cost only)
- Clear "Full access at claw-net.org" upsell in every response
- ClawHub tier: slightly worse pricing than direct (fewer credits, no USDC option, no bonus tiers)
- Platform dependency mitigation: keep the ClawHub skill trivially replaceable

### Avoiding Channel Conflict

ClawHub = discovery. claw-net.org = monetization. They are not the same thing. Never put your full pricing, credit system, or USDC bonuses on ClawHub. Force serious users to your platform.

### Security Guardrails Required Before Any Public Release

- ✅ Rate limiting (tiered by amount paid)
- ✅ Credit checks before execution
- ✅ SWARM_BASE_FEE upfront, maxSubTasks cap
- ✅ Prompt template variable validation (Zod `z.record(z.string().max(500))`)
- ✅ Error messages sanitized in production
- ✅ Execution only against hardcoded registry (no freeform URLs)
- ✅ Per-key daily spend cap — `DAILY_SPEND_CAP` env var (default 0 = disabled; agents spend freely until balance runs out)
- ✅ Admin key revocation — `POST /v1/admin/revoke-key` `{ key?, email?, reason? }`, logs `KEY_REVOKED`
- ✅ Anomaly detection — email `ADMIN_EMAIL` when key crosses `ANOMALY_THRESHOLD` credits/day (default 5K)
- ✅ Load test script ready (`scripts/loadtest.sh`) — run against production to verify p95 < 5s
- ✅ GitHub Actions CI — `.github/workflows/ci.yml` (typecheck + unit tests on push/PR)

### What to Log / Never Log

**Log:** requestId, timestamp, action type, duration, credit cost, success/failure, query text (truncated to 200 chars), selected endpoints, cache hits, error types (aggregated)

**Never log:** Full API keys (mask to first6...last4), full USDC wallet addresses, raw upstream API responses, LLM prompts containing user queries, Stripe webhook payloads

### Pricing Model

Stay with per-request credits. Add monthly subscription only after 5+ users ask for predictable pricing. Current formula is correct: `max(1, ceil(apiCosts * 2000))`.

### Top Mistakes to Avoid

1. Publishing to ClawHub before having paying users — you'd optimize discovery for an unvalidated product
2. Putting routing logic in a skill definition — SKILL.md should be description + schema only
3. Treating ClawHub free-tier clicks as demand signal — only count credit purchasers
4. Building marketplace features before having marketplace supply (recruit 5 creators manually first)
5. Competing with ClawHub publicly before your marketplace has traction — position as complementary
6. Underpricing to attract users — your upstream API costs are real; subsidizing loses money
7. Over-engineering skill packaging before testing the API directly
8. Ignoring the cold start problem — the flywheel doesn't self-start; manually seed both sides
9. Adding power-user config knobs to the public interface — every option is an attack surface
10. Forgetting the registry is the moat — invest in expanding it, not just the routing logic

---

## Product Viability Notes

**The beachhead:** Solana/DeFi data + AI analysis packaged as a pay-per-use API. 183 endpoints, no subscription. This is the wedge.

**The flywheel:** Paying orchestration users → marketplace traffic → skill creators join → more skills → more buyers → more creators. This does NOT self-start. Both sides need to be manually seeded.

**What needs to happen before the flywheel starts:**
1. 5 paying orchestration API users (direct outreach, not marketplace) — signal: they return after week 1
2. Fix the top pain points discovered from those 5 users
3. 10 paying users total, each with >1 credit purchase
4. Manually recruit 3-5 skill creators (may need to pay them or build the skills yourself)
5. 10+ real skills in marketplace (currently 3 seeded, 0 third-party)

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
    api.ts                    — POST /v1/orchestrate, GET /v1/estimate
    openclaw.ts               — POST /v1/openclaw/invoke (universal gateway)
    skills.ts                 — skill CRUD + invoke + A/B
    marketplace.ts            — marketplace + staking + creator stats
    escrow.ts                 — escrow state machine
    discover.ts               — POST /v1/discover (trinity)
    mesh.ts                   — GET /v1/mesh/peers
    stats.ts                  — GET /v1/stats (public) — includes activeUsers (api_keys WHERE active=1 AND credits>=1)
    admin.ts                  — admin routes (ADMIN_API_KEY)
    stripe.ts, solana.ts      — payment routes
    dashboard.ts              — dashboard routes + POST /v1/dashboard/billing-portal
    feedback.ts, referral.ts, endpoints.ts, contact.ts
    batch.ts                  — POST /v1/batch (parallel multi-query)
    stream.ts                 — GET /v1/stream/orchestrate (SSE)
    swarm.ts                  — POST /v1/swarm/task
    llm.ts                    — GET /v1/llm/models, POST /v1/llm/chat (OpenAI-compat), /embeddings, /code/run
    registry.ts               — GET /v1/registry, /v1/registry/health, /v1/registry/:id
    x402-skills.ts            — POST /x402/skills/:id, GET /x402/skills, GET /x402
  mcp/server.ts               — MCP server (npm run mcp) — list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits
  core/
    endpoint-health-cron.ts   — HEAD-pings 12 providers every 5 min, writes endpoint_health table
    discovery-engine.ts       — trinity aggregation
    embeddings.ts             — ONNX embed()
    seed-embeddings.ts        — seeds 183 endpoints
    seed-skills.ts            — seeds 3 official skills on startup
    escrow-cron.ts            — 10min: expired escrow cleanup
    skill-ab-cron.ts          — 30min: A/B auto-promote
    formatter.ts              — LLM response synthesis
    heartbeat.ts
  mesh/node.ts                — libp2p startMeshNode/stopMeshNode
  utils/shutdown.ts           — SIGTERM/SIGINT handlers
  integrations/telegram.ts
site/
  index.html                  — landing page; hero shows live USERS stat (active keys w/ credits) via /v1/stats
  marketplace.html            — skill marketplace (hash routing, skill detail pages)
  dashboard.html              — user dashboard
  docs.html                   — public API reference
  endpoints.html, login.html, success.html, admin.html
skills/token-analysis/        — official skill package
docs/
  escrow-design.md
  SKILL.md
  RUNBOOK.md
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

// Audit log (use for all state changes — fire-and-forget, never throws)
logAudit({ entityType: 'x', entityId: id, action: 'ACTION', actorId: key, data: {} })

// nanoid for IDs
const { nanoid } = await import('nanoid')
const id = nanoid(16)

// topUpCredits — always pass explicit amountPaid for Stripe purchases (bonus tiers inflate credits)
topUpCredits(apiKey, credits, stripeSessionId, amountPaid)
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
SOLANA_RPC_FALLBACK=<optional secondary RPC URL>
TELEGRAM_BOT_TOKEN=<set>
TELEGRAM_CHANNEL_ID=<set>
ADMIN_API_KEY=<set, min 16 chars>
PLATFORM_SIGNING_SECRET=<32-byte hex — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# Optional — activate when ready:
# CLERK_WEBHOOK_SECRET=whsec_...        (free trial — also register endpoint in Clerk dashboard)
# FREE_TRIAL_CREDITS=100               (free trial credits on signup, default 0 = disabled)
# STRIPE_ANNUAL_PRICE_100=price_...    (annual $1,200/yr → 1,612,800 credits)
# STRIPE_ANNUAL_PRICE_500=price_...    (annual $6,000/yr → 8,280,000 credits)
# STRIPE_ANNUAL_PRICE_1000=price_...   (annual $12,000/yr → 17,940,000 credits)
```

---

## Where to Start

**Chunks 1–14 are COMPLETE. Fintech audit backlog is COMPLETE. All security guardrails are COMPLETE. GitHub Actions CI is LIVE.**

**Next priority: user acquisition, not more features.**

1. Outreach to 5 Solana/DeFi developers — offer free starter credits, watch what they query
2. Fix the top 3 pain points they surface
3. Once 10 paying users exist: run `scripts/loadtest.sh` against production
4. Once 10+ paying users return after week 1: consider thin ClawHub wrapper skill

The code is production-ready. The constraint is users.
