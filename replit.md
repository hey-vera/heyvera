# heyvera / ClawNet — Replit workspace

## Project overview

Monorepo at `github.com/hey-vera/heyvera`. Three distinct apps:

| App | Dir | Port | Served at |
|---|---|---|---|
| Backend API (Hono) | `src/` | 3000 | `api.claw-net.org` (Docker on VPS) |
| Internal dashboard | `dashboard/` | 5000 | `claw-net.org/dashboard` (VPS via deploy script) |
| HeyVera public/app frontend | `web/` | 5001 (dev) | `heyvera.org` (Cloudflare Pages, auto-deploys from `main`) |

## Correct push flow

### 1. Push feature branch to GitHub
```bash
git push "https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/hey-vera/heyvera.git" feat/identity-lite-shell
```

### 2. Merge web/ changes to main (for Cloudflare / heyvera.org)
Branch protection blocks direct pushes to main (requires 3 CI checks: `api`, `web`, `runtime-floor`). Use the clean-branch flow:

- Get blob SHAs for changed `web/` files from the feature branch HEAD
- Create a new git tree on top of main's tree with those blobs
- Commit it as a child of main's HEAD
- Push as `feat/web-updates`, open a PR, poll CI until `api` + `web` + `runtime-floor` all pass
- Squash merge the PR

Cloudflare Pages watches `main` and auto-deploys `web/` to heyvera.org on every merge. No manual trigger needed for heyvera.org.

### 3. Deploy backend + dashboard to VPS (claw-net.org)
Trigger the `deploy-production.yml` workflow manually via GitHub API:
```bash
curl -s -X POST \
  -H "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hey-vera/heyvera/actions/workflows/deploy-production.yml/dispatches" \
  -d '{"ref":"main","inputs":{"branch":"main"}}'
```
This SSHes into the VPS over Tailscale and runs `scripts/deploy.sh`, which builds `dashboard/` and syncs `site/`. It does **not** touch `web/`.

## What deploys where

| Change type | Needs step 2 (PR merge) | Needs step 3 (VPS deploy) |
|---|---|---|
| `web/` (heyvera.org frontend) | yes | no |
| `dashboard/` (internal SPA) | no | yes |
| `src/` (API / backend) | no | yes |
| `site/` (static claw-net.org) | no | yes |

## Key notes

- `git remote set-url` is blocked in Replit sandbox — always use the inline token URL for pushes
- The "Add issue or PR to org project" CI check always fails (missing secret) — safe to ignore, not a required check
- The "Cloudflare Pages" check in CI is the heyvera.org production build — success there means the site updated
- Changes to the signed-in shell (`VeraSocials`, `IdentityRegion`, etc.) only appear after logging in on heyvera.org
- Always auto-merge `web/` changes to `main` for heyvera.org using the clean-branch + PR flow above

## Local workflows

- **Backend API**: `npm run dev` → port 3000
- **Start application** (dashboard): `cd dashboard && npm run dev` → port 5000

## User preferences

- Keep pushes and deploys automated end-to-end — no manual steps
