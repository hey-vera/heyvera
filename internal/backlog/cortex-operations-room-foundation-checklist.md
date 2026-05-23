# Cortex Operations Room Foundation Checklist

Status: brainstorm
Owner: cross-repo
Stage: discovery
Confidence: medium-high
Next gate: proposal

## Raw Vision

Cortex should become an operations product for AI-assisted software work, not just a chat product.

The product should support:

- solo coders who need one place to manage projects, chats, subscriptions, runs, approvals, and spend
- power users who run many projects at once
- team/org users who want one shared operations room for a company or GitHub organization
- multi-company operators who need a personal portfolio panel across many orgs, repos, projects, and approvals

The guiding phrase is: **batter first, icing later**. The foundation must make work truthful, safe, and controllable before adding premium visual layers.

## Product Doctrine

1. Cortex has one Operations Room engine, not separate personal and team products.
2. Personal Portfolio Ops, Org Ops, Project Chat, Task Manager, and Live Map are scoped views over the same execution graph.
3. The canonical graph is `Project -> Task -> Run -> Step -> Evidence`.
4. Project Chat is for intent, judgment, and detailed vibe-coding work.
5. Task Manager is the control lens: queue, prioritize, dispatch, pause, retry, approve, cancel, assign, and inspect.
6. Live Map is the truth lens: topology, active work, stale edges, conflicts, loops, blockers, evidence, and cost hotspots.
7. Personal Portfolio Ops aggregates across scopes the user is allowed to see, but it is not a super-admin layer.
8. Org Ops is the shared authority root for a company/team/GitHub org.
9. Reads can aggregate across orgs when authorized; writes against shared org state must execute under that org's authority and audit trail.
10. "Done" means evidence-backed: diff, tests, logs, checks, receipts, and verifier verdict.

## Scope Model

### Personal Portfolio Ops

The user's cross-project and cross-org command surface.

In scope:

- personal projects, repos, subscriptions, chats, runs, approvals, and spend
- authorized slices of org work across every org the user belongs to
- a triage inbox for "what needs me now"
- cross-org rollups for health, blockers, budget, and active work
- quick entry into an org operations room or project chat

Out of scope:

- bypassing org policy
- viewing org secrets or work the user has not been delegated
- mutating shared org state without explicit org-context handoff
- merging org data pools into a global super-admin store

### Org / Team Operations

The shared operations room for one company/team/GitHub organization.

In scope:

- org repos, issues, PRs, projects, deployments, tasks, runs, and approvals
- shared budget and authority policy
- member and agent assignment
- resource leases for conflict prevention
- canonical org audit/event log
- org-level Live Map and task queue

Out of scope:

- private user scratch work before explicit promotion
- personal billing details
- private chats unrelated to org work
- silent changes to authority, membership, secrets, trust policy, or deploy policy

### Project Chat

The implementation and collaboration workbench.

In scope:

- vibe-coding back-and-forth
- project-specific planning, debugging, editing, review, and decisions
- attaching to durable project/task threads
- raising or resolving human decisions

Out of scope:

- being the source of truth for run state
- one chat per machine event
- hidden orchestration state that only exists in scrollback

## Foundation Checklist

### Phase 0: Source Of Truth

- [ ] Replace mutable Task Manager JSON blobs with an append-only event log.
- [ ] Bind every Task to one or more Runs.
- [ ] Bind every Run to Steps and Evidence.
- [ ] Define typed work contracts: objective, repo, scope, allowed paths, acceptance criteria, autonomy, budget, authority, and rollback notes.
- [ ] Make Project Chat, Task Manager, and Live Map projections of the same graph.
- [ ] Retire fake seeded members/activity from production surfaces.
- [ ] Retire regex-only task parsing as core behavior; keep natural language as a thin shell over typed commands.

### Phase 1: Verifier / Evidence Floor

- [ ] Capture actual git diff, changed files, command logs, test/build/lint results, and artifacts per run.
- [ ] Add verifier reports with verdict, risk, acceptance coverage, allowed-path violations, stale-context notes, and next action.
- [ ] Prevent "done" status without verifier evidence.
- [ ] Record verified outcomes so routing/bandit behavior learns only from real outcomes.
- [ ] Make evidence drillable from Task Manager, Project Chat, and Live Map.

### Phase 2: Authority And Scope

- [ ] Model personal scope and org scope with the same Operations Room engine.
- [ ] Define the authority root for each run: personal Heart or org Heart.
- [ ] Add an authority resolver: person + action + target + org -> allowed, needs handoff, or denied.
- [ ] Require explicit promotion when personal work wants to mutate org resources.
- [ ] Add scoped handoff sessions for entering org context from Personal Portfolio Ops.
- [ ] Preserve per-org audit trails for all org-affecting actions.

### Phase 3: GitHub Trust Layer

