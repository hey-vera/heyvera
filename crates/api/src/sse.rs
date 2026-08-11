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
use uuid::Uuid;

use cortex_core::ledger::{LedgerEntry, LedgerEvent};
use cortex_engine::router::Router;
use cortex_worker::executor::{Executor, StepExecution};
use cortex_worker::stream::WorkerEvent;

use crate::billing::PremiumUser;
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
    _user: PremiumUser,
    Json(req): Json<ExecuteRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorResponse>)> {
    let file_paths = crate::validate::sanitize_file_paths(&req.file_paths)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(crate::routes::ErrorResponse { error: e })))?;
    let providers = state.providers.read().await;
    let path_refs: Vec<&str> = file_paths.iter().map(|s| s.as_str()).collect();

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
        model: Some(decision.model_id.clone()),
        alternatives_considered: decision.alternatives_considered.clone(),
    });
    let _ = state.ledger.append(&entry);

    drop(providers);

    let (worker_tx, worker_rx) = mpsc::channel::<WorkerEvent>(64);

    let task_clone = task.clone();
    let decision_clone = decision.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        let step = StepExecution {
            step_id: Uuid::new_v4().to_string(),
            attempt_id: Uuid::new_v4().to_string(),
            lease_gen: 1,
            // This path does not plan against a repository, so it has nothing
            // to derive a grant from. Denying is both the safe answer and
            // exactly what this path did before the field existed.
            egress: cortex_core::egress::EgressPlan::deny(),
            // The provider half needs no repository, only the routing
            // decision this path already made. Every path that builds a
            // sandbox needs it, or that path keeps F7.
            provider_egress: cortex_core::egress::derive_provider_egress(decision_clone.provider),
        };

        let result = Executor::execute_sandboxed(
            &task_clone,
            &decision_clone,
            &step,
            worker_tx,
            state_clone.workspace_dir.as_path(),
        )
        .await;

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
