# HeyVera production / local environment checklist

Use this before claiming a production deploy is ready.

## Owner map (ENFORCED)

| Route prefix | Process | Port | systemd unit |
|--------------|---------|------|--------------|
| `/v1/social/*`, `/v1/pulse/*`, `/v1/health`, `/v1/ready` | **heyvera-server** | **3002** | `heyvera-api` |
| `/api/*` | **cortex-server** | **3001** | `cortex` |
| other `/v1/*` (legacy) | Node product API | **3402** | `claw-net-node` (if used) |

Install HeyVera unit once: `sudo bash scripts/heyvera-install-service.sh`  

**Single deploy procedure (API owner + SPA):** `./scripts/deploy-vera.sh`  
Builds cortex-server (:3001), heyvera-server (:3002), and `heyvera/` SPA → `HEYVERA_WWW` (default `/home/guardian/www/heyvera`). Reloads Caddy so **apex heyvera.org** and **api.heyvera.org** route `/v1/social/*`, `/v1/pulse/*`, health/ready → :3002.

## Required (auth)

| Variable | Purpose |
|----------|---------|
| `CLERK_SECRET_KEY` | Verify JWTs on API |
| `CLERK_ISSUER` | Optional but recommended issuer check |
| `CLERK_AUTHORIZED_PARTY` | Optional `azp` check |
| `HEYVERA_ENV=production` (or `APP_ENV` / `CORTEX_ENV` / `ENVIRONMENT=production`) | Fail closed if Clerk missing; **disables mock media** |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend Clerk |

Never deploy HeyVera social with empty `CLERK_SECRET_KEY` and production env unset.

## API / CORS

| Variable | Purpose |
|----------|---------|
| `CORTEX_ALLOWED_ORIGINS` | Comma-separated browser origins (not `*`) — **required in production** |
| `VITE_API_URL` | Frontend API base for production builds: `https://api.heyvera.org`. Local: leave empty (Vite dual proxy → :3002 social/pulse, :3001 `/api`) |

## Database

SQLite path as configured by heyvera-server / AppState (see crate env). Single-writer SQLite is fine for early users; document scale limits.

## Media (required in production)

| Variable | Purpose |
|----------|---------|
| `STORAGE_ENDPOINT` | R2/S3 endpoint |
| `STORAGE_BUCKET` | Bucket name |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Credentials |
| `STORAGE_REGION` | Optional (default `auto` for R2) |
| `STORAGE_PUBLIC_URL` | Optional public CDN / URL base |

**Fail-closed:** when any production env flag is set and storage is incomplete, `POST /v1/social/media/upload-url` returns an error (`STORAGE_NOT_CONFIGURED`) and does **not** return a mock upload URL. Mock PUT is also disabled in production.

Without storage vars in **non-production**, media uses mock upload path (dev only).

## Pulse LLM (optional)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Enables Pulse chat `tools_v2` (LLM tool JSON). Prefer Anthropic if both set. |

Without these keys, `/v1/pulse/chat` stays on **tools_v1** (keyword matching only). No fake AI.

## Pulse schedule processor (cron / self-call)

Approved drafts can be scheduled via `POST /v1/pulse/schedules` (or chat: `schedule draft <id> at <ISO>`).

Due items are **not** auto-published in-process. Call the processor periodically:

```bash
# Preferred: repo script (cron-callable)
export PULSE_PROCESS_TOKEN="…"   # valid Clerk/session JWT
export HEYVERA_API_ORIGIN="https://api.heyvera.org"
./scripts/pulse-schedule-process.sh

# Equivalent curl
curl -sS -X POST "$HEYVERA_API_ORIGIN/v1/pulse/schedules/process" \
  -H "Authorization: Bearer $PULSE_PROCESS_TOKEN"
```

Suggested crontab:

```cron
* * * * * PULSE_PROCESS_TOKEN=… /home/guardian/claw-net/scripts/pulse-schedule-process.sh >>/var/log/pulse-schedule.log 2>&1
```

| Item | Detail |
|------|--------|
| Endpoint | `POST /v1/pulse/schedules/process` |
| Owner | heyvera-server :3002 (via api.heyvera.org `/v1/pulse/*`) |
| Auth | Authenticated Clerk JWT |
| Effect | Publishes schedules where `publish_at <= now` and draft is still `approved` |
| Suggested cron | `* * * * *` (every minute) or every 5 minutes for low traffic |

Without this cron (or manual self-call), scheduled drafts remain in `scheduled` status forever.

## Billing (optional)

Stripe keys as already used by shared billing routes if Premium is enabled.

## x402 agent micropayments (Social, optional)

Default is **off**. Enable only when you intend shape-only validation or a real facilitator.

| Variable | Purpose |
|----------|---------|
| `X402_ENABLED=1` | Enable verify path (exactly `1`; anything else = disabled) |
| `X402_NETWORK` | Chain id, e.g. `base-sepolia` or `base` (default `base-sepolia` when enabled) |
| `X402_FACILITATOR_URL` | Optional HTTP facilitator base; when set → mode `facilitator` |
| `X402_PAY_TO` | Public recipient address for status UI (never a private key) |

**Never** put private keys in env for this surface. Details: `heyvera/docs/X402.md`.

Modes: `disabled` | `shape_only` (enabled, no facilitator) | `facilitator` (enabled + URL).

## Smoke gate

```bash
./scripts/heyvera-launch-smoke.sh
# Requires healthy api /v1/health for social+pulse entry checks:
#   GET /v1/social/trending  → 2xx JSON
#   GET /v1/pulse/drafts     → 401 OK (route present), 404 FAIL
```
