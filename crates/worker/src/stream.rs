use serde::Serialize;

use cortex_core::failure::WorkerFailureReport;
use cortex_core::protocol::StepOutput;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerEvent {
    Started {
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        provider: String,
        model: String,
    },
    Output {
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        line: String,
    },
    Completed {
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        exit_code: i32,
        base_commit: Option<String>,
        head_commit: Option<String>,
        branch: Option<String>,
        output: StepOutput,
    },
    Failed {
        step_id: String,
        attempt_id: String,
        lease_gen: i64,
        failure: WorkerFailureReport,
    },
}
