# HeyVera Release Workflow

Status: canonical

This is the production release workflow for the current HeyVera public
frontend and backend split.

## Current Production Truth

- `heyvera.org` and `www.heyvera.org` are the canonical public frontend
  domains.
- The canonical public frontend deploy path is Cloudflare Pages for `web/`.
- Cloudflare Pages production deploys come from `main`.
- Cloudflare Pages project settings must use:
  - root directory: `web`
  - build command: `npm run build`
  - output directory: `dist`
- `.github/workflows/deploy-frontend.yml` is not the current canonical
  public frontend deploy path. Treat it as legacy/VPS-oriented automation
  unless a future ADR explicitly re-promotes it.
- Backend/API deployment remains separate from the Pages public frontend.
- Same-domain `https://heyvera.org/v1/*` only becomes production-ready after
  the backend `/v1` surface is live and a Cloudflare Pages Function proxies
  `/v1/*` to the backend.

## Required PR Flow

1. Work on a short-lived branch or isolated worktree.
2. Keep frontend, backend, and deploy-surface changes separated unless the
   release explicitly needs them together.
3. Open a pull request into `main`.
4. Wait for required checks.
5. Verify the Cloudflare Pages preview for frontend changes.
6. Review and merge to `main`.
7. Let Cloudflare Pages publish the production deployment.
8. Run the release smoke gates below before calling the release complete.

## Frontend Smoke Gates

Run these after the Cloudflare Pages production deployment finishes:

- `https://heyvera.org/` returns `200`.
- `https://www.heyvera.org/` either returns `200` or redirects cleanly to
  `https://heyvera.org/`.
- The live HTML references the expected built asset bundle.
- The referenced JavaScript and CSS assets return `200`.
- Browser smoke passes on desktop and mobile widths for the public homepage.
- No console errors block first render.
- The production deployment in Cloudflare Pages points at the expected `main`
  commit.

## Backend And Same-Domain API Gates

Before treating same-domain API calls as production-ready:

- Backend `/v1` is deployed and has its own health/deploy metadata check.
- A Cloudflare Pages Function exists for `/v1/*`.
- The Pages Function preserves method, path, query string, request body, and
  required auth headers.
- CORS/cookie/auth behavior is verified for the production domain.
- A representative unauthenticated `/v1` read returns the expected status.
- A representative authenticated `/v1` request reaches the backend with auth
  intact.
- Failure behavior is intentional: backend errors surface as API errors, not
  as the frontend SPA fallback.

Until those are true, same-domain `/v1/*` is a planned integration point, not
a completed production path.

## Rollback Gates

Before release:

- Identify the previous good Cloudflare Pages production deployment.
- Confirm Cloudflare rollback permission exists for the operator handling the
  release.
- Confirm the rollback target belongs to the intended project and domain.
- If a Pages Function changed, confirm the previous good Function state or
  commit is known.
- If backend behavior changed, confirm frontend rollback remains compatible
  with the live backend contract.

After rollback:

- Re-run the frontend smoke gates.
- Re-run same-domain `/v1/*` gates if a Pages Function or API route was part
  of the release.
- Record the rolled-back deployment and reason in the release notes or
  incident log.

## Stop Conditions

Do not call the release complete if:

- Cloudflare Pages production points at an unexpected commit.
- `heyvera.org` serves stale or missing assets after cache settles.
- `/v1/*` is expected by the frontend but has no Pages Function proxy.
- API paths are swallowed by the SPA fallback.
- There is no known previous good Pages deployment for rollback.
- Production env vars are assumed from setup notes instead of verified against
  the code path that actually runs.
