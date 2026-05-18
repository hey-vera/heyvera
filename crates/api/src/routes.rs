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

pub async fn get_ledger(
    State(state): State<Arc<AppState>>,
    _user: ClerkUser,
) -> Result<Json<Vec<LedgerEntry>>, (StatusCode, Json<ErrorResponse>)> {
    let entries = state.ledger.recent(50).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )
    })?;
    Ok(Json(entries))
}
