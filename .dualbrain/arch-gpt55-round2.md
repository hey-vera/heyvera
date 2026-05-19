I’ll ground this against the repo context first so the merged architecture names crates and boundaries accurately, then I’ll produce the Round 2 review directly.
exec
/bin/bash -lc "pwd && rg --files -g 'Cargo.toml' -g 'AGENTS.md' -g 'docs/**' -g 'crates/**' | head -200" in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
exec
/bin/bash -lc 'git branch --show-current && git remote -v' in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
exec
/bin/bash -lc "rg -n \"Cortex|Level 5|ExecutionPlan|BrainMessage|WorkerMessage|MissionControl|CapabilityManifest|Thompson|event\" . -g '"'!node_modules'"' -g '"'!target'"' -g '"'!dist'"'" in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
codex
I do not have your original Round 1 text in this thread, so I’m comparing Opus against the GPT-5.5 design position I would defend for Cortex L5: event-first but not CRUD-replacing, policy-first execution, typed protocol envelopes, probabilistic routing, runtime memory, CLI workers, and human-gated acceptance rather than consensus.
**1. Major Disagreements**
1. **Event DB placement**
   - Opus: `CortexEvent` in separate `cortex_events.db` with WAL.
   - My design: event log should be logically central, with strong write-order guarantees against run/task state.
   - Conflict: separate DB improves isolation but weakens atomicity unless we add an outbox/transaction boundary.
2. **Evaluator math**
   - Opus: `ArmState { alpha, beta }` per `(provider, tier, context_key)` plus score:
     `thompson*0.40 + confidence*0.15 + capability_match*0.15 + reputation*0.20 - pressure*0.10`.
   - My design: Thompson sampling should pick among eligible arms after hard constraints and risk filters, not be buried inside another weighted scorer.
   - Conflict: Opus keeps too much of the old weighted system.
3. **Checkpointing**
   - Opus: `CheckpointPayload { worktree_tarball_uri, conversation_state, progress_pct, resumable }`.
   - My design: checkpointing must separate filesystem state, protocol state, and execution cursor.
   - Conflict: tarballs are useful, but not sufficient as the checkpoint abstraction.
4. **Worker trust**
   - Opus: workers are semi-trusted; Brain trusted; HMAC-SHA256 signed by Brain.
   - My design: workers are untrusted for claims, semi-trusted only for execution artifacts; all important claims need evidence.
   - Conflict: Opus is too trusting of worker-originated semantic outputs.
5. **Policy model**
   - Opus: `LayeredPolicy`, child policies only restrict.
   - My design: same core idea, but with explicit capability grants and enforcement points.
   - Conflict: Opus defines policy shape but not enforcement semantics.
6. **DAG mutation**
   - Opus: `StepProposal`, `ExecutionPlan` snapshots, `PlanStatus`, `EdgeTypeV2::{Speculative, Informational}`.
   - My design: dynamic DAG changes should be command/event driven and explicitly accepted before becoming executable.
   - Conflict: Opus is close, but `StepProposal` lifecycle is underspecified.
7. **Memory**
   - Opus: `StigmergyTrace`, `semantic_memory`, `procedural_memory`.
   - My design: runtime memory should be split into ephemeral coordination memory, durable learned memory, and audit/provenance.
   - Conflict: Opus names the right buckets but mixes operational hints and learned truth too loosely.
8. **Crate boundaries**
   - Opus: no new crates; put additions into existing crates.
   - My design: add boundaries if needed for protocol/runtime/policy separation.
   - Conflict: Opus optimizes migration simplicity over long-term modular clarity.
9. **Learning loop**
   - Opus: full `LearningCycle` with `p_value`.
   - My design: learning should be conservative, offline-first, and mostly proposal-generating until there is enough production data.
   - Conflict: Opus over-specifies statistical promotion too early.
