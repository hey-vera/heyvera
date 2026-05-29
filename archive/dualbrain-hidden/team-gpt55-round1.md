I’ll first verify what is actually in the workspace so the design can line up with any existing docs or code instead of inventing around stale assumptions.
exec
/bin/bash -lc 'git status --short --branch && git remote -v' in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
exec
/bin/bash -lc "pwd && rg --files -g '"'!*node_modules*'"' -g '"'!*.png'"' -g '"'!*.jpg'"' -g '"'!*.jpeg'"' -g '"'!*.gif'"' | head -200" in /home/runner/workspace
 exited 1 in 0ms:
bwrap: Unexpected capabilities but not setuid, old file caps config?
codex
I could not inspect the workspace because the local sandbox command runner failed with `bwrap: Unexpected capabilities but not setuid, old file caps config?`, so this design is grounded in the Cortex context you provided rather than existing repo files.
**Core Position**
Cortex should treat collaboration as a scheduler problem first, a chat problem second, and an agent execution problem third.
The Brain should not be “a bot in a room.” It should be a repo-aware, org-aware work coordinator that maintains explicit state for:
- goals
- predicted file and symbol impact
- branch ownership
- active leases
- conflicts
- dependencies
- evidence
- human decisions
The architecture should be event-sourced at the coordination layer. Every goal, plan, conflict, approval, worker update, test result, PR state change, and merge result should become an append-only event. Current UI state is a projection.
The three layers become:
1. **Org Command Center**
   Org-wide projection of active goals, repos, people, conflicts, approvals, and cross-repo DAGs.
2. **Per-Repo Workspace**
   Repo-scoped goal intake, threaded discussions, scoped orchestration map, branch/worktree state, file ownership, and conflict queue.
3. **Worker Execution**
   Invisible branch-bound executors. Workers never own collaboration state. They report evidence and artifacts back to the Brain.
The hard architectural choice: **Cortex should not use hard file locks as its primary concurrency model.** It should use predictive soft leases, conflict scoring, branch isolation, merge trains, and explicit human arbitration for high-risk overlaps.
---
## Problem 1: Concurrent Goal Arbitration
### 1. Algorithm / Data Flow
Example:
- Dev A: “fix the auth bug”
- Dev B: “rehaul the auth flow”
The Brain must detect likely overlap before dispatch. It cannot wait for git conflicts after workers have burned hours.
The arbitration pipeline:
1. **Goal Intake**
   A user submits a goal in a repo workspace.
2. **Goal Normalization**
   Brain converts free text into a structured `GoalIntent`.
3. **Impact Prediction**
   Brain predicts affected files, symbols, APIs, migrations, config, tests, and ownership domains.
4. **Active Work Comparison**
   Brain compares predicted scope against active goals and active leases.
5. **Conflict Classification**
   Brain assigns conflict type and severity.
6. **Scheduling Decision**
   Brain chooses one of:
   - `Run`
   - `RunWithWarning`
   - `RunWithLeaseConstraints`
   - `QueueBehind`
   - `RequireTeamDecision`
   - `MarkSupersedingCandidate`
7. **User Notification**
   Each affected user sees a specific message in their goal thread. A coordination thread is created for team-level conflicts.
8. **Dispatch**
   Only dispatch safe steps. Risky steps wait for decision or dependency resolution.
9. **Ongoing Reconciliation**
   As workers produce actual diffs, the Brain updates leases and conflict scores.
