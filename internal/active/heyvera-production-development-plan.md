# HeyVera Production Development Plan

**Status:** active internal execution plan
**Scope:** convert the long-term production development checklist into safe parallel delivery slices
**Source inputs:** `internal/specs/heyvera-v1-spec.md`, current repo layout, active frontend work under `web/` and `dashboard/`
**Non-goal:** this is not canonical shipped truth and does not mark future implementation complete

## Purpose

The platform spec already defines the long-term production checklist in phase order. This file turns that checklist into:

- safe parallel slices with explicit ownership
- a two-week opening sequence
- blockers and dependency gates
- handoff rules between frontend and backend agents

The main constraint is collision control. We are already in a mixed-reality repo:

- legacy Node/Hono runtime in `src/`
- emerging Rust platform slices in `crates/`
- public/frontend work in `web/` and `dashboard/`

The plan below keeps chat and current surfaces working while the production kernel is built under them.

## Planning Rules

1. One later code-owner slice per module root.
2. Frontend agents do not block backend kernel work.
3. Backend agents preserve a compatibility bridge until replacement paths are verified.
4. Shared contracts move through narrow adapter files, not cross-cutting edits.
5. No slice is "done" until its exit criteria, tests, and operator checks exist.

## Slice Map

### Slice A — Kernel Foundation

- **Goal:** establish shared production primitives for config, ids, time, money, errors, and DB bootstrap
- **Can run in parallel with:** Slice F, Slice G
- **Must land before:** Slice B, Slice C, Slice D, Slice E
- **Primary later ownership:**
  - `crates/core`
  - `crates/soma-core`
  - `crates/api` bootstrap wiring
  - migration/bootstrap scaffolding for the production DB layer
- **Secondary touch zone later:** legacy integration adapter only, not broad `src/` rewrites
- **Notes:** this slice defines the types every other production slice consumes

### Slice B — Observability Spine

- **Goal:** request IDs, tracing, metrics, and error boundary conventions for all new production paths
- **Can run in parallel with:** Slice C, Slice F
- **Depends on:** Slice A interface stability
- **Primary later ownership:**
  - `crates/api`
  - `crates/core`
  - `crates/engine` instrumentation hooks
  - operator-facing metrics wiring in the new API surface
- **Notes:** this should publish the baseline health contract before heavier migrations move in

### Slice C — Auth and Principal Boundary

- **Goal:** unify human and agent identity extraction behind one production principal model
- **Can run in parallel with:** Slice B, Slice D, Slice G
- **Depends on:** Slice A
- **Primary later ownership:**
  - `crates/api`
  - `crates/soma`
  - auth/policy primitives in new Rust layers
  - compatibility bridge from current `src/middleware/auth.ts` and `src/middleware/clerk-auth.ts`
- **Notes:** this slice should end with adapter seams, not a full cutover

### Slice D — Events and Durable Job Spine

- **Goal:** append-only events, queue semantics, lease/retry model, worker handoff
- **Can run in parallel with:** Slice C, Slice F
- **Depends on:** Slice A
- **Primary later ownership:**
  - `crates/engine`
  - `crates/worker`
  - `crates/api` enqueue boundary
- **Notes:** this is the execution-state backbone and should stay isolated from frontend concerns

### Slice E — Billing, Metering, and Ledger Migration

- **Goal:** move subscription, usage, and x402 settlement logic onto a production ledger path
- **Can run in parallel with:** Slice H once contracts exist
- **Depends on:** Slice A, Slice B, Slice C, Slice D
- **Primary later ownership:**
  - `crates/api`
  - `crates/core`
  - billing/metering modules that replace legacy logic in `src/routes/economy.ts` and `src/utils/usage.ts`
- **Notes:** high-risk slice; keep behind compatibility gates until invariants are proven

### Slice F — API Compatibility Shell

- **Goal:** keep the current product usable while new production services are introduced behind a narrow bridge
- **Can run in parallel with:** Slice A, Slice B, Slice D, Slice G
- **Depends on:** none to start; becomes more valuable after Slice A
- **Primary later ownership:**
  - `src/index.ts`
  - `src/routes/*`
  - `src/middleware/*`
  - compatibility adapters into `crates/api`