- [ ] Mirror GitHub org/repo/project/issue/PR/check/deploy state through GitHub App + webhooks.
- [ ] Treat GitHub as the reconcilable external source for repo state.
- [ ] Backlink Cortex tasks/runs/steps/artifacts to GitHub objects where applicable.
- [ ] Stamp PRs/commits/checks with Cortex run provenance.
- [ ] Start read-only for one org before enabling writes.
- [ ] Enable writes through branch-per-run and PR creation, not direct shared-branch mutation.

### Phase 4: Conflict And Concurrency Control

- [ ] Add resource leases before parallel autonomy.
- [ ] Lease branches, file/path scopes, issues, PRs, migrations, deployment environments, secrets, and release channels.
- [ ] Enforce branch-per-run.
- [ ] Serialize migrations and production deployments.
- [ ] Detect overlapping file/path scopes before dispatch.
- [ ] Add merge gates: rebase, tests, verifier, approval when required.
- [ ] Route conflicts to an Ask instead of silently resolving high-risk changes.

### Phase 5: Task Manager As Operations Room

- [ ] Default to a "what needs me now" inbox, not a metrics wall.
- [ ] Add controls: queue, prioritize, assign, pause, resume, retry, cancel, approve, open/attach chat, inspect evidence.
- [ ] Add dependencies and blocked-frontier visibility.
- [ ] Add per-task budget, autonomy, and approval gates.
- [ ] Add Ask records as first-class human-decision items.
- [ ] Allow headless queueing without opening Project Chat.
- [ ] Make task cards open an inspector first; chat opens when collaboration is needed.

### Phase 6: Project Chat Boundaries

- [ ] Attach chats to Project or Task, not Run, Step, retry, agent, or phase.
- [ ] Default to attaching to existing durable threads.
- [ ] Spawn a new chat only for a distinct durable outcome, distinct authority/budget/participants, or context-pollution prevention.
- [ ] Explain why a new chat was spawned.
- [ ] Rehydrate resumed chat from graph + evidence + memory, not scrollback alone.
- [ ] Archive chats when outcomes are sealed and no open Asks remain.

### Phase 7: Live Map

- [ ] Build Live Map only over real event/run/evidence data.
- [ ] Show projects, tasks, runs, steps, agents, resources, leases, blockers, cost, and evidence.
- [ ] Support pan, zoom, click-to-inspect, and time replay.
- [ ] Visualize loops, stale edges, expensive branches, blocked frontiers, and lease conflicts.
- [ ] Allow safe actions from map nodes where authority permits: pause, retry, raise Ask, inspect evidence.
- [ ] Keep it a truth/debugging lens, not the primary task queue.

### Phase 8: Personal Portfolio Ops

- [ ] Top-left entry opens the user's personal operations panel.
- [ ] Show one ambient signal for "things that need you" across authorized scopes.
- [ ] Show company/org rows with health, active runs, spend, approvals, and blockers.
- [ ] Show personal projects and recent chats/runs.
- [ ] Support quick launch into org ops or project chat.
- [ ] Keep cross-org reads scoped to the user's authorized slice.
- [ ] Require org-context handoff for org writes.
- [ ] Design for N authorities with N=1 as the v1 implementation.

### Phase 9: Premium Icing After Foundation

- [ ] Multi-org portfolio rollups.
- [ ] Cross-org spend optimization.
- [ ] Advanced model/provider specialist graph.
- [ ] Rich Live Map polish and replay.
- [ ] Parallel multi-agent planning over verified leases.
- [ ] Executive summaries across companies.
- [ ] Organization-level SLA/risk dashboards.
- [ ] Marketplace or agent roster surfaces.

## V1 Cut Line

Ship first:

- one Operations Room engine
- personal scope plus one org scope
- Project -> Task -> Run -> Step -> Evidence graph
- append-only event log
- verifier/evidence floor
- Project Chat attached to project/task
- read-only GitHub mirror for one org
- branch-per-run PR creation
- approval inbox
- migration and deploy locks
- basic task queue and task inspector
- Personal Ops top-left entry that works for N=1 scope and is designed for N scopes later

Do not ship first:

- full multi-company cockpit
- auto-parallelization without leases
- Live Map as decorative demo data
- silent cross-org writes
- full autonomy without verifier gates
- separate personal and team codebases

## Evidence Ledger

- current status: brainstorm
- vision fit: strong; this defines Cortex as a premium operations layer for AI software work instead of only chat.
- security exposure: high; touches org authority, GitHub writes, secrets, deploys, billing, audit, and cross-org visibility.
- upstream dependencies: Soma Heart/delegation semantics, verifier/evidence model, GitHub App trust model, org membership and approval policy.
- missing evidence: current mainline implementation audit, data model proposal, threat model, first customer workflow, performance expectations, permission matrix.
- blocks current work: no, unless implementing Task Manager/Live Map foundations.
- next gate: promote to proposal with data model, authority model, v1 slice, threat model, and rollback plan.
- terminal condition: accepted proposal plus ADRs for authority/event-log/GitHub trust boundaries, or superseded by a newer Cortex operations architecture decision.