**2. Where Opus Is Right**
Opus is right that **event sourcing should be append-only alongside CRUD**, not a big-bang replacement. Existing operational tables should remain the serving model while events become the audit/replay substrate.
Opus is right to reject BFT. Cortex needs **acceptance quorums**, not consensus. The Brain is the coordinator; workers provide evidence, proposals, and artifacts.
Opus is right that workers should stay **CLI-wrapped**. Replacing the worker execution model while also adding Level 5 planning, memory, policy, and learning would create too much surface area.
Opus is right that existing weighted routing data should not be thrown away. It should seed priors, reputation, and eligibility, even if the final selector changes.
Opus is right about `LayeredPolicy`: global → user → run → step, with child layers only restricting. That invariant should be adopted.
Opus is right to include `StigmergyTrace`. Lightweight coordination traces like `FileModified`, `FileLocked`, `ApproachFailed`, and `TestFlaky` are exactly the kind of local swarm memory needed before heavier semantic memory pays off.
Opus is right that `MissionControlCommand` needs first-class commands like `PauseRun`, `ResumeRun`, `RedirectStep`, `AcceptProposal`, and `RejectProposal`.
**3. Where Opus Is Wrong**
The evaluator formula is wrong. A value called `thompson` should not be just another weighted feature inside:
```text
thompson*0.40 + confidence*0.15 + capability_match*0.15 + reputation*0.20 - pressure*0.10
```
That makes the system neither clean Thompson sampling nor a transparent deterministic scorer. Better: use hard filters first, compute priors/reputation/capability as arm parameters or eligibility gates, then sample from posterior distributions.
`ArmState` per `(provider, tier, context_key)` is too coarse and too fragile. `context_key` will either explode cardinality or hide important differences. It needs a typed `RoutingContext` with bounded dimensions such as `task_kind`, `risk_class`, `tooling_required`, `latency_class`, and `execution_mode`.
`alpha`/`beta` floor at `0.5` is suspicious. Beta priors below `1.0` create U-shaped priors and can encourage extreme samples. Use named priors per context, probably starting from `Beta(1,1)` or calibrated historical priors.
Separate `cortex_events.db` is dangerous without an explicit consistency mechanism. SQLite cannot atomically commit across separate DB files in the way this architecture needs unless carefully managed, and even then operational failure modes are awkward. If separate DB wins, we need a transactional outbox or event-first write path with reconciliation.
`CheckpointPayload.worktree_tarball_uri` is not enough. A resumable checkpoint also needs command cursor, worker identity, tool permissions, environment digest, parent event id, base git SHA, patch summary, and validation status.
`SemanticOutput` is too trusting. Worker-provided `SemanticPayload::Decision` or `ReviewFindings` must be treated as claims with provenance, not facts. Soma origin also does not prove factual truth.
`PolicySpec.network_access` is too vague. Network needs structured values: `Denied`, `Allowlist`, `OpenWithApproval`, maybe with domains, ports, and purpose.
HMAC signed by Brain is acceptable for internal envelopes but incomplete. The design lacks key id, rotation, replay protection, signature coverage rules, and worker-to-brain attestation. Use HMAC for local trust zones only; do not let it become cross-boundary identity.
`semantic_memory.source_event_ids` should not be a single field unless it is purely JSON. Better is a join table: `semantic_memory_sources(memory_id, event_id)`.
`BenchmarkResult.p_value` is premature and possibly misleading. Adaptive systems and bandit changes need guardrails, counterfactual logging, canary budgets, and rollback criteria more than classical p-values.
“No new crates” is too rigid. It is fine for migration, but the architecture should allow a later extraction if `policy`, `protocol`, or `memory` becomes independently reusable.
**4. Gaps Neither Design Fully Addresses**
The remaining hard gaps:
- Idempotency: every command and event needs stable ids and replay behavior.
- Event schema evolution: explicit `event_type`, `event_version`, migration policy, and unknown-event handling.
- Ordering: per-run sequence numbers and causal parent ids.
- Backpressure: worker admission, queue depth, budget limits, and cancellation.
- Secrets: what workers can see, how secrets are redacted from checkpoints/events/memory.
- Audit model: which records are immutable, user-visible, admin-only, or purgeable.
- Rollback: how a bad learning promotion or routing change is reverted.
- Cost accounting: token, wall-clock, tool, and credit accounting must use existing `round6()` rules where money/credits are involved.
- Human authority: who can approve `MissionControlCommand` actions and quorum votes.
- Test strategy: deterministic replay tests, migration tests, policy denial tests, and worker failure simulations.
- Production ops: retention, compaction, backup, and restore for `cortex_events.db`.
**5. Final Merged Architecture**
The merged design should use Opus’s migration shape, but tighten the trust, event, evaluator, and policy semantics.
**Core Decision: CRUD + Append-Only Events Wins**
Adopt Opus’s dual model:
```ts
CortexEvent {
  event_id
  run_id
  step_id?
  event_type
  event_version
  sequence_no
  parent_event_id?
  correlation_id
  actor_type
  actor_id
  payload_json
  payload_hash
  created_at
}
```
But add a required consistency rule: operational state changes must either be event-first or use a transactional outbox. If `cortex_events.db` stays separate, add reconciliation and startup repair before Level 5 depends on replay.
Winner: **Opus, with outbox/reconciliation added.**
**Protocol: Envelope Wins**
Adopt:
```ts
Envelope<T> {
  version
  message_id
  timestamp
  correlation_id
  causation_id?
  run_id
  step_id?
  sender
  signature?
  payload: T
}
```
Keep Opus’s `BrainMessage::{SolicitBids, ProposalVerdict, PolicyEnvelope}` and `WorkerMessage::{Bid, ProposeStep, Checkpoint, SemanticOutput}`, but every message must be idempotent and replay-safe.
Winner: **Opus, with causation/idempotency added.**
**Evaluator: Thompson Sampling Wins, Weighted Composite Loses**
Replace Opus’s composite score with:
1. Hard eligibility filters: policy, capability, budget, availability.
2. Prior initialization from historical weights/reputation.
3. Thompson sample per eligible arm.
4. Tie-breakers: cost, pressure, latency, diversity.
Use:
```ts
ArmState {
  provider
  tier
  routing_context
  alpha
  beta
  observations
  last_updated_at
  decay_policy
}
```
`confidence`, `capability_match`, and `reputation` initialize or adjust priors. They are not mixed with the posterior sample as arbitrary weights.
Winner: **GPT-5.5 approach.**
**Workers: CLI-Wrapped Wins**
Adopt Opus’s `CapabilityManifest`, but make it more precise:
```ts
CapabilityManifest {
  worker_id
  roles
  providers
  execution_modes
  tools
  checkpoint_support
  max_concurrent
  resource_profile
  workspace_digest
  policy_capabilities
}
```
`SwarmRole::{Scout, Planner, Implementer, Reviewer, Tester, Guard}` is good. Add that role is advisory, not authority.
Winner: **Opus.**
**Checkpointing: Tarball as Artifact, Not Whole Checkpoint**
Keep `worktree_tarball_uri`, but expand:
```ts
CheckpointPayload {
  checkpoint_id
  base_git_sha
  worktree_tarball_uri?
  patch_uri?
  conversation_state_uri?
  execution_cursor
  environment_digest
  policy_hash
  progress_pct
  resumable
  validation_status
}
```
Winner: **Merged. Opus artifact mechanism, stricter checkpoint contract.**
**DAG: Versioned Plans Win**
Adopt `ExecutionPlan`, `PlanStatus`, `StepProposal`, and `EdgeTypeV2::{Speculative, Informational}`.
But rule: `StepProposal` cannot become executable until accepted by Brain or Mission Control. Plan transitions must be events:
```ts
PlanProposed
PlanSelected
StepProposed
StepAccepted
StepRejected
PlanSuperseded
PlanCommitted
```
Winner: **Opus structure, GPT-5.5 lifecycle rules.**
**Memory: Three-Layer Memory Wins**
Adopt Opus’s tables, but separate them clearly:
- `StigmergyTrace`: ephemeral coordination.
- `semantic_memory`: durable claims with confidence and provenance.
- `procedural_memory`: learned procedures, gated by benchmark/canary.
Change `source_event_ids` to a join table.
Winner: **Opus names, GPT-5.5 provenance model.**
**Mission Control: Commands + Quorums Win**
Adopt `MissionControlCommand` and `EvidenceQuorum`, but quorum votes must include evidence links:
```ts
QuorumVote {
  voter_id
  verdict
  confidence
  evidence_event_ids
  rationale
  created_at
}
```
No consensus language. This is acceptance control.
Winner: **Opus.**
**Security: Restrictive Layered Policy Wins**
Adopt `LayeredPolicy`, but define enforceable operations:
```ts
PolicySpec {
  allowed_operations
  allowed_paths
  denied_paths
  network_policy
  max_tokens
  max_duration_ms
  max_cost
  secret_scopes
  requires_approval
}
```
HMAC is acceptable only with `key_id`, rotation, replay window, and canonical signing. Public-key signing can be deferred unless messages cross trust domains.
Winner: **Opus for policy hierarchy; merged signing model.**
**Learning Loop: Conservative Version Wins**
Keep Opus’s lifecycle:
```ts
Classifying -> GeneratingCandidate -> Benchmarking -> CanaryRunning -> Promoting -> Completed | Rejected
```
But promotion must produce a reviewable change record, not silently mutate routing or procedures. Replace `p_value` as the central criterion with canary metrics, rollback threshold, sample size, and human approval for high-risk changes.
Winner: **Opus state machine, GPT-5.5 promotion discipline.**
**Crate Boundaries**
For the first migration, accept Opus’s “no new crates” rule:
- `cortex-core`: evaluator, protocol, policy, worker types.
- `cortex-engine`: plan, memory, learning runtime.
- `cortex-api`: mission control endpoints.
But document an extraction threshold: if protocol/policy starts being shared by multiple binaries or repos, split later.
Winner: **Opus for migration; not as a permanent rule.**
**Final Verdict**
Opus has the better migration path and several right primitives: append-only events beside CRUD, CLI workers, acceptance quorums, layered policy, stigmergy traces, and versioned plans.
The main corrections are: do not fake Thompson sampling with another weighted score; do not trust worker semantic outputs as facts; do not use separate event DBs without consistency repair; do not treat tarballs as complete checkpoints; and do not promote learning changes based on weak statistical theater.
The merged architecture is Level 5 as an event-backed, policy-constrained, dynamically planned worker swarm with conservative learning and human-visible acceptance gates.
I do not have your original Round 1 text in this thread, so I’m comparing Opus against the GPT-5.5 design position I would defend for Cortex L5: event-first but not CRUD-replacing, policy-first execution, typed protocol envelopes, probabilistic routing, runtime memory, CLI workers, and human-gated acceptance rather than consensus.
**1. Major Disagreements**
1. **Event DB placement**
   - Opus: `CortexEvent` in separate `cortex_events.db` with WAL.
   - My design: event log should be logically central, with strong write-order guarantees against run/task state.
   - Conflict: separate DB improves isolation but weakens atomicity unless we add an outbox/transaction boundary.
