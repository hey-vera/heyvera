# Routing Intelligence Layer — Opus 4.7 Round 1

## Question 1: Reward Attribution — What Evidence Is Strong Enough to Learn From?

### Core Principle: Evidence Graph with Signal Taxonomy

The routing system must learn which route templates work best for which task shapes. But learning from garbage is worse than not learning at all. We need a rigorous signal taxonomy that separates hard evidence from noise.

### Signal Reliability Taxonomy

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SignalReliability {
    Hard,       // Deterministic, machine-verifiable
    Soft,       // Heuristic, informative but gameable
    Behavioral, // Human-generated, weakest signal
}

#[derive(Debug, Clone)]
pub enum Signal {
    // Hard signals (weight: 1.0)
    CompileSuccess { exit_code: i32 },
    TestSuiteResult { passed: u32, failed: u32, skipped: u32, total: u32 },
    CiPipelineResult { status: CiStatus, duration: Duration },
    PrMerged { time_to_merge: Duration },
    PrReverted { time_to_revert: Duration },
    
    // Soft signals (weight: 0.3-0.5)
    DiffQuality { lines_added: u32, lines_removed: u32, files_touched: u32, churn_ratio: f64 },
    TokenEfficiency { input_tokens: u64, output_tokens: u64, task_complexity: f64 },
    LatencyProfile { time_to_first_token: Duration, total_time: Duration },
    RetryCount { attempts: u32, succeeded_on: u32 },
    
    // Behavioral signals (weight: 0.1)
    UserAccepted,
    UserRejected { with_edit: bool },
}
```

### Signal Weight Configuration

```rust
pub struct SignalWeightConfig {
    pub compile_success: f64,     // 1.0 — binary, unambiguous
    pub test_pass_rate: f64,      // 0.9 — strong but tests can be weak
    pub ci_pipeline: f64,         // 0.85 — delayed but authoritative
    pub pr_merged: f64,           // 0.7 — delayed, confounded by reviewer bias
    pub pr_reverted: f64,         // -2.0 — NEGATIVE, strong counter-signal
    pub diff_quality: f64,        // 0.3 — heuristic, gameable
    pub token_efficiency: f64,    // 0.4 — useful for cost optimization
    pub latency: f64,             // 0.2 — speed matters but isn't quality
    pub retry_count: f64,         // -0.3 — negative signal per retry
    pub user_accepted: f64,       // 0.1 — weakest positive signal
    pub user_rejected: f64,       // -0.15 — slightly stronger than acceptance
}

impl Default for SignalWeightConfig {
    fn default() -> Self {
        Self {
            compile_success: 1.0,
            test_pass_rate: 0.9,
            ci_pipeline: 0.85,
            pr_merged: 0.7,
            pr_reverted: -2.0,
            diff_quality: 0.3,
            token_efficiency: 0.4,
            latency: 0.2,
            retry_count: -0.3,
            user_accepted: 0.1,
            user_rejected: -0.15,
        }
    }
}
```

### Reward Computation

```rust
pub fn compute_reward(signals: &[Signal], config: &SignalWeightConfig) -> f64 {
    let mut reward = 0.0;
    let mut total_weight = 0.0;
    
    for signal in signals {
        let (value, weight) = match signal {
            Signal::CompileSuccess { exit_code } => {
                (if *exit_code == 0 { 1.0 } else { -1.0 }, config.compile_success)
            }
            Signal::TestSuiteResult { passed, failed, total, .. } => {
                if *total == 0 { continue; } // No tests = no signal, not success
                let rate = *passed as f64 / *total as f64;
                (rate * 2.0 - 1.0, config.test_pass_rate) // Map [0,1] to [-1,1]
            }
            Signal::CiPipelineResult { status, .. } => {
                (match status { CiStatus::Passed => 1.0, CiStatus::Failed => -1.0, _ => 0.0 }, config.ci_pipeline)
            }
            Signal::PrMerged { .. } => (1.0, config.pr_merged),
            Signal::PrReverted { .. } => (1.0, config.pr_reverted), // Weight is already negative
            Signal::DiffQuality { churn_ratio, .. } => {
                (1.0 - churn_ratio.min(1.0), config.diff_quality)
            }
            Signal::TokenEfficiency { input_tokens, output_tokens, task_complexity } => {
                let efficiency = *task_complexity / (*output_tokens as f64 + 1.0);
                (efficiency.min(1.0), config.token_efficiency)
            }
            Signal::LatencyProfile { total_time, .. } => {
                // Normalize: under 30s = 1.0, over 5min = 0.0
                let secs = total_time.as_secs_f64();
                ((300.0 - secs) / 270.0).clamp(0.0, 1.0).into()
            }
            Signal::RetryCount { attempts, .. } => {
                (-(*attempts as f64 - 1.0).max(0.0), config.retry_count)
            }
            Signal::UserAccepted => (1.0, config.user_accepted),
            Signal::UserRejected { with_edit } => {
                (if *with_edit { -0.5 } else { -1.0 }, config.user_rejected)
            }
        };
        
        reward += value * weight.abs();
        total_weight += weight.abs();
    }
    
    if total_weight == 0.0 { return 0.0; }
    reward / total_weight // Normalized to [-1, 1]
}
```

### Signal Collection with Finalization Windows

```rust
pub struct SignalCollector {
    task_id: TaskId,
    route_id: RouteId,
    signals: Vec<(Signal, Instant)>,
    finalization_windows: Vec<FinalizationWindow>,
}

