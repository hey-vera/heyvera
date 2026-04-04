# ClawNet — CLAUDE.md
Always stage commit push after major changes.
Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (better-sqlite3, raw SQL — no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments, Soma-verified execution. Single-process Node on a VPS.

## Quick Reference

```bash
npm run dev          # Dev mode (tsx watch + .env)
npm run build        # Compile to dist/ (tsc --noCheck)
npm start            # Run compiled dist/index.js
npm run test:unit    # Vitest unit tests
npm run typecheck    # Type check only (no emit)
npm run mcp          # Start MCP server
```

**VPS:** `guardian-vps` (guardian@24.199.121.137), deploy with `deploy` alias.

## Stack Rules (CRITICAL — never deviate)

| Use               | NOT                         |
|-------------------|-----------------------------|
| Hono              | Fastify                     |
| npm               | pnpm                        |
| better-sqlite3    | Drizzle / any ORM           |
| Single flat repo  | Turborepo / monorepo        |
| Plain HTML (site/)| Vite / React SPA            |
| Clerk + Phantom   | Reown AppKit                |
| .env on VPS       | sops / systemd secrets      |
| libp2p + yamux    | @libp2p/node (doesn't exist)|

## Project Structure

```
src/
├── routes/        HTTP endpoints (Hono routers)
├── core/          Business logic, crons, execution engine
├── db/            Domain files re-exported via index.ts barrel
├── utils/         Billing, payouts, masking, shutdown, email, crypto
├── middleware/     Auth (API key, Clerk, admin), rate limit, signing, soma provenance
├── cache/          Smart cache v2 (L1 memory + L2 Redis)
├── integrations/   Telegram bot, ag0, agentkit
├── payments/       x402/MPP/LSAT payment verifiers
├── providers/      LLM (Anthropic/OpenAI), ClawAPIs x402, facilitator pool
├── mcp/            MCP tool server + Soma MCP wrapper
├── config/         Zod env validation, API registry (274+ built-in endpoints)
├── sdk/            @clawnet/sdk TypeScript client
├── mesh/           libp2p DHT node
├── bots/           x-outreach (Twitter/X marketing)
site/              Static HTML website (not in src/)
tests/unit/        Vitest tests (187 passing, 10 files)
```

## API Access (two paths)

**Orchestrated (LLM-routed):** `POST /v1/orchestrate` — natural language query, LLM picks endpoints. 2-credit orchestration fee + endpoint costs. For agents that don't know which endpoint to call.

```
POST /v1/orchestrate → parseIntent(query) → optimizePlan(intent, pricing)
  → executePlan(intent, budget?) → formatResponse() → bill credits
```

- **Budget:** `{ maxCredits?, strategy: cheapest|balanced|fastest|reliable }`
- **Orchestration fee:** 2 credits per query (covers LLM parsing)
- `checkBudget()` returns 402 pre-flight if plan exceeds `maxCredits`

**Direct (no LLM):** `POST /v1/endpoints/:id/call` — call a specific registry endpoint by ID. No orchestration fee, no LLM. Endpoint cost only. For programmatic clients that know exactly which endpoint they want.

```
POST /v1/endpoints/twitsh-tweet-replies/call
  { "params": { "tweetId": "123" } }
→ upstream fetch → cache → bill credits → return data + Soma certificate
```

- **Cache hits** = 10% of live cost (min 0.1cr)
- Returns `provenance` field with Soma birth certificate when heart is active
- `X-Soma-*` headers on response (Data-Hash, Signature, Public-Key, Heartbeat-Index)

## Database Patterns

```typescript
// ALWAYS use getDb() — never store reference
const row = getDb().prepare('SELECT * FROM t WHERE id = ?').get(id);

// Transactions — note double parentheses
getDb().transaction(() => { /* ... */ })();

// Audit trail (fire-and-forget, never crashes caller)
logAudit({ entityType, entityId, action, actorId?, data? });
```

- **122 migrations** in `src/db/connection.ts` (v1–v122)
- **Adding a migration:** append `{ version: 123, sql: 'ALTER TABLE ...' }` to the `MIGRATIONS` array in `connection.ts`. Increment version. Runs automatically on next `initDb()`. No rollback support.
- **Barrel export** at `src/db/index.ts` — import from here, never from domain files directly
- Financial safety triggers on `credits`, `credit_cost`, `amount_credits` columns

## Billing Math (src/core/credits.ts)

```typescript
round6(n)                        // ALWAYS use — prevents floating-point drift
creditCostForEndpoint(ep)        // Explicit creditCost OR round6(max(0.001, cost * 1500))
creditsForExecution(steps, lookup) // Sum of live step costs (0 for cached/failed)
x402SurchargeCredits(usdAmount)  // 1:1 cost recovery → credited to clawhub-treasury
cacheCreditCost(liveCost)        // round6(max(0.1, liveCost * 0.10))
dynamicCreditCost(...)           // Surge (up to 5x) + volume discounts + off-peak
```

- **Credit rate:** CREDITS_PER_USD=1000 → $0.001/credit, fractional supported (min 0.001)
- **Revenue split (skills):** 85% creator / 15% treasury (uses `round6()`, not `Math.floor()`)
- **Revenue split (registry endpoints):** 100% treasury (~33% margin via COST_MARKUP_FACTOR)
- **Deduction guard:** `WHERE credits >= amount` + DB trigger
- **Delegated billing:** auth resolves child→parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` across 20+ billing sites

## Auth (3 layers)

| Layer | Header | Usage |
|-------|--------|-------|
| API Key | `X-API-Key` (cn-...) | Most /v1/* routes (not all — some are public) |
| Clerk | `Authorization: Bearer` | Escrow, user endpoints |
| Admin | `X-Admin-Key` | /v1/admin/* (timing-safe SHA-256) |

**Middleware:** auth, admin-auth, clerk-auth, rate-limit, sign-response, soma-provenance.

## Critical Gotchas

- **`round6()`** — use on ALL credit math, never raw floating-point
- **`maskApiKey()`** from `src/utils/mask.ts` — ALWAYS use, never `.slice()`
- **`trackDelegatedSpend()`** — must be called after every `deductCredit()`
- **x402 surcharge** — MUST credit `clawhub-treasury`, not burn
- **DB imports** — always from `src/db/index.ts`, never domain files directly
- **`clawhub-treasury` + `clawhub-official`** — auto-reactivated on startup
- **Composite skills** — max depth 3, max 10 leaf invocations, BFS cycle detection
- **Per-skill rate limit** — `checkSkillRateLimit()` uses `cacheIncr(key, 3600)`
- **Webhook HMAC** — `X-ClawNet-Signature` + `X-ClawNet-Timestamp` headers
- **Soma: provenance ≠ verification** — birth certificates prove data origin; model verification requires sense on observer side. Never conflate in code or marketing.
- **Soma: never self-verify** — ClawNet runs heart, callers run sense. Heart + sense in same process = self-attestation, not cryptographic verification.

## x402 Payment Layer (src/routes/x402-skills.ts, src/payments/)

Agents can invoke skills via x402 without an account. Payment verified on-chain before execution.

**Flow:** Agent → `POST /x402/skills/:id` (no payment) → 402 + offer → Agent pays → retries with `X-PAYMENT` header → facilitator verifies → execute → response + receipt.

**Facilitator pool:** Coinbase, PayAI, Skyfire — automatic failover with health tracking (60s cooldown).

**x402 client:** `clawApiCall()` in `src/providers/clawapis.ts` — outbound x402 calls to upstream endpoints using Solana wallet.

**x402 MCP transport:** `src/mcp/x402-mcp-transport.ts` — x402-gated MCP tools with payment_hash idempotency.

## Skills Marketplace (src/routes/skills.ts)

Creator-registered high-value services. 85% revenue to creator, 15% to treasury.

**Skill types:**
- **`api_proxy`** — Creator-registered endpoints. The primary marketplace type. Creator runs a service, registers the URL, agents pay to invoke it.
- **`prompt_template`** — LLM-powered skills with template variables and prompt engineering.
- **`composite`** — Multi-step orchestrations chaining other skills (max depth 3, max 5 deps).
- **`data`** — **Deprecated.** Auto-converts to `api_proxy` with `method=GET` on creation. Existing data skills still work.

**Invoke:** `POST /v1/skills/:id/invoke` (credits) or `POST /x402/skills/:id` (on-chain payment, no account needed).

**Not skills:** Raw API registry endpoints (twitsh, cascade, etc.) are called via `POST /v1/endpoints/:id/call`. These are commodity data pipes, 100% treasury revenue. Skills are for high-value creator services.

## Smart Cache v2 (src/cache/)

Three-layer: L1 memory (10k max, LFU eviction) → L2 Redis (gzip >1KB) → agent context (SQLite).

Features: content-hash validation, stale-while-revalidate, adaptive TTL, request coalescing, negative caching (30s), semantic key normalization (SOL↔sol↔Solana), startup preloading, background refresh queue, proportional pricing (10% of live).

## Cron Jobs

| Cron | Interval | What |
|------|----------|------|
| Escrow | periodic | Expire stale escrows |
| Endpoint health | 15m | Ping endpoints, mark DEGRADED |
| Endpoint discovery | 4h | Poll clawapis.com/api/pricing |
| Skill A/B | periodic | A/B test skill variants |
| Stake unlock | periodic | Unlock matured stakes |
| Payout | 4h | Creator payouts + treasury sweep + wallet alerts |
| Skill health | 15m | SLA checks, penalty escalation, trust decay, auto-replace |
| Skill scheduler | 1m | Execute due scheduled skills |
| Cache warming | periodic | Preload popular cache entries |
| Creator notifications | periodic | Email notifications |
| Index sync | periodic | Multi-source endpoint sync (402index, Coinbase, Satring, Cascade, Dexter, x402list) |
| Soma anchor | periodic | Soma verdict Merkle root → Solana memo |
| EAS anchor | periodic | Soma receipt Merkle root → Base EAS timestamp |
| Zauth discovery | 4h | Auto-discover verified x402 endpoints from zauthx402.com |
| Canary | periodic | Canary checks |
| Trust decay | periodic | Rating weight decay (10%/30 days) |

## Route Pattern

```typescript
import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';

const router = new Hono();
router.post('/path', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  return c.json({ ok: true });
});
export { router };

// Error response — always include code
return c.json({ error: 'message', code: 'SNAKE_CASE_CODE' }, 4xx);
```

## 2-Wallet Architecture

| Wallet | Purpose | Env Var |
|--------|---------|---------|
| RECEIVING | Users send USDC | `SOLANA_RECEIVING_WALLET` (public only) |
| HOT WALLET | x402 calls + payouts | `SOLANA_PRIVATE_KEY` = `PLATFORM_PAYOUT_PRIVATE_KEY` |

Treasury sweep optional — with 2-wallet setup, treasury credits are pure profit.

## Key Files

| File | What |
|------|------|
| `src/index.ts` | Server entry, middleware stack, cron startups |
| `src/db/connection.ts` | initDb(), getDb(), 122 migrations, logAudit() |
| `src/db/index.ts` | Barrel export of domain DB files |
| `src/core/credits.ts` | round6(), all billing math |
| `src/core/executor.ts` | executePlan(), circuit breaker, cache, zauth pre-flight |
| `src/core/pricing.ts` | optimizePlan(), checkBudget(), 4 strategies |
| `src/core/composite-executor.ts` | Output piping, parallel, conditionals, depth 3 |
| `src/cache/index.ts` | L1+L2, SWR, coalescing, negative cache |
| `src/core/soma.ts` | Soma Heart singleton, heartLlmComplete(), key bridging, genome |
| `src/providers/clawapis.ts` | x402 client, clawApiCall() + soma birth certificates |
| `src/providers/llm.ts` | llmComplete() — routes through heart.generate() first |
| `src/providers/x402-facilitator.ts` | Facilitator pool (Coinbase/PayAI/Skyfire), failover |
| `src/utils/billing.ts` | trackDelegatedSpend() |
| `src/utils/mask.ts` | maskApiKey() (first4+last4) |
| `src/utils/solana-payout.ts` | sendSolanaUsdc(), balance checks |
| `src/utils/shutdown.ts` | SIGTERM/SIGINT, 15s drain |
| `src/utils/jcs.ts` | Shared JCS + base58btc + Ed25519 validation |
| `src/utils/crypto-agility.ts` | somaHash(), ML-DSA-65 hybrid signing, post-quantum migration |
| `src/utils/eas.ts` | EAS integration: off-chain attestations, schema encoding, batch timestamp |
| `src/core/soma-receipt.ts` | Unified receipt builder for all payment paths |
| `src/core/eas-anchor-cron.ts` | EAS receipt Merkle anchoring on Base |
| `src/routes/api.ts` | POST /v1/orchestrate, GET /v1/estimate |
| `src/routes/endpoints.ts` | GET /v1/endpoints (catalog), POST /v1/endpoints/:id/call (direct invoke) |
| `src/routes/soma.ts` | Soma verdict API: trust, verdicts, export, anchors |
| `src/core/soma-anchor-cron.ts` | Soma verdict Merkle anchoring on Solana |
| `src/db/soma-verdicts.ts` | Soma verdict CRUD, stats, anchor lifecycle |
| `src/middleware/soma-provenance.ts` | X-Soma-* provenance headers on all responses |
| `src/mcp/soma-mcp-wrapper.ts` | Soma MCP identity (genome + X25519 for sense verification) |
| `src/core/zauth-discovery.ts` | Zauth auto-discovery (verified x402 endpoints) |
| `src/routes/x402-skills.ts` | x402 payment-gated skill invocation |
| `src/middleware/auth.ts` | checkApiKey, checkPermission, checkPolicy |
| `flow.md` | System flow document |

## Soma — Identity as Execution (primary identity/verification system)

Soma is the core identity and verification protocol. Proves identity through physics: temporal fingerprinting of model inference + per-token HMAC authentication. You can't fake Claude's inference rhythm without running Claude.

**Soma repo:** `C:\Users\Josh\Desktop\GitHub\Soma` ([github.com/1xmint/Soma](https://github.com/1xmint/Soma))

**Two components:**
- **soma-heart** (agent side) — execution runtime, credential vault, birth certificates, heartbeat chain, per-token HMAC
- **soma-sense** (observer side) — temporal/topology/vocabulary fingerprinting, phenotype atlas, behavioral verdicts (GREEN/AMBER/RED/UNCANNY)

**Strategic direction:** ClawNet makes itself verifiable. ClawNet runs the heart. Callers run the sense (if they want behavioral verification). ClawNet does NOT verify itself — self-verification = self-attestation. The observer must be a separate party.

**On-chain identity:** Three ERC-8004 registrations on Base Mainnet:
- **36119** — ClawNet
- **37696** — Soma protocol
- **36118** — AID Protocol (legacy, abandoned)

### Phase 1 — Data Provenance (built)

ClawNet uses `heart.fetchData()` for outbound x402 API calls. Every call gets a birth certificate (data hash + Ed25519 signature + heartbeat chain entry). This proves "I called this URL, got this data, here's the hash."

**Key bridging:** Derives soma keypair from `PLATFORM_SIGNING_SECRET` via SHA-256 seed (`src/utils/ed25519-signer.ts`).

**Integration points:**
- `src/core/soma.ts` — `initHeart()`, `getHeart()`, `getHeartSafe()`, `destroyHeart()`, `heartLlmComplete()`
- `src/providers/clawapis.ts` — `clawApiCall()` wraps fetch in `heart.fetchData()`, birth certificate via `getLastBirthCertificate()`
- `src/core/executor.ts` — `StepResult.birthCertificate`, `ExecutionResult.birthCertificates`
- `src/routes/api.ts` — `POST /v1/orchestrate` response includes `provenance` field when certificates exist
- `src/routes/well-known.ts` — `GET /.well-known/soma.json` exposes genome, DIDs, heartbeat chain status
- `src/middleware/soma-provenance.ts` — `X-Soma-*` headers on all orchestration + x402 responses

### Phase 2 — Model Verification (built)

ClawNet's own LLM calls (`parseIntent()`, `formatResponse()`, etc.) route through `heart.generate()` via `heartLlmComplete()`. Every `llmComplete()` call tries the heart first, falls back to direct SDK if unavailable.

This gives ClawNet's internal LLM calls:
- Per-token HMAC authentication (cryptographic proof per token)
- Heartbeat chain entries (tamper-evident computation log)
- Generation provenance in response headers (`X-Soma-Model-Verified`, `X-Soma-Token-Count`, etc.)

**MCP verification:** `src/mcp/soma-mcp-wrapper.ts` embeds Soma metadata (genome commitment + ephemeral X25519 public key) in MCP initialize response. Callers running soma-sense can verify via encrypted channel.

**Key distinction:** Data provenance (birth certificates) ≠ model verification (sense verdicts). Never conflate them.

### Phase 3 — On-Chain Anchored Verdicts (built)

Soma verdict infrastructure anchors verification outcomes on-chain via Merkle trees + Solana memo.

**DB tables (v122 migration):** `soma_verdicts`, `soma_verdict_stats`, `soma_verdict_anchors`
**Domain module:** `src/db/soma-verdicts.ts` — `recordSomaVerdict()`, `getSomaVerdictStats()`, `getRecentSomaVerdicts()`, anchor lifecycle

**Routes (`src/routes/soma.ts`):**
- `POST /v1/soma/verdicts` — submit verdict (Ed25519 signature verified, self-verdicts blocked, dual rate limited by IP + DID)
- `GET  /v1/soma/:did/trust` — public "credit bureau" endpoint (free, no auth)
- `GET  /v1/soma/:did/verdicts` — recent verdicts for an agent
- `GET  /v1/soma/:did/export` — portable trust chain with per-verdict Merkle proofs (rate limited)
- `GET  /v1/soma/anchors/:id` — anchor details (Solana tx hash, tree)

**Cron (`src/core/soma-anchor-cron.ts`):** Periodically builds Merkle tree from unanchored verdicts, sends Solana memo with root. Uses existing `MERKLE_ANCHOR_ENABLED` flag. ~$0.024/day.

### Shared Crypto Primitives

| File | What |
|------|------|
| `src/utils/ed25519-signer.ts` | Deterministic Ed25519 keypair from `PLATFORM_SIGNING_SECRET` |
| `src/utils/jcs.ts` | JCS canonicalization (RFC 8785), base58btc encode/decode |
| `src/utils/crypto-agility.ts` | `somaHash()`, algorithm-agile signing, post-quantum migration path |
| `src/core/merkle-anchor.ts` | Merkle tree build/verify for verdict anchoring |

## Testing

```bash
npm run test:unit           # 187 tests via Vitest (10 test files, all green)
npm run test:unit:coverage  # With coverage
npm run typecheck           # tsc --noEmit (0 errors expected)
```

Tests in `tests/unit/` — credit, escrow, governance, skills, soma verdicts, and more. Use `setupTestDb()` from `tests/unit/helpers/db.ts`.

## Environment

All env vars are Zod-validated in `src/config/index.ts`. See `.env.example` for the full list. Key vars:

- `PORT=3402`, `NODE_ENV`, `LOG_LEVEL`
- `ANTHROPIC_API_KEY`, `LLM_PROVIDER` (anthropic|openai|openclaw)
- `REDIS_URL`, `CACHE_TTL_SECONDS=300`
- `CLERK_SECRET_KEY`, `ADMIN_API_KEY` (required in prod, min 16 chars)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SOLANA_RECEIVING_WALLET`, `SOLANA_PRIVATE_KEY`, `SOLANA_RPC_URL`
- `CREDITS_PER_USD=1000`, `COST_MARKUP_FACTOR=1500`, `ORCHESTRATION_FEE=2`
- `PLATFORM_SIGNING_SECRET` (deterministic Ed25519 key derivation for Soma Heart)
- `X402_RECIPIENT_ADDRESS` (enables x402 payment mode)
- `AG0_DISCOVERY_ENABLED`, `INDEX_SYNC_ENABLED`, `MERKLE_ANCHOR_ENABLED` (feature flags)
- `SENTRY_DSN` (optional), `RESEND_API_KEY` (optional)

## Workflow

Always stage, commit, and push after considerable changes. User SSHs to VPS and types `deploy`.
