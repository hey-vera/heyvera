# Cortex Harness Excellence Plan

> **Status:** proposed implementation plan
> **Prepared:** 2026-08-07 (Track A), extended 2026-08-07 (Track B)
> **Review base:** `d437ff5d` (`docs/concurrency-assessment`)
> **Scope:** Cortex only: the Rust API/worker/runtime and `cortex/` web client.
> This is a change plan, not a claim that the listed work is already shipped.
>
> **Related docs — read before implementing, do not contradict:**
> [VISION.md](VISION.md) (what Cortex sells and explicitly does not claim),
> [RESEARCH-2026-08.md](RESEARCH-2026-08.md) (competitive landscape, top-down
> engineering literature, multi-agent coherence evidence),
> [CREDITS.md](CREDITS.md), [VERIFIER.md](VERIFIER.md), [CONTEXT.md](CONTEXT.md),
> [PLAN-RECEIPT.md](PLAN-RECEIPT.md), [SURFACE.md](SURFACE.md),
> [CONCURRENCY-ASSESSMENT.md](CONCURRENCY-ASSESSMENT.md).

## How to resume this document

Every claim in the evidence tables is a `file:line` you can re-check in one
command. If you are a fresh session picking this up, do **not** re-derive the
survey — verify the specific line you are about to change and move on.

Verification scope of this review, stated honestly so nobody over-trusts it:

- **Directly read and confirmed:** `crates/worker/src/executor.rs` (host
  execution, worktree fallback, `build_command`), `crates/core/src/routing.rs`,
  `crates/core/src/task.rs`, `crates/core/src/provider.rs`,
  `crates/core/src/evaluator.rs` (`parse_intent`, `DefaultPolicy::decide`,
  `default_model`), `crates/engine/src/models.rs`,
  `crates/engine/src/pipeline.rs`, `crates/engine/src/decomposer.rs`,
  `crates/api/src/cost_estimator.rs`, `crates/api/src/scheduler.rs`
  (`route_step`, `update_bandit_from_outcome`, `create_run_from_goal`),
  `crates/api/src/verification_driver.rs` (`runner_image`),
  `cortex/src/lib/taskManager.ts`.
- **Taken from the Track A review without independent re-read:** the `ws.rs`
  and `db.rs` line references in the Track A evidence table.
- **Not run:** full API test suite, frontend build (`cortex/node_modules`
  absent). Local Rust builds *do* work — use
  `cargo +stable-x86_64-pc-windows-gnullvm test -p cortex-api --lib`. Never run
  `cargo fmt` on this repo.

## Decision

Cortex has a compelling and defensible direction: verified software work, with
the receipt and the price bound to the outcome. The recent V3 work is a real
foundation: checks are frozen before execution, verdicts are persisted, the
verifier grades a detached checkout, the check container is constrained, and
ledger writes are idempotent.

It is **not yet safe or honest** to market or operate Cortex as a verified,
operator-hosted coding harness. The independent verifier is currently an
asynchronous side path after a step has already been marked successful; its
result does not drive the canonical step/run/task state, router learning,
receipt discovery, or billing. Separately, the code-writing agent process is
executed on the worker host rather than inside the sandbox promised by the
product vision.

The implementation order is therefore:

1. Make execution and completion truthful and safe.
2. Make verification durable, recoverable, and the only outcome signal.
3. Bind a persisted quote and ledger to that outcome.
4. Expose the resulting truth in the chat and operations interface.
5. Use the trustworthy outcome data to improve routing and multi-agent work.

Do not begin feature-parity work, outcome-pricing launch, multi-replica
deployment, or broad autonomous GitHub writes until the applicable gates below
are green.

### The second half of the decision — the product thesis

The above is a **truth-and-safety** plan (Track A). It is necessary and it is
not sufficient. A Cortex that is perfectly honest about a mediocre outcome is a
correct product nobody buys.

The product thesis this plan must also serve: *a developer states an outcome, and
Cortex behaves like a senior engineer who scopes it properly, chooses the cheapest
tool that will actually pass, proves it, and hands back a reviewable change.* The
same object graph has to serve a solo builder saying "build me a game with X, Y,
and Z" and a 400-person engineering org that needs budgets, roles, and an audit
trail.

Measured against that thesis, the current code has a second class of gap, distinct
from the safety gaps. It is not that the product is unsafe; it is that **the
mechanisms the thesis requires are either absent or vestigial**:

- The effort dial exists only in a standalone CLI binary and controls nothing on
  the served product path.
- Intent classification is prefix/substring matching, and the confidence score it
  produces is recorded and then ignored — there is no "ask a clarifying question"
  path anywhere.
- The decomposer is a sentence splitter capped at five segments; it rejects
  exactly the rich one-shot request the flagship demo depends on.
- The router's learning signal is binary success with **no cost term at all**, so
  it is structurally incapable of learning the thing the vision says matters most.
- Model identity and price live in three hand-synchronised tables that already
  disagree with each other.
- There is no org, team, role, spend-ceiling, or effort-ceiling model, which is
  the floor for selling to a team of 100+.
- Parallel steps within a run have no path arbitration, a goal stated in plain
  English silently takes a repo-wide exclusive lock, and **nothing anywhere
  merges the per-step branches** — so "many agents working together" currently
  has isolation without composition.
- Nothing forecasts what a run will cost or caps what it may spend, which is the
  one thing every buyer in this category now asks about first.

Track B below addresses these. **Track B is not "after" Track A.** Some Track B
work is genuinely blocked by Track A (anything that prices, charges, or claims a
verdict); much of it is not (the model catalog, the intake frame, the org model).
The delivery order at the end interleaves both and states each dependency
explicitly, because sequencing these two tracks serially would waste months.

One structural point that governs both tracks: **the execution-job interface
introduced in Track A Phase 0.1 is the same interface that must carry effort,
budget, model identity, and network policy.** If the sandbox lands with only the
fields Track A needs, it gets re-cut within weeks. Design it once, with Track B's
fields, even if they are initially unset.

## Evidence from this checkout

| Finding | Evidence | Consequence |
|---|---|---|
| The worker launches provider CLIs as host processes. A worktree is isolation for source changes, not a security boundary; if worktree creation fails it deliberately falls back to the original directory. | `crates/worker/src/executor.rs:49-84`, `:125` | Model-authored code can access the worker's network, user-visible filesystem, process environment, and any credentials available to that worker. This violates the operator-hosted trust boundary in `VISION.md`. |
| A worker completion becomes `succeeded` before independent verification starts. The V3 verifier is spawned after `complete_step`. | `crates/api/src/ws.rs:471-537`; `crates/api/src/db.rs:8683-8738` | A run can be shown as done and downstream work can start before the independent check has passed. A later failed or inconclusive V3 verdict does not reverse that state. |
| The V3 verdict only updates `verification_runs`; it does not transition the step, attempt, run, task, or operations projection. | `crates/api/src/db.rs:11396-11413` | The product has two incompatible truths: execution completion and independent verification. |
| Routing rewards are granted at `StepCompleted` from the legacy worker-evidence report, before V3 completes. | `crates/api/src/scheduler.rs:100-137`, `:967-1005` | The proposed routing/eval moat is trained on self-reported evidence rather than the independent outcome. |
| A verification claim is made in a fire-and-forget Tokio task. There is no recovery query or durable queue consumer for pending verification rows. | `crates/api/src/ws.rs:521-537`; `crates/api/src/db.rs:3465-3478`, `:11330-11363` | A restart after the claim can strand a pending verdict permanently; the unique claim then prevents a retry. |
| The runner claims a pinned image, but defaults to mutable `cortex/runner:phase-a` and accepts arbitrary environment values. | `crates/api/src/verification_driver.rs:56-63`; `crates/api/src/check_runner.rs:51-96` | Receipts are not reproducible or supply-chain trustworthy unless digest pinning is enforced, not merely documented. |
| No step quote is persisted or passed to the driver; `quoted_credits` is always `None`. | `crates/api/src/ws.rs:509-519`; `crates/api/src/verification_driver.rs:284-309` | V3 rightly records verdicts without charging, but verified-outcome pricing and refund-on-failure cannot be exercised. |
| The receipt index scans legacy `verifier_report_id`, while V3 receipts live in separate tables. The run UI badges legacy state. | `cortex/src/components/mission/ReceiptsPane.tsx:18-108`; `cortex/src/components/mission/RunsPane.tsx:52-76`; `crates/api/src/run_payload.rs:132-135` | An independent receipt may be hidden, and a reassuring badge can describe worker-reported evidence rather than the independent verdict. |
| Task Manager starts with browser-local state and invented members, then allows local fallback if the backend is unavailable. | `cortex/src/lib/taskManager.ts:116-190`, `:620-662`; `:426-442` | This is useful prototype resilience but cannot be production operations truth. It conflicts with the Operations Room contract's "no local-only production work" rule. |
| The production path is single-node only; `Mutex<Connection>` still serializes 423 lock sites and the scheduler has no leader election. | `cortex/plan/CONCURRENCY-ASSESSMENT.md:15-17`, `:41-49` | A second API replica can double-dispatch paid work. SQLite constraints protect customer billing rows, but not provider spend or task semantics. |

The V3 unit suite itself is green locally: `cargo +stable-x86_64-pc-windows-gnullvm test -p cortex-api --lib verification_driver` passed 7/7 tests. The complete API suite began 296 tests but exceeded the review command's 60-second command limit after test startup, so this plan does not claim a full-suite result. The frontend build was not runnable in this checkout because `cortex/node_modules` is absent (`tsc` unavailable); no dependency installation was performed during review.

## Evidence for the product thesis (Track B)

These are separate findings from the safety table above. None of them is a
security problem; each one is a mechanism the stated product thesis requires and
the code does not currently have.

| Finding | Evidence | Consequence |
|---|---|---|
| **The effort dial is vestigial.** `dial` exists only as a `PipelineConfig` field consumed by the standalone `cortex` CLI binary. The served API path never constructs a `PipelineConfig`; it hardcodes `exploration_weight_for_dial(5)` and nothing else. | `crates/engine/src/pipeline.rs:11`, `:156-164`; `crates/engine/src/bin/cortex.rs:141`, `:376`; `crates/api/src/state.rs:257` | The single most prominent feature of the product vision does not exist on the product. What dial there is selects a `RouteTemplate` (fan-out shape) only — never model capability and never per-request reasoning effort. |
| **No execution path can carry an effort level.** `build_command` emits `claude -p --model X` and `codex exec -c model=X -c approval_policy=never`. Neither carries a reasoning-effort argument. Effort is a first-class provider parameter in 2026 (`output_config.effort` on Claude; `reasoning_effort` on OpenAI). | `crates/worker/src/executor.rs:494-525` | A dial cannot be plumbed to the model without changing the invocation path. This must be co-designed with the Phase 0.1 sandbox interface, not bolted on after. |
| **Gemini invocations ignore the routed model entirely.** `ProviderId::Gemini => Ok(("gemini".to_string(), vec![]))` — no `--model`, no flags. The routing decision records a `model_id` that is never passed to the process. | `crates/worker/src/executor.rs:520` | A receipt can name a model that demonstrably did not constrain execution. This is a provenance defect in the same class as an unpinned runner image, and it undercuts the receipt story. |
| **The router's reward has no cost term.** `update_bandit_from_outcome` accepts `cost_estimate: Option<f64>` and uses it only to write a Soma spend receipt. The reward is `if success { 1.0 } else { 0.0 }`. | `crates/api/src/scheduler.rs:967-1005`, esp. `:1002` | The router is structurally incapable of learning "cheapest model that still passes" — the exact objective VISION.md and the founder's brief both name as the priority. It will converge on whatever passes most often, which is the most expensive model. |
| **Model identity and price live in three unsynchronised tables.** `evaluator::default_model` and `engine::models::REGISTRY` are two hardcoded 12-entry matches kept in sync by a source comment, and they already disagree (`claude-haiku-4-5-20251001` vs `claude-haiku-4-5`). `CostEstimator::get_model_rates` is a third table, matching on substrings of model names and still carrying `claude-3-*` / `gpt-4`-era rates. | `crates/core/src/evaluator.rs:541-561`; `crates/engine/src/models.rs:3-19`; `crates/api/src/cost_estimator.rs:127-146` | Every model addition is a three-file change with no test that they agree. Cost-aware routing built on this table would optimise against fictional prices. |
| **Intent confidence is computed, recorded, and never acted on.** `parse_intent` emits a confidence from `0.95` down to a `0.30` catch-all that guesses `Intent::Add`. The only consumer stores it as decision evidence. | `crates/core/src/evaluator.rs:704-740`; `crates/api/src/scheduler.rs:1075` | There is no clarification path. A request Cortex understood at 30% confidence is dispatched exactly like one it understood at 95%. "Cortex knows what you meant" is currently a claim with no mechanism behind it. |
| **Two divergent intent classifiers.** `core::evaluator::parse_intent` (prefix-then-substring, confidence-scored, used by the decomposer on the API path) and `engine::pipeline::parse_intent` (substring-only, no confidence, defaults to `Fix`) disagree on the same input. | `crates/core/src/evaluator.rs:704`; `crates/engine/src/pipeline.rs:128-150` | The CLI and the product classify the same sentence differently. The substring-only variant also misfires on ordinary English: "refactor the addressing logic" matches `add` inside `addressing` before it reaches the `refactor` branch. |
| **The decomposer is a sentence splitter, and it hard-fails on rich requests.** `decompose_goal` splits on markers like `" and then "` and comma-plus-verb, maps each fragment to a step, and returns `Err("too many segments (max 5)")` above five fragments. | `crates/engine/src/decomposer.rs:9-62`, `:20-22`, `:78-96` | This is not top-down engineering; it is string splitting. It also rejects the flagship one-shot request ("build me a game with X, Y, and Z, and do it in one run") rather than decomposing it. |
| **The `profile` parameter is threaded through decomposition and never read.** `decompose_goal(user_id, goal, file_paths, profile)` passes `profile` straight into `RunBuilder::new` as a string and branches on it nowhere. | `crates/engine/src/decomposer.rs:13`, `:24` | Cost-saver and quality-first produce byte-identical plans. The user-visible profile control affects model scoring only, never how much engineering is planned. |
| **The frontend's evidence gate fails open.** `validateTaskCompletion` calls the evidence check and, on any thrown error, logs `"Evidence validation failed, allowing completion"` and returns `{ canComplete: true }`. | `cortex/src/lib/taskManager.ts:426-442` | An unreachable backend silently converts a gated completion into an ungated one. This is the verification thesis inverted, in the surface the customer actually looks at. |
| **The operations surface fabricates organisation data.** `defaultMembers` seeds non-personal groups with invented teammates named `Joe`, `Maya`, and `Sam`, complete with `online`/`working` presence states. | `cortex/src/lib/taskManager.ts:116-130` | Beyond the Track A truthfulness problem, this is a hard procurement blocker: no security review passes a product that renders fictional members in a shared team view. |
| **No organisation, team, role, or spend-ceiling model exists.** No SCIM, no SAML, no RBAC role enum on the Cortex path; a generic `audit_log` table exists but no export surface. | `crates/api/src/db.rs:1859-1865`; absence across `crates/api/src/` | The floor for a 100+ seat sale is RBAC → audit export → SSO → SCIM, in that order. None of it is started, and the Phase 4 data-plane work is a prerequisite for the self-host/VPC tier those buyers ask for. |
| **Resource leases are run-scoped, so parallel steps within a run have no path arbitration.** `acquire_run_resource_leases_tx` is called once, at run creation, from the run's declared file paths. | `crates/api/src/db.rs:8143` | Two runs cannot collide; the N concurrent steps of a single run can. This is precisely the "many agents on one task" case the vision depends on. |
| **A run without declared file paths takes a repo-wide `.` write lease**, and `.` overlaps every path. | `crates/api/src/scheduler.rs:1682-1692`; `crates/api/src/db.rs:4403-4411` | One natural-language goal — the common case — serialises every other run on that repo. The concurrency model's default setting is "fully serial." |
| **Lease conflict fails run creation rather than queueing.** | `crates/api/src/db.rs:8151-8154` | Correct fail-closed safety, wrong throughput behaviour, and a poor error: the user sees a failure instead of "waiting on step 7." |
| **Nothing integrates the per-step branches.** Each step gets a worktree on `cortex/step/{step_id}` cut from HEAD, and no merge, rebase, or cherry-pick exists anywhere in the worker or scheduler. | `crates/worker/src/worktree.rs:229-256`; absence across `crates/worker/`, `crates/api/src/scheduler.rs` | N parallel steps produce N divergent branches and the worktrees are then deleted. Cortex has isolation primitives and no composition — parallel agents cannot corrupt each other, and also cannot produce a combined result. |

## Non-negotiable invariants

These are product contracts. Each one needs an automated test, a metric, and a
runbook before its feature is enabled.

1. **No host execution of untrusted task code.** A code-writing agent never
   receives host credentials, a Docker socket, the production database, or
   arbitrary host filesystem access.
2. **No successful completion before independent verification.** The UI may say
   `delivered; verifying`, but it may not say `done`, unlock dependent writes,
   create a PR, charge, or improve a model's score before the required verdict.
3. **One durable work item has one durable terminal outcome.** Retries and
   restarts are idempotent; a claimed verifier job is recoverable rather than
   silently stranded.
4. **Receipts are reproducible.** Every receipt names an immutable source tree,
   OCI image digest, check argv, timeout, resource profile, result, output
   digest, and artifact locations.
5. **Pricing is quoted before work and immutable after dispatch.** The quote,
   pricing version, scope, and acceptance contract travel with the task. No code
   infers a price after the work has run.
6. **The independent verdict is the sole truth for completion, billing, and
   learning.** Worker-reported checks remain useful diagnostics and are labelled
   as such; they cannot create a verification badge or positive routing reward.
7. **Every UI state identifies its source and freshness.** A browser-local draft
   can never be styled as shared live operations data.
8. **Parallel work is conflict-safe by policy, not best effort.** If a required
   isolation, lease, base commit, or sandbox cannot be obtained, dispatch fails
   closed and explains the blocker.

The following five govern Track B and are contracts in exactly the same sense.

9. **A control the user can move must change something the user can see.** If the
   effort dial does not visibly change the plan, the quote, or the checks on the
   Plan Receipt before approval, it is decoration and must not ship.
10. **A receipt never claims a setting the backend did not apply.** If an
    execution backend cannot honour a requested effort level or model, it
    declares that at dispatch and the receipt records what was actually applied,
    not what was asked for.
11. **One fact, one table.** Model identity, price, capability class, context
    window, and supported effort levels live in exactly one versioned catalog.
    The catalog version is recorded on every routing decision and every receipt.
    No routing or pricing code carries a hardcoded model name.
12. **The router optimises cost-to-verified-outcome, never pass rate.** Every
    reward carries the total provider spend for the attempt chain, including
    retries and the cost of verification itself. A route that passes at four
    times the price is a worse route.
13. **Low confidence produces a question, not a guess.** When intake confidence
    or a missing decision falls below the policy threshold, Cortex asks — in
    Plan mode, before any billable execution. Silently guessing and dispatching
    is prohibited regardless of how the request was phrased.
14. **Spend cannot surprise.** Every run carries a forecast and a hard cap
    enforced at the sandbox boundary. At the cap Cortex stops and asks; it never
    silently continues and never silently abandons. Cortex may lower effort or
    cost without asking and must record it; it may never raise them without
    consent.
15. **Concurrent steps have disjoint write sets, proven at plan time.** Two
    leaves that can run at once may not write overlapping paths. Where
    disjointness cannot be established, the leaves are serialised and the Plan
    Receipt says why. Unknown scope is never optimistically parallelised.
16. **Nothing merges without re-verification.** A textual merge is not a verdict.
    The full check battery runs against the *integrated* tree, because two
    branches can each pass their own checks and still disagree at runtime.
17. **Inferred content is never rendered downstream as fact.** Every context item
    carries a provenance type, and a model's conclusion travels with its origin
    and confidence or it does not travel. Verified evidence is never compacted
    away.
18. **Instructions come only from the contract; everything else is data.**
    Repository content, issue bodies, dependency metadata, and tool output are
    `observed` information and can never direct behaviour, regardless of what
    they contain. Apparent directives in observed content are reported as
    findings.
19. **Knowledge is never authority over evidence.** Curated packs, standards, and
    priors say what to *check*; execution says what is *true*. When a
    pack-derived expectation contradicts the repository, the repository wins and
    the pack is flagged for review — never the reverse. Curated knowledge carries
    a citation and a date, or it is not knowledge.
20. **Only objective signals train a shared artifact.** Executed check outcomes,
    attributed misses, and non-executability may train globally. Human
    dispositions are a local preference, scoped at most to the organisation that
    produced them, and never propagate across customers.
21. **An unreliable check never decides anything.** A check that produces
    differing outcomes on a byte-identical tree is quarantined: it still runs and
    still reports, but it cannot fail a paid task, move the ledger, or reach any
    learning signal — and the receipt names it.
22. **Cortex verifies what can be executed, and says UNVERIFIED otherwise.**
    Where no executable ground truth exists, the work may still be done, is
    labelled, and is never priced as though it had been proven.
23. **A shared artifact is immutable and versioned.** Professionals, method-library
    entries, policies, and price lists are published, never edited. Consumers pin
    a version; a narrower ownership scope can never mutate a broader one; every
    receipt names the exact versions that ran.

---

# Track A - Truth and safety

Phases 0–5 make Cortex's claims mechanically true and its execution contained.
Nothing in Track B is worth building on a system that reports outcomes it has not
proven.

## Phase 0 - Establish an honest, safe private alpha

**Goal:** stop unsafe execution and misleading completion claims before adding
more capability.

### 0.1 Replace host worker execution with an execution sandbox

**Owner area:** `crates/worker`, `crates/api`, deployment.

Replace direct `tokio::process::Command` execution of provider CLIs with a
versioned `ExecutionJob` sent to a sandbox runner. The initial implementation
may use a dedicated rootless container runtime if it has the following enforced
properties; the interface must allow a Firecracker/microVM implementation later.

- Fresh sandbox per task attempt; no reuse of writable state between tenants.
- Read/write worktree mounted only inside that sandbox. The runner service, not
  the model process, owns Git credentials and performs sanctioned fetch/push
  operations.
- No Docker socket, host PID/IPC namespace, privileged mode, host networking,
  host home directory, production environment, or inherited credentials.
- Default network denied. Enable only an explicit, task-scoped allowlist for
  dependency resolution, and record that capability in the receipt.
- Non-root UID, read-only base image, bounded CPU/memory/pids/disk/runtime,
  seccomp/AppArmor or equivalent, egress logging, and mandatory teardown.
- If sandbox setup or worktree creation fails, return a typed `Blocked` outcome.
  Remove the direct-directory fallback.

**Acceptance tests:** an adversarial task cannot read a host secret, access a
Docker socket, reach an unapproved host, write outside its workspace, or persist
data into the next task. A forced sandbox failure leaves the step blocked and
does not invoke the provider CLI.

**Design `ExecutionJob` once, with Track B's fields.** This struct is the
narrowest waist in the whole system, and re-cutting it later is expensive. It
must carry, from the first version, even if some fields are initially `None`:

| Field | Why it must be here and not added later |
|---|---|
| `model_ref` (catalog ID + catalog version) | Provenance. `crates/worker/src/executor.rs:520` currently drops the routed model for Gemini; the job must make "which model actually ran" unforgeable. |
| `effort: Option<EffortLevel>` and `effort_applied: EffortApplication` | Phase 6. The backend reports back whether it applied, downgraded, or could not honour the level — invariant 10. |
| `token_budget` / `wall_clock_budget` / `max_tool_calls` | Cost containment must be enforced at the boundary, not trusted to the agent. |
| `network_policy` | Already required by Track A; belongs on the same job. |
| `capability_grants` | Phase 2.1's grants must be enforceable at the sandbox edge, not only checked in the API. |
| `context_bundle_ref` + packed size | CONTEXT.md C3, and RESEARCH-2026-08 rec 7 wants packed size recorded per attempt. |
| `quote_id`, `plan_receipt_id`, `attempt_id`, `lease_gen` | Everything downstream — receipt, ledger, router fact — joins on these. |

Two provider realities to settle while designing it, because they change the
shape of the interface:

1. **CLI backends may not expose effort.** `claude -p` and `codex exec` are
   invoked with model flags only today. Either the CLI exposes an effort flag,
   or effort-controlled work goes down the HTTP path (`crates/api/src/llm_client.rs`
   already exists for Zen). The interface must support both backends and record
   which one ran. Do not let a CLI backend silently swallow an effort request.
2. **Effort invalidates prompt caching when it changes mid-conversation.**
   Anthropic's guidance is explicit: effort shapes the rendered prompt, so
   varying it between requests in one cached session discards the cached prefix.
   Therefore effort is fixed for the lifetime of an *attempt*. Escalation
   happens by starting a new attempt, which is also what the fresh-context retry
   rule in RESEARCH-2026-08 rec 4 already requires. These two constraints agree;
   implement them as one rule.

### 0.2 Introduce truthful lifecycle states

**Owner area:** `crates/core`, `crates/api`, `cortex/src`.

Replace the current completion shortcut with an explicit state machine:

```text
planned -> queued -> leased -> running -> delivered -> verifying
                                             |              |
                                             |              +-> verified -> review/done
                                             |              +-> failed -> retry/failed
                                             |              +-> inconclusive -> retry/attention
                                             +-> execution_failed -> retry/failed
```

`delivered` means the sandbox produced a commit. `verified` means Cortex's
independent runner accepted the frozen checks. A legacy worker report is never a
transition guard. Preserve the legacy report as an attached diagnostic artifact
only.

Make the step/attempt/run/task projection update in one transaction per
transition, write an operations event/outbox record in the same transaction, and
use `lease_gen` plus a version CAS on every transition. Update dependency logic
to require `verified` for write-dependent edges; explicitly model any approved
manual override with its actor, reason, and expiry.

**Correction to the earlier V3 launch guidance:** avoiding a `verifying` state
keeps the state model smaller but makes the product state false. The Operations
Room contract already defines `verifying`; implement it.

**Acceptance tests:** a successful worker exit cannot make a task done; a failed
independent check transitions the delivered attempt to failure/retry; stale
delivery and stale verifier results cannot alter the active attempt; dependent
write steps remain blocked until verification passes.

### 0.3 Enforce immutable runner provenance

**Owner area:** `crates/api`, deployment/CI.

Replace `CORTEX_RUNNER_IMAGE` free-form configuration with a signed runner
registry. Deployment supplies an OCI digest (`name@sha256:...`); startup rejects
tags, an empty value, or an unapproved digest. Persist the runner build ID,
digest, resource policy version, command argv, and executor version on every
check execution. Build and scan this image in CI, with an explicit update
process that creates a new runner policy version.

**Acceptance tests:** tag input causes startup/config validation failure; a
receipt always exposes a digest; old receipts retain their original digest after
a runner upgrade.

**Phase 0 exit gate:** code execution is sandboxed, completion is visibly
`verifying` until independent success, and no production UI calls a merely
delivered result `verified` or `done`.

## Phase 1 - Make verification a durable workflow, not a spawned side effect

**Goal:** a receipt reaches a terminal, inspectable state through crashes,
retries, and deploys.

### 1.1 Add a verification-job outbox and recovery worker

Create `verification_jobs` (or a generalized durable job table) with:

- job ID; run/step/attempt/lease generation; immutable delivered commit;
  frozen spec set ID; quote ID; runner policy version;
- `queued | claimed | retry_wait | succeeded | failed | inconclusive | dead`;
- claim token, claimed-at, lease/heartbeat, attempt count, next-run-at, and
  typed terminal reason; and
- a unique key covering the logical verification attempt.

In the transaction that moves a step from `delivered` to `verifying`, insert the
job/outbox event. A worker claims jobs with database CAS semantics, heartbeats,
and reclaims expired claims. On startup and on an interval, reconcile every
non-terminal job. Never use `tokio::spawn` as the source of durability.

For single-node SQLite, run exactly one verifier dispatcher and fail startup if
the deployment does not assert single-node mode. The future Postgres dispatcher
must use `FOR UPDATE SKIP LOCKED` or equivalent lease claims; its semantics must
match the SQLite implementation.

**Acceptance tests:** crash after enqueue, after claim, after first check, after
verdict seal, and after ledger write. Each case recovers automatically, produces
at most one receipt/charge/refund, and exposes the recovery attempt in the
operations timeline.

### 1.2 Make independent verification drive all projections

On terminal verification, execute one idempotent transition that:

- seals the verification report;
- transitions attempt/step/run/task projections;
- unblocks or cancels dependent steps as appropriate;
- emits a `verification.completed` event with source `cortex_independent`; and
- queues the next scheduler action.

`Inconclusive` must not silently become done. It receives a bounded automatic
retry only for infrastructure-class failures, then enters `attention` with a
visible operator and customer explanation. A verification failure produces a
diagnostic branch/retry policy; it never quietly marks a completed step as
successful.

### 1.3 Create a receipt-first API and UI projection

Add a paginated, authorized `GET /api/receipts` backed directly by
`verification_runs`, not a scan of `verifier_reports`. Return status,
independence level, task/run/step links, quote/ledger links, source commit,
runner digest, checks, output artifacts, and retry history.

Update `RunsPane`, `ReceiptsPane`, task inspectors, graphs, and chat cards to
show exactly one of:

- `Delivered - verification queued/running`
- `Verified independently`
- `Verification failed`
- `Verification inconclusive - retrying/needs attention`
- `Manual override` (with actor and reason)

Keep the legacy report visible under **Worker-reported diagnostics**, never as a
verification badge. Do not fall back from an unavailable independent receipt to
a legacy success UI.

**Phase 1 exit gate:** every delivered change has a recoverable verification job
and one visible receipt state; task completion, dependencies, and operations
views agree after a page refresh or server restart.

## Phase 2 - Bind pricing and guarantees to the receipt

**Goal:** make "fixed price per verified outcome" mechanically true rather than
a copywriting promise.

### 2.1 Implement a Plan Receipt before dispatch

Promote the existing plan-receipt idea into the mandatory task contract. At
planning/approval time persist:

- objective, scope/repo/base commit, target and forbidden paths;
- decomposition DAG and explicit dependencies;
- acceptance criteria and frozen `CheckSpec`s;
- capability grants (write, network, GitHub/PR, deploy, secrets), each with
  scope and expiry;
- model/routing policy constraints and estimated execution envelope;
- a versioned fixed price quote, expiry, quote owner, and refund policy; and
- customer approval/override decisions.

The Plan Receipt is immutable after approval. Replanning creates a new receipt
and requires the exact approval rule appropriate to the changed scope, checks,
capabilities, or quote. It is the link from chat intent to implementation and
the "exam" the independent verifier grades.

### 2.2 Persist and reserve the quote

> ⚠️ **Superseded in part by Phase 6.4 — read that before implementing this.**
> This section was written assuming a fixed credit price per task class. The
> measured 3×–30× run-to-run cost variance on identical tasks does not support
> that, and Phase 6.4 replaces it with a forecast-plus-hard-cap model that
> graduates to fixed pricing per class once variance is measured and tight.
> Everything below about **idempotency, append-only ledger semantics, reservation,
> and refund coherence still applies unchanged** — only the shape of the quoted
> number changes. CREDITS.md must be amended before PR F persists a schema.

Create `task_quotes` and reference its ID from the plan, run, step attempt,
verification job, receipt, and ledger rows. Quotes must include whole credits,
price-list version, task class, issue timestamp, expiry, and policy result.

At dispatch, reserve the quoted credits or perform a clear preflight that
guarantees availability. At terminal verdict, use the immutable quote ID rather
than a caller-provided amount. Keep all ledger operations append-only and
idempotent, but make refund behavior coherent:

- verified outcome: settle the quoted charge once;
- verified failure after a settlement: restore the exact debited buckets once;
- infra inconclusive: no settlement and a retry/attention state;
- cancellation before delivery: release reservation; and
- manual override: a separately authorized, explicit ledger reason.

Do not enable outcome-pricing launch until this is live. The present
`quoted_credits: None` behavior is correct safety behavior, not a launch-ready
pricing path.

### 2.3 Provide invoice-grade reconciliation

Expose a ledger entry that links: quote -> plan receipt -> run -> step attempt
-> verification ID -> receipt -> charge/refund. Customers can export this as a
compact dispute bundle; operators can reconcile balance caches against the
append-only ledger and alert on any mismatch.

**Phase 2 exit gate:** a chaos test covering retry, server crash, duplicate
message, failed verification, and manual override results in exactly the
documented customer balance and one evidence-linked ledger explanation.

## Phase 3 - Build the exceptional coding and chat experience

**Goal:** make the safe system feel faster, clearer, and more useful than a
terminal transcript without replacing developer control.

### 3.1 Treat chat as a workbench, not an alternate source of truth

Project Chat must attach messages to the Plan Receipt, task, run, and step.
Use three interaction modes with explicit transitions:

- **Ask:** read-only repository questions, explanation, design debate, and
  code review. No quote or execution side effect.
- **Plan:** Cortex proposes a Plan Receipt and asks only for material missing
  decisions: scope, tests, capability grants, risk, or budget.
- **Execute:** shows the approved contract, live state, safe next action,
  streamed evidence, and a direct route to the diff/receipt.

Persist human decisions as structured `Ask` artifacts rather than hiding them
in prose. Let a user revise a plan, fork a task, or attach an existing task to a
conversation without losing history. The task graph remains canonical; chat is
its collaborative lens.

### 3.2 Make authority and autonomy legible

Before execution, show a concise capability card: what may change, which branch
is used, whether network is permitted, expected cost, required checks, and
whether PR/deploy requests need an approval. Offer well-defined autonomy
profiles such as `read-only`, `propose`, `write branch`, `open PR`, and
`deploy-approved`; do not infer privileged authority from conversational tone.

Every destructive or external action is an auditable event with actor,
authority scope, target, before/after data when practical, and receipt/task
link. The UI needs one-click pause, cancel, retry, and "why is this blocked?"
actions that call the canonical API only.

### 3.3 Deliver a review surface, not just a completion toast

For each verified result, make the default handoff a review bundle:

- concise outcome summary and changed-file map;
- branch/commit/PR state and base-commit drift check;
- independent check matrix with durable output links;
- browser/screenshot artifact for UI changes when the Plan Receipt requires it;
- risk/authority/capability changes; and
- the exact next action: review diff, request revision, retry with scope,
  approve PR, or inspect failure.

Use a single visual vocabulary for `executing`, `verifying`, `verified`,
`blocked`, and `attention required`. Do not seed fake collaborators or activity
in the production surface. If offline drafts are retained, put them in a
visibly separate "local draft" mode that cannot mutate shared task status;
use ETags/version conflicts instead of last-write-wins whole-state sync.

### 3.4 Carry durable, layered context

