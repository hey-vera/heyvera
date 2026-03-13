# ClawNet — Project Memory

> Internal reference for how the system currently functions. Updated when internals change.

---

## Orchestration Engine

**Startup:** initDb → seedSkills → initRedis → initClawApis → shutdown handlers → heartbeat → Telegram (try/catch isolated) → mesh (try/catch isolated) → crons → embeddings (background) → serve. Structured boot log: `{ port, env, simulation, llm, redis, signing, x402, freeTrial, rateLimit }`.

**Shutdown:** SIGTERM/SIGINT → stop HTTP (no new connections) → 15s drain (covers SSE streams + batch queries) → stop crons/heartbeat → stop mesh/Telegram → close DB (WAL checkpoint TRUNCATE) → close Redis (5s timeout) → exit. 30s force-kill deadline. Docker `stop_grace_period: 40s` (> 30s; ch18 fix — was missing, Docker SIGKILL fired at 10s during drain).

**Request flow:** Query → rate limit (60/min/IP, tiered per-key, headers on every response) → auth → intent parser → pricing optimization → budget pre-flight → executor → synthesizer → cache → signed response. Health endpoint (`/health`) is registered BEFORE the middleware stack — bypasses CORS, security headers, rate limiter, body limit, and hono logger for zero-overhead monitoring.

**Intent parsing:** 12 regex plan templates match ~60-80% of queries (skip LLM). Fallback: fast LLM (`claude-haiku-4-5-20251001` / `gpt-4o-mini`). `parallelGroups` indices remapped after hallucinated endpoint filtering. Hallucinated params stripped — only keys declared in endpoint's `inputSchema` survive. Retry includes correction hint. When pricing is present, `pricingPromptHint()` appends cost instructions to the LLM system prompt. Pricing hint included in cache key so different budgets produce different cached plans.

**Pricing optimization (`src/core/pricing.ts`):** Client sends `pricing: { maxCredits?, targetCredits?, minCredits?, strategy }` on any orchestrate/batch/stream request. `PricingPreferencesSchema` (Zod) validates with constraint: `minCredits ≤ targetCredits ≤ maxCredits`. Strategies: `cheapest` | `balanced` | `fastest` | `reliable`. After intent parsing, `checkBudget()` runs a pre-flight estimate — returns 402 before any API calls if plan exceeds `maxCredits`. If over budget, auto-rescues by trying `optimizePlan()` with `cheapest` strategy (swap to cheaper alternatives). If still over, returns 402. Within budget, `optimizePlan(intent, pricing)` swaps endpoints per strategy. **Endpoint alternatives map:** 11 capability groups (~45 endpoints) mapped in `ENDPOINT_ALTERNATIVES` — groups like `token-price`, `web-scrape`, `news-search`, `social-sentiment`, etc. Each group has 3-7 interchangeable endpoints sorted by cost/latency per strategy. `getAlternativesForEndpoint()` powers the `/v1/estimate` alternatives display.

**Execution:** Parallel API calls via `executePlan(intent, budget?, agentKey?)`. Optional `BudgetConstraint { maxCredits }` tracks `runningCostUsd` across groups and skips steps that would exceed the cap at runtime (marks them `BUDGET_EXCEEDED`). Per-endpoint circuit breaker (CLOSED→OPEN→HALF_OPEN, MAX_CIRCUITS=500, 7-day auto-reset, `probing` flag prevents thundering herd). Smart cache TTLs (metadata 24h, prices 60s, holders 30min, social 10min). **Post-fetch validation:** checks response keys against endpoint's `outputFields` — warns if <30% match ratio (schema mismatch detection). Responses >1MB served uncached (not truncated). **Cache is LRU** (ch15 audit confirmed): `MemoryCache.get()` promotes keys to Map tail via delete+re-insert — eviction correctly removes least-recently-used.

**Agent Context Layer (`src/db/contexts.ts`, v47):** Per-agent persistent cache in SQLite. Three-tier lookup: agent context (sub-1ms SQLite) → Redis/memory cache → live API call. After successful API calls, responses stored in `agent_contexts` with 3x the endpoint's normal cache TTL. Limits: 500 entries / 5MB per agent, LRU eviction on overflow. Routes: `GET /v1/context` (list entries), `GET /v1/context/stats` (namespace stats), `DELETE /v1/context` (clear all), `DELETE /v1/context/:endpointId` (clear specific). Expired entries purged by daily cleanup cron.

