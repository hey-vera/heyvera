mod admin;
mod auth;
pub mod billing;
mod chat;
pub mod clerk;
mod conversations;
pub mod db;
pub mod github;
pub mod mission_control;
mod ratelimit;
pub mod storage;
pub mod routes;
mod run_stream;
pub mod scheduler;
mod sse;
pub mod state;
mod usage_api;
mod user;
mod ws;

use std::sync::Arc;

use axum::middleware;
use axum::routing::{delete, get, patch, post};
use axum::Router;
use tower_http::cors::CorsLayer;

use state::AppState;

/// Build the full axum Router with all routes, given an initialized AppState.
pub fn build_router(state: Arc<AppState>) -> Router {
    // Rate-limited routes (expensive endpoints)
    let rate_limited = Router::new()
        .route("/api/route", post(routes::route_task))
        .route("/api/execute", post(sse::execute_task))
        .route("/api/chat", post(chat::chat))
        .route("/api/runs", get(routes::list_runs).post(routes::create_run))
        .route("/api/runs/estimate", post(routes::estimate_run))
        .route("/api/runs/{id}", get(routes::get_run))
        .route("/api/runs/{id}/pr", post(routes::create_pr))
        .route("/api/runs/{id}/stream", get(run_stream::stream_run))
        .route("/api/conversations", post(conversations::create_conversation))
        .route("/api/conversations/{id}/messages", post(conversations::add_message))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ratelimit::rate_limit_middleware,
        ));

    // Non-rate-limited routes
    Router::new()
        // Public
        .route("/api/health", get(routes::health))
        .route("/api/auth/status", get(auth::auth_status))
        // Protected — lightweight
        .route("/api/providers", get(routes::get_providers))
        .route("/api/ledger", get(routes::get_ledger))
        .route("/api/auth/start", post(auth::auth_start))
        .route("/api/auth/submit", post(auth::auth_submit))
        .route("/api/auth/refresh", post(auth::auth_refresh))
        // Conversations (reads)
        .route("/api/conversations", get(conversations::list_conversations))
        .route("/api/conversations/{id}", get(conversations::get_conversation))
        .route("/api/conversations/{id}", patch(conversations::update_conversation))
        .route("/api/conversations/{id}", delete(conversations::delete_conversation))
        // User endpoints
        .route("/api/user/profile", get(user::get_profile))
        .route("/api/user/routing", get(user::get_routing_profile))
        .route("/api/user/routing", post(user::update_profile))
        .route("/api/user/github/status", get(user::github_status))
        .route("/api/user/repos/select", post(user::select_repos))
        // Usage
        .route("/api/usage", get(usage_api::get_usage))
        .route("/api/usage/daily", get(usage_api::get_daily_usage))
        // Admin / Observability
        .route("/api/admin/workers", get(admin::get_workers))
        .route("/api/admin/stats", get(admin::system_stats))
        .route("/api/admin/decisions", get(admin::list_decisions))
        .route("/api/admin/runs", get(admin::list_all_runs))
        .route("/api/admin/runs/{id}", get(admin::get_run_detail))
        .route("/api/admin/pressure", get(admin::pressure_dashboard))
        .route("/api/admin/usage", get(usage_api::admin_usage))
        .route("/api/admin/usage/users", get(usage_api::admin_usage_users))
        // Worker WebSocket
        .route("/api/ws", get(ws::ws_handler))
        // Mission Control WebSocket (frontend observers)
        .route("/api/mc", get(mission_control::mc_handler))
        // Merge rate-limited routes
        .merge(rate_limited)
        .layer(CorsLayer::permissive())
        .with_state(state)
}
