# ClawNet — CLAUDE.md

Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (better-sqlite3, raw SQL — no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments, Soma-verified execution. Single-process Node on a VPS.

## Workflow Rules

1. Always stage, commit, and push after medium-to-major changes. User SSHs to VPS and types `deploy`.
2. Never assume — always verify. Check the actual code, search the web, or read the docs before answering. If unsure, research first, ask second.

## Quick Reference

```bash
npm run dev          # Dev mode (tsx watch + .env)
npm run build        # Compile to dist/ (tsc --noCheck)
npm start            # Run compiled dist/index.js
npm run test:unit    # Vitest unit tests
npm run typecheck    # Type check only (no emit)
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

## Project Structure

```
src/
├── routes/        HTTP endpoints (Hono routers)
├── core/          Business logic, crons, execution engine
├── db/            Domain files re-exported via index.ts barrel
├── utils/         Billing, payouts, masking, shutdown, email, crypto
├── middleware/     Auth, rate limit, signing, soma provenance
├── cache/         Smart cache v2 (L1 memory + L2 Redis)
├── providers/     LLM, ClawAPIs x402, facilitator pool
├── config/        Zod env validation, API registry (274+ endpoints)
├── mcp/           MCP tool server + Soma MCP wrapper
site/              Static HTML website
tests/unit/        Vitest tests
```

## API Access (three paths)

**Orchestrated:** `POST /v1/orchestrate` — LLM picks endpoints. 2-credit fee + endpoint costs.
**Direct:** `POST /v1/endpoints/:id/call` — specific endpoint by ID. No LLM, endpoint cost only.
**Verify:** `POST /v1/soma/verify` — agent calls provider directly, submits cert for async trust verification. Zero latency.

## Database Patterns

```typescript
const row = getDb().prepare('SELECT * FROM t WHERE id = ?').get(id);  // ALWAYS getDb()
getDb().transaction(() => { /* ... */ })();  // Note double parentheses
logAudit({ entityType, entityId, action, actorId?, data? });  // Fire-and-forget
```

- Migrations in `src/db/connection.ts` — append `{ version: N, sql: '...' }`. Runs on `initDb()`.
- Barrel export at `src/db/index.ts` — import from here, never domain files directly.

## Auth (3 layers)

| Layer | Header | Usage |
|-------|--------|-------|
| API Key | `X-API-Key` (cn-...) | Most /v1/* routes |
| Clerk | `Authorization: Bearer` | Escrow, user endpoints |
| Admin | `X-Admin-Key` | /v1/admin/* (timing-safe SHA-256) |

## Critical Gotchas

- **`round6()`** — use on ALL credit math, never raw floating-point
- **`maskApiKey()`** — ALWAYS use, never `.slice()`
- **`trackDelegatedSpend()`** — must be called after every `deductCredit()`
- **x402 surcharge** — MUST credit `clawhub-treasury`, not burn
- **DB imports** — always from `src/db/index.ts`, never domain files directly
- **Soma: provenance ≠ verification** — birth certificates prove data origin; sense verifies model
- **Soma: never self-verify** — ClawNet runs heart, callers run sense
- **Revenue share** — 90% provider / 10% platform on live calls. Cache hits = 0% provider. `creditProviderShare()` after `deductCredit()`
- **Promo codes** — admin creates via `/v1/admin/promo-codes`, users redeem via self-onboard or `/v1/account/redeem-promo`

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

## Testing

```bash
npm run test:unit           # Vitest
npm run test:unit:coverage  # With coverage
```

Use `setupTestDb()` from `tests/unit/helpers/db.ts`.

## Environment

All env vars Zod-validated in `src/config/index.ts`. Full list in `.env.example`.

## Detailed Docs

For deeper context on specific subsystems:
- `docs/billing.md` — Credit math, revenue splits, pricing engine
- `docs/soma-integration.md` — Soma phases 1-6, receipt layer, EAS, verify mode, provider umbrella
- `docs/architecture.md` — Key files, cron jobs, cache, wallet architecture, provider umbrella, promo codes
