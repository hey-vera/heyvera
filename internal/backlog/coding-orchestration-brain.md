# Coding Orchestration Brain — ClawNet Wedge Into Trusted Agent Work

**Status:** Backlog / candidate wedge. Not on the active build queue yet.
**Date:** 2026-04-10
**Thesis:** AI routing alone is not the moat. But a coding-focused orchestration layer can be the fastest way to pressure-test ClawNet's real moat: trust, identity, verification, delegation, and Soma-native execution.

**Why backlog, not active:** for personal day-to-day work, subscription-based usage is currently the more budget-efficient path than API-heavy orchestration. This stays in backlog because it is still strategically interesting and may become timely later, but it is not the best immediate personal-work investment.

---

## Why this exists

We want to answer a practical question before overbuilding:

**Does a smart semi-automatic multi-brain coding workflow outperform a single premium coding model enough to matter?**

If yes, ClawNet should not compete as "just another coding copilot." It should become:

- the trusted control plane for coding agents
- the policy layer for multi-model execution
- the verification layer for agent-delivered work
- the provenance layer for "who changed what, under what authority, with which model, at what cost"

This makes coding an ideal wedge:

- immediate painkiller
- easy to benchmark
- naturally tool-using
- naturally budget-constrained
- naturally trust-sensitive

If the wedge works, the same primitives generalize to research agents, language agents, browser agents, and delegated work across networks.

---

## Product framing

This is **not** "ClawNet becomes an IDE."

This is:

**ClawNet Code = trusted coding-agent orchestration**

One user task fans into multiple execution roles:

- planner
- implementer
- reviewer
- verifier

ClawNet decides which model handles which role, under explicit policy:

- budget caps
- allowed providers
- allowed tools
- approval thresholds
- workspace/repo scope
- delegation depth

The user experiences one assistant. Under the hood, the work may be split across multiple models and sub-agents.

The important product point:

- the user should **not** manually decide "use model A for this prompt and model B for that prompt"
- the system should route automatically from an explicit model profile
- the routing should become better over time from outcome data

---

## Why this is strategically useful even if routing commoditizes

Routing logic will get copied. Native providers will improve. Frontier coding agents will become more autonomous.

The durable value is elsewhere:

- scoped identity for sub-agents
- spend-limited delegated capabilities
- Soma-signed execution traces
- verifiable tool/action history
- receipts for delivered work
- trust queries over agent outcomes
- future computation witness / proof mining

So this feature should be built as a **Soma-native proving ground**, not as a standalone forever-business thesis.

---

## The smallest believable version

### v0 — Benchmark before product

Before building a full coding product, prove that a routed workflow is materially better than one-model usage.

Test matrix:

- GPT/Codex only
- Claude only
- semi-automatic hybrid router

Benchmark on 10-20 real tasks:

- bug fix
- failing test repair
- medium multi-file feature
- refactor
- review-and-improve pass

Measure:

- success rate
- retries required
- tests passed
- time to completion
- human-rated code quality
- human-rated architectural judgment
- cost/spend

**Exit criterion:** the semi-automatic router wins clearly enough that users would tolerate setup friction or pay for orchestration.

If the router does not clearly win, do not escalate this into a major product initiative.

---

## Build order

### Phase 1 — Local benchmark harness

Build a ClawNet-owned benchmark runner for coding tasks.

Core outputs:

- task manifest
- prompts by role
- result capture
- test command execution
- scorecard
- cost and retry logs

Suggested implementation:

- `src/core/code-bench.ts`
- `src/routes/code-bench.ts`
- `internal/active/code-bench-results-*.md` for experiments

This is intentionally narrow. The goal is not end-user polish. The goal is evidence.

### Phase 2 — Semi-automatic orchestration runtime

Implement a simple role-based workflow:

- `plan` -> strongest reasoning model
- `execute` -> strongest tool-using model
- `review` -> independent model or cheaper second pass
- `verify` -> tests, lint, typecheck, diff heuristics

No opaque autonomy yet. Start deterministic, inspectable, and policy-driven.

The router should make decisions automatically from a visible profile of model strengths and weaknesses.

Minimum system pieces:

- task session object
- per-role provider selection
- routing rationale log
- transcript log
- workspace/tool policy
- verification summary

Suggested implementation:

- `src/core/code-orchestrator.ts`
- `src/core/code-policy.ts`
- `src/routes/code.ts`

### Phase 3 — Soma-native execution

Route every model phase through Soma when available.

Requirements:

