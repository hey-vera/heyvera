# Cortex Routing Intelligence Layer -- Merged Consensus

> Synthesized from 2 rounds of GPT-5.5 vs Opus 4.7 dual-brain architecture debate.
> Sources: routing-opus-round1.md, routing-gpt55-round1.md, routing-opus-round2.md, routing-gpt55-round2.md
>
> Key principle from GPT-5.5: "A sophisticated learner on bad evidence will be worse
> than a simple learner on clean evidence."
>
> Key principle from Opus: "The evidence floor NEVER bends to the dial."
>
> Ship UCB on clean evidence for v1. Expand to Thompson sampling on rich features for v2.

---

## Design Philosophy

Cortex is a **constrained learning system**, not an autonomous optimizer. It learns which model, provider, strategy, and verification pattern works best for a given task context. It must never learn its way around privacy, budget, auth, tenant isolation, or the minimum evidence required to claim success.

The dial controls resource investment. It does not control truthfulness, safety, or policy.

The hardest problem is reward attribution. Most naive routing systems learn from wrong signals: user clicks, agent-written tests, superficial "done" messages, short-term latency wins. Cortex needs an Evidence Graph that records what was attempted, what verification happened, what changed later, and which actors may have biased the signal. The routing learner consumes that graph through a conservative attribution pipeline.

---

## Core Design Principles

1. **Evidence floor NEVER bends to dial.** Dial 1 on a high-risk auth change still requires the full evidence floor for that risk class. Dial controls optional investment above the floor, never verification below it.

2. **Simple learner on clean evidence beats sophisticated learner on garbage.** v1 ships UCB scoring over an append-only evidence graph with contamination tracking. Thompson sampling comes in v2 after evidence quality is validated.

3. **Route templates CONFIGURED, selection LEARNED.** Humans define safe, auditable route template schemas. The learner picks which template works best for which task shape. The learner does not invent arbitrary execution graphs.

4. **Risk classification is INVARIANT floor, not purely learned.** File-path patterns for auth/payments/secrets/crypto establish a minimum risk class. Learned classifiers can raise risk, never lower it below the invariant floor.

5. **Contamination is a first-class dimension.** Every signal carries reward, confidence, and contamination penalty. A generated test passing against generated code is not as trustworthy as a human-written regression test passing after independent review.

6. **Causal credit sums capped at 1.0 per event.** Even for failures with joint responsibility, the total credit weight per evidence event must not exceed 1.0. This prevents double-penalization of routes.

7. **Confidence decides current action; reward updates future belief.** These are separate axes. A route can have high confidence (proceed autonomously) but uncertain reward (still learning which template is best).

8. **Circuit breaker thresholds are CONFIGURED, not learned.** Learning the threshold creates a meta-learning problem. The detection signals that trigger the breaker may come from learned detectors, but the threshold itself is policy.

9. **Exploration scales with dial level.** At dial 1, exploration must be cheap or absent. At dial 10, full counterfactual evaluation is permitted. The cost of exploration must be proportional to the user's investment posture.

10. **Append-only evidence graph with compensating updates.** History is never mutated. Delayed negative evidence (reverts, incidents) appends compensating updates. Beliefs are derived state, recalculated from the immutable ledger.

---

## 5-Layer Architecture

```
User Intent
    |
    v
[1. Intent Decomposer] --> IntentGraph
    |
    v
[2. Intent Scheduler]  --> scoped blocking, route-around-blocks
    |
    v  (per ready node)
[3. Invariant Policy Gate + Capacity Tracker + Dial Mapper]
    |
    v
[4. Learned Route Scorer + Autonomy Gate]
    |
    v
[5. Evidence Graph + Attribution Engine + Belief Updater]
```

### Layer 1: Intent Decomposer

Decomposes user goals into an IntentGraph -- a DAG of typed work nodes with dependencies, iteration specs, and blocking relationships.

"20 security audit rounds" becomes an IntentGraph with shape `IterativeAudit`, 20+ nodes connected by `FeedsInto` edges.

"Plan-then-build" becomes `Planning -> FeedsInto -> FeatureImplementation`.

"Discuss-then-fix" becomes `Planning { requires_user_action: true } -> BlockedUntilUser -> BugFix`.

Each node gets its own routing decision. A 20-round audit at dial 8 does not mean 20x dial-8 cost -- later rounds are cheaper (narrower scope, incremental findings).

### Layer 2: Intent Scheduler

Tracks ready/blocked/waiting nodes. Routes around blocked work -- when a node blocks on user input, sibling nodes that are ready continue executing. Capacity reservation accounts for blocked nodes that may unblock soon.

The scheduler asks on each tick:
1. Which nodes are ready?
2. Which nodes are blocked?
3. Which blocked nodes have runnable siblings?
4. Which ready nodes fit the dial envelope?
5. Which ready nodes fit available capacity?
6. Which nodes require user confirmation?
7. Which nodes can proceed autonomously?

### Layer 3: Invariant Policy Gate + Capacity Tracker + Dial Mapper

Three sub-systems that must remain separate:

- **Invariant Policy Gate**: Privacy, auth, budget, evidence floor. Filters candidates before the learner sees them. The learner cannot override steps 1-6 of the policy stack.
- **Capacity Tracker**: Subscription registry, live capacity snapshots, reservations, fair-share allocation with priority classes.
- **Dial Mapper**: Converts dial level to investment envelope relative to the user's actual subscription pool. Dial is constraint on resource ceiling, preference on quality, and verification-depth selector.

### Layer 4: Learned Route Scorer + Autonomy Gate

- **Route Scorer**: UCB for v1 (deterministic, explainable, sufficient for small arm space). Thompson sampling with exploration temperature for v2.
- **Autonomy Gate**: Confidence threshold determines proceed/suggest/block per risk class. Thresholds are invariant policy -- the learner produces higher-confidence outputs by selecting better routes, which naturally leads to more autonomous operation.

### Layer 5: Evidence Graph + Attribution Engine + Belief Updater

- **Evidence Graph**: Append-only, typed nodes (Task, Attempt, Artifact, Event, Route) and edges (ProducedBy, VerifiedBy, SelectedBy, RevertedBy for v1).
- **Attribution Engine**: Contamination-aware, role-based causal credit assignment. Concrete types for v1, trait boundary only on BeliefStore.
- **Belief Updater**: Hierarchical beliefs (global -> tenant -> repo -> context) with three gates: minimum signal diversity, confidence floor per risk, signal freshness.

---

## Definitive Rust Types

### Layer 1: Intent Decomposition

