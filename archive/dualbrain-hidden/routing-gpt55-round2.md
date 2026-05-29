**Round 2 Challenge: Cortex Routing Intelligence**

Round 1 produced two strong but differently biased designs.

GPT-5.5 optimized for evidence integrity, causal attribution, invariant safety boundaries, and auditability. Opus 4.7 optimized for concrete execution mechanics: fixed templates, numeric reward weights, Thompson sampling, update gates, finalization windows, and an explainable routing pipeline.

Round 2 must merge these into a routing system that can handle arbitrary user intent, scoped blocking, confidence-driven autonomy, and continuous progress while waiting on blocked steps.

The core challenge is no longer “pick the best route for one task.” It is:

> Maintain a live intent graph, continuously route executable work, route around blocked work, learn from clean evidence, and decide when confidence is sufficient for autonomy.

---

## 1. Reward Attribution

### Where GPT-5.5 Is Stronger

GPT-5.5’s design is stronger on evidence quality and causal attribution.

The 5-tier taxonomy is more robust than Opus’s 3-tier Hard/Soft/Behavioral split because it separates signal kind from signal contamination.

Key GPT-5.5 types and concepts:

```rust
SignalTier::PolicyEligibility
SignalTier::HardObjective
SignalTier::IndependentVerification
SignalTier::Stability
SignalTier::WeakSubjective
SignalTier::NegativeContamination
```

The explicit `contamination_penalty` on `SignalWeight` is important. Without contamination as a first-class dimension, the learner can be tricked by signals that appear positive but are causally weak or self-referential.

Example: a generated test passing against generated code is not as trustworthy as a human-written regression test passing after an independent reviewer modifies the implementation.

GPT-5.5 is also stronger because of its causal credit model:

```rust
AttemptRole::PrimaryGenerator
AttemptRole::ParallelCandidate
AttemptRole::Planner
AttemptRole::Implementer
AttemptRole::Reviewer
AttemptRole::TestWriter
AttemptRole::Verifier
AttemptRole::Refiner
AttemptRole::Arbiter
```

This matters for arbitrary multi-step work. If a planner creates the correct decomposition, a worker implements only one piece, a verifier catches a bug, and a refiner fixes it, the final success should not be attributed only to the final implementer or final model call.

The append-only temporal evidence ledger is also superior:

```rust
observed_at
event_time
compensating_update
```

That model preserves history and allows later correction without mutation. This is critical for delayed signals like PR revert, production incident, user dissatisfaction, or deployment failure.

The `RouteBeliefKey` is also stronger than Opus’s template-only belief target:

```rust
RouteBeliefKey {
    task_family,
    repo_profile_bucket,
    risk_class,
    model_id,
    strategy_id,
}
```

This prevents misleading global learning. A model may be excellent at low-risk refactors in small TypeScript repos but poor at authentication migrations in a payment system. Belief must be contextual.

### Where Opus Is Stronger

Opus is stronger on operational concreteness.

It supplied numeric weights, finalization windows, update gates, and a direct reward computation path:

```rust
SignalWeightConfig {
    compile: 1.0,
    test: 0.9,
    ci: 0.85,
    pr_merged: 0.7,
    pr_reverted: -2.0,
    user_accepted: 0.1,
}
```

The exact values should not be accepted blindly, but the design has the right shape: V1 needs a transparent scoring function that can ship.

Opus’s finalization windows are also useful:

```rust
10s       // immediate command result
120s      // local test/build result
1800s     // CI/deploy result
604800s   // revert/incidents/user outcome
```

GPT-5.5 had the better ledger model, but Opus had the better answer for when to update beliefs.

Opus’s three belief update gates should be adopted:

```rust
minimum_signal_diversity
confidence_floor_per_risk
signal_freshness
```

These are essential. A learner should not update route beliefs after a single weak signal, stale signal, or low-confidence signal on critical work.

Opus’s cross-model verification at high dial levels is also worth adopting. GPT-5.5 had independent verification as a tier, but Opus made it operational:

```rust
dial >= 7 => require_cross_model_verification
anchor_tests_weight = 2x
human_written_tests_weight = 3x
```

### Merged Design

The merged design should use GPT-5.5’s evidence graph and causal attribution as the canonical reward substrate, while adopting Opus’s reward finalization windows, confidence ceilings, numeric baseline weights, and update gates.

The reward system should work like this:

