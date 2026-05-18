use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::provider::ProviderId;
use crate::routing::RoutingDecision;
use crate::task::TaskContract;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BrainMessage {
    Welcome {
        session_id: String,
    },
    ExecuteTask {
        task: TaskContract,
        decision: RoutingDecision,
    },
    CancelTask {
        task_id: Uuid,
    },
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerMessage {
    Register {
        worker_id: String,
        user_id: String,
        token: String,
        available_providers: Vec<ProviderId>,
        workspace_dir: String,
    },
    TaskStarted {
        task_id: Uuid,
        provider: String,
        model: String,
    },
    TaskOutput {
        task_id: Uuid,
        line: String,
    },
    TaskCompleted {
        task_id: Uuid,
        exit_code: i32,
    },
    TaskFailed {
        task_id: Uuid,
        error: String,
    },
    Pong,
    Heartbeat {
        worker_id: String,
        available_providers: Vec<ProviderId>,
    },
}