**Synthesis:** Smart LLM (`claude-sonnet-4-20250514` / `gpt-4o`). XML breakout prevention: `<api-data>` and `</api-data>` tags escaped in API response data. Fallback shows clean message not raw JSON.

**Credit billing (v2 — value-based pricing):** `creditCostForEndpoint()` in `src/core/credits.ts` is the single source of truth. Formula: explicit `creditCost` override OR `max(1, ceil(costPerCall * COST_MARKUP_FACTOR))` where `COST_MARKUP_FACTOR` defaults to 1500 (env-configurable). Guarantees 33-50% margin on every endpoint at $0.001/credit sale price. Orchestration fee: `ORCHESTRATION_FEE` (default 2cr, env-configurable) added per LLM-orchestrated query — covers intent parsing + synthesis LLM costs. Cache hits: per-step = 0 credits (in `creditsForExecution()`), full-query cache = 1 credit (prevents free-riding). Skill invocations: `max(actualCost, skill.credit_cost)` — skill author's price is a minimum floor. Daily spend tracking + anomaly detection + low-balance email alerts.

**Credit flow integrity:** All 6 orchestration routes (api, batch, stream, openclaw, skills, tasks) use `creditsForExecution(steps, findEndpoint)` for consistent value-based pricing. `deductCredit()` is atomic (`WHERE credits >= amount AND active = 1`). Batch: upfront deduction + refund. SSE: 10-credit pre-check. Budget constraint in executor uses `creditCostForEndpoint()` per-step projection. Treasury fee credited on ALL 3 skill billing paths: marketplace purchase, skill invoke, openclaw skill invoke (ch07+ch08 fixes). Cache hits always 1 credit (openclaw was overcharging — ch08 fix).

**Batch:** `POST /v1/batch` — up to 10 parallel queries, MAX_BATCH_STEPS=30 total. Credits deducted upfront atomically, excess refunded after execution. Accepts `pricing` in body — per-query optimization applied during intent mapping.

**SSE streaming:** `GET /v1/stream/orchestrate` — minimum 10-credit pre-check. `streamCounted` flag prevents double-decrement on disconnect. Max 5 concurrent streams per key. Accepts pricing via `?strategy=&maxCredits=` query params.

**Estimate:** `GET /v1/estimate?query=&strategy=&maxCredits=` — returns plan cost breakdown with `alternatives[]` per step and `optimized` section showing what pricing would change.

---

## API Registry & Endpoints

163 endpoints across 15 categories (solana, social, utility, defi, intelligence, oracle, scraping, discovery, infrastructure, search, media, enrichment, weather, ai-ml, security). Defined in `src/config/api-registry.ts`.

Health monitoring: HEAD pings every 5 min (`endpoint-health-cron.ts`), daily retention cleanup. `GET /v1/registry`, `/v1/registry/health`, `/v1/registry/:id`.

**Public stats (`/v1/stats`):** Unauthenticated. Exposes only aggregate numbers: totalCalls, avgDurationMs, successRate, activeUsers, endpoints.total. Circuit breaker state and per-endpoint costs removed (ch08 — prevented attacker/competitor intelligence).

---

## Skill System

**Types:** `prompt_template` (LLM pipeline), `api_proxy` (direct proxy, no LLM, 15s timeout), and `data` (smart-cached GET fetch, no LLM). Skills with `execution_plan_json` bypass LLM intent parser for deterministic routing.

**Data skills:** `GET /v1/skills/:id/query?params` — fetches upstream JSON, caches in Redis by `update_frequency` (realtime=60s, hourly=3600s, daily=86400s, weekly=604800s, static=30d). Cache hit = 1cr; live fetch = `max(1, skill.credit_cost)` + 97/3 split. New columns: `sample_output_json` (canonical example shown on marketplace card), `update_frequency`. SSRF check (`isProxyUrlSafe()`) runs at creation AND query time. Requires `proxyUrl`; `promptTemplate` defaults to `''`. `POST /:id/invoke` returns 400 with redirect hint for data skills. `GET /v1/skills?type=data` filters by type.

