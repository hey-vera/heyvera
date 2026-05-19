use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};

use cortex_core::ledger::{LedgerEntry, LedgerEvent};
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use cortex_engine::router::Router;

use crate::clerk::ClerkUser;
use crate::scheduler;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct RouteRequest {
    pub input: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
}

#[derive(Serialize)]
pub struct RouteResponse {
    pub task: TaskContract,
    pub decision: RoutingDecision,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "service": "cortex" }))
}

pub async fn route_task(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<RouteRequest>,
) -> Result<Json<RouteResponse>, (StatusCode, Json<ErrorResponse>)> {
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
        model: Some(decision.model_id.clone()),
        alternatives_considered: decision.alternatives_considered.clone(),
    });
    let _ = state.ledger.append(&entry);

    Ok(Json(RouteResponse { task, decision }))
}

pub async fn get_providers(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
) -> Json<Vec<cortex_core::provider::ProviderStatus>> {
    let providers = state.providers.read().await;
    Json(providers.clone())
}

// --- Runs API ---

#[derive(Deserialize)]
pub struct CreateRunRequest {
    pub goal: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
    #[serde(default = "default_profile")]
    pub profile: String,
}

fn default_profile() -> String {
    "auto".to_string()
}

#[derive(Serialize)]
pub struct CreateRunResponse {
    pub run_id: String,
    pub steps: usize,
}

pub async fn create_run(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<CreateRunRequest>,
) -> Result<Json<CreateRunResponse>, (StatusCode, Json<ErrorResponse>)> {
    let scheduler_tx = state.scheduler_tx.read().await;
    let tx = scheduler_tx.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorResponse {
                error: "scheduler not ready".into(),
            }),
        )
    })?;

    let user_id = &user.user_id;

    let run_id = scheduler::create_run_from_goal(
        &state,
        tx,
        user_id,
        &req.goal,
        &req.file_paths,
        &req.profile,
    )
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: e }),
        )
    })?;

    // Count steps
    let steps = state
        .db
        .as_ref()
        .map(|db| db.get_all_step_statuses(&run_id).len())
        .unwrap_or(0);

    Ok(Json(CreateRunResponse { run_id, steps }))
}

// --- User-scoped run listing ---

#[derive(Deserialize)]
pub struct ListRunsQuery {
    #[serde(default = "default_run_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

fn default_run_limit() -> usize {
    50
}

pub async fn list_runs(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    axum::extract::Query(query): axum::extract::Query<ListRunsQuery>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })?;

    let runs = db.list_user_runs(&user.user_id, query.limit, query.offset);
    Ok(Json(runs))
}

pub async fn get_run(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })?;

    let goal = db.get_run_goal(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "run not found".into(),
            }),
        )
    })?;

    // Verify the requesting user owns this run
    if !db.verify_run_owner(&id, &user.user_id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "access denied: run belongs to another user".into(),
            }),
        ));
    }

    let steps = db.get_all_step_statuses(&id);

    Ok(Json(serde_json::json!({
        "id": id,
        "goal": goal,
        "steps": steps.iter().map(|(sid, status)| {
            serde_json::json!({ "id": sid, "status": status })
        }).collect::<Vec<_>>(),
    })))
}

pub async fn get_ledger(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // When a DB is available, return user-scoped decisions from the DB.
    // The file-based ledger doesn't carry user_id, so DB decisions are
    // the proper source for multi-user isolation.
    if let Some(db) = &state.db {
        let decisions = db.list_decisions(50, Some(&user.user_id));
        return Ok(Json(serde_json::json!(decisions)));
    }

    // Fallback to file-based ledger (single-user / local dev mode)
    let entries = state.ledger.recent(50).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;
    Ok(Json(serde_json::json!(entries)))
}

// --- PR creation ---

#[derive(Deserialize)]
pub struct CreatePrRequest {
    /// PR title. Defaults to the run's goal.
    pub title: Option<String>,
    /// Base branch to merge into. Defaults to "main".
    #[serde(default = "default_base_branch")]
    pub base: String,
}

fn default_base_branch() -> String {
    "main".to_string()
}

#[derive(Serialize)]
pub struct CreatePrResponse {
    pub pr_url: String,
    pub branch: String,
}

/// `POST /api/runs/{id}/pr` — push the run's branch and create a GitHub PR.
pub async fn create_pr(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<CreatePrRequest>,
) -> Result<Json<CreatePrResponse>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })?;

    // Verify the run exists
    let goal = db.get_run_goal(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "run not found".into(),
            }),
        )
    })?;

    // Verify the requesting user owns this run
    if !db.verify_run_owner(&id, &user.user_id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "access denied: run belongs to another user".into(),
            }),
        ));
    }

    // Get the branch
    let branch = db.get_run_branch(&id).ok_or_else(|| {
        (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(ErrorResponse {
                error: "run has no branch — no changes were made".into(),
            }),
        )
    })?;

    // Push the branch to origin
    let push_output = std::process::Command::new("git")
        .args(["push", "-u", "origin", &branch])
        .output()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("failed to run git push: {e}"),
                }),
            )
        })?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("git push failed: {stderr}"),
            }),
        ));
    }

    // Create PR via gh CLI
    let title = req.title.unwrap_or_else(|| format!("cortex: {goal}"));
    let body = format!(
        "Automated PR created by Cortex run `{id}`.\n\n**Goal:** {goal}\n\n**Branch:** `{branch}`",
    );

    let pr_output = std::process::Command::new("gh")
        .args([
            "pr", "create",
            "--title", &title,
            "--body", &body,
            "--base", &req.base,
            "--head", &branch,
        ])
        .output()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("failed to run gh pr create: {e}"),
                }),
            )
        })?;

    if !pr_output.status.success() {
        let stderr = String::from_utf8_lossy(&pr_output.stderr);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("gh pr create failed: {stderr}"),
            }),
        ));
    }

    let pr_url = String::from_utf8_lossy(&pr_output.stdout).trim().to_string();

    Ok(Json(CreatePrResponse { pr_url, branch }))
}
