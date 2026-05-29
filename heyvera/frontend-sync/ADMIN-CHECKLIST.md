# Frontend Admin Checklist

This is the human-admin checklist for turning the repo-side workflow
into a fully automated frontend delivery loop.

Use this after the repo files are in place.

## Goal

Make the frontend workflow:
- safer
- more automatic
- easier for a first-time vibe coder
- easier to review while multiple people work at once

## GitHub Admin Checklist

### 1. Protect `main`

In GitHub:
- Settings
- Rules
- Rulesets or Branch protection

Turn on for `main`:
- require a pull request before merging
- require at least 1 approval
- require status checks to pass before merging
- require branches to be up to date before merging
- block force pushes to `main`
- block direct pushes to `main`

Required checks to add after the first CI run:
- `api`
- `web`
- `runtime-floor`

### 2. Enable auto-merge

In repository settings:
- enable auto-merge

Use this for packet PRs once:
- required checks pass
- review is approved

### 3. Verify CODEOWNERS routing

Check that GitHub recognizes:
- `.github/CODEOWNERS`
- `/web/`
- `/web/frontend-plan/`
- `/web/frontend-sync/`

Goal:
- PRs touching `web/**` request the right reviewer automatically

### 4. Use draft PRs by default for packets

Working rule:
- open a draft PR as soon as Packet 1 work starts
- keep pushing to that PR until the packet is reviewable
- convert to ready-for-review only when the packet is done

### 5. Use the frontend blocker issue form only when needed

Check that the new issue type appears:
- `Frontend blocker`

Use it for:
- durable blockers
- repeated ambiguity
- anything too important to leave only in markdown notes

## Cloudflare Admin Checklist

### 1. Confirm GitHub repo integration

In Cloudflare Pages:
- verify the HeyVera repo is connected
- verify the `web/` project is linked to the correct repo

### 2. Confirm build settings

For the `web/` project:
- production branch: `main`
- build command: `npm run build`
- build output directory: `dist`
- root directory: `web`

### 3. Confirm preview deployments

Turn on or verify:
- preview deployments for pull requests
- branch previews for non-production branches

Goal:
- every packet PR gets a preview URL automatically

### 4. Optional: protect previews

If needed, add Cloudflare Access to preview deployments so:
- only approved people can view previews

This is optional for now, but useful if previews should stay private.

### 5. Record preview URLs in PRs

Working rule:
- copy the Cloudflare preview URL into the PR template
- optionally also add it to `web/frontend-sync/STATUS.md`

## Review Workflow Checklist

When a packet is ready:
- Xotic commits and pushes
- Xotic updates `web/frontend-sync/STATUS.md`
- Xotic logs blockers if needed
- GitHub Actions runs
- Cloudflare generates preview URL
- Josh reviews the PR plus preview plus `frontend-sync/` notes
- if approved, enable auto-merge or merge normally

## Quality Checklist

Before merging a packet PR:
- preview URL works
- CI checks are green
- packet stayed in scope
- mobile was checked
- no dashboard drift
- no crypto-first drift
- blockers were recorded instead of guessed through

## What Not To Automate Blindly

Do not automate:
- auto-pull into dirty local branches
- direct commits to `main`
- auto-merge without review
- AI-driven product decisions without docs
