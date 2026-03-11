# ClawNet — Project Memory

> Internal reference for how the system currently functions. Updated when internals change.

---

## Orchestration Engine

**Startup:** initDb → seedSkills → initRedis → initClawApis → shutdown handlers → heartbeat → Telegram (try/catch isolated) → mesh (try/catch isolated) → crons → embeddings (background) → serve. Structured boot log: `{ port, env, simulation, llm, redis, signing, x402, freeTrial, rateLimit }`.

**Shutdown:** SIGTERM/SIGINT → stop HTTP (no new connections) → 15s drain (covers SSE streams + batch queries) → stop crons/heartbeat → stop mesh/Telegram → close DB → close Redis (5s timeout) → exit. 30s force-kill deadline.

**Request flow:** Query → rate limit (60/min/IP, tiered per-key, headers on every response) → auth → intent parser → executor → synthesizer → cache → signed response. Health endpoint (`/health`) is registered BEFORE the middleware stack — bypasses CORS, security headers, rate limiter, body limit, and hono logger for zero-overhead monitoring.

**Intent parsing:** 12 regex plan templates match ~60-80% of queries (skip LLM). Fallback: fast LLM (`claude-haiku-4-5-20251001` / `gpt-4o-mini`). `parallelGroups` indices remapped after hallucinated endpoint filtering. Retry includes correction hint.

**Execution:** Parallel API calls via `executePlan()`. Per-endpoint circuit breaker (CLOSED→OPEN→HALF_OPEN, MAX_CIRCUITS=500, 7-day auto-reset, `probing` flag prevents thundering herd). Smart cache TTLs (metadata 24h, prices 60s, holders 30min, social 10min).

**Synthesis:** Smart LLM (`claude-sonnet-4-20250514` / `gpt-4o`). XML breakout prevention: `<api-data>` and `</api-data>` tags escaped in API response data. Fallback shows clean message not raw JSON.

**Credit billing:** `creditsForApiCost()` in `src/core/credits.ts` is the single source of truth. Formula: `max(1, ceil(apiCosts * 2000))`. Cache hits: 1 credit flat. Daily spend tracking + anomaly detection + low-balance email alerts.

**Batch:** `POST /v1/batch` — up to 10 parallel queries, MAX_BATCH_STEPS=30 total. Credits deducted upfront atomically, excess refunded after execution.

**SSE streaming:** `GET /v1/stream/orchestrate` — minimum 10-credit pre-check. `streamCounted` flag prevents double-decrement on disconnect. Max 5 concurrent streams per key.

---

## API Registry & Endpoints

163 endpoints across 15 categories (solana, social, utility, defi, intelligence, oracle, scraping, discovery, infrastructure, search, media, enrichment, weather, ai-ml, security). Defined in `src/config/api-registry.ts`.

Health monitoring: HEAD pings every 5 min (`endpoint-health-cron.ts`), daily retention cleanup. `GET /v1/registry`, `/v1/registry/health`, `/v1/registry/:id`.

---

## Skill System

**Types:** `prompt_template` (LLM pipeline) and `api_proxy` (direct proxy, no LLM, 15s timeout). Skills with `execution_plan_json` bypass LLM intent parser for deterministic routing.

**Revenue:** 97% creator / 3% platform fee (official skills exempt). Min 1-credit fee for third-party ≥10cr. Transaction type: `SKILL_SALE`. Reputation: +0.1 success / -0.05 failure.

**A/B testing:** Fork creates challenger, 30% traffic split. Auto-promote cron (30min) at +10% success rate threshold. Cron checks challenger still active before evaluating.

**Security:** 18-pattern scanner on publish, fork, AND invoke-time variable values. Unicode-normalized input (zero-width chars, fullwidth ASCII stripped). Security statuses: CLEAN → SUSPICIOUS → VERIFIED → FLAGGED. Auto-flag at 3+ community reports. FLAGGED = blocked from invoke AND purchase.

**10 official skills** seeded on boot by `clawhub-official` (all v2.0.0, VERIFIED, deterministic execution plans).

---

## Marketplace

Purchase = invoke in single call (result shown immediately). Ratings: verified buyers only (checks `SKILL_SALE` transaction). View count rate-limited per IP. Featured skills admin-toggled.

Creator tools: stats dashboard, withdrawal requests (min 1000cr, max 3 pending). Payout calc: `SUM(amount_credits - fee_credits)` (net, not gross). Star/unstar: fully atomic (transactions).

---

## Payments & Credits

**Stripe:** 6 packages ($5-$1K), Scout subscription $29/mo→40K credits. Idempotent webhooks via `stripe_refunded_charges` table. Proportional refund credit calc.

