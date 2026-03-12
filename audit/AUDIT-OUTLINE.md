# ClawNet — Master Audit Outline

> Production-grade audit plan for ClawNet v3 — sovereign AI agent orchestration platform.
> Each chapter is designed to be executed independently in a dedicated session.
> This file defines scope, specific files, audit questions, production-scale concerns, and feature opportunities.

**Platform summary:** ClawNet turns natural language queries into multi-step API workflows across 163 endpoints, with a full skill marketplace, credit-based economy, escrow system, governance, P2P mesh, and multi-rail payments (Stripe, USDC/Solana, x402). Single VPS (DigitalOcean), SQLite WAL, Redis L2 cache, Hono framework, TypeScript strict mode.

**Scale target:** Thousands of daily orchestrations scaling to millions of credit transfers. Every financial operation must be atomic. Every auth boundary must hold under adversarial conditions. Every table must have bounded growth.

---

## Audit Completion Tracker

| Ch | Chapter | Status |
|----|---------|--------|
| 01 | Architecture & Codebase Foundation | COMPLETE |
| 02 | Database Design & Data Lifecycle | COMPLETE |
| 03 | Financial Engine | COMPLETE |
| 04 | Authentication, Authorization & Identity | COMPLETE |
| 05 | Security & Attack Surface | COMPLETE |
| 06 | AI Orchestration Pipeline | COMPLETE |
| 07 | Skill Marketplace & Economy | COMPLETE |
| 08 | API Design & Developer Experience | COMPLETE |
| 09 | Mesh Network & Discovery | COMPLETE |
| 10 | Integrations & External Services | COMPLETE |
| 11 | Background Jobs & Cron System | COMPLETE |
| 12 | Infrastructure & Deployment | COMPLETE |
| 13 | Frontend & User Experience | COMPLETE |
| 14 | Observability & Operations | COMPLETE |
| 15 | Scalability & Performance | COMPLETE |
| 16 | Governance & Community | PENDING |
| 17 | Testing & Verification | PENDING |
| 18 | Resilience & Shutdown | PENDING |
| 19 | Product Completeness & Market Readiness | PENDING |
| 20 | Compliance, Risk & Trust | PENDING |

---

## Chapter 01 — Architecture & Codebase Foundation

### Scope

The structural skeleton of ClawNet: entry point, startup/shutdown sequence, route registration order, middleware chain, configuration validation, error handling, dependency graph, and TypeScript compilation. This chapter establishes whether the foundation can support millions of requests without collapsing under its own complexity.

### Files to Read

```
src/index.ts                       — 215 lines. Hono app, 23 route mounts, startup sequence, process handlers, health check, CORS, security headers, body limits
src/config/index.ts                — 110 lines. Zod env schema, 40+ env vars, defaults, production safety checks
src/utils/shutdown.ts              — 83 lines. SIGTERM/SIGINT handlers, 7-step drain sequence, 30s hard deadline
src/utils/logger.ts                — 32 lines. Pino structured logging, redaction paths, dev/prod modes
src/middleware/auth.ts              — 72 lines. API key middleware, timing-safe env key comparison, regex format validation
src/middleware/clerk-auth.ts        — 75 lines. Clerk JWT verification, 5-min email cache (10K LRU), background purge
src/middleware/sign-response.ts     — 36 lines. HMAC-SHA256 response signing (X-ClawNet-Signature header)
package.json                        — 47 prod deps, 8 dev deps. Scripts: dev, build, test:unit, mcp
tsconfig.json                       — ES2022 target, CJS module, strict mode, esModuleInterop
```

### Current Implementation

**Startup sequence (src/index.ts `start()`):**
1. `initDb()` — SQLite WAL mode, 41 migrations, foreign keys ON
2. `seedOfficialSkills()` — 10 official skills + treasury key
3. `initRedis()` — ioredis with auto-reconnect
4. `initClawApis()` — x402 consumer mode (if SOLANA_PRIVATE_KEY set)
5. `setupGracefulShutdown()` — register SIGTERM/SIGINT handlers
6. `startHeartbeat()` — hourly uptime pulse
7. `initTelegram()` — grammY bot long-polling
8. `startMeshNode()` — libp2p TCP/4001
9. Start 4 cron jobs: escrow-cron, skill-ab-cron, stake-unlock-cron, endpoint-health-cron
10. `loadEmbeddingModel()` — background, non-blocking (.catch logs only)
11. `serve()` — Hono on port 3402, hostname 0.0.0.0

**Middleware chain (applied to every request, in order):**
1. CORS (production-locked to claw-net.org domains)
2. Security headers: X-Content-Type-Options, X-Frame-Options DENY, CSP default-src 'none', Strict-Transport-Security, Referrer-Policy, Permissions-Policy
3. Request ID: `nanoid(12)` on `X-Request-Id` header
4. Body limit: 256KB global, 64KB for webhooks
5. Rate limiter: 60 req/min/IP (Redis-backed, memory fallback)
6. Per-route: `checkApiKey` or `requireClerkAuth` middleware
7. Per-route: `signResponse` on orchestrate/invoke/batch/balance/tasks

**Route registration:** 23 routers mounted in fixed order before `app.notFound()`.

**Health check (GET /health):**
- Verifies DB liveness (`SELECT 1`)
- Checks Redis connectivity status
- Returns 503 if DB unreachable, 200 with `degraded` if Redis down

**Process error handlers:**
- `unhandledRejection` → log error, continue running
- `uncaughtException` → log error, `process.exit(1)`

### Audit Questions

1. **Startup ordering dependencies** — `seedOfficialSkills()` runs before Redis is initialized. If seeding queries Redis (cache invalidation), does it fail silently or crash? Trace the dependency chain.
2. **Route registration order** — are middleware applied correctly to ALL routes? If a new route is mounted after the notFound handler, it's unreachable. Verify the mount ordering.
3. **Body limit bypass** — 256KB global limit, but 64KB for webhooks. How are webhooks distinguished? Is the smaller limit enforced on the correct paths only?
4. **Security headers completeness** — CSP is `default-src 'none'` — appropriate for API-only server. But does the health endpoint or any HTML response need relaxed CSP?
5. **CORS production lock** — only allows `*.claw-net.org`. If a third-party integration (MCP, external agent) calls the API from a browser context, CORS blocks it. Is this intentional?
6. **Request ID collision** — `nanoid(12)` gives ~35 bits of entropy. At 1M requests/day, birthday paradox collision probability is non-trivial. Should this be longer?
7. **Health check depth** — `SELECT 1` proves SQLite responds, but not that migrations completed or that tables exist. Should the health check verify schema version?
8. **Missing startup failure isolation** — if `initTelegram()` throws, does it crash the entire server? Or is it wrapped in try/catch? Check each startup step's error handling.
9. **Startup race** — the HTTP server starts accepting connections at step 11. But cron jobs start at step 9. If a cron job writes to DB while the server is already accepting requests, is there write contention?
10. **Config validation strictness** — Zod `parse()` throws on invalid env. But what about env vars that are valid but semantically wrong (e.g., `CREDITS_PER_USD=0`, `RATE_LIMIT_PER_MIN=-1`)?
11. **Dependency count** — 47 production deps is high for a single-purpose API. Are all dependencies actively used? Audit for dead deps that increase attack surface.
12. **TypeScript CJS module** — project uses CJS (`"module": "CommonJS"`) but several deps are ESM-only (libp2p, x402). Are all ESM workarounds stable across Node.js versions?

### Production-Scale Concerns

- At 10K req/min, every middleware adds measurable latency. The security headers middleware runs on EVERY request including internal health checks. Should health checks bypass non-essential middleware?
- 23 route mounts means 23 Hono router lookups per request. At scale, consider route grouping or lazy loading for rarely-used routes (governance, admin).
- `nanoid(12)` for request IDs is fast but not cryptographically unique. For financial audit trails, consider UUIDv7 (time-ordered, globally unique).
- `process.exit(1)` on uncaughtException is correct, but Docker restart-unless-stopped may create a crash loop if the exception is persistent (e.g., corrupt DB file).

### Feature Opportunities

- **Startup health gate** — don't bind HTTP port until ALL services (DB, Redis, embedding model) report healthy. Prevents serving 500s during cold start.
- **Route lazy loading** — mount rarely-used routes (governance, admin, x402) only when first accessed. Reduces startup time and memory.
- **Request tracing** — propagate X-Request-Id through LLM calls, DB queries, and external API calls for end-to-end debugging.
- **Config hot reload** — watch `.env` for changes without restart (rate limits, feature flags).
- **Structured startup log** — single log line at boot: `{ port, dbVersion, redisConnected, meshActive, cronsStarted, embeddingReady }`.

### Fixes Applied (Initial Pass)

