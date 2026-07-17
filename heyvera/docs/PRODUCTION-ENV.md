# HeyVera production / local environment checklist

Use this before claiming a production deploy is ready.

## Required (auth)

| Variable | Purpose |
|----------|---------|
| `CLERK_SECRET_KEY` | Verify JWTs on API |
| `CLERK_ISSUER` | Optional but recommended issuer check |
| `CLERK_AUTHORIZED_PARTY` | Optional `azp` check |
| `HEYVERA_ENV=production` or `APP_ENV=production` | Fail closed if Clerk missing |
| `VITE_CLERK_PUBLISHABLE_KEY` | Frontend Clerk |

Never deploy HeyVera social with empty `CLERK_SECRET_KEY` and production env unset.

## API / CORS

| Variable | Purpose |
|----------|---------|
| `CORTEX_ALLOWED_ORIGINS` | Comma-separated browser origins (not `*`) |
| `VITE_API_URL` | Frontend API base (e.g. `https://api.heyvera.org`) |

## Database

SQLite path as configured by heyvera-server / AppState (see crate env). Single-writer SQLite is fine for early users; document scale limits.

## Media (optional until Phase 4 production)

| Variable | Purpose |
|----------|---------|
| `STORAGE_ENDPOINT` | R2/S3 endpoint |
| `STORAGE_BUCKET` | Bucket name |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Credentials |
| Public CDN / URL base if used by resolve_public_url |

Without storage vars, media uses mock upload path (dev only).

## Pulse LLM (optional)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Enables Pulse chat `tools_v2` (LLM tool JSON). Prefer Anthropic if both set. |

Without these keys, `/v1/pulse/chat` stays on **tools_v1** (keyword matching only). No fake AI.

## Pulse schedule processor (cron / self-call)

Approved drafts can be scheduled via `POST /v1/pulse/schedules` (or chat: `schedule draft <id> at <ISO>`).

Due items are **not** auto-published in-process. Call the processor periodically:

```bash
# Every minute (example). Requires a valid Clerk user JWT for the API.
curl -sS -X POST "$VITE_API_URL/v1/pulse/schedules/process" \
  -H "Authorization: Bearer $CLERK_SESSION_JWT"
```

| Item | Detail |
|------|--------|
| Endpoint | `POST /v1/pulse/schedules/process` |
| Auth | Authenticated Clerk JWT (early product: processes global due queue on single-tenant SQLite) |
| Effect | Publishes schedules where `publish_at <= now` and draft is still `approved` |
| Suggested cron | `* * * * *` (every minute) or every 5 minutes for low traffic |

Without this cron (or manual self-call), scheduled drafts remain in `scheduled` status forever.

## Billing (optional)

Stripe keys as already used by shared billing routes if Premium is enabled.
