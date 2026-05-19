# Cortex Team Architecture — Merged Consensus

> Synthesized from 2 rounds of GPT-5.5 vs Opus 4.7 dual-brain architecture debate.
> Sources: team-gpt55-round1.md, team-opus-round2.md, team-gpt55-round2.md, plus routing intelligence discussion.
> 
> Key principle from GPT-5.5 Round 2: "The question is not 'can we make the model smaller?' 
> It is 'which distinctions are operationally necessary before damage occurs?'"
> Ship simple visible v1 backed by extensible, policy-aware primitives.

## Design Philosophy

**GPT-5.5's framing, Opus's shipping discipline.**

Cortex treats collaboration as a **scheduler problem first**, a chat problem second, and an agent execution problem third. The Brain is not "a bot in a room" — it is a repo-aware, org-aware work coordinator that maintains explicit state.

Five durable primitives. Everything else is projection:

| Primitive | What it is | What projects from it |
|-----------|-----------|----------------------|
| **Goal** | A user's requested outcome | Chat threads, cards, status |
| **Step** | A planned unit of work in a DAG | Worker tasks, progress bars |
| **Lease** | A soft claim over a resource | Conflict detection, overlap warnings |
| **Artifact** | A typed output consumable by others | Cross-repo context, dependency gates |
| **Evidence** | A verifiable completion record | Quality gates, approval flows |

Build the full schema from day one. Implement only the simple paths for v1. The schema supports the 18-month vision; the code ships the 6-week reality.

---

## Problem 1: Concurrent Goal Arbitration

### Architecture

The arbitration pipeline:

```
Goal Intake → Normalization → Impact Prediction → Active Work Comparison
→ Conflict Classification → Scheduling Decision → Notification → Dispatch
→ Ongoing Reconciliation (actual diffs update predictions)
```

### Conflict Detection (2 layers v1, extensible to 4)

| Layer | v1 | v2+ | Description |
|-------|-----|-----|-------------|
| Path overlap | ✅ | ✅ | Compare predicted file paths using path trie |
| Branch/diff overlap | ✅ | ✅ | Compare actual git diffs after work starts |
| Contract overlap | — | ✅ | API/schema/auth policy changes affect dependents |
| Symbol overlap | — | v3 | AST/tree-sitter based, only if path overlap proves insufficient |

Domain overlap and supersession detection are heuristics layered on path overlap, not separate detection layers.

**Critical design constraint (from GPT-5.5 R2):** Store conflicts in an extensible evidence graph, not a flat "path + diff" record. The v1 code runs 2 detectors, but the conflict data model must accept evidence from any detector type without schema changes. This prevents trapping the system in a model that fails when richer detection ships.

### Impact Levels (4)

```rust
enum Impact {
    Read,           // won't modify
    Edit,           // may modify, can merge
    Exclusive,      // needs sole access
    ContractChange, // public API surface change
}
```

Risk classifications (`SecuritySensitive`, `Migration`) live on the Goal's risk metadata, not in impact prediction.

### Conflict Severity (5 ordinal levels)

```rust
enum ConflictSeverity {
    None,       // no overlap detected → run
    Parallel,   // overlap exists but merge-safe → run with warning
    Constrain,  // requires sequencing or coordination → constrain
    Queue,      // must wait for other goal → queue behind
    Block,      // mutually exclusive → human decides
}
```

### Lease Model (v1: path-only)

```rust
struct FileLease {
    id: LeaseId,
    goal_id: GoalId,
    path_glob: String,
    mode: LeaseMode,          // Read | Edit | Exclusive
    confidence: f32,
    acquired_at: DateTime<Utc>,
    expires_at: DateTime<Utc>, // auto-release on timeout
    worker_id: Option<WorkerId>,
}

enum LeaseMode {
    Read,
    Edit,
    Exclusive,
}
```

v2 adds Symbol and Contract lease resources when AST infrastructure exists.

