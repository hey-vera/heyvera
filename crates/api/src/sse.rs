use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_core::Stream;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;

use cortex_core::ledger::{LedgerEntry, LedgerEvent};
use cortex_engine::router::Router;
use cortex_worker::executor::Executor;
use cortex_worker::stream::WorkerEvent;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ExecuteRequest {
    pub input: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
}

pub async fn execute_task(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<ExecuteRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorResponse>)> {
    let providers = state.providers.read().await;
    let path_refs: Vec<&str> = req.file_paths.iter().map(|s| s.as_str()).collect();

    let (task, decision) = Router::route(&req.input, &path_refs, &providers).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;

    let entry = LedgerEntry::new(LedgerEvent::RoutingDecision {
        task_id: task.id,
        provider: decision.provider,
        tier: decision.tier,
        risk: task.risk,
        rationale: decision.rationale.clone(),
        score: decision.score,
    });
    let _ = state.ledger.append(&entry);

    drop(providers);

    let (worker_tx, worker_rx) = mpsc::channel::<WorkerEvent>(64);

    let task_clone = task.clone();
    let decision_clone = decision.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        let result = Executor::execute(&task_clone, &decision_clone, worker_tx, Some(state_clone.workspace_dir.as_path())).await;

        let status = match &result {
            Ok(0) => cortex_core::task::TaskStatus::Completed,
            _ => cortex_core::task::TaskStatus::Failed,
        };
        let duration = task_clone
            .created_at
            .signed_duration_since(chrono::Utc::now())
            .num_milliseconds()
            .unsigned_abs();

        let outcome = LedgerEntry::new(LedgerEvent::TaskOutcome {
            task_id: task_clone.id,
            provider: decision_clone.provider,
            status,
            duration_ms: duration,
            files_changed: 0,
            tests_passed: None,
        });
        let _ = state_clone.ledger.append(&outcome);
    });

    let stream = ReceiverStream::new(worker_rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_default();
        Ok(Event::default().data(data))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