```rust
/// The decomposed user goal as a directed acyclic graph.
/// Source: Opus Round 2 (new requirement), refined by GPT Round 2
#[derive(Debug, Clone)]
pub struct IntentGraph {
    pub intent_id: IntentId,                          // GPT Round 2
    pub shape: IntentShape,                            // GPT Round 2
    pub root_goal: String,                             // GPT Round 2
    pub nodes: BTreeMap<WorkNodeId, WorkNode>,         // GPT Round 2
    pub edges: Vec<IntentEdge>,                        // Opus Round 2
    pub blockers: BTreeMap<BlockerId, Blocker>,         // GPT Round 2
    pub ready_queue: BTreeSet<WorkNodeId>,              // GPT Round 2
    pub blocked_queue: BTreeSet<WorkNodeId>,            // GPT Round 2
    pub completed: BTreeSet<WorkNodeId>,                // GPT Round 2
    pub cancelled: BTreeSet<WorkNodeId>,                // GPT Round 2
    pub decomposed_at: time::OffsetDateTime,            // Opus Round 2
}

/// Individual work node within the intent graph.
/// Source: GPT Round 2
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
    pub iteration_spec: IterationSpec,                 // Opus Round 2
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

/// A node in the original Opus intent decomposition.
/// Source: Opus Round 2
#[derive(Debug, Clone)]
pub struct IntentNode {
    pub id: IntentNodeId,
    pub task_family: TaskFamily,
    pub description: String,
    pub iteration_spec: IterationSpec,
    pub requires_user_action: bool,
    pub confidence_threshold_for_autonomy: f64,
}

/// Edges between intent nodes.
/// Source: Opus Round 2
#[derive(Debug, Clone)]
pub struct IntentEdge {
    pub from: IntentNodeId,
    pub to: IntentNodeId,
    pub edge_type: IntentEdgeType,
}

/// How a node relates to its successor.
/// Source: Opus Round 2
#[derive(Debug, Clone)]
pub enum IntentEdgeType {
    Then,              // Sequential
    Parallel,          // Can run simultaneously
    FeedsInto,         // Output of A is input to B
    IteratesOver,      // B runs once per output of A
    BlockedUntilUser,  // B waits for user action after A
}

/// Iteration specification for repeated work.
/// Source: Opus Round 2
#[derive(Debug, Clone)]
pub enum IterationSpec {
    Once,
    NTimes(u32),
    UntilCondition { condition: String, max: u32 },
    UntilUserSatisfied { max: u32 },
}

/// Classified shape of the overall user intent.
/// Source: GPT Round 2 (new)
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

/// Kind of work a node represents.
/// Source: GPT Round 2 (new)
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
```

### Layer 2: Scoped Blocking and Scheduling

```rust
/// State of a work node in the scheduler.
/// Source: GPT Round 2 (new)
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

/// What kind of blocker is preventing progress.
/// Source: GPT Round 2 (new)
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

/// How wide the block extends.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockerScope {
    NodeOnly,   // Only this node is blocked
    Subtree,    // This node and its dependents
    Intent,     // The entire intent graph
    Global,     // All active intents
}

/// A concrete blocker attached to a work node.
/// Source: GPT Round 2 (new)
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

/// What must happen for a blocker to clear.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone)]
pub enum UnblockCondition {
    UserResponds,
    UserApproves,
    UserCompletesAction { expected_evidence: String },
    ExternalSignalObserved { evidence_kind: String },
    CapacityAvailable { provider: String },
    TimeElapsed { retry_after: SystemTime },
    ManualOverride,
}

/// Dependency between work nodes.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone)]
pub struct WorkDependency {
    pub from: WorkNodeId,
    pub to: WorkNodeId,
    pub dependency_kind: DependencyKind,
}

/// Type of dependency edge.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DependencyKind {
    MustCompleteBefore,
    ShouldCompleteBefore,
    BlocksIfFailed,
    ProvidesContext,
    ProvidesVerification,
    AlternativePath,
}

/// Scheduler configuration.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone)]
pub struct SchedulerPolicy {
    pub max_parallel_nodes: usize,
    pub route_around_blockers: bool,
    pub allow_speculative_context_gathering: bool,
    pub allow_parallel_verification: bool,
    pub ask_user_when_confidence_below: f32,
    pub flag_user_when_confidence_below: f32,
}

/// Result of a scheduler tick.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone)]
pub struct SchedulerDecision {
    pub runnable: Vec<WorkNodeId>,
    pub waiting: Vec<WorkNodeId>,
    pub ask_user: Vec<WorkNodeId>,
    pub deferred: Vec<WorkNodeId>,
    pub rationale: Vec<String>,
}
```

### Layer 3a: Invariant Policy Gate

```rust
/// Hard constraints the learner cannot override.
/// Source: Opus Round 1, refined by GPT Round 1
#[derive(Debug, Clone)]
pub struct RoutingConstraints {
    // INVARIANT -- never violated, not learned
    pub privacy: PrivacyPolicy,
    pub budget: BudgetCeiling,
    pub auth: AuthPolicy,
    pub evidence_floor: EvidenceFloor,

    // CONSTRAINT -- external reality, not policy
    pub capacity: SubscriptionCapacity,
    pub provider_health: ProviderHealth,
}

/// Privacy rules per provider.
/// Source: Opus Round 1
#[derive(Debug, Clone)]
pub struct PrivacyPolicy {
    pub denied_providers: HashSet<ProviderId>,
    pub sensitive_patterns: Vec<GlobPattern>,
    pub default_allow: bool,
}

/// Hard budget limits.
/// Source: Opus Round 1
#[derive(Debug, Clone)]
pub struct BudgetCeiling {
    pub per_task_max: f64,
    pub per_session_max: f64,
    pub per_day_max: f64,
    pub per_month_max: f64,
}

/// Risk classification levels.
/// Source: GPT Round 1 (invariant risk classification)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RiskClass {
    Low,
    Medium,
    High,
    Critical,
}

/// Evidence floor -- minimum verification by risk and task family.
/// Source: GPT Round 1 (wins: evidence floor as invariant)
#[derive(Debug, Clone)]
pub struct EvidenceFloor {
    pub risk: RiskClass,
    pub task_family: TaskFamily,
    pub requirements: Vec<EvidenceRequirement>,
    pub minimum_confidence_to_claim_verified: f64,
}

/// A single evidence requirement.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct EvidenceRequirement {
    pub kind: EvidenceRequirementKind,
    pub min_count: usize,
    pub required: bool,
}

/// Types of evidence that can be required.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum EvidenceRequirementKind {
    CompileOrTypecheck,
    ExistingTests,
    ReproTest,
    Build,
    RuntimeSmoke,
    IndependentReview,
    SecurityScan,
    LinkCheck,
    ExampleExecution,
    PublicApiCompatibility,
    HumanReview,
}

/// Risk signals detected from task context.
/// Source: GPT Round 1, with Opus correction (use glob patterns, not hard-coded booleans)
#[derive(Debug, Clone)]
pub struct RiskClassification {
    pub class: RiskClass,
    pub signals: RiskSignals,
    pub reasons: Vec<RiskReason>,
    pub confidence: f64,
}

/// Specific risk indicators.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct RiskSignals {
    pub touches_auth: bool,
    pub touches_payments: bool,
    pub touches_secrets: bool,
    pub touches_crypto: bool,
    pub touches_database_migration: bool,
    pub touches_permissions: bool,
    pub touches_prod_infra: bool,
    pub destructive_operation: bool,
    pub public_api_change: bool,
    pub user_data_access: bool,
}

/// Independence requirements per risk level.
/// Source: GPT Round 1 (wins: explicit constraint per risk)
#[derive(Debug, Clone)]
pub struct IndependenceRequirement {
    pub require_different_model: bool,
    pub require_different_provider: bool,
    pub require_no_patch_access_for_test_writer: bool,
}

/// Circuit breaker -- thresholds CONFIGURED, detection signals may be learned.
/// Source: Opus Round 1 (holds: configured not learned), merged with GPT Round 2
#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    pub provider: ProviderId,
    pub model: ModelId,
    pub error_window: Duration,        // 5 minutes
    pub error_threshold: f64,          // 0.3 (30% error rate)
    pub half_open_after: Duration,     // 60 seconds
    pub state: CircuitState,
}

/// Circuit breaker state machine.
/// Source: Opus Round 1
#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,                    // Normal operation
    Open { since: Instant },   // Blocking all requests
    HalfOpen { test_count: u32 }, // Allowing 1-2 test requests
}

/// Repo observability profile -- determines confidence ceiling.
/// Source: GPT Round 1 (wins: formal struct with confidence ceiling)
#[derive(Debug, Clone)]
pub struct RepoObservabilityProfile {
    pub has_tests: bool,
    pub has_ci: bool,
    pub has_typecheck: bool,
    pub has_compile_step: bool,
    pub has_lint: bool,
    pub has_build: bool,
    pub has_runtime_smoke: bool,
    pub has_static_analysis: bool,
    pub test_command: Option<String>,
    pub build_command: Option<String>,
    pub typecheck_command: Option<String>,
    pub lint_command: Option<String>,
    pub start_command: Option<String>,
    pub confidence_ceiling: f64,
}

impl RepoObservabilityProfile {
    pub fn compute_confidence_ceiling(&self) -> f64 {
        let mut ceiling: f64 = 0.25;
        if self.has_compile_step { ceiling += 0.15; }
        if self.has_typecheck { ceiling += 0.15; }
        if self.has_build { ceiling += 0.15; }
        if self.has_tests { ceiling += 0.25; }
        if self.has_ci { ceiling += 0.10; }
        if self.has_runtime_smoke { ceiling += 0.10; }
        ceiling.clamp(0.25, 0.95)
    }
}
```

