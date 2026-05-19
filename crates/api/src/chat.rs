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
use cortex_engine::classifier::classify_intent;
use cortex_engine::router::Router;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::{AppState, StepEvent};

#[derive(Deserialize)]
pub struct ChatRequest {
    pub message: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
    /// Ignored when auth is enabled — the authenticated user's ID is used instead.
    #[serde(default)]
    pub user_id: Option<String>,
    /// Conversation ID for multi-turn persistence. If omitted, treated as one-shot.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// User-selected routing preferences from the session controls UI.
    #[serde(default)]
    pub routing_preferences: Option<RoutingPreferences>,
}

/// Routing preferences sent from the frontend session controls.
/// These influence model selection, timeout behavior, and approval flow.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct RoutingPreferences {
    /// Speed preference: "steady" | "balanced" | "rapid"
    /// Maps to: task timeout multiplier and concurrency limits.
    #[serde(default = "default_balanced")]
    pub speed: String,
    /// Intelligence preference: "focused" | "balanced" | "deep"
    /// Maps to: model tier selection (focused=fast/cheap, balanced=mid, deep=frontier).
    #[serde(default = "default_balanced")]
    pub intelligence: String,
    /// Autonomy preference: "manual" | "guided" | "smart_auto" | "full_auto" | "custom"
    /// Maps to: whether Cortex asks for approval before writing/committing.
    #[serde(default = "default_guided")]
    pub autonomy: String,
    /// Routing profile override: "auto" | "balanced" | "cost_saver" | "quality_first"
    #[serde(default)]
    pub profile: Option<String>,
    /// Per-request budget cap in credits. Advisory unless delegation has matching Budget caveat.
    #[serde(default)]
    pub budget_limit: Option<f64>,
}

fn default_balanced() -> String { "balanced".into() }
fn default_guided() -> String { "guided".into() }

