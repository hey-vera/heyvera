# Routing Intelligence Layer -- Opus Round 2

## Preamble

I have read GPT-5.5's Round 1 position in full. This document is a systematic comparison, challenge, and conflict resolution. Where GPT's design is superior, I concede explicitly. Where mine is superior, I defend. Where the best answer is a merge, I specify how.

I also evaluate both designs against four new requirements from the user that arrived after Round 1:

1. **Arbitrary user intents** (20 security audit rounds, plan-then-build, discuss-then-fix)
2. **Scoped blocking** (system continues non-blocked work while waiting for user action)
3. **Confidence weights determine confirmation vs autonomous proceed**
4. **"Gravity-defying UFO" level** -- aspirationally the most flexible, intelligent routing system possible

---

## Part 1: Signal Taxonomy

### My Round 1: 3-Tier (Hard / Soft / Behavioral)

I used three reliability tiers mapped to static weights (1.0 / 0.3-0.5 / 0.1). Clean, simple, easy to reason about.

### GPT's Round 1: 5-Tier with Contamination Signals

GPT proposed Tier 0 (policy/eligibility), Tier 1 (hard objective), Tier 2 (independent verification), Tier 3 (stability/delayed), Tier 4 (weak subjective), plus a separate Tier 5 of contamination signals that reduce confidence in other tiers. Each signal has three dimensions: reward, confidence, and contamination_penalty.

### Challenge and Verdict

**GPT wins this one.** My 3-tier taxonomy conflates two things that should be separate: how much a signal tells you about correctness (reward), and how much you should trust it (confidence). GPT's three-dimensional `SignalWeight { reward, confidence, contamination_penalty }` is a better decomposition than my single-dimensional weight.

The specific improvements:

1. **Tier 0 as non-reward policy signals.** I treated compile success as a Hard signal with weight 1.0. GPT correctly separates "provider auth succeeded" (Tier 0 -- eligibility, not reward) from "compile passed" (Tier 1 -- actual evidence). This prevents the learner from treating "I was allowed to run" as evidence of quality.

2. **Tier 3 stability signals as a separate class.** My design folded delayed evidence into the finalization window mechanism but did not give stability its own signal tier. GPT's explicit Tier 3 (no-revert-after-window, no-follow-up-fix, no-production-incident) with its own modest positive weights is cleaner. Stability is not the same kind of evidence as "tests passed" -- it is absence-of-negative, which deserves distinct treatment.

3. **Contamination as a multiplicative penalty, not a tier.** GPT's `ContaminationProfile` with additive penalties (same_model_as_generator: +0.25, saw_generated_patch: +0.15, etc.) that reduce effective confidence is more principled than my ad-hoc "tests that always pass are suspect" heuristic. Contamination should be orthogonal to signal type, applied across all tiers.

4. **31 signal kinds vs my 11.** GPT enumerated `ReproTestBeforeFailsAfterPasses`, `SecurityScanPass/Fail`, `BenchmarkImproved/Regressed`, `DocsLinkValid/Broken`, etc. This granularity matters because different signal kinds need different weights. My `TestSuiteResult` lumped repro tests and existing tests together.

**What I would keep from my design:** The finalization window concept (immediate/short/medium/long) for structuring when signals arrive. GPT's temporal evidence ledger with `observed_at` vs `event_time` is equivalent but less prescriptive about windows. I think explicit windows with required/optional flags are operationally simpler for v1.

**Merge verdict:** Use GPT's 5-tier taxonomy and 3-dimensional signal weights. Use my finalization windows for the collection pipeline. Use GPT's contamination profile as a cross-cutting concern.

---

## Part 2: Reward Computation

### My Round 1: Weighted Average to [-1, 1]

I computed reward as a weighted sum of signal values divided by total weight, producing a normalized scalar in [-1, 1].

### GPT's Round 1: Reward Vector with Objective Weights

GPT decomposed reward into six dimensions: `{ correctness, usefulness, cost_efficiency, latency, user_preference, policy_compliance }`, with objective weights that vary by risk class. The scalar for model selection is a weighted dot product.

### Challenge and Verdict

**GPT wins on the decomposition. I win on simplicity for v1.**

GPT's insight is correct: user preference is not the same axis as correctness. A route that the user liked but that later reverted should have high `user_preference` and low `correctness`. My scalar conflates these. A model that produces elegant-looking code that fails tests would score 0 in my system (cancel out), but in GPT's system it would score high on `user_preference`, low on `correctness`, and the risk-weighted objective would still rank it low for high-risk tasks.

However, GPT's `RewardObjectiveWeights` with six dimensions and risk-varying weights adds significant complexity. For v1, I would implement a two-axis decomposition -- `correctness` and `experience` (combining usefulness, latency, user_preference) -- and expand to the full vector later.

**Concession:** GPT's point about `policy_compliance` being a gate rather than a reward dimension is exactly right. I should not have included it in reward computation at all.

**Merge verdict:** Two-axis reward (correctness, experience) for v1, expandable to GPT's 6-axis later. Correctness dominates routing decisions. Experience tunes preference learning. Policy compliance is a gate.

---

## Part 3: Evidence Graph Data Model

### My Round 1: Minimal -- SignalCollector with Three Gates

I designed a `SignalCollector` per task with three gates before belief update (minimum signal diversity, confidence floor, signal freshness). No explicit graph structure.

### GPT's Round 1: Full Graph with Typed Nodes and Edges

GPT designed a full evidence graph with typed nodes (`Task`, `Attempt`, `Artifact`, `Event`, `Route`), typed edges (`ProducedBy`, `VerifiedBy`, `FailedOn`, `Contradicts`, etc.), and an 11-step attribution pipeline.

