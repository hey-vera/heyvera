mod admin;
mod auth;
pub mod billing;
mod chat;
pub mod clerk;
mod context_api;
mod context_flow;
mod conversations;
pub mod db;
pub mod github;
mod integrations;
pub mod mission_control;
// pub mod memory; // removed for Context-Flow Pipeline deployment
// mod orchestrator; // removed for Context-Flow Pipeline deployment
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
mod validate;
pub mod vera;
mod ws;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

use state::AppState;

async fn vera_snapshot(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    axum::Json(state.vera_tracker.snapshot())
}

async fn vera_personal(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    user: clerk::ClerkUser,
) -> impl axum::response::IntoResponse {
    axum::Json(state.vera_tracker.personal_view(&user.user_id))
}

#[derive(serde::Deserialize)]
struct SimulateParams {
    #[serde(default = "default_agent_count")]
    agents: usize,
    #[serde(default = "default_per_agent")]
    per_agent: usize,
}
fn default_agent_count() -> usize { 20 }
fn default_per_agent() -> usize { 10 }

async fn vera_simulate(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<SimulateParams>,
) -> impl axum::response::IntoResponse {
    let agents = params.agents.min(1000);
    let per_agent = params.per_agent.min(100);
    state.vera_tracker.simulate_ecosystem(agents, per_agent);
    axum::Json(state.vera_tracker.snapshot())
}

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
            tracing::info!("CORS: restricted to {} origin(s)", origins.len());
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods(AllowMethods::any())
                .allow_headers(AllowHeaders::any())
        }
        _ => {
            tracing::info!("CORS: permissive (set CORTEX_ALLOWED_ORIGINS to restrict)");
            CorsLayer::permissive()
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
        // Flow orchestration test endpoint (disabled)
        .route("/api/conversations", post(conversations::create_conversation))
        .route("/api/conversations/{id}/messages", post(conversations::add_message))
        // Memory system (organizational intelligence) - disabled
        // Context-Flow debugging endpoints
        .route("/api/context/runs/:run_id/artifacts", get(context_api::list_artifacts_for_run))
        .route("/api/context/runs/:run_id/context", get(context_api::preview_context_for_run))
        .route("/api/context/stats", get(context_api::get_context_stats))
        .route("/api/context/health", get(context_api::get_context_health))
        .route("/api/context/test", post(context_api::test_context_assembly))
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
        // Vera observation layer — live network state
        .route("/api/vera/network", get(vera_snapshot))
        .route("/api/vera/me", get(vera_personal))
        .route("/api/vera/simulate", post(vera_simulate))
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
        // Slack + Replit integrations
        .route("/api/integrations/status", get(integrations::integration_status))
        .route("/api/integrations/slack/oauth/start", post(integrations::slack_oauth_start))
        .route("/api/integrations/slack/oauth/callback", get(integrations::slack_oauth_callback))
        .route("/api/integrations/slack/channels", get(integrations::slack_channels))
        .route("/api/integrations/slack/import-channels", post(integrations::import_slack_channels))
        .route("/api/integrations/slack/events", post(integrations::slack_events))
        .route("/api/integrations/slack/command", post(integrations::slack_command))
        .route("/api/integrations/replit/workspaces", get(integrations::replit_workspaces))
        .route("/api/integrations/replit/import", post(integrations::import_replit_workspace))
        .route("/api/groups/{group_id}/tasks", get(integrations::get_group_tasks))
        .route("/api/groups/{group_id}/tasks", put(integrations::update_group_tasks))
        // Billing & Subscription
        .route("/api/billing/status", get(billing::get_billing_status))
        .route("/api/billing/checkout", post(billing::create_checkout))
        .route("/api/billing/portal", post(billing::create_portal))
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
        // Admin — Promo Codes
        .route("/api/admin/codes", get(admin::list_promo_codes).post(admin::create_promo_code))
        .route("/api/admin/codes/{id}", patch(admin::update_promo_code).delete(admin::delete_promo_code))
        .route("/api/admin/redemptions", get(admin::list_redemptions))
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