### Layer 3b: Capacity Tracker and Subscription Registry

```rust
/// Rich subscription slot with auth, sharing, privacy, and model entitlements.
/// Source: GPT Round 1 (wins decisively over Opus's minimal version)
#[derive(Debug, Clone)]
pub struct ProviderSubscription {
    pub id: SubscriptionId,
    pub tenant_id: TenantId,
    pub owner: SubscriptionOwner,
    pub provider: ProviderId,
    pub auth_ref: AuthRef,
    pub plan: SubscriptionPlan,
    pub models: Vec<ModelEntitlement>,
    pub sharing_policy: SharingPolicy,
    pub privacy_policy: ProviderPrivacyPolicy,
    pub status: SubscriptionStatus,
    pub created_at: time::OffsetDateTime,
    pub updated_at: time::OffsetDateTime,
}

/// Who owns the subscription.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum SubscriptionOwner {
    User(UserId),
    Team(TeamId),
    Organization(OrgId),
}

/// How the subscription authenticates.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum AuthRef {
    OAuthToken { vault_key: String },
    ApiKey { vault_key: String },
    BrowserSession { vault_key: String },
    LocalCliCredential { worker_ref: String },
}

/// Subscription lifecycle status.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum SubscriptionStatus {
    Active,
    Expired,
    Revoked,
    RateLimited,
    Suspended,
    Unknown,
}

/// What a subscription's plan provides.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct SubscriptionPlan {
    pub label: String,
    pub monthly_price_usd: Option<f64>,
    pub hard_monthly_token_limit: Option<u64>,
    pub hard_monthly_request_limit: Option<u64>,
    pub provider_rate_limits: Vec<RateLimitSpec>,
    pub priority: ProviderPriority,
}

/// Per-model capabilities within a subscription.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct ModelEntitlement {
    pub model: ModelId,
    pub supports_tools: bool,
    pub supports_long_context: bool,
    pub supports_images: bool,
    pub supports_patch_output: bool,
    pub max_context_tokens: Option<u64>,
    pub max_output_tokens: Option<u64>,
    pub cost_hint: CostHint,
    pub quality_tier: QualityTier,
}

/// Model quality classification.
/// Source: GPT Round 1
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum QualityTier {
    Budget,
    Standard,
    Premium,
    Frontier,
}

/// Cost structure for a model.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum CostHint {
    SubscriptionIncluded,
    Metered { input_per_million: f64, output_per_million: f64 },
    Unknown,
}

/// Team sharing rules for a subscription.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct SharingPolicy {
    pub share_with_team: bool,
    pub max_concurrent_uses: usize,
    pub max_daily_uses_per_user: Option<u64>,
    pub fair_share_weight: f64,
    pub allow_high_dial: bool,
    pub allowed_repos: RepoAllowList,
}

/// Provider-level privacy rules.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct ProviderPrivacyPolicy {
    pub allow_raw_code: bool,
    pub allow_secret_redacted_code: bool,
    pub allow_training_by_provider: bool,
    pub data_retention: DataRetentionClass,
    pub allowed_regions: Vec<DataRegion>,
}

/// Subscription registry -- the pool of available providers.
/// Source: GPT Round 1 (rich version wins)
#[derive(Debug, Clone)]
pub struct SubscriptionRegistry {
    pub subscriptions: Vec<ProviderSubscription>,
}

/// Live capacity observation.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct CapacitySnapshot {
    pub subscription_id: SubscriptionId,
    pub provider: ProviderId,
    pub model: ModelId,
    pub availability: Availability,
    pub remaining: RemainingCapacity,
    pub cooldown_until: Option<time::OffsetDateTime>,
    pub observed_latency_ms_p50: Option<u64>,
    pub observed_latency_ms_p95: Option<u64>,
    pub recent_error_rate: f64,
    pub active_reservations: usize,
    pub updated_at: time::OffsetDateTime,
}

/// Provider availability state.
/// Source: GPT Round 1
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    Available,
    Degraded,
    RateLimited,
    Exhausted,
    AuthFailed,
    DisabledByPolicy,
    Unknown,
}

/// Capacity reservation with priority classes.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct CapacityReservation {
    pub id: ReservationId,
    pub subscription_id: SubscriptionId,
    pub model: ModelId,
    pub task_id: TaskId,
    pub user_id: UserId,
    pub estimated_input_tokens: u64,
    pub estimated_output_tokens: u64,
    pub estimated_duration_ms: u64,
    pub priority: ReservationPriority,
    pub expires_at: time::OffsetDateTime,
}

/// Priority classes for capacity allocation.
/// Required verification outranks optional dial expansion.
/// Source: GPT Round 1 (wins: priority-class preemption)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReservationPriority {
    BackgroundExploration,
    LowDialInteractive,
    NormalInteractive,
    HighDialInteractive,
    EvidenceFloorRequired,
    CriticalVerification,
}

/// Fair-share allocation with priority classes.
/// Source: Merged -- GPT's priority classes with Opus's borrow-from-pool
#[derive(Debug, Clone)]
pub struct FairShareAllocator {
    pub team_id: TeamId,
    pub members: Vec<FairShareAccount>,
    pub allocation_window: Duration,
}

/// Per-user fair share account.
/// Source: Merged
#[derive(Debug, Clone)]
pub struct FairShareAccount {
    pub user_id: UserId,
    pub team_id: TeamId,
    pub weight: f64,
    pub recent_consumption_units: f64,
    pub guaranteed_min_share: f64,
    pub burst_allowance: f64,
}
```

### Layer 3c: Dial Mapper