### Challenge and Verdict

**GPT wins, but with a complexity warning.**

GPT's evidence graph is architecturally superior for several reasons:

1. **Causal traceability.** When a revert happens 7 days later, GPT's graph can trace `Revert -> SupersededBy -> Artifact -> ProducedBy -> Attempt -> Route` and assign credit precisely. My `SignalCollector` would need ad-hoc logic to link delayed signals back to the right attempt.

2. **Multi-attempt credit.** When a parallel fleet produces three patches and an arbiter selects one, GPT's graph records which attempt produced which artifact, which verifier approved which artifact, and which arbiter selected which candidate. My design had no way to represent this.

3. **Append-only audit.** GPT explicitly states the graph is append-only for audit, with beliefs as derived state. This is the right pattern for a system that needs to explain its decisions months later.

**Where GPT overbuilt:** The `EvidenceEdgeKind` enum with `Contradicts` and `DependsOn` edges suggests a full reasoning graph. For v1, we need `ProducedBy`, `VerifiedBy`, `SelectedBy`, and `RevertedBy`. The rest can wait.

**What I challenge in GPT's design:** The `AttributionEngine` with its generic `<Q, C, B>` type parameters is elegant but makes the code harder to test and debug. For v1, I would use concrete types with a trait boundary only on `BeliefStore` (for testing with in-memory vs SQLite).

**Merge verdict:** GPT's graph model with pruned edge types for v1. Concrete types for the engine. Append-only storage.

---

## Part 4: Credit Assignment for Multi-Attempt Routes

### My Round 1: Not Addressed

I did not explicitly design multi-attempt credit assignment. My `TemplateBelief` tracked success/failure per template-task pair but did not decompose credit to individual attempts within a template execution.

### GPT's Round 1: Role-Based Causal Weights

GPT designed an `AttemptRole` enum (PrimaryGenerator, Planner, Reviewer, Verifier, Arbiter, etc.) with role-based causal weight functions. For a passing test: generator gets 0.65, planner 0.10, reviewer 0.10, verifier 0.10, arbiter 0.05. For failures, credit can sum to >1.0 because failures can be joint responsibility.

### Challenge and Verdict

**GPT wins cleanly.** This is a genuine gap in my Round 1. Without per-role credit assignment, my system cannot learn that "Model X is a great reviewer but mediocre implementer" -- a distinction GPT explicitly modeled via `ModelRoleKey { model, provider, role, task_family, language, risk }`.

**One correction to GPT's design:** The causal weights for failure should not mechanically exceed 1.0. If a generator produces a bad patch and a reviewer approves it, the total negative credit is -0.90 (for the patch failing) applied with weights 0.70 to generator and 0.20 to reviewer. The sum of weights (0.90) being <1.0 is fine. The generator and reviewer are not independently responsible for separate failures -- they share blame for a single failure. Allowing sums >1.0 double-penalizes the route. GPT's own description says "the same event can assign negative credit to multiple roles because failures can be joint responsibility" but the math should still normalize per event.

**Verdict:** GPT's design with causal weights capped at sum <= 1.0 per evidence event, even for failures.

---

## Part 5: Learned vs Invariant Boundaries

### My Round 1: Risk Classification Is Learned, Evidence Floor Is Invariant

I drew the line at: "auth code is critical risk" is learned from file path patterns, but "critical risk requires compile + existing tests + new tests" is invariant.

### GPT's Round 1: Risk Classification Is Policy, Detection Is Learned-Assisted

GPT drew the line differently: the risk classifier itself uses invariant rules ("auth-sensitive code requires stronger verification" is policy, not learned). The learner can assist in detection (predicting what is auth-sensitive), but the policy threshold is invariant.

### Challenge and Verdict

**GPT wins on the principle, but I challenge the implementation.**

GPT's argument is correct: risk classification should not be purely learned because auth bugs are asymmetric -- absence of reported failures is weak evidence, and a routing optimizer trained on user acceptance will systematically under-verify auth changes. The invariant should be: "if file path matches auth/payments/secrets/crypto patterns, risk is at least High." The learned part should be: "this particular file in the auth directory is actually low-risk boilerplate" (a downgrade requires explicit evidence, not just absence of failure).

However, GPT's `RiskSignals` struct with 10 boolean fields (`touches_auth`, `touches_payments`, etc.) is a static taxonomy that will need updating every time a new risk category emerges. I prefer a pattern-based approach where the invariant is a set of glob rules mapping path patterns to minimum risk levels, and the system can learn to add new patterns (subject to admin approval).

