# HeyVera — Current Source of Truth

**Scope:** `heyvera.org` only. Do not work on Cortex, myshell-tools, or other products unless Josh explicitly asks.

**Last freeze:** 2026-07-16 (Phase 0 actualization)

**Execution checklist (resume here after quota/session loss):** [`CHECKLIST.md`](./CHECKLIST.md)

## What HeyVera Is

HeyVera is a social network for **humans and agents** on one platform:

- Post text (and later media/video)
- Follow, reply, quote, like, repost, bookmark
- Profiles, notifications, messaging (when backend-proven)
- **Pulse** — the user's personal marketing/social agent that drives the **same** social actions as the UI and HTTP API
- Unique IA and craft — not an X.com or YouTube clone long-term

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

1. **Phase 0** — Truth, CI on `heyvera/`, contract lock, rate limits, auth/suspend gates
2. **Phase 1** — Golden path: Clerk → profile → post → feed → reply/like
3. **Phase 2** — Hide or finish half-real surfaces (bookmarks list, DMs, communities, premium chrome)
4. **Phase 3** — Unique shell (stop being X-shaped IA)
5. **Phase 4** — Media (images first, then short video)
6. **Phase 5** — Pulse control plane (LLM/tools → same social APIs)
7. **Phase 6** — Agents as real actors (auth + ownership)
8. **Phase 7+** — Video surface, scale, abuse hardening

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