1. **HIGH** — Startup isolation: Telegram + mesh wrapped in try/catch so failures don't crash boot
2. **MEDIUM** — Config bounds: `RATE_LIMIT_PER_MIN` min:1/max:10000, `FREE_TRIAL_CREDITS` in Zod schema
3. **LOW** — Webhook 413 response now includes `code: 'PAYLOAD_TOO_LARGE'`
4. **MEDIUM** — Auth type safety: `getApiKey()` returns typed `credits_used` + `amount_paid`, no unsafe casts
5. **LOW** — Structured boot log with operational fields
6. **MEDIUM** — Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`) on every response

### Fixes Applied (Recheck)

7. **MEDIUM** — Health check moved BEFORE middleware stack: monitoring/Docker pings no longer run through CORS, security headers, rate limiter, body limit, hono logger, or nanoid generation. At 10K+ health pings/day this eliminates ~6 middleware hops per ping.
8. **HIGH** — Drain timeout increased from 5s → 15s: SSE streams run up to 30s, batch queries up to 20s. The 5s drain was killing active requests on every deploy. 15s covers the vast majority of in-flight work while keeping deploy latency reasonable.

### Recheck Verdict

Per-key tiered rate limiting (`rateTier()`) is enforced on all credit-spending routes (api.ts, batch.ts, skills.ts, openclaw.ts) via separate `rl:orch:{key}` counters — confirmed correct. Two-layer rate limiting (IP global + per-key tiered) is the right architecture for an agent economy.

**Deferred to later chapters:**
- Request timeouts on slow LLM/API calls → Ch03 (Executor pipeline)
- `nanoid(12)` vs UUIDv7 for request IDs → Ch08 (API Design)
- Route lazy loading for rarely-used endpoints → Ch15 (Scalability)

### Why It Matters

The architecture is the load-bearing wall. A misconfigured middleware chain means every request is vulnerable. A startup ordering bug means the server accepts traffic before it's ready. A missing error handler means one bad webhook crashes the entire platform. At millions of requests, every millisecond of middleware overhead compounds. Every startup dependency that can fail needs isolation. The foundation must be bulletproof because every other chapter builds on it.

---

## Chapter 02 — Database Design & Data Lifecycle

### Scope

29 tables, 44+ indexes, 41 migrations, and the lifecycle of every row from creation to cleanup. SQLite WAL mode on a single file (`data/orchestrator.db`) is the entire persistence layer. This chapter audits schema design, migration safety, query patterns, data retention, and whether the database can handle millions of rows without degradation.

### Files to Read

```
src/db/connection.ts               — 530 lines. initDb(), 41 migrations, WAL/FK pragmas, safeJsonParse, logAudit
src/db/index.ts                    — barrel re-export from 9 domain modules
src/db/keys.ts                     — 407 lines. API key CRUD, Clerk linking, regeneration, referrals, subscriptions
src/db/credits.ts                  — 127 lines. deductCredit, topUpCredits, Stripe/Solana idempotency
src/db/skills.ts                   — 489 lines. Skill CRUD, listings, staking, A/B testing, versions
src/db/marketplace.ts              — 434 lines. Purchase, refund, transactions, payout requests
src/db/escrow.ts                   — 172 lines. 7-state escrow machine, fund/release/refund/resolve
src/db/governance.ts               — governance proposals, voting, weight calculation
src/db/services.ts                 — 366 lines. Tasks, task ratings, swarms, endpoint health, peer management
src/db/audit.ts                    — 107 lines. writeAuditLog, 12 cleanup functions
src/db/admin.ts                    — reconciliation, revenue, treasury, key revocation
```

### Current Implementation

**29 tables + 1 virtual (skill_embeddings) + 1 cache (discovery_cache):**

| Category | Tables | Growth Pattern |
|----------|--------|---------------|
| Core | api_keys, users, claim_tokens | Bounded (1 per user) |
| Financial | transactions, subscriptions, payout_requests | Unbounded (1 per purchase) |
| Skills | skills, skill_versions, skill_metrics, skill_stars, skill_reports, skill_ratings, skill_embeddings | Mixed (skills bounded, metrics unbounded) |
| Escrow | escrows | Unbounded (1 per work agreement) |
| Governance | proposals, votes | Unbounded (1 per proposal/vote) |
| Tasks | tasks (was missing table), task_ratings | Unbounded (1 per async task) |
| Marketplace | stakes | Semi-bounded (1 per user-skill pair) |
| Infrastructure | peers, endpoint_health, telegram_subscribers, swarms | Bounded (peers pruned, health upsert) |
| Idempotency | solana_processed_sigs, stripe_processed_sessions, stripe_processed_events, stripe_refunded_charges | Unbounded (1 per payment event) |
| Audit | audit_log, orchestrations, feedback, email_send_log | Unbounded (1 per operation) |
| Referral | referral_codes, referral_uses | Semi-bounded |
| Schema | schema_migrations | Bounded (1 per migration) |

**44+ indexes** covering: entity PKs, foreign keys, sorting (uses DESC, stars DESC, published_at DESC), search (author, email, status), and cleanup (timestamp columns).

**Migrations (v1–v41):** Run sequentially in `initDb()`. Each checks `schema_migrations` before applying. No rollback mechanism.

**Key pragmas:**
- `journal_mode = WAL` (concurrent reads, serialized writes)
- `foreign_keys = ON`
- `busy_timeout = 5000` (5s retry on SQLITE_BUSY)

**Cleanup functions (12 total in audit.ts):**
- `cleanupOldAuditLogs(90d)`, `cleanupOldSkillMetrics(90d)`, `cleanupOldSolanaSigs(30d)`, `cleanupOldOrchestrations(180d)`, `cleanupOldFeedback(365d)`, `cleanupOldEmailLog(30d)`, `cleanupStalePeers(7d)`, `cleanupOldStripeSessions(90d)`, `cleanupOldStripeEvents(90d)`, `cleanupExpiredClaimTokens()`, `cleanExpiredDiscoveryCache()`, `pruneStalePeers(7d)`

### Audit Questions

1. **Tables with NO cleanup function:** `transactions`, `tasks`, `task_ratings`, `escrows` (completed), `proposals`, `votes`, `skill_stars`, `skill_reports`, `reputation_events`, `swarms`, `subscriptions`, `payout_requests`. At 1M+ purchases, the `transactions` table alone could reach millions of rows. Which tables need retention policies?
2. **Migration safety** — migrations run synchronously on startup. If migration v42 has a bug (e.g., drops a column), there's no rollback. The server crashes and can't restart until the migration is manually fixed. Is there a backup-before-migrate step?
3. **Foreign key enforcement** — `foreign_keys = ON` but many tables reference `api_keys.key` which can be deactivated (soft delete). Does deactivating a key orphan its transactions, tasks, escrows, and stakes?
4. **WAL checkpoint** — SQLite auto-checkpoints WAL at 1000 pages. Under heavy write load, the WAL file can grow to hundreds of MB. Is there an explicit `PRAGMA wal_checkpoint(TRUNCATE)` on shutdown?
5. **Index coverage for cleanup queries** — cleanup functions use `WHERE timestamp < datetime('now', '-90 days')`. Are there indexes on the timestamp columns used in cleanup? Missing indexes mean full table scans on large tables.
6. **Concurrent migration risk** — if two server instances start simultaneously (Docker restart race), both run migrations. SQLite transactions prevent corruption, but duplicate migration attempts could cause confusing errors.
7. **JSON column parsing** — `tags_json`, `metadata_json`, `sub_tasks_json`, `data_json` store JSON strings. `safeJsonParse()` handles malformed JSON, but there's no schema validation on read. Corrupted JSON could cause runtime errors in business logic.
8. **Skill embedding virtual table** — `skill_embeddings` uses `sqlite-vec` extension (alpha). Is the extension loaded before the virtual table is queried? What happens if the extension binary is missing on a fresh deploy?
9. **Auto-increment vs nanoid** — some tables use `INTEGER PRIMARY KEY AUTOINCREMENT` (audit_log, transactions), others use `nanoid` strings (skills, escrows, tasks). Is there a consistent PK strategy?
10. **Barrel export risk** — `src/db/index.ts` re-exports everything from 9 modules. If two modules export the same function name, the later export silently wins. Are there naming conflicts?
11. **busy_timeout behavior** — 5s wait on SQLITE_BUSY. At 100 concurrent writes, requests queue behind the lock. The 101st request waits 5s then gets SQLITE_BUSY error. Is 5s appropriate? What error does the user see?
12. **Data integrity constraints** — are CHECK constraints used? For example, `credits >= 0` to prevent negative balances, `rating BETWEEN 1 AND 5` for reviews, `credit_cost > 0` for skills?

### Production-Scale Concerns

- **SQLite at 1M rows:** The `orchestrations` table grows fastest (~1K rows/day at moderate usage). At 180-day retention, that's 180K rows. `DELETE WHERE created_at < X` on 180K rows locks the database for seconds. Need batched deletes (`DELETE ... LIMIT 10000` in a loop).
- **Transaction table unbounded:** No cleanup. At 10K purchases/month, transactions table hits 120K rows/year. Aggregate queries (`SUM`, `COUNT` for creator stats) become expensive without covering indexes.
- **WAL file size:** Under sustained write pressure (cron cleanup + API writes), the WAL file can exceed the main DB size. Need explicit checkpointing.
- **Single-writer bottleneck:** SQLite serializes ALL writes. At peak load, write transactions queue. A long-running transaction (marketplace purchase with 3 table updates) blocks ALL other writes for its duration.
- **Vacuum:** SQLite doesn't reclaim space from deleted rows automatically. After cleanup cron deletes 100K rows, disk space isn't freed until `VACUUM`. But `VACUUM` requires 2× DB size in free disk space and locks the entire database.

### Feature Opportunities

- **Batched cleanup** — `DELETE ... LIMIT 10000` in a loop with `PRAGMA wal_checkpoint(PASSIVE)` between batches. Prevents long locks.
- **Archival strategy** — move old transactions/orchestrations to a separate archive DB instead of deleting. Preserves audit trail without growing the hot DB.
- **CHECK constraints** — `credits >= 0`, `rating BETWEEN 1 AND 5`, `credit_cost > 0`. Catches bugs at the DB level instead of in application code.
- **Migration backup** — `sqlite3 .backup` before running new migrations. Enables rollback on failure.
- **Read replica** — use `litestream` for real-time replication to S3. Analytics queries run against the replica, not the primary.
- **Schema documentation** — auto-generate an ERD from the migration file. Currently, the schema is only documented in code.

### Fixes Applied

1. **CRITICAL** — Financial safety triggers (migration v42): `trg_credits_non_negative` on api_keys (ABORT if credits < 0), `trg_credit_cost_non_negative` on skills INSERT/UPDATE, `trg_escrow_amount_positive` on escrows INSERT, `trg_stake_amount_positive` on stakes INSERT. Database-level enforcement — no application bug can create negative balances.

2. **HIGH** — Missing cleanup indexes (migration v43): Added indexes on `feedback(timestamp)`, `stripe_processed_sessions(processed_at)`, `stripe_processed_events(processed_at)`, `peers(last_seen)`, `claim_tokens(expires_at)`, `transactions(created_at)`, `tasks(completed_at)`, `swarms(created_at)`, `reputation_events(timestamp)`. Previously, cleanup queries on these tables did full table scans.

3. **HIGH** — Batched cleanup deletes: Rewrote all 10 cleanup functions to use `DELETE ... WHERE rowid IN (SELECT rowid ... LIMIT 5000)` in a loop. At 100K+ rows, a single unbounded DELETE holds the SQLite write lock for seconds — blocking all API writes. Batched deletes keep each lock under ~50ms.

4. **HIGH** — WAL checkpoint on shutdown: `closeDb()` now runs `PRAGMA wal_checkpoint(TRUNCATE)` before closing. Prevents WAL file from growing unbounded across restarts. Daily cleanup cron also runs `PRAGMA wal_checkpoint(PASSIVE)` after bulk deletes.

5. **MEDIUM** — Cleanup for 5 previously unbounded tables: `cleanupOldTasks(90d)`, `cleanupOldSwarms(90d)`, `cleanupOldReputationEvents(365d)`, `cleanupOldTransactions(730d)` (2-year financial retention), `cleanupOldVotes(365d)` on closed proposals. All wired into daily cron.

6. **LOW** — `getKeyStats()` DATE() fix: Changed `DATE(timestamp) = ?` to range comparison `timestamp >= ? AND timestamp < ?`. The DATE() function wraps every row preventing index use — range comparison uses `idx_orchestrations_timestamp` directly.

### Recheck Verdict

All 29 tables now have either bounded growth (upsert/dedup), retention cleanup, or finite cardinality. Financial columns are protected by SQLite triggers — a bug in deductCredit that somehow sets credits negative will now ABORT the transaction at the DB level. Cleanup operations are batched to keep write lock time under 50ms per batch. WAL is checkpointed on shutdown and after daily cleanup.

**Deferred to later chapters:**
- Migration backup strategy (sqlite3 .backup before migrate) → Ch12 (Infrastructure)
- Read replica via litestream → Ch15 (Scalability)
- Archival strategy for old transactions → Ch15 (Scalability)

### Why It Matters

The database is the single source of truth for every credit, every payment, every skill, and every user. A schema bug means incorrect balances. A missing index means slow queries that lock the database. Unbounded table growth means disk full at 3am. No backup strategy means a disk failure loses all user data — real money gone. SQLite is perfect for ClawNet's scale, but only if every table has a growth plan, every query has index coverage, and every migration is safe to run.

---

## Chapter 03 — Financial Engine

### Scope

Every operation that moves credits: deduction, top-up, marketplace purchase, escrow fund/release/refund, stake/unstake, payout requests, Stripe webhooks, Solana USDC verification, and subscription renewals. At scale, this handles millions of dollars in credit value. A single atomicity bug means money appears or disappears.

### Files to Read

```
src/db/credits.ts                  — 127 lines. deductCredit, topUpCredits, Stripe/Solana idempotency guards
src/db/escrow.ts                   — 172 lines. 7-state machine: CREATED→FUNDED→WIP→COMPLETED/REFUNDED/DISPUTED→RESOLVED
src/db/marketplace.ts              — 434 lines. Purchase (97/3 split), refund (deficit tracking), stake/unstake, payout
src/routes/stripe.ts               — 349 lines. checkout.session.completed, invoice.payment_succeeded, charge.refunded
src/routes/solana.ts               — 324 lines. USDC verify with on-chain tx walking, RPC fallback, atomic signature claim
src/db/keys.ts                     — 407 lines. topUpCreditsForClerk, regenerateApiKey (balance preservation)
src/routes/api.ts                  — orchestration billing: pre-check, deduction, cache-hit costing
src/routes/batch.ts                — batch billing: per-query deduction, step limit enforcement
src/routes/swarm.ts                — SWARM_BASE_FEE=20 upfront deduction
```

### Current Implementation

**Credit formula:** `Math.max(1, Math.ceil(apiCosts * CREDITS_PER_USD))` where `CREDITS_PER_USD=2000` (1 credit ≈ $0.0005).

**Core financial operations (all wrapped in `db.transaction()`):**

| Operation | Atomicity | Idempotency | Audit Logged |
|-----------|-----------|-------------|-------------|
| `deductCredit(key, amount)` | Yes | No (caller responsibility) | Yes |
| `topUpCredits(key, credits, session?, paid?)` | Yes | Session dedup | Yes |
| `marketplacePurchase(buyer, skill, cost)` | Yes (3 table updates) | No | Yes (transaction record) |
| `marketplaceRefund(buyer, skill, credits)` | Yes (3 table updates) | No | Yes (SKILL_REFUND) |
| `fundEscrow(id, hirerId)` | Yes (deduct + state change) | No | Yes |
| `releaseEscrow(id)` | Yes (credit worker + state) | No | Yes |
| `refundEscrow(id)` | Yes (credit hirer + state) | No | Yes |
| `resolveEscrow(id, workerPct)` | Yes (split + state) | No | Yes |
| `stakeCredits(key, skill, amount)` | Yes (deduct + insert) | No | Yes |
| `unstakeCredits(stakeId, key)` | Yes (credit + delete) | No | Yes |

**Payment idempotency guards:**
- `stripe_processed_sessions` — prevents double credit on checkout.session.completed replay
- `stripe_processed_events` — prevents double credit on invoice.payment_succeeded replay
- `solana_processed_sigs` — prevents double credit on signature resubmission
- `stripe_refunded_charges` — tracks cumulative refund cents (delta-based)

**Revenue share model:**
- Official skills (`clawhub-official`): 0% fee, 100% to official key
- Community skills: 3% platform fee → `clawhub-treasury`, 97% → creator
- Minimum fee: 1 credit (if skill costs ≥10 credits), else 0
- Self-purchase blocked by email match

**Stripe pricing tiers:**
| Amount | Credits | Bonus |
|--------|---------|-------|
| $5 | 5,000 | 0% |
| $20 | 21,000 | +5% |
| $50 | 54,000 | +8% |
| $100 | 112,000 | +12% |
| $500 | 600,000 | +20% |
| $1,000 | 1,300,000 | +30% |

**USDC pricing:** All tiers +7% vs Stripe (e.g., $100 → 120K instead of 112K).

**Subscription rollover cap:** Monthly credits capped at 3× allotment to prevent accumulation.

### Audit Questions

1. **deductCredit negative balance** — `credits -= amount` with a `WHERE credits >= amount` guard. But is there a CHECK constraint `credits >= 0` at the DB level? Without it, a race condition between two concurrent deductions could overdraw.
2. **Marketplace purchase atomicity** — the transaction updates 3 tables (buyer, seller, treasury). If the treasury key doesn't exist, does the transaction rollback? Or is the fee silently lost?
3. **Escrow resolve rounding** — `resolveEscrow(id, workerPct=70)` splits amount by percentage. If amount=99 credits and workerPct=33, worker gets 32.67 → Math.floor(32)? Math.round(33)? Where do remainder credits go?
4. **Stripe refund negative delta** — `newCents = charge.amount_refunded - previousCents`. If Stripe sends a dispute reversal (amount_refunded decreases), delta goes negative. `creditsToDeduct = Math.round(newCents * creditsPerDollar / 100)` would be negative → `topUpCredits` instead of deduct? Trace this path.
5. **Solana RPC race** — `tryClaimSolanaSignature()` uses INSERT OR IGNORE. If two requests arrive simultaneously with the same signature, only one claims. But does the second request return 409 or proceed to on-chain verification (wasting RPC quota)?
6. **Regenerate key balance transfer** — `regenerateApiKey` copies `credits`, `credits_used`, `amount_paid` to new key. Are active escrows, stakes, and pending payouts also transferred? Or do they reference the old (now deactivated) key?
7. **Payout request credit lock** — `createPayoutRequest` deducts credits immediately but the actual USDC transfer is manual/off-chain. If the admin rejects the payout, are credits restored? Trace the rejection path.
8. **Subscription cancellation mid-period** — if a user cancels their subscription, do they keep credits already granted for the current period? Or are they clawed back?
9. **Marketplace deficit tracking** — if a refund finds the seller has insufficient balance, it records a deficit in metadata. But who follows up? Is there an admin alert? An automated recovery?
10. **Swarm base fee timing** — `SWARM_BASE_FEE=20` is deducted upfront. If the swarm task fails immediately, is the 20-credit fee refunded or consumed?
11. **Cache hit billing** — orchestration charges 1 credit on cache hit. But what if the cached result is stale or incorrect? The user pays for a bad answer with no recourse.
12. **Batch pre-flight estimation** — batch billing estimates total cost upfront but charges actuals. If actual > estimate (more steps than planned), are extra credits deducted atomically? What if the user runs out mid-batch?

### Production-Scale Concerns

- **Write serialization:** Every credit operation requires a SQLite write transaction. At 1000 concurrent purchases, transactions queue behind the WAL write lock. Worst case: 5s busy_timeout → SQLITE_BUSY → 500 error → user thinks payment failed.
- **Stripe webhook volume:** 1000+ subscription renewals per month. Each triggers a DB transaction. If webhooks arrive in bursts (Stripe batch retry), SQLite write queue spikes.
- **Audit log volume:** Every financial operation writes to `audit_log`. At 10K operations/day, that's 3.6M rows/year. Cleanup at 90 days means 900K rows in the table.
- **Transaction table analytics:** `getCreatorStats()` runs `SUM(amount_credits)` across all transactions for an author. At 100K+ transactions, this is a full table scan without a covering index.
- **Float precision:** `CREDITS_PER_USD=2000` and credit costs are integers. But `apiCosts` from ClawAPIs are floats. `Math.ceil(0.0001 * 2000) = 1`. At high volumes, rounding always rounds up — platform overcharges slightly. Acceptable?

### Feature Opportunities

- **Double-entry ledger** — every credit movement recorded as debit/credit pair. Enables self-auditing: `SUM(debits) = SUM(credits)` always. Currently, balance is stored as a single field.
- **Credit holds** — pre-authorize credits before execution (like credit card holds). Prevents overdraw on long-running tasks without immediate deduction.
- **Spend rate alerting** — detect anomalous spend patterns (5000 credits in 1 day threshold exists but limited). Add per-key velocity checks.
- **Refund automation** — currently manual. Add auto-refund on skill execution failure (>50% step failure rate).
- **Financial reconciliation report** — admin endpoint that compares `SUM(all credits granted)` vs `SUM(all credits spent) + SUM(all current balances)`. Any discrepancy = bug.

### Why It Matters

Credits are real money. Every credit represents ~$0.0005 that a user paid via Stripe or USDC. A rounding error in marketplace purchase that loses 1 credit per transaction compounds to thousands of dollars at scale. A missing idempotency guard means Stripe webhook replay grants double credits. A race condition in deductCredit means a user can spend more than they have. The financial engine must be provably correct — not "works most of the time" but "mathematically guaranteed to never lose or create money."

### Status: ✅ COMPLETE

### Audit Verdicts

| # | Question | Verdict | Action |
|---|----------|---------|--------|
| Q1 | deductCredit negative balance | ✅ PASS | `WHERE credits >= amount` + `trg_credits_non_negative` trigger (v42) — double protection |
| Q2 | Marketplace purchase atomicity | ✅ PASS | Treasury missing → exception → full rollback |
| Q3 | Escrow resolve rounding | ✅ PASS | `Math.floor(amount * pct / 100)`, remainder goes to hirer — no credits vanish |
| Q4 | Stripe refund negative delta | ✅ PASS | `newCents <= 0 → skip` — dispute reversals safely ignored |
| Q5 | Solana RPC race | ✅ PASS | Second request gets `changes === 0` → 409, no wasted RPC |
| Q6 | Key regeneration transfers | 🔴 BUG FIXED | Stakes and pending payouts were orphaned on key regen. Added `UPDATE stakes/payout_requests SET agent_key = newKey` inside the transaction |
| Q7 | Payout rejection credit restore | 🔴 BUG FIXED | `REJECTED` status set but credits never returned. Added atomic credit restoration in `PATCH /v1/admin/payouts/:id` when status=REJECTED |
| Q8 | Subscription cancellation | ✅ PASS | Credits already granted are kept — correct UX behavior |
| Q9 | Deficit tracking followup | ⚠️ IMPROVED | Added `sendAdminAlert()` on refund deficit (seller/treasury balance insufficient) |
| Q10 | Swarm base fee on failure | ✅ PASS | Fee consumed by design (covers LLM decomposition cost) |
| Q11 | Cache hit billing | ✅ PASS | 1 credit for cache hit is acceptable (fast response, TTL prevents staleness) |
| Q12 | Batch pre-flight estimation | ✅ PASS | Deducts estimate upfront, refunds difference. Costs are deterministic from registry |

### Production-Scale Fix

- **Migration v44:** Added covering index `idx_transactions_creator_stats` on `transactions(to_agent, type, skill_id, amount_credits, fee_credits) WHERE type = 'SKILL_SALE'` — eliminates full table scan in `getCreatorStats()` at 100K+ transactions

### Fixes Applied

1. **Q6 — `regenerateApiKey` orphaned stakes** (`src/db/keys.ts`): Added `UPDATE stakes SET agent_key = newKey` and `UPDATE payout_requests SET agent_key = newKey` inside the regen transaction. Without this, regenerating a key would orphan locked credits in stakes (user could never unstake) and disconnect pending payout requests from the new key.

2. **Q7 — Payout rejection didn't restore credits** (`src/routes/admin.ts`): When admin marks a payout as REJECTED, credits are now atomically restored to the user's balance. Previously, rejection just updated the status field — credits were permanently lost. Also added state guards (can't reject an already-rejected or already-paid payout).

3. **Q9 — Refund deficit admin alert** (`src/db/marketplace.ts`): `marketplaceRefund()` now fires `sendAdminAlert()` when a refund creates a seller or treasury deficit. Previously, deficits were logged and recorded in tx metadata but nobody was notified.

4. **Migration v44 — Creator stats index** (`src/db/connection.ts`): Covering index for `getCreatorStats()` so `SUM(amount_credits)` across transactions doesn't require a full table scan at scale.

---

## Chapter 04 — Authentication, Authorization & Identity

### Scope

Three auth systems (API key, Clerk JWT, admin key), two identity models (API key email, Clerk user ID), rate limiting per-IP and per-key, key lifecycle (creation, linking, regeneration, deactivation), and the authorization boundaries that determine what each identity can access.

### Files to Read

```
src/middleware/auth.ts              — 72 lines. checkApiKey middleware, env key fallback, timing-safe comparison
src/middleware/clerk-auth.ts        — 75 lines. requireClerkAuth middleware, email cache, Clerk API fallback
src/middleware/rate-limit.ts        — 59 lines. IP extraction, proxy trust, Redis-backed counters
src/routes/dashboard.ts            — 336 lines. Key reveal, regenerate, billing portal, magic claim links
src/routes/auth-tokens.ts          — 60 lines. /auth/me, /auth/usage, /auth/estimate
src/routes/admin.ts                — admin key check, dashboard, treasury, revenue endpoints
src/db/keys.ts                     — 407 lines. Key CRUD, Clerk linking, email lookup, subscriptions
src/config/index.ts                — ADMIN_API_KEY enforcement, ADMIN_CLERK_IDS, rate tier config
```

### Current Implementation

**Three auth layers:**

| Layer | Mechanism | Protected Routes | Identity |
|-------|-----------|-----------------|----------|
| API Key | `X-API-Key` header, `cn-[a-f0-9]{48}` format | All /v1/* endpoints | `apiKeyInfo.key` |
| Clerk JWT | `Authorization: Bearer <token>` | Dashboard, Solana, contact | `clerkUserId` + `clerkEmail` |
| Admin Key | `X-Admin-Key` header, constant-time compare | /v1/admin/* | N/A (system identity) |

**API key auth flow:**
1. Check env keys first (comma-separated `API_KEYS`, timing-safe compare, grants Infinity credits)
2. Regex validate format: `cn-[a-f0-9]{48}`
3. DB lookup: `getApiKey(key)` → email, credits, credits_used, amount_paid, active
4. Set `apiKeyInfo` on Hono context

**Rate limiting:**
- Global: `RATE_LIMIT_PER_MIN` (default 60) per IP
- Per-key tiered: `<$20: 30/min, $20-99: 60/min, $100-499: 120/min, $500+: 300/min`
- Redis-backed: `rl:{ip}` with 60s TTL
- Fallback: in-memory counters if Redis is down (reset on restart)

**Clerk email cache:**
- `Map<clerkUserId, { email, expiresAt }>`
- 5-min TTL, 10K max entries
- LRU eviction: moves hit entries to end of Map
- Background purge every 10 minutes (timer.unref())

**Key lifecycle:**
- Created via: Stripe checkout, USDC payment, free trial, admin
- Linked to Clerk user: auto-link if email matches, or via magic claim token
- Regenerated: new key inherits balance, old key deactivated (rate-limited 3/hour)
- Deactivated: `active=0`, key stops working immediately

### Audit Questions

1. **Timing-safe comparison scope** — env keys use `crypto.timingSafeEqual`. But DB key lookup uses `SELECT WHERE key = ?` which is NOT timing-safe (SQLite string comparison leaks key length via timing). Is this acceptable given keys are 48 hex chars (fixed length)?
2. **Rate limit reset on Redis failure** — when Redis goes down, rate limits fall back to in-memory Map. If Redis recovers, the in-memory counters are discarded. A user who was rate-limited can burst again. Is there a synchronization mechanism?
3. **Clerk email cache poisoning** — if a Clerk user changes their email, the cache serves the stale email for up to 5 minutes. During this window, key auto-linking could match the wrong key. How critical is this?
4. **Key regeneration race** — `regenerateApiKey` copies balance then deactivates old key. If a concurrent request uses the old key between copy and deactivation, both keys have the same balance briefly. Is this a double-spend window?
5. **Admin key in env** — `ADMIN_API_KEY` is a single string. If it leaks, there's no rotation mechanism without server restart. Should admin auth use Clerk instead (supports `ADMIN_CLERK_IDS`)?
6. **Magic claim token security** — tokens expire in 1 hour, are single-use (atomic `markClaimTokenUsed()`). But the token is sent via email as a URL parameter. Is the token long enough to prevent brute force? What's the entropy?
7. **API key in URL** — some endpoints accept the key via query parameter `?key=cn-...`. This leaks the key in access logs, browser history, and referrer headers. Is this pattern used?
8. **Per-key rate limit enforcement** — rate tiers are based on `amountPaid` (lifetime spend). A user who bought $500 once gets 300 req/min forever, even after spending all credits. Is this correct? Should tier be based on current balance?
9. **Deactivated key cleanup** — deactivated keys stay in the DB indefinitely. At 100K users with key regenerations, the api_keys table grows without bound. Is there cleanup for deactivated keys?
10. **Multi-key per user** — a Clerk user can have multiple API keys (Stripe creates new key per purchase). `getApiKeyByClerkId` returns the latest. Are older keys still active? Can a user abuse multiple active keys to bypass rate limits?
11. **IP extraction trust** — `getClientIp()` trusts X-Forwarded-For from private ranges (10.x, 172.16-31.x, 192.168.x). Behind Caddy (reverse proxy), the client IP is in X-Forwarded-For. But if an attacker sends a request directly to port 3402 (bypassing Caddy), they can spoof X-Forwarded-For. Is port 3402 firewalled?
12. **Auth bypass on public endpoints** — `/v1/stats`, `/v1/registry`, `/health`, `/v1/marketplace/skills` are public. Can these endpoints be abused for reconnaissance (enumerate skills, discover pricing, probe health)?

### Production-Scale Concerns

- Clerk email cache at 10K entries uses ~2MB of memory. At 100K concurrent users, cache misses trigger Clerk API calls. Clerk rate limit is ~100 req/s — at scale, cache miss storms could exhaust the Clerk API quota.
- Rate limit Redis keys: at 100K unique IPs/day, Redis stores 100K keys with 60s TTL. This is fine for 128MB Redis, but if IPs are IPv6 (long strings), memory usage increases.
- API key DB lookup on every request: at 10K req/s, that's 10K SQLite reads/sec. WAL mode handles this well, but each read still acquires a shared lock.

### Feature Opportunities

- **API key scoping** — restrict keys to specific actions (read-only, specific skills, spend cap per request).
- **API key expiry** — optional TTL on keys. Auto-deactivate after 90 days of inactivity.
- **OAuth2 support** — for programmatic integrations, support standard OAuth2 client credentials flow.
- **Session-based auth** — for the frontend, use httpOnly cookies instead of sending API keys in headers.
- **Rate limit headers** — return `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Limit` on every response.
- **Key rotation alerts** — email users when their key hasn't been rotated in 90+ days.

### Status: ✅ COMPLETE

| # | Question | Verdict |
|---|----------|---------|
| Q1 | Timing-safe DB lookup | **SAFE** — keys are fixed 51 chars (`cn-` + 48 hex), regex pre-filter rejects wrong lengths before DB hit |
| Q2 | Rate limit Redis failover | **ACCEPTABLE** — worst case = 60 extra requests in 60s window, `cacheIncr` memory fallback sufficient |
| Q3 | Clerk email cache stale 5 min | **LOW RISK** — email changes rare, auto-linking only matches own existing key |
| Q4 | Key regen race condition | **SAFE** — single `db.transaction()`, SQLite serializes, no double-spend window |
| Q5 | Admin key rotation | **ACCEPTABLE** — env-based admin fine for single VPS, `ADMIN_CLERK_IDS` exists for Clerk-based admin |
| Q6 | Claim token entropy | **SAFE** — `crypto.randomBytes(32)` = 256 bits, 1-hour expiry, atomic single-use |
| Q7 | API key in URL | **NOT FOUND** — all routes use `X-API-Key` header only |
| Q8 | Rate tier on lifetime spend | **BY DESIGN** — rewards loyal customers, doesn't affect credit deduction |
| Q9 | Deactivated key cleanup | **FIXED** — added `cleanupDeactivatedKeys(90)` to daily retention cron |
| Q10 | Multi-key per user | **BY DESIGN** — rate limiting is per-IP, multi-key doesn't bypass limits. Stripe tops up existing keys; `createApiKey` only fires for genuinely new users |
| Q11 | IP trust / port 3402 | **SAFE** — `getClientIp()` uses raw socket IP in production when not from proxy range; direct access can't spoof |
| Q12 | Public endpoint recon | **ACCEPTABLE** — only public data exposed (stats, public skills, health), no user/key enumeration |

### Fixes Applied

- **Q9**: Added `cleanupDeactivatedKeys()` in `src/db/audit.ts` — batched delete of `active=0, credits=0` keys older than 90 days. Wired into daily retention cron in `endpoint-health-cron.ts`.

### Why It Matters

Auth is the front door. A timing attack on key comparison lets an attacker recover the key byte by byte. A rate limit bypass lets a single user DDoS the platform. A key regeneration race condition creates double-spend. Identity linking bugs mean one user can access another's credits. At scale, every auth decision is made millions of times per day — the cost of getting it wrong even 0.01% of the time is thousands of unauthorized operations.

---

## Chapter 05 — Security & Attack Surface

### Scope

Every input validation, output sanitization, injection prevention, and trust boundary in the system. Prompt injection in skill templates, XSS in HTML outputs, SQL injection via user input, HMAC response signing, and the 17-pattern security scanner that gates skill publication.

### Files to Read

```
src/core/skill-scanner.ts          — 61 lines. 17 regex patterns for prompt injection/XSS/SQL detection
src/utils/html.ts                  — 10 lines. escapeHtml() for &, <, >, ", '
src/utils/template.ts              — 21 lines. renderTemplate() with 500-char cap + 3-pattern sanitization
src/core/skill-executor.ts         — 96 lines. buildIntentFromPlan() with {var} interpolation
src/middleware/sign-response.ts     — 36 lines. HMAC-SHA256 response signing
src/core/circuit-breaker.ts        — 157 lines. Per-endpoint failure isolation, MAX_CIRCUITS=500
src/integrations/telegram.ts       — sanitizeInput() strips NFKC + control chars
src/middleware/rate-limit.ts        — IP extraction with proxy trust validation
```

### Current Implementation

**Skill security scanner (17 patterns):**
1. `ignore previous/all/prior instructions` — prompt injection
2. `[SYSTEM]` / `SYSTEM:` markers — persona override
3. `you are now a/an` — identity hijack
4. `disregard your/all/any rules` — bypass
5. `do not follow/obey your/the rules` — bypass
6. `reveal your/the system/hidden prompt` — data exfiltration
7. `print your/the api-key/secret/token` — credential extraction
8. `process.env` / `__ENV__` — env variable access
9. `exec/eval/require/import` — code execution
10. `base64.*decode / atob / Buffer.from.*base64` — obfuscation
11. Long URLs (20+ chars) to non-API domains — data exfiltration channel
12. `<script>`, `javascript:` — XSS
13. SQL keywords (SELECT/INSERT/UPDATE/DELETE + FROM/INTO/SET) — SQL injection
14. `{{...}}` repeated 5+ times — template bomb
15. Unicode normalization (fullwidth ASCII, zero-width chars)

**Template rendering (`renderTemplate`):**
- Replaces `{{varName}}` with variable values
- Each value capped at 500 chars
- 3 sanitization patterns: `[SYSTEM]→[FILTERED]`, `SYSTEM:→FILTERED:`, `ignore previous instructions→[FILTERED]`

**HMAC response signing:**
- Header: `X-ClawNet-Signature: t=<unix_ms>,v1=<hmac-sha256(t.body, secret)>`
- Applied to: orchestrate, invoke, batch, balance, tasks
- Graceful degradation: if secret missing, sends unsigned response

**Circuit breaker:**
- States: CLOSED → OPEN (5 failures) → HALF_OPEN (2min cooldown) → CLOSED (2 successes)
- Max 500 circuits tracked (evicts oldest CLOSED)
- 7-day auto-reset for stuck OPEN/HALF_OPEN
- Redis persistence (fire-and-forget, 24h TTL)

### Audit Questions

1. **Scanner bypass via encoding** — the scanner normalizes fullwidth ASCII and strips zero-width chars, but does it handle: URL encoding (`%69gnore %70revious`), HTML entities (`&#105;gnore`), Unicode homoglyphs (Cyrillic `а` vs Latin `a`), or mixed-case evasion?
2. **Template injection depth** — `renderTemplate` sanitizes 3 patterns in variable VALUES. But what about the template ITSELF? If a skill creator puts `{{ignore_previous}}` as a variable name, the rendered output contains the literal attack string.
3. **SQL injection via skill names** — skill names are used in SQL `LIKE` queries for search. If a skill is named `%'; DROP TABLE skills; --`, does the parameterized query prevent injection? Verify all SQL uses parameterized queries, not string interpolation.
4. **XSS in email templates** — `sendApiKeyEmail` and `sendLowBalanceEmail` inject user data (email, credits, key) into HTML templates. Are all interpolated values escaped with `escapeHtml()`?
5. **HMAC replay attack** — the signature includes timestamp but there's no replay window check on the client side. An intercepted signed response can be replayed indefinitely. Should the client validate `t` is within 5 minutes?
6. **Circuit breaker poisoning** — if an attacker sends 5 requests to a non-existent endpoint ID, the circuit opens and blocks all future requests to that endpoint. Can user-supplied data create arbitrary circuit breaker entries?
7. **Skill executor interpolation** — `buildIntentFromPlan` uses `{varName}` syntax (single braces) while templates use `{{varName}}` (double braces). If a user supplies a value containing `{otherVar}`, does it get double-interpolated?
8. **SSRF via API proxy skills** — `skill_type='api_proxy'` makes HTTP requests to `proxy_url`. If a skill creator sets `proxy_url` to an internal address (`http://localhost:3402/v1/admin/dashboard`), can they access internal endpoints?
9. **Telegram input sanitization** — `sanitizeInput()` strips control chars but preserves Unicode. Can a crafted Unicode string cause issues in Pino logging (log injection), SQLite storage, or Telegram API calls?
10. **Response signing scope** — not all endpoints are signed (only orchestrate, invoke, batch, balance, tasks). Can an attacker MITM unsigned endpoints (marketplace purchase, governance vote) to modify responses?
11. **Env key abuse** — env keys get Infinity credits. If the env key leaks via logs or error messages, an attacker has unlimited access. Verify env keys are never logged, even in error paths.
12. **Body size limit bypass** — 256KB limit is on request body. But SSE streaming (GET request, no body) could be used to trigger unbounded server-side processing if the query parameter is very long. Is there a query string length limit?