```rust
/// The dial -- 1-10 investment posture.
/// Source: Merged -- GPT's relative-to-pool abstraction with Opus's concrete envelope
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Dial(u8);

impl Dial {
    pub fn new(value: u8) -> anyhow::Result<Self> {
        if (1..=10).contains(&value) {
            Ok(Self(value))
        } else {
            anyhow::bail!("dial must be 1..=10")
        }
    }

    pub fn value(self) -> u8 {
        self.0
    }
}

/// Concrete resource envelope for a dial level.
/// Source: Opus Round 1 (wins: concrete operational meaning)
#[derive(Debug, Clone)]
pub struct ResourceEnvelope {
    pub max_cost: f64,                       // Relative to pool, not absolute dollars (GPT wins)
    pub max_parallel: u8,
    pub max_models: u8,
    pub verification_depth: VerificationDepth,
    pub allow_cross_provider: bool,
}

/// Dial-level policy parameters.
/// Source: GPT Round 1 (richer parameterization)
#[derive(Debug, Clone)]
pub struct DialPolicy {
    pub max_parallel_candidates: usize,
    pub max_verifier_passes: usize,
    pub max_planner_passes: usize,
    pub exploration_temperature: f64,
    pub cost_sensitivity: f64,
    pub latency_sensitivity: f64,
    pub allow_premium_models: bool,
    pub allow_full_fleet: bool,
    pub allow_shadow_counterfactuals: bool,
}

/// Cost budget relative to subscription pool.
/// Source: GPT Round 1 (wins: subscription-unit-relative, not absolute dollars)
#[derive(Debug, Clone)]
pub struct CostBudget {
    pub max_metered_usd: Option<f64>,
    pub max_subscription_units: f64,
    pub max_premium_calls: usize,
}

impl CostBudget {
    pub fn from_dial(dial: Dial, risk: RiskClass, pool: &AvailablePoolSummary) -> Self {
        let subscription_units = match dial.value() {
            1 => 1.0,   2 => 1.5,  3 => 2.0,   4 => 3.0,
            5 => 4.0,   6 => 5.5,  7 => 7.0,   8 => 9.0,
            9 => 12.0, 10 => 16.0, _ => 1.0,
        };
        let risk_multiplier = match risk {
            RiskClass::Low => 1.0,
            RiskClass::Medium => 1.25,
            RiskClass::High => 1.75,
            RiskClass::Critical => 2.5,
        };
        Self {
            max_metered_usd: None,
            max_subscription_units: subscription_units * risk_multiplier,
            max_premium_calls: pool.premium_model_count,
        }
    }
}

/// Summary of what the subscription pool can support.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct AvailablePoolSummary {
    pub available_model_count: usize,
    pub available_provider_count: usize,
    pub premium_model_count: usize,
    pub max_useful_parallelism: usize,
    pub supports_independent_provider_review: bool,
    pub supports_independent_model_review: bool,
    pub total_concurrent_slots: usize,
    pub tightest_constraints: Vec<PoolConstraint>,
}
```

### Layer 4a: Route Templates and Selection

```rust
/// Route template identifier -- 10+ fixed templates.
/// Source: Merged -- GPT's staged structure, Opus's template count
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RouteTemplateId {
    SoloFast,              // Dial 1-3: cheapest model, minimal verification
    SoloCareful,           // Dial 2-4: single model with lint/typecheck
    Cascade,               // Dial 2-4: try cheap first, escalate on failure
    BestSingle,            // Dial 3-6: best available single model
    PlanThenExecute,       // Dial 4-7: planner + implementer
    ImplementThenReview,   // Dial 4-8: generator + independent reviewer + refiner
    TestFirstIndependent,  // Dial 5-10: test writer (issue-only) + implementer + verifier
    CrossModelVerify,      // Dial 6-9: different-provider verification
    ParallelCandidates,    // Dial 7-10: parallel fleet + arbiter
    HumanCheckpoint,       // Dial 7-10: includes explicit human approval gate
    FullCriticalPath,      // Dial 8-10: planner + parallel + arbiter + verifier + review
    DualBrainSynthesis,    // Dial 9-10: cross-provider synthesis (not just review)
}

/// Structured route template with typed stages.
/// Source: GPT Round 1 (wins: stage-level composition)
#[derive(Debug, Clone)]
pub struct RouteTemplate {
    pub id: RouteTemplateId,
    pub name: &'static str,
    pub min_dial: u8,
    pub max_dial: u8,
    pub supported_task_families: Vec<TaskFamily>,
    pub max_parallel_attempts: usize,
    pub requires_independent_verifier: bool,
    pub stages: Vec<RouteStageTemplate>,
}

/// A single stage within a route template.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct RouteStageTemplate {
    pub stage_id: &'static str,
    pub role: AttemptRole,
    pub candidate_count: CandidateCount,
    pub input_policy: StageInputPolicy,
    pub output_contract: OutputContract,
}

/// How many candidates to run at a stage.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum CandidateCount {
    One,
    DialScaled { min: usize, max: usize },
    Fixed(usize),
}

/// What context a stage receives -- enables per-stage privacy evaluation.
/// Source: GPT Round 1 (wins: per-stage privacy)
#[derive(Debug, Clone)]
pub enum StageInputPolicy {
    FullContext,
    IssueOnly,
    DiffOnly,
    PlanOnly,
    PatchAndLogs,
    RedactedSummaryOnly,
}

/// What a stage must produce.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub enum OutputContract {
    Plan,
    Patch,
    Review,
    TestPlan,
    TestPatch,
    Verdict,
    FinalAnswer,
}

/// Roles within a route execution.
/// Source: GPT Round 1
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AttemptRole {
    PrimaryGenerator,
    ParallelCandidate,
    Planner,
    Implementer,
    Reviewer,
    TestWriter,
    Verifier,
    Refiner,
    Arbiter,
}

/// Task family classification.
/// Source: GPT Round 1
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaskFamily {
    BugFix,
    FeatureImplementation,
    Refactor,
    Docs,
    TestWriting,
    Debugging,
    CodeReview,
    Migration,
    Performance,
    Security,
    Planning,
    Unknown,
}

/// Rich task features for difficulty normalization.
/// Source: GPT Round 1 (wins: required for preventing difficulty confounding)
#[derive(Debug, Clone)]
pub struct TaskFeatures {
    pub family: TaskFamily,
    pub risk: RiskClass,
    pub language: Option<String>,
    pub framework: Option<String>,
    pub repo_size_bucket: SizeBucket,
    pub diff_size_estimate: SizeBucket,
    pub files_touched_estimate: SizeBucket,
    pub requires_runtime: bool,
    pub requires_external_services: bool,
    pub auth_sensitive: bool,
    pub payment_sensitive: bool,
    pub data_migration: bool,
    pub ambiguous_requirement_score: f64,
    pub observability: RepoObservabilityProfile,
}
```

### Layer 4b: Learned Scoring and Autonomy

