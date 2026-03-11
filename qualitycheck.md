# ClawNet — Production Quality Check

> Full system audit for real-world readiness. Every finding has exact file/line references.
> Go through each chunk file sequentially — each one is a focused fix session.

---

## Chunk Overview

| # | Chunk | Severity | Scope | Est. Fixes |
|---|-------|----------|-------|-----------|
| 1 | ✅ Financial Integrity | CRITICAL | Money flow, credits, refunds, revenue share | 7 |
| 2 | ✅ Auth & Access Control | CRITICAL | Admin auth, rate limits, key exposure | 8 |
| 3 | ✅ Database & Performance | HIGH | Column bugs, missing indexes, query perf | 6 |
| 4 | ✅ Concurrency & Atomicity | HIGH | Race conditions, cron guards, transactions | 7 |
| 5 | LLM Pipeline Safety | HIGH | Prompt injection, cache corruption, scanning | 6 |
| 6 | Resource Management | MEDIUM | Memory leaks, cleanup, shutdown | 6 |
| 7 | API Robustness | MEDIUM | Error handling, validation, response consistency | 8 |
| 8 | Real-World Hardening | MEDIUM | Production gaps, observability, resilience | 6 |

---

## Chunk 1 — Financial Integrity

Money is the #1 thing that must be bulletproof. These bugs can cause real dollar losses.

### 1.1 CRITICAL — Treasury Fee Silent Loss
**File:** `src/db/index.ts:1654-1656`
**Bug:** `marketplacePurchase()` credits treasury but never checks if the UPDATE succeeded. If `clawhub-treasury` key is inactive or missing, fee credits vanish silently — no error, no log.
**Contrast:** Seller credit path (line 1649) correctly throws on `result.changes === 0`.
**Fix:** Add `result.changes` check after treasury UPDATE, throw if 0.

### 1.2 CRITICAL — Stripe Webhook Idempotency Race Condition
**File:** `src/routes/stripe.ts:253-282`
**Bug:** Pre-flight `isStripeEventProcessed()` check at line 253 happens BEFORE the transaction at line 279. Two concurrent webhook deliveries both pass the pre-flight check, both enter the transaction, both INSERT OR IGNORE, both call `topUpCredits()` — credits doubled.
**Fix:** Remove the pre-flight check entirely. The INSERT OR IGNORE inside the transaction is sufficient.

### 1.3 HIGH — Solana Signature Claim Not Atomic With Credit Grant
**File:** `src/routes/solana.ts:87-204`
**Bug:** `tryClaimSolanaSignature()` at line 90 locks the signature, but credit grant happens in a separate DB transaction at line 193. If process crashes between claim and credit grant, signature is permanently locked but user never receives credits.
**Fix:** Move signature claim inside the credit grant transaction so both are atomic.

### 1.4 HIGH — Marketplace Refund Failure Not Checked
**File:** `src/routes/marketplace.ts:295-311`
**Bug:** When skill execution fails after purchase, `marketplaceRefund()` is called but its return value (`{ ok, error }`) is not checked. If refund fails (DB error, treasury inactive), buyer is charged but told "refunded" in the response.
**Fix:** Check `refund.ok` before responding; if false, log CRITICAL and return honest error.

### 1.5 HIGH — Marketplace Refund Swallows Errors
**File:** `src/db/index.ts:1716-1718`
**Bug:** `marketplaceRefund()` catches all errors but returns `{ ok: false }` with no message. Debugging production refund failures is impossible.
**Fix:** Return `{ ok: false, error: (err as Error).message }` and log the error.

### 1.6 MEDIUM — Batch Queries Partial Billing
**File:** `src/routes/batch.ts:99-144`
**Bug:** Credits are deducted per-query inside `Promise.all()`. If queries 1-5 succeed but query 6 fails due to insufficient credits, user is partially billed with no clear accounting.
**Fix:** Estimate total cost upfront and deduct in one transaction before execution. Refund unused portion after.

