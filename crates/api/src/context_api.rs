//! Context-Flow debugging API endpoints
//!
//! Provides endpoints to inspect and debug the Context-Flow Pipeline

use std::sync::Arc;
use axum::extract::{Path, State, Query};
use axum::http::StatusCode;
use axum::response::{Json, IntoResponse};
use serde::{Deserialize, Serialize};
use crate::state::AppState;
use crate::context_flow::{ContextBus, ArtifactKind, ContextTransform, ContextBusConfig};
use crate::clerk::ClerkUser;

#[derive(Debug, Serialize)]
pub struct ArtifactResponse {
    pub id: String,
    pub producer_step_id: String,
    pub producer_run_id: String,
    pub kind: String,
    pub content: String,
    pub summary: String,
    pub files_changed: Vec<String>,
    pub confidence: f32,
    pub tokens: u32,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct ContextPreview {
    pub predecessor_summaries: Vec<PredecessorSummaryPreview>,
    pub user_goal: String,
    pub conversation_excerpt: Option<String>,
    pub total_tokens: u32,
    pub truncated_count: usize,
}

#[derive(Debug, Serialize)]
pub struct PredecessorSummaryPreview {
    pub step_id: String,
    pub kind: String,
    pub summary: String,
    pub files_changed: Vec<String>,
    pub token_count: u32,
}

#[derive(Debug, Serialize)]
pub struct ContextFlowStats {
    pub total_artifacts: usize,
    pub artifacts_by_kind: std::collections::HashMap<String, usize>,
    pub recent_runs_with_artifacts: Vec<String>,
    pub average_tokens_per_artifact: f32,
    pub pipeline_config: ContextBusConfigResponse,
}

#[derive(Debug, Serialize)]
pub struct ContextBusConfigResponse {
    pub max_predecessors: usize,
    pub max_total_tokens: u32,
    pub target_tokens: Option<u32>,
    pub summarize_code: bool,
}

#[derive(Debug, Deserialize)]
pub struct TestContextQuery {
    pub run_id: String,
    pub user_goal: Option<String>,
    pub max_predecessors: Option<usize>,
    pub max_total_tokens: Option<u32>,
}

/// GET /api/context/runs/{run_id}/artifacts
/// List all artifacts for a specific run
pub async fn list_artifacts_for_run(
    State(state): State<Arc<AppState>>,
    Path(run_id): Path<String>,
    _user: ClerkUser,
) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
            "error": "Database not available"
        })));
    };

    let artifacts = db.get_context_artifacts_for_run(&run_id);

    let response: Vec<ArtifactResponse> = artifacts
        .into_iter()
        .map(|(id, producer_step_id, kind, content, summary, files_changed, confidence, tokens, created_at)| {
            ArtifactResponse {
                id,
                producer_step_id,
                producer_run_id: run_id.clone(),
                kind,
                content,
                summary,
                files_changed,
                confidence,
                tokens,
                created_at,
            }
        })
        .collect();

    (StatusCode::OK, Json(serde_json::json!(response)))
}

/// GET /api/context/runs/{run_id}/context
/// Preview assembled context for the next step in a run
pub async fn preview_context_for_run(
    State(state): State<Arc<AppState>>,
    Path(run_id): Path<String>,
    Query(params): Query<TestContextQuery>,
    _user: ClerkUser,
) -> impl IntoResponse {
    let user_goal = params.user_goal.unwrap_or_else(|| "Test goal".to_string());

    // Create temporary config with query parameters
    let mut config = ContextBusConfig::default();
    if let Some(max_pred) = params.max_predecessors {
        config.max_predecessors = max_pred;
    }
    if let Some(max_tokens) = params.max_total_tokens {
        config.max_total_tokens = max_tokens;
    }

    let temp_bus = ContextBus::new(config.clone());
    let context = temp_bus.assemble_context(
        state.db.as_ref(),
        &run_id,
        &user_goal,
        None,
    ).await;

    // Calculate statistics
    let total_tokens: u32 = context.predecessor_summaries.iter()
        .map(|s| s.summary.len() as u32 / 4) // rough token estimation
        .sum();

    let predecessor_previews: Vec<PredecessorSummaryPreview> = context.predecessor_summaries
        .into_iter()
        .map(|pred| {
            let token_count = pred.summary.len() as u32 / 4;
            PredecessorSummaryPreview {
                step_id: pred.step_id,
                kind: pred.kind,
                summary: pred.summary,
                files_changed: pred.files_changed,
                token_count,
            }
        })
        .collect();

    let truncated_count = if let Some(db) = state.db.as_ref() {
        let all_artifacts = db.get_context_artifacts_for_run(&run_id);
        all_artifacts.len().saturating_sub(predecessor_previews.len())
    } else {
        0
    };

    let response = ContextPreview {
        predecessor_summaries: predecessor_previews,
        user_goal: context.user_goal,
        conversation_excerpt: context.conversation_excerpt,
        total_tokens,
        truncated_count,
    };

    (StatusCode::OK, Json(response))
}

/// GET /api/context/stats
/// Pipeline statistics and health information
pub async fn get_context_stats(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
) -> impl IntoResponse {
    let Some(db) = state.db.as_ref() else {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
            "error": "Database not available"
        })));
    };

    // Get statistics from database
    let (total_artifacts, artifacts_by_kind, average_tokens_per_artifact) = db.get_context_artifact_stats();
    let recent_runs_with_artifacts = db.get_recent_runs_with_artifacts(10);
    let config = &state.context_bus.config;

    let response = ContextFlowStats {
        total_artifacts,
        artifacts_by_kind,
        recent_runs_with_artifacts,
        average_tokens_per_artifact,
        pipeline_config: ContextBusConfigResponse {
            max_predecessors: config.max_predecessors,
            max_total_tokens: config.max_total_tokens,
            target_tokens: config.default_transform.target_tokens,
            summarize_code: config.default_transform.summarize_code,
        },
    };

    (StatusCode::OK, Json(serde_json::json!(response)))
}

/// POST /api/context/test
/// Test context assembly with different parameters
pub async fn test_context_assembly(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(params): Json<TestContextQuery>,
) -> impl IntoResponse {
    let run_id = params.run_id.clone();
    preview_context_for_run(
        State(state),
        Path(run_id),
        Query(params),
        _user,
    ).await
}

/// GET /api/context/health
/// Health status of the Context-Flow Pipeline
pub async fn get_context_health(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
) -> impl IntoResponse {
    let health = state.context_bus.get_health_status();
    (StatusCode::OK, Json(health))
}