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
use cortex_engine::classifier::classify_intent;
use cortex_engine::router::Router;
use cortex_worker::executor::Executor;
use cortex_worker::stream::WorkerEvent;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ChatRequest {
    pub message: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
}

pub async fn chat(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<ChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorResponse>)> {
    let intent = classify_intent(&req.message);
    let (tx, rx) = mpsc::channel::<WorkerEvent>(64);

    if intent.is_some() {
        let providers = state.providers.read().await;
        let path_refs: Vec<&str> = req.file_paths.iter().map(|s| s.as_str()).collect();

        let (task, decision) =
            Router::route(&req.message, &path_refs, &providers).map_err(|e| {
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

        let task_clone = task.clone();
        let decision_clone = decision.clone();
        let state_clone = state.clone();

        tokio::spawn(async move {
            let result = Executor::execute(&task_clone, &decision_clone, tx, Some(state_clone.workspace_dir.as_path())).await;

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
    } else {
        let task_id = Uuid::new_v4();
        tokio::spawn(async move {
            let _ = tx
                .send(WorkerEvent::Started {
                    task_id,
                    provider: "cortex".to_string(),
                    model: "conversation".to_string(),
                })
                .await;

            let response = handle_conversation(&req.message);
            let _ = tx
                .send(WorkerEvent::Output {
                    task_id,
                    line: response,
                })
                .await;

            let _ = tx
                .send(WorkerEvent::Completed {
                    task_id,
                    exit_code: 0,
                })
                .await;
        });
    }

    let stream = ReceiverStream::new(rx).map(|event| {
        let data = serde_json::to_string(&event).unwrap_or_default();
        Ok(Event::default().data(data))
    });

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn handle_conversation(message: &str) -> String {
    let lower = message.to_lowercase();

    if lower.contains("hello") || lower.contains("hi") || lower.starts_with("hey") {
        return "Hey! I'm Cortex. Tell me what you need — I'll route it to the right provider and tier. Try something like \"fix the auth bug\" or \"explore the src directory\".".to_string();
    }

    if lower.contains("status") || lower.contains("what can you do") || lower.contains("help") {
        return "I'm a multi-provider orchestration engine. I route tasks across Claude and OpenAI based on complexity and risk.\n\n**What I can do:**\n- **fix/add** — Execute-tier work (edits, tests, git)\n- **explore/find** — Search-tier work (read-only lookups)\n- **review/think** — Think-tier work (architecture, decisions)\n\nJust describe what you need in natural language.".to_string();
    }

    format!(
        "I'm not sure what to do with that. Try phrasing it as a task:\n\
        - \"fix the login bug\"\n\
        - \"explore the auth module\"\n\
        - \"add a health check endpoint\"\n\
        - \"review the recent changes\"\n\n\
        Or say \"help\" to see what I can do."
    )
}
