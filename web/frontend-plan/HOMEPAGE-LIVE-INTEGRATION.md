# Homepage Live Integration

Status: canonical

Read date: 2026-05-25.

This file records the production integration truth for the public HeyVera
homepage.

## Current Decision

- `heyvera.org` is the canonical public frontend domain.
- `web/` is the public frontend app.
- Cloudflare Pages is the canonical public frontend deploy path.
- Cloudflare Pages production deploys from `main`.
- The Cloudflare Pages build uses root `web`, command `npm run build`, and
  output directory `dist`.
- `.github/workflows/deploy-frontend.yml` is not the current canonical public
  frontend deploy path. Treat it as legacy/VPS-oriented automation unless a
  future ADR changes that.

## Same-Domain API Rule

The desired same-domain API shape is:

- public frontend: `https://heyvera.org`
- same-domain API: `https://heyvera.org/v1/*`
- backend origin: the live backend `/v1` service

That same-domain path is not complete from Cloudflare Pages static hosting
alone. After the backend `/v1` surface is live, `web/` needs a Cloudflare
Pages Function that proxies `/v1/*` to the backend.

The Function must preserve:

- HTTP method
- path and query string
- request body
- auth headers and other required API headers
- backend status codes and API error bodies

API paths must not fall through to the frontend SPA fallback.

## Release Smoke

After a production Pages deploy:

1. Open `https://heyvera.org/`.
2. Confirm the public homepage renders.
3. Confirm the live HTML references the expected built assets.
4. Confirm the referenced JavaScript and CSS assets return `200`.
5. Check desktop and mobile widths.
6. Confirm Cloudflare Pages production points at the expected `main` commit.
7. If `/v1/*` is in release scope, verify representative same-domain API
   requests reach the backend through the Pages Function.

## Rollback Gate

Before calling the release complete:

- identify the previous good Cloudflare Pages production deployment
- confirm the operator can roll back to it
- identify the previous good Pages Function state if `/v1/*` proxy behavior
  changed
- confirm frontend rollback remains compatible with the live backend contract

After rollback, repeat the release smoke.

## Not Current Truth

- The public homepage is not blocked on VPS static-site deployment.
- The old `site/`-style VPS public-site model is not canonical for
  `heyvera.org`.
- `.github/workflows/deploy-frontend.yml` does not define the current
  canonical public frontend deploy path.
