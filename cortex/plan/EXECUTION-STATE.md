# Cortex execution state

Running checkpoint for the actualization of
`cortex/plan/HARNESS-EXCELLENCE-PLAN-2026-08.md`. Update this file as work
lands; an interrupted session should be able to resume from it without
re-deriving anything.

**Last updated:** 2026-08-09
**Base commit at start:** `c8ca2941` (main — "clear all seven open dependency advisories (#498)")

---

## Status

| Task | What | State |
|---|---|---|
| 1 | Land the harness plan on `main` | **done** — PR [#500](https://github.com/hey-vera/heyvera/pull/500) merged |
| 1a | Split-out auth commit from the same branch | branch `fix/auth-remove-subscription-flow` pushed, **PR deliberately not opened** — see F1 |
| 2 | Briefs for PR C, PR A, PR B | **done** — PR [#501](https://github.com/hey-vera/heyvera/pull/501) merged |
| 3 | Implement PR C (execution sandbox) | implemented on `feat/pr-c-execution-sandbox` |

## PR C — what landed, and what it deliberately did not

Six commits, each independently green:

1. `crates/core/src/execution_job.rs` — the full field set, version 1.
2. `crates/worker/src/sandbox/` — trait, container implementation, policy.
3. `crates/worker/src/executor.rs` — sandbox routing, fallback deleted.
4. Executor regression tests.
5. Migration v62 + `record_execution_job` + protocol field.
6. Adversarial tests against a real runtime + `Dockerfile.sandbox` + CI job.

**Two exposures closed, not one.** The known one was the worktree fallback. The
second was found during implementation: `run_required_checks` executed
`sh -lc <command>` on the host, in the worktree the agent had just written to.
A check like `npm test` runs repository-defined scripts, so a task only had to
write a file to get host execution. Checks now run in the sandbox, one per
check. This was the same invariant and the same interface, so it landed here
rather than becoming a separate PR.

**Known gaps, stated rather than papered over:**

- **The wire protocol has no `blocked` state.** A refusal travels as
  `StepFailed` with its reason prefixed `BLOCKED:`. That attributes an
  operator's infrastructure problem to the customer's step. **PR A closes it**
  by giving the refusal its own state. Inventing a lifecycle state in PR C
  would have created a second source of truth for step status.
- **Isolation is `Container`, not `MicroVm`.** Phase 32.4 requires kernel-level
  isolation and the container class is recorded on every job so no receipt
  overstates it. The `SandboxRunner` trait carries no container vocabulary, so
  the microVM implementation is a swap. **Phase 32.4 asks for a date on that
  commitment; the date is Josh's to set.**
- **The `sandbox` CI job is not in the required-checks list.** It runs on every
  PR but cannot block a merge until it is added to branch protection. Adding it
  is a one-line settings change and should happen once it has a green history.
- **`run_id` on the job is empty at the worker.** The worker does not know it;
  the API supplies it when recording. Harmless today, but a `NOT NULL` column
  fed from a `resolve_run_id` that can return `None` will want revisiting when
  PR D reads these rows.

Briefs live in `cortex/plan/briefs/`. An implementer reads only the brief.

## Migration numbers — the shared-counter hazard

`schema_version` is one counter shared with the HeyVera Socials product. Max on
`main` was **v61** (`crates/api/src/db.rs:3445`). PRs A, B, and C each need a
migration and all three briefs point at the next free number. **Whichever lands
second takes the next one; resolve at rebase, not at design time.** Each brief
says so; do not let two branches claim v62.

## What was verified directly (not inherited)

Re-checked against the tree at `c8ca2941`, per the plan's "Verify before you
change" rule:

- `crates/worker/src/executor.rs:49-70` — worktree isolation is **best-effort**
  and falls back to the caller's `working_dir` on any worktree failure. Confirmed
  verbatim; this is the live safety exposure PR C removes.
- `crates/worker/src/executor.rs:74` — `Command::new(&cmd)` spawns the provider
  CLI as a **host process** with the worker's inherited environment.
- `crates/worker/src/executor.rs:520` — `ProviderId::Gemini => Ok(("gemini", vec![]))`
  drops the routed model. The plan's claim holds at the stated line.
- Migration counter: latest is `migrate_v61` (`crates/api/src/db.rs:3445`); the
  fresh-database assertion at `db.rs:25375` requires `>= 61`. **Next free number
  is v62.**
- Branch protection required checks: `heyvera`, `rust`, `cortex`,
  `npm-audit (cortex)`, `npm-audit (heyvera)`, `cargo-deny`. Auto-merge is armed
  on every PR by `.github/workflows/automerge.yml`; the required checks are the
  only gate.

## Findings — plan/repo inconsistencies

Recorded per the handoff rule (record and keep going; do not redesign mid-flight).

### F1. The plan branch was not docs-only *(action taken, needs Josh)*

`origin/docs/concurrency-assessment` carried one substantive code commit,
`865dbfae fix(auth): remove the provider-subscription credential flow`, mixed in
among sixteen docs commits. It removes the backend subscription auth flow, the
container CLI login path, `PendingContainerAuth`, `start_login_exec`,
`complete_login_exec`, `AppState::pending_container_auths`, and rewrites
onboarding's `ProviderStep.tsx`.

It was **split out of the docs PR** onto `fix/auth-remove-subscription-flow` and
pushed. Its PR was **not** opened, because opening a PR arms auto-merge and this
is a customer-facing onboarding change. Awaiting Josh.

### F2. `CONCURRENCY-ASSESSMENT.md` was already on main

The handoff states the plan docs exist only on `docs/concurrency-assessment`.
`cortex/plan/CONCURRENCY-ASSESSMENT.md` was in fact already on `main` with
byte-identical content, so commit `d437ff5d` was dropped during the rebase.
Cosmetic; noted so the next reader is not confused by a 16-commit branch
producing 15 commits.

### F3. PR C is Wave 2, but is being implemented before PR A

The plan's delivery order puts PR C in "Wave 2 — execution and durability
(needs A)". The handoff schedules PR C first, on the grounds that it is the only
live safety exposure rather than a missing capability.

This is **compatible** rather than a violation: Wave 2's dependency on A is real
for **PR B** (which drives the `delivered → verifying` transition and therefore
needs A's states to exist), and not for PR C. PR C's outward contract is a typed
`Blocked` outcome on sandbox-setup failure, which the current executor can return
without any lifecycle-state change. PR C's brief states this explicitly and
fences it: **PR C must not introduce lifecycle states — those are PR A's.**

Reconciled, not deferred. No plan change needed.

## Rules in force

- Never push to `main`; never bypass a required check.
- Commit and push after each coherent unit.
- Rust: `cargo +stable-x86_64-pc-windows-gnullvm test -p cortex-api --lib`.
  **Never run `cargo fmt` on this repo.**
- Known pre-existing local failure, not a regression:
  `validate::tests::normalizes_dot_segments` (Windows path separators).
- If a brief and the plan disagree, the plan wins and the brief is fixed.
