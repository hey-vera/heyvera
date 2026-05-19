# Cortex v0.1 Build Spec

**Date:** May 19, 2026
**Status:** Ready to build
**Build method:** Parallel agent waves via dual-brain orchestrator
**Confidence to start:** 10/10 — existing code covers 60%+ of the core

---

## What Already Exists (DO NOT REBUILD)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Intent decomposer (DAG) | `engine/src/decomposer.rs` | 497 | Full — splits goals, infers deps, cycle checks |
| Evaluator + profiles | `core/src/evaluator.rs` | 967 | Full — Auto/Balanced/CostSaver/QualityFirst, pressure scoring, risk+intent+budget evidence |
| Captain (scheduler) | `engine/src/captain.rs` | 713 | Full — round-robin, heal plans, DAG validation |
| Risk classifier | `engine/src/risk.rs` + `core/src/evaluator.rs` | 207 | Full — file-path keyword patterns |
| Ledger (append-only) | `engine/src/ledger.rs` + `core/src/ledger.rs` | 192 | Full — JSONL with typed events |
| Task contracts | `core/src/task.rs` | 87 | Full — TaskContract, Status, Operations |
| Provider/routing types | `core/src/provider.rs` + `core/src/routing.rs` | 151 | Full — ProviderId, Tier, RiskLevel, Intent |
| API server | `api/src/` | 4000+ | Full — Axum, SSE, WebSocket, chat, admin |
| Worker executor | `worker/src/` | 1498 | Full — worktree isolation, streaming |

**Total existing: ~12,800 lines of working Rust across 4 crates.**

---

## What Needs to Be Built (THE GAPS)

### Gap 1: Contamination Tracking (NEW — highest priority)

**Why:** This is our most differentiated feature. No competitor has it. The battle test confirmed it's the crown jewel.

**What:** Every evidence signal gets a contamination score tracking whether AI-generated outputs validated AI-generated work.

```rust
// New file: crates/core/src/contamination.rs

/// Source of an evidence signal
pub enum EvidenceSource {
    HumanWrittenTest,
    HumanReview,
    AiGeneratedTest,
    AiGeneratedCode,
    CompilerOutput,      // Zero contamination — objective
    CiPipeline,          // Zero contamination — objective  
    ExistingTestSuite,   // Low contamination — pre-existing
    RuntimeBehavior,     // Zero contamination — objective
}

/// Contamination assessment for a single evidence event
pub struct ContaminationScore {
    pub raw_value: f64,        // 0.0 (clean) to 1.0 (fully contaminated)
    pub source: EvidenceSource,
    pub generator_model: Option<String>,  // Which model created the artifact being tested
    pub verifier_model: Option<String>,   // Which model verified it
    pub same_model_penalty: bool,         // Generator == Verifier
}

/// 5-tier signal taxonomy from consensus doc
pub enum SignalTier {
    Policy,             // Tier 0: Inviolable (budget, auth, privacy)
    HardObjective,      // Tier 1: Compiler, type checker, existing tests
    IndependentVerify,  // Tier 2: Different model review, human review
    Stability,          // Tier 3: Consistent across reruns
    WeakSubjective,     // Tier 4: Model self-report, user thumbs up
}
```

**Acceptance criteria:**
- [ ] Every LedgerEvent includes a ContaminationScore
- [ ] AI-generated test passing AI-generated code scores ≥ 0.7 contamination
- [ ] Compiler/CI signals score 0.0 contamination
- [ ] Same-model-generates-and-verifies gets penalty flag
- [ ] Contamination scores flow into routing decisions (downweight contaminated evidence)

---

### Gap 2: Evidence Floors (ENFORCE — types exist, enforcement doesn't)

**Why:** "The evidence floor NEVER bends to the dial." Risk classification exists. Evidence types exist. But nothing BLOCKS a route that doesn't meet the floor.

**What:** Invariant policy gate that rejects routing decisions when evidence requirements aren't met.

```rust
// New file: crates/engine/src/evidence_floor.rs

pub struct EvidenceFloor {
    pub risk_level: RiskLevel,
    pub required_signals: Vec<RequiredSignal>,
}

pub struct RequiredSignal {
    pub signal_type: SignalTier,
    pub min_count: u32,
    pub max_contamination: f64,  // Signal rejected if contamination exceeds this
}

/// Invariant floors — these NEVER change regardless of dial or profile
pub fn floors() -> Vec<EvidenceFloor> {
    vec![
        EvidenceFloor {
            risk_level: RiskLevel::Critical, // auth, secrets, payments
            required_signals: vec![
                RequiredSignal { signal_type: SignalTier::HardObjective, min_count: 1, max_contamination: 0.3 },
                RequiredSignal { signal_type: SignalTier::IndependentVerify, min_count: 1, max_contamination: 0.5 },
            ],
        },
        EvidenceFloor {
            risk_level: RiskLevel::High, // database, API contracts
            required_signals: vec![
                RequiredSignal { signal_type: SignalTier::HardObjective, min_count: 1, max_contamination: 0.5 },
            ],
        },
        // Medium and Low: no mandatory floor (dial controls optional verification)
    ]
}
```

