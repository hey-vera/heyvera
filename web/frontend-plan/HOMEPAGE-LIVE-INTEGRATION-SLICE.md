# Homepage Live Integration Slice

This is the execution-ready slice for making the new `web/` homepage
become the live `heyvera.org` public surface.

Important correction:
- the frontend workflow docs point to Cloudflare Pages as the intended
  homepage delivery path
- the root repo deploy files still reflect an older VPS-served public-site
  model

So this slice starts by resolving that publish-path conflict explicitly.

Use this after the homepage itself is already accepted.

## Goal

Make `heyvera.org` serve the `web/` homepage through the canonical publish
path, without breaking:
- `/dashboard/*`
- `/api/*`
- `/v1/*`
- other existing proxied backend paths

## Required File Set

Primary implementation files when Cloudflare is canonical:
- frontend branch state and merge path
- `web/frontend-sync/STATUS.md` if needed for review continuity
- optionally frontend workflow docs if they need a small cleanup

Primary implementation files only if VPS is canonical:
- `scripts/deploy.sh`
- `Caddyfile`

Supporting docs to update in the same slice:
- `docs/operations/release.md`

Optional but nice if touched carefully:
- `docs/operations/runbook.md`

Do not widen this slice into homepage redesign or unrelated backend work.

## Verified Starting Truth

- the public homepage is implemented in `web/`
- `web/package.json` and `web/package-lock.json` exist
- `web/AGENTS.md` says the stack includes Cloudflare Pages
- `web/frontend-sync/ADMIN-CHECKLIST.md` says the `web/` project should be
  linked to Cloudflare Pages with:
  - production branch `main`
  - root directory `web`
  - build command `npm run build`
  - output directory `dist`
- root production deploy still syncs `site/` to `/var/www/heyvera`
- there is no `site/` directory in the repo
- `dashboard/` is already built and deployed separately to
  `/var/www/heyvera-dashboard`

## Branch Safety Rule

Do not do this integration in the current dirty branch state.

Manager expectation:
- isolate homepage live-integration work into a clean branch or worktree
- avoid mixing it with the unrelated modified files already in the repo

## Exact Behavior Change

### 1. Resolve the canonical publish path

Preferred answer:
- Cloudflare Pages is canonical for the homepage
- VPS deploy remains canonical for API/backend infrastructure

Manager acceptance criteria:
- the team stops treating homepage launch as blocked on `scripts/deploy.sh`
  unless live domain truth proves otherwise

### 2. If Cloudflare is canonical, clean the homepage publish loop

Required behavior:
- isolate homepage-related changes from unrelated repo dirt
- push a clean frontend branch
- verify the Cloudflare preview is correct
- merge to `main`
- confirm production auto-publishes to `heyvera.org`

Required checks:
- preview URL is green
- homepage matches accepted scope
- `main` receives the correct homepage commit
- `heyvera.org` updates after the production Pages build

### 3. Only if VPS is canonical, deploy script should build and publish `web/`

Current broken assumption:
- `scripts/deploy.sh` expects `site/`

Target behavior:
- build `web/`
- sync `web/dist/` to `/var/www/heyvera`

Suggested shape:

1. add public-site path variables near the top:
   - `PUBLIC_SITE_DIR="${PUBLIC_SITE_DIR:-$REPO_DIR/web}"`
   - `PUBLIC_SITE_WWW="${PUBLIC_SITE_WWW:-/var/www/heyvera}"`
2. replace the old `site/` sync block with:
   - `cd "$PUBLIC_SITE_DIR"`
   - `npm ci`
   - `npm run build`
   - `cd "$REPO_DIR"`
   - `rsync -a --delete "$PUBLIC_SITE_DIR/dist/" "$PUBLIC_SITE_WWW/"`
3. keep dashboard deploy logic separate and intact

Acceptance condition:
- after deploy, `/var/www/heyvera` contains the built Vite output from
  `web/dist/`

### 4. Only if VPS is canonical, Caddy should serve the public app as the root SPA

Current broken assumption:
- root public site is treated like an old clean-URL static HTML tree

Target behavior:
- preserve `/dashboard/*` handling
- preserve API and backend proxy handling
- serve the public site from `/var/www/heyvera` with SPA fallback

Suggested shape for `heyvera.org, www.heyvera.org`:

1. keep:
   - `/dashboard/*` -> `/var/www/heyvera-dashboard`
   - `/api/*` reverse proxy
   - `/portal*` reverse proxy
   - `/v1/*`, `/x402/*`, `/mcp/*`, `/health`, `/.well-known/*`, `/a2a/*`,
     `/feed.xml`, `/llms.txt` reverse proxy rules
2. remove the old root-level static-site clean-URL assumption:
   - `try_files {path} {path}.html {path}/index.html`
3. replace it with a final public-site SPA handler similar to:

```caddy
	handle {
		root * /var/www/heyvera
		try_files {path} /index.html
		file_server
	}
```

Important ordering rule:
- API and dashboard handlers must stay above the final SPA fallback block

Acceptance condition:
- non-file public paths fall back to `/index.html`
- dashboard still works
- API paths do not get swallowed by the SPA

### 5. Release docs should reflect the new truth

Update `docs/operations/release.md` so it no longer implies the root site is
unambiguously a VPS-served legacy static `site/` directory.

Minimum doc change:
- say the homepage/public site currently prefers the `web/` Cloudflare Pages
  path
- say the dashboard deploy still builds from `dashboard/`
- if VPS remains relevant, describe it as the backend/server deploy path

## Preflight Checks

Before any publish attempt:

1. local `web` build passes
2. local `dashboard` build still passes if relevant to touched config
3. branch/worktree is clean for this slice
4. if Cloudflare is canonical, preview wiring is understood
5. if VPS is canonical, deploy script diff is isolated and readable
6. if VPS is canonical, Caddy routing order is reviewed carefully

## Production Verification

After publish:

1. open `https://heyvera.org`
2. confirm the new homepage is visible
3. open `https://heyvera.org/dashboard/`
4. confirm dashboard still loads
5. hit `https://api.heyvera.org/api/deploy-info`
6. hit `https://heyvera.org/api/deploy-info` if same-origin proxy is relied on

## Known Risk Notes

### Cloudflare project truth risk

This path only works cleanly if:
- the `web/` Cloudflare project still exists
- the custom domain is attached correctly
- production really maps from `main`

Those need confirmation before we treat Cloudflare as the live path.

### Node version on the VPS

`web` uses Vite 7, which requires a modern Node runtime.

That matters only if the VPS path turns out to be canonical for the public
site.

### Dirty branch risk

The current repo has many unrelated modified files.

This is a deployment-integrity risk, not just a git hygiene issue.

### Publish-path ambiguity risk

The repo currently tells two stories:
- Cloudflare Pages in `web/`
- VPS static site in root deploy infra

This slice should reduce that ambiguity, not deepen it.

### Scope creep risk

Do not combine this slice with:
- OG/meta polishing
- favicon work
- homepage copy rewrites
- socials planning
- marketplace planning
- crypto planning

## Done When

This slice is done when:
- the canonical homepage publish path is explicit
- `heyvera.org` serves the `web` app
- if Cloudflare is canonical, preview -> main -> production works cleanly
- if VPS is canonical, deploy builds `web/` correctly
- dashboard and API routes still work
- release docs describe the new production truth