- **Notes:** this slice owns preservation of current behavior and is the only slice allowed to coordinate broad legacy/runtime seams

### Slice G — Frontend Contract and Shell Readiness

- **Goal:** make frontend work proceed safely against versioned contracts and stable loading/auth/error states
- **Can run in parallel with:** Slice A, Slice C, Slice F
- **Depends on:** backend contract drafts, not full backend implementation
- **Primary later ownership:**
  - `web/src/api/*`
  - `web/src/hooks/*`
  - `web/src/components/layout/*`
  - `dashboard/src/lib/api.ts`
  - `dashboard/src/pages/*`
- **Notes:** this slice must not reach into backend internals; it consumes explicit response shapes only

### Slice H — Context Assembly and Intelligence Activation

- **Goal:** shadow-mode context assembly, then controlled activation into routing and orchestration
- **Can run in parallel with:** limited preparatory work alongside Slice E and Slice G
- **Depends on:** Slice A, Slice B, Slice C, Slice D, stable API shell
- **Primary later ownership:**
  - `crates/engine`
  - `crates/api`
  - legacy comparison points in `src/core/intent-parser.ts`, `src/core/executor.ts`, `src/providers/llm.ts`
- **Notes:** do not activate until observability, job semantics, and rollback hooks are real

### Slice I — Execution Isolation and Production Hardening

- **Goal:** runner separation, container hardening, key management, bot defense, deploy-safe production modes
- **Can run in parallel with:** late work on Slice H and Slice J
- **Depends on:** Slice D and an operating worker/runtime boundary
- **Primary later ownership:**
  - `crates/worker`
  - `crates/engine`
  - production deploy/runtime configuration
- **Notes:** this is where "production-ready" becomes materially true instead of structurally promised

### Slice J — Consent, Privacy, and VeraAI Foundation

- **Goal:** consent controls, privacy boundaries, analytics posture, secure aggregation groundwork
- **Can run in parallel with:** Slice I after principal and event models are stable
- **Depends on:** Slice C, Slice D, Slice E
- **Primary later ownership:**
  - `web/src/pages/*` and related settings/privacy surfaces
  - `dashboard/src/pages/*` for operator views
  - backend privacy/event plumbing in the new production stack
- **Notes:** do not front-run policy UX before the backend event/accountability model exists

## Safe Parallelization Matrix

Run these lanes concurrently once interfaces are agreed:

1. **Backend lane 1:** Slice A -> Slice B
2. **Backend lane 2:** Slice C + Slice D after Slice A types exist
3. **Legacy bridge lane:** Slice F continuously, with one owner to avoid `src/` collision
4. **Frontend lane:** Slice G against mocked or versioned contracts only
5. **Later platform lane:** Slice E -> Slice H -> Slice I
6. **Late product/policy lane:** Slice J after principal, events, and ledger semantics stabilize

Unsafe pairings to avoid:

- two slices editing broad `src/routes/*` behavior at once
- frontend agents consuming unversioned backend responses directly from in-flight branches
- billing migration work landing before event and principal semantics are stable
- execution isolation changes landing before worker lease/retry behavior is testable

## First Two-Week Sequence

### Week 1

**Day 1-2**

- confirm the production target boundary from `internal/specs/heyvera-v1-spec.md`
- freeze later ownership per slice before implementation churn starts
- start Slice A with crate boundaries and shared primitive definitions
- start Slice F with a compatibility inventory of current `src/` entry points
- start Slice G with API-client boundary cleanup in `web/src/api/*` and `dashboard/src/lib/api.ts`

**Day 3-4**

- publish Slice A draft interfaces for config, principal-adjacent types, DB bootstrap, and errors
- start Slice B on tracing/metrics/http request IDs using Slice A interfaces
- start Slice C on auth/principal extraction shape
- keep Slice F focused on adapter seams, not behavior rewrites

