# ClawNet — CLAUDE.md

Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (better-sqlite3, raw SQL — no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments. Single-process Node on a VPS.

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

## Project Structure (119 .ts files)

```
src/
├── routes/       (39)  HTTP endpoints (Hono routers)
├── core/         (31)  Business logic, crons, execution engine
├── db/           (17)  15 domain files re-exported via index.ts barrel
├── utils/        (12)  Billing, payouts, masking, shutdown, email
├── cache/         (5)  Smart cache v2 (L1 memory + L2 Redis)
├── middleware/     (5)  Auth (API key, Clerk, admin), rate limit, signing
├── config/        (2)  Zod env validation, API registry (344 endpoints)
├── providers/     (2)  LLM (Anthropic/OpenAI), ClawAPIs x402
├── sdk/           (1)  @clawnet/sdk TypeScript client
├── mcp/           (1)  MCP tool server (6 tools)
├── mesh/          (1)  libp2p DHT node
├── bots/          (1)  x-outreach (Twitter/X marketing)
├── integrations/  (1)  Telegram bot
site/             (17)  Static HTML website (not in src/)
tests/unit/        (4)  Vitest tests (66 passing)
```

## Orchestration Pipeline

```
POST /v1/orchestrate → parseIntent(query) → optimizePlan(intent, pricing)
  → executePlan(intent, budget?) → formatResponse() → bill credits
```

- **Budget:** `{ maxCredits?, strategy: cheapest|balanced|fastest|reliable }`
- **Cache hits** = 0 credits per step; full-query cache = 10% of live cost (min 0.1cr)
- **Orchestration fee:** 2 credits per LLM-routed query (burned, not credited)
- `checkBudget()` returns 402 pre-flight if plan exceeds `maxCredits`

## Database Patterns

```typescript
// ALWAYS use getDb() — never store reference
const row = getDb().prepare('SELECT * FROM t WHERE id = ?').get(id);

// Transactions — note double parentheses
getDb().transaction(() => { /* ... */ })();

// Audit trail (fire-and-forget, never crashes caller)
logAudit({ entityType, entityId, action, actorId?, data? });
```

- **70 migrations** in `src/db/connection.ts`
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
- **Revenue split:** 85% creator / 15% treasury (uses `round6()`, not `Math.floor()`)
- **Deduction guard:** `WHERE credits >= amount` + DB trigger
- **Delegated billing:** auth resolves child→parent, `deductCredit(parent)` then `trackDelegatedSpend(child)` at all 10 billing sites

## Auth (3 layers)

| Layer | Header | Usage |
|-------|--------|-------|
| API Key | `X-API-Key` (cn-...) | All /v1/* routes |
| Clerk | `Authorization: Bearer` | Escrow, user endpoints |
| Admin | `X-Admin-Key` | /v1/admin/* (timing-safe SHA-256) |

## Critical Gotchas

- **`round6()`** — use on ALL credit math, never raw floating-point
- **`maskApiKey()`** from `src/utils/mask.ts` — ALWAYS use, never `.slice()`
- **`trackDelegatedSpend()`** — must be called after every `deductCredit()` (10 sites)
- **x402 surcharge** — MUST credit `clawhub-treasury`, not burn
- **DB imports** — always from `src/db/index.ts`, never domain files directly
- **`clawhub-treasury` + `clawhub-official`** — auto-reactivated on startup
- **Composite skills** — max depth 3, max 10 leaf invocations, BFS cycle detection
- **Per-skill rate limit** — `checkSkillRateLimit()` uses `cacheIncr(key, 3600)`
- **Webhook HMAC** — `X-ClawNet-Signature` + `X-ClawNet-Timestamp` headers

## Smart Cache v2 (src/cache/)

Three-layer: L1 memory (10k max, LFU eviction) → L2 Redis (gzip >1KB) → agent context (SQLite).

Features: content-hash validation, stale-while-revalidate, adaptive TTL, request coalescing, negative caching (30s), semantic key normalization (SOL↔sol↔Solana), startup preloading, background refresh queue, proportional pricing (10% of live).

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
| `src/index.ts` | Server entry, middleware stack, cron startup |
| `src/db/connection.ts` | initDb(), getDb(), 70 migrations, logAudit() |
| `src/db/index.ts` | Barrel export of 17 domain DB files |
| `src/core/credits.ts` | round6(), all billing math |
| `src/core/executor.ts` | executePlan(), circuit breaker, cache |
| `src/core/pricing.ts` | optimizePlan(), checkBudget(), 4 strategies |
| `src/core/composite-executor.ts` | Output piping, parallel, conditionals, depth 3 |
| `src/cache/index.ts` | L1+L2, SWR, coalescing, negative cache |
| `src/utils/billing.ts` | trackDelegatedSpend() |
| `src/utils/mask.ts` | maskApiKey() (first4+••••+last4) |
| `src/utils/solana-payout.ts` | sendSolanaUsdc(), balance checks |
| `src/utils/shutdown.ts` | SIGTERM/SIGINT, 15s drain |
| `src/routes/api.ts` | POST /v1/orchestrate, GET /v1/estimate |
| `flow.md` | 33-section system flow document |

## Testing

```bash
npm run test:unit           # 66 tests via Vitest
npm run test:unit:coverage  # With coverage
npm run typecheck           # tsc --noEmit (0 errors expected)
```

Tests in `tests/unit/` — credit, escrow, governance, skills. Use `setupTestDb()` from `tests/unit/helpers/db.ts`.

## Workflow

Always stage, commit, and push after considerable changes. User SSHs to VPS and types `deploy`.
