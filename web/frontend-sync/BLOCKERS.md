# Frontend Blockers

Use this file when Qwen or Xotic hits something they should not guess.

## Add An Entry When

- the docs seem to conflict
- the current packet is unclear
- the design starts drifting
- the app has an error that is not obvious to fix
- a product decision is required
- a backend assumption becomes relevant unexpectedly

## Entry Format

```text
## [DATE] Packet N - Short title
- Type: error | ambiguity | design drift | scope question | doc conflict
- What happened:
- What was tried:
- Why it is blocked or risky:
- What answer is needed:
```

## Open Blockers

- None currently

## Recently Resolved

## [2026-05-11] Next signed-in packet files missing
- Type: doc conflict
- What happened: a handoff referenced missing packet files that were not
  present in this repo.
- What was tried: verified the committed `frontend-plan/` files,
  reconciled the packet system with the real shell-baseline branch, and
  authored `PACKET-4-EXEC.md` and `PACKET-5-EXEC.md` in this branch.
- Why it was blocked or risky: Xotic could not safely start the next
  signed-in pass from chat-only packet names.
- Resolution: the next execution-ready packet now lives in
  `frontend-plan/PACKET-5-EXEC.md`.