Adopt a compact context contract for every task: repository instructions,
path-specific instructions, architecture/repository map, relevant symbols and
tests, Plan Receipt, prior verified outcomes, and only task-relevant chat
decisions. Support established instruction files (`AGENTS.md`, repository and
path-specific instruction files) as a first-class, inspectable context source.
This matches current industry practice while avoiding an unbounded chat
transcript as model context. [GitHub instruction support](https://docs.github.com/en/copilot/reference/custom-instructions-support)

**Phase 3 exit gate:** a new developer can answer "what is working, what did
it change, what is proven, what will it cost, and what should I do next?" from
one task screen without reading raw logs.

## Phase 4 - Scale safely and improve throughput

**Goal:** remove single-node and monolithic-state limits only after the product
truth is correct.

### 4.1 Enforce the current deployment boundary

Until the data plane is migrated, make single-node runtime a deployment
invariant: one scheduler/verifier process, no horizontally scaled API service,
explicit startup/config assertion, database on a persistent volume outside the
Git tree, backups, integrity checks, WAL monitoring, and verified restore
drills. Add alerts for stuck verification jobs, lease expiration, dispatch
duplicates, verifier queue latency, sandbox cleanup failures, and ledger
reconciliation failures.

### 4.2 Move orchestration state to Postgres deliberately

SQLite with `Mutex<Connection>` and synchronous database calls is acceptable for
a constrained private alpha, not for concurrent multi-tenant orchestration.
Design a Postgres migration around the already-defined CAS and append-only
semantics, not a table-for-table port:

- transactional outbox/events and rebuildable projections;
- lease/job claims with `SKIP LOCKED` or an equivalent CAS lease;
- idempotency constraints retained at the database level;
- leader election for scheduler responsibilities;
- independent API, scheduler, verifier, and sandbox-worker roles; and
- online migration, dual-read/verify, cutover, and rollback plan.

Only then add a read pool, separate write ownership, multiple replicas, and
parallel verifier workers. Benchmark p50/p95 dispatch latency, queue age,
database lock wait, verifier duration, and provider spend waste before and
after each change.

### 4.3 Split only the real seams

Do not begin with a microservice rewrite. The first seams are: task/plan API,
scheduler, durable job dispatcher, sandbox runner, verifier, artifact storage,
and receipt/ledger projection. Keep a typed protocol crate for their shared
contracts and use contract tests across every boundary.

**Phase 4 exit gate:** a controlled two-replica failure test demonstrates no
double dispatch, no duplicate ledger effects, correct lease recovery, and no
cross-tenant artifact access.

## Phase 5 - Earn the routing and multi-agent advantage

**Goal:** make model choice evidence-based rather than static heuristics or
self-reported success.

### 5.1 Use only independently labelled outcomes for learning

Record immutable route-decision facts at dispatch: candidate set, model/version,
prompt/context digest, task class, risk, quote, environment, policy version,
and expected checks. On the independent terminal verdict, record the outcome,
latency, provider cost, retry count, human acceptance/rejection, and
contamination class. Feed positive and negative rewards into the router only
from this terminal record.

Quarantine samples that were manually overridden, affected by a sandbox outage,
or lack sufficient verification. Never let a failed receipt silently become a
positive example because the worker exited zero.

### 5.2 Run a champion/challenger evaluation program

Build a private, consented replay corpus of Plan Receipts and holdout tasks.
Evaluate candidate route policies by verified pass rate, total cost to verified
outcome, latency, retry rate, regression rate, and human review burden. Use
confidence bounds and minimum samples before changing default routing; allow
shadow routing and offline replay before live traffic changes.

Use multi-agent work selectively: planner, implementer, deterministic verifier,
and independent reviewer each receive scoped context and capability envelopes.
Do not parallelize two writers over overlapping paths. When comparing multiple
attempts, choose only through executable checks and bounded human review, not a
model's opinion of its own answer.

### 5.3 Add a visual/browser quality loop for UI tasks

When a Plan Receipt declares a UI acceptance criterion, provision a sandboxed
browser worker that captures labelled screenshots and runs defined smoke tests.
Attach artifacts to the receipt and PR review bundle. This is a differentiator
that is valuable only because the artifact is part of the same trusted task
contract, not a decorative screenshot.

Independent sandboxes, task-local environments, rich approvals, and evidence
linked to completion are already expected at the leading edge of coding-agent
products; Cortex should match these safety baselines and differentiate through
its stronger independent receipt and outcome-linked pricing. [OpenAI Codex overview](https://openai.com/index/introducing-codex/), [GitHub isolated agent sessions](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions)

**Phase 5 exit gate:** a monthly routing report demonstrates a statistically
credible improvement in verified outcome economics against the fixed champion,
with raw evidence available for audit.

---

# Track B - The product thesis

Track A makes Cortex honest. Track B makes it worth buying. The phases below are
numbered to continue Track A's sequence, but they are **not gated behind Phase 5**
— see the interleaved delivery order at the end for the real dependencies.

## Phase 6 - The control surface: effort, speed, and predictable spend

**Goal:** turn "a dial from speed to intelligence" from a slider into a
mechanism that provably changes the plan, the forecast, and the proof — and make
spend incapable of surprising anyone.

### 6.1 Two dials, because Cortex is an orchestrator and not a model

**This is the single most important design decision in Track B, and it is where
Cortex should deliberately diverge from every product it will be compared to.**

Every model-shaped product — GPT, Claude Code, Codex — ships one dial, because
for a single model the tradeoff is genuinely monotonic: more thinking means more
tokens means more latency. Left is fast and shallow, right is slow and deep. You
cannot have both, so one dial tells the truth.

Cortex is not a model. It is an orchestrator, and for an orchestrator **depth and
latency are bought with different currencies**:

- **Depth** is bought with reasoning effort, stronger models, deeper
  decomposition, more checks, and an independent reviewer. It costs *tokens*.
- **Latency** is bought with parallelism, racing, speculative execution, and warm
  sandboxes. It costs *duplicated work*.

These are separable. A single model cannot be fast and thorough at once; an
orchestrator can, by doing thorough work in parallel and paying for the
redundancy. Collapsing them into one dial imports a constraint Cortex does not
have, and throws away its main structural advantage over every competitor.

So: **two dials, and cost is the dependent variable.**

```text
        EFFORT  (how thorough)          SPEED  (how fast)
        low ──────────────► ultra       patient ──────────► urgent
                    │                            │
                    └──────────┬─────────────────┘
                               ▼
                    FORECAST COST  (shown, capped, never a surprise)
```

Developers already have a mental model for this and have had it for fifty years:
**fast, good, cheap — pick two.** Rendering literally that is the clearest
control surface available, and unlike the vendors, Cortex can be honest about it
because it can actually deliver any two.

| | **Patient** | **Urgent** |
|---|---|---|
| **Low effort** | Cheapest capable model, single pass, minimal checks. The overnight dependency bump. | One fast model, single pass, warm sandbox. Cheap and quick; the shallow answer arrives now. |
| **Ultra effort** | Deep decomposition, strongest models, full check battery, independent review, sequential escalation. Lowest cost per unit of depth — the weekend refactor. | **The differentiated quadrant.** Same depth, bought concurrently: parallel fan-out across the DAG, best-of-N raced with the verifier picking the first passer, checks run concurrently. Expensive, and no competitor can offer it. |

The bottom-right quadrant is the product. It is also **only coherent because
Cortex has an execution verifier**: racing N attempts is worthless unless
something can identify the winner, which is exactly the argument VISION.md
already makes for why best-of-N needs a verifier to beat single-shot. A
competitor without verdicts cannot sell "thorough and fast" — they can only sell
"more attempts and hope."

Underneath, the two dials resolve to four knobs. Model them separately and
compose them; do not let any of them become the user's problem:

| Knob | What it is | Driven by | Where it lands today |
|---|---|---|---|
| **Capability** | Which model runs the step. | Effort | `Tier::{Search,Execute,Think}` → `default_model` (`crates/core/src/evaluator.rs:541`). Three coarse buckets, hardcoded. |
| **Reasoning effort** | The per-request provider parameter governing thinking tokens and tool-call count. | Effort | **Nowhere.** Not in `RoutingDecision`, not in `build_command`. |
| **Workflow depth** | Single pass vs. plan→implement vs. plan→implement→review; how big the check battery is. | Effort | `RouteTemplate`, reachable only from the CLI binary. |
| **Concurrency** | DAG fan-out width, best-of-N racing, speculative execution, warm sandbox pool, parallel verification. | Speed | Partially present as worktrees; **no step-level arbitration and no integration step** — see Phase 11. |

A useful way to hold it: **capability is who does the work, reasoning effort is
how hard they think, workflow depth is how many people are in the room, and
concurrency is how many rooms run at once.**

**The speed dial is gated on Phase 11.** Buying latency with parallelism is only
safe once parallel steps cannot corrupt each other's work, and today they can.
Ship the effort dial first; ship the speed dial when conflict-freedom is real.
A speed dial on an unsafe concurrency model is worse than no speed dial.

### 6.2 `ExecutionPolicy` is versioned data, not a `match`

Define five effort positions. Recommended names, deliberately borrowing the
vocabulary developers already know from Claude Code and the Codex CLI so the
control needs no explanation: **`low · medium · high · xhigh · ultra`**.

A dial position does **not** map directly to a model. The two positions together
select an `ExecutionPolicy` row, and the policy resolves a point in the
four-knob space **per task class**. `ultra` on a `test` leaf and `ultra` on a
`security-review` leaf must not resolve to the same thing.

Speed is a second, independent position: **`patient · normal · urgent`**. Three
positions is enough — latency buying has sharply diminishing returns, and each
position roughly doubles the redundant work.

```text
ExecutionPolicy {
  policy_version,                 -- recorded on every decision and receipt
  effort_position,                -- low | medium | high | xhigh | ultra
  speed_position,                 -- patient | normal | urgent
  task_class,                     -- test | refactor | feature | security-review | ...

  -- resolved from effort
  capability_floor,               -- minimum catalog capability class
  reasoning_effort,               -- provider-native level to request
  workflow_depth,                 -- single | plan_implement | plan_implement_review
  check_battery_ref,              -- see Phase 8.4: higher effort buys more checks
  max_attempts,                   -- escalation budget

  -- resolved from speed
  max_parallel_leaves,            -- DAG fan-out width
  race_width,                     -- best-of-N attempts raced; verifier picks first passer
  speculative_depth,              -- how far ahead to start likely-next steps
  sandbox_warm_pool,              -- pre-provisioned vs cold start
  parallel_check_execution,       -- run the battery concurrently

  -- consequences, not inputs
  forecast_model_ref,             -- see 6.4; which empirical distribution priced this
  wall_clock_budget
}
```

Note what is deliberately *not* in this struct: a price. Effort and speed
determine how much work happens; how that work is charged is Phase 6.4, and
under the model recommended there it is a forecast against actuals rather than a
multiplier on a fixed number.

Store it as a seeded table with a migration, not a Rust `match`. It is tuned by
measurement (Phase 5.2's evaluation loop), and anything tuned by measurement must
be changeable without a deploy — but every change must be a new
`policy_version`, so old receipts keep resolving to the policy that actually ran.

**Do not ship a raw model picker.** VISION.md is explicit that Cortex is not a
model gateway, and a model picker converts a differentiated outcome product into
a commodity one with a worse UI than OpenRouter's. The dial is the abstraction
that lets Cortex change models underneath without renegotiating with the user.

### 6.3 Inheritance and escalation: conversation sets the default, tasks can move

The dial is a **conversation-level preference**, not a per-request switch. Every
task created from that conversation inherits it, and from there either side can
move an individual task. This is the founder's stated model and it is the right
one — it means "I want max effort for this entire app" is said once and then
simply holds.

The resolution chain, most specific wins:

```text
org policy ceiling  →  project default  →  conversation preference
                                              →  task override (user)
                                              →  task suggestion (Cortex, needs consent)
                                                    →  per-leaf resolution (Cortex, inside the envelope)
```

Rules that make each link honest:

- **Inheritance is visible and sticky.** A task shows the dial it inherited and
  from where. Changing the conversation preference does not retroactively change
  tasks already planned — those are frozen contracts.
- **The user can move any task, up or down, at any time before dispatch.** After
  dispatch it becomes a new attempt, because effort is frozen for an attempt's
  lifetime (see 0.1: changing effort mid-conversation also discards prompt-cache
  prefixes, so a mid-flight change is not free and must not be pretended to be).
- **Cortex suggests, and says why.** "This step touches auth and payment paths;
  I'd run it at `xhigh` rather than the inherited `medium` — about 3× the
  forecast." The suggestion carries its reason and its cost delta, and the user
  accepts or declines. Cortex may *always* suggest; it may only *self-raise*
  within the approved envelope and budget cap.
- **Cortex may lower without asking, and must say so.** If the router's history
  shows a task class passes at `medium` as reliably as at `high`, taking the
  cheaper path is doing its job — but the receipt records that it did, so the
  user can audit it. Silent *upward* movement is prohibited; silent *downward*
  movement is allowed, logged, and reversible.
- **Natural-language scoping is first-class.** "The security of this iOS app
  needs high effort, everything else use your judgment" resolves to a per-subtree
  floor on the security subtree and is persisted as a structured `Ask` artifact
  (Phase 3.1) — never re-parsed from chat prose on each run.
- **Per-leaf resolution happens inside whatever envelope survives the chain.**
  Task class, risk, and blast radius decide where in the envelope each leaf lands.
  This is the "Cortex knows how to engineer it properly" behaviour: the user set
  a ceiling, not a uniform setting.
- **Org ceilings always win, and a downgrade is shown with a named reason.**
  Silent downgrade is the fastest way to make the dial feel fake.
- **Effort is frozen at dispatch** alongside the check spec — `scheduler.rs`
  already freezes specs at dispatch, so use the same transaction — recorded on
  the attempt, and reproduced in the receipt.

**Acceptance tests:** moving either dial one position changes at least one
visible field on the Plan Receipt for a fixed task; a task shows which level it
inherited and from where; a Cortex suggestion carries a reason and a forecast
delta and cannot self-apply upward; a downward auto-adjustment appears on the
receipt; a per-subtree override applies to that subtree and no other; an org
ceiling downgrade is visible and reasoned; a receipt's recorded effort equals what
the backend reported applying.

### 6.4 Forecast and cap, not a fixed price — and this amends CREDITS.md

**This section supersedes the earlier recommendation in this plan that effort be
a price multiplier on a fixed quote.** That recommendation assumed a task's cost
is estimable in advance. The evidence says it is not, and the correction matters
enough to state plainly.

The measured reality of agentic workloads:

- **Run-to-run variance on the *same task* is roughly 3× to 30×**, driven by how
  many tool calls and retries a given run happens to need. A fixed price per task
  class is therefore not a price; it is a bet on a distribution with a very long
  right tail.
- **Models systematically underestimate their own token usage.** Published
  forecasting work finds only weak-to-moderate correlation with real consumption,
  biased low across every model tested. So "ask the model what this will cost" is
  the one approach guaranteed to produce confident under-quotes.
- The whole category converted to effort metering within four months of H1 2026,
  and **bill shock is now its dominant complaint** (RESEARCH-2026-08 rec 1).
  Raw metering is not an acceptable answer either.

Fixed pricing is undeliverable; raw metering is unsellable. The resolution is the
thing neither camp does:

> **Cortex forecasts a range from its own history, quotes a hard cap, executes
> against the cap, and bills what actually happened — never more than the cap
> without asking.**

That is a *predictability* guarantee rather than a *price* guarantee, and it is
strictly more honest than either alternative. The customer's question is not
"what is the exact price"; it is "can this surprise me." The answer becomes no.

**Why Cortex can forecast when the models cannot.** A model asked to estimate its
own cost is introspecting. Cortex is not introspecting — it has an empirical
distribution of *completed, verdict-labelled runs* per (task class × effort ×
speed × repo size × ecosystem). Nobody else has that dataset, because nobody else
records verdicts. This is the same asset as Phase 8.4(d), pointed at pricing. It
also means the forecast improves monotonically with usage, which is a compounding
advantage rather than a one-time feature.

Design rules:

- **Quote the p90, not the p50.** The cap must sit in the tail, because the tail
  is where the customer relationship is destroyed. Under-quoting is far more
  expensive than over-quoting.
- **Every forecast records a prediction ID that joins to actuals.** Calibration
  is a closed loop or it is decoration. Track forecast-vs-actual error per class
  and alert when a class drifts out of calibration.
- **A cold class has no forecast, and says so.** Before there is history, Cortex
  shows a wide range explicitly labelled as an estimate and requires an explicit
  cap from the user. Never fabricate a narrow forecast to look confident.
- **The cap is enforced at the sandbox boundary**, not by asking the agent to
  behave — `token_budget` and `wall_clock_budget` on `ExecutionJob` (Phase 0.1).
  A budget the agent can talk its way past is not a budget.
- **At the cap, Cortex stops and asks** — it does not silently continue, and it
  does not silently abandon. The user sees what was accomplished, what remains,
  and what continuing would cost, and decides. This is the mechanism that
  delivers "prevents random extra API and unexpected costs."
- **Live burn is visible during the run**, against the forecast and the cap. A
  progress bar for money.

#### Reconciling with CREDITS.md

CREDITS.md holds that a credit is a **verified task, integer-denominated, never
tokens**. That is not wrong — it is the correct *end state*, and it should not be
abandoned. But it can only be honestly offered for a task class whose cost
distribution Cortex has actually measured and found tight.

So the two models are one model with a maturity axis:

| Class maturity | What the customer is quoted | Requirement to get here |
|---|---|---|
| **Cold** — no history | A labelled estimate range, plus a user-set cap | Nothing; this is the entry state |
| **Measured** — enough runs for a distribution | A p90 cap in credits, billed on actuals below it | Calibrated forecast, monitored drift |
| **Fixed** — tight distribution, stable pass rate | **A single fixed credit price**, exactly as CREDITS.md describes | Measured variance under threshold; Cortex absorbs the tail as a margin decision |

**A task class graduates to fixed pricing by earning it.** That is a far stronger
story than declaring fixed prices on day one and discovering the tail in
production, and it gives the marketing something true to say at every stage.
Publishing which classes are fixed-priced, and why, is itself a trust artifact no
competitor can copy.

Two rules that survive from the original model unchanged, because they are the
wedge and not the meter:

- **Refund on verification failure.** Independent of how the work was priced. A
  task that fails its checks is not charged. This is separable from the pricing
  model and must not be traded away in this redesign.
- **Escalation after a failed verification is charged to Cortex, not the
  customer.** The customer paid for a verified outcome. If Cortex's first,
  cheaper attempt fails its checks, the retry is Cortex's cost of having been
  wrong. This is what forces the router to get genuinely good rather than to
  gamble cheap, and it is why the cost-aware reward in Phase 7.2 has teeth.

**Action required:** CREDITS.md must be amended to describe the maturity ladder
rather than asserting fixed pricing universally. Do this *before* PR F persists a
price list, since the schema differs — a cap-and-actuals model needs a forecast
row, a cap, and a settlement, where a fixed model needs only a price.

### 6.5 The estimator is a subsystem Cortex owns, not a model call

To be unambiguous, because the distinction matters: **nothing here asks a model
what something will cost.** The estimator is ordinary deterministic software —
measurable features in, a fitted statistical model, a percentile out, calibrated
against recorded actuals. It should be as boring and as testable as the ledger.

#### Inputs: things Cortex can measure before running anything

Half of these are available from a repo scan that costs seconds, and none of them
require inference. Run the scan at plan time and cache it per commit.

| Feature group | Examples | Source |
|---|---|---|
| **Repo shape** | LOC, file count, language mix, dependency count, max directory depth, monorepo vs single package | static scan, cached per commit |
| **Verification cost** | measured wall-clock of the test suite, lint, typecheck, build; container pull and warm-up time | measured on first run, cached per repo, refreshed on drift — this is `c_v` from Phase 7.3 and it is *directly measurable*, never guessed |
| **Task shape** | task class, `WorkKind`, blast radius (files in the write set), risk level, DAG node count and depth, achievable parallel width | the plan itself |
| **Policy** | effort position, speed position, race width, capability class, check battery size | `ExecutionPolicy` |
| **History** | this repo's own past runs; this task class across all repos; this professional's record (Phase 12) | the outcome corpus |
| **Context** | packed context size for the leaf, prior attempt count on this task | CONTEXT.md C3 |

#### The model: conditional quantiles, not a point estimate

The output is a **distribution**, because the input is a distribution. Concretely:

- Fit **quantile regression** (or gradient-boosted quantile trees — the feature
  set is small, tabular, and non-linear, which is exactly where they win) to
  predict p50, p80, and p95 of cost and of wall-clock, separately.
- Predict *per leaf*, then compose the run: costs add, and wall-clock composes
  along the DAG's critical path, not by summing. A wide plan is cheap in time and
  expensive in money; a deep plan is the reverse. The estimator must model that
  or the speed dial's numbers will be nonsense.
- **Back off along a hierarchy when data is thin**: this repo + this class →
  this class across repos → this class family → global prior. Report which level
  answered, because it determines how wide the interval is.
- Add the **retry mass**: expected cost includes `(1 − p_verified) × retry cost`
  using the router's own pass-rate estimate for that route. A route that usually
  needs two attempts must forecast two attempts.
- Keep it **monotonic by construction**: `ultra` must never forecast below
  `xhigh` for the same task. Fit with monotonicity constraints, or clamp
  post-hoc, and test it. A non-monotonic dial destroys trust instantly and is the
  single most likely visible bug in this subsystem.

#### The closed loop

- Every forecast writes a row with a **prediction ID**, the feature vector, the
  model version, and the backoff level used.
- Every completed run joins its actual back to that row.
- **Calibration is monitored, not assumed**: track the empirical hit rate of each
  quantile. If the p95 cap is being exceeded more than 5% of the time, the model
  is miscalibrated and must alert — that is a reliability incident, not a
  metrics curiosity.
- Track **coverage** and **sharpness** separately. A trivially wide interval has
  perfect coverage and is useless; the goal is the narrowest interval that holds
  its promise.
- Retrain on a schedule, version the model, and record `estimator_version` on
  every forecast so old quotes remain explicable.

#### Cold start, honestly

Before there is history, there is no estimator — there is a seeded prior from a
small internal benchmark corpus, and it must be **labelled as a prior**, with a
visibly wide interval and a required user-set cap. Do not synthesise confidence.
The interval narrowing over the first weeks is a *feature to show the user*, not
an embarrassment to hide: "our estimates for this class are now within ±12%, from
±60% a month ago" is a trust artifact.

**Acceptance tests:** forecasts are monotonic across effort and speed positions;
quantile hit rates land within tolerance on held-out runs; the estimator degrades
to a labelled prior with no history and says which backoff level answered;
wall-clock composes along the critical path rather than summing; a repo whose
test suite slows down produces higher forecasts without a redeploy.

### 6.6 The transparency contract — the developer is never blind

**Requirement: at no point may a developer be unable to answer "what will this
cost and how long will it take" or "what is it costing right now."** Not in
settings, not in docs, not after the fact. This is a hard product contract and it
should be enforced by tests over the surface, not by good intentions.

Four moments, four obligations:

**1. Choosing — show the whole curve, not the selected point.**

This is the key design move and it is what makes the dials legible. A dial that
shows a cost only for the position you already picked forces you to move it back
and forth to learn anything. Instead, **every position renders its own estimate
simultaneously**, for this specific task:

```text
  EFFORT                                       SPEED
  ○ low       ~4 cr    · ~3 min                ○ patient   ~11 cr  · ~22 min
  ○ medium    ~7 cr    · ~5 min                ● normal    ~14 cr  · ~9 min
  ● high      ~14 cr   · ~9 min                ○ urgent    ~31 cr  · ~4 min
  ○ xhigh     ~26 cr   · ~14 min
  ○ ultra     ~58 cr   · ~25 min               cap: 40 cr   [edit]
                                               estimates for "refactor · this repo"
                                               have landed within ±14% on the last 37 runs
```

Everything in that panel is real: the numbers come from the estimator for *this
task on this repo*, the accuracy line is the measured calibration record, and the
cap is editable and enforced. A developer can see the entire tradeoff surface in
one glance and never has to guess what a control does.

**2. Approving — the Plan Receipt carries the forecast per leaf.**

Range, not point. Cap, prominent and editable. What changes if a step fails and
retries. Which leaves are parallel and which are serialised, with the limiting
resource named (Phase 11.2). No approval without a visible cap.

**3. Running — live burn, always visible.**

Spend so far against forecast and against cap. Projected final, updated as leaves
complete. Which leaf is spending. Time elapsed against forecast wall-clock. And
an always-available answer to *"why is this taking so long"* — waiting on a lease,
retrying after a failed check, escalated to a stronger model, queued behind a
budget approval.

**4. After — actual versus forecast, on the receipt, permanently.**

Every receipt shows what was estimated and what happened. This is the mechanism
that makes the whole thing self-policing: a systematically optimistic estimator
becomes visible to the customer before it becomes visible in a support ticket.
Aggregate it per user: "your last 20 runs: 17 under forecast, 3 over, none over
cap."

**Publishing your own calibration record is the trust move nobody in this
category makes.** Every competitor shows a meter after the fact. Showing your
estimate, your actual, and your historical accuracy — including when you were
wrong — is a categorically different posture, and Cortex is the only product with
the data to do it.

**Acceptance tests:** the surface cannot render a dial without per-position
estimates; a plan cannot be approved without a visible cap; a running task always
exposes burn and a reason for its current state; every receipt shows forecast
versus actual; and a deliberately miscalibrated estimator is visible to the user
without anyone reading a log.

### 6.7 What "ultra" should actually mean

Reserve the top position for a change in *kind*, not just a bigger number.
Grounded in RESEARCH-2026-08 §3, `ultra` should buy:

- maximum capability and the provider's top reasoning-effort level;
- a **deeper decomposition** — the plan itself is planned at higher effort, which
  is the highest-leverage place to spend, since MAST puts 41.8% of multi-agent
  failures in the specification class;
- **plan lint** (RESEARCH rec 5) run and surfaced, not skipped;
- the **held-out check battery** (RESEARCH rec 2) rather than only the visible
  contract checks;
- an **independent fresh-context reviewer** over the diff before delivery — read
  only, no verdict authority, output attached to the review bundle;
- a larger attempt/escalation budget.

Note what is deliberately absent: multi-model debate and consensus layers.
RESEARCH-2026-08 §3 rejects both on measured grounds (premature-consensus
collapse; 76–89% problem drift in long debates), and "models propose, never
grade" is not suspended at high effort. `ultra` buys more *evidence*, not more
*opinions*.

And symmetrically, `urgent` should buy, in this order of safety:

1. **Best-of-N racing** — N attempts at the same leaf, verifier keeps the first
   to pass, the rest are discarded. No extra lease breadth, no integration risk.
   This is the safest way to convert money into latency and should be the first
   thing the speed dial reaches for.
2. **Warm sandbox pools** — cold start is real, measurable latency that costs
   nothing but capacity to remove.
3. **Parallel check execution** — run the battery concurrently rather than
   serially.
4. **Wider DAG fan-out** — only across leaves proven disjoint at plan time
   (Phase 11.2).
5. **Speculative execution** — start likely-next steps before the current
   verdict lands, and discard on a wrong guess. Highest waste, lowest priority,
   and only worth it where the branch probability is high.

Racing before width, always: width is bounded by the dependency graph and
carries integration risk, while racing is bounded only by budget and carries
none.

## Phase 7 - Model economics as a first-class system

**Goal:** make "cheapest tool that actually passes" a measurable, optimised
quantity rather than an aspiration. This is the phase that most directly serves
the founder's stated priority.

### 7.1 One versioned model catalog

Collapse the three hand-synchronised tables (`evaluator::default_model`,
`engine::models::REGISTRY`, `CostEstimator::get_model_rates`) into a single
seeded, versioned catalog. Per entry:

provider · catalog model ID · provider model string · capability class ·
input/output/cache-read/cache-write price · context window · max output ·
supported effort levels · supported invocation modes (CLI / HTTP) · availability
status · deprecation date · price effective-from date.

Rules that make it load-bearing rather than a refactor:

- **No hardcoded model string survives** outside the catalog. Add a test that
  greps the workspace for known model-name patterns outside the catalog module
  and fails on a hit — otherwise the third table grows back within a quarter.
- **Prices are dated.** Provider prices change; a receipt from March must
  reconcile against March's prices. `price_effective_from` is not optional.
- **`catalog_version` is recorded on every routing decision, attempt, and
  receipt.** Without it, historical cost analysis is unreconcilable and the
  router's training data silently mixes price regimes.
- **Capability class replaces `Tier`'s three buckets** as the routing primitive.
  Keep `Tier` as a derived view if it is load-bearing elsewhere, but the router
  should score against catalog facts, not an enum with three values.
- Substring matching on model names (`m.contains("haiku")`) is deleted, not
  extended. It is how `CostEstimator` ended up pricing 2026 traffic at
  `claude-3` rates.

### 7.2 Reward on cost-to-verified-outcome

Replace the binary reward at `crates/api/src/scheduler.rs:1002`. The reward for a
route must be a function of:

- **verified** (from the independent verdict only — Track A PR E already moves
  the trigger point);
- **total provider spend for the whole attempt chain**, including failed attempts
  and escalations, not just the winning attempt;
- **the cost of verification itself**, which is a container running a real test
  suite and is frequently not small;
- **wall-clock latency**, weighted by the dial position (the left side of the
  dial is a latency preference, and it needs a term in the objective or it means
  nothing);
- **human rework**, when the review bundle is rejected — a route that produces
  passing-but-rejected diffs is a bad route, and this is the only signal that
  catches teaching-to-the-test.

The headline business metric that falls out, and that should be on the operator
dashboard from day one: **credits-per-verified-task COGS, per task class, per
model, per dial position.** Under outcome pricing the customer's price is fixed,
so provider efficiency is Cortex's gross margin. This resolves the founder's
tension about cheap-versus-expensive models cleanly: *the customer buys an
outcome at a fixed price; which model delivers it is a margin decision Cortex
owns and the customer never sees.* The dial controls quality and thoroughness;
it does not control which vendor gets the traffic.

Keep RESEARCH-2026-08's contamination weighting and quarantine rules; add cost
as a second dimension rather than replacing them.

### 7.3 The escalation ladder, and when it is actually cheaper

Cascading cheap→strong is the standard cost-reduction result (FrugalGPT-style
cascades; RouteLLM-style learned routing), and Cortex has a genuine structural
advantage over both: **those systems escalate on a confidence proxy, Cortex
escalates on an executed verdict.** That is the defensible version of the routing
claim, and it is the same argument VISION.md already makes for why verification
is what makes cheap models safe to use.

But cascading is not free, and it is worth writing down when it pays. For one
step, with cheap-attempt cost `c_c`, strong-attempt cost `c_s`, verification cost
`c_v`, and cheap-model verified pass rate `p_c`:

```text
E[straight to strong]  = c_s + c_v
E[cheap, then escalate] = c_c + c_v + (1 - p_c) * (c_s + c_v)

cheap-first wins  ⟺  p_c  >  (c_c + c_v) / (c_s + c_v)
```

The consequence is not obvious and matters a lot for Cortex specifically:
**verification cost sits on both sides and pushes the threshold up.** Two worked
cases, same models:

- Light checks (`c_c`=0.10, `c_s`=1.00, `c_v`=0.05): threshold ≈ **14%**. Almost
  any capable cheap model wins. Cascade aggressively.
- Heavy checks (`c_c`=0.10, `c_s`=1.00, `c_v`=2.00): threshold ≈ **70%**. The
  cheap model must clear a 70% verified pass rate before cascading pays at all.

So `c_v` must be **measured per task class and stored in the catalog alongside
model prices**, and the escalation policy must be per task class. A repo whose
test suite takes twenty minutes has fundamentally different routing economics
from one whose checks are a type-check and a lint. No competitor can compute this
number, because none of them run the checks.

Also weight latency: two cheap attempts plus two verification runs can beat one
strong attempt on price and lose badly on the clock, and on the left side of the
dial the clock is what the user asked for.

### 7.4 Guardrails, because a bad router is worse than no router

VISION.md already carries the finding that a badly calibrated router can cost
**three times** more than not routing, and that one commercial router measured
−24.7% against simply using the best single model. Treat that as a design
constraint on this phase, not a footnote:

- Every routing policy change ships behind Phase 5.2's shadow evaluation with
  minimum sample counts and confidence bounds. No policy change reaches live
  traffic on a hunch.
- Keep a permanently available **champion baseline of "always use the strongest
  model"** and report the router's cost and quality against it continuously. If
  the router is not beating that baseline on cost-to-verified-outcome, it is
  costing money and should be switched off.
- Cap escalation depth per Plan Receipt and surface the cap. An unbounded ladder
  is how a fixed-price task becomes a margin event.
- Per-org provider allowlists are a **routing constraint evaluated before
  scoring**, not a UI filter (see Phase 9.3). An org that forbids a provider must
  never have work routed there, including on escalation.

## Phase 8 - Understanding intent, and engineering top-down

**Goal:** make "Cortex understands what you meant and knows how to build it
properly" a mechanism rather than a marketing sentence.

### 8.1 Replace keyword classification with a structured intake

`parse_intent` is prefix-then-substring matching over eight verbs with a 0.30
catch-all (`crates/core/src/evaluator.rs:704-740`). It cannot represent
"an iOS app for crypto traders where the security matters more than the UI."

Introduce a **`TaskFrame`**: a typed artifact produced by one cheap, low-effort
model call at intake, before any planning or billing. It carries:

objective · deliverable kind (new project / feature / fix / investigation /
review / migration) · domain and ecosystem · target platform · named
non-functional priorities (security, performance, accessibility, cost) with
per-area emphasis · explicit constraints · **explicit unknowns and open
questions** · risk flags · suggested effort envelope · one-run vs. staged
preference · confidence.

Design rules:

- **Cheap and low effort by construction.** This is exactly the workload the
  effort dial's left side exists for: a fast structured extraction, not a
  reasoning task. It must not add meaningful latency or cost to intake.
- **Deterministic classification survives as a cross-check, not a fallback
  hierarchy.** When the frame and the deterministic classifier disagree
  materially, that disagreement is itself a low-confidence signal.
- **The frame is persisted and is the input to the Plan Receipt**, so the chain
  from a sentence a human typed to a priced, checked DAG is inspectable end to
  end. This is what makes "it understood me" auditable rather than asserted.
- **One classifier, not two.** Delete `engine::pipeline::parse_intent` or make
  it call the same code path as the product. Two classifiers that disagree on
  the same sentence is a defect regardless of which is better.

### 8.2 Give confidence a job

Confidence is currently computed and discarded (`scheduler.rs:1075` records it as
evidence; nothing branches on it). Wire it to invariant 13:

- Above the threshold and no material unknowns → proceed to Plan.
- Below the threshold, or a material unknown that changes scope, price, or
  capability grants → **Cortex asks**, in Plan mode, before anything billable.
- Questions are bounded and specific. "What framework?" is a good question.
  "Tell me more about your app" is not, and a plan that asks more than a small
  number of questions is a planning failure, not diligence.
- Answers persist as structured `Ask` artifacts on the Plan Receipt (Phase 3.1),
  so a re-run or a fork does not re-ask, and so the answer is auditable evidence
  rather than buried chat prose.

The founder's instinct that "the user shouldn't even have to say that" is right
as a *default*, and asking is what makes the default safe: Cortex proposes a full
plan with its own judgment applied, and asks only where a different answer would
produce materially different work. That is precisely the standard a careful
senior engineer meets.

### 8.3 Make decomposition an engineering step, not a string split

`decompose_goal` splits on `" and then "` and comma-plus-verb, caps at five
fragments, and ignores `profile` entirely (`crates/engine/src/decomposer.rs:9-62`).
Three changes, in order of value:

1. **Remove the five-segment hard error.** A rich one-shot request is the
   flagship demo; the current code returns
   `Err("too many segments (max 5) — please clarify or split into separate requests")`
   for exactly that input. Bound the plan by **budget and depth**, not by how
   many clauses the sentence had, and when the bound binds, degrade by proposing
   a staged plan — never by refusing.
2. **Decompose from the `TaskFrame`, not from the sentence.** Requirements →
   components → tasks, with each leaf carrying its derived checks, its
   VERIFIED/UNVERIFIED label, its price, and its lease claim. This is the Plan
   Receipt that PLAN-RECEIPT.md and RESEARCH-2026-08 rec 3 already specify;
   Phase 8 is where the planner actually produces it. VeriMAP (arXiv 2510.17109)
   is the published blueprint: a planner that emits a per-subtask verification
   function at plan time.
3. **Make effort reach the planner.** Today `profile` is passed in and never
   read, so cost-saver and quality-first produce byte-identical plans. Planning
   depth is the highest-leverage place to spend effort, because decomposition is
   where multi-agent systems fail most (MAST: specification problems are 41.8%
   of failures, the largest single class). Deeper plans at higher effort is the
   most defensible thing the dial can buy.

Apply RESEARCH-2026-08 rec 5's plan lint here: deterministic structural rules
first (a leaf with an empty check union that is not labelled UNVERIFIED; a leaf
whose impact set exceeds its lease; a DAG edge with no data dependency), then one
fresh-context advisory pass. Annotations on the Plan Receipt, never a block —
"models propose, never grade" holds at every effort level.

### 8.4 The Engineering Method Library — top-down engineering, encoded

**This section revises an earlier, too-quick rejection.** The first version of
this plan argued against building a top-down engineering knowledge base on the
grounds that frontier models already hold that knowledge. That argument
conflated two different things, and the distinction is the whole answer:

- **Declarative knowledge** — what a rate limiter is, what CQRS means, how a
  layered architecture is structured. Models genuinely have this. Retrieving a
  prose passage about it adds tokens and rarely changes an output.
- **Procedural judgment** — *in this situation, with these constraints, do these
  things, in this order, and verify them this way.* Models have this too, but
  **inconsistently.** Ask the same model the same architectural question twice
  and you get two different decompositions, both defensible, neither repeatable.

The gap is not knowledge. **The gap is consistency, and consistency is exactly
what a product must sell.** So the instinct is right and the form was wrong.

Three further arguments that the first version missed, and that settle it:

1. **A product guarantee cannot be probabilistic.** An engineering org buying
   Cortex needs "your security review always covers these 40 things." "The model
   probably thought of them" is not a purchasable claim. Encoding the method is
   how a capability becomes a commitment.
2. **Model knowledge is *average* practice, not *best* practice.** It is trained
   on all of GitHub, most of which is mediocre. A curated layer is how Cortex
   encodes an opinionated standard rather than regressing to the corpus mean.
   "A professional at everything" does not mean knowing more facts; it means
   consistently making the better move.
3. **Externalised method is inspectable and governable.** The 2026 agent-skills
   literature makes this point directly: reusable behavioural knowledge becomes
   an artefact that can be inspected, supplied, selected, governed, and revised
   independently of the model. A customer can audit a method library. They cannot
   audit a model's habits.

So: build it. But build it as **method, not encyclopedia** — every entry is
structured, executable, or decision-shaped, and none of it is an article.

#### The three layers

**L1 — Archetype decomposition templates.** DAG shapes per project archetype:
iOS app, REST API with web frontend, CLI tool, data pipeline, mobile game,
browser extension. Requirements → architecture → components → tasks, with the
ordering, the dependency edges, and the standard omissions ("nobody remembers
error states, auth refresh, empty states, or migration rollback") encoded as
nodes that must be explicitly included or explicitly declined. **This is literally
top-down engineering, and it is the layer the founder's instinct was reaching
for.** It attacks MAST's largest failure class — specification problems at 41.8%
— directly, which is the single highest-leverage place in the system to spend.

**L2 — Check batteries.** What "done" means per (task class × ecosystem × risk),
as executable checks. "Look at the security of this iOS app at high effort"
resolves to a named, versioned battery: static analysis, dependency and CVE
audit, secret scanning, keychain and ATS and entitlement checks, transport
security. Source from real standards (OWASP MASVS and equivalents), not
invention. Wires directly into `check_battery_ref` from Phase 6.2, and every
class that gains a battery is a class the verified-outcome guarantee can extend
to.

**L3 — Decision rubrics.** When a plan hits a genuine fork — SQL vs. document
store, monolith vs. services, server vs. client rendering — the library supplies
the *questions that discriminate* and the *criteria*, not the answer. Cortex
either resolves it from repo evidence and records why, or surfaces it as a
bounded `Ask` on the Plan Receipt (Phase 8.2). This is where "big picture
understanding that real developers need" actually lives: not in knowing the
answer, but in reliably noticing that the question is load-bearing.

#### What makes it beyond state of the art

A curated method library is a wiki. **A method library whose every entry carries
measured outcomes is something nobody has built**, and Cortex is the only product
positioned to build it — because it is the only one that runs the checks.

Every L1 template, L2 battery, and L3 rubric accumulates:

verified pass rate · cost to verified outcome · median attempts · human rework
and rejection rate · UNVERIFIED share · which effort level it needs to work

Which converts the library from an opinion into an instrument:

- Templates that do not beat no-template on measured outcomes are **retired**,
  not defended.
- Competing templates for the same archetype can be **A/B'd** through Phase 5.2's
  champion/challenger machinery — the infrastructure already exists.
- New templates enter as challengers and must earn promotion.
- The library's entries can be **published with their scores**. "This is our iOS
  security method, here is its measured pass rate across N runs" is a marketing
  artifact that is simultaneously a technical asset, and no competitor can
  produce one.

That is *evidence-graded engineering method*, and it is a genuinely new object.
It is also the honest synthesis of both instincts: encode the method, then let
the verifier decide whether the encoding was any good.

#### The falsification test, stated up front

The failure mode is a library of generic templates that add tokens and change
nothing. Guard against it explicitly:

**Ship no template without its measurement.** Every entry must demonstrate, on
held-out tasks, that it beats the no-template baseline on verified pass rate or
cost-to-verified-outcome. An entry that cannot is deleted. If the first three
templates all fail this test, that is a real finding and the library should stop
at L2 — where the value is most mechanical and least dependent on judgment.

Start narrow: **two archetypes and two batteries**, in domains with real demand
and clear external standards. Measure. Expand only where measurement justifies it.

#### What still gets rejected

**A prose architecture corpus.** Not because the knowledge is worthless, but
because prose is the one form that cannot be scored, cannot be executed, and
cannot be audited. Everything valuable about the ByteByteGo instinct survives the
translation into templates, batteries, and rubrics. Nothing valuable is lost.

#### And the corpus that costs nothing

Separately from the library, keep capturing **Cortex's own verified-outcome
corpus**: every receipt is (TaskFrame, plan DAG, template used, route, effort,
speed, catalog version, forecast, actual cost, **executed verdict**, human
accept/reject). Competitors accumulate completions; Cortex accumulates graded
outcomes with costs attached. This is what grades the method library, calibrates
the forecasts in Phase 6.4, and trains the router in Phase 7.2 — three of this
plan's central mechanisms run on the same dataset.

It costs almost nothing extra *if designed in now*, since Phases 1, 2, 5, 6, and
7 already require every field. It cannot be reconstructed later. It needs a
consent and retention basis written before the first customer task.

Net recommendation: **finish repo-grounded context (b), build the method library
(L1/L2/L3) with its measurement harness, capture the outcome corpus, and skip
prose.**

#### One object, not two — read with Phase 12.3

The Method Library and the knowledge packs in Phase 12.3 are **the same object
family**, and an implementer must not build them twice. The relationship:

- A **knowledge pack** (12.3) is the cited, dated, versioned source material for
  a domain — the standards, records, and research.
- The **L1/L2/L3 entries** here are what is *derived* from a pack: templates,
  batteries, and rubrics, each citing the pack entry that justifies it.
- A **professional** (12.2) is a generic worker loaded with a pack and its
  derived entries.

So the build order is: pack → derived entries → professional. Phase 8.4 defines
the derived layer, Phase 12.3 defines the source layer, and everything in both is
versioned, scope-owned, and graded by execution rather than opinion.

### 8.5 The greenfield problem, and how to resolve it

**The problem.** Cortex's wedge is that it runs *your* checks and refuses to
charge when they fail. "Build me a game with X, Y, and Z" has **no existing
checks to run.** The acceptance contract must be generated from the request
itself — so the strongest case for the marketing is simultaneously the weakest
case for the guarantee, and a check Cortex wrote against a spec Cortex inferred
is materially weaker proof than a repo's real test suite.

**The resolution: don't try to verify greenfield. Make greenfield stop being
greenfield as fast as possible.**

A project is only unverifiable while it has no test harness. That condition is
not a property of the task — it is a property of *the first few minutes of the
task*. So the fix is architectural, not epistemic:

> **Step one of every greenfield run is "scaffold the project *with* its test
> harness, checks, and CI wired up," and that step is verified deterministically.
> From step two onward, every subsequent step is ordinary repo work against a
> real suite.**

Greenfield is not an unverifiable category. It is an unverifiable *prefix*, and
the prefix can be made one step long. This also happens to be what a senior
engineer does when starting a project, which is a good sign the design is right.

#### The bootstrap ladder

Ground truth is available for greenfield in a strict order of strength. Climb it
as fast as the project allows, and always report which rung a receipt sits on:

| Rung | Evidence | Fakeable? |
|---|---|---|
| 0 | **It builds.** Compiles, installs, resolves dependencies. | No — deterministic |
| 1 | **It runs.** Process starts, health check answers, no crash on boot. | No — deterministic |
| 2 | **The harness exists and executes.** Test runner wired, CI config valid, one trivial test passes. | No — this is the rung that ends greenfield |
| 3 | **The smoke path completes.** Game launches, renders a frame, accepts input, state advances. API returns the expected shape. | Barely |
| 4 | **Approved acceptance tests pass.** Generated at plan time, approved by the user, frozen. | Weakly — mitigated below |
| 5 | **Property and metamorphic checks pass.** Generated variants the implementer never saw. | Strongly resistant |

Rungs 0–2 are available on literally every project and are pure execution. Lead
with them; they are real, they are unfakeable, and they are more than any
competitor proves about a greenfield build today.

#### The move that makes rung 4 legitimate

Generated acceptance criteria are a weak proof when Cortex both writes and grades
them. They become a strong proof when **the user approves them before work
starts**:

- Cortex drafts the acceptance criteria **as executable tests**, at plan time,
  as part of the Plan Receipt.
- The user reviews and approves them. At that moment they stop being Cortex's
  inference and become **the customer's specification**.
- They are frozen with the rest of the check spec at dispatch.
- The implementer is graded against them by the independent runner, exactly as
  with repo work.

This inverts the framing entirely: **greenfield is the *best* case for the Plan
Receipt, not the worst.** For repo work the Plan Receipt is an approval artifact
layered onto an existing spec. For greenfield the Plan Receipt *is* the spec —
it is the most valuable thing Cortex produces, and the thing a solo builder most
needs and is least likely to write themselves.

Apply RESEARCH-2026-08 rec 2 here with extra force: hold out a subset of the
generated checks from the implementer. When Cortex writes both the code and the
test, visible tests invite writing code that satisfies the test rather than the
intent. Held-out property variants are the defence.

#### Rules that keep the claim honest

- **Greenfield is its own task class** with its own forecast distribution, its own
  UNVERIFIED rate, and its own graduation status on the Phase 6.4 maturity
  ladder. Never averaged with repo work.
- **The receipt names its rung.** "Verified: builds, runs, harness green, 12/12
  approved acceptance tests" is a precise, true, and genuinely impressive claim.
  Bare "independently verified" without the rung is not.
- **Criteria authorship is labelled.** "Verified against criteria Cortex proposed
  and you approved" is honest and still strong. Hiding the authorship is not.
- **The refund promise is weighted by class.** Marketing the guarantee hardest
  where the checks are weakest is how a good policy becomes a support queue.

#### The upside nobody is capturing

Every competitor treats a greenfield build as a one-shot generation problem.
Framing it as *bootstrap the harness, then iterate against it* means Cortex's
one-shot builds arrive **with a working test suite and CI already wired** — which
is both a better artifact than the competition ships and the precondition for
every later Cortex task on that repo being cheap to verify. The flagship demo
stops being the risky case and becomes the on-ramp.

## Phase 9 - Teams, organisations, and the 100-plus-seat sale

**Goal:** clear the floor that decides whether a large engineering org can buy
Cortex at all. Today none of it exists, and the procurement conversation ends
before anyone evaluates the routing.

### 9.1 The object model comes first

Organisation → team → project/repo → membership with roles. Every run, task,
receipt, quote, ledger entry, and capability grant is owned by a point in that
tree, and every agent session maps to a **named human identity** — without that,
access reviews, offboarding, and audit trails do not function, and all three are
asked about in every enterprise security review.

Retrofitting ownership onto existing rows is a migration with a data-correctness
risk on billing tables. Doing it before Phase 2.2 persists quotes is materially
cheaper than after.

### 9.2 Build in procurement order

The order is not aesthetic; it is the order buyers actually gate on, and each
step depends on the previous one.

1. **RBAC.** Everything else is defined in terms of roles. Minimum viable set:
   owner, admin, maintainer, member, billing, read-only. Roles govern who
   approves a Plan Receipt, who can grant write/PR/deploy capability, who can
   override a failed verdict, and who can raise a spend or effort ceiling.
2. **Audit log with export.** A generic `audit_log` table exists
   (`crates/api/src/db.rs:1859`) with no export surface. Every capability grant,
   override, deploy, ledger event, policy change, and role change appends;
   append-only; exportable as a file and streamable to a SIEM. This is the single
   most-requested artifact after SSO.
3. **SAML SSO.** Okta, Entra ID, Google Workspace. Table stakes — every mature
   competitor has it.
4. **SCIM provisioning.** Build when a customer asks by name. Deprovisioning is
   the part that matters: a departed employee's agent sessions and capability
   grants must die with their account.

### 9.3 Spend and effort governance is the feature, not the checkbox

This is where Phase 6 and Phase 9 meet, and it is a genuine differentiator rather
than a compliance chore. The category's dominant complaint in 2026 is bill shock
after every major vendor converted to effort metering within four months
(RESEARCH-2026-08 rec 1). Cortex's answer should be structural:

- Budgets at org, team, repo, and member level, each with a soft alert threshold
  and a hard stop.
- **Effort ceilings per org/team/project**, so `ultra` is a governed resource.
  This is the control that makes a user-movable dial safe to give a 400-person
  org.
- Provider allowlists per org, enforced as a routing constraint before scoring
  (Phase 7.4), not as a display filter. Some orgs will forbid specific vendors
  contractually.
- Autonomy ceilings per org/repo: which repos may be written to, which may open
  PRs, which may deploy, and who approves each.
- A reconciliation view where an admin traces any charge to its Plan Receipt,
  run, verdict, and diff (Phase 2.3). Under fixed-price outcome billing this is
  far easier to render than any token or compute-minute meter — which is exactly
  why it is worth leading with.

### 9.4 Deployment flexibility is a Phase 4 dependency

The largest buyers ask for VPC or self-hosted deployment. That is not a packaging
decision; it is gated on the Phase 4 data-plane work (Postgres, leader election,
separable API/scheduler/verifier/sandbox roles). Name the enterprise tier as a
driver of Phase 4 alongside scale, so the sequencing is understood: **there is no
self-host story on a single-node SQLite deployment with a `Mutex<Connection>`.**

Two nearer-term items that block deals and are cheap:

- A written data-handling statement: what leaves the boundary, to which
  providers, under what retention, and whether it trains anything. Buyers ask
  this in the first call. It also interacts with Phase 8.4(d) — the
  verified-outcome corpus needs a consent basis before the first customer task.
- Removing fabricated data from shared surfaces. `defaultMembers`
  (`cortex/src/lib/taskManager.ts:116-130`) seeding a team view with invented
  members named Joe, Maya, and Sam does not survive a security review, and the
  fail-open evidence gate at `:426-442` is worse: it converts a gated completion
  into an ungated one whenever the backend is unreachable.

## Phase 10 - Surfaces: one contract, many clients

**Goal:** make the web app one client among several, cheaply, now — before a
desktop and iOS app make it expensive.

### 10.1 API-first is a rule, not an aspiration

The current client holds behaviour the server should own: browser-local task
state, invented members, local fallback when the backend is unavailable, and an
evidence gate that fails open. Each is a bug today and a blocker for a second
client tomorrow, because a native app cannot inherit any of it.

- Every state transition goes through a documented, versioned API. No client
  computes canonical state.
- Offline is a **visibly separate local-draft mode** that cannot mutate shared
  status (Phase 3.3 already says this) — never a silent fallback.
- Optimistic concurrency via ETag/version conflict, not last-write-wins whole-
  state sync. Two clients on two devices is the normal case for a native app.
- Auth that works headless and native: device-code or token flow, not cookie-only.

### 10.2 Design the event model for mobile now

The reason to build a mobile client is not to write code on a phone. It is that
**agent work is asynchronous and the interesting moments happen while you are
away from the desk**: your plan needs approval, your task is blocked on a
question, verification failed, a PR is ready to review, a budget threshold
tripped. Those are notifications, and the notification model is a property of the
event schema.

So: define the run/step/verification event stream as a versioned, documented
contract now, with stable event types and an explicit "requires human action"
class. Retrofitting a notification taxonomy onto an ad-hoc WebSocket stream is
the expensive version of this.

### 10.3 What developers actually want from the interface

The founder's question — how would developers like this interface, from solo vibe
coders to large teams — has an opinionated answer, and a way to check it.

The answer: **the same object graph, with progressive disclosure.** A solo
builder wants one input, a dial, and a result they can trust. A 100-developer org
wants a queue, ownership, review, budgets, and policy. These are not different
products; they are different default views over the same tasks, plans, receipts,
and ledger. Building two products is the failure mode to avoid.

Any surface, for either audience, must answer four questions within about five
seconds without opening a log:

1. What is running, and what state is it actually in?
2. What has it proven — and what has it *not* proven?
3. What will this cost, and what has it cost?
4. What is the single next thing I should do?

Three design positions worth committing to:

- **The Plan Receipt is the primary object, not the chat transcript.** Chat is a
  lens onto it (Phase 3.1). A transcript is a bad substrate for both a solo
  builder returning after an hour and a reviewer joining at the end.
- **The dial belongs next to the price, not in settings.** A control whose
  consequence is invisible at the moment of use reads as decoration. Showing "at
  `high`: 6 credits · at `ultra`: 22 credits" on the plan is what makes it real.
- **Never render worker-reported evidence in the same visual vocabulary as an
  independent verdict.** This is Track A invariant 6, and the interface is where
  it is actually won or lost.

And a way to check it rather than assert it, because none of the above is
validated with real users yet: recruit a small number of design partners across
the three segments (solo builder, small team, platform team at a large org), give
them the same scripted tasks, and instrument time-to-first-approved-plan, plan
revision count, run abandonment rate, receipt open rate, and UNVERIFIED rate by
segment. The specific hypothesis to test first is the riskiest one: **do users
understand what the dials did?** Two controls are more powerful and more
confusing than one; only testing settles which dominates.

### 10.4 The first five minutes — currently unspecified

A gap worth naming, because it is the first thing an external tester meets and
nothing in this plan or its siblings covers it.

Between "a developer has an account" and "a developer approves their first Plan
Receipt" sits: connect a repo, grant the right GitHub scopes, wait for the first
repo scan, discover what Cortex can already verify here, and pick a first task
worth trying. Every one of those is a place to lose someone, and the last two are
places Cortex can be unusually good:

- **The repo scan already has to happen** for the estimator (Phase 6.5). Show its
  output as the welcome: detected ecosystems, the checks Cortex found and can
  run, measured test-suite duration, and — honestly — which parts of this repo it
  currently cannot verify. A new user learning *"Cortex found your test suite,
  it takes 4m12s, and here is what it can prove"* in the first minute is a far
  stronger opening than any tour.
- **Propose the first task rather than asking for one.** A blank input box is the
  worst possible first screen for a product whose value is scoping work properly.
  From the scan, suggest two or three genuinely useful, low-risk, high-verifiability
  starters — a dependency bump with a real CVE, a missing-test gap, a lint class —
  each with a forecast and a cap already filled in.
- **The first run should be free and should be a receipt.** The fastest way to
  convey the entire product thesis is one completed run whose receipt the user
  opens. Optimise the onboarding for reaching that artifact, not for feature
  coverage.

Specify this before external testing. It is cheap, it reuses machinery three
other phases already require, and it is the difference between a tester
evaluating Cortex and a tester bouncing off it.

## Phase 11 - Parallel execution and conflict freedom

**Goal:** make "Cortex dispatched N agents and they worked flawlessly together"
mechanically true. This phase is the prerequisite for the speed dial in Phase 6 —
buying latency with parallelism is only safe once parallel work cannot corrupt
itself.

### 11.1 What exists today, and what does not

Cortex is further along here than most of Track B, and the gaps are specific.

**What works:**

- A real `resource_leases` table with `path`, `branch`, `environment`, and `task`
  resource types, `write`/`exclusive` modes, expiry, and authority scoping
  (`crates/api/src/db.rs:1478`).
- **Correct path-overlap semantics.** `path_keys_overlap`
  (`crates/api/src/db.rs:4403`) handles prefix containment — `src` conflicts with
  `src/auth/login.ts`, and `.` conflicts with everything. This is the hard part
  and it is right.
- Per-step git worktrees on branch `cortex/step/{step_id}` cut from HEAD
  (`crates/worker/src/worktree.rs:229-256`), giving each step an isolated index
  and working directory over a shared object database.
- Lease acquisition is transactional and fails closed — a conflict rolls back run
  creation (`crates/api/src/db.rs:8143-8155`).

**What does not, and each is load-bearing for the 100-agent case:**

| Gap | Evidence | Consequence |
|---|---|---|
| **Leases are run-scoped, not step-scoped.** `acquire_run_resource_leases_tx` is called once at run creation with the run's file paths. | `crates/api/src/db.rs:8143` | Two *runs* cannot collide. The N parallel *steps inside one run* have **no path arbitration between them at all** — which is exactly the "100 agents on one task" case. |
| **A run with no declared file paths takes a repo-wide `.` write lease.** | `crates/api/src/scheduler.rs:1682-1692` | Because `.` overlaps everything, one such run **serialises every other run on that repo**. And a goal stated in natural language usually has no file paths, so this is the common case, not the edge case. |
| **Conflict fails the run instead of queueing it.** | `crates/api/src/db.rs:8151-8154` | The user gets an error rather than "waiting on step 7." Fail-closed is right for safety and wrong for throughput; the correct behaviour is to wait, visibly. |
| **Nothing ever integrates the step branches.** No merge, rebase, or cherry-pick exists anywhere in the worker or scheduler. | absence across `crates/worker/`, `crates/api/src/scheduler.rs` | N parallel steps produce N branches diverging from the same HEAD, and the worktrees are then deleted. There is no defined path from parallel step output to a single reviewable result. |

The honest summary: **Cortex has good isolation primitives and no composition.**
Isolation without integration means parallel agents cannot corrupt each other and
also cannot produce a combined result.

### 11.2 Conflict-freedom is a planning property, not a runtime scramble

The strongest available move, and the one that distinguishes Cortex from every
"run four agents in worktrees and merge later" workflow: **partition the DAG so
that concurrently-runnable leaves have disjoint write sets, at plan time.**

- The planner already emits target paths per leaf (`WorkRecipeSeed.target_paths`).
  Make disjointness a **validated property of the plan**, checked before
  approval, not a hope checked at merge time.
- Two leaves whose write sets overlap get a dependency edge instead of running
  concurrently. This is a plan-lint rule (RESEARCH-2026-08 rec 5) and it is
  deterministic — no model judgment involved.
- The Plan Receipt shows the **achievable parallel width** and, when it is
  narrow, *why*: "steps 4–9 all write `src/routes/index.ts`, so they run in
  sequence." This turns a limitation into an explanation, and it is exactly the
  "big picture" a real developer wants to see.
- Where the planner cannot determine a write set, the leaf is treated as
  repo-wide and serialised. Unknown scope is never optimistically parallelised.

This is strictly better than conflict *resolution*, because the cheapest conflict
is the one that never happens — and because a clean textual merge does not imply
correct behaviour (see 11.4).

### 11.3 Step-level leases, and queue rather than fail

The mechanism already exists; it is applied at the wrong granularity.

- Move lease acquisition from run creation to **step dispatch**, keyed on the
  step's resolved write set. Keep the run-level lease as a coarse outer bound for
  cross-run isolation.
- **Queue on conflict.** A step whose lease is held waits in `blocked_on_resource`
  with the holder's identity visible, and is woken on release. The existing lease
  expiry and reclaim machinery covers the crash case.
- Deadlock avoidance: acquire a step's full lease set **atomically in a canonical
  order**, all-or-nothing. Partial acquisition plus waiting is how a scheduler
  deadlocks itself.
- **Fix the repo-wide default.** A run without declared paths currently takes `.`
  and blocks the world. Instead: derive the write set from the plan once
  decomposition completes, and hold only a read lease until then. If the write
  set genuinely cannot be bounded, say so on the Plan Receipt — "this task will
  run exclusively on this repo" is a legitimate outcome the user should see
  before approving, not a surprise serialisation.
- Surface lease waits as first-class run state. "Why is this blocked?" (Phase 3.2)
  must be able to answer "step 7 holds `src/api/` until its verification
  completes."

### 11.4 Integration is a DAG node, not an afterthought

This is the missing piece. Add an explicit **integrate** step kind.

- Integration runs **sequentially, one branch at a time**, rebasing the remaining
  branches onto the updated base after each. This is the researched-best strategy
  for parallel agent branches: it confines surprise to one branch at a time and
  produces far fewer late-stage failures than an N-way merge.
- **A textual merge success is not a verdict.** The integration node re-runs the
  **full check battery on the integrated tree**, not on the individual branches.
  This is the single most important rule in the phase: two agents can each pass
  their own checks and produce code that compiles and disagrees at runtime.
  Cortex is uniquely able to catch this, because it already owns an independent
  execution verifier — the capability exists, it just has to be pointed at the
  merge result.
- A failed integration is a **normal, planned outcome** with a defined recovery:
  identify the conflicting pair, re-plan the later leaf with fresh context and
  the integration failure as evidence, and re-run it against the updated base.
  Never continue the failed worker's transcript (RESEARCH-2026-08 rec 4).
- Integration cost is attributed to the run, forecast like any other step, and
  visible on the Plan Receipt. Parallelism is not free and the price of it should
  not be hidden.
- The integrated result — not any individual step branch — is what becomes the
  PR and what the receipt describes.

### 11.5 Hotspot resources need declaring, not discovering

Real repositories have files that everything touches: route tables, DI
registries, `Cargo.toml` / `package.json`, lockfiles, i18n catalogs, and
**single-integer migration counters** — the last of which this organisation has
already lost time to on its own repo.

- Let a repo declare hotspots in its Cortex config, and infer additional ones
  from git history (files with unusually high change frequency across otherwise
  unrelated changes).
- Hotspots become **short-duration exclusive resources**: a step takes the lease
  only for the edit, not for its whole execution.
- Better still, where the file's format allows it, **defer hotspot edits to the
  integration node**, which applies them once in a defined order. A migration
  counter or a route registry does not need N agents fighting over it; it needs
  one deterministic assignment at integration time.
- Sequence-allocated resources (migration numbers, port assignments) should be
  **allocated by the scheduler**, not chosen by the agent. This category of
  conflict is entirely preventable and should simply not exist.

### 11.6 The honest ceiling, and how to communicate it

"Deploy 100 agents and they work flawlessly" is achievable **for work that
genuinely decomposes into 100 disjoint pieces**, and is not achievable for 100
agents on one tightly-coupled module — by anyone, ever, for the same reason 100
human engineers cannot edit one file at once. Cortex should say this rather than
imply otherwise, and should say it in a form that is useful:

> Cortex runs as wide as your dependency graph allows, shows you the achievable
> width before you approve, and tells you exactly what is limiting it.

That is both true and more valuable than a number, because "steps 4–9 all write
the same route table" is *actionable architectural feedback about the codebase* —
a genuinely novel thing to get from a coding tool, and a natural upsell into a
refactor task.

Two supporting positions:

- **Parallel writers stay bounded and planned; parallel readers are unbounded.**
  Read-only exploration, review, and analysis subagents can fan out very wide
  safely — this is the converged 2026 pattern (one orchestrator owning context,
  ephemeral fresh-context read-only subagents returning compressed summaries) and
  RESEARCH-2026-08 §3 already endorses it. Most of the impressive-looking width
  in a large run should be readers.
- **Racing is a different mechanism from fan-out and must not be confused with
  it.** Best-of-N runs N attempts at *the same* leaf and keeps the first to pass
  verification; it consumes no additional lease breadth and creates no
  integration risk, because N−1 branches are discarded. This is the safest way to
  spend money on speed, which is why the Phase 6 speed dial should reach for
  racing before it reaches for width.

**Phase 11 exit gate:** a run with a wide DAG executes concurrently without
lease violations; two steps with overlapping write sets are serialised by the
planner and the Plan Receipt says why; an induced merge conflict produces a
defined re-plan rather than a stuck run; the integration node catches a
semantic conflict that both branches individually passed; and a hotspot edit
deferred to integration produces a deterministic result under repeated runs.

## Phase 12 - Professionals: the specialist system

**Goal:** make Cortex behave like a senior engineering lead with a bench of
specialists, rather than one generalist wearing different hats — and make the
bench measurably better over time rather than merely better-named.

### 12.1 The idea is right; the obvious implementation is theatre

A "cybersecurity professional" or a "Rust professional" is exactly the right
organising unit — it matches how real engineering orgs work, it gives the
Method Library a natural container, and it is immediately legible to a buyer.

But the common implementation is a system-prompt prefix, and that adds nothing.
Worse, RESEARCH-2026-08 §3 documents that role proliferation is actively harmful:
MAST attributes 41.8% of multi-agent failures to specification problems, of which
ambiguous roles are a major component. **A persona that is only a personality
makes the system less reliable, not more.**

So the design rule is absolute:

> **A professional is a bundle of mechanisms with a measured track record. If
> removing a professional's prompt text changes nothing measurable, it was never
> a professional.**

### 12.2 An expert is a knowledge pack, not an agent

The correct mental model, and it removes the persona risk entirely:

> **The runtime worker is generic. The expertise is data loaded into it.**

There is no "security agent" with a security personality. There is a generic
fresh-context worker plus a **versioned knowledge pack** that makes it, for the
duration of one task, the best-informed reviewer of iOS cryptography available —
because it is holding current, cited, domain-specific material instead of trying
to recall it or re-derive it from a web search.

This is also the practical argument, and it is the strongest one: **making a model
search the web for OWASP MASVS every time an iOS security review runs is absurd.**
It is slow, it costs tokens, it returns something slightly different each time,
and it produces exactly the inconsistency that a product cannot sell. Curate it
once, version it, index it, load it in milliseconds.

```text
Professional {
  id, version, domain,
  claimed_task_classes[],

  -- WHAT IT KNOWS: the pack (12.3)
  knowledge_pack_ref,          -- versioned, cited, dated domain knowledge

  -- WHAT IT DOES: derived from the pack, each entry citing its justification
  check_batteries[],           -- L2 — what "done" means here
  decision_rubrics[],          -- L3 — the forks it knows are load-bearing
  method_templates[],          -- L1 — decomposition shapes

  -- HOW IT RUNS
  routing_priors,              -- model preferences the router may still override
  effort_defaults,             -- e.g. crypto review floors at xhigh
  context_recipe,              -- which slices it needs
  tool_grants[],               -- semgrep, cargo-audit, axe-core

  -- WHAT IT MAY TOUCH
  capability_envelope,         -- read_only | propose | write_scoped
  default_capability,          -- reviewers are read_only, always

  -- WHAT IT HAS PROVEN
  outcome_record               -- objective signals only; see 12.5
}
```

Note there is no prompt, no persona, and no voice. If a field cannot be pointed
at — a cited source, an executable check, a measured number — it does not belong
in this object.

### 12.3 The knowledge pack: curated, cited, dated, versioned

The pack is the answer to "how does Cortex know the best of the best." Not by
being asked to remember, and not by searching from scratch every time.

**Composition rules, each of which exists to prevent a specific failure:**

| Rule | Failure it prevents |
|---|---|
| **Every entry cites a primary source with a retrieval date** — an RFC, a standard, a CVE record, a language edition guide, a framework release note, a published paper | Model-generated prose laundered into authority. If it has no source, it is not knowledge, it is an opinion with formatting. |
| **Extracts and pointers, not summaries** where the source is authoritative | A summary is `inferred` (Phase 13) and can drift from what the standard actually says |
| **Every entry carries a domain-specific half-life** | CVE data goes stale in days; a crypto primitive's guidance in years; a framework API in months. One staleness policy for all of it is wrong for all of it. |
| **Derived checks cite the entry that justified them** | A check exists *because a standard says so*, and you can trace it. This is what makes the battery auditable to a compliance buyer. |
| **Packs are immutable and versioned** (12.11) | Silent drift across a 200-developer org |
| **Scope-owned** — global, org, project | An org's internal standards are a pack of their own, and their crypto policy is not Cortex's to edit |

A pack is small, dense, and boring. That is the point: it is the difference
between an expert who has read the standard and one who is confident they
remember it.

### 12.4 Currency: the pack researches, like a real engineer

A curated registry that is never refreshed becomes exactly the stale authority
the founder is right to worry about. So refresh is a designed subsystem, not an
intention:

- **Staleness is scheduled per entry**, from its half-life. An entry past its
  half-life is marked stale and **does not silently keep asserting**.
- **A stale entry dispatches a research task**: re-fetch the primary source,
  diff against what the pack holds, and report what changed. This is the "does
  its own online research like a real engineer" behaviour — but performed *once,
  on a schedule, against a known source*, rather than a thousand times ad hoc.
- **Live research is allowed when the pack does not cover something**, and it is
  typed. Research output enters context as `researched` — cited, retrieval-dated,
  and **never promoted into the pack automatically**. Promotion is a reviewed
  publish producing a new pack version.
- **Contradiction is a first-class event.** When live research or observed repo
  reality contradicts a pack entry, that is flagged and triggers pack review. A
  good engineer noticing the documentation is out of date is a *feature*, and it
  is the main mechanism keeping the pack honest.
- **Anomaly triggers review too.** A check derived from the pack that suddenly
  changes behaviour across many repos usually means the world moved, not that
  every repo broke simultaneously.

**And the rule that keeps knowledge from becoming bias:**

> **Knowledge is never authority over evidence.** The pack says what to *check*.
> Execution says what is *true*. When a pack-derived expectation contradicts the
> repository, the repository wins and the pack is flagged — never the reverse.

That single line is why a curated registry is safe here and is not safe in a
product without a verifier. Cortex can afford strong priors precisely because it
has something stronger to check them against.

### 12.5 Grading: objective signals only

**A correction, prompted by a sharp objection: an earlier draft of this section
proposed learning from developer dispositions — accepted, dismissed, ignored.
That is a corrupt signal and it must not train anything shared.**

Developers are heterogeneous and their intent is unknowable from the outside. A
hobbyist dismissing a hardcoded-secret finding on a throwaway project must never
teach the global crypto pack that the finding is noise. "Dismissed" is
irrecoverably ambiguous — it may mean wrong, right-but-not-now,
right-but-I-disagree, or did-not-understand — and the developers who dismiss most
are frequently the least careful. Aggregating that across customers would
actively make the bench worse over time, and the degradation would be invisible.

So the signals are ranked by objectivity, and the rules follow the ranking:

| Signal | Objective? | May train |
|---|---|---|
| **Caught** — derived check *fails* on the tree | Fully. A failing test is a fact. | **Global** |
| **Missed** — a defect later caught by an *executed check* in a domain this pack covers | Fully, when the later catch is itself executed | **Global** |
| **Non-executable rate** — findings that cannot become checks | Fully — it is a property of the finding | **Global** |
| **Verified absent** — check passes | Fully, but low information alone; meaningful as coverage | **Global**, weakly weighted |
| **Contradiction / anomaly** (12.4) | Fully | **Global**, as a review trigger |
| **Human disposition** | **No.** Intent unknowable, chaotic across the population | **Org-scoped at most, never global, never cross-customer** |

Two consequences worth stating plainly:

- **Human feedback is a local preference, not a truth signal.** An org's own
  dismissals may tune *that org's* pack — that is legitimate, it is their
  standard. It may never propagate outward.
- **A check that has never fired across thousands of runs** is either a solved
  problem or a bad check. Either way it is worth a human look. That is an
  objective review trigger with no dependence on anyone's opinion.

The `outcome_record` is still load-bearing, and packs are still retired when they
do not beat the baseline (Phase 5.2 champion/challenger, Phase 8.4's
falsification test). It is now graded on things that are true rather than on
things people clicked.

### 12.6 Assignment is routing with a richer unit

This is where the founder's framing — a lead who orchestrates professionals —
becomes a mechanism rather than a metaphor. The planner already decomposes into
leaves and the router already scores routes. Assignment is the same operation
keyed on a richer unit:

```text
plan leaf  →  (task class, risk, ecosystem, blast radius)
           →  candidate professionals, scored on measured fit for that signature
           →  professional supplies template + battery + context recipe + routing priors
           →  router picks the model within those priors, on cost-to-verified-outcome
```

Two consequences worth stating:

- **The professional constrains the router; it does not replace it.** Priors are
  priors. If measurement shows a cheaper model clears the security battery just
  as reliably, the router takes it, and the professional's record improves. This
  keeps Phase 7's economics intact rather than letting personas smuggle in
  expensive defaults.
- **The Plan Receipt names the assignee.** "This leaf goes to the iOS Security
  professional (v4, 89% verified pass over 210 runs, median 31 credits)."
  That single line does more for the "senior lead orchestrating professionals"
  claim than any amount of persona writing, and it is auditable.

### 12.7 Start with reviewers, because reviewers are free

The safest and highest-value professionals are **read-only**, and this is not a
compromise — it is where the value actually is.

- Read-only fan-out is the one place parallelism is unbounded and safe
  (Phase 11.6, RESEARCH-2026-08 §3). Twenty reviewer professionals can inspect a
  diff concurrently with no leases, no integration risk, and no conflict.
- A security professional's output is **findings plus proposed checks**, not a
  verdict. It never grades — "models propose, never grade" is not suspended for
  specialists. Its findings become check-battery entries, which the independent
  runner executes. That is how an opinion becomes evidence.
- This maps directly onto the founder's example: *"the security of that iOS app
  needs high effort."* That resolves to: assign the iOS Security professional to
  the security subtree at an `xhigh` floor, read-only, its battery attached,
  its findings promoted to executable checks, verified independently.

Write-capable professionals come later, and only for domains where the outcome
record justifies it.

### 12.8 Why this compounds — and why it is the enterprise moat

Three compounding effects, in increasing order of strategic value:

1. **Each professional accumulates its own outcome corpus**, so its routing
   priors, effort defaults, and forecasts get sharper in its domain faster than a
   generalist ever could. Specialisation becomes measurable rather than asserted.
2. **Professionals are publishable with their scores.** "Our Rust professional:
   91% verified pass across 1,400 runs, median 18 credits" is simultaneously a
   marketing artifact and a technical one. No competitor can produce the
   equivalent, because none of them have verdicts.
3. **An organisation can define private professionals encoding its own
   standards** — "our payments reviewer," "our migration specialist," carrying
   that org's batteries, rubrics, and forbidden patterns. This is the strongest
   retention mechanism in the entire plan: an org's professionals are built from
   its own history and cannot be exported to a competitor. It is also a natural
   enterprise upsell that costs nothing extra to build, because it is the same
   object with a tenant scope.

Point 3 is the long-term answer to "how does this build into something much
stronger." The bench is not a feature — it is the shape customer knowledge takes
inside Cortex, and it gets heavier every month.

### 12.9 Guardrails

- **No professional without a measured record.** New professionals enter as
  challengers against the generalist and must earn promotion through Phase 5.2's
  machinery. An unpromoted professional is not offered for assignment.
- **No debate, no consensus, no cross-grading.** Professionals do not argue with
  each other and do not evaluate each other's work. RESEARCH-2026-08 §3 rejects
  both on measured grounds, and specialisation does not create an exception.
- **Bounded bench.** Ten well-measured professionals beat fifty prompt variants.
  Resist proliferation; every entry must pay for its existence.
- **Fresh context per professional.** A professional is not a long-lived
  conversation; it is a configuration applied to a fresh-context worker. "No step
  inherits a transcript" holds here too.
- **Assignment is visible and overridable.** A user can see who was assigned, why,
  and reassign. Invisible assignment is the same failure as a silent effort
  downgrade.

### 12.10 The expert panel — and how to beat the known art

A panel of specialists reviewing one change is the right instinct and sits one
word away from the thing this plan rejects. The distinction is sharp and it is
the whole design:

> **A panel of judges argues toward consensus. A panel of experts produces
> evidence in disjoint domains, and something deterministic resolves it.**
> Cortex builds the second and never the first.

Multi-agent debate fails for measured reasons — sycophancy collapses
disagreement, problem drift affects 76–89% of long debates, and a model cannot
correct itself without an external signal (RESEARCH-2026-08 §3). Every one of
those failures comes from **models resolving disagreement between models**.
Remove that step and the panel's value survives intact.

#### How the panel actually runs

1. **Independent, fresh-context, read-only.** Each professional reviews the diff
   from a clean context and **never sees another professional's output**.
   Independence is the entire source of value; cross-visibility reintroduces the
   sycophancy that kills debate systems. This also makes the panel unboundedly
   parallel — no leases, no integration risk (Phase 11.6).
2. **Output is findings plus proposed checks**, never a verdict, never a score.
3. **Aggregation is execution, not voting.** Proposed checks are executed by the
   independent runner against the tree. A finding that produces a failing check
   is a defect. A finding that produces a passing check was noise.
   **Disagreements between experts are resolved by running the code.**
4. **The verifier decides.** Exactly as everywhere else in this document.

That last inversion is the thing. Every published panel or debate system
aggregates opinions with another opinion. Cortex aggregates them with an
executable outcome — which it can do only because it already owns the verifier.

#### Three mechanisms that go past the current art

**(a) A multi-signal outcome record per expert.**

An earlier draft of this section described this as "precision: what fraction of
findings produce failing checks." **That framing is wrong and would produce a
genuinely dumb system**, for two reasons worth stating so nobody rebuilds it:

- **A passing check is not a false positive.** A crypto professional proposing
  "verify no key material reaches the logger," and that check passing, is
  *verified absence* — correct vigilance that produced a durable guarantee. Under
  a naive precision metric that professional gets punished for being right about
  what to look at. The system would learn to stop checking things that are
  usually fine, which is exactly backwards for security work.
- **One bit per finding is far too sparse** to distinguish a sharp expert from a
  lucky one.

The outcome record is therefore multi-signal, and the signals mean different
things:

| Signal | What it is | What it says |
|---|---|---|
| **Caught** | Finding → check → check **fails** on the current tree | A real defect found. The strongest positive. |
| **Verified absent** | Finding → check → check **passes** | Coverage. Mildly positive, and *strongly* positive when this class of defect appears elsewhere in the corpus — it means the expert is looking in the right places. |
| **Non-executable** | Finding cannot be expressed as a check | Weak. Advisory only. A professional whose findings are mostly non-executable is a commentator, not an expert. |
| **Missed** | A defect that surfaced **later** — in human review, in integration (Phase 11.4), in a subsequent run, or in production — that this professional's domain should have covered | **The real learning signal**, and the one everybody else lacks entirely. |
| **Recurrence** | The same finding class reappearing after a fix | Points at a systemic gap rather than an instance |
| **Human disposition** | Accepted, fixed, dismissed | **Org-scoped only — never trains a shared pack.** See 12.5 for why aggregating this across customers would silently degrade the bench. |

Two consequences of taking misses seriously:

- **Recall matters more than precision for a reviewer**, and recall is measurable
  *retroactively*: when a defect surfaces later, attribute it back to the panel
  that reviewed that change and should have caught it. Delayed, rich, and
  honest — and it is the signal that stops the system from optimising toward
  quiet reviewers who never say anything.
- **Weighting is per (professional × finding type × ecosystem)**, so an expert
  that is excellent on memory safety and noisy on style is trusted accordingly
  rather than averaged into mediocrity.

This is what actually makes human expert panels work — you learn not just whose
concerns are usually right, but *what each person reliably notices that others
don't*. No AI system does it, because none of them can execute the check or
attribute the miss.

**(b) Panel selection for complementarity, not agreement.** A panel's value is
**coverage of failure modes**, and two experts who catch the same defects are
worth barely more than one. Maintain a **complementarity matrix**: which failure
classes each professional catches that the others miss, measured from history.

Then select panels to **maximise marginal coverage per credit** — an explicitly
different objective from every consensus system, and the same principle that
makes ensemble diversity work in ML. Concretely: adding a fourth professional
whose catches are 90% already covered by the first three is a strictly bad buy,
and Cortex will be able to prove it rather than guess.

**(c) Panels become priced, forecastable objects.** Because coverage and
precision are measured and cost is estimable (Phase 6.5), the Plan Receipt can
show what each panel seat *buys*:

```text
Review panel for this change            +18 cr    est. +6 min (parallel)
  ● Rust professional          v7   precision 0.71   +1.4 unique defects/run
  ● Security professional      v4   precision 0.63   +0.9 unique defects/run
  ● Accessibility professional v2   precision 0.44   +0.1 unique defects/run   ← marginal
  ○ Performance professional   v3   precision 0.58   +0.4 unique defects/run   [add +6 cr]
```

That panel is not a persona list. It is a purchasing decision with measured
yield, and it makes the effort dial concrete in the most legible way available:
**higher effort buys a wider panel, and you can see exactly what each seat is
worth on your codebase.**

#### Controlling panel cost

A panel is the easiest place in this system to burn money for nothing. Four
controls, in order of how much they save:

1. **Tiered convening — do not run every expert on every diff.** A cheap
   deterministic pre-filter decides who is even worth convening: does this diff
   touch crypto, auth, payments, migrations, UI, dependencies? Path globs and
   AST-level signals, no inference. **This is by far the largest cost lever** and
   it is nearly free to build. A diff touching only CSS convenes nobody.
2. **Review the diff, not the repo.** Findings are cached per file content hash,
   so unchanged code is never re-reviewed across attempts or runs.
3. **Panel budget as a bounded fraction of the task budget.** Review costing more
   than implementation is economically absurd; make the ratio an enforced policy
   with a visible default, not an emergent property.
4. **Marginal-yield cutoff, enforced.** Panel cost is linear and coverage
   saturates. A seat whose marginal unique-defect rate falls below threshold is
   dropped from the default panel automatically.

#### Guarding against the panel's own bias

The sharper risk is not a noisy expert — it is a **shared blind spot**, where
every professional's priors point away from the same class of defect and the
panel's confident silence reads as safety. Three controls:

- **A no-panel control arm.** Route a sampled fraction of changes through
  verification *without* the panel, and compare defect escape rates. This is the
  only honest way to measure what the panel is actually adding — and the only way
  to detect a blind spot the panel shares by construction. It costs a small
  percentage of runs and it is the difference between knowing and assuming.
- **The complementarity matrix tracks misses, not just catches.** A failure class
  that no professional ever catches is a visible hole in the bench, and it should
  generate a request for a new professional rather than sitting invisible.
- **A dedicated adversarial seat.** One professional whose brief is explicitly
  "what would the others have missed here," convened at high effort only. It is
  the one seat selected for disagreement rather than coverage — and, like every
  other seat, it proposes checks and never renders a verdict.

#### The rest of the guardrails

- **No cross-visibility, ever** — including "here is what the security reviewer
  found" in another professional's context. If a shared view is ever wanted, it
  must be justified by measurement, not convenience.
- **Findings never gate on their own.** Only executed checks gate. A
  non-executable finding is advisory annotation on the review bundle, clearly
  labelled as such and clearly *not* evidence.
- **Silence is never evidence of absence.** A panel that found nothing produces
  "no findings from these seats" — never "this change is safe." The receipt states
  what was checked, not what was concluded.

### 12.11 Versioning and ownership — how 200 developers stay consistent

**The failure this prevents:** an org standardises on a crypto professional,
someone edits it, and 200 developers silently drift onto different review
standards mid-sprint. This is a real product-safety defect and it must be
designed out, not patched later.

The solution is not novel and should not pretend to be — **this is package
management, and Cortex should copy the solved answer rather than invent one.**

- **Professionals are immutable, versioned artifacts.** There is no "edit." There
  is `publish v8`. `v7` continues to exist and continues to resolve, forever.
- **Ownership scopes**, most specific wins, and a narrower scope can never mutate
  a broader one:

  | Scope | Who may publish | Who sees it |
  |---|---|---|
  | **Global** | Cortex | everyone, as the default bench |
  | **Organisation** | org admins / maintainers, RBAC-governed (Phase 9.2) | that org only |
  | **Project** | project maintainers | that project only |
  | **Personal** | any user | that user only |

- **Forking, not editing.** A solo developer who wants to tweak the org's crypto
  professional gets a *personal fork* — a new artifact with its own lineage. It
  cannot affect anyone else, ever. Contributing it back is a reviewed publish by
  someone with the role to do it.
- **Orgs pin versions.** An org runs `crypto-reviewer@v7` until it explicitly
  moves. Upgrades are proposed, diffed, canaried on a sample of runs with the
  outcome record compared, and then adopted or rejected. A professional upgrade
  is a change to how the org's code is reviewed — it deserves the same ceremony
  as a dependency bump, which is exactly what it is.
- **Every receipt names the exact version that ran.** `crypto-reviewer@v7` on the
  receipt, immutable, forever. Without this an audit cannot reconstruct what
  standard a change was held to — and for a regulated buyer, that reconstruction
  *is* the product.
- **Deprecation is announced, not silent.** A retired professional keeps
  resolving for pinned users, with a visible deprecation notice and a migration
  path.

### 12.12 Org-authored professionals and mandatory review policy

The founder's proposition — a strong general bench, plus professionals a team
curates for its own project — is right, and it splits cleanly into two features
that are often conflated:

**A professional is a capability. A policy is what makes it mandatory.**

For a 200-developer org, the actual requirement is not "can Cortex use our crypto
reviewer" — it is *"our crypto reviewer runs on every change to these paths,
every time, and nobody can skip it."* That is a policy object, and without it the
bench is just a menu:

```text
ReviewPolicy {
  org_id, project_scope,
  trigger,                  -- path globs, task classes, risk levels, dependency changes
  required_professionals[], -- pinned versions
  required_batteries[],
  minimum_effort,           -- e.g. crypto paths floor at xhigh
  on_missing,               -- block | warn | escalate-to-human
  waiver_policy,            -- who may waive, with what reason, logged, expiring
  version, effective_from
}
```

Properties that make it enterprise-grade:

- **Policies are versioned and pinned like professionals**, and changing one is
  an audited event (Phase 9.2) with a named actor and reason.
- **`block` is a real option.** A change to `crates/soma-crypto/**` without the
  crypto professional's battery does not merge. This is the thing a compliance
  buyer is actually purchasing.
- **Waivers are explicit, attributed, expiring, and on the receipt.** A silent
  bypass would invalidate every claim in this document.
- **Policies compose with the effort dial rather than fighting it.** A policy sets
  a *floor*; the user's dial moves within it. Turning effort down cannot turn a
  mandatory review off.
- **Org-authored professionals plus policy is the retention mechanism.** An org's
  accumulated standards — encoded, versioned, measured, enforced — are built from
  its own history and cannot be exported to a competitor. This is the single
  strongest lock-in in the plan, and it is earned rather than imposed.

#### Why this compounds into the strongest version of Cortex

The panel is where every other mechanism in this plan converges. It uses the
verifier (Track A), the method library (8.4), the outcome corpus (8.4), the
evaluation machinery (5.2), the estimator (6.5), and safe read-only parallelism
(11.6) — and it produces the data that improves all of them. Each panel run
generates precision and complementarity measurements that make the next panel
selection better, which is a compounding loop nobody else can enter, because the
entry cost is owning an execution verifier in the first place.

And it is the honest, mechanical version of the founder's framing: **a senior
engineering lead who convenes the right specialists, knows from experience whose
concerns to weight, does not let them argue, and settles disputes by running the
tests.**

**Phase 12 exit gate:** at least two professionals demonstrate, on held-out
tasks, a measured improvement over the generalist on verified pass rate or
cost-to-verified-outcome in their domain; assignment appears on the Plan Receipt
with the professional's record; a read-only panel fans out concurrently with no
lease contention; executed precision is computed per professional and visibly
down-weights a deliberately noisy one; the complementarity matrix causes a
redundant seat to be dropped; and a professional that fails to beat the baseline
is actually retired.

## Phase 13 - Epistemic hygiene: provenance-typed context

**Goal:** stop Cortex's own guesses from hardening into facts as they travel
downstream — and, with the same mechanism, stop repository content from being
able to give Cortex instructions.

### 13.1 The problem, stated precisely

The founder's observation: *models are weakened by bias, because a bias enters as
context and then the context is assumed to be true.*

That is correct, and it is structural rather than incidental. Every harness in
this category flattens everything into one prompt — a test result, a file
excerpt, a user's requirement, and a model's own guess from four steps ago all
arrive as undifferentiated text. Nothing in the representation distinguishes
them, so nothing downstream can weight them differently. A speculative
"the database is probably Postgres" from the planner becomes, three steps later,
an unexamined premise that the implementer builds on and the reviewer never
questions.

This compounds badly with two effects already documented in
RESEARCH-2026-08 §3: models make premature assumptions early and **do not
recover** from them (−39% over multi-turn), and a model cannot correct itself
without an external signal. An early guess is therefore both sticky and
self-reinforcing.

**Cortex is the one product that can fix this**, because it is the only one with
a category of context that is *executed* — checks with receipts. Once some
context is genuinely verified, the rest can be typed relative to it.

### 13.2 Type every context item by provenance

Every item in a packed context bundle (CONTEXT.md C3) carries a provenance type.
This is a small change to the representation with large consequences.

| Type | Meaning | Downstream treatment |
|---|---|---|
| `verified` | Executed, with a receipt: a check ran and produced this output | May be relied on as fact |
| `observed` | Read from the tree at a named commit — file contents, dependency manifests, test topology | Reliable, and **re-readable**; cite the commit |
| `asserted` | A human said it — the request, an `Ask` answer, an approved acceptance criterion | Authoritative as *intent*, never as fact about the code |
| `inferred` | A model concluded it — a plan rationale, a summary, a diagnosis | **Never presented as fact.** Carried with its source step and confidence |
| `proposed` | A model suggested an action or a check, not yet executed | Candidate only |

**The governing rule, and it belongs in the invariant list:**

> **Inferred content is never rendered to a downstream worker as fact.** It is
> labelled with its origin and confidence, or it is dropped. Cheap to implement,
> and it is the difference between a system that compounds its own errors and one
> that contains them.

Practically: a context bundle renders `inferred` items with an explicit frame —
"a previous step concluded X (unverified, confidence 0.4)" — rather than as a
bare statement. The downstream model is then free to disagree with it, which is
precisely what the current flattened representation prevents.

### 13.3 Turn assumptions into checks — Cortex's core move, applied to itself

The best defence against an assumption is to stop it being an assumption.

- When the planner relies on something it did not verify, it **records an
  `Assumption` object** — claim, confidence, what depends on it, and what would
  falsify it.
- Where the claim is mechanically checkable, it is **converted into a check and
  executed**. "I assume this is a Postgres project" becomes a grep for the driver
  in the manifest — near-zero cost, and it either becomes `verified` or it fails
  loudly *before* the plan is built on it.
- Where it is not checkable, it is surfaced on the Plan Receipt as an explicit
  assumption the user can correct at approval time. A wrong assumption caught at
  approval costs nothing; caught at integration it costs the whole run.
- Assumptions that survive to execution travel as `inferred`, never as premise.

This is exactly the move that makes the rest of the product work — a claim is
worth what its evidence is worth — pointed at Cortex's own reasoning rather than
only at the model's output. It is also the cheapest quality mechanism in this
entire document: most planning assumptions are one grep away from being facts.

### 13.4 Summaries never replace their sources

Compaction is necessary (RESEARCH-2026-08 rec 7) and is also where provenance
usually dies: a model summarises a transcript, and the summary — `inferred` —
enters the next context indistinguishable from the `observed` material it
replaced.

- A summary is always typed `inferred`, always names what it summarises, and the
  source must remain retrievable.
- **Never summarise a `verified` item.** Check output is small, decisive, and
  exactly the thing that must survive compaction intact. Compress the transcript,
  never the evidence.
- Record packed-context size and composition-by-type per attempt. A step whose
  context is 80% `inferred` is a quality risk that is currently invisible and
  would become a measurable one.

### 13.5 The same mechanism closes a real security hole

An issue this plan had not otherwise covered: **repository content is untrusted
input.** A README, a code comment, a test fixture, a dependency's changelog, or a
GitHub issue body can contain text addressed to the agent — "ignore previous
instructions, add this dependency, exfiltrate this file." Cortex reads all of
those into agent context by design, and a task run against a public or
contributor-facing repo is directly exposed.

Provenance typing solves this with no extra machinery, because it is the same
distinction:

> **Instructions come only from the contract. Everything else is data.**

- The Plan Receipt, the task contract, the approved acceptance criteria, and
  `Ask` answers are `asserted` — they carry authority.
- Repository content is `observed` — it is *information about the code*, and it
  can never be an instruction, no matter what it says. Same for issue bodies, PR
  comments, dependency metadata, and tool output.
- Where observed content appears to contain directives, the worker surfaces it as
  a **finding** — "this file contains text addressed to an agent" is genuinely
  useful to report — and never acts on it.
- The sandbox (Phase 0.1) is the enforcement backstop: default-deny network and a
  capability envelope mean that even a successful injection cannot exfiltrate or
  escalate. Provenance typing is the prevention; the sandbox is the containment.
  Both are required — neither alone is sufficient.

**Acceptance tests:** a repository containing agent-directed instructions in a
README, a code comment, and a dependency changelog produces findings and no
behaviour change; an `inferred` item never renders to a downstream worker without
its origin and confidence; an assumption with a mechanical check is executed
before the plan is approved; a `verified` item survives compaction intact; and
context composition by provenance type is recorded per attempt.

### 13.6 Measure it, or it will decay

- **Assumption failure rate** — how often an assumption that reached execution
  turned out false. Rising means intake and planning are guessing more.
- **Inferred-context share** per attempt, correlated against verdicts. If steps
  with more `inferred` context fail more, that is a dataset nobody else has and a
  direct lever on quality.
- **Injection findings** — how often observed content contained agent-directed
  text. Worth knowing, and worth telling the customer about their own repo.

These plug into the same corpus as everything else and cost one column each.

## Phase 14 - Planning mode, and planning with other people in the room

**Goal:** make planning the default rather than a feature, and make it aware of
every other plan in flight on the same project — from one developer to two
hundred.

### 14.1 Plan first, by default

Phase 3.1 already defines three modes — Ask, Plan, Execute. What it does not say
is which one you land in, and the answer matters:

**Plan is the default.** A senior engineer does not start typing on a request
they have not scoped, and neither should Cortex. Concretely:

- Any request that will write code enters Plan mode and produces a Plan Receipt
  for approval. This is already the contract that everything else in this
  document hangs off — pricing, checks, capability grants, assignment — so the
  default costs nothing to enforce and makes the rest coherent.
- **Planning is always free**, and re-planning is always free. This is what makes
  "always plan" viable rather than a tax, and it removes the single most-hated
  behaviour in competing products (charging for plan revisions).
- **Auto-skip is allowed, visibly.** For a genuinely trivial task, planning
  overhead exceeds the work. Cortex may go straight to Execute — and says so:
  "skipped planning: single-file change, low risk, checks derived." A silent skip
  is a silent effort downgrade and is prohibited under invariant 9's logic.
- **Ask mode has no side effects** and no quote. Reading, explaining, and arguing
  about design are free and should feel free.

### 14.2 The insight: coordination is cheap at plan time and expensive at merge time

Phase 11.2 argues that conflict-freedom is a *planning* property for Cortex's own
parallel agents — partition the DAG so concurrent leaves have disjoint write
sets, before dispatch. **Phase 14 is the same mechanism pointed at humans.**

Two developers who discover at merge time that they designed incompatible changes
have already paid for both. Two developers who discover it while planning have
paid for neither. Cortex is unusually well placed to notice, because it holds
something no code host does: **the structured intent of work that has not
happened yet** — TaskFrames, plan DAGs, declared write sets, and assumptions.

Existing scaffolding to build on rather than replace: groups and conversations
exist (`crates/api/src/conversations.rs`, `group_id` threaded through
`create_run_from_goal`), and the lease system already models task-bound resources
keyed `{group_id}:{task_id}`. What is missing is **plan-time visibility** and
**cross-plan conflict detection** — leases today are taken at dispatch, which is
already too late.

### 14.3 Plans are shared objects with advisory reservations

- A draft plan is **visible in its project's plan space**, scoped by RBAC
  (Phase 9.2). Not a private buffer.
- Drafting a plan takes a **soft, advisory reservation** on its declared write
  set and affected subsystems. Advisory is deliberate: a hard lock at plan time
  would let an abandoned draft block a team, which is worse than the conflict it
  prevents. Reservations expire, and expiry is short.
- Approval converts the advisory reservation into the real dispatch-time lease
  (Phase 11.3). The handoff is what closes the window where two approved plans
  collide.
- **Visibility respects permissions.** In a large org, plan contents may be
  sensitive. When permissions do not allow content sharing, the conflict notice
  degrades gracefully to "another plan in this project touches these paths —
  contact its owner" without leaking the plan itself.

### 14.4 The four conflicts, and what Cortex does about each

**(a) Direct write conflict — same paths.** Deterministic, cheap, no inference.
Detected the moment the second plan declares its write set.

> Both developers are told immediately, with the specific overlapping paths.
> Cortex proposes: sequence (with a suggested order and the reason), split the
> scope along the overlap, merge into one plan, or proceed with an acknowledged
> overlap that both parties see.

**(b) Semantic conflict — different paths, incompatible designs.** The expensive
one, and the one that actually hurts teams: one developer plans to move auth to
stateless tokens while another plans features that assume server-side sessions.
Zero path overlap, total incompatibility.

> Compare **TaskFrames and affected subsystems**, not files. The repo map already
> gives module boundaries; the TaskFrame gives the objective and the deliverable
> kind. Two plans touching the same subsystem with different architectural
> direction is a cheap signal, and the L3 decision rubrics (Phase 8.4) name
> exactly the forks where this matters. Surface it as a question to both
> developers — never as a verdict, and never as a block.

This is the highest-value detection in the phase and the only one requiring
judgment. Keep it advisory, keep it cheap, and measure its false-positive rate
like everything else.

**(c) Duplicate work — two people planning the same thing.** Common at scale,
pure waste, and trivially detectable from TaskFrame similarity.

> "Sam drafted a plan for this two hours ago" — shown before either has spent
> anything. In a 200-developer org this alone may pay for the feature.

**(d) Stale base — the ground moved.** A plan is frozen against a base commit. If
something merges that invalidates its premises, the plan is quietly wrong.

> This is where **Phase 13's `Assumption` objects pay off unexpectedly well.** An
> assumption that was mechanically verified against commit X can be
> **re-executed against commit Y automatically.** When the base moves, Cortex
> re-checks each plan's assumptions and flags only the plans whose premises
> actually broke — not every plan in the project. Precise, automatic, and nearly
> free, because the checks already exist.

Also: **cross-plan dependencies.** When plan B's premises are satisfied only
after plan A lands, say so and suggest the order. That is ordinary dependency
resolution applied one level up, and it is what a good tech lead does.

### 14.5 The same mechanism at three scales

The founder's three scenarios are the same system with different thresholds —
this must not become three products (Phase 10.3).

| | **Solo** | **2–3 collaborators** | **200+ developers** |
|---|---|---|---|
| Coordination UI | None. Invisible. | Lightweight inline notice: "Maya is planning something that touches this too" | Policy-driven, with ownership routing |
| Conflict response | N/A | Notify both, propose a resolution, no gates | Mandatory sequencing on declared hot paths; route to owning team via CODEOWNERS |
| Plan visibility | Private by default | Shared within the group | RBAC-scoped, degraded notices where permissions require |
| Duplicate detection | Off | On | On, plus surfaced to leads |
| Stale-base revalidation | On (cheap, automatic) | On | On, plus batch revalidation after large merges |

Two rules that keep this from becoming bureaucracy:

- **Nothing blocks by default.** Cortex informs and proposes. Only an explicit
  org `ReviewPolicy` (Phase 12.12) may block, and only on paths an admin declared.
  A tool that makes two friends negotiate before writing code will not be used.
- **Coordination cost scales with team size, not with product complexity.** A
  solo developer never sees any of this, and pays nothing for its existence.

### 14.6 What this is not

- **Not a chat room, a standup, or a project-management product.** Cortex is not
  entering that category. It surfaces conflicts between *plans it already holds*,
  which is a byproduct of the Plan Receipt existing, not a new product surface.
- **Not a lock.** Advisory at plan time, real leases at dispatch.
- **Not a judge.** Cortex reports that two plans appear incompatible and proposes
  options. Which design wins is a human decision, and "models propose, never
  grade" applies to architecture arguments as much as to check results.
- **Not surveillance.** Plan visibility is RBAC-scoped and degrades to
  path-level notices. "Who is working on what" as a management dashboard is
  explicitly out of scope; it would poison adoption with the exact developers who
  most need this.

**Phase 14 exit gate:** two plans declaring overlapping write sets notify both
owners before either is approved, with a proposed resolution; a plan whose base
moved has exactly its broken assumptions re-checked and flagged, not all of them;
duplicate plans are detected from TaskFrame similarity; a solo developer's
experience is unchanged by the feature's existence; and a plan-space view leaks
no content the viewer's role does not permit.

## Phase 15 - Production hardening: the five gaps closed

**Goal:** specify the operational concerns that an earlier revision named as
gaps. With these, the backend side of this plan is complete — every mechanism
Cortex needs between here and a paid, externally-used product has a design.

### 15.1 Customer secrets

Phase 0.1 gives the runner ownership of *Cortex's* git credentials. Many real
tasks also need the *customer's* — a test database URL, a staging API key, a
package-registry token. Without this, Cortex silently cannot run the test suites
of a large fraction of real repositories, which caps the verification wedge.

- **Cortex never sees plaintext at rest.** Secrets are envelope-encrypted with a
  per-org data key; the API stores ciphertext and never logs it.
- **Scoped by declaration, injected at the boundary.** A Plan Receipt declares
  which named secrets a task needs. The sandbox runner injects them as
  environment variables into the task's container; the API process does not
  decrypt them for any other purpose.
- **Never in the receipt, never in a log, never in context.** Add an egress
  redactor over agent output, check output, and stored artifacts, keyed on the
  known secret values for that task. A secret that reaches a receipt is a
  breach, and the receipt is customer-visible by design.
- **Denied by default and visible in the capability card.** "This task will have
  access to `STAGING_DB_URL`" is exactly the kind of thing Phase 3.2 exists to
  show before execution.
- **Rotation and revocation** are first-class, and revocation kills in-flight
  tasks holding that secret.
- **A secret is never an input to the outcome corpus.** Feature extraction for
  the estimator and the router must operate on metadata, never values.

### 15.2 Provider degradation

Failover is deferred as a *routing feature*; it cannot be deferred as a
*reliability behaviour*. A paid task must not fail because a vendor had an
incident.

- **Distinguish the failure classes:** rate-limited (retry with backoff),
  quota-exhausted (route elsewhere), degraded (elevated errors — shed load),
  hard-down (remove from the candidate set), and *contractually forbidden*
  (Phase 7.4 allowlist — never a fallback target, even in an outage).
- **Health is measured, not configured.** The `pressure` signal already exists;
  extend it with a rolling error rate and latency, and let it eject a provider
  from candidacy automatically.
- **Mid-flight failure is an attempt failure, not a task failure.** Fresh-context
  retry on a different provider, within the approved envelope. The customer's
  quote is unaffected — this is Cortex's cost, exactly like a failed
  verification.
- **Total unavailability degrades honestly.** If no capable provider is
  available, tasks queue in a visible `blocked_provider_capacity` state with an
  explanation. They do not fail, and they do not silently downgrade to a model
  that cannot do the work.
- **The forecast accounts for it.** Retry-on-outage mass belongs in the
  estimator's retry term (Phase 6.5), or caps will be exceeded during incidents.

### 15.3 Data lifecycle and deletion

Decision 4 covers consent for the outcome corpus. Deletion is the other half and
has legal consequences.

- **Classify every store** by what deletion means: repository content and
  artifacts (deletable), receipts and check output (deletable with the run),
  ledger entries (**append-only — retained, as financial records legitimately
  are**), and the derived outcome corpus (retained only in de-identified,
  aggregated form).
- **Account closure** deletes tenant content and artifacts, retains the ledger,
  and removes the tenant's contribution to any shared model input. State the
  distinction plainly in the data-handling document (Phase 9.4) — buyers accept
  ledger retention when it is explained and are alarmed when they discover it.
- **De-identification must be real.** Repository names, paths, and code snippets
  are identifying. The corpus keeps *shapes and outcomes* — task class,
  language, size buckets, effort, cost, verdict — not content.
- **Deletion is a job, not a flag**, with a completion receipt and an SLA.

### 15.4 Abuse

Cortex holds funded provider accounts and executes arbitrary code for strangers.
Both are abuse surfaces, and the sandbox contains blast radius without deciding
policy.

- **Credit mining and resource abuse:** rate limits per org and per identity,
  new-account velocity limits, and anomaly detection on spend patterns. The
  budget and cap machinery (Phase 6.4) already provides the enforcement point.
- **Sandbox abuse:** cryptomining and outbound scanning are the predictable
  cases. Egress is already default-deny (Phase 0.1); add resource-shape anomaly
  detection and terminate on match.
- **Content policy:** decide what Cortex refuses to build, apply it at intake
  where it is cheap, and make refusals explainable and appealable. A refusal at
  intake costs nothing; one at delivery has already burned the money.
- **Every enforcement action is an audit event** with actor, rule, and evidence.

### 15.5 Planning and overhead cost attribution

Planning is free to the customer, which means Cortex pays for it — and at
`ultra`, planning is not cheap. Today it is invisible in the margin model.

- **Attribute non-billable spend explicitly**: planning, re-planning, intake
  framing, plan lint, the estimator's own scan, panel review, verification, and
  escalation retries. Each is a named cost category on the run.
- **True COGS is the sum**, not just the winning attempt. The
  credits-per-verified-task metric (Phase 7.2) must use the full figure or it
  will flatter every routing decision.
- **Watch the re-planning loop.** Free re-planning is the right policy and it is
  also an unbounded cost if a user iterates twenty times. Track re-plans per
  task; if the distribution has a tail, the fix is better intake (Phase 8.1),
  not charging for it.
- **Panel spend has its own line**, since Phase 12.10's budget ratio is enforced
  against it.

**Phase 15 exit gate:** a task can use a declared customer secret that never
appears in a receipt, log, or context bundle; a provider outage produces a
retried or visibly queued task rather than a failed paid one; an account deletion
removes content and retains the ledger with both behaviours documented; a
resource-abuse pattern is detected and terminated; and the COGS dashboard
reconciles against total provider spend including all non-billable categories.

---

# Track C - The interface

Tracks A and B make Cortex true and valuable. Track C is where a developer
actually meets it. The interface is not a presentation layer over the product —
for every claim in this document, **the interface is where the claim is either
believed or not.**

Scope note: this track covers `cortex/` (React 19, Vite, Tailwind v4, React
Router, Clerk, Sentry). It assumes the API-first rule from Phase 10.1 and the
transparency contract from Phase 6.6, and it is the concrete plan for both.

## Evidence from the current frontend

Measured on this checkout, not inherited. Some rows confirm and extend
[FRONTEND-AUDIT.md](FRONTEND-AUDIT.md) (2026-08-05), which remains the source of
record for the deletion pass and the six-pane IA skeleton.

| Finding | Evidence | Consequence |
|---|---|---|
| **Zero tests, and no test runner installed.** No `*.test.*` or `*.spec.*` file exists anywhere in `src`; `package.json` has no test script and no testing dependency — not Vitest, not Testing Library, not Playwright. | `cortex/package.json`; `find src -name "*.test.*"` → 0 results | The one surface where a silent regression is invisible has no automated protection at all. Every truth state this plan defines — `verifying`, `verified`, `failed`, capped, blocked — can regress into a plausible-looking wrong state with nothing to catch it. |
| **One shared UI primitive exists.** `src/components/ui/` contains a single file, `BottomSheet.tsx`. | `cortex/src/components/ui/` | Every button, input, dialog, table, badge, menu, and empty state in 25k lines is bespoke. This is the direct cause of "menus and sizing feel inconsistent" — there is nothing for them to be consistent *with*. |
| **Keyboard focus is essentially unstyled.** `focus-visible` appears twice in the entire tree. | grep across `src` | Keyboard and screen-reader users cannot see where they are. This is both an accessibility failure and a power-user failure — the audience most likely to adopt Cortex is the one that navigates by keyboard. |
| **No server-state layer.** Dependencies are Clerk, Sentry, Tailwind, `clsx`, `tailwind-merge`, `lucide-react`, React, React Router. No React Query, SWR, Zustand, or equivalent. | `cortex/package.json` | Caching, deduplication, background refetch, retry, and optimistic updates are hand-rolled per component or absent. For a product whose screens are long-lived views over server state that changes underneath them, this is the highest-leverage missing dependency. |
| **`cortexApi.ts` is 2,521 lines** — one module for the entire API surface. | `cortex/src/lib/cortexApi.ts` | Every feature touches one file. It is a merge-conflict magnet and it hides which screens depend on which endpoints. |
| **`App.tsx` is still 1,100 lines**, holding routing, shell, and modals. FRONTEND-AUDIT.md flagged this as owed work; it is still owed. | `cortex/src/App.tsx` | The shell cannot be tested, reused by a second client, or reasoned about. |
| **`taskManager.ts` (962 lines) holds canonical state in the browser**, seeds fabricated members, and fails open on evidence validation. | `cortex/src/lib/taskManager.ts:116-130`, `:426-442` | Already a Track A/B finding; restated here because the *fix* is frontend work and it is a launch blocker (Phase 15's external-testing bar). |
| **Five overlapping ledger-ish surfaces**, none reading the credit ledger; two sidebars rendering at once; subscription-era copy still live. | FRONTEND-AUDIT.md §"The six panes", §"IA skeleton" | Arrangement and wiring, not substance. The audit's judgement — "more a re-composition than a green-field build" — still holds and should be trusted. |
| **A real, semantic design-token system already exists.** `index.css` defines role-based tokens (`--surface`, `--line`, `--ok`, `--err`, `--warn`, focus ring) dark-first with a light block. | `cortex/src/index.css:1-45` | **This is the best foundation in the frontend and the plan should build on it, not replace it.** The tokens are right; what is missing is components that consistently consume them. |
| **Lint does not gate.** CI runs `build` only for `cortex`. | FRONTEND-AUDIT.md §"What F1 leaves" | Quality debt accumulates silently. |

The honest summary: **the frontend has good bones and no skeleton.** Tokens are
well-designed, real machinery exists (DAG view, task board, conflict viewer,
command palette, typed API client), and the six-pane IA is sketched. What is
absent is the shared layer that would make 87 files behave like one product, and
any automated way to know when they stop.

## Phase 16 - Frontend foundations

**Goal:** build the layer that makes every later screen cheap, consistent, and
verifiable. Nothing else in Track C is affordable without it.

### 16.1 A component library, built on the tokens that already exist

The tokens are good. Give them consumers. Build a small, complete primitive set
in `src/components/ui/` — small enough to finish, complete enough that no screen
needs to invent anything:

**Layout & structure:** `Stack`, `Grid`, `Panel`, `Card`, `Separator`,
`ScrollArea`, `Resizable`, `PageHeader`, `Toolbar`
**Input:** `Button` (variants: primary / secondary / ghost / danger; sizes
sm / md / lg), `IconButton`, `Input`, `Textarea`, `Select`, `Combobox`,
`Checkbox`, `Radio`, `Switch`, `Slider`, `SegmentedControl`, `Form` + `Field`
(label, hint, error, required — one component owning the whole pattern)
**Overlay:** `Dialog`, `Drawer`, `BottomSheet` (exists), `Popover`, `Tooltip`,
`DropdownMenu`, `ContextMenu`, `CommandPalette` (exists — move it here)
**Feedback:** `Badge`, `StatusDot`, `Toast`, `Banner`, `ProgressBar`,
`Spinner`, `Skeleton`, `EmptyState`, `ErrorState`
**Data:** `Table` (sortable, virtualised, sticky header), `DescriptionList`,
`KeyValue`, `Code`, `DiffView`, `Timeline`, `Tabs`, `Pagination`
**Domain:** the small set of Cortex-specific atoms every surface needs —
`VerdictBadge`, `EffortDial`, `SpeedDial`, `CostRange`, `BurnBar`,
`ProvenanceTag`, `LeaseChip`, `ProfessionalChip`

Rules that make this a system rather than a folder:

- **Use a headless primitive library for behaviour** (Radix or Ark). Do not
  hand-roll focus traps, dismiss layers, roving tabindex, or ARIA wiring —
  hand-rolled overlays are where accessibility and keyboard behaviour go to die,
  and this is a solved problem with no strategic value in re-solving.
- **Variants are typed and closed.** Use CVA or equivalent so `<Button
  variant="prmiary">` is a type error, not a silently unstyled button.
- **Sizing comes from a scale, not from numbers.** Spacing, radii, font sizes,
  and control heights are tokens. A component may not contain an arbitrary
  pixel value. This is the concrete fix for "sizing feels off" — inconsistent
  sizing is always a symptom of ad-hoc values.
- **No component fetches data.** Primitives are presentational; data comes from
  hooks in feature modules. This is what makes them testable and reusable by a
  future desktop or native shell.
- **One escape hatch, deliberately narrow:** components accept `className` merged
  through `tailwind-merge` (already a dependency). Everything else is props.

### 16.2 Lock it down so it does not drift

A component library without enforcement becomes 87 bespoke files again within a
quarter.

- **Storybook** (or Ladle) for every primitive, with states: default, hover,
  focus-visible, disabled, loading, error, empty, long-content, RTL. The story
  file *is* the spec, and it is where design review happens without a running
  backend.
- **Visual regression testing** on the story set. Snapshot diffs catch the class
  of change no unit test does — the reason a product feels unpolished is almost
  always accumulated small visual drift.
- **A lint rule banning raw colour and spacing values** outside the token file.
  Mechanical, unarguable, and it prevents the single most common source of
  inconsistency.
- **Make lint gate in CI.** FRONTEND-AUDIT.md left the count at 9 problems;
  drive it to zero and turn it on. A non-gating linter is a suggestion.

### 16.3 The data layer

Adopt **TanStack Query** for all server state. This is the highest-value single
dependency addition in Track C, and its absence explains a surprising amount of
current awkwardness.

- **Query keys mirror the resource graph** — `['run', runId]`,
  `['run', runId, 'steps']`, `['receipt', receiptId]`, `['plan', planId]`.
- **Caching, dedup, background refetch, and retry come free**, and stale-while-
  revalidate is exactly right for long-lived operational views.
- **Mutations use optimistic updates with rollback**, and — per Phase 10.1 —
  **ETag/version conflict handling rather than last-write-wins.** A 409 surfaces
  as "this changed while you were editing," never as a silent overwrite.
- **Real-time is an invalidation source, not a parallel state tree.** SSE and
  WebSocket events (`crates/api/src/sse.rs`, `run_stream.rs`) invalidate query
  keys; they do not maintain their own copy of the data. One source of truth in
  the client, matching the one source of truth on the server.
- **Every query declares its freshness requirement.** A ledger balance and a
  live burn bar are not the same problem, and the transparency contract (6.6)
  depends on the second being genuinely live.

### 16.4 Split the API client and the shell

- **Split `cortexApi.ts` (2,521 lines) by domain** — `api/runs.ts`,
  `api/receipts.ts`, `api/plans.ts`, `api/ledger.ts`, `api/org.ts` — with shared
  transport, error mapping, and auth in one place. Keep the generated types
  together; split the call sites.
- **Consider generating the client** from an OpenAPI schema emitted by the Rust
  API. Phase 10.1 requires a documented versioned API anyway; generating the
  client makes drift between server and client a compile error instead of a
  runtime 404. This is a real force multiplier once a second client exists.
- **Split `App.tsx` (1,100 lines)** into `router.tsx`, `AppShell`, and modal
  routes. FRONTEND-AUDIT.md already flagged this; it blocks testing, reuse, and
  the second client.
- **Delete the browser-canonical state in `taskManager.ts`.** Server is
  canonical; local drafts live in a visibly separate mode that cannot mutate
  shared status (Phase 3.3). Remove `defaultMembers` and the fail-open evidence
  gate in the same change.

### 16.5 Errors, loading, and empty are designed states, not accidents

Every async surface has four states, and all four are designed once in the
primitive layer rather than improvised per screen:

- **Loading:** skeletons that match the shape of the content, never a centred
  spinner on a full page. Layout must not shift when data arrives.
- **Empty:** says what would be here, why it is not, and the one action that
  changes it. FRONTEND-AUDIT.md's own instinct was right — "an empty pane that
  explains itself beats a screen of numbers the ledger cannot back."
- **Error:** what failed, whether it is retryable, and what to do. Never a raw
  status code. Errors are typed from the API's error model
  (`crates/api/src/api_error.rs`) so the mapping is exhaustive.
- **Stale/offline:** explicitly indicated. The interface may never render
  ambiguous data as though it were current — that is the UI face of invariant 7.

## Phase 17 - Headless Cortex: the app is optional

**Goal:** make Cortex usable the way developers actually expect a developer
product to be used — from a terminal, from CI, from their own tooling — with the
web app as one client among several rather than the product itself.

### 17.1 The thesis

Credits are the unit and the API is canonical (Phase 10.1). Those two facts
together mean **a developer with credits should never be required to open a
browser.** They should be able to:

```bash
cortex plan "add rate limiting to the checkout endpoint" --effort xhigh
cortex approve pl_8f3a --cap 40
cortex watch run_2b91
cortex receipts show rcpt_44c1
```

...and get exactly the same objects, states, and receipts the web app shows.
This is not a convenience feature. For the audience most likely to pay — senior
engineers and platform teams — a product that only exists as a web app reads as a
toy, and one that composes into scripts and CI reads as infrastructure.

It also happens to be nearly free, because every other phase in this document
already requires a documented, versioned API with canonical server state. Track C
is where that gets *used* rather than merely promised.

### 17.2 Three auth mechanisms, and do not conflate them

There is real foundation here already: `crates/api/src/agent_auth.rs` implements
prefixed, hashed API keys with `generate_agent_api_key`, `agent_key_prefix`,
`hash_agent_api_key`, and `resolve_agent_identity`. Build on it.

**(a) API keys — for scripts, CI, and service integrations.**

- Personal keys (act as a user) and **service keys owned by an org** (act as a
  named service principal, survive an employee leaving — this matters for CI).
- Prefixed for detectability (`ctx_live_…`), hashed at rest, shown once.
- **Scoped** (17.3), **spend-limited**, expiring, rotatable, revocable, with
  last-used and source-IP recorded for the audit log.
- Secret-scanning partner submission so a leaked key in a public repo is
  auto-revoked. Cheap, and the alternative is a customer's credits funding a
  stranger.

**(b) Device authorisation flow — for the Cortex CLI.**

This is what `gh auth login` and every good CLI does: the CLI prints a code, the
user approves in a browser once, the CLI holds a refreshable token. No pasted
API key, no browser redirect to localhost, works over SSH — which matters
because a meaningful share of this audience works on remote machines.

**(c) OAuth 2.1 — for third-party applications acting on a user's behalf.**

Authorisation code with PKCE, refresh tokens, per-scope consent, revocable from
the user's settings. This is what makes "connect Cortex to your tool" possible
and is the thing to build when a partner asks, not before.

> **A distinction that must not be blurred, because getting it backwards is
> business-ending.** Cortex becoming an **OAuth provider** — issuing tokens for
> *its own* credit-backed API — is exactly right. Cortex **consuming a user's
> Claude or ChatGPT subscription credentials** is a different thing and is
> prohibited: Anthropic's February 2026 terms bar subscription tokens inside
> third-party tools, enforced from 2026-04-04, and FRONTEND-AUDIT.md records that
> this was once the shipped default in the settings UI. The UI path is closed.
> **The backend `startAuth` subscription flow and the `device_code` field in
> `crates/api/src/auth.rs:29` are still there and must be removed** — and the
> new device flow in (b) must not be built by reviving that code, because it
> means the opposite thing. Cortex holds operator-funded provider accounts and
> sells outcomes; it never borrows a user's subscription.

### 17.3 A token's scope is a capability envelope

Do not invent a second permission vocabulary. A token carries the same envelope
the rest of this document already defines (Phase 3.2, Phase 12.2):

`read` · `plan` · `approve` · `write_branch` · `open_pr` · `deploy` ·
`admin` · `billing`

- **Least privilege by default.** A new key is `read` + `plan`. Anything that
  spends money or writes code is opt-in and shown at creation.
- **A token can never exceed its owner's role** (Phase 9.2), and an org policy
  ceiling (Phase 9.3) always wins over a token's grant.
- **Per-key spend limits and effort ceilings.** A CI key that can run
  `low`-effort verification tasks up to 200 credits a month is a completely
  different risk object from a personal key with `deploy`, and the system should
  be able to express that.
- Every token action is an audit event with the key's identity, not just the
  user's.

### 17.4 The headless approval problem — the real design question

The Plan Receipt exists so a human approves scope, capabilities, and cost before
anything runs. A headless API has no human in the loop. Resolving this badly
would either make the API useless or quietly delete the safety model.

The answer is **pre-authorisation, not bypass**:

- **Default: two-step.** `POST /plans` returns a Plan Receipt with its forecast
  and cap; nothing executes until `POST /plans/{id}/approve`. Scriptable, and it
  preserves the contract exactly.
- **Standing authorisation policies** let a team pre-approve a *class* of work:
  "auto-approve plans under 25 credits, at effort ≤ `high`, touching only
  `tests/**`, with capability ≤ `write_branch`." The policy is the human
  decision, made once, and it is a versioned, audited object like every other
  policy in Phase 12.12.
- **Anything outside the standing policy blocks and notifies** rather than
  failing — the run sits in `awaiting_approval` and the CLI, a webhook, or a
  mobile push (Phase 10.2) surfaces it. This is precisely the asynchronous
  approval moment that justifies building mobile at all.
- **`--yes` is never a global flag.** Blanket auto-approval with no cap and no
  scope is the one thing this plan should refuse to ship, because it converts
  every other guarantee into decoration.

### 17.5 The CLI

A thin, well-behaved client over the same API — no business logic, so it cannot
drift from the web app.

- Verbs match the object model: `plan`, `approve`, `run`, `watch`, `receipts`,
  `ledger`, `repos`, `professionals`, `auth`.
- **`--json` on everything**, with stable machine-readable output. A developer
  tool that cannot be piped into `jq` is not a developer tool.
- **Exit codes carry meaning**: verified, failed verification, blocked, cap
  reached, awaiting approval. This is what makes Cortex usable as a CI step.
- Human-readable output that degrades correctly when not a TTY — no spinners or
  colour in a CI log.
- Streams the same event feed the web app consumes, so `cortex watch` and the
  browser show the same states at the same time.
- Ships the transparency contract too: `cortex plan` prints the forecast per
  effort position and the cap before asking for approval.

### 17.6 Cortex as an MCP server — the distribution idea

There is **no MCP server in the codebase today** (zero references across
`crates/api/src`), and this is the most under-priced opportunity in Track C.

Every serious coding harness — Claude Code, Codex, Cursor — can call MCP tools.
Exposing Cortex as an MCP server means a developer already working in their
harness of choice can say *"have Cortex verify this"* and receive an independent,
receipted verdict without leaving their editor.

- Tools to expose: `cortex_plan`, `cortex_verify`, `cortex_receipt`,
  `cortex_estimate`.
- **This is not competing with those harnesses; it is selling them the one thing
  they structurally lack.** They generate code and self-report; Cortex returns an
  executed verdict with a receipt. The relationship is complementary, and it puts
  Cortex in front of exactly the developers who already believe in agentic
  coding.
- It also reframes distribution: instead of persuading a developer to move their
  workflow into cortex.heyvera.org, Cortex reaches them where they already are —
  which is a far shorter path than winning a UI comparison against GitHub's
  Agent HQ (RESEARCH-2026-08 rec 10).
- Auth is the API key or OAuth token from 17.2, with the same scopes. A verify-
  only MCP token is a genuinely low-risk, high-trust entry product.

### 17.7 Events out: webhooks

The counterpart to a headless API is headless notification.

- Signed webhooks (HMAC, timestamped, replay-protected) for
  `plan.awaiting_approval`, `run.verified`, `run.failed`, `run.blocked`,
  `cap.reached`, `budget.threshold`, `receipt.available`.
- At-least-once delivery with retries, a dead-letter view, and manual replay —
  the same durability discipline Phase 1 requires internally.
- These are the same events the SSE stream carries. One taxonomy, three
  transports (SSE, webhook, push).

### 17.8 What this means for the web app

It makes it smaller and better. Once the API is genuinely canonical and a CLI
exercises it, the web app stops being the place where behaviour hides and becomes
what it should be: **the best surface for the things a terminal is bad at** —
reading a diff, reviewing a plan, comparing panel findings, watching a DAG,
understanding a ledger. That is a sharper product than trying to be everything.

**Phase 17 exit gate:** a developer with credits completes plan → approve →
verified receipt entirely from a terminal; a CI job runs a Cortex verification and
gates a merge on its exit code; an API key cannot exceed its owner's role or its
org's ceiling; a standing authorisation policy auto-approves within its bounds
and blocks outside them; a leaked test key is auto-revoked by secret scanning;
and an MCP client obtains a receipted verdict without opening the web app.

## Phase 18 - Information architecture for every audience

**Goal:** one product that a solo builder, three friends, a professional team,
and a 200-person org each experience as *theirs* — without building four
products or hiding the good parts behind expertise.

### 18.1 Settle the doorway problem

FRONTEND-AUDIT.md is unambiguous and correct: the chat shell currently occupies
the position the run and receipt machinery should hold, and it renders **a nav
inside a nav** because `CortexShell` brings its own full-height sidebar.

- **One navigation, one shell.** Chat's navigation folds into the pane nav; the
  chat surface becomes a pane, not a frame.
- **The Plan Receipt is the primary object of the product**, not the transcript
  (Phase 10.3). Chat is a lens onto it.
- Delete the subscription-era copy the audit found live in the shell
  ("Subscribe to unlock full AI agent capabilities") — it contradicts the credit
  model and is exactly the kind of stale string that makes a product feel
  unmaintained.

### 18.2 The navigation model

Extend the existing six-pane skeleton (`components/mission/MissionControl.tsx`)
rather than replacing it. The panes, in the order a developer thinks about them:

| Pane | Question it answers | Present state |
|---|---|---|
| **Work** | What am I doing, and what needs me? | chat + task board + launcher, currently the whole app |
| **Plans** | What is proposed, what does it cost, what do I approve? | **absent** — the most important missing surface |
| **Runs** | What is executing right now? | real material (`RunPanel`, `OperationsGraphPanel`, `OperationsRoom`) |
| **Receipts** | What has been proven? | **absent** — the trust surface, and it is empty |
| **Ledger** | What have I spent, and on what? | five overlapping views, none reading the ledger |
| **Repos** | What is connected, and what can Cortex verify here? | scattered across integrations and project setup |
| **Bench** | Which professionals and policies apply? | absent (Phase 12) |
| **Admin** | Who can do what, and what are the limits? | split between `AdminView` and a 971-line settings modal |

Rules:

- **A pane is a place, with a URL.** Everything deep-links: a plan, a run, a
  step, a receipt, a ledger entry, a finding. Sharing a link into a conversation
  is how teams actually work, and it costs nothing if routing is designed for it.
- **No modal holds primary content.** Modals confirm and edit; they never hold a
  plan, a receipt, or a diff. The 971-line `SettingsPanel` modal is the current
  counter-example and should become the Admin pane.
- **Global search and a command palette** over every object type. The palette
  already exists — promote it to a primitive and wire it to everything.

### 18.3 Progressive disclosure, not four products

The same object graph, with defaults that differ by context. **Nothing is
hidden permanently; the difference is what is on screen by default.**

| | **Solo / new** | **2–3 collaborators** | **Professional team** | **200+ org** |
|---|---|---|---|---|
| Default pane | Work | Work | Plans | Plans |
| Visible by default | Work, Plans, Receipts, Ledger | + presence on plans | + Runs, Repos, Bench | + Admin, policies, org budgets |
| Effort control | One dial, simple labels | same | both dials, forecasts per position | both dials within org ceilings |
| Approval | Inline, one click | inline + conflict notice | Plan pane with review | policy-gated |
| Ledger view | "credits left, recent runs" | same | per-project | per-team, exportable, reconciliation |
| Coordination UI | none | inline notices | plan space | ownership routing |

The mechanism: **capability- and role-driven navigation**, not a "mode" the user
picks. A solo user without an org never sees org concepts. A user whose role
gains `admin` sees the Admin pane appear. This avoids the two classic failures —
a beginner drowning in enterprise chrome, and a professional hitting a ceiling
because the product decided they were a beginner.

**One rule that outranks the table: the receipt is never hidden from anyone.**
The trust artifact is the product; a "simple mode" that conceals it would be
hiding the thing that makes Cortex worth using.

### 18.4 Menus, keyboard, and density

The specific complaints that "menus and sizing feel off" have mechanical causes
and mechanical fixes:

- **One menu component** (`DropdownMenu`), one set of item shapes (label, icon,
  shortcut, description, destructive variant), one width scale. Today every menu
  is bespoke, which guarantees inconsistency.
- **A density setting** — comfortable and compact — driven by a token scale, not
  per-component overrides. Operational surfaces are tables, and professionals
  want more rows.
- **Keyboard-first navigation.** `⌘K` palette, `g` + letter for pane jumps,
  `j`/`k` in lists, `Enter` to open, `?` for the shortcut sheet. This audience
  navigates by keyboard and notices immediately when a product does not support
  it — and today `focus-visible` appears twice in the whole tree.
- **Every destructive action confirms with specificity.** "Cancel run 2b91 —
  3 steps complete, 14 credits spent, not refundable" beats "Are you sure?"

### 18.5 The first five minutes

Implements Phase 10.4. The repo scan already runs for the estimator (Phase 6.5),
so the welcome screen is nearly free: detected ecosystems, the checks Cortex found
and can run, measured suite duration, and — honestly — what it cannot verify here
yet. Then propose two or three real starter tasks with forecasts pre-filled,
rather than presenting a blank input box. **Optimise the whole flow for reaching
one completed receipt.**

## Phase 19 - The surfaces that carry the claims

**Goal:** specify the screens where this document's promises are kept or broken.
Each one is listed with what it must show, because in every case the failure mode
is showing something reassuring that the backend cannot support.

### 19.1 The Plan Receipt — the primary surface

The most important screen in the product and it does not exist yet.

Must show: objective and the `TaskFrame` it was understood as, with **confidence
visible**; the decomposition DAG with per-leaf checks, VERIFIED/UNVERIFIED
labels, and assigned professional with version; **both dials with a forecast for
every position** (Phase 6.6) and an editable cap; the achievable parallel width
and what limits it (Phase 11.2); capability grants requested; assumptions Cortex
made and which were mechanically verified (Phase 13.3); open questions requiring
an answer; and conflicts with other in-flight plans (Phase 14.4).

Must support: approve, revise (free, always), fork, and reject with a reason.

### 19.2 The run surface

Must show: live state per step with the truth vocabulary — `delivered`,
`verifying`, `verified`, `failed`, `inconclusive`, `blocked`, `attention` — never
collapsed into "running"; **live burn against forecast and cap**; why anything is
blocked, naming the lease holder or the pending approval; the DAG with what is
parallel and what is serialised; and streamed evidence.

Must support: pause, cancel, retry, raise cap, and answer a blocking question.
`OperationsGraphPanel` and `RunPanel` are real material here — rewire, do not
rewrite.

### 19.3 The receipt

The trust artifact, and today an empty pane. Must show: verdict with its
independence level; the exact tree hash, runner image digest, check argv, and
outputs; **forecast versus actual**; effort and speed actually applied (not
requested); catalog, professional, pack, and policy versions that ran; the rung
climbed for greenfield (Phase 8.5); and provenance for anything asserted.

Must support: a **shareable public read view** (RESEARCH-2026-08 rec 8) — a
receipt a developer can paste into a PR or a CFO into an audit is the viral unit
of the entire trust story.

### 19.4 The review bundle

Outcome summary, changed-file map, diff with the check matrix beside it, panel
findings grouped by professional **with each expert's record shown**, screenshots
for UI work, and the single next action. Findings that became executed checks are
visually distinct from advisory annotations — invariant 6, rendered.

### 19.5 The ledger — five surfaces become one

Consolidate `LedgerView`, `UsageView`, `SpendDashboard`, `billing/*`, and
`cost/*` into one pane reading `credit_transactions`. Must show balance, spend
over time, per-task attribution, forecast accuracy history (Phase 6.6), and the
quote → plan → run → verdict → charge chain for any entry. Export as the dispute
bundle from Phase 2.3.

### 19.6 Repos, bench, leases, admin

- **Repos:** what is connected, what Cortex can verify here, measured suite
  duration, declared hotspots (Phase 11.5), and per-repo policy.
- **Bench:** available professionals with versions and records, which are pinned,
  and which policies require them. Where an org authors its own.
- **Leases:** `ConflictViewer` is a real seed; give it semantic leases and the
  "why is this waiting" answer.
- **Admin:** roles, budgets and ceilings, provider allowlists, audit export,
  API keys and OAuth apps (Phase 17). One pane, replacing the settings modal.

### 19.7 The dial component

Specified once, used everywhere. Renders all five effort positions and all three
speed positions **with a per-position cost and time estimate for the current
task**, the inherited value and its source, an editable cap, and the calibration
line. Disabled positions show *why* — "your org caps effort at xhigh" — never
silently absent.

This component is the single most direct expression of the transparency
contract, and it is the one place where a shortcut would undo Phase 6 entirely.

## Phase 20 - Team economics: credits, budgets, and authority

**Goal:** make a 200-developer organisation's use of Cortex feel like cloud
infrastructure — funded centrally, governed by policy, attributed for
accounting — rather than like an expense-report workflow.

### 20.1 The intuitive answer is the wrong one

The obvious design is **per-developer credit allocation**: a lead tops up each
engineer's wallet. It should be rejected, and the reasons are worth recording
because it will be proposed again.

- **It blocks work at the worst moment.** An engineer runs out at 2am mid-incident
  and waits for a manager to wake up. Every per-seat wallet system produces this,
  and engineers remember it.
- **It creates hoarding and waste simultaneously.** Some wallets sit unused all
  quarter; others are exhausted in a week. The org buys for the peak of every
  individual instead of the peak of the aggregate.
- **It is permanent administrative overhead** — a top-up queue that never ends.
- **Nobody buys infrastructure this way.** AWS does not give each engineer a
  personal balance.

Equally, **per-developer purchase** is right for a solo builder and unworkable
above about three people: no central visibility, individual expensing, no volume
terms, and procurement will refuse it.

### 20.2 The model: one pool, governed by policy

> **An organisation funds one credit pool. Everyone draws from it. Control is
> exercised through limits and policy, never through partitioning the money.**

The load-bearing distinction, and the one that makes this work:

**A budget is a ceiling on consumption, not a reservation of funds.** Budgets may
sum to more than the pool, because they are limits rather than partitions. That
single property is what removes the blocked-at-2am failure while keeping real
control — nobody is stopped by an empty personal wallet, because there are no
personal wallets.

The layers:

| Layer | What it does | Scope |
|---|---|---|
| **Pool** | The org's credit balance | org |
| **Auto-recharge** | Threshold-triggered top-up, so work never stops on a payment step | org |
| **Budgets** | Soft alert + hard stop on consumption over a period | org / team / project / member |
| **Rate limits** | Spend per member per unit time — contains a runaway loop | member / key |
| **Effort ceilings** | Caps how expensive a single task may be (Phase 6.3) | org / team / project |
| **Per-run caps** | Bounds each individual run (Phase 6.4) | run |
| **Priority classes** | Who runs first when the pool is tight | task |
| **Attribution tags** | Team, project, cost centre — for internal chargeback | run |

Two consequences worth designing for explicitly:

- **Per-run caps make pool depletion predictable.** Because every run carries an
  enforced maximum, an org's worst-case burn over the next hour is computable
  rather than a surprise. That is a genuinely reassuring property to show an
  admin, and it falls out of Phase 6.4 for free.
- **Priority matters at scale.** When the pool is low, a production hotfix must
  outrank a speculative refactor. Priority classes with admin-defined defaults,
  and low-priority work queues rather than failing.

### 20.3 Depletion, refunds, and the boundary cases

- **When the pool empties: complete in-flight work, block new dispatch, alert
  loudly.** Killing running work destroys partial value *and* the money already
  spent on it — the worst of both. Alerts fire at forecast-based projections
  ("at current burn, ~3 days remain"), not only at zero.
- **Refunds return to the pool that paid**, never to an individual.
- **Personal and org contexts are explicit and visible.** A developer who belongs
  to an org must always be able to see which pool a run will draw from, and
  switching context is deliberate. Accidentally spending personal credits on
  employer work — or the reverse — is a bad surprise in both directions.
- **Departure is clean.** Deprovisioning (Phase 9.2) ends a member's access;
  their historical runs and receipts stay with the org, because the org paid for
  them and needs them for audit.

### 20.4 Four orthogonal controls — do not conflate them

Teams get confused, and products get confused, because these are usually mashed
into one "permissions" concept. Keep them separate:

| Control | Question | Defined in |
|---|---|---|
| **Role** | What may this *person* do? | Phase 9.2 RBAC |
| **Budget** | How much may they *spend*? | 20.2 |
| **Capability envelope** | What may the *agent* touch on their behalf? | Phase 3.2 |
| **Policy** | What must *happen* regardless of who asks? | Phase 12.12 |

A senior engineer with `admin` may still be subject to a mandatory crypto review;
a junior with a small budget may still hold `open_pr`. Conflating these produces
the two classic failures — a lead who cannot be restricted, and a junior who
cannot do their job.

**Spend authority is its own ladder**, separate from role: any member may approve
plans up to *X* credits; above *Y* requires a lead. This is how organisations
already handle purchasing, it is immediately legible to a finance team, and it
plugs directly into Phase 17.4's standing authorisation policies.

### 20.5 Packaging: do not charge per seat for access

A recommendation with a real adoption argument behind it.

The temptation is per-seat licensing plus credits. **Resist per-seat pricing for
access**, because it forces an org to decide *in advance* who gets to use Cortex —
and that rationing conversation is precisely what kills bottom-up adoption inside
large companies. The occasional user who tries it once a month is how a tool
spreads; a seat fee makes that user a line item someone has to justify.

Credits already meter usage. Seats would meter *permission to try*, which is the
wrong thing to meter.

Recommended shape:

- **Credits for the work** — the existing model, unchanged. Consumption scales
  with value delivered.
- **An organisation-level platform tier for governance** — SSO, SCIM, audit
  export, policies, org-authored professionals, self-host. Priced on the
  organisation, not per head. These are genuine engineering investments
  (Phases 9, 12.12, 15) and they are what enterprises expect to pay for
  separately.
- **Volume terms on credits**, and invoiced billing above a threshold, because
  procurement requires it.

This keeps the incentive clean: Cortex earns more when it does more useful work,
and never by taxing the act of trying it.

**Phase 20 exit gate:** a member never blocks on a personal balance; an admin can
see projected days-of-runway and per-team attribution; a runaway loop is contained
by rate limits without an admin intervening; pool depletion completes in-flight
work and blocks new dispatch with advance warning; a refund returns to the paying
pool; and a developer can always tell which pool a run will draw from before
approving it.

## Phase 21 - Craft: accessibility, performance, testing, and polish

**Goal:** the difference between software that works and software that feels
professional. These are the factors that are invisible when present and
unmistakable when absent.

### 21.1 Accessibility

Currently `focus-visible` appears twice in 25,485 lines. That is the whole story.

- **Every interactive element has a visible focus ring**, from the token already
  defined (`--focus-ring`). Non-negotiable, and it lands automatically once the
  primitive layer exists.
- **Full keyboard operability.** Every action reachable without a mouse; no
  keyboard traps; logical tab order; skip-to-content.
- **Correct semantics** — headless primitives (16.1) supply ARIA wiring, roles,
  and live regions rather than hand-rolled attributes.
- **Live regions for async state.** A run moving to `verified` must announce; a
  screen-reader user should not have to poll a page to learn a task finished.
- **Contrast meets WCAG 2.2 AA** in both themes — verify the token palette
  rather than assuming, particularly the muted greys on dark surfaces.
- **Respect `prefers-reduced-motion`.**
- **Automated axe checks in CI over the Storybook set**, so regressions fail a
  build rather than a user.

Two audience arguments, since accessibility is often deprioritised: this is the
keyboard-driven audience most likely to pay, and **accessibility conformance is a
procurement checklist item** for large orgs and public-sector buyers — a VPAT
request will arrive.

### 21.2 Performance

- **Budgets, enforced in CI**: initial JS ≤ 200 kB gzip, LCP < 2.0s, INP < 200ms,
  CLS < 0.1. The audit measured 72.6 kB gzip after its deletion pass — that is a
  good position to defend rather than rediscover later.
- **Route-level code splitting**, with heavy panes (DAG, diff viewer) lazy.
- **Virtualise every long list** — runs, ledger entries, findings, log lines.
- **Skeletons sized to content** so nothing shifts on load.
- **Stream long output**; never block a screen on a full log fetch.
- **Measure real users** via web-vitals into the existing Sentry integration.

### 21.3 Testing — from zero

There is no test infrastructure at all. Build it in this order, because the order
determines how much value arrives first:

1. **Vitest + Testing Library.** Unit tests for the primitive layer and for every
   pure function in `lib/` — the API client's error mapping, formatters, the
   dial's resolution logic.
2. **Truth-state component tests.** Every surface that renders a verdict,
   verification state, cost, or provenance gets a deterministic test per state.
   **This is the highest-value testing in the product**: the whole thesis is that
   Cortex tells the truth about state, and the frontend is where a regression
   would silently make it lie.
3. **MSW for API mocking**, so screens are testable without a backend — which
   also unblocks frontend work on a machine with no Rust build.
4. **Playwright end-to-end** on the critical path: connect repo → plan → approve
   → run → verifying → verified → receipt. Plus the failure path, because the
   failure path is the product's honesty claim.
5. **Visual regression** over Storybook (16.2).
6. **Accessibility assertions** in component tests, not only in the axe sweep.

Gate all of it in CI alongside lint and the bundle budget. The `cortex` CI job
currently runs `build` only.

### 21.4 Responsive and multi-device

- **Three real breakpoints**, designed rather than inherited: phone (review and
  approve), tablet, desktop (the operational surfaces).
- **Phone is not a shrunken dashboard.** It is the approve/monitor/notify
  surface — the asynchronous moments from Phase 10.2. Optimise for: read a plan,
  approve or decline, see burn, answer a blocking question, read a receipt.
- **Touch targets ≥ 44px**, and the existing `BottomSheet` is the right pattern
  for phone overlays.
- **The layout work here is what the future desktop and iOS clients inherit**, so
  keeping presentation in the primitive layer and logic in hooks pays twice.

### 21.5 Internationalisation and formatting

- **Externalise strings from the start** — retrofitting i18n across 87 files is
  significantly more expensive than adopting it now, and the enterprise buyers
  in Phase 9 are frequently multinational.
- **Locale-aware numbers, currency, and dates**; relative times that update.
- **Never concatenate translated fragments**; interpolate.
- Ensure the layout survives longer translations and RTL — the Storybook states
  in 16.2 include both.

### 21.6 Observability of the interface itself

- Sentry is already installed; add **release health, source maps, and user
  feedback on error boundaries**.
- **Structured product analytics on the scoreboard metrics** from the Phase 15
  scoreboard — time-to-first-approved-plan, plan revision count, abandonment,
  receipt open rate. These are product decisions, and today nothing measures them.
- **A client-side error must never be silent.** `ErrorBoundary` exists; make it
  report, offer recovery, and preserve unsaved input.

### 21.7 The polish pass

The things that separate professional from competent, each cheap once the
primitive layer exists: consistent empty states with a real next action; optimistic
UI with rollback on failure; undo for anything reversible; preserved scroll and
filter state across navigation; copy-to-clipboard on every identifier;
relative timestamps with absolute on hover; sensible tab titles and favicon
badging for attention-required states; a printable receipt; consistent number
formatting for credits everywhere; and no layout shift, anywhere, ever.

**Phase 21 exit gate:** the critical path passes an automated end-to-end test
including its failure branch; every truth state has a deterministic component
test; axe reports no violations across the Storybook set; the bundle budget gates
in CI; the app is fully keyboard-operable with visible focus; and the phone
layout supports read-plan → approve → read-receipt without a desktop.

## Phase 22 - The free editor tool: present daily, paid only when it matters

**Goal:** be in the developer's editor every day at near-zero marginal cost, and
make spending credits a deliberate choice the developer makes when the work is
genuinely worth it.

### 22.1 The problem this solves

A professional does not want to burn credits editing three lines. If the only way
to touch Cortex is to spend, the rational behaviour is to use it rarely — and a
tool that is not in the daily workflow never becomes the default. That is an
adoption problem, not a pricing problem, and it will not be fixed by cheaper
credits.

The founder's framing is exactly right and should be designed *for* rather than
fought: **"I'll code this one myself"** is the correct outcome most of the time.
Cortex should be the thing sitting next to that developer, useful for free, and
one keystroke away when the task is genuinely big.

### 22.2 What Cursor is, and why not to build one

- **VS Code** is Microsoft's editor, open source under MIT.
- **Cursor** is a *fork* of VS Code with AI built in. It is **not free to run** —
  its free tier is limited and subsidised, because every completion costs
  inference. Copilot, Windsurf, Cline, Continue, and Zed occupy the same ground.

**Do not fork an editor, and do not compete on autocomplete.** Three reasons:

1. A VS Code fork is a permanent rebase treadmill against upstream, for no
   strategic gain.
2. Inline completion is a latency-and-cache game won with tiny fast models. It is
   the *opposite* of Cortex's thesis, and Cortex has no advantage there.
3. VISION.md's rule applies directly: do not enter commodity ground. Autocomplete
   is the most commoditised surface in developer tooling.

**Ship an extension, not a fork.** An extension runs inside VS Code, Cursor, and
Windsurf alike — which means Cortex reaches Cursor's users instead of fighting
them, and pairs naturally with the MCP server in Phase 17.6. JetBrains follows if
demand justifies it.

The strategic position: **Cortex is complementary to whatever autocomplete a
developer already uses.** Fighting Copilot for completions is a losing battle;
being the verification and orchestration layer on top of everyone's completions
is a winning one.

### 22.3 What is free, and why it can be

The design constraint is honest: anything that calls a model costs Cortex money
per user. So the free tier is built from **local computation and data the
customer already owns** — and it happens that this is precisely where Cortex is
strongest.

| Free feature | Why it costs ~nothing | Why nobody else can ship it |
|---|---|---|
| **Verification overlay** — which files and lines are covered by a verified receipt, and when | Reading data already paid for | Requires owning an independent verifier and a receipt store |
| **Local check batteries** — run the Phase 8.4 L2 batteries against the working tree | They are *executable checks*, not inference. `semgrep`, `cargo-audit`, `axe` run locally at zero marginal cost to Cortex | The curated, versioned, outcome-graded battery is the asset |
| **Local estimate** — "this change would cost ~14 credits at `high`" | The estimator (Phase 6.5) is a fitted model, not a model call | Requires the outcome corpus |
| **Plan drafting** — compose and refine a plan, see its forecast, decide later | Drafting is local; only execution spends | Requires the Plan Receipt object |
| **Repo insight** — what Cortex can verify here, hotspots, suite duration, UNVERIFIED gaps | The repo scan is static analysis | — |
| **Team awareness** — "someone is planning a change to this file" (Phase 14) | It is data, not inference | Requires the shared plan space |
| **Receipt links in review** — jump from a line to the receipt that proved it | Data | Requires receipts to exist |

**The golden property: Cortex's differentiator is checks, and checks are free to
run locally.** So the free tool gives away the thing Cortex is best at, costs
almost nothing per user, and is structurally uncopyable by an autocomplete
vendor — because the batteries are curated, versioned, and graded by an execution
corpus none of them have.

### 22.4 The conversion path is the honest one

The free extension finds a real problem and says what fixing it would cost:

> `crates/api/src/db.rs:8151` — lease conflict fails run creation instead of
> queueing. **Fix it yourself**, or **hand it to Cortex** — est. 11–18 credits at
> `high`, ~7 min. [Draft plan]

The developer fixes the easy ones themselves. That is the *correct* outcome and
the product should say so rather than nudge. When something is genuinely hard,
tedious, or needs to be provably right, the plan is already drafted and the cost
already known — one keystroke from work already in progress.

This inverts the usual funnel. Instead of persuading someone to move their
workflow into a new product, Cortex earns a place in the existing one and gets
paid only when it does something the developer did not want to do by hand.

### 22.5 Boundaries, so this does not become a second product

- **No inline completion. No chat-with-your-codebase.** Both are commodity, both
  cost inference per keystroke, and both are already well served.
- **No BYOK.** VISION.md is explicit, and a BYOK path in the extension would
  quietly re-open exactly the model the credit product replaced.
- **The extension is a thin client over the Phase 17 API.** No business logic, so
  it cannot drift — same rule as the CLI and the web app.
- **Free tier abuse controls apply** (Phase 15.4): anything that eventually does
  call a model needs rate limits and identity from day one.
- **Local check execution runs on the developer's machine, in their trust
  boundary** — it is not the verification sandbox and its results are *not*
  receipts. Keep the distinction visible: local checks are advice, receipts are
  proof. Blurring that would undermine the entire trust vocabulary.

### 22.6 Is there a Cursor API to build on? Two channels, neither needing Cursor

**There is no public Cursor extension API.** Cursor's AI internals — its agent,
tab completion, and chat — are closed, and it exposes no third-party hooks into
them. But two channels are open, and together they are better than a private API
would be:

**(a) The VS Code extension API.** Cursor is a *fork* of VS Code and runs VS Code
extensions unchanged. One extension therefore reaches VS Code, Cursor, and
Windsurf. Publish to **Open VSX** as well as the Microsoft Marketplace — Cursor
and Windsurf cannot use the Microsoft Marketplace for licensing reasons, and Open
VSX is how they get extensions. Skipping Open VSX would silently cut off exactly
the audience most likely to want Cortex.

**(b) MCP.** Cursor supports MCP servers, as do Claude Code and Codex. The Phase
17.6 MCP server therefore makes Cortex callable *from inside Cursor's own agent*
— a developer can have Cursor write the code and Cortex independently verify it,
with a receipt.

**Why not go deeper even if a private API existed.** It would be a dependency on
a competitor for mindshare, revocable at their convenience — which is precisely
the exposure that ended the provider-subscription path this repository already
had to remove. MCP is vendor-neutral, standardised, and cannot be withdrawn by
any single vendor. Prefer it on principle, not just convenience.

The resulting posture is worth stating plainly: **Cortex does not compete with
Cursor for the editor; it sells Cursor's users the verification Cursor cannot
provide.** Two integration channels, both open, neither requiring anyone's
cooperation.

Also cheap and worth doing: read `.cursor/rules` and `AGENTS.md` as first-class
context sources (Phase 3.4). A team that has already written their conventions
down should not have to write them again for Cortex.

### 22.7 What this makes possible later

Once the extension exists as a thin API client, the desktop app (Phase 10) is
largely the same client in a different shell, and the MCP server (Phase 17.6)
serves the same data to other harnesses. **Three surfaces, one API, one set of
objects** — which is the whole argument for the API-first rule paying off rather
than being an aspiration.

**Phase 22 exit gate:** the extension installs in VS Code and Cursor; a developer
with no credits gets genuine daily value from the verification overlay, local
batteries, and repo insight; a local check result is visually distinct from a
receipt; drafting a plan and seeing its forecast costs nothing; and handing a
drafted plan to Cortex is one action from the editor.

## Phase 23 - Launch operations: everything else a real product needs

**Goal:** close the remaining non-feature gaps. None of these is interesting
engineering; every one of them is the reason a technically excellent product
fails to become a business.

### 23.1 Documentation

A developer product with no documentation does not get adopted, and Cortex has
several genuinely novel concepts (receipts, the two dials, caps, professionals)
that nobody arrives already understanding.

- **API reference generated from the schema**, not hand-written — hand-written
  references drift and then actively mislead. Phase 16.4 already proposes an
  OpenAPI schema; generate the docs and the client from the same source.
- **Concept guides** for the ideas that are not self-explanatory: what a receipt
  proves and what it does not, how effort and speed differ, how caps and
  forecasts work, what UNVERIFIED means.
- **Quickstarts per surface**: web, CLI, CI, MCP, extension.
- **A worked example of every failure mode**, because the honest handling of
  failure *is* the product and hiding it in docs undercuts the pitch.
- Docs live in the repo, review in the same PR as the change, and **a PR that
  changes an API contract without touching docs fails CI.**

### 23.2 Support, disputes, and the feedback loop

- **Every receipt has a "this looks wrong" action** that opens a dispute with
  the receipt, run, and ledger entry attached. Phase 2.3's reconciliation bundle
  is the payload. This is the trust product's single most important support path
  and it should take one click.
- **A dispute is a first-class object** with a state machine and an SLA, not an
  email thread — an ad-hoc process is where a verified-outcome promise quietly
  becomes discretionary.
- **Feedback on findings and plans routes to the right artifact**: a bad finding
  is a signal about a professional (org-scoped, per Phase 12.5); a bad plan is a
  signal about intake.
- **In-product changelog**, because a product that changes weekly and never says
  so feels unstable even when it is not.

### 23.3 Status, incidents, and reliability commitments

- **A public status page** covering API, scheduler, verifier, and per-provider
  availability. A paid developer product without one is not taken seriously.
- **Incident communication that names what was affected** — "verification was
  delayed, no charges were incorrect" is a very different message from silence,
  and Cortex can be specific because the ledger is append-only and reconcilable.
- **An SLA for the paid tier** — availability and, more importantly for this
  product, a *verification latency* target. That is the number customers will
  actually feel.
- **Backup, restore drills, and DR** are already required by Phase 4.1; make the
  restore drill a scheduled recurring exercise with a recorded result, not a
  documented intention.
- **Runbooks with an on-call owner** for the alert set defined in Phase 4.1.

### 23.4 API versioning and deprecation

Once a CLI, an extension, an MCP server, and third-party OAuth apps exist,
**the API contract is load-bearing and cannot be changed casually.**

- **Version the API explicitly** and support at least one previous version.
- **Additive changes only within a version.** Removing a field or tightening a
  type is a new version — this document's own `device_code` removal is a small
  example of the class.
- **Deprecation policy with a published window**, deprecation headers on
  responses, and telemetry showing who is still calling the old path so the
  window is evidence-based.
- **Clients declare their version**, and the server can refuse a client too old
  to be safe — particularly for anything touching capability grants or spend.

### 23.5 Commercial and legal

- **Self-serve purchase and auto-recharge** on the existing Stripe integration
  (`crates/api/src/stripe_client.rs`), plus invoiced billing above a threshold
  because procurement requires it.
- **Terms of service, an acceptable-use policy, a privacy policy, and a DPA**
  (with SCCs for EU customers). The DPA gets asked for in the first enterprise
  call, and not having one stalls a deal for weeks.
- **A sub-processor list**, kept current — customers with their own compliance
  obligations need to know which model providers see their code, and Phase 9.4's
  data-handling statement is where it lives.
- **A security contact and a vulnerability disclosure policy.** Cortex executes
  untrusted code for a living; researchers will find things, and the good outcome
  is that they have somewhere to report them.
- **SOC 2 Type II** when enterprise deals justify the cost. Start collecting
  evidence early — the audit period is retrospective, so the cheapest time to
  begin is before anyone asks.

### 23.6 The provider-dependency risk register

This organisation has already been burned once by a provider terms change, which
makes this concrete rather than theoretical.

- **Maintain a written register** of what Cortex depends on per provider —
  account type, terms, rate limits, data-retention posture — with a named
  review cadence.
- **Terms changes are a monitored event.** The subscription-credential removal
  in this repository is the worked example of what happens when one lands.
- **The model catalog (Phase 7.1) is the mitigation**: because no model name is
  hardcoded and routing optimises cost-to-verified-outcome, losing or repricing
  any single provider is a catalog update rather than a code change. This is a
  real strategic benefit of Phase 7.1 beyond tidiness, and it is worth stating
  where the decision gets made.
- **Never build on a provider surface that is private, undocumented, or
  revocable at the vendor's convenience** — the same reasoning that chooses MCP
  over a private editor API in Phase 22.6.

### 23.7 Go-live checklist

Beyond the seven external-testing gates, general availability additionally
requires: documented and versioned API; status page live; disputes routed and
answerable; ToS, privacy policy, and DPA published; sub-processor list current;
security contact and disclosure policy live; backup restore drill passed with a
recorded result; on-call rota and runbooks in place; billing reconciliation
alerting green for a sustained period; and the scoreboard from this document
populated with real data rather than zeroes.

## Phase 24 - Verification at the edges

**Goal:** close the five gaps that attack the verification thesis directly.
Everything else in this document assumes checks are meaningful, reproducible, and
binary. In real repositories none of those three is reliably true, and the plan
has not said so until now.

### 24.1 Flaky tests — the most dangerous unaddressed threat in this plan

**This is the single largest hole found in the whole review.** Cortex's entire
model rests on "the checks passed" meaning something. Real test suites are
flaky. Under the current design, a flaky failure produces:

- a **wrongly refunded task** — Cortex pays for the work and collects nothing;
- a **poisoned router**, because the route is punished for a defect it did not
  cause (Phase 7.2);
- a **wrong professional record**, because a "miss" is attributed to a pack that
  was correct (Phase 12.5); and
- a **customer who watches Cortex fail on a task that actually worked**, which is
  worse for trust than an honest failure.

Flakiness does not just add noise; it corrupts every learning signal in the
system simultaneously. It must be treated as first-class infrastructure.

**Cortex can detect flakiness better than any CI system, and this is a real
structural advantage.** The industry rule of thumb is "a test that flips outcome
without a code change" — but ordinary CI can only approximate "without a code
change." Cortex holds an **immutable tree hash** for every verification and can
re-execute *byte-identical* inputs on demand. Same tree, same image digest, same
argv, different result is not an approximation of flakiness; it is proof of it.

Design:

- **Flake identity is `(check, tree_hash, runner_digest)`.** A differing outcome
  across executions of that triple is definitionally flaky.
- **Confirm before concluding.** On a failing check that would fail a paid task,
  re-run it a bounded number of times against the same tree. Consistent failure
  is a real defect. Inconsistent outcome quarantines the check.
- **Quarantine is non-blocking, not deletion.** A quarantined check still runs
  and still reports, but does not gate the verdict or the ledger — the standard
  industry pattern, and the receipt must say plainly which checks were
  quarantined and why. A silent quarantine would be a lie of omission on the
  central trust artifact.
- **Maintain a flakiness score per check with a trailing window** (90 days is the
  conventional horizon), visible in the Repos pane. This is genuinely valuable
  free intelligence for the customer about their own suite.
- **Quarantined outcomes are excluded from every learning signal** — router
  reward, professional record, forecast calibration. Feeding them in is how the
  corruption above happens.
- **Flake rate per repo is an input to the forecast** (Phase 6.5), because a
  flaky suite genuinely costs more in re-runs.
- **Report it to the customer.** "Your suite has 14 flaky tests costing an
  estimated 6% of verification time" is a report nobody else produces, and it is
  a natural first paid task: *fix them*.

**Acceptance tests:** an injected non-deterministic test is quarantined rather
than failing a paid task; a genuinely broken test fails consistently across
re-runs and does fail the task; quarantined outcomes never reach the router or a
professional record; the receipt names quarantined checks.

### 24.2 Brownfield — the wedge is weakest exactly where the money is

An uncomfortable truth this plan has been avoiding: **Cortex verifies by running
your tests, and the enterprise codebases with the biggest budgets are the ones
with the fewest tests.** A fifteen-year-old service with 4% coverage is precisely
the customer who most needs help and least fits the model. Phase 8.5 solved
greenfield; brownfield is the mirror problem and is commercially larger.

The established answer is **characterization testing** (golden-master testing):
capture what the code *currently does* before deciding what it *should* do, and
use that as the safety net. The published framing is exact — characterization
tests pin existing behaviour and are the on-ramp that makes untested code safe to
hand to an agent. Tooling in this space reports substantial coverage gains over a
developer working with a general coding agent.

This maps onto Cortex better than onto anyone else, because Cortex already has
the execution sandbox, the check-freezing machinery, and the receipt:

- **Characterization generation is its own task class**, priced and sold
  separately: *"establish a safety net on this module."* It is verifiable by
  construction — a characterization test that does not pass against current
  behaviour is wrong, so the deliverable grades itself.
- **It is the natural first task for any brownfield repo**, and it converts an
  unverifiable repo into a verifiable one — the same "minimise the unverified
  prefix" move as Phase 8.5, applied to legacy code instead of new code.
- **Coverage of the change's blast radius is the gate**, not global coverage.
  Cortex needs a net under *what it is about to touch*, which is a far cheaper
  and more achievable target than repo-wide coverage.
- **Label the receipt honestly.** "Verified against characterization tests
  capturing pre-existing behaviour" is a true and useful claim, and materially
  different from "verified against the team's intended behaviour." A
  characterization test pins bugs as faithfully as features — that is the point,
  and it must not be oversold.
- **Guard the known weakness**: generated tests can be syntactically valid and
  semantically shallow. Require assertions on observable behaviour, reject tests
  that assert nothing, and prefer property and metamorphic variants (RESEARCH
  rec 2) over recorded literals where the domain allows it.

**This also fixes the UNVERIFIED-rate problem at its root.** Rather than
narrowing the refund promise to repos that happen to be well-tested, Cortex sells
the step that makes a repo qualify. That is a better business than declining the
customer.

### 24.3 Partial delivery — real work is not binary

The state model is `verified` or `failed`. Real engineering finishes seven of
nine steps and gets blocked on the eighth. Under the current design that run is
a failure: refunded, discarded, and the completed work thrown away — which is
simultaneously bad for the customer (their good work vanished) and bad for Cortex
(it paid for all nine).

- **A run has per-leaf outcomes, and the DAG already expresses this.** Steps that
  verified are verified; the receipt reports the frontier reached.
- **Deliver what passed.** Verified leaves land on a branch with their receipts;
  the blocked frontier is stated explicitly with what it needs.
- **Bill what was delivered**, at the per-leaf granularity the Plan Receipt
  already quotes. Refunding the whole run for a partial block is as wrong as
  charging for it.
- **A blocked frontier is a resumption point, not a dead end.** Answer the
  question or widen the scope and the run continues from the frontier with fresh
  context — never by continuing a failed worker's transcript.
- **`attention` is a real terminal-ish state with an owner and an age.** Runs
  that sit in it are a queue somebody must work, and it must appear on the
  operator dashboard or it will silently accumulate.

This is also the honest answer to the greenfield one-shot: a large build that
gets 80% of the way with receipts for each landed piece is a *good outcome* and
should be presented and billed as one.

### 24.4 Receipts have a shelf life — say so

A receipt claims reproducibility: this tree, this image digest, these checks,
this result. Three forces erode that over time, and none is currently
acknowledged.

- **Models get deprecated.** A receipt naming `gpt-5.4` becomes
  unreproducible when that model is retired — and the catalog (Phase 7.1) makes
  this visible rather than silent, which is the point of recording
  `catalog_version`. Note that this affects *reproducing the generation*, not
  *re-checking the result*: the checks still run, which is precisely why
  execution-based verification ages better than any log of model output.
- **Runner images rot.** A pinned digest may be garbage-collected from a
  registry. Retention policy for runner images must be at least as long as the
  receipt-verifiability promise, and that promise must be stated.
- **Checks are time-dependent.** Tests that depend on the date, timezone, locale,
  a TLS certificate, or an expiring token will pass in March and fail in
  September against an identical tree. Freeze what can be frozen — `TZ`, locale,
  `SOURCE_DATE_EPOCH` — and flag checks that vary with wall-clock time as
  non-reproducible in the receipt.

**State the guarantee precisely rather than implying eternity:** a receipt is
*re-executable* for a defined retention window, and *readable as evidence*
forever. Those are different promises and conflating them would be the kind of
overclaim the rest of this document exists to prevent.

### 24.5 Verification that needs the outside world

Many real suites need a database, a message broker, a mock third-party API, or
fixture data. Phase 0.1's default-deny network is correct for the *agent* and
insufficient for the *verifier* as specified.

- **Service dependencies are declared in the Plan Receipt**, provisioned as
  ephemeral sidecars in the verification sandbox — the established
  test-container pattern — and named in the receipt.
- **Sidecars are pinned by digest** like the runner, or the receipt is not
  reproducible.
- **Still default-deny to the public internet.** A declared Postgres sidecar is
  not an excuse for general egress.
- **Third-party APIs are recorded or virtualised, never called live.** A live
  call makes the check non-reproducible, bills someone, and can mutate real data.
- **Provisioning failure is `inconclusive`, never `failed`.** Infrastructure
  problems must never look like the customer's code being wrong — that
  distinction is load-bearing for the refund promise.

**Phase 24 exit gate:** a flaky check cannot fail a paid task or reach a learning
signal; a repo with no tests can be brought to verifiability as a priced task; a
partially completed run delivers and bills its verified leaves; a receipt states
its re-execution window and flags non-reproducible checks; and a suite requiring
a database verifies inside the sandbox with the sidecar pinned and named.

## Phase 25 - Scope: repositories, runtimes, and deliverables

**Goal:** name the shapes of work the plan currently assumes away, and say for
each whether Cortex supports it, defers it, or declines it. An unstated boundary
becomes an overpromise the first time a customer walks into it.

### 25.1 Changes that span repositories

Everything so far assumes one repository per task. A change touching three
services is normal in any organisation past about thirty engineers.

- **Model it as one Plan Receipt with per-repository subtrees**, each with its own
  base commit, leases, checks, and branch. One priced, approvable unit; several
  delivery targets.
- **Integration is ordered and cross-repo aware** (Phase 11.4): a contract change
  lands before its consumers, and the DAG encodes that rather than leaving it to
  luck.
- **Cross-repo verification is the hard part and must be honest.** A service
  whose contract changed cannot be fully verified against a consumer that has not
  merged. Where a consumer's suite can be run against the producer's branch, do
  it and say so; where it cannot, the receipt states which side is verified and
  which is asserted. **Do not claim a system-level verdict from component-level
  checks.**
- **Atomicity is not offered.** Cortex cannot make three PRs merge atomically —
  neither can anyone — so it delivers a *coordinated* change set with an explicit
  merge order and clearly labelled risk, rather than pretending otherwise.

### 25.2 Monorepos, and using the build graph instead of guessing

A monorepo breaks two assumptions at once: the repo scan is expensive, and
"run the test suite" is meaningless when the suite is four hours.

The right answer is already sitting in these repositories and Cortex should use
it: **modern monorepos have a build system that computes affected targets.**
Bazel, Nx, Turborepo, Pants, and Gradle all answer "given this diff, what must
be rebuilt and retested."

- **Derive checks from the build graph** rather than from path heuristics. This
  is strictly better than Cortex's own inference: it is the repo's own ground
  truth about impact, maintained by the team, and it is exactly the input
  `derive_step_check_specs` should prefer when available.
- **It also sharpens Phase 11.2's conflict-freedom.** The build graph gives a
  real dependency structure for partitioning parallel work, replacing path-prefix
  overlap with actual target dependencies.
- **And it fixes the forecast.** Verification cost `c_v` in a monorepo is a
  function of the affected target set, not a repo-wide constant — so the
  estimator must take affected-target count as a feature or its monorepo
  forecasts will be badly wrong in both directions.
- **Cache aggressively and legitimately.** These build systems have remote
  caches; a verification sandbox that participates in one (read-only, with the
  cache key recorded on the receipt) turns a four-hour suite into minutes.
  Reproducibility is preserved because the cache key is content-addressed.
- **Sparse and shallow checkout** for repositories where a full clone is
  prohibitive; record what was checked out on the receipt.

Monorepo support done this way is a genuine enterprise differentiator, because
it is where generic "run the tests" agents fall over hardest.

### 25.3 Long-running and stateful work

Some real tasks do not fit a single sandboxed execution: a database migration
rehearsal, a load test, a multi-hour build, a data backfill.

- **Support long-running verification explicitly** — heartbeats, checkpointing,
  and a wall-clock budget that is a task-class property rather than a global
  constant. Phase 1's durable job machinery already provides the recovery
  semantics; the gap is only that the current budgets assume short work.
- **Migrations are their own task class** with a rehearsal shape: apply against a
  restored snapshot, verify, and **verify the rollback too**. A migration whose
  down-path is untested is not verified in any sense a customer cares about.
- **Declare state that must persist across steps** and treat it as an explicit
  resource with a lease and a teardown, never as sandbox residue. Invariant 1's
  "no reuse of writable state between tenants" is not weakened — the state is
  named, scoped, and destroyed.
- **Decline what genuinely does not fit**, at plan time, with a reason. A task
  requiring a week-long soak test is not a Cortex task, and saying so at intake
  is far better than discovering it at the cap.

### 25.4 Non-code deliverables

Check derivation is written for application code. Several common deliverables
behave differently, and each needs its verification shape named:

| Deliverable | What verification means | Verdict |
|---|---|---|
| **Infrastructure as code** | `plan`/`validate`, policy checks (OPA/Conftest), drift detection, and — critically — **never `apply`** without explicit deploy authority | **Support.** Terraform and friends verify well; this is a strong fit |
| **Database schema changes** | Migration applies to a snapshot, rolls back, and the resulting schema matches expectation | **Support**, as 25.3's migration class |
| **Documentation** | Links resolve, code samples compile and run, examples match current APIs | **Support**, and it is genuinely useful — stale docs are a real defect class with mechanical checks |
| **Configuration and manifests** | Schema validation, policy checks, dry-run against a cluster | **Support** |
| **Notebooks** | Execute top-to-bottom cleanly, outputs deterministic where seeded | **Support with caveats** — flag non-determinism per 24.4 |
| **Prose, design docs, product copy** | No executable ground truth exists | **Decline as a verified class.** Cortex may draft them, labelled UNVERIFIED, and must not price them as verified work |

The general rule, and it is a good one to state publicly: **Cortex verifies what
can be executed. Where nothing can be executed, it says UNVERIFIED and does not
charge as though it had proven something.** That is a limitation stated as a
principle, which is far stronger than a limitation discovered by a customer.

### 25.5 Platforms Cortex cannot verify today

The runner is a Linux container. That is correct for the large majority of
server, web, and backend work, and it excludes real customers.

- **iOS and macOS builds require Apple hardware and toolchains.** No Linux
  container verifies an iOS app. This directly affects Phase 6.3's own worked
  example — "the security of that iOS app" — where Cortex can today run static
  analysis, dependency audit, and secret scanning, but cannot build, run, or
  test the app. **Say that explicitly rather than implying full coverage.**
- **Windows and .NET desktop targets** need Windows runners.
- **Embedded, mobile-device, and GPU workloads** need hardware Cortex does not
  have.

The honest posture: **support Linux-container-verifiable work fully, and for
everything else verify the subset that is verifiable and label the remainder
UNVERIFIED.** Partial verification, clearly scoped, is genuinely valuable — the
failure would be claiming a verdict the runner could not produce.

Expansion order, if demand justifies it: Windows runners (mechanically
straightforward), then macOS/iOS via hosted Apple hardware (expensive, licence-
constrained, and only worth it for a named customer). Both are runner-fleet work,
not architecture work, because `ExecutionJob` already abstracts the runner —
which is a further reason to get that interface right in PR C.

## Phase 26 - Strategic position and operational completeness

**Goal:** the remaining items that are neither features nor infrastructure —
where Cortex sits when the market moves, and the operational behaviours a real
service needs that nothing else in this document has claimed.

### 26.1 What happens when a major vendor ships receipts

Assume it happens, because the idea is not secret and the plan is public the
moment a customer sees a receipt.

**What is copyable:** running checks in a sandbox and attaching output to a PR.
GitHub, OpenAI, or Anthropic could ship that in a quarter. Treat the *mechanism*
as commoditisable and do not build the brand on it.

**What is not copyable quickly:**

- **The outcome corpus.** Years of (task, plan, route, effort, cost, executed
  verdict) tuples. A competitor starts at zero on the day they ship.
- **The economic model.** Refund-on-failure and outcome pricing are *hostile to
  the incumbent business model* — a vendor selling tokens or seats cannot easily
  offer "we don't charge when it fails" without cannibalising their meter. This
  is the strongest structural moat in the plan and it is worth being explicit
  that it is a *business-model* moat, not a technical one.
- **The method library and professional bench**, graded by execution.
- **Org-authored professionals and policies** (Phase 12.12), which are built from
  the customer's own history and cannot be exported.

**The strategic response, decided in advance so it is not improvised:**

1. **Do not compete on "we also have receipts."** Compete on *what the receipt is
   worth* — refunds, forecasts, and a router trained on verdicts.
2. **Interoperate rather than duplicate.** The MCP server (Phase 17.6) means a
   vendor's agent writing the code and Cortex verifying it is a *good* outcome
   for Cortex. Being the verification layer for other people's agents is a
   stronger long-run position than being one more agent.
3. **Publish the format.** A receipt that other tools can read and render — and
   that a third party can independently replay — makes it a standard rather than
   a feature. Standards outlive features.
4. **Accelerate the compounding assets** (corpus, library, bench) over surface
   features, since those are the ones a well-funded competitor cannot shortcut.

### 26.2 Receipts as compliance evidence — the upsell nobody is building

An opportunity hiding inside work already planned, and worth naming so it is not
missed.

Regulated organisations must demonstrate, per change, that it was reviewed,
tested, authorised, and traceable. Today they assemble that evidence by hand from
Jira, GitHub, and CI logs — expensive, error-prone, and universally disliked.

**A Cortex receipt already contains almost exactly what an auditor asks for:**
what changed, what was checked, what the result was, which policy applied, who
approved it, under what authority, and an immutable tree hash tying it together.
The append-only ledger supplies the rest.

- Add a **compliance export** — evidence bundles per change or per period, mapped
  to common control frameworks (change management, segregation of duties, testing
  evidence).
- **Phase 12.12's mandatory review policies are the control implementation**, and
  the waiver log is the exception register. That is a direct answer to a control
  objective, not an analogy.
- This is a **high-margin enterprise upsell that requires almost no new
  engineering** — it is a projection over data Phases 1, 2, 9, and 12 already
  produce, and it makes the governance platform tier (Phase 20.5) obviously worth
  paying for.
- **Caveat honestly:** Cortex produces *evidence*, not *compliance*. It does not
  certify anything, and the export should say so.

### 26.3 Rollback: what happens when verified work turns out wrong

Verification proves the checks passed, not that the change was right. Production
will eventually disagree, and the plan currently has nothing to say about it.

- **Revert is a first-class task class** — cheap, fast, high-priority, and
  verifiable by construction (the reverted tree must pass the checks the original
  tree passed).
- **The receipt makes revert precise.** Exact commits, exact blast radius, exact
  dependent steps — Cortex can identify what to revert far more reliably than a
  human reading a merge history under incident pressure.
- **A revert after a verified delivery is a strong learning signal** and should
  feed Phase 12.5's "missed" category: the checks passed and the change was still
  wrong, which is precisely the gap between proxy and intent that
  RESEARCH-2026-08 §3 warns about. It is the most valuable negative signal
  available and nothing currently captures it.
- **Do not auto-revert.** Detecting that production is unhappy is not Cortex's
  competence, and an autonomous revert during an incident is how a bad night
  becomes a worse one.

### 26.4 Asking a question mid-run

Phase 8.2 covers clarification at plan time and Phase 24.3 covers a blocked
frontier. Neither covers the ordinary case of an agent discovering something
mid-execution that changes the answer — an undocumented dependency, a second
caller, a design decision that was not visible from outside.

- **`awaiting_input` is a real, first-class run state** with the question, the
  context that prompted it, the options, and the cost of waiting.
- **The clock and the budget pause.** A customer must never pay for an agent
  idling on a question.
- **Questions route to a human through every surface** — web, CLI, webhook,
  mobile push. This is the asynchronous moment that Phase 10.2 identifies as the
  real reason to build mobile.
- **A timeout policy per task class**: proceed on a stated default assumption
  (recorded as an `Assumption` per Phase 13.3), or park in `attention`. Never
  guess silently.
- **Bound it.** An agent that asks five questions on one leaf has an intake or
  context problem, and the metric should surface that rather than the interface
  absorbing it.

### 26.5 Detecting pathological agent behaviour

Agents fail in shapes that are neither success nor clean failure, and burning a
cap while thrashing is the worst outcome for both parties.

- **Detect loops and thrashing**: repeated identical edits, oscillating between
  two states, re-running the same failing check without changing anything,
  repeatedly editing a file it already reverted.
- **Detect no-progress**: budget consumed with no diff, or a diff that does not
  move any check from fail to pass.
- **Detect scope drift**: writes wandering outside the declared blast radius —
  which is already a lease violation (Phase 11.3) and should be caught there
  first, but a soft signal earlier is cheaper.
- **Respond with a bounded ladder**: nudge, then fresh-context retry with the
  evidence, then stop and report. **Never let a cap be consumed by a loop** — a
  task that hits its cap while thrashing should surface as thrashing, not as
  "needs a bigger budget," because raising the cap is exactly the wrong response.
- These signals are cheap, they are strong quality metrics per route and per
  professional, and they belong in the outcome corpus.

### 26.6 Working with the gates a team already has

Cortex is not the only quality system in a real repository, and behaving as if it
were is a fast way to be rejected by a platform team.

- **Run and respect the repo's existing CI**, linters, formatters, commit
  conventions, and review bots. A Cortex change that a team's own pipeline
  rejects is a failed change regardless of Cortex's verdict.
- **Their required checks are Cortex's required checks.** Branch-protection rules
  are a first-class input to check derivation — the team has already declared
  what "done" means, and Cortex should read it rather than infer it.
- **Report as a check run**, so a Cortex verdict appears natively where the team
  already looks, alongside everything else.
- **Never bypass a protection rule**, and never push directly to a protected
  branch, regardless of authority granted elsewhere. If Cortex holds credentials
  that could bypass, the fact that it *doesn't* is a trust statement worth making
  explicitly.
- **Respect `CODEOWNERS`** for review routing (Phase 14.5), and honour the team's
  existing instruction files — `AGENTS.md`, `.cursor/rules`, and equivalents —
  as first-class context.

**Phase 26 exit gate:** a competitive-response position is written down before it
is needed; a compliance evidence bundle exports from existing receipt and ledger
data; revert exists as a task class and a post-delivery revert registers as a
missed signal; a mid-run question pauses the budget and reaches a human on every
surface; a thrashing agent is stopped and reported as thrashing rather than as
needing a larger cap; and a Cortex change passes the repository's own CI and
protection rules without bypassing any of them.

## Phase 27 - Verification under adversarial pressure

**Goal:** establish that the verdict means something. Twenty-three invariants,
twenty-six phases, a ledger, a refund policy, a router, and a professional system
all consume a verdict whose soundness this document has never once examined.

This is the deepest gap found in four rounds of review. Phase 24.1 addressed
checks that are *noisy* — a flaky check is wrong at random. This phase addresses
checks that are *fooled* — wrong in the specific direction that optimisation
pressure pushes. Noise averages out. Bias compounds, and every mechanism in
Track B applies pressure in the same direction.

### 27.1 The exam is written on the answer sheet

The V3 design already understood half of this problem, and the code says so:

> `crates/api/src/verification_driver.rs:11-12` — *"Load the specs frozen at
> dispatch. Deriving them now would let the task influence its own exam."*

That freezes the **argv**. It does not freeze what the argv reads. A check spec
of `cargo test --all` frozen at dispatch executes against the tree the agent
delivered, and that tree contains the agent's edits to `tests/`. The detached
checkout in `TreeCheckout::create` (`:75-97`) is a clean checkout *of the
delivered commit* — which is exactly the commit whose test files the agent
controls. Cleanliness of the checkout was never the exposure.

Confirmed absent in this checkout: no path classification, no test-surface diff,
no assertion-count comparison, and no protected-path concept anywhere in
`verification_driver.rs`, `check_runner.rs`, `core/src/verification.rs`, or
`core/src/check_derivation.rs`. The word `tamper` does not appear in the plan.

This is not a hypothetical failure mode. It is the most heavily documented
failure mode in the 2026 agent literature, with named mechanisms: overwriting
unit tests, deleting or weakening assertions, monkey-patching the scoring
function, marking tests skipped or expected-failure, and terminating the process
early with a success code. TRACE catalogues 54 distinct hack categories and
finds a frontier model detects only 63% of them by inspection; Terminal Wrench
catalogues 331 hackable tasks. The uncomfortable result from EvilGenie is that a
**held-out** test battery — which Phase 6.7 already buys at `ultra` — was *not*
the best detector; an inspecting judge was. Held-out checks defend against
overfitting to the visible contract. They do not defend against an agent that
edits the harness the held-out checks run in.

The framing that should govern this phase: **Cortex does not train models, but
Cortex is an optimiser.** Best-of-N racing, the escalation ladder, the router's
reward, and the professional grading loop all select for outcomes that pass the
battery. Selection against a fixed target is the same pressure as training
against it, applied at inference time, and the literature's central conclusion
holds either way — no fixed reward function survives a capability increase in
the thing being selected. Verification has to co-evolve with what it grades.

### 27.2 Type the diff: the exam is a first-class surface

Partition every delivered diff at verification time into three surfaces:

| Surface | Contents | Why it is separate |
|---|---|---|
| `subject` | Production code the contract asked to change | The thing being graded |
| `exam` | Anything a frozen check reads as ground truth: test files, fixtures, golden/snapshot files, property generators, CI workflow, lint and typecheck config, coverage thresholds, build scripts, test harness code | Changing it changes the grade |
| `incidental` | Lockfiles, generated code, docs, formatting | Neither graded nor grading |

Classification is deterministic — path globs per ecosystem, derived once per repo
and pinned on the receipt, plus the build system's own knowledge of which targets
are test targets (Phase 25.2 already reads the build graph; reuse it rather than
guessing from paths in a monorepo).

**Modifying the exam is not forbidden.** Forbidding it would break test-driven
work, and it would break Phase 24.2 entirely — characterization testing *is*
exam authorship, and it is the on-ramp that turns an unverifiable brownfield repo
into a customer. The rule is not prohibition; it is that a verdict produced under
exam authorship is **a different kind of claim** and may never be rendered as
though it were the same one.

Two contract shapes, declared at plan time, on the Plan Receipt, before approval:

```
verdict_class:
  strong    -- exam surface is byte-identical between base and delivered tree.
               The battery that graded the work is the battery the customer had
               before Cortex touched anything.
  authored  -- the task legitimately wrote or changed the exam (new feature with
               new tests, TDD, characterization work). The verdict proves the
               subject satisfies an exam Cortex partly wrote.
```

An `authored` verdict is still a real verdict and still worth paying for — it is
what every human engineer produces. It is not the same evidence as `strong`, and
the receipt, the badge, the API field, and the compliance export all carry the
class. Silently rendering them identically would be precisely the lie of omission
Phase 24.1 refused for quarantined checks.

The dangerous case is neither of those: a task declared `strong` whose delivered
diff touches the exam surface. That is a contract violation, not a verdict.
Dispatch declared the class; delivery contradicted it; the run does not get to
choose after the fact. It resolves as `inconclusive`, is not charged, and is
routed to a human with the exam diff shown first.

Within `authored`, the specific edits that warrant surfacing regardless:

| Signal | Detection | Disposition |
|---|---|---|
| Assertion deleted or count reduced in a test that existed at base | AST count per test function, base vs delivered | Named on the receipt, always |
| Test removed, renamed away, or moved out of a discovered path | Test-identity set difference | Named on the receipt, always |
| Test marked skipped, ignored, expected-failure, or conditionally excluded | Ecosystem-specific attribute/decorator scan | Named on the receipt, always |
| Assertion weakened in place (equality to truthiness, exact to approximate, specific exception to bare catch) | AST shape comparison on matched test bodies | Named on the receipt, always |
| Timeout raised, retry count raised, tolerance widened | Numeric literal comparison in exam config | Named on the receipt, always |
| Lint rule, typecheck strictness, or coverage threshold relaxed | Config diff against base | Named on the receipt, always |
| Test process exits successfully before executing the discovered set | Executed-test count vs discovered count, recorded per run | `inconclusive` — this one is not a disclosure, it is a broken run |

None of these blocks by default. All of them appear on the receipt, and all of
them are inputs to the review bundle's ordering (Phase 3.3) — a reviewer with
limited attention should see the exam diff before the subject diff, always,
because it is the part that decides whether the rest of the evidence is worth
reading.

Org policy (Phase 12.12 already has the mechanism) can escalate any row to
`block`, with the same attributed, expiring, receipt-visible waiver.

### 27.3 Verifier precision is a number, and Cortex does not know it

Two quantities govern the entire product, and neither is measured today:

- **`p_fa` — false accept.** The battery passed and the work is wrong. This is
  what refund-on-failure fails to catch, what the router learns from as success,
  what the professional record scores as a hit, and what the customer discovers
  in production. Every economic claim in this document is a function of `p_fa`.
- **`p_fr` — false reject.** The battery failed and the work was right. Phase
  24.1 covers the random component; the systematic component is over-strict or
  mis-derived checks. This one costs Cortex money directly under refund-on-
  failure, which at least makes it self-correcting.

`p_fa` is the one that is not self-correcting, because every incentive in the
system points away from discovering it. Three independent estimators, all
executable, none requiring a human labelling loop:

**(a) Mutation testing on the blast radius — does the battery *have* the power to
fail?** Inject mutants into the subject surface and re-run the frozen battery. A
battery that survives its mutants proves nothing about the code it graded,
regardless of how green it is. This is the only *executable* measure of check
power that exists, and it is the direct answer to a green tick on a repo with 4%
coverage (Phase 24.2). It is affordable because it is scoped exactly the way
Phase 24.2 already scopes coverage — to the blast radius of the change, not the
repository. Run it against the **base** tree at plan time, where it costs nothing
in latency on the critical path and where the result is a property of the repo
rather than of the change.

The output is not a gate. It is a class:

```
battery_power: strong | weak | none
  -- mutation score over the change's blast radius, thresholds per ecosystem,
     recorded on the Plan Receipt before approval and on the final receipt.
  -- `none` means the frozen checks cannot distinguish correct from incorrect
     code in the region being changed. The work may still proceed; the verdict
     is UNVERIFIED (invariant 22) and it is not priced as proven.
```

Showing `battery_power` on the **Plan Receipt, before approval**, is the honest
move and also the commercially useful one: it is the moment where Phase 24.2's
characterization on-ramp sells itself. The customer sees "the checks in this
region cannot fail" and is offered the task that fixes it.

**(b) The revert corpus.** Phase 26.3 already collects post-delivery reverts and
already calls a revert the most valuable negative signal available. It is also
the empirical numerator for `p_fa` — a delivered, verified change that a human
reverted is a false accept by observation rather than by inference. Wire 26.3's
output into a measured rate per repo, per task class, and per verdict class,
rather than only into the professional record. This costs nothing beyond joining
two things that both already exist.

**(c) A held-out red-team corpus, run against the harness on a schedule.**
Deliberately hackable tasks — a weak battery over a task with an obvious shortcut
— where the correct behaviour is a `weak`/`none` battery class and an
`UNVERIFIED` or `authored` verdict, not a green tick. This is a Phase 30 asset
and is specified there; what belongs here is the requirement that `p_fa` has a
number attached to it, published internally, tracked over time, and that a
release which moves it in the wrong direction is a regression.

**Nothing may claim a `strong` verdict on a `none` battery.** That pairing is the
exact shape of the failure this phase exists to prevent: a maximally confident
claim resting on checks that cannot fail.

### 27.4 Racing amplifies exactly this, and this plan calls it the safe knob

Phase 6.7 currently states, as a design rule:

> *"Racing before width, always: width is bounded by the dependency graph and
> carries integration risk, while racing is bounded only by budget and carries
> none."* — line 1149-1151

**That is wrong, and it is the most consequential wrong sentence in the
document,** because it is phrased as the safe default and it sits on the speed
dial where a customer in a hurry will reach for it.

Take one attempt at a leaf. It is correct-and-passing with probability `a`,
wrong-but-passing with probability `b` (a false accept), and failing with
probability `1 − a − b`. Race N independent attempts and keep the first passer.

On an easy leaf the conditional error rate is unchanged — among passers, the
false-accept share is `b / (a + b)` whether N is 1 or 10. That is the reassuring
half, and it is presumably the intuition behind the current sentence.

The hard tail is where it breaks. Consider a leaf where the honest success
probability `a` is near zero and `b` is not — a genuinely difficult change over a
battery with a shortcut in it. A single attempt mostly fails, and a failure is
*safe*: it refunds, it tells the truth, and it routes to a human. Racing N drives
`P(deliver) → 1 − (1 − a − b)^N`, and on that leaf essentially all of the newly
delivered mass is `b`. **Racing does not change the error rate on work that was
going to succeed. It converts work that was going to honestly fail into work that
passes by shortcut.** It is a false-accept generator aimed precisely at the tail.

Three things make this materially worse than the abstract statement:

1. That tail is not a rare corner. It is **the tasks a customer sends to a
   refund-backed vendor** — the adverse-selection result in Phase 31.2. The
   distribution Cortex is exposed to is skewed toward exactly the leaves where
   racing is most dangerous.
2. Racing is on the **speed** dial, so it is reached for under time pressure,
   which is when a human is least likely to read the diff carefully.
3. `b` is not a constant. It rises as the model gets better at finding the
   shortcut and falls as the battery gets stronger — and Cortex measures neither
   today.

The correction, and it is small:

- **Racing requires `verdict_class: strong`.** Racing an `authored` contract
  races the authorship of the exam itself, which is selecting for the most
  permissive test suite among N. Prohibited outright.
- **Race width is capped by measured battery power.** `strong` battery: full
  width. `weak`: width 2. `none`: racing is unavailable and the dial says so
  rather than silently doing nothing. This is invariant 9 applied honestly — the
  dial must change something visible, including when what it changes is a refusal.
- **Losing attempts are evidence, not garbage.** Today the N−1 discarded attempts
  are thrown away. They are the cheapest precision estimator in the system:
  N independent samples of the same leaf whose *agreement* is measurable at zero
  extra provider spend. Five attempts converging on the same change is strong
  corroboration. Five attempts producing five semantically different diffs, one
  of which happened to pass, is a warning that the battery — not the code — is
  what was solved. Record `race_agreement` on the receipt; a passing winner with
  low agreement routes to review rather than auto-delivering.

That last point is worth stating plainly because it inverts the current design:
**the value of racing is not the winner, it is the distribution.** Cortex is
already paying for N samples; the current plan extracts one bit from them and
discards the rest. Cross-attempt agreement is the one signal in this document
that costs nothing and measures the thing that matters.

The generalisation, and the twenty-fourth invariant:

> **Selection pressure against a check battery is bounded by that battery's
> measured power.** Any mechanism that produces multiple candidates and keeps the
> ones that pass — racing, escalation retries, speculative execution — declares
> its width, and the width is a function of measured battery power. Unbounded
> selection against an unmeasured battery is prohibited.

This also disciplines the escalation ladder (Phase 7.3), which is the same shape:
retry until something passes is best-of-N with extra steps and inherits the same
bound.

### 27.5 The two controls that make a battery prove something

Both are cheap, deterministic, universal, and — as far as this review can
establish — absent from every competing product. They are the executable form of
invariant 22, which currently states a principle with no mechanism behind it.

**The differential control, for behaviour-changing work.** At least one frozen
check must **fail on the base tree and pass on the delivered tree.** If no check
in the battery discriminates between "before the work" and "after the work", the
battery did not verify the work — it verified that the repository still compiles.
A green battery that was equally green before Cortex touched anything is the most
common way a verification claim is vacuous, and it is detectable in one extra
execution of a battery Cortex is already running, against a tree it already has.

Where no check discriminates, the verdict is `UNVERIFIED` and the receipt names
the reason. For a bug fix this control is exactly "there is a regression test".
For a feature it is exactly "the acceptance criterion is executable". Both are
things a senior engineer requires and no harness currently enforces.

**The invariance control, for behaviour-preserving work.** A refactor is the
mirror image: the battery must pass on **both** trees, and the exam surface must
be **byte-identical**. A refactor that rewrote its own tests is not a refactor,
and today nothing distinguishes the two. This closes the loophole the differential
control would otherwise leave open — declaring behaviour-preserving intent to
escape the requirement that some check moved.

Which control applies is a property of the `TaskFrame` (Phase 8.1) and is decided
at plan time, not at grading time. Declaring `refactor` to escape the differential
control and then shipping behaviour changes fails the invariance control, because
the delivered tree's battery result will differ from the base tree's.

Both controls run against the base tree, which means both can and should run at
**plan time**, before approval and before a credit is committed. A customer who
learns at plan time that their battery cannot distinguish done from not-done has
been told something genuinely valuable, has been given the Phase 24.2 path to
fixing it, and has not been charged to discover it.

**Alongside these, fuzz the derivation.** Phase 8.4's check derivation and Phase
25.2's build-graph derivation both turn a task into a battery, and both are code
that can be wrong in the permissive direction. A scheduled fuzzing pass over
derivation — malformed contracts, adversarial repository layouts, a `Makefile`
target that shadows a real one, a test path that resolves outside the tree — is
the same idea as the red-team corpus applied one level down, and it is the level
where a single bug is worth thousands of individually-hacked tasks.

**Phase 27 exit gate:** every diff is classified into subject/exam/incidental and
the classification is on the receipt; `verdict_class` is declared at plan time and
a `strong` contract that touches the exam resolves `inconclusive` rather than
choosing a class after the fact; assertion deletion, test removal, skip marking,
and threshold relaxation are detected and named on every receipt; `battery_power`
is measured by blast-radius mutation testing at plan time and shown before
approval; a `none` battery cannot produce a `strong` verdict; racing requires a
`strong` contract and its width is bounded by measured battery power; discarded
race attempts are retained and their agreement recorded, with low agreement
routing to review; the differential control fails a behaviour-changing task whose
battery does not discriminate base from delivered; the invariance control fails a
refactor that modified its exam surface; and `p_fa` has a published number derived
from the revert corpus and the red-team suite.

## Phase 28 - Capability: how Cortex exceeds the best single model

**Goal:** give the product thesis a mechanism. The founder's statement of the
vision is *better than any single AI model* — a multi-engine vehicle rather than
a bigger engine. Read literally against this document, **that mechanism is not
here.** Everything in Track B makes Cortex cheaper, safer, more honest, and more
governable than a single model. Nothing in it makes Cortex *more capable* than
the best model it routes to.

### 28.1 The plan currently optimises cheaper-than, and the vision is better-than

Invariant 12, as written:

> *"The router optimises cost-to-verified-outcome, never pass rate. ... A route
> that passes at four times the price is a worse route."*

That is the correct objective for most work and it is stated **unconditionally**,
which is the defect. Under an unconditional cost objective, Cortex converges on
the cheapest model that clears the bar, and its pass-rate ceiling is therefore
the pass rate of *that* model — necessarily at or below the frontier. Phase 6's
effort dial changes the fan-out shape and the model tier, but the router's
objective function does not change with it, so even at `ultra` the optimiser is
still trying to spend less.

There are two objectives here and this document has one:

| | Objective | The dial position that means it | Ceiling |
|---|---|---|---|
| **Efficiency** | minimise cost subject to passing | balanced and below | the routed model's pass rate |
| **Capability** | maximise P(verified) subject to a spend cap | `ultra` | strictly above any single sample, if and only if the verifier is sound |

The correction is small and it makes the top of the dial mean something:

> **Invariant 25.** The router's objective is set by the effort dial, not fixed.
> Below the top position it minimises cost subject to reaching the required
> confidence. At the top position it **maximises P(verified) subject to the cap**,
> and a route that passes at four times the price is the *better* route there.
> The receipt records which objective was in force.

This also repairs an inconsistency the current text carries: Phase 6.7 already
describes `ultra` as buying "more evidence" and a larger escalation budget, which
is a capability objective, while invariant 12 forbids exactly that trade.

### 28.2 What actually raises the ceiling, and by how much

Four mechanisms are available. Only some of them work, and the ones that work are
bounded in ways this document has to state rather than assume.

**(a) Repeated sampling against a sound verifier — the only one with a hard
guarantee.** If a single attempt is correct with probability `a` and attempts are
independent, at least one of N is correct with probability `1 − (1 − a)^N`. This
is the generation–verification gap, and it is the entire reason a verifier-owning
harness can beat the model it calls: the model can already produce the right
answer, and the missing capability is *identifying* it. Cortex owns an executable
identifier. Nobody selling tokens does.

The bound nobody states: **the delivered-correct rate is the sampling gain
multiplied by verifier precision**, not the sampling gain alone.

```
P(delivered correct) ≈ [1 − (1 − a)^N] × precision
where precision = a_pass / (a_pass + b_pass)   -- Phase 27's p_fa, inverted
```

Both terms are real and this document currently has a plan for neither. Raising N
without raising precision is the Phase 27.4 failure — more delivery, more of it
wrong, concentrated in the hard tail. **Verifier precision is the binding
constraint on Cortex's capability ceiling, which is why Phase 27 comes first.**

**(b) Decomposition below the coherence horizon — real, and it has a crossover
this document should compute rather than assume.** A model's success probability
falls as scope grows. Decomposing into `n` leaves and integrating gives roughly
`Π aᵢ` against `a_whole` for the single shot. Decomposition wins only when

```
Π aᵢ  >  a_whole        (times integration success, which is not 1)
```

That condition is **not** automatically true, and it fails exactly when a plan is
over-decomposed: twelve leaves at 0.95 is 0.54, which loses to one shot at 0.7.
This is the quantitative statement behind Phase 8.3's "decomposition is an
engineering step" and behind MAST's finding that specification failure dominates
multi-agent error. It converts decomposition depth from a matter of taste into a
measurable decision with an optimum, and the estimator subsystem (Phase 6.5)
already has the machinery to hold per-leaf priors. Record the predicted `Π aᵢ`
and `a_whole` on the Plan Receipt at `ultra`, and let the plan lint (Phase 6.7)
fail a plan that decomposed itself past its own crossover.

**(c) Diversity across engines — the mechanism that is uniquely Cortex's, and
which the current design forecloses.** Repeated sampling works in proportion to
how *independent* the samples are. N samples from one model at temperature are
strongly correlated: they fail the same way, on the same reasoning, for the same
reason. N samples from different providers, prompted with different methods
(Phase 8.4's Engineering Method Library), correlate far less, so the union of
what they can solve is much larger than any one of them.

The current design cannot express this. The router picks *one* model and then
Phase 6.7 races that model against itself, which is the weakest possible version
of the technique. **Racing should be a portfolio decision, not a repetition.**
The race set is chosen to maximise expected marginal coverage per credit — which
is exactly the complementarity machinery Phase 12.10 already built for expert
panels, applied to generators instead of reviewers. That code should be written
once and used twice.

This is the concrete engineering content of "multi-engine vehicle", and it is a
genuine structural moat: a single-vendor coding product cannot race its model
against a competitor's, and would not want to. Cortex can, because it sells the
outcome rather than the inference.

**(d) Compounding across runs.** The fourth mechanism — a repository-specific
corpus that makes attempt `k+1` better than attempt `1` — is Phase 29.

### 28.3 Weak verifiers may rank, and may never pass

Phase 6.7 rejects multi-model debate and consensus on measured grounds
(premature-consensus collapse, problem drift in long debates), and that rejection
should stand. But the rule it is expressed through — *models propose, never
grade* — is currently absolute, and taken absolutely it forecloses the
best-measured result in this area: combining several **weak** verifiers produces
a materially stronger selector than any one of them, shrinking the
generation–verification gap by double digits, and doing so more reliably than
self-consistency or a single reward model.

The two positions are reconcilable, and the boundary is clean:

> **Invariant 26.** Executed checks are the only thing that can create a pass. A
> model acting as a verifier is a **weak** signal: it may rank candidates *within*
> the set that already passed the executed battery, and it may raise a finding
> for a human, and it may lower confidence. It can never move a `failed` to a
> `verified`, never create a badge, and never emit a positive routing reward.

Under that boundary, weak verifiers are safe by construction — the worst a
compromised or wrong one can do is pick a poorer member of an already-passing
set — and they attack precisely the residual that executed checks cannot reach:
choosing between five candidates that all pass the battery. Phase 27.4's
cross-attempt agreement is the cheapest weak verifier of all and requires no
extra inference at all.

This also gives the EvilGenie result somewhere to live: an inspecting judge
outperformed held-out tests at *detecting* hacks. As a detector feeding Phase
27.2's disclosure list, that is exactly a weak verifier doing the job weak
verifiers are good at. As a grader it would violate invariant 6. The distinction
is not academic — it is the difference between a useful signal and a
model-authored verdict.

### 28.4 The efficiency half: stop re-executing checks Cortex has already run

Phase 24.1 introduces `(check, tree_hash, runner_digest)` as **flake identity**.
That triple is also a **content-addressed cache key**, and the document never
uses it as one. This is the largest cost reduction available anywhere in the
plan, and it requires no new machinery — only noticing that the key already
exists.

- A check whose triple has been executed before does not execute again; the
  recorded outcome is reused and the receipt names the earlier execution.
- **Soundness condition:** reuse is only valid if the check is a pure function of
  the tree — which is *precisely what Phase 24.1's flake scoring measures*. A
  check with a clean determinism record is cacheable; a quarantined check is not.
  One measurement drives both mechanisms, and they reinforce: the second
  execution of a triple is simultaneously a cache miss and a free flake probe, so
  early in a repo's life Cortex pays for determinism evidence it wants anyway,
  and later it stops paying at all.
- The savings are concentrated where the pain is: retry after a one-line fix,
  escalation ladder re-runs, racing (N attempts share unchanged subtrees),
  integration re-verification (invariant 16 requires a full battery on the
  integrated tree, most of which is unchanged), and monorepos, where Phase 25.2's
  remote build cache is the same idea one layer down.
- It strengthens rather than weakens the receipt, because a content-addressed
  reuse is *more* reproducible than a re-execution: the receipt can name the exact
  prior execution, and any auditor can re-run it.

Cache scope is per-repository and never crosses a tenant boundary — a shared
cache keyed on tree hash is a cross-customer oracle for private source, which
Phase 32.4 treats as an existential failure rather than a performance trade.

### 28.5 The honest ceiling, and what would falsify it

Stated plainly so it can be checked rather than believed:

**Cortex's capability ceiling is the routed portfolio's pass@N, multiplied by
verifier precision, minus integration loss.** It exceeds the best single model
when — and only when — three things hold:

1. `N > 1` with genuinely diverse generators (28.2c), so pass@N is meaningfully
   above pass@1;
2. verifier precision is high and *measured* (Phase 27), so the sampling gain is
   not eaten by false accepts;
3. decomposition stays on the winning side of its crossover (28.2b), so
   orchestration adds capability rather than multiplying failure.

Fail any one and Cortex is a governance layer over a frontier model: valuable,
honest, cheaper, and not better. That is a perfectly good product and it is not
the stated vision, so the difference should be measured rather than asserted —
which is what Phase 30 exists to do. The falsification test is specific: **if
Cortex at `ultra` does not beat the best single model run at maximum effort on
the held-out suite, at any price, the capability claim is false and must not be
made.** That test should exist before the claim does.

**Phase 28 exit gate:** the router's objective is a function of the effort dial
and the receipt records which objective was in force; `ultra` maximises
P(verified) under the cap rather than minimising cost; the race set is selected
for generator diversity using the Phase 12.10 complementarity machinery rather
than repeating one model; weak verifiers rank within the passing set and are
mechanically incapable of creating a pass; predicted `Π aᵢ` versus `a_whole` is
computed at plan time and plan lint fails an over-decomposed plan; verified check
results are reused by content-addressed triple, gated on the determinism record,
never across tenants; and the held-out suite reports Cortex-at-`ultra` against
the best single model at maximum effort, with the capability claim withheld until
that comparison is won.

## Phase 29 - Repository comprehension, and the corpus only Cortex can own

**Goal:** make what Cortex *knows about the codebase* a measured, improving,
compounding asset. This is the largest determinant of coding quality and this
document, across twenty-eight phases, spends almost nothing on it — every phase
so far governs the agent, and none of them make the agent better informed.

### 29.1 What actually exists, stated accurately

Two earlier passages refer to "the repo map" as an established thing (line 569,
line 2689) without a phase behind it, so this review went looking for it. It
exists and it is better than the plan implies. `crates/context` (2,178 lines) is
a real subsystem: `extract.rs` does tree-sitter symbol and reference extraction,
`repo_map.rs` builds a ranked map from symbols and references, `index.rs`,
`retrieval.rs`, `impact.rs`, and `cache.rs` provide an index, targeted retrieval,
and impact analysis with a cache. It is wired into dispatch —
`scheduler.rs:1213-1226` (`with_repo_map`) renders the map into `StepContext`
under a token budget derived from provider and tier.

That is a genuinely good foundation, and it changes the finding from "missing" to
four specific defects, each of which matters more than it looks.

| Defect | Evidence | Consequence |
|---|---|---|
| **The comprehension layer degrades silently.** `with_repo_map` documents failure as silent by design — an unparseable repo "should cost a step its orientation and nothing else." | `crates/api/src/scheduler.rs:1208-1226` | The agent works blind and **nothing says so.** The receipt claims the same verdict class whether the agent had a full map or none. This is invariant 10 — a receipt never claims a setting the backend did not apply — applied to context instead of effort, and it is currently violated. |
| **Grammar coverage is four languages.** Rust, TypeScript, TSX, JavaScript. | `crates/context/src/extract.rs:66-88` | Python, Go, Java, C#, Ruby, PHP, Kotlin, Swift, and C/C++ repositories get an empty map, silently, per the row above. For a product that must serve 200 developers across many repositories, this is the single largest capability cliff in the codebase — and it is invisible from the outside. |
| **Retrieval and impact analysis are built and not on the dispatch path.** Only the rendered map reaches a step; `retrieval.rs` and `impact.rs` are reachable only through `context_api.rs`. | `crates/api/src/context_api.rs:287-298`; absence in `scheduler.rs`, `ws.rs` | The *targeted* half of comprehension — "which symbols does this task actually touch" — is written, tested, and unused by the thing that writes code. Same defect shape as the effort dial: a real capability behind an unused entry point. |
| **The workspace is a single global directory.** `state.workspace_dir`. | `crates/api/src/scheduler.rs:1221`; `crates/api/src/state.rs:110` | Multi-repo (Phase 25.1) and multi-tenant repository comprehension have no representation. The map is per-*deployment*, not per-repo. |

The first two together are the important one: **Cortex currently cannot tell the
difference between a well-oriented run and a blind one, and neither can the
customer.** Every capability claim in Phase 28 is conditioned on the agent
knowing where it is.

### 29.2 Do not build a vector index — the obvious move is the wrong one

The reflex here is to embed the repository and retrieve by similarity. It should
be resisted, and the reason is measured rather than aesthetic: on repository
exploration benchmarks, **agentic explorers form a clear tier above classical
retrieval**, file-level localization by modern agentic methods is already strong,
and the axes that still separate the state of the art are *line-level coverage*
and *ranking efficiency* — neither of which embedding similarity improves. An
embedding index would be expensive to maintain, stale by construction, another
thing to invalidate, and worse than what a competent agent does with symbol
extraction and grep.

Cortex already made the right architectural choice by building a structural map
(tree-sitter symbols and references) rather than a semantic one. The work is to
extend and instrument what is there, not to replace it with the fashionable
thing. Three concrete extensions, in value order:

1. **Grammar coverage as a product requirement, not a nice-to-have.** Every
   language a target customer uses gets a grammar, and the supported set is
   published. Where no grammar exists, a degraded structural fallback (imports,
   file tree, and definition-shaped regex) is better than nothing — and is
   *labelled* as degraded rather than passed off as a map.
2. **Wire `retrieval` and `impact` into dispatch**, so a step receives the
   symbols its declared write set actually touches plus their reverse
   dependencies, rather than a globally-ranked map truncated to a token budget.
   Impact analysis is also the honest source for Phase 11's declared write sets
   and Phase 25.2's blast radius — three phases currently guessing at something
   one existing module computes.
3. **Make the context budget a decision rather than a constant.** Today it is
   `token_budget / REPO_MAP_BUDGET_FRACTION`. It should be an allocation the
   estimator makes and the receipt records, because over-retrieval is a
   measurable defect — more tokens, more context rot, worse outcome — and not
   merely a cost.

### 29.3 Comprehension is a durable artifact, not a per-run expense

Every run explores. Today that exploration dies with the worktree and the next
run on the same repository pays for it again from zero. That is the single
largest recurring waste in the system and the reason the same task costs the same
amount on the hundredth run as on the first.

Make it an artifact, anchored to content rather than to time:

```
RepoUnderstanding {
  repo_id, commit_anchor,
  symbol_graph_digest,            -- from crates/context
  subsystem_map[],                -- module boundaries, ownership, entry points
  convention_findings[],          -- observed, evidence-linked: how this repo
                                  --   names things, tests things, wires DI
  hotspot_paths[],                -- Phase 11.5, now derived rather than declared
  battery_shape,                  -- how this repo is verified: commands, cost,
                                  --   determinism record, mutation power (27.3)
  dead_ends[],                    -- what was looked at and was NOT relevant
  per_file_content_hash[]         -- invalidation granularity
}
```

Two design points that decide whether this works:

- **Negative results are the valuable half.** `dead_ends` is what makes the next
  exploration cheap, and it is exactly what every harness throws away. Knowing
  that six plausible-looking modules are irrelevant to authentication saves more
  tokens than knowing the two that are.
- **Invalidate per file content hash, not per commit.** A commit-scoped cache is
  useless in a repository with 200 developers committing — it is stale before it
  is written. Content-hash granularity means a busy repository degrades the map
  gradually instead of discarding it, which is the only version of this that
  survives Phase 33's scale.

Provenance discipline is not optional here, and Phase 13 already supplies it: a
prior run's *executed outcome* enters as `verified`, a prior run's *conclusion*
enters as `inferred` with its origin, and invariant 19 governs the conflict — when
the map disagrees with the tree, the tree wins and the map entry is flagged. A
comprehension cache that can override the repository is a defect generator, and
the mechanism to prevent it is already specified; it just has to be applied here.

### 29.4 The corpus nobody else can build

This is the compounding mechanism Phase 28.2(d) deferred, and it is a stronger
moat than the professional system, because it accrues automatically from work
Cortex is already paid to do.

The measured result worth building toward: **accurately summarised and retrieved
prior experience improves resolution accuracy while simultaneously reducing
runtime and token cost, and the gain is largest on hard tasks.** Better and
cheaper at once is rare, and the reason it holds here is that most of what an
agent spends on a hard task is re-deriving orientation someone already paid for.

What Cortex holds per repository that no model vendor and no IDE does:

| Asset | Where it already comes from | What it answers next time |
|---|---|---|
| `TaskFrame` → files actually changed | Every completed run | Which subsystem does this *kind* of request touch here |
| Derived battery + its cost + determinism record | Phase 24.1, Phase 27.3 | How is this repo verified, what does it cost, what can be trusted |
| Checks that failed and the fix that made them pass | Verification history | The repo's recurring failure modes |
| Review findings and their dispositions | Phase 3.3, Phase 12 | What this team rejects, in this repo |
| Post-delivery reverts | Phase 26.3 | Where verified work is nonetheless wrong here |
| Race-attempt disagreement | Phase 27.4 | Which regions of this repo are underspecified |

That last one is quietly the most interesting: regions where independent attempts
systematically disagree are regions where the repository does not constrain
behaviour — which is a real, sellable finding about the codebase that arrives as
a by-product of racing.

**Tenancy is the hard boundary and invariant 20 already draws it.** The corpus is
per repository and never crosses an organisation. What *may* generalise across
customers is structural and objective — this ecosystem's conventional test
command, this framework's usual entry points, this build system's affected-target
query — and nothing derived from a customer's code, findings, or dispositions. A
retrieved-experience layer that leaks across tenants is a source-code disclosure
with extra steps, and it must be architecturally impossible rather than
policy-prevented.

### 29.5 Localization is measurable, and the label is free

Cortex can score its own comprehension retroactively at zero labelling cost,
because **every completed run reveals the ground truth**: the set of files the
change actually touched. Compare it against what the agent was given and what it
opened.

| Metric | Definition | Why it matters here |
|---|---|---|
| Context recall | share of finally-changed files present in the assembled context | Below 1, the agent had to discover; the gap is pure cost |
| Context precision | share of assembled context that was touched or read | Low precision is context rot and wasted budget |
| Exploration cost | tokens and wall-clock spent before the first edit | The number the corpus in 29.4 should drive down over time |
| Map availability | whether a real map, a degraded fallback, or nothing was supplied | The unreported condition from 29.1, now reported |

These feed three places that currently guess: the estimator (Phase 6.5) — poor
localization is a leading cause of the 3×–30× cost variance the forecast keeps
missing; the router, where context quality is a confound it currently attributes
to the model; and the Plan Receipt, where "Cortex has a strong map of this
repository" versus "Cortex is working without a symbol map in this language" is
information the customer is entitled to *before* approving spend.

> **Invariant 27.** Comprehension quality is declared, never assumed. Every
> attempt records what map, retrieval, and prior-experience layers were actually
> available; a degraded or absent map appears on the Plan Receipt before approval
> and on the receipt after; and no verdict class is raised on the strength of
> context the backend did not supply.

**Phase 29 exit gate:** an unparseable or unsupported repository produces a
declared degraded-comprehension state on the Plan Receipt rather than a silent
empty map; grammar coverage spans the published supported-language set with a
labelled structural fallback beyond it; `retrieval` and `impact` are consumed on
the dispatch path and impact analysis is the source for declared write sets and
blast radius; the context budget is an allocated, recorded decision; repository
understanding persists as a content-hash-invalidated artifact including dead
ends; prior-run experience is retrievable per repository, typed by provenance,
architecturally unable to cross a tenant boundary, and loses to the tree on
conflict; and context recall, precision, exploration cost, and map availability
are computed for every completed run and feed the estimator, the router, and the
receipt.

## Handover protocol — how to actually execute this document

**Read this before dispatching any implementation work.**

This document is a *plan*: it argues, cites evidence, and records why decisions
went the way they did. That is what it needs to be for review, and it is **not
the right artifact to hand an implementer.** A 2,000-line plan given to a
medium-effort model produces confident work against half-remembered constraints.

The rule: **every PR gets its own execution brief, generated from this document,
and the implementer reads the brief — not this file.**

### The brief template

One file per PR, in `cortex/plan/briefs/PR-<letter>-<slug>.md`, self-contained
enough that an implementer never needs to open this plan:

```markdown
# PR <letter> — <title>

## Objective
One paragraph. What is true after this PR that is not true now.

## Do not do
Explicit scope fence. The adjacent work that belongs to other PRs.

## Prerequisites
Which PRs must be merged. What to verify is present before starting.

## Files expected to change
Concrete paths from this repo, with what changes in each.

## Invariants this PR must not violate
Copied verbatim from the plan's invariant list, by number. Not paraphrased.

## Design decisions already made
The conclusions, without the argument. If the implementer needs the reasoning,
link the plan section — do not inline it.

## Schema / migration
Exact tables, columns, indexes. Migration number. Backfill and rollback.

## Test matrix
Named tests to add, with the failure each one catches.

## Done criteria
A checklist that is mechanically checkable. No judgment calls.

## Open questions
Things the implementer must ask rather than decide. Empty is the goal.
```

### Rules for the briefs

- **Decisions are resolved before the brief is written, never inside it.** An
  "Open questions" section with entries means the brief is not ready to dispatch.
  This is the main thing that separates a brief from a plan.
- **Copy invariants verbatim.** Paraphrasing a safety invariant is how it gets
  softened.
- **Name files by path.** Every file reference in this plan is `file:line` for
  exactly this reason — the brief inherits them.
- **One brief, one PR, one reviewable diff.** If a brief cannot be executed
  without touching a second PR's territory, the wave boundaries are wrong.
- **Higher effort for the brief than for the implementation.** Writing the brief
  is where the thinking happens; executing a good brief is mechanical. This is
  the cheapest possible allocation of effort — and it is the same argument
  Phase 8.3 makes for spending effort on decomposition rather than execution.

### Honest assessment of handover readiness

| PR | Ready to brief? | What is missing |
|---|---|---|
| A, B, D, E, I, L, M, R, U | **Yes** | Evidence and design are specific; no open product decisions block them. U in particular is small, self-contained, and should go early. |
| C | **Yes, with care** | The `ExecutionJob` field table is specified, but the CLI-vs-HTTP effort question (Phase 0.1) must be settled in the brief, not during implementation. |
| Q, F | **Yes, after one doc change** | Decisions 1 and 2 are resolved. The only prerequisite is amending CREDITS.md to the maturity ladder — a documentation change, not a code one, and it must land before PR F persists a schema. |
| K, S | **Yes, in order** | Decisions 5, 6, and 7 are resolved: effort dial in K, speed dial deferred to S behind R. Confirm the two-dial design with design partners *while* K is built, not before it starts. |
| G, N, Z, AA, AB, AC, AD | **Yes** | Decisions resolved. Dial *visuals* should still be design-partner tested, but the data contract behind them (6.6) is fixed and can be built now. |
| O, P, T | **Later** | These need outcome data to exist before their measurement harnesses mean anything. T's *schema* — immutability, versioning, ownership scopes — should be designed now even if the bench ships later, because retrofitting immutability is painful. |
| V | **After N and T** | Policy needs roles to bind to and professionals to require. |

**Every decision in this document is resolved with a decided default**, so no
PR waits on an answer. The single prerequisite before PR F is amending
CREDITS.md to the maturity ladder (decision 1) — a documentation change that
takes an hour and prevents a pricing schema being built against a superseded
model.

Josh should confirm the three **[business risk]** decisions (1, 5, 18) when
convenient. None of them blocks the start of work; all three are cheaper to
change now than after the PR that depends on them.

### Operating instructions for the implementing model

This document is evidence-based, not authoritative. **It was written at a point
in time against commit `d437ff5d`, and the tree moves.** An implementer that
follows it blindly will eventually implement something against code that no
longer exists.

**Verify before you change.**

- Every claim here carries a `file:line`. **Re-check the specific line you are
  about to modify** before modifying it. If the code has moved or the claim no
  longer holds, say so in the PR and adjust — do not implement against a stale
  premise, and do not silently paper over the discrepancy.
- If a design decision in this plan turns out to be wrong when it meets the real
  code, **stop and say so.** A brief that cannot be executed as written is a
  finding, not an obstacle to route around. This whole document argues that
  Cortex should not silently guess; the same standard applies to whoever builds it.
- Do the grounding once, up front, then write. Re-reading files mid-implementation
  is the main source of wasted context.

**Environment facts that will otherwise cost a round trip.**

- **Rust builds work locally** with the gnullvm toolchain:
  `cargo +stable-x86_64-pc-windows-gnullvm test -p cortex-api --lib`. The default
  `stable-x86_64-pc-windows-gnu` toolchain fails on everything including
  `cargo check`. Full lib suite runs in about two minutes — use it rather than
  burning CI round trips on type errors.
- **Never run `cargo fmt` on this repo.** There is no `rust-toolchain.toml` and CI
  does not check formatting, so the tree has drifted from every rustfmt version.
  One run reformatted 54 files and 5,470 lines, burying a real change. Format
  only what you wrote, by hand.
- Known pre-existing local failure, not yours:
  `validate::tests::normalizes_dot_segments` fails on Windows path separators and
  passes on Linux CI. Baseline is 236 passed / 1 failed.
- `cortex/node_modules` may be absent; the frontend build needs an install first.

**Repository and delivery discipline.**

- Work on a branch, never on `main`. **Commit and push after each logical unit**,
  not once at the end — unpushed work in a worktree is nearly unrecoverable if a
  session dies mid-flight, and that has already happened on this project.
- Use `gh` for PRs and issues. One brief, one PR, one reviewable diff.
- This repository contains **two products**. Cortex work touches `cortex/**`,
  `crates/**` on the Cortex path. HeyVera Socials work is a different lane and
  must not be reviewed, merged, or rebased from a Cortex change.
- `schema_version` is a **single shared migration counter** across both products.
  Check the current value before writing a migration; two branches claiming the
  same number is a merge-order problem that costs real time.

**Production and deploy.**

- The VPS is reachable over Tailscale as `ssh guardian-vps-tail` (user
  `guardian`). Use it for inspection and diagnosis.
- **Deploys run from GitHub Actions (`deploy-production.yml`, `workflow_dispatch`,
  branch `main`), not from a local SSH session.** Do not hand-deploy.
- Cloudflare Pages deploys `cortex/` from `main` continuously via its own Git
  integration, independent of the backend — the web client can run ahead of the
  API. Account for that when shipping a frontend change that needs a new endpoint.
- Confirm the current state of the deploy-safety work before triggering anything:
  `scripts/deploy-cortex.sh` historically did `git reset --hard` plus
  `git clean -fd` against a checkout that contained the live database as a tracked
  file. Verify that is resolved on the current `main` rather than assuming it.

**Do not.**

- Do not weaken a Track A invariant to make a Track B feature land. If they
  conflict, the invariant wins and the conflict is a finding.
- Do not combine a schema change, a sandbox change, and a UI change in one PR.
- Do not mark work complete that is not verified. The product this document
  describes refuses to do that; the process building it should not either.

## Delivery order for Claude

Implement as small, reviewable PRs. Do not combine schema changes, sandbox
cutover, billing activation, and broad UI redesign in one change.

Track A PRs are lettered A–H, Track B PRs I–P. They are grouped into waves by
dependency, not by track. **Everything inside a wave can proceed in parallel;
a wave starts when its stated dependencies are merged.**

### Wave 1 — foundations, fully parallel, no dependencies between them

- **PR A · Truth model (Track A).** Write the state-transition ADR; add
  `delivered` and `verifying` projections and transitions; prevent `done` and
  downstream release before independent verification. No billing change.
- **PR I · Model catalog (Track B, Phase 7.1).** Collapse `evaluator::default_model`,
  `engine::models::REGISTRY`, and `CostEstimator::get_model_rates` into one
  seeded, versioned, dated catalog. Add the test that fails on any hardcoded
  model string outside the catalog module. Pure refactor plus a migration — no
  behaviour change, which is why it can land immediately and unblocks E, J, and K.
- **PR M · Ownership model (Track B, Phase 9.1).** Org → team → project →
  membership, with every existing run/task/receipt row assigned an owner.
  **This must precede PR F.** Retrofitting ownership onto populated billing
  tables is a data-correctness migration; doing it before quotes exist is
  dramatically cheaper.

### Wave 2 — execution and durability (needs A)

- **PR B · Durable verifier (Track A).** Verification job/outbox/recovery, lease
  and reclaim loop, terminal transition transaction, failure-injection tests,
  metrics. Keep provider work disabled if the sandbox is not ready.
- **PR C · Sandbox boundary and `ExecutionJob` (Track A 0.1, amended by Phase 6).**
  Implement the runner; remove direct-host and direct-worktree fallback; add
  adversarial isolation tests and deployment hardening. **Ship the full
  `ExecutionJob` field set from Phase 0.1's table**, including `effort`,
  `model_ref`, and budgets, even where initially unset — and fix the Gemini
  invocation that drops the routed model (`executor.rs:520`) in this PR, since
  it is the same interface.

### Wave 3 — make the outcome data trustworthy (needs B, C)

- **PR D · Receipt projection (Track A).** Paginated receipt APIs; replace
  legacy-report badges and indexing with independent receipt state; keep legacy
  diagnostics as clearly labelled secondary evidence.
- **PR E · Router truth (Track A, needs I).** Move bandit and reliability updates
  from `StepCompleted` to the independent terminal verdict; persist route facts
  including `catalog_version`; labelled-outcome tests.
- **PR L · Intake and decomposition (Track B, Phase 8.1–8.3).** `TaskFrame`,
  confidence-gated clarification, deletion of the duplicate classifier, removal
  of the five-segment hard error, and decomposition driven by the frame with
  effort reaching the planner. Independent of the billing chain — it can run
  alongside D and E.
- **PR R · Conflict-free scheduling (Track B, Phase 11.2–11.3, 11.5).** Move
  leases from run scope to step scope; queue on conflict instead of failing;
  replace the repo-wide `.` default with a plan-derived write set; make write-set
  disjointness a validated plan property; atomic canonical-order lease
  acquisition; hotspot declaration and scheduler-allocated sequence resources.
  **This is the gate on the speed dial** and it is independent of the billing
  chain.
- **PR U · Provenance-typed context (Track B, Phase 13).** Provenance types on
  every context item; the never-render-inferred-as-fact rule; `Assumption`
  objects with mechanical checks executed at plan time; summaries typed and
  sourced; verified evidence exempt from compaction; observed-content directives
  reported as findings rather than obeyed; per-attempt context composition
  recorded. **Cheap, high-leverage, and it closes the repo-content injection hole
  that nothing else in this plan covers.** Independent of the billing chain —
  land it early.

### Wave 4 — economics (needs E, I, M)

- **PR J · Cost-aware reward (Track B, Phase 7.2–7.3).** Replace the binary
  reward at `scheduler.rs:1002` with cost-to-verified-outcome including retries
  and verification cost; measure and store per-class verification cost; implement
  the escalation-threshold policy; ship the credits-per-verified-task COGS
  dashboard and the always-strongest-model champion baseline.
- **PR Q · The estimator, cap, and settlement (Track B, Phase 6.4–6.5).** The
  repo-shape scanner and measured verification cost `c_v`; the conditional-quantile
  estimator with monotonicity constraints and hierarchical backoff; critical-path
  composition for wall-clock; the forecast row with prediction ID, feature
  vector, and `estimator_version`; cap enforcement at the sandbox boundary via
  `ExecutionJob` budgets; stop-and-ask at the cap; calibration monitoring with
  coverage/sharpness tracking and drift alerting; the labelled cold-start prior.
  **Ships before PR F**, because it determines the pricing schema PR F persists.
- **PR F · Plan Receipt, quotes, and settlement (Track A 2.1–2.2, amended by 6.4).**
  Amend CREDITS.md to the maturity ladder first, then persist the quote as a
  **cap plus actuals** rather than a fixed price, bind settlement and refund,
  implement class graduation to fixed pricing, and add reconciliation bundles and
  chaos tests. Do not activate pricing in the same PR that creates the schema.

### Wave 5 — the product surface (needs F, L, R)

- **PR K · Effort dial end-to-end (Track B, Phase 6.2–6.5).** `ExecutionPolicy`
  table, conversation-level inheritance, per-task escalation up and down, Cortex
  suggestions with reason and forecast delta, freeze-at-dispatch,
  `effort_applied` reporting from each backend, per-subtree overrides as `Ask`
  artifacts, escalation charged to Cortex. Delete the vestigial CLI-only dial or
  make it call this path. **Effort dial only** — the speed dial waits for PR S.
- **PR S · Integration and the speed dial (Track B, Phase 11.4, 6.1).** The
  `integrate` step kind: sequential one-branch-at-a-time rebase, full check
  battery re-run against the *integrated* tree, defined re-plan on integration
  failure, hotspot edits applied deterministically at integration. Then enable
  the speed dial's concurrency knobs — parallel width, best-of-N racing,
  speculative depth, warm sandbox pool. **Racing before width**: it buys latency
  with no lease breadth and no integration risk, so it is the safe first
  increment.
- **PR G · Chat and Operations Room (Track A 3.x, plus the dial UI).** Attach
  chat, plans, decisions, live verification states, authority controls, and
  review bundles to canonical APIs. Remove fabricated members and the fail-open
  evidence gate (`taskManager.ts:116-130`, `:426-442`). Put the dial next to the
  price on the Plan Receipt.
- **PR N · Governance (Track B, Phase 9.2–9.3).** RBAC, then audit export, then
  SAML SSO. Budgets and effort ceilings at org/team/repo/member. Per-org provider
  allowlists enforced as routing constraints. SCIM only when a customer asks.

### Wave 6 — compounding advantage (continuous after Wave 5)

- **PR O · Engineering Method Library (Track B, Phase 8.4).** L2 check batteries
  first — two, where demand and external standards are clear. Then L1 archetype
  decomposition templates and L3 decision rubrics. **The measurement harness
  ships with the first entry, not after**: every template must beat the
  no-template baseline on held-out tasks or be deleted. Wire
  `check_battery_ref`. Includes the greenfield bootstrap ladder (Phase 8.5) as
  its first archetype.
- **PR P · Evaluation loop (Track A 5.2, Track B 7.4, 8.4, 12.5).** Replay
  corpus, shadow routing, champion/challenger with confidence bounds, quarantine
  rules. **One machinery, three consumers**: it grades routing policies,
  method-library entries, and professionals. Build it once and every later
  "is this actually better?" question has an answer.
- **PR T · Professionals and the panel (Track B, Phase 12).** The immutable
  versioned `Professional` object with ownership scopes and pinning **from the
  first version** — retrofitting immutability onto a mutable artifact is a
  migration nobody enjoys. Assignment scored on measured fit; the Plan Receipt
  assignee line naming exact versions; the multi-signal outcome record including
  retroactively attributed misses; tiered convening; the no-panel control arm.
  **Read-only reviewers first.** Two professionals, promoted only through PR P's
  machinery.
- **PR W · Collaborative planning (Track B, Phase 14).** Plan-as-default with
  visible auto-skip; the shared plan space with RBAC-scoped visibility; advisory
  plan-time reservations handing off to dispatch leases; the four detections
  (path overlap, subsystem/semantic divergence, duplicate work, stale base); and
  assumption re-execution when the base moves — which is nearly free once PR U
  exists. **Needs L (TaskFrame), R (write sets), U (assumptions), M (ownership).**
  Ship the solo and small-team behaviour first; org policy routing comes with V.
- **PR V · Review policy and org-authored professionals (Track B, Phase 12.12).**
  The `ReviewPolicy` object with path-glob triggers, pinned required
  professionals, `block` enforcement, and attributed expiring waivers; org-scoped
  publishing under Phase 9.2's RBAC. **Needs PR N and PR T.** This is what a
  compliance buyer is actually purchasing, and it is the strongest retention
  mechanism in the plan.
- **PR H · Platform scale (Track A 4.x, and the self-host prerequisite).**
  Postgres target, leader election, migration, rollback, load testing, two-replica
  chaos proof. Do not cut over merely because the document exists.

### Track C and production hardening — mostly parallel to everything above

Frontend foundations have **no backend dependencies** and should start
immediately, in parallel with Wave 1. Surface work follows the APIs it renders.

- **PR X · Frontend foundations (Phase 16). Start now, parallel to Wave 1.**
  The primitive library on the existing tokens, headless behaviour library, typed
  variants, Storybook with full state coverage, the raw-value lint rule, lint
  gating in CI, TanStack Query, `cortexApi.ts` split by domain, `App.tsx` split,
  and deletion of browser-canonical state in `taskManager.ts` (which is also a
  Phase 15 launch blocker). **Nothing else in Track C is affordable first.**
- **PR Y · Test infrastructure (Phase 21.3). Immediately after X.** Vitest,
  Testing Library, MSW, Playwright, and the truth-state component tests. Going
  from zero tests to a gated critical path is the single largest reduction in
  regression risk available anywhere in this document.
- **PR Z · Information architecture (Phase 18).** One shell and one nav, the
  doorway fix, pane routing with deep links, role- and capability-driven
  disclosure, the menu and keyboard model, and the first-five-minutes flow.
  **Needs X.**
- **PR AA · The surfaces (Phase 19).** Plan Receipt, run, receipt, review
  bundle, consolidated ledger, repos, bench, leases, admin, and the dial
  component. **Each surface follows its API** — the Plan Receipt surface needs
  PR F and PR K, the receipt surface needs PR D, the ledger needs PR F. Ship them
  as they unblock rather than as one release.
- **PR AB · Craft and quality gates (Phase 21).** Accessibility conformance,
  performance budgets in CI, responsive breakpoints, i18n extraction,
  observability, and the polish pass. Partly parallel with AA.
- **PR AC · Headless Cortex (Phase 17).** API keys with scopes and spend limits
  on `agent_auth.rs`'s foundation, device authorisation for the CLI, the CLI
  itself, standing authorisation policies, webhooks, and **removal of the legacy
  subscription `startAuth` flow and the `device_code` field in `auth.rs:29`**.
  **Needs M and N** for scoping. The MCP server is a small, high-leverage
  follow-on once the API is stable.
- **PR AD · Team economics (Phase 20).** Org pool, auto-recharge, budgets as
  ceilings, rate limits, priority classes, attribution tags, depletion behaviour,
  and the spend-authority ladder. **Needs M, N, and F.**
- **PR AE · Production hardening (Phase 15).** Customer secrets with egress
  redaction, provider degradation handling, data lifecycle and deletion, abuse
  controls, and full COGS attribution. **Secrets and provider degradation are the
  two that gate real external repositories** and should not wait for the others.

- **PR AF · The free editor extension (Phase 22).** A thin VS Code extension over
  the Phase 17 API: verification overlay, local check batteries, local estimate,
  plan drafting, repo insight, team awareness. **Needs AC** (the API and auth)
  and benefits from O (batteries). Ship after the API is stable — this is
  distribution, and distribution built on an unstable contract is rework.

- **PR AG · Flake defence (Phase 24.1). Early — this protects every learning
  signal in the system.** Flake identity on `(check, tree_hash, runner_digest)`,
  bounded confirmation re-runs, non-blocking quarantine surfaced on the receipt,
  flakiness scoring, and exclusion of quarantined outcomes from router reward,
  professional records, and forecast calibration. **Needs D; should land before
  PR J**, or the router trains on noise.
- **PR AH · Brownfield on-ramp (Phase 24.2).** Characterization-test generation
  as a priced task class, blast-radius coverage as the gate, honest receipt
  labelling, and shallow-test rejection. Turns unverifiable repos into
  customers. **Needs F and O.**
- **PR AI · Partial delivery (Phase 24.3).** Per-leaf outcomes delivered and
  billed, blocked frontier as a resumption point, `attention` as an owned queue.
  **Needs A and F.**
- **PR AJ · Scope expansion (Phase 25).** Multi-repo Plan Receipts, build-graph
  check derivation for monorepos with remote-cache participation, long-running
  and migration task classes, non-code deliverable classes, and the
  Windows-runner path. Ship the monorepo build-graph work first — it is the
  largest enterprise differentiator here.
- **PR AK · Operational completeness (Phase 26).** Compliance evidence export,
  revert as a task class with post-delivery revert as a missed signal,
  `awaiting_input` with a paused budget, thrashing detection, and integration
  with the repository's existing CI, protection rules, and CODEOWNERS.
  **The existing-gates work in 26.6 should land early** — it is small and it is
  what makes a platform team willing to try Cortex at all.

### If only three things get done

Ranked by consequence, if capacity forces a choice:

1. **PR C** — the sandbox. It is the only item in this document that is a live
   safety exposure rather than a missing capability.
2. **PR A + PR B** — a truthful, durable outcome. Without it every other number
   in the system, including every forecast and every routing reward, is measuring
   something that is not true.
3. **PR I + PR J + PR Q** — the catalog, the cost-aware objective, and the
   forecast. These three together are the entire economic claim: without them
   Cortex cannot route on cost, cannot quote without surprising people, and
   cannot say anything defensible about being cheaper.

**Two more deserve a mention just outside that list**, both because they are
unusually cheap for what they buy:

- **PR R** — the lease machinery and the path-overlap logic already exist and are
  correct; the work is applying them at step granularity and queueing instead of
  failing. It unlocks the speed dial, the most differentiated thing in Track B.
- **PR U** — provenance typing is a small change to one representation. It
  contains Cortex's own error propagation, closes the repository-content
  injection hole, and produces a quality dataset nobody else has. It is the
  highest ratio of consequence to effort in this document, and it is a
  prerequisite for pointing Cortex at repositories nobody has vetted.

Each PR must contain: an explicit invariant section, migration/recovery notes,
authorization review, a test matrix, observability additions, and a rollback
plan. Require a second-model or human review for sandbox, authorization,
ledger, state-machine, and pricing changes.

## Required test matrix

| Layer | Required proof |
|---|---|
| State machine | Property/transition tests covering every legal and illegal state transition, stale lease, duplicate message, retry, and cancellation. |
| Database | Migration from production-shaped snapshots, idempotency uniqueness, outbox atomicity, ledger reconciliation, and rollback failure injection. |
| Sandbox | Adversarial tests for credential, filesystem, process, Docker socket, network, privilege, disk, CPU, memory, pids, and teardown escape attempts. |
| Verification | Clean checkout identity, frozen-check integrity, digest enforcement, timeout/output behaviour, crash recovery, and exact receipt reconstruction. |
| API/authz | Per-user/org scope tests, 404 concealment where appropriate, capability-grant expiry, ETag conflict behavior, and prohibited state mutations. |
| UI | Deterministic component tests for all truth states plus a browser e2e flow: plan -> approve -> execute -> verifying -> verified/failed -> review/receipt. |
| Routing | No positive reward before independent verdict; replay/holdout evaluation; quarantine and contamination behavior. |
| Operations | Single-node guard, backup/restore, alert exercise, stuck-job reaper, and future multi-replica lease/dispatch chaos test. |
| Model catalog | Exactly one source of model identity and price: a test that fails on any hardcoded model string outside the catalog module; dated prices reconcile a historical receipt against the catalog version it recorded. |
| Effort and speed | Moving either dial one position changes at least one visible field on the Plan Receipt; a receipt's recorded effort equals the level the backend reported applying; a backend that cannot honour a level declares it rather than silently ignoring it; org ceiling downgrades are visible and reasoned; a task shows what it inherited and from where; Cortex cannot self-raise effort without consent, and a self-lowering is recorded. |
| Forecast and cap | A cap is enforced at the sandbox boundary and cannot be exceeded by an agent's own behaviour; reaching the cap stops and asks rather than continuing or abandoning; every forecast joins to an actual by prediction ID; a cold class refuses to emit a narrow forecast; forecast-vs-actual drift raises an alert; class graduation to fixed pricing requires the measured variance threshold. |
| Concurrency | Two leaves with overlapping write sets are never scheduled concurrently, and the Plan Receipt states the limiting resource; lease acquisition is atomic and canonically ordered under induced contention; a conflicting step queues with the holder visible rather than failing; a crashed holder's lease is reclaimed; a hotspot edit deferred to integration is deterministic across repeated runs. |
| Integration | Sequential rebase integrates N branches with a defined order; the full battery re-runs against the integrated tree; an induced semantic conflict that both branches individually passed is caught at integration; integration failure produces a fresh-context re-plan rather than a stuck run or a continued transcript. |
| Flake defence | A non-deterministic check is quarantined rather than failing a paid task; a consistently broken check still fails it; quarantined outcomes never reach router reward, professional records, or forecast calibration; the receipt names every quarantined check. |
| Edge verification | A repo with no tests reaches verifiability through a characterization task; a partially blocked run delivers and bills its verified leaves; a receipt states its re-execution window and flags time-dependent checks; a suite needing a database verifies with a digest-pinned sidecar and no public egress; sidecar provisioning failure yields `inconclusive`, never `failed`. |
| Scope boundaries | A multi-repo plan states which side is verified and which asserted, and never claims a system-level verdict from component checks; monorepo checks derive from the build graph and the forecast uses affected-target count; a declined shape is declined at intake with a reason, not at the cap. |
| Operational | A post-delivery revert registers as a missed signal; a mid-run question pauses budget and clock and reaches every surface; a thrashing agent is stopped and reported as thrashing rather than as needing a larger cap; Cortex never bypasses a branch-protection rule it holds credentials to bypass. |
| Provenance and injection | An `inferred` item never renders downstream without origin and confidence; a `verified` item survives compaction intact; agent-directed text planted in a README, a code comment, a test fixture, a dependency changelog, and an issue body produces findings and zero behaviour change; a plan assumption with a mechanical check is executed before approval; context composition by type is recorded per attempt. |
| Collaborative planning | Two plans with overlapping write sets notify both owners before approval; a semantically divergent pair in the same subsystem is surfaced without blocking; duplicate plans are detected; a base-commit move re-executes exactly the affected assumptions and flags only the broken plans; an advisory reservation expires and never wedges a project; a viewer without permission sees a path-level notice and no plan content; the solo path emits no coordination UI at all. |
| Knowledge packs | Every entry has a citation and a retrieval date, enforced at publish; a stale entry stops asserting and dispatches a research task; live research enters as `researched` and cannot self-promote into a pack; a pack-derived expectation contradicted by the repository flags the pack rather than failing the repo; a derived check traces to the entry that justified it; a human disposition recorded in one org cannot alter a global pack. |
| Professionals and policy | A published version is immutable and keeps resolving after a newer one exists; a personal fork cannot affect an org's pinned version; a receipt names exact professional and policy versions; a `block` policy actually blocks and a waiver is attributed, expiring, and on the receipt; a deliberately noisy professional is down-weighted; a redundant seat is dropped by the complementarity matrix; the no-panel control arm produces a comparable escape rate. |
| Routing economics | Reward carries total attempt-chain spend including verification; the always-strongest-model champion baseline is computable at any time; escalation respects per-receipt depth caps; a forbidden provider is never routed to, including on escalation. |
| Intake | Low-confidence input produces a question rather than a dispatch; a rich multi-clause one-shot request decomposes instead of erroring; the deterministic classifier and the `TaskFrame` are compared and disagreement lowers confidence. |
| Authorization and tenancy | Cross-org read/write isolation on every owned object; role matrix enforced at the API, not the UI; deprovisioning kills live sessions and capability grants; audit export completeness against a scripted action sequence. |

## Deliberately deferred

- New model providers, model breadth, and provider failover.
- Autonomous deploys and broad GitHub write permissions.
- Multi-agent hierarchy, manager personas, and decorative live-map polish.
- Horizontal scaling before the durable job/leader/data-plane work is complete.
- Outcome-pricing marketing before quotes, reservations, and receipt-linked
  settlement are live.
- Replacing the Rust core or performing a premature microservice rewrite.
- Desktop and iOS clients. Phase 10 spends nothing on them now beyond keeping the
  API and event contract clean, which is worth doing on its own merits.
- SCIM, until a named customer asks for it.

## Deliberately rejected

Distinct from deferred: these should not be built later either, and the reasons
should survive the next time they come up.

- **A user-facing model picker.** VISION.md is explicit that Cortex is not a model
  gateway. A picker commoditises the product and locks Cortex out of changing
  models underneath. The effort dial exists precisely so this is unnecessary.
- **A prose architecture corpus.** Not because encoded engineering knowledge is
  worthless — Phase 8.4 argues at length that it is valuable and should be built —
  but because prose is the one form that cannot be executed, scored, or audited.
  Templates, batteries, and rubrics keep everything valuable about the instinct.
- **A fixed price per task class before its variance is measured** (Phase 6.4).
  Run-to-run cost variance on identical tasks is 3×–30×; quoting a fixed number
  into that distribution is a bet, not a price. Classes graduate to fixed pricing
  by earning it.
- **Asking a model to estimate its own cost.** Published forecasting work finds
  models systematically underestimate token usage across the board. Forecast from
  Cortex's own run history instead.
- **Unbounded parallel writers.** Width is bounded by the dependency graph and
  proven disjoint at plan time. "Deploy 100 agents at a coupled module" is not a
  capability anyone has; promising it would be the one claim in this product that
  cannot be backed by a receipt.
- **Multi-model debate or consensus layers, at any effort level.** Rejected on
  measured grounds in RESEARCH-2026-08 §3: premature-consensus collapse and
  76–89% problem drift in long debates. `ultra` buys more evidence, not more
  opinions.
- **LLM evaluator gates that grade quality between phases.** "Models propose,
  never grade" holds everywhere, including at maximum effort.
- **Silent effort downgrades.** If a ceiling or a backend limitation reduces the
  requested level, it is shown with a reason. A dial that quietly does nothing is
  worse than no dial.

## Decisions — resolved, with defaults

**Nothing in this document blocks on an unanswered question.** Every decision
below carries a **decided default**: the implementer proceeds on it without
waiting. Josh can override any of them, and an override is a small change
because each default names exactly what it touches.

Three are marked **[business risk]** — the engineering is unblocked either way,
but the choice reflects appetite rather than evidence, and should be confirmed
before money moves.

| # | Decision | **Decided default** | Touches |
|---|---|---|---|
| 1 | Pricing model **[business risk]** | **Build the mechanism, defer the policy.** The quote schema carries forecast, cap, quoted amount, and actuals — enough to express fixed pricing, a capped range, or a cold estimate. Which policy is live per task class is a config decision made once PR Q has measured the distribution. Amend CREDITS.md to say exactly this before PR F. | PR Q, PR F |
| 2 | Graduation threshold | A class graduates to fixed pricing when **p95/p50 ≤ 1.5 over ≥ 200 runs**; Cortex absorbs the tail. Below that, quote a capped range. | PR Q |
| 3 | Launch trust model | **Private alpha → operator-hosted single-tenant → multi-tenant.** Sandbox (PR C) is required for all three. | PR C, PR AE |
| 4 | Outcome-corpus consent | **Opt-out, de-identified, aggregate-only, never cross-customer for human dispositions** (invariant 20). Written basis published before the first customer task. | PR D, PR AE |
| 5 | Two-dial design **[business risk]** | **Ship it.** Effort `low·medium·high·xhigh·ultra` × Speed `patient·normal·urgent`, cost as the displayed consequence. Validate with design partners before PR K freezes the surface. | PR K, PR AA |
| 6 | Speed dial in v1 | **No.** Effort dial ships first; speed dial waits for PR R and PR S. A speed dial on today's concurrency model would be unsafe. | PR K, PR S |
| 7 | Default envelope | Floor `medium`, ceiling `xhigh`, speed `normal`. `ultra` and `urgent` opt-in per task. | PR K |
| 8 | Sandbox network policy | **Default deny.** Allowlist only dependency-resolution hosts per ecosystem, recorded in the receipt. | PR C |
| 9 | First proof workflow | **One developer, one repo, one approved task, one PR, one verified receipt.** Greenfield demo is the *second* proof. | — |
| 10 | Human override policy | Only `maintainer`+ may override a failed verdict; an override **can never release a PR automatically**; it is labelled on the receipt, priced as a normal charge, and audited. | PR F, PR N |
| 11 | Design partners | **Three segments, two each**: solo builder, 2–3 person team, platform team at a large org. Recruit before PR K. | PR AA |
| 12 | First method-library entries | **Two L2 batteries first** — web/API security review and dependency upgrade. Archetypes follow only if the batteries clear the falsification test. | PR O |
| 13 | First professionals | **Two, both read-only reviewers**: Rust and web/API security. Promotion only through PR P. | PR T |
| 14 | No-panel control arm | **10% of eligible changes.** Lowering it is a governance change, not an optimisation. | PR T |
| 15 | Panel budget ratio | **Review may not exceed 25% of a task's forecast.** Enforced, not advisory. | PR T |
| 16 | Knowledge-pack curation | **One pack, curated properly** (web/API security), with citation and half-life rules enforced at publish. Expand only on measured lift. | PR O |
| 17 | Team credit model | **One org pool, budgets as ceilings, no per-developer wallets.** Auto-recharge on threshold. | PR AD |
| 18 | Packaging **[business risk]** | **No per-seat fee for access.** Credits for work; an org-level platform tier for governance (SSO, SCIM, audit, policies, self-host). | PR AD |
| 19 | Spend authority | Any member approves to **50 credits**; `maintainer` to **500**; `admin` above. Org-configurable. | PR AD, PR N |
| 20 | Editor strategy | **Extension, not a fork.** Publish to Open VSX *and* the Microsoft Marketplace. MCP for agent-level integration. No inline completion, no BYOK. | PR AF |
| 21 | Free-tier scope | **Local checks, verification overlay, estimates, plan drafting, repo insight.** Nothing that calls a model. | PR AF |
| 22 | API versioning | **Explicit version, one previous version supported, additive-only within a version**, published deprecation window. | PR AC |
| 23 | Open source | **The extension and the check batteries are open; the orchestrator, verifier, and corpus are not.** Batteries being auditable is a trust asset; the corpus is the moat. | PR O, PR AF |

### The three that genuinely deserve Josh's confirmation

- **#1 pricing.** The engineering is identical either way — a cap is a cap — so
  the *schema* is not a business decision and should be built now. What differs
  is who absorbs variance once real numbers exist. See the note below on why
  fixed pricing should not be written off.
- **#5 two dials.** Argued from system structure, not user evidence. Cheap to
  confirm with design partners; expensive to reverse after PR K.
- **#18 packaging.** The no-per-seat recommendation trades predictable revenue
  for adoption velocity. That is a strategy call, not a technical one.

Everything else should simply proceed.

### Why CREDITS.md should be amended — and amended narrowly

**Amend it. But not to assert the maturity ladder.**

The published variance evidence (3×–30× on identical tasks) is real, but it
measures systems that *cannot bound their own spend*. Cortex can: the cap is
enforced at the sandbox boundary, and a task that cannot finish inside its budget
becomes a failed verification, which is already refunded. **Variance is not
imposed on Cortex; Cortex chooses how much of it to absorb.** That means fixed
pricing — the better customer experience, and what VISION.md promises — is not
disproven by that evidence and should not be written off on it.

What is genuinely unknown is the *distribution*: what fraction of real tasks
would blow through a fixed budget. At 5% the fixed model is comfortable; at 40%
it collapses. Only PR Q can answer that, and it can only answer it in production.

So the amendment should do three things and stop:

1. **Keep the unit.** A credit remains a verified task, integer-denominated,
   never tokens. Nothing about that changes.
2. **Name the mechanism.** Every quote carries a forecast, a hard cap, a quoted
   amount, and settled actuals. That schema expresses fixed pricing, a capped
   range, and a labelled cold estimate without alteration.
3. **Record that the policy is measured, not asserted.** Which of the three is
   live for a given task class is a configuration decision made against PR Q's
   data, with a stated threshold for graduating a class to fixed pricing.

This is a smaller, safer change than replacing the pricing model outright. It
leaves the refund logic and ledger design untouched, it unblocks PR F
immediately, and it avoids making a business decision now that will be much
better informed in six weeks.

**Correction to an earlier revision of this plan**, which recommended amending
CREDITS.md to assert the maturity ladder as the pricing model. That went further
than the evidence supports and would have foreclosed the better option.


## The numbers that say Cortex is actually best

A plan without a scoreboard drifts. These are the metrics that decide whether the
work in this document produced the product it claims — instrumented from the
first PR that can produce them, not added at the end.

**Correctness and trust**

| Metric | Why it decides something | Target posture |
|---|---|---|
| Verified pass rate, per task class | The core claim | Rising; published per class |
| **UNVERIFIED rate**, per class and ecosystem | The refund promise collapses if checks cannot be derived for real work (RESEARCH rec 6) | Falling; gates which classes the guarantee is marketed on |
| Human rejection rate of *verified* results | The only signal that catches teaching-to-the-test | Low and stable; a rise means the checks are being gamed |
| Stranded verification jobs | Phase 1's whole purpose | Zero, alerting |
| Sandbox escape attempts blocked / succeeded | Phase 0.1 | Any success is a stop-everything incident |

**Economics**

| Metric | Why it decides something | Target posture |
|---|---|---|
| **Credits-per-verified-task COGS**, per class × model × dial | Under outcome pricing this *is* gross margin | The headline operator number |
| Router cost vs. always-strongest-model champion | A miscalibrated router costs 3× (VISION.md) | Router must beat baseline or be switched off |
| Forecast **coverage** (quantile hit rate) | A cap that is exceeded is a broken promise | p95 exceeded <5%, alerting |
| Forecast **sharpness** (interval width) | Wide intervals have perfect coverage and no value | Narrowing over time; shown to users |
| Cap-hit rate | Frequent caps mean bad forecasts, not disciplined users | Low; a rise is an estimator incident |
| Escalation rate and retry depth | Cortex eats escalation cost, so this is margin | Falling as the router learns |

**Throughput**

| Metric | Why it decides something | Target posture |
|---|---|---|
| Achievable vs. realised parallel width | Phase 11's payoff | Gap closing |
| Lease wait time, p50/p95 | Whether conflict-freedom actually helps or just blocks | Low |
| Integration failure rate, and semantic conflicts caught at integration | The value of Phase 11.4 | Catches >0 — if it never fires, it is not being tested honestly |
| Wall-clock to verified result, by speed position | The speed dial's entire justification | `urgent` must be measurably faster or the dial is a lie |

**Product**

| Metric | Why it decides something | Target posture |
|---|---|---|
| Time to first approved plan | The onboarding cliff | Minutes, not a session |
| Plan revision count before approval | High means intake is guessing (Phase 8.1–8.2) | Low; re-planning is always free |
| Run abandonment rate | The honest measure of trust | Falling |
| Receipt open rate | Whether the evidence is actually wanted | If near zero, the wedge is not landing and that is worth knowing early |
| Method-library and professional **lift over baseline** | Phase 8.4 and 12's falsification tests | Positive, or the entry is retired |

### The bar for external user testing

Since real external testing is the near-term goal, state its entry gate
explicitly rather than discovering it during the first session:

1. **PR C merged.** No untrusted code executes on the worker host. This is
   non-negotiable and is the only item on this list that is a safety matter
   rather than a quality one.
2. **PR A + B merged.** Nothing is called done before it is independently
   verified, and a crash cannot strand a verdict.
3. **PR Q merged.** Every run carries a forecast and an enforced cap. No external
   user should ever be exposed to uncapped spend.
4. **Fabricated data removed** — `defaultMembers` and the fail-open evidence gate
   (`taskManager.ts:116-130`, `:426-442`). A tester who sees invented teammates
   stops trusting everything else on the screen.
5. **The transparency contract (6.6) live** for at least the choose-and-run
   moments. A tester who cannot see what something will cost cannot give useful
   feedback about whether it is worth it.
6. **One rehearsed end-to-end path** — the Phase 8 decision-8 proof workflow —
   executed successfully by someone who did not build it.
7. **PR U merged.** External testers point Cortex at repositories nobody at
   Cortex has read. Repository content is untrusted input, and until the
   instructions-come-only-from-the-contract rule is enforced, every external test
   is an unreviewed injection surface. PR U is small and it is not optional
   before outside repos are involved.

Everything else in this document can arrive after real users do. Those seven
cannot.

## Definition of "beyond state of the art"

Cortex is not better because it has more agents or more dashboards. It is better
when a developer can delegate a scoped change with the same confidence they have
in a careful teammate: the runtime is contained; the authority is explicit; the
plan and price are known before work begins; the result is independently proven
on an immutable tree; failure is recoverable and transparent; the receipt,
diff, and ledger agree; and the router learns only from those facts. Everything
in this plan exists to make that claim mechanically enforceable.

Track B adds the second half of that sentence. Confidence is necessary but a
developer also has to *want* to delegate. That happens when Cortex scopes the
work the way a senior engineer would, asks the one question that actually
matters instead of guessing, spends the least money that will still pass, proves
it, and lets a team put governed limits around all of it. The dial is the visible
surface of that promise, which is why it must never be decoration: it is the
customer's only handle on how much engineering they are buying.

Five claims Cortex can defend that no competitor currently can. Every one of them
descends from the same asset — Cortex runs the checks, so Cortex has verdicts:

- **Escalation on an executed verdict, not a confidence proxy.** Every published
  cascade router escalates on the model's own estimate of whether it did well.
  Cortex escalates on whether the tests passed.
- **Thorough *and* fast.** A single model must trade depth against latency.
  An orchestrator with a verifier can race N deep attempts and keep the first
  that passes. The two-dial design is not a UI choice — it is a capability
  competitors structurally do not have.
- **A forecast that improves with use.** Models systematically underestimate
  their own cost. Cortex forecasts from measured history and joins every
  prediction to an actual, so the cap gets tighter the more it is used.
- **Evidence-graded engineering method.** A method library whose templates carry
  measured pass rates, costs, and rework rates — where losing templates are
  retired rather than defended. A wiki cannot be graded. This one can, and can be
  published with its scores.
- **Parallelism with an honest ceiling.** Cortex runs as wide as the dependency
  graph allows, proves disjointness before dispatch, re-verifies the integrated
  result, and explains what is limiting the width. That explanation is
  architectural feedback about the codebase — a new thing to get from a coding
  tool.
- **An expert panel whose disagreements are settled by running the code.** Every
  published panel or debate system resolves expert disagreement with another
  model's opinion, and the measured result is sycophancy and drift. Cortex
  resolves it by execution — which lets it do the thing no AI review system can:
  learn what each expert **reliably catches and reliably misses**, and select
  panels for **measured complementarity** rather than agreement. A panel seat
  becomes a purchasing decision with a known yield.
- **Context that knows what it knows.** Every other harness flattens a test
  result, a file excerpt, a user's requirement, and a model's four-steps-ago
  guess into one undifferentiated prompt — so an early guess becomes an
  unexamined premise, and a README can issue orders. Cortex types context by
  provenance, refuses to render inference as fact, and converts its own
  assumptions into checks. Only a system that already owns a category of
  *executed* truth can do this, and it contains error propagation and prompt
  injection with the same mechanism.

## Where this plan is weakest

The document now covers, end to end: execution safety and sandboxing; a truthful
state model; durable verification; pricing, forecasting, and caps; routing
economics and the model catalog; intake, decomposition, and the method library;
parallel execution, conflict-freedom, and integration; professionals, packs, and
the expert panel; provenance and injection resistance; collaborative planning;
organisations, roles, budgets, and policy; production hardening; headless access
via API, CLI, and MCP; the frontend from primitives to polish; the free editor
extension; and launch operations. Every decision carries a decided default, so
no PR waits on an answer.

Every plan of this size still has soft spots. Hiding them produces a document that
reads well and fails in contact with reality, so they are listed here — but
**sorted by what you can actually do about them**, because the three kinds need
opposite responses.

### A. Fix before actualizing — these are cheap now and expensive later

Weaknesses caused by *missing work*, not missing information. Do these first.

| Weakness | Fix | Cost |
|---|---|---|
| **CREDITS.md contradicts Phase 6.4** on what a credit is. An implementer reading one doc builds a fixed price list; reading the other builds a cap-and-actuals schema. Two different schemas. | Amend CREDITS.md as described in decision 1 — separate *mechanism* from *policy*. | ~1 hour, doc only |
| **Effort semantics are uncalibrated across providers.** Anthropic's `effort` and OpenAI's `reasoning_effort` are not the same scale, and CLI backends may expose neither. Mapping them by name similarity would make the dial lie. | Write the calibration protocol into PR K's brief: a fixed eval set run at each level per provider, mapping by *measured* token spend and quality, not by label. | Half a day of design, before PR K |
| **`ExecutionJob`'s field set is the narrowest waist in the system** and is specified in prose, not as a type. | Write the struct — actual Rust, in PR C's brief — and review it before implementation starts. Re-cutting it later touches every phase. | Half a day |
| **The state machine in Phase 0.2 is a diagram, not a specification.** Legal transitions, guards, and terminal states are described but not enumerated. | Produce the transition table in PR A's brief. Every cell is a test in the Phase A matrix. | One day, and it *is* PR A's design work |

### B. Cannot be resolved before actualizing — instrument and revisit

These are not gaps in the plan. **The missing input is production data**, and no
amount of further planning produces it. Trying to "fix" these first means never
starting.

- **The forecast has no data.** Phase 6.5's estimator needs an empirical
  distribution Cortex does not have. The cold-start path is designed; the first
  weeks will be wide labelled estimates. *Response:* ship the mechanism, show the
  interval honestly, and let it narrow visibly — that narrowing is itself a trust
  artifact.
- **`p_c` and `c_v` in Phase 7.3 are unmeasured.** The escalation formula is
  correct; its inputs are placeholders and the worked examples are illustrative.
  *Response:* PR J instruments them before any routing policy change is trusted.
- **The panel's precision and complementarity matrices need volume.** Precision
  per (professional × finding type × ecosystem) is many cells. *Response:* run
  the first professionals on coarse global precision and priors; do not let the
  elegance of the target design delay shipping two useful read-only reviewers.
- **No user research backs the progressive-disclosure position or the two-dial
  design.** Both are argued from system structure. *Response:* the design-partner
  protocol (Phase 10.3) tests them *during* PR K rather than gating its start —
  the data contract behind the dials (Phase 6.6) is fixed either way, so only the
  visual treatment is at risk.

### C. Process risks — no document can fix these

These fail through *discipline*, not through *design*. Writing more plan does not
help; only a gate that someone actually enforces does.

- **The method library could become a wiki with extra steps.** The falsification
  test in Phase 8.4 only works if it is enforced the first time a template fails —
  which is precisely when keeping it will feel reasonable.
- **Phase 12 is the easiest phase here to fake.** Every other phase fails loudly
  when done badly; a bench of personas that changes nothing demos beautifully and
  is worthless. The `outcome_record` requirement and the retirement rule are the
  only defence, and both are commitments rather than code.
- **Semantic conflict detection (14.4b) will produce false positives.** Ship it
  advisory, measure the false-positive rate, and be genuinely willing to turn it
  off — a coordination signal developers learn to ignore is worse than none.

**Mitigation for all three, and it is the same one:** each has a numeric gate in
the scoreboard. Put the gate in the PR's done-criteria, and make failing it mean
*delete the feature*, not *write a follow-up ticket*.

### Resolved since the previous revision

Kept visible so nobody re-raises them:

- ~~Track A's `ws.rs` / `db.rs` line references were never independently
  re-read.~~ **Verified.** `complete_step` (`ws.rs:472`) runs before the
  verification spawn (`ws.rs:521`); `quoted_credits: None` is at `ws.rs:517`;
  `finish_verification` (`db.rs:11397`) only updates `verification_runs` and
  transitions nothing. Track A's evidence table is accurate.
- ~~Onboarding is unspecified.~~ Specified in Phase 10.4 and Phase 18.5.
- ~~Customer secrets, provider outage, data deletion, abuse, and planning-cost
  attribution are unspecified.~~ **All five are now Phase 15.**
- ~~The provider-subscription credential flow is still live in the backend.~~
  **Removed** — see the commit history for this branch.

### What is still genuinely not covered

The five areas listed in the previous revision — multi-repo and monorepo scale,
long-running and stateful workloads, non-code deliverables, non-Linux targets,
and competitive response — are now Phases 25 and 26. What follows is what is
left after that round, and it is deliberately short.

- **Data residency by region.** Enterprise buyers in the EU will ask for
  processing confined to a region, which constrains both provider routing and
  where the sandbox runs. Phase 9.4's self-host tier partly answers it; a hosted
  regional deployment does not exist in this plan.
- **Non-English codebases and mixed-language teams.** Identifiers, comments,
  commit messages, and requirements in other languages. Nothing here is
  English-specific by design, but nothing has been tested either, and intake
  (Phase 8.1) is the most likely place it breaks.
- **A third-party marketplace for packs and professionals.** The natural
  extension of Phase 12 — an ecosystem where a security firm publishes a graded
  pack. Genuinely attractive, and deliberately out of scope until the first-party
  bench has proven the grading mechanism actually works.
- **Fine-tuning on the outcome corpus.** Deliberately not proposed. The corpus is
  worth more as routing, forecasting, and grading signal than as training data:
  fine-tuning would couple Cortex to one base model, invite contamination between
  the training set and the evaluation set, and trade a durable advantage for a
  temporary one. Revisit only with a specific measured case.
- **Pricing experimentation.** Whether to A/B pricing, and how to do that
  ethically when the ledger is the trust artifact, is unaddressed.

### The completeness claim, stated precisely

This document specifies the mechanisms Cortex needs from its current state to a
professional, externally testable product across backend, frontend, headless
access, and operations. Every decision carries a decided default; every claim
about the current code carries a `file:line`; every phase carries an exit gate.

It does **not** claim that no further gaps exist. Three rounds of review have each
found real ones — the last round found flaky tests, brownfield verification, and
partial delivery, any of which would have hurt in production. **A fourth review
should be expected to find more, and the right response is another round rather
than confidence.**

## Sources for Track B

- Effort as a first-class provider parameter, level semantics, and the
  prompt-caching interaction: [Claude effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort)
- Cost-aware cascades and learned routing (FrugalGPT, RouteLLM, and the 2026
  cascade literature): [Dynamic model routing and cascading survey](https://arxiv.org/html/2603.04445v2),
  [Cluster, Route, Escalate](https://arxiv.org/html/2606.27457)
- Cost-per-resolved-instance reporting as part of benchmark design rather than an
  appendix: [SWE-bench Verified frontier leaderboard, 2026](https://contracollective.com/blog/swe-bench-verified-frontier-models-leaderboard-2026)
- Enterprise procurement ordering (RBAC → audit → SSO → SCIM), named-identity
  requirement, and BYOC/self-host expectations:
  [Enterprise AI coding agent deployment](https://northflank.com/blog/enterprise-ai-coding-agent-deployment),
  [Enterprise-ready SaaS ordering](https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs)
- Context-grounded spec-driven workflows and the drift/staleness problem with
  hand-maintained instruction files: [Spec Kit Agents](https://arxiv.org/abs/2604.05278)
- Agent cost variance (3×–30× on identical tasks), systematic model
  underestimation of token usage, and forecast-to-actual calibration via
  prediction IDs: [How Do AI Agents Spend Your Money?](https://arxiv.org/pdf/2604.22750),
  [Agentic AI inference cost](https://www.spheron.network/blog/agentic-ai-inference-cost-2026/),
  [token budget enforcement as the primary runaway-spend control](https://waxell.ai/blog/ai-agent-token-budget-enforcement)
- Worktree isolation, sequential one-at-a-time merge as the best integration
  strategy for parallel agent branches, hotspot files, and the finding that a
  clean textual merge does not imply semantic correctness:
  [Running parallel AI coding agents](https://superset.sh/blog/parallel-coding-agents-guide),
  [AgenticFlict: merge conflicts in agent PRs](https://arxiv.org/pdf/2604.03551),
  [multi-agent coding workspaces](https://www.augmentcode.com/guides/how-to-run-a-multi-agent-coding-workspace)
- Externalised behavioural knowledge as an inspectable, governable, revisable
  artefact independent of the model — the argument that settled Phase 8.4:
  [Harnessing Agent Skills](https://arxiv.org/html/2606.20631v1)
- MAST specification-failure share, VeriMAP, multi-turn degradation, context rot,
  and the debate-drift results are all catalogued with citations in
  [RESEARCH-2026-08.md](RESEARCH-2026-08.md) — that doc is the source of record
  for them; this plan does not restate the evidence.