- planner/implementer/reviewer calls use `heart.generate()` first
- task session stores generation provenance per phase
- final response emits Soma headers
- delivered result can mint a Soma receipt

This gives us something no generic coding wrapper has:

- signed record of model-phase execution
- explicit identity for the orchestrator
- future ability to attest delegation and policy compliance

### Phase 4 — Delegation + capability controls

Map coding sub-agents onto Soma delegation primitives.

Needed capabilities:

- `tool:read`
- `tool:edit`
- `tool:test`
- `tool:git`
- `tool:network`
- `model:plan`
- `model:execute`
- `model:review`
- `spend:max`
- `repo:scope`

Each spawned sub-agent should get a narrower budget and permission envelope than the parent session.

This is where ClawNet starts becoming the trusted control plane rather than just the router.

### Phase 5 — Real product surface

Only after benchmarks and runtime validation:

- CLI first
- optional editor integration later
- dashboard for logs, costs, approvals, and receipts

Do not start with a complex hosted UX.

---

## Soma integration thesis

This should run through Soma from day one where possible.

Why:

- coding work is exactly the kind of high-value delegated computation that benefits from provenance
- if a coding agent edits files or spends budget, we should know which identity and policy authorized it
- coding is a good proving ground for future computation witness / attestation economics

Soma responsibilities here:

- execution identity
- signed model generation provenance
- delegated capability constraints
- task receipts
- later: third-party verification of delivered work

Initial Soma fit:

- use existing `heartLlmComplete()` path for role-based LLM phases
- attach provenance to code-task responses
- mint receipts for completed tasks or benchmark runs

Future Soma fit:

- delegated coding workers with branch spend caps
- proof that a task stayed within policy
- proof that a claimed review actually happened
- proof-mining / witness markets for delivered software work

---

## What we should not do first

- do not start with multi-provider account linking complexity
- do not build consumer-subscription pooling
- do not start with a polished SaaS UI
- do not promise "best coding AI on earth" before benchmarking
- do not generalize to every agent category before coding shows signal

---

## Commercial paths

### Path A — Self-hosted wedge

Ship as:

- local CLI
- self-hosted orchestrator
- BYOK or local provider auth

Pros:

- fastest validation
- lower trust friction
- easier launch

Cons:

- weaker moat by itself

### Path B — ClawNet premium layer

Later add:

- hosted task logs
- policy management
- receipts
- trust analytics
- shared memory
- remote runners

Pros:

- stronger moat
- fits ClawNet's core strategy

Cons:

- only worth doing after the wedge proves demand

**Recommendation:** start with Path A mechanics, but architect it so Path B can absorb it cleanly.

---

## Success criteria

This graduates from backlog to active only if:

1. Hybrid coding workflow beats single-model workflow on real tasks.
2. Soma provenance adds meaningful product value, not just novelty.
3. We can explain why ClawNet should own this instead of generic coding wrappers.

If all three are true, promote to `internal/active/` and scope a 2-week implementation sprint.

---

## Router intelligence model

The first version should be **semi-automatic**, not manual and not a black box.

### Stage 1 — Prior-driven routing

The system starts with explicit assumptions about model strengths and weaknesses.

Example priors:

- stronger planner
- stronger implementer
- stronger reviewer
- cheaper classifier
- weaker on long diffs
- weaker on architectural cleanup
- more reliable with terminal/tool use

The user does not pick the phase routing by hand. The system does.

### Stage 2 — Outcome-aware adaptation

The system records task outcomes and learns where its assumptions are right or wrong.

Things to learn:

- which model wins by task type
- which model wins by language / repo shape
- when review is worth paying for
- when single-model flow is enough
- when a model's failure pattern suggests escalation

### Stage 3 — Limitation-aware routing

The system should eventually know and work around its own limits.

Examples:

- trigger planning before execution on ambiguous tasks
- force independent review on risky diffs
- decompose tasks when context load is too high
- avoid expensive review when prior evidence says it adds little
- reroute when provider rate limits or degraded quality are detected

This is the actual "brain" thesis:

**ClawNet stores a living model of model limitations and uses it to improve coding outcomes over time.**

---

## First concrete next steps

1. Create a benchmark corpus of 10 real coding tasks from ClawNet and adjacent repos.
2. Implement a minimal benchmark runner that stores prompts, outputs, verification, and scores.
3. Implement a semi-automatic router with explicit prior assumptions about each model.
4. Compare three paths: GPT-only, Claude-only, semi-automatic router.
5. If the router wins, build the Phase 2 runtime and wire it through Soma.

---

## Phase 1 checklist — benchmark harness