**Skill classes (`skill_class` column, v45):** `standard` (default), `recursive` (re-invokes with refined input — 1 extra pass, max 5 steps), `self_checking` (validates output against `output_schema_json`, retries once if required fields missing). Set at creation via `skillClass` param. Extra LLM/API costs from refinement/retry are included in the final credit charge.

**Analytics:** `GET /v1/skills/:id/analytics` — per-skill cost & performance: total invocations, total credits earned, avg/median cost, p95/avg latency, success rate, completion rate, 8-week cost trend.

**Revenue:** 97% creator / 3% platform fee (official skills exempt). Min 1-credit fee for third-party ≥10cr. Transaction type: `SKILL_SALE`. Reputation: +0.1 success / -0.05 failure.

**A/B testing:** Fork creates challenger, 30% traffic split. Auto-promote cron (30min) at +10% success rate threshold. Cron checks challenger still active before evaluating.

**Security:** 18-pattern scanner on publish, fork, AND invoke-time variable values. Unicode-normalized input (zero-width chars, fullwidth ASCII stripped). Security statuses: CLEAN → SUSPICIOUS → VERIFIED → FLAGGED. Auto-flag at 3+ community reports. FLAGGED = blocked from invoke AND purchase. **Proxy response scanning:** `scanProxyResponse()` checks api_proxy responses for wallet drainers, phishing, social engineering, XSS (10 danger patterns + Solana address + urgency combo detection). Unsafe responses return HTTP 451 and auto-flag the skill as FLAGGED.

**Verified Publisher Program:** `GET /v1/skills/verification/status` + `POST /v1/skills/verification/apply`. Automated criteria: reputation ≥5.0, 3+ skills with 100+ invocations, avg success ≥90%, Clerk linked, 0 reports. `autoVerifyPublisher()` promotes eligible CLEAN/UNSCANNED skills to VERIFIED.

**10 official skills** seeded on boot by `clawhub-official` (all v2.0.0, VERIFIED, deterministic execution plans).

---

## Marketplace

Purchase = invoke in single call (result shown immediately). Ratings: verified buyers only (checks `SKILL_SALE` transaction). View count rate-limited per IP. Featured skills admin-toggled.

Creator tools: stats dashboard, withdrawal requests (min 1000cr, max 3 pending). Payout calc: `SUM(amount_credits - fee_credits)` (net, not gross). Star/unstar: fully atomic (transactions).

---

## Payments & Credits

**Stripe:** 6 packages ($5-$1K), Scout subscription $29/mo→40K credits. Idempotent webhooks via `stripe_refunded_charges` table. Proportional refund credit calc.

**USDC/Solana:** Phantom wallet, on-chain signature verify, +7% bonus. `releaseClaimSolanaSignature()` on all non-success paths.

**x402:** Consumer mode (pay ClawAPIs via Solana, needs `SOLANA_PRIVATE_KEY`). Provider mode (serve skills on Base/USDC, needs `X402_RECIPIENT_ADDRESS`). Price: `skill.credit_cost × X402_USDC_PER_CREDIT` (default $0.001/credit — aligned with Stripe base rate). Error details hidden in production behind `NODE_ENV` check (ch10 fix). `tags_json` parsed via `safeJsonParse()` (ch10 fix).

`isSimulationMode = !env.SOLANA_PRIVATE_KEY` — blocks prompt_template skills, api_proxy still works.

---

## Task API

`POST /v1/tasks` — async skill execution with idempotency-key dedup, A/B routing, webhook callback with retry (3 attempts, exponential backoff 0s→1s→3s, `X-ClawNet-Attempt` header). Webhook status tracked per task (`webhook_attempts`, `webhook_status`: delivered/failed:STATUS/failed:error). `GET /v1/tasks/:id` includes webhook delivery info. `GET /v1/tasks`, cancel, rate. `GET /v1/auth/me`, `/estimate`, `/usage`.

---

## P2P Mesh & Discovery

