use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// --- Run & Step types ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Pending,
    Planning,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Planning => "planning",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "planning" => Some(Self::Planning),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Ready,
    Leased,
    Running,
    Succeeded,
    Failed,
    Recovered,
    Cancelled,
    Orphaned,
    Skipped,
}

impl StepStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Recovered | Self::Cancelled | Self::Skipped
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Leased => "leased",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Recovered => "recovered",
            Self::Cancelled => "cancelled",
            Self::Orphaned => "orphaned",
            Self::Skipped => "skipped",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "ready" => Some(Self::Ready),
            "leased" => Some(Self::Leased),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            "recovered" => Some(Self::Recovered),
            "cancelled" => Some(Self::Cancelled),
            "orphaned" => Some(Self::Orphaned),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    Search,
    Execute,
    Think,
    Test,
    Build,
    Lint,
    Heal,
    Review,
    Gate,
}

impl StepKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Search => "search",
            Self::Execute => "execute",
            Self::Think => "think",
            Self::Test => "test",
            Self::Build => "build",
            Self::Lint => "lint",
            Self::Heal => "heal",
            Self::Review => "review",
            Self::Gate => "gate",
        }
    }

    pub fn lease_duration_ms(&self) -> i64 {
        match self {
            Self::Search => 2 * 60 * 1000,
            Self::Execute => 10 * 60 * 1000,
            Self::Think | Self::Review => 15 * 60 * 1000,
            Self::Test | Self::Build | Self::Lint => 10 * 60 * 1000,
            Self::Heal => 10 * 60 * 1000,
            Self::Gate => 5 * 60 * 1000,
        }
    }

    pub fn is_healable(&self) -> bool {
        matches!(self, Self::Execute | Self::Test | Self::Build | Self::Lint)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    SuccessRequired,
    CompletionRequired,
}

impl EdgeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SuccessRequired => "success_required",
            Self::CompletionRequired => "completion_required",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "success_required" => Some(Self::SuccessRequired),
            "completion_required" => Some(Self::CompletionRequired),
            _ => None,
        }
    }

    pub fn is_satisfied(&self, dep_status: StepStatus) -> bool {
        match self {
            Self::SuccessRequired => dep_status == StepStatus::Succeeded,
            Self::CompletionRequired => dep_status.is_terminal(),
        }
    }
}

// --- Scheduler events ---

#[derive(Debug, Clone)]
pub enum SchedulerEvent {
    RunCreated {
        run_id: String,
    },
    StepCompleted {
        run_id: String,
        step_id: String,
        cost_estimate: Option<f64>,
    },
    StepFailed {
        run_id: String,
        step_id: String,
    },
    WorkerConnected {
        worker_id: String,
    },
    WorkerDisconnected {
        worker_id: String,
    },
    ProviderAuthExpired {
        worker_id: String,
        provider: String,
        user_id: String,
    },
    Reconcile,
}

// --- Scheduler state ---

#[derive(Debug)]
pub struct UserQueue {
    pub ready_steps: VecDeque<StepRef>,
    pub running_count: usize,
    pub max_concurrent: usize,
}

impl Default for UserQueue {
    fn default() -> Self {
        Self {
            ready_steps: VecDeque::new(),
            running_count: 0,
            max_concurrent: 5,
        }
    }
}

impl UserQueue {
    pub fn has_capacity(&self) -> bool {
        self.running_count < self.max_concurrent
    }
}

#[derive(Debug, Clone)]
pub struct StepRef {
    pub step_id: String,
    pub run_id: String,
    pub user_id: String,
    pub kind: StepKind,
    pub tier: String,
    pub risk: String,
    pub objective: String,
}

pub struct SchedulerState {
    pub user_queues: HashMap<String, UserQueue>,
    pub schedulable_users: VecDeque<String>,
    enqueued_step_ids: HashSet<String>,
}

impl SchedulerState {
    pub fn new() -> Self {
        Self {
            user_queues: HashMap::new(),
            schedulable_users: VecDeque::new(),
            enqueued_step_ids: HashSet::new(),
        }
    }

    pub fn enqueue_ready_step(&mut self, step: StepRef) {
        // Deduplicate: skip if this step is already enqueued
        if !self.enqueued_step_ids.insert(step.step_id.clone()) {
            return;
        }

        let user_id = step.user_id.clone();
        let queue = self.user_queues.entry(user_id.clone()).or_default();
        queue.ready_steps.push_back(step);

        if !self.schedulable_users.contains(&user_id) {
            self.schedulable_users.push_back(user_id);
        }
    }

