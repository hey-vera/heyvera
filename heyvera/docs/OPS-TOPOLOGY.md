# HeyVera ops topology (ENFORCED)

This note describes how **heyvera.org**, **api.heyvera.org**, and **cortex.heyvera.org** are wired **as of the files in this monorepo**. Prefer reading the cited files before changing production.

## Owner map (ENFORCED)

| Surface | Owner process | Port | Caddy (api.heyvera.org) |
|---------|---------------|------|-------------------------|
| `/v1/social/*` | **heyvera-server** | **3002** | → `localhost:3002` + X-Forwarded-For / X-Real-IP |
| `/v1/pulse/*` | **heyvera-server** | **3002** | → `localhost:3002` + X-Forwarded-For / X-Real-IP |
| `/v1/health`, `/v1/ready` | **heyvera-server** | **3002** | → `localhost:3002` |
| `/api/*` | **cortex-server** | **3001** | → `localhost:3001` |
| remaining `/v1/*` | legacy Node (if needed) | **3402** | → `localhost:3402` |

**Single owner for Social + Pulse:** `heyvera-server` (`crates/heyvera-server`, binary name `heyvera-server`, cargo package `heyvera-server-bin`). Do not route production Social/Pulse to cortex-server.

Cortex still mounts a **subset** of `/v1/social/*` with **rate-limit middleware** as defense-in-depth if Caddy is misconfigured. Primary production traffic must hit **:3002**.

## Binaries and default ports

| Binary | Crate | Default port | Router builder | Typical role |
|--------|--------|--------------|----------------|--------------|
| `heyvera-server` | `crates/heyvera-server` | **3002** (`HEYVERA_PORT`) | `cortex_api::build_heyvera_router` | **Owner** of Social + Pulse + `/v1/health` |
| `cortex-server` | `crates/cortex-server` | **3001** (`CORTEX_PORT`) | `cortex_api::build_cortex_router` | Cortex product `/api/*` + rate-limited social subset (mis-route defense) |
| Legacy Node / product API | (deploy scripts) | **3402** | n/a in Rust | Remaining non-social `/v1/*` on api.heyvera.org if still needed |

Sources: `crates/heyvera-server/src/main.rs`, `crates/cortex-server/src/main.rs`, `crates/api/src/lib.rs`, `Caddyfile`, `scripts/deploy-vera.sh`, `deploy/heyvera-api.service`.

## Caddy notes (`Caddyfile`)

### `heyvera.org` / `www.heyvera.org` (ENFORCED — soft-launch integrity)

```
handle /v1/social/*     → localhost:3002   (heyvera-server) + XFF/X-Real-IP
handle /v1/pulse/*      → localhost:3002   (heyvera-server) + XFF/X-Real-IP
handle /v1/health       → localhost:3002
handle /v1/ready        → localhost:3002
handle /api/*           → localhost:3001   (cortex-server, billing same-origin)
handle /v1/*            → localhost:3402   (legacy remainder only)
handle /assets/*        → static under /home/guardian/www/heyvera
handle (SPA)            → same root, try_files → /index.html
```

- Frontend static files are expected at `/home/guardian/www/heyvera` (deployed by `scripts/deploy-vera.sh`).
- Apex same-origin social/pulse must hit **:3002**, not silent legacy **:3402**.

### `api.heyvera.org` (ENFORCED)

```
handle /api/*           → localhost:3001   (Cortex) + XFF/X-Real-IP
handle /v1/social/*     → localhost:3002   (heyvera-server) + XFF/X-Real-IP
handle /v1/pulse/*      → localhost:3002   (heyvera-server) + XFF/X-Real-IP
handle /v1/health       → localhost:3002
handle /v1/ready        → localhost:3002
handle /v1/*            → localhost:3402   (legacy remainder)
```

### `cortex.heyvera.org`

```
@api path /api/* /v1/*  → reverse_proxy localhost:3001
static SPA              → /var/www/cortex
```

Cortex UI + API on the same host.

## Cloudflare Pages (heyvera root)

- App source/root for Pages: **`heyvera/`** (Vite React SPA).
- Functions proxy: `heyvera/functions/v1/[[path]].ts` forwards `heyvera.org/v1/*` to **`https://api.heyvera.org`**.
- Upstream Social/Pulse hit **api.heyvera.org → :3002**.

Smoke: `scripts/heyvera-launch-smoke.sh` (probes `/v1/health`, `/v1/social/trending`, `/v1/pulse/drafts` — 401 OK for pulse drafts).

