# ADR-0008: Add Cortex Authority And Scope Boundaries

Status: proposed

## Context

Cortex is becoming an operations room for software work, not only a solo task board. The current backend mostly scopes state by `user_id` and `group_id`: groups, task state, runs, approvals, resource leases, and summaries are user-owned. That keeps solo work simple, but it does not define safe boundaries for team, org, GitHub organization, or future multi-org views.

Personal Operations should aggregate what a user may see. It must not become a shortcut around org policy. Org Operations needs a shared authority root. Multi-org views should begin as read aggregation, not cross-org write authority.

## Decision

Cortex will model authority as first-class backend state.

The authority model starts with:

- authority scopes: personal, team, org, and future company/portfolio-shaped scopes
- memberships: which users may access a scope and with what role
- resources: repos, orgs, projects, deployment surfaces, or other resources covered by a scope
- policies: JSON policy attached to scopes and resources until a stricter typed policy engine is justified

The first implementation is read-only:

- bootstrap a personal scope for each authenticated user
- expose authorized scopes and resources to the frontend
- do not grant new write powers
- do not allow Personal Operations to mutate org work without a later explicit handoff and policy check

## Consequences

- Personal Operations can show a user's authorized operational universe without pretending everything is personal.
- Org Operations has a durable place to attach membership, resources, policies, audits, and future GitHub installation state.
- GitHub writes, deployment mutations, and cross-user resource leases should move toward authority-scoped checks instead of `user_id`-only checks.
- Existing `user_id + group_id` APIs remain valid during migration, but they are not sufficient for shared org automation.
- Multi-org write automation is out of scope until single-org authority, handoff, audit, approval, and leases are enforced.

## Follow-Up Work

- Add explicit org-context handoff for mutations initiated from Personal Operations.
- Add GitHub org/repo trust mirror as authority resources.
- Add authority scope ids to runs, approvals, leases, task projections, and operations events.
- Enforce authority on PR creation, deployment adapters, and any repo mutation.
- Update the frontend to consume authority scopes passively before adding action controls.