2. **Evaluator math**
   - Opus: `ArmState { alpha, beta }` per `(provider, tier, context_key)` plus score:
     `thompson*0.40 + confidence*0.15 + capability_match*0.15 + reputation*0.20 - pressure*0.10`.
   - My design: Thompson sampling should pick among eligible arms after hard constraints and risk filters, not be buried inside another weighted scorer.
   - Conflict: Opus keeps too much of the old weighted system.
3. **Checkpointing**
   - Opus: `CheckpointPayload { worktree_tarball_uri, conversation_state, progress_pct, resumable }`.
   - My design: checkpointing must separate filesystem state, protocol state, and execution cursor.
   - Conflict: tarballs are useful, but not sufficient as the checkpoint abstraction.
4. **Worker trust**
   - Opus: workers are semi-trusted; Brain trusted; HMAC-SHA256 signed by Brain.
   - My design: workers are untrusted for claims, semi-trusted only for execution artifacts; all important claims need evidence.
   - Conflict: Opus is too trusting of worker-originated semantic outputs.
5. **Policy model**
   - Opus: `LayeredPolicy`, child policies only restrict.
   - My design: same core idea, but with explicit capability grants and enforcement points.
   - Conflict: Opus defines policy shape but not enforcement semantics.
6. **DAG mutation**
   - Opus: `StepProposal`, `ExecutionPlan` snapshots, `PlanStatus`, `EdgeTypeV2::{Speculative, Informational}`.
   - My design: dynamic DAG changes should be command/event driven and explicitly accepted before becoming executable.
   - Conflict: Opus is close, but `StepProposal` lifecycle is underspecified.
