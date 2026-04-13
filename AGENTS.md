# ClawNet - AGENTS.md

Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (better-sqlite3, raw SQL - no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments, Soma-verified execution. Single-process Node on a VPS.

## Workflow Rules

1. Always stage, commit, and push after medium-to-major changes.
2. Normal production deploys happen from GitHub Actions, not by manually SSHing to the VPS.
   Use `Actions -> Deploy Production` on `main`. The workflow syncs the exact GitHub commit to the server mirror, connects over Tailscale SSH, runs the hardened deploy script, and should be verified with `/health` or `/api/deploy-info`.
3. Never assume - always verify. Check actual code, docs, and runtime behavior before answering.

## Push And Deploy Discipline

- Treat GitHub as the source of truth. Normal code pushes should go to the GitHub remote and land through PRs.
- This repo lives in the `clawnet` GitHub organization. Verify `origin` points at `https://github.com/clawnet/claw-net.git` before pushing from a local clone or worktree.
- Do **not** use direct VPS remotes like `live` or `origin` for normal development or release flow.
- Only use direct server push paths if the user explicitly asks for an emergency/manual recovery path.
- Before starting work, re-check the actual current branch with Git instead of trusting a stale session header or UI summary.
- Treat `main` as the only deploy-truth branch. Long-lived forks or local branches are not production reality until merged through PRs.
- Before planning follow-up slices, verify that the target feature surface actually exists on `main`. If it does not, re-plan as foundation-first incremental PRs off `main`.
- Do not propose giant rebases or wholesale merges from long-lived forks without explicit user approval.
- Prepared VPS env vars are not proof a feature is live. Verify the deploy branch actually reads the env before treating infrastructure setup as deployed behavior.

## Merge Conventions

- Default to `Squash and merge`.
- Use `Merge commit` only when preserving branch history is intentionally valuable.
- Auto-merge is enabled on this private repo and branch protections are enforced under the paid org. If a PR is ready but still waiting on checks, prefer asking whether to enable auto-merge.
- Be collaborative: when a PR looks merge-ready, explicitly prompt the user before merging instead of assuming.

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