1. Every signal enters an append-only `EvidenceLedger`.
2. Every signal has tier, reliability, confidence, contamination, freshness, and causal scope.
3. Rewards are computed against `RouteBeliefKey`, not global model/template aggregates.
4. Belief updates are blocked unless diversity, freshness, and confidence gates pass.
5. Delayed negative evidence is represented by compensating updates.
6. Multi-agent or multi-attempt routes assign credit through an explicit causal graph.
7. High-risk work requires independent verification before positive belief updates.

---

## 2. Learned vs Invariant

### Where GPT-5.5 Is Stronger

GPT-5.5 is stronger on the separation of learned behavior from safety constraints.

The three-system split should remain foundational:

```rust
EvidenceGraph
InvariantPolicy
DialToStrategy
```

This separation prevents the learner from eroding hard safety rules.

The strongest GPT-5.5 position is:

> Risk classification is invariant.

Opus suggested auth risk classification could be learned from file paths. That is dangerous. The learner can assist classification, but it must not own final risk boundaries.

For example, these should be invariantly classified as high or critical risk:

```rust
auth
billing
payments
credentials
secrets
deployment
production database migrations
permission checks
crypto signing
policy enforcement
```

GPT-5.5’s evidence floors are also stronger as invariants. The system should not “learn” that tests are unnecessary for high-risk code simply because a model often gets lucky.

The principle is:

> The learner may select within the allowed strategy space, but it may not redefine the safety envelope.

### Where Opus Is Stronger

Opus is stronger on bounded strategy units and exploration mechanics.

The fixed `RouteTemplateId` enum is practical:

```rust
RouteTemplateId::SoloFast
RouteTemplateId::SoloCareful
RouteTemplateId::PlanThenExecute
RouteTemplateId::ParallelCandidates
RouteTemplateId::ImplementThenReview
RouteTemplateId::CrossModelVerify
RouteTemplateId::HumanCheckpoint
RouteTemplateId::FullCriticalPath
```

GPT-5.5’s “route template primitives are configured and auditable; selection is learned” is conceptually right, but Opus gives the system a concrete learning unit.

Opus’s Thompson sampling is also stronger than GPT-5.5’s UCB default for early V1 because Beta distributions are simple, explainable, and naturally represent uncertainty:

```rust
TemplateBelief {
    alpha,
    beta,
}
```

However, plain Beta reward is too simple for multi-dimensional outcomes. It should be adopted for binary success/failure summaries, while the evidence graph remains canonical.

Opus’s configured circuit breaker thresholds should also be adopted, with one correction: circuit breaker thresholds are configured/invariant, while their triggering signals may come from learned detectors.

### Merged Design

The merged design should use:

```rust
InvariantPolicy
ConfiguredRouteTemplates
LearnedTemplateSelection
EvidenceBackedBeliefUpdates
```

Risk classification should be invariant with optional learned suggestions.

Route templates should be configured and auditable. Template selection should be learned.

Exploration should combine Opus’s Thompson sampling with GPT-5.5’s contextual belief key:

```rust
TemplateBeliefKey {
    task_family,
    repo_profile_bucket,
    risk_class,
    route_template_id,
    model_pool_id,
}
```

Circuit breakers should be invariant actions triggered by observed evidence:

```rust
if contamination_spike || failure_rate_exceeded || provider_health_bad {
    constrain_strategy_space()
}
```

---

## 3. Dial Mapper

### Where GPT-5.5 Is Stronger

GPT-5.5 is stronger on capacity correctness.

The `SubscriptionSlot` and `CapacitySnapshot` model with hard reservation is necessary:

```rust
SubscriptionSlot {
    provider,
    tier,
    rate_limit,
    remaining_capacity,
    cooldown,
}

CapacitySnapshot {
    slots,
    hard_reservations,
}
```

This matters because routing is not merely choosing a theoretically good model. It must choose a feasible route under live capacity constraints.

GPT-5.5’s fair team allocation with proportional shares is also stronger than a naive global pool. A team should not be starved because another task faned out 20 expensive agents.

The route score is also the right transparent V1 shape:

```rust
score = quality
      - cost_penalty
      - latency_penalty
      - capacity_penalty
```

### Where Opus Is Stronger

Opus is stronger on dial semantics and explainability.

The `Dial` and `ResourceEnvelope` model should be adopted:

```rust
Dial {
    level,
    resource_envelope,
}

ResourceEnvelope {
    max_cost,
    max_parallel,
    max_models,
    verification_depth,
    allow_cross_provider,
}
```