### Impact Prediction
Before execution, Cortex should build a `PredictedImpactSet`.
Sources:
- repository index
- git history
- code ownership files
- language server / tree-sitter index
- dependency graph
- test map
- prior Cortex goal history
- Brain decomposition
- explicit user hints
- package/module boundaries
- file patterns such as `auth/**`, `middleware/**`, `schema.sql`, `migrations/**`
Prediction should be conservative. It is better to warn early than silently schedule conflicting work.
Impact levels:
- `ReadOnly`
- `LikelyEdit`
- `DefiniteEdit`
- `ExclusiveEdit`
- `DeletesOrReplaces`
- `PublicContractChange`
- `Migration`
- `SecuritySensitive`
The Brain should classify auth, billing, permissions, crypto, deployment, schema, and API contracts as high-risk domains.
For the example:
Dev A:
```text
Goal: fix auth bug
Predicted files:
- src/auth/session.rs: LikelyEdit
- src/auth/middleware.rs: LikelyEdit
- tests/auth/session_expiry.rs: LikelyEdit
Domain:
- auth/session
Risk:
- security-sensitive
```
Dev B:
```text
Goal: rehaul auth flow
Predicted files:
- src/auth/**: ExclusiveEdit
- src/api/auth_routes.rs: LikelyEdit
- web/login/**: LikelyEdit
- migrations/*auth*: PossibleEdit
Domain:
- auth/*
Risk:
- security-sensitive, public-contract-change
```
The overlap is not merely file-level. It is semantic. Dev B’s work can invalidate Dev A’s work.
### Conflict Detection Mechanism
Use layered conflict detection.
**Layer 1: Path overlap**
Compare file paths using a path trie.
```text
src/auth/session.rs overlaps src/auth/**
```
**Layer 2: Symbol overlap**
If both goals touch `AuthSession`, `validate_token`, `login_handler`, or `SessionStore`, they conflict even if files differ.
**Layer 3: Domain overlap**
If both goals touch domain `auth/session`, they conflict even before files are known.
**Layer 4: Contract overlap**
If one goal changes an API, schema, auth behavior, payment behavior, or public interface, any dependent goal conflicts.
**Layer 5: Branch/diff overlap**
After work starts, compare actual git diffs continuously.
**Layer 6: Supersession detection**
If one goal is broader and structurally replaces the area of another goal, mark it as a possible supersession.
Example:
- “fix auth bug” is narrow
- “rehaul auth flow” is broad
- The broader goal may make the narrow fix obsolete
The Brain should not automatically cancel Dev A. It should pause risky dispatch and ask.
### Scheduling Policy
Hard choice:
- **Default:** run both only if overlap is low or manageable.
- **Queue:** when one goal has `ExclusiveEdit` over another’s likely edit.
- **Require team decision:** when security-sensitive or public-contract changes overlap.
- **Parallel branches:** allowed for medium-risk overlap, but only with a merge train and explicit conflict contract.
- **Block dispatch:** only for high-risk exclusive resources.
The scheduler should use conflict severity:
```text
0-20: no conflict, run
21-40: warn, run
41-65: run constrained, require merge train
66-85: queue or require owner decision
86-100: block until decision
```
Auth example likely scores `90`.
Decision:
```text
Dev B's "rehaul auth flow" claims an exclusive lease on auth/*.
Dev A's bug fix overlaps security-sensitive auth/session.
Brain pauses Dev A before worker dispatch or before risky edit.
Brain opens a conflict coordination thread.
Team chooses:
1. fold Dev A's bug fix into Dev B's rehaul
2. finish Dev A first, then rebase Dev B
3. run both and merge Dev A first
4. cancel/supersede Dev A
```
### Merge Handling
If both run on branches:
1. Each goal branch is isolated.
2. Brain maintains a repo merge train.
3. PRs are not considered complete if they conflict with earlier in-flight goals.
4. Brain continuously rebases lower-priority branches onto higher-priority branch heads or target branch snapshots.
5. If rebase fails, Brain creates a `MergeConflict` step.
6. A worker may attempt resolution, but human approval is required for high-risk domains.
Merge train order is determined by:
- explicit priority
- dependency graph
- goal age
- conflict severity
- PR readiness
- branch freshness
- code owner approval requirements
- urgency policy
If Dev B makes Dev A irrelevant:
1. Brain detects semantic supersession.
2. Dev A’s goal becomes `PossiblySuperseded`.
3. Dev A sees:
```text
This goal may be superseded by “Rehaul auth flow.”
The broader goal replaces the auth/session area this fix targets.
Options:
- Fold this bug case into the rehaul acceptance criteria
- Finish this fix first
- Keep both branches active
- Cancel this goal
```
Dev B sees:
```text
Your goal overlaps an active auth bug fix from Dev A.
Cortex recommends adding Dev A's failing case as an acceptance test for this rehaul.
```
Team thread:
```text
Conflict: auth/session overlap
Dev A: fix auth bug
Dev B: rehaul auth flow
Risk: high
Reason: shared auth domain, likely same files, security-sensitive behavior
Recommended decision:
Fold Dev A's bug reproduction into Dev B's rehaul, pause Dev A's implementation branch, and keep Dev A as reviewer.
```
### Scaling to 10+ Devs
At 10+ devs, file-lock thinking breaks. The Brain needs a repo-level scheduler.
Key ideas:
- one scheduler actor per repo
- append-only event log
- path trie for active leases
- symbol index for semantic overlap
- priority queue for runnable steps
- merge train per base branch
- real-time conflict projection
- leases expire or refresh from actual diffs
- high-risk domains require narrower concurrency
The repo scheduler should not ask humans about every overlap. It should auto-resolve low-risk cases and only escalate meaningful conflicts.
---
### 2. Concrete Rust Types
```rust
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;
use chrono::{DateTime, Utc};
pub type OrgId = Uuid;
pub type RepoId = Uuid;
pub type GoalId = Uuid;
pub type StepId = Uuid;
pub type UserId = Uuid;
pub type BranchId = Uuid;
pub type ThreadId = Uuid;
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoalStatus {
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImpactKind {
    ReadOnly,
    LikelyEdit,
    DefiniteEdit,
    ExclusiveEdit,
    DeletesOrReplaces,
    PublicContractChange,
    Migration,
    SecuritySensitive,
}
#[derive(Debug, Clone)]
pub struct GoalIntent {
    pub goal_id: GoalId,
    pub org_id: OrgId,
    pub repo_id: RepoId,
    pub submitted_by: UserId,
    pub title: String,
    pub raw_prompt: String,
    pub normalized_summary: String,
    pub priority: GoalPriority,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum GoalPriority {
    Low,
    Normal,
    High,
    Urgent {
        reason: String,
        expires_at: Option<DateTime<Utc>>,
    },
}
#[derive(Debug, Clone)]
pub struct PredictedImpactSet {
    pub goal_id: GoalId,
    pub repo_id: RepoId,
    pub paths: Vec<PathImpact>,
    pub symbols: Vec<SymbolImpact>,
    pub domains: Vec<DomainImpact>,
    pub contracts: Vec<ContractImpact>,
    pub confidence: f32,
    pub generated_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub struct PathImpact {
    pub path_glob: String,
    pub kind: ImpactKind,
    pub confidence: f32,
}
#[derive(Debug, Clone)]
pub struct SymbolImpact {
    pub language: String,
    pub symbol: String,
    pub file_path: Option<String>,
    pub kind: ImpactKind,
    pub confidence: f32,
}
#[derive(Debug, Clone)]
pub struct DomainImpact {
    pub domain: String,
    pub kind: ImpactKind,
    pub confidence: f32,
}
#[derive(Debug, Clone)]
pub struct ContractImpact {
    pub contract_name: String,
    pub contract_kind: ContractKind,
    pub kind: ImpactKind,
    pub confidence: f32,
}
#[derive(Debug, Clone)]
pub enum ContractKind {
    HttpApi,
    GraphQl,
    DatabaseSchema,
    EventSchema,
    AuthPolicy,
    PermissionModel,
    PaymentFlow,
    CliContract,
    PublicLibraryApi,
}
#[derive(Debug, Clone)]
pub struct WorkLease {
    pub lease_id: Uuid,
    pub org_id: OrgId,
    pub repo_id: RepoId,
    pub goal_id: GoalId,
    pub branch_id: Option<BranchId>,
    pub resource: LeaseResource,
    pub mode: LeaseMode,
    pub confidence: f32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum LeaseResource {
    PathGlob(String),
    Symbol { language: String, symbol: String },
    Domain(String),
    Contract { kind: ContractKind, name: String },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeaseMode {
    SharedRead,
    SoftEdit,
    ExclusiveEdit,
    MergeTrainSlot,
}
#[derive(Debug, Clone)]
pub struct Conflict {
    pub conflict_id: Uuid,
    pub org_id: OrgId,
    pub repo_id: RepoId,
    pub goals: Vec<GoalId>,
    pub severity: ConflictSeverity,
    pub reasons: Vec<ConflictReason>,
    pub recommendation: ArbitrationDecision,
    pub status: ConflictStatus,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum ConflictSeverity {
    None,
    Low,
    Medium,
    High,
    Blocking,
}
#[derive(Debug, Clone)]
pub enum ConflictReason {
    PathOverlap { path: String },
    SymbolOverlap { symbol: String },
    DomainOverlap { domain: String },
    ContractOverlap { contract: String },
    SecuritySensitiveOverlap,
    MigrationOverlap,
    SupersessionCandidate { superseding: GoalId, superseded: GoalId },
    MergeTrainConflict,
}
#[derive(Debug, Clone)]
pub enum ConflictStatus {
    Open,
    AutoResolved,
    WaitingForDecision,
    DecisionApplied,
    Obsolete,
}
#[derive(Debug, Clone)]
pub enum ArbitrationDecision {
    Run,
    RunWithWarning,
    RunWithLeaseConstraints,
    QueueBehind { blocker: GoalId },
    RequireTeamDecision,
    FoldIntoGoal { target_goal: GoalId },
    CancelAsSuperseded { superseded_by: GoalId },
}
```
---
### 3. Database Schema
```sql
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  title TEXT NOT NULL,
  raw_prompt TEXT NOT NULL,
  normalized_summary TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  priority_reason TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE goal_impacts (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  impact_kind TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_goal_impacts_repo_resource
ON goal_impacts(repo_id, resource_type, resource_key);
CREATE TABLE work_leases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  branch_id TEXT,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  lease_mode TEXT NOT NULL,
  confidence REAL NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_work_leases_repo_resource
ON work_leases(repo_id, resource_type, resource_key);
CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE conflict_goals (
  conflict_id TEXT NOT NULL REFERENCES conflicts(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (conflict_id, goal_id)
);
CREATE TABLE conflict_reasons (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id) ON DELETE CASCADE,
  reason_type TEXT NOT NULL,
  resource_type TEXT,
  resource_key TEXT,
  details_json TEXT NOT NULL
);
CREATE TABLE arbitration_decisions (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id),
  decided_by TEXT,
  decision TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE repo_merge_train (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  branch_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
---
### 4. Protocol Messages
```rust
pub enum BrainMessage {
    GoalSubmitted {
        goal: GoalIntent,
    },
    GoalImpactPredicted {
        goal_id: GoalId,
        impact: PredictedImpactSet,
    },
    ConflictDetected {
        conflict: Conflict,
    },
    ArbitrationRequired {
        conflict_id: Uuid,
        options: Vec<ArbitrationDecision>,
        recommended: ArbitrationDecision,
    },
    ArbitrationApplied {
        conflict_id: Uuid,
        decision: ArbitrationDecision,
    },
    LeaseGranted {
        goal_id: GoalId,
        leases: Vec<WorkLease>,
    },
    LeaseDenied {
        goal_id: GoalId,
        conflicts: Vec<Uuid>,
    },
    GoalSupersessionProposed {
        superseding: GoalId,
        superseded: GoalId,
        reason: String,
    },
    MergeTrainUpdated {
        repo_id: RepoId,
        base_branch: String,
        entries: Vec<MergeTrainEntry>,
    },
}
pub enum WorkerMessage {
    WorkerReady {
        worker_id: Uuid,
        repo_id: RepoId,
        branch_name: String,
    },
    ActualImpactObserved {
        goal_id: GoalId,
        step_id: StepId,
        changed_paths: Vec<String>,
        changed_symbols: Vec<String>,
    },
    StepEvidenceProduced {
        goal_id: GoalId,
        step_id: StepId,
        evidence: EvidenceBundle,
    },
    BranchRebaseResult {
        goal_id: GoalId,
        branch_name: String,
        result: RebaseResult,
    },
    MergeConflictObserved {
        goal_id: GoalId,
        paths: Vec<String>,
        details: String,
    },
}
pub struct MergeTrainEntry {
    pub goal_id: GoalId,
    pub branch_name: String,
    pub position: u32,
    pub status: String,
}
pub struct EvidenceBundle {
    pub tests: Vec<TestResult>,
    pub pr_url: Option<String>,
    pub diff_summary: String,
    pub conflicts_with_inflight_work: bool,
}
pub enum RebaseResult {
    Clean,
    Conflict { paths: Vec<String> },
    Failed { reason: String },
}
```
---
### 5. UX Description
Dev A sees, inside their goal thread:
```text
Cortex found an overlap before starting implementation.
Your goal touches auth/session.
Dev B submitted “Rehaul auth flow,” which claims a broader auth/* change.
Status: waiting for arbitration
Recommended: fold your bug reproduction into Dev B's rehaul acceptance tests.
```
Dev B sees:
```text
This goal overlaps an active auth bug fix from Dev A.
Risk: high
Reason: shared auth domain, likely same files, security-sensitive behavior
Cortex recommends absorbing Dev A's bug case into this goal before workers start.
```
Repo workspace gets a conflict card:
```text
Auth conflict
Goals:
- Fix auth bug
- Rehaul auth flow
Recommended action:
Fold bug fix into rehaul, pause narrow implementation, add failing test case to broader goal.
```
The repo orchestration map shows:
- both goals as nodes
- red conflict edge
- shared resources highlighted
- auth files marked as soft/exclusive leases
- worker dispatch paused on risky steps
For 10+ devs, the repo surface must have a conflict queue, not just inline chat messages.
---
### 6. Edge Cases and Failure Modes
**False positive conflicts**
The Brain warns or queues unnecessarily. Mitigation: confidence scores, user override, and fast reclassification after plan refinement.
**False negative conflicts**
Workers collide later. Mitigation: actual diff monitoring, merge train, branch rebase checks, and conflict events.
**Urgent goal abuse**
Urgency should not be a raw override. It should require reason, expiry, and audit trail.
**Long-running exclusive goal blocks repo**
Exclusive leases must be scoped and checkpointed. A broad goal cannot freeze `src/**` indefinitely.
**Worker changes unexpected files**
Actual impact can upgrade conflict severity. Brain may pause the step and ask.
**Supersession disagreement**
The Brain recommends, humans decide. Supersession should never silently cancel someone’s work.
**Merge train starvation**
Old low-priority work can starve. Use age boosts and explicit repo maintainer controls.
---
# Problem 2: Cross-Repo Orchestration
## 1. Algorithm / Data Flow
Example:
> “Update the auth system across the API, the web app, and the mobile app.”
This is not three independent goals. It is one global goal with repo-local subgoals and typed cross-repo dependencies.
The decomposer creates:
```text
GlobalGoal: update auth system
RepoGoal: API / Rust
- design new auth contract
- update server implementation
- publish OpenAPI/auth contract artifact
- add compatibility tests
RepoGoal: Web / Next.js
- consume new auth contract
- update login/session flow
- pass contract tests
RepoGoal: Mobile / Swift
- consume new auth contract
- update token refresh flow
- pass contract tests
Cross-repo dependencies:
- Web depends on API auth contract artifact
- Mobile depends on API auth contract artifact
- API final merge waits for at least one consumer validation, depending on policy
```
The hard choice: **cross-repo context must be artifact-based, not transcript-based.**
Workers should not rely on “the other worker said X in chat.” They should consume typed artifacts:
- API schema
- auth contract manifest
- migration plan
- generated client hints
- test fixture bundle
- environment assumptions
- PR URLs
- diff summaries
- known breaking changes
- compatibility matrix
### Cross-Repo DAG Model
A `GlobalGoal` owns a DAG of `GlobalStep`s.
Step types:
- `RepoStep`
- `CrossRepoContractStep`
- `CrossRepoValidationStep`
- `CoordinationStep`
- `ReleaseGateStep`
- `CompensationStep`
The DAG can contain repo-local steps and cross-repo edges.
Example:
```text
A1 API: inspect current auth flow
A2 API: produce auth contract v2
B1 Web: update client auth service
C1 Mobile: update token refresh
A3 API: implement server changes
B2 Web: run contract tests against API branch preview
C2 Mobile: run contract tests against API branch preview
G1 Global: evidence gate
G2 Global: merge train / release decision
```
Dependencies:
```text
B1 depends on A2 artifact auth-contract-v2
C1 depends on A2 artifact auth-contract-v2
A3 depends on A2
G1 depends on A3, B2, C2
G2 depends on G1 approval
```
### Branch Management Across Repos
Each global goal creates a `BranchSet`.
```text
global goal id: g123
api branch: cortex/g123-auth-system
web branch: cortex/g123-auth-system
mobile branch: cortex/g123-auth-system
```
Branch names should be correlated but repo-local.
The Brain tracks:
- branch creation
- base SHA
- current head SHA
- PR URL
- review state
- CI state
- mergeability
- dependency state
- rollback/compensation plan
### Context Sharing
Use `ContextArtifact`.
An artifact is immutable once published. New info creates a new version.
Artifacts are stored in Cortex and optionally committed into generated files or attached to PR comments.
Examples:
```rust
pub enum ContextArtifactKind {
    ApiContract,
    DatabaseMigrationPlan,
    AuthPolicyManifest,
    TestFixtureBundle,
    DiffSummary,
    GeneratedClientSpec,
    ReleasePlan,
    RollbackPlan,
    HumanDecision,
}
```
Workers request artifacts by dependency.
A Web worker receives:
```text
Inputs:
- auth-contract-v2 artifact from API step A2
- compatibility matrix
- test fixture bundle
- API preview endpoint
- branch metadata
```
It does not receive all API repo chat history unless explicitly needed.
### Partial Failure
What if repo 1 merges but repo 2 fails?
For cross-repo changes, Cortex should default to **coordinated merge gates**.
Preferred policy:
- Open PRs independently.
- Do not merge any breaking repo PR until global release gate passes.
- If partial merge is allowed, it must be protected by feature flags, backward compatibility, or compensation steps.
Policies:
```text
AtomicPreferred:
  Do not merge until all required repos are green.
CompatibilityFirst:
  API merges backward-compatible changes first.
  Consumers merge later.
  Breaking behavior remains disabled behind flag.
ManualPartialAllowed:
  Maintainer can merge subset with explicit risk acceptance.
Emergency:
  Security patch may merge server first with degraded client behavior accepted.
```
If API merged and web/mobile failed:
1. Brain marks global goal `PartiallyMerged`.
2. Creates compensation decision:
   - roll forward consumers
   - revert API
   - disable feature flag
   - ship compatibility shim
3. Org command center shows release risk.
4. Completion is blocked until terminal state is reached.
---
## 2. Concrete Rust Types
```rust
#[derive(Debug, Clone)]
pub struct GlobalGoal {
    pub id: Uuid,
    pub org_id: OrgId,
    pub submitted_by: UserId,
    pub title: String,
    pub raw_prompt: String,
    pub status: GlobalGoalStatus,
    pub repo_goals: Vec<GoalId>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum GlobalGoalStatus {
    Planning,
    Running,
    WaitingForCrossRepoDependency,
    WaitingForReleaseGate,
    PartiallyMerged,
    Completed,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone)]
pub struct GlobalStep {
    pub id: StepId,
    pub global_goal_id: Uuid,
    pub repo_id: Option<RepoId>,
    pub kind: GlobalStepKind,
    pub depends_on: Vec<StepDependency>,
    pub status: StepStatus,
}
#[derive(Debug, Clone)]
pub enum GlobalStepKind {
    RepoStep {
        repo_id: RepoId,
        local_goal_id: GoalId,
        summary: String,
    },
    CrossRepoContractStep {
        producer_repo_id: RepoId,
        artifact_kind: ContextArtifactKind,
        summary: String,
    },
    CrossRepoValidationStep {
        consumer_repo_id: RepoId,
        producer_repo_id: RepoId,
        artifact_id: Uuid,
        validation_kind: ValidationKind,
    },
    CoordinationStep {
        required_decision: String,
    },
    ReleaseGateStep {
        policy: ReleasePolicy,
    },
    CompensationStep {
        reason: String,
    },
}
#[derive(Debug, Clone)]
pub enum StepStatus {
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
#[derive(Debug, Clone)]
pub enum StepDependency {
    Step(StepId),
    Artifact {
        artifact_id: Uuid,
        min_version: u32,
    },
    HumanDecision(Uuid),
    PullRequestGreen {
        repo_id: RepoId,
        pr_number: u64,
    },
}
#[derive(Debug, Clone)]
pub struct BranchSet {
    pub id: Uuid,
    pub global_goal_id: Uuid,
    pub branches: Vec<RepoBranch>,
    pub release_policy: ReleasePolicy,
}
#[derive(Debug, Clone)]
pub struct RepoBranch {
    pub repo_id: RepoId,
    pub goal_id: GoalId,
    pub branch_name: String,
    pub base_branch: String,
    pub base_sha: String,
    pub head_sha: Option<String>,
    pub pr_url: Option<String>,
    pub status: BranchStatus,
}
#[derive(Debug, Clone)]
pub enum BranchStatus {
    Planned,
    Created,
    Active,
    PrOpen,
    CiPassing,
    ReviewApproved,
    Mergeable,
    Merged,
    Failed,
    Reverted,
}
#[derive(Debug, Clone)]
pub enum ReleasePolicy {
    AtomicPreferred,
    CompatibilityFirst,
    ManualPartialAllowed,
    Emergency,
}
#[derive(Debug, Clone)]
pub struct ContextArtifact {
    pub id: Uuid,
    pub global_goal_id: Uuid,
    pub producer_step_id: StepId,
    pub producer_repo_id: RepoId,
    pub kind: ContextArtifactKind,
    pub version: u32,
    pub content_uri: String,
    pub summary: String,
    pub schema_version: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum ContextArtifactKind {
    ApiContract,
    DatabaseMigrationPlan,
    AuthPolicyManifest,
    TestFixtureBundle,
    DiffSummary,
    GeneratedClientSpec,
    ReleasePlan,
    RollbackPlan,
    HumanDecision,
}
#[derive(Debug, Clone)]
pub enum ValidationKind {
    ContractTest,
    IntegrationTest,
    Typecheck,
    ConsumerBuild,
    ManualReview,
}
```
---
## 3. Database Schema
```sql
CREATE TABLE global_goals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  title TEXT NOT NULL,
  raw_prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  release_policy TEXT NOT NULL DEFAULT 'atomic_preferred',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE global_goal_repos (
  global_goal_id TEXT NOT NULL REFERENCES global_goals(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  local_goal_id TEXT NOT NULL REFERENCES goals(id),
  role TEXT NOT NULL,
  PRIMARY KEY (global_goal_id, repo_id)
);
CREATE TABLE global_steps (
  id TEXT PRIMARY KEY,
  global_goal_id TEXT NOT NULL REFERENCES global_goals(id) ON DELETE CASCADE,
  repo_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE global_step_dependencies (
  step_id TEXT NOT NULL REFERENCES global_steps(id) ON DELETE CASCADE,
  depends_on_type TEXT NOT NULL,
  depends_on_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  PRIMARY KEY (step_id, depends_on_type, depends_on_id)
);
CREATE TABLE branch_sets (
  id TEXT PRIMARY KEY,
  global_goal_id TEXT NOT NULL REFERENCES global_goals(id) ON DELETE CASCADE,
  release_policy TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE repo_branches (
  id TEXT PRIMARY KEY,
  branch_set_id TEXT NOT NULL REFERENCES branch_sets(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT,
  pr_url TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE context_artifacts (
  id TEXT PRIMARY KEY,
  global_goal_id TEXT NOT NULL REFERENCES global_goals(id) ON DELETE CASCADE,
  producer_step_id TEXT NOT NULL REFERENCES global_steps(id),
  producer_repo_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_uri TEXT NOT NULL,
  summary TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(global_goal_id, kind, version)
);
CREATE TABLE release_gates (
  id TEXT PRIMARY KEY,
  global_goal_id TEXT NOT NULL REFERENCES global_goals(id),
  policy TEXT NOT NULL,
  status TEXT NOT NULL,
  required_repos_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
---
## 4. Protocol Messages
```rust
pub enum BrainMessage {
    GlobalGoalSubmitted {
        global_goal: GlobalGoal,
    },
    CrossRepoDagPlanned {
        global_goal_id: Uuid,
        steps: Vec<GlobalStep>,
    },
    BranchSetCreated {
        branch_set: BranchSet,
    },
    ContextArtifactPublished {
        artifact: ContextArtifact,
    },
    CrossRepoDependencyReady {
        step_id: StepId,
        artifact_id: Uuid,
    },
    CrossRepoDependencyBlocked {
        step_id: StepId,
        reason: String,
    },
    ReleaseGateOpened {
        global_goal_id: Uuid,
        policy: ReleasePolicy,
    },
    ReleaseGatePassed {
        global_goal_id: Uuid,
    },
    ReleaseGateFailed {
        global_goal_id: Uuid,
        reason: String,
    },
    CompensationRequired {
        global_goal_id: Uuid,
        reason: String,
        options: Vec<String>,
    },
}
pub enum WorkerMessage {
    ArtifactRequested {
        worker_id: Uuid,
        step_id: StepId,
        artifact_kind: ContextArtifactKind,
        min_version: u32,
    },
    ArtifactConsumed {
        worker_id: Uuid,
        step_id: StepId,
        artifact_id: Uuid,
    },
    ArtifactProduced {
        worker_id: Uuid,
        step_id: StepId,
        artifact: ContextArtifact,
    },
    CrossRepoValidationResult {
        step_id: StepId,
        validation_kind: ValidationKind,
        passed: bool,
        details_uri: Option<String>,
    },
}
```
---
## 5. UX Description
Org map:
```text
Global goal: Update auth system
Repos:
- api: implementing auth contract v2
- web: waiting for auth contract artifact
- mobile: waiting for auth contract artifact
Current blocker:
API contract artifact not finalized.
Release policy:
Atomic preferred
```
After API publishes contract:
```text
Auth contract v2 published.
Web and Mobile workers are now runnable.
```
If web passes and mobile fails:
```text
Global release gate blocked.
API: PR green
Web: PR green
Mobile: contract tests failing
Recommended:
Keep API PR unmerged unless auth v2 is backward-compatible behind a feature flag.
```
Map view:
- global goal as parent node
- repo lanes underneath
- cross-repo dependency edges
- artifacts as diamond nodes
- PR states as badges
- release gate as final checkpoint
- failed repo branch shown in red
- compensation path shown if partial merge happens
---
## 6. Edge Cases and Failure Modes
**Repo unavailable**
Mark repo step blocked. Other independent repo steps can continue if they do not depend on it.
**Contract artifact wrong**
Publish a new artifact version. Dependent steps re-evaluate.
**API branch changes after consumers started**
Consumers pin to artifact version. Brain emits `ArtifactSuperseded`; consumers decide whether to rebase onto new contract.
**One repo has stricter review rules**
Release gate waits for that repo. Repo permission and branch protection are inherited from GitHub.
**Partial merge**
Global goal enters `PartiallyMerged`. Evidence-based completion blocks until rollback, roll-forward, or explicit acceptance.
**Cross-repo circular dependency**
The decomposer must reject cycles or insert a design artifact step that breaks the cycle.
---
# Problem 3: Team Chat Model Without Hardlocks
## 1. Algorithm / Data Flow
The correct model is a **task board plus threaded conversation**, not flat chat.
Hard choice:
- One visible repo workspace.
- Every goal has its own thread.
- Conflicts get their own coordination thread.
- Brain questions are targeted to the relevant goal/thread/user.
- Repo-level announcements appear in the repo activity feed.
- Flat chat is only an input surface, not the state model.
### Thread Types
- `GoalThread`
- `ConflictThread`
- `RepoAnnouncementThread`
- `GlobalGoalThread`
- `ReviewThread`
- `IncidentThread`
The Brain maintains separate conversation state per goal. It does not stuff the whole repo chat into every prompt.
Each goal thread has:
- goal summary
- owner/sponsor
- participants
- decisions
- artifacts
- relevant messages
- step state
- conflict links
- PR links
The repo workspace shows a combined feed:
```text
[Goal] Fix auth bug
[Goal] Rehaul auth flow
[Conflict] Auth overlap
[PR] Update session expiry
```
But internally these are separate threads.
### Brain Questions
If Brain asks Dev A:
```text
Do you want the auth fix to preserve existing refresh tokens?
```
Only Dev A’s goal becomes `WaitingForHuman`. Dev B’s unrelated goal remains runnable.
If Dev B depends on that answer, Brain creates an explicit dependency. Otherwise Dev B keeps going.
### Conflict Surfacing
When conflict involves Dev A and Dev B:
- A short notice appears in both goal threads.
- A new `ConflictThread` becomes the decision surface.
- Repo workspace shows one conflict card.
- Org command center shows only if severity is high or cross-repo.
This avoids duplicating decisions across goal threads.
### Priority System
Priority should be policy-bound.
Fields:
- level: low, normal, high, urgent
- reason
- requested_by
- approved_by, optional
- expiry
- preemption allowed?
- affected goals
- audit trail
Urgent does not mean “kill everything.” It means:
- move up the merge train
- preempt queued runnable steps
- ask for arbitration sooner
- pause lower-priority conflicting work at safe checkpoints
- notify relevant participants
Workers should not be interrupted mid-command unless the operation is safe to cancel.
### Thread Completion
When work is done:
- Goal thread collapses in repo workspace.
- It remains searchable.
- It links to PR and evidence bundle.
- Once PR opens, review-specific discussion should move to GitHub or be mirrored from GitHub.
- Cortex thread becomes the orchestration record.
State:
```text
Active -> PR Open -> Evidence Complete -> Approved -> Merged -> Archived
```
Do not delete or convert the thread entirely. It is part of the evidence trail.
---
## 2. Concrete Rust Types
```rust
#[derive(Debug, Clone)]
pub struct Thread {
    pub id: ThreadId,
    pub org_id: OrgId,
    pub repo_id: Option<RepoId>,
    pub global_goal_id: Option<Uuid>,
    pub goal_id: Option<GoalId>,
    pub conflict_id: Option<Uuid>,
    pub thread_type: ThreadType,
    pub title: String,
    pub status: ThreadStatus,
    pub priority: GoalPriority,
    pub created_by: UserId,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum ThreadType {
    Goal,
    Conflict,
    RepoAnnouncement,
    GlobalGoal,
    Review,
    Incident,
}
#[derive(Debug, Clone)]
pub enum ThreadStatus {
    Active,
    WaitingForHuman,
    WaitingForDependency,
    Resolved,
    Collapsed,
    Archived,
}
#[derive(Debug, Clone)]
pub struct ThreadMessage {
    pub id: Uuid,
    pub thread_id: ThreadId,
    pub author: MessageAuthor,
    pub body: String,
    pub message_kind: MessageKind,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum MessageAuthor {
    User(UserId),
    Brain,
    Worker(Uuid),
    GitHub,
    System,
}
#[derive(Debug, Clone)]
pub enum MessageKind {
    UserText,
    BrainQuestion {
        requested_user: Option<UserId>,
        decision_id: Uuid,
    },
    Decision,
    StatusUpdate,
    ConflictNotice,
    EvidenceUpdate,
    PullRequestUpdate,
}
#[derive(Debug, Clone)]
pub struct ConversationContext {
    pub thread_id: ThreadId,
    pub goal_id: Option<GoalId>,
    pub compact_summary: String,
    pub pinned_decisions: Vec<DecisionRecord>,
    pub linked_artifacts: Vec<Uuid>,
    pub linked_conflicts: Vec<Uuid>,
    pub last_compacted_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub struct DecisionRecord {
    pub id: Uuid,
    pub thread_id: ThreadId,
    pub decided_by: UserId,
    pub decision_type: String,
    pub decision_value: String,
    pub rationale: Option<String>,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub struct Presence {
    pub user_id: UserId,
    pub repo_id: Option<RepoId>,
    pub active_thread_id: Option<ThreadId>,
    pub active_goal_id: Option<GoalId>,
    pub active_file_path: Option<String>,
    pub status: PresenceStatus,
    pub updated_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum PresenceStatus {
    Online,
    Viewing,
    Editing,
    Reviewing,
    Away,
}
```
---
## 3. Database Schema
```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT,
  global_goal_id TEXT,
  goal_id TEXT,
  conflict_id TEXT,
  thread_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_threads_repo_status
ON threads(repo_id, status);
CREATE INDEX idx_threads_goal
ON threads(goal_id);
CREATE TABLE thread_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL,
  author_id TEXT,
  message_kind TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_thread_messages_thread_created
ON thread_messages(thread_id, created_at);
CREATE TABLE conversation_contexts (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  compact_summary TEXT NOT NULL,
  pinned_decisions_json TEXT NOT NULL,
  linked_artifacts_json TEXT NOT NULL,
  linked_conflicts_json TEXT NOT NULL,
  last_compacted_at TEXT NOT NULL
);
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  goal_id TEXT,
  conflict_id TEXT,
  decided_by TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  decision_value TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE presence (
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  repo_id TEXT,
  active_thread_id TEXT,
  active_goal_id TEXT,
  active_file_path TEXT,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, org_id)
);
CREATE TABLE priority_changes (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  old_priority TEXT NOT NULL,
  new_priority TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
```
---
## 4. Protocol Messages
```rust
pub enum BrainMessage {
    ThreadCreated {
        thread: Thread,
    },
    ThreadStatusChanged {
        thread_id: ThreadId,
        status: ThreadStatus,
    },
    BrainQuestionAsked {
        thread_id: ThreadId,
        requested_user: Option<UserId>,
        question: String,
        decision_id: Uuid,
    },
    DecisionRecorded {
        decision: DecisionRecord,
    },
    ConflictThreadOpened {
        conflict_id: Uuid,
        thread_id: ThreadId,
        linked_goals: Vec<GoalId>,
    },
    PriorityChanged {
        goal_id: GoalId,
        old_priority: GoalPriority,
        new_priority: GoalPriority,
    },
    PresenceUpdated {
        presence: Presence,
    },
    ThreadArchived {
        thread_id: ThreadId,
        evidence_bundle_id: Option<Uuid>,
    },
}
pub enum ClientMessage {
    SubmitGoal {
        repo_id: RepoId,
        prompt: String,
        priority: GoalPriority,
    },
    SendThreadMessage {
        thread_id: ThreadId,
        body: String,
    },
    AnswerBrainQuestion {
        thread_id: ThreadId,
        decision_id: Uuid,
        answer: String,
    },
    ChangeGoalPriority {
        goal_id: GoalId,
        priority: GoalPriority,
        reason: String,
    },
    JoinRepoWorkspace {
        repo_id: RepoId,
    },
    SetPresence {
        repo_id: Option<RepoId>,
        thread_id: Option<ThreadId>,
        file_path: Option<String>,
        status: PresenceStatus,
    },
}
```
---
## 5. UX Description
Repo workspace layout:
- left: active goals and conflicts
- center: selected thread
- right: scoped orchestration map and evidence
- bottom or side panel: active workers and branch state
A developer can submit a goal from the repo chat input, but the system immediately creates a goal card/thread.
Brain asks a question in the goal thread:
```text
Cortex needs a decision:
Should this auth fix preserve existing refresh tokens?
Waiting on: Dev A
Impact: only this goal is paused
```
Other repo work continues.
Conflict thread:
```text
Conflict: auth/session overlap
Linked goals:
- Fix auth bug
- Rehaul auth flow
Decision needed:
Should the bug fix be folded into the rehaul?
```
When done:
```text
Goal complete
Evidence:
- Tests passed
- PR opened
- No in-flight conflicts
- Awaiting human approval
```
After merge:
```text
Archived
PR: #184
Evidence bundle: available
```
---
## 6. Edge Cases and Failure Modes
**Flat chat users keep typing unrelated requests**
Brain creates separate goal threads and asks for clarification if a message could refer to multiple active goals.
**A user answers in the wrong thread**
Brain can detect linked decision IDs. If ambiguous, it asks where to apply the answer.
**Dev leaves while Brain waits**
If no answer after timeout, route to goal sponsor, repo maintainer, or team default policy.
**Priority fight**
Urgent changes are visible and audited. Repo maintainers can downgrade.
**Thread overload**
Collapse completed goals, group low-severity updates, and promote only blocking items.
---
# Evidence-Based Completion
A goal is complete only when all required evidence exists.
```rust
#[derive(Debug, Clone)]
pub struct CompletionGate {
    pub goal_id: GoalId,
    pub required_tests_passed: bool,
    pub pr_open: bool,
    pub no_inflight_conflicts: bool,
    pub human_approved: bool,
    pub auto_approval_policy_matched: bool,
    pub status: CompletionStatus,
}
#[derive(Debug, Clone)]
pub enum CompletionStatus {
    Incomplete,
    EvidenceReady,
    AwaitingApproval,
    Approved,
    Completed,
    Rejected,
}
```
Schema:
```sql
CREATE TABLE evidence_bundles (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  branch_id TEXT,
  pr_url TEXT,
  test_summary_json TEXT NOT NULL,
  diff_summary TEXT NOT NULL,
  conflict_summary_json TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE completion_gates (
  goal_id TEXT PRIMARY KEY REFERENCES goals(id),
  required_tests_passed INTEGER NOT NULL DEFAULT 0,
  pr_open INTEGER NOT NULL DEFAULT 0,
  no_inflight_conflicts INTEGER NOT NULL DEFAULT 0,
  human_approved INTEGER NOT NULL DEFAULT 0,
  auto_approval_policy_matched INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```
Completion rule:
```text
Done = tests pass + PR open + no active conflicts + human approval or matching auto-approval policy.
```
The worker cannot mark done. It can only submit evidence.
---
# Frontend Orchestration Map Data Model
The map should be a projection, not the source of truth.
Three scopes:
- `OrgMap`
- `RepoMap`
- `GoalMap`
They compose bottom-up:
```text
Goal DAGs -> Repo active work map -> Org command map
```
Types:
```rust
#[derive(Debug, Clone)]
pub struct OrchestrationMap {
    pub scope: MapScope,
    pub nodes: Vec<MapNode>,
    pub edges: Vec<MapEdge>,
    pub viewport_hints: ViewportHints,
    pub generated_at: DateTime<Utc>,
}
#[derive(Debug, Clone)]
pub enum MapScope {
    Org { org_id: OrgId },
    Repo { repo_id: RepoId },
    Goal { goal_id: GoalId },
    GlobalGoal { global_goal_id: Uuid },
}
#[derive(Debug, Clone)]
pub struct MapNode {
    pub id: String,
    pub node_type: MapNodeType,
    pub label: String,
    pub status: MapNodeStatus,
    pub repo_id: Option<RepoId>,
    pub goal_id: Option<GoalId>,
    pub step_id: Option<StepId>,
    pub worker_id: Option<Uuid>,
    pub branch_name: Option<String>,
    pub progress: Option<f32>,
    pub eta_seconds: Option<u64>,
    pub badges: Vec<MapBadge>,
    pub metadata_json: String,
}
#[derive(Debug, Clone)]
pub enum MapNodeType {
    Org,
    Repo,
    Goal,
    GlobalGoal,
    Step,
    Worker,
    Branch,
    PullRequest,
    Conflict,
    FileLease,
    Artifact,
    ReleaseGate,
    HumanDecision,
}
#[derive(Debug, Clone)]
pub enum MapNodeStatus {
    Idle,
    Planned,
    Running,
    Waiting,
    Blocked,
    Conflict,
    Passed,
    Failed,
    Done,
}
#[derive(Debug, Clone)]
pub struct MapEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub edge_type: MapEdgeType,
    pub status: MapEdgeStatus,
    pub label: Option<String>,
}
#[derive(Debug, Clone)]
pub enum MapEdgeType {
    Dependency,
    Owns,
    Produces,
    Consumes,
    ConflictsWith,
    Blocks,
    RunsOn,
    OpensPr,
    RequiresApproval,
}
#[derive(Debug, Clone)]
pub enum MapEdgeStatus {
    Active,
    Waiting,
    Blocked,
    Resolved,
}
#[derive(Debug, Clone)]
pub struct MapBadge {
    pub kind: String,
    pub label: String,
    pub severity: String,
}
#[derive(Debug, Clone)]
pub struct ViewportHints {
    pub preferred_layout: String,
    pub group_by_repo: bool,
    pub group_by_goal: bool,
}
```
Frontend behavior:
- Org map groups by repo.
- Repo map groups by goal and conflict.
- Goal map shows the actual DAG.
- Clicking a node opens detail panel.
- Conflict edges are red and explainable.
- File leases appear as overlays, not as giant nodes unless selected.
- ETAs are confidence-labeled.
- Active workers show command, branch, current step, and last heartbeat.
- Approval nodes are interactive.
- Cross-repo artifacts are diamond-shaped nodes.
- Release gates are final checkpoint nodes.
- Presence is rendered as avatars on repo, thread, or file nodes.
Live updates should use WebSocket/SSE events:
```rust
pub enum MapEvent {
    NodeAdded(MapNode),
    NodeUpdated(MapNode),
    NodeRemoved { id: String },
    EdgeAdded(MapEdge),
    EdgeUpdated(MapEdge),
    EdgeRemoved { id: String },
    ViewInvalidated { scope: MapScope },
}
```
---
# GitHub Integration Flow
Hard choice: use **GitHub OAuth for identity** and **GitHub App installation for repo operations**.
OAuth alone is awkward for durable repo automation, webhooks, branch checks, and org installation. The MVP can present this as “connect GitHub org,” but under the hood Cortex should install a GitHub App.
Flow:
1. User signs in with GitHub OAuth.
2. Cortex stores GitHub user identity.
3. User selects org.
4. Cortex verifies org membership through GitHub.
5. User installs Cortex GitHub App on selected org/repos.
6. Cortex imports repos where installation grants access.
7. Team membership is synced from GitHub org members.
8. Repo permissions are inherited from GitHub.
9. No Cortex invite system for MVP.
10. Branch protection, PR review, and merge permission defer to GitHub.
Schema:
```sql
CREATE TABLE github_identities (
  user_id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  access_token_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE github_orgs (
  org_id TEXT PRIMARY KEY,
  github_org_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  installation_id INTEGER,
  connected_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE github_repos (
  repo_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES github_orgs(org_id),
  github_repo_id INTEGER NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  private INTEGER NOT NULL,
  archived INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE github_memberships (
  org_id TEXT NOT NULL REFERENCES github_orgs(org_id),
  user_id TEXT NOT NULL,
  github_role TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE github_repo_permissions (
  repo_id TEXT NOT NULL REFERENCES github_repos(repo_id),
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (repo_id, user_id)
);
CREATE TABLE github_pull_requests (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES github_repos(repo_id),
  goal_id TEXT,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  state TEXT NOT NULL,
  mergeable_state TEXT,
  checks_state TEXT,
  review_state TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repo_id, number)
);
```
Permissions:
- If GitHub says user cannot read repo, Cortex does not show repo.
- If GitHub says user cannot push/open PR, Cortex does not let them dispatch write goals unless policy allows a bot-owned branch with PR only.
- If GitHub says user cannot merge, Cortex cannot approve merge through UI.
- Team membership sync happens on login, webhook, and periodic background refresh.
---
# Final Architecture Choice
Cortex should be built around five durable primitives:
1. **Goal**
   A user’s requested outcome.
2. **Step**
   A planned unit of work in a DAG.
3. **Lease**
   A soft claim over path, symbol, domain, or contract.
4. **Artifact**
   A typed output that can be consumed by another step, repo, or worker.
5. **Evidence**
   A verifiable completion record.
Everything else is projection:
- chat threads
- maps
- conflict cards
- worker panels
- org dashboards
- PR timelines
That gives Cortex the core property it needs: multiple humans and multiple AI agents can coordinate without turning the product into a noisy chat room or a brittle lock manager.
I could not inspect the workspace because the local sandbox command runner failed with `bwrap: Unexpected capabilities but not setuid, old file caps config?`, so this design is grounded in the Cortex context you provided rather than existing repo files.