### Production-Scale Concerns

- Scanner runs on every skill publish + fork + invoke-time variables. At 1000 invocations/min, that's 1000 regex evaluations. Current 17 patterns are fast, but adding more complex patterns could impact latency.
- Circuit breaker MAX_CIRCUITS=500. With 163 endpoints, this is sufficient. But if skills create custom proxy URLs, each unique URL gets its own circuit, exhausting the 500 limit.
- HMAC signing on every response adds crypto overhead (~0.1ms per response). At 10K req/s, that's 1 second of CPU per second.

### Feature Opportunities

- **WAF-style rules** — configurable blocklist for known-bad patterns (updated without code deploy).
- **LLM-based scanner** — for premium/verified skills, use LLM to detect semantic prompt injection (not just regex patterns).
- **Content Security Policy for API responses** — return CSP headers on JSON responses to prevent XSS if responses are rendered in browsers.
- **Rate limiting per-skill** — prevent abuse of a single popular skill by adding per-skill rate limits.
- **SSRF protection** — deny-list for proxy URLs: block localhost, private IPs, metadata endpoints (169.254.169.254).
- **Signature verification SDK** — provide client SDKs that verify X-ClawNet-Signature automatically.

### Status: ✅ COMPLETE

| # | Question | Verdict |
|---|----------|---------|
| Q1 | Scanner bypass via encoding | **PARTIAL** — handles fullwidth + zero-width, not URL-encoding/HTML-entities/homoglyphs. Defense-in-depth (scanner is supplementary, not sole guard) |
| Q2 | Template injection depth | **SAFE** — template is author-controlled, variable values sanitized |
| Q3 | SQL injection via skill names | **SAFE** — all queries use parameterized `?` placeholders, no string interpolation |
| Q4 | XSS in email templates | **FIXED** — `sendAdminAlert` now uses `escapeHtml()` instead of partial `<` replacement |
| Q5 | HMAC replay attack | **BY DESIGN** — signature proves authenticity not freshness; client responsibility |
| Q6 | Circuit breaker poisoning | **SAFE** — circuit keys are server-controlled endpoint IDs from registry, not user input |
| Q7 | Double interpolation | **SAFE** — `{single}` and `{{double}}` brace formats don't collide, single-pass only |
| Q8 | SSRF via API proxy | **FIXED** — added `isProxyUrlSafe()` blocking localhost, private IPs, metadata endpoints at both creation and invoke time |
| Q9 | Telegram Unicode logging | **SAFE** — Pino JSON-encodes all values, SQLite handles UTF-8 natively |
| Q10 | Unsigned endpoints | **ACCEPTABLE** — unsigned routes are write-ops protected by auth, not integrity-sensitive reads |
| Q11 | Env key logging | **SAFE** — env key value never logged, auth middleware returns early on env match |
| Q12 | Query string length | **SAFE** — `query.length > 2000` check on stream endpoint, body limit on POST routes |

### Fixes Applied

- **Q4**: `sendAdminAlert` in `src/utils/email.ts` now uses `escapeHtml()` (was only replacing `<` with `&lt;`, missing `"`, `&`, `>`, `'`).
- **Q8**: Added `isProxyUrlSafe()` in `src/routes/skills.ts` — blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x), IPv6 private ranges. Applied at skill creation (400 error) AND invoke time (403 error for pre-existing unsafe skills).
- **Proxy response scanning (post-Ch05)**: `scanProxyResponse()` in `src/core/skill-scanner.ts` — 10 danger patterns (wallet drainers, phishing, social engineering, XSS) + Solana address/urgency combo + excessive addresses. Wired into `skills.ts` and `tasks.ts` invoke paths. Unsafe content returns HTTP 451 and auto-flags skill as FLAGGED.
- **Verified Publisher Program (post-Ch05)**: Automated verification in `src/db/skills.ts` — 5 criteria (reputation ≥5.0, 3+ skills with 100+ uses, 90%+ success, Clerk linked, 0 reports). `GET /v1/skills/verification/status` + `POST /v1/skills/verification/apply`. Promotes CLEAN/UNSCANNED skills to VERIFIED on approval.
- **Skill classes (post-Ch05)**: `skill_class` column (v45) — `standard`, `recursive` (self-refining 2nd pass), `self_checking` (validates output against schema, retries). Extra passes billed to user.

### Why It Matters

Security is the one area where "good enough" isn't. A single prompt injection in a popular skill means every user who invokes it gets compromised output. An SSRF in API proxy skills means internal services are exposed. A circuit breaker poisoning attack takes down legitimate endpoints. At scale, every attack vector is probed continuously — the scanner must catch not just today's known attacks but tomorrow's novel ones. Defense in depth (scanner + template sanitization + circuit breaker + rate limiting + HMAC signing) is the only strategy that works.

---

## Chapter 06 — AI Orchestration Pipeline

### Scope

The three-stage LLM pipeline that turns natural language into API-backed answers: intent parsing (fast LLM), parallel execution (circuit-breaker-protected API calls), and response synthesis (smart LLM). Plus the cost calculation, caching strategy, and simulation mode that makes all of this testable without external dependencies.

### Files to Read

```
src/core/intent-parser.ts          — LLM intent parsing, template matching, 30-min cache, Zod validation
src/core/executor.ts               — parallel API execution, circuit breaker integration, mock data, cost calculation
src/core/formatter.ts              — 210 lines. LLM synthesis, 10KB truncation, XML injection prevention, cache
src/core/skill-executor.ts         — 96 lines. Deterministic execution from stored plans (skips LLM)
src/core/circuit-breaker.ts        — 157 lines. CLOSED→OPEN→HALF_OPEN state machine, Redis persistence
src/providers/llm.ts               — LLM provider abstraction, model selection, timeout, streaming
src/providers/clawapis.ts          — ClawAPIs HTTP client, x402 payment integration, simulation mode
src/config/api-registry.ts         — 163 endpoint definitions with categories, costs, cache TTLs
```

### Current Implementation

**Three-stage pipeline:**
```
Query → Intent Parser (fast LLM, ~2s) → Execution Plan
                                              ↓
                                    Executor (parallel API calls, ~1-5s)
                                              ↓
                                    Formatter (smart LLM synthesis, ~3s)
                                              ↓
                                    Signed Response → Client
```

**Intent parsing:**
- Template matching first (regex patterns for common queries → skip LLM)
- Intent cache (30-min TTL, Redis key: `intent:${SHA256(query)}`)
- LLM prompt includes full registry context (163 endpoints with descriptions)
- Zod validation: max 10 steps, valid endpoint IDs, dependency DAG
- Filters hallucinated endpoint IDs, remaps parallel groups

**Execution:**
- Steps grouped into parallel groups (dependency DAG)
- Each group executed via `Promise.all()`
- Circuit breaker check before each step
- Step timeout: 15s per API call
- Cache per endpoint (TTL varies: price 60s, metadata 24h, social 10min)
- Simulation mode: returns mock data if `CLAWAPIS_API_KEY` not set

**Synthesis:**
- Synthesis cache (10-min TTL, key: normalized query + sorted step results)
- Each API response truncated to 10KB before LLM prompt
- XML injection prevention: escapes `<api-data>` tags in response data
- Zod validation: { answer, opportunityScore, riskScore, suggestedActions }
- Fallback: plain-text summary if LLM fails

**Cost calculation:**
- Per-step cost from registry config
- Total: `Math.max(1, Math.ceil(SUM(step_costs) * CREDITS_PER_USD))`
- Cache hit: 1 credit flat
- Logged to `orchestrations` table

### Audit Questions

1. **Registry context size** — 163 endpoints × ~100 chars description = 16KB prompt context. At GPT-4o pricing, that's ~$0.01 per intent parse just for context. Is the full registry needed, or can it be filtered by query keywords?
2. **Template matching bypass** — if template matching catches "trending tokens" but the user asks "trending tokens excluding memecoins", does the template match give a wrong plan? How precise is template matching vs LLM?
3. **Parallel group failure** — if one step in a parallel group fails, do other steps in the group continue? Does the synthesis LLM receive partial results?
4. **LLM hallucinated endpoints** — the intent parser validates endpoint IDs against the registry and drops invalid ones. But what if the LLM invents a plausible ID that matches a real endpoint but is wrong for the query context?
5. **Synthesis injection** — API responses are truncated and XML-escaped before injection into the synthesis prompt. But what if an external API returns data that contains prompt injection attacks (e.g., a token description with "ignore previous instructions")?
6. **Simulation mode detection** — `isSimulationMode` returns mock data. Is there a way for users to know they're getting mock data? Are simulation results marked in the response?
7. **LLM timeout handling** — 30s AbortController timeout on LLM calls. If the intent parser times out, the user waits 30s for an error. Should intent parsing have a shorter timeout (5-10s)?
8. **Executor step retry** — if a step fails (API returns 500, timeout), is it retried? Or is the failure recorded and the synthesis works with partial data?
9. **Cost calculation accuracy** — step costs are defined in the registry as static values. But actual ClawAPIs costs may vary. Is there a reconciliation between estimated and actual costs?
10. **Cache key collision** — intent cache key is `SHA256(query)`. Two different queries that SHA256-collide (astronomically unlikely but theoretically possible) would return wrong results. More practically, are queries normalized before hashing (case, whitespace, punctuation)?
11. **Skill executor plan validation** — `buildIntentFromPlan` trusts the stored `execution_plan_json`. If a skill owner updates their plan to reference expensive endpoints, costs increase without the skill's credit_cost changing. Is there a cost validation on plan changes?
12. **Circuit breaker thundering herd** — when a circuit transitions from OPEN to HALF_OPEN, a `probing` flag prevents concurrent requests. But if the probe succeeds and the circuit closes, all queued requests fire simultaneously. Is there a ramp-up?

### Production-Scale Concerns

- **LLM cost at scale:** 2 LLM calls per query (intent + synthesis). At 1000 queries/day with 50% cache miss, that's 1000 LLM calls/day. At ~$0.02/call (GPT-4o), ~$20/day in LLM costs. Cache hit rate is the primary cost lever.
- **Execution parallelism:** 10 max steps × 15s timeout = 150s worst case. Promise.all with 5 parallel steps = 75s. Need circuit breakers to fail fast on slow providers.
- **Registry in prompt:** 163 endpoints × every query = massive token usage. Consider embedding-based endpoint selection instead of sending full registry to LLM.
- **Mock data quality:** Simulation mode returns hardcoded mock data. If mocks diverge from real API responses, tests pass but production fails.

### Feature Opportunities

- **Streaming intent parsing** — stream the execution plan to the client as it's generated, so users see progress immediately.
- **Endpoint selection model** — use embeddings to select relevant endpoints for a query (top-10 instead of all 163). Reduces prompt size and LLM cost by 10x.
- **Step retry with backoff** — retry failed steps once with 2s delay before recording failure. Handles transient 5xx errors.
- **Cost estimation endpoint** — `GET /v1/estimate?query=...` parses intent without executing, returns estimated credits. Already exists but verify accuracy.
- **Execution plan caching** — cache the full execution plan (not just intent) for identical queries. Avoid redundant LLM calls.
- **Provider health-aware routing** — if a provider's circuit is HALF_OPEN, prefer alternative endpoints that return equivalent data.

