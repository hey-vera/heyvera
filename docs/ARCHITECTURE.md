# Cortex Architecture — Design Specification

> Finalized via dual-brain (Claude Opus + GPT 5.5) architectural review.
> This document is the source of truth for the Rust implementation.

## Core Principle

**Brain owns decisions, state, policy, and recovery. Workers own local execution and user-provider access.**

---

## 1. State Layer — SQLite

One database. WAL mode. All operational state lives here.

### Tables

```sql
-- User & auth
CREATE TABLE users (
    id          TEXT PRIMARY KEY,  -- Clerk user ID or "local"
    email       TEXT,
    created_at  INTEGER NOT NULL,  -- epoch ms
    updated_at  INTEGER NOT NULL
);

-- Conversations (chat UI)
CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT 'New Chat',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,  -- user, assistant, system
    content         TEXT NOT NULL,
    provider        TEXT,
    model           TEXT,
    created_at      INTEGER NOT NULL
);

-- Provider capabilities (claims + verification)
CREATE TABLE provider_capabilities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    provider        TEXT NOT NULL,  -- claude, openai, gemini
    status          TEXT NOT NULL DEFAULT 'claimed',  -- claimed, verified, degraded, cooling_down, unavailable
    last_reported   INTEGER NOT NULL,
    last_verified   INTEGER,
    last_success    INTEGER,
    last_failure    INTEGER,
    failure_streak  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(worker_id, provider)
);

-- Decision ledger (routing decisions + outcomes)
CREATE TABLE decisions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    run_id          TEXT,
    step_id         TEXT,
    timestamp       INTEGER NOT NULL,
    intent          TEXT NOT NULL,
    risk            TEXT NOT NULL,
    tier            TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    worker_id       TEXT,
    rationale       TEXT NOT NULL,
    profile         TEXT NOT NULL DEFAULT 'auto'
);

CREATE TABLE outcomes (
    id              TEXT PRIMARY KEY,
    decision_id     TEXT NOT NULL REFERENCES decisions(id),
    timestamp       INTEGER NOT NULL,
    success         INTEGER NOT NULL,  -- 0 or 1
    duration_ms     INTEGER,
    failure_kind    TEXT,              -- TaskFailureKind enum
    failure_scope   TEXT,              -- FailureScope enum
    files_changed   TEXT,             -- JSON array
    exit_code       INTEGER
);

-- Usage tracking (for pressure calculation)
CREATE TABLE usage_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    provider    TEXT NOT NULL,
    tier        TEXT NOT NULL,
    model       TEXT NOT NULL,
    worker_id   TEXT,
    tokens_in   INTEGER,
    tokens_out  INTEGER,
    duration_ms INTEGER
);

CREATE INDEX idx_usage_window ON usage_events(provider, timestamp);

-- Task orchestration (Ship Captain)
CREATE TABLE runs (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    goal            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    -- pending, planning, running, succeeded, failed, cancelled
    profile         TEXT NOT NULL DEFAULT 'auto',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    started_at      INTEGER,
    finished_at     INTEGER,
    failure_reason  TEXT,
    heal_attempts   INTEGER NOT NULL DEFAULT 0,
    version         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE steps (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES runs(id),
    kind            TEXT NOT NULL,
    -- search, execute, think, test, build, lint, heal, review, gate
    status          TEXT NOT NULL DEFAULT 'pending',
    -- pending, ready, leased, running, succeeded, failed, cancelled, orphaned, skipped
    depends_on      TEXT NOT NULL DEFAULT '[]',  -- JSON array of step IDs
    tier            TEXT NOT NULL,
    risk            TEXT NOT NULL,
    objective       TEXT NOT NULL,
    input_context   TEXT,           -- JSON: compact context from predecessors
    output_summary  TEXT,
    files_changed   TEXT,           -- JSON array
    attempt_count   INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    lease_gen       INTEGER NOT NULL DEFAULT 0,
    lease_deadline  INTEGER,
    assigned_worker TEXT,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    version         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE step_attempts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id         TEXT NOT NULL REFERENCES steps(id),
    run_id          TEXT NOT NULL,
    attempt_number  INTEGER NOT NULL,
    worker_id       TEXT,
    lease_gen       INTEGER NOT NULL,
    status          TEXT NOT NULL,  -- started, succeeded, failed, orphaned
    provider        TEXT,
    model           TEXT,
    started_at      INTEGER NOT NULL,
    finished_at     INTEGER,
    failure_kind    TEXT,
    error_summary   TEXT
);

-- Score evidence (for explainability and replay)
CREATE TABLE score_evidence (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id     TEXT NOT NULL REFERENCES decisions(id),
    evaluator       TEXT NOT NULL,  -- intent, risk, budget, provider_fit, quality
    evidence_json   TEXT NOT NULL,  -- full typed evidence as JSON
    score           REAL,
    timestamp       INTEGER NOT NULL
);
```