### 1.7 MEDIUM — Skill Revenue Share Ambiguity
**File:** `src/routes/skills.ts:508-525`
**Bug:** `actualCost` is calculated from API costs with markup, then `MAX(actualCost, skill.credit_cost)` determines charge. But author share is always based on the charged amount — if skill price is artificially high, author gets overpaid relative to actual API cost consumed.
**Impact:** Not a bug per se, but a policy decision that should be explicit and documented.

---

## Chunk 2 — Auth & Access Control

Auth inconsistencies are the fastest path to a breach.

### 2.1 CRITICAL — Inconsistent Admin Auth Patterns
**Files:** `src/routes/stripe.ts:37`, `src/routes/admin.ts:22-27`, `src/routes/marketplace.ts:657`
**Bug:** Three different admin auth patterns:
- `stripe.ts` webhook handlers have NO auth (relies on Stripe signature — correct for webhooks, but verify signature is actually checked)
- `admin.ts` uses `X-Admin-Key` header with timing-safe comparison (correct)
- `marketplace.ts` line 657: admin feature toggle checks `X-Admin-Key` OR `X-API-Key` — any valid API key holder can toggle featured skills
**Fix:** Enforce admin-only auth on all admin endpoints. Remove `X-API-Key` fallback from admin routes.

### 2.2 HIGH — Clerk Webhook Free Trial No Rate Limit
**File:** `src/routes/clerk-webhook.ts:82-128`
**Bug:** If `FREE_TRIAL_CREDITS > 0`, webhook creates API key with trial credits. No limit on Clerk account creation — attacker creates hundreds of accounts, each gets free credits.
**Impact:** Currently safe because `FREE_TRIAL_CREDITS=0` default, but if ever enabled, it's instantly exploitable.
**Fix:** Add per-IP rate limit on webhook endpoint, or per-Clerk-org daily creation cap.

### 2.3 HIGH — MCP Server No Rate Limiting
**File:** `src/mcp/server.ts:64-306`
**Bug:** MCP tool calls have no rate limiting. If `CLAWNET_API_KEY` is set in Claude Desktop config, any Claude session can make unlimited skill invocations.
**Fix:** Implement per-key rate limits in MCP tools (reuse existing rate-limit logic).

### 2.4 MEDIUM — Dashboard Claim-Session Brute Force
**File:** `src/routes/dashboard.ts:139-174`
**Bug:** `claim-session` endpoint validates format but has no rate limit on claim attempts. Attacker can brute-force valid session IDs.
**Fix:** Add rate limit: max 5 claim attempts per IP per minute.

### 2.5 MEDIUM — API Key Masking Leaks Key Length
**File:** `src/utils/mask.ts:2-5`
**Bug:** Keys shorter than 8 chars return `••••••••` (8 bullets). Pattern: `key.slice(0,4) + '••••' + key.slice(-4)` — for a 6-char key, first4 and last4 overlap, leaking the entire key.
**Fix:** Return fixed-width mask regardless of key length. Add guard: `if (key.length < 12) return '••••••••••••'`.

### 2.6 MEDIUM — Dashboard Duplicates maskApiKey()
**File:** `src/routes/dashboard.ts:17-22`
**Bug:** Inlines its own `maskApiKey()` instead of importing from `src/utils/mask.ts`. If one changes, the other doesn't — maintenance hazard.
**Fix:** Import from `src/utils/mask.ts`.

### 2.7 LOW — LLM Model ID Echoed in Error
**File:** `src/routes/llm.ts:130-134`
**Bug:** Error response echoes user-supplied model name. Not XSS-able in JSON, but information disclosure pattern.
**Fix:** Return generic "Unknown model" without echoing input.

### 2.8 LOW — Registry Allows Large Result Sets
**File:** `src/routes/registry.ts:22-50`
**Bug:** `limit` param allows up to 500. With 163 endpoints, `?limit=500` returns ~150KB JSON per request.
**Fix:** Cap at 100, add pagination.

