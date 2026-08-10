# Cortex execution state

Running checkpoint for the actualization of
`cortex/plan/HARNESS-EXCELLENCE-PLAN-2026-08.md`. Update this file as work
lands; an interrupted session should be able to resume from it without
re-deriving anything.

**Last updated:** 2026-08-10 (wave 3 in progress — Tasks 1, 1a, 2 done; Task 3 next)
**Base commit at start:** `c8ca2941` (main — "clear all seven open dependency advisories (#498)")
**Wave 2 base:** `3db58b13` (main — "make the sandbox check able to block a merge (#504)")

---

## Status

| Task | What | State |
|---|---|---|
| 1 | Land the harness plan on `main` | **done** — PR [#500](https://github.com/hey-vera/heyvera/pull/500) merged |
| 1a | Split-out auth commit from the same branch | branch `fix/auth-remove-subscription-flow` pushed, **PR deliberately not opened** — see F1 |
| 2 | Briefs for PR C, PR A, PR B | **done** — PR [#501](https://github.com/hey-vera/heyvera/pull/501) merged |
| 3 | Implement PR C (execution sandbox) | **done** — PR [#502](https://github.com/hey-vera/heyvera/pull/502) merged |
| 4 | Promote `sandbox` to a required status check | **done** — PR [#504](https://github.com/hey-vera/heyvera/pull/504) merged |
| 5 | Implement PR A (truth model) | **done** — PR [#505](https://github.com/hey-vera/heyvera/pull/505) merged |
| 6 | Brief + implement PR C2 (scoped egress) | **done** — PRs [#506](https://github.com/hey-vera/heyvera/pull/506), [#507](https://github.com/hey-vera/heyvera/pull/507) merged |
| 7 | Handle PR #499 (28 cargo bumps) | **done** — reviewed, not merged; grouping fixed in PR [#508](https://github.com/hey-vera/heyvera/pull/508) |
| 8 | Implement PR B (durable verifier) | **done** — PR [#513](https://github.com/hey-vera/heyvera/pull/513) merged |
| **Wave 3** | | |
| 9 | Fence Soma behind a cargo feature, default off | **done** — see "Wave 3 / Task 1" below |
| 9a | Corrections to the fence: soma-core, `/api/vera/simulate`, frontend | **done** — PR [#517](https://github.com/hey-vera/heyvera/pull/517) merged |
| 10 | Derive the egress allowlist at plan time | **done** — see "Wave 3 / Task 2" below |

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

- ~~**The wire protocol has no `blocked` state.**~~ **Closed by PR A.** The
  protocol has `StepBlocked` (version 2 to 3), and a refusal is recorded as
  `execution_failed` against Cortex rather than as the customer's step failing.
  The `BLOCKED:` prefix is gone.
- **Isolation is `Container`, not `MicroVm`.** Phase 32.4 requires kernel-level
  isolation and the container class is recorded on every job so no receipt
  overstates it. The `SandboxRunner` trait carries no container vocabulary, so
  the microVM implementation is a swap. **Phase 32.4 asks for a date on that
  commitment; the date is Josh's to set.**
- ~~**The `sandbox` CI job is not in the required-checks list.**~~ **Closed
  2026-08-09** — see "Task 4" below.
- **`run_id` on the job is empty at the worker.** The worker does not know it;
  the API supplies it when recording. Harmless today, but a `NOT NULL` column
  fed from a `resolve_run_id` that can return `None` will want revisiting when
  PR D reads these rows.
- ~~**Scoped egress is not implemented.**~~ **Closed by PR C2 (#507).** The
  adversarial test inverted as predicted: a granted registry is now reachable
  and everything else is not.

**Three things CI found that local testing could not**, worth remembering
because they are the class of bug a container unit test cannot reach:

1. bollard reports a **non-zero exit as a wait error**, so every legitimately
   failing task was being classified `SandboxUnavailable` — the exact
   Failed/Blocked confusion the design set out to prevent.
2. A bind mount **carries host ownership through unchanged**, so a sandbox
   running as a different unprivileged user could not write to its own
   workspace. Every task would have delivered nothing. The sandbox now runs as
   the workspace owner, never uid 0.
3. The allowlist path named a per-attempt Docker network that **nothing
   provisions**, so it failed at submit rather than silently opening egress.

## Task 4 — `sandbox` is now a required check

Required contexts on `main` are now:

```
heyvera, rust, cortex, npm-audit (cortex), npm-audit (heyvera), cargo-deny, sandbox
```

A check that runs but cannot block a merge is not a gate. That is the precise
shape of the fault that let seven dependency advisories accumulate before #498,
and the `sandbox` job is the only thing standing between a task and host
execution — so it had to become blocking rather than advisory.

Two properties made it safe to require rather than merely desirable:

- The job is **unconditional**. It has no `paths:` filter and no change-detection
  gate, so it reports on every pull request. A required check that sometimes
  does not report never goes green and wedges the repository — the failure mode
  that killed the old `web` job in reverse.
- It **cannot pass vacuously**. The adversarial tests skip silently when
  `CORTEX_SANDBOX_IT` is unset, so the job counts the passing tests and fails
  below ten (`.github/workflows/ci.yml:146`). A green `sandbox` therefore means
  the tests ran, not that they were skipped.

Branch protection is read-modify-write: `PUT .../branches/main/protection`
replaces the entire object, and every field omitted from the payload is reset to
its default. The current settings were read first, the one context added, and
the rest resent unchanged. Re-read afterwards to confirm the settings that were
not the point of the change survived: `required_conversation_resolution` still
enabled, `allow_force_pushes` and `allow_deletions` still disabled, `strict`
still false, no review requirement or push restriction introduced.

## PR A — what landed, and what it deliberately did not

Three commits. Migration **v63**, not the v62 the brief anticipated: PR C
landed first and took v62.

1. `crates/engine/src/captain.rs` + `docs/adr/ADR-0001-step-truth-model.md` —
   the states, and why they exist.
2. `crates/api/src/db.rs`, `storage.rs`, `ws.rs`, `scheduler.rs`,
   `verification_driver.rs`, `run_payload.rs` — migration v63, the
   transactional transitions, and the wiring.
3. `crates/core/src/protocol.rs`, `crates/worker/src/bin/worker.rs`,
   `cortex/src/**` — `StepBlocked` and the truthful panes.

**The consequential decision.** The migration rewrites every historical
`succeeded` step to `delivered`, never `verified`. Those rows were never
independently verified, so labelling them verified would assert a claim about
work already delivered to customers that we never checked. Old runs now show
fewer verified steps. Forward-only: reversing it means re-asserting a claim
that was never true.

**Known gaps, stated rather than papered over:**

- ~~**A step can strand in `verifying`.**~~ **Closed by PR B (#513).** The job
  row is inserted in the same transaction as the transition, and a dispatcher
  that dies leaves a claim that expires rather than a delivery that is lost.
- **The positive routing signal is suspended.** `record_step_completed`
  derived its outcome from the worker's exit code, which invariant 6 forbids
  from improving a score, so it no longer fires on delivery. It does not fire
  from the verdict path either: `VeraTracker` lives in `AppState` by value and
  cannot be moved into the spawned task. Dropping a metric beats crediting
  unverified work. **PR B restores it against a real verdict.**
- **The verdict emits no live event.** Same constraint — the spawned task holds
  a `Database` and nothing else, so it cannot reach the Mission Control
  channel. A pane shows `verifying` until it refreshes. Run completion is
  reconciled on the 30s scheduler tick (`reconcile_run_completion`) so a run
  whose last step verified in the background does finish.
- **`success_required` serialises more than strictly necessary.** Every
  dependent waits for `verified`, including read-only ones. The scheduler
  cannot establish that a dependent does not write, and unknown scope is never
  optimistically unblocked. Narrowing this needs write-scope on the step.
- **`inconclusive` holds its dependents indefinitely.** It is not terminal and
  not accepted, so a run with an inconclusive step waits for an operator. Its
  retry policy is PR B's.

## PR C2 — what landed, and what it deliberately did not

Three commits. Migration **v64**.

1. `crates/egress/` (the mediator binary) + `crates/worker/src/sandbox/egress.rs`
   (its lifecycle) + the policy rules that decide what gets opened.
2. `ExecutionJob.effective_egress` / `.egress_mediator` + `Dockerfile.egress`.
3. Ten adversarial tests, the CI wiring, and `docs/adr/ADR-0002-egress-mediation.md`.

**The decision.** Enforcement is network topology, not client configuration. The
sandbox joins a Docker network created `internal: true` — Docker installs no
gateway, so nothing on it can reach off the host by any route — and the mediator
is the only dual-homed member. A task that unsets `HTTPS_PROXY` and dials an
allowlisted host's IP does not get filtered; it gets no route.

`egress_a_direct_connection_bypassing_the_proxy_fails` is the test that proves
it, and it passed against a real runtime in the `sandbox` job. If it ever goes
red, the allowlist is advice.

**Known gaps, stated rather than papered over:**

- **Nothing issues a capability grant.** The planning path never decides that a
  task needs npm, so `effective_egress` records an empty set in practice. The
  enforcement is complete and currently unused. Issuing grants is a planning
  decision, not a boundary one, and it is the next thing that makes the sandbox
  useful rather than merely capable.
- **DNS resolves inside the sandbox even under `internal`.** Docker's embedded
  resolver forwards through the daemon, so a lookup can succeed where no packet
  can follow it. Harmless — resolution is not access — and it is why the tests
  assert at the TCP level rather than on `getent`.
- **Registry host sets drift.** `REGISTRIES` in `policy.rs` needs an owner and a
  review cadence; a stale entry looks to a customer like a broken build.
- **Container-specific.** The microVM phase needs its own mediator attachment,
  most likely over vsock. `SandboxRunner` still carries no container vocabulary.

## Task 7 — PR #499, reviewed rather than merged

28 cargo crates in one Dependabot group, 15 of them major. It was already red:
`bollard` 0.18 → 0.21 moved half its module tree and `crates/worker/src/sandbox/`
imports six of the moved items, so `rust` and `sandbox` both failed. The gate
worked; it was never going to merge unread.

Two findings from reading it, both recorded on the PR:

1. **`sentry` 0.35 → 0.49 pulls `sentry-actix`**, and with it `actix-web` plus
   seven more actix crates, into the lockfile of an axum product. Behind an
   optional feature so it does not compile by default — but it is in
   `Cargo.lock` and therefore in `cargo-deny`'s surface.
2. **Five RustCrypto majors** land in `soma-crypto`, whose test vectors cannot
   detect a behavioural change. See F5.

The grouping that produced it is the actual defect, and PR #508 fixes it: minor
and patch stay grouped (which is what makes them safe to automerge), majors
arrive alone. The rule was already written in `dependabot.yml` for `rusqlite`;
it now applies to every crate.

## PR B — what landed, and what it deliberately did not

Two commits. Migration **v65**.

1. `verification_jobs` + the claim/heartbeat/reclaim/retry/seal SQL, and the
   enqueue threaded through `begin_verifying_step` so it is inside PR A's
   transition transaction.
2. `crates/api/src/verification_dispatcher.rs`, the startup wiring in both
   binaries, the single-node assertion, and the metrics.

**The durability argument.** The job row is inserted inside the
`delivered -> verifying` transaction. If the transition commits the job exists;
if it rolls back neither happened. `enqueue_verification_job_in` is private and
takes a transaction for exactly that reason — a public enqueue is a way to end
up with a job without a state, or a state without a job.

**⚠️ Deployment changed.** `CORTEX_SINGLE_NODE=1` is required and the server
**exits** without it. The SQLite store is a `Mutex<Connection>` two processes do
not share, so a second dispatcher grades every delivery twice. Set in
`deploy/cortex-api.service`, `docker-compose.yml`, `docker-compose.dev.yml`, and
`.env.example`. **Anything that deploys Cortex outside those files needs it
added.**

**Known gaps, stated rather than papered over:**

- **The positive routing signal is still suspended.** PR A dropped it because it
  derived from the worker's exit code; PR B did not restore it, because the
  dispatcher reaches a `Database` and not `AppState`, where `VeraTracker` lives
  by value. Restoring it means either putting the tracker behind an `Arc` or
  routing the verdict back through the scheduler channel. Neither is large;
  both are out of PR B's brief.
- **The verdict still emits no live Mission Control event**, for the same
  reason. A pane shows `verifying` until it refreshes, and run completion is
  reconciled on the 30s scheduler tick.
- **One dispatcher, one process, by assertion.** The claim CAS is written so a
  Postgres `FOR UPDATE SKIP LOCKED` port has the same semantics, but the rest of
  the write path is not yet safe for two writers. The assertion is the guard
  until the write-actor + read-pool work in ARCHITECTURE.md §13 exists.
- **Rollback requires draining.** Dropping `verification_jobs` with jobs in
  flight loses the queue.

## Wave 3 / Task 1 — the Soma fence

`docs/adr/ADR-0003-soma-feature-fence.md` carries the reasoning. What landed:
`soma` is an optional dependency of `crates/api` **and** `crates/worker`, behind
a `soma` feature that is not in `default`. `crate::soma_fence` is the single
place the two projects meet.

~~**`soma-core` is deliberately not fenced.** It is the trust arithmetic behind
`VeraTracker` — no identity, no delegation, no keys, no network — and fencing it
would delete the routing signal that Task 3 exists to restore.~~ **This
justification was false of the crate and is corrected in Task 1a below.**

**Two things found while doing it, neither of which the brief anticipated:**

1. **The worker refuses every step without a delegation.**
   `crates/worker/src/bin/worker.rs:180` fails the step `PermissionDenied` when
   `delegation` is `None`, gated on `SOMA_ENFORCE_DELEGATION` which **defaults
   to on** and is set nowhere in `deploy/`. Turning the feature off in the API
   alone would have stopped Cortex executing any work at all. The worker is
   fenced by the same feature, so the two must be built the same way; a
   mismatched pair fails loudly rather than degrading.
2. **A `{`-prefixed worker token could have reached the `Ok("local")`
   fallback.** `authenticate_worker` returns `Ok("local")` when
   `clerk_secret_key` is `None`. Had the Soma branch simply been deleted, a JSON
   token in a no-Clerk deployment would have authenticated. It is now rejected
   by format check before that path, with a test that leaves
   `clerk_secret_key` unset on purpose.

**Guarded against rot:** a `no-default-features` CI job builds and tests the
whole workspace with everything off and counts its fence assertions (floor 6),
and a step in `rust` compiles `--features soma` on both binaries. The
`no-default-features` job should be added to the required-checks list — see
wave 3 / Task 4.

**Customer-facing consequence for Josh:** `cortex/src/lib/cortexApi.ts` calls
six `/api/soma/*` endpoints that now 404 in a default build, and `/api/health`
no longer carries a `soma` block. Nothing in Cortex's execution, routing, or
billing path depends on them. **Decided and closed in Task 1a: fence the
frontend, do not opt the deploy into `--features soma`.**

## Wave 3 / Task 1a — three corrections to the fence

Three commits on `fix/cortex-owns-trust-arithmetic`. No migration.

### The fence was half a fence

`crates/api/Cargo.toml` said `soma-core` "carries no identity, delegation, keys,
or network." That is false of the crate: `crates/soma-core/src` holds
`delegation.rs`, `heart.rs`, `envelope.rs`, `trust.rs`, `death.rs`,
`pulse_tree.rs`, `room.rs`, and its manifest depends on `soma-crypto` and
`rand_core`/`getrandom`. The true claim was narrower — the path Cortex
exercised, `VeraTracker`, touched none of it.

The gap was not cosmetic. Confirmed before changing anything:

```
$ cargo tree -p cortex-api --no-default-features -i soma-crypto
soma-crypto v0.1.0
└── soma-core v0.1.0
    └── cortex-api v0.1.0
```

`soma-crypto` was linked into **every default Cortex build**, including
`--no-default-features` — the crate whose test vectors assert nothing (was F5).

Fixed by moving, not by fencing. `crates/core/src/vera.rs` is a verbatim copy of
soma-core's `trust`, `compaction`, and `vera` modules plus the three plain types
they need, so every value it computes is the value computed before. `crates/api`
declares no `soma-core` dependency. `crates/soma`, `crates/soma-core` and
`crates/soma-crypto` are unmodified — the "do not modify crates/soma\*"
instruction held; the arithmetic was copied out, not edited in place.

**The generalisable lesson, and the reason this is worth the space:** a
`#[cfg(feature = ...)]` gate fences the code it is written on and says nothing
about what is *linked*. No Rust construct can see a dependency graph, so no test
in the fence could ever have caught this. The `no-default-features` job now
asserts the graph directly — `cargo tree -p <bin> --no-default-features -i
<crate>` for all three soma crates against both binaries, where a *successful*
invocation is the failure — plus the opposite direction, so the feature cannot
silently become a no-op.

soma-core had **no tests at all** (`grep -rn "cfg(test)" crates/soma-core/src`
returns nothing), so the arithmetic behind the routing signal was entirely
unexercised. The copy lands with ten, covering what Task 3 will lean on: decay
saturates rather than underflowing on a future timestamp; a failure lowers trust
without lowering warmth; and one repeated observer cannot reach high coherence
(C=0.05 gamed vs 1.0 diverse) — the anti-gaming property that makes the
bottleneck multiplicative rather than additive.

### `/api/vera/simulate` was a denial-of-service lever, and unauthenticated

Worse than the brief recorded. It was not "any authenticated caller": the
handler took **no auth extractor at all** and sat in the public,
un-rate-limited block. `agents=1000&per_agent=100` is 100,000 synthetic
interactions, each a SHA-256 and a `format!`, run synchronously on an async
handler.

The precise mechanism, since it matters for the fix: it does not take the
database lock. It occupies a Tokio **worker thread** for the whole run, and
enough concurrent calls starve the runtime that every database handler shares —
so the effect is a stalled process, reached by thread starvation rather than by
lock contention.

Both halves, because neither alone is sufficient: the route moved to
`/api/admin/vera/simulate` behind `require_admin_middleware`, and the bound
moved *into* `simulate_ecosystem` and onto the **product** rather than each
factor — which is why 1000 and 100 each looked modest. `authorize_admin` fails
closed in production but returns `Ok(())` when no admin list is configured *and*
`CLERK_SECRET_KEY` is unset, so the internal bound is what covers a
misconfigured deployment.

Also bounded the compaction history: level-2 values were retained for the life
of the process, one per hundred interactions, and serialised in full into every
response from the public `/api/vera/network`.

### The frontend is fenced, and the deploy is not

`SOMA_API_ENABLED` (off unless `VITE_CORTEX_SOMA_ENABLED=true`) follows the
existing `MEMORY_API_ENABLED` pattern. Three live call sites go quiet: the
sign-in session POST, the spend hooks, and the "Soma spend" settings tab.
Nothing is deleted — Soma returns, and the flag turns on with the cargo feature.

**Found while doing it:** `setSomaDelegation` is guarded inside the setter, not
just at the call site, because `authedFetch` sends `Authorization: Soma <json>`
*instead of* the Clerk bearer token whenever a delegation is set. With the
backend fence up, that scheme is refused — a delegation arriving from anywhere
would not degrade Soma features, it would **unauthenticate the entire app**.
Latent today only because the session POST 404s before it can set one.

On the dropped `/api/health` soma block: no change needed and none made.
Nothing under `cortex/src` ever read a soma field off the health response.

**Verified:** `cortex-api` lib 335/335. `soma_isolation` 3/3 with default
features off. The five new `vera_surface` tests pass. `cortex-core` vera 10/10.
`cargo check -p cortex-api --features soma` still compiles. `cargo tree -i`
reports all three soma crates absent from `cortex-api` and `cortex-worker` with
default features off, and `soma` present with the feature on. `npm run build`
passes; `npm run lint` reports 11 problems, identical to an unmodified tree.

## Wave 3 / Task 2 — the egress allowlist is derived at plan time

Three commits on `feat/plan-time-egress-grants`. No migration — v64 already
added `effective_egress` and `egress_mediator`.

Closes PR C2's "enforcement complete and unused": the planning path now issues
capability grants, so `effective_egress` records real endpoints instead of an
empty set.

### The rule

`cortex_core::egress::derive_egress` requires two conditions, and **neither is
authored by the task**:

1. **The step must be able to change the tree.** Search, Think, Review and Gate
   steps never resolve a dependency. `step_changes_the_tree` is reused rather
   than re-expressed — the same predicate that decides whether verification
   attaches — because writing it twice is how the two would stop agreeing.
2. **The repository must contain the manifest.** A repo with no `Cargo.toml`
   gets no route to crates.io regardless of what the objective claims to need.

So an objective saying "install the dependencies" opens nothing; a
`package.json` opens npm.

### The registry table moved, rather than being copied

`REGISTRIES` and `expand_registry` now live in `cortex_core::egress`. Both ends
need them — the planner names the allowlist, the worker refuses any entry no
grant justifies — and two copies would agree only until one was edited. The
failure mode is silent and misdiagnosable: the sandbox opens strictly *less*
than the planner believed, so a task fails looking like a broken network rather
than like a policy mismatch. Enforcement is unchanged and now reads the same
table the planner did.

`EcosystemManifests` is deliberately **not** `check_derivation::EcosystemFacts`.
The two answer different questions — a `go.mod` justifies the module proxy and
contributes nothing to the check floor — and keeping them apart means a change
to what egress opens cannot change what verification requires, or the reverse.
`check_derivation` is untouched. It also let the manifest probe cover pypi and
go, which the check floor does not know about.

### Protocol version stays at 3

A bump is for a change an old peer cannot handle safely; this one it can.
`ExecuteStep.egress` is `serde(default)` and the default is `Deny`, so an old
worker ignoring it behaves exactly as today and a new worker against an old
brain gets the same. **Both directions of a version skew fail closed.** Bumping
would break every running worker's handshake to announce a change whose failure
mode is already closed.

### The receipt reports both halves

`granted_registries` (what the planner decided) and `endpoints` (the
intersection the sandbox enforced). If they ever disagree a reader can see it
rather than trusting they cannot. Absent means *no record*; present-but-empty
means *reached nothing* — collapsing those would let a receipt claim "no
network" for a step where we do not know.

**Verified:** api lib 337, core 94, worker 56, engine 111, context 44 — all
green, run cold after trimming 26.2 GiB of build cache. Frontend builds.

## Next — wave 2 is complete

Every task in the wave-2 handoff has landed. The plan's delivery order from
here:

- **PR I, J, Q** — the catalog, the cost objective, the forecast. The whole
  economic claim, and the reason `quoted_credits` is still `None` everywhere.
- **PR R** — step-level leases. Cheap, and it unlocks the speed dial.
- **PR U** — provenance typing. The plan's highest consequence-to-effort item
  and the prerequisite for pointing Cortex at unvetted repositories.

Two things worth doing before or alongside those, both found during this wave:

- ~~**Issue capability grants** (see PR C2's gaps). The egress enforcement is
  complete and unused until the planning path decides a task needs npm.~~
  **Closed by wave 3 / Task 2.**
- ~~**Fix the soma-crypto vectors** (F5).~~ Out of Cortex's lane since Task 1a
  removed soma-crypto from the dependency graph. Now gate **G2** in ADR-0003.
  Still blocks the five RustCrypto majors in #499.

Briefs live in `cortex/plan/briefs/`. An implementer reads only the brief.

## Migration numbers — the shared-counter hazard

`schema_version` is one counter shared with the HeyVera Socials product. The
hazard is real and it bit three times this wave: PR C took **v62**, PR A took
**v63** against a brief that said v62, PR C2 took **v64**, and PR B took
**v65**. **Re-check the maximum before claiming a number** — a collision means
whichever branch merges second has its migration silently skipped. Max on `main`
is **v65**.

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
  `npm-audit (cortex)`, `npm-audit (heyvera)`, `cargo-deny` — and, since
  2026-08-09, `sandbox`. Auto-merge is armed on every PR by
  `.github/workflows/automerge.yml`; the required checks are the only gate.

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

### F7. The sandboxed provider CLI has no route to the model API *(unresolved, needs Josh)*

Found while grounding Task 2. Not fixed there, and Task 2 does not fix it —
registries are not provider endpoints.

The chain, each link verified at the stated line:

- `executor.rs:103` builds the `SandboxRequest` from `invocation.program` — the
  provider CLI itself — so the agent runs **inside** the sandbox.
- `executor.rs:142` uses `ContainerSandbox` unconditionally. PR C deleted the
  host fallback deliberately; there is no other runner in production.
- `container.rs:128-135`: with no grants the config is `network_mode: "none"`
  and `network_disabled: true`.

So a step dispatched to a sandbox with no egress grant runs an agent CLI that
cannot reach `api.anthropic.com`. Task 2 grants registries when the repo has a
manifest, which does not help: a cargo grant opens crates.io, not the provider.

**Why this is not fixed here.** Opening egress to provider endpoints is a
security-boundary decision, not one derivable from a repository's manifests —
it is the same class of judgement as the isolation-class date in Phase 32.4.
Guessing it inside a task about ecosystem-derived allowlists would put a
permanent hole in the boundary as a side effect of a feature. **Josh's call.**

The plausible shapes, for when it is taken: a provider grant issued at plan time
from the routing decision (the planner already knows which provider was
chosen), or the CLI moved out of the sandbox with only its filesystem effects
sandboxed — which is a different architecture and would need its own ADR.

Worth checking before acting: whether any step has in fact executed
successfully since PR C merged. If the answer is no, this is why, and it means
the sandbox path has never run a real step end to end.

### F5. The soma-crypto test vectors do not test anything *(reclassified — now gate G2)*

**No longer a Cortex to-do.** Since Task 1a, `soma-crypto` is not in any Cortex
binary's dependency graph, so this cannot affect a Cortex build. It is recorded
as **G2 in ADR-0003's "Gates on ever re-enabling the feature"** — a condition on
turning `--features soma` back on, not a task in anyone's queue. It remains a
prerequisite for the five RustCrypto majors in #499, which are soma-crypto's
bumps.

Kept below in full because the reasoning is the evidence for the gate.

Upgraded from F4, which recorded only the symptom.

`export_test_vectors` in `crates/soma-crypto/src/{aead,composite,hash,pulse}.rs`
generates a **fresh random keypair**, signs, and writes the result to
`crates/soma-crypto/test-vectors/*.json`. It asserts nothing. The files are
named as though they were the regression protection for the crypto primitives
and are in fact exported samples that overwrite themselves on every run — which
is also why `cargo test --workspace` leaves a dirty tree.

Consequence: a behavioural change in `aes-gcm`, `chacha20poly1305`, `sha2`,
`hmac`, or `ed25519-dalek` would be absorbed silently by the artifact meant to
catch it. This blocks taking those five majors from #499 with any confidence.

Not fixed here — it is a soma-crypto change, not a Cortex-harness one — but it
should be fixed before those bumps move.

### F6. The worker verifies a delegation against itself *(reclassified — now gate G1)*

**No longer a to-do.** It is reachable only with `--features soma`, which no
deployment sets, so leaving it on a task list would mean carrying an item that
cannot be triggered — the reliable way for a known defect to become a forgotten
one. It is recorded as **G1 in ADR-0003's "Gates on ever re-enabling the
feature"**: a condition that must be cleared *before* the feature can come back,
written down where someone turning the feature on will be reading.

Kept below in full because the reasoning is the evidence for the gate.

`crates/worker/src/bin/worker.rs:154` builds its `InvocationContext` with
`invoker_did: deleg.issuer_did` — the issuer taken from the delegation being
checked. `verify_delegation` therefore confirms the signature is consistent with
the DID the token itself claims, and nothing establishes that the DID is
Cortex's. A self-issued delegation verifies.

The API side does check this (`ws.rs`: `delegation.issuer_did != heart.did()`
is rejected), so the exposure is worker-side only and requires an attacker
already able to send `ExecuteStep` frames over an authenticated socket.

Not fixed in the fence PR: fixing it means changing the worker authentication
path, which is precisely what ADR-0003 exists to avoid doing while Track A
lands. It matters whenever the `soma` feature is turned back on.

### F4. A test run mutates a tracked file *(superseded by F5)*

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
- The handoff lists `validate::tests::normalizes_dot_segments` as a known local
  failure. It **passed** on this machine during PR A (316/316 on the api lib).
  Treat any failure of it as suspect rather than expected.
- If a brief and the plan disagree, the plan wins and the brief is fixed.