    pub fn next_assignable(&mut self) -> Option<StepRef> {
        let mut attempts = self.schedulable_users.len();
        while attempts > 0 {
            if let Some(user_id) = self.schedulable_users.pop_front() {
                let queue = self.user_queues.get_mut(&user_id);
                if let Some(q) = queue {
                    if q.has_capacity() {
                        if let Some(step) = q.ready_steps.pop_front() {
                            self.enqueued_step_ids.remove(&step.step_id);
                            q.running_count += 1;
                            if !q.ready_steps.is_empty() {
                                self.schedulable_users.push_back(user_id);
                            }
                            return Some(step);
                        }
                    } else {
                        self.schedulable_users.push_back(user_id);
                    }
                }
            }
            attempts -= 1;
        }
        None
    }

    pub fn mark_step_done(&mut self, user_id: &str) {
        if let Some(q) = self.user_queues.get_mut(user_id) {
            q.running_count = q.running_count.saturating_sub(1);

            if !q.ready_steps.is_empty()
                && q.has_capacity()
                && !self.schedulable_users.contains(&user_id.to_string())
            {
                self.schedulable_users.push_back(user_id.to_string());
            }
        }
    }
}

// --- Run builder (creates DAG from decomposed steps) ---

pub struct RunBuilder {
    pub run_id: String,
    pub user_id: String,
    pub goal: String,
    pub profile: String,
    steps: Vec<StepDef>,
    edges: Vec<(usize, usize, EdgeType)>,
}

pub struct StepDef {
    pub id: String,
    pub kind: StepKind,
    pub tier: String,
    pub risk: String,
    pub objective: String,
    pub required_provider: Option<String>,
    pub max_attempts: u32,
}

impl RunBuilder {
    pub fn new(user_id: String, goal: String, profile: String) -> Self {
        Self {
            run_id: Uuid::new_v4().to_string(),
            user_id,
            goal,
            profile,
            steps: Vec::new(),
            edges: Vec::new(),
        }
    }

    pub fn add_step(&mut self, kind: StepKind, tier: &str, risk: &str, objective: &str) -> usize {
        let idx = self.steps.len();
        self.steps.push(StepDef {
            id: Uuid::new_v4().to_string(),
            kind,
            tier: tier.to_string(),
            risk: risk.to_string(),
            objective: objective.to_string(),
            required_provider: None,
            max_attempts: 3,
        });
        idx
    }

    pub fn add_edge(&mut self, from: usize, to: usize, edge_type: EdgeType) {
        self.edges.push((from, to, edge_type));
    }

    pub fn add_sequential(&mut self, from: usize, to: usize) {
        self.add_edge(from, to, EdgeType::SuccessRequired);
    }

    pub fn steps(&self) -> &[StepDef] {
        &self.steps
    }

    pub fn edges(&self) -> &[(usize, usize, EdgeType)] {
        &self.edges
    }

    pub fn step_id(&self, idx: usize) -> &str {
        &self.steps[idx].id
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.steps.is_empty() {
            return Err("run has no steps".into());
        }

        for &(from, to, _) in &self.edges {
            if from >= self.steps.len() || to >= self.steps.len() {
                return Err(format!(
                    "edge references invalid step index: {from} -> {to}"
                ));
            }
            if from == to {
                return Err(format!("self-referencing edge at step {from}"));
            }
        }

        if self.has_cycle() {
            return Err("dependency cycle detected".into());
        }

        Ok(())
    }

    fn has_cycle(&self) -> bool {
        let n = self.steps.len();
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut in_degree = vec![0usize; n];

        for &(from, to, _) in &self.edges {
            adj[from].push(to);
            in_degree[to] += 1;
        }

        let mut queue: VecDeque<usize> = in_degree
            .iter()
            .enumerate()
            .filter(|&(_, d)| *d == 0)
            .map(|(i, _)| i)
            .collect();

        let mut visited = 0;
        while let Some(node) = queue.pop_front() {
            visited += 1;
            for &next in &adj[node] {
                in_degree[next] -= 1;
                if in_degree[next] == 0 {
                    queue.push_back(next);
                }
            }
        }

        visited != n
    }
}

// --- Heal insertion ---

pub struct HealPlan {
    pub heal_step_id: String,
    pub retry_step_id: String,
    pub heal_objective: String,
    pub retry_objective: String,
    pub failed_step_id: String,
    pub original_kind: StepKind,
    pub tier: String,
    pub risk: String,
}

pub fn plan_heal(
    failed_step_id: &str,
    original_kind: StepKind,
    original_objective: &str,
    tier: &str,
    risk: &str,
    last_error: Option<&str>,
    heal_attempt: u32,
) -> HealPlan {
    let error_context = last_error
        .map(|e| format!(" Error: {e}"))
        .unwrap_or_default();

    HealPlan {
        heal_step_id: Uuid::new_v4().to_string(),
        retry_step_id: Uuid::new_v4().to_string(),
        heal_objective: format!(
            "Fix the failure in step {failed_step_id} (attempt {heal_attempt}).{error_context}"
        ),
        retry_objective: format!("Retry: {original_objective}"),
        failed_step_id: failed_step_id.to_string(),
        original_kind,
        tier: tier.to_string(),
        risk: risk.to_string(),
    }
}

