use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

pub fn is_admin(_state: &AppState, user_id: &str) -> bool {
    let admins: HashSet<String> = std::env::var("CORTEX_ADMIN_USERS")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    // When no admin list is configured AND no Clerk auth is set up, allow local dev access.
    // In production (CLERK_SECRET_KEY set), an empty admin list means NO ONE is admin.
    if admins.is_empty() {
        return std::env::var("CLERK_SECRET_KEY").is_err();
    }
    admins.contains(user_id)
}

fn require_admin(
    state: &AppState,
    user: &ClerkUser,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if !is_admin(state, &user.user_id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "admin access required".into(),
            }),
        ));
    }
    Ok(())
}

// --- Worker status ---

pub async fn get_workers(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    require_admin(&state, &user)?;

    let in_memory: Vec<serde_json::Value> = {
        let workers = state.workers.read().await;
        workers
            .values()
            .map(|w| {
                serde_json::json!({
                    "id": w.worker_id,
                    "user_id": w.user_id,
                    "providers": w.available_providers.iter()
                        .map(|p| p.to_string()).collect::<Vec<_>>(),
                    "connected": true,
                })
            })
            .collect()
    };

    let db_workers = state
        .db
        .as_ref()
        .map(|db| db.get_worker_list())
        .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "connected": in_memory,
        "all": db_workers,
        "count": in_memory.len(),
    })))
}

// --- System stats ---

pub async fn system_stats(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    require_admin(&state, &user)?;
    let stats = state
        .db
        .as_ref()
        .map(|db| db.system_stats())
        .unwrap_or_else(|| serde_json::json!({"error": "database not available"}));

    let worker_count = state.workers.read().await.len();

    let mut stats = stats;
    if let Some(obj) = stats.as_object_mut() {
        obj.insert(
            "workers_connected_live".to_string(),
            serde_json::json!(worker_count),
        );
    }

    Ok(Json(stats))
}

// --- Decision transparency ---

#[derive(Deserialize)]
pub struct DecisionQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    pub user_id: Option<String>,
}

fn default_limit() -> usize {
    50
}

pub async fn list_decisions(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Query(query): Query<DecisionQuery>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<ErrorResponse>)> {
    require_admin(&state, &user)?;
    let decisions = state
        .db
        .as_ref()
        .map(|db| db.list_decisions(query.limit, query.user_id.as_deref()))
        .unwrap_or_default();

    Ok(Json(decisions))
}

// --- Run listing (all users) ---

#[derive(Deserialize)]
pub struct RunListQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

pub async fn list_all_runs(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Query(query): Query<RunListQuery>,
) -> Result<Json<Vec<serde_json::Value>>, (StatusCode, Json<ErrorResponse>)> {
    require_admin(&state, &user)?;
    let runs = state
        .db
        .as_ref()
        .map(|db| {
            db.list_all_runs(query.limit, query.offset)
                .into_iter()
                .map(|(id, user_id, goal, status, created_at)| {
                    serde_json::json!({
                        "id": id,
                        "user_id": user_id,
                        "goal": goal,
                        "status": status,
                        "created_at": created_at,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Json(runs))
}

// --- Run detail with full step DAG ---

pub async fn get_run_detail(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    require_admin(&state, &user)?;
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

    let profile = db.get_run_profile(&id).unwrap_or_else(|| "auto".into());
    let heal_count = db.get_run_heal_count(&id);
    let steps = db.get_all_step_statuses(&id);

    let step_details: Vec<serde_json::Value> = steps
        .iter()
        .map(|(sid, status)| {
            let details = db.get_step_details(sid);
            let predecessors = db.get_step_predecessors(sid);
            let output = db.get_step_output_summary(sid);
            let files = db.get_step_files_changed(sid);
            let error = db.get_step_last_error(sid);

            let mut step = serde_json::json!({
                "id": sid,
                "status": status,
                "predecessors": predecessors,
            });

            if let Some((kind, tier, risk, objective)) = details {
                step["kind"] = serde_json::json!(kind);
                step["tier"] = serde_json::json!(tier);
                step["risk"] = serde_json::json!(risk);
                step["objective"] = serde_json::json!(objective);
            }
            if let Some(o) = output {
                step["output_summary"] = serde_json::json!(o);
            }
            if let Some(f) = files {
                step["files_changed"] = serde_json::json!(f);
            }
            if let Some(e) = error {
                step["last_error"] = serde_json::json!(e);
            }
            step
        })
        .collect();

    Ok(Json(serde_json::json!({
        "id": id,
        "goal": goal,
        "profile": profile,
        "heal_attempts": heal_count,
        "steps": step_details,
    })))
}

// --- Provider pressure dashboard ---

pub async fn pressure_dashboard(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Json<serde_json::Value> {
    let db = match &state.db {
        Some(db) => db,
        None => return Json(serde_json::json!({"error": "database not available"})),
    };

    let window_ms = cortex_core::evaluator::WINDOW_SECS * 1000;
    let raw = db.pressure_for_user(&user.user_id, window_ms);
    let reliability = db.provider_reliability(&user.user_id, 24);

    let pressure: Vec<serde_json::Value> = raw
        .into_iter()
        .map(|(provider, tier, tokens)| {
            let budget = cortex_core::evaluator::token_budget(
                parse_provider(&provider),
                parse_tier(&tier),
            );
            let ratio = if budget > 0 {
                tokens as f64 / budget as f64
            } else {
                0.0
            };
            let state = cortex_core::evaluator::PressureState::from_ratio(ratio);

            serde_json::json!({
                "provider": provider,
                "tier": tier,
                "tokens_used": tokens,
                "budget": budget,
                "ratio": ratio,
                "state": format!("{:?}", state),
            })
        })
        .collect();

    let reliability_data: Vec<serde_json::Value> = reliability
        .into_iter()
        .map(|(provider, total, successes)| {
            let rate = if total > 0 {
                successes as f64 / total as f64
            } else {
                1.0
            };
            serde_json::json!({
                "provider": provider,
                "total": total,
                "successes": successes,
                "rate": rate,
            })
        })
        .collect();

    Json(serde_json::json!({
        "user_id": user.user_id,
        "window_hours": cortex_core::evaluator::WINDOW_SECS / 3600,
        "pressure": pressure,
        "reliability_24h": reliability_data,
    }))
}

fn parse_provider(s: &str) -> cortex_core::provider::ProviderId {
    match s {
        "claude" => cortex_core::provider::ProviderId::Claude,
        "openai" => cortex_core::provider::ProviderId::Openai,
        "gemini" => cortex_core::provider::ProviderId::Gemini,
        _ => cortex_core::provider::ProviderId::Claude,
    }
}

fn parse_tier(s: &str) -> cortex_core::provider::Tier {
    match s {
        "search" => cortex_core::provider::Tier::Search,
        "think" => cortex_core::provider::Tier::Think,
        _ => cortex_core::provider::Tier::Execute,
    }
}