**libp2p:** TCP transport, Noise encryption, Yamux muxer, Kademlia DHT, ping service. Max 50 connections. `peers` table persisted to SQLite. Port 4001. `stopMeshNode()` try/catch-safe for clean shutdown. `onPeerConnect` handler wrapped in try/catch (ch09 fix — prevents uncaught exception from crashing process via libp2p event emitter).

**Peer lifecycle:** `getPeers()` filters to last 24h (max 500 rows). `pruneStalePeers()` removes >7-day entries (runs in escrow cron alongside discovery cache cleanup).

**Discovery Trinity:** semantic 60% + P2P 25% + on-chain mock 15% (configurable via `discovery.json`). ONNX all-MiniLM-L6-v2 embeddings. `POST /v1/discover`. `skill_embeddings` virtual table (sqlite-vec). Partial weight overrides auto-normalized to sum=1.0. P2P/onchain word matching filters ≤2-char words to prevent false matches. Discovery queries logged at debug level (not audit_log).

**libp2p gotchas:** Config key `connectionEncrypters` not `connectionEncryption`. `@libp2p/mplex` deprecated → use yamux. `kadDHT` requires `ping` service. ESM-only but tsx handles it.

---

## Escrow & Swarms

**Escrow:** Full state machine: create→fund→start→complete→release | dispute→evidence→resolve. Cron (10min): expired FUNDED→REFUNDED, WIP→DISPUTED. All error responses include `code` field.

**Swarms:** `POST /v1/swarm/task` (202 async). LLM decomposes → parallel skill invocations → LLM synthesis. `maxBudget` cap, `X-Swarm-Depth` recursion guard, upfront SWARM_BASE_FEE=20 deduction.

---

## Governance

Proposals + weighted voting. Vote weight: `sqrt(total credits spent)` (quadratic-lite, no floor). 100+ credits to propose. Auto-expire on closed. Duplicate vote prevention. All errors have `code` field.

**Ch16 audit fix:** `getVoterWeight()` previously used `Math.max(1, sqrt(spent))` — this floored all keys at weight=1 including zero-spend keys, enabling free Sybil voting. Fixed to `sqrt(spent)` with no floor; `castVote()` already rejects `weight <= 0`. VERIFIED skills immune to community auto-flagging (3 reports). Proposal balance check (100 credits) is NOT a spend — one key can spam proposals (known limitation, rate-limited by IP). No quorum minimum (known limitation).

**Ch17 audit fixes:** `vitest.config.ts` coverage `include` was `src/db/index.ts` (barrel re-export after Ch01 split) — changed to `src/db/**/*.ts` for real domain-file coverage. Added 3 `getVoterWeight()` regression tests to governance.test.ts (zero-spend=0, sqrt(spent), zero-weight-vote rejected). Tests now 51/51.

---

## LLM Proxy & MCP

**LLM proxy:** `GET /v1/llm/models` (23 models), `POST /v1/llm/chat` (OpenAI-compatible), `/embeddings`, `/code/run`. 15% markup. Cache key: SHA-256 of full message array. Cache hits: 1 credit.

**MCP server:** 6 tools (list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits). Run: `npm run mcp`.

---

## Telegram Bot

User-driven only (no auto-queries). 12h global cooldown shared across users. `/price` exempt (per-user 1/min). `/skill` shows info, does NOT invoke. `sanitizeInput()` on all args. `broadcastBatched()`: parallel batches of 5. Subscribers in `telegram_subscribers` table.

---

## Compliance & Trust Notes (Ch20)

**GDPR erasure:** `user.deleted` Clerk webhook handler deactivates API key, anonymizes email to `[deleted]`, unpublishes author's skills. Financial records retained per legal retention windows.
**PII stored:** email in `api_keys`/`subscriptions`/`email_send_log`. No Solana wallets, no IP addresses in SQLite.
**Audit trail:** `CREDIT_DEDUCT` logs lack requestId correlation to specific orchestrations — correlate by api_key + timestamp. Documented in considerations.md.
**Key masking:** `maskApiKey()` now used in all log paths (auth.ts, clerk-webhook.ts). Never `.slice()` directly.
**Vitest pool:** `pool: 'forks'` set in `vitest.config.ts` — required on Windows; default `vmThreads` fails in vitest 4.x.
**Policy TODOs:** ToS/Privacy pages, API key expiry/scoping, data export endpoint, creator 1099 reporting — all deferred in considerations.md.

