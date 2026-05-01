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
Do not write placeholder values here.

Use exact live values only for:
- branch name
- last pushed commit
- ready-for-review state

If an exact value is not known yet:
- leave it blank
- or update it after the push

Preferred status path:
- use `npm run status:update -- "Packet N" yes`
- do not type commit hashes into `STATUS.md` by hand unless the script
  is unavailable

## Human Loop

Josh can read this folder directly.
Codex can read this folder directly.

That means Xotic does not need to manually relay every small issue
through chat as long as the important unknowns are recorded here.

## Low-Friction Review Loop

Preferred flow:
- Xotic builds one packet
- Xotic pushes the branch
- Xotic updates `STATUS.md` briefly
- Xotic stops
- Josh/Codex inspect the actual code, diff, CI state, and notes directly
- Josh/Codex decide whether to:
  - approve and move forward
  - give a tighter next prompt
  - correct drift
  - fix a small issue directly

This means the default is not:
- "Xotic must self-audit everything first"

The default is:
- "push the state, then review from the real repo state"

Packet-complete rule:
- a packet is not considered handed off until the branch is pushed
- `STATUS.md` should include the last pushed commit and whether the
  branch is ready for review
- "local only" is still in-progress, not review-ready

Proof rule:
- before claiming a packet is done, verify the actual files show the
  packet work
- preferred proof:
  - `npm run proof`
- if the files do not visibly contain the packet scope, the packet is
  not done yet
