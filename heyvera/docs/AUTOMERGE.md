# HeyVera PR → main (full green + automerge)

Use this for every shipping chunk so branches do not go stale.

## Defaults

| Setting | Value |
|---------|--------|
| Base | `main` |
| Merge style | **squash** |
| Automerge | **on** after PR open |
| Required today (branch protection) | `api`, `web`, `runtime-floor` |
| Also wait for (full green) | `heyvera`, `rust`, Cloudflare heyvera when present |

## Open PR + automerge (copy-paste)

```bash
# Auth (this env): GH_TOKEN from git credentials
export GH_TOKEN
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | awk -F= '/^password=/{print $2}')

BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"

# Create PR if missing
if ! gh pr view --json number -q .number >/dev/null 2>&1; then
  gh pr create --base main --fill
fi

# Automerge when green (squash)
gh pr merge --auto --squash

# Optional: watch until merged
gh pr checks --watch
```

Or one-liner after branch is pushed:

```bash
gh pr create --base main --fill && gh pr merge --auto --squash
```

## Agent rules

1. Prefer small PRs that stay green.
2. Always enable `--auto --squash` after open.
3. If a check fails: fix on the same branch, push, automerge stays armed.
4. After merge: `git checkout main && git pull` before next work.
5. Do not leave long-lived feature branches after merge; delete remote branch if still open.

## Workflow scope note

Updating `.github/workflows/*` needs a token with **`workflow`** scope. Product PRs without workflow file changes merge fine with current `repo` scope.

## Required checks to tighten later (admin)

Once CI is stable, add **`heyvera`** and **`rust`** as required status checks on `main` so automerge truly means full green, not only legacy `api`/`web`/`runtime-floor`.