```rust
/// Contextual belief key -- beliefs are contextual, not global.
/// Source: GPT Round 1 (wins: prevents misleading global learning)
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct RouteBeliefKey {
    pub task_family: TaskFamily,
    pub repo_profile_bucket: RepoProfileBucket,
    pub risk_class: RiskClass,
    pub model_id: ModelId,
    pub strategy_id: StrategyId,
}

/// Route belief -- posterior estimate per context bucket.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct RouteBelief {
    pub key: RouteBeliefKey,
    pub mean_reward: f64,
    pub uncertainty: f64,
    pub evidence_count: u64,
    pub effective_sample_size: f64,
    pub last_updated_at: time::OffsetDateTime,
}

/// Hierarchical belief -- global > tenant > repo > context.
/// Source: GPT Round 1 (wins: enables local specialization)
#[derive(Debug, Clone)]
pub struct HierarchicalBelief {
    pub global: RouteBelief,
    pub tenant: Option<RouteBelief>,
    pub repo: Option<RouteBelief>,
    pub context: Option<RouteBelief>,
}

/// v1 route scoring: UCB (deterministic, explainable).
/// Source: GPT Round 1 (wins for v1: deterministic, easy to debug)
pub fn ucb_score(mean: f64, uncertainty: f64, exploration: f64) -> f64 {
    mean + exploration * uncertainty
}

/// v2 route scoring: Thompson sampling with exploration temperature.
/// Source: GPT Round 1 (normal variant, extends to multi-dimensional reward)
pub struct ThompsonRouteScorer {
    pub exploration_temperature: f64,
}

/// Exploration modes that scale with dial.
/// Source: GPT Round 1 (wins: exploration cost proportional to investment)
#[derive(Debug, Clone)]
pub enum ExplorationMode {
    None,
    CheapShadowReview,
    ShadowPlanOnly,
    ParallelCandidate,
    FullCounterfactual,
}

/// Confidence score with calibrated band.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone, Copy)]
pub struct ConfidenceScore {
    pub value: f32,
    pub band: ConfidenceBand,
    pub calibrated_at: SystemTime,
}

impl ConfidenceScore {
    pub fn from_value(value: f32, calibrated_at: SystemTime) -> Self {
        let bounded = value.clamp(0.0, 1.0);
        let band = if bounded < 0.45 { ConfidenceBand::Low }
            else if bounded < 0.75 { ConfidenceBand::Medium }
            else if bounded < 0.95 { ConfidenceBand::High }
            else { ConfidenceBand::Certain };
        Self { value: bounded, band, calibrated_at }
    }
}

/// Confidence band classification.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfidenceBand {
    Low,
    Medium,
    High,
    Certain,
}

/// Components that feed into confidence.
/// Source: GPT Round 2 (new)
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
        let positive = self.task_understanding + self.repo_context + self.tool_feedback
            + self.test_coverage + self.independent_verification + self.user_preference_match;
        let negative = self.risk_penalty + self.ambiguity_penalty + self.stale_context_penalty;
        ((positive / 6.0) - (negative / 3.0)).clamp(0.0, 1.0)
    }
}

/// Autonomy decision for a work node.
/// Source: GPT Round 2 (new), Opus Round 2 (AutonomyPolicy)
#[derive(Debug, Clone)]
pub struct AutonomyDecision {
    pub policy: ConfirmationPolicy,
    pub confidence: ConfidenceScore,
    pub risk_class: RiskClass,
    pub rationale: Vec<String>,
    pub required_user_question: Option<String>,
}

/// What confirmation is required before proceeding.
/// Source: GPT Round 2 (new)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmationPolicy {
    ProceedAutonomously,
    ProceedAndFlag,
    AskBeforeProceeding,
    RequireExplicitApproval,
    Forbidden,
}

/// Invariant autonomy thresholds per risk class. The learner MUST NOT lower these.
/// Source: Opus Round 2 (new requirement)
#[derive(Debug, Clone)]
pub struct AutonomyPolicy {
    pub thresholds: HashMap<RiskClass, AutonomyThreshold>,
}

/// Per-risk confidence thresholds for autonomy decisions.
/// Source: Opus Round 2
#[derive(Debug, Clone)]
pub struct AutonomyThreshold {
    pub auto_proceed_above: f64,    // Confidence above this: no confirmation
    pub suggest_above: f64,         // Above this: suggest, wait for confirmation
    pub block_below: f64,           // Below this: refuse to proceed
}

impl Default for AutonomyPolicy {
    fn default() -> Self {
        let mut thresholds = HashMap::new();
        thresholds.insert(RiskClass::Low, AutonomyThreshold {
            auto_proceed_above: 0.6, suggest_above: 0.3, block_below: 0.1,
        });
        thresholds.insert(RiskClass::Medium, AutonomyThreshold {
            auto_proceed_above: 0.75, suggest_above: 0.5, block_below: 0.2,
        });
        thresholds.insert(RiskClass::High, AutonomyThreshold {
            auto_proceed_above: 0.9, suggest_above: 0.7, block_below: 0.4,
        });
        thresholds.insert(RiskClass::Critical, AutonomyThreshold {
            auto_proceed_above: 0.95, suggest_above: 0.85, block_below: 0.6,
        });
        thresholds
    }
}

/// Why a candidate was not selected -- prevents stale beliefs from capacity issues.
/// Source: GPT Round 1 (wins: critical for preventing quota bias)
#[derive(Debug, Clone)]
pub enum NonSelectionReason {
    LowerExpectedUtility,
    CapacityUnavailable,
    BudgetExceeded,
    PrivacyBlocked,
    AuthUnavailable,
    UserProviderLock,
    EvidenceFloorRequiresOtherRole,
}
```

### Layer 5: Evidence Graph and Attribution