pub struct FinalizationWindow {
    pub window: Duration,
    pub signal_types: Vec<SignalType>,
    pub required: bool,
}

impl SignalCollector {
    pub fn default_windows() -> Vec<FinalizationWindow> {
        vec![
            // Immediate (0-10s): compile, lint
            FinalizationWindow {
                window: Duration::from_secs(10),
                signal_types: vec![SignalType::Compile, SignalType::Lint],
                required: true,
            },
            // Short (10s-2min): test suite
            FinalizationWindow {
                window: Duration::from_secs(120),
                signal_types: vec![SignalType::TestSuite],
                required: false,
            },
            // Medium (2-30min): CI pipeline
            FinalizationWindow {
                window: Duration::from_secs(1800),
                signal_types: vec![SignalType::CiPipeline],
                required: false,
            },
            // Long (30min-7d): PR merge/revert
            FinalizationWindow {
                window: Duration::from_secs(604800),
                signal_types: vec![SignalType::PrMerge, SignalType::PrRevert],
                required: false,
            },
        ]
    }
    
    pub fn confidence_ceiling(&self) -> f64 {
        // Without test signals, confidence can never exceed 0.6
        // Without CI signals, confidence can never exceed 0.8
        // Full signal chain needed for 1.0
        let has_tests = self.signals.iter().any(|(s, _)| matches!(s, Signal::TestSuiteResult { .. }));
        let has_ci = self.signals.iter().any(|(s, _)| matches!(s, Signal::CiPipelineResult { .. }));
        
        match (has_tests, has_ci) {
            (false, false) => 0.5,
            (true, false) => 0.8,
            (false, true) => 0.7, // CI without local tests is suspect
            (true, true) => 1.0,
        }
    }
}
```

### Three Gates Before Updating Beliefs

```rust
pub fn should_update_beliefs(
    collector: &SignalCollector,
    task: &TaskShape,
) -> BeliefUpdateDecision {
    // Gate 1: Minimum signal diversity
    let hard_count = collector.signals.iter()
        .filter(|(s, _)| s.reliability() == SignalReliability::Hard)
        .count();
    if hard_count == 0 {
        return BeliefUpdateDecision::Defer("No hard signals yet");
    }
    
    // Gate 2: Confidence floor for the task risk
    let confidence = collector.confidence_ceiling();
    let required_confidence = match task.risk_level {
        RiskLevel::Low => 0.3,
        RiskLevel::Medium => 0.5,
        RiskLevel::High => 0.7,
        RiskLevel::Critical => 0.9,
    };
    if confidence < required_confidence {
        return BeliefUpdateDecision::Defer("Confidence below task risk threshold");
    }
    
    // Gate 3: Signal freshness — don't learn from stale data
    let newest_hard = collector.signals.iter()
        .filter(|(s, _)| s.reliability() == SignalReliability::Hard)
        .map(|(_, t)| t)
        .max();
    if let Some(newest) = newest_hard {
        if newest.elapsed() > Duration::from_secs(86400) {
            return BeliefUpdateDecision::Decay(0.5); // Half-weight for old signals
        }
    }
    
    BeliefUpdateDecision::Update(compute_reward(&collector.signal_values(), &SignalWeightConfig::default()))
}

