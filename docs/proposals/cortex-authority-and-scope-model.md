# Cortex Authority And Scope Model

Status: proposal

## Title

Cortex authority and scope model for personal, team, org, and future multi-org operations.

## Problem

Cortex currently isolates most operational state by `user_id` and `group_id`. That is good enough for a solo user's project board, but it is not enough for a product that should manage personal work, team work, GitHub org work, and eventually multi-company operations.

Without a first-class authority model, Personal Operations could accidentally look like it can mutate org work, team groups could become user-local copies instead of shared truth, and GitHub/repo writes could rely on global credentials instead of explicit grants.

## Why Now

The Operations Room foundation now has backend projections for tasks, runs, approvals, resource leases, and personal operations summaries. The next batter step is to define who may see or mutate each surface before adding richer map UI, broader GitHub automation, or cross-org controls.

## Broad Idea

Add a backend-owned authority layer:

- `personal` scope: one user's private operations authority.
- `team` scope: a shared team/workspace boundary.
- `org` scope: a company or GitHub organization boundary.
- future `company` or `portfolio` scope: read aggregation over multiple orgs, not cross-org write authority by default.

Every operational surface should eventually answer:

- which authority scope am I in?
- what role does this user have?
- what resources are covered?
- what actions are allowed?
- which actions require handoff, approval, lease, or verifier evidence?

## What 10/10 Looks Like

A customer can open Personal Operations and see all authorized attention across personal and org work without bypassing org policy. A team can open Org Operations and see shared truth for repos, runs, approvals, leases, and audit events. A CEO-style multi-org view can aggregate read-only state across companies while writes still require explicit context selection and policy checks.

## Fitness Check

- vision fit: high; this is the control boundary for the operations-room product.
- real user/operator need: high before team/org automation or GitHub writes expand.
- security exposure: high; incorrect scope handling can leak data or mutate the wrong repo/org.
- evidence this is needed now: current code scopes groups, runs, approvals, leases, and GitHub repo selection primarily by `user_id`.
- keep / reshape / pause / remove: keep, but ship in small read-only slices first.

## Evidence Ledger

- current status: partial foundation; personal summary and group summaries exist, but authority is not first-class.
- upstream dependencies: GitHub org/repo trust mirror and explicit write adapters.
- missing evidence: real org membership sync, GitHub App installation model, policy UI, and write authorization enforcement.
- blocks current work: yes, for team/org/multi-org operations and safe automation.
- next gate: read-only authority scope tables and API, then explicit org handoff.
- terminal condition: authority scopes are used by read projections, write gates, audit events, leases, and GitHub adapters.

## Repo Ownership

- protocol truth: Soma owns protocol-level delegation semantics.
- platform/runtime truth: this repo owns Cortex authority scopes and runtime enforcement.
- product/integration truth: Cortex owns Operations Room UX; GitHub integration truth belongs in Cortex adapter docs.
- internal-only material: raw multi-org cockpit ideas stay in `internal/` until accepted.

## First Consumer

Cortex Personal Operations and Task Manager should consume a read-only `/api/authority/scopes` contract before any org mutation controls are added.

## Security / Reliability Requirements

- threat model: unauthorized cross-user/org reads, wrong-org writes, global GitHub token misuse, policy bypass from Personal Operations.
- rollback or recovery: schema is additive; read endpoint can be ignored by older frontend builds.
- auditability: future mutations must record authority scope, actor, role, resource, approval, and lease evidence.
- failure modes: if authority lookup is unavailable, org writes fail closed; read-only personal scope may degrade to personal-only.

## Delivery Shape

1. Add read-only authority scope tables and personal scope bootstrap.
2. Add `/api/authority/scopes` for frontend context.
3. Add frontend API types, no write UI.
4. Add explicit org-context handoff for org mutations.
5. Add GitHub org/repo trust mirror and authority resources.
6. Enforce authority on runs, approvals, leases, PRs, and deployment adapters.
7. Add read-only multi-org aggregation only after single-org enforcement works.

## ADR Needed?

- yes
- `docs/decisions/ADR-0008-cortex-authority-and-scope-boundaries.md`

## Open Questions

- Should the first org authority source be GitHub App installations, Clerk organizations, or a Cortex-native team table?
- Which roles are enough for V1: owner/admin/member/viewer, or do we need operator/billing/security roles immediately?
- Should `operations_events.scope_id` be migrated to authority scope ids, or should it keep group ids with a separate `authority_scope_id` column?
- What is the exact handoff ceremony when Personal Operations opens an org mutation?

## Links

- canonical reference: `docs/reference/cortex-operations-room.md`
- related proposal: `docs/proposals/cortex-operations-room-contract.md`
- deployment authority related ADR: `docs/decisions/ADR-0007-cortex-deployment-capability-adapters.md`