This gives the dial concrete operational meaning.

Opus’s 8-step `RoutingPipeline.plan()` should also be adopted as the explainable planning interface. GPT-5.5 had stronger principles, but Opus made the system inspectable.

Opus’s `explain_plan` is especially important. A routing system this powerful must explain why it chose autonomy, user confirmation, parallelism, or deferral.

### Merged Design

The merged dial mapper should treat dial as:

1. A hard resource ceiling.
2. A quality preference.
3. A verification-depth selector.
4. A concurrency allowance.
5. An autonomy bias, mediated by confidence.

The dial should not directly map to one template. It should map to a strategy envelope, then the planner selects executable work units inside that envelope.

For arbitrary intent, the dial must apply across a live work graph, not a single route.

---

# New Round 2 Requirements

The new requirements change the architecture.

The system now needs an intent-level scheduler, not only a task router.

A user may say:

- “Do 20 rounds of security audits.”
- “Plan a huge app then build it.”
- “Discuss with me how to fix this, then fix it.”
- “Start deployment, but I need to click something in the browser.”
- “Investigate all likely causes while waiting for me to approve the command.”

The system must represent this as a graph of work, where individual nodes may be executable, blocked, waiting, speculative, confirmed, or complete.

The whole system must not stop when one step blocks.

---

# New Rust Types

Below are new structures needed for scoped blocking, confidence-weighted autonomy, and route-around-block behavior.