pub enum BeliefUpdateDecision {
    Update(f64),       // Go ahead, here's the reward
    Defer(&'static str), // Don't update yet, reason
    Decay(f64),        // Update with decay factor
}
```

### Bootstrapping for Repos with No Tests

For repos with zero tests, the system:
1. Defaults to compile-only verification (confidence ceiling: 0.5)
2. Uses diff quality metrics as supplementary soft signals
3. Suggests test generation as part of higher-dial routes (dial 6+)
4. Tracks "test density" per repo as a meta-signal — repos with growing test coverage get progressively more confident routing

### Preventing Feedback Loops from Agent-Generated Tests

Key insight: tests generated by the same model that wrote the code encode that model's assumptions. A model that misunderstands the spec will write code AND tests that agree with each other.

Mitigation:
1. **Cross-model test verification**: At dial 7+, tests generated by model A are run against code written by model B
2. **Test independence scoring**: Track whether generated tests ever fail. Tests that always pass are suspect — decay their signal weight
3. **Anchor tests**: Tests that existed BEFORE the task are weighted 2x vs generated tests
4. **Human-written test bonus**: Tests from commits with human authors get 3x weight

---

## Question 2: What Is LEARNED vs INVARIANT?

### The Constraint Envelope

```rust
#[derive(Debug, Clone)]
pub struct RoutingConstraints {
    // INVARIANT — never violated, not learned
    pub privacy: PrivacyPolicy,
    pub budget: BudgetCeiling,
    pub auth: AuthPolicy,
    pub evidence_floor: EvidenceFloor,
    