This is the next-project entry point. Keep it small enough to finish quickly and useful enough to drive a go / no-go decision.

### 1. Define the benchmark corpus

- [ ] Pick 10 tasks from real ClawNet work, not toy prompts
- [ ] Ensure task spread: bug fix, failing tests, refactor, feature slice, review-improve
- [ ] Write each task as a stable fixture with:
  - task id
  - repo path
  - starting branch/commit
  - allowed files or directories
  - success criteria
  - verification commands
- [ ] Add 2-3 "hard mode" tasks that require multi-file reasoning
- [ ] Exclude tasks that depend on unavailable external services or unstable secrets

### 2. Define the scoring rubric

- [ ] Track binary success/failure
- [ ] Track verification pass rate: tests, lint, typecheck
- [ ] Track retries needed
- [ ] Track wall-clock completion time
- [ ] Track estimated provider/model cost
- [ ] Track human review score for:
  - code quality
  - architectural judgment
  - unnecessary complexity
- [ ] Define a single weighted score so results are comparable

### 3. Build the benchmark manifest format

- [ ] Create a manifest schema for benchmark tasks
- [ ] Store manifests under a dedicated folder, e.g. `data/code-bench/`
- [ ] Include prompt template fields for:
  - task summary
  - repo context
  - constraints
  - verification commands
  - scoring notes
- [ ] Include a place to record expected human setup steps if any

### 4. Build the benchmark runner

- [ ] Add `src/core/code-bench.ts`
- [ ] Support loading a manifest and running one benchmark session
- [ ] Record:
  - model/provider path used
  - prompts
  - outputs
  - timestamps
  - verification results
  - final score inputs
- [ ] Write results as durable JSON/Markdown artifacts
- [ ] Ensure runner can compare:
  - GPT-only
  - Claude-only
  - hybrid-manual
  - hybrid-router later

### 5. Build the verification step

- [ ] Add a thin wrapper for running task verification commands
- [ ] Capture stdout/stderr, exit code, and duration
- [ ] Mark flaky or environment-dependent checks explicitly
- [ ] Keep verification read-only where possible except for normal build/test artifacts

### 6. Define the first semi-automatic router

- [ ] Lock a deterministic automatic role flow:
  - `plan` = strongest reasoning model
  - `execute` = strongest coding/tool model
  - `review` = independent second pass
  - `verify` = commands + score capture
- [ ] Define an inspectable model profile with initial priors for each provider
- [ ] Log why the router chose each phase/model combination
- [ ] Keep prompts and routing rules stable across early runs so results are comparable
- [ ] Document what counts as a retry versus a router escalation

### 7. Add minimal Soma instrumentation

- [ ] Reuse existing `heartLlmComplete()` path when running ClawNet-owned LLM phases
- [ ] Record generation provenance by benchmark phase
- [ ] Include Soma metadata in benchmark result artifacts
- [ ] Do not block the benchmark if Soma is unavailable; fall back cleanly

### 8. Produce the first result set

- [ ] Run at least 5 tasks through GPT-only
- [ ] Run the same 5 tasks through Claude-only
- [ ] Run the same 5 tasks through semi-automatic router
- [ ] Summarize results in `internal/active/code-bench-results-YYYY-MM-DD.md`
- [ ] Decide:
  - router clearly wins -> proceed to runtime
  - results mixed -> refine benchmark
  - no advantage -> deprioritize project

### 9. Exit criteria for Phase 1

- [ ] Benchmark runner works end-to-end on at least 5 tasks
- [ ] Results are reproducible enough to compare workflows
- [ ] Router outcome is evidence-based, not anecdotal
- [ ] We can explain exactly what to build next if the benchmark is positive

---

## Phase 2 preview checklist — minimal runtime

Only start this if Phase 1 shows clear signal.

- [ ] Add `src/core/code-orchestrator.ts`
- [ ] Add a task session object with phase logs
- [ ] Add model/provider selection by role
- [ ] Add model-profile memory for strengths, weaknesses, and observed outcomes
- [ ] Add policy envelope: repo scope, file scope, spend cap, tool cap
- [ ] Add a `review` phase separate from `execute`
- [ ] Add verification summary output
- [ ] Add Soma provenance capture per phase
- [ ] Add a small route or CLI entry point for local dogfooding

---

## Fast-testing gameplan

Goal: learn as fast as possible whether the semi-automatic brain actually improves coding quality.

### Week 1 — smallest possible proof

