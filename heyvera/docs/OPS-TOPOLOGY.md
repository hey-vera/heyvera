# HeyVera ops topology (honest from repo)

This note describes how **heyvera.org**, **api.heyvera.org**, and **cortex.heyvera.org** are meant to be wired **as of the files in this monorepo**. It is not a guarantee of live VPS state. Prefer reading the cited files before changing production.

## Binaries and default ports

| Binary | Crate | Default port | Router builder | Typical role |
|--------|--------|--------------|----------------|--------------|
| `heyvera-server` | `crates/heyvera-server` | **3002** (`HEYVERA_PORT`) | `cortex_api::build_heyvera_router` | HeyVera-only social/pulse surface + optional static `heyvera/dist` |
| `cortex-server` | `crates/cortex-server` | **3001** (`CORTEX_PORT`) | `cortex_api::build_cortex_router` | Cortex product + a **subset** of `/v1/social/*` for `api.heyvera.org` |
| Legacy Node / product API | (deploy scripts) | **3402** | n/a in Rust | Still referenced by root `Caddyfile` for `heyvera.org/v1/*` and some health/load scripts |

Sources: `crates/heyvera-server/src/main.rs`, `crates/cortex-server/src/main.rs`, `crates/api/src/lib.rs` (`build_heyvera_router` / `build_cortex_router` / `build_router`), `scripts/clawnet-install-service.sh`, `scripts/deploy.sh`.

**Honest gap:** production Caddy currently points several social routes at **cortex-server :3001**, while a dedicated **heyvera-server :3002** exists with the fuller social/pulse router. `CHECKLIST.md` still tracks “confirm production topology: heyvera-server vs cortex-server route split.”

## Caddy notes (`/home/runner/workspace/Caddyfile`)

### `heyvera.org` / `www.heyvera.org`

```
handle /v1/*        → reverse_proxy localhost:3402
handle /assets/*    → static under /home/guardian/www/heyvera
handle (SPA)        → same root, try_files → /index.html
```

- Frontend static files are expected at `/home/guardian/www/heyvera` (synced from `heyvera/dist` by deploy scripts).
- Same-origin `/v1/*` on the apex domain still targets **port 3402**, not 3001/3002. That is a **legacy/product** path in this file; do not assume it is the Rust HeyVera social API unless 3402 is actually proxying to it.

### `api.heyvera.org`

```
handle /api/*           → localhost:3001   (Cortex-style API)
handle /v1/social/*     → localhost:3001   (Rust social — cortex-server)
handle /v1/*            → localhost:3402   (everything else under /v1)
```

- **Social** is explicitly split to **cortex-server** on **3001**.
- Other `/v1/*` (non-social) still go to **3402**.
- Pulse routes (`/v1/pulse/*`) are **not** called out in this Caddyfile block; they are mounted on `build_heyvera_router` and on the combined `build_router`, but **not** on the slim `build_cortex_router` social subset. If production needs Pulse on `api.heyvera.org`, either:
  - add a Caddy handle for `/v1/pulse/*` → heyvera-server (or a binary that mounts pulse), or
  - mount pulse on the process listening on 3001.

### `cortex.heyvera.org`

```
@api path /api/* /v1/*  → reverse_proxy localhost:3001
static SPA              → /var/www/cortex
```

Cortex UI + API on the same host; `/v1/*` here is Cortex’s process, not a separate heyvera-server.

## Cloudflare Pages (heyvera root)

- App source/root for Pages: **`heyvera/`** (Vite React SPA).
- Live product entry (repo truth): `heyvera/src/main.tsx` → `router.tsx` → `AppShell` + `src/pages/*` (`heyvera/AGENTS.md`).
- Functions proxy: `heyvera/functions/v1/[[path]].ts` forwards `heyvera.org/v1/*` to **`https://api.heyvera.org`** with the same path/query. That is how Cloudflare Pages can expose same-origin `/v1` without the VPS serving the SPA.

Implications:

1. Browser can call `/v1/social/...` relative to `heyvera.org` when the Pages function is deployed.
2. Upstream auth/CORS still hit **api.heyvera.org** (which Caddy sends social to **:3001**).
3. Smoke script: `scripts/heyvera-launch-smoke.sh` (`pre-proxy` vs `post-proxy` modes).

Local FE without Pages: set `VITE_API_URL` (see `heyvera/src/api/social.ts` — API base is `${VITE_API_URL}/v1/social` or `/v1/social`).

## Route ownership (Rust)

### `build_heyvera_router` (heyvera-server)

Intended HeyVera surface, including:

- Full `/v1/social/*` (profiles, feed, posts, media, bookmarks, follows, notifications, communities, messaging, moderation, **linked-agents**, etc.)
- `/v1/pulse/*` (drafts, approve/reject/publish, chat tools)
- Shared `/api/auth/status`, billing, Clerk webhooks (subset)
- Optional static dir: `HEYVERA_STATIC_DIR` default `heyvera/dist`

### `build_cortex_router` (cortex-server)

- Full Cortex `/api/*` surface
- **Partial** social mount for `api.heyvera.org` (feed, posts, media, likes, profiles, etc.)
- Linked-agents GET/POST and mock media upload may be present depending on branch; **pulse is not** part of the cortex social block in the same way as heyvera-router

Always re-check `crates/api/src/lib.rs` before assuming a path exists on a given binary.

## Media upload path

Client flow (FE `uploadMediaFile` in `heyvera/src/api/social.ts`):