### Supersession Detection (from GPT-5.5)

When a broader goal structurally replaces the area of a narrower goal:
- Brain detects via path containment + goal scope comparison
- Narrow goal becomes `PossiblySuperseded`
- Human decides: fold, finish narrow first, keep both, or cancel
- Brain never auto-cancels — always asks

### Scheduling Decisions

```rust
enum ArbitrationAction {
    Run,
    RunWithWarning,
    RunConstrained { lease_constraints: Vec<FileLease> },
    QueueBehind { blocker: GoalId },
    RequireTeamDecision,
    FoldIntoGoal { target_goal: GoalId },  // supersession
}
```

### No Merge Train

GitHub already has merge queues. Cortex tracks branch state and surfaces conflicts but does not reimplement CI/CD. Brain maintains awareness of PR state, mergeability, and CI status via GitHub webhooks.

### Key Types

```rust
struct GoalIntent {
    id: GoalId,
    org_id: OrgId,
    repo_id: RepoId,
    submitted_by: UserId,
    title: String,
    raw_prompt: String,
    normalized_summary: String,
    priority: GoalPriority,
    risk: RiskLevel,
    status: GoalStatus,
    created_at: DateTime<Utc>,
}

enum GoalPriority {
    Normal,
    Urgent { reason: String, expires_at: Option<DateTime<Utc>> },
}

enum GoalStatus {
    Draft,
    Planning,
    WaitingForArbitration,
    Runnable,
    Running,
    WaitingForHuman,
    WaitingForDependency,
    PossiblySuperseded,
    Completed,
    Cancelled,
    Failed,
}

struct PredictedImpact {
    goal_id: GoalId,
    paths: Vec<PathImpact>,
    confidence: f32,
    generated_at: DateTime<Utc>,
}

struct PathImpact {
    path_glob: String,
    impact: Impact,
    confidence: f32,
}

struct Conflict {
    id: ConflictId,
    repo_id: RepoId,
    goals: Vec<GoalId>,
    severity: ConflictSeverity,
    reasons: Vec<ConflictReason>,
    recommendation: ArbitrationAction,
    status: ConflictStatus,
}

enum ConflictReason {
    PathOverlap { path: String },
    BranchConflict { paths: Vec<String> },
    SupersessionCandidate { broader: GoalId, narrower: GoalId },
}

enum ConflictStatus {
    Open,
    AutoResolved,
    WaitingForDecision,
    DecisionApplied,
    Obsolete,
}
```

---

## Problem 2: Cross-Repo Orchestration

### Architecture

A `GlobalGoal` owns a typed DAG of steps. Steps can be repo-local or cross-repo. Dependencies are explicit edges in the DAG.

```
User: "Update auth across API, web, and mobile"
  → GlobalGoal
    → Step: API design new auth contract (RepoStep)
    → Step: API publish contract artifact (CrossRepoContract)
    → Step: Web consume contract + update (RepoStep, depends on artifact)
    → Step: Mobile consume contract + update (RepoStep, depends on artifact)
    → Step: Human approval gate (HumanGate)
```

### Step Types (3)

```rust
enum StepKind {
    Repo { repo_id: RepoId, summary: String },
    CrossRepoContract { producer_repo: RepoId, consumer_repos: Vec<RepoId>, artifact_kind: String },
    HumanGate { approvers: Vec<UserId>, description: String },
}

struct GlobalStep {
    id: StepId,
    global_goal_id: GlobalGoalId,
    kind: StepKind,
    depends_on: Vec<StepDependency>,
    status: StepStatus,
}

enum StepDependency {
    Step(StepId),
    Artifact { artifact_id: ArtifactId, min_version: u32 },
    HumanDecision(DecisionId),
    PullRequestGreen { repo_id: RepoId, pr_number: u64 },
}

enum StepStatus {
    Planned,
    Runnable,
    Running,
    WaitingForArtifact,
    WaitingForHuman,
    Passed,
    Failed,
    Skipped,
    Cancelled,
}
```

