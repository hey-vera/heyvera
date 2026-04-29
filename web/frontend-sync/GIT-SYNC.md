# Frontend Git Sync

This file defines the low-friction git sync workflow for HeyVera
frontend work.

## Why This Exists

Josh, Xotic, and reviewers may all be working from different local
clones or branches.

That means:
- Xotic will not automatically see new docs unless he fetches them
- Josh will not automatically see Xotic's commits unless he fetches them
- nobody should use blind `git pull` habits on a dirty tree

## Core Rule

Do not assume local files are current.

Before starting a packet, before review, and after a teammate says
"there are updates," do a sync check.

## Xotic Workflow

### Before starting work

1. Check branch and local changes:

```bash
git status
```

2. Fetch remote updates:

```bash
git fetch origin
```

3. If your current frontend branch tracks a remote branch and you have
   no uncommitted work, sync it:

```bash
git pull --rebase
```

4. Re-read the frontend docs if the sync brought changes in `web/`.

### Branch shape

Prefer one short-lived branch per packet or packet group.

Examples:
- `xotic/web-packet-1-foundation`
- `xotic/web-packet-2-core-sections`
- `xotic/web-packet-3-supporting-sections`

### Pull request shape

Open a draft PR early.

Why:
- preview deploys can attach to the PR
- review can start earlier
- packet status is easier to track
- the PR becomes part of the communication lane

### Before starting the next packet

Run:

```bash
git fetch origin
git status
```

If there are new remote commits on the branch you are using:
- sync first
- then continue

### After finishing a packet

1. Commit the packet cleanly
2. Push the branch
3. Update `frontend-sync/STATUS.md`
4. Tell Josh the packet is ready for review

## Josh Workflow

### Before reviewing Xotic's work

1. Fetch remote updates:

```bash
git fetch origin
```

2. Inspect the branch or commit Xotic pushed
3. Review the code and `frontend-sync/` notes together

### Important

If Josh's local tree is dirty:
- do not use blind `git pull`
- review carefully
- prefer fetching first and deciding intentionally how to inspect or
  merge changes

## When Not To Pull

Do not run `git pull` automatically if:
- you have uncommitted local changes
- you are not sure which branch you are on
- you do not know whether the remote changes are intended for your lane

In those cases:
- run `git status`
- run `git branch`
- run `git fetch origin`
- decide intentionally

## Best Practical Shape

The safest working model is:
- Xotic works on one frontend branch
- pushes after each packet
- opens a draft PR for the packet
- Josh fetches and reviews
- decisions get recorded in `frontend-sync/DECISIONS.md`
- blockers get recorded in `frontend-sync/BLOCKERS.md`

## Communication Rule

If someone says:
- "I updated the docs"
- "I pushed Packet 1"
- "there are fixes on main"

that is a signal to run a sync check, not to assume your local copy is
already current.