    // CONSTRAINT — external reality, not policy
    pub capacity: SubscriptionCapacity,
    pub provider_health: ProviderHealth,
}

#[derive(Debug, Clone)]
pub struct PrivacyPolicy {
    pub denied_providers: HashSet<ProviderId>,
    pub sensitive_patterns: Vec<GlobPattern>, // e.g., "*.env", "secrets/*"
    pub default_allow: bool,
}

#[derive(Debug, Clone)]
pub struct BudgetCeiling {
    pub per_task_max: f64,
    pub per_session_max: f64,
    pub per_day_max: f64,
    pub per_month_max: f64,
}

#[derive(Debug, Clone)]
pub struct EvidenceFloor {
    pub minimum_signals: HashMap<RiskLevel, Vec<RequiredSignal>>,
}

impl Default for EvidenceFloor {
    fn default() -> Self {
        let mut minimum = HashMap::new();
        minimum.insert(RiskLevel::Low, vec![RequiredSignal::Compile]);
        minimum.insert(RiskLevel::Medium, vec![RequiredSignal::Compile, RequiredSignal::Lint]);
        minimum.insert(RiskLevel::High, vec![
            RequiredSignal::Compile, RequiredSignal::ExistingTests,
        ]);
        minimum.insert(RiskLevel::Critical, vec![
            RequiredSignal::Compile, RequiredSignal::ExistingTests, RequiredSignal::NewTests,
        ]);
        Self { minimum_signals: minimum }
    }
}
```

### What Is Learned: Route Template Selection

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RouteTemplateId {
    CheapSingle,    // Dial 1-2: cheapest model, minimal verification
    Cascade,        // Dial 2-3: try cheap first, escalate on failure
    BestSingle,     // Dial 4-5: best available single model
    VerifiedSingle, // Dial 5-6: best model + verification step
    DualRace,       // Dial 6-7: two models race, pick best output
    MultiAgent,     // Dial 7-8: specialized agents collaborate
    DualBrain,      // Dial 8-9: cross-provider review + synthesis
    FullFleet,      // Dial 9-10: everything available, maximum parallelism
}

#[derive(Debug, Clone)]
pub struct TemplateBelief {
    pub template: RouteTemplateId,
    pub task_shape: TaskShapeKey,
    pub alpha: f64,  // Beta distribution: successes
    pub beta: f64,   // Beta distribution: failures
    pub total_uses: u64,
    pub last_updated: Instant,
    pub provider_affinity: HashMap<ProviderId, f64>, // Learned per-provider success rate
}

impl TemplateBelief {
    pub fn expected_reward(&self) -> f64 {
        self.alpha / (self.alpha + self.beta)
    }
    
    pub fn uncertainty(&self) -> f64 {
        let n = self.alpha + self.beta;
        (self.alpha * self.beta / (n * n * (n + 1.0))).sqrt()
    }
    
    pub fn thompson_sample(&self, rng: &mut impl Rng) -> f64 {
        // Sample from Beta(alpha, beta)
        let dist = Beta::new(self.alpha, self.beta).unwrap();
        dist.sample(rng)
    }
}
```

### Template Selection Algorithm

```rust
pub fn select_template(
    task: &TaskShape,
    dial: &Dial,
    beliefs: &[TemplateBelief],
    constraints: &RoutingConstraints,
    rng: &mut impl Rng,
) -> RouteTemplateId {
    // Step 1: Filter templates by dial level (hard constraint)
    let eligible: Vec<_> = beliefs.iter()
        .filter(|b| b.task_shape == task.shape_key())
        .filter(|b| dial.allows_template(b.template))
        .filter(|b| constraints.capacity.can_support(b.template))
        .collect();
    
    if eligible.is_empty() {
        return cold_start_template(dial, task);
    }
    
    // Step 2: Exploration vs exploitation
    let explore = rng.gen::<f64>() < EXPLORATION_RATE;
    
    if explore {
        // Thompson sampling — naturally explores uncertain options
        eligible.iter()
            .max_by(|a, b| {
                a.thompson_sample(rng)
                    .partial_cmp(&b.thompson_sample(rng))
                    .unwrap_or(Ordering::Equal)
            })
            .map(|b| b.template)
            .unwrap()
    } else {
        // Exploit — pick highest expected reward
        eligible.iter()
            .max_by(|a, b| {
                a.expected_reward()
                    .partial_cmp(&b.expected_reward())
                    .unwrap_or(Ordering::Equal)
            })
            .map(|b| b.template)
            .unwrap()
    }
}

pub struct ExplorationPolicy {
    pub base_rate: f64,         // 0.05 (5%)
    pub boost_for_new_models: f64, // 0.15 when a new model is detected
    pub decay_after_n: u64,     // After 100 uses, decay exploration
    pub minimum_rate: f64,      // 0.01 (never stop exploring entirely)
}
```

### The Subtle Boundaries

**"Auth code needs stronger verification" — LEARNED or INVARIANT?**
Answer: The EVIDENCE FLOOR is invariant (critical risk = compile + tests required). But "auth code is critical risk" is LEARNED from file path patterns. The system discovers that `src/auth/*` changes correlate with reverts, and automatically classifies it as high/critical risk. The invariant is the floor per risk level; the risk classification is learned.

**"This model is degraded" — LEARNED or INVARIANT (circuit breaker)?**
Answer: BOTH. The detection is learned (error rate exceeds threshold). The circuit breaker is an invariant response (if error_rate > 0.3, stop routing to this model). The threshold itself is configurable but not learned.

```rust
pub struct CircuitBreaker {
    pub provider: ProviderId,
    pub model: ModelId,
    pub error_window: Duration,        // 5 minutes
    pub error_threshold: f64,          // 0.3 (30% error rate)
    pub half_open_after: Duration,     // 60 seconds
    pub state: CircuitState,
}

pub enum CircuitState {
    Closed,                    // Normal operation
    Open { since: Instant },   // Blocking all requests
    HalfOpen { test_count: u32 }, // Allowing 1-2 test requests
}
```

**"Explore 10% to new models" — LEARNED or POLICY?**
Answer: POLICY. The exploration rate is a configured parameter (default 5%), boosted to 15% when new models appear. The system doesn't learn WHAT the exploration rate should be — that would create a meta-learning problem. The outcomes of exploration update beliefs normally.

**Route templates — LEARNED, CONFIGURED, or DISCOVERED?**
Answer: CONFIGURED set, LEARNED selection. The ~8 templates are defined by us (configured). Which template works best for which task shape is learned. New templates can be added by us in updates, and the system will naturally explore them. Templates are NOT discovered by the system — that would require a template search space, which is unbounded.

**The dial — CONSTRAINT or PREFERENCE?**
Answer: CONSTRAINT on resource ceiling, PREFERENCE on quality floor. Dial 3 means "don't spend more than $0.05" (hard constraint). But within that budget, the system still picks the best available option (preference for quality).

---

## Question 3: How Does the Dial Map to Routing Decisions?

### Dial Structure

```rust
#[derive(Debug, Clone)]
pub struct Dial {
    pub level: u8, // 1-10
    pub envelope: ResourceEnvelope,
}

#[derive(Debug, Clone)]
pub struct ResourceEnvelope {
    pub max_cost: f64,
    pub max_parallel: u8,
    pub max_models: u8,
    pub verification_depth: VerificationDepth,
    pub allow_cross_provider: bool,
}

impl Dial {
    pub fn from_level(level: u8) -> Self {
        let envelope = match level {
            1 => ResourceEnvelope {
                max_cost: 0.02,
                max_parallel: 1,
                max_models: 1,
                verification_depth: VerificationDepth::CompileOnly,
                allow_cross_provider: false,
            },
            2 => ResourceEnvelope {
                max_cost: 0.04,
                max_parallel: 1,
                max_models: 1,
                verification_depth: VerificationDepth::CompileLint,
                allow_cross_provider: false,
            },
            3 => ResourceEnvelope {
                max_cost: 0.08,
                max_parallel: 1,
                max_models: 1,
                verification_depth: VerificationDepth::CompileLintBasic,
                allow_cross_provider: false,
            },
            4 => ResourceEnvelope {
                max_cost: 0.15,
                max_parallel: 1,
                max_models: 1,
                verification_depth: VerificationDepth::ExistingTests,
                allow_cross_provider: false,
            },
            5 => ResourceEnvelope {
                max_cost: 0.30,
                max_parallel: 2,
                max_models: 1,
                verification_depth: VerificationDepth::FullTestSuite,
                allow_cross_provider: true,
            },
            6 => ResourceEnvelope {
                max_cost: 0.50,
                max_parallel: 2,
                max_models: 2,
                verification_depth: VerificationDepth::TestsAndReview,
                allow_cross_provider: true,
            },
            7 => ResourceEnvelope {
                max_cost: 0.75,
                max_parallel: 3,
                max_models: 2,
                verification_depth: VerificationDepth::TestsAndGenerated,
                allow_cross_provider: true,
            },
            8 => ResourceEnvelope {
                max_cost: 1.50,
                max_parallel: 4,
                max_models: 3,
                verification_depth: VerificationDepth::CrossModelReview,
                allow_cross_provider: true,
            },
            9 => ResourceEnvelope {
                max_cost: 2.50,
                max_parallel: 6,
                max_models: 4,
                verification_depth: VerificationDepth::DualBrainReview,
                allow_cross_provider: true,
            },
            10 => ResourceEnvelope {
                max_cost: 5.00,
                max_parallel: 8,
                max_models: 8,
                verification_depth: VerificationDepth::FullEvidenceChain,
                allow_cross_provider: true,
            },
            _ => unreachable!(),
        };
        Self { level, envelope }
    }
    
    pub fn allows_template(&self, template: RouteTemplateId) -> bool {
        match template {
            RouteTemplateId::CheapSingle => true, // Always allowed
            RouteTemplateId::Cascade => self.level >= 2,
            RouteTemplateId::BestSingle => self.level >= 4,
            RouteTemplateId::VerifiedSingle => self.level >= 5,
            RouteTemplateId::DualRace => self.level >= 6,
            RouteTemplateId::MultiAgent => self.level >= 7,
            RouteTemplateId::DualBrain => self.level >= 8,
            RouteTemplateId::FullFleet => self.level >= 9,
        }
    }
}
```

### Subscription Registry

```rust
#[derive(Debug, Clone)]
pub struct SubscriptionSlot {
    pub id: SubscriptionId,
    pub provider: ProviderId,
    pub tier: SubscriptionTier, // Free, Plus($20), Pro($200)
    pub owner: UserId,
    pub rate_limit: RateLimit,
    pub remaining_capacity: AtomicCapacity,
    pub cooldown_until: Option<Instant>,
    pub health: ProviderHealth,
}

#[derive(Debug, Clone)]
pub struct SubscriptionRegistry {
    pub slots: Vec<SubscriptionSlot>,
    pub team_id: Option<TeamId>,
}

impl SubscriptionRegistry {
    pub fn available_capacity(&self) -> CapacitySummary {
        let slots: Vec<_> = self.slots.iter()
            .filter(|s| s.cooldown_until.map_or(true, |t| Instant::now() > t))
            .filter(|s| s.health.is_healthy())
            .collect();
        
        CapacitySummary {
            total_slots: slots.len(),
            by_provider: slots.iter()
                .fold(HashMap::new(), |mut map, s| {
                    map.entry(s.provider.clone())
                        .or_insert_with(Vec::new)
                        .push(s.clone());
                    map
                }),
            max_parallel: slots.len().min(8), // Cap at 8 parallel streams
            estimated_tokens_available: slots.iter()
                .map(|s| s.remaining_capacity.estimate())
                .sum(),
        }
    }
    
    pub fn effective_dial_ceiling(&self, dial: u8) -> u8 {
        // Dial can't exceed what subscriptions support
        let capacity = self.available_capacity();
        let max_supported = match capacity.total_slots {
            0 => 0,
            1 => {
                let tier = &self.slots[0].tier;
                match tier {
                    SubscriptionTier::Free => 2,
                    SubscriptionTier::Plus => 5,
                    SubscriptionTier::Pro => 7,
                }
            }
            2 => 8,
            3..=4 => 9,
            _ => 10,
        };
        dial.min(max_supported)
    }
}
```

### Fair Share Allocator

```rust
pub struct FairShareAllocator {
    pub team_id: TeamId,
    pub members: Vec<TeamMember>,
    pub allocation_window: Duration, // 1 hour rolling
}

pub struct TeamMember {
    pub user_id: UserId,
    pub dial_level: u8,
    pub usage_in_window: f64,  // Cost consumed in current window
    pub fair_share: f64,       // Proportional allocation
}

impl FairShareAllocator {
    pub fn can_allocate(&self, user: &UserId, estimated_cost: f64) -> AllocationDecision {
        let member = self.members.iter().find(|m| &m.user_id == user)
            .expect("User must be team member");
        
        let remaining = member.fair_share - member.usage_in_window;
        
        if estimated_cost <= remaining {
            AllocationDecision::Approved
        } else if estimated_cost <= remaining * 1.2 {
            AllocationDecision::ApprovedWithWarning("Approaching allocation limit")
        } else {
            // Check if other team members have unused capacity
            let total_unused: f64 = self.members.iter()
                .filter(|m| &m.user_id != user)
                .map(|m| (m.fair_share - m.usage_in_window).max(0.0))
                .sum();
            
            if total_unused > estimated_cost {
                AllocationDecision::BorrowFromPool(estimated_cost)
            } else {
                AllocationDecision::Denied("Team allocation exhausted")
            }
        }
    }
}
```

### The Complete Routing Pipeline

```rust
pub struct RoutingPipeline {
    pub constraints: RoutingConstraints,
    pub beliefs: BeliefStore,
    pub registry: SubscriptionRegistry,
    pub allocator: Option<FairShareAllocator>,
    pub circuit_breakers: HashMap<(ProviderId, ModelId), CircuitBreaker>,
}

impl RoutingPipeline {
    pub fn plan(
        &self,
        task: &TaskShape,
        dial: &Dial,
        user: &UserId,
        rng: &mut impl Rng,
    ) -> Result<ExecutionPlan, RoutingError> {
        // 1. Apply capacity ceiling
        let effective_dial = self.registry.effective_dial_ceiling(dial.level);
        let dial = Dial::from_level(effective_dial);
        
        // 2. Check budget
        let budget_remaining = self.constraints.budget.remaining_for_task();
        if budget_remaining <= 0.0 {
            return Err(RoutingError::BudgetExhausted);
        }
        
        // 3. Check team allocation
        if let Some(allocator) = &self.allocator {
            match allocator.can_allocate(user, dial.envelope.max_cost) {
                AllocationDecision::Denied(reason) => {
                    return Err(RoutingError::AllocationDenied(reason));
                }
                AllocationDecision::ApprovedWithWarning(msg) => {
                    // Log warning, proceed
                }
                _ => {}
            }
        }
        
        // 4. Filter providers by privacy + circuit breakers
        let available_providers: Vec<_> = self.registry.slots.iter()
            .filter(|s| !self.constraints.privacy.denied_providers.contains(&s.provider))
            .filter(|s| {
                self.circuit_breakers.get(&(s.provider.clone(), s.model()))
                    .map_or(true, |cb| cb.state != CircuitState::Open { .. })
            })
            .collect();
        
        if available_providers.is_empty() {
            return Err(RoutingError::NoProvidersAvailable);
        }
        
        // 5. Select route template
        let template = select_template(
            task,
            &dial,
            &self.beliefs.for_task_shape(task),
            &self.constraints,
            rng,
        );
        
        // 6. Map template to concrete model assignments
        let assignments = self.assign_models(template, &available_providers, &dial);
        
        // 7. Determine verification steps from evidence floor + dial
        let verification = self.verification_plan(task, &dial);
        
        // 8. Build execution plan
        Ok(ExecutionPlan {
            template,
            assignments,
            verification,
            estimated_cost: self.estimate_cost(&assignments, &verification),
            rationale: self.explain_plan(task, &dial, template),
        })
    }
    
    fn cold_start_template(dial: &Dial, task: &TaskShape) -> RouteTemplateId {
        // No learned beliefs yet — use dial level directly
        match dial.level {
            1..=2 => RouteTemplateId::CheapSingle,
            3 => RouteTemplateId::Cascade,
            4..=5 => RouteTemplateId::BestSingle,
            6 => RouteTemplateId::VerifiedSingle,
            7 => RouteTemplateId::DualRace,
            8 => RouteTemplateId::MultiAgent,
            9 => RouteTemplateId::DualBrain,
            10 => RouteTemplateId::FullFleet,
            _ => RouachTemplateId::BestSingle,
        }
    }
    
    fn explain_plan(&self, task: &TaskShape, dial: &Dial, template: RouteTemplateId) -> String {
        format!(
            "Dial {} → {} template. {} provider(s), {} parallel stream(s). \
             Verification: {}. Estimated cost: ${:.2}. \
             Confidence in this route: {:.0}%",
            dial.level,
            template.name(),
            // ... fill from assignments
        )
    }
}
```

### What the User Sees

At each dial level, the UI shows:
- **Current dial position** with cost estimate
- **What's happening**: "Using Claude Sonnet, single pass, compile check"
- **What would change at dial+1**: "Would add: test suite verification (+$0.10)"
- **Capacity indicator**: "2/4 subscriptions active, 3 at capacity"
- **If limited**: "Dial capped at 7 — you need more subscriptions for 8+"

### Cold Start Strategy

For a brand new user with unknown repo:
1. **Dial 1-3**: Safe to use immediately. CheapSingle/Cascade with compile verification.
2. **Dial 4-5**: BestSingle with whatever tests exist. System discovers test coverage on first run.
3. **Dial 6+**: Explicitly tell user: "I'll learn which strategies work best for this repo over the next ~20 tasks. Early routes may be conservative."
4. **After 20 tasks**: Enough data to start making informed template selections via Thompson sampling.

---

## 7 Conflict-Ready Positions for Round 2

1. **User feedback weight at 0.1**: I argue it's appropriately low. GPT may argue it should be higher or have conditional weighting.
2. **8 fixed templates vs continuous strategy space**: I argue fixed templates are the right abstraction. GPT may argue for a more flexible composition system.
3. **Evidence floor as invariant**: I say evidence floors never bend to the dial. GPT may argue they should degrade gracefully.
4. **Thompson sampling over Beta distributions**: I chose this over UCB or epsilon-greedy. GPT may prefer UCB for its deterministic exploration guarantees.
5. **Dial as hard cost ceiling**: I say the dial caps cost absolutely. GPT may argue for soft ceilings with overshoot for high-confidence routes.
6. **Circuit breaker thresholds as configured, not learned**: I argue learning the threshold creates a meta-learning problem. GPT may disagree.
7. **5% base exploration rate**: Arbitrary but defensible. GPT may argue for adaptive exploration based on belief uncertainty.