**Merge verdict:** Invariant risk floor via configurable pattern rules (GPT's principle). Learned risk refinement can only raise risk, never lower it below the pattern floor (my principle). The pattern set is config, not code.

---

## Part 6: Route Template Design

### My Round 1: 8 Named Templates as an Enum

I defined `RouteTemplateId` as an enum with 8 variants: CheapSingle, Cascade, BestSingle, VerifiedSingle, DualRace, MultiAgent, DualBrain, FullFleet.

### GPT's Round 1: Structured Templates with Stages, Roles, and Input Policies

GPT defined `RouteTemplate` as a struct with `stages: Vec<RouteStageTemplate>`, where each stage has a role, candidate count (which can be dial-scaled), input policy (FullContext, IssueOnly, PatchAndLogs, etc.), and output contract (Plan, Patch, Review, Verdict, etc.). Four built-in examples: single_direct, generate_review_refine, test_first_independent, parallel_fleet_arbiter.

### Challenge and Verdict

**GPT wins on template structure, I win on template count.**

GPT's stage-based template structure is superior because:

1. **Composability.** A template is not a black box -- it is a sequence of typed stages. This means the system can reason about which stages need which models, which stages need independence constraints, and which stages can run in parallel.

2. **Input policies per stage.** The `StageInputPolicy` (IssueOnly, PatchAndLogs, RedactedSummaryOnly) enables privacy-aware routing at the stage level, not just the template level. This is a direct consequence of GPT's insight about per-stage privacy evaluation, which my design missed entirely.

3. **Dial-scaled candidate count.** `CandidateCount::DialScaled { min: 1, max: 3 }` is a cleaner way to express "more parallelism at higher dials" than my template-per-dial approach.

However, GPT's 4 templates are too few. The 8 I proposed map to real user scenarios. GPT's templates should be expanded to cover: cascade (try cheap, escalate on failure), dual-brain (cross-provider synthesis, not just review), and the "explore-then-implement" pattern that the new arbitrary intent requirement demands.

**Challenge to GPT:** The `test_first_independent` template is hard-coded to `TaskFamily::BugFix` only. The new requirements demand arbitrary intent chaining -- "20 security audit rounds" is not a bugfix. Templates need to be composable into chains, not just internally structured.

**Merge verdict:** GPT's stage-based template structure. Expand to 10+ templates covering my original scenarios plus chain-aware patterns. Add a `ChainTemplate` type that sequences templates for multi-intent workflows.

---

## Part 7: Thompson Sampling vs UCB

### My Round 1: Thompson Sampling with Separate Exploration Rate

I used Thompson sampling (sample from Beta distribution) with a configurable exploration rate that determines whether to explore or exploit.

### GPT's Round 1: Thompson Sampling Primary, UCB as Debug Fallback

GPT proposed Thompson sampling as primary (sampling from a normal distribution based on mean_reward and uncertainty), with UCB as a simpler fallback for v1 debugging.

### Challenge and Verdict

**Mostly aligned, with a nuance.**

Both designs converge on Thompson sampling, which is the right choice for this domain. GPT's suggestion to start with UCB for v1 is pragmatic and correct -- UCB is deterministic, easier to log, easier to explain to users ("this model scored highest with exploration bonus"), and sufficient when the number of arms is small (which it is with 10 templates).

**My challenge to GPT's implementation:** GPT samples from a normal distribution, which can produce negative scores. My Beta distribution is bounded to [0, 1], which is more natural for a "probability of success" interpretation. However, GPT's normal sampling works better with the multi-dimensional reward vector because you cannot have a Beta distribution over `{ correctness, usefulness, cost_efficiency }`. So GPT's approach is more extensible.

**My challenge to my own design:** I added a separate `EXPLORATION_RATE` parameter that gates whether to Thompson-sample or exploit. This is wrong. Thompson sampling already handles exploration-exploitation tradeoff intrinsically -- that is its entire point. Adding a separate gate creates double-exploration when explore=true (sampling) and under-exploration when explore=false (greedy). The correct approach is to control exploration via the `exploration_temperature` parameter on the sampling distribution.

**Merge verdict:** UCB for v1, Thompson sampling (GPT's normal variant with exploration_temperature) for v2. Remove my redundant exploration rate gate.

---

## Part 8: Dial Mapping

### My Round 1: Dial as Hard Cost Ceiling with Explicit ResourceEnvelope

I mapped each dial level to a concrete `ResourceEnvelope { max_cost, max_parallel, max_models, verification_depth, allow_cross_provider }` with specific dollar amounts ($0.02 at dial 1 to $5.00 at dial 10).

### GPT's Round 1: Dial as Investment Envelope Relative to Available Pool

GPT used subscription units (1.0 at dial 1 to 16.0 at dial 10) with a risk multiplier, plus policy parameters (exploration_temperature, cost_sensitivity, latency_sensitivity, allow_premium, allow_full_fleet).

### Challenge and Verdict

**GPT wins on the abstraction, I win on concreteness.**

GPT is correct that absolute dollar amounts in the dial mapping are wrong. A user with a $200/month subscription and a user with a $20/month subscription should not both have a dial-10 ceiling of $5.00. GPT's subscription-unit-based budgeting scales naturally with the user's actual capacity. The risk multiplier (1.0x for low, 2.5x for critical) is also smart -- it means the system automatically invests more for dangerous work.

However, GPT's `subscription_units` abstraction is under-defined. What is 1 subscription unit in terms of actual provider usage? For a $200 Anthropic subscription, is 1 unit = 1 request? 1000 tokens? 0.1% of monthly capacity? Without this conversion, the abstraction is a placeholder.

**Merge verdict:** Use GPT's relative-to-pool abstraction with explicit conversion factors per provider tier. Define 1 subscription unit = 1/1000th of a tier's estimated monthly capacity, adjusted by provider-specific rate limit observations.

---

## Part 9: Subscription Registry

### My Round 1: Minimal SubscriptionSlot

I defined a `SubscriptionSlot` with provider, tier (Free/Plus/Pro), rate_limit, remaining_capacity, and cooldown.

### GPT's Round 1: Rich ProviderSubscription with Auth, Sharing, Privacy, Model Entitlements

GPT defined `ProviderSubscription` with `AuthRef` (OAuth, API key, browser session, CLI credential), `SharingPolicy` (team sharing rules, repo allowlists), `ProviderPrivacyPolicy` (raw code allowed, data retention, region), `ModelEntitlement` (per-model capabilities, cost hints, quality tier), and `SubscriptionStatus`.

### Challenge and Verdict

**GPT wins decisively.** My subscription registry is too simple for the real world.

Key things GPT included that I missed:

1. **Auth diversity.** Real subscriptions authenticate via OAuth, API keys, browser sessions, and CLI credentials. My design assumed uniform auth.

2. **Per-model entitlements.** A single subscription can access multiple models with different capabilities (tool use, long context, images). My design treated subscriptions as monolithic.

3. **Privacy per provider.** Different providers have different data retention policies. GPT's per-provider privacy policy enables routing decisions like "use this provider for planning (redacted summary) but not for implementation (needs raw code)."

4. **Sharing policies with repo allowlists.** Team subscriptions may be restricted to specific repos. My design assumed all subscriptions are available for all repos.

5. **Capacity reservation with priority.** GPT's `ReservationPriority` (BackgroundExploration through CriticalVerification) enables preemption of optional work when critical verification needs capacity. My design had no reservation concept.

**Verdict:** GPT's subscription registry design, wholesale.

---

## Part 10: Cold Start Strategy

### My Round 1: Progressive Unlocking with 20-Task Learning Threshold

I proposed: dials 1-3 safe immediately, dials 4-5 use whatever tests exist, dial 6+ warns "I'll learn over ~20 tasks."

### GPT's Round 1: Deterministic Defaults with Global Priors and Exploration Gating

GPT proposed: cold-start uses global/public model priors maintained by Cortex, prefers robust generalist models, avoids exotic templates, uses more verification when repo observability is weak, and gates exploration to dial 5+ with non-critical risk and 2+ models available.

### Challenge and Verdict

**Merge.** Both approaches are partially right.

My design is correct that there should be a clear user-facing message: "Using default routing because this repo has no history yet." GPT's design is correct that the system should use global priors (cross-tenant aggregated model quality estimates) rather than starting from uniform ignorance.

GPT's `cold_start_exploration_allowed()` function is better gated than my "after 20 tasks" threshold. 20 tasks is arbitrary and does not account for task diversity. A user who runs 20 identical "fix typo" tasks has not generated diverse enough evidence for the system to learn template selection for bug fixes.

**What both designs missed (new requirement):** Cold start for arbitrary intent chains. A user who says "run 20 security audit rounds" on their first session hits cold start immediately with a complex multi-step workflow. The system needs intent decomposition as part of cold start, not just template selection.

**Merge verdict:** GPT's global priors + my progressive user messaging + intent decomposition for cold start of complex workflows. Replace "20 tasks" with "statistically significant evidence per task family" (minimum 5 per family with 2+ hard signals each).

---

## Part 11: Team Fair Allocation

### My Round 1: Simple Fair Share with Borrow-from-Pool

I designed a `FairShareAllocator` with per-user allocation windows, 20% overshoot warning, and borrow-from-idle-members.

### GPT's Round 1: Weighted Fair Queuing with Priority Classes

GPT designed a priority-based system where evidence-floor-required verification outranks optional dial expansion, and dial influences priority among optional work only. Critical verification gets score 100, evidence floor required gets 50, normal interactive gets 5, background exploration gets 1.

### Challenge and Verdict

**GPT wins on the priority design.** The key insight is: "A user at dial 10 should not starve a user at dial 3 from basic service." My design allowed this because it treated all usage as fungible tokens from a shared pool.

GPT's principle that "evidence-floor-required verification gets priority over optional dial expansion" is exactly right. If user A at dial 10 is running shadow counterfactuals and user B at dial 3 needs a compile check for a high-risk task, user B's compile check should preempt user A's shadow run. My design would have let user A exhaust the pool.

**What I would simplify:** GPT's `fair_share_score` formula with `priority_boost * dial_boost + burst_allowance - consumption_penalty` mixes multiplicative and additive terms, which creates non-obvious behavior. I would use a strict priority queue with preemption: required verification > interactive work at any dial > background exploration. Within each priority class, use GPT's consumption-based fairness.

**Merge verdict:** GPT's priority classes with strict preemption between classes. Within-class fairness uses consumption-weighted fair queuing.

---

## Part 12: New Requirement -- Arbitrary User Intents

Neither Round 1 design addressed this adequately.

The user wants the system to handle "20 security audit rounds" or "plan-then-build" or "discuss-then-fix" as first-class workflow shapes, not just single tasks.

This requires:

### Intent Decomposition Layer

```rust
#[derive(Debug, Clone)]
pub struct IntentGraph {
    pub id: IntentGraphId,
    pub nodes: Vec<IntentNode>,
    pub edges: Vec<IntentEdge>,
    pub user_intent: String,
    pub decomposed_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct IntentNode {
    pub id: IntentNodeId,
    pub task_family: TaskFamily,
    pub description: String,
    pub iteration_spec: IterationSpec,
    pub requires_user_action: bool,
    pub confidence_threshold_for_autonomy: f64,
}

#[derive(Debug, Clone)]
pub enum IterationSpec {
    Once,
    NTimes(u32),
    UntilCondition { condition: String, max: u32 },
    UntilUserSatisfied { max: u32 },
}

#[derive(Debug, Clone)]
pub struct IntentEdge {
    pub from: IntentNodeId,
    pub to: IntentNodeId,
    pub edge_type: IntentEdgeType,
}

#[derive(Debug, Clone)]
pub enum IntentEdgeType {
    Then,              // Sequential
    Parallel,          // Can run simultaneously
    FeedsInto,         // Output of A is input to B
    IteratesOver,      // B runs once per output of A
    BlockedUntilUser,  // B waits for user action after A
}
```

"20 security audit rounds" decomposes to: `IntentNode { task_family: Security, iteration_spec: NTimes(20), ... }` with each iteration feeding its findings into the next.

"Plan-then-build" decomposes to: `Planning -> FeedsInto -> FeatureImplementation`.

"Discuss-then-fix" decomposes to: `Planning { requires_user_action: true } -> BlockedUntilUser -> BugFix`.

**Key principle:** Each node in the intent graph gets its own routing decision. A 20-round security audit at dial 8 does not mean 20x the cost of dial 8 -- the routing system should learn that later rounds of iterative audit are cheaper (narrower scope, incremental findings).

**Neither design addressed this.** GPT's `TaskFamily` enum includes `Planning`, `Security`, `CodeReview` but does not compose them into chains. My templates include `MultiAgent` and `DualBrain` but those are single-task templates, not workflow orchestrators.

---

## Part 13: New Requirement -- Scoped Blocking

Neither Round 1 design addressed the concept of continuing non-blocked work while waiting for user action.

This requires a task scheduler with dependency tracking:

```rust
#[derive(Debug, Clone)]
pub enum TaskState {
    Ready,
    Running { attempt_id: AttemptId },
    WaitingForUser { prompt: String, since: time::OffsetDateTime },
    WaitingForDependency { blocked_by: Vec<TaskId> },
    Completed { outcome: TaskOutcome },
    Failed { error: String, retries: u32 },
}

pub struct IntentScheduler {
    pub graph: IntentGraph,
    pub task_states: HashMap<IntentNodeId, TaskState>,
}

impl IntentScheduler {
    pub fn runnable_nodes(&self) -> Vec<IntentNodeId> {
        self.graph.nodes.iter()
            .filter(|n| {
                let state = &self.task_states[&n.id];
                matches!(state, TaskState::Ready) &&
                self.dependencies_satisfied(n.id)
            })
            .map(|n| n.id)
            .collect()
    }

    pub fn blocked_nodes(&self) -> Vec<(IntentNodeId, BlockReason)> {
        // Returns nodes that are waiting, plus the reason
        // The system routes runnable nodes while these wait
    }
}
```

The routing layer must be aware that blocked nodes exist and may become unblocked. This affects capacity reservation -- the system should not exhaust all capacity on runnable nodes if blocked nodes may unblock soon.

---

## Part 14: New Requirement -- Confidence-Based Autonomy

The user wants confidence weights to determine what needs user confirmation vs autonomous proceed.

This is a policy question, not a learning question. The confidence threshold should be invariant per risk level:

```rust
pub struct AutonomyPolicy {
    pub thresholds: HashMap<RiskClass, AutonomyThreshold>,
}

pub struct AutonomyThreshold {
    pub auto_proceed_above: f64,    // Confidence above this: no confirmation
    pub suggest_above: f64,         // Confidence above this: suggest, wait for confirmation
    pub block_below: f64,           // Confidence below this: refuse to proceed
}

impl Default for AutonomyPolicy {
    fn default() -> Self {
        let mut thresholds = HashMap::new();
        thresholds.insert(RiskClass::Low, AutonomyThreshold {
            auto_proceed_above: 0.6,
            suggest_above: 0.3,
            block_below: 0.1,
        });
        thresholds.insert(RiskClass::Medium, AutonomyThreshold {
            auto_proceed_above: 0.75,
            suggest_above: 0.5,
            block_below: 0.2,
        });
        thresholds.insert(RiskClass::High, AutonomyThreshold {
            auto_proceed_above: 0.9,
            suggest_above: 0.7,
            block_below: 0.4,
        });
        thresholds.insert(RiskClass::Critical, AutonomyThreshold {
            auto_proceed_above: 0.95,
            suggest_above: 0.85,
            block_below: 0.6,
        });
        thresholds
    }
}
```

**This is an invariant.** The learner must not learn to lower autonomy thresholds. It can learn to produce higher-confidence outputs (by selecting better routes), which naturally leads to more autonomous operation. But the thresholds themselves are policy.

**Connection to scoped blocking:** When a task falls in the "suggest" zone, it enters `WaitingForUser` state, and the scheduler routes other ready tasks. When it falls in the "auto-proceed" zone, it executes without waiting. When it falls in the "block" zone, it refuses and explains why.

---

## Part 15: New Requirement -- "Gravity-Defying UFO" Flexibility

The user's aspiration is the most flexible, intelligent routing system possible. Both Round 1 designs are conservative by nature (correctly -- conservatism about evidence and policy is right). But the flexibility aspiration demands that the system be maximally capable within those invariant boundaries.

Concretely, "gravity-defying" means:

1. **No hard-coded model preferences.** The system should be able to discover that a new model released yesterday is the best reviewer for Rust code within 10 tasks, without any code change.

2. **Arbitrary workflow shapes.** Not just our 8-10 templates -- the system should be able to discover that "for this repo, the best workflow is: lint first, then implement, then run only integration tests (skip unit tests), then review" without us defining that template.

3. **Self-improving routing.** The system should track its own routing quality over time and detect when its beliefs have drifted from reality (e.g., a model degraded gradually).

GPT's design is closer to this aspiration because of:
- Hierarchical beliefs (global -> tenant -> repo -> context) that enable local specialization
- Model-role pair learning, not just model learning
- Template discovery in shadow mode (mentioned but not detailed)

My design needs:
- Composable template discovery (not just selection among fixed templates)
- Drift detection on beliefs (detect when a model's actual quality diverges from learned estimates)
- Dynamic task family expansion (the `TaskFamily` enum should not be fixed)

For v2, the system should support user-defined task families and template composition. For v1, the fixed set is acceptable.

---

## Part 16: Revert Cause Classification

### GPT's Design: Explicit RevertCause Enum

GPT proposed classifying reverts by cause (FunctionalRegression, SecurityRegression, MergeConflict, ProductChange, StylePreference, FlakyTest, Unknown) with different weights per cause.

### My Design: Single PrReverted Signal with Weight -2.0

I treated all reverts as a single strong negative signal.

### Verdict

**GPT wins.** A revert due to a product direction change should not penalize the model's routing score as heavily as a revert due to a functional regression. My -2.0 blanket penalty would systematically under-credit models that work on frequently-changed product areas.

GPT's cause-specific weights (FunctionalRegression: -0.85, ProductChange: -0.05, MergeConflict: -0.25) are well-calibrated. The system needs to classify revert cause, which is itself a non-trivial classification problem, but the principle is sound.

---

## Part 17: Evidence Quality Model

### GPT's Design: Six-Dimensional EvidenceQuality

GPT proposed `EvidenceQuality { objectivity, independence, reproducibility, scope_match, contamination, observability }` where effective confidence is the product of all positive factors times a contamination multiplier.

### My Design: Confidence Ceiling Based on Signal Presence

I used a simpler model: confidence ceiling based on which signal types are present (no tests = 0.5, tests = 0.8, tests + CI = 1.0).

### Verdict

**GPT's is more principled, mine is more practical for v1.** GPT's model captures the right dimensions but requires computing six values for every evidence event, which is operationally expensive. My ceiling-based approach is a coarse approximation that works well for the common case.

**Merge verdict:** Use my ceiling approach for v1 with GPT's contamination profile as a multiplier. Expand to GPT's full quality model in v2.

---

## Part 18: Repo Observability Profile

### GPT's Design: Detailed RepoObservabilityProfile with Confidence Ceiling

GPT defined a struct tracking `has_tests`, `has_ci`, `has_typecheck`, `has_compile_step`, `has_lint`, `has_build`, `has_runtime_smoke`, `has_static_analysis` with discovered commands and a computed confidence ceiling.

### My Design: Not Explicitly Modeled

I mentioned "test density per repo" as a meta-signal but did not define a formal observability profile.

### Verdict

**GPT wins.** The repo observability profile is essential for calibrating confidence claims. GPT's additive ceiling computation (base 0.25 + 0.15 per capability, capped at 0.95) is a clean model. The discovered command strings (test_command, build_command, etc.) are necessary for the execution layer.

---

## Part 19: Per-Stage Privacy Evaluation

### GPT's Design: stage_privacy_allowed() per Stage

GPT recognized that different stages need different access levels. A planner working from `IssueOnly` or `RedactedSummaryOnly` can use a provider that is not allowed to see raw code, while an implementer working from `FullContext` requires a code-allowed provider.

### My Design: Privacy as a Template-Level Binary

I treated privacy as "this provider is denied" at the subscription level.

### Verdict

**GPT wins.** Per-stage privacy evaluation is a genuine capability improvement. It means a team that blocks Provider X from seeing raw code can still use Provider X as a planner or reviewer (reading only issue descriptions or redacted summaries). This expands the available provider pool without compromising privacy.

---

## Part 20: Non-Selection Reason Tracking

### GPT's Design: NonSelectionReason Enum

GPT distinguished between `LowerExpectedUtility`, `CapacityUnavailable`, `BudgetExceeded`, `PrivacyBlocked`, etc. Only `LowerExpectedUtility` trains preference. Others update separate priors.

### My Design: Not Addressed

I did not track why a provider was not selected.

### Verdict

**GPT wins.** This is critical for preventing the "stale beliefs from capacity unavailability" feedback loop. If Model X is unavailable for a week due to rate limiting, the system should not learn that Model X is bad -- it should only learn that Model X was unavailable. GPT's design makes this explicit.

---

## Part 21: Route Decision Transparency

### GPT's Design: RouteDecisionAudit with CandidateAudit and RouteDecisionReason

GPT designed a comprehensive audit trail explaining why each candidate was considered, rejected, or selected, with specific reasons (StrongPriorForTaskFamily, PrivacyBlocked, DialLimitedParallelism, etc.).

### My Design: Single explain_plan() String

I generated a format string explaining the decision.

### Verdict

**GPT wins on structure, but mine is more user-facing.** GPT's structured audit is essential for debugging and system introspection. My format string is what the user actually sees. Both are needed: structured audit for the system, formatted explanation for the user.

---

## Part 22: Exploration Strategy

### My Round 1: 5% Base Rate, 15% for New Models

I used a static exploration rate with a boost for new models.

### GPT's Round 1: Tiered Exploration Modes (None / CheapShadow / ShadowPlan / ParallelCandidate / FullCounterfactual)

GPT defined exploration modes that scale with dial and risk. At low dial: no exploration or cheap shadow review. At high dial: parallel candidates and full counterfactual evaluation.

### Verdict

**GPT wins.** GPT's approach is more nuanced -- exploration should be more expensive at higher dials, not just more frequent. Running a shadow plan costs almost nothing; running a full parallel candidate costs real money. GPT's tiered modes scale exploration cost with dial level, which is exactly right.

My static 5% rate is too blunt. At dial 1, 5% exploration wastes the user's limited budget. At dial 10, 5% is too conservative -- the user is paying for maximum quality, and exploration should be aggressive.

---

## Part 23: Task Features for Difficulty Normalization

### GPT's Design: Rich TaskFeatures with Difficulty Dimensions

GPT defined `TaskFeatures` with `ambiguous_requirement_score`, `requires_runtime`, `requires_external_services`, `auth_sensitive`, `payment_sensitive`, `data_migration`, `repo_size_bucket`, `diff_size_estimate`, etc.

### My Design: TaskShape with Minimal Shape Key

I used a `TaskShapeKey` for belief lookup but did not define what features compose it.

### Verdict

**GPT wins.** Without rich task features, the system cannot normalize for difficulty. A model that gets all the hard tasks will appear worse than a model that gets easy tasks. GPT's explicit difficulty dimensions enable contextual beliefs per difficulty bucket, preventing this confound.

---

## Part 24: Independence Requirements by Risk

### GPT's Design: Explicit IndependenceRequirement per Risk Level

GPT defined requirements: Low risk = no independence needed, Medium = different model required, High/Critical = different provider required + no patch access for test writer.

### My Design: Implicit via Template Selection

I handled independence implicitly through template design (DualBrain template uses cross-provider review) rather than as an explicit constraint.

### Verdict

**GPT wins.** Making independence an explicit, auditable constraint is better than baking it into template design. It means the system can explain "I used Model Y as reviewer because policy requires a different provider for high-risk tasks" rather than silently selecting a template that happens to use multiple providers.

---

## Part 25: v1 Implementation Strategy

### My Round 1: Thompson Sampling with Beta Distributions

I targeted a v1 with Thompson sampling, 8 templates, and signal-gated belief updates.

### GPT's Round 1: UCB with Clean Evidence Graph

GPT explicitly recommended starting with deterministic UCB scoring, transparent attribution, and an append-only evidence graph. "A sophisticated learner on bad evidence will be worse than a simple learner on clean evidence."

### Verdict

**GPT wins on v1 strategy.** UCB is the right choice for v1 because:
1. Deterministic -- same inputs produce same outputs, making debugging tractable.
2. Explainable -- the exploration bonus is a visible number in the audit log.
3. Sufficient -- with 10 templates and 5 providers, the arm space is small enough for UCB.

Thompson sampling should be v2, after the evidence graph is validated.

---

## Conflict Resolution Table

| # | Design Decision | Opus Round 1 | GPT Round 1 | Verdict | Rationale |
|---|----------------|-------------|-------------|---------|-----------|
| 1 | Signal taxonomy tiers | 3 tiers (Hard/Soft/Behavioral) | 5 tiers + contamination | **GPT wins** | Separating reward from confidence from contamination is more principled |
| 2 | Signal weight dimensionality | 1D (single weight) | 3D (reward, confidence, contamination_penalty) | **GPT wins** | Single weight conflates distinct concepts |
| 3 | Signal enumeration granularity | 11 signal variants | 31 signal kinds | **GPT wins** | Different signal kinds need different weights |
| 4 | Reward computation | Weighted average scalar | 6-axis reward vector | **Merge** | Two-axis (correctness, experience) for v1; expand to 6 in v2 |
| 5 | Evidence graph structure | Flat SignalCollector | Full typed graph with nodes and edges | **GPT wins** | Causal traceability and multi-attempt credit require graph |
| 6 | Multi-attempt credit assignment | Not addressed | Role-based causal weights | **GPT wins** | Essential for learning model-role specialization |
| 7 | Causal weight sum constraint | N/A | Allows >1.0 for failures | **Opus correction** | Cap at 1.0 per evidence event even for failures; prevents double-penalization |
| 8 | Risk classification boundary | Learned from file paths | Invariant policy, learned-assisted detection | **GPT wins** | Auth bugs are asymmetric; absence of failure is weak evidence |
| 9 | Risk pattern implementation | Enum with file path learning | Boolean struct with 10 fields | **Merge** | GPT's principle (invariant floor) + configurable glob patterns (not hard-coded booleans) |
| 10 | Route template structure | Enum with 8 named variants | Struct with typed stages, roles, input policies | **GPT wins** | Stage-level composition enables per-stage privacy and independence |
| 11 | Template count | 8 templates | 4 templates | **Opus wins** | 4 is too few; real scenarios need 10+ |
| 12 | Template selection algorithm v1 | Thompson sampling | UCB (debug-friendly) | **GPT wins** | UCB is deterministic, explainable, sufficient for small arm space |
| 13 | Template selection algorithm v2 | Thompson w/ Beta distribution | Thompson w/ Normal + exploration_temperature | **GPT wins** | Normal sampling extends to multi-dimensional reward |
| 14 | Exploration rate | Static 5% with boost for new models | Tiered modes scaling with dial | **GPT wins** | Exploration cost should scale with dial investment |
| 15 | Exploration rate as separate gate | Yes (redundant with Thompson) | No | **Opus self-correction** | Thompson intrinsically handles explore/exploit; separate gate is wrong |
| 16 | Dial mapping abstraction | Absolute dollar amounts | Subscription-unit-relative | **GPT wins** | Must scale with actual user capacity |
| 17 | Dial as constraint vs preference | Hard cost ceiling | Both (constraint on ceiling, preference on quality) | **Merge** | Both are correct at different layers; need explicit separation |
| 18 | Evidence floor vs dial | Floor is invariant, dial cannot lower | Same position | **Aligned** | Both agree: dial never weakens evidence floor |
| 19 | Subscription registry richness | Minimal (provider, tier, rate_limit) | Rich (auth, sharing, privacy, model entitlements) | **GPT wins** | Real-world subscriptions are complex |
| 20 | Per-stage privacy evaluation | Template-level binary | Per-stage based on input policy | **GPT wins** | Expands provider pool without compromising privacy |
| 21 | Cold start strategy | Progressive unlock, 20-task threshold | Global priors, risk-gated exploration | **Merge** | GPT's priors + Opus user messaging + replace "20 tasks" with statistical significance |
| 22 | Team fair allocation priority | Flat pool with borrow | Priority-class preemption | **GPT wins** | Required verification must preempt optional dial expansion |
| 23 | Revert cause classification | Single -2.0 penalty | Cause-specific weights | **GPT wins** | Product-change reverts should not penalize model quality |
| 24 | Evidence quality model | Confidence ceiling by signal presence | 6-dimensional quality model | **Merge** | Ceiling for v1, full quality model for v2; contamination as cross-cutting v1 |
| 25 | Repo observability profile | Mentioned but not modeled | Formal struct with confidence ceiling | **GPT wins** | Essential for calibrating confidence claims |
| 26 | Non-selection reason tracking | Not addressed | Explicit enum with learning implications | **GPT wins** | Prevents stale beliefs from capacity unavailability |
| 27 | Route decision transparency | Format string | Structured audit with candidate reasons | **GPT wins** | Both needed: structured audit + user-facing format |
| 28 | Task feature richness | Minimal TaskShapeKey | Rich TaskFeatures with difficulty dimensions | **GPT wins** | Required for difficulty normalization |
| 29 | Independence requirements | Implicit via template | Explicit constraint per risk level | **GPT wins** | Auditable constraint is better than implicit template design |
| 30 | Circuit breaker thresholds | Configured, not learned | Not explicitly addressed | **Opus holds** | Learning the threshold creates meta-learning problems |
| 31 | Finalization windows | Explicit required/optional windows | Temporal ledger with observed_at/event_time | **Merge** | Both needed: windows for collection, dual timestamps for audit |
| 32 | Feedback loop prevention | Cross-model test verification, always-pass decay | Winner-starvation, difficulty confounding, self-fulfilling verification, quota bias | **GPT wins** | GPT identified 4 distinct feedback loop types vs my 2 |
| 33 | Agent-written test handling | Weight multiplier (anchor 2x, human 3x) | TestOrigin enum with test_evidence_quality scoring | **GPT wins** | More granular origin tracking enables better quality assessment |
| 34 | Arbitrary user intents (NEW) | Not addressed | Not addressed | **Both need extension** | IntentGraph with decomposition, iteration, and dependency edges |
| 35 | Scoped blocking (NEW) | Not addressed | Not addressed | **Both need extension** | IntentScheduler with runnable/blocked node tracking |
| 36 | Confidence-based autonomy (NEW) | Not addressed | Not addressed | **Both need extension** | AutonomyPolicy as invariant thresholds per risk class |
| 37 | v1 implementation priority | Thompson sampling first | UCB first, clean evidence graph | **GPT wins** | "Simple learner on clean evidence > sophisticated learner on bad evidence" |

---

## Summary Scorecard

| Category | Opus Wins | GPT Wins | Merge | Aligned | Both Need Extension |
|----------|-----------|----------|-------|---------|-------------------|
| Count    | 2         | 23       | 6     | 1       | 3                 |

**Honest assessment:** GPT-5.5 produced a substantially more thorough and better-reasoned design in Round 1. The key areas where GPT is clearly superior:

1. **Evidence quality modeling** -- contamination as a cross-cutting concern, not a per-signal hack
2. **Multi-attempt credit assignment** -- I simply did not address this
3. **Subscription registry design** -- I under-estimated real-world complexity
4. **Per-stage privacy** -- a genuine capability I missed
5. **Feedback loop prevention** -- GPT identified 4 loop types, I identified 2

**Where I hold my position:**

1. **Template count** -- 4 is too few, the system needs 10+ to cover real scenarios
2. **Circuit breaker thresholds** -- should be configured, not learned
3. **Causal weight normalization** -- should not exceed 1.0 per event even for failures

**Where neither design is adequate:**

The new requirements (arbitrary intents, scoped blocking, confidence-based autonomy) demand an orchestration layer above the routing layer. Both Round 1 designs assumed single-task routing. The real system needs an IntentGraph that decomposes user goals into routable tasks, a scheduler that manages dependencies and blocking, and autonomy policies that determine when to ask the user and when to proceed.

---

## Recommended Architecture (Merged)

```
User Intent
    |
    v
[Intent Decomposer] -- Decomposes "20 security audit rounds" into IntentGraph
    |
    v
[Intent Scheduler] -- Tracks ready/blocked/waiting nodes
    |
    v  (per ready node)
[Invariant Policy Gate] -- Privacy, auth, budget, evidence floor (GPT's design)
    |
    v
[Capacity Tracker] -- Subscription registry, reservations, fair share (GPT's design)
    |
    v
[Dial-to-Envelope Mapper] -- Investment envelope relative to pool (GPT's abstraction)
    |
    v
[Route Candidate Generator] -- Stage-based templates (GPT's structure, Opus's count)
    |
    v
[Learned Scorer] -- UCB v1, Thompson v2 (GPT's progression)
    |
    v
[Autonomy Gate] -- Confidence threshold determines confirm/auto/block (NEW)
    |
    v
[Executor] -- Runs route, collects evidence
    |
    v
[Evidence Graph] -- Append-only, typed nodes/edges (GPT's design)
    |
    v
[Attribution Engine] -- Contamination-aware, role-based credit (GPT's design)
    |
    v
[Belief Updater] -- Hierarchical beliefs with quality gates (GPT's hierarchical, Opus's gates)
```

This is the merged architecture that incorporates the best of both designs and addresses the new requirements. Round 3 should focus on implementation order, API contracts between layers, and the IntentGraph schema.