### BranchSet (from GPT-5.5)

Correlates branches across repos for a single global goal:

```rust
struct BranchSet {
    id: BranchSetId,
    global_goal_id: GlobalGoalId,
    branches: Vec<RepoBranch>,
    release_policy: ReleasePolicy,
}

struct RepoBranch {
    repo_id: RepoId,
    goal_id: GoalId,
    branch_name: String,
    base_branch: String,
    base_sha: String,
    head_sha: Option<String>,
    pr_url: Option<String>,
    status: BranchStatus,
}

enum BranchStatus {
    Planned, Created, Active, PrOpen,
    CiPassing, ReviewApproved, Mergeable, Merged,
    Failed, Reverted,
}
```

### Artifacts (freeform with runtime validation)

```rust
struct Artifact {
    id: ArtifactId,
    global_goal_id: GlobalGoalId,
    produced_by: StepId,
    producer_repo: RepoId,
    kind: String,                    // "api_contract", "migration_plan", etc.
    version: u32,
    content: serde_json::Value,      // validated by kind-specific validators
    summary: String,
    immutable: bool,                 // true after producing step completes
    created_at: DateTime<Utc>,
}
```

Register validators per kind at runtime. New artifact types don't require code changes.

### Release Policy (v1: one policy)

```rust
enum ReleasePolicy {
    AtomicPreferred,  // don't merge any until all green (v1 default)
    // v2: CompatibilityFirst, ManualPartialAllowed, Emergency
}
```

### Partial Failure (v2)

When one repo merges but another fails: `GlobalGoal` enters `PartiallyMerged`. Compensation steps (revert, feature flag, compatibility shim) are `RepoStep`s with `is_compensation: true` metadata. Deferred until cross-repo ships.

### GlobalGoal Types

```rust
struct GlobalGoal {
    id: GlobalGoalId,
    org_id: OrgId,
    submitted_by: UserId,
    title: String,
    raw_prompt: String,
    status: GlobalGoalStatus,
    repo_goals: Vec<GoalId>,
    release_policy: ReleasePolicy,
    created_at: DateTime<Utc>,
}

enum GlobalGoalStatus {
    Planning,
    Running,
    WaitingForCrossRepoDependency,
    WaitingForReleaseGate,
    PartiallyMerged,  // v2
    Completed,
    Failed,
    Cancelled,
}
```

---

## Problem 3: Team Chat Without Hardlocks

### Architecture

The chat model is **threaded conversations tied to goals**, not flat chat.

- Each goal gets its own thread
- Conflicts get coordination threads linking affected goals
- Thread state IS goal state projection
- Brain questions are decision-targeted (scoped to specific user + goal)
- A question blocking Dev A does NOT block Dev B's unrelated work

### Thread Types (3)

```rust
enum ThreadKind {
    Goal { goal_id: GoalId },
    Conflict { conflict_id: ConflictId },
    Review { pr_url: String },
}

struct Thread {
    id: ThreadId,
    org_id: OrgId,
    repo_id: Option<RepoId>,
    kind: ThreadKind,
    title: String,
    status: ThreadStatus,
    created_by: UserId,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

enum ThreadStatus {
    Active,
    WaitingForHuman,
    WaitingForDependency,
    Resolved,
    Collapsed,
    Archived,
}
```

### Decision-Targeted Questions (from GPT-5.5)

```rust
struct BrainQuestion {
    id: DecisionId,
    thread_id: ThreadId,
    goal_id: GoalId,
    requested_user: Option<UserId>,  // None = any team member can answer
    question: String,
    options: Option<Vec<String>>,     // structured choices when applicable
    status: QuestionStatus,
    created_at: DateTime<Utc>,
}

enum QuestionStatus {
    Pending,
    Answered { by: UserId, answer: String },
    TimedOut,
    Skipped,
}
```

