# ClawNet Development Workflow

This document captures the durable repo guidance for day-to-day development, regardless of which AI assistant or editor is being used.

## Overview

ClawNet is a sovereign AI agent orchestration layer built on a Hono API, SQLite with WAL mode, Redis caching, Clerk auth, Stripe plus USDC/Solana payments, and Soma-verified execution. The production target is a single-process Node deployment on a VPS.

## Core Commands

```bash
npm run dev
npm run build
npm start
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run test:unit
```

## Stack Constraints

- Use `Hono`, not Express or Fastify.
- Use `npm`, not `pnpm`.
- Use `better-sqlite3` and raw SQL, not an ORM.
- Keep the repo flat rather than introducing monorepo tooling.
- Keep marketing pages in `site/` as plain HTML.
- Keep provider dashboards in `dashboard/` with React + Vite.

## Database Rules

- Append migrations in [src/db/connection.ts](C:\Users\Josh\Desktop\GitHub\claw-net\src\db\connection.ts).
- Import database helpers from [src/db/index.ts](C:\Users\Josh\Desktop\GitHub\claw-net\src\db\index.ts) instead of bypassing the barrel.
- Use prepared statements from `getDb()`.
- Use `logAudit(...)` for security-sensitive changes and important business events.

## App Rules

- Use `round6()` for credit math instead of raw floating-point math.
- Use `maskApiKey()` when displaying or logging API keys.
- Call `trackDelegatedSpend()` after delegated spend events.
- Call `creditProviderShare()` after billable endpoint calls.
- Return API errors with a machine-readable `code`.

## Environment And Secrets

- Keep local examples in [.env.example](C:\Users\Josh\Desktop\GitHub\claw-net.env.example).
- Do not commit real `.env` files or production keys.
- Keep production secrets on the VPS outside the repo when possible.
- Prefer an external VPS env file such as `/etc/claw-net/claw-net.env` instead of a repo-local production `.env`.
- Treat wallet keys, Clerk secrets, Stripe secrets, and signing secrets as production-only values.

## Git Workflow

- Stage only the files intended for the current change.
- Avoid mixing formatting, feature work, and deploy hotfixes in the same commit.
- Validate with `npm run lint`, `npm run build`, and the most relevant tests before pushing medium-to-large changes.
- Do not use force-push or destructive git cleanup unless there is an explicit reason and the branch state is understood.
- For shared worktrees with unrelated changes, use targeted staging such as `git add <file>` rather than `git add .`.
- When using an assistant in a dirty worktree, commits should include only the files for the current task, and pushes should happen only after local verification passes.

## Deployment Notes

- The live service runs on a VPS.
- Keep deploy steps repeatable and scriptable.
- Prefer validating changes locally with lint/tests before deploys.
- The deploy script prefers `/etc/claw-net/claw-net.env` when present and only falls back to repo-local `.env`.

## Related Docs

- [docs/architecture.md](C:\Users\Josh\Desktop\GitHub\claw-net\docs\architecture.md)
- [docs/billing.md](C:\Users\Josh\Desktop\GitHub\claw-net\docs\billing.md)
- [docs/soma-integration.md](C:\Users\Josh\Desktop\GitHub\claw-net\docs\soma-integration.md)
- [docs/RUNBOOK.md](C:\Users\Josh\Desktop\GitHub\claw-net\docs\RUNBOOK.md)
