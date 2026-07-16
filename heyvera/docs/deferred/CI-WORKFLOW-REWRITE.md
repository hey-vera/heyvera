# Deferred: root GitHub Actions rewrite

**Status:** not applied on `phase-0-heyvera-ship` (push OAuth lacked `workflow` scope).  
**Saved so we never lose the intent.** Re-apply in a tiny follow-up PR after auth has `repo` + `workflow` scopes.

## Why

`origin/main` CI still carries legacy root Node / optional paths. We want CI that always checks:

1. **heyvera** frontend: `cd heyvera` → typecheck, unit tests, build  
2. **rust**: `cargo check --workspace --locked` + `cargo test --workspace --lib --locked`

## What main already has (do not regress)

- `deploy-frontend.yml` already builds **`heyvera/`** (not `web/`) and can pass `VITE_API_URL` — **keep that env** when re-applying.
- Some “skip if no package.json” guards exist — optional to keep for monorepo safety.

## Proposed target

See sibling file `ci.yml.proposed` (snapshot from local foundation work, 2026-07-16).

## Apply steps (human or agent)

```bash
gh auth login --scopes 'repo,workflow'   # if needed
cp heyvera/docs/deferred/ci.yml.proposed .github/workflows/ci.yml
# review deploy-frontend.yml — only change if still wrong
git checkout -b chore/ci-heyvera-jobs
git add .github/workflows/ci.yml
git commit -m "ci: always run heyvera frontend + rust workspace checks"
git push -u origin HEAD
gh pr create --fill
```

## Do not

- Delete rust job  
- Point frontend back at `web/`  
- Drop `VITE_API_URL` from deploy-frontend without intentional reason  