- [ ] Pick 5 benchmark tasks from ClawNet
- [ ] Write the task manifests
- [ ] Create the first model profile with explicit priors
- [ ] Implement a thin runner that can execute:
  - GPT-only
  - Claude-only
  - router
- [ ] Record outputs, verification results, and human scores
- [ ] Publish first result note in `internal/active/`

### Week 2 — tighten the router

- [ ] Review failure patterns from week 1
- [ ] Adjust routing priors only where results justify it
- [ ] Add simple escalation rules:
  - ambiguous task -> force planning phase
  - risky diff -> force review phase
  - failed verification -> reroute or retry once
- [ ] Re-run the same task set plus 2 new tasks

### Week 3 — Soma-native dogfood

- [ ] Route planner/reviewer phases through Soma where available
- [ ] Attach provenance to result artifacts
- [ ] Decide whether task receipts are worth minting during benchmarks
- [ ] Evaluate whether Soma adds real product value here or just instrumentation

### Decision gate

Promote from backlog to active only if all are true:

- [ ] the router beats single-model baselines on real tasks
- [ ] routing decisions are explainable enough to debug
- [ ] Soma integration feels additive, not forced
- [ ] we have a clear next-sprint build scope

---

## Adjacent wedges worth testing

These are nearby product ideas that fill gaps generic agent tools still leave open. Some may prove more aligned with ClawNet's moat than the coding brain itself.

### 1. Trusted PR review + verification loop

Gap:

- many tools generate code
- fewer tools provide a strong independent review + verification loop
- almost none produce a trustable artifact showing what was actually checked

Wedge:

- ingest task / diff / PR
- run planner/reviewer/verifier phases
- output findings, verification summary, and receipt

Why it matters:

- narrower and easier to benchmark than a full coding agent
- closer to ClawNet's trust and verification identity
- useful even if frontier coding models become much better

What to test:

- does independent review catch materially more issues than single-model review?
- do users value signed/auditable verification output?

### 2. Agent policy + permission layer

Gap:

- current coding tools are often too permissive or too opaque
- users need fine-grained control over what an agent can touch and spend

Wedge:

- repo scope
- file scope
- command/tool scope
- spend caps
- review requirements
- escalation thresholds

Why it matters:

- highly aligned with ClawNet and Soma delegation
- likely durable even if model quality converges

What to test:

- does visible policy control make users trust agent workflows more?
- does constrained delegation reduce bad outcomes enough to be valuable?

### 3. Verifiable task receipts

Gap:

- most tools do not give a trustworthy proof of what work was done
- teams cannot easily answer who changed what, under what authority, with what checks

Wedge:

- task receipt with:
  - task hash
  - repo scope
  - phases used
  - models used
  - verification commands run
  - result hashes
  - policy envelope
  - provenance metadata

Why it matters:

- directly tied to ClawNet's long-term moat
- useful for teams, compliance, agent marketplaces, and dispute handling

What to test:

- do users care enough about receipts to pay for them?
- does receipt-backed verification resonate more than raw generation?

### 4. Delegated coding workers

Gap:

- current agent tools rarely provide trustworthy, scoped sub-agent delegation
- larger tasks benefit from decomposition, but safety/control are weak

Wedge:

- parent task spawns child workers with:
  - narrower repo scope
  - narrower tool scope
  - smaller spend budget
  - revocable authority
  - explicit role assignment

Why it matters:

- maps directly to Soma delegation and ClawNet's trust model
- increasingly important as coding agents become more autonomous

What to test:

- do scoped child workers outperform one large undifferentiated agent on larger tasks?
- do users value the control enough to tolerate added complexity?

### 5. Verification-as-a-service for agent output

Gap:

- many users already have a generation tool
- fewer have a reliable verifier for AI-generated output

Wedge:

- ClawNet verifies patches, PRs, and task results from any agent
- emits verdicts, scores, and receipts

Why it matters:

- works regardless of which provider/model wins
- closer to ClawNet's deepest moat than pure routing

What to test:

- is verification more compelling commercially than generation?
- do users trust "verify any agent's work" more than "use our agent"?

### 6. Cost-quality routing engine

Gap:

- existing routing is often simplistic or opaque
- few systems clearly optimize for quality, cost, latency, and risk together

Wedge:

- explicit router optimizing for:
  - pass rate
  - cost
  - latency
  - risk level
  - repo/language fit

Why it matters:

- practical, measurable, and synergistic with the coding brain

What to test:

- can routing beat "always use the strongest model" on cost-adjusted quality?

### 7. Trust query for agents

Gap:

- users and agents still cannot cleanly ask "should I trust this agent for this kind of work?"