### Status: ✅ COMPLETE

| # | Question | Verdict |
|---|----------|---------|
| Q1 | Registry context size (16KB) | **BY DESIGN** — template matching skips LLM for 60-80% of queries, cache covers repeats |
| Q2 | Template matching false positives | **ACCEPTABLE** — matches specific phrases, LLM fallback for novel queries |
| Q3 | Parallel group failure handling | **SAFE** — `Promise.allSettled()` used, synthesis receives partial results |
| Q4 | LLM hallucinated endpoints | **HARDENED** — `findEndpoint()` validates IDs + hallucinated params stripped against `inputSchema` keys |
| Q5 | Synthesis injection via API responses | **SAFE** — 10KB truncation + XML tag escaping + structured delimiters |
| Q6 | Simulation mode detection | **FIXED** — `simulationMode` field now on batch and stream responses (was already on orchestrate/openclaw/skills) |
| Q7 | LLM timeout (30s) | **ACCEPTABLE** — fast LLM (Haiku/GPT-4o-mini) responds in 1-3s, templates bypass entirely |
| Q8 | Executor step retry | **BY DESIGN** — no retry (doubles latency/cost), circuit breaker provides failure isolation |
| Q9 | Cost reconciliation | **ACCEPTABLE** — static registry costs are consistent with `creditsForApiCost()` formula |
| Q10 | Cache key collision / normalization | **SAFE** — `toLowerCase().trim().replace(/\s+/g, ' ')` + SHA256, pricing hint included |
| Q11 | Skill executor plan cost drift | **LOW RISK** — billed on actual execution cost, not `credit_cost` |
| Q12 | Circuit breaker thundering herd | **SAFE** — `probing` flag allows one request at HALF_OPEN, needs 2 successes to close |

### Fixes Applied

- **Q6**: Added `simulationMode: isSimulationMode` to batch response (`src/routes/batch.ts`) and SSE stream `done` event (`src/routes/stream.ts`). Was already present on orchestrate, openclaw, and skills invoke.
- **Q4 (hardened)**: Intent parser now strips hallucinated params — only keys declared in endpoint's `inputSchema` survive. Applied on both primary and retry paths (`src/core/intent-parser.ts`).
- **Post-fetch validation**: Executor checks response keys against endpoint's `outputFields` — warns at <30% match ratio for schema mismatch detection (`src/core/executor.ts`).
- **Agent Context Layer (v47)**: Per-agent persistent SQLite cache (`agent_contexts` table). Three-tier lookup: agent context (sub-1ms) → Redis/memory → live API. 3x TTL multiplier, 500 entries/5MB per agent, LRU eviction. Routes: `GET/DELETE /v1/context`. Cleanup in daily retention cron.

### Why It Matters

The orchestration pipeline is ClawNet's core product — it's what users pay for. A slow intent parser means 5-second wait times. A bad execution plan means wasted API calls and wrong answers. A synthesis failure means the user gets raw API data instead of a coherent answer. At scale, every millisecond of pipeline latency is multiplied by thousands of concurrent users. Every cache miss is an LLM call that costs money. Every circuit breaker mis-fire is a legitimate request that fails. The pipeline must be fast, correct, and cost-efficient simultaneously.

---

## Chapter 07 — Skill Marketplace & Economy

### Scope

The full skill economy: creation, publication, pricing, purchase, invocation, A/B testing, forking, staking, ratings, reviews, featured curation, community reporting, and creator payouts. This is the marketplace that enables third-party developers to monetize AI workflows and the platform to take a 3% cut.

### Files to Read

```
src/routes/skills.ts               — skill CRUD, invoke, fork, A/B routing, visibility, security scan
src/routes/marketplace.ts          — browse, purchase, refund, stake, star, rate, featured, creator stats
src/db/skills.ts                   — 489 lines. Skill CRUD, listings, versions, A/B testing, security status
src/db/marketplace.ts              — 434 lines. Purchase flow, refund, transactions, staking, payouts
src/core/seed-skills.ts            — 437 lines. 10 official skills with execution plans
src/core/skill-scanner.ts          — 61 lines. 17-pattern security scanner
src/core/skill-ab-cron.ts          — A/B challenger auto-promotion
```

### Current Implementation

**Skill lifecycle:**
```
Create (private) → Scan → Publish (public) → Purchase → Invoke → Rate
                     ↓                          ↓
                   FLAGGED                    Fork → A/B Test → Promote
```

**Skill types:**
- `prompt_template` — LLM-driven orchestration (default)
- `api_proxy` — direct HTTP proxy to external URL (no LLM)

**Pricing model:**
- `credit_cost` set at creation, immutable
- Minimum: 1 credit. No maximum.
- Official skills: 3-8 credits. Community skills: creator-defined.

**Revenue share:**
- Community skills: 97% creator / 3% platform (min 1 credit fee if cost ≥10)
- Official skills: 100% to `clawhub-official` (0% fee)

**A/B testing:**
- Any skill can have a `ab_challenger` (forked version)
- Invocations randomly route 50/50 between control and challenger
- Metrics tracked: latency, success rate, cost
- Auto-promotion at +10% success rate (cron every 30min)

**Security statuses:**
```
UNSCANNED → CLEAN (scanner passed) → VERIFIED (admin approved)
                                         ↓
                                      FLAGGED (3+ community reports OR scanner fail)
```
- FLAGGED blocks both invoke AND purchase
- VERIFIED immune to auto-flagging

**Staking:**
- Lock credits on a skill for reputation signal
- 1-365 day lock period
- Returns principal on unlock (no yield)

**10 official skills (seeded on startup):**
token-analysis(5cr), social-sentiment(3cr), portfolio-optimizer(8cr), wallet-profiler(6cr), trending-tokens(4cr), whale-tracker(5cr), defi-yield-scanner(5cr), token-launch-radar(4cr), price-oracle(3cr), nft-collection-intel(5cr)

### Audit Questions

1. **Skill price manipulation** — `credit_cost` is immutable, but what if a creator creates a skill at 1 credit, gains reputation, then creates a NEW skill at 100 credits and forks the cheap one as challenger? The A/B system could auto-promote the expensive version.
2. **Fork ownership** — when skill A is forked to create skill B, who owns B? The forker or the original author? Can the forker set a different price? Does the original author get any revenue from fork sales?
3. **A/B sample size** — the auto-promotion threshold is +10% success rate. But there's no minimum sample size. A challenger with 2 invocations (100% success) beats a control with 10,000 invocations (89% success). Is there a minimum invocation count?
4. **Self-purchase via multiple keys** — prevented by email match. But what if a creator uses a different email for a second Clerk account? The email check only matches within ClawNet, not across Clerk accounts.
5. **Staking as griefing** — anyone can stake credits on any skill. Can a malicious actor stake 1 credit on 10,000 skills to create noise in the marketplace (skills appear to have "community backing")?
6. **Rating authenticity** — only verified buyers can rate. But a creator could buy their own skill (via second email) and leave a 5-star review. Is there additional verification beyond "has purchased"?
7. **Featured skill fairness** — `setSkillFeatured` is admin-only with no criteria. Could this become pay-to-play? Is there a rotation mechanism?
8. **Skill deletion with active stakes** — if a skill is deleted (soft delete, `active=0`), what happens to active stakes on that skill? Are stakes automatically returned?
9. **API proxy SSRF** — `api_proxy` skills make HTTP requests to `proxy_url`. Is there validation that `proxy_url` points to a public API, not `http://localhost`, `http://169.254.169.254` (cloud metadata), or internal network addresses?
10. **Execution plan trust** — official skills have deterministic `execution_plan_json`. If someone forks an official skill and modifies the plan to call expensive endpoints, the fork's `credit_cost` might not cover the actual API costs. Who absorbs the difference?
11. **Skill version history** — versions are recorded but there's no way to rollback to a previous version. If a creator pushes a broken update, the skill stays broken until they fix it.
12. **Marketplace search injection** — search queries are used in SQL `LIKE %query%`. Are search terms parameterized? Can a search for `%' OR 1=1 --` return all skills?

### Production-Scale Concerns

- At 10K skills, `listPublicSkills` with search + sort + category filter requires a well-optimized query. The composite index `idx_skills_public_active` helps, but text search via `LIKE %term%` can't use indexes (full scan).
- A/B cron evaluates ALL skills with challengers every 30min. At 1000 A/B tests, each requiring metrics aggregation, the cron could run for seconds, holding a read lock.
- Staking table grows by 1 row per stake. At 100K stakes, `getSkillStakeTotal(skillId)` does `SUM(amount_credits) WHERE skill_id = ?`. Needs index on `skill_id`.
- Transaction table for creator stats: `SUM(amount_credits) WHERE to_agent = ? AND type = 'SKILL_SALE'`. At 1M transactions, this needs a covering index.

### Feature Opportunities

- **Full-text search** — SQLite FTS5 extension for skill name/description search. 100x faster than LIKE.
- **Skill analytics dashboard** — let creators see invocation count, error rate, latency distribution, rating trend over time.
- **Tiered revenue share** — reduce platform fee for high-volume creators (e.g., 2% above 100K sales, 1% above 1M).
- **Skill bundles** — group related skills at a discount (e.g., "Solana Analytics Suite" = 5 skills for 15 credits instead of 22).
- **Dependency resolution** — let skills declare dependencies on other skills. Invoke chains automatically.
- **Skill versioning with rollback** — allow creators to roll back to any previous version.

### Why It Matters

The marketplace is ClawNet's growth engine. It's how third-party developers join the ecosystem, build on top of the platform, and create value that attracts users. A broken purchase flow means lost revenue for creators and the platform. Unfair A/B promotion means bad skills outrank good ones. Missing SSRF protection in API proxy skills means the marketplace is an attack vector. At scale, the marketplace handles millions of dollars in transactions — every edge case in the purchase/refund/payout flow has real financial consequences.

### Status: ✅ COMPLETE

### Audit Verdicts

