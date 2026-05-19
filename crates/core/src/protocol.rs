use serde::{Deserialize, Serialize};

use crate::failure::WorkerFailureReport;
use crate::provider::ProviderId;
use crate::routing::RoutingDecision;
use crate::task::TaskContract;

pub const PROTOCOL_VERSION: u32 = 2;

// --- Brain → Worker ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BrainMessage {
    Welcome {
        session_id: String,
        worker_id: String,
        protocol_version: u32,
    },
    ExecuteStep {
        run_id: String,
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        lease_deadline_ms: i64,
        workspace_id: String,
        base_commit: Option<String>,
        allowed_paths: Vec<String>,
        task: TaskContract,
        decision: RoutingDecision,
        context: StepContext,
    },
    CancelStep {
        step_id: String,
        reason: String,
    },
    StaleLeaseNotice {
        step_id: String,
        your_lease_gen: i64,
        current_lease_gen: i64,
        disposition: String,
    },
    Ping,
}

// --- Worker → Brain ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerMessage {
    Register {
        token: String,
        protocol_version: u32,
        providers: Vec<ProviderClaim>,
        workspace_dir: String,
        repos: Vec<RepoInfo>,
    },
    StepStarted {
        message_id: String,
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        provider: String,
        model: String,
    },
    StepOutput {
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        line: String,
    },
    StepCompleted {
        message_id: String,
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        exit_code: i32,
        base_commit: Option<String>,
        head_commit: Option<String>,
        branch: Option<String>,
        output: StepOutput,
    },
    StepFailed {
        message_id: String,
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        failure: WorkerFailureReport,
    },
    LeaseRenew {
        step_id: String,
        lease_gen: i64,
    },
    Heartbeat {
        active_steps: Vec<String>,
    },
    Pong,
}

// --- Supporting types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderClaim {
    pub provider: ProviderId,
    pub cli_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInfo {
    pub path: String,
    pub remote_url: Option<String>,
    pub branch: Option<String>,
    pub head_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepOutput {
    pub summary: String,
    pub files_found: Vec<String>,
    pub files_changed: Vec<String>,
    pub structured: serde_json::Value,
}

impl Default for StepOutput {
    fn default() -> Self {
        Self {
            summary: String::new(),
            files_found: Vec::new(),
            files_changed: Vec::new(),
            structured: serde_json::Value::Null,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepContext {
    pub predecessor_summaries: Vec<PredecessorSummary>,
    pub user_goal: String,
    pub conversation_excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredecessorSummary {
    pub step_id: String,
    pub kind: String,
    pub summary: String,
    pub files_changed: Vec<String>,
}

impl Default for StepContext {
    fn default() -> Self {
        Self {
            predecessor_summaries: Vec::new(),
            user_goal: String::new(),
            conversation_excerpt: None,
        }
    }
}