Wedge:

- trust query for coding and agent work:
  - reliability
  - verification depth
  - spend efficiency
  - delegation quality
  - consistency

Why it matters:

- extends naturally beyond coding into the broader ClawNet vision

What to test:

- do trust signals change which agents users choose?
- do users pay for better decision-making around agent selection?

---

## What may already be partially solved by Soma / ClawNet

Some of the strategic value here is not greenfield. ClawNet and Soma already have building blocks that generic coding wrappers do not.

Already present or materially underway:

- generation provenance via `heart.generate()` / `heartLlmComplete()`
- task-adjacent receipts and attestation infrastructure
- Soma delegation primitives: scoped children, depth, caps, cascade revoke
- trust query infrastructure and verdict storage
- identity and provenance headers
- provider / policy / billing primitives

This matters because the real opportunity may not be "build a coding product from scratch."

It may be:

**take existing Soma and ClawNet primitives, then aim them at a coding-specific wedge that demonstrates why those primitives matter.**

That suggests a practical order of operations:

1. test the coding brain wedge
2. test trusted review / verification loop in parallel or immediately after
3. reuse existing Soma delegation and receipt infrastructure wherever possible
4. prefer thin integration layers over new protocol work at the start

If one of the adjacent wedges proves stronger than the coding brain itself, follow the stronger signal.

---

## Open questions

- Should benchmark scoring be purely test-based, or include human review weighting?
- Should the first runtime operate inside ClawNet's own repo only, or support arbitrary local repos?
- When should task receipts be minted: every run, only successful runs, or only paid runs?
- Is "coding" the first wedge, or should "PR review + fix loop" be even narrower?
- Which role taxonomy is stable enough to codify early: planner/executor/reviewer/verifier, or something even simpler?

---

## Bottom line

This is worth building **only as a measured wedge into trusted agent orchestration**.

The sequence is:

- benchmark first
- semi-automatic router second
- Soma-native provenance third
- productization only after signal

That keeps us aligned with ClawNet's real moat while still moving fast enough to learn.

---

## Unspoken rules the OpenClaw coding agent must inherit

These are durable discipline rules that keep recurring across human + AI coding sessions. An OpenClaw coding agent trained on this repo should treat them as first-class verification steps, not stylistic advice. This section is the inheritance point — update it when we discover new rules, so the agent brain picks them up.

### Rule 1 — Wiring discipline: a feature isn't shipped until it's wired

**The rule:** a feature is NOT shipped until there's a live call path from request → your code → DB/output. If deleting your function wouldn't break a test or route, it was decoration, not shipping.

**Why it keeps biting us:** across multiple sessions, large amounts of code have been marked "complete" while quietly being decoration. Two concrete cases from 2026-04-09→11: the trust scoring layer (multiple files consuming dead columns, never imported by any route handler) and `soma-checkpoint.ts` (exists, has unit tests, has a reader — but nothing writes to it in production). Both passed build + tests, both were dead.

**How the agent should apply it:** before marking ANY task complete, run the three-line trace.

1. **Who imports this module?** Grep for the export name across the codebase, excluding the file itself and its own tests. Zero non-test callers = decoration.
2. **What reads its output?** Follow the DB writes / return values into a consumer. If nothing consumes the column or value, it's decoration.
3. **What test exercises the live path?** Not a unit test of the function in isolation. An integration test or a real route handler that hits it via the same entry point production traffic would use.

If any answer is "nothing," the feature is **not done**. Say so, do not mark complete, and wire it.

**Corollaries:**

- Migrations ship in pairs: column + writer + reader + round-trip test. A column nothing populates is decoration.
- `tsc --noCheck` and green unit tests do NOT prove a path is live. They prove the path *would compile if called*. Wiring proof is a separate check.
- When killing a dead subsystem, delete files that *only served* that subsystem, not just files named after it. Grep for what the file reads and writes, not just its filename.
- When auditing prior work (from a previous session or previous author), do NOT trust "shipped" labels. Re-run the three-line trace on anything load-bearing before building on top of it.

**When to ignore:** pure utility primitives explicitly scoped as "unused, ships with library" (`utils/`-style), or research spikes clearly marked as throwaway. If the code sits under `core/` or is referenced by a route that returns success, it is NOT a candidate for ignoring — that's the dangerous decoration shape.

### Rule 2 — (reserved for future unspoken rules)

When we discover another recurring discipline failure, add it here rather than scattering it across commit messages and session notes. The goal is a single inheritable rulebook the OpenClaw coding agent can ingest.