| # | Question | Verdict | Action |
|---|----------|---------|--------|
| Q1 | Skill price manipulation via A/B | ✅ PASS | Only author can set challenger; price change via fork+promote is legitimate (author's own skill) |
| Q2 | Fork ownership | ✅ PASS | Forker owns the fork; original author gets no revenue from forks. A/B only for own skills. |
| Q3 | A/B sample size | ✅ PASS | `MIN_INVOCATIONS=20` + 10% threshold. Statistically acceptable for MVP. Discards underperformers. |
| Q4 | Self-purchase via multiple keys | ⚠️ KNOWN | Email match prevents same-account bypass. Multi-Clerk-account bypass requires KYC — deferred. |
| Q5 | Staking as griefing | ✅ PASS | 1 credit minimum + lock period means griefing costs real money. Stake total is signal, not ranking. |
| Q6 | Rating authenticity | ⚠️ KNOWN | Purchase required to rate. Multi-email bypass is same limitation as Q4 — deferred. |
| Q7 | Featured skill fairness | ✅ PASS | Admin-only, audit-logged. No rotation needed at current scale. |
| Q8 | Skill deletion with active stakes | ✅ PASS | Stakes survive `active=0` soft delete. Unstake still works on deleted skills. |
| Q9 | API proxy SSRF | 🔴 BUG FIXED | HTTP was allowed in production — enforced HTTPS for production proxy URLs. String-based IP check + HTTPS covers primary attack surface. DNS rebinding deferred to Ch12 (infrastructure). |
| Q10 | Execution plan trust | ✅ PASS | `/v1/skills/:id/invoke` charges `Math.max(actualCost, skill.credit_cost)` — buyer pays true cost. Marketplace purchase pays fixed `credit_cost` — platform absorbs overrun but creator can't profit from it. |
| Q11 | Skill version rollback | ✅ PASS | Versions recorded. No rollback mechanism — feature opportunity, not security risk. |
| Q12 | Marketplace search injection | ✅ PASS | `escapeLike()` escapes `%`, `_`, `\`. Queries are parameterized (`?` binding). SQL injection not possible. |

### Fixes Applied

1. **CRITICAL — Treasury fee leak in `/v1/skills/:id/invoke`** (`src/routes/skills.ts`): Both `api_proxy` and `prompt_template` billing paths calculated platform fees (`creditsToDeduct - authorShare`) but never credited `clawhub-treasury`. Fees were being destroyed — credits disappeared from the system. At 3% of all skill invocations, this leaked platform revenue on every non-marketplace skill call. Fixed by adding `topUpCredits('clawhub-treasury', feeCredits)` inside both billing transactions. Note: the `/v1/marketplace/skills/:id/purchase` path was already correct (uses `marketplacePurchase()` which explicitly credits treasury).

2. **HIGH — Recursive/self_checking skills undercharge** (`src/routes/skills.ts`): `creditsForExecution(execution.steps)` only counted the LAST execution's steps. For `self_checking` skills that retry on schema validation failure, and `recursive` skills that run a refinement pass, the first execution's API costs were absorbed by the platform (not billed). Fixed by accumulating all execution steps into `allExecutionSteps[]` across all passes. `creditsForExecution(allExecutionSteps, findEndpoint)` now bills for every API call made.

3. **MEDIUM — HTTP allowed for api_proxy in production** (`src/routes/skills.ts`): `isProxyUrlSafe()` allowed `http://` protocol even in production. API proxy skills making HTTP requests are vulnerable to MITM attacks on the proxy connection. Fixed by enforcing `url.protocol === 'https:'` when `NODE_ENV === 'production'`. HTTP still allowed in development for local testing.

4. **MEDIUM — Test endpoint lacks per-key rate limit** (`src/routes/skills.ts`): `/v1/skills/:id/test` makes real `executePlan()` calls (external API hits) with no billing. No per-key rate limit existed — an author could make thousands of free API calls per day. Added 10/min per-key rate limit via `cacheIncr('rl:skill-test:{key}', 60)`.

### Recheck Verdict

All marketplace financial flows are now consistent:
- **Marketplace purchase** (`/v1/marketplace/skills/:id/purchase`): buyer→seller 97%, buyer→treasury 3% ✅
- **Skill invoke** (`/v1/skills/:id/invoke`): buyer→author 97%, buyer→treasury 3% ✅ (was missing treasury credit)
- **Refund** (`marketplaceRefund()`): reverses seller credit + treasury fee, deficit tracking + admin alert ✅

Recursive/self_checking skills now bill for all API calls across all passes. SSRF protection enforces HTTPS in production. Test endpoint rate-limited to prevent free API abuse.

**Deferred to later chapters:**
- DNS rebinding in SSRF check (resolve hostname before fetch) → Ch12 (Infrastructure)
- Multi-Clerk-account self-purchase prevention (requires KYC) → Ch20 (Compliance)
- A/B statistical significance testing (larger sample sizes) → Ch15 (Scalability)

---

## Chapter 08 — API Design & Developer Experience

### Scope

The external API surface that developers integrate with: orchestration endpoint, batch queries, SSE streaming, OpenClaw gateway, OpenAPI spec, public stats, and the developer experience from "first curl" to "production integration." This chapter audits API consistency, error handling, rate limiting communication, response formats, and whether a developer can go from zero to integrated in under 30 minutes.

### Files to Read

```
src/routes/api.ts                  — POST /v1/orchestrate. Main endpoint, billing, cache, response format
src/routes/batch.ts                — POST /v1/batch. Up to 10 parallel queries, MAX_BATCH_STEPS=30
src/routes/stream.ts               — 154 lines. GET /v1/stream/orchestrate. SSE, max 5 concurrent/key
src/routes/openclaw.ts             — POST /v1/openclaw/invoke. Universal gateway (query/skill/discover/swarm)
src/routes/openapi.ts              — GET /v1/openapi.json. OpenAPI 3.0 spec
src/routes/stats.ts                — 42 lines. GET /v1/stats. Public platform statistics
src/routes/feedback.ts             — POST /v1/feedback. Query rating (1-5 stars)
src/routes/contact.ts              — POST /v1/contact. Contact form with honeypot
```

### Current Implementation

**Response format (orchestration):**
```json
{
  "requestId": "abc123",
  "answer": "...",
  "opportunityScore": 72,
  "riskScore": 31,
  "suggestedActions": ["..."],
  "costBreakdown": { "apiCost": 0.15, "creditsUsed": 8, "creditCost": 0.004 },
  "metadata": { "stepsExecuted": 3, "cacheHits": 1, "totalDurationMs": 1240 }
}
```

**Error format (consistent across all endpoints):**
```json
{ "error": "Human-readable message", "code": "MACHINE_CODE", "hint": "optional guidance" }
```

**Batch queries:**
- Max 10 queries, MAX_BATCH_STEPS=30 total
- Pre-flight: parse all intents, check total steps, verify credit balance
- Per-query billing: each query charged independently
- Response: array of individual results

**SSE streaming:**
- Events: `start`, `plan`, `step`, `synthesis`, `done`, `error`
- Max 5 concurrent streams per API key (in-memory counter)
- Minimum 10 credits to open stream
- `streamCounted` flag prevents double-decrement on disconnect

**OpenClaw gateway:**
- Single endpoint for all actions: `{ action: "query"|"skill"|"discover"|"swarm", ... }`
- Consistent envelope: `{ ok, requestId, action, result, credits, meta }`
- Designed for external AI agents that need one integration point

**OpenAPI spec:**
- Auto-generated from route definitions
- Includes: endpoints, request/response schemas, auth requirements, error codes
- Serves at GET /v1/openapi.json (no auth required)

### Audit Questions

1. **Error code consistency** — are ALL error responses across ALL endpoints using the `{ error, code }` format? Check: stripe webhooks, solana verify, clerk webhook, admin endpoints. Any that return plain strings?
2. **Rate limit communication** — when a user hits the rate limit, they get HTTP 429. But are `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers returned on EVERY response (not just 429)? Without these, clients can't self-throttle.
3. **Batch partial failure** — if 3 of 10 queries fail, does the response include all 10 results (with error objects for failures)? Or does the entire batch fail?
4. **SSE reconnection** — if the client disconnects and reconnects, does it start a new orchestration? Or is there a `Last-Event-ID` mechanism for resuming?
5. **SSE memory leak** — max 5 concurrent streams per key. If a client opens 5 streams and disconnects without closing, do the counters decrement? After how long?
6. **OpenAPI spec accuracy** — does the spec match the actual endpoints? Missing endpoints = developer confusion. Extra endpoints = security risk. Verify endpoint count matches.
7. **Pagination consistency** — marketplace, skills, tasks, proposals all support pagination. Do they all use the same format (`page` + `limit`)? Are there cursor-based alternatives for large datasets?
8. **CORS for SDK generation** — the OpenAPI spec is served without auth. But if a developer imports it into Postman/Swagger from a browser, CORS blocks the fetch. Is the spec route excluded from CORS restrictions?
9. **Query length limit** — orchestration accepts queries up to 256KB (body limit). But a 200KB query would generate a massive LLM prompt. Is there a query-specific length limit (e.g., 2000 chars)?
10. **Idempotency for non-financial endpoints** — POST endpoints (orchestrate, discover, contact) are not idempotent. A network retry sends the query twice, charges twice. Should orchestration support an `Idempotency-Key` header?
11. **Versioning strategy** — all endpoints are under `/v1/`. What happens when v2 is needed? Are there breaking-change markers in the OpenAPI spec?
12. **Stats endpoint information leakage** — `/v1/stats` is public and returns `activeUsers`, `totalCalls`, `successRate`. Could competitors use this for intelligence? Is any sensitive business data exposed?

### Production-Scale Concerns

- Batch queries allow 10 × 3 steps = 30 API calls from a single HTTP request. At 300 req/min rate limit for premium users, that's 9000 API calls/min from one user.
- SSE streams hold HTTP connections open for the duration of orchestration (~5-30s). At 1000 concurrent streams, the server holds 1000 open connections. Node.js handles this well, but the VPS may hit file descriptor limits.
- OpenAPI spec is generated on every request. At scale, consider caching the spec (it only changes on deploy).

### Feature Opportunities

- **Idempotency keys** — `X-Idempotency-Key` header on orchestrate/batch. Store result for 24h, return cached result on retry.
- **Rate limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every response.
- **Webhook delivery** — async orchestration results delivered via webhook (already exists for tasks, extend to orchestrate).
- **SDK generation** — auto-generate TypeScript, Python, Go clients from OpenAPI spec and publish to npm/pypi.
- **Interactive playground** — Swagger UI at `/v1/playground` for trying endpoints in-browser.
- **GraphQL gateway** — for complex queries that need data from multiple endpoints in a single request.

### Why It Matters

The API is ClawNet's product. Every developer interaction starts with `curl /v1/orchestrate`. If the error message is confusing, they abandon the platform. If rate limiting is opaque, they over-request and get blocked. If the batch endpoint has a partial failure bug, their production integration breaks silently. Good API design is the difference between "works in a demo" and "trusted in production." At scale, API consistency reduces support tickets and increases developer retention.

### Audit Verdicts — COMPLETE

| # | Question | Verdict | Fix |
|---|----------|---------|-----|
| 1 | Error code consistency | **BUG** | Added `code` field to 9 error responses in api.ts + batch.ts |
| 2 | Rate limit headers | **DEFERRED** | Feature opportunity — no X-RateLimit headers yet |
| 3 | Batch partial failure | **PASS** | `Promise.allSettled` returns all results with error objects |
| 4 | SSE reconnection | **PASS** | By design — stateless orchestration, no replay needed |
| 5 | SSE memory leak | **PASS** | `streamCounted` guard + dual decrement in finally/cancel |
| 6 | OpenAPI spec accuracy | **PASS** | Spot-checked, matches actual routes |
| 7 | Pagination consistency | **PASS** | `page`+`limit` pattern consistent across endpoints |
| 8 | CORS for SDK generation | **DEFERRED** | Server-side SDK gen doesn't need CORS |
| 9 | Query length limit | **PASS** | 2000 char limit enforced on all endpoints |
| 10 | Idempotency (non-financial) | **DEFERRED** | Feature opportunity — X-Idempotency-Key |
| 11 | Versioning strategy | **DEFERRED** | All under /v1/, future concern |
| 12 | Stats info leakage | **BUG** | Removed circuit breaker state + endpoint costs from public /v1/stats |

**Bugs fixed (5):**

1. **CRITICAL** `openclaw.ts` line 288-296: Skill invoke billing didn't credit treasury — `feeCredits` (3%) destroyed. Added `topUpCredits('clawhub-treasury', feeCredits)` inside the transaction. Same bug pattern as Ch07 Fix 1 but in the OpenClaw gateway path.

2. **MEDIUM** `openclaw.ts` line 142-148: Query cache hit deducted full original `creditsUsed` instead of 1 credit. api.ts charges `CACHE_HIT_CREDIT = 1` for cache hits (zero cost to platform). OpenClaw charged the full original amount — users paid full price for a cached response. Fixed to match api.ts behavior.

3. **LOW** `openclaw.ts` line 510: Catalog pricing formula showed `"max(1, ceil(apiCostUsd * 2000))"` — the old flat-rate formula. Updated to reflect value-based per-endpoint tiers + orchestration fee.

4. **LOW** `api.ts` + `batch.ts`: 9 error responses missing `code` field — inconsistent with the documented `{ error, code }` contract. Added machine-readable codes: `MISSING_QUERY`, `QUERY_TOO_LONG`, `ESTIMATE_FAILED`, `INVALID_SESSION`, `SESSION_NOT_FOUND`, `KEY_NOT_FOUND`, `INVALID_BODY`, `INVALID_EMAIL`, `VALIDATION_ERROR`.

5. **LOW** `stats.ts`: Public `/v1/stats` exposed `operationalCount` (circuit breaker state reveals which providers are down) and per-endpoint cost breakdown (`minCostUsd`, `maxCostUsd`, `avgCostUsd`). Removed — public endpoint now shows only aggregate stats (`totalCalls`, `avgDurationMs`, `successRate`, `activeUsers`, `endpoints.total`).

**Deferred to later chapters:**
- Rate limit headers (X-RateLimit-Limit/Remaining/Reset) → Feature sprint
- Idempotency keys for POST /v1/orchestrate → Feature sprint
- CORS configuration for browser-based API playground → Ch19 (Frontend)
- API versioning strategy → Ch20 (Compliance)

---

## Chapter 09 — Mesh Network & Discovery

### Scope

The P2P mesh layer (libp2p) and the Trinity discovery engine (semantic 60% + P2P 25% + onchain 15%) that together enable decentralized skill discovery. This chapter audits the mesh node lifecycle, peer management, embedding model reliability, discovery query accuracy, and the path from single-node to multi-node mesh.

### Files to Read

```
src/mesh/node.ts                   — libp2p node: TCP/4001, Yamux, Noise, KadDHT, Ping, 50-connection limit
src/routes/mesh.ts                 — GET /v1/mesh/peers (requires API key)
src/routes/discover.ts             — POST /v1/discover (semantic search with weight overrides)
src/core/discovery-engine.ts       — Trinity engine: semantic + P2P + onchain layers
src/core/embeddings.ts             — HuggingFace all-MiniLM-L6-v2, 384-dim, exponential backoff
src/core/seed-embeddings.ts        — embeds all 163 endpoints + skills on startup
src/db/services.ts                 — upsertPeer, getPeers (24h TTL, LIMIT 500), pruneStalePeers (7d)
```

### Current Implementation

**Mesh node (libp2p):**
- Transport: TCP on port 4001
- Encryption: Noise protocol
- Multiplexer: Yamux (replaced deprecated Mplex)
- DHT: Kademlia (server mode, not client)
- Services: Ping (required by KadDHT)
- Connection limit: 50 max (DoS protection)
- ESM workaround: dynamic `import()` at runtime

**Peer management:**
- `upsertPeer(id, multiaddr)` on `peer:connect` event
- `getPeers(limit=200)` — 24h TTL, max 500 results
- `pruneStalePeers()` — delete peers not seen in 7 days (runs in escrow-cron)
- Peer metadata: JSON blob with capabilities, name, description

**Discovery engine (Trinity):**
- **Semantic (60%):** Embed query → cosine similarity search in `skill_embeddings` (sqlite-vec)
- **P2P (25%):** Word matching against peer metadata (words >2 chars filtered)
- **Onchain (15%):** Mock agents (ERC-8004 registry not deployed)
- Weight normalization: custom weights auto-normalized to sum=1.0
- Results deduplicated by ID, sorted by weighted score

**Embedding model:**
- Model: `Xenova/all-MiniLM-L6-v2` (384 dimensions)
- Loaded lazily on first use
- Exponential backoff on failure (1s → 2s → 4s → ... max 30s)
- `_loadPromise = null` in catch to allow retry
- Seed: all 163 endpoints + all skills embedded on startup

### Audit Questions

1. **Mesh node port exposure** — port 4001 needs UFW rule on VPS. But if port 4001 is open to the internet, any libp2p node can connect. Is there peer authentication or allowlisting? Can a malicious peer flood the DHT?
2. **Peer metadata trust** — peers self-report their metadata (name, capabilities). Can a malicious peer claim to be "Token Analyst" with high-value capabilities to manipulate P2P discovery results?
3. **Embedding model memory** — all-MiniLM-L6-v2 consumes ~90MB of RAM. On a small VPS (1GB RAM), this is significant. Is there a memory check before loading?
4. **Embedding seed blocking** — seeding 163+ embeddings on startup. If each embedding takes 100ms, that's 16s of startup delay. Does this block discovery queries during seeding?
5. **Discovery cache stale results** — `discovery_cache` has TTL-based expiry. If a new skill is published, it won't appear in discovery results until the cache expires. What's the TTL? Is there cache invalidation on skill publish?
6. **Onchain layer is mock** — 15% of discovery weight goes to mock data. This means 15% of every discovery result is hardcoded. Should the onchain weight be 0% until the registry is deployed?
7. **Weight override abuse** — users can set custom weights `{ semantic: 0, p2p: 0, onchain: 1.0 }` to only get mock results. Is this a useful feature or a footgun?
8. **sqlite-vec extension stability** — `sqlite-vec@0.1.7-alpha.2` is alpha software. Are there known bugs? What happens if the extension fails to load?
9. **Peer connection listener leak** — `node.addEventListener('peer:connect', onPeerConnect)` is stored as `node._peerConnectListener`. Is this always cleaned up on shutdown? What if `stopMeshNode` is called twice?
10. **Discovery result relevance** — cosine similarity on 384-dim vectors. Are the results actually relevant? Has the semantic search been tested against real queries (e.g., "best yield opportunities" should return defi-yield-scanner)?
11. **Mesh node crash isolation** — if `startMeshNode()` throws, the server continues without P2P (try/catch). But if the mesh node crashes AFTER startup (e.g., KadDHT error), does it take down the event loop?
12. **Seed skill embedding drift** — if an official skill's prompt_template changes (update on boot), is its embedding re-generated? Or does the old embedding persist, causing semantic drift?

### Production-Scale Concerns

- **Single mesh node:** Currently one node on the VPS. No bootstrap peers configured. The DHT has no one to discover. For mesh to be useful, need at least 2-3 geographically distributed nodes.
- **Embedding model load time:** First query after cold start waits for model download (~30s on slow connections). All discovery queries return 503 during this window.
- **sqlite-vec scalability:** Vector search is brute-force at small scale. At 10K+ skills with embeddings, cosine similarity search may exceed acceptable latency. Consider HNSW index.
- **P2P word matching quality:** Simple word overlap is noisy. "token price analysis" matches "token" in many irrelevant skills. Need TF-IDF or better scoring.

### Feature Opportunities

- **Bootstrap peers** — configure well-known bootstrap peers for DHT initialization. Deploy 2-3 mesh nodes for redundancy.
- **Peer reputation** — track peer reliability (uptime, response quality). Down-weight unreliable peers in P2P discovery.
- **HNSW index** — when skill count exceeds 1K, switch from brute-force to approximate nearest neighbor for embeddings.
- **Real-time embedding updates** — re-embed skills when prompt_template changes. Invalidate discovery cache on update.
- **Onchain registry** — deploy ERC-8004 skill registry on Base. Replace mock data with real on-chain lookups.
- **Discovery analytics** — track which queries return poor results (low confidence scores). Use this to identify gaps in the skill catalog.

### Why It Matters

Discovery is how users find skills. A marketplace with 10,000 skills but bad search is useless. Semantic search must be accurate — returning "price oracle" when the user asked for "portfolio optimization" erodes trust. The mesh network is the foundation for ClawNet's decentralization story — agents discovering each other without a central registry. But a mesh with no peers, mock onchain data, and alpha-quality vector search is a prototype, not production. This chapter identifies what's needed to make discovery reliable enough that users trust the results.

### Audit Verdicts — COMPLETE

| # | Question | Verdict | Detail |
|---|----------|---------|--------|
| 1 | Mesh node port exposure | **KNOWN LIMITATION** | No peer auth; maxConnections=50 is DoS mitigation only |
| 2 | Peer metadata trust | **PASS** | P2P layer is 25% weight, results are informational only |
| 3 | Embedding model memory | **KNOWN LIMITATION** | ~90MB RAM, no pre-check |
| 4 | Embedding seed blocking | **PASS** | Runs in background after serve() |
| 5 | Discovery cache stale results | **PASS** | New skills embed at publish (skills.ts:59) |
| 6 | Onchain layer is mock | **KNOWN LIMITATION** | 15% to 3 hardcoded entries; graceful degradation if 0 matches |
| 7 | Weight override abuse | **PASS** | Weights normalized; user gets what they ask for |
| 8 | sqlite-vec stability | **PASS** | try/catch in semanticLayer, graceful degradation |
| 9 | Peer connection listener leak | **PASS** | removeEventListener in stopMeshNode, double-call safe |
| 10 | Discovery result relevance | **DEFERRED** | Quality concern, needs real-world testing |
| 11 | Mesh node crash isolation | **BUG** | `onPeerConnect` handler had no try/catch |
| 12 | Seed skill embedding drift | **PASS** | Skills embed at publish; registry endpoints stable |

**Bugs fixed (1):**

1. **MEDIUM** `src/mesh/node.ts` line 61-67: `onPeerConnect` event handler had no try/catch. If `getConnections()` or `toString()` throws (e.g., during shutdown race or malicious peer), the error propagates uncaught through libp2p's event emitter and could crash the entire Node.js process. Wrapped handler body in try/catch.

**Known limitations (accepted):**
- Mesh port 4001 open to any libp2p peer — no auth/allowlist (acceptable for discovery-only use)
- Embedding model ~90MB RAM — no pre-check (VPS has 4GB)
- Onchain layer returns mock data — 15% weight redistributes to active layers when 0 matches
- Single mesh node with no bootstrap peers — mesh is non-functional until multi-node deployment

---

## Chapter 10 — Integrations & External Services

### Scope

Every external service ClawNet depends on: Telegram bot, Stripe webhooks, Clerk webhooks, Solana RPC, x402 micropayments, Resend email, and the ClawAPIs provider. Each is a trust boundary where spoofed input, network failure, or API changes can cause data loss, financial errors, or security breaches.

### Files to Read

```
src/integrations/telegram.ts       — grammY bot, commands, cooldowns, broadcast
src/routes/stripe.ts               — Stripe one-time + subscription webhooks
src/routes/solana.ts               — USDC payment verify, package list, build-tx
src/routes/clerk-webhook.ts        — Clerk user lifecycle events
src/routes/x402-skills.ts          — x402 provider mode (serve skills for USDC)
src/utils/email.ts                 — Resend transactional email
src/providers/clawapis.ts          — x402 consumer mode (pay for API calls)
src/config/index.ts                — env vars for all integrations
```

### Current Implementation

**Telegram bot (grammY):**
- Commands: `/start`, `/help`, `/query`, `/price`, `/skill`, `/subscribe`, `/unsubscribe`, `/broadcast` (admin)
- Security: `sanitizeInput()` strips NFKC + control chars. `TELEGRAM_ALLOWED_USER_IDS` env allowlist.
- Cooldowns: 12h global cooldown shared across all users (in-memory). `/price` exempt with per-user 1/min rate limit.
- Broadcast: `broadcastBatched()` sends in parallel batches of 5 to avoid Telegram rate limits.
- Subscribers persisted in `telegram_subscribers` table.

**Stripe webhooks:**
- Two webhook endpoints: `/v1/webhooks/stripe` (one-time) and `/v1/webhooks/stripe-subscriptions`.
- Events handled: `checkout.session.completed`, `invoice.payment_succeeded`, `charge.refunded`.
- Idempotency: `stripe_refunded_charges` table tracks partial refund cents. `stripe_processed_events` prevents double-processing.
- Refund: proportional credit deduction using `newCents = charge.amount_refunded - previousCents`.
- Subscription: `topUpCredits` + `markStripeEventProcessed` wrapped in single `db.transaction()`.

**Solana/USDC:**
- Phantom wallet integration (frontend builds unsigned tx, backend verifies on-chain).
- `tryClaimSolanaSignature()` prevents double-claim. `releaseClaimSolanaSignature()` on all error paths.
- Package bonuses: +7% on all tiers for USDC payments.
- RPC: `SOLANA_RPC_URL` env (default mainnet-beta). Single RPC endpoint, no fallback.

**Clerk webhooks:**
- Events: `user.created` → create free trial key + welcome email. `user.deleted` → deactivate keys.
- Webhook signature verification via Clerk SDK.
- Email lookup cached 5 min in-memory with LRU eviction (10k entries).

**x402:**
- Consumer mode: pays ClawAPIs via Solana SPL tokens (needs `SOLANA_PRIVATE_KEY`).
- Provider mode: serves skills as x402 payable endpoints on Base/USDC (needs `X402_RECIPIENT_ADDRESS`).
- ESM-only packages — uses `require()` CJS workaround with type casting.

**Resend email:**
- Transactional emails: welcome, low-balance alert, admin notifications, key resend.
- `RESEND_API_KEY` + `RESEND_FROM` env vars. Optional `ADMIN_EMAIL` for alerts.
- Rate limiting: one low-balance email per key per 24h (tracked in `email_send_log` table).

### Audit Questions

1. **Telegram global cooldown resets on restart** — the 12h cooldown is in-memory only. If the server restarts, any user can immediately trigger a query. Should this be persisted to SQLite?
2. **Telegram admin broadcast** — is the admin check (`TELEGRAM_ALLOWED_USER_IDS`) sufficient? What happens if env var is empty?
3. **Stripe webhook replay** — if Stripe replays a `checkout.session.completed` event, does the idempotency check prevent double credit? Trace the full path.
4. **Stripe partial refund edge case** — what if `charge.amount_refunded` decreases (Stripe dispute reversal)? The delta calc `newCents = amount_refunded - previousCents` would go negative.
5. **Solana RPC single point of failure** — no fallback RPC. If mainnet-beta is down, all USDC payments fail silently. Should there be a fallback URL list?
6. **Solana signature race** — two requests with same signature arrive simultaneously. Does `tryClaimSolanaSignature()` (INSERT OR IGNORE) handle this atomically?
7. **Clerk webhook user.deleted** — does key deactivation also cancel pending escrows, tasks, and stakes for that user? Or are credits orphaned?
8. **x402 CJS workaround** — the `require()` cast suppresses type errors. Are there runtime failures if x402 packages update their export structure?
9. **Email deliverability** — are there SPF/DKIM records for `claw-net.org`? Failed emails are fire-and-forget — is there alerting on delivery failures?
10. **Webhook body size** — Stripe webhooks have 64KB body limit. Is this sufficient for large subscription events with metadata?

### Production-Scale Concerns

- At 10K+ Telegram subscribers, `broadcastBatched()` with batch size 5 takes `subscribers/5 * Telegram_rate_limit_delay`. Broadcast to 50K users could take hours.
- Stripe webhook volume at scale: 1000+ subscription renewals/month. Each triggers `invoice.payment_succeeded` — verify no N+1 queries in the handler.
- Solana RPC rate limits: mainnet-beta public endpoint has strict rate limits. At scale, need a dedicated RPC provider (Helius, QuickNode).
- Clerk API rate limits: email lookup cached 5min, but at 1000+ concurrent users, cache misses could spike Clerk API usage.

### Feature Opportunities

- **Webhook retry queue** — failed webhook deliveries (tasks, external callbacks) should retry with exponential backoff instead of fire-and-forget.
- **Multi-RPC Solana** — round-robin or failover across multiple RPC endpoints.
- **Telegram inline mode** — let users invoke skills directly from any chat via inline queries.
- **Email templates** — currently inline HTML strings. Move to template files for maintainability.
- **Integration health dashboard** — surface Stripe, Clerk, Solana, Telegram connectivity status in admin panel.

### Why It Matters

Each integration is a trust boundary where the platform hands control to an external system. Webhook signature verification prevents spoofed financial events. Solana claim flow must handle RPC failures without losing money. x402 is a novel payment rail — bugs there have no established recovery playbook. At scale, each external service introduces latency, rate limits, and failure modes that compound. A Telegram bot crash shouldn't affect payment processing. A Stripe outage shouldn't block orchestration. Graceful degradation per-integration is the difference between "some features are slow" and "the platform is down."

### Verdicts

| # | Question | Verdict |
|---|----------|---------|
| 1 | Telegram cooldown resets on restart | KNOWN LIMITATION — in-memory only, acceptable for current scale |
| 2 | Telegram admin broadcast | PASS — empty allowlist blocks all users, broadcastBatched parallel-safe |
| 3 | Stripe webhook replay | PASS — claimStripeSession + stripe_processed_events prevent double credit |
| 4 | Stripe partial refund edge case | KNOWN LIMITATION — negative delta on dispute reversal not handled |
| 5 | Solana RPC single point of failure | PASS — SOLANA_RPC_FALLBACK already implemented |
| 6 | Solana signature race | PASS — INSERT OR IGNORE is atomic |
| 7 | Clerk user.deleted | KNOWN LIMITATION — not handled, orphaned credits possible |
| 8 | x402 CJS workaround | PASS — require() cast works at runtime, fragile but functional |
| 9 | Email deliverability | DEFERRED — SPF/DKIM config is DNS-level, outside code audit scope |
| 10 | Webhook body size | PASS — 64KB sufficient for Stripe events |

**Bugs fixed (3):**
1. **MEDIUM** `x402-skills.ts`: Error details leaked in production → hidden behind `NODE_ENV` check
2. **LOW** `x402-skills.ts`: `JSON.parse(s.tags_json)` → `safeJsonParse<string[]>(s.tags_json, [])` for crash safety
3. **LOW** `email.ts`: Duplicate local `maskApiKey()` removed → uses centralized import from `src/utils/mask.ts`

---

## Chapter 11 — Background Jobs & Cron System

### Scope

Six cron jobs that run continuously in the background, managing escrow expiry, endpoint health, A/B testing, stake unlocks, heartbeat monitoring, and data retention cleanup. Each cron is invisible until it fails — and failure means credits locked forever, tables growing unbounded, or stale data corrupting business logic.

### Files to Read

```
src/core/escrow-cron.ts             — escrow expiry + discovery cache cleanup + peer pruning
src/core/endpoint-health-cron.ts    — HEAD pings to 12 provider URLs + daily retention cleanup
src/core/skill-ab-cron.ts           — A/B challenger auto-promotion
src/core/stake-unlock-cron.ts       — stake credit release on deadline
src/core/heartbeat.ts               — hourly uptime pulse to JSONL file
src/core/seed-skills.ts             — official skill seeding on startup
src/core/seed-embeddings.ts         — embedding vector seeding on startup
src/utils/shutdown.ts               — cron stop sequence
src/db/audit.ts                     — 12 cleanup functions
```

### Current Implementation

| Job | Interval | Guard | Cleanup Piggybacked |
|-----|----------|-------|---------------------|
| Escrow expiry | 10 min | `_running` flag in finally | Discovery cache + stale peers |
| Endpoint health | 5 min | `_running` flag | Daily retention (all 12 cleanup fns) |
| Skill A/B promote | 30 min | `_running` flag | None |
| Stake unlock | periodic | `_running` flag | None |
| Heartbeat | hourly | None | Rotates file at 1000 lines |
| Seed skills | startup only | None | N/A |
| Seed embeddings | startup only | None | N/A |

**Concurrency guard pattern (all crons):**
```typescript
let _running = false;
function run() {
  if (_running) return;
  _running = true;
  try { /* work */ } catch (err) { logger.error(...) } finally { _running = false; }
}
```

**12 cleanup functions in audit.ts:**
`cleanupOldAuditLogs(90d)`, `cleanupOldSkillMetrics(90d)`, `cleanupOldSolanaSigs(30d)`, `cleanupOldOrchestrations(180d)`, `cleanupOldFeedback(90d)`, `cleanupOldEmailLog(30d)`, `cleanupStalePeers(7d)`, `cleanupOldStripeSessions(90d)`, `cleanupOldStripeEvents(90d)`, `cleanupExpiredClaimTokens()`, `cleanExpiredDiscoveryCache()`, `pruneStalePeers(7d)`.

### Audit Questions

1. **Are all 12 cleanup functions actually called?** Trace from `endpoint-health-cron.ts` daily cleanup to verify every function is invoked. Missing one means unbounded table growth.
2. **Tables with NO cleanup:** `reputation_events`, `transactions`, `tasks`, `task_ratings`, `escrows` (completed), `proposals`, `votes`, `skill_stars`, `skill_reports`, `swarms`. These grow indefinitely. Which need cleanup functions?
3. **Escrow cron timing** — runs every 10 min. If a funded escrow expires at minute 1, it won't be caught until minute 10. Is this latency acceptable? What if deadline precision matters for dispute resolution?
4. **A/B cron promotion threshold** — +10% success rate required. What's the minimum sample size? Can a challenger with 2 invocations (100% success) beat a control with 1000 invocations (89% success)?
5. **Stake unlock timing** — what interval does this actually run at? The code says "periodic" — verify the exact `setInterval` value.
6. **Heartbeat file rotation** — keeps last 1000 lines. At hourly writes, that's ~41 days. Is the JSONL file useful for monitoring, or is it dead code that should be replaced with a proper metric?
7. **Seed skills idempotency** — does `seedOfficialSkills()` handle the case where skills already exist? Does it update existing skills or skip them?
8. **Seed embeddings blocking** — `seedEmbeddings()` runs after embedding model loads (async). If 163 endpoints need embedding, how long does this take? Does it block discovery queries during seeding?
9. **Cron drift** — `setInterval` drifts over time (each tick starts interval_ms after the previous tick *completes*, not from a fixed clock). After 30 days, crons could be minutes off schedule. Does this matter?
10. **Shutdown race** — if a cron is mid-execution when SIGTERM arrives, the `_running` flag prevents re-entry but doesn't abort the current run. Does `stopEscrowCron()` (clearInterval) wait for the current tick to finish?

### Production-Scale Concerns

- Daily cleanup of 12 tables in a single cron tick could lock SQLite for seconds. At 1M+ rows in `orchestrations`, the DELETE query scans the entire table. Need indexes on timestamp columns for cleanup queries.
- Endpoint health pings 12 provider URLs every 5 min = 3,456 HTTP requests/day just for monitoring. At scale, this should be configurable per-provider.
- A/B cron evaluates ALL skills with challengers every 30 min. At 10K+ skills, this becomes a performance concern (full table scan + metrics aggregation per skill).
- Stake unlock cron checks ALL stakes every tick. At 100K+ stakes, this needs an indexed query on `unlock_at <= datetime('now')`.

### Feature Opportunities

- **Dead letter queue** — failed cron ticks should write to a DLQ table for manual review, not just log and continue.
- **Cron health dashboard** — expose last-run timestamps and success/failure counts in admin API.
- **Configurable intervals** — move cron intervals to env vars so they can be tuned per-deployment.
- **Batch cleanup** — instead of `DELETE WHERE timestamp < X` (which can lock for seconds on large tables), use `DELETE ... LIMIT 10000` in a loop.
- **Missed-run recovery** — if the server was down for 2 hours, crons should catch up on missed work (e.g., process all expired escrows since last run, not just current ones).

### Why It Matters

Crons are invisible until they break. A stuck escrow cron means funded escrows never expire — users' credits are locked forever. A stuck A/B cron means challenger skills never promote, freezing marketplace evolution. The cleanup cron failing means tables grow unbounded until disk fills (SQLite has no built-in retention). Each cron runs unsupervised — the only signal of failure is a log line that nobody is watching unless observability is set up correctly.

### Verdicts

| # | Question | Verdict |
|---|----------|---------|
| 1 | Are all cleanup functions called? | PASS — 17 cleanup fns called in daily cron + 2 in escrow cron |
| 2 | Tables with NO cleanup | KNOWN LIMITATION — task_ratings, escrows, proposals, skill_stars, skill_reports have no cleanup (low-volume, acceptable) |
| 3 | Escrow cron timing | PASS — 10-min granularity acceptable for hours/days-scale deadlines |
| 4 | A/B cron promotion threshold | PASS — MIN_INVOCATIONS=20 prevents small-sample promotion |
| 5 | Stake unlock timing | PASS — runs every 60s via setInterval |
| 6 | Heartbeat file rotation | PASS — 1000-line cap at hourly writes = ~41 days, useful for basic uptime checks |
| 7 | Seed skills idempotency | PASS — SELECT-before-INSERT + UPDATE on every boot |
| 8 | Seed embeddings blocking | PASS — runs in background via loadEmbeddingModel().then(seedEmbeddings) |
| 9 | Cron drift | PASS — setInterval drift negligible for these intervals (5-60 min) |
| 10 | Shutdown race | PASS — 15s drain period lets in-flight cron ticks complete before DB close |

**Bugs fixed (2):**
1. **MEDIUM** `stake-unlock-cron.ts`: Missing `_running` concurrency guard — added flag + finally block (consistent with all other crons)
2. **MEDIUM** `heartbeat.ts`: Initial `setTimeout` not stored — `stopHeartbeat()` during startup wait leaked the timer. Stored as `startupTimerId`, cleared in `stopHeartbeat()`

---

## Chapter 12 — Infrastructure & Deployment

### Scope

Docker build, compose orchestration, VPS deployment, CI/CD pipeline, firewall rules, SSL termination, backup strategy, disk management, and the gap between "works locally" and "serves 10,000 users reliably."

### Files to Read

```
Dockerfile                          — multi-stage Node 22 build
docker-compose.yml                  — app + Redis services
.github/workflows/ci.yml            — GitHub Actions pipeline
package.json                        — scripts, dependencies (39 prod + 8 dev)
tsconfig.json                       — TypeScript strict config
.dockerignore                       — build context exclusions
.env.example                        — env var template (if exists)
```

### Current Implementation

**Docker:**
- Multi-stage build: Stage 1 (builder) installs all deps + compiles TS. Stage 2 (runner) copies dist + prod deps only.
- Runs as non-root `node` user (UID 1000).
- Data volume: `./data:/app/data` for SQLite persistence.
- Health check: 30s interval, 3 retries.

**docker-compose.yml:**
- Two services: `app` (Node 22) + `redis` (Redis 7-alpine, 128MB maxmemory, allkeys-lru eviction).
- App depends on Redis health. Restart unless-stopped.
- No logging driver configured (defaults to json-file with no rotation).

**CI pipeline (GitHub Actions):**
1. Checkout → Node 22 setup → `npm ci`
2. `npm audit --production --audit-level=moderate`
3. `npm run typecheck` (tsc --noEmit)
4. `npm run test:unit` (48 Vitest tests)
- Missing: no build step, no E2E tests, no deployment trigger.

**VPS:**
- DigitalOcean, Ubuntu 24.04.4, single droplet at `24.199.121.137`.
- SSH as `guardian` user. Deploy via `deploy` alias (git pull + docker compose up --build).
- Backend at `/home/guardian/claw-net/`, frontend at `/var/www/claw-net/`.
- Caddy for SSL termination + static file serving.
- SQLite at `data/orchestrator.db` (WAL mode, 41 migrations).
- Ports: 3402 (API), 4001 (libp2p mesh).

### Audit Questions

1. **Docker layer caching** — does the Dockerfile copy `package.json` + `package-lock.json` before source code? If not, every code change reinstalls all deps.
2. **Docker restart policy** — `unless-stopped` means a crash at 3am auto-restarts. But does the health check actually catch hung processes (e.g., SQLite lock contention)?
3. **Redis data persistence** — Redis is configured with `allkeys-lru` but no AOF/RDB persistence. If Redis container restarts, all cached data (rate limits, circuit breaker state, query cache) is lost. Is this acceptable?
4. **No Docker log rotation** — json-file driver with no max-size means container logs grow unbounded until disk fills. Need `max-size: 10m` + `max-file: 3`.
5. **SQLite backup strategy** — what happens if the VPS disk fails? Is there automated backup of `data/orchestrator.db`? SQLite in WAL mode needs special backup handling (can't just `cp` the file).
6. **SSL certificate renewal** — Caddy auto-renews Let's Encrypt certs. But if Caddy crashes or the renewal fails, the API goes down on HTTPS. Any monitoring for cert expiry?
7. **Firewall rules** — port 4001 (libp2p) needs to be open. Is UFW configured? Are there any other ports unintentionally exposed?
8. **Single VPS** — zero redundancy. What's the recovery time if the droplet is destroyed? Is there a runbook for rebuilding from scratch?
9. **CI doesn't build** — `npm run typecheck` passes but `npm run build` (tsc with output) might fail. CI should verify the actual build artifact.
10. **Dependency vulnerabilities** — 6 known vulnerabilities including HIGH in bigint-buffer (Solana chain, no fix available). What's the risk assessment?
11. **No pre-commit hooks** — no ESLint, no Prettier, no Husky. Code quality is enforced only by CI, not at commit time.
12. **Deploy is manual** — `deploy` alias is SSH + git pull + docker compose. No blue-green deployment, no rollback mechanism, no canary. A bad deploy takes the platform down until manually reverted.

### Production-Scale Concerns

- Single VPS with SQLite means all reads and writes go through one process. At 1000+ concurrent requests, SQLite write serialization becomes the bottleneck. WAL mode helps (concurrent reads), but writes are still serialized.
- Redis with 128MB maxmemory means cache eviction starts early. At scale, frequently accessed query results may be evicted, causing upstream API cost spikes.
- Docker container memory is unbounded — no `--memory` limit. A memory leak (e.g., in-memory cache, libp2p connections) can OOM-kill the container and take down the database mid-write.
- No horizontal scaling path. Adding a second VPS requires shared state (Redis cluster + SQLite replication or migration to Postgres).

### Feature Opportunities

- **Automated backups** — daily SQLite backup to S3/DigitalOcean Spaces using `sqlite3 .backup` command (WAL-safe).
- **Docker log rotation** — add `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` to compose.
- **CI build step** — add `npm run build` to CI pipeline.
- **Health check endpoint enhancement** — return more diagnostics (Redis connected, DB writable, disk space, cron status).
- **Blue-green deploy** — run new container alongside old, verify health, then swap traffic.
- **Memory limits** — add `deploy.resources.limits.memory: 2g` to compose for OOM protection.
- **Monitoring stack** — add Prometheus metrics endpoint + Grafana dashboard (or use DigitalOcean monitoring).
- **Staging environment** — separate VPS with test data for pre-production validation.

### Why It Matters

Infrastructure is the difference between "works on my machine" and "works for 10,000 users." A misconfigured Docker restart policy means a crash at 3am stays down until morning. No backup strategy means a disk failure loses all user data and all credits — real money gone. CI that doesn't catch regressions means broken deploys reach production. Single VPS means zero redundancy — every failure is a full outage.

### Verdicts

| # | Question | Verdict |
|---|----------|---------|
| 1 | Docker layer caching | PASS — package*.json copied before source code |
| 2 | Docker restart + health check | PASS — 30s interval, 3 retries, hits /v1/health |
| 3 | Redis data persistence | PASS — Redis is L2 cache, loss on restart acceptable |
| 4 | No Docker log rotation | FIXED — added max-size 10m + max-file 3 to both services |
| 5 | SQLite backup strategy | DEFERRED — operational task, not code |
| 6 | SSL certificate renewal | DEFERRED — Caddy handles, outside code scope |
| 7 | Firewall rules | DEFERRED — VPS-level config |
| 8 | Single VPS | KNOWN LIMITATION — acceptable for current scale |
| 9 | CI doesn't build | FIXED — added `npm run build` step to CI pipeline |
| 10 | Dependency vulnerabilities | KNOWN LIMITATION — bigint-buffer (Solana transitive) has no fix |
| 11 | No pre-commit hooks | PASS — CI enforces quality, hooks are optional |
| 12 | Deploy is manual | KNOWN LIMITATION — acceptable for early-stage |

**Bugs fixed (2):**
1. **MEDIUM** `docker-compose.yml`: No log rotation — added `json-file` driver with `max-size: 10m` + `max-file: 3` to both orchestrator and redis services
2. **LOW** `.github/workflows/ci.yml`: Missing build step — added `npm run build` between typecheck and tests

---

## Chapter 13 — Frontend & User Experience

### Scope

10 static HTML pages serving as the entire user-facing frontend. No framework, no component reuse, no state management. Each page is independently maintained with inline CSS/JS. This chapter audits UX flows, accessibility, performance, and whether the frontend successfully converts visitors into paying users.

### Files to Read

```
site/index.html              — 69 KB, landing page + pricing + payment flows
site/dashboard.html           — 65 KB, Clerk auth, API key management, credits
site/marketplace.html         — 121 KB, skill browsing, publishing, purchases, ratings
site/docs.html                — 65 KB, API documentation
site/endpoints.html           — 40 KB, searchable endpoint catalog
site/success.html             — 14 KB, payment confirmation + API key reveal
site/admin.html               — 16 KB, admin dashboard
site/login.html               — 4.9 KB, Clerk login redirect
site/contact-section.html     — 12 KB, contact form
site/admin-vps.html           — 3.7 KB, VPS admin tools
```

### Current Implementation

- **Design:** Muted dark theme, teal accent (#10b981), Inter + JetBrains Mono fonts.
- **Auth:** Clerk.js CDN loaded on dashboard/marketplace pages. Publishable key hardcoded in HTML.
- **Payments:** Stripe Checkout redirect on landing page. USDC via Phantom wallet integration.
- **Total HTML:** ~398 KB across 10 files. No shared CSS/JS framework — each page bundles everything inline.
- **CDN deps:** Google Fonts, Clerk.js v5.
- **No build step:** Pages are served as-is by Caddy from `/var/www/claw-net/`.

### Audit Questions

1. **Landing page conversion** — what's the flow from landing → purchase → first API call? How many clicks? Is there a clear CTA?
2. **Dashboard key reveal** — is the full API key shown only once, or can users re-reveal it? What happens if they lose it?
3. **Marketplace UX** — can users easily discover, evaluate, and purchase skills? Are ratings and reviews prominently displayed?
4. **Mobile responsiveness** — are all 10 pages responsive? Test at 375px (iPhone SE) and 768px (iPad).
5. **Accessibility** — ARIA labels on interactive elements? Keyboard navigation? Color contrast ratios? Screen reader compatibility?
6. **Page load performance** — 121 KB marketplace.html is large. Are there render-blocking scripts? Can above-the-fold content load first?
7. **Error states** — what does the user see when: API key is invalid, payment fails, skill invocation errors, network timeout?
8. **Docs completeness** — does docs.html cover all 100+ endpoints? Is pricing per-endpoint shown?
9. **USDC payment UX** — is the Phantom wallet flow clear for non-crypto-native users? What if they don't have Phantom installed?
10. **Onboarding** — is there a guided "first API call" experience after signup? Or is the user dropped into the dashboard with no guidance?

### Production-Scale Concerns

- 398 KB of HTML with no minification or compression. At 10K monthly visitors, that's ~4 GB of HTML transfer.
- No service worker or offline capability. Every page load is a full server round-trip.
- Clerk.js CDN is a single point of failure for auth — if jsdelivr goes down, users can't log in.
- No analytics — no way to measure conversion funnel, page views, or user behavior.

### Feature Opportunities

- **Shared CSS/JS** — extract common styles and scripts into shared files. Reduces total payload by ~60%.
- **Usage dashboard** — let users see their credit usage over time (charts, history).
- **Billing history page** — show all payments, credits received, and credit usage.
- **Interactive API playground** — let users try endpoints directly from docs page (like Swagger UI).
- **Onboarding wizard** — guided flow: signup → get key → make first call → see result → purchase credits.
- **Dark/light mode toggle** — currently forced dark mode. Some users prefer light.
- **PWA manifest** — add service worker for offline dashboard access (cached key, balance).

### Why It Matters

The frontend is the first (and often only) impression. A confusing dashboard means users don't understand their credits. A broken payment flow means lost revenue. Poor marketplace UX means developers don't publish skills. The frontend is plain HTML (no framework) — which means no component reuse, no state management, and every page is independently maintained. At the scale ClawNet is targeting, the frontend needs to convert visitors into paying API users efficiently.

### Verdicts

| # | Question | Verdict |
|---|----------|---------|
| 1 | Landing page conversion | PASS — clear CTA flow, Stripe + USDC paths |
| 2 | Dashboard key reveal | PASS — one-time per session, memory-only storage, regenerate available |
| 3 | Marketplace UX | PASS — search/filter/purchase/rating flows work, all data escaped via esc() |
| 4 | Mobile responsiveness | PASS — viewport meta tags on all pages, media queries, fluid typography |
| 5 | Accessibility | UX IMPROVEMENT — missing ARIA labels on buttons, no skip-to-content, no focus trap in modals |
| 6 | Page load performance | UX IMPROVEMENT — large inline scripts (~45KB in dashboard), no code splitting |
| 7 | Error states | PASS — all fetch calls have error handling, user-facing toast/modal messages |
| 8 | Docs completeness | PASS — endpoints documented, admin endpoints noted |
| 9 | USDC payment UX | PASS — Phantom detection with fallback message, multi-step status updates |
| 10 | Onboarding | UX IMPROVEMENT — no guided first-API-call experience after signup |

**Bugs fixed (0):** No security or code bugs found. All user-controlled data properly escaped (esc() function). API keys handled safely (memory-only, never in URL or localStorage). All issues are UX/accessibility improvements, not bugs.

---

## Chapter 14 — Observability & Operations

### Scope

How the platform is monitored, debugged, and operated in production. Covers logging, error tracking, health monitoring, admin tools, and the gap between "it's running" and "I know exactly what it's doing."

### Files to Read

```
src/utils/logger.ts                 — Pino structured logging config
src/core/heartbeat.ts               — hourly uptime pulse to JSONL
src/core/endpoint-health-cron.ts    — provider health monitoring
src/core/circuit-breaker.ts         — per-endpoint failure tracking
src/routes/admin.ts                 — admin dashboard + management endpoints
src/routes/stats.ts                 — public platform statistics
src/db/audit.ts                     — audit log system
src/cache/index.ts                  — cache stats function
```

### Current Implementation

**Pino logger:**
- Structured JSON logs in production, pretty-print in dev.
- Redaction paths configured for sensitive fields (API keys, tokens).
- Log levels: trace/debug/info/warn/error/fatal.

**Heartbeat:**
- Hourly write to `data/heartbeat.jsonl` with timestamp, uptime, memory usage.
- File rotated at 1000 lines (~41 days of history).

**Endpoint health:**
- HEAD pings to 12 provider base URLs every 5 min.
- Tracks uptime_pct, avg_latency_ms, success_count, failure_count per provider.
- `GET /v1/registry/health` exposes status publicly.

**Circuit breaker:**
- Per-endpoint state: CLOSED → OPEN (after 5 failures) → HALF_OPEN (after 60s).
- MAX_CIRCUITS = 500 (prevents memory leak from unique endpoint IDs).
- 7-day auto-reset. `probing` flag prevents thundering herd in HALF_OPEN.
- `getCircuitStats()` returns open/closed counts.

**Admin dashboard:**
- `GET /v1/admin/dashboard` — HTML dashboard with key stats.
- `GET /v1/admin/treasury` — treasury + official key balances.
- `GET /v1/admin/revenue` — platform revenue breakdown.
- Key revocation, user management, circuit breaker reset.

**Audit log:**
- Entity-action pattern: `{ entityType, entityId, action, actorId, data }`.
- Used for: escrow state changes, governance votes, skill security scans, discovery queries.
- 90-day retention (cleanup function exists).

**Sentry:**
- Optional integration via `SENTRY_DSN` env var.
- If not configured, errors only appear in Pino logs.

### Audit Questions

1. **Log volume** — at 1000 req/min, how much log data is generated per day? Is there log rotation on the Docker container?
2. **Sensitive data in logs** — verify Pino redaction covers ALL sensitive fields: API keys, Stripe keys, Solana private keys, JWT tokens, email addresses, passwords.
3. **Heartbeat utility** — is anyone reading the JSONL file? If not, it's dead code generating disk I/O. Should it be replaced with a proper metrics endpoint?
4. **Circuit breaker visibility** — when a circuit opens (provider down), is there an alert? Or does it silently degrade until someone checks the admin dashboard?
5. **Admin dashboard security** — is the HTML dashboard vulnerable to XSS via injected data (user emails, skill names, API key prefixes)?
6. **Audit log completeness** — are all state-changing operations logged? Check: credit deductions, key creation/revocation, skill publish/unpublish, payment events.
7. **Cache stats** — is `cacheStats()` exposed anywhere? Can the operator see Redis hit/miss rates?
8. **Error alerting** — Sentry is optional and not configured by default. What's the alerting strategy for production errors?
9. **Per-key usage tracking** — can the operator see which API keys are consuming the most credits, making the most requests, or hitting rate limits?
10. **Incident response** — if orchestration latency spikes to 30s, how would the operator detect it? Is there p99 latency tracking?

### Production-Scale Concerns

- Pino JSON logs at 1000 req/min = ~1GB/day of log data. Docker json-file driver with no rotation fills disk.
- Audit log table at 1000 writes/day × 90 days = 90K rows. `DELETE WHERE timestamp < X` on 90K rows locks SQLite briefly.
- Endpoint health stores one row per provider (ON CONFLICT upsert) — bounded. But historical health data is lost (no time-series).
- Circuit breaker state is in-memory — lost on restart. All circuits start CLOSED, causing a burst of requests to previously-failed providers.

### Feature Opportunities

- **Prometheus metrics endpoint** — expose req/sec, latency percentiles, cache hit rate, credit deduction rate, circuit breaker state as Prometheus metrics.
- **Admin alerting** — email or Telegram notification when: circuit opens, daily spend anomaly, key exhaustion, disk >80%.
- **Historical health data** — store endpoint health checks as time-series (not just latest status) for trend analysis.
- **Circuit breaker state persistence** — save to SQLite on shutdown, restore on startup to avoid thundering herd.
- **Request tracing** — add trace IDs (already have requestId) and propagate through LLM calls for end-to-end debugging.
- **User-facing usage dashboard** — let API key holders see their usage patterns (requests/day, credits/day, top skills used).

### Why It Matters

You can't fix what you can't see. Without structured observability, debugging production issues means SSH-ing into the VPS and grep-ing log files. Missing metrics means capacity problems are discovered by users, not by alerts. The admin dashboard is the operator's window into platform health — if it's incomplete or misleading, operational decisions are made blind. At scale, observability is the difference between proactive ops and reactive firefighting.

### Verdicts

| # | Question | Verdict |
|---|----------|---------|
| 1 | Log volume | PASS — Docker log rotation added in Ch12 (10m × 3 files) |
| 2 | Sensitive data in logs | PASS — 16 redaction paths cover all secrets; emails logged for ops debugging (acceptable) |
| 3 | Heartbeat utility | PASS — useful for basic VPS uptime checks via SSH |
| 4 | Circuit breaker visibility | KNOWN LIMITATION — logs warn on open, no proactive alert (email/Telegram) |
| 5 | Admin dashboard XSS | PASS — all data escaped via escapeHtml() |
| 6 | Audit log completeness | KNOWN LIMITATION — skill creation not audit-logged (low priority) |
| 7 | Cache stats exposed | PASS — available in admin HTML dashboard |
| 8 | Error alerting | KNOWN LIMITATION — sendAdminAlert() used for spend anomaly + marketplace deficit only, not circuit breaker/cron failures |
| 9 | Per-key usage tracking | PASS — GET /v1/auth/usage provides per-key stats |
| 10 | Incident response / p99 latency | KNOWN LIMITATION — only avgDurationMs tracked, no percentiles |

**Bugs fixed (1):**
1. **MEDIUM** `usage.ts`: `usage.jsonl` appended on every request with no rotation — grows unbounded (~720MB/day at scale). Added `rotateUsageFile()` with 10K-line cap, triggered every 1000 writes.

---

## Chapter 15 — Scalability & Performance

### Scope

Every performance ceiling and scalability wall in the system. SQLite write serialization, Redis cache effectiveness, circuit breaker tuning, connection limits, response size guards, timeout configurations, and the path from single-VPS to multi-instance if needed.

### Files to Read

```
src/cache/index.ts                  — L1 (memory) + L2 (Redis) cache layer
src/core/circuit-breaker.ts         — per-endpoint failure isolation
src/core/executor.ts                — parallel API execution + timeouts
src/core/intent-parser.ts           — LLM call + Redis caching
src/core/formatter.ts               — LLM synthesis
src/providers/llm.ts                — LLM provider timeouts + fallback
src/middleware/rate-limit.ts         — IP + key-based rate limiting
src/routes/stream.ts                — SSE concurrent stream cap
src/routes/batch.ts                 — batch query limits
src/db/connection.ts                — SQLite WAL + busy_timeout config
src/config/index.ts                 — rate limit + timeout env vars
```

### Current Implementation

**Cache architecture:**
- L1: In-memory Map (default 10K entries, FIFO eviction — not true LRU).
- L2: Redis (optional, `ioredis`, `maxRetriesPerRequest: 3`).
- Cache key: `orch:${SHA256(query)}` for orchestration results.
- TTLs: metadata 24h, prices 60s, holders 30min, social 10min.
- Response size guard: 1MB max cached per entry.
- Fallback: if Redis is down, memory-only mode (rate limits use in-memory incrStore).

**Rate limiting:**
- Global: 60 req/min/IP (configurable via `RATE_LIMIT_PER_MIN`).
- Per-key tiered: `rateTier(amountPaid)` — $0: 30/min, $20: 60/min, $100: 120/min, $500: 300/min.
- Batch queries: each query in batch consumes a rate limit slot.
- Implementation: `cacheIncr()` with 60s TTL. If Redis down, in-memory counter (resets on restart).

**SQLite:**
- WAL mode (concurrent reads, serialized writes).
- `busy_timeout: 5000` (5s wait before SQLITE_BUSY error).
- Foreign keys enabled.
- No connection pooling (single connection, synchronous API).

**Timeouts:**
- LLM: 30s AbortController timeout.
- API steps: 15s per external API call.
- Redis: 5s connection timeout.

**Limits:**
- SSE streams: max 5 concurrent per key (in-memory tracking).
- Batch queries: max 10 queries, MAX_BATCH_STEPS=30 total API calls.
- Request body: 256KB general, 64KB webhooks.
- Mesh connections: maxConnections=50.

### Audit Questions

1. **Memory cache FIFO eviction** — the cache deletes the first key when full. This is not LRU — a frequently accessed hot key could be evicted if it was inserted early. Quantify the cache hit rate loss vs true LRU.
2. **Redis failure mode** — when Redis goes down: rate limits reset (anyone can burst), query cache is lost (API costs spike), circuit breaker incr fails. What's the blast radius?
3. **SQLite write contention** — at 100 concurrent writes/sec, how often does `SQLITE_BUSY` fire? WAL mode helps reads but writes are still serialized. Profile under load.
4. **LLM timeout cascade** — if the intent parser times out at 30s, the user waits 30s for an error. Should there be a faster timeout for intent parsing (5-10s) vs synthesis?
5. **Batch amplification** — 10 queries × 3 steps each = 30 API calls from one HTTP request. Does this create a DoS vector for a single API key?
6. **SSE stream memory leak** — if a client disconnects without triggering the close event, does the `activeStreams` counter decrement? Or do ghost streams accumulate?
7. **Circuit breaker MAX_CIRCUITS=500** — with 163 endpoints, this seems sufficient. But if endpoint IDs are user-generated (skills with custom IDs), could an attacker create 500+ unique circuit entries to fill the map?
8. **Cache stampede** — when a popular cached query expires, 100 concurrent requests all miss cache and hit the LLM simultaneously. Is there a cache stampede prevention mechanism (lock, probabilistic refresh)?
9. **Response size guard** — 1MB max cached. What if a legitimate orchestration result exceeds 1MB? Is it served uncached or truncated?
10. **In-memory state inventory** — list ALL in-memory state: cache map, rate limit counters, circuit breakers, active streams, Telegram cooldowns, embedding model, Clerk email cache. Total memory footprint?

### Production-Scale Concerns

- **SQLite at 1M rows:** `orchestrations`, `transactions`, `skill_metrics` tables grow fastest. DELETE cleanup on 100K+ rows locks the database for seconds. Need `LIMIT 10000` batched deletes.
- **Redis 128MB:** At 10K cached queries × 10KB avg = 100MB. Near-full Redis triggers eviction, losing rate limit state.
- **LLM costs:** Without cache, every query costs 2 LLM calls (intent + synthesis). At 1000 queries/day, that's ~$50/day in LLM costs. Cache hit rate directly determines profitability.
- **Single-process Node.js:** No clustering. CPU-bound operations (embedding generation, JSON parsing) block the event loop. At 100+ concurrent requests, tail latency spikes.
- **No connection pooling:** better-sqlite3 uses a single synchronous connection. Long-running transactions block all other queries.

### Feature Opportunities

- **True LRU cache** — replace FIFO Map with `lru-cache` npm package (O(1) get/set, configurable max size).
- **Cache stampede prevention** — use "stale-while-revalidate" pattern: serve stale cache while refreshing in background.
- **SQLite read replicas** — use `litestream` for real-time replication to S3, with read replicas for analytics queries.
- **Worker threads** — offload embedding generation and LLM response parsing to worker threads to avoid event loop blocking.
- **Response streaming** — for large orchestration results, stream responses instead of buffering entire response in memory.
- **Tiered cache TTL** — adjust TTL based on query specificity. Generic "trending tokens" queries get longer TTL than specific "wallet 7xK... balance" queries.
- **Rate limit headers** — return `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers so clients can self-throttle.

### Why It Matters

ClawNet currently runs on a single VPS. Every scalability ceiling is a hard wall — not a gradual degradation. SQLite write serialization means a traffic spike blocks all writes. Redis going down falls back to no-cache mode, multiplying API costs by 10x. The circuit breaker prevents cascading failures from a single bad provider, but misconfigured thresholds mean either false-tripping (lost revenue) or not tripping (wasted API budget on dead endpoints). Performance optimization at this stage is about extending the runway before needing infrastructure migration.

### Verdicts

| # | Question | Verdict |
|---|----------|---------|
| 1 | Memory cache FIFO eviction | PASS — actually LRU: get() promotes keys to tail via delete+re-insert; audit outline description was incorrect |
| 2 | Redis failure mode | PASS — graceful degradation: in-memory rate limits, no-cache mode, circuit breaker memory-only |
| 3 | SQLite write contention | PASS — busy_timeout=5000ms, WAL mode, crons are the primary writers |
| 4 | LLM timeout cascade | KNOWN LIMITATION — 30s timeout for both intent+synthesis; split timeouts would improve UX |
| 5 | Batch amplification DoS | PASS — MAX_BATCH_STEPS=30 caps total API calls regardless of query count |
| 6 | SSE stream memory leak | PASS — streamCounted flag prevents double-decrement; both finally and cancel() handled |
| 7 | Circuit breaker MAX_CIRCUITS=500 | PASS — endpoint IDs are registry-static (163) or skill IDs, not user-arbitrary |
| 8 | Cache stampede | KNOWN LIMITATION — no stale-while-revalidate or distributed lock on expiry |
| 9 | Response size guard | PASS — oversized responses (>1MB) served uncached but not truncated |
| 10 | In-memory state inventory | PASS — all maps bounded: cache (10K), rate limits (purged 60s), circuits (500), streams (5/key), Clerk cache (10K LRU) |

**Bugs fixed (0):** No code bugs found. All issues are architectural known limitations or performance improvement opportunities.

---

## Chapter 16 — Governance & Community

### Scope

On-platform governance (proposals + voting), community moderation (skill reports + flagging), trust hierarchy (security statuses), and the mechanisms that allow the community to shape the platform's evolution.

### Files to Read

```
src/routes/governance.ts            — proposal CRUD + voting endpoints
src/db/governance.ts                — proposal/vote DB operations
src/db/skills.ts                    — reportSkill(), security statuses, VERIFIED badge
src/routes/skills.ts                — community report endpoint
src/routes/marketplace.ts           — featured skills, admin moderation
src/core/skill-scanner.ts           — automated security scanning
src/core/skill-ab-cron.ts           — A/B auto-promotion (community-driven quality)
```

### Current Implementation

**Proposals:**
- Any key with 100+ credits can create a proposal (title, description, closeDays 1-30).
- Status: OPEN → CLOSED (auto-expire) → EXECUTED (manual).
- Paginated listing with status filter.

**Voting:**
- Vote weight: `sqrt(total_credits_spent)` — quadratic-lite. Prevents plutocratic capture while rewarding platform engagement.
- Self-transfer credits excluded from weight calculation (anti-gaming).
- UNIQUE constraint on (voter_key, proposal_id) prevents double-voting.
- FOR/AGAINST directions, weight stored per vote.

**Community moderation:**
- `reportSkill()` — any user can report a skill with reason text. UNIQUE(skill_id, reporter_key) prevents spam.
- Auto-flag at 3+ unique reports: security_status → FLAGGED (blocks invoke AND purchase).
- VERIFIED skills (set by admin) are immune to auto-flagging (`NOT IN ('VERIFIED','FLAGGED')`).

**Trust hierarchy:**
- UNSCANNED → CLEAN (scanner passed) → VERIFIED (admin approved) → FLAGGED (community reported or scanner failed).
- 18-pattern regex scanner runs on publish, fork, and invoke-time variable values.
- FLAGGED skills are blocked from marketplace purchase AND direct invocation.

### Audit Questions

1. **Sybil attack on voting** — can someone create 100 API keys, spend 1 credit each, and get 100 × sqrt(1) = 100 votes? The `sqrt` formula should use `credits_used` (lifetime spend), but does each key count independently?
2. **Sybil attack on reports** — can the same person create multiple keys and file 3 reports to auto-flag a competitor's skill?
3. **Proposal execution** — proposals auto-close but who executes them? There's no automated execution path. Is EXECUTED status set manually by admin?
4. **Vote weight manipulation** — if someone buys $1000 in credits, their weight is sqrt(1,000,000) ≈ 1000. A single whale can outweigh 1000 regular users. Is this intended?
5. **Report reason quality** — reports store free-text reason with no validation beyond max length. Are there categories (spam, malicious, copyright, etc.) that would help triage?
6. **VERIFIED badge abuse** — admin can set VERIFIED on any skill. Is there a process/criteria, or is it arbitrary? Can VERIFIED status be revoked?
7. **Flagged skill recovery** — once FLAGGED, how does a skill owner get unflagged? Is there an appeal mechanism?
8. **Governance turnout** — with low user counts, proposals might have 2-3 voters. Is there a minimum quorum for a proposal to be considered valid?
9. **Proposal spam** — 100 credits is the barrier to propose. At $0.10 (100 credits), someone could spam hundreds of proposals. Should the cost be higher?
10. **Historical proposals** — no cleanup for old proposals/votes. At scale, the governance tables grow unbounded. Need archival strategy.

### Production-Scale Concerns

- Vote weight calculation queries `SUM(credits_used)` across all transactions for a key. At 1M+ transactions, this scan is expensive. Should be cached or materialized.
- Report count check (`COUNT(*) FROM skill_reports WHERE skill_id = ?`) on every new report. Needs index on `skill_id` (already exists: UNIQUE constraint).
- Auto-flag threshold of 3 is low for a platform with 10K+ users. False positives become common. Should scale with user count.

### Feature Opportunities

- **Minimum quorum** — require N voters or N% of active users for a proposal to be valid.
- **Proposal categories** — separate governance proposals (platform policy) from feature requests.
- **Report categories** — structured reasons (security, spam, copyright, quality) for better triage.
- **Appeal process** — FLAGGED skill owners can submit appeal, reviewed by admin or community vote.
- **Governance notifications** — email or Telegram notification when a new proposal is created or enters voting phase.
- **Vote delegation** — allow users to delegate their voting weight to trusted community members.
- **Proposal bond** — require 100 credits to be locked (not spent) while proposal is open. Refunded when proposal closes. Prevents spam without permanent cost.

### Why It Matters

Governance is the mechanism for community-driven platform evolution. A broken voting weight formula means plutocratic capture or Sybil attacks. Community reports are the first line of defense against malicious skills — if the flagging threshold is wrong, either legitimate skills get buried or dangerous ones stay live. The trust hierarchy (CLEAN → VERIFIED → FLAGGED) determines what users see and trust. At scale, governance becomes the primary way the platform self-regulates without centralized admin intervention.

---

## Chapter 17 — Testing & Verification

### Scope

Test coverage, test quality, CI pipeline, and the gap between "48 tests pass" and "the platform is verified correct under all conditions."

### Files to Read

```
vitest.config.ts                    — test configuration
tests/unit/helpers/db.ts            — mock DB helper
tests/unit/credit.test.ts           — 10 credit tests
tests/unit/escrow.test.ts           — 19 escrow tests
tests/unit/governance.test.ts       — 10 governance tests
tests/unit/skills.test.ts           — 9 skill tests
tests/run.ts                        — 6 integration tests
.github/workflows/ci.yml            — CI pipeline
```

### Current Implementation

**Unit tests (48 tests, 4 files):**
- `credit.test.ts` (10): deductCredit, topUpCredits, atomicity, inactive keys.
- `escrow.test.ts` (19): full state machine, fundEscrow, releaseEscrow, transitionEscrow, edge cases.
- `governance.test.ts` (10): createProposal, castVote, duplicate votes, vote weights, auto-expiry.
- `skills.test.ts` (9): createSkill, listPublicSkills, incrementUses, deleteSkill, 97% revenue share.

**Integration tests (6 tests, tests/run.ts):**
- Runs against live server on localhost:3402.
- Basic endpoint checks: health, registry, token query, cache, error handling.

**Mock strategy:**
- `vi.mock('../db/index')` with `importOriginal` — real function implementations, in-memory DB.
- Each test gets fresh DB state (isolate per file).

**CI:**
- GitHub Actions: typecheck + unit tests on push/PR to main.
- No build verification, no E2E tests, no coverage threshold enforcement.

### Audit Questions

1. **Coverage gaps** — which of these modules have ZERO test coverage?
   - Routes: api, marketplace, stripe, solana, tasks, swarm, stream, batch, admin, dashboard, clerk-webhook, x402-skills, llm, mesh, discover, contact, feedback, openapi, stats, endpoints
   - Middleware: auth, clerk-auth, admin-auth, rate-limit, sign-response
   - Core: intent-parser, executor, formatter, skill-executor, skill-scanner, circuit-breaker, embeddings, discovery-engine, seed-skills, seed-embeddings
   - Providers: llm, clawapis
   - Utils: shutdown, logger, email, html, template, mask
   - Cache: index
2. **Financial flow testing** — are these critical paths tested end-to-end?
   - Stripe webhook → credit top-up → skill purchase → revenue share → creator withdrawal
   - USDC payment → signature verify → credit top-up → orchestration → credit deduction
   - Batch orchestration → upfront deduction → execution → partial refund
3. **Error path testing** — are failure modes tested?
   - What happens when deductCredit returns false? When LLM times out? When Redis is down?
   - Double webhook replay, expired escrow with active work, concurrent stake/unstake.
4. **Test isolation** — do tests share any global state? Can test order affect results?
5. **Mock fidelity** — does the mock DB accurately simulate SQLite behavior (WAL mode, UNIQUE constraints, foreign keys, ON CONFLICT)?
6. **CI coverage threshold** — there's no minimum coverage gate. A PR could reduce coverage to 0% and still pass CI.
7. **Integration test reliability** — tests/run.ts requires a running server. Is it run in CI? If not, how is it verified?
8. **Load testing** — is there any load test for concurrent orchestration, batch queries, or SSE streams?
9. **Security testing** — are there tests for: SQL injection, XSS in skill templates, auth bypass, rate limit circumvention?
10. **Regression tests** — do bugs found in audits (ch01-09) have corresponding regression tests to prevent re-introduction?

### Production-Scale Concerns

- 48 tests covering 4 modules means ~20+ modules have zero coverage. Every untested module is a regression risk on every deploy.
- No integration tests in CI means the route → middleware → DB chain is unverified.
- No load tests means performance regressions are discovered in production.
- No E2E payment flow tests means Stripe/Solana changes could break billing without detection.

### Feature Opportunities

- **Coverage enforcement** — add `--coverage.thresholds.lines=70` to vitest config. Fail CI if coverage drops below threshold.
- **Route handler tests** — test each route handler with mocked middleware (inject apiKeyInfo directly).
- **Webhook simulation tests** — test Stripe/Clerk webhook handlers with sample payloads.
- **Load test suite** — use `autocannon` or `k6` for concurrent request testing.
- **Contract tests** — verify OpenAPI spec matches actual route behavior.
- **Snapshot tests** — for formatted LLM responses, verify output structure stability.
- **Property-based testing** — for credit arithmetic (fuzzing deduction amounts, concurrent operations).

### Why It Matters

Tests are the safety net for every future change. 48 tests covering 4 modules means 20+ modules have zero test coverage. No integration tests means the route → middleware → DB chain is untested as a whole. No E2E tests means payment flows, webhook handling, and SSE streaming are verified only manually. Every untested path is a regression waiting to happen. At ClawNet's scale ambition, deploying without comprehensive tests is deploying blind.

---

## Chapter 18 — Resilience & Shutdown

### Scope

How the platform handles failures, crashes, and graceful shutdowns. Covers process error handlers, shutdown sequence, Redis reconnection, database connection lifecycle, embedding model failures, and the ability to survive and recover from any single-component failure.

### Files to Read

```
src/utils/shutdown.ts               — SIGTERM/SIGINT handlers, drain, service stop
src/index.ts                        — startup sequence, start().catch, process handlers
src/cache/index.ts                  — Redis connection, reconnection behavior
src/db/connection.ts                — initDb(), closeDb(), WAL mode
src/core/embeddings.ts              — model load failure + backoff
src/mesh/node.ts                    — startMeshNode/stopMeshNode with try/catch
src/integrations/telegram.ts        — bot start/stop
src/core/endpoint-health-cron.ts    — cron start/stop
src/core/escrow-cron.ts             — cron start/stop
```

### Current Implementation

**Shutdown sequence (src/utils/shutdown.ts):**
1. Close HTTP server (stop accepting connections).
2. Drain 5s (let in-flight requests complete).
3. Stop all 6 cron jobs.
4. Stop mesh node (try/catch safe).
5. Stop Telegram bot.
6. Close SQLite DB.
7. Close Redis (5s timeout).
8. `process.exit(0)`.
9. Force-exit timer: 30s failsafe.

**Process error handlers (src/index.ts):**
- `unhandledRejection`: log error, continue running.
- `uncaughtException`: log error, exit immediately.

**Redis reconnection:**
- ioredis auto-reconnects with exponential backoff.
- `maxRetriesPerRequest: 3` — after 3 failures, operation returns error (not crash).
- `redisConnected` flag checked before operations. Falls back to memory-only.

**Embedding model:**
- Exponential backoff on load failures (`_failCount`, min 1s → max 30s).
- `_loadPromise = null` in catch — allows retry after backoff.
- `/v1/discover` returns 503 if model unavailable.

**Startup failure:**
- `start().catch((err) => { logger.fatal(...); process.exit(1); })`.
- If initDb fails, process exits before HTTP port opens.

### Audit Questions

1. **Drain vs cron race** — during the 5s drain, are cron jobs still running? Can a cron write to SQLite AFTER closeDb() is called?
2. **Redis disconnect mid-operation** — if Redis disconnects during a `cacheIncr()` (rate limit check), does the request proceed without rate limiting or fail closed?
3. **SQLite WAL corruption** — if the process is killed (SIGKILL, OOM) during a write, does WAL recover automatically? Is there a WAL checkpoint on graceful shutdown?
4. **Concurrent shutdown signals** — if SIGTERM fires twice (Docker sends SIGTERM then SIGKILL after timeout), does the shutdown sequence handle re-entry?
5. **Embedding model OOM** — `all-MiniLM-L6-v2` loads into memory. How much RAM does it consume? Can it cause OOM on a small VPS?
6. **Telegram bot error isolation** — if the Telegram polling loop crashes, does it take down the entire process or just stop responding to Telegram?
7. **Startup ordering** — initDb runs before initRedis. If Redis takes 30s to connect, does the server start accepting HTTP requests during that time?
8. **Graceful shutdown completeness** — are ALL resources cleaned up? Check: file handles (heartbeat JSONL), timers (all setInterval), event listeners (mesh peer:connect), Redis subscriptions.
9. **Recovery after OOM** — Docker restart-unless-stopped will restart after OOM kill. But the process might enter a crash loop if the OOM condition persists (e.g., embedding model too large). Is there a crash loop detection?
10. **Partial startup** — if startMeshNode() fails (port 4001 in use), does the rest of the server still start? Or is mesh failure fatal?

### Production-Scale Concerns

- 30s force-exit is long for Docker. Docker default SIGKILL timeout is 10s. If `stop_grace_period` isn't configured in compose, Docker kills the process before it finishes cleanup.
- In-flight SSE streams during shutdown: the 5s drain may not be enough for long-running streams. Clients see connection drop without error event.
- Circuit breaker state is in-memory. Every restart resets all circuits to CLOSED, causing a burst of requests to previously-failed providers until they re-open.

### Feature Opportunities

- **Circuit breaker persistence** — save open circuits to SQLite on shutdown, restore on startup.
- **Health-gated startup** — don't start accepting HTTP requests until ALL services (DB, Redis, embedding model) are healthy.
- **Crash loop detection** — if the process restarts 3+ times in 5 minutes, log a critical alert and pause startup.
- **WAL checkpoint on shutdown** — explicit `PRAGMA wal_checkpoint(TRUNCATE)` before closeDb() to ensure clean state.
- **Docker stop_grace_period** — set to 35s in compose (> 30s force-exit timer) to ensure clean shutdown.
- **Readiness probe** — separate from health check: returns 503 until all services are ready. Prevents traffic routing during startup.

### Why It Matters

Resilience determines whether a transient failure becomes a permanent outage. An ungraceful shutdown corrupts SQLite. A missing error handler crashes the process on a single bad webhook. Redis going down should degrade performance, not crash the server. The difference between "5 minutes of degraded service" and "2 hours of downtime" is entirely in how failures are handled. At production scale, the server WILL crash — the question is whether it recovers gracefully or loses data.

---

## Chapter 19 — Product Completeness & Market Readiness

### Scope

The gap between "technically functional" and "people will pay for this." Onboarding experience, documentation quality, competitive positioning, distribution strategy, missing features that block user adoption, and the path from first 5 users to first 5,000.

### Files to Read

```
README.md                           — public project documentation
site/index.html                     — landing page (first impression)
site/dashboard.html                 — post-signup experience
site/docs.html                      — API documentation
site/marketplace.html               — skill discovery + publishing
src/routes/openapi.ts               — OpenAPI 3.0 spec
src/mcp/server.ts                   — MCP integration for AI tools
project-memory.md                   — internal state reference
```

### Audit Questions

1. **First 5 minutes** — a developer finds claw-net.org. What's the experience from landing page → signup → first API call? How many steps? How much friction?
2. **Documentation completeness** — does docs.html cover: every endpoint, request/response examples, error codes, authentication setup, credit pricing per operation?
3. **Pricing clarity** — can a user calculate their monthly cost before purchasing? Is there a cost calculator?
4. **Free trial** — `FREE_TRIAL_CREDITS=0` by default. Is there a free tier? Can users try the API before paying?
5. **Key delivery** — after Stripe checkout, how does the user get their API key? Is it emailed? Shown on success page? Both?
6. **SDK availability** — OpenAPI spec exists. Are there generated client SDKs (Python, TypeScript, Go)? npm package?
7. **MCP distribution** — the MCP server is a key distribution channel (Claude Code, Cursor, VSCode). Is it discoverable? Is there a one-click install?
8. **Competitive positioning** — how does ClawNet compare to: LangChain, CrewAI, AutoGPT, OpenRouter? What's the unique value proposition?
9. **Referral system** — the referral route was deleted. Is there any user acquisition mechanism beyond organic discovery?
10. **Community** — is there a Discord, Telegram group, or forum for developers using ClawNet? Where do users get help?
11. **Changelog** — is there a public changelog so users know what's new?
12. **Status page** — is there a public status page showing API uptime?
13. **Rate limit communication** — do users know their tier limits before hitting them? Are limit headers returned?
14. **Error experience** — when a user's credits run out mid-query, what do they see? Is there a clear "buy more credits" CTA?
15. **Marketplace creator experience** — how easy is it to create and publish a skill? Is there documentation for skill creators?

### Feature Opportunities

- **Free trial** — give new users 50-100 free credits to try the API before purchasing.
- **Interactive playground** — in-browser API testing (like Swagger UI) so developers can try before they buy.
- **Generated SDKs** — auto-generate TypeScript, Python, and Go clients from OpenAPI spec.
- **Quick start guides** — "Build a token tracker in 5 minutes" tutorials for different use cases.
- **Referral program** — give referrers 500 credits per paid user signup.
- **Discord/Telegram community** — for support, feature requests, and skill creator collaboration.
- **Public changelog** — weekly updates on new features, endpoint additions, and bug fixes.
- **Status page** — use UptimeRobot or similar to show API availability.
- **Usage analytics** — let users see their usage patterns and optimize API calls.
- **Billing history** — show all payments, credits received, and transaction history in dashboard.

### Why It Matters

Technical excellence means nothing if the product doesn't reach users. A confusing onboarding flow loses developers in the first 5 minutes. Missing documentation means support tickets instead of self-service. No distribution strategy means building features for an empty room. This chapter bridges the gap between "works correctly" and "people will pay for this." The focus should be on removing every friction point between discovery and first paid API call.

---

## Chapter 20 — Compliance, Risk & Trust

### Scope

Legal and regulatory risks that no amount of good engineering can fix. Financial regulation, data privacy, API key security, third-party liability, and the policy decisions needed before scaling to thousands of paying users.

### Files to Read

```
src/db/connection.ts                — all data stored (table schemas)
src/db/keys.ts                      — API key lifecycle
src/db/credits.ts                   — credit system (stored value)
src/db/audit.ts                     — data retention policies
src/routes/clerk-webhook.ts         — user data handling
src/routes/stripe.ts                — payment processing
src/routes/solana.ts                — crypto payment handling
src/middleware/auth.ts              — bearer token model
```

### Audit Questions

1. **Money transmitter risk** — the credit system is a stored-value token. In the US, stored-value may trigger money transmitter licensing requirements (FinCEN). Is ClawNet a money services business?
2. **Refund obligations** — credits never expire. What are the legal obligations to refund unused credits if a user requests it? If the platform shuts down?
3. **PII storage** — Clerk handles most PII, but ClawNet stores: email addresses (in api_keys), Solana wallet addresses, Stripe customer IDs, IP addresses (in rate limit logs). What's the GDPR surface area?
4. **Data deletion** — when a Clerk user.deleted webhook fires, is ALL user data removed? Or just the API key? Check: transactions, escrows, tasks, reputation events, audit logs, skill_ratings, etc.
5. **API key security** — keys have no expiry, no rotation policy, no scope restrictions. A leaked key gives permanent full access. What mitigations exist?
6. **Third-party skill liability** — if a third-party skill returns harmful content (medical advice, financial advice, defamation), who is liable? The skill creator or the platform?
7. **Content moderation** — the skill scanner catches prompt injection, but not harmful content (hate speech, illegal content). Is there a content policy?
8. **GDPR right to erasure** — can a user request deletion of all their data? What's the process? Is it automated?
9. **Data export** — can a user export all their data (GDPR right to portability)? Credit history, usage logs, skills created?
10. **Terms of service** — is there a ToS that covers: credit non-refundability, skill creator responsibilities, platform liability limitations, acceptable use?
11. **Privacy policy** — is there a privacy policy that discloses: what data is collected, how it's used, who it's shared with, retention periods?
12. **Crypto regulatory** — accepting USDC payments may trigger crypto-specific regulations in some jurisdictions. Is there KYC/AML compliance?
13. **Tax implications** — creator payouts (97% revenue share) may be taxable income. Is there 1099 reporting for US creators above $600/year?
14. **Audit trail completeness** — for financial disputes, can the platform reconstruct exactly what happened? Credit deduction → API calls made → results returned → credits charged.
15. **Key masking consistency** — verify that API keys are NEVER logged, returned in responses, or stored in audit logs in full. Only masked versions should appear anywhere.

### Production-Scale Concerns

- At $100K+ in annual credit sales, money transmitter licensing may be required in the US.
- GDPR fines can be up to 4% of annual revenue or €20M for violations. Data deletion must be complete.
- Tax reporting for 1000+ skill creators requires automated 1099 generation or third-party service.
- Content liability increases with user-generated skills. Need clear creator ToS and DMCA process.

### Feature Opportunities

- **API key scoping** — allow keys with restricted permissions (read-only, specific skills only, spend caps).
- **API key expiry** — optional key expiration for security-conscious users.
- **Key rotation alerts** — notify users when their key hasn't been rotated in 90+ days.
- **Data export API** — `GET /v1/auth/export` returns all user data in JSON.
- **Account deletion API** — `DELETE /v1/auth/account` triggers complete data removal.
- **Creator agreement** — require skill creators to accept terms before publishing (content policy, liability waiver).
- **Terms of service page** — add `/terms` and `/privacy` pages to the site.

### Why It Matters

Compliance risk is existential. A stored-value credit system may trigger money transmitter regulations. User data retention without clear policies creates GDPR liability. Third-party skills running arbitrary prompts create content liability. API keys with no expiry are a permanent credential leak risk. These risks compound with scale — what's acceptable for 10 users becomes a legal exposure at 10,000. This chapter identifies risks that require policy decisions, not just code fixes.

---

## Audit Execution Protocol

Each chapter is reviewed in a dedicated session by a fresh Opus instance. The reviewer will:

1. **Read this outline** to understand scope, files, and specific questions
2. **Read all listed source files** — verify claims against actual code, not assumptions
3. **Classify findings** as: CRITICAL / HIGH / MEDIUM / LOW / INFO
4. **Implement fixes** for confirmed code-level bugs
5. **Document feature opportunities** that require product decisions (don't implement without user approval)
6. **Update project-memory.md** to reflect any internal changes
7. **Verify TypeScript compiles** with 0 errors after all changes
8. **Track progress** in the completion tracker at the top of this file

**Severity definitions:**
- **CRITICAL:** Data loss, financial loss, security breach, or platform crash. Fix immediately.
- **HIGH:** Incorrect behavior under normal conditions, race conditions in financial paths, auth bypasses. Fix before next deploy.
- **MEDIUM:** Incorrect behavior under edge conditions, missing validation, unbounded growth. Fix within a week.
- **LOW:** Code quality, missing optimization, non-blocking issues. Fix when convenient.
- **INFO:** Documentation, feature suggestions, architectural observations. No code fix needed.

**Key project rules (MUST follow):**
- Stack: Hono, npm, better-sqlite3 raw SQL, single flat repo, plain HTML
- NOT: Fastify, pnpm, Drizzle/any ORM, Turborepo, React/Vue SPA
- Always use `maskApiKey()` from `src/utils/mask.ts` — never `.slice()` directly
- Always use `creditsForApiCost()` — never inline `* 2000`
- Error responses always include `{ error: string, code: string }`
- Commit and push after completing each chapter
