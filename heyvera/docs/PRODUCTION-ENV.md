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
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Future tools_v2 LLM chat |

tools_v1 works without these.

## Billing (optional)

Stripe keys as already used by shared billing routes if Premium is enabled.