**USDC/Solana:** Phantom wallet, on-chain signature verify, +7% bonus. `releaseClaimSolanaSignature()` on all non-success paths.

**x402:** Consumer mode (pay ClawAPIs via Solana, needs `SOLANA_PRIVATE_KEY`). Provider mode (serve skills on Base/USDC, needs `X402_RECIPIENT_ADDRESS`).

`isSimulationMode = !env.SOLANA_PRIVATE_KEY` — blocks prompt_template skills, api_proxy still works.

---

## Task API

`POST /v1/tasks` — async skill execution with idempotency-key dedup, A/B routing, webhook callback. `GET /v1/tasks`, `GET /v1/tasks/:id`, cancel, rate. `GET /v1/auth/me`, `/estimate`, `/usage`.

---

## P2P Mesh & Discovery

**libp2p:** TCP transport, Noise encryption, Yamux muxer, Kademlia DHT, ping service. Max 50 connections. `peers` table persisted to SQLite. Port 4001. `stopMeshNode()` try/catch-safe for clean shutdown.

**Peer lifecycle:** `getPeers()` filters to last 24h (max 500 rows). `pruneStalePeers()` removes >7-day entries (runs in escrow cron alongside discovery cache cleanup).

**Discovery Trinity:** semantic 60% + P2P 25% + on-chain mock 15% (configurable via `discovery.json`). ONNX all-MiniLM-L6-v2 embeddings. `POST /v1/discover`. `skill_embeddings` virtual table (sqlite-vec). Partial weight overrides auto-normalized to sum=1.0. P2P/onchain word matching filters ≤2-char words to prevent false matches. Discovery queries logged at debug level (not audit_log).

**libp2p gotchas:** Config key `connectionEncrypters` not `connectionEncryption`. `@libp2p/mplex` deprecated → use yamux. `kadDHT` requires `ping` service. ESM-only but tsx handles it.

---

## Escrow & Swarms

**Escrow:** Full state machine: create→fund→start→complete→release | dispute→evidence→resolve. Cron (10min): expired FUNDED→REFUNDED, WIP→DISPUTED. All error responses include `code` field.

**Swarms:** `POST /v1/swarm/task` (202 async). LLM decomposes → parallel skill invocations → LLM synthesis. `maxBudget` cap, `X-Swarm-Depth` recursion guard, upfront SWARM_BASE_FEE=20 deduction.

---

## Governance

Proposals + weighted voting. Vote weight: `sqrt(total credits spent)` (quadratic-lite). 100+ credits to propose. Auto-expire on closed. Duplicate vote prevention. All errors have `code` field.

---

## LLM Proxy & MCP

**LLM proxy:** `GET /v1/llm/models` (23 models), `POST /v1/llm/chat` (OpenAI-compatible), `/embeddings`, `/code/run`. 15% markup. Cache key: SHA-256 of full message array. Cache hits: 1 credit.

**MCP server:** 6 tools (list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits). Run: `npm run mcp`.

---

## Telegram Bot

User-driven only (no auto-queries). 12h global cooldown shared across users. `/price` exempt (per-user 1/min). `/skill` shows info, does NOT invoke. `sanitizeInput()` on all args. `broadcastBatched()`: parallel batches of 5. Subscribers in `telegram_subscribers` table.

---

## Security Layer

**Auth:** Clerk JWT (`requireClerkAuth`), API key (`checkApiKey` — `getApiKey()` returns typed `credits_used` + `amount_paid`, no unsafe casts), Admin (`requireAdmin` — timing-safe SHA-256, `X-Admin-Key`). `ADMIN_API_KEY` required in production.

**Request protection:** HSTS + security headers, 256KB body limit (64KB for webhooks), rate limiting (60/min/IP + tiered per-key, `X-RateLimit-Limit` + `X-RateLimit-Remaining` headers on every response). Response signing: HMAC-SHA256 `X-ClawNet-Signature` on orchestrate, skill invoke, batch, balance, tasks.

**Financial safety:** Atomic credit deduction (`WHERE credits >= amount`). `deductCredit()` return value always checked. Batch: upfront deduction + refund. SSE: 10-credit pre-check.

**Key handling:** `maskApiKey()` from `src/utils/mask.ts` always — never `.slice()` directly. Clerk email cache with LRU eviction. Timing-safe env key comparison.

**Error format:** All routes use `{ error: string, code: string, details?: object }`. Structured error codes: NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, INSUFFICIENT_CREDITS, RATE_LIMITED, INVALID_STATE, etc.

---

## Database

