# HeyVera setup (Linux)

Local setup for the **heyvera/** frontend and **heyvera-server** API.

The app path is **`heyvera/`** (not `web/`).

---

## Prerequisites

- Node.js 20+ (LTS recommended)
- npm
- Rust toolchain (`cargo`) for the backend
- Git

---

## Frontend

```bash
cd heyvera
npm ci
npm run dev
```

Dev server defaults to **http://localhost:5001** and proxies `/v1` → `http://localhost:3402`.

Useful scripts:

```bash
npm run typecheck
npm run test:unit
npm run build
```

---

## Backend

Binary crate: `crates/heyvera-server` (binary name **`heyvera-server`**).

From the **repo root**:

```bash
# Match the Vite proxy target for local FE+API work
HEYVERA_PORT=3402 cargo run -p heyvera-server-bin
```

Package name is `heyvera-server-bin`; the binary is `heyvera-server`.

Default bind without `HEYVERA_PORT` is **3002** — set `HEYVERA_PORT=3402` so `heyvera` Vite proxy works without `VITE_API_URL`.

---

## Environment

### Frontend (`heyvera/.env` or shell)

| Variable | Required | Notes |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | For auth UI | Without it, app runs public/read-only (no ClerkProvider). |
| `VITE_API_URL` | Optional | Absolute API origin when not using relative `/v1` + proxy. Leave unset locally (Vite proxies `/v1` → `:3402`). |

Copy from `heyvera/.env.example`.

### Backend (process env)

| Variable | Required | Notes |
|---|---|---|
| `CLERK_SECRET_KEY` | For real auth | Without it, server logs auth disabled (dev-friendly). |
| `HEYVERA_ENV` | Prod | Use `production` (or set `HEYVERA_REQUIRE_AUTH`) so missing Clerk fails closed. Also reads `APP_ENV` / `RUST_ENV`. |
| `HEYVERA_PORT` | Optional | Default `3002`. Use `3402` with local Vite proxy. |
| `HEYVERA_LEDGER_PATH` | Optional | Default `.heyvera/ledger.jsonl`. |
| `HEYVERA_WORKSPACE` | Optional | Workspace dir for the process. |

### Storage (optional — media upload / public URLs)

| Variable | Notes |
|---|---|
| `STORAGE_ENDPOINT` | S3-compatible endpoint |
| `STORAGE_BUCKET` | Bucket name |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Credentials |
| `STORAGE_REGION` | Default `auto` |
| `STORAGE_PUBLIC_URL` | Public CDN/base URL for media links |

Without storage env, media upload may return mock URLs in dev.

---

## Typical local loop

Terminal 1 — API:

```bash
HEYVERA_PORT=3402 cargo run -p heyvera-server-bin
```

Terminal 2 — UI:

```bash
cd heyvera
npm ci   # first time
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5001`).

---

## Paths (Linux)

| What | Path |
|---|---|
| Frontend app | `heyvera/` |
| Frontend entry | `heyvera/src/main.tsx` → `router.tsx` → pages |
| API client | `heyvera/src/api/social.ts`, `heyvera/src/api/pulse.ts` |
| Server binary | `crates/heyvera-server` |
| Shared API crate | `crates/api` |

Do **not** use legacy `web/` paths from older docs.

---

## Theme

Dark is the product default. Light mode is an optional preference (`localStorage` key `vera-theme`).

---

## Troubleshooting

### API calls fail with network / 502 in dev

- Ensure backend is listening on **3402** (`HEYVERA_PORT=3402`), or set `VITE_API_URL` to the real origin.
- Vite only proxies `/v1` in `npm run dev` / preview — not in static production builds.

### No sign-in UI

- Set `VITE_CLERK_PUBLISHABLE_KEY` for the frontend.
- Set `CLERK_SECRET_KEY` on the server for JWT verification.

### Wrong directory

Always work under `heyvera/` for the public app — not `web/`.
