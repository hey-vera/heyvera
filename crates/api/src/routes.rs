use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};

use cortex_core::ledger::{LedgerEntry, LedgerEvent};
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use cortex_core::usage::{CostProjection, StepCostEstimate, estimate_cost_by_provider};
use cortex_engine::decomposer::decompose_goal;
use cortex_engine::router::Router;

use crate::clerk::ClerkUser;
use crate::github;
use crate::run_payload::{build_run_graph_payload, build_run_step_payloads};
use crate::scheduler;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct RouteRequest {
    pub input: String,
    #[serde(default)]
    pub file_paths: Vec<String>,
    #[serde(default)]
    pub routing_preferences: Option<crate::chat::RoutingPreferences>,
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

pub async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let soma_did = state.soma_heart.as_ref().map(|h| h.did().to_string());
    let heartbeat_count = state
        .soma_heart
        .as_ref()
        .map(|h| h.heartbeat_chain.lock().unwrap().len())
        .unwrap_or(0);
    Json(serde_json::json!({
        "status": "ok",
        "service": "cortex",
        "soma": {
            "did": soma_did,
            "protocol": "soma-delegation/0.1",
            "heartbeats": heartbeat_count,
        }
    }))
}

pub async fn deploy_info() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "cortex",
        "version": env!("CARGO_PKG_VERSION"),
        "commit": option_env!("GITHUB_SHA"),
    }))
}

pub async fn route_task(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<RouteRequest>,
) -> Result<Json<RouteResponse>, (StatusCode, Json<ErrorResponse>)> {
    if req.input.len() > 32_768 {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, Json(ErrorResponse { error: "input exceeds 32KB".into() })));
    }
    let file_paths = crate::validate::sanitize_file_paths(&req.file_paths)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e })))?;
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

    Ok(Json(RouteResponse { task, decision }))
}

pub async fn get_providers(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Json<Vec<cortex_core::provider::ProviderStatus>> {
    // If using local auth (no real user), return empty to prevent frontend crashes
    if user.user_id == "local" && state.clerk_secret_key.is_none() {
        return Json(Vec::new());
    }
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
    if req.goal.len() > 32_768 {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, Json(ErrorResponse { error: "goal exceeds 32KB".into() })));
    }
    if req.file_paths.len() > 50 {
        return Err((StatusCode::BAD_REQUEST, Json(ErrorResponse { error: "too many file paths (max 50)".into() })));
    }
    let file_paths = crate::validate::sanitize_file_paths(&req.file_paths)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e })))?;
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
        &file_paths,
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

#[derive(Deserialize)]
pub struct ListRunEventsQuery {
    #[serde(default = "default_run_events_limit")]
    pub limit: usize,
}

fn default_run_limit() -> usize {
    50
}

fn default_run_events_limit() -> usize {
    200
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

    let steps = build_run_step_payloads(db, &id);
    let graph = build_run_graph_payload(db, &id, &steps);

    Ok(Json(serde_json::json!({
        "id": id,
        "goal": goal,
        "steps": steps,
        "graph": graph,
    })))
}

