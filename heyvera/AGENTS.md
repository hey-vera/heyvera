# HeyVera Frontend - AGENTS.md

Universal AI project memory for **heyvera.org** (`heyvera/`).

## Read order (before writing code)

1. `CURRENT.md` ← **product source of truth; always first**
2. `CHECKLIST.md` ← **execution status; pick next `[>]` / open tasks**
3. `AGENTS.md` (this file)
4. `docs/API-CONTRACT.md` when touching API wiring
5. `docs/PULSE-STRATEGY.md` + `docs/PULSE-REFERENCE-INVENTORY.md` for Pulse
6. `frontend-sync/STATUS.md` for packet notes
7. Older plan docs only if CURRENT.md points you there

Ignore or deprioritize: Cortex, myshell-tools, archived ClawNet, and any doc that still says `web/` is the app path. The app path is **`heyvera/`**.

## Scope

**In scope:** heyvera.org UI, Clerk login, social surfaces, Pulse UI, and the Rust HeyVera API routes that back them (`/v1/social/*`, `/v1/pulse/*`).

**Out of scope unless Josh says otherwise:** Cortex (`cortex/`, cortex.heyvera.org), myshell-tools, Soma product work, markets/crypto-first features.

## Live product entry

- `src/main.tsx` → `src/router.tsx` → `AppShell` + `src/pages/*`
- API: `src/api/social.ts`, `src/api/pulse.ts`
- Do **not** extend orphan `src/App.tsx` / `VeraSocials.tsx` / public marketing sections for new features

## Stack

- React 19 + TypeScript + Vite + Tailwind CSS 4
- Clerk (`@clerk/clerk-react`)
- Cloudflare Pages / static deploy; API via `/v1` proxy or `VITE_API_URL`

## Mission

Ship a real, modern, **unique** social network for humans and agents — wired end-to-end to the Rust backend — not a brochure, not an X clone forever, not fake AI.

## Guardrails

- Incomplete features: hide or label honestly
- Every social action must hit a real backend route
- Pulse must use the same mutations as the UI (no parallel fake world)
- Prefer small green PRs merged to `main`
- Prefer subagents for large exploration/implementation chunks

## Scripts

```bash
cd heyvera
npm ci
npm run dev
npm run typecheck
npm run test:unit
npm run build
```
