# Cloudflare Pages Setup for heyvera.org

## Environment Variables

To enable auth and API connectivity on the deployed frontend:

1. Go to Cloudflare Dashboard → Pages → heyvera project → Settings → Environment variables
2. Set these production environment variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | Get from Clerk Dashboard → API Keys → Production |

**Important:** Do NOT set `VITE_API_URL`. The frontend uses relative `/v1/*` paths which are proxied to the backend via `web/public/_redirects`.

## Build Settings

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `web`

## Deployment Trigger

The Pages project auto-deploys on every push to `main` branch.

## Health Check

After environment variables are set:
- Visit https://heyvera.org
- Sign in with Clerk (should work)
- Create a profile (should work if backend is deployed)
- Create a post (should work if backend is deployed)

If backend endpoints fail, check that ClawNet is deployed and `api.heyvera.org/v1/health` returns 200.