```rust
/// The 31-variant signal taxonomy.
/// Source: GPT Round 1 (wins: granularity matters for different weights)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SignalKind {
    ExistingTestsPass,
    ExistingTestsFail,
    ReproTestBeforeFailsAfterPasses,
    CompilePass,
    CompileFail,
    TypecheckPass,
    TypecheckFail,
    LintPass,
    LintFail,
    BuildPass,
    BuildFail,
    RuntimeSmokePass,
    RuntimeSmokeFail,
    SecurityScanPass,
    SecurityScanFail,
    HumanReviewApprove,
    HumanReviewReject,
    IndependentModelReviewPass,
    IndependentModelReviewFail,
    UserAccept,
    UserReject,
    Merged,
    Reverted,
    FollowupFixSameScope,
    NoRevertAfterWindow,
    ProductionIncidentLinked,
    AgentSelfReport,
    GeneratedTestsPass,
    GeneratedTestsFail,
    DocsLinkValid,
    DocsLinkBroken,
    BenchmarkImproved,
    BenchmarkRegressed,
}

/// 5-tier signal taxonomy with contamination as cross-cutting.
/// Source: GPT Round 1 (wins over Opus's 3-tier)
///
/// Tier 0: Policy/eligibility -- not rewards, decide validity
/// Tier 1: Hard objective -- strongest positive/negative signals
/// Tier 2: Independent verification -- strong but slightly below Tier 1
/// Tier 3: Stability -- delayed, absence-of-negative
/// Tier 4: Weak subjective -- auxiliary evidence only
/// Tier 5 (cross-cutting): Contamination -- reduces confidence in other tiers

/// 3-dimensional signal weight.
/// Source: GPT Round 1 (wins: separates reward from confidence from contamination)
#[derive(Debug, Clone, Copy)]
pub struct SignalWeight {
    pub reward: f64,
    pub confidence: f64,
    pub contamination_penalty: f64,
}

/// Signal reliability classification (retained from Opus as operational field).
/// Source: Opus Round 1 (adopted by GPT Round 2 as complementary)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SignalReliability {
    Hard,       // Deterministic, machine-verifiable
    Soft,       // Heuristic, informative but gameable
    Behavioral, // Human-generated, weakest signal
}

/// An evidence event in the append-only ledger.
/// Source: GPT Round 1 (wins: full evidence graph)
#[derive(Debug, Clone)]
pub struct EvidenceEvent {
    pub id: EvidenceEventId,
    pub task_id: TaskId,
    pub observed_at: time::OffsetDateTime,     // When Cortex learned about it
    pub event_time: time::OffsetDateTime,      // When it actually happened
    pub source: EvidenceSource,
    pub kind: SignalKind,
    pub scope: EvidenceScope,
    pub value: EvidenceValue,
    pub provenance: Provenance,
    pub contamination: ContaminationProfile,
    pub linked_artifacts: Vec<ArtifactId>,
    pub linked_attempts: Vec<AttemptId>,
}

/// Contamination profile -- cross-cutting concern applied to all tiers.
/// Source: GPT Round 1 (wins: multiplicative penalty, not per-signal hack)
#[derive(Debug, Clone)]
pub struct ContaminationProfile {
    pub same_model_as_generator: bool,
    pub same_provider_as_generator: bool,
    pub saw_generated_patch: bool,
    pub saw_agent_rationale: bool,
    pub generated_by_attempt: Option<AttemptId>,
    pub user_confirmed_without_execution: bool,
    pub dirty_workspace: bool,
    pub truncated_logs: bool,
    pub synthetic_only: bool,
}

impl ContaminationProfile {
    pub fn penalty(&self) -> f64 {
        let mut p: f64 = 0.0;
        if self.same_model_as_generator   { p += 0.25; }
        if self.same_provider_as_generator { p += 0.10; }
        if self.saw_generated_patch        { p += 0.15; }
        if self.saw_agent_rationale        { p += 0.10; }
        if self.user_confirmed_without_execution { p += 0.20; }
        if self.dirty_workspace            { p += 0.20; }
        if self.truncated_logs             { p += 0.15; }
        if self.synthetic_only             { p += 0.25; }
        p.clamp(0.0, 0.9)
    }
}

/// Attribution update -- the unit of belief change.
/// Source: GPT Round 1
#[derive(Debug, Clone)]
pub struct AttributionUpdate {
    pub update_id: uuid::Uuid,
    pub task_id: TaskId,
    pub attempt_id: AttemptId,
    pub route_id: RouteId,
    pub model_id: ModelId,
    pub strategy_id: StrategyId,
    pub event_id: EvidenceEventId,
    pub reward_delta: f64,
    pub confidence_delta: f64,
    pub credit_window: CreditWindow,
    pub reason: AttributionReason,
    pub created_at: time::OffsetDateTime,
}

/// Role-based credit assignment per evidence event.
/// Source: GPT Round 1 (wins: essential for model-role specialization)
/// Constraint: causal_weight sum MUST be <= 1.0 per event (Opus correction)
#[derive(Debug, Clone)]
pub struct CreditAssignment {
    pub attempt_id: AttemptId,
    pub role: AttemptRole,
    pub causal_weight: f64,  // Sum across all assignments for one event <= 1.0
    pub reward_delta: f64,
    pub confidence: f64,
}

/// Revert cause classification -- different causes get different penalties.
/// Source: GPT Round 1 (wins over Opus's blanket -2.0)
#[derive(Debug, Clone)]
pub enum RevertCause {
    FunctionalRegression,
    SecurityRegression,
    PerformanceRegression,
    ProductChange,
    MergeConflict,
    FlakyTest,
    StylePreference,
    Unknown,
}

/// Test origin tracking for evidence quality.
/// Source: GPT Round 1 (wins: more granular than Opus's multiplier approach)
#[derive(Debug, Clone)]
pub enum TestOrigin {
    ExistingRepoTest,
    HumanWritten,
    GeneratedBeforePatch { model: ModelId, attempt_id: AttemptId },
    GeneratedAfterPatch { model: ModelId, attempt_id: AttemptId },
    GeneratedByImplementer { model: ModelId, attempt_id: AttemptId },
}

/// Evidence quality model -- 6 dimensions for v2, ceiling-based for v1.
/// Source: Merged -- Opus ceiling for v1, GPT's full model for v2
#[derive(Debug, Clone)]
pub struct EvidenceQuality {
    pub objectivity: f64,
    pub independence: f64,
    pub reproducibility: f64,
    pub scope_match: f64,
    pub contamination: f64,
    pub observability: f64,
}

impl EvidenceQuality {
    pub fn effective_confidence(&self, base_confidence: f64) -> f64 {
        let positive = self.objectivity * self.independence * self.reproducibility
            * self.scope_match * self.observability;
        let contamination_multiplier = 1.0 - self.contamination.clamp(0.0, 0.95);
        (base_confidence * positive * contamination_multiplier).clamp(0.0, 1.0)
    }
}

/// Belief store trait -- concrete types for v1, trait for testing.
/// Source: Merged -- GPT's interface, Opus's pragmatism
pub trait BeliefStore {
    fn append_update(&mut self, update: AttributionUpdate) -> anyhow::Result<()>;
    fn current_belief(&self, key: &RouteBeliefKey) -> anyhow::Result<Option<RouteBelief>>;
    fn updates_for_attempt(&self, attempt_id: AttemptId) -> anyhow::Result<Vec<AttributionUpdate>>;
}

/// Evidence graph edge types.
/// Source: GPT Round 1 (v1 subset: ProducedBy, VerifiedBy, SelectedBy, RevertedBy)
#[derive(Debug, Clone)]
pub enum EvidenceEdgeKind {
    ProducedBy,
    VerifiedBy,
    FailedOn,
    PassedOn,
    RevertedBy,
    SupersededBy,
    SameScopeAs,
    DependsOn,     // v2
    Contradicts,   // v2
}

/// Finalization windows for signal collection.
/// Source: Opus Round 1 (adopted: concrete timing model)
pub struct FinalizationWindow {
    pub window: Duration,
    pub signal_types: Vec<SignalType>,
    pub required: bool,
}

// Default windows:
// Immediate (0-10s):   compile, lint
// Short (10s-2min):    test suite
// Medium (2-30min):    CI pipeline
// Long (30min-7d):     PR merge/revert, production incidents

/// Three gates before updating beliefs.
/// Source: Opus Round 1 (adopted by GPT Round 2)
pub enum BeliefUpdateDecision {
    Update(f64),           // Go ahead, here's the reward
    Defer(&'static str),   // Don't update yet, reason
    Decay(f64),            // Update with decay factor
}
// Gate 1: Minimum signal diversity (at least 1 hard signal)
// Gate 2: Confidence floor per task risk
// Gate 3: Signal freshness (decay for signals >24h old)
```

---

## Conflict Resolution Summary