7. **Memory**
   - Opus: `StigmergyTrace`, `semantic_memory`, `procedural_memory`.
   - My design: runtime memory should be split into ephemeral coordination memory, durable learned memory, and audit/provenance.
   - Conflict: Opus names the right buckets but mixes operational hints and learned truth too loosely.
8. **Crate boundaries**
   - Opus: no new crates; put additions into existing crates.
   - My design: add boundaries if needed for protocol/runtime/policy separation.
   - Conflict: Opus optimizes migration simplicity over long-term modular clarity.
9. **Learning loop**
   - Opus: full `LearningCycle` with `p_value`.
   - My design: learning should be conservative, offline-first, and mostly proposal-generating until there is enough production data.
   - Conflict: Opus over-specifies statistical promotion too early.
**2. Where Opus Is Right**
Opus is right that **event sourcing should be append-only alongside CRUD**, not a big-bang replacement. Existing operational tables should remain the serving model while events become the audit/replay substrate.
Opus is right to reject BFT. Cortex needs **acceptance quorums**, not consensus. The Brain is the coordinator; workers provide evidence, proposals, and artifacts.
Opus is right that workers should stay **CLI-wrapped**. Replacing the worker execution model while also adding Level 5 planning, memory, policy, and learning would create too much surface area.
Opus is right that existing weighted routing data should not be thrown away. It should seed priors, reputation, and eligibility, even if the final selector changes.
Opus is right about `LayeredPolicy`: global → user → run → step, with child layers only restricting. That invariant should be adopted.
Opus is right to include `StigmergyTrace`. Lightweight coordination traces like `FileModified`, `FileLocked`, `ApproachFailed`, and `TestFlaky` are exactly the kind of local swarm memory needed before heavier semantic memory pays off.
Opus is right that `MissionControlCommand` needs first-class commands like `PauseRun`, `ResumeRun`, `RedirectStep`, `AcceptProposal`, and `RejectProposal`.
**3. Where Opus Is Wrong**
The evaluator formula is wrong. A value called `thompson` should not be just another weighted feature inside:
```text
thompson*0.40 + confidence*0.15 + capability_match*0.15 + reputation*0.20 - pressure*0.10
```
That makes the system neither clean Thompson sampling nor a transparent deterministic scorer. Better: use hard filters first, compute priors/reputation/capability as arm parameters or eligibility gates, then sample from posterior distributions.
`ArmState` per `(provider, tier, context_key)` is too coarse and too fragile. `context_key` will either explode cardinality or hide important differences. It needs a typed `RoutingContext` with bounded dimensions such as `task_kind`, `risk_class`, `tooling_required`, `latency_class`, and `execution_mode`.
`alpha`/`beta` floor at `0.5` is suspicious. Beta priors below `1.0` create U-shaped priors and can encourage extreme samples. Use named priors per context, probably starting from `Beta(1,1)` or calibrated historical priors.
Separate `cortex_events.db` is dangerous without an explicit consistency mechanism. SQLite cannot atomically commit across separate DB files in the way this architecture needs unless carefully managed, and even then operational failure modes are awkward. If separate DB wins, we need a transactional outbox or event-first write path with reconciliation.
`CheckpointPayload.worktree_tarball_uri` is not enough. A resumable checkpoint also needs command cursor, worker identity, tool permissions, environment digest, parent event id, base git SHA, patch summary, and validation status.
`SemanticOutput` is too trusting. Worker-provided `SemanticPayload::Decision` or `ReviewFindings` must be treated as claims with provenance, not facts. Soma origin also does not prove factual truth.
`PolicySpec.network_access` is too vague. Network needs structured values: `Denied`, `Allowlist`, `OpenWithApproval`, maybe with domains, ports, and purpose.
HMAC signed by Brain is acceptable for internal envelopes but incomplete. The design lacks key id, rotation, replay protection, signature coverage rules, and worker-to-brain attestation. Use HMAC for local trust zones only; do not let it become cross-boundary identity.
`semantic_memory.source_event_ids` should not be a single field unless it is purely JSON. Better is a join table: `semantic_memory_sources(memory_id, event_id)`.
`BenchmarkResult.p_value` is premature and possibly misleading. Adaptive systems and bandit changes need guardrails, counterfactual logging, canary budgets, and rollback criteria more than classical p-values.
“No new crates” is too rigid. It is fine for migration, but the architecture should allow a later extraction if `policy`, `protocol`, or `memory` becomes independently reusable.
**4. Gaps Neither Design Fully Addresses**
The remaining hard gaps:
- Idempotency: every command and event needs stable ids and replay behavior.
- Event schema evolution: explicit `event_type`, `event_version`, migration policy, and unknown-event handling.
- Ordering: per-run sequence numbers and causal parent ids.
- Backpressure: worker admission, queue depth, budget limits, and cancellation.
- Secrets: what workers can see, how secrets are redacted from checkpoints/events/memory.
- Audit model: which records are immutable, user-visible, admin-only, or purgeable.
- Rollback: how a bad learning promotion or routing change is reverted.
- Cost accounting: token, wall-clock, tool, and credit accounting must use existing `round6()` rules where money/credits are involved.
- Human authority: who can approve `MissionControlCommand` actions and quorum votes.
- Test strategy: deterministic replay tests, migration tests, policy denial tests, and worker failure simulations.
- Production ops: retention, compaction, backup, and restore for `cortex_events.db`.
**5. Final Merged Architecture**
The merged design should use Opus’s migration shape, but tighten the trust, event, evaluator, and policy semantics.
**Core Decision: CRUD + Append-Only Events Wins**
Adopt Opus’s dual model:
```ts
CortexEvent {
  event_id
  run_id
  step_id?
  event_type
  event_version
  sequence_no
  parent_event_id?
  correlation_id
  actor_type
  actor_id
  payload_json
  payload_hash
  created_at
}
```
But add a required consistency rule: operational state changes must either be event-first or use a transactional outbox. If `cortex_events.db` stays separate, add reconciliation and startup repair before Level 5 depends on replay.
Winner: **Opus, with outbox/reconciliation added.**
**Protocol: Envelope Wins**
Adopt:
```ts
Envelope<T> {
  version
  message_id
  timestamp
  correlation_id
  causation_id?
  run_id
  step_id?
  sender
  signature?
  payload: T
}
```
Keep Opus’s `BrainMessage::{SolicitBids, ProposalVerdict, PolicyEnvelope}` and `WorkerMessage::{Bid, ProposeStep, Checkpoint, SemanticOutput}`, but every message must be idempotent and replay-safe.
Winner: **Opus, with causation/idempotency added.**
**Evaluator: Thompson Sampling Wins, Weighted Composite Loses**
Replace Opus’s composite score with:
1. Hard eligibility filters: policy, capability, budget, availability.
2. Prior initialization from historical weights/reputation.
3. Thompson sample per eligible arm.
4. Tie-breakers: cost, pressure, latency, diversity.
Use:
```ts
ArmState {
  provider
  tier
  routing_context
  alpha
  beta
  observations
  last_updated_at
  decay_policy
}
```
`confidence`, `capability_match`, and `reputation` initialize or adjust priors. They are not mixed with the posterior sample as arbitrary weights.
Winner: **GPT-5.5 approach.**
**Workers: CLI-Wrapped Wins**
Adopt Opus’s `CapabilityManifest`, but make it more precise:
```ts
CapabilityManifest {
  worker_id
  roles
  providers
  execution_modes
  tools
  checkpoint_support
  max_concurrent
  resource_profile
  workspace_digest
  policy_capabilities
}
```
`SwarmRole::{Scout, Planner, Implementer, Reviewer, Tester, Guard}` is good. Add that role is advisory, not authority.
Winner: **Opus.**
**Checkpointing: Tarball as Artifact, Not Whole Checkpoint**
Keep `worktree_tarball_uri`, but expand:
```ts
CheckpointPayload {
  checkpoint_id
  base_git_sha
  worktree_tarball_uri?
  patch_uri?
  conversation_state_uri?
  execution_cursor
  environment_digest
  policy_hash
  progress_pct
  resumable
  validation_status
}
```
Winner: **Merged. Opus artifact mechanism, stricter checkpoint contract.**
**DAG: Versioned Plans Win**
Adopt `ExecutionPlan`, `PlanStatus`, `StepProposal`, and `EdgeTypeV2::{Speculative, Informational}`.
But rule: `StepProposal` cannot become executable until accepted by Brain or Mission Control. Plan transitions must be events:
```ts
PlanProposed
PlanSelected
StepProposed
StepAccepted
StepRejected
PlanSuperseded
PlanCommitted
```
Winner: **Opus structure, GPT-5.5 lifecycle rules.**
**Memory: Three-Layer Memory Wins**
Adopt Opus’s tables, but separate them clearly:
- `StigmergyTrace`: ephemeral coordination.
- `semantic_memory`: durable claims with confidence and provenance.
- `procedural_memory`: learned procedures, gated by benchmark/canary.
Change `source_event_ids` to a join table.
Winner: **Opus names, GPT-5.5 provenance model.**
**Mission Control: Commands + Quorums Win**
Adopt `MissionControlCommand` and `EvidenceQuorum`, but quorum votes must include evidence links:
```ts
QuorumVote {
  voter_id
  verdict
  confidence
  evidence_event_ids
  rationale
  created_at
}
```
No consensus language. This is acceptance control.
Winner: **Opus.**
**Security: Restrictive Layered Policy Wins**
Adopt `LayeredPolicy`, but define enforceable operations:
```ts
PolicySpec {
  allowed_operations
  allowed_paths
  denied_paths
  network_policy
  max_tokens
  max_duration_ms
  max_cost
  secret_scopes
  requires_approval
}
```
HMAC is acceptable only with `key_id`, rotation, replay window, and canonical signing. Public-key signing can be deferred unless messages cross trust domains.
Winner: **Opus for policy hierarchy; merged signing model.**
**Learning Loop: Conservative Version Wins**
Keep Opus’s lifecycle:
```ts
Classifying -> GeneratingCandidate -> Benchmarking -> CanaryRunning -> Promoting -> Completed | Rejected
```
But promotion must produce a reviewable change record, not silently mutate routing or procedures. Replace `p_value` as the central criterion with canary metrics, rollback threshold, sample size, and human approval for high-risk changes.
Winner: **Opus state machine, GPT-5.5 promotion discipline.**
**Crate Boundaries**
For the first migration, accept Opus’s “no new crates” rule:
- `cortex-core`: evaluator, protocol, policy, worker types.
- `cortex-engine`: plan, memory, learning runtime.
- `cortex-api`: mission control endpoints.
But document an extraction threshold: if protocol/policy starts being shared by multiple binaries or repos, split later.
Winner: **Opus for migration; not as a permanent rule.**
**Final Verdict**
Opus has the better migration path and several right primitives: append-only events beside CRUD, CLI workers, acceptance quorums, layered policy, stigmergy traces, and versioned plans.
The main corrections are: do not fake Thompson sampling with another weighted score; do not trust worker semantic outputs as facts; do not use separate event DBs without consistency repair; do not treat tarballs as complete checkpoints; and do not promote learning changes based on weak statistical theater.
The merged architecture is Level 5 as an event-backed, policy-constrained, dynamically planned worker swarm with conservative learning and human-visible acceptance gates.