```rust
use std::collections::{BTreeMap, BTreeSet};
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct IntentId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct WorkNodeId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BlockerId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct EvidenceId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RouteId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ActorId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentShape {
    SingleTask,
    MultiPhaseBuild,
    IterativeAudit,
    DiscussionThenExecution,
    Investigation,
    Deployment,
    IncidentResponse,
    ResearchAndProposal,
    OpenEndedExploration,
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkNodeKind {
    Clarify,
    Plan,
    Research,
    InspectCode,
    Implement,
    Test,
    Review,
    Verify,
    Deploy,
    Document,
    AskUser,
    WaitForUserAction,
    Decide,
    Summarize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkNodeState {
    Pending,
    Ready,
    Running,
    Blocked,
    WaitingForUser,
    WaitingForExternalSystem,
    Completed,
    Failed,
    Cancelled,
    Superseded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RiskClass {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmationPolicy {
    ProceedAutonomously,
    ProceedAndFlag,
    AskBeforeProceeding,
    RequireExplicitApproval,
    Forbidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfidenceBand {
    Low,
    Medium,
    High,
    Certain,
}

#[derive(Debug, Clone, Copy)]
pub struct ConfidenceScore {
    pub value: f32,
    pub band: ConfidenceBand,
    pub calibrated_at: SystemTime,
}

impl ConfidenceScore {
    pub fn from_value(value: f32, calibrated_at: SystemTime) -> Self {
        let bounded = value.clamp(0.0, 1.0);
        let band = if bounded < 0.45 {
            ConfidenceBand::Low
        } else if bounded < 0.75 {
            ConfidenceBand::Medium
        } else if bounded < 0.95 {
            ConfidenceBand::High
        } else {
            ConfidenceBand::Certain
        };

        Self {
            value: bounded,
            band,
            calibrated_at,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfidenceWeights {
    pub task_understanding: f32,
    pub repo_context: f32,
    pub tool_feedback: f32,
    pub test_coverage: f32,
    pub independent_verification: f32,
    pub user_preference_match: f32,
    pub risk_penalty: f32,
    pub ambiguity_penalty: f32,
    pub stale_context_penalty: f32,
}

impl ConfidenceWeights {
    pub fn aggregate(&self) -> f32 {
        let positive =
            self.task_understanding
            + self.repo_context
            + self.tool_feedback
            + self.test_coverage
            + self.independent_verification
            + self.user_preference_match;

        let negative =
            self.risk_penalty
            + self.ambiguity_penalty
            + self.stale_context_penalty;

        ((positive / 6.0) - (negative / 3.0)).clamp(0.0, 1.0)
    }
}

#[derive(Debug, Clone)]
pub struct AutonomyDecision {
    pub policy: ConfirmationPolicy,
    pub confidence: ConfidenceScore,
    pub risk_class: RiskClass,
    pub rationale: Vec<String>,
    pub required_user_question: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockerKind {
    NeedsUserClarification,
    NeedsUserApproval,
    NeedsUserShellCommand,
    NeedsUserBrowserAction,
    NeedsExternalCi,
    NeedsVpsAccess,
    NeedsSecretOrCredential,
    NeedsPaymentProviderAction,
    NeedsUpstreamDecision,
    CapacityUnavailable,
    PolicyForbidden,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockerScope {
    NodeOnly,
    Subtree,
    Intent,
    Global,
}

#[derive(Debug, Clone)]
pub struct Blocker {
    pub id: BlockerId,
    pub kind: BlockerKind,
    pub scope: BlockerScope,
    pub blocked_node: WorkNodeId,
    pub created_at: SystemTime,
    pub last_checked_at: SystemTime,
    pub message_to_user: Option<String>,
    pub unblocks_when: UnblockCondition,
}

#[derive(Debug, Clone)]
pub enum UnblockCondition {
    UserResponds,
    UserApproves,
    UserCompletesAction {
        expected_evidence: String,
    },
    ExternalSignalObserved {
        evidence_kind: String,
    },
    CapacityAvailable {
        provider: String,
    },
    TimeElapsed {
        retry_after: SystemTime,
    },
    ManualOverride,
}

#[derive(Debug, Clone)]
pub struct WorkDependency {
    pub from: WorkNodeId,
    pub to: WorkNodeId,
    pub dependency_kind: DependencyKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DependencyKind {
    MustCompleteBefore,
    ShouldCompleteBefore,
    BlocksIfFailed,
    ProvidesContext,
    ProvidesVerification,
    AlternativePath,
}

#[derive(Debug, Clone)]
pub struct WorkNode {
    pub id: WorkNodeId,
    pub intent_id: IntentId,
    pub kind: WorkNodeKind,
    pub state: WorkNodeState,
    pub title: String,
    pub risk_class: RiskClass,
    pub confidence: ConfidenceScore,
    pub autonomy_decision: AutonomyDecision,
    pub dependencies: Vec<WorkDependency>,
    pub blockers: Vec<BlockerId>,
    pub route_id: Option<RouteId>,
    pub evidence: Vec<EvidenceId>,
    pub assigned_actor: Option<ActorId>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

#[derive(Debug, Clone)]
pub struct IntentGraph {
    pub intent_id: IntentId,
    pub shape: IntentShape,
    pub root_goal: String,
    pub nodes: BTreeMap<WorkNodeId, WorkNode>,
    pub blockers: BTreeMap<BlockerId, Blocker>,
    pub ready_queue: BTreeSet<WorkNodeId>,
    pub blocked_queue: BTreeSet<WorkNodeId>,
    pub completed: BTreeSet<WorkNodeId>,
    pub cancelled: BTreeSet<WorkNodeId>,
}

impl IntentGraph {
    pub fn ready_nodes(&self) -> Vec<&WorkNode> {
        self.ready_queue
            .iter()
            .filter_map(|id| self.nodes.get(id))
            .filter(|node| node.state == WorkNodeState::Ready)
            .collect()
    }

    pub fn blocked_nodes(&self) -> Vec<&WorkNode> {
        self.blocked_queue
            .iter()
            .filter_map(|id| self.nodes.get(id))
            .filter(|node| {
                matches!(
                    node.state,
                    WorkNodeState::Blocked
                        | WorkNodeState::WaitingForUser
                        | WorkNodeState::WaitingForExternalSystem
                )
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct SchedulerPolicy {
    pub max_parallel_nodes: usize,
    pub route_around_blockers: bool,
    pub allow_speculative_context_gathering: bool,
    pub allow_parallel_verification: bool,
    pub ask_user_when_confidence_below: f32,
    pub flag_user_when_confidence_below: f32,
}

#[derive(Debug, Clone)]
pub struct SchedulerDecision {
    pub runnable: Vec<WorkNodeId>,
    pub waiting: Vec<WorkNodeId>,
    pub ask_user: Vec<WorkNodeId>,
    pub deferred: Vec<WorkNodeId>,
    pub rationale: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ProgressLoopState {
    pub active_intents: BTreeMap<IntentId, IntentGraph>,
    pub active_routes: BTreeMap<RouteId, WorkNodeId>,
    pub scheduler_policy: SchedulerPolicy,
    pub last_tick_at: SystemTime,
}

#[derive(Debug, Clone)]
pub struct ScopedBlockingUpdate {
    pub blocker_id: BlockerId,
    pub node_id: WorkNodeId,
    pub previous_state: WorkNodeState,
    pub new_state: WorkNodeState,
    pub still_runnable_siblings: Vec<WorkNodeId>,
    pub user_message_sent: bool,
    pub observed_at: SystemTime,
}
```

