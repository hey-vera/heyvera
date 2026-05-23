use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::provider::{ProviderId, Tier};
use crate::routing::RiskLevel;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskContract {
    pub id: Uuid,
    pub objective: String,
    pub tier: Tier,
    pub risk: RiskLevel,
    pub allowed_operations: Vec<Operation>,
    pub acceptance_criteria: Vec<String>,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_name: Option<String>,
    #[serde(default)]
    pub repo_path: Option<String>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub forbidden_paths: Vec<String>,
    #[serde(default)]
    pub expected_base_commit: Option<String>,
    #[serde(default)]
    pub autonomy: Option<String>,
    #[serde(default)]
    pub approval: Option<String>,
    #[serde(default)]
    pub budget_limit: Option<f64>,
    #[serde(default)]
    pub rollback_notes: Option<String>,
    #[serde(default)]
    pub required_checks: Vec<RequiredCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequiredCheck {
    pub name: String,
    pub command: String,
    #[serde(default = "default_required_check")]
    pub required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Read,
    Edit,
    Create,
    Delete,
    Test,
    GitCommit,
    GitPush,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: Uuid,
    pub status: TaskStatus,
    pub provider: ProviderId,
    pub files_changed: Vec<String>,
    pub tests_run: Option<TestOutcome>,
    pub duration_ms: u64,
    pub output_summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    AwaitingApproval,
    Approved,
    Rejected,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestOutcome {
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
}

impl TaskContract {
    pub fn new(objective: String, tier: Tier, risk: RiskLevel) -> Self {
        Self {
            id: Uuid::new_v4(),
            objective,
            tier,
            risk,
            allowed_operations: default_operations_for_tier(tier),
            acceptance_criteria: Vec::new(),
            created_at: Utc::now(),
            project_id: None,
            project_name: None,
            repo_path: None,
            allowed_paths: Vec::new(),
            forbidden_paths: Vec::new(),
            expected_base_commit: None,
            autonomy: None,
            approval: None,
            budget_limit: None,
            rollback_notes: None,
            required_checks: Vec::new(),
        }
    }

    pub fn with_allowed_paths(mut self, allowed_paths: Vec<String>) -> Self {
        self.allowed_paths = allowed_paths;
        self
    }

    pub fn with_expected_base_commit(mut self, expected_base_commit: Option<String>) -> Self {
        self.expected_base_commit = expected_base_commit;
        self
    }

    pub fn with_dispatch_contract(
        self,
        allowed_paths: Vec<String>,
        expected_base_commit: Option<String>,
    ) -> Self {
        self.with_allowed_paths(allowed_paths)
            .with_expected_base_commit(expected_base_commit)
    }
}

fn default_operations_for_tier(tier: Tier) -> Vec<Operation> {
    match tier {
        Tier::Search => vec![Operation::Read],
        Tier::Execute => vec![
            Operation::Read,
            Operation::Edit,
            Operation::Create,
            Operation::Test,
        ],
        Tier::Think => vec![Operation::Read],
    }
}

fn default_required_check() -> bool {
    true
}
