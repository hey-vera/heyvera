# Homepage Live Integration

This file explains why the new homepage is not live on `heyvera.org` yet
and what has to change to make `web/` the production public surface.

Important correction:
- the repo contains two different production stories
- the frontend workflow docs point to Cloudflare Pages as the intended
  public-site delivery path
- the root deploy script and `Caddyfile` still reflect an older VPS-served
  public-site model

For the current homepage launch, prefer the Cloudflare Pages path unless
live infra truth proves otherwise.

## Verified Current Truth

Read date: 2026-05-06.

### Homepage implementation truth

- the new homepage exists in `web/`
- the built app is a Vite React app
- the homepage work is currently local and uncommitted

Relevant files:
- `web/src/*`
- `web/index.html`
- `web/package.json`

### Frontend workflow truth

The current frontend workflow docs assume:
- `web/` is the public site
- Cloudflare Pages is the delivery surface
- `main` is the production branch
- `web/` is the project root for the Cloudflare Pages build

Relevant files:
- `web/AGENTS.md`
- `web/frontend-sync/ADMIN-CHECKLIST.md`
- `web/SETUP.md`

### Root repo deploy truth

The root production deploy path still assumes:
- public site assets come from `site/`
- dashboard assets come from `dashboard/dist/`
- `heyvera.org` serves `/var/www/heyvera`
- `/dashboard/*` serves `/var/www/heyvera-dashboard`

Relevant files:
- `.github/workflows/deploy-production.yml`
- `scripts/deploy.sh`
- `Caddyfile`

### Critical mismatch

The new homepage is not live because the repo does not present one clean
production truth.

More specifically:
- frontend docs point to Cloudflare Pages for `web/`
- root deploy infra still expects a legacy `site/` path
- there is currently no `site/` directory in the repo
- the homepage lives in `web/`

That means the real task is:
- choose the canonical publish path
- remove ambiguity
- and then use that path consistently

## Correct Product Decision

For current frontend truth, the right decision is:

- `web/` should become the production public site for `heyvera.org`
- Cloudflare Pages should be treated as the preferred homepage delivery
  path
- `dashboard/` should remain the separate built SPA served under
  `/dashboard/`
- do not revive the old `site/` model as the main public surface unless
  infra truth explicitly forces it

Reason:
- all current public-site planning truth points at `web/`
- the new homepage is already built there
- `web/AGENTS.md` and `frontend-sync/ADMIN-CHECKLIST.md` already point to
  Cloudflare Pages
- keeping `site/` as the canonical public surface would duplicate the
  product truth and reintroduce drift

## Preferred Integration Path

### Preferred path: Cloudflare Pages

Use this if the `web/` Cloudflare project is still connected to the repo
and the custom domain for `heyvera.org` is attached there.

What must be true:
- Cloudflare repo integration is real
- project root is `web`
- build command is `npm run build`
- output directory is `dist`
- production branch is `main`

In that model, the homepage goes live when:
1. the homepage changes are isolated cleanly
2. the frontend branch is pushed
3. preview looks good
4. the work merges to `main`
5. Cloudflare Pages publishes the production build to `heyvera.org`

### Secondary path: VPS-served public site

Use this only if live infra truth shows `heyvera.org` is still being served
from the VPS path in `scripts/deploy.sh` and `Caddyfile`.

That path would require:
- teaching deploy to build `web/`
- changing the VPS-served root site behavior

This should be treated as the fallback interpretation, not the default one.

## Required Integration Work

There are four real steps.

### Step 1 - Clean git boundary first

Do not publish from the current branch state yet.

Why:
- the branch is dirty
- the branch is diverged
- there are many unrelated repo changes present

Manager requirement:
- isolate the homepage and publish-path work cleanly before production
  movement

### Step 2 - Confirm the canonical live path

Manager job:
- confirm whether `heyvera.org` is attached to the Cloudflare Pages `web/`
  project
- if yes, stop treating the homepage launch as blocked on the VPS
  static-site flow
- if no, treat the VPS path as the fallback integration target

### Step 3 - If Cloudflare is canonical, clean the branch -> preview -> main flow

Needed behavior:
- isolate homepage work from unrelated repo dirt
- push the frontend branch cleanly
- verify Cloudflare preview
- merge to `main`
- let Cloudflare publish production

Minimum desired outcome:
- `heyvera.org` updates from the `web/` Cloudflare project

### Step 4 - Only if VPS is still canonical, rewire deploy to publish `web/`

Needed behavior:
- run `npm ci` and `npm run build` inside `web/`
- sync `web/dist/` to `/var/www/heyvera`
- update `Caddyfile` so the root public app is served as an SPA while
  preserving dashboard and API routing

## Safe Execution Order

1. confirm whether Cloudflare Pages or VPS is the canonical homepage path
2. isolate homepage publish-path work from unrelated repo dirt
3. if Cloudflare is canonical, clean the branch -> preview -> main flow
4. if VPS is canonical, patch `scripts/deploy.sh` and `Caddyfile`
5. verify the chosen path cleanly
6. publish
7. verify `heyvera.org` live

## Not The Right Move

Avoid these shortcuts:
- manually copying local files to the server and calling it done
- rebuilding a parallel `site/` copy of the homepage
- deploying from the current dirty branch without isolating the slice
- changing the homepage and publish path in the same messy commit as
  unrelated backend work
- assuming the VPS path is canonical when the frontend workflow docs point
  to Cloudflare Pages

## Exact Manager Read

The homepage itself is not the blocker anymore.

The blocker is production integration:
- `web/` is now the intended public surface
- the repo contains conflicting production stories
- frontend docs point to Cloudflare Pages
- root deploy infra still points to a legacy `site/` path that is not even
  present

So the next real work item is:
- homepage-to-production integration for `web/`, with Cloudflare Pages as
  the preferred publish path unless infra truth proves otherwise

Not:
- redesigning the homepage again
- starting socials
- starting marketplace
- starting crypto
