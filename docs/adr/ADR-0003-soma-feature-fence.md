# ADR-0003 — Soma is fenced behind a cargo feature that is off by default

**Status:** accepted
**Date:** 2026-08-10
**Supersedes nothing.** Soma was never decided into Cortex; it arrived.

## Context

Soma is a separate, work-in-progress project: cryptographic agent identity,
capability delegation, a heartbeat chain, and a spend log. Cortex is an
orchestration harness that routes work to providers, executes it in a sandbox,
and pays for verified results.

Soma is nonetheless on Cortex's worker authentication path, and on more besides:

- `crates/api` depended on `soma` unconditionally.
- `AppState` carried a `soma_heart`, constructed at startup.
- `authenticate_worker` tried a Soma delegation before anything else.
- The scheduler recorded routing decisions, deliveries, and failures as Soma
  heartbeats, wrote a Soma spend receipt on every successful bandit update, and
  issued a per-step Soma delegation to the worker on dispatch.
- `crates/worker` **refused to execute any step without a valid delegation**
  (`SOMA_ENFORCE_DELEGATION`, default on).

That last item is the shape of the problem. A WIP subsystem had become a hard
dependency of Cortex executing a single step, and it got there without anyone
deciding it should.

Track A is landing. Refactoring the worker authentication path while it does is
the wrong risk to take, and removing Soma outright is a refactor of exactly that
path. But leaving an unfinished project load-bearing is not a neutral choice
either — it is the choice to keep taking the risk indefinitely.

## Decision

**Soma is compiled out by default, and the boundary is a cargo feature rather
than a runtime flag.**

`crates/api` and `crates/worker` both gain an optional `soma` dependency behind
a feature named `soma`, absent from `default`. With the feature off:

- `crate::soma` and `crate::soma_bridge` do not exist.
- `AppState` has no `soma_heart` **field** — not a `None`, no field.
- The `/api/soma/*` routes are not registered; a request 404s.
- `/api/health` reports no `soma` subsystem at all.
- The `Soma ` authorization scheme is refused as unsupported.
- A worker token that starts with `{` is rejected as an unknown credential
  format.
- `issue_step_delegation` returns `None`, and the worker does not ask for one.

A feature rather than a flag, because a runtime flag leaves the code compiled
in, linked, and reachable — one mistaken `if` from being live again. `cargo`
removes it from the binary, and `cargo tree` stops listing it. The question
"could a Soma value reach a receipt?" becomes answerable by the type checker
instead of by reading every branch.

### Why the `{`-prefixed token is rejected rather than ignored

`authenticate_worker` ends in a Clerk fallback, and that fallback returns
`Ok("local")` when `clerk_secret_key` is `None` — the local-development
configuration. Letting a JSON token fall through would therefore not merely
produce a confusing "invalid JWT" error for something that was never a JWT; in a
deployment without Clerk configured it would **authenticate an unverifiable
credential**. The format check rejects before that path is reachable, and
`json_worker_token_is_rejected_rather_than_falling_through_to_local` pins it
with `clerk_secret_key` deliberately unset.

### Why `soma-core` is *not* fenced

`soma-core` stays a normal, non-optional dependency. It is the trust and
compaction arithmetic behind `VeraTracker` — `Interaction`, `HeartId`,
`SessionOutcome`, `distill` — and it carries no identity, no delegation, no
keys, and no network. `VeraTracker` is the routing signal, which is being
restored, not removed; fencing `soma-core` would delete it.

The distinction that matters for the invariant below: `VeraTracker` is
write-only telemetry. Nothing reads it to make a routing decision, and its
`cortex_heart_id` is a local grouping label derived from a constant, not a
credential. `soma` is the part that signs things, and that is the part behind
the fence.

### The invariant

**With the feature off, no Cortex receipt, routing decision, or ledger row may
carry a value that originated in Soma.**

Asserted, not assumed:

| Assertion | Where |
|---|---|
| No delegation is attached to a dispatched step | `scheduler::soma_fence_tests::no_step_delegation_is_issued` |
| A JSON credential cannot authenticate a worker, and cannot reach the `Ok("local")` fallback | `ws::soma_fence_tests::json_worker_token_is_rejected_rather_than_falling_through_to_local` |
| Local dev still works, so a later tightening cannot break it unnoticed | `ws::soma_fence_tests::empty_token_still_means_local_dev` |
| Every `/api/soma/*` route 404s | `tests/soma_isolation.rs::soma_routes_are_absent` |
| Health reports no Soma subsystem | `tests/soma_isolation.rs::health_does_not_report_a_soma_subsystem` |
| The `Soma ` scheme is refused | `tests/soma_isolation.rs::soma_authorization_scheme_is_refused` |

The Soma spend log is not the Cortex ledger and never was: the Cortex ledger is
written in `verification_driver.rs`, from an independent verdict, and it has
never read a Soma value. The fence does not change that; it makes it checkable.

### The two features must be set the same way on both binaries

An API without the feature issues no delegation. A worker **with** the feature
demands one and fails the step `PermissionDenied` when it is missing. So a
mismatched pair does not degrade — it stops executing work entirely.

This is deliberate. The alternative, a worker that shrugs when the delegation it
was built to require is absent, is a security check that turns itself off, which
is worse than no check. The mismatch fails loudly and in the safe direction.

## Consequences

**Accepted:**

- `/api/soma/*` returns 404 in a default build. `cortex/src/lib/cortexApi.ts`
  calls six of these endpoints. Those calls now fail. They are Soma-surface UI
  for a WIP project, and the honest answer to "is Soma available" is no.
- `/api/health` no longer carries a `soma` block or a `checks.soma` entry. A
  dashboard keying on those sees absence rather than a permanent red light —
  which is the intent: a check that is always failing teaches people to stop
  reading it.
- `mc_snapshot` reports `heart: null` and `spend: null`.
- `build_delegation_status` reports `NotIssued` / `budget_enforced: false`,
  which was already the truthful answer — nothing was enforcing a delegation
  budget.

**Not accepted, and guarded:**

- Feature rot. `--workspace` never compiles an off-by-default feature, which is
  how `otel` stopped building while still pinning a dependency with an open
  advisory. Two CI steps close it: a `no-default-features` job that builds and
  tests the whole workspace with everything off, and a step in `rust` that
  compiles `--features soma` on both binaries. The `no-default-features` job
  also counts its fence assertions, because tests that quietly stop being
  collected read like coverage.

**Left alone, deliberately:**

- `crates/soma`, `crates/soma-core`, `crates/soma-crypto` are untouched. This
  ADR is about what Cortex depends on, not about what Soma is.
- The worker's delegation verification does not check that the issuer is
  Cortex's heart — it builds its `InvocationContext` with
  `invoker_did: deleg.issuer_did`, so a self-issued delegation verifies against
  itself. The API side *does* check the issuer. Recorded here rather than fixed,
  because fixing it means changing the worker auth path, which is the thing this
  ADR exists to avoid doing right now. It is a finding in
  `cortex/plan/EXECUTION-STATE.md`.

## Alternatives rejected

**Remove Soma from `crates/api` outright.** The right end state and the wrong
move this week. It is a refactor of the worker authentication path while Track A
is landing on it.

**A runtime environment flag.** Leaves the code compiled in and reachable. The
`SOMA_ENFORCE_DELEGATION` variable already demonstrated the failure mode: a
security check whose default could be flipped by an environment variable nobody
sets deliberately.

**Fence `soma-core` too, for symmetry.** Would delete `VeraTracker` and with it
the routing signal, to remove a dependency that signs nothing and decides
nothing.
