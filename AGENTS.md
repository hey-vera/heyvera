# ClawNet - AGENTS.md

Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (better-sqlite3, raw SQL - no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments, Soma-verified execution. Single-process Node on a VPS.

## Workflow Rules

1. Always stage, commit, and push after medium-to-major changes.
2. Normal production deploys happen from GitHub Actions, not by manually SSHing to the VPS.
   Use `Actions -> Deploy Production` on `main`. The workflow syncs the exact GitHub commit to the server mirror, connects over Tailscale SSH, runs the hardened deploy script, and should be verified with `/health` or `/api/deploy-info`.
3. Never assume - always verify. Check actual code, docs, and runtime behavior before answering.

## Quick Reference

```bash
npm run dev
npm run build
npm start
npm run test:unit
```

**VPS admin:** `guardian-vps-tail`  
**Production host:** `clawguard` (`tag:deploy`)  
**Server repo path:** `/home/guardian/claw-net`  
**Deploy branch:** `main`  
**Preferred release path:** GitHub Actions `Deploy Production`  
**Emergency fallback:** SSH as `guardian`, then run `bash scripts/deploy.sh` from `/home/guardian/claw-net`

## Stack Rules (CRITICAL)

| Use | NOT |
|---|---|
| Hono | Fastify |
| npm | pnpm |
| better-sqlite3 | Drizzle / any ORM |
| Single flat repo | Turborepo / monorepo |
| Plain HTML (`site/`) | SPA framework for marketing pages |
| React + Vite + shadcn (`dashboard/`) | Alternative dashboard stack |
| Clerk + Phantom | Reown AppKit |
| `.env` on VPS | sops / systemd secrets |

## Critical Gotchas

- `round6()` for all credit math
- `maskApiKey()` always, never `.slice()`
- import DB helpers from `src/db/index.ts`, not domain files directly
- Soma origin does not prove factual truth
- callers run sense, ClawNet runs heart

## Detailed Docs

- `docs/billing.md`
- `docs/soma-integration.md`
- `docs/architecture.md`
- `docs/secure-release-workflow.md`