### Key Query Patterns

```sql
-- Pressure calculation (rolling 5-hour window)
SELECT provider, tier, SUM(tokens_in + tokens_out) as total_tokens
FROM usage_events
WHERE timestamp > ? AND user_id = ?
GROUP BY provider, tier;

-- Provider reliability (last 24h)
SELECT provider, 
    COUNT(*) as total,
    SUM(success) as successes,
    AVG(duration_ms) as avg_duration
FROM outcomes o
JOIN decisions d ON o.decision_id = d.id
WHERE o.timestamp > ? AND d.user_id = ?
GROUP BY provider;

-- Ready steps (dependencies satisfied)
SELECT s.* FROM steps s
WHERE s.run_id = ? AND s.status = 'pending'
AND NOT EXISTS (
    SELECT 1 FROM steps dep
    WHERE dep.id IN (SELECT value FROM json_each(s.depends_on))
    AND dep.status != 'succeeded'
);

-- Expire stale leases
UPDATE steps SET status = 'orphaned', version = version + 1
WHERE status = 'leased' AND lease_deadline < ?;

-- CAS step transition
UPDATE steps SET status = ?, version = version + 1, updated_at = ?
WHERE id = ? AND status = ? AND version = ?;
```

---

## 2. Intent Resolution — Deterministic First

Layered resolution, no LLM for parsing:

```
Layer 1: Explicit commands         ("/fix", "/explore", "/review")
Layer 2: Pattern match             (regex on keywords — 90% of cases)
Layer 3: Compound decomposition    ("fix X and test Y" → 2 steps)
Layer 4: Clarification             (ambiguous → ask user)
Layer 5: Template response         (format results without LLM)
```

### Intent Enum

```rust
pub enum Intent {
    Fix,        // fix, repair, patch, resolve, debug
    Add,        // add, create, implement, build, write
    Explore,    // explore, find, search, grep, where, what
    Review,     // review, audit, check, inspect
    Think,      // should we, how should, architecture, design
    Test,       // test, verify, validate, check
    Refactor,   // refactor, clean, simplify, restructure
    Ship,       // ship, deploy, release, publish, PR
}
```

### Compound Decomposition

Split on: `and|also|then|after that|plus|,`

Each segment gets independent intent + risk classification → becomes a Step in the run DAG.

Ordered language (`then|after|first|before`) → sequential dependencies.
No ordering cues + independent subsystems → parallel (no depends_on).

---

## 3. Scoring — Evaluator + Policy Judge

### Architecture

```rust
#[async_trait]
pub trait Evaluator: Send + Sync {
    type Evidence: Serialize + Send + Sync;
    async fn evaluate(&self, ctx: &EvalContext) -> Result<Self::Evidence>;
}

pub struct DecisionEvidence {
    pub intent: IntentEvidence,
    pub risk: RiskEvidence,
    pub budget: BudgetEvidence,
    pub provider_fit: ProviderFitEvidence,
}

pub trait RoutingPolicy: Send + Sync {
    fn decide(&self, evidence: &DecisionEvidence, profile: &Profile) -> RoutingDecision;
}
```

### Evaluators

**IntentEvaluator** — pattern-match keywords → Intent + confidence.

**RiskEvaluator** — three layers:
1. Static keyword patterns (fast, 90%)
2. File path patterns (auth/, billing/, etc.)
3. Historical success rate from `outcomes` table