---

# Conflict Resolution Table

| # | Decision | Verdict | Rationale |
|---:|---|---|---|
| 1 | Canonical reward substrate | GPT-5.5 | Evidence graph is more robust than direct scalar reward. |
| 2 | Signal taxonomy | GPT-5.5 | 5-tier model separates hard evidence, verification, stability, weak subjective input, and contamination. |
| 3 | Numeric baseline weights | Adopt Opus | V1 needs transparent default weights. |
| 4 | Contamination penalty | GPT-5.5 | Prevents self-confirming routes from poisoning beliefs. |
| 5 | Signal reliability enum | Adopt Opus | Useful operational field alongside GPT-5.5 tiers. |
| 6 | Reward normalization to [-1, 1] | Adopt Opus with changes | Good for implementation, but must be computed from evidence graph. |
| 7 | Temporal ledger | GPT-5.5 | `observed_at` vs `event_time` is essential for delayed evidence. |
| 8 | Retroactive corrections | GPT-5.5 | Use compensating updates, not mutation. |
| 9 | Finalization windows | Adopt Opus | Concrete timing model is needed for belief updates. |
| 10 | Multi-role credit assignment | GPT-5.5 | Required for planners, reviewers, verifiers, refiners, and arbiters. |
| 11 | Route belief key | GPT-5.5 | Beliefs must be contextual by task, repo, risk, model, and strategy. |
| 12 | Belief update gates | Adopt Opus | Diversity, confidence, and freshness gates prevent bad learning. |
| 13 | Confidence ceiling by signal type | Adopt Opus | Prevents weak signals from producing high-confidence updates. |
| 14 | Cross-model verification at high dial | Adopt Opus | Makes independent verification operational. |
| 15 | Anchor test multiplier | Adopt Opus | Regression/anchor tests carry stronger causal evidence. |
| 16 | Human-written test multiplier | Adopt Opus | Human tests are less likely to share generator blind spots. |
| 17 | Learned vs invariant separation | GPT-5.5 | Safety boundaries must not drift through learning. |
| 18 | Risk classification | GPT-5.5 | Final risk classification must be invariant, though learned suggestions may assist. |
| 19 | Auth risk from file paths | Reject Opus as final authority | File path heuristics are useful hints, not safety truth. |
| 20 | Evidence floors | GPT-5.5 | Required verification depth should be invariant by risk. |
| 21 | Route templates | Merge | Templates are configured/auditable; selection is learned. |
| 22 | Fixed template enum | Adopt Opus for V1 | Practical learning unit and easier explanation. |
| 23 | Template primitives | GPT-5.5 for long term | Needed for arbitrary intent and compositional routes. |
| 24 | Exploration algorithm | Merge | Use Thompson sampling for V1 template choice; keep UCB available for contextual variants. |
| 25 | Exploration rate | Adopt Opus with policy guardrails | 5% base is reasonable, but critical paths need stricter caps. |
| 26 | Circuit breaker thresholds | Merge | Thresholds are configured/invariant; detection signals may be learned. |
| 27 | Dial semantics | Merge | Dial is hard ceiling on resources, preference on quality, and verification-depth selector. |
| 28 | Direct dial-to-template mapping | Reject as general rule | Too rigid for arbitrary intent; acceptable only for cold start. |
| 29 | Resource envelope | Adopt Opus | Concrete cost, model, parallelism, and verification limits are needed. |
| 30 | Subscription capacity model | GPT-5.5 | Hard reservation prevents overcommit. |
| 31 | Fair-share allocation | Merge | Use proportional shares with Opus-style borrowing of unused capacity. |
| 32 | Route score formula | GPT-5.5 | Transparent quality minus cost/latency/capacity penalties is correct for V1. |
| 33 | `RoutingPipeline.plan()` | Adopt Opus | Clear explainable planning surface. |
| 34 | `explain_plan` | Adopt Opus | Required for trust and debugging. |
| 35 | Arbitrary intent support | New merged design | Requires intent graph, not single-task router. |
| 36 | Scoped blocking | New merged design | Blocks attach to nodes/subtrees, not necessarily whole intent. |
| 37 | Continue while waiting for user | New merged design | Scheduler must route ready siblings while blocked nodes wait. |
| 38 | Confidence-driven autonomy | New merged design | Confidence determines proceed, flag, ask, require approval, or forbid. |
| 39 | Medium confidence behavior | New merged design | Proceed but flag when risk allows. |
| 40 | Low confidence behavior | New merged design | Ask or require approval depending on risk. |
| 41 | High confidence behavior | New merged design | Proceed autonomously inside invariant policy envelope. |
| 42 | “20 rounds of audits” support | New merged design | Model as iterative work graph with round nodes, verification nodes, and stop conditions. |
| 43 | “Plan huge app then build” support | New merged design | Model as multi-phase intent graph with proposal, decomposition, implementation, review, and verification. |
| 44 | “Discuss then fix” support | New merged design | Discussion node can block execution subtree while inspection/research nodes proceed. |
| 45 | Self-healing behavior | New merged design | Failures create new evidence, update blockers, and enqueue recovery/alternative nodes. |