**Scoped blocking (refined from GPT-5.5 R2):** Questions block at the STEP level, not the Brain level. Brain continues planning, executing independent work, and refining alternatives. But the unsafe action must not proceed until the gate resolves. A question can block a step, a lease, a release, or a contract edge. Deadlocks are avoided through timeouts, escalation, and fallback plans — not by making all questions non-blocking.

- Low-risk questions: non-blocking, Brain auto-decides after timeout
- Medium-risk questions: blocks the specific step, other goals continue  
- High-risk/destructive questions: blocks the step AND any dependent steps, requires explicit human answer — never auto-skip

### Thread Lifecycle (tied to goal)

```
Active → Running → PR Open → Evidence Complete → Approved → Merged → Archived
```

Thread state is a projection of goal state. No separate state machine to sync.

### Messages

```rust
struct ThreadMessage {
    id: MessageId,
    thread_id: ThreadId,
    author: MessageAuthor,
    body: String,
    kind: MessageKind,
    created_at: DateTime<Utc>,
}

enum MessageAuthor {
    User(UserId),
    Brain,
    Worker(WorkerId),
    System,
}

enum MessageKind {
    UserText,
    BrainQuestion { decision_id: DecisionId },
    Decision { decision_id: DecisionId },
    StatusUpdate,
    ConflictNotice,
    EvidenceUpdate,
}
```

### Decisions

```rust
struct DecisionRecord {
    id: DecisionId,
    thread_id: ThreadId,
    goal_id: GoalId,
    decided_by: UserId,
    decision_type: String,
    decision_value: String,
    rationale: Option<String>,
    created_at: DateTime<Utc>,
}
```

### No Presence System (v1-v2)

Message activity is sufficient signal for small teams. Brain knows who's active based on who's sending messages. Presence (WebSocket heartbeats, online/away status) adds infrastructure complexity not justified until team size warrants it.

### Compaction (early v2, not deferred)

GPT-5.5 R2 argues compaction is orchestration correctness, not UX polish. AI agents waste context re-reading stale discussion. Without compaction, agents either drop important context or carry too much irrelevant context — both cause mistakes. This is memory hygiene, not social feature.

When implemented:
- Compact old messages into durable summaries
- Pin decisions that affect future work
- Mark superseded decisions explicitly
- Keep linked artifacts and conflict references
- Stale-state marking prevents agents from citing outdated information

---

## Evidence-Based Completion

A goal is complete only when all required evidence exists:

```rust
struct CompletionEvidence {
    goal_id: GoalId,
    tests_passed: bool,
    pr_open: bool,
    no_active_conflicts: bool,
    human_approved: bool,
    status: CompletionStatus,
}

enum CompletionStatus {
    Incomplete,
    EvidenceReady,
    AwaitingApproval,
    Approved,
    Completed,
    Rejected,
}
```

The worker cannot mark done. It can only submit evidence. The Brain evaluates evidence against completion criteria.

---

## Frontend Orchestration Map

### Hierarchical Composition (from Opus)

Three scopes, bottom-up:

```
Goal DAGs → Repo active work map → Org command map
```

Each scope is a separate projection. Backend sends only what's relevant for the current view.

### Types

```rust
struct OrchestrationMap {
    scope: MapScope,
    nodes: Vec<MapNode>,
    edges: Vec<MapEdge>,
    generated_at: DateTime<Utc>,
}

enum MapScope {
    Org { org_id: OrgId },
    Repo { repo_id: RepoId },
    Goal { goal_id: GoalId },
    GlobalGoal { global_goal_id: GlobalGoalId },
}

struct MapNode {
    id: String,
    node_type: MapNodeType,
    label: String,
    status: MapNodeStatus,
    goal_id: Option<GoalId>,
    repo_id: Option<RepoId>,
    progress: Option<f32>,
    metadata: serde_json::Value,
}

enum MapNodeType {
    Repo,
    Goal,
    Step,
    Worker,
    Conflict,
    Artifact,     // diamond-shaped in UI
    HumanGate,    // interactive approval node
}

enum MapNodeStatus {
    Idle, Planned, Running, Waiting,
    Blocked, Conflict, Passed, Failed, Done,
}

struct MapEdge {
    from: String,
    to: String,
    edge_type: MapEdgeType,
    status: MapEdgeStatus,
}

enum MapEdgeType {
    Dependency,
    Owns,
    ConflictsWith,
    Blocks,
}

enum MapEdgeStatus {
    Active, Waiting, Blocked, Resolved,
}
```