```rust
pub struct RiskEvidence {
    pub level: RiskLevel,
    pub basis: RiskBasis,  // static, file_path, historical, combined
    pub static_level: RiskLevel,
    pub file_risk: Option<RiskLevel>,
    pub history_success_rate: Option<f64>,
}
```

**BudgetEvaluator** — rolling window pressure per provider/tier:

```rust
pub struct BudgetEvidence {
    pub pressures: HashMap<(ProviderId, Tier), PressureState>,
}

pub enum PressureState {
    Healthy(f64),     // 0-65%
    Warm(f64),        // 65-82%
    Hot(f64),         // 82-95%
    Throttled(f64),   // 95%+
}
```

**ProviderFitEvaluator** — capability match, isolation, coupling:

```rust
pub struct ProviderFitEvidence {
    pub candidates: Vec<CandidateScore>,
}

pub struct CandidateScore {
    pub provider: ProviderId,
    pub worker_id: String,
    pub capability_status: ProviderStatus,
    pub pressure_penalty: f64,
    pub fit_bonus: f64,         // coupling/isolation match
    pub latency_penalty: f64,   // startup overhead for short tasks
    pub reliability: f64,       // from outcome history
    pub total: f64,
}
```

### Policy Function

The policy is profile-aware. It takes all evidence and applies profile-specific weights:

```rust
impl RoutingPolicy for DefaultPolicy {
    fn decide(&self, evidence: &DecisionEvidence, profile: &Profile) -> RoutingDecision {
        // 1. Filter: remove providers that can't serve this tier/risk
        // 2. Score: weight evidence by profile
        // 3. Select: highest scoring candidate
        // 4. Explain: build rationale from evidence
    }
}
```

Both evidence AND decision are persisted to `decisions` + `score_evidence` tables.

---

## 4. Failure Taxonomy

### Two-part model: Worker reports evidence, Brain classifies

Worker sends structured failure:

```rust
pub struct WorkerFailureReport {
    pub task_id: Uuid,
    pub kind: WorkerFailureKind,
    pub exit_code: Option<i32>,
    pub stderr_excerpt: Option<String>,  // last 500 chars
    pub tool: Option<String>,            // claude, codex, gemini
}

pub enum WorkerFailureKind {
    CliNotFound,
    CliNotAuthenticated,
    CliAuthExpired,
    CliRateLimited,
    CliModelUnavailable,
    CliCrashed,
    ProcessTimeout,
    ProcessKilled,
    NetworkError,
    PermissionDenied,
    OutputEmpty,
    Unknown,
}
```

Brain enriches with its own observations:

```rust
pub enum TaskFailureKind {
    // Provider scope — affects provider scoring
    ProviderAuthExpired,
    ProviderQuotaExceeded,
    ProviderRateLimited,
    ProviderModelUnavailable,
    ProviderServiceDown,
    ProviderSafetyRefusal,

    // Worker scope — affects worker reliability
    CliNotInstalled,
    CliNotAuthenticated,
    WorkerCrashed,
    WorkerDisconnected,
    WorkerResourceExhausted,

    // Task scope — no provider/worker penalty
    TaskTimeout,
    TaskCancelled,
    PermissionDenied,
    TestsFailed,
    BuildFailed,
    QualityFailure,
    OutputEmpty,
    OutputInvalid,

    // Workspace scope
    GitConflict,
    GitPushRejected,
    WorkspaceDirty,
    ConflictingEdits,

    Unknown,
}

pub enum FailureScope {
    Provider,
    ProviderAccount,
    ProviderModel,
    Worker,
    WorkerTooling,
    Task,
    Workspace,
    User,
    Unknown,
}
```

### Routing impact matrix