---

## Chunk 3 — Database & Performance

Bugs that cause silent data loss or degrade performance over time.

### 3.1 CRITICAL — Column Name Mismatch in Cleanup
**File:** `src/db/index.ts:2220`
**Bug:** `cleanupOldSkillMetrics()` queries `WHERE recorded_at < ...` but the `skill_metrics` table (line 217) uses column `timestamp`. Cleanup deletes zero rows → table grows unbounded → disk exhaustion.
**Fix:** Change `recorded_at` to `timestamp` on line 2220.

### 3.2 MEDIUM — Missing Index on skill_metrics(timestamp)
**File:** `src/db/index.ts:220-222`
**Bug:** Cleanup query `DELETE FROM skill_metrics WHERE timestamp < ...` does a full table scan. No index on `timestamp`.
**Fix:** Add migration: `CREATE INDEX IF NOT EXISTS idx_skill_metrics_timestamp ON skill_metrics(timestamp)`.

### 3.3 MEDIUM — Missing Index on audit_log(timestamp)
**File:** `src/db/index.ts:362, 2213`
**Bug:** `cleanupOldAuditLogs()` filters by `timestamp` with no index. Same full-scan problem.
**Fix:** Add migration: `CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`.

### 3.4 MEDIUM — Missing Index on solana_signatures Cleanup
**File:** `src/db/index.ts` (cleanupOldSolanaSigs)
**Bug:** Same pattern — cleanup by timestamp without index.
**Fix:** Add index on the timestamp column used for cleanup.

### 3.5 LOW — endpoint_health Table No Primary Key Guard
**File:** `src/db/index.ts:409`
**Bug:** Potential for duplicate endpoint_health rows if insert logic doesn't use INSERT OR REPLACE.
**Fix:** Verify INSERT OR REPLACE is used, or add UNIQUE constraint.

### 3.6 LOW — Stale Synthesis Cache After Skill Update
**File:** `src/core/seed-skills.ts:403-437`, `src/core/formatter.ts:38-46`
**Bug:** When official skills are updated (prompt changes), synthesis cache key doesn't include skill version. Old cached analyses persist for 10 min.
**Fix:** Include skill version or prompt hash in synthesis cache key.

---

## Chunk 4 — Concurrency & Atomicity

Race conditions that can cause data corruption under load.

### 4.1 HIGH — Escrow Cron Permanent Lockout
**File:** `src/core/escrow-cron.ts:22-60`
**Bug:** If `runExpiryCheck()` throws before `_running = false`, the flag stays true forever. All subsequent cron invocations silently skip. Escrow processing stops until restart.
**Fix:** Ensure `_running = false` is in a `finally` block.

### 4.2 HIGH — Skill A/B Cron Non-Atomic Promotion
**File:** `src/core/skill-ab-cron.ts:75-78`
**Bug:** Two sequential DB updates (clear challenger, deactivate old) without a transaction. Crash between them leaves orphaned active challenger skill with no parent reference.
**Fix:** Wrap both updates in `getDb().transaction(() => { ... })()`.

### 4.3 MEDIUM — Stripe Subscription Rollover TOCTOU
**File:** `src/routes/stripe.ts:286-293`
**Bug:** Balance read and credit add happen inside transaction (safe in better-sqlite3 synchronous mode), BUT the pre-flight check at line 253 outside the transaction creates a TOCTOU window.
**Note:** This overlaps with 1.2 — removing the pre-flight check fixes both.

### 4.4 MEDIUM — Escrow Double-Release Possible
**File:** `src/routes/escrow.ts:94-215`
**Bug:** `releaseEscrow()` transitions WORK_IN_PROGRESS→COMPLETED. If called twice rapidly, second call may enter the function before DB state reflects first call's COMPLETED state.
**Fix:** Add explicit `SELECT ... FOR UPDATE`-equivalent check inside the transaction (better-sqlite3 is single-threaded so this is safe, but verify the state check is inside the transaction).