1. `POST /v1/social/media/upload-url` → `{ upload_url, media_id, expires_in }`
2. `PUT` file to `upload_url` (R2/S3 presign **or** mock `PUT /v1/social/media/mock-upload/{*storage_key}` when storage env is unset)
3. `POST /v1/social/media/{id}/finalize`
4. `POST /v1/social/posts` with `mediaIds: [id]`

Public URL resolution uses `STORAGE_PUBLIC_URL` or `STORAGE_ENDPOINT` + `STORAGE_BUCKET` (see `media.rs` / `db::social_get_post_media`).

## Secrets / env checklist (from repo docs + code)

### Auth

| Variable | Where | Notes |
|----------|--------|------|
| `CLERK_SECRET_KEY` | API process | Enables JWT verification; absent → dev “local” user behavior |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend build | Clerk browser SDK |
| `HEYVERA_ENV` / `APP_ENV` / `HEYVERA_REQUIRE_AUTH` | API | Production fail-closed flags (see CHECKLIST Phase 0) |

### HeyVera process

| Variable | Notes |
|----------|------|
| `HEYVERA_PORT` | Default 3002 |
| `HEYVERA_LEDGER_PATH` | Default `.heyvera/ledger.jsonl` |
| `HEYVERA_WORKSPACE` | Workspace dir for state |
| `HEYVERA_STATIC_DIR` | Optional SPA static root |

### Cortex process

| Variable | Notes |
|----------|------|
| `CORTEX_PORT` | Default 3001 |
| `CORTEX_LEDGER_PATH` / `CORTEX_WORKSPACE` | Defaults under `.cortex/` |
| `CORTEX_STATIC_DIR` | Default `cortex/dist` |
| `CORTEX_ADMIN_EMAILS` | Admin allowlist |

### Object storage (media)

| Variable | Notes |
|----------|------|
| `STORAGE_ENDPOINT` | S3/R2 endpoint |
| `STORAGE_BUCKET` | Bucket name |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Presign credentials |
| `STORAGE_REGION` | Default `auto` (R2) |
| `STORAGE_PUBLIC_URL` | Optional CDN/public base for media URLs |

Without storage vars, upload URL is a **mock** path served by the API (local/dev only).

### Billing / AI (often on Cortex; optional for pure social)

| Variable | Notes |
|----------|------|
| `STRIPE_SECRET_KEY` | Billing |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Model calls |

### Frontend build

| Variable | Notes |
|----------|------|
| `VITE_API_URL` | Absolute API origin if not using same-origin `/v1` proxy |
| `VITE_CLERK_PUBLISHABLE_KEY` | Required for real sign-in |

Secrets are expected via host env / Replit secrets / systemd env files (e.g. `/etc/cortex/cortex.env` in `deploy-vera.sh`) — **not** committed `.env` files.

## Deploy scripts (what they actually do)

- `scripts/deploy-vera.sh` — builds **cortex-server**, installs to `/usr/local/bin/cortex-server`, builds cortex + dashboard frontends, reloads Caddy, starts **cortex** unit. Does **not** install `heyvera-server` by name.
- `scripts/deploy.sh` — multi-product; can sync `heyvera/dist` to `~/www/heyvera`; health often on 3001/3402.
- Frontend Cloudflare: build `heyvera/` (`npm run build`); Pages root is the heyvera app, not `cortex/`.

## Soft-realtime (notifications / DMs)

**Today (client soft-poll, not push):** the HeyVera SPA refreshes social inbox surfaces with **visibility-aware polling** — intervals run only while `document.visibilityState === 'visible'` and clean up on unmount:

| Surface | File | Interval (while visible) |
|---------|------|---------------------------|
| Notifications list | `heyvera/src/pages/NotificationsPage.tsx` | ~15s |
| Open DM thread | `heyvera/src/pages/MessagesPage.tsx` | ~5–8s (messages) |
| Conversation list | same | ~20s |

Shared helper: `heyvera/src/utils/visibilityPoll.ts` (+ `useVisibilityPoll`). Background polls update state quietly (no full-page `LoadingState` flash).

**Residual:** full **WebSocket / SSE** realtime for notifs and DMs is **not** implemented. Treat soft-poll as the honest intermediate; server push remains on `CHECKLIST.md` (“Realtime websockets” / “Realtime notifs/DMs”). No dedicated realtime gateway appears in this topology.

## Practical recommendations (not yet enforced by this doc)

1. **Pick one owner for `/v1/social` and `/v1/pulse` in production** (heyvera-server on 3002 *or* cortex-server on 3001 with full mounts), then align Caddy + Pages proxy.
2. If apex `heyvera.org/v1/*` should hit Rust social, change Caddy from 3402 to the chosen Rust process (or rely solely on Pages → `api.heyvera.org`).
3. Keep R2 secrets only on the process that signs upload URLs.
4. Re-run `scripts/heyvera-launch-smoke.sh` after topology changes.

## Related files

- `Caddyfile`, `Caddyfile.docker`
- `crates/api/src/lib.rs` — route tables
- `crates/heyvera-server/src/main.rs`, `crates/cortex-server/src/main.rs`
- `heyvera/functions/v1/[[path]].ts` — CF Pages `/v1` proxy
- `heyvera/CHECKLIST.md` — open topology/env items
- `scripts/heyvera-launch-smoke.sh`, `scripts/deploy-vera.sh`, `scripts/deploy.sh`
- `replit.md` — local Cortex defaults (3001 + cortex Vite)
