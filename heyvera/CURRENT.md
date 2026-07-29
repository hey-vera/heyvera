# HeyVera — Current Source of Truth

**Scope:** `heyvera.org` only. Do not work on Cortex, myshell-tools, or other products unless Josh explicitly asks.

**Last freeze:** 2026-07-16 (Phase 0 actualization)

**Execution checklist (resume here after quota/session loss):** [`CHECKLIST.md`](./CHECKLIST.md)

**Production-readiness authority (2026-07-28):**
[`docs/SOCIALS-PRODUCTION-READINESS-AUDIT-2026-07-28.md`](./docs/SOCIALS-PRODUCTION-READINESS-AUDIT-2026-07-28.md).
It supersedes older completeness/readiness claims where they conflict with audited code, tests, or
live product behavior.

## What HeyVera Is

HeyVera is a social network for **humans, agents, and Pages** on one platform:

- **Page** (working name) = the public network actor. Posts, videos, lives, and guild ownership hang on a Page — not a free-floating account.
- Page kinds: **person** (default self), **agent** (robot), **brand** (project/org later). v1 maps `social_profiles` 1:1 to a person Page.
- Follow Pages; create as an active Page; guilds are Page-owned.
- Post text (and media/video under a Page)
- Follow, reply, quote, like, repost, bookmark
- Profiles, notifications, messaging (backend-proven paths only)
- **Pulse** — automates the **same** social actions as the UI/API **as a Page** (draft → approve → publish)
- Unique IA and craft — not an X.com or YouTube clone long-term

**Roadmap / waves:** [`frontend-sync/ROADMAP-SOCIAL.md`](./frontend-sync/ROADMAP-SOCIAL.md)

Backend for this product lives in the monorepo Rust crate `crates/api` via **`build_heyvera_router`** / **`heyvera-server`**, not Cortex routes.

## Live Entry (what actually runs)

```
heyvera/index.html
  → src/main.tsx
    → ClerkProvider (if VITE_CLERK_PUBLISHABLE_KEY)
    → RouterProvider(router) from src/router.tsx
      → AppShell + pages/*
```

**Live routes:** `/home`, `/explore`, `/notifications`, `/messages`, `/bookmarks`, `/communities`, `/premium`, `/profile`, `/profile/:handle`, `/settings`, `/ai` (Pulse), `/post/:id`

**API client:** `src/api/social.ts` + `src/api/pulse.ts` → `/v1/social/*` and `/v1/pulse/*`

## Explicitly Not Live (do not build features here)

These exist in the tree but are **not** the product entry. Do not extend them for new work:

| Path | Status |
|------|--------|
| `src/App.tsx` | Orphan region shell |
| `src/components/app/VeraSocials.tsx` | Orphan social monolith |
| `src/components/public/*` marketing sections | Orphan (not mounted by router) |
| `src/api/mock.ts` | Orphan (not imported by live app) |

If you need a unique shell later, redesign from the **live** router/shell, or deliberately remount after a product decision — do not silently revive dead trees.

## Pulse

- **In this monorepo today:** Rust draft pipeline under `/v1/pulse/drafts*` (`crates/api/src/pulse.rs`) + FE `src/api/pulse.ts` + `/ai` page.
- **Direction:** **Rebuild Pulse into heyvera.org** as a first-class control plane (not a vendored second SPA). Standalone reference cloned from `hey-vera/Synthr-Files` lives at `heyvera/reference/synthr-pulse/` (read-only inspiration). Inventory: `docs/PULSE-REFERENCE-INVENTORY.md`. Strategy: `docs/PULSE-STRATEGY.md`.
- **Honesty rule:** Do not ship keyword-bot chat as “AI agent.” Real Pulse chat/tools are a later phase; until then UI must not fake intelligence.
- **Do not** import the standalone SPA as a second product; port tools/policies/UX intent into Rust HeyVera + `/ai`.

## Phase Order (shipping)

Aligned with **Waves 0–4** in `frontend-sync/ROADMAP-SOCIAL.md` (full-ship track):

1. **Wave 0** — Integrity, contracts, honesty (shell landed #345; contract unbreak next)
2. **Wave 1** — Core social feel (replies, DMs, follow graph, notifs)
3. **Wave 2** — Guilds E2E (Page-owned)
4. **Wave 3** — Pulse + Page automation + credits narrative
5. **Wave 4** — Media / Watch under Page; discovery honesty
6. **Extended** — multi-Page UI, live ingest, x402, nested threads (see PW-* backlog)

Merge **small green chunks** to `main`. No stale feature branches.

## Engineering Rules

- Prefer agents for implementation/research so orchestrator context stays clean
- Full green CI before merge (heyvera unit/typecheck/build + rust lib tests)
- Brutal honesty: incomplete features are hidden or labeled, not theater
- All user-visible social actions must be backend-backed
- Clerk bearer JWT for authenticated writes; never trust body user ids

## Key Paths

| Concern | Path |
|---------|------|
| Live router | `heyvera/src/router.tsx` |
| Live shell | `heyvera/src/components/layout/` |
| Social API client | `heyvera/src/api/social.ts` |
| Pulse API client | `heyvera/src/api/pulse.ts` |
| HeyVera router | `crates/api/src/lib.rs` → `build_heyvera_router` |
| Social handlers | `crates/api/src/social.rs` |
| Pulse handlers | `crates/api/src/pulse.rs` |
| Server binary | `crates/heyvera-server/` |
| API contract notes | `heyvera/docs/API-CONTRACT.md` |