### Live Updates (SSE from GPT-5.5)

```rust
enum MapEvent {
    NodeAdded(MapNode),
    NodeUpdated(MapNode),
    NodeRemoved { id: String },
    EdgeAdded(MapEdge),
    EdgeUpdated(MapEdge),
    EdgeRemoved { id: String },
}
```

Frontend behavior:
- Org map groups by repo
- Repo map groups by goal and conflict
- Goal map shows the actual DAG
- Clicking a node opens detail panel
- Conflict edges are red
- Artifacts are diamond-shaped
- Human gates are interactive approval nodes
- Cross-repo edges shown at org level

---

## GitHub Integration

### Phased Approach

**v1:** GitHub OAuth for identity. User's OAuth token for repo operations (acceptable for solo/small teams). Minimal permission tables from day one: installations, repos, user links, effective access snapshots, token freshness.

**v1.5 (early, before team launch):** GitHub App installation for repo operations. If Cortex creates branches/PRs on behalf of teams, App auth is needed — whose token creates the branch matters for audit trail and token revocation resilience.

**v2:** Full permission inheritance, webhook-driven sync, background reconciliation.

### v1 Types

```rust
struct GitHubIdentity {
    user_id: UserId,
    github_user_id: u64,
    github_login: String,
    access_token_encrypted: String,
    created_at: DateTime<Utc>,
}

struct GitHubOrg {
    org_id: OrgId,
    github_org_id: u64,
    github_login: String,
    connected_by: UserId,
    created_at: DateTime<Utc>,
}

struct GitHubRepo {
    repo_id: RepoId,
    org_id: OrgId,
    github_repo_id: u64,
    owner: String,
    name: String,
    default_branch: String,
    private: bool,
    created_at: DateTime<Utc>,
}

struct GitHubMembership {
    org_id: OrgId,
    user_id: UserId,
    github_role: String,   // admin, member
    synced_at: DateTime<Utc>,
}
```

### Permission Rule

If GitHub says user cannot read repo → Cortex doesn't show repo.
If GitHub says user cannot push → Cortex doesn't dispatch write goals.
If GitHub says user cannot merge → Cortex cannot approve merge.

No Cortex-specific permission system for v1. GitHub IS the permission system.

---

## Routing Intelligence Layer (MISSING — Next Design Round)

Both architects designed structure but not intelligence. The following systems are needed:

### 1. Capability Probing
How Cortex discovers and tracks what each model can do. Periodic micro-benchmarks, outcome tracking, capability profiles that update as models change.

### 2. Strategy Selection
How Cortex picks between "Opus extended thinking" vs "3x Sonnet parallel" vs "Haiku scout → Opus plan → Sonnet execute" for a given task shape.

### 3. Quality Feedback Loop
How evidence-based completion feeds back into routing decisions. Thompson sampling on model+strategy combinations per task shape.

### 4. Model Registry
Live registry tracking: latency, error rates, token costs, rate limit headroom, capability profiles, health signals. Self-updates when models change.

### 5. Self-Calibration
When a new model drops or an existing one degrades: canary routing → compare outcomes → shift traffic automatically. No human config updates needed.

**This layer is the "turbo jet magic dust" — it makes routing intelligent instead of rule-based. Needs its own focused design round.**