**Day 5**

- lock a first internal contract set:
  - health/status
  - auth/session shape
  - request error envelope
- frontend lane updates stubs/hooks to those contracts only
- produce first blocker review before new work fans out

### Week 2

**Day 6-7**

- continue Slice B to baseline health metrics and trace scaffolding
- continue Slice C to principal extraction adapter
- start Slice D on event append and job-queue lease model

**Day 8-9**

- test compatibility bridge assumptions through Slice F
- validate that current chat/social/auth flows still have a preserved path
- frontend lane begins real loading/error/auth states against stable envelopes, not full feature expansion

**Day 10**

- checkpoint review:
  - are Slice A interfaces still holding
  - is observability visible on new paths
  - is principal extraction coherent
  - is the event/job model credible enough to begin billing/metering planning next

If the checkpoint fails, do not open Slice E yet.

## Blockers and Dependency Gates

### Structural blockers

- actual production DB target and migration policy must be explicit before downstream slices build storage assumptions
- principal model must settle before billing, metering, and privacy work can claim correctness
- worker queue semantics must settle before execution isolation work becomes meaningful

### Repo-shape blockers

- mixed runtime reality (`src/` Node, `crates/` Rust, `web/`, `dashboard/`) creates ownership collision risk
- frontend branches can drift fast unless contract adapters are the only integration seam
- legacy routes currently hold behavior that will be tempting to "just patch"; Slice F must police that boundary

### Operational blockers

- production deploy path for the new stack must be designed before any cutover claim
- observability must exist before migration work can be trusted in production
- rollback posture must be defined before ledger or auth cutovers

## Handoff Rules Between Frontend and Backend Agents

1. **Backend owns contracts; frontend owns rendering and local interaction state.**
   Frontend agents consume versioned shapes through `web/src/api/*` and `dashboard/src/lib/api.ts`. They do not depend on backend internals or ad hoc branch behavior.

2. **Only the bridge owner edits broad legacy runtime seams.**
   If work requires touching `src/index.ts`, `src/routes/*`, or `src/middleware/*` outside a narrow adapter, it routes through Slice F ownership.

3. **Handoffs happen on explicit artifacts, not chat summaries.**
   Minimum artifact for handoff:
   - endpoint or event name
   - request/response envelope
   - auth expectation
   - loading/error states
   - known fallback behavior

4. **Frontend can proceed on mocks once envelopes are frozen.**
   It does not wait for full backend completion if:
   - field names are frozen
   - error shape is frozen
   - auth state model is frozen

5. **Backend does not silently change response shapes after frontend adoption.**
   If a contract must move, update the adapter boundary first and hand off a new version intentionally.

6. **No frontend ownership of billing truth, auth truth, or policy truth.**
   Frontend may display those states; backend remains authoritative for computation and enforcement.

7. **Cutover reviews require both sides.**
   Before any feature moves from mocked/bridged to live production path, one frontend and one backend owner verify:
   - contract parity
   - degraded-state behavior
   - auth failure behavior
   - telemetry presence

## Recommended Slice Ownership Later

- **Platform/kernel owner:** Slice A + Slice B
- **Identity/policy owner:** Slice C
- **Execution/runtime owner:** Slice D + Slice I
- **Ledger/billing owner:** Slice E
- **Legacy continuity owner:** Slice F
- **Frontend shell/contracts owner:** Slice G
- **Intelligence/context owner:** Slice H
- **Privacy/foundation owner:** Slice J

## Exit Criteria For Opening the Next Wave

Do not open the next heavy wave of work until all of the following are true:

- Slice A shared primitives are stable enough that other slices are not rewriting core types weekly
- Slice B exposes basic health, trace, and error visibility
- Slice C defines one coherent principal path
- Slice D proves a durable event/job model in tests
- Slice F preserves current user-visible behavior during migration
- Slice G is consuming explicit contracts rather than scraping incidental backend behavior

Once those are true, the repo can safely expand into ledger migration, context activation, and execution hardening without every branch fighting the others.