pub async fn chat(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<ChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorResponse>)> {
    let intent = classify_intent(&req.message);
    let (tx, rx) = mpsc::channel::<StepEvent>(64);

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
            model: Some(decision.model_id.clone()),
            alternatives_considered: decision.alternatives_considered.clone(),
        });
        let _ = state.ledger.append(&entry);

        drop(providers);

        let task_clone = task.clone();
        let decision_clone = decision.clone();
        let state_clone = state.clone();
        let user_id = user.user_id.clone();

        tokio::spawn(async move {
            match state_clone
                .dispatch_step(&user_id, task_clone.clone(), decision_clone.clone(), tx.clone())
                .await
            {
                Ok(step_id) => {
                    tracing::info!("step dispatched: {step_id}");
                }
                Err(e) => {
                    let _ = tx
                        .send(StepEvent::Failed {
                            step_id: "none".into(),
                            error: e,
                        })
                        .await;
                }
            }
        });
    } else {
        tokio::spawn(async move {
            let _ = tx
                .send(StepEvent::Started {
                    step_id: "conversation".into(),
                    provider: "cortex".into(),
                    model: "conversation".into(),
                })
                .await;

            let response = handle_conversation(&req.message);
            let _ = tx
                .send(StepEvent::Output {
                    step_id: "conversation".into(),
                    line: response,
                })
                .await;

            let _ = tx
                .send(StepEvent::Completed {
                    step_id: "conversation".into(),
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

/// GET /api/chat/suggestions — Contextual autocomplete suggestions for the chat input.
/// Returns a list of suggested next actions based on current system state.
pub async fn chat_suggestions(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
) -> Json<SuggestionsResponse> {
    let mut suggestions = Vec::new();

    // Add context-aware suggestions based on system state
    let has_workers = !state.workers.read().await.is_empty();
    let providers = state.providers.read().await;
    let has_providers = providers.iter().any(|p| p.authenticated);
    drop(providers);

    if !has_workers {
        suggestions.push(Suggestion {
            text: "Connect a worker to start executing tasks".into(),
            category: "setup".into(),
            shortcut: None,
        });
    } else if has_providers {
        // Active system — suggest common task patterns
        suggestions.extend([
            Suggestion {
                text: "Fix the failing tests".into(),
                category: "execute".into(),
                shortcut: Some("fix".into()),
            },
            Suggestion {
                text: "Explore the codebase structure".into(),
                category: "search".into(),
                shortcut: Some("explore".into()),
            },
            Suggestion {
                text: "Review recent changes".into(),
                category: "think".into(),
                shortcut: Some("review".into()),
            },
            Suggestion {
                text: "Add a new feature".into(),
                category: "execute".into(),
                shortcut: Some("add".into()),
            },
        ]);
    }

    // Check for pending approvals
    if let Some(db) = &state.db {
        let active_runs = db.list_active_runs();
        if !active_runs.is_empty() {
            suggestions.push(Suggestion {
                text: format!("Check status of {} active run(s)", active_runs.len()),
                category: "status".into(),
                shortcut: Some("status".into()),
            });
        }
    }

    Json(SuggestionsResponse { suggestions })
}

#[derive(serde::Serialize)]
pub struct SuggestionsResponse {
    pub suggestions: Vec<Suggestion>,
}

#[derive(serde::Serialize)]
pub struct Suggestion {
    pub text: String,
    pub category: String,
    pub shortcut: Option<String>,
}

/// POST /api/chat/options — Given an assistant response, generate clickable option buttons.
/// The frontend calls this after receiving a response that presents choices.
pub async fn chat_options(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<ChatOptionsRequest>,
) -> Json<ChatOptionsResponse> {
    let options = extract_options_from_response(&req.assistant_message);
    Json(ChatOptionsResponse { options })
}

#[derive(Deserialize)]
pub struct ChatOptionsRequest {
    pub assistant_message: String,
}

#[derive(serde::Serialize)]
pub struct ChatOptionsResponse {
    pub options: Vec<ChatOption>,
}

#[derive(serde::Serialize)]
pub struct ChatOption {
    pub label: String,
    pub value: String,
    pub category: String,
}

fn extract_options_from_response(message: &str) -> Vec<ChatOption> {
    let mut options = Vec::new();
    for line in message.lines() {
        let trimmed = line.trim();
        // Match numbered options like "1. Do something" or "1) Do something"
        if let Some(rest) = trimmed.strip_prefix(|c: char| c.is_ascii_digit())
            .and_then(|s| s.strip_prefix(". ").or_else(|| s.strip_prefix(") ")))
        {
            let label = rest.trim().to_string();
            if !label.is_empty() && label.len() < 200 {
                options.push(ChatOption {
                    label: label.clone(),
                    value: label,
                    category: "option".into(),
                });
            }
        }
    }
    options
}

fn handle_conversation(message: &str) -> String {
    let lower = message.to_lowercase();

    if lower.contains("hello") || lower.contains("hi") || lower.starts_with("hey") {
        return "Hey! I'm Cortex. Tell me what you need — I'll route it to the right provider and tier. Try something like \"fix the auth bug\" or \"explore the src directory\".".to_string();
    }

    if lower.contains("status") || lower.contains("what can you do") || lower.contains("help") {
        return "I'm a multi-provider orchestration engine. I route tasks across Claude and OpenAI based on complexity and risk.\n\n**What I can do:**\n- **fix/add** — Execute-tier work (edits, tests, git)\n- **explore/find** — Search-tier work (read-only lookups)\n- **review/think** — Think-tier work (architecture, decisions)\n\nJust describe what you need in natural language.".to_string();
    }

    "I'm not sure what to do with that. Try phrasing it as a task:\n\
     - \"fix the login bug\"\n\
     - \"explore the auth module\"\n\
     - \"add a health check endpoint\"\n\
     - \"review the recent changes\"\n\n\
     Or say \"help\" to see what I can do."
        .to_string()
}