| Failure Kind | Scope | Retry Action | Scoring Impact |
|---|---|---|---|
| ProviderAuthExpired | ProviderAccount | Different provider; ask user to re-auth | Account cooldown until refresh |
| ProviderQuotaExceeded | ProviderAccount | Different provider | Account cooldown until reset |
| ProviderRateLimited | ProviderModel | Same provider after backoff | Temporary pressure increase |
| ProviderModelUnavailable | ProviderModel | Same provider, fallback model | Model penalty (permanent if deprecated) |
| ProviderServiceDown | Provider | Different provider | Temporary global cooldown |
| ProviderSafetyRefusal | Task | Ask user to revise | No penalty |
| CliNotInstalled | WorkerTooling | Different worker/provider | Worker-tooling penalty until fixed |
| CliNotAuthenticated | WorkerTooling | Ask user to auth | Worker-tooling penalty until fixed |
| WorkerCrashed | Worker | Different worker | Temporary worker cooldown |
| WorkerDisconnected | Worker | Wait for reconnect or reassign | Temporary worker cooldown |
| TaskTimeout | Task | Retry with larger model or decompose | No penalty (penalize task shape) |
| TestsFailed | Task | Heal step (up to 2x) | Quality signal, not reliability |
| BuildFailed | Task | Heal step (up to 2x) | Quality signal |
| GitConflict | Workspace | Ask user or rebase | No penalty |

---

## 5. Ship Captain — Task Orchestration

### Run Lifecycle

```
pending → planning → running → succeeded
                         ↓
                       failed
                         ↓
                      cancelled
```

### Step Lifecycle

```
pending → ready → leased → running → succeeded
                     ↓         ↓
                  orphaned   failed → (retry?) → ready
                     ↓
                   ready (requeued)
```

### Step Model

Steps form a DAG via `depends_on`. A step becomes `ready` when all dependencies are `succeeded`. Brain checks readiness after every step state change.

### Dynamic Heal Insertion

When a test/build step fails:
1. Brain checks `run.heal_attempts < max_heal_attempts` (default: 2)
2. Inserts a new `heal` step that depends on the failed step
3. Inserts a retry of the original test step that depends on the heal step
4. If same failure signature repeats → stop healing, fail the run

```
edit → test(failed) → heal₁ → test_retry₁(failed) → heal₂ → test_retry₂
```

### Lease Model

- Brain assigns `(step_id, lease_gen, deadline)` to a Worker
- Deadline scales by step kind: search=2min, execute=10min, think=15min
- Worker sends heartbeats to extend lease
- If heartbeat stops → Brain waits until deadline → marks `orphaned` → requeues
- Late results with stale `lease_gen` are rejected

### Multi-Worker Selection

```rust
fn select_worker(step: &Step, workers: &[ConnectedWorker]) -> Option<WorkerId> {
    workers.iter()
        .filter(|w| w.has_provider(step.required_provider()))
        .filter(|w| w.capability_status(step.provider) != Unavailable)
        .filter(|w| step.required_repo.is_none() || w.has_repo(step.required_repo))
        .max_by_key(|w| worker_score(w, step))
}
```

Prefer: verified providers > claimed, low queue depth, matching repo.

### Step Output Chaining

Steps produce structured output:

```rust
pub struct StepOutput {
    pub summary: String,
    pub files_found: Vec<String>,
    pub files_changed: Vec<String>,
    pub structured: serde_json::Value,  // step-kind-specific data
}
```

Brain builds compact `StepContext` for successor steps from predecessor summaries + declared structured fields. Full transcripts stay in artifacts, not in context.

### Brain Restart Recovery