**Acceptance criteria:**
- [ ] Critical-risk routes BLOCKED unless hard objective + independent verification present
- [ ] High-risk routes BLOCKED unless hard objective signal present
- [ ] Floor enforcement cannot be disabled by any dial/profile setting
- [ ] Blocked routes return clear explanation of which evidence is missing
- [ ] Test: deliberately route auth code without tests → floor blocks it

---

### Gap 3: UCB Bandit Scoring (UPGRADE — replace pressure scorer)

**Why:** Current scorer picks lowest-pressure provider. UCB learns which provider/model actually works best for each task shape.

**What:** Contextual UCB scorer keyed on (TaskFamily, RiskLevel, Provider, ModelId).

```rust
// New file: crates/engine/src/bandit.rs

pub struct ArmKey {
    pub task_family: TaskFamily,  // Maps from Intent
    pub risk_level: RiskLevel,
    pub provider: ProviderId,
    pub model_id: String,
}

pub struct ArmStats {
    pub successes: u32,
    pub trials: u32,
    pub total_reward: f64,        // Weighted by contamination-adjusted signal quality
    pub last_updated: DateTime<Utc>,
}

pub struct UcbScorer {
    pub arms: HashMap<ArmKey, ArmStats>,
    pub exploration_weight: f64,   // Scales with dial level
    pub global_priors: HashMap<TaskFamily, Vec<(ProviderId, f64)>>,  // Seeded from benchmarks
}

impl UcbScorer {
    /// UCB1 formula: mean_reward + exploration_weight * sqrt(ln(total_trials) / arm_trials)
    pub fn score(&self, key: &ArmKey, dial: u8) -> f64 { ... }
    
    /// Update arm with new evidence (contamination-weighted)
    pub fn update(&mut self, key: &ArmKey, reward: f64, contamination: f64) { ... }
    
    /// Cold start: return global prior if arm has < MIN_OBSERVATIONS trials
    pub fn is_cold(&self, key: &ArmKey) -> bool { ... }
}
```

**Acceptance criteria:**
- [ ] Replaces `score_providers` in engine/src/scorer.rs
- [ ] Falls back to global priors when arm has < 5 observations
- [ ] Exploration weight scales with dial (dial 1 = exploit only, dial 10 = full explore)
- [ ] Updates from LedgerEvent::TaskOutcome with contamination weighting
- [ ] After 20+ tasks, demonstrably outperforms static routing on success rate

---

### Gap 4: Confidence → Autonomy Pipeline (NEW)

**Why:** Cortex needs to know when to ask vs when to proceed. This is the "scoped blocking" from the consensus doc.

```rust
// New file: crates/core/src/autonomy.rs

pub enum ConfidenceBand {
    Low,      // < 0.3
    Medium,   // 0.3 - 0.6
    High,     // 0.6 - 0.85
    Certain,  // > 0.85
}

pub enum AutonomyDecision {
    ProceedAutonomously,    // High confidence + low/medium risk
    ProceedAndFlag,         // High confidence + high risk, or medium confidence + low risk
    AskBeforeProceeding,    // Medium confidence + high risk, or low confidence
    RequireExplicitApproval, // Critical risk regardless of confidence
    Forbidden,              // Policy violation — no amount of confidence allows this
}

pub fn decide_autonomy(confidence: f64, risk: RiskLevel, is_first_observation: bool) -> AutonomyDecision {
    // First observation in a repo → always ask (no prior evidence)
    // Critical risk → always require explicit approval
    // Confidence band × risk level → lookup table
}
```

**Acceptance criteria:**
- [ ] First task in a new repo always asks for confirmation
- [ ] Critical risk always requires explicit approval regardless of confidence
- [ ] After 10+ successful tasks in same risk class, autonomy increases
- [ ] User can override with `--yes` flag (but flag is logged in ledger)

---

### Gap 5: Route Templates (FORMALIZE — behavior exists, abstraction doesn't)

**Why:** The consensus doc defines 10+ templates. Current code has implicit routing but no template concept.

