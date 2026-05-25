# Homepage Live Integration Slice

Status: current

This is the execution slice for keeping the live `heyvera.org` public
frontend aligned with the canonical production path.

## Goal

Ship public frontend changes through Cloudflare Pages without breaking:

- `https://heyvera.org/`
- `https://www.heyvera.org/`
- future same-domain `/v1/*`
- backend/API deployment independence

## Canonical Path

- `heyvera.org` is canonical for the public frontend.
- Cloudflare Pages is canonical for the public `web/` deploy.
- Production deploys from `main`.
- Build settings: root `web`, command `npm run build`, output `dist`.
- `.github/workflows/deploy-frontend.yml` is not the current canonical public
  frontend deploy path.

## Required Work

1. Keep public frontend work isolated on a branch or worktree.
2. Verify the Cloudflare Pages preview before merge.
3. Merge reviewed work to `main`.
4. Let Cloudflare Pages publish production.
5. Run the smoke gates in `docs/operations/release.md`.
6. Update `docs/reference/heyvera-production-checklist.md` if a gate changes
   state.

## Same-Domain `/v1/*`

Do not mark same-domain API complete until:

- backend `/v1` is live
- a Cloudflare Pages Function proxies `/v1/*` to the backend
- the proxy preserves method, query string, body, auth headers, and backend
  status codes
- representative authenticated and unauthenticated API requests pass smoke
- API errors are returned as API errors and are not swallowed by the SPA

## Rollback

Before release, identify the previous good Cloudflare Pages deployment. If
the release includes a Pages Function, identify the previous good Function
state as well.

Rollback is complete only after:

- Cloudflare Pages serves the previous good deployment
- `https://heyvera.org/` passes smoke again
- `/v1/*` smoke passes again if the Function or backend path was involved

## Done When

- `heyvera.org` serves the expected `web/` production build from Cloudflare
  Pages.
- The production deployment maps to the expected `main` commit.
- Release smoke gates pass.
- Rollback target is known.
- Same-domain `/v1/*` is either verified through a Pages Function or clearly
  marked incomplete.