pub async fn get_run_events(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<ListRunEventsQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })?;

    if db.get_run_goal(&id).is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "run not found".into(),
            }),
        ));
    }

    if !db.verify_run_owner(&id, &user.user_id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "access denied: run belongs to another user".into(),
            }),
        ));
    }

    let events = db.list_run_operations_events(&id, query.limit);
    Ok(Json(serde_json::json!({
        "run_id": id,
        "events": events,
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

/// Build a rich PR body with step summaries, files changed, cost, and duration.
fn build_pr_body(
    run_id: &str,
    goal: &str,
    branch: &str,
    db: &crate::db::Database,
) -> String {
    let steps = db.get_all_step_statuses(run_id);
    let mut body = format!(
        "## Cortex Run `{run_id}`\n\n**Goal:** {goal}\n\n**Branch:** `{branch}`\n"
    );

    // Step summary table
    if !steps.is_empty() {
        body.push_str("\n### Steps\n\n");
        body.push_str("| # | Kind | Objective | Status |\n");
        body.push_str("|---|------|-----------|--------|\n");

        let mut all_files: Vec<String> = Vec::new();

        for (i, (step_id, status)) in steps.iter().enumerate() {
            let (kind, _work_kind, _tier, _risk, objective) = db
                .get_step_details(step_id)
                .unwrap_or_else(|| ("unknown".into(), "".into(), "".into(), "".into(), "".into()));

            let status_icon = match status.as_str() {
                "completed" => "done",
                "failed" => "FAILED",
                "running" => "running",
                _ => status.as_str(),
            };

            body.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                i + 1,
                kind,
                truncate_str(&objective, 60),
                status_icon,
            ));

            // Collect files changed per step
            if let Some(files_json) = db.get_step_files_changed(step_id) {
                if let Ok(files) = serde_json::from_str::<Vec<String>>(&files_json) {
                    for f in files {
                        if !all_files.contains(&f) {
                            all_files.push(f);
                        }
                    }
                }
            }
        }

        // Files changed
        if !all_files.is_empty() {
            body.push_str(&format!("\n### Files Changed ({})\n\n", all_files.len()));
            // Show up to 30 files, then summarize
            let show = all_files.len().min(30);
            for f in &all_files[..show] {
                body.push_str(&format!("- `{f}`\n"));
            }
            if all_files.len() > 30 {
                body.push_str(&format!(
                    "\n...and {} more files\n",
                    all_files.len() - 30,
                ));
            }
        }
    }

    // Run timing — query created_at and finished_at from the runs table
    if let Some(run_info) = db.list_user_runs_by_id(run_id) {
        if let (Some(started), Some(finished)) = (
            run_info.get("started_at").and_then(|v| v.as_i64()),
            run_info.get("finished_at").and_then(|v| v.as_i64()),
        ) {
            let duration_secs = (finished - started) / 1000;
            let mins = duration_secs / 60;
            let secs = duration_secs % 60;
            body.push_str(&format!("\n**Duration:** {mins}m {secs}s\n"));
        }
    }

    body.push_str("\n---\n*Automated PR created by [Cortex](https://github.com/cortex)*\n");
    body
}

/// Truncate a string, appending "..." if it exceeds `max_len`.
fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

/// `POST /api/runs/{id}/pr` — push the run's branch and create a GitHub PR.
///
/// Tries the GitHub API first (if `GITHUB_TOKEN` is set), falls back to `gh` CLI.
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
        .current_dir(&state.workspace_dir)
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

    // Build PR metadata
    let title = req.title.unwrap_or_else(|| format!("cortex: {goal}"));
    let body = build_pr_body(&id, &goal, &branch, db);

    // Try GitHub API first, fall back to gh CLI
    if let Some(gh_client) = &state.github_client {
        if let Some((owner, repo)) = github::parse_github_remote(&state.workspace_dir) {
            match gh_client
                .create_pull_request(&owner, &repo, &title, &body, &branch, &req.base)
                .await
            {
                Ok(pr) => {
                    tracing::info!("PR #{} created via GitHub API: {}", pr.number, pr.html_url);
                    return Ok(Json(CreatePrResponse {
                        pr_url: pr.html_url,
                        branch,
                    }));
                }
                Err(e) => {
                    tracing::warn!("GitHub API PR creation failed, falling back to gh CLI: {e}");
                    // Fall through to gh CLI below
                }
            }
        } else {
            tracing::warn!(
                "could not parse owner/repo from git remote, falling back to gh CLI"
            );
        }
    }

    // Fallback: create PR via gh CLI
    let pr_output = std::process::Command::new("gh")
        .args([
            "pr", "create",
            "--title", &title,
            "--body", &body,
            "--base", &req.base,
            "--head", &branch,
        ])
        .current_dir(&state.workspace_dir)
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

// --- Cost Projection ---

/// Map a step kind string to the default provider to use for estimation.
fn default_provider_for_tier(tier: &str) -> &'static str {
    match tier {
        "search" => "claude",
        "execute" => "claude",
        "think" => "claude",
        _ => "claude",
    }
}

/// Fallback token estimates when no historical data exists.
fn fallback_tokens(kind: &str) -> (i64, i64, i64) {
    // (tokens_in, tokens_out, duration_ms)
    match kind {
        "search" => (1_000, 500, 15_000),
        "execute" => (5_000, 3_000, 120_000),
        "think" | "review" => (8_000, 5_000, 180_000),
        "test" | "build" | "lint" => (3_000, 2_000, 60_000),
        "gate" => (2_000, 1_000, 30_000),
        "heal" => (5_000, 3_000, 120_000),
        _ => (3_000, 2_000, 60_000),
    }
}

/// `POST /api/runs/estimate` — project the cost of a run without executing it.
pub async fn estimate_run(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<CreateRunRequest>,
) -> Result<Json<CostProjection>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })?;

    let file_paths = crate::validate::sanitize_file_paths(&req.file_paths)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: e })))?;
    // Decompose the goal into steps (same as create_run)
    let builder = decompose_goal(&user.user_id, &req.goal, &file_paths, &req.profile)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: e }),
            )
        })?;

    let mut step_estimates = Vec::new();
    let mut total_confidence_sum = 0.0_f64;

    for step in builder.steps() {
        let kind = step.kind.as_str();
        let tier = &step.tier;
        let provider = default_provider_for_tier(tier);

        // Try historical data first, fall back to defaults
        let (tokens_in, tokens_out, duration_ms, confidence) =
            if let Some((avg_in, avg_out, avg_dur, sample_count)) =
                db.get_historical_step_costs(&user.user_id, tier, provider)
            {
                // Confidence: min(1.0, sample_count / 10) — 10+ samples = full confidence
                let conf = (sample_count as f64 / 10.0).min(1.0);
                (avg_in, avg_out, avg_dur, conf)
            } else {
                let (fb_in, fb_out, fb_dur) = fallback_tokens(kind);
                (fb_in, fb_out, fb_dur, 0.0)
            };

        let cost = estimate_cost_by_provider(provider, tokens_in, tokens_out);
        total_confidence_sum += confidence;

        step_estimates.push(StepCostEstimate {
            kind: kind.to_string(),
            tier: tier.clone(),
            provider: provider.to_string(),
            estimated_tokens_in: tokens_in,
            estimated_tokens_out: tokens_out,
            estimated_cost: cost,
            estimated_duration_ms: duration_ms,
        });
    }

    let step_count = step_estimates.len();
    let estimated_total_cost: f64 = step_estimates.iter().map(|s| s.estimated_cost).sum();
    let total_duration_ms: i64 = step_estimates.iter().map(|s| s.estimated_duration_ms).sum();
    let estimated_duration_minutes = total_duration_ms as f64 / 60_000.0;
    let confidence = if step_count > 0 {
        total_confidence_sum / step_count as f64
    } else {
        0.0
    };

    Ok(Json(CostProjection {
        estimated_total_cost,
        estimated_duration_minutes,
        step_estimates,
        confidence,
    }))
}
