use serde::{Deserialize, Serialize};

use crate::failure::WorkerFailureReport;
use crate::provider::ProviderId;
use crate::routing::RoutingDecision;
use crate::task::TaskContract;

// 3: adds `StepBlocked`. A worker that speaks 3 can tell an operator's
// infrastructure failure apart from a customer's step failing, which v2 could
// only express by prefixing a failure string.
pub const PROTOCOL_VERSION: u32 = 3;

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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        delegation: Option<serde_json::Value>,
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
        /// What the worker is actually about to run: image, isolation class,
        /// resource profile, network policy, model identity, and the budgets
        /// in force.
        ///
        /// Optional so a worker built before this field still parses. A
        /// missing job is recorded as missing rather than filled in with a
        /// plausible default — a receipt that guesses its own provenance is
        /// worse than one that admits it does not have it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        execution_job: Option<crate::execution_job::ExecutionJob>,
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
    /// The worker refused to execute: it could not establish the isolation the
    /// job required.
    ///
    /// Distinct from `StepFailed`, which is a report about work that ran. A
    /// refusal is an operator's infrastructure problem, and routing it through
    /// the failure channel attributes it to the customer's step. PR C had to
    /// do exactly that — a refusal travelled as a `StepFailed` whose reason
    /// was prefixed `BLOCKED:` — because there was no blocked state to
    /// transition to. There is now.
    StepBlocked {
        message_id: String,
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        blocked: crate::execution_job::Blocked,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<WorkerEvidencePacket>,
    #[serde(default)]
    pub tokens_in: Option<i64>,
    #[serde(default)]
    pub tokens_out: Option<i64>,
    #[serde(default)]
    pub cost_estimate: Option<f64>,
    pub structured: serde_json::Value,
}

impl Default for StepOutput {
    fn default() -> Self {
        Self {
            summary: String::new(),
            files_found: Vec::new(),
            files_changed: Vec::new(),
            evidence: None,
            tokens_in: None,
            tokens_out: None,
            cost_estimate: None,
            structured: serde_json::Value::Null,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkerEvidencePacket {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git: Option<GitEvidence>,
    #[serde(default)]
    pub command: CommandEvidence,
    #[serde(default)]
    pub checks: Vec<CheckEvidence>,
    #[serde(default)]
    pub parsed_files_changed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitEvidence {
    #[serde(default)]
    pub changed_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_excerpt: Option<String>,
    #[serde(default)]
    pub diff_truncated: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_porcelain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommandEvidence {
    pub exit_code: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout_excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr_excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub log_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckEvidence {
    pub name: String,
    pub command: String,
    #[serde(default = "default_required_check")]
    pub required: bool,
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stdout_excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stderr_excerpt: Option<String>,
    #[serde(default)]
    pub timed_out: bool,
    #[serde(default)]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepContext {
    pub predecessor_summaries: Vec<PredecessorSummary>,
    pub user_goal: String,
    pub conversation_excerpt: Option<String>,
    /// A ranked skeleton of the repository (CONTEXT.md C1), already fitted to
    /// the step's token budget. Optional and `serde(default)` so payloads
    /// written before this field still deserialize — a worker mid-run must not
    /// break because the brain learned to send more context.
    #[serde(default)]
    pub repo_map: Option<String>,
}

fn default_required_check() -> bool {
    true
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
            repo_map: None,
        }
    }
}