| # | Decision | Opus R1 | GPT R1 | Verdict | Rationale |
|---|----------|---------|--------|---------|-----------|
| 1 | Signal taxonomy tiers | 3 tiers (Hard/Soft/Behavioral) | 5 tiers + contamination | **GPT wins** | Separating reward from confidence from contamination is more principled |
| 2 | Signal weight dimensionality | 1D (single weight) | 3D (reward, confidence, contamination_penalty) | **GPT wins** | Single weight conflates distinct concepts |
| 3 | Signal enumeration granularity | 11 signal variants | 31 signal kinds | **GPT wins** | Different signal kinds need different weights |
| 4 | Reward computation | Weighted average scalar | 6-axis reward vector | **Merge** | Two-axis (correctness, experience) for v1; expand to 6 in v2 |
| 5 | Evidence graph structure | Flat SignalCollector | Full typed graph with nodes/edges | **GPT wins** | Causal traceability and multi-attempt credit require graph |
| 6 | Multi-attempt credit assignment | Not addressed | Role-based causal weights | **GPT wins** | Essential for learning model-role specialization |
| 7 | Causal weight sum constraint | N/A | Allows >1.0 for failures | **Opus correction** | Cap at 1.0 per event even for failures; prevents double-penalization |
| 8 | Risk classification boundary | Learned from file paths | Invariant policy, learned-assisted | **GPT wins** | Auth bugs are asymmetric; absence of failure is weak evidence |
| 9 | Risk pattern implementation | File path learning | Boolean struct with 10 fields | **Merge** | GPT's principle (invariant floor) + configurable glob patterns (not hard-coded booleans) |
| 10 | Route template structure | Enum with 8 named variants | Struct with typed stages, roles, input policies | **GPT wins** | Stage-level composition enables per-stage privacy and independence |
| 11 | Template count | 8 templates | 4 templates | **Opus wins** | 4 too few; real scenarios need 10+ covering cascade, dual-brain, explore-then-implement |
| 12 | Template selection algorithm v1 | Thompson sampling | UCB (debug-friendly) | **GPT wins** | UCB is deterministic, explainable, sufficient for small arm space |
| 13 | Template selection algorithm v2 | Thompson w/ Beta distribution | Thompson w/ Normal + exploration_temperature | **GPT wins** | Normal sampling extends to multi-dimensional reward |
| 14 | Exploration rate | Static 5% with boost for new models | Tiered modes scaling with dial | **GPT wins** | Exploration cost should scale with dial investment |
| 15 | Exploration rate as separate gate | Yes (redundant with Thompson) | No | **Opus self-correction** | Thompson intrinsically handles explore/exploit; separate gate is wrong |
| 16 | Dial mapping abstraction | Absolute dollar amounts | Subscription-unit-relative | **GPT wins** | Must scale with actual user capacity |
| 17 | Dial as constraint vs preference | Hard cost ceiling | Both (ceiling on resources, preference on quality) | **Merge** | Both correct at different layers; need explicit separation |
| 18 | Evidence floor vs dial | Floor is invariant, dial cannot lower | Same position | **Aligned** | Both agree: dial NEVER weakens evidence floor |
| 19 | Subscription registry richness | Minimal (provider, tier, rate_limit) | Rich (auth, sharing, privacy, model entitlements) | **GPT wins** | Real-world subscriptions are complex |
| 20 | Per-stage privacy evaluation | Template-level binary | Per-stage based on input policy | **GPT wins** | Expands provider pool without compromising privacy |
| 21 | Cold start strategy | Progressive unlock, 20-task threshold | Global priors, risk-gated exploration | **Merge** | GPT's priors + Opus user messaging + statistical significance per task family |
| 22 | Team fair allocation priority | Flat pool with borrow | Priority-class preemption | **GPT wins** | Required verification must preempt optional dial expansion |
| 23 | Revert cause classification | Single -2.0 penalty | Cause-specific weights | **GPT wins** | Product-change reverts should not penalize model quality |
| 24 | Evidence quality model | Confidence ceiling by signal presence | 6-dimensional quality model | **Merge** | Ceiling for v1, full quality model for v2; contamination as cross-cutting v1 |
| 25 | Repo observability profile | Mentioned but not modeled | Formal struct with confidence ceiling | **GPT wins** | Essential for calibrating confidence claims |
| 26 | Non-selection reason tracking | Not addressed | Explicit enum with learning implications | **GPT wins** | Prevents stale beliefs from capacity unavailability |
| 27 | Route decision transparency | Format string | Structured audit with candidate reasons | **GPT wins** | Both needed: structured audit + user-facing format |
| 28 | Task feature richness | Minimal TaskShapeKey | Rich TaskFeatures with difficulty dimensions | **GPT wins** | Required for difficulty normalization |
| 29 | Independence requirements | Implicit via template | Explicit constraint per risk level | **GPT wins** | Auditable constraint better than implicit template design |
| 30 | Circuit breaker thresholds | Configured, not learned | Not explicitly addressed | **Opus holds** | Learning the threshold creates meta-learning problems |
| 31 | Finalization windows | Explicit required/optional windows | Temporal ledger with observed_at/event_time | **Merge** | Both needed: windows for collection, dual timestamps for audit |
| 32 | Feedback loop prevention | Cross-model verification, always-pass decay | Winner-starvation, difficulty confounding, self-fulfilling verification, quota bias | **GPT wins** | GPT identified 4 distinct feedback loop types vs Opus's 2 |
| 33 | Agent-written test handling | Weight multiplier (anchor 2x, human 3x) | TestOrigin enum with test_evidence_quality | **GPT wins** | More granular origin tracking enables better quality assessment |
| 34 | Arbitrary user intents | Not addressed | Not addressed | **New (both)** | IntentGraph with decomposition, iteration, and dependency edges |
| 35 | Scoped blocking | Not addressed | Not addressed | **New (both)** | IntentScheduler with runnable/blocked node tracking and blocker scope |
| 36 | Confidence-based autonomy | Not addressed | Not addressed | **New (both)** | AutonomyPolicy as invariant thresholds per risk class |
| 37 | v1 implementation priority | Thompson sampling first | UCB first, clean evidence graph | **GPT wins** | "Simple learner on clean evidence > sophisticated learner on bad evidence" |
| 38 | Numeric baseline weights | Not provided | Default weights for all 31 signals | **Adopt Opus/GPT** | v1 needs transparent defaults; GPT provided comprehensive set |
| 39 | Confidence ceiling by signal type | Explicit presence-based ceiling | Part of 6D quality model | **Adopt Opus for v1** | Prevents weak signals from producing high-confidence updates |
| 40 | Cross-model verification at high dial | dial >= 7, anchor 2x, human 3x | Independent verification as tier | **Adopt Opus** | Makes independent verification operational with concrete thresholds |
| 41 | Temporal evidence model | Finalization windows with timeouts | Append-only ledger with compensating updates | **GPT wins** | Append-only with compensating updates is architecturally cleaner |
| 42 | User approval weight | 0.1 (appropriately low) | 0.12 reward, 0.25 confidence, 0.10 contamination | **Aligned** | Both agree: user approval is weak, useful only for preference learning |
| 43 | Belief hierarchy | Template-level only | Global > tenant > repo > context | **GPT wins** | Prevents misleading global learning |
| 44 | Model-role pair learning | Not addressed | Explicit ModelRoleKey | **GPT wins** | Captures "great reviewer, mediocre implementer" distinctions |
| 45 | Route around blocks | Not addressed | Not addressed | **New (GPT R2)** | Scheduler routes ready siblings while blocked nodes wait |

### Scorecard

| Category | Opus Wins | GPT Wins | Merge | Aligned | New from Both |
|----------|-----------|----------|-------|---------|---------------|
| Count    | 3         | 27       | 8     | 2       | 5             |

GPT-5.5 produced a substantially more thorough and better-reasoned design. Opus's key contributions: template count (10+ vs 4), circuit breaker thresholds as configured, causal weight cap at 1.0, finalization windows, and confidence ceiling model for v1.

---

## Build Sequence

### v0.1: Foundation (weeks 1-3)

- Core ID types and error types
- `RiskClass`, `TaskFamily`, `SignalKind` enums
- `RoutingConstraints` and `EvidenceFloor` with default evidence floors
- `RepoObservabilityProfile` with confidence ceiling computation
- `CircuitBreaker` state machine
- Append-only `EvidenceEvent` storage (SQLite)
- `RouteTemplate` registry with 4 built-in templates (SoloFast, BestSingle, ImplementThenReview, TestFirstIndependent)
- Basic `Dial` and `ResourceEnvelope` mapping

### v0.2: Policy Gate and Capacity (weeks 4-6)

- `SubscriptionRegistry` with `ProviderSubscription`
- `CapacitySnapshot` and `CapacityReservation`
- `InvariantPolicy` trait with privacy, auth, budget, evidence floor enforcement
- `RiskClassification` with invariant floor from glob patterns
- `IndependenceRequirement` per risk level
- Per-stage privacy evaluation (`stage_privacy_allowed`)
- `FairShareAllocator` with priority classes
- `NonSelectionReason` tracking

### v0.3: UCB Scoring and Attribution (weeks 7-9)

- `RouteBeliefKey` and `RouteBelief` storage
- `HierarchicalBelief` with blended scoring
- UCB route scorer
- `EvidenceEvent` ingestion pipeline
- `ContaminationProfile` and penalty computation
- `CreditAssignment` with role-based causal weights (capped at 1.0)
- `AttributionUpdate` append and belief materialization
- Three belief update gates (diversity, confidence floor, freshness)
- `RevertCause` classification
- `RouteDecisionAudit` for transparency

### v0.4: Intent Graph and Scheduling (weeks 10-12)

