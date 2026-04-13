# ClawNet - AGENTS.md

Sovereign AI agent orchestration layer. Hono API on port 3402, SQLite WAL (`better-sqlite3`, raw SQL - no ORM), Redis L2 cache, Clerk auth, Stripe + USDC/Solana payments, Soma-verified execution. Single-process Node on a VPS.

## Workflow Rules

1. Always stage, commit, and push after medium-to-major changes.
2. Normal production deploys happen from GitHub Actions, not by manually SSHing to the VPS.
   Use `Actions -> Deploy Production` on `main`. The workflow syncs the exact GitHub commit to the server mirror, connects over Tailscale SSH, runs the hardened deploy script, and should be verified with `/health` or `/api/deploy-info`.
3. Never assume - always verify. Check actual code, docs, and runtime behavior before answering.

## Tighter Build Loop

Use this repo flow for important work:

1. Discovery
   Broad ideas start in a GitHub Discussion, `internal/backlog/`, or a structured issue draft.
2. Proposal
   Serious work gets shaped in `docs/proposals/` using the proposal template.
3. Boundary check
   Decide what belongs in `Soma`, what belongs in `claw-net`, and what belongs in `pulse`.
4. ADR
   If the work changes structure, trust model, scope, or repo boundaries, write or update an ADR in `docs/decisions/`.
5. Delivery
   Break accepted work into a parent issue, sub-issues, and small PR slices.
6. Production-readiness gate
   Before merging, check threat model, rollback, first-consumer reality, docs, and deploy consequences.

Heuristic:

- brainstorming belongs in Discussions or `internal/backlog/`
- adopted design belongs in `docs/proposals/`
- accepted structural choices belong in `docs/decisions/`
- shipped truth belongs in canonical docs under `docs/`

## Repo Truth Rules

- Treat GitHub as the source of truth. Normal code pushes should go to the GitHub remote and land through PRs.
- `docs/` is the canonical repo-truth layer.
- `internal/` is private company/workstream space, not canonical shipped truth.
- This repo is the runtime and platform home for ClawNet.
- Protocol truth stays in `Soma`.
- Product-specific Pulse truth stays in `pulse`.

## Push And Deploy Discipline

- This repo lives in the `claw-net` GitHub organization. Verify `origin` points at `https://github.com/claw-net/claw-net.git` before pushing from a local clone or worktree.
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
**Deploy-user SSH alias:** `claw-vps-tail` (may be blocked by Tailscale SSH policy for human/agent sessions; CI uses `deploy`)
**Production host:** `clawguard` (`tag:deploy`)
**Live server repo path:** `/home/guardian/claw-net`
**Deploy branch:** `main`
**Preferred release path:** GitHub Actions `Deploy Production`
**Emergency fallback:** SSH as `guardian`, then run `bash scripts/deploy.sh` from `/home/guardian/claw-net`

## Ops Access Notes

- Future agents should assume host inspection happens over `guardian-vps-tail` unless a human explicitly confirms deploy-user SSH is allowed for their session.
- Do not assume a repo note grants SSH by itself. Real access still depends on the local machine having the right SSH keys, SSH config aliases, active Tailscale auth, and matching Tailscale SSH policy.
- When checking live production state, prefer verifying the actual server path and user on the box instead of assuming `/home/deploy/...` from workflow variables.

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

- `docs/overview.md`
- `docs/architecture/context.md`
- `docs/architecture/runtime.md`
- `docs/reference/repo-system.md`
- `docs/reference/billing.md`
- `docs/reference/soma-integration.md`
- `docs/operations/release.md`
- `docs/operations/runbook.md`
- `docs/decisions/`
- `docs/proposals/PROPOSAL-TEMPLATE.md`
- `docs/reference/github-project-schema.md`
- `internal/active/idea-to-production-loop.md`