SQLite WAL mode, `data/orchestrator.db`, 41 migrations. 9 domain modules: `connection`, `keys`, `credits`, `skills`, `marketplace`, `escrow`, `governance`, `services`, `audit`. Barrel re-exported from `src/db/index.ts`.

Daily cleanup: audit_log (90d), skill_metrics (90d), solana_sigs (30d), orchestrations, feedback, email log, peers, Stripe sessions/events, claim tokens.

Key tables: `api_keys`, `transactions`, `skills`, `skill_metrics`, `skill_ratings`, `skill_versions`, `skill_reports`, `stakes`, `escrows`, `audit_log`, `proposals`, `votes`, `tasks`, `task_ratings`, `peers`, `discovery_cache`, `skill_embeddings`, `endpoint_health`, `telegram_subscribers`, `stripe_refunded_charges`, `payout_requests`, `swarms`

---

## Background Jobs (Crons)

| Job | Interval | File |
|---|---|---|
| Endpoint health pings | 5 min | `endpoint-health-cron.ts` |
| Escrow expiry | 10 min | `escrow-cron.ts` |
| Skill A/B auto-promote | 30 min | `skill-ab-cron.ts` |
| Stake unlock | periodic | `stake-unlock-cron.ts` |
| Heartbeat | hourly | `heartbeat.ts` |
| Daily retention cleanup | 24h | `endpoint-health-cron.ts` |

All use concurrency guard pattern: `let _running = false; if (_running) return;`

---

## OpenAPI & Developer Experience

`GET /v1/openapi.json` — 25+ paths across 9 tag groups (Core, Account, Skills, Marketplace, Tasks, Discovery, Governance, Mesh, System). ClerkAuth + ApiKeyAuth security schemes. Skill schema defined.

---

## Code Patterns

```typescript
// Route: always Hono, named export
const router = new Hono()
router.post('/path', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') // { key, credits, isEnvKey, amountPaid, ... }
  return c.json({ ok: true })
})
export { router }

// DB: raw SQL, no ORM
const row = getDb().prepare('SELECT * FROM t WHERE id = ?').get(id)
getDb().transaction(() => { /* atomic */ })()

// Route registration in src/index.ts (before app.notFound())
app.route('/v1/something', someRouter)

// Audit log (fire-and-forget)
logAudit({ entityType: 'x', entityId: id, action: 'ACTION', actorId: key, data: {} })

// Key masking — always use this
maskApiKey(key) // → "cn12••••abcd"
```

---

## Key File Map

```
src/index.ts                     — app, routes, startup sequence
src/db/{connection,keys,credits,skills,marketplace,escrow,governance,services,audit}.ts
src/config/index.ts              — Zod env (incl FREE_TRIAL_CREDITS, RATE_LIMIT_PER_MIN min:1), rateTier(), SWARM_BASE_FEE
src/config/api-registry.ts       — 163 endpoints
src/middleware/{auth,clerk-auth,admin-auth,rate-limit,sign-response}.ts
src/utils/{mask,shutdown,logger,html,template}.ts
src/core/{intent-parser,plan-templates,executor,formatter,credits,circuit-breaker}.ts
src/core/{skill-scanner,skill-executor,discovery-engine,embeddings}.ts
src/core/{seed-skills,seed-embeddings,endpoint-health-cron,escrow-cron,skill-ab-cron,stake-unlock-cron,heartbeat}.ts
src/routes/{api,openclaw,skills,marketplace,tasks,auth-tokens,escrow,governance}.ts
src/routes/{discover,mesh,swarm,llm,registry,x402-skills,openapi,admin,dashboard}.ts
src/routes/{stripe,solana,clerk-webhook,stats,batch,stream,feedback,contact,endpoints}.ts
src/mesh/node.ts                 — libp2p
src/mcp/server.ts                — MCP for Claude Code/Cursor
src/integrations/telegram.ts     — grammY bot
src/providers/llm.ts             — llmComplete() two-model strategy
```

---

## Technical Principles

1. **No ORM** — raw SQL only, domain-split DB modules
2. **No monorepo** — single flat repo, single deploy
3. **SQLite-first** — Redis is cache only (lossy OK)
4. **Credits, not subscriptions** — subs just top up monthly
5. **Simulation mode always works** — server runs without Solana keys
6. **One VPS** — scale vertically first
7. **Registry = source of truth** — add endpoint to registry, everything picks it up
8. **maskApiKey() everywhere** — never `.slice()` directly
9. **creditsForApiCost() everywhere** — never inline `* 2000`
10. **Error responses always include `code`** — `{ error, code, details? }`