---

## Product & Distribution Notes (Ch19)

**MCP**: config in README, requires local clone + `npx tsx src/mcp/server.ts`. No published npm package yet.
**Free trial**: infrastructure complete (`createFreeTrialKey()` + clerk-webhook.ts); `FREE_TRIAL_CREDITS=0` default — one env var to enable.
**Referral routes**: deleted in Ch01 audit but DB functions remain in `src/db/keys.ts` (`createReferralCode`, `applyReferralCode`, etc.); tables exist but no HTTP endpoints expose them.
**OpenAPI coverage**: ~60% of routes documented in spec. Missing: escrow, swarm, LLM proxy, openclaw, payout, context, x402.
**402 errors**: all INSUFFICIENT_CREDITS paths now include `hint: 'Top up your credits at claw-net.org'`.

---

## Security Layer

**Auth:** Clerk JWT (`requireClerkAuth`), API key (`checkApiKey` — `getApiKey()` returns typed `credits_used` + `amount_paid`, no unsafe casts), Admin (`requireAdmin` — timing-safe SHA-256, `X-Admin-Key`). `ADMIN_API_KEY` required in production. `adminRouter.use('*', ...)` middleware guard added — all admin routes protected even if handler forgets the per-route check.

**Request protection:** HSTS + security headers, 256KB body limit (64KB for webhooks), rate limiting (60/min/IP + tiered per-key, `X-RateLimit-Limit` + `X-RateLimit-Remaining` headers on every response). Response signing: HMAC-SHA256 `X-ClawNet-Signature` on orchestrate, skill invoke, batch, balance, tasks.

**Financial safety:** Atomic credit deduction (`WHERE credits >= amount`). `deductCredit()` return value always checked. Batch: upfront deduction + refund. SSE: 10-credit pre-check.

**Security audit fixes (2026-03-12):** `isProxyUrlSafe()` IPv6 fix — `url.hostname` strips brackets, so check `host.startsWith('fc')` not `'[fc'`; also blocks `::ffff:` (IPv4-mapped). Rate limiter proxy detection: Docker is `172.16-31.x.x` — uses `/^172\.(1[6-9]|2\d|3[01])\./` not `startsWith('172.')` (which matched public IPs). `listPublicSkills()` excludes `security_status = 'FLAGGED'`. Private skill `GET /:id` uses SHA-256 hash normalization for constant-time key compare (handles empty key, no length leak). `ensureTreasuryKey()` + `ensurePlatformKey()` now check `active` and re-activate on startup if deactivated.

**Key handling:** `maskApiKey()` from `src/utils/mask.ts` always — never `.slice()` directly. `email.ts` consolidated to use centralized import (ch10 fix). Clerk email cache with LRU eviction. Timing-safe env key comparison.

**Error format:** All routes use `{ error: string, code: string, details?: object }`. Structured error codes: NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, INSUFFICIENT_CREDITS, RATE_LIMITED, INVALID_STATE, MISSING_QUERY, QUERY_TOO_LONG, ESTIMATE_FAILED, INVALID_SESSION, SESSION_NOT_FOUND, KEY_NOT_FOUND, INVALID_BODY, INVALID_EMAIL, etc. (ch08 audit added missing codes to api.ts + batch.ts).

---

## Database

SQLite WAL mode, `data/orchestrator.db`, 51 migrations (v50: `sample_output_json`, v51: `update_frequency`). 10 domain modules: `connection`, `keys`, `credits`, `skills`, `marketplace`, `escrow`, `governance`, `services`, `audit`, `contexts`. Barrel re-exported from `src/db/index.ts`.

**Pragmas:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. WAL checkpoint (TRUNCATE) on shutdown in `closeDb()`. Passive checkpoint after daily cleanup cron.

**Financial triggers (v42):** `trg_credits_non_negative` (api_keys), `trg_credit_cost_non_negative` (skills), `trg_escrow_amount_positive` (escrows), `trg_stake_amount_positive` (stakes). DB-level enforcement — no application bug can create negative balances or zero-cost escrows.

