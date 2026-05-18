use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerEvent {
    Started {
        task_id: Uuid,
        provider: String,
        model: String,
    },
    Output {
        task_id: Uuid,
        line: String,
    },
    Completed {
        task_id: Uuid,
        exit_code: i32,
    },
    Failed {
        task_id: Uuid,
        error: String,
    },
}