// --- Run completion check ---

pub fn check_run_completion(step_statuses: &[(String, StepStatus)]) -> Option<RunStatus> {
    if step_statuses.is_empty() {
        return None;
    }

    let all_terminal = step_statuses.iter().all(|(_, s)| s.is_terminal());
    if !all_terminal {
        return None;
    }

    let any_failed = step_statuses
        .iter()
        .any(|(_, s)| *s == StepStatus::Failed || *s == StepStatus::Skipped);

    if any_failed {
        Some(RunStatus::Failed)
    } else {
        Some(RunStatus::Succeeded)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_type_satisfaction() {
        assert!(EdgeType::SuccessRequired.is_satisfied(StepStatus::Succeeded));
        assert!(!EdgeType::SuccessRequired.is_satisfied(StepStatus::Failed));
        assert!(!EdgeType::SuccessRequired.is_satisfied(StepStatus::Running));

        assert!(EdgeType::CompletionRequired.is_satisfied(StepStatus::Succeeded));
        assert!(EdgeType::CompletionRequired.is_satisfied(StepStatus::Failed));
        assert!(EdgeType::CompletionRequired.is_satisfied(StepStatus::Cancelled));
        assert!(!EdgeType::CompletionRequired.is_satisfied(StepStatus::Running));
        assert!(!EdgeType::CompletionRequired.is_satisfied(StepStatus::Pending));
    }

    #[test]
    fn run_builder_linear_dag() {
        let mut builder = RunBuilder::new("u1".into(), "fix and test".into(), "auto".into());

        let edit = builder.add_step(StepKind::Execute, "execute", "medium", "fix the bug");
        let test = builder.add_step(StepKind::Test, "execute", "medium", "run tests");
        builder.add_sequential(edit, test);

        assert!(builder.validate().is_ok());
        assert_eq!(builder.steps().len(), 2);
        assert_eq!(builder.edges().len(), 1);
    }

    #[test]
    fn run_builder_diamond_dag() {
        let mut builder = RunBuilder::new("u1".into(), "parallel work".into(), "auto".into());

        let start = builder.add_step(StepKind::Search, "search", "low", "explore codebase");
        let fix_a = builder.add_step(StepKind::Execute, "execute", "medium", "fix module A");
        let fix_b = builder.add_step(StepKind::Execute, "execute", "medium", "fix module B");
        let test = builder.add_step(StepKind::Test, "execute", "medium", "run all tests");

        builder.add_sequential(start, fix_a);
        builder.add_sequential(start, fix_b);
        builder.add_sequential(fix_a, test);
        builder.add_sequential(fix_b, test);

        assert!(builder.validate().is_ok());
    }

    #[test]
    fn run_builder_detects_cycle() {
        let mut builder = RunBuilder::new("u1".into(), "bad dag".into(), "auto".into());

        let a = builder.add_step(StepKind::Execute, "execute", "low", "step a");
        let b = builder.add_step(StepKind::Execute, "execute", "low", "step b");
        let c = builder.add_step(StepKind::Execute, "execute", "low", "step c");

        builder.add_sequential(a, b);
        builder.add_sequential(b, c);
        builder.add_sequential(c, a);

        assert!(builder.validate().is_err());
    }

    #[test]
    fn run_builder_detects_self_edge() {
        let mut builder = RunBuilder::new("u1".into(), "self ref".into(), "auto".into());
        let a = builder.add_step(StepKind::Execute, "execute", "low", "step a");
        builder.add_sequential(a, a);

        assert!(builder.validate().is_err());
    }

    #[test]
    fn run_builder_empty_is_invalid() {
        let builder = RunBuilder::new("u1".into(), "empty".into(), "auto".into());
        assert!(builder.validate().is_err());
    }

    #[test]
    fn scheduler_round_robin() {
        let mut state = SchedulerState::new();

        // User A has 3 ready steps, User B has 1
        for i in 0..3 {
            state.enqueue_ready_step(StepRef {
                step_id: format!("a-{i}"),
                run_id: "r1".into(),
                user_id: "user-a".into(),
                kind: StepKind::Execute,
                tier: "execute".into(),
                risk: "low".into(),
                objective: format!("task a-{i}"),
            });
        }
        state.enqueue_ready_step(StepRef {
            step_id: "b-0".into(),
            run_id: "r2".into(),
            user_id: "user-b".into(),
            kind: StepKind::Execute,
            tier: "execute".into(),
            risk: "low".into(),
            objective: "task b-0".into(),
        });

        let first = state.next_assignable().unwrap();
        let second = state.next_assignable().unwrap();

        // Round-robin: first from user-a, then user-b
        assert_eq!(first.user_id, "user-a");
        assert_eq!(second.user_id, "user-b");
    }

    #[test]
    fn scheduler_respects_concurrency_limit() {
        let mut state = SchedulerState::new();

        // Set max_concurrent to 1 for user-a
        state
            .user_queues
            .entry("user-a".into())
            .or_default()
            .max_concurrent = 1;

        for i in 0..3 {
            state.enqueue_ready_step(StepRef {
                step_id: format!("a-{i}"),
                run_id: "r1".into(),
                user_id: "user-a".into(),
                kind: StepKind::Execute,
                tier: "execute".into(),
                risk: "low".into(),
                objective: format!("task {i}"),
            });
        }

        let first = state.next_assignable().unwrap();
        assert_eq!(first.step_id, "a-0");

        // Second call should return None (at capacity)
        assert!(state.next_assignable().is_none());

        // Mark done, should be able to get next
        state.mark_step_done("user-a");
        let next = state.next_assignable().unwrap();
        assert_eq!(next.step_id, "a-1");
    }

    #[test]
    fn check_run_all_succeeded() {
        let steps = vec![
            ("s1".into(), StepStatus::Succeeded),
            ("s2".into(), StepStatus::Succeeded),
        ];
        assert_eq!(check_run_completion(&steps), Some(RunStatus::Succeeded));
    }

    #[test]
    fn check_run_any_failed() {
        let steps = vec![
            ("s1".into(), StepStatus::Succeeded),
            ("s2".into(), StepStatus::Failed),
        ];
        assert_eq!(check_run_completion(&steps), Some(RunStatus::Failed));
    }

    #[test]
    fn check_run_recovered_is_terminal_but_not_failed() {
        let steps = vec![
            ("s1".into(), StepStatus::Recovered),
            ("s2".into(), StepStatus::Succeeded),
        ];
        assert_eq!(check_run_completion(&steps), Some(RunStatus::Succeeded));
    }

    #[test]
    fn check_run_still_running() {
        let steps = vec![
            ("s1".into(), StepStatus::Succeeded),
            ("s2".into(), StepStatus::Running),
        ];
        assert_eq!(check_run_completion(&steps), None);
    }

    #[test]
    fn heal_plan_creates_valid_ids() {
        let plan = plan_heal(
            "step-123",
            StepKind::Test,
            "run tests",
            "execute",
            "medium",
            Some("assertion failed: expected 4, got 3"),
            1,
        );

        assert_ne!(plan.heal_step_id, plan.retry_step_id);
        assert!(plan.heal_objective.contains("step-123"));
        assert!(plan.heal_objective.contains("assertion failed"));
        assert!(plan.retry_objective.contains("run tests"));
    }

    #[test]
    fn step_kind_lease_durations() {
        assert_eq!(StepKind::Search.lease_duration_ms(), 120_000);
        assert_eq!(StepKind::Execute.lease_duration_ms(), 600_000);
        assert_eq!(StepKind::Think.lease_duration_ms(), 900_000);
    }

    #[test]
    fn step_kind_healable() {
        assert!(StepKind::Execute.is_healable());
        assert!(StepKind::Test.is_healable());
        assert!(StepKind::Build.is_healable());
        assert!(StepKind::Lint.is_healable());
        assert!(!StepKind::Think.is_healable());
        assert!(!StepKind::Heal.is_healable());
    }

    #[test]
    fn heal_step_depends_on_failed_via_completion_required() {
        // Verify the heal workflow edge types
        // heal step depends on failed step with completion_required
        // retry step depends on heal step with success_required
        let mut builder = RunBuilder::new("u1".into(), "fix and test".into(), "auto".into());

        let edit = builder.add_step(StepKind::Execute, "execute", "medium", "fix bug");
        let test = builder.add_step(StepKind::Test, "execute", "medium", "run tests");
        builder.add_sequential(edit, test);

        // Simulate test failure → insert heal chain
        let heal = builder.add_step(StepKind::Heal, "execute", "medium", "fix the failure");
        let retry = builder.add_step(StepKind::Test, "execute", "medium", "retry tests");

        // heal depends on test being terminal (completion_required)
        builder.add_edge(test, heal, EdgeType::CompletionRequired);
        // retry depends on heal succeeding
        builder.add_sequential(heal, retry);

        assert!(builder.validate().is_ok());

        // Verify: heal's dependency on test is satisfied when test fails
        assert!(EdgeType::CompletionRequired.is_satisfied(StepStatus::Failed));
        // Verify: retry's dependency on heal requires success
        assert!(!EdgeType::SuccessRequired.is_satisfied(StepStatus::Failed));
        assert!(EdgeType::SuccessRequired.is_satisfied(StepStatus::Succeeded));
    }
}