### 4.5 MEDIUM — Embeddings Backoff Counter Never Resets
**File:** `src/core/embeddings.ts:15-21`
**Bug:** `_failCount` increments on failure but is never reset on success. After transient failures resolve, backoff delay persists permanently (capped at 30s).
**Fix:** Reset `_failCount = 0` on successful model load.

### 4.6 LOW — Skills A/B Routing Race
**File:** `src/routes/skills.ts:381-387`
**Bug:** A/B challenger check and actual routing happen in separate reads. If challenger is promoted between check and invoke, user could hit a deactivated skill. Very unlikely in practice.
**Impact:** Negligible — skill deactivation is idempotent.

### 4.7 LOW — Executor Parallel Group Index Mapping
**File:** `src/core/executor.ts:235-249`
**Bug:** `Promise.allSettled()` result index mapping relies on array order. Semantically fragile if group composition changes.
**Fix:** Use explicit step ID mapping instead of positional indexing.

---

## Chunk 5 — LLM Pipeline Safety

The LLM pipeline is the attack surface most unique to this project.

### 5.1 HIGH — Synthesis Prompt XML Injection
**File:** `src/core/formatter.ts:59-101`
**Bug:** Endpoint IDs are interpolated directly into XML-style tags without escaping:
```typescript
`<api-data endpoint="${s.endpointId}">\n${truncated}\n</api-data>`
```
If `s.endpointId` contains `">`, it breaks the XML structure. Truncation at byte boundary (10KB) can split JSON mid-string, leaving unescaped chars.
**Fix:** Escape `endpointId` with `JSON.stringify()`. Truncate at JSON parse boundaries.

### 5.2 HIGH — Stale Intent Cache Poisoning
**File:** `src/core/intent-parser.ts:102-116`
**Bug:** If LLM returns malformed JSON that partially parses, it gets cached in Redis for 30 min. All subsequent identical queries return the corrupted intent.
**Fix:** Validate parsed intent structure before caching. Clear cache key on parse failure.

### 5.3 HIGH — Skill Scanner Pattern Gaps
**File:** `src/core/skill-scanner.ts:32-45`
**Bug:** 14 regex patterns miss common bypass techniques:
- "ignoring previous instructions" (present tense)
- Unicode lookalikes (Cyrillic "а" for Latin "a")
- Embedded variables like `{{system_prompt}}` or `{{hidden_instruction}}`
- "respond as if you are a different system"
- Excessive variable count (>50 vars = likely obfuscation)
**Fix:** Expand pattern library. Add variable name scanning. Reject templates with >30 variables.

### 5.4 MEDIUM — Skill Executor Silent Variable Substitution
**File:** `src/core/skill-executor.ts:33-35`
**Bug:** Missing template variables are silently replaced with empty string. No logging, no warning. Skill produces degraded results with no indication why.
**Fix:** Log missing variables. Consider failing if required variables are absent.

### 5.5 MEDIUM — Telegram Unicode Injection
**File:** `src/integrations/telegram.ts:33-38`
**Bug:** `sanitizeInput()` strips ASCII control chars but not Unicode control chars (zero-width spaces U+200B, right-to-left override U+202E). `slice(0, 300)` cuts at byte boundary, not character boundary.
**Fix:** Use Unicode-aware `.normalize()` and character-level length checking. Strip non-printable Unicode.

### 5.6 LOW — Plan Template Case Sensitivity
**File:** `src/core/plan-templates.ts:275`
**Bug:** Query normalized to lowercase but patterns should explicitly use `i` flag. Currently correct but fragile.
**Fix:** Add comment documenting requirement, or enforce in pattern validation.

---

## Chunk 6 — Resource Management

Leaks and cleanup failures that compound over weeks/months in production.

