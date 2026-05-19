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
pub mod soma;
mod soma_bridge;
mod sse;
pub mod state;
pub mod stripe_client;
mod usage_api;
mod user;
mod ws;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, patch, post};
use axum::Router;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

use state::AppState;

async fn soma_identity(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    match &state.soma_heart {
        Some(heart) => {
            let chain = heart.heartbeat_chain.lock().unwrap();
            let capabilities = heart.lineage.as_ref()
                .map(|l| ::soma::lineage::effective_capabilities(l))
                .unwrap_or_else(|| vec!["*".into()]);
            axum::Json(serde_json::json!({
                "did": heart.did(),
                "genome": heart.identity.genome,
                "protocol": "soma-delegation/0.1",
                "heartbeats": chain.len(),
                "head_hash": chain.head_hash(),
                "capabilities": capabilities,
                "root_did": heart.root_did,
                "has_lineage": heart.lineage.is_some(),
            }))
        }
        None => axum::Json(serde_json::json!({
            "error": "soma heart not initialized"
        })),
    }
}

fn cors_layer() -> CorsLayer {
    let allowed_origins = std::env::var("CORTEX_ALLOWED_ORIGINS").ok();
    match allowed_origins {
        Some(origins) if !origins.is_empty() => {
            let origins: Vec<_> = origins
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods(AllowMethods::any())
                .allow_headers(AllowHeaders::any())
        }
        _ => {
            if std::env::var("CORTEX_PRODUCTION").ok().map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false) {
                tracing::warn!("CORTEX_PRODUCTION=true but no CORTEX_ALLOWED_ORIGINS set — CORS will reject cross-origin requests");
                CorsLayer::new()
                    .allow_origin(AllowOrigin::exact("https://cortex.heyvera.org".parse().unwrap()))
                    .allow_methods(AllowMethods::any())
                    .allow_headers(AllowHeaders::any())
            } else {
                CorsLayer::permissive()
            }
        }
    }
}

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
        // Chat intelligence
        .route("/api/chat/suggestions", get(chat::chat_suggestions))
        .route("/api/chat/options", post(chat::chat_options))
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
        // Soma identity (public — lets clients discover Cortex's DID)
        .route("/api/soma/identity", get(soma_identity))
        // Soma delegation bridge (Clerk user → Soma session)
        .route("/api/soma/session", post(soma_bridge::create_session))
        .route("/api/soma/revoke", post(soma_bridge::revoke_delegation))
        .route("/api/soma/me", get(soma_bridge::get_user_identity))
        .route("/api/soma/spend", get(soma_bridge::get_spend))
        .route("/api/soma/spend/{delegation_id}", get(soma_bridge::get_spend_detail))
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
        // Billing & Subscription
        .route("/api/billing/status", get(billing::get_billing_status))
        .route("/api/billing/checkout", post(billing::create_checkout))
        .route("/api/billing/portal", post(billing::create_portal))
        .route("/api/billing/credits", post(billing::purchase_credits))
        .route("/api/billing/referral/validate", post(billing::validate_referral))
        .route("/api/billing/history", get(billing::get_billing_history))
        // Stripe webhook (no auth — verified by signature)
        .route("/api/stripe/webhook", post(billing::stripe_webhook))
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
        // Mission Control WebSocket (frontend observers) + snapshot
        .route("/api/mc", get(mission_control::mc_handler))
        .route("/api/mc/snapshot", get(mission_control::mc_snapshot))
        // Merge rate-limited routes
        .merge(rate_limited)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024)) // 2MB max request body
        .layer(middleware::from_fn_with_state(
            state.clone(),
            soma::soma_headers_middleware,
        ))
        .layer(cors_layer())
        .with_state(state)
}
