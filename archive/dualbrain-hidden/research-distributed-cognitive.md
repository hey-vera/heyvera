I’ll verify the current state of the named systems and then synthesize this as an implementation-focused report for a Rust Cortex Brain/Worker architecture.
web search: 
web search: Yjs CRDT documentation update model shared types
web search: 
web search: Temporal durable execution workflows official documentation
web search: 
web search: Temporal official documentation workflows durable execution replay deterministic
web search: 
web search: Alloy analyzer official documentation model checking
web search: 
web search: ant colony optimization Dorigo paper technical overview
web search: 
web search: ant colony optimization Dorigo Gambardella ant colony system paper PDF
web search: 
web search: yrs Rust Yjs crate documentation
codex
**Report: Distributed Systems, Biological Intelligence, And Unconventional Computing Paradigms For Cortex**
Cortex, as a Rust-based Brain/Worker AI orchestration engine, should not be designed as a simple job queue with LLM wrappers. The hard problems are distributed coordination, recoverability, contention over shared artifacts, divergent agent beliefs, partial failures, and long-running adaptive behavior. The strongest architecture is a hybrid: an event-sourced durable core, CRDT-backed collaborative workspaces, reactive execution graphs, formal safety models for orchestration invariants, and optional swarm/P2P modes for exploration and scale.
The central design principle: Cortex should treat agents less like stateless API calls and more like unreliable, concurrent, semi-autonomous distributed processes.
---
## 1. CRDTs For Multi-Agent Code Editing
CRDTs are a direct fit for one hard Cortex problem: multiple agents editing the same workspace without a central lock on every file. Yjs exposes shared CRDT types like `Y.Text`, `Y.Map`, and `Y.Array`, with update-based synchronization and existing WebSocket/WebRTC/persistence adapters. Automerge provides JSON-like CRDT documents, local-first sync, a binary format, and a sync protocol. Diamond Types is especially relevant to Rust because it is a high-performance Rust CRDT focused on plain text editing.
Relevant sources: [Yjs docs](https://docs.yjs.dev/), [Yjs shared types](https://docs.yjs.dev/api/shared-types), [Automerge](https://automerge.org/), [Automerge Rust crate](https://automerge.org/automerge/automerge/index.html), [Yrs Rust crate](https://docs.rs/yrs/latest/yrs/), [Diamond Types crate](https://docs.rs/diamond-types/latest/i686-pc-windows-msvc/diamond_types/).
For Cortex, CRDTs should not replace Git. They should sit below Git as a live collaboration layer and above the raw filesystem as a workspace mutation log.
A practical architecture:
```text
Cortex Brain
  Workspace Registry
  Event Store
  Merge/Review Policy Engine
Worker A              Worker B              Worker C
  CRDT checkout         CRDT checkout         CRDT checkout
  edit file X           edit file X           edit file Y
  emit ops              emit ops              emit ops
CRDT Workspace Service
  file_id -> CRDT document
  path tree -> CRDT map
  awareness -> cursor/intent/lock hints
  snapshots -> Git branch/commit
```
Each file can be represented as a text CRDT. The directory tree can be represented as a map CRDT: path, file id, mode, tombstone, rename metadata. Agent-local edits become CRDT operations rather than immediate filesystem writes. A materializer then renders the CRDT workspace to a real directory for build/test execution.
This has advantages:
- Agents can work offline or under temporary network partition.
- Concurrent edits converge instead of overwriting each other.
- Every insertion/deletion has provenance: agent id, task id, event id.
- The Brain can inspect live partial work without waiting for a patch.
- Merge conflicts become structured CRDT conflicts plus semantic review, rather than opaque Git conflict hunks.
But code is not prose. Text convergence does not imply compilable or semantically correct code. If two agents edit the same function, the CRDT will preserve both edits, but the result may duplicate logic, break syntax, or violate intent. Cortex therefore needs a two-layer model:
1. **Syntactic CRDT layer**: guarantees no lost characters and deterministic convergence.
2. **Semantic integration layer**: parses, formats, tests, and validates resulting code.
For Rust, a feasible initial implementation would use `yrs` for Yjs-compatible shared documents or `diamond-types` for plain text performance. Automerge is better when representing structured state, such as task boards, memory records, DAG definitions, or workspace manifests. Diamond Types is attractive for file text because it is Rust-native and optimized for collaborative strings, but it is narrower than Automerge/Yjs.
Recommended Cortex design:
```rust
struct WorkspaceOp {
    workspace_id: WorkspaceId,
    file_id: FileId,
    agent_id: AgentId,
    task_id: TaskId,
    lamport: u64,
    op: CrdtOpBytes,
    intent: EditIntent,
    base_git_commit: Sha,
}
```
Use CRDTs for live multi-agent editing, but keep Git as the release boundary. The Brain should periodically produce “semantic checkpoints”: materialize CRDT state, run formatter/parser/tests, generate a patch, and commit to a branch. The Git commit is the accepted artifact; the CRDT log is the collaborative substrate.
Could agents edit the same codebase simultaneously using a CRDT-based filesystem? Yes, but only if Cortex treats the CRDT filesystem as a collaborative staging environment, not as the production filesystem. The safe pattern is:
```text
CRDT ops -> materialized workspace -> build/test/typecheck -> patch review -> Git commit
```
A full CRDT filesystem would need path CRDTs, rename conflict policy, tombstones, permissions, binary blob handling, generated-file filtering, and Git reconciliation. For MVP, implement CRDT-backed text files plus a conventional file tree manifest.
---
## 2. Biological Swarm Intelligence In Software
Biological swarm intelligence is useful for Cortex because agent orchestration often involves search under uncertainty: which task should run next, which worker is reliable, which plan is promising, which file is risky, which branch should be explored?
Ant colony optimization, bee foraging, and neural swarm behavior all suggest coordination without heavy central planning. Ant colony optimization uses indirect signals analogous to pheromones. Better paths accumulate stronger traces; stale paths decay. Bee foraging uses scouts, employed bees, and onlookers: some agents explore new sources, some exploit known sources, and others allocate effort based on observed quality. Stigmergy means agents coordinate by modifying a shared environment rather than directly messaging every other agent.
Sources: [Ant System by Dorigo et al.](https://www.researchgate.net/publication/235439153_Ant_sytem_Optimization_by_a_colony_of_cooperating_agents), [Ant Colony System](https://faculty.washington.edu/paymana/swarm/dorigo97-itec.pdf), [Artificial Bee Colony overview](https://link.springer.com/article/10.1007/s40747-022-00746-1), [virtual stigmergy in multi-agent systems](https://www.sciencedirect.com/science/article/pii/S016764231930139X).
For Cortex, stigmergy should become a first-class runtime concept.
Instead of only storing task state like:
```text
task_123: running
```
Cortex should store environmental traces:
```text
trace:
  kind: file_hotspot
  target: src/billing/ledger.rs
  strength: 0.84
  emitted_by: agent_7
  evidence: ["test_failed", "recent_conflict", "high_churn"]
  decay_half_life: 30m
```
Possible trace types:
- `file_hotspot`: many agents touched this file or tests fail near it.
- `promising_plan`: a plan has passed partial validation.
- `blocked_path`: a branch of work hit unresolved dependency.
- `risky_tool`: a command or tool caused repeated failures.
- `semantic_conflict`: two agents reached incompatible conclusions.
- `test_signal`: a test is strongly correlated with a task.
- `expertise_signal`: worker has high success rate on a module.
Ant-colony scheduling can be applied to task routing. Each worker-task edge has a pheromone score:
```text
score(worker, task) =
  pheromone(worker, module)
  * heuristic(task_priority, dependency_unblock_value, worker_capacity)
  * freshness_decay
```
Pheromone increases when a worker completes a similar task, fixes a failing test, or produces accepted code. It decays over time to avoid permanent lock-in.
Bee-foraging maps well to agent roles:
- **Scout workers** explore uncertain solution paths cheaply.
- **Employed workers** develop known promising paths.
- **Onlooker workers** choose among advertised partial results.
- **Guard workers** inspect safety, policy, and merge risk.
The Brain does not need to decide everything upfront. It can maintain a “nectar board” of candidate work items, each with confidence, cost, expected value, and current evidence. Workers bid for or sample work based on local heuristics.
Emergent behavior is useful but dangerous. A swarm can converge on bad local optima, amplify false signals, or stampede into the same file. Cortex needs dampers:
- Pheromone decay.
- Diversity quotas.
- Negative traces for repeated failure.
- Exploration budgets.
- Per-file concurrency limits.
- Randomized assignment with weighted probability, not strict max-score routing.
In implementation terms, use SQLite tables or event-sourced projections:
```sql
agent_trace(id, kind, target, strength, emitted_by, event_id, created_at, expires_at)
agent_affinity(worker_id, module, score, successes, failures, updated_at)
task_signal(task_id, signal_kind, value, confidence, source_event_id)
```
This converts swarm intelligence into measurable scheduling metadata.
---
## 3. Event Sourcing For Agent Orchestration
Event sourcing is probably the most important architectural shift for Cortex. Instead of storing mutable task state as the source of truth, every agent action should be an immutable event.
Current-style mutable orchestration:
```text
task.status = "running"
task.assigned_to = "worker-3"
task.output = latest_output
```
Event-sourced orchestration:
```text
TaskCreated
WorkerAssigned
PromptRendered
ModelCalled
ToolRequested
ToolStarted
ToolCompleted
PatchProposed
TestRunStarted
TestRunCompleted
ReviewFailed
RetryScheduled
TaskCompleted
```
The mutable state becomes a projection derived from the event log.
Temporal and Restate show why this matters. Temporal’s platform documentation describes crash-proof execution that resumes after failures. Restate records progress in a journal, skips already completed steps on retry, supports durable timers, and provides durable communication/state. Restate is also Rust-based at the server level and has a Rust SDK, making it especially relevant for Cortex.
Sources: [Temporal docs](https://docs.temporal.io/), [Restate durable execution concepts](https://docs.restate.dev/concepts/durable_execution/), [Restate overview](https://docs.restate.dev/index), [Restate durable execution article](https://www.restate.dev/what-is-durable-execution/).
For Cortex, durable execution transforms the Brain from “scheduler plus database” into a replayable control plane.
A Cortex event schema might look like:
```rust
enum CortexEvent {
    TaskCreated { task_id: TaskId, goal: String },
    WorkerLeased { task_id: TaskId, worker_id: WorkerId, lease_id: LeaseId },
    AgentStepStarted { run_id: RunId, step_id: StepId, input_hash: Hash },
    ModelCallRecorded { step_id: StepId, provider: String, request_hash: Hash, response_ref: BlobRef },
    ToolCallRequested { step_id: StepId, tool: String, args_hash: Hash },
    ToolCallCompleted { step_id: StepId, exit_code: i32, stdout_ref: BlobRef, stderr_ref: BlobRef },
    WorkspaceOpAppended { workspace_id: WorkspaceId, op_ref: BlobRef },
    TestResultRecorded { run_id: RunId, status: TestStatus },
    HumanDecisionRecorded { decision_id: DecisionId, outcome: Decision },
}
```
Important rule: LLM calls and tool calls are non-deterministic side effects. They must be recorded as events with content-addressed blobs. On replay, Cortex should not call the model again unless explicitly scheduled. It should reuse the recorded result.
This unlocks:
- Complete auditability.
- Replay and debugging of agent failures.
- Idempotent retries.
- Time travel across orchestration decisions.
- Deterministic reconstruction of task state.
- Safer billing and quota accounting.
- Better security review because every tool call is inspectable.
A recommended implementation for Cortex:
```text
SQLite WAL Event Store
  events(sequence, stream_id, event_type, payload_json, payload_hash, created_at)
  blobs(hash, media_type, storage_uri, size)
  projections(...)
  outbox(...)
Rust Brain
  append_event()
  load_stream()
  rebuild_projection()
  dispatch_outbox()
Workers
  poll/subscribe
  execute lease
  append results
```
Because the user’s repository constraints mention SQLite WAL and raw SQL patterns, Cortex can start with SQLite as a single-node durable log. Later, event streams can be partitioned by workspace, task, or tenant.
Temporal/Restate can either be integrated or treated as design references. If Cortex wants maximum control, implement a minimal durable step engine directly. If it wants production-grade workflow recovery quickly, use Restate/Temporal for workflow substrate and keep Cortex-specific agent semantics above it.
---
## 4. Consensus And Game Theory
Consensus is needed when Cortex must decide one authoritative value among competing proposals: which patch wins, whether a task is complete, whether an agent result is trustworthy, or whether a worker should be quarantined.
Raft is appropriate for trusted Cortex Brain replicas. Raft is a consensus algorithm for replicated logs; it is easier to understand than Paxos and well suited to leader-based replication. Paxos is more general but harder to implement correctly. For a Cortex cluster, Raft can replicate the event log or coordinate leases.
Source: [Raft paper via USENIX](https://www.usenix.org/node/184041.).
Do not use Raft for agent disagreement. Raft assumes non-Byzantine nodes. An LLM agent can be wrong, hallucinate, or act adversarially if prompt-injected. That is closer to Byzantine behavior: nodes may produce arbitrary incorrect outputs.
PBFT-style reasoning matters when Cortex has multiple agents evaluating an untrusted action. Practical Byzantine Fault Tolerance was designed to tolerate arbitrary faulty replicas under assumptions about the number of faulty nodes.
Source: [PBFT paper](https://www.usenix.org/legacy/publications/library/proceedings/osdi99/full_papers/castro/castro_html/castro.html).
For Cortex, full PBFT is probably overkill for everyday orchestration. But BFT-inspired quorum policy is useful:
```text
Accept patch if:
  1 implementer proposes it
  1 reviewer validates it
  1 test runner confirms it
  no security guard vetoes it
```
Or for high-risk operations:
```text
Require 2-of-3 independent reviewers
Require deterministic test evidence
Require policy engine approval
Require no unresolved contradiction event
```
This is not blockchain consensus. It is evidence consensus.
Game theory enters because agents optimize whatever Cortex rewards. If agents are rewarded only for task completion, they may produce shallow fixes. If rewarded only for passing tests, they may overfit. If rewarded for speed, they may avoid hard tasks.
Mechanism design for Cortex should define incentive-compatible protocols:
- Reward accepted outcomes, not verbose effort.
- Penalize downstream reverts, failed reviews, and flaky tests.
- Give partial credit for useful negative findings.
- Separate proposer, executor, and verifier roles.
- Randomly audit high-confidence claims.
- Use stake-like reputation: agents with high reputation get more autonomy; failed high-risk actions reduce autonomy.
A concrete scoring model:
```text
agent_reputation =
  accepted_patch_rate * 0.35
  + review_accuracy * 0.25
  + test_prediction_accuracy * 0.15
  + low_revert_rate * 0.15
  + cost_efficiency * 0.10
```
Consensus should be layered:
- **Raft**: Brain cluster and event log replication among trusted infrastructure nodes.
- **Lease consensus**: exactly one worker owns a mutable execution lease.
- **Evidence quorum**: multiple agents/tools agree on task state.
- **Human override**: final authority for risky merge/deploy decisions.
- **BFT-style guardrails**: for untrusted workers, external contributors, or model-generated shell/code actions.
---
## 5. P2P Agent Networks
A central Brain is simpler, but it can become a bottleneck or single point of failure. P2P workers can coordinate directly for large-scale exploration, local inference, edge deployments, or degraded operation.
libp2p is the obvious Rust-compatible foundation. It provides modular peer-to-peer networking, peer identity, transports, discovery, NAT traversal, and pub/sub such as GossipSub.
Sources: [libp2p IPFS docs](https://docs.ipfs.tech/concepts/libp2p/), [rust-libp2p docs](https://libp2p.github.io/rust-libp2p/libp2p/), [rust-libp2p getting started](https://libp2p.io/docs/getting-started-rust/).
A Cortex P2P mode could look like:
```text
Brain: policy, event anchoring, high-value scheduling
Workers: local task exchange, artifact gossip, model shard discovery
Network: libp2p GossipSub + request/response + Kademlia discovery
```
Useful P2P capabilities:
- Workers share cached model outputs by content hash.
- Workers advertise tool capabilities.
- Workers exchange CRDT workspace updates.
- Workers form local review quorums.
- Workers continue low-risk tasks if Brain is temporarily unavailable.
- Edge nodes perform federated inference near data.
But P2P introduces serious issues:
- Identity and authorization become harder.
- Prompt injection can spread through gossiped artifacts.
- Malicious workers can advertise false capabilities.
- Network partitions create divergent beliefs.
- Debugging becomes more complex.
Cortex should not start fully decentralized. A practical design is “federated orchestration”:
```text
Central Brain anchors truth.
Regional/tenant worker meshes optimize local coordination.
All accepted state eventually lands in the Brain event log.
```
Each worker has a cryptographic identity. Messages are signed. Artifacts are content-addressed. Capability claims require Brain-issued attestations. The Brain can define topic ACLs:
```text
/cortex/workspace/{id}/crdt
/cortex/task/{id}/events
/cortex/artifacts/{hash}/providers
/cortex/capability/rust-test-runner
```
The P2P layer is then an optimization plane, not the source of truth.
---
## 6. Reactive Dataflow
Agent orchestration is naturally a graph: prompts depend on repo state, tests depend on patches, reviews depend on diffs, deployments depend on checks. Traditional orchestrators often execute DAGs once. Cortex should treat DAGs as reactive streams: when an input changes, dependent computations invalidate and re-execute.
Differential dataflow is relevant because it performs incremental computation over changing inputs. Materialize uses Timely and Differential Dataflow to maintain query results over fast-changing data. Hydroflow is a Berkeley project for distributed systems programming with dataflow concepts and lattice/CALM-inspired reasoning.
Sources: [Materialize docs](https://materialize.com/docs/transform-data/), [Materialize arrangements](https://materialize.com/docs/get-started/arrangements/), [Hydroflow paper](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2021/EECS-2021-201.pdf).
For Cortex:
```text
Inputs:
  repo commit
  CRDT workspace snapshot
  task goal
  agent memory
  tool result
  human feedback
  policy config
Derived nodes:
  plan
  file relevance
  patch
  test selection
  review summary
  risk score
  merge readiness
```
If `src/billing/ledger.rs` changes, Cortex should automatically invalidate:
- stale code summaries,
- dependent plans,
- test recommendations,
- patch reviews,
- risk assessments,
- any agent memory derived from old code.
This avoids a common multi-agent failure: agents continue reasoning from stale context.
A Rust implementation does not need full Materialize initially. Cortex can implement incremental projections over the event log:
```rust
trait ReactiveNode {
    type Input;
    type Output;
    fn dependencies(&self) -> Vec<NodeId>;
    fn compute(&self, input: Self::Input) -> Self::Output;
    fn cache_key(&self, input_hashes: &[Hash]) -> Hash;
}
```
Then store:
```sql
reactive_node(id, kind, config_hash)
reactive_edge(parent_id, child_id)
reactive_value(node_id, input_hash, output_hash, status, updated_at)
invalidations(node_id, reason_event_id)
```
Long term, Cortex can use differential-style deltas:
```text
+ PatchProposed(file=A)
- ReviewValid(old_patch)
+ ReviewRequired(new_patch)
```
Instead of recomputing the entire orchestration state, it propagates small changes. This is especially powerful when hundreds of agents operate over thousands of files.
---
## 7. Formal Verification Of Agents
Formal verification should not try to prove that LLMs are correct. It should prove that the orchestration substrate preserves safety properties despite unreliable agents.
TLA+ is designed for concurrent and distributed systems modeling. Alloy is useful for bounded structural modeling and finding counterexamples through SAT solving. Rust property-based testing with tools like `proptest` can generate randomized event sequences and check invariants.
Sources: [TLA+ overview](https://en.wikipedia.org/wiki/TLA%2B), [Alloy Analyzer docs](https://alloydocs-fork.readthedocs.io/en/latest/tooling/analyzer.html), [Alloy model finder explanation](https://alloytools.org/faq/how_does_the_alloy_analyzer_differ_from_model_checkers.html), [proptest crate](https://docs.rs/proptest/latest/proptest/).
Critical Cortex invariants:
- No task is completed unless required evidence exists.
- No lease is owned by two workers at the same time.
- No tool result is accepted without matching request id.
- No model call is billed twice after replay.
- No CRDT checkpoint becomes a Git commit without materialization and validation.
- No deployment starts from an unreviewed commit.
- No worker can append events for a tenant it is not authorized for.
- No event replay changes the resulting projection.
TLA+ model candidates:
1. Worker lease protocol.
2. Event append and replay.
3. Retry/idempotency semantics.
4. Human approval gates.
5. Patch acceptance quorum.
6. Brain failover and leader election if using Raft.
Example invariant:
```text
Invariant: For every task marked Complete,
there exists at least one TestResultRecorded(success)
and one ReviewAccepted
after the latest PatchProposed event for that task.
```
Property-based testing should run against the real Rust projection code. Generate random sequences:
```text
TaskCreated
WorkerLeased
WorkerLeased duplicate
ToolStarted
ToolCompleted unknown id
PatchProposed
ReviewAccepted stale patch
RetryScheduled
TaskCompleted
```
Then assert that projections never reach impossible states.
Cortex should maintain a `crates/orchestration-model` test suite where events are arbitrary generated data. This is more valuable than normal unit tests because orchestration bugs usually occur in weird interleavings.
Formal methods should be applied surgically. Do not model the entire AI system. Model the small protocols that must never fail.
---
## 8. Cognitive Architectures
Cortex can borrow from cognitive science without pretending to replicate a brain.
Global Workspace Theory suggests a system where many specialized processes operate locally, but selected information is broadcast globally when it becomes salient. For Cortex, the Brain’s global workspace is not a consciousness layer; it is a priority broadcast bus.
Source: [Global Workspace Theory overview](https://en.wikipedia.org/wiki/Global_workspace_theory).
Implementation idea:
```text
Local processors:
  code summarizer
  test runner
  planner
  reviewer
  security guard
  memory retriever
  cost monitor
Global workspace:
  high-salience events
  active goals
  current blockers
  accepted world model
  working memory
```
Agents should not all see everything. They should receive selected broadcasts:
```text
Broadcast:
  kind: blocker
  salience: 0.92
  target_agents: ["planner", "rust-fixer", "reviewer"]
  content_ref: blob_hash
```
Predictive processing and Friston’s free energy principle suggest another useful pattern: maintain a generative model of expected outcomes, then minimize prediction error. In software terms, Cortex should predict what will happen when an agent acts, then learn from deviations.
Sources: [Predictive coding under free-energy principle](https://pmc.ncbi.nlm.nih.gov/articles/PMC2666703/), [Friston free-energy principle](https://www.nature.com/articles/nrn2787).
For each task, Cortex can predict:
- expected files touched,
- expected tests affected,
- expected runtime,
- probability of merge success,
- likely failure modes,
- cost estimate,
- review risk.
After execution, compute prediction error:
```text
prediction_error =
  abs(expected_cost - actual_cost)
  + changed_files_surprise
  + failed_tests_surprise
  + review_rejection_surprise
```
High prediction error updates memory and scheduling. If Cortex predicted a simple docs change but the worker edited billing code, that is a salience spike requiring review.
Memory consolidation is also central. Cortex should distinguish:
- **Working memory**: active task context, current plan, open files, recent tool output.
- **Episodic memory**: event traces of specific runs, failures, reviews, decisions.
- **Semantic memory**: durable facts about the codebase, architecture, APIs, conventions.
- **Procedural memory**: learned workflows, tool recipes, debugging playbooks, patch strategies.
A concrete storage model:
```text
working_memory:
  short TTL, task-scoped, small, frequently overwritten
episodic_memory:
  event-sourced, append-only, replayable
semantic_memory:
  curated docs, code summaries, symbol graphs, architecture facts
procedural_memory:
  versioned strategies with success metrics
```
Neuroplasticity maps to adaptive routing and strategy updates. Cortex should not hard-code one orchestration policy forever. It should update weights based on outcomes:
```text
strategy: "run targeted tests before broad tests"
success_rate: 0.78
contexts: ["rust", "billing", "small_patch"]
last_updated: ...
```
But plasticity needs boundaries. Cortex should version learned policies, keep rollback, and require approval before changing high-risk behavior.
---
## Recommended Cortex Architecture
The strongest concrete architecture is:
```text
Cortex Brain
  Event Store
  Durable Step Engine
  Reactive Projection Engine
  Policy/Quorum Engine
  Global Workspace
  Memory Consolidator
  Scheduler with Swarm Signals
Cortex Worker
  Tool sandbox
  Model adapter
  CRDT workspace client
  Event append client
  Local cache
  P2P optional mesh client
Workspace Layer
  CRDT text docs
  path manifest
  materializer
  Git checkpoint bridge
Verification Layer
  property tests
  TLA+ specs
  replay tests
  deterministic projection tests
```
Suggested implementation order:
1. Build the event-sourced core first.
2. Add durable idempotent worker steps.
3. Add reactive projections from events.
4. Add CRDT workspace staging for concurrent edits.
5. Add quorum-based review and policy gates.
6. Add stigmergic scheduling signals.
7. Add formal models for leases, replay, and patch acceptance.
8. Add optional P2P worker mesh.
The key warning: do not combine all paradigms at once as a research artifact. Cortex should use each paradigm for a specific failure mode.
- CRDTs solve concurrent workspace edits.
- Event sourcing solves audit, replay, and recovery.
- Durable execution solves crashes and retries.
- Swarm intelligence solves exploration and adaptive scheduling.
- Consensus solves authoritative decisions.
- P2P solves scale and degraded coordination.
- Reactive dataflow solves stale context.
- Formal verification solves orchestration safety.
- Cognitive architecture solves attention, memory, and adaptation.
If implemented this way, Cortex becomes more than an AI task runner. It becomes a durable distributed cognition runtime: agents act concurrently, leave traces, converge through evidence, recover after failure, and continuously improve without surrendering control of the system’s safety boundaries.
**Report: Distributed Systems, Biological Intelligence, And Unconventional Computing Paradigms For Cortex**
Cortex, as a Rust-based Brain/Worker AI orchestration engine, should not be designed as a simple job queue with LLM wrappers. The hard problems are distributed coordination, recoverability, contention over shared artifacts, divergent agent beliefs, partial failures, and long-running adaptive behavior. The strongest architecture is a hybrid: an event-sourced durable core, CRDT-backed collaborative workspaces, reactive execution graphs, formal safety models for orchestration invariants, and optional swarm/P2P modes for exploration and scale.
The central design principle: Cortex should treat agents less like stateless API calls and more like unreliable, concurrent, semi-autonomous distributed processes.
---
## 1. CRDTs For Multi-Agent Code Editing
CRDTs are a direct fit for one hard Cortex problem: multiple agents editing the same workspace without a central lock on every file. Yjs exposes shared CRDT types like `Y.Text`, `Y.Map`, and `Y.Array`, with update-based synchronization and existing WebSocket/WebRTC/persistence adapters. Automerge provides JSON-like CRDT documents, local-first sync, a binary format, and a sync protocol. Diamond Types is especially relevant to Rust because it is a high-performance Rust CRDT focused on plain text editing.
Relevant sources: [Yjs docs](https://docs.yjs.dev/), [Yjs shared types](https://docs.yjs.dev/api/shared-types), [Automerge](https://automerge.org/), [Automerge Rust crate](https://automerge.org/automerge/automerge/index.html), [Yrs Rust crate](https://docs.rs/yrs/latest/yrs/), [Diamond Types crate](https://docs.rs/diamond-types/latest/i686-pc-windows-msvc/diamond_types/).
For Cortex, CRDTs should not replace Git. They should sit below Git as a live collaboration layer and above the raw filesystem as a workspace mutation log.
A practical architecture:
```text
Cortex Brain
  Workspace Registry
  Event Store
  Merge/Review Policy Engine
Worker A              Worker B              Worker C
  CRDT checkout         CRDT checkout         CRDT checkout
  edit file X           edit file X           edit file Y
  emit ops              emit ops              emit ops
CRDT Workspace Service
  file_id -> CRDT document
  path tree -> CRDT map
  awareness -> cursor/intent/lock hints
  snapshots -> Git branch/commit
```
Each file can be represented as a text CRDT. The directory tree can be represented as a map CRDT: path, file id, mode, tombstone, rename metadata. Agent-local edits become CRDT operations rather than immediate filesystem writes. A materializer then renders the CRDT workspace to a real directory for build/test execution.
This has advantages:
- Agents can work offline or under temporary network partition.
- Concurrent edits converge instead of overwriting each other.
- Every insertion/deletion has provenance: agent id, task id, event id.
- The Brain can inspect live partial work without waiting for a patch.
- Merge conflicts become structured CRDT conflicts plus semantic review, rather than opaque Git conflict hunks.
But code is not prose. Text convergence does not imply compilable or semantically correct code. If two agents edit the same function, the CRDT will preserve both edits, but the result may duplicate logic, break syntax, or violate intent. Cortex therefore needs a two-layer model:
1. **Syntactic CRDT layer**: guarantees no lost characters and deterministic convergence.
2. **Semantic integration layer**: parses, formats, tests, and validates resulting code.
For Rust, a feasible initial implementation would use `yrs` for Yjs-compatible shared documents or `diamond-types` for plain text performance. Automerge is better when representing structured state, such as task boards, memory records, DAG definitions, or workspace manifests. Diamond Types is attractive for file text because it is Rust-native and optimized for collaborative strings, but it is narrower than Automerge/Yjs.
Recommended Cortex design:
```rust
struct WorkspaceOp {
    workspace_id: WorkspaceId,
    file_id: FileId,
    agent_id: AgentId,
    task_id: TaskId,
    lamport: u64,
    op: CrdtOpBytes,
    intent: EditIntent,
    base_git_commit: Sha,
}
```
Use CRDTs for live multi-agent editing, but keep Git as the release boundary. The Brain should periodically produce “semantic checkpoints”: materialize CRDT state, run formatter/parser/tests, generate a patch, and commit to a branch. The Git commit is the accepted artifact; the CRDT log is the collaborative substrate.
Could agents edit the same codebase simultaneously using a CRDT-based filesystem? Yes, but only if Cortex treats the CRDT filesystem as a collaborative staging environment, not as the production filesystem. The safe pattern is:
```text
CRDT ops -> materialized workspace -> build/test/typecheck -> patch review -> Git commit
```
A full CRDT filesystem would need path CRDTs, rename conflict policy, tombstones, permissions, binary blob handling, generated-file filtering, and Git reconciliation. For MVP, implement CRDT-backed text files plus a conventional file tree manifest.
---
## 2. Biological Swarm Intelligence In Software
Biological swarm intelligence is useful for Cortex because agent orchestration often involves search under uncertainty: which task should run next, which worker is reliable, which plan is promising, which file is risky, which branch should be explored?
Ant colony optimization, bee foraging, and neural swarm behavior all suggest coordination without heavy central planning. Ant colony optimization uses indirect signals analogous to pheromones. Better paths accumulate stronger traces; stale paths decay. Bee foraging uses scouts, employed bees, and onlookers: some agents explore new sources, some exploit known sources, and others allocate effort based on observed quality. Stigmergy means agents coordinate by modifying a shared environment rather than directly messaging every other agent.
Sources: [Ant System by Dorigo et al.](https://www.researchgate.net/publication/235439153_Ant_sytem_Optimization_by_a_colony_of_cooperating_agents), [Ant Colony System](https://faculty.washington.edu/paymana/swarm/dorigo97-itec.pdf), [Artificial Bee Colony overview](https://link.springer.com/article/10.1007/s40747-022-00746-1), [virtual stigmergy in multi-agent systems](https://www.sciencedirect.com/science/article/pii/S016764231930139X).
For Cortex, stigmergy should become a first-class runtime concept.
Instead of only storing task state like:
```text
task_123: running
```
Cortex should store environmental traces:
```text
trace:
  kind: file_hotspot
  target: src/billing/ledger.rs
  strength: 0.84
  emitted_by: agent_7
  evidence: ["test_failed", "recent_conflict", "high_churn"]
  decay_half_life: 30m
```
Possible trace types:
- `file_hotspot`: many agents touched this file or tests fail near it.
- `promising_plan`: a plan has passed partial validation.
- `blocked_path`: a branch of work hit unresolved dependency.
- `risky_tool`: a command or tool caused repeated failures.
- `semantic_conflict`: two agents reached incompatible conclusions.
- `test_signal`: a test is strongly correlated with a task.
- `expertise_signal`: worker has high success rate on a module.
Ant-colony scheduling can be applied to task routing. Each worker-task edge has a pheromone score:
```text
score(worker, task) =
  pheromone(worker, module)
  * heuristic(task_priority, dependency_unblock_value, worker_capacity)
  * freshness_decay
```
Pheromone increases when a worker completes a similar task, fixes a failing test, or produces accepted code. It decays over time to avoid permanent lock-in.
Bee-foraging maps well to agent roles:
- **Scout workers** explore uncertain solution paths cheaply.
- **Employed workers** develop known promising paths.
- **Onlooker workers** choose among advertised partial results.
- **Guard workers** inspect safety, policy, and merge risk.
The Brain does not need to decide everything upfront. It can maintain a “nectar board” of candidate work items, each with confidence, cost, expected value, and current evidence. Workers bid for or sample work based on local heuristics.
Emergent behavior is useful but dangerous. A swarm can converge on bad local optima, amplify false signals, or stampede into the same file. Cortex needs dampers:
- Pheromone decay.
- Diversity quotas.
- Negative traces for repeated failure.
- Exploration budgets.
- Per-file concurrency limits.
- Randomized assignment with weighted probability, not strict max-score routing.
In implementation terms, use SQLite tables or event-sourced projections:
```sql
agent_trace(id, kind, target, strength, emitted_by, event_id, created_at, expires_at)
agent_affinity(worker_id, module, score, successes, failures, updated_at)
task_signal(task_id, signal_kind, value, confidence, source_event_id)
```
This converts swarm intelligence into measurable scheduling metadata.
---
## 3. Event Sourcing For Agent Orchestration
Event sourcing is probably the most important architectural shift for Cortex. Instead of storing mutable task state as the source of truth, every agent action should be an immutable event.
Current-style mutable orchestration:
```text
task.status = "running"
task.assigned_to = "worker-3"
task.output = latest_output
```
Event-sourced orchestration:
```text
TaskCreated
WorkerAssigned
PromptRendered
ModelCalled
ToolRequested
ToolStarted
ToolCompleted
PatchProposed
TestRunStarted
TestRunCompleted
ReviewFailed
RetryScheduled
TaskCompleted
```
The mutable state becomes a projection derived from the event log.
Temporal and Restate show why this matters. Temporal’s platform documentation describes crash-proof execution that resumes after failures. Restate records progress in a journal, skips already completed steps on retry, supports durable timers, and provides durable communication/state. Restate is also Rust-based at the server level and has a Rust SDK, making it especially relevant for Cortex.
Sources: [Temporal docs](https://docs.temporal.io/), [Restate durable execution concepts](https://docs.restate.dev/concepts/durable_execution/), [Restate overview](https://docs.restate.dev/index), [Restate durable execution article](https://www.restate.dev/what-is-durable-execution/).
For Cortex, durable execution transforms the Brain from “scheduler plus database” into a replayable control plane.
A Cortex event schema might look like:
```rust
enum CortexEvent {
    TaskCreated { task_id: TaskId, goal: String },
    WorkerLeased { task_id: TaskId, worker_id: WorkerId, lease_id: LeaseId },
    AgentStepStarted { run_id: RunId, step_id: StepId, input_hash: Hash },
    ModelCallRecorded { step_id: StepId, provider: String, request_hash: Hash, response_ref: BlobRef },
    ToolCallRequested { step_id: StepId, tool: String, args_hash: Hash },
    ToolCallCompleted { step_id: StepId, exit_code: i32, stdout_ref: BlobRef, stderr_ref: BlobRef },
    WorkspaceOpAppended { workspace_id: WorkspaceId, op_ref: BlobRef },
    TestResultRecorded { run_id: RunId, status: TestStatus },
    HumanDecisionRecorded { decision_id: DecisionId, outcome: Decision },
}
```
Important rule: LLM calls and tool calls are non-deterministic side effects. They must be recorded as events with content-addressed blobs. On replay, Cortex should not call the model again unless explicitly scheduled. It should reuse the recorded result.
This unlocks:
- Complete auditability.
- Replay and debugging of agent failures.
- Idempotent retries.
- Time travel across orchestration decisions.
- Deterministic reconstruction of task state.
- Safer billing and quota accounting.
- Better security review because every tool call is inspectable.
A recommended implementation for Cortex:
```text
SQLite WAL Event Store
  events(sequence, stream_id, event_type, payload_json, payload_hash, created_at)
  blobs(hash, media_type, storage_uri, size)
  projections(...)
  outbox(...)
Rust Brain
  append_event()
  load_stream()
  rebuild_projection()
  dispatch_outbox()
Workers
  poll/subscribe
  execute lease
  append results
```
Because the user’s repository constraints mention SQLite WAL and raw SQL patterns, Cortex can start with SQLite as a single-node durable log. Later, event streams can be partitioned by workspace, task, or tenant.
Temporal/Restate can either be integrated or treated as design references. If Cortex wants maximum control, implement a minimal durable step engine directly. If it wants production-grade workflow recovery quickly, use Restate/Temporal for workflow substrate and keep Cortex-specific agent semantics above it.
---
## 4. Consensus And Game Theory
Consensus is needed when Cortex must decide one authoritative value among competing proposals: which patch wins, whether a task is complete, whether an agent result is trustworthy, or whether a worker should be quarantined.
Raft is appropriate for trusted Cortex Brain replicas. Raft is a consensus algorithm for replicated logs; it is easier to understand than Paxos and well suited to leader-based replication. Paxos is more general but harder to implement correctly. For a Cortex cluster, Raft can replicate the event log or coordinate leases.
Source: [Raft paper via USENIX](https://www.usenix.org/node/184041.).
Do not use Raft for agent disagreement. Raft assumes non-Byzantine nodes. An LLM agent can be wrong, hallucinate, or act adversarially if prompt-injected. That is closer to Byzantine behavior: nodes may produce arbitrary incorrect outputs.
PBFT-style reasoning matters when Cortex has multiple agents evaluating an untrusted action. Practical Byzantine Fault Tolerance was designed to tolerate arbitrary faulty replicas under assumptions about the number of faulty nodes.
Source: [PBFT paper](https://www.usenix.org/legacy/publications/library/proceedings/osdi99/full_papers/castro/castro_html/castro.html).
For Cortex, full PBFT is probably overkill for everyday orchestration. But BFT-inspired quorum policy is useful:
```text
Accept patch if:
  1 implementer proposes it
  1 reviewer validates it
  1 test runner confirms it
  no security guard vetoes it
```
Or for high-risk operations:
```text
Require 2-of-3 independent reviewers
Require deterministic test evidence
Require policy engine approval
Require no unresolved contradiction event
```
This is not blockchain consensus. It is evidence consensus.
Game theory enters because agents optimize whatever Cortex rewards. If agents are rewarded only for task completion, they may produce shallow fixes. If rewarded only for passing tests, they may overfit. If rewarded for speed, they may avoid hard tasks.
Mechanism design for Cortex should define incentive-compatible protocols:
- Reward accepted outcomes, not verbose effort.
- Penalize downstream reverts, failed reviews, and flaky tests.
- Give partial credit for useful negative findings.
- Separate proposer, executor, and verifier roles.
- Randomly audit high-confidence claims.
- Use stake-like reputation: agents with high reputation get more autonomy; failed high-risk actions reduce autonomy.
A concrete scoring model:
```text
agent_reputation =
  accepted_patch_rate * 0.35
  + review_accuracy * 0.25
  + test_prediction_accuracy * 0.15
  + low_revert_rate * 0.15
  + cost_efficiency * 0.10
```
Consensus should be layered:
- **Raft**: Brain cluster and event log replication among trusted infrastructure nodes.
- **Lease consensus**: exactly one worker owns a mutable execution lease.
- **Evidence quorum**: multiple agents/tools agree on task state.
- **Human override**: final authority for risky merge/deploy decisions.
- **BFT-style guardrails**: for untrusted workers, external contributors, or model-generated shell/code actions.
---
## 5. P2P Agent Networks
A central Brain is simpler, but it can become a bottleneck or single point of failure. P2P workers can coordinate directly for large-scale exploration, local inference, edge deployments, or degraded operation.
libp2p is the obvious Rust-compatible foundation. It provides modular peer-to-peer networking, peer identity, transports, discovery, NAT traversal, and pub/sub such as GossipSub.
Sources: [libp2p IPFS docs](https://docs.ipfs.tech/concepts/libp2p/), [rust-libp2p docs](https://libp2p.github.io/rust-libp2p/libp2p/), [rust-libp2p getting started](https://libp2p.io/docs/getting-started-rust/).
A Cortex P2P mode could look like:
```text
Brain: policy, event anchoring, high-value scheduling
Workers: local task exchange, artifact gossip, model shard discovery
Network: libp2p GossipSub + request/response + Kademlia discovery
```
Useful P2P capabilities:
- Workers share cached model outputs by content hash.
- Workers advertise tool capabilities.
- Workers exchange CRDT workspace updates.
- Workers form local review quorums.
- Workers continue low-risk tasks if Brain is temporarily unavailable.
- Edge nodes perform federated inference near data.
But P2P introduces serious issues:
- Identity and authorization become harder.
- Prompt injection can spread through gossiped artifacts.
- Malicious workers can advertise false capabilities.
- Network partitions create divergent beliefs.
- Debugging becomes more complex.
Cortex should not start fully decentralized. A practical design is “federated orchestration”:
```text
Central Brain anchors truth.
Regional/tenant worker meshes optimize local coordination.
All accepted state eventually lands in the Brain event log.
```
Each worker has a cryptographic identity. Messages are signed. Artifacts are content-addressed. Capability claims require Brain-issued attestations. The Brain can define topic ACLs:
```text
/cortex/workspace/{id}/crdt
/cortex/task/{id}/events
/cortex/artifacts/{hash}/providers
/cortex/capability/rust-test-runner
```
The P2P layer is then an optimization plane, not the source of truth.
---
## 6. Reactive Dataflow
Agent orchestration is naturally a graph: prompts depend on repo state, tests depend on patches, reviews depend on diffs, deployments depend on checks. Traditional orchestrators often execute DAGs once. Cortex should treat DAGs as reactive streams: when an input changes, dependent computations invalidate and re-execute.
Differential dataflow is relevant because it performs incremental computation over changing inputs. Materialize uses Timely and Differential Dataflow to maintain query results over fast-changing data. Hydroflow is a Berkeley project for distributed systems programming with dataflow concepts and lattice/CALM-inspired reasoning.
Sources: [Materialize docs](https://materialize.com/docs/transform-data/), [Materialize arrangements](https://materialize.com/docs/get-started/arrangements/), [Hydroflow paper](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2021/EECS-2021-201.pdf).
For Cortex:
```text
Inputs:
  repo commit
  CRDT workspace snapshot
  task goal
  agent memory
  tool result
  human feedback
  policy config
Derived nodes:
  plan
  file relevance
  patch
  test selection
  review summary
  risk score
  merge readiness
```
If `src/billing/ledger.rs` changes, Cortex should automatically invalidate:
- stale code summaries,
- dependent plans,
- test recommendations,
- patch reviews,
- risk assessments,
- any agent memory derived from old code.
This avoids a common multi-agent failure: agents continue reasoning from stale context.
A Rust implementation does not need full Materialize initially. Cortex can implement incremental projections over the event log:
```rust
trait ReactiveNode {
    type Input;
    type Output;
    fn dependencies(&self) -> Vec<NodeId>;
    fn compute(&self, input: Self::Input) -> Self::Output;
    fn cache_key(&self, input_hashes: &[Hash]) -> Hash;
}
```
Then store:
```sql
reactive_node(id, kind, config_hash)
reactive_edge(parent_id, child_id)
reactive_value(node_id, input_hash, output_hash, status, updated_at)
invalidations(node_id, reason_event_id)
```
Long term, Cortex can use differential-style deltas:
```text
+ PatchProposed(file=A)
- ReviewValid(old_patch)
+ ReviewRequired(new_patch)
```
Instead of recomputing the entire orchestration state, it propagates small changes. This is especially powerful when hundreds of agents operate over thousands of files.
---
## 7. Formal Verification Of Agents
Formal verification should not try to prove that LLMs are correct. It should prove that the orchestration substrate preserves safety properties despite unreliable agents.
TLA+ is designed for concurrent and distributed systems modeling. Alloy is useful for bounded structural modeling and finding counterexamples through SAT solving. Rust property-based testing with tools like `proptest` can generate randomized event sequences and check invariants.
Sources: [TLA+ overview](https://en.wikipedia.org/wiki/TLA%2B), [Alloy Analyzer docs](https://alloydocs-fork.readthedocs.io/en/latest/tooling/analyzer.html), [Alloy model finder explanation](https://alloytools.org/faq/how_does_the_alloy_analyzer_differ_from_model_checkers.html), [proptest crate](https://docs.rs/proptest/latest/proptest/).
Critical Cortex invariants:
- No task is completed unless required evidence exists.
- No lease is owned by two workers at the same time.
- No tool result is accepted without matching request id.
- No model call is billed twice after replay.
- No CRDT checkpoint becomes a Git commit without materialization and validation.
- No deployment starts from an unreviewed commit.
- No worker can append events for a tenant it is not authorized for.
- No event replay changes the resulting projection.
TLA+ model candidates:
1. Worker lease protocol.
2. Event append and replay.
3. Retry/idempotency semantics.
4. Human approval gates.
5. Patch acceptance quorum.
6. Brain failover and leader election if using Raft.
Example invariant:
```text
Invariant: For every task marked Complete,
there exists at least one TestResultRecorded(success)
and one ReviewAccepted
after the latest PatchProposed event for that task.
```
Property-based testing should run against the real Rust projection code. Generate random sequences:
```text
TaskCreated
WorkerLeased
WorkerLeased duplicate
ToolStarted
ToolCompleted unknown id
PatchProposed
ReviewAccepted stale patch
RetryScheduled
TaskCompleted
```
Then assert that projections never reach impossible states.
Cortex should maintain a `crates/orchestration-model` test suite where events are arbitrary generated data. This is more valuable than normal unit tests because orchestration bugs usually occur in weird interleavings.
Formal methods should be applied surgically. Do not model the entire AI system. Model the small protocols that must never fail.
---
## 8. Cognitive Architectures
Cortex can borrow from cognitive science without pretending to replicate a brain.
Global Workspace Theory suggests a system where many specialized processes operate locally, but selected information is broadcast globally when it becomes salient. For Cortex, the Brain’s global workspace is not a consciousness layer; it is a priority broadcast bus.
Source: [Global Workspace Theory overview](https://en.wikipedia.org/wiki/Global_workspace_theory).
Implementation idea:
```text
Local processors:
  code summarizer
  test runner
  planner
  reviewer
  security guard
  memory retriever
  cost monitor
Global workspace:
  high-salience events
  active goals
  current blockers
  accepted world model
  working memory
```
Agents should not all see everything. They should receive selected broadcasts:
```text
Broadcast:
  kind: blocker
  salience: 0.92
  target_agents: ["planner", "rust-fixer", "reviewer"]
  content_ref: blob_hash
```
Predictive processing and Friston’s free energy principle suggest another useful pattern: maintain a generative model of expected outcomes, then minimize prediction error. In software terms, Cortex should predict what will happen when an agent acts, then learn from deviations.
Sources: [Predictive coding under free-energy principle](https://pmc.ncbi.nlm.nih.gov/articles/PMC2666703/), [Friston free-energy principle](https://www.nature.com/articles/nrn2787).
For each task, Cortex can predict:
- expected files touched,
- expected tests affected,
- expected runtime,
- probability of merge success,
- likely failure modes,
- cost estimate,
- review risk.
After execution, compute prediction error:
```text
prediction_error =
  abs(expected_cost - actual_cost)
  + changed_files_surprise
  + failed_tests_surprise
  + review_rejection_surprise
```
High prediction error updates memory and scheduling. If Cortex predicted a simple docs change but the worker edited billing code, that is a salience spike requiring review.
Memory consolidation is also central. Cortex should distinguish:
- **Working memory**: active task context, current plan, open files, recent tool output.
- **Episodic memory**: event traces of specific runs, failures, reviews, decisions.
- **Semantic memory**: durable facts about the codebase, architecture, APIs, conventions.
- **Procedural memory**: learned workflows, tool recipes, debugging playbooks, patch strategies.
A concrete storage model:
```text
working_memory:
  short TTL, task-scoped, small, frequently overwritten
episodic_memory:
  event-sourced, append-only, replayable
semantic_memory:
  curated docs, code summaries, symbol graphs, architecture facts
procedural_memory:
  versioned strategies with success metrics
```
Neuroplasticity maps to adaptive routing and strategy updates. Cortex should not hard-code one orchestration policy forever. It should update weights based on outcomes:
```text
strategy: "run targeted tests before broad tests"
success_rate: 0.78
contexts: ["rust", "billing", "small_patch"]
last_updated: ...
```
But plasticity needs boundaries. Cortex should version learned policies, keep rollback, and require approval before changing high-risk behavior.
---
## Recommended Cortex Architecture
The strongest concrete architecture is:
```text
Cortex Brain
  Event Store
  Durable Step Engine
  Reactive Projection Engine
  Policy/Quorum Engine
  Global Workspace
  Memory Consolidator
  Scheduler with Swarm Signals
Cortex Worker
  Tool sandbox
  Model adapter
  CRDT workspace client
  Event append client
  Local cache
  P2P optional mesh client
Workspace Layer
  CRDT text docs
  path manifest
  materializer
  Git checkpoint bridge
Verification Layer
  property tests
  TLA+ specs
  replay tests
  deterministic projection tests
```
Suggested implementation order:
1. Build the event-sourced core first.
2. Add durable idempotent worker steps.
3. Add reactive projections from events.
4. Add CRDT workspace staging for concurrent edits.
5. Add quorum-based review and policy gates.
6. Add stigmergic scheduling signals.
7. Add formal models for leases, replay, and patch acceptance.
8. Add optional P2P worker mesh.
The key warning: do not combine all paradigms at once as a research artifact. Cortex should use each paradigm for a specific failure mode.
- CRDTs solve concurrent workspace edits.
- Event sourcing solves audit, replay, and recovery.
- Durable execution solves crashes and retries.
- Swarm intelligence solves exploration and adaptive scheduling.
- Consensus solves authoritative decisions.
- P2P solves scale and degraded coordination.
- Reactive dataflow solves stale context.
- Formal verification solves orchestration safety.
- Cognitive architecture solves attention, memory, and adaptation.
If implemented this way, Cortex becomes more than an AI task runner. It becomes a durable distributed cognition runtime: agents act concurrently, leave traces, converge through evidence, recover after failure, and continuously improve without surrendering control of the system’s safety boundaries.