---

# Merged Architecture

The merged Cortex routing system should have five layers.

```rust
IntentGraph
ScopedScheduler
InvariantPolicy
RoutePlanner
EvidenceAndBeliefSystem
```

`IntentGraph` represents what the user wants.

`ScopedScheduler` decides which nodes can run now, which are blocked, and which should be routed around.

`InvariantPolicy` enforces hard safety, privacy, cost, risk, and evidence-floor rules.

`RoutePlanner` chooses the strategy, model set, parallelism, and verification depth.

`EvidenceAndBeliefSystem` records outcomes, assigns causal credit, and updates contextual route beliefs only after gates pass.

The key shift is that routing happens continuously. It is not a one-shot function.

---

# Handling the New Requirements

## Arbitrary Intent Flexibility

A user request should first become an `IntentGraph`.

Examples:

“Do 20 rounds of security audits” becomes:

```text
Intent: IterativeAudit
Nodes:
- establish audit scope
- inspect auth
- inspect billing
- inspect deployment
- inspect database access
- round 1 review
- round 2 review
- ...
- round 20 review
- consolidate findings
- propose fixes
```

“Plan a huge app then build it” becomes:

```text
Intent: MultiPhaseBuild
Nodes:
- clarify product boundaries
- inspect repo
- create architecture plan
- identify slices
- implement slice 1
- test slice 1
- review slice 1
- implement slice 2
- ...
```

“Discuss with me how to fix this then fix it” becomes:

```text
Intent: DiscussionThenExecution
Nodes:
- inspect issue
- propose options
- ask user decision
- wait for user
- implement selected option
- verify
```

The discussion node may block implementation, but it should not block inspection, test discovery, or context gathering.

## Scoped Blocking

A blocker must have scope:

```rust
BlockerScope::NodeOnly
BlockerScope::Subtree
BlockerScope::Intent
BlockerScope::Global
```

If deployment needs a user browser click, deployment waits. Documentation, local verification, deploy-info inspection, or rollback planning may continue.

If a command requires user approval, only that command node blocks. The route planner may continue with independent code inspection.

## Confidence Weights

Confidence should decide autonomy.

```text
High confidence + low/medium risk => proceed
Medium confidence + low/medium risk => proceed and flag
Low confidence => ask
High risk + medium confidence => ask
Critical risk => require explicit approval unless policy says routine safe action
```

Confidence must account for:

```rust
task_understanding
repo_context
tool_feedback
test_coverage
independent_verification
user_preference_match
risk_penalty
ambiguity_penalty
stale_context_penalty
```

Confidence is not the same as reward. Confidence decides current action. Reward updates future belief.

## Route Around Blocks

The scheduler should repeatedly ask:

1. Which nodes are ready?
2. Which nodes are blocked?
3. Which blocked nodes have runnable siblings?
4. Which ready nodes fit the dial envelope?
5. Which ready nodes fit available capacity?
6. Which nodes require user confirmation?
7. Which nodes can proceed autonomously?

This turns blocking into a local scheduling condition, not a global pause.

## Self-Calibrating, Self-Healing Behavior

Self-healing means:

- failed route creates evidence
- evidence updates confidence
- confidence may downgrade autonomy
- scheduler may spawn a verifier, refiner, or alternate route
- repeated failure may trigger a circuit breaker
- blocked work is bypassed where possible
- stale assumptions are rechecked
- delayed negative evidence corrects prior beliefs

The system should not blindly continue. It should continue intelligently inside policy.

---

