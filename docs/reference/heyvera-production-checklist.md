# HeyVera Production Completion Checklist

Status: canonical

Verified against `main` on 2026-05-25. This checklist records the production
completion gates for the public HeyVera frontend and the future same-domain
API path.

## Evidence Rules

- `[x]` means the repo or live production decision currently establishes the
  item.
- `[ ]` means the item is not implemented, not verified, or still needs a
  release gate.
- Re-check this file against `main` and live Cloudflare/backend state before
  calling a production release complete.

## Canonical Public Frontend

- [x] `heyvera.org` is the canonical public frontend domain.
- [x] Cloudflare Pages is the canonical deploy surface for the public
  `web/` frontend.
- [x] Cloudflare Pages production deploys should track `main`.
- [x] Cloudflare Pages build settings are documented as root `web`, build
  command `npm run build`, output `dist`.
- [x] `.github/workflows/deploy-frontend.yml` is documented as not the
  current canonical public frontend deploy path.
- [ ] Cloudflare Pages production deployment has been verified against the
  expected `main` commit for the release.
- [ ] Cloudflare Pages preview URL has been checked before merge.

## Same-Domain API Path

- [x] Same-domain `/v1/*` is the desired public API path for frontend calls
  once the backend `/v1` surface is live.
- [ ] Backend `/v1` is live and verified with health/deploy metadata.
- [ ] A Cloudflare Pages Function proxies `https://heyvera.org/v1/*` to the
  backend.
- [ ] The Pages Function preserves methods, headers, bodies, query strings,
  and auth material.
- [ ] `/v1/*` failures return API errors instead of falling through to the
  frontend SPA.
- [ ] Authenticated and unauthenticated representative `/v1` requests have
  passed production smoke.

## Release Smoke Gates

- [ ] `https://heyvera.org/` returns `200`.
- [ ] `https://www.heyvera.org/` returns `200` or redirects cleanly to the
  apex domain.
- [ ] Live HTML references the expected built asset bundle.
- [ ] Referenced JavaScript and CSS assets return `200`.
- [ ] Desktop and mobile browser smoke tests pass.
- [ ] No console error blocks first render.
- [ ] Cloudflare Pages production deployment points at the expected `main`
  commit.
- [ ] If same-domain API is in scope, `https://heyvera.org/v1/*` reaches the
  backend through a Pages Function.

## Rollback Gates

- [ ] Previous good Cloudflare Pages production deployment is identified.
- [ ] Operator has permission to roll back the Pages deployment.
- [ ] If a Pages Function changed, the previous good Function state or commit
  is identified.
- [ ] If backend behavior changed, frontend rollback compatibility with the
  live backend contract is confirmed.
- [ ] Rollback smoke procedure is documented in `docs/operations/release.md`.

## Completion Rule

Production completion requires the frontend smoke gates, applicable
same-domain API gates, and rollback gates to pass. Prepared DNS, env vars, or
workflow files are not sufficient evidence unless the live path actually uses
them.