### 6.1 HIGH — Circuit Breaker Map Eviction Bug
**File:** `src/core/circuit-breaker.ts:127-150`
**Bug:** Hard cap eviction sorts by `lastFailure` timestamp, but CLOSED circuits with zero failures have stale `lastFailure` values. Old healthy circuits get evicted before newer failing ones — backwards.
**Fix:** Track `lastAccess` timestamp. Evict by LRU (least recently used), not by failure time.

### 6.2 HIGH — Mesh Node Event Listener Leak
**File:** `src/mesh/node.ts:59-72`
**Bug:** `startMeshNode()` adds a `peer:connect` listener but doesn't remove old ones on restart. Multiple calls accumulate orphaned listeners.
**Fix:** Remove existing listener before adding new one. Store reference for cleanup.

### 6.3 MEDIUM — Telegram Dead Subscriber Accumulation
**File:** `src/integrations/telegram.ts:603-623`
**Bug:** `broadcastBatched()` collects failed chatIds and removes them, but if `removeTelegramSubscriber()` throws (DB error), the exception is uncaught and removal stops.
**Fix:** Wrap removal in try/catch, continue removing remaining dead subscribers.

### 6.4 MEDIUM — Heartbeat File Rotation Failure
**File:** `src/core/heartbeat.ts:17-28`
**Bug:** If file rotation fails, only a warning is logged. File grows unbounded. No escalation after repeated failures.
**Fix:** Track consecutive rotation failures. After N failures, stop writing (prevent disk exhaustion).

### 6.5 MEDIUM — Shutdown Redis Hang
**File:** `src/utils/shutdown.ts:62-69`
**Bug:** `closeRedis()` is awaited with no timeout. If Redis is frozen, shutdown hangs past the 30s force timer, potentially corrupting SQLite state.
**Fix:** Add 5-second timeout: `await Promise.race([closeRedis(), sleep(5000)])`.

### 6.6 LOW — Logger Redaction Incomplete
**File:** `src/utils/logger.ts:8`
**Bug:** Redaction paths miss nested patterns like `response.body.api_key`, `data.*.secret`. Secrets could leak in error logs.
**Fix:** Add broader redaction patterns: `*.apiKey`, `*.api_key`, `data.*.secret`.

---

## Chunk 7 — API Robustness

Making every endpoint behave correctly under all conditions.

### 7.1 MEDIUM — Streaming Credits Pre-Check Too Loose
**File:** `src/routes/stream.ts:38-87`
**Bug:** Pre-check only requires `credits >= 1`. If execution costs 100 credits and user has 50, the SSE stream is already opened (HTTP 200 sent) before deduction fails. Client receives partial data then error event.
**Fix:** Estimate cost before opening stream. Return 402 if insufficient.

### 7.2 MEDIUM — Governance Vote Weight No Input Guard
**File:** `src/routes/governance.ts:106-118`
**Bug:** `Math.sqrt(spent)` with no check for negative values. Shouldn't happen via normal paths, but a DB corruption or manual edit could cause NaN propagation.
**Fix:** Add `Math.max(0, spent)` before sqrt.

### 7.3 MEDIUM — Swarm LLM Decomposition Unvalidated
**File:** `src/routes/swarm.ts:113-134`
**Bug:** LLM returns JSON with `skillId` fields. Invalid skill IDs are silently filtered out, not errored. If LLM hallucinates all skill IDs, user gets an empty swarm result with credits already deducted.
**Fix:** If zero valid subtasks after filtering, refund SWARM_BASE_FEE and return error.

### 7.4 MEDIUM — Contact Form Email Fire-and-Forget
**File:** `src/routes/contact.ts:121-175`
**Bug:** Email sends use `.catch()` without `await` (fire-and-forget). Both admin notification and user confirmation can fail silently. User gets 200 OK with no email sent.
**Fix:** Await at least the user confirmation email. Return warning if it fails.

### 7.5 LOW — Discovery Engine P2P Matching Quality
**File:** `src/core/discovery-engine.ts:51-83`
**Bug:** Word matching is naive substring — "token" won't match "tokens", single-char words inflate scores. No TF-IDF or stemming.
**Impact:** Poor P2P discovery results. 25% of trinity score may be low quality.
**Fix:** Add basic stemming (porter-stemmer) or use trigram matching. Filter stopwords.