```rust
// New file: crates/engine/src/templates.rs

pub enum RouteTemplate {
    CheapSingle,         // Dial 1-3: cheapest model, minimal verification
    BestSingle,          // Dial 4-6: best model for task shape
    Cascade,             // Try cheap first, escalate if quality estimator flags
    ImplementThenReview, // Execute with one model, review with another
    DualRace,            // Two providers race, pick best result
    VerifiedSingle,      // One model + independent verification
}

pub struct TemplateConfig {
    pub template: RouteTemplate,
    pub min_dial: u8,
    pub max_dial: u8,
    pub min_providers: u8,
    pub estimated_cost_multiplier: f64,  // vs CheapSingle baseline
}
```

**Acceptance criteria:**
- [ ] Bandit scorer selects template, not just provider
- [ ] Templates enforce their own constraints (DualRace requires 2+ providers)
- [ ] Dial range filtering prevents expensive templates at low dial
- [ ] Each template produces a concrete execution plan (ordered steps)

---

### Gap 6: SQLite Persistence (UPGRADE — replace JSONL)

**Why:** JSONL works for prototyping. SQLite works for production queries (arm stats, recent evidence, contamination lookups).

**What:** Migrate ledger from JSONL to SQLite with tables for events, arm_stats, evidence_signals, contamination_scores.

**Acceptance criteria:**
- [ ] All LedgerEvent types stored in SQLite
- [ ] Arm stats queryable without full-scan
- [ ] Evidence signals queryable by task_id, risk_level, contamination range
- [ ] Migration from existing JSONL data
- [ ] WAL mode for concurrent reads during routing

---

## Build Waves

### Wave 1: Core Intelligence (parallel agents)
- **Agent A:** Contamination tracking (`contamination.rs` + integrate into LedgerEvent)
- **Agent B:** Evidence floors (`evidence_floor.rs` + policy gate enforcement)
- **Agent C:** UCB bandit scorer (`bandit.rs` + replace pressure scorer)

### Wave 2: Decision Pipeline (parallel agents)
- **Agent D:** Confidence → Autonomy pipeline (`autonomy.rs` + integrate into captain)
- **Agent E:** Route templates (`templates.rs` + template selection in bandit)
- **Agent F:** SQLite persistence (migrate ledger, add arm_stats table)

### Wave 3: Integration + Testing
- **Agent G:** Wire everything together — decomposer → scheduler → policy gate → bandit → template → execute → evidence → update
- **Agent H:** Integration tests — the 5 proofs from the battle test

### Wave 4: CLI + UX
- **Agent I:** CLI commands: `cortex route "..."`, `cortex status`, `cortex ledger`, `cortex explain <task_id>`
- **Agent J:** Evidence receipt output — after each task, show routing decision + evidence + contamination

---

## The 5 Proofs (Success Criteria for v0.1)

1. **Pressure scorer beats static:** Run 20 tasks. Compare UCB routing vs always-pick-best-model. Measure success rate.
2. **Contamination catches circular validation:** Generate code with Claude, generate tests with Claude, run them. Contamination tracker flags it as high-contamination (≥ 0.7).
3. **Cold start works at 20-50 interactions:** Use Cortex for 50 tasks. Plot routing quality over time. Show improvement curve.
4. **Evidence floor blocks unsafe route:** Route auth code change to cheap model without tests. Floor blocks it. Route same change with tests. Floor allows it.
5. **Three-mode abstraction holds:** Wrap Cortex core as a Soma Delegation-receiving agent. Send it a task via delegation key. Verify it respects the delegation scope and reports back.

---

## What We Explicitly DON'T Build in v0.1

- ❌ Thompson sampling (v2 — after evidence quality validated)
- ❌ Shapley credit assignment (v2 — UCB attribution is sufficient)
- ❌ Soma Pulse Tree integration
- ❌ x402 marketplace / Cortex Insights
- ❌ HeyData skill mode
- ❌ Team features / subscription pooling
- ❌ Editor integrations (CLI only)
- ❌ Multi-surface (iOS/desktop/web — CLI only for now)
- ❌ Nova IVC / cryptographic proofs
- ❌ Federated intelligence aggregation
- ❌ Enterprise compliance features

---

## Confidence Assessment

| Aspect | Confidence | Evidence |
|--------|-----------|----------|
| Can we build v0.1? | **10/10** | 60%+ code exists, build pipeline proven |
| Will UCB beat static routing? | **8/10** | Literature validates, need our own proof |
| Will contamination tracking work? | **9/10** | Conceptually clean, implementation straightforward |
| Will evidence floors prevent real mistakes? | **9/10** | Simple policy enforcement, easy to test |
| Will strangers care? | **7/10** | User + friends confirm demand, broader market unproven |
| Will teams pay? | **5/10** | Logical value prop, zero validation yet |

**Overall confidence to START BUILDING: 10/10**
**Overall confidence it SHIPS as working product: 9/10**
**Overall confidence it finds paying users: 6/10** (needs the 5 proofs + real users)
