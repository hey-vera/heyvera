I’ll ground this in the current repo shape before drafting the architecture, so the blueprint aligns with the actual crates and existing tables rather than only the summary.
exec
/bin/bash -lc 'git branch --show-current && git remote -v' in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
exec
/bin/bash -lc "pwd && rg --files -g 'Cargo.toml' -g '*.rs' -g '*.sql' -g 'migrations/**'" in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
codex
I could not inspect the workspace because every shell command failed before execution with:
```text
bwrap: Unexpected capabilities but not setuid, old file caps config?
```
So this blueprint is grounded in the architecture summary you provided, not fresh repo inspection. I would still treat this as implementation-ready design, but the first build slice should verify exact module names and existing table columns.
# Cortex Level 5 Concrete Rust Architecture
The core choice: Level 5 should not replace the current CRUD scheduler in one jump. It should add an append-only event spine, schema-versioned protocol envelopes, worker manifests, contextual routing statistics, and policy envelopes while keeping the existing `runs`, `steps`, `step_edges`, and `step_attempts` tables as read/write projections during migration.
I would split the system into these responsibilities:
```text
cortex-core
  Stable shared types, protocol envelopes, policy model, event model, memory payloads.
cortex-engine
  DAG planner/scheduler, speculative graph, invalidation, candidate plan scoring.
cortex-api
  Axum server, SQLite storage, event append/replay, Mission Control, auth, DB projections.
cortex-worker
  Worker runtime, CLI executors, checkpoint handling, manifest loading.
new: cortex-memory
  Event replay, derived memory views, stigmergy decay, semantic/procedural stores.
new: cortex-router
  Market router, bidding, Thompson sampling, contextual success estimates.
new: cortex-policy
  Policy envelope composition, evidence quorum evaluation, governance checks.
```
I would add the new crates because router, memory, and policy will otherwise turn `cortex-core` into a junk drawer. `cortex-core` should define wire-compatible types and pure domain objects only.
---
## 1. Protocol: Schema-Versioned, Replayable, Brain-Anchored Mesh
### Design Choice
All protocol messages move into a versioned envelope. Brain remains the source of truth. Workers may exchange direct mesh messages, but every consequential action must be mirrored to Brain as an event. Direct worker-to-worker traffic is advisory unless Brain commits it.
### Core Protocol Types
In `crates/core/src/protocol.rs`:
```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
pub const PROTOCOL_SCHEMA_VERSION: u16 = 2;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RunId(pub Uuid);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StepId(pub Uuid);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WorkerId(pub Uuid);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EventId(pub Uuid);
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CapabilityId(pub String);
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolEnvelope<T> {
    pub schema_version: u16,
    pub message_id: Uuid,
    pub run_id: Option<RunId>,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<Uuid>,
    pub sender: ProtocolActor,
    pub recipient: ProtocolRecipient,
    pub sent_at: DateTime<Utc>,
    pub body: T,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProtocolActor {
    Brain,
    Worker { worker_id: WorkerId },
    MissionControl { session_id: Uuid },
    System,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProtocolRecipient {
    Brain,
    Worker { worker_id: WorkerId },
    Workers { role: Option<WorkerRole> },
    MissionControl,
    Broadcast,
}
pub type BrainEnvelope = ProtocolEnvelope<BrainMessage>;
pub type WorkerEnvelope = ProtocolEnvelope<WorkerMessage>;
pub type MeshEnvelope = ProtocolEnvelope<MeshMessage>;
```
### Worker Roles and Modes
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkerRole {
    Scout,
    Planner,
    Implementer,
    Reviewer,
    Tester,
    Guard,
    Summarizer,
    Generalist,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExecutionMode {
    Deterministic,
    Model,
    Agent,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExecutionTrust {
    LocalDeterministic,
    ModelAssisted,
    AgenticUntrusted,
    AgenticSandboxed,
    HumanApproved,
}
```
### New Brain Messages
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum BrainMessage {
    ExecuteStep(ExecuteStep),
    CancelStep(CancelStep),
    Heartbeat(BrainHeartbeat),
    AckCompletion(AckCompletion),
    // Level 5 additions
    RequestManifest(RequestManifest),
    RequestBid(RequestBid),
    AcceptBid(AcceptBid),
    RejectBid(RejectBid),
    OpenMeshSession(OpenMeshSession),
    CloseMeshSession(CloseMeshSession),
    RequestCheckpoint(RequestCheckpoint),
    ResumeFromCheckpoint(ResumeFromCheckpoint),
    ApplyPolicyEnvelope(ApplyPolicyEnvelope),
    RequestEvidence(RequestEvidence),
    QuorumDecision(QuorumDecision),
    ApproveTask(ApproveTask),
    RejectTask(RejectTask),
    PauseRun(PauseRun),
    RedirectStep(RedirectStep),
    InjectStep(InjectStep),
    InvalidateSteps(InvalidateSteps),
}
```
### New Worker Messages
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WorkerMessage {
    StepStarted(StepStarted),
    StepOutput(StepOutput),
    StepCompleted(StepCompleted),
    StepFailed(StepFailed),
    Heartbeat(WorkerHeartbeat),
    // Level 5 additions
    ManifestAdvertised(WorkerManifest),
    BidSubmitted(WorkerBid),
    BidDeclined(BidDeclined),
    CheckpointCreated(CheckpointRef),
    CheckpointRejected(CheckpointRejected),
    ResumeAccepted(ResumeAccepted),
    ResumeRejected(ResumeRejected),
    ProposedStep(ProposedStep),
    ProposedPlan(PlanCandidate),
    EvidenceSubmitted(Evidence),
    PolicyViolation(PolicyViolation),
    StructuredObservation(StructuredObservation),
    MeshTranscriptCommitted(MeshTranscript),
}
```
### Mesh Messages
Direct worker coordination gets its own enum. These messages are not authoritative unless committed back to Brain.
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum MeshMessage {
    RequestArtifact(RequestArtifact),
    ProvideArtifact(ProvideArtifact),
    RequestReview(RequestReview),
    ReviewFinding(ReviewFinding),
    ClaimSubtask(ClaimSubtask),
    ReleaseSubtask(ReleaseSubtask),
    ShareObservation(StructuredObservation),
    RequestLocalContext(RequestLocalContext),
}
```
### Worker Bid
The bid is concrete, priced, capability-bound, and falsifiable. No vague “confidence”.
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestBid {
    pub run_id: RunId,
    pub step_id: StepId,
    pub task: TaskSpec,
    pub policy: PolicyEnvelope,
    pub required_capabilities: Vec<CapabilityConstraint>,
    pub desired_outputs: Vec<OutputContract>,
    pub bid_deadline_ms: u64,
    pub max_parallel_awards: u16,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerBid {
    pub run_id: RunId,
    pub step_id: StepId,
    pub worker_id: WorkerId,
    pub bid_id: Uuid,
    pub role: WorkerRole,
    pub execution_mode: ExecutionMode,
    pub estimated_cost: CostEstimate,
    pub estimated_latency_ms: u64,
    pub success_likelihood: f64,
    pub uncertainty: f64,
    pub capability_match: f64,
    pub risk_acceptance: RiskAcceptance,
    pub checkpoint_support: CheckpointSupport,
    pub evidence_plan: EvidencePlan,
    pub assumptions: Vec<String>,
    pub expires_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub tool_calls: Option<u32>,
    pub usd: Option<f64>,
    pub local_cpu_ms: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAcceptance {
    pub accepted_policy_hash: String,
    pub sandbox_required: bool,
    pub filesystem_write_scope: Vec<String>,
    pub network_scope: NetworkScope,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CheckpointSupport {
    None,
    FilesystemSnapshot,
    ProcessReplay,
    SemanticState,
    Full,
}
```
### Step Output Becomes Semantic Payload
Current `structured: serde_json::Value` is fine as a wire fallback, but internally it needs a typed semantic envelope.
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepOutput {
    pub run_id: RunId,
    pub step_id: StepId,
    pub worker_id: WorkerId,
    pub attempt_id: Uuid,
    pub text: String,
    pub files: Vec<FileArtifact>,
    pub usage: Option<UsageReport>,
    pub structured: StructuredPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredPayload {
    pub schema: String,
    pub schema_version: u16,
    pub kind: StructuredKind,
    pub value: Value,
    pub confidence: Option<f64>,
    pub evidence_refs: Vec<EvidenceRef>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StructuredKind {
    Plan,
    CodeChange,
    TestResult,
    Review,
    RiskAssessment,
    Fact,
    Summary,
    Decision,
    Metric,
    Unknown,
}
```
---
## 2. Event Sourcing: Minimum Viable Event Spine
### Design Choice
Do not event-source everything on day one. Add an append-only `events` table and dual-write from existing CRUD operations. The existing tables remain projections. New Level 5 features append events first, then update projections in a transaction.
### Core Event Types
In `cortex-core/src/events.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortexEvent {
    pub id: EventId,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub stream: EventStream,
    pub sequence: i64,
    pub actor: ProtocolActor,
    pub occurred_at: DateTime<Utc>,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<Uuid>,
    pub schema_version: u16,
    pub payload: EventPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventStream {
    Global,
    Run(RunId),
    Step(StepId),
    Worker(WorkerId),
    Policy(String),
    Memory(String),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum EventPayload {
    RunCreated(RunCreated),
    StepCreated(StepCreated),
    StepQueued(StepQueued),
    StepAssigned(StepAssigned),
    StepStarted(StepStarted),
    StepOutput(StepOutput),
    StepCompleted(StepCompleted),
    StepFailed(StepFailed),
    StepCancelled(StepCancelled),
    BidRequested(RequestBid),
    BidSubmitted(WorkerBid),
    BidAccepted(AcceptBid),
    BidRejected(RejectBid),
    PlanProposed(PlanCandidate),
    PlanAccepted(PlanAccepted),
    StepProposed(ProposedStep),
    StepInjected(InjectStep),
    StepInvalidated(StepInvalidated),
    PolicyApplied(PolicyEnvelope),
    PolicyViolation(PolicyViolation),
    EvidenceSubmitted(Evidence),
    QuorumReached(QuorumDecision),
    CheckpointCreated(CheckpointRef),
    CheckpointRestored(CheckpointRestored),
    MemoryTraceWritten(StigmergyTrace),
    LearningCandidateCreated(LearningCandidate),
    LearningCandidatePromoted(LearningPromotion),
    MissionControlAction(MissionControlAction),
}
```
### Event Store Trait
In new `cortex-memory` or `cortex-api/src/event_store.rs` initially:
```rust
#[async_trait::async_trait]
pub trait EventStore: Send + Sync {
    async fn append(&self, event: NewEvent) -> anyhow::Result<CortexEvent>;
    async fn append_batch(
        &self,
        events: Vec<NewEvent>,
        expected: ExpectedStreamVersion,
    ) -> anyhow::Result<Vec<CortexEvent>>;
    async fn load_stream(
        &self,
        stream: EventStream,
        after_sequence: Option<i64>,
        limit: usize,
    ) -> anyhow::Result<Vec<CortexEvent>>;
    async fn load_run_events(
        &self,
        run_id: RunId,
        after_sequence: Option<i64>,
    ) -> anyhow::Result<Vec<CortexEvent>>;
    async fn subscribe(&self, from_global_sequence: i64) -> anyhow::Result<EventSubscription>;
}
#[derive(Debug, Clone)]
pub struct NewEvent {
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub stream: EventStream,
    pub actor: ProtocolActor,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<Uuid>,
    pub schema_version: u16,
    pub payload: EventPayload,
}
#[derive(Debug, Clone)]
pub enum ExpectedStreamVersion {
    Any,
    Exact(i64),
    NotExists,
}
```
### Event Tables
```sql
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    global_sequence INTEGER NOT NULL UNIQUE,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    stream_sequence INTEGER NOT NULL,
    run_id TEXT,
    step_id TEXT,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    causation_id TEXT,
    correlation_id TEXT,
    schema_version INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload_hash TEXT NOT NULL,
    prev_stream_hash TEXT,
    stream_hash TEXT NOT NULL,
    UNIQUE(stream_type, stream_id, stream_sequence)
);
CREATE INDEX IF NOT EXISTS idx_events_run_sequence
ON events(run_id, global_sequence);
CREATE INDEX IF NOT EXISTS idx_events_stream
ON events(stream_type, stream_id, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_events_type_time
ON events(event_type, occurred_at);
```
SQLite needs global sequence generation. Use a transaction plus a singleton counter table:
```sql
CREATE TABLE IF NOT EXISTS event_sequences (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO event_sequences(name, value)
VALUES ('global', 0);
```
Within one transaction:
```sql
UPDATE event_sequences SET value = value + 1 WHERE name = 'global';
SELECT value FROM event_sequences WHERE name = 'global';
```
---
## 3. Evaluator: Market Router + Thompson Sampling
### Design Choice
Use Thompson sampling over contextual buckets, not a full online model first. Rust implementation should be deterministic, debuggable, and backed by SQLite. Contextual keys are coarse: role, task kind, risk tier, provider/model, worker capability set hash, execution mode.
Static scoring stays as a fallback prior.
### Router Types
In `cortex-router/src/lib.rs`:
```rust
use rand::Rng;
use rand_distr::{Beta, Distribution};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingContext {
    pub run_id: RunId,
    pub step_id: StepId,
    pub task_kind: TaskKind,
    pub role: WorkerRole,
    pub risk_tier: RiskTier,
    pub execution_mode: ExecutionMode,
    pub budget_class: BudgetClass,
    pub required_capabilities: Vec<CapabilityId>,
    pub policy_hash: String,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TaskKind {
    Plan,
    CodeEdit,
    Test,
    Review,
    Research,
    Summarize,
    Shell,
    Deploy,
    SecurityAnalysis,
    Unknown,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum RiskTier {
    Low,
    Medium,
    High,
    Critical,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum BudgetClass {
    Tiny,
    Normal,
    ExpensiveAllowed,
    Emergency,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteDecision {
    pub decision_id: Uuid,
    pub run_id: RunId,
    pub step_id: StepId,
    pub selected_bid: WorkerBid,
    pub considered_bids: Vec<ScoredBid>,
    pub strategy: RoutingStrategy,
    pub explanation: DecisionExplanation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RoutingStrategy {
    DeterministicRule,
    ThompsonSampling,
    HumanOverride,
    FallbackStaticEvaluator,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredBid {
    pub bid: WorkerBid,
    pub sampled_success: f64,
    pub expected_utility: f64,
    pub posterior_alpha: f64,
    pub posterior_beta: f64,
    pub cost_penalty: f64,
    pub risk_penalty: f64,
}
```
### Thompson Sampling
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BetaPosterior {
    pub alpha: f64,
    pub beta: f64,
    pub observations: u64,
    pub last_updated_at: DateTime<Utc>,
}
impl BetaPosterior {
    pub fn prior() -> Self {
        Self {
            alpha: 2.0,
            beta: 2.0,
            observations: 0,
            last_updated_at: Utc::now(),
        }
    }
    pub fn update(&self, success: bool, weight: f64) -> Self {
        let mut next = self.clone();
        if success {
            next.alpha += weight.max(0.0);
        } else {
            next.beta += weight.max(0.0);
        }
        next.observations += 1;
        next.last_updated_at = Utc::now();
        next
    }
    pub fn sample<R: Rng + ?Sized>(&self, rng: &mut R) -> f64 {
        let dist = Beta::new(self.alpha.max(0.001), self.beta.max(0.001))
            .expect("valid beta posterior");
        dist.sample(rng)
    }
    pub fn mean(&self) -> f64 {
        self.alpha / (self.alpha + self.beta)
    }
}
```
### Router Trait
```rust
#[async_trait::async_trait]
pub trait CognitiveRouter: Send + Sync {
    async fn request_bids(&self, context: RoutingContext) -> anyhow::Result<Vec<WorkerBid>>;
    async fn score_bids(
        &self,
        context: RoutingContext,
        bids: Vec<WorkerBid>,
    ) -> anyhow::Result<Vec<ScoredBid>>;
    async fn select_bid(
        &self,
        context: RoutingContext,
        scored: Vec<ScoredBid>,
    ) -> anyhow::Result<RouteDecision>;
    async fn record_outcome(
        &self,
        decision_id: Uuid,
        outcome: RoutingOutcome,
    ) -> anyhow::Result<()>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingOutcome {
    pub success: bool,
    pub completed: bool,
    pub accepted_by_quorum: bool,
    pub latency_ms: u64,
    pub actual_cost_usd: Option<f64>,
    pub failure_class: Option<FailureClass>,
    pub quality_score: Option<f64>,
}
```
### Utility Function
Pick the bid maximizing:
```text
sampled_success
- normalized_cost * cost_weight
- risk_penalty
- latency_penalty
+ capability_bonus
+ reputation_bonus
```
The router should not let workers self-report success probability as truth. `WorkerBid.success_likelihood` is a signal; Thompson posterior is the learned term.
```rust
pub fn expected_utility(
    sampled_success: f64,
    bid: &WorkerBid,
    policy: &PolicyEnvelope,
    reputation: f64,
) -> f64 {
    let cost_penalty = bid.estimated_cost.usd.unwrap_or(0.0) * policy.budget.cost_weight;
    let latency_penalty = (bid.estimated_latency_ms as f64 / 60_000.0) * policy.budget.latency_weight;
    let risk_penalty = if bid.risk_acceptance.sandbox_required { 0.02 } else { 0.08 };
    sampled_success
        + reputation * 0.10
        + bid.capability_match * 0.08
        - cost_penalty
        - latency_penalty
        - risk_penalty
}
```
### Router DB Tables
```sql
CREATE TABLE IF NOT EXISTS worker_reputation (
    worker_id TEXT NOT NULL,
    context_key TEXT NOT NULL,
    alpha REAL NOT NULL DEFAULT 2.0,
    beta REAL NOT NULL DEFAULT 2.0,
    observations INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    quality_sum REAL NOT NULL DEFAULT 0.0,
    latency_ms_sum INTEGER NOT NULL DEFAULT 0,
    cost_usd_sum REAL NOT NULL DEFAULT 0.0,
    last_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(worker_id, context_key)
);
CREATE TABLE IF NOT EXISTS worker_bids (
    bid_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    role TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    estimated_cost_json TEXT NOT NULL,
    estimated_latency_ms INTEGER NOT NULL,
    success_likelihood REAL NOT NULL,
    uncertainty REAL NOT NULL,
    capability_match REAL NOT NULL,
    risk_acceptance_json TEXT NOT NULL,
    evidence_plan_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worker_bids_step
ON worker_bids(run_id, step_id, status);
CREATE TABLE IF NOT EXISTS route_decisions (
    decision_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    selected_bid_id TEXT,
    strategy TEXT NOT NULL,
    context_key TEXT NOT NULL,
    explanation_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS route_decision_candidates (
    decision_id TEXT NOT NULL,
    bid_id TEXT NOT NULL,
    sampled_success REAL NOT NULL,
    expected_utility REAL NOT NULL,
    posterior_alpha REAL NOT NULL,
    posterior_beta REAL NOT NULL,
    PRIMARY KEY(decision_id, bid_id)
);
```
---
## 4. DAG: Speculative Reactive Execution Graph
### Design Choice
Keep the existing DAG as the committed graph. Add candidate plans and reactive node contracts around it. Speculative branches are not first-class executable truth until accepted by Brain policy.
### Types
In `cortex-engine/src/graph.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactiveStep {
    pub step_id: StepId,
    pub run_id: RunId,
    pub title: String,
    pub task: TaskSpec,
    pub role: WorkerRole,
    pub execution_mode: ExecutionMode,
    pub inputs: Vec<InputContract>,
    pub outputs: Vec<OutputContract>,
    pub invalidation: Vec<InvalidationCondition>,
    pub policy: PolicyEnvelope,
    pub state: StepState,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputContract {
    pub name: String,
    pub source: InputSource,
    pub required: bool,
    pub schema: Option<JsonSchemaRef>,
    pub freshness: FreshnessRequirement,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InputSource {
    StepOutput { step_id: StepId, output_name: String },
    MemoryQuery { query: MemoryQuery },
    Artifact { artifact_id: String },
    HumanInput { prompt: String },
    Constant { value: serde_json::Value },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputContract {
    pub name: String,
    pub kind: StructuredKind,
    pub schema: Option<JsonSchemaRef>,
    pub required_for_success: bool,
    pub consumers: Vec<StepId>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InvalidationCondition {
    InputChanged { input_name: String },
    ArtifactChanged { path_glob: String },
    PolicyChanged { policy_key: String },
    MemoryTraceDecayedBelow { trace_key: String, threshold: f64 },
    UpstreamFailed { step_id: StepId },
    QuorumRejected { evidence_set_id: Uuid },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StepState {
    Draft,
    Blocked,
    Ready,
    Bidding,
    Assigned,
    Running,
    AwaitingApproval,
    Succeeded,
    Failed,
    Invalidated,
    Cancelled,
}
```
### Plan Candidates
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanCandidate {
    pub candidate_id: Uuid,
    pub run_id: RunId,
    pub proposed_by: ProtocolActor,
    pub parent_candidate_id: Option<Uuid>,
    pub base_graph_version: i64,
    pub steps: Vec<ReactiveStep>,
    pub edges: Vec<ReactiveEdge>,
    pub score: PlanScore,
    pub rationale: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactiveEdge {
    pub from: StepId,
    pub to: StepId,
    pub kind: EdgeKind,
    pub condition: EdgeCondition,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeKind {
    SuccessRequired,
    CompletionRequired,
    DataDependency { output_name: String, input_name: String },
    SpeculativeAlternative,
    GuardApproval,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeCondition {
    Always,
    StructuredFieldEquals { path: String, value: serde_json::Value },
    ScoreAtLeast { metric: String, threshold: f64 },
    PolicyAllows { action: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanScore {
    pub safety: f64,
    pub cost: f64,
    pub coverage: f64,
    pub latency: f64,
    pub reversibility: f64,
    pub confidence: f64,
    pub total: f64,
}
```
### Scheduler Trait
```rust
#[async_trait::async_trait]
pub trait ReactiveScheduler: Send + Sync {
    async fn load_graph(&self, run_id: RunId) -> anyhow::Result<ExecutionGraph>;
    async fn ready_steps(
        &self,
        graph: &ExecutionGraph,
        memory: &dyn MemoryView,
    ) -> anyhow::Result<Vec<ReactiveStep>>;
    async fn apply_event(
        &self,
        graph: &mut ExecutionGraph,
        event: &CortexEvent,
    ) -> anyhow::Result<GraphDelta>;
    async fn propose_plan(
        &self,
        run_id: RunId,
        goal: GoalSpec,
        constraints: PlanConstraints,
    ) -> anyhow::Result<Vec<PlanCandidate>>;
    async fn accept_plan_candidate(
        &self,
        candidate_id: Uuid,
        actor: ProtocolActor,
    ) -> anyhow::Result<GraphDelta>;
    async fn invalidate(
        &self,
        run_id: RunId,
        cause: InvalidationCause,
    ) -> anyhow::Result<Vec<StepInvalidated>>;
}
```
### DAG DB Additions
```sql
CREATE TABLE IF NOT EXISTS graph_versions (
    run_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    graph_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(run_id, version)
);
CREATE TABLE IF NOT EXISTS reactive_steps (
    step_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    graph_version INTEGER NOT NULL,
    title TEXT NOT NULL,
    task_json TEXT NOT NULL,
    role TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    input_contracts_json TEXT NOT NULL,
    output_contracts_json TEXT NOT NULL,
    invalidation_json TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reactive_edges (
    edge_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    graph_version INTEGER NOT NULL,
    from_step_id TEXT NOT NULL,
    to_step_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    condition_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_candidates (
    candidate_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    proposed_by_type TEXT NOT NULL,
    proposed_by_id TEXT,
    parent_candidate_id TEXT,
    base_graph_version INTEGER NOT NULL,
    score_json TEXT NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plan_candidate_steps (
    candidate_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    step_json TEXT NOT NULL,
    PRIMARY KEY(candidate_id, step_id)
);
CREATE TABLE IF NOT EXISTS plan_candidate_edges (
    candidate_id TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    edge_json TEXT NOT NULL,
    PRIMARY KEY(candidate_id, edge_id)
);
```
---
## 5. Memory: Four Tiers + Stigmergy
### Design Choice
Memory is derived from events. Store raw traces append-only, then maintain queryable projections. Do not pretend SQLite is a vector database at Level 5. Use SQLite FTS5 for first implementation and leave vector embeddings behind a trait.
### Memory Types
In `cortex-memory/src/lib.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MemoryTier {
    Working,
    Episodic,
    Semantic,
    Procedural,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub memory_id: Uuid,
    pub tier: MemoryTier,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub key: String,
    pub content: StructuredPayload,
    pub importance: f64,
    pub confidence: f64,
    pub source_event_id: EventId,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StigmergyTrace {
    pub trace_id: Uuid,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub worker_id: Option<WorkerId>,
    pub trace_type: TraceType,
    pub target: TraceTarget,
    pub signal: f64,
    pub decay: DecaySpec,
    pub content: StructuredPayload,
    pub evidence_refs: Vec<EvidenceRef>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TraceType {
    UsefulPath,
    RiskMarker,
    FailedApproach,
    TestSignal,
    CapabilityHint,
    CostSignal,
    HumanPreference,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TraceTarget {
    TaskKind(TaskKind),
    FilePath(String),
    Capability(CapabilityId),
    Worker(WorkerId),
    Policy(String),
    PlanPattern(String),
    Artifact(String),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecaySpec {
    pub half_life_seconds: u64,
    pub min_signal: f64,
}
```
### Memory Traits
```rust
#[async_trait::async_trait]
pub trait MemoryWriter: Send + Sync {
    async fn write_record(&self, record: NewMemoryRecord) -> anyhow::Result<MemoryRecord>;
    async fn write_trace(&self, trace: StigmergyTrace) -> anyhow::Result<()>;
    async fn promote(&self, memory_id: Uuid, target_tier: MemoryTier) -> anyhow::Result<()>;
}
#[async_trait::async_trait]
pub trait MemoryView: Send + Sync {
    async fn working_set(&self, run_id: RunId) -> anyhow::Result<Vec<MemoryRecord>>;
    async fn query(&self, query: MemoryQuery) -> anyhow::Result<Vec<ScoredMemory>>;
    async fn traces_for_target(
        &self,
        target: TraceTarget,
        now: DateTime<Utc>,
    ) -> anyhow::Result<Vec<DecayedTrace>>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryQuery {
    pub tiers: Vec<MemoryTier>,
    pub text: Option<String>,
    pub structured_filter: Option<serde_json::Value>,
    pub run_id: Option<RunId>,
    pub task_kind: Option<TaskKind>,
    pub limit: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredMemory {
    pub record: MemoryRecord,
    pub score: f64,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecayedTrace {
    pub trace: StigmergyTrace,
    pub current_signal: f64,
}
```
### Memory Tables
```sql
CREATE TABLE IF NOT EXISTS memory_records (
    memory_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    run_id TEXT,
    step_id TEXT,
    key TEXT NOT NULL,
    content_json TEXT NOT NULL,
    importance REAL NOT NULL,
    confidence REAL NOT NULL,
    source_event_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_tier_key
ON memory_records(tier, key);
CREATE INDEX IF NOT EXISTS idx_memory_run
ON memory_records(run_id, tier);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts
USING fts5(memory_id UNINDEXED, key, content_text);
CREATE TABLE IF NOT EXISTS stigmergy_traces (
    trace_id TEXT PRIMARY KEY,
    run_id TEXT,
    step_id TEXT,
    worker_id TEXT,
    trace_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_key TEXT NOT NULL,
    signal REAL NOT NULL,
    half_life_seconds INTEGER NOT NULL,
    min_signal REAL NOT NULL,
    content_json TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stigmergy_target
ON stigmergy_traces(target_type, target_key, created_at);
CREATE INDEX IF NOT EXISTS idx_stigmergy_run
ON stigmergy_traces(run_id, created_at);
```
### Pressure Optimization
Replace `pressure_for_user` scanning all events with rollups.
```sql
CREATE TABLE IF NOT EXISTS usage_pressure_buckets (
    user_id TEXT NOT NULL,
    bucket_start TEXT NOT NULL,
    bucket_seconds INTEGER NOT NULL,
    provider TEXT,
    model TEXT,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, bucket_start, bucket_seconds, provider, model)
);
CREATE INDEX IF NOT EXISTS idx_pressure_user_bucket
ON usage_pressure_buckets(user_id, bucket_start);
```
Then pressure is computed from recent bucket rows, not all raw `usage_events`.
---
## 6. Workers: Capability Manifests, Roles, Checkpoints
### Design Choice
CLI-wrapped executors cannot truly migrate process state. So checkpoint migration is semantic replay plus artifact snapshots, not live process transfer. The protocol should be honest about this. For Claude/Codex/Gemini subprocesses, checkpoint means:
1. Captured prompt/input context.
2. Captured stdout/stderr transcript.
3. Captured produced artifacts.
4. Captured structured state summary.
5. Optional workspace snapshot hash or tarball reference.
### Manifest Types
In `cortex-core/src/worker.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerManifest {
    pub worker_id: WorkerId,
    pub schema_version: u16,
    pub name: String,
    pub roles: Vec<WorkerRole>,
    pub capabilities: Vec<WorkerCapability>,
    pub executors: Vec<ExecutorDescriptor>,
    pub resource_limits: ResourceLimits,
    pub sandbox: SandboxDescriptor,
    pub checkpoint: CheckpointDescriptor,
    pub mesh: MeshDescriptor,
    pub advertised_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerCapability {
    pub id: CapabilityId,
    pub name: String,
    pub version: String,
    pub task_kinds: Vec<TaskKind>,
    pub input_schemas: Vec<JsonSchemaRef>,
    pub output_schemas: Vec<JsonSchemaRef>,
    pub risk_tiers: Vec<RiskTier>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutorDescriptor {
    pub executor_id: String,
    pub provider: String,
    pub model: Option<String>,
    pub command: Option<String>,
    pub modes: Vec<ExecutionMode>,
    pub deterministic: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointDescriptor {
    pub support: CheckpointSupport,
    pub max_snapshot_bytes: Option<u64>,
    pub restore_modes: Vec<CheckpointRestoreMode>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CheckpointRestoreMode {
    SameWorkerOnly,
    CompatibleExecutor,
    AnyWorkerSemanticReplay,
}
```
### Worker Runtime Traits
```rust
#[async_trait::async_trait]
pub trait Executor: Send + Sync {
    fn descriptor(&self) -> ExecutorDescriptor;
    async fn can_execute(&self, task: &TaskSpec, policy: &PolicyEnvelope) -> anyhow::Result<CapabilityMatch>;
    async fn execute(
        &self,
        assignment: StepAssignment,
        context: StepContext,
        checkpoint: Option<CheckpointRef>,
        sink: Box<dyn ExecutionSink>,
    ) -> anyhow::Result<ExecutionResult>;
    async fn create_checkpoint(
        &self,
        assignment: &StepAssignment,
        state: &ExecutionState,
    ) -> anyhow::Result<CheckpointRef>;
    async fn restore_checkpoint(
        &self,
        checkpoint: CheckpointRef,
    ) -> anyhow::Result<RestoredExecutionState>;
}
#[async_trait::async_trait]
pub trait ExecutionSink: Send + Sync {
    async fn started(&self, event: StepStarted) -> anyhow::Result<()>;
    async fn output(&self, output: StepOutput) -> anyhow::Result<()>;
    async fn checkpoint(&self, checkpoint: CheckpointRef) -> anyhow::Result<()>;
    async fn completed(&self, completed: StepCompleted) -> anyhow::Result<()>;
    async fn failed(&self, failed: StepFailed) -> anyhow::Result<()>;
}
```
### Checkpoint Types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointRef {
    pub checkpoint_id: Uuid,
    pub run_id: RunId,
    pub step_id: StepId,
    pub attempt_id: Uuid,
    pub worker_id: WorkerId,
    pub support: CheckpointSupport,
    pub restore_mode: CheckpointRestoreMode,
    pub artifact_refs: Vec<ArtifactRef>,
    pub transcript_ref: Option<ArtifactRef>,
    pub semantic_state: StructuredPayload,
    pub workspace_snapshot: Option<WorkspaceSnapshotRef>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSnapshotRef {
    pub snapshot_id: Uuid,
    pub content_hash: String,
    pub storage_uri: String,
    pub byte_len: u64,
    pub file_count: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionState {
    pub prompt_context: serde_json::Value,
    pub transcript: Vec<TranscriptItem>,
    pub partial_outputs: Vec<StructuredPayload>,
    pub touched_files: Vec<String>,
}
```
### Worker Tables
```sql
CREATE TABLE IF NOT EXISTS worker_manifests (
    worker_id TEXT PRIMARY KEY,
    manifest_json TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS worker_capabilities (
    worker_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    task_kinds_json TEXT NOT NULL,
    risk_tiers_json TEXT NOT NULL,
    PRIMARY KEY(worker_id, capability_id)
);
CREATE TABLE IF NOT EXISTS checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    support TEXT NOT NULL,
    restore_mode TEXT NOT NULL,
    semantic_state_json TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    transcript_ref_json TEXT,
    workspace_snapshot_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_step
ON checkpoints(run_id, step_id, created_at);
```
---
## 7. Security: Policy Envelopes and Evidence Quorums
### Design Choice
Policy envelopes compose by specificity and deny-by-default for dangerous actions. Precedence:
```text
system baseline < org < project < run < step < human override
```
But composition is not “last write wins” for everything. Denies accumulate unless an explicit override is signed by a principal with override authority.
### Policy Types
In new `cortex-policy/src/lib.rs` and shared serializable types in `cortex-core/src/policy.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEnvelope {
    pub policy_id: String,
    pub version: u32,
    pub layer: PolicyLayer,
    pub subject: PolicySubject,
    pub rules: Vec<PolicyRule>,
    pub budget: BudgetPolicy,
    pub quorum: Option<QuorumPolicy>,
    pub provenance: PolicyProvenance,
    pub expires_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PolicyLayer {
    System,
    Org,
    Project,
    Run,
    Step,
    HumanOverride,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicySubject {
    Global,
    User { user_id: String },
    Run { run_id: RunId },
    Step { step_id: StepId },
    Worker { worker_id: WorkerId },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub rule_id: String,
    pub effect: PolicyEffect,
    pub action: PolicyAction,
    pub condition: Option<PolicyCondition>,
    pub overrideable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyEffect {
    Allow,
    Deny,
    RequireApproval,
    RequireQuorum,
    RequireSandbox,
    RequireEvidence,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyAction {
    ReadFile { path_glob: String },
    WriteFile { path_glob: String },
    ExecuteCommand { command_glob: String },
    NetworkAccess { scope: NetworkScope },
    SpendBudget,
    UseProvider { provider: String },
    DelegateToWorker,
    ModifyDag,
    PromoteLearningCandidate,
    Deploy,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkScope {
    None,
    Loopback,
    Domains(Vec<String>),
    Any,
}
```
### Composition Trait
```rust
pub trait PolicyEngine: Send + Sync {
    fn compose(&self, envelopes: &[PolicyEnvelope]) -> anyhow::Result<EffectivePolicy>;
    fn evaluate(
        &self,
        policy: &EffectivePolicy,
        request: PolicyRequest,
    ) -> anyhow::Result<PolicyDecision>;
    fn required_evidence(
        &self,
        policy: &EffectivePolicy,
        action: &PolicyAction,
    ) -> Vec<EvidenceRequirement>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectivePolicy {
    pub policy_hash: String,
    pub source_policy_ids: Vec<String>,
    pub rules: Vec<PolicyRule>,
    pub budget: BudgetPolicy,
    pub quorum: Option<QuorumPolicy>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRequest {
    pub actor: ProtocolActor,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub action: PolicyAction,
    pub context: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyDecision {
    Allow,
    Deny { reasons: Vec<String> },
    RequireApproval { reasons: Vec<String> },
    RequireQuorum { policy: QuorumPolicy },
    RequireSandbox { decision_after_sandbox: Box<PolicyDecision> },
}
```
### Evidence Quorums
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuorumPolicy {
    pub quorum_id: String,
    pub min_accepts: u16,
    pub max_rejects: u16,
    pub required_roles: Vec<WorkerRole>,
    pub independence: IndependenceRequirement,
    pub timeout_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IndependenceRequirement {
    None,
    DistinctWorkers,
    DistinctProviders,
    DistinctModels,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub evidence_id: Uuid,
    pub run_id: RunId,
    pub step_id: Option<StepId>,
    pub submitted_by: ProtocolActor,
    pub kind: EvidenceKind,
    pub claim: String,
    pub payload: StructuredPayload,
    pub artifact_refs: Vec<ArtifactRef>,
    pub confidence: f64,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvidenceKind {
    TestPassed,
    TestFailed,
    ReviewApproval,
    ReviewRejection,
    StaticAnalysis,
    RuntimeObservation,
    HumanApproval,
    PolicyAttestation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuorumDecision {
    pub quorum_id: String,
    pub run_id: RunId,
    pub step_id: Option<StepId>,
    pub accepted: bool,
    pub evidence_ids: Vec<Uuid>,
    pub reasons: Vec<String>,
    pub decided_at: DateTime<Utc>,
}
```
### Security Tables
```sql
CREATE TABLE IF NOT EXISTS policy_envelopes (
    policy_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    layer TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT,
    envelope_json TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    PRIMARY KEY(policy_id, version)
);
CREATE INDEX IF NOT EXISTS idx_policy_subject
ON policy_envelopes(subject_type, subject_id, active);
CREATE TABLE IF NOT EXISTS effective_policies (
    policy_hash TEXT PRIMARY KEY,
    source_policy_ids_json TEXT NOT NULL,
    effective_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    submitted_by_type TEXT NOT NULL,
    submitted_by_id TEXT,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quorum_decisions (
    quorum_decision_id TEXT PRIMARY KEY,
    quorum_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT,
    accepted INTEGER NOT NULL,
    evidence_ids_json TEXT NOT NULL,
    reasons_json TEXT NOT NULL,
    decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
---
## 8. Mission Control: Interactive Operational Theater
### Design Choice
Mission Control should consume the same event stream as everything else. Time scrub is replay from `events`. Interactive actions append command events, then command handlers mutate projections.
### Mission Control Types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MissionControlCommand {
    ApproveTask(ApproveTask),
    RejectTask(RejectTask),
    PauseRun(PauseRun),
    ResumeRun(ResumeRun),
    RedirectStep(RedirectStep),
    InjectStep(InjectStep),
    AdjustPolicy(ApplyPolicyEnvelope),
    ForceQuorumDecision(QuorumDecision),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionControlView {
    pub run_id: RunId,
    pub as_of_sequence: i64,
    pub run_state: RunState,
    pub graph: ExecutionGraphView,
    pub workers: Vec<WorkerStatusView>,
    pub route_decisions: Vec<RouteDecisionView>,
    pub evidence_sets: Vec<EvidenceSetView>,
    pub memory_traces: Vec<DecayedTrace>,
    pub pending_approvals: Vec<ApprovalRequestView>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeScrubRequest {
    pub run_id: RunId,
    pub as_of_sequence: i64,
}
```
### Mission Control DB
Most data is from events, but pending commands need durable tracking:
```sql
CREATE TABLE IF NOT EXISTS mission_control_commands (
    command_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_id TEXT,
    command_type TEXT NOT NULL,
    command_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_event_id TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    requested_by_event_id TEXT NOT NULL,
    approval_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    context_json TEXT NOT NULL,
    status TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_reason TEXT
);
```
This finally makes `AwaitingApproval`, `Approved`, and `Rejected` real.
---
## 9. Learning Loop: Gated Self-Improvement Factory
### Design Choice
Learning candidates are not auto-promoted into production behavior. They are artifacts with benchmark results and canary gates. The first implementation should improve router priors, decomposition prompts/templates, and policy hints. Do not let it rewrite core scheduler logic automatically.
### Types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceCapture {
    pub capture_id: Uuid,
    pub run_id: RunId,
    pub event_range: EventRange,
    pub failure_class: Option<FailureClass>,
    pub summary: StructuredPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FailureClass {
    ToolFailure,
    BadPlan,
    BadRouting,
    PolicyBlocked,
    BudgetExceeded,
    Timeout,
    InvalidOutput,
    TestFailure,
    HumanRejected,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCandidate {
    pub candidate_id: Uuid,
    pub kind: LearningCandidateKind,
    pub source_capture_ids: Vec<Uuid>,
    pub proposed_change: StructuredPayload,
    pub risk_tier: RiskTier,
    pub status: LearningStatus,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LearningCandidateKind {
    RouterPriorAdjustment,
    WorkerCapabilityUpdate,
    DecompositionTemplate,
    PolicyRuleSuggestion,
    ProceduralMemory,
    BenchmarkCase,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LearningStatus {
    Draft,
    Benchmarking,
    Canary,
    Promoted,
    RolledBack,
    Rejected,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub result_id: Uuid,
    pub candidate_id: Uuid,
    pub benchmark_suite: String,
    pub passed: bool,
    pub metrics: serde_json::Value,
    pub created_at: DateTime<Utc>,
}
```
### Learning Trait
```rust
#[async_trait::async_trait]
pub trait LearningLoop: Send + Sync {
    async fn capture_trace(&self, run_id: RunId, range: EventRange) -> anyhow::Result<TraceCapture>;
    async fn classify_failure(&self, capture: &TraceCapture) -> anyhow::Result<Option<FailureClass>>;
    async fn generate_candidates(
        &self,
        capture: &TraceCapture,
    ) -> anyhow::Result<Vec<LearningCandidate>>;
    async fn benchmark(&self, candidate_id: Uuid) -> anyhow::Result<BenchmarkResult>;
    async fn start_canary(&self, candidate_id: Uuid, policy: CanaryPolicy) -> anyhow::Result<()>;
    async fn promote(&self, candidate_id: Uuid, evidence: Vec<Evidence>) -> anyhow::Result<LearningPromotion>;
    async fn rollback(&self, candidate_id: Uuid, reason: String) -> anyhow::Result<()>;
}
```
### Learning Tables
```sql
CREATE TABLE IF NOT EXISTS trace_captures (
    capture_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    from_sequence INTEGER NOT NULL,
    to_sequence INTEGER NOT NULL,
    failure_class TEXT,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS learning_candidates (
    candidate_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source_capture_ids_json TEXT NOT NULL,
    proposed_change_json TEXT NOT NULL,
    risk_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS benchmark_results (
    result_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    benchmark_suite TEXT NOT NULL,
    passed INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS canary_runs (
    canary_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    rollback_reason TEXT
);
CREATE TABLE IF NOT EXISTS learning_promotions (
    promotion_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    promoted_by TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL,
    promoted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
---
## 10. Crate Boundary Changes
### `cortex-core`
Keep:
```text
types
protocol
events
policy data types
worker manifests
artifacts
task specs
structured payloads
```
Do not put SQLite, axum, subprocess, or routing algorithms here.
### `cortex-engine`
Owns:
```text
reactive graph
decomposer
scheduler
plan candidate scoring
invalidation
graph projections
```
Depends on `cortex-core`, `cortex-memory` traits, and `cortex-policy` traits.
### `cortex-api`
Owns:
```text
HTTP routes
WebSocket brain server
Mission Control
SQLite implementation of EventStore
SQLite projections
auth
admin commands
```
Depends on all domain crates.
### `cortex-worker`
Owns:
```text
worker process
manifest loader
CLI executors
checkpoint writer/restorer
mesh client
Brain WS client
```
Depends on `cortex-core` and maybe `cortex-policy` for local preflight checks.
### New `cortex-router`
Owns:
```text
bid collection
Thompson sampling
routing outcomes
reputation projection
```
### New `cortex-memory`
Owns:
```text
memory traits
event replay projections
stigmergy decay
FTS query implementation abstraction
```
### New `cortex-policy`
Owns:
```text
policy composition
policy evaluation
quorum evaluation
manifest precedence validation
```
---
## 11. Migration Path From Level 1 to Level 5
### Phase 0: Compatibility Foundation
Add new types behind protocol schema version `2`, but keep accepting current message shapes. Current `BrainMessage::ExecuteStep` and `WorkerMessage::StepCompleted` continue to work.
Add `events` table and start dual-writing:
```text
runs insert -> RunCreated event
steps insert -> StepCreated event
step attempt start -> StepStarted event
completion -> StepCompleted event
failure -> StepFailed event
```
No behavior changes yet.
### Phase 1: Structured Output and Event Replay
Start populating `StepOutput.structured` for known executor outputs:
```text
test result
file edits
usage
summary
review finding
```
Add Mission Control time scrub by replaying `events` into a read model. Existing UI keeps current stream.
### Phase 2: Worker Manifests
Workers send `ManifestAdvertised` on connect. Brain stores `worker_manifests` and `worker_capabilities`.
Current workers can advertise a minimal manifest:
```rust
WorkerManifest {
    roles: vec![WorkerRole::Generalist],
    checkpoint: CheckpointDescriptor {
        support: CheckpointSupport::SemanticState,
        restore_modes: vec![CheckpointRestoreMode::AnyWorkerSemanticReplay],
        max_snapshot_bytes: None,
    },
    // ...
}
```
No bidding yet. Brain still assigns as before.
### Phase 3: Router Shadow Mode
Implement `cortex-router`, `worker_bids`, and `route_decisions`.
Initially, Brain asks for bids but does not use them for assignment. It records what would have been selected and compares to actual outcomes.
This protects production behavior while building posterior data.
### Phase 4: Router Active for Low-Risk Steps
Enable market routing only when:
```text
risk_tier = Low
execution_mode != AgenticUntrusted
policy does not require approval
at least 2 compatible workers or known fallback
```
Fallback to Level 1 evaluator if no valid bids arrive before deadline.
### Phase 5: Reactive Graph Contracts
Add `reactive_steps` and `reactive_edges` as projections alongside existing `steps` and `step_edges`.
Existing decomposer fills default contracts:
```text
inputs = predecessor summaries
outputs = generic summary
invalidation = upstream failed/input changed
```
Scheduler still operates mostly as today but reads readiness from contracts.
### Phase 6: Plan Candidates and Worker Step Proposals
Allow workers to send `ProposedStep` and `ProposedPlan`, but require Brain acceptance. Accepted proposals are inserted into the committed graph and mirrored into old `steps`/`step_edges` tables.
This avoids breaking old run views.
### Phase 7: Policy Envelopes and Quorums
Start with passive policy logging, then enforce:
```text
write scope
network scope
budget
dangerous commands
deploy actions
```
Enable `AwaitingApproval`, `Approved`, and `Rejected` states only where policy demands it.
### Phase 8: Checkpoints
Implement semantic checkpoints for CLI executors. Do not claim live process migration. If a worker dies:
```text
Brain requests latest checkpoint
Brain reopens bidding with checkpoint ref
new worker resumes from semantic state and artifacts
```
This is sufficient for agentic CLI execution.
### Phase 9: Memory and Stigmergy
Write working and episodic memory from events first. Then add semantic/procedural promotion through the gated learning loop.
Use stigmergy traces to inform:
```text
routing context
decomposer choices
risk classification
review/test focus
```
### Phase 10: Learning Loop
Start with benchmark-case generation and router prior adjustment. Human or policy quorum required for promotion.
Do not let learning modify core scheduler code automatically.
---
## Hard Challenges to the Vision Doc
The “agent-to-agent mesh” should be constrained. If worker mesh messages can mutate truth, the system becomes impossible to audit. The Brain must remain the only committer of graph, policy, memory, and outcome events.
“Checkpoint migration” for CLI-wrapped Claude/Codex/Gemini cannot mean process migration. It should mean semantic replay and artifact restoration. Anything stronger requires owning the executor runtime.
“BFT-inspired acceptance quorums” should not be framed as Byzantine fault tolerance unless workers have independent trust roots and adversarial assumptions are formalized. The implementation should call this evidence quorum, with independence constraints.
“Event-sourced institutional memory” should not immediately replace CRUD tables. The safe architecture is event spine plus projections. Full event-sourced write models can come later if needed.
The highest-leverage first slice is:
1. Add event spine.
2. Add protocol envelope.
3. Add worker manifests.
4. Add router shadow mode.
5. Add structured outputs.
That path creates Level 5 foundations without destabilizing the current scheduler.
I could not inspect the workspace because every shell command failed before execution with:
```text
bwrap: Unexpected capabilities but not setuid, old file caps config?
```
So this blueprint is grounded in the architecture summary you provided, not fresh repo inspection. I would still treat this as implementation-ready design, but the first build slice should verify exact module names and existing table columns.
# Cortex Level 5 Concrete Rust Architecture
The core choice: Level 5 should not replace the current CRUD scheduler in one jump. It should add an append-only event spine, schema-versioned protocol envelopes, worker manifests, contextual routing statistics, and policy envelopes while keeping the existing `runs`, `steps`, `step_edges`, and `step_attempts` tables as read/write projections during migration.
I would split the system into these responsibilities:
```text
cortex-core
  Stable shared types, protocol envelopes, policy model, event model, memory payloads.
cortex-engine
  DAG planner/scheduler, speculative graph, invalidation, candidate plan scoring.
cortex-api
  Axum server, SQLite storage, event append/replay, Mission Control, auth, DB projections.
cortex-worker
  Worker runtime, CLI executors, checkpoint handling, manifest loading.
new: cortex-memory
  Event replay, derived memory views, stigmergy decay, semantic/procedural stores.
new: cortex-router
  Market router, bidding, Thompson sampling, contextual success estimates.
new: cortex-policy
  Policy envelope composition, evidence quorum evaluation, governance checks.
```
I would add the new crates because router, memory, and policy will otherwise turn `cortex-core` into a junk drawer. `cortex-core` should define wire-compatible types and pure domain objects only.
---
## 1. Protocol: Schema-Versioned, Replayable, Brain-Anchored Mesh
### Design Choice
All protocol messages move into a versioned envelope. Brain remains the source of truth. Workers may exchange direct mesh messages, but every consequential action must be mirrored to Brain as an event. Direct worker-to-worker traffic is advisory unless Brain commits it.
### Core Protocol Types
In `crates/core/src/protocol.rs`:
```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use uuid::Uuid;
use chrono::{DateTime, Utc};
pub const PROTOCOL_SCHEMA_VERSION: u16 = 2;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RunId(pub Uuid);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StepId(pub Uuid);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WorkerId(pub Uuid);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EventId(pub Uuid);
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CapabilityId(pub String);
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolEnvelope<T> {
    pub schema_version: u16,
    pub message_id: Uuid,
    pub run_id: Option<RunId>,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<Uuid>,
    pub sender: ProtocolActor,
    pub recipient: ProtocolRecipient,
    pub sent_at: DateTime<Utc>,
    pub body: T,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProtocolActor {
    Brain,
    Worker { worker_id: WorkerId },
    MissionControl { session_id: Uuid },
    System,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProtocolRecipient {
    Brain,
    Worker { worker_id: WorkerId },
    Workers { role: Option<WorkerRole> },
    MissionControl,
    Broadcast,
}
pub type BrainEnvelope = ProtocolEnvelope<BrainMessage>;
pub type WorkerEnvelope = ProtocolEnvelope<WorkerMessage>;
pub type MeshEnvelope = ProtocolEnvelope<MeshMessage>;
```
### Worker Roles and Modes
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkerRole {
    Scout,
    Planner,
    Implementer,
    Reviewer,
    Tester,
    Guard,
    Summarizer,
    Generalist,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExecutionMode {
    Deterministic,
    Model,
    Agent,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExecutionTrust {
    LocalDeterministic,
    ModelAssisted,
    AgenticUntrusted,
    AgenticSandboxed,
    HumanApproved,
}
```
### New Brain Messages
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum BrainMessage {
    ExecuteStep(ExecuteStep),
    CancelStep(CancelStep),
    Heartbeat(BrainHeartbeat),
    AckCompletion(AckCompletion),
    // Level 5 additions
    RequestManifest(RequestManifest),
    RequestBid(RequestBid),
    AcceptBid(AcceptBid),
    RejectBid(RejectBid),
    OpenMeshSession(OpenMeshSession),
    CloseMeshSession(CloseMeshSession),
    RequestCheckpoint(RequestCheckpoint),
    ResumeFromCheckpoint(ResumeFromCheckpoint),
    ApplyPolicyEnvelope(ApplyPolicyEnvelope),
    RequestEvidence(RequestEvidence),
    QuorumDecision(QuorumDecision),
    ApproveTask(ApproveTask),
    RejectTask(RejectTask),
    PauseRun(PauseRun),
    RedirectStep(RedirectStep),
    InjectStep(InjectStep),
    InvalidateSteps(InvalidateSteps),
}
```
### New Worker Messages
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum WorkerMessage {
    StepStarted(StepStarted),
    StepOutput(StepOutput),
    StepCompleted(StepCompleted),
    StepFailed(StepFailed),
    Heartbeat(WorkerHeartbeat),
    // Level 5 additions
    ManifestAdvertised(WorkerManifest),
    BidSubmitted(WorkerBid),
    BidDeclined(BidDeclined),
    CheckpointCreated(CheckpointRef),
    CheckpointRejected(CheckpointRejected),
    ResumeAccepted(ResumeAccepted),
    ResumeRejected(ResumeRejected),
    ProposedStep(ProposedStep),
    ProposedPlan(PlanCandidate),
    EvidenceSubmitted(Evidence),
    PolicyViolation(PolicyViolation),
    StructuredObservation(StructuredObservation),
    MeshTranscriptCommitted(MeshTranscript),
}
```
### Mesh Messages
Direct worker coordination gets its own enum. These messages are not authoritative unless committed back to Brain.
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum MeshMessage {
    RequestArtifact(RequestArtifact),
    ProvideArtifact(ProvideArtifact),
    RequestReview(RequestReview),
    ReviewFinding(ReviewFinding),
    ClaimSubtask(ClaimSubtask),
    ReleaseSubtask(ReleaseSubtask),
    ShareObservation(StructuredObservation),
    RequestLocalContext(RequestLocalContext),
}
```
### Worker Bid
The bid is concrete, priced, capability-bound, and falsifiable. No vague “confidence”.
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestBid {
    pub run_id: RunId,
    pub step_id: StepId,
    pub task: TaskSpec,
    pub policy: PolicyEnvelope,
    pub required_capabilities: Vec<CapabilityConstraint>,
    pub desired_outputs: Vec<OutputContract>,
    pub bid_deadline_ms: u64,
    pub max_parallel_awards: u16,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerBid {
    pub run_id: RunId,
    pub step_id: StepId,
    pub worker_id: WorkerId,
    pub bid_id: Uuid,
    pub role: WorkerRole,
    pub execution_mode: ExecutionMode,
    pub estimated_cost: CostEstimate,
    pub estimated_latency_ms: u64,
    pub success_likelihood: f64,
    pub uncertainty: f64,
    pub capability_match: f64,
    pub risk_acceptance: RiskAcceptance,
    pub checkpoint_support: CheckpointSupport,
    pub evidence_plan: EvidencePlan,
    pub assumptions: Vec<String>,
    pub expires_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub tool_calls: Option<u32>,
    pub usd: Option<f64>,
    pub local_cpu_ms: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAcceptance {
    pub accepted_policy_hash: String,
    pub sandbox_required: bool,
    pub filesystem_write_scope: Vec<String>,
    pub network_scope: NetworkScope,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CheckpointSupport {
    None,
    FilesystemSnapshot,
    ProcessReplay,
    SemanticState,
    Full,
}
```
### Step Output Becomes Semantic Payload
Current `structured: serde_json::Value` is fine as a wire fallback, but internally it needs a typed semantic envelope.
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepOutput {
    pub run_id: RunId,
    pub step_id: StepId,
    pub worker_id: WorkerId,
    pub attempt_id: Uuid,
    pub text: String,
    pub files: Vec<FileArtifact>,
    pub usage: Option<UsageReport>,
    pub structured: StructuredPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredPayload {
    pub schema: String,
    pub schema_version: u16,
    pub kind: StructuredKind,
    pub value: Value,
    pub confidence: Option<f64>,
    pub evidence_refs: Vec<EvidenceRef>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StructuredKind {
    Plan,
    CodeChange,
    TestResult,
    Review,
    RiskAssessment,
    Fact,
    Summary,
    Decision,
    Metric,
    Unknown,
}
```
---
## 2. Event Sourcing: Minimum Viable Event Spine
### Design Choice
Do not event-source everything on day one. Add an append-only `events` table and dual-write from existing CRUD operations. The existing tables remain projections. New Level 5 features append events first, then update projections in a transaction.
### Core Event Types
In `cortex-core/src/events.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CortexEvent {
    pub id: EventId,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub stream: EventStream,
    pub sequence: i64,
    pub actor: ProtocolActor,
    pub occurred_at: DateTime<Utc>,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<Uuid>,
    pub schema_version: u16,
    pub payload: EventPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventStream {
    Global,
    Run(RunId),
    Step(StepId),
    Worker(WorkerId),
    Policy(String),
    Memory(String),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum EventPayload {
    RunCreated(RunCreated),
    StepCreated(StepCreated),
    StepQueued(StepQueued),
    StepAssigned(StepAssigned),
    StepStarted(StepStarted),
    StepOutput(StepOutput),
    StepCompleted(StepCompleted),
    StepFailed(StepFailed),
    StepCancelled(StepCancelled),
    BidRequested(RequestBid),
    BidSubmitted(WorkerBid),
    BidAccepted(AcceptBid),
    BidRejected(RejectBid),
    PlanProposed(PlanCandidate),
    PlanAccepted(PlanAccepted),
    StepProposed(ProposedStep),
    StepInjected(InjectStep),
    StepInvalidated(StepInvalidated),
    PolicyApplied(PolicyEnvelope),
    PolicyViolation(PolicyViolation),
    EvidenceSubmitted(Evidence),
    QuorumReached(QuorumDecision),
    CheckpointCreated(CheckpointRef),
    CheckpointRestored(CheckpointRestored),
    MemoryTraceWritten(StigmergyTrace),
    LearningCandidateCreated(LearningCandidate),
    LearningCandidatePromoted(LearningPromotion),
    MissionControlAction(MissionControlAction),
}
```
### Event Store Trait
In new `cortex-memory` or `cortex-api/src/event_store.rs` initially:
```rust
#[async_trait::async_trait]
pub trait EventStore: Send + Sync {
    async fn append(&self, event: NewEvent) -> anyhow::Result<CortexEvent>;
    async fn append_batch(
        &self,
        events: Vec<NewEvent>,
        expected: ExpectedStreamVersion,
    ) -> anyhow::Result<Vec<CortexEvent>>;
    async fn load_stream(
        &self,
        stream: EventStream,
        after_sequence: Option<i64>,
        limit: usize,
    ) -> anyhow::Result<Vec<CortexEvent>>;
    async fn load_run_events(
        &self,
        run_id: RunId,
        after_sequence: Option<i64>,
    ) -> anyhow::Result<Vec<CortexEvent>>;
    async fn subscribe(&self, from_global_sequence: i64) -> anyhow::Result<EventSubscription>;
}
#[derive(Debug, Clone)]
pub struct NewEvent {
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub stream: EventStream,
    pub actor: ProtocolActor,
    pub causation_id: Option<EventId>,
    pub correlation_id: Option<Uuid>,
    pub schema_version: u16,
    pub payload: EventPayload,
}
#[derive(Debug, Clone)]
pub enum ExpectedStreamVersion {
    Any,
    Exact(i64),
    NotExists,
}
```
### Event Tables
```sql
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    global_sequence INTEGER NOT NULL UNIQUE,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    stream_sequence INTEGER NOT NULL,
    run_id TEXT,
    step_id TEXT,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    causation_id TEXT,
    correlation_id TEXT,
    schema_version INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payload_hash TEXT NOT NULL,
    prev_stream_hash TEXT,
    stream_hash TEXT NOT NULL,
    UNIQUE(stream_type, stream_id, stream_sequence)
);
CREATE INDEX IF NOT EXISTS idx_events_run_sequence
ON events(run_id, global_sequence);
CREATE INDEX IF NOT EXISTS idx_events_stream
ON events(stream_type, stream_id, stream_sequence);
CREATE INDEX IF NOT EXISTS idx_events_type_time
ON events(event_type, occurred_at);
```
SQLite needs global sequence generation. Use a transaction plus a singleton counter table:
```sql
CREATE TABLE IF NOT EXISTS event_sequences (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO event_sequences(name, value)
VALUES ('global', 0);
```
Within one transaction:
```sql
UPDATE event_sequences SET value = value + 1 WHERE name = 'global';
SELECT value FROM event_sequences WHERE name = 'global';
```
---
## 3. Evaluator: Market Router + Thompson Sampling
### Design Choice
Use Thompson sampling over contextual buckets, not a full online model first. Rust implementation should be deterministic, debuggable, and backed by SQLite. Contextual keys are coarse: role, task kind, risk tier, provider/model, worker capability set hash, execution mode.
Static scoring stays as a fallback prior.
### Router Types
In `cortex-router/src/lib.rs`:
```rust
use rand::Rng;
use rand_distr::{Beta, Distribution};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingContext {
    pub run_id: RunId,
    pub step_id: StepId,
    pub task_kind: TaskKind,
    pub role: WorkerRole,
    pub risk_tier: RiskTier,
    pub execution_mode: ExecutionMode,
    pub budget_class: BudgetClass,
    pub required_capabilities: Vec<CapabilityId>,
    pub policy_hash: String,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TaskKind {
    Plan,
    CodeEdit,
    Test,
    Review,
    Research,
    Summarize,
    Shell,
    Deploy,
    SecurityAnalysis,
    Unknown,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum RiskTier {
    Low,
    Medium,
    High,
    Critical,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum BudgetClass {
    Tiny,
    Normal,
    ExpensiveAllowed,
    Emergency,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteDecision {
    pub decision_id: Uuid,
    pub run_id: RunId,
    pub step_id: StepId,
    pub selected_bid: WorkerBid,
    pub considered_bids: Vec<ScoredBid>,
    pub strategy: RoutingStrategy,
    pub explanation: DecisionExplanation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RoutingStrategy {
    DeterministicRule,
    ThompsonSampling,
    HumanOverride,
    FallbackStaticEvaluator,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredBid {
    pub bid: WorkerBid,
    pub sampled_success: f64,
    pub expected_utility: f64,
    pub posterior_alpha: f64,
    pub posterior_beta: f64,
    pub cost_penalty: f64,
    pub risk_penalty: f64,
}
```
### Thompson Sampling
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BetaPosterior {
    pub alpha: f64,
    pub beta: f64,
    pub observations: u64,
    pub last_updated_at: DateTime<Utc>,
}
impl BetaPosterior {
    pub fn prior() -> Self {
        Self {
            alpha: 2.0,
            beta: 2.0,
            observations: 0,
            last_updated_at: Utc::now(),
        }
    }
    pub fn update(&self, success: bool, weight: f64) -> Self {
        let mut next = self.clone();
        if success {
            next.alpha += weight.max(0.0);
        } else {
            next.beta += weight.max(0.0);
        }
        next.observations += 1;
        next.last_updated_at = Utc::now();
        next
    }
    pub fn sample<R: Rng + ?Sized>(&self, rng: &mut R) -> f64 {
        let dist = Beta::new(self.alpha.max(0.001), self.beta.max(0.001))
            .expect("valid beta posterior");
        dist.sample(rng)
    }
    pub fn mean(&self) -> f64 {
        self.alpha / (self.alpha + self.beta)
    }
}
```
### Router Trait
```rust
#[async_trait::async_trait]
pub trait CognitiveRouter: Send + Sync {
    async fn request_bids(&self, context: RoutingContext) -> anyhow::Result<Vec<WorkerBid>>;
    async fn score_bids(
        &self,
        context: RoutingContext,
        bids: Vec<WorkerBid>,
    ) -> anyhow::Result<Vec<ScoredBid>>;
    async fn select_bid(
        &self,
        context: RoutingContext,
        scored: Vec<ScoredBid>,
    ) -> anyhow::Result<RouteDecision>;
    async fn record_outcome(
        &self,
        decision_id: Uuid,
        outcome: RoutingOutcome,
    ) -> anyhow::Result<()>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingOutcome {
    pub success: bool,
    pub completed: bool,
    pub accepted_by_quorum: bool,
    pub latency_ms: u64,
    pub actual_cost_usd: Option<f64>,
    pub failure_class: Option<FailureClass>,
    pub quality_score: Option<f64>,
}
```
### Utility Function
Pick the bid maximizing:
```text
sampled_success
- normalized_cost * cost_weight
- risk_penalty
- latency_penalty
+ capability_bonus
+ reputation_bonus
```
The router should not let workers self-report success probability as truth. `WorkerBid.success_likelihood` is a signal; Thompson posterior is the learned term.
```rust
pub fn expected_utility(
    sampled_success: f64,
    bid: &WorkerBid,
    policy: &PolicyEnvelope,
    reputation: f64,
) -> f64 {
    let cost_penalty = bid.estimated_cost.usd.unwrap_or(0.0) * policy.budget.cost_weight;
    let latency_penalty = (bid.estimated_latency_ms as f64 / 60_000.0) * policy.budget.latency_weight;
    let risk_penalty = if bid.risk_acceptance.sandbox_required { 0.02 } else { 0.08 };
    sampled_success
        + reputation * 0.10
        + bid.capability_match * 0.08
        - cost_penalty
        - latency_penalty
        - risk_penalty
}
```
### Router DB Tables
```sql
CREATE TABLE IF NOT EXISTS worker_reputation (
    worker_id TEXT NOT NULL,
    context_key TEXT NOT NULL,
    alpha REAL NOT NULL DEFAULT 2.0,
    beta REAL NOT NULL DEFAULT 2.0,
    observations INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    quality_sum REAL NOT NULL DEFAULT 0.0,
    latency_ms_sum INTEGER NOT NULL DEFAULT 0,
    cost_usd_sum REAL NOT NULL DEFAULT 0.0,
    last_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(worker_id, context_key)
);
CREATE TABLE IF NOT EXISTS worker_bids (
    bid_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    role TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    estimated_cost_json TEXT NOT NULL,
    estimated_latency_ms INTEGER NOT NULL,
    success_likelihood REAL NOT NULL,
    uncertainty REAL NOT NULL,
    capability_match REAL NOT NULL,
    risk_acceptance_json TEXT NOT NULL,
    evidence_plan_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worker_bids_step
ON worker_bids(run_id, step_id, status);
CREATE TABLE IF NOT EXISTS route_decisions (
    decision_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    selected_bid_id TEXT,
    strategy TEXT NOT NULL,
    context_key TEXT NOT NULL,
    explanation_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS route_decision_candidates (
    decision_id TEXT NOT NULL,
    bid_id TEXT NOT NULL,
    sampled_success REAL NOT NULL,
    expected_utility REAL NOT NULL,
    posterior_alpha REAL NOT NULL,
    posterior_beta REAL NOT NULL,
    PRIMARY KEY(decision_id, bid_id)
);
```
---
## 4. DAG: Speculative Reactive Execution Graph
### Design Choice
Keep the existing DAG as the committed graph. Add candidate plans and reactive node contracts around it. Speculative branches are not first-class executable truth until accepted by Brain policy.
### Types
In `cortex-engine/src/graph.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactiveStep {
    pub step_id: StepId,
    pub run_id: RunId,
    pub title: String,
    pub task: TaskSpec,
    pub role: WorkerRole,
    pub execution_mode: ExecutionMode,
    pub inputs: Vec<InputContract>,
    pub outputs: Vec<OutputContract>,
    pub invalidation: Vec<InvalidationCondition>,
    pub policy: PolicyEnvelope,
    pub state: StepState,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputContract {
    pub name: String,
    pub source: InputSource,
    pub required: bool,
    pub schema: Option<JsonSchemaRef>,
    pub freshness: FreshnessRequirement,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InputSource {
    StepOutput { step_id: StepId, output_name: String },
    MemoryQuery { query: MemoryQuery },
    Artifact { artifact_id: String },
    HumanInput { prompt: String },
    Constant { value: serde_json::Value },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputContract {
    pub name: String,
    pub kind: StructuredKind,
    pub schema: Option<JsonSchemaRef>,
    pub required_for_success: bool,
    pub consumers: Vec<StepId>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InvalidationCondition {
    InputChanged { input_name: String },
    ArtifactChanged { path_glob: String },
    PolicyChanged { policy_key: String },
    MemoryTraceDecayedBelow { trace_key: String, threshold: f64 },
    UpstreamFailed { step_id: StepId },
    QuorumRejected { evidence_set_id: Uuid },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StepState {
    Draft,
    Blocked,
    Ready,
    Bidding,
    Assigned,
    Running,
    AwaitingApproval,
    Succeeded,
    Failed,
    Invalidated,
    Cancelled,
}
```
### Plan Candidates
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanCandidate {
    pub candidate_id: Uuid,
    pub run_id: RunId,
    pub proposed_by: ProtocolActor,
    pub parent_candidate_id: Option<Uuid>,
    pub base_graph_version: i64,
    pub steps: Vec<ReactiveStep>,
    pub edges: Vec<ReactiveEdge>,
    pub score: PlanScore,
    pub rationale: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactiveEdge {
    pub from: StepId,
    pub to: StepId,
    pub kind: EdgeKind,
    pub condition: EdgeCondition,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeKind {
    SuccessRequired,
    CompletionRequired,
    DataDependency { output_name: String, input_name: String },
    SpeculativeAlternative,
    GuardApproval,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EdgeCondition {
    Always,
    StructuredFieldEquals { path: String, value: serde_json::Value },
    ScoreAtLeast { metric: String, threshold: f64 },
    PolicyAllows { action: String },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanScore {
    pub safety: f64,
    pub cost: f64,
    pub coverage: f64,
    pub latency: f64,
    pub reversibility: f64,
    pub confidence: f64,
    pub total: f64,
}
```
### Scheduler Trait
```rust
#[async_trait::async_trait]
pub trait ReactiveScheduler: Send + Sync {
    async fn load_graph(&self, run_id: RunId) -> anyhow::Result<ExecutionGraph>;
    async fn ready_steps(
        &self,
        graph: &ExecutionGraph,
        memory: &dyn MemoryView,
    ) -> anyhow::Result<Vec<ReactiveStep>>;
    async fn apply_event(
        &self,
        graph: &mut ExecutionGraph,
        event: &CortexEvent,
    ) -> anyhow::Result<GraphDelta>;
    async fn propose_plan(
        &self,
        run_id: RunId,
        goal: GoalSpec,
        constraints: PlanConstraints,
    ) -> anyhow::Result<Vec<PlanCandidate>>;
    async fn accept_plan_candidate(
        &self,
        candidate_id: Uuid,
        actor: ProtocolActor,
    ) -> anyhow::Result<GraphDelta>;
    async fn invalidate(
        &self,
        run_id: RunId,
        cause: InvalidationCause,
    ) -> anyhow::Result<Vec<StepInvalidated>>;
}
```
### DAG DB Additions
```sql
CREATE TABLE IF NOT EXISTS graph_versions (
    run_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    graph_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(run_id, version)
);
CREATE TABLE IF NOT EXISTS reactive_steps (
    step_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    graph_version INTEGER NOT NULL,
    title TEXT NOT NULL,
    task_json TEXT NOT NULL,
    role TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    input_contracts_json TEXT NOT NULL,
    output_contracts_json TEXT NOT NULL,
    invalidation_json TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reactive_edges (
    edge_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    graph_version INTEGER NOT NULL,
    from_step_id TEXT NOT NULL,
    to_step_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    condition_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_candidates (
    candidate_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    proposed_by_type TEXT NOT NULL,
    proposed_by_id TEXT,
    parent_candidate_id TEXT,
    base_graph_version INTEGER NOT NULL,
    score_json TEXT NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plan_candidate_steps (
    candidate_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    step_json TEXT NOT NULL,
    PRIMARY KEY(candidate_id, step_id)
);
CREATE TABLE IF NOT EXISTS plan_candidate_edges (
    candidate_id TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    edge_json TEXT NOT NULL,
    PRIMARY KEY(candidate_id, edge_id)
);
```
---
## 5. Memory: Four Tiers + Stigmergy
### Design Choice
Memory is derived from events. Store raw traces append-only, then maintain queryable projections. Do not pretend SQLite is a vector database at Level 5. Use SQLite FTS5 for first implementation and leave vector embeddings behind a trait.
### Memory Types
In `cortex-memory/src/lib.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MemoryTier {
    Working,
    Episodic,
    Semantic,
    Procedural,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub memory_id: Uuid,
    pub tier: MemoryTier,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub key: String,
    pub content: StructuredPayload,
    pub importance: f64,
    pub confidence: f64,
    pub source_event_id: EventId,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StigmergyTrace {
    pub trace_id: Uuid,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub worker_id: Option<WorkerId>,
    pub trace_type: TraceType,
    pub target: TraceTarget,
    pub signal: f64,
    pub decay: DecaySpec,
    pub content: StructuredPayload,
    pub evidence_refs: Vec<EvidenceRef>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TraceType {
    UsefulPath,
    RiskMarker,
    FailedApproach,
    TestSignal,
    CapabilityHint,
    CostSignal,
    HumanPreference,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TraceTarget {
    TaskKind(TaskKind),
    FilePath(String),
    Capability(CapabilityId),
    Worker(WorkerId),
    Policy(String),
    PlanPattern(String),
    Artifact(String),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecaySpec {
    pub half_life_seconds: u64,
    pub min_signal: f64,
}
```
### Memory Traits
```rust
#[async_trait::async_trait]
pub trait MemoryWriter: Send + Sync {
    async fn write_record(&self, record: NewMemoryRecord) -> anyhow::Result<MemoryRecord>;
    async fn write_trace(&self, trace: StigmergyTrace) -> anyhow::Result<()>;
    async fn promote(&self, memory_id: Uuid, target_tier: MemoryTier) -> anyhow::Result<()>;
}
#[async_trait::async_trait]
pub trait MemoryView: Send + Sync {
    async fn working_set(&self, run_id: RunId) -> anyhow::Result<Vec<MemoryRecord>>;
    async fn query(&self, query: MemoryQuery) -> anyhow::Result<Vec<ScoredMemory>>;
    async fn traces_for_target(
        &self,
        target: TraceTarget,
        now: DateTime<Utc>,
    ) -> anyhow::Result<Vec<DecayedTrace>>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryQuery {
    pub tiers: Vec<MemoryTier>,
    pub text: Option<String>,
    pub structured_filter: Option<serde_json::Value>,
    pub run_id: Option<RunId>,
    pub task_kind: Option<TaskKind>,
    pub limit: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredMemory {
    pub record: MemoryRecord,
    pub score: f64,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecayedTrace {
    pub trace: StigmergyTrace,
    pub current_signal: f64,
}
```
### Memory Tables
```sql
CREATE TABLE IF NOT EXISTS memory_records (
    memory_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    run_id TEXT,
    step_id TEXT,
    key TEXT NOT NULL,
    content_json TEXT NOT NULL,
    importance REAL NOT NULL,
    confidence REAL NOT NULL,
    source_event_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_tier_key
ON memory_records(tier, key);
CREATE INDEX IF NOT EXISTS idx_memory_run
ON memory_records(run_id, tier);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts
USING fts5(memory_id UNINDEXED, key, content_text);
CREATE TABLE IF NOT EXISTS stigmergy_traces (
    trace_id TEXT PRIMARY KEY,
    run_id TEXT,
    step_id TEXT,
    worker_id TEXT,
    trace_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_key TEXT NOT NULL,
    signal REAL NOT NULL,
    half_life_seconds INTEGER NOT NULL,
    min_signal REAL NOT NULL,
    content_json TEXT NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stigmergy_target
ON stigmergy_traces(target_type, target_key, created_at);
CREATE INDEX IF NOT EXISTS idx_stigmergy_run
ON stigmergy_traces(run_id, created_at);
```
### Pressure Optimization
Replace `pressure_for_user` scanning all events with rollups.
```sql
CREATE TABLE IF NOT EXISTS usage_pressure_buckets (
    user_id TEXT NOT NULL,
    bucket_start TEXT NOT NULL,
    bucket_seconds INTEGER NOT NULL,
    provider TEXT,
    model TEXT,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, bucket_start, bucket_seconds, provider, model)
);
CREATE INDEX IF NOT EXISTS idx_pressure_user_bucket
ON usage_pressure_buckets(user_id, bucket_start);
```
Then pressure is computed from recent bucket rows, not all raw `usage_events`.
---
## 6. Workers: Capability Manifests, Roles, Checkpoints
### Design Choice
CLI-wrapped executors cannot truly migrate process state. So checkpoint migration is semantic replay plus artifact snapshots, not live process transfer. The protocol should be honest about this. For Claude/Codex/Gemini subprocesses, checkpoint means:
1. Captured prompt/input context.
2. Captured stdout/stderr transcript.
3. Captured produced artifacts.
4. Captured structured state summary.
5. Optional workspace snapshot hash or tarball reference.
### Manifest Types
In `cortex-core/src/worker.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerManifest {
    pub worker_id: WorkerId,
    pub schema_version: u16,
    pub name: String,
    pub roles: Vec<WorkerRole>,
    pub capabilities: Vec<WorkerCapability>,
    pub executors: Vec<ExecutorDescriptor>,
    pub resource_limits: ResourceLimits,
    pub sandbox: SandboxDescriptor,
    pub checkpoint: CheckpointDescriptor,
    pub mesh: MeshDescriptor,
    pub advertised_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerCapability {
    pub id: CapabilityId,
    pub name: String,
    pub version: String,
    pub task_kinds: Vec<TaskKind>,
    pub input_schemas: Vec<JsonSchemaRef>,
    pub output_schemas: Vec<JsonSchemaRef>,
    pub risk_tiers: Vec<RiskTier>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutorDescriptor {
    pub executor_id: String,
    pub provider: String,
    pub model: Option<String>,
    pub command: Option<String>,
    pub modes: Vec<ExecutionMode>,
    pub deterministic: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointDescriptor {
    pub support: CheckpointSupport,
    pub max_snapshot_bytes: Option<u64>,
    pub restore_modes: Vec<CheckpointRestoreMode>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CheckpointRestoreMode {
    SameWorkerOnly,
    CompatibleExecutor,
    AnyWorkerSemanticReplay,
}
```
### Worker Runtime Traits
```rust
#[async_trait::async_trait]
pub trait Executor: Send + Sync {
    fn descriptor(&self) -> ExecutorDescriptor;
    async fn can_execute(&self, task: &TaskSpec, policy: &PolicyEnvelope) -> anyhow::Result<CapabilityMatch>;
    async fn execute(
        &self,
        assignment: StepAssignment,
        context: StepContext,
        checkpoint: Option<CheckpointRef>,
        sink: Box<dyn ExecutionSink>,
    ) -> anyhow::Result<ExecutionResult>;
    async fn create_checkpoint(
        &self,
        assignment: &StepAssignment,
        state: &ExecutionState,
    ) -> anyhow::Result<CheckpointRef>;
    async fn restore_checkpoint(
        &self,
        checkpoint: CheckpointRef,
    ) -> anyhow::Result<RestoredExecutionState>;
}
#[async_trait::async_trait]
pub trait ExecutionSink: Send + Sync {
    async fn started(&self, event: StepStarted) -> anyhow::Result<()>;
    async fn output(&self, output: StepOutput) -> anyhow::Result<()>;
    async fn checkpoint(&self, checkpoint: CheckpointRef) -> anyhow::Result<()>;
    async fn completed(&self, completed: StepCompleted) -> anyhow::Result<()>;
    async fn failed(&self, failed: StepFailed) -> anyhow::Result<()>;
}
```
### Checkpoint Types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointRef {
    pub checkpoint_id: Uuid,
    pub run_id: RunId,
    pub step_id: StepId,
    pub attempt_id: Uuid,
    pub worker_id: WorkerId,
    pub support: CheckpointSupport,
    pub restore_mode: CheckpointRestoreMode,
    pub artifact_refs: Vec<ArtifactRef>,
    pub transcript_ref: Option<ArtifactRef>,
    pub semantic_state: StructuredPayload,
    pub workspace_snapshot: Option<WorkspaceSnapshotRef>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceSnapshotRef {
    pub snapshot_id: Uuid,
    pub content_hash: String,
    pub storage_uri: String,
    pub byte_len: u64,
    pub file_count: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionState {
    pub prompt_context: serde_json::Value,
    pub transcript: Vec<TranscriptItem>,
    pub partial_outputs: Vec<StructuredPayload>,
    pub touched_files: Vec<String>,
}
```
### Worker Tables
```sql
CREATE TABLE IF NOT EXISTS worker_manifests (
    worker_id TEXT PRIMARY KEY,
    manifest_json TEXT NOT NULL,
    manifest_hash TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS worker_capabilities (
    worker_id TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    task_kinds_json TEXT NOT NULL,
    risk_tiers_json TEXT NOT NULL,
    PRIMARY KEY(worker_id, capability_id)
);
CREATE TABLE IF NOT EXISTS checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    support TEXT NOT NULL,
    restore_mode TEXT NOT NULL,
    semantic_state_json TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    transcript_ref_json TEXT,
    workspace_snapshot_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_step
ON checkpoints(run_id, step_id, created_at);
```
---
## 7. Security: Policy Envelopes and Evidence Quorums
### Design Choice
Policy envelopes compose by specificity and deny-by-default for dangerous actions. Precedence:
```text
system baseline < org < project < run < step < human override
```
But composition is not “last write wins” for everything. Denies accumulate unless an explicit override is signed by a principal with override authority.
### Policy Types
In new `cortex-policy/src/lib.rs` and shared serializable types in `cortex-core/src/policy.rs`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyEnvelope {
    pub policy_id: String,
    pub version: u32,
    pub layer: PolicyLayer,
    pub subject: PolicySubject,
    pub rules: Vec<PolicyRule>,
    pub budget: BudgetPolicy,
    pub quorum: Option<QuorumPolicy>,
    pub provenance: PolicyProvenance,
    pub expires_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PolicyLayer {
    System,
    Org,
    Project,
    Run,
    Step,
    HumanOverride,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicySubject {
    Global,
    User { user_id: String },
    Run { run_id: RunId },
    Step { step_id: StepId },
    Worker { worker_id: WorkerId },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRule {
    pub rule_id: String,
    pub effect: PolicyEffect,
    pub action: PolicyAction,
    pub condition: Option<PolicyCondition>,
    pub overrideable: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyEffect {
    Allow,
    Deny,
    RequireApproval,
    RequireQuorum,
    RequireSandbox,
    RequireEvidence,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyAction {
    ReadFile { path_glob: String },
    WriteFile { path_glob: String },
    ExecuteCommand { command_glob: String },
    NetworkAccess { scope: NetworkScope },
    SpendBudget,
    UseProvider { provider: String },
    DelegateToWorker,
    ModifyDag,
    PromoteLearningCandidate,
    Deploy,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkScope {
    None,
    Loopback,
    Domains(Vec<String>),
    Any,
}
```
### Composition Trait
```rust
pub trait PolicyEngine: Send + Sync {
    fn compose(&self, envelopes: &[PolicyEnvelope]) -> anyhow::Result<EffectivePolicy>;
    fn evaluate(
        &self,
        policy: &EffectivePolicy,
        request: PolicyRequest,
    ) -> anyhow::Result<PolicyDecision>;
    fn required_evidence(
        &self,
        policy: &EffectivePolicy,
        action: &PolicyAction,
    ) -> Vec<EvidenceRequirement>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectivePolicy {
    pub policy_hash: String,
    pub source_policy_ids: Vec<String>,
    pub rules: Vec<PolicyRule>,
    pub budget: BudgetPolicy,
    pub quorum: Option<QuorumPolicy>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRequest {
    pub actor: ProtocolActor,
    pub run_id: Option<RunId>,
    pub step_id: Option<StepId>,
    pub action: PolicyAction,
    pub context: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicyDecision {
    Allow,
    Deny { reasons: Vec<String> },
    RequireApproval { reasons: Vec<String> },
    RequireQuorum { policy: QuorumPolicy },
    RequireSandbox { decision_after_sandbox: Box<PolicyDecision> },
}
```
### Evidence Quorums
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuorumPolicy {
    pub quorum_id: String,
    pub min_accepts: u16,
    pub max_rejects: u16,
    pub required_roles: Vec<WorkerRole>,
    pub independence: IndependenceRequirement,
    pub timeout_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IndependenceRequirement {
    None,
    DistinctWorkers,
    DistinctProviders,
    DistinctModels,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evidence {
    pub evidence_id: Uuid,
    pub run_id: RunId,
    pub step_id: Option<StepId>,
    pub submitted_by: ProtocolActor,
    pub kind: EvidenceKind,
    pub claim: String,
    pub payload: StructuredPayload,
    pub artifact_refs: Vec<ArtifactRef>,
    pub confidence: f64,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvidenceKind {
    TestPassed,
    TestFailed,
    ReviewApproval,
    ReviewRejection,
    StaticAnalysis,
    RuntimeObservation,
    HumanApproval,
    PolicyAttestation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuorumDecision {
    pub quorum_id: String,
    pub run_id: RunId,
    pub step_id: Option<StepId>,
    pub accepted: bool,
    pub evidence_ids: Vec<Uuid>,
    pub reasons: Vec<String>,
    pub decided_at: DateTime<Utc>,
}
```
### Security Tables
```sql
CREATE TABLE IF NOT EXISTS policy_envelopes (
    policy_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    layer TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT,
    envelope_json TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    PRIMARY KEY(policy_id, version)
);
CREATE INDEX IF NOT EXISTS idx_policy_subject
ON policy_envelopes(subject_type, subject_id, active);
CREATE TABLE IF NOT EXISTS effective_policies (
    policy_hash TEXT PRIMARY KEY,
    source_policy_ids_json TEXT NOT NULL,
    effective_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS evidence (
    evidence_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    submitted_by_type TEXT NOT NULL,
    submitted_by_id TEXT,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quorum_decisions (
    quorum_decision_id TEXT PRIMARY KEY,
    quorum_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT,
    accepted INTEGER NOT NULL,
    evidence_ids_json TEXT NOT NULL,
    reasons_json TEXT NOT NULL,
    decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
---
## 8. Mission Control: Interactive Operational Theater
### Design Choice
Mission Control should consume the same event stream as everything else. Time scrub is replay from `events`. Interactive actions append command events, then command handlers mutate projections.
### Mission Control Types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MissionControlCommand {
    ApproveTask(ApproveTask),
    RejectTask(RejectTask),
    PauseRun(PauseRun),
    ResumeRun(ResumeRun),
    RedirectStep(RedirectStep),
    InjectStep(InjectStep),
    AdjustPolicy(ApplyPolicyEnvelope),
    ForceQuorumDecision(QuorumDecision),
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionControlView {
    pub run_id: RunId,
    pub as_of_sequence: i64,
    pub run_state: RunState,
    pub graph: ExecutionGraphView,
    pub workers: Vec<WorkerStatusView>,
    pub route_decisions: Vec<RouteDecisionView>,
    pub evidence_sets: Vec<EvidenceSetView>,
    pub memory_traces: Vec<DecayedTrace>,
    pub pending_approvals: Vec<ApprovalRequestView>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeScrubRequest {
    pub run_id: RunId,
    pub as_of_sequence: i64,
}
```
### Mission Control DB
Most data is from events, but pending commands need durable tracking:
```sql
CREATE TABLE IF NOT EXISTS mission_control_commands (
    command_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    run_id TEXT,
    command_type TEXT NOT NULL,
    command_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_event_id TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
    approval_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_id TEXT,
    requested_by_event_id TEXT NOT NULL,
    approval_type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    context_json TEXT NOT NULL,
    status TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_reason TEXT
);
```
This finally makes `AwaitingApproval`, `Approved`, and `Rejected` real.
---
## 9. Learning Loop: Gated Self-Improvement Factory
### Design Choice
Learning candidates are not auto-promoted into production behavior. They are artifacts with benchmark results and canary gates. The first implementation should improve router priors, decomposition prompts/templates, and policy hints. Do not let it rewrite core scheduler logic automatically.
### Types
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceCapture {
    pub capture_id: Uuid,
    pub run_id: RunId,
    pub event_range: EventRange,
    pub failure_class: Option<FailureClass>,
    pub summary: StructuredPayload,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FailureClass {
    ToolFailure,
    BadPlan,
    BadRouting,
    PolicyBlocked,
    BudgetExceeded,
    Timeout,
    InvalidOutput,
    TestFailure,
    HumanRejected,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LearningCandidate {
    pub candidate_id: Uuid,
    pub kind: LearningCandidateKind,
    pub source_capture_ids: Vec<Uuid>,
    pub proposed_change: StructuredPayload,
    pub risk_tier: RiskTier,
    pub status: LearningStatus,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LearningCandidateKind {
    RouterPriorAdjustment,
    WorkerCapabilityUpdate,
    DecompositionTemplate,
    PolicyRuleSuggestion,
    ProceduralMemory,
    BenchmarkCase,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LearningStatus {
    Draft,
    Benchmarking,
    Canary,
    Promoted,
    RolledBack,
    Rejected,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub result_id: Uuid,
    pub candidate_id: Uuid,
    pub benchmark_suite: String,
    pub passed: bool,
    pub metrics: serde_json::Value,
    pub created_at: DateTime<Utc>,
}
```
### Learning Trait
```rust
#[async_trait::async_trait]
pub trait LearningLoop: Send + Sync {
    async fn capture_trace(&self, run_id: RunId, range: EventRange) -> anyhow::Result<TraceCapture>;
    async fn classify_failure(&self, capture: &TraceCapture) -> anyhow::Result<Option<FailureClass>>;
    async fn generate_candidates(
        &self,
        capture: &TraceCapture,
    ) -> anyhow::Result<Vec<LearningCandidate>>;
    async fn benchmark(&self, candidate_id: Uuid) -> anyhow::Result<BenchmarkResult>;
    async fn start_canary(&self, candidate_id: Uuid, policy: CanaryPolicy) -> anyhow::Result<()>;
    async fn promote(&self, candidate_id: Uuid, evidence: Vec<Evidence>) -> anyhow::Result<LearningPromotion>;
    async fn rollback(&self, candidate_id: Uuid, reason: String) -> anyhow::Result<()>;
}
```
### Learning Tables
```sql
CREATE TABLE IF NOT EXISTS trace_captures (
    capture_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    from_sequence INTEGER NOT NULL,
    to_sequence INTEGER NOT NULL,
    failure_class TEXT,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS learning_candidates (
    candidate_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    source_capture_ids_json TEXT NOT NULL,
    proposed_change_json TEXT NOT NULL,
    risk_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS benchmark_results (
    result_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    benchmark_suite TEXT NOT NULL,
    passed INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS canary_runs (
    canary_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    rollback_reason TEXT
);
CREATE TABLE IF NOT EXISTS learning_promotions (
    promotion_id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    promoted_by TEXT NOT NULL,
    evidence_ids_json TEXT NOT NULL,
    promoted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
---
## 10. Crate Boundary Changes
### `cortex-core`
Keep:
```text
types
protocol
events
policy data types
worker manifests
artifacts
task specs
structured payloads
```
Do not put SQLite, axum, subprocess, or routing algorithms here.
### `cortex-engine`
Owns:
```text
reactive graph
decomposer
scheduler
plan candidate scoring
invalidation
graph projections
```
Depends on `cortex-core`, `cortex-memory` traits, and `cortex-policy` traits.
### `cortex-api`
Owns:
```text
HTTP routes
WebSocket brain server
Mission Control
SQLite implementation of EventStore
SQLite projections
auth
admin commands
```
Depends on all domain crates.
### `cortex-worker`
Owns:
```text
worker process
manifest loader
CLI executors
checkpoint writer/restorer
mesh client
Brain WS client
```
Depends on `cortex-core` and maybe `cortex-policy` for local preflight checks.
### New `cortex-router`
Owns:
```text
bid collection
Thompson sampling
routing outcomes
reputation projection
```
### New `cortex-memory`
Owns:
```text
memory traits
event replay projections
stigmergy decay
FTS query implementation abstraction
```
### New `cortex-policy`
Owns:
```text
policy composition
policy evaluation
quorum evaluation
manifest precedence validation
```
---
## 11. Migration Path From Level 1 to Level 5
### Phase 0: Compatibility Foundation
Add new types behind protocol schema version `2`, but keep accepting current message shapes. Current `BrainMessage::ExecuteStep` and `WorkerMessage::StepCompleted` continue to work.
Add `events` table and start dual-writing:
```text
runs insert -> RunCreated event
steps insert -> StepCreated event
step attempt start -> StepStarted event
completion -> StepCompleted event
failure -> StepFailed event
```
No behavior changes yet.
### Phase 1: Structured Output and Event Replay
Start populating `StepOutput.structured` for known executor outputs:
```text
test result
file edits
usage
summary
review finding
```
Add Mission Control time scrub by replaying `events` into a read model. Existing UI keeps current stream.
### Phase 2: Worker Manifests
Workers send `ManifestAdvertised` on connect. Brain stores `worker_manifests` and `worker_capabilities`.
Current workers can advertise a minimal manifest:
```rust
WorkerManifest {
    roles: vec![WorkerRole::Generalist],
    checkpoint: CheckpointDescriptor {
        support: CheckpointSupport::SemanticState,
        restore_modes: vec![CheckpointRestoreMode::AnyWorkerSemanticReplay],
        max_snapshot_bytes: None,
    },
    // ...
}
```
No bidding yet. Brain still assigns as before.
### Phase 3: Router Shadow Mode
Implement `cortex-router`, `worker_bids`, and `route_decisions`.
Initially, Brain asks for bids but does not use them for assignment. It records what would have been selected and compares to actual outcomes.
This protects production behavior while building posterior data.
### Phase 4: Router Active for Low-Risk Steps
Enable market routing only when:
```text
risk_tier = Low
execution_mode != AgenticUntrusted
policy does not require approval
at least 2 compatible workers or known fallback
```
Fallback to Level 1 evaluator if no valid bids arrive before deadline.
### Phase 5: Reactive Graph Contracts
Add `reactive_steps` and `reactive_edges` as projections alongside existing `steps` and `step_edges`.
Existing decomposer fills default contracts:
```text
inputs = predecessor summaries
outputs = generic summary
invalidation = upstream failed/input changed
```
Scheduler still operates mostly as today but reads readiness from contracts.
### Phase 6: Plan Candidates and Worker Step Proposals
Allow workers to send `ProposedStep` and `ProposedPlan`, but require Brain acceptance. Accepted proposals are inserted into the committed graph and mirrored into old `steps`/`step_edges` tables.
This avoids breaking old run views.
### Phase 7: Policy Envelopes and Quorums
Start with passive policy logging, then enforce:
```text
write scope
network scope
budget
dangerous commands
deploy actions
```
Enable `AwaitingApproval`, `Approved`, and `Rejected` states only where policy demands it.
### Phase 8: Checkpoints
Implement semantic checkpoints for CLI executors. Do not claim live process migration. If a worker dies:
```text
Brain requests latest checkpoint
Brain reopens bidding with checkpoint ref
new worker resumes from semantic state and artifacts
```
This is sufficient for agentic CLI execution.
### Phase 9: Memory and Stigmergy
Write working and episodic memory from events first. Then add semantic/procedural promotion through the gated learning loop.
Use stigmergy traces to inform:
```text
routing context
decomposer choices
risk classification
review/test focus
```
### Phase 10: Learning Loop
Start with benchmark-case generation and router prior adjustment. Human or policy quorum required for promotion.
Do not let learning modify core scheduler code automatically.
---
## Hard Challenges to the Vision Doc
The “agent-to-agent mesh” should be constrained. If worker mesh messages can mutate truth, the system becomes impossible to audit. The Brain must remain the only committer of graph, policy, memory, and outcome events.
“Checkpoint migration” for CLI-wrapped Claude/Codex/Gemini cannot mean process migration. It should mean semantic replay and artifact restoration. Anything stronger requires owning the executor runtime.
“BFT-inspired acceptance quorums” should not be framed as Byzantine fault tolerance unless workers have independent trust roots and adversarial assumptions are formalized. The implementation should call this evidence quorum, with independence constraints.
“Event-sourced institutional memory” should not immediately replace CRUD tables. The safe architecture is event spine plus projections. Full event-sourced write models can come later if needed.
The highest-leverage first slice is:
1. Add event spine.
2. Add protocol envelope.
3. Add worker manifests.
4. Add router shadow mode.
5. Add structured outputs.
That path creates Level 5 foundations without destabilizing the current scheduler.