**Daily cleanup (all batched — LIMIT 5000/iteration):** audit_log (90d), skill_metrics (90d), solana_sigs (30d), orchestrations (180d), feedback (365d), email_log (30d), peers (7d), Stripe sessions/events (90d), claim tokens, tasks (90d), swarms (90d), reputation_events (365d), transactions (730d), votes on closed proposals (365d), deactivated keys with zero balance (90d), expired agent_contexts.

Key tables: `api_keys`, `transactions`, `skills`, `skill_metrics`, `skill_ratings`, `skill_versions`, `skill_reports`, `stakes`, `escrows`, `audit_log`, `proposals`, `votes`, `tasks`, `task_ratings`, `peers`, `discovery_cache`, `skill_embeddings`, `endpoint_health`, `telegram_subscribers`, `stripe_refunded_charges`, `payout_requests`, `swarms`, `agent_contexts`

---

## Background Jobs (Crons)

| Job | Interval | File |
|---|---|---|
| Endpoint health pings | 5 min | `endpoint-health-cron.ts` |
| Escrow expiry | 10 min | `escrow-cron.ts` |
| Skill A/B auto-promote | 30 min | `skill-ab-cron.ts` |
| Stake unlock | 60s | `stake-unlock-cron.ts` |
| USDC payout | 4h | `payout-cron.ts` |
| Heartbeat | hourly | `heartbeat.ts` |
| Daily retention cleanup | 24h | `endpoint-health-cron.ts` |

All use concurrency guard pattern: `let _running = false; if (_running) return;` (ch11 fix: stake-unlock-cron was missing this guard). Heartbeat stores startup `setTimeout` ID so `stopHeartbeat()` can cancel it during early shutdown (ch11 fix). `usage.jsonl` rotated at 10K lines (every 1000 writes) — was unbounded before ch14 fix.

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
src/db/{connection,keys,credits,skills,marketplace,escrow,governance,services,audit,contexts}.ts
src/config/index.ts              — Zod env (incl FREE_TRIAL_CREDITS, RATE_LIMIT_PER_MIN min:1), rateTier(), SWARM_BASE_FEE
src/config/api-registry.ts       — 163 endpoints
src/middleware/{auth,clerk-auth,admin-auth,rate-limit,sign-response}.ts
src/utils/{mask,shutdown,logger,html,template,usage}.ts
src/core/{intent-parser,plan-templates,executor,formatter,credits,pricing,circuit-breaker}.ts
src/core/{skill-scanner,skill-executor,discovery-engine,embeddings}.ts
src/core/{seed-skills,seed-embeddings,endpoint-health-cron,escrow-cron,skill-ab-cron,stake-unlock-cron,heartbeat}.ts
src/routes/{api,openclaw,skills,marketplace,tasks,auth-tokens,escrow,governance}.ts
src/routes/{discover,mesh,swarm,llm,registry,x402-skills,openapi,admin,dashboard}.ts
src/routes/{stripe,solana,clerk-webhook,stats,batch,stream,feedback,contact,endpoints,context}.ts
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
11. **Docker log rotation** — both services use `json-file` driver with `max-size: 10m` + `max-file: 3` (ch12 fix)
12. **CI builds artifact** — `npm run build` step added to pipeline between typecheck and tests (ch12 fix)


npm is a snapshot registry — each version is frozen forever once published. Changes to the server don't automatically update the package. Here's the full picture:

Server-side changes (routes, DB, business logic):
Changes to src/ deploy to the VPS via git push → deploy. The published npm package immediately benefits because it just calls api.claw-net.org — the bundle doesn't change, but the API it hits does. No npm republish needed.

MCP client changes (tool descriptions, new tools, bug fixes in packages/mcp/src/index.ts):
These require a manual republish:


# bump version in packages/mcp/package.json (e.g. 1.0.0 → 1.0.1)
cd packages/mcp
npm publish --access public
Users on npx -y @clawnet/mcp get the latest version automatically on next run (npx caches but respects semver). Users who pinned a version stay on the old one until they update.

Bottom line:

Adding a new route to the server → just deploy, no npm action
Adding a new MCP tool or fixing tool descriptions → bump version + republish
Publishng is a deliberate step you control, not continuous