1. Load all runs where `status IN ('planning', 'running')`
2. Mark all worker connections as unknown (they'll re-register)
3. Expire leases where `deadline < now()`
4. Requeue orphaned steps (if retries remaining)
5. Recompute ready steps from DAG
6. Resume scheduler loop

All state transitions use CAS: `WHERE version = ? ... SET version = version + 1`

---

## 6. Profiles

Four profiles that configure the policy function:

| Profile | Risk Floor | Heal Attempts | Provider Bias | Budget Warn/Limit |
|---|---|---|---|---|
| auto | adaptive | 2 | balance by pressure | $5 / $10 |
| balanced | medium | 2 | even split | $5 / $10 |
| cost-saver | high | 1 | prefer cheaper | $2 / $5 |
| quality-first | low | 3 | prefer strongest | $15 / $30 |

Natural language aliases: "cheap" → cost-saver, "careful" → quality-first, "fast" → cost-saver, "thorough" → quality-first.

Profiles are persisted per-user in SQLite.

---

## 7. Wire Protocol v2

### Brain → Worker

```rust
pub enum BrainMessage {
    Welcome { session_id: String },
    ExecuteStep {
        run_id: String,
        step_id: String,
        lease_gen: i64,
        lease_deadline_ms: i64,
        task: TaskContract,
        decision: RoutingDecision,
        context: StepContext,
    },
    CancelStep { step_id: String },
    Ping,
}
```

### Worker → Brain

```rust
pub enum WorkerMessage {
    Register {
        worker_id: String,
        user_id: String,
        token: String,
        providers: Vec<ProviderClaim>,
        workspace_dir: String,
        repos: Vec<RepoInfo>,
    },
    StepStarted {
        step_id: String,
        lease_gen: i64,
        provider: String,
        model: String,
    },
    StepOutput {
        step_id: String,
        lease_gen: i64,
        line: String,
    },
    StepCompleted {
        step_id: String,
        lease_gen: i64,
        exit_code: i32,
        output: StepOutput,
    },
    StepFailed {
        step_id: String,
        lease_gen: i64,
        failure: WorkerFailureReport,
    },
    Heartbeat {
        worker_id: String,
        active_steps: Vec<String>,
    },
    Pong,
}

pub struct ProviderClaim {
    pub provider: ProviderId,
    pub cli_version: Option<String>,
}

pub struct RepoInfo {
    pub path: String,
    pub remote_url: Option<String>,
    pub branch: Option<String>,
}
```

### Key changes from v1:
- `ExecuteTask` → `ExecuteStep` (step-aware, includes lease + context)
- `StepCompleted` includes structured `StepOutput`
- `StepFailed` includes typed `WorkerFailureReport` (not just string)
- `Register` includes `ProviderClaim` with version + `RepoInfo`
- `Heartbeat` includes list of active steps (Brain can detect orphans)
- All step messages include `lease_gen` for stale rejection

---

## 8. Test Strategy

### Test Pyramid

```
Unit (70%)     — evaluators, state machine reducer, intent parser, risk classifier
Integration    — Brain + MockWorker via real WebSocket, real SQLite
(25%)            scenario-driven: success, retry, timeout, disconnect, heal
E2E (5%)       — full stack smoke test with mock CLI
```

### Mock Worker

Scenario-driven test Worker that simulates various failure modes:

```rust
pub struct MockWorkerConfig {
    pub brain_url: String,
    pub worker_id: String,
    pub scenario: Scenario,
}

pub enum ScenarioStep {
    Succeed { delay_ms: u64 },
    FailWith { kind: WorkerFailureKind, delay_ms: u64 },
    Timeout,
    Disconnect,
    SlowStream { lines: Vec<String>, delay_per_line_ms: u64 },
}
```

### Routing Replay

Record real routing decisions as fixtures. Replay against new scoring logic:

```rust
#[test]
fn replay_routing_ledger() {
    for entry in load_fixtures("tests/fixtures/routing/*.json") {
        let actual = policy.decide(&entry.evidence, &entry.profile);
        assert_properties(&actual, &entry.expected_properties);
    }
}
```

Semantic assertions over exact score matching:
- "critical risk never routes to search tier"
- "throttled provider never wins"
- "verified provider preferred over claimed"

### State Machine Invariants (proptest)

- Completed run has no pending/running steps
- Failed run has terminal failure reason
- Retry count never exceeds policy
- Terminal states are absorbing
- Every dispatched step has a worker assignment
- Stale lease completions are rejected

---

## 9. What This Design Does NOT Include (Intentionally Deferred)

- LLM-powered intent parsing (deterministic is enough for v1)
- Multi-Brain / distributed coordination (single process is fine at scale)
- x402 billing integration (log usage events, wire later)
- VeraAI observation pipeline (schema ready, integration deferred)
- Soma reputation wiring (event schema ready, implementation deferred)
- Gemini provider support (enum exists, executor stubbed)
- Desktop app (Tauri, after web is solid)
- Mobile app (iOS, after desktop)
- Agent hierarchy / manager layers
- Subscription pooling / team features