### 7.6 LOW — Contact Honeypot Check Logic
**File:** `src/routes/contact.ts:101-105`
**Bug:** Honeypot fires on `data.website && data.website.length > 0`. Schema is `z.string().optional()`. Works correctly (truthy check), but should be more explicit.
**Fix:** No change needed — verify in test.

### 7.7 LOW — Marketplace Price Immutability Not DB-Enforced
**File:** `src/routes/marketplace.ts`
**Bug:** No UPDATE endpoint for `credit_cost` (good), but no DB trigger or constraint prevents manual updates. Policy-enforced, not schema-enforced.
**Fix:** Document this as intentional. Consider adding a DB trigger if admin DB access is a concern.

### 7.8 LOW — OpenAPI Spec Completeness
**File:** `src/routes/openapi.ts`
**Bug:** Verify all 27+ route files are represented in the spec. Missing endpoints = invisible to SDK generators.
**Fix:** Audit spec against actual routes, add any missing.

---

## Chunk 8 — Real-World Hardening

Final production readiness gaps that separate "works in dev" from "works at scale."

### 8.1 MEDIUM — No Health Check Endpoint
**Impact:** Load balancers, uptime monitors, and container orchestrators need a lightweight health probe. Currently must use `GET /v1/registry` or similar heavyweight endpoint.
**Fix:** Add `GET /health` — returns 200 with `{ status: 'ok', uptime, dbConnected, redisConnected }`. No auth required.

### 8.2 MEDIUM — No Request Timeout Middleware
**Impact:** A slow LLM call or hung upstream API can hold a connection open indefinitely. Under load, this exhausts the connection pool.
**Fix:** Add global 30s request timeout middleware. LLM calls already have per-call timeouts, but the HTTP connection itself needs a hard cap.

### 8.3 MEDIUM — No Structured Error Responses
**Impact:** Error responses are inconsistent — some return `{ error: string }`, some `{ ok: false, error }`, some throw raw 500s. Clients can't reliably parse errors.
**Fix:** Standardize all error responses to `{ ok: false, error: string, code?: string }`. Add error middleware.

### 8.4 MEDIUM — Missing CORS Origin Restriction
**Impact:** If CORS is set to `*`, any website can make API calls on behalf of authenticated users (CSRF with cookies/headers). Verify CORS config restricts to known origins.
**Fix:** Set `origin` to `['https://claw-net.org']` in production.

### 8.5 LOW — No Graceful Drain on Deploy
**Impact:** During deploy, in-flight requests get killed. Container stops immediately.
**Fix:** Shutdown handler already has 5s drain, but verify Docker sends SIGTERM (not SIGKILL) and `stop_grace_period` is set in docker-compose.

### 8.6 LOW — SQLite Backup Strategy
**Impact:** SQLite file is the single source of truth. No backup = total data loss on disk failure.
**Fix:** Add daily `.backup()` call to a mounted volume or S3. SQLite's online backup API is safe during writes.

---

## Execution Order

1. **Chunk 1 (Financial)** — Fix money bugs FIRST. Every day these exist is potential revenue loss.
2. **Chunk 3 (Database)** — The column mismatch bug (3.1) is causing silent data growth NOW.
3. **Chunk 2 (Auth)** — Admin auth inconsistency (2.1) is the highest security risk.
4. **Chunk 4 (Concurrency)** — Cron lockout bugs (4.1, 4.2) cause silent system degradation.
5. **Chunk 5 (LLM Safety)** — Prompt injection (5.1) is exploitable by malicious API data.
6. **Chunk 6 (Resources)** — Memory leaks (6.1, 6.2) compound over days/weeks.
7. **Chunk 7 (API)** — Robustness fixes improve client experience.
8. **Chunk 8 (Hardening)** — Final production polish.