---

## Build Sequence

### Phase 1: Single-User Foundation (weeks 1-4)
- Goal, Step, Lease, Artifact, Evidence primitives
- Path-based conflict detection (1 layer)
- Simple arbitration (Run/Queue/Block)
- Goal threads with decision-targeted questions
- Basic orchestration map (repo scope only)
- GitHub OAuth identity

### Phase 2: Team Basics (weeks 5-8)
- Multi-user goal submission
- Conflict detection (2 layers: path + branch/diff)
- Arbitration with supersession detection
- Conflict threads
- Org-level orchestration map
- GitHub org membership sync

### Phase 3: Cross-Repo (weeks 9-12)
- GlobalGoal with typed DAG
- BranchSet for correlated branches
- Artifact system with cross-repo dependencies
- AtomicPreferred release policy
- Cross-repo orchestration map

### Phase 4: Intelligence (weeks 13-16)
- Routing intelligence layer
- Capability probing
- Strategy selection with Thompson sampling
- Quality feedback loop
- Model registry with self-calibration

### Phase 5: Scale (weeks 17-20)
- GitHub App installation
- Permission inheritance
- Contract-level conflict detection
- Release policy options
- Compensation steps for partial failures
- Chat compaction
- Presence system

---

## Resolution Summary (Post Round 2)

| Decision | Source | Rationale |
|----------|--------|-----------|
| 5 durable primitives | GPT-5.5 | Right foundation for all projections |
| Scheduler-first framing | GPT-5.5 | Correct mental model |
| 2 conflict layers (v1) | Opus | Ship fast, extend later |
| Extensible conflict evidence graph | GPT-5.5 R2 | Don't trap system in "path + diff" model |
| 4 impact levels + metadata | Merge | Labels for simplicity, structured metadata for breaking/additive/reversible |
| Named severity from computed dimensions | Merge | Display named, compute from risk vector |
| Path-only leases (v1) | Opus | Infrastructure not ready for more |
| No merge train (v1) | Opus | GitHub handles this; design interface early (GPT-5.5 R2) |
| Supersession detection | GPT-5.5 | Prevents wasted work |
| Typed DAG for cross-repo | GPT-5.5 | Self-documenting, expressive |
| 3 step types + extension | Merge | Core 3, add migration/deploy/flag as needed (GPT-5.5 R2) |
| BranchSet | GPT-5.5 | Essential for cross-repo |
| Freeform artifacts + registered kinds | Merge | Freeform metadata, but policy-bearing kinds must be registered (GPT-5.5 R2) |
| AtomicPreferred + explicit stricter | Merge | Default + ability to mark "atomic-required" for unsafe cross-repo (GPT-5.5 R2) |
| Compensation steps (v2) | GPT-5.5 | Real but deferred |
| 3 thread types + message states | Merge | Keep shell types, add structured decision/question/gate message kinds |
| Decision-targeted questions | GPT-5.5 | Strictly better mechanism |
| Scoped blocking (not "never block") | GPT-5.5 R2 | Step-level blocking for destructive ops; Brain continues independent work |
| Thread lifecycle = goal | GPT-5.5 | Eliminates state sync |
| Compaction (early v2, not deferred) | GPT-5.5 R2 | Orchestration correctness for AI memory, not just UX |
| Assignee/approver state (not full presence) | GPT-5.5 R2 | Not green dots, but ownership + escalation state needed |
| Hierarchical map + typed substrate | Merge | Simple views over rich backend semantics (GPT-5.5 R2) |
| SSE with event discipline | GPT-5.5 R2 | Topics, cursors, replay, auth filtering |
| GitHub App (v1.5, before team launch) | GPT-5.5 R2 | Needed before team features, not deferred to v2 |
| Permission tables from day one | GPT-5.5 R2 | Minimal but present: installations, repos, access snapshots |
| Permission = GitHub | GPT-5.5 | Don't reinvent |
