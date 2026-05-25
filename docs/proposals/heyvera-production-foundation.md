## Title

# HeyVera Production Foundation

Status: proposed

## Problem

HeyVera has product direction and partial architecture material, but it does not yet have one canonical proposal that defines the long-term production foundation for the application stack, operational gates, and documentation ownership. Without that foundation, development risks drifting into demo-first work, unclear repo truth, weak security boundaries, and infrastructure choices that are hard to evolve once real users and payments exist.

## Why Now

HeyVera needs a production shape before major feature work hardens the wrong assumptions. The frontend surface, the new Rust backend, and the operational data plane should be designed together now so auth, observability, storage, and recovery are first-class constraints instead of retrofit work.

## Broad Idea

Build HeyVera as a production modular monolith with:

- a React frontend for the user-facing product surface
- a new Rust backend as the primary application runtime
- Postgres as the system of record
- Redis for ephemeral coordination, cache, and rate-control support
- R2 for durable object/blob storage
- Clerk for identity and session management
- OpenTelemetry for tracing, metrics, and structured observability

The goal is not microservices. The goal is one deployable product with explicit module boundaries, strong internal contracts, and operational discipline that can later be extracted only where evidence justifies it.

## What 10/10 Looks Like

- One canonical source-of-truth doc set explains current architecture, data ownership, auth flows, runtime boundaries, deploy topology, and incident handling.
- The Rust backend owns business logic, state transitions, policy enforcement, background jobs, and integrations behind explicit module interfaces.
- The frontend is thin on authority: it renders product workflows, calls backend APIs, and does not become a second policy engine.
- Postgres is authoritative for relational state and audit-critical records.
- Redis is optional for correctness and required only for performance, coordination, and short-lived state.
- R2 holds uploads, generated artifacts, exports, and other blob payloads with durable references recorded in Postgres.
- Clerk is the identity source, but HeyVera still owns authorization, tenancy, and role checks in backend policy code.
- OpenTelemetry spans cover request path, job path, external dependencies, and user-impacting critical flows end to end.
- Security, recovery, and rollout gates block production releases until threat model, backups, migrations, observability, and rollback paths are proven.
- The system is still a modular monolith at this stage; no service split exists without measured need.

## Fitness Check

- vision fit: high; a sovereign product needs a stable runtime, explicit trust boundaries, and durable operational truth
- real user/operator need: high; production users need reliability, auditability, and recoverable state before breadth features
- security exposure: high; auth, user data, stored artifacts, and future payments make weak foundations expensive
- evidence this is needed now: existing HeyVera/Rust architecture material exists, but repo-truth and production gates are not yet unified
- keep / reshape / pause / remove: keep the production-foundation goal, reshape current work around one canonical proposal and ADR set

## Evidence Ledger

- current status: directional architecture and product material exist; production foundation is not yet canonicalized as one accepted proposal
- upstream dependencies: product scope clarity, repo ownership rules, auth/provider requirements, hosting constraints, and rollout priorities
- missing evidence: target scale assumptions, multi-tenant boundary details, data retention policy, compliance posture, and exact background job workload
- blocks current work: yes
- next gate: accept proposal, write ADR set, then deliver foundation slices in sequence
- terminal condition: production foundation is implemented, documented, observable, and releasable with rollback and recovery evidence

## Repo Ownership

- protocol truth: Soma, where protocol semantics or normative trust behavior belong
- platform/runtime truth: HeyVera repo, including frontend, Rust backend, storage, deploy shape, and product-level policy
- product/integration truth: HeyVera repo for UI, workflow, integrations, and backend application contracts
- internal-only material: brainstorming, experiments, speculative roadmap, and pre-adoption notes outside canonical docs

## First Consumer

HeyVera itself is the first consumer. The foundation should optimize for the first real product surface and operator workflow, not for hypothetical downstream platforms.

## Security / Reliability Requirements

- threat model:
  frontend compromise, session theft, backend auth bypass, broken tenant isolation, blob/object exposure, unsafe migrations, cache inconsistency, queue/job replay, secret leakage, observability gaps, and supply-chain risk
- rollback or recovery:
  reversible deploys, backward-compatible schema discipline where possible, tested Postgres backups/restores, Redis flush tolerance, R2 object recovery expectations, and clear degraded-mode behavior
- auditability:
  append-only audit trail for security-sensitive actions, actor attribution from Clerk identity plus backend authorization context, request IDs, deployment/version visibility, and trace correlation
- failure modes:
  Postgres unavailable, Redis unavailable, R2 degraded, Clerk outage, partial job execution, downstream provider timeout, migration failure, and telemetry pipeline failure must each have documented behavior and operator response

## Delivery Shape

1. Foundation proposal and ADR tranche
   Define architecture, ownership, deploy model, data classes, and production gates before broad implementation.
2. Canonical docs baseline
   Create source-of-truth docs for architecture, runtime topology, data model boundaries, auth/authorization, storage, observability, and operations.
3. Rust backend skeleton
   Stand up the modular monolith structure, module boundaries, health endpoints, config loading, error model, tracing bootstrap, and persistence abstractions.
4. Data plane foundation
   Establish Postgres migrations, Redis usage rules, R2 object conventions, backup/restore approach, and local/dev/test parity.
5. Identity and policy layer
   Integrate Clerk authentication, backend authorization checks, tenancy model, session handling, and audit logging.
6. Frontend foundation
   Establish app shell, auth handoff, API client boundaries, error/loading conventions, and observability hooks without embedding policy in the UI.
7. Reliability gates
   Add CI/CD checks, migration safety review, release checklist, smoke tests, SLO/SLI definitions, tracing dashboards, and incident/runbook coverage.
8. First production slice
   Deliver one end-to-end user workflow through the full foundation and use it to validate deploy, rollback, telemetry, and operator ergonomics.

## ADR Needed?

- yes
- if yes, which decision changes?
  - modular monolith boundaries and extraction rules
  - Rust backend framework/runtime choice and async/job model
  - Postgres as primary store and migration discipline
  - Redis usage boundaries and correctness rules
  - R2 object storage model and retention classes
  - Clerk authentication boundary and backend authorization model
  - OpenTelemetry standard for traces, metrics, logs, and correlation
  - deploy topology, environments, and rollback strategy
  - canonical docs map and source-of-truth ownership

## Open Questions

- Which Rust web/runtime stack best fits the operational model without over-complicating the backend?
- What tenancy model is required at launch: single-tenant, workspace-based, or user-scoped only?
- Which records require strict audit immutability versus normal application history?
- What background work belongs inside the modular monolith process versus a separate worker process at first release?
- What retention and lifecycle policies apply to R2 objects, traces, and user-generated artifacts?
- Which reliability targets are mandatory before the first production release versus later hardening?

## Links

- parent issue: none yet
- discussion: none yet
- related docs:
  - `docs/proposals/PROPOSAL-TEMPLATE.md`
  - `docs/ARCHITECTURE.md`
  - `docs/overview.md`