- `IntentGraph` decomposition from user goals
- `IntentShape` classification
- `WorkNode`, `WorkNodeState`, `WorkDependency`
- `Blocker`, `BlockerScope`, `UnblockCondition`
- `IntentScheduler` with ready/blocked queue management
- Route-around-blocks: continue sibling nodes while blocked nodes wait
- Capacity reservation for potentially-unblocking nodes

### v0.5: Autonomy and Self-Healing (weeks 13-15)

- `ConfidenceScore` and `ConfidenceWeights` computation
- `AutonomyPolicy` with invariant thresholds per risk class
- `AutonomyDecision` and `ConfirmationPolicy`
- Integration: scheduler uses autonomy gate to decide proceed/ask/block
- Self-healing: failed routes create evidence, update confidence, may spawn recovery nodes
- Expand to 10+ route templates

### v1.0: Production (weeks 16-20)

- Full `TaskFeatures` with difficulty normalization
- `TestOrigin` tracking and `test_evidence_quality` scoring
- `ExplorationMode` tiered by dial level
- Finalization windows for signal collection
- Delayed evidence jobs (CI, merge, revert, follow-up fixes)
- `StabilityPolicy` with risk-based windows
- Route decision explanation (structured audit + user-facing format)
- Cold start with global priors and progressive user messaging
- Full integration testing of the 5-layer pipeline

### v2.0: Advanced Learning (weeks 21+)

- Thompson sampling with exploration temperature (replace UCB)
- Multi-dimensional reward vector (correctness, usefulness, cost_efficiency, latency, user_preference)
- Full 6-dimensional `EvidenceQuality` model (replace ceiling-based)
- `ModelRoleKey` learning (model-role specialization)
- Shadow counterfactual evaluation at high dial
- Composable template discovery in shadow mode
- Dynamic task family expansion
- Drift detection on beliefs (detect model degradation)

---

## Key Algorithms

### v1 Route Selection Pipeline

```
1. Receive RoutingRequest (task, dial, user, repo)
2. InvariantPolicy.evaluate() -> PolicyDecision
   - Risk classification (invariant floor from glob patterns)
   - Privacy filtering (per-stage, not per-template)
   - Budget check
   - Evidence floor determination
   - Independence requirements
3. CapacityTracker.snapshot() -> available providers
4. CircuitBreaker.filter() -> healthy providers
5. Dial.to_envelope() -> ResourceEnvelope (relative to pool)
6. TemplateRegistry.eligible() -> templates within dial + capacity
7. For each template:
   a. Instantiate with available models per stage
   b. Check evidence floor satisfaction
   c. Check budget feasibility
   d. Check independence requirements
8. UCB score each feasible candidate
9. AutonomyGate.evaluate() -> proceed / suggest / block
10. Reserve capacity
11. Execute route
12. Collect evidence through finalization windows
13. Attribution pipeline -> belief updates (gated)
```

### Confidence-to-Autonomy Mapping

```
High confidence + low/medium risk    => ProceedAutonomously
Medium confidence + low/medium risk  => ProceedAndFlag
Low confidence                       => AskBeforeProceeding
High risk + medium confidence        => AskBeforeProceeding
Critical risk                        => RequireExplicitApproval
                                        (unless routine safe action)
Below block threshold                => Forbidden (explain why)
```

### Evidence Floor by Task and Risk

```
BugFix + Low:      compile (required)
BugFix + Medium:   compile (required) + existing tests (required) + repro test (optional)
BugFix + High:     compile + existing tests + repro test + independent review (all required)
Security + Any:    compile + existing tests + security scan + independent review (all required)
Docs + Any:        link check (optional) + example execution (optional)
Refactor + High:   compile + existing tests + public API compat + independent review (all required)
Default:           compile (optional) + existing tests (optional)
```

---

## What LEARNED vs What INVARIANT

### Learned

- Which provider/model performs best for task family and repo profile
- Which route template works best for a task shape
- Which model is best at each role (planning, coding, review, tests)
- How much parallelism is worth it for a task type under a dial setting
- Which verification strategy finds real issues
- Which prompt template performs best
- Which model handles a language/framework better
- Which model tends to over-edit or produce patches that revert
- Which provider is degraded right now (from observed evidence)

### Invariant (never learned, never bent)

- Privacy constraints
- Provider authorization
- Tenant boundaries
- Budget hard caps
- Evidence floor per risk class
- Minimum independence requirements for high risk
- Risk classification floor (auth/payments/secrets = at least High)
- Circuit breaker thresholds
- Autonomy thresholds per risk class
- Audit logging
- Claims policy (what Cortex may say is "verified")
- Maximum blast radius without explicit approval

### The Boundary

| Concept | Invariant Part | Learned Part |
|---------|---------------|-------------|
| "Auth code needs stronger verification" | Evidence floor for High/Critical risk | Which auth tasks are easier than others |
| "This model is degraded" | Circuit breaker response (stop routing) | Error rate detection that triggers the breaker |
| "Explore 10% to new models" | Exploration is policy (configured rate) | Outcomes of exploration update beliefs normally |
| Route templates | Template schemas are configured/auditable | Which template works best is learned |
| The dial | Hard ceiling on resources | Quality preference within the ceiling |
| "This file is auth-sensitive" | Glob pattern floor (never below High) | Learned classifiers can raise risk, never lower |

---

## Route Decision Transparency

Every route must produce an explanation that separates constraints from preferences.

Bad: "Used Claude because it is best."

Good: "Used Claude Sonnet as primary because it has the strongest prior for TypeScript bug fixes in this repo profile. Used GPT as independent reviewer because the task touched auth code and policy requires independent verification. Did not use Gemini because the team privacy policy blocks providers with unknown retention for this repo. Dial 6 allowed one reviewer but not a full parallel fleet."

The structured audit (`RouteDecisionAudit`) powers both system introspection and user-facing explanations.

---

## Self-Healing Behavior

Self-healing means:

1. Failed route creates evidence
2. Evidence updates confidence
3. Confidence may downgrade autonomy
4. Scheduler may spawn a verifier, refiner, or alternate route
5. Repeated failure may trigger a circuit breaker
6. Blocked work is bypassed where possible
7. Stale assumptions are rechecked
8. Delayed negative evidence corrects prior beliefs via compensating updates

The system does not blindly continue. It continues intelligently inside policy.

---

## Concrete Example Routes

### Solo user, one $20 sub, dial 1, low-risk docs fix

- Route: SoloFast. Single model, link check if available.
- Evidence: link valid (moderate positive), user accept (weak preference).
- Confidence: limited by observability. No claim beyond "docs checked."

### Solo user, one $20 sub, dial 10, medium bugfix

- Route: BestSingle or ImplementThenReview (if model variants available on same provider).
- Different-provider independent review unavailable.
- Transparency: "Dial 10 used maximum available pool, but only one provider connected. Independent-provider review unavailable, so confidence is limited."

### Team, eight premium subs, dial 10, auth refactor

- Route: FullCriticalPath. Planner on strongest reasoning model. 2-3 parallel implementers across providers. Test writer sees issue only (IssueOnly input policy). Arbiter selects candidate. Independent verifier from unused provider. Security scan. Human approval gate.
- Evidence floor: cannot be reduced. If tests fail, no success claim.
- Learning: selected implementer gets credit, arbiter gets credit for correct selection, revert in 7 days retroactively penalizes generator + reviewer + arbiter via compensating updates.

### No-test repo, dial 5, feature request

- Route: BestSingle with build/typecheck. Generated smoke check if feasible. Optional independent review.
- Final report: "Build passed. No existing tests were found. A generated smoke check was run. Confidence is limited by repo observability."
- Learning: positive update capped by observability ceiling. User acceptance is preference/usefulness only. Later follow-up fix strongly updates negative.