## Route ownership (Rust)

### `build_heyvera_router` (heyvera-server) — production owner

- Full `/v1/social/*` (profiles, feed, posts, media, bookmarks, follows, notifications, communities, messaging, moderation, linked-agents, etc.)
- `/v1/pulse/*` (drafts, approve/reject/publish, chat tools, schedules/process, goals)
- Shared `/api/auth/status`, billing, Clerk webhooks (subset)
- **Rate-limit middleware** on the whole router
- Optional static dir: `HEYVERA_STATIC_DIR` default `heyvera/dist`

### `build_cortex_router` (cortex-server)

- Full Cortex `/api/*` surface
- **Partial** social mount with **rate_limit_middleware** (defense if mis-routed)
- Pulse is **not** on cortex-router

Always re-check `crates/api/src/lib.rs` before assuming a path exists on a given binary.

## Media upload path

Client flow (FE `uploadMediaFile` in `heyvera/src/api/social.ts`):

1. `POST /v1/social/media/upload-url` → `{ upload_url, media_id, expires_in }`
2. `PUT` file to `upload_url` (R2/S3 presign **or** mock only in non-production)
3. `POST /v1/social/media/{id}/finalize`
4. `POST /v1/social/posts` with `mediaIds: [id]`

**Production gate:** if `HEYVERA_ENV` / `CORTEX_ENV` / `APP_ENV` / `ENVIRONMENT` is `production` and storage is not fully configured (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`), upload-url **refuses** mock URLs (`STORAGE_NOT_CONFIGURED`). Mock PUT handler is also fail-closed in production.

## Secrets / env checklist

### Auth

| Variable | Where | Notes |
|----------|--------|------|
| `CLERK_SECRET_KEY` | API process | Enables JWT verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend build | Clerk browser SDK |
| `HEYVERA_ENV=production` | heyvera-server | Fail-closed flags (auth CORS, media mock) |

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

### Object storage (media) — required in production

| Variable | Notes |
|----------|------|
| `STORAGE_ENDPOINT` | S3/R2 endpoint |
| `STORAGE_BUCKET` | Bucket name |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Presign credentials |
| `STORAGE_REGION` | Default `auto` (R2) |
| `STORAGE_PUBLIC_URL` | Optional CDN/public base for media URLs |

### Pulse schedule cron

```bash
# Every minute — scripts/pulse-schedule-process.sh
* * * * * PULSE_PROCESS_TOKEN=… /path/to/scripts/pulse-schedule-process.sh
```

Endpoint: `POST /v1/pulse/schedules/process` on heyvera-server (via api.heyvera.org).

## Deploy scripts (ENFORCED)

- `scripts/deploy-vera.sh` — **single procedure**: builds **cortex-server** + **heyvera-server** (`-p heyvera-server-bin`), builds **`heyvera/` SPA** (`npm ci && npm run build`) and rsyncs to `HEYVERA_WWW` (default `/home/guardian/www/heyvera`), reloads Caddy (apex + api → social/pulse :3002), starts **cortex** + **heyvera-api** units.
- `scripts/heyvera-install-service.sh` — one-time systemd install for `heyvera-api.service` (template: `deploy/heyvera-api.service`).
- `scripts/heyvera-launch-smoke.sh` — health + social trending + pulse drafts (401 OK) + SPA index note.
- `scripts/pulse-schedule-process.sh` — cron-callable schedule processor (required for due scheduled posts).

## Soft-realtime (notifications / DMs)

**Today:** Notifications use visibility-aware soft polling (~15s). Messages retain a polling fallback
(~5–20s) and use a ticket-authenticated WebSocket for new-message push while connected. Presence,
missed-event replay, horizontal fan-out, and broader WebSocket/SSE push remain future work.

## Related files

- `Caddyfile`, `Caddyfile.docker`
- `crates/api/src/lib.rs` — route tables + rate limits
- `crates/api/src/media.rs` — prod mock fail-closed
- `crates/heyvera-server/src/main.rs`, `crates/cortex-server/src/main.rs`
- `deploy/heyvera-api.service`, `scripts/heyvera-install-service.sh`
- `heyvera/functions/v1/[[path]].ts` — CF Pages `/v1` proxy
- `scripts/heyvera-launch-smoke.sh`, `scripts/deploy-vera.sh`, `scripts/pulse-schedule-process.sh`
