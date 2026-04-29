# Frontend Sync

This folder is the shared repo-native communication lane for frontend
implementation.

Use it so Xotic, Josh, and any reviewer can coordinate without copying
every small blocker into chat.

## Purpose

Use this folder to record:
- current packet status
- blockers and unknowns
- decisions that need human input
- resolved decisions
- review notes after a packet is done

## Files

- `STATUS.md`
  - current packet
  - what is in progress
  - what was last finished

- `BLOCKERS.md`
  - errors
  - unknowns
  - conflicting docs
  - anything Qwen or Xotic cannot safely resolve alone

- `DECISIONS.md`
  - decisions Josh made
  - design corrections
  - scope freezes
  - anything that should stop the same question from repeating

- `REVIEWS.md`
  - packet review notes
  - what to tighten before moving on

- `GIT-SYNC.md`
  - when to fetch
  - when to pull
  - how Josh and Xotic stay in sync safely

- `ADMIN-CHECKLIST.md`
  - GitHub and Cloudflare admin setup
  - required toggles for a safer automated workflow

## Working Rule

When a problem appears:
- if it is a simple implementation fix, solve it
- if it is a product, design, scope, or ambiguity problem, log it here
- if it blocks the current packet, add it to `BLOCKERS.md`
- if Josh answers it, record the answer in `DECISIONS.md`

## Update Style

Keep entries:
- short
- dated
- packet-specific
- easy to scan

Do not write long essays here.

## Human Loop

Josh can read this folder directly.
Codex can read this folder directly.

That means Xotic does not need to manually relay every small issue
through chat as long as the important unknowns are recorded here.
