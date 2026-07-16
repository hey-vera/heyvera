mod admin;
pub mod api_error;
mod api_keys;
mod auth;
pub mod billing;
pub mod budget_enforcer;
mod chat;
pub mod clerk;
mod clerk_webhooks;
mod context_api;
mod context_flow;
mod conversations;
pub mod cost_estimator;
mod crypto;
mod deploy_status;
pub mod db;
pub mod credentials;
pub mod docker;
pub mod github;
pub mod github_repos;
mod integrations;
pub mod llm_client;
pub mod media;
mod messaging;
pub mod metrics;
pub mod mission_control;
mod moderation;
mod pulse;
// pub mod memory; // removed for Context-Flow Pipeline deployment
pub mod notifications;
// mod orchestrator; // removed for Context-Flow Pipeline deployment
mod ratelimit;
pub mod replit;
pub mod storage;
pub mod routes;
mod run_payload;
mod run_stream;
pub mod social;
pub mod scheduler;
pub mod soma;
mod soma_bridge;
mod sse;
pub mod state;
pub mod token_refresh;
pub mod stripe_client;
mod usage_api;
mod user;
mod validate;
pub mod vera;
mod ws;

pub use api_error::ApiError;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::middleware;
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tower_http::services::ServeDir;
use axum::response::IntoResponse;

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

/// GET /v1/health — public health check
async fn v1_health() -> impl axum::response::IntoResponse {
    let timestamp = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    axum::Json(serde_json::json!({
        "status": "ok",
        "service": "heyvera-social",
        "version": "0.1.0",
        "timestamp": timestamp,
    }))
}

/// GET /v1/ready — readiness probe; checks DB accessibility
async fn v1_ready(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    let db_ok = match &state.db {
        Some(database) => database.health_check(),
        None => false,
    };
    let ready = db_ok;
    let status = if ready {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    };
    (status, axum::Json(serde_json::json!({
        "ready": ready,
        "db": db_ok,
    })))
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
            if is_production_env() {
                panic!("CORTEX_ALLOWED_ORIGINS is required when CORTEX_ENV/APP_ENV/ENVIRONMENT is production");
            }
            tracing::info!("CORS: permissive (set CORTEX_ALLOWED_ORIGINS to restrict)");
            CorsLayer::permissive()
        }
    }
}

async fn deploy_metadata() -> impl axum::response::IntoResponse {
    axum::Json(serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "service": "cortex-api",
        "build_time": option_env!("BUILD_TIME").unwrap_or("unknown"),
    }))
}

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

/// Correlation + observability middleware.
///
/// Responsibilities:
///   - Assign (or honour an inbound) request id and surface it on the response
///     as `x-request-id`, plus stash it in request extensions for handlers.
///   - Open a tracing span carrying the request id, method and matched route so
///     every log line emitted while serving the request is correlated.
///   - Record Prometheus metrics: in-flight gauge, total count by
///     method/route/status-class, 5xx error count, and a latency histogram.
///
/// The `route` label is the matched router template (e.g.
/// `/api/runs/{id}`), never the raw path, to keep metric cardinality bounded.
async fn request_id_middleware(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    // Honour an upstream-supplied request id if present (lets a gateway thread
    // correlation through), otherwise mint a fresh one.
    let request_id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty() && s.len() <= 128)
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let method = req.method().clone();
    let path = req.uri().path().to_string();

    // Matched route template for low-cardinality metric labels. Falls back to a
    // sentinel for unmatched paths (static files, 404s) so we never label
    // metrics with unbounded raw paths.
    let route = req
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "<unmatched>".to_string());

    let start = std::time::Instant::now();

    let incoming_traceparent = req
        .headers()
        .get("traceparent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let (mut parts, body) = req.into_parts();
    parts.extensions.insert(RequestId(request_id.clone()));
    let req = axum::http::Request::from_parts(parts, body);

    // Span ties all downstream logs to this request for correlation. It is
    // attached to the handler future via `.instrument` so it follows the
    // request across every `.await` point.
    let span = tracing::info_span!(
        "http_request",
        request_id = %request_id,
        method = %method,
        route = %route,
    );

    let m = metrics::metrics();
    m.http_in_flight.inc();

    let response = {
        use tracing::Instrument as _;
        next.run(req).instrument(span).await
    };

    let elapsed = start.elapsed();
    let duration_ms = elapsed.as_millis() as u64;
    let status = response.status().as_u16();
    let class = metrics::status_class(status);

    m.http_in_flight.dec();
    m.http_requests_total
        .with_label_values(&[method.as_str(), &route, class])
        .inc();
    m.http_request_duration_seconds
        .with_label_values(&[method.as_str(), &route])
        .observe(elapsed.as_secs_f64());
    if status >= 500 {
        m.http_errors_total
            .with_label_values(&[method.as_str(), &route])
            .inc();
        tracing::error!(
            request_id = %request_id,
            method = %method,
            path = %path,
            route = %route,
            status = status,
            duration_ms = duration_ms,
            "request failed"
        );
    } else {
        tracing::info!(
            request_id = %request_id,
            method = %method,
            path = %path,
            route = %route,
            status = status,
            duration_ms = duration_ms,
            "request completed"
        );
    }

    let (mut parts, body) = response.into_parts();
    parts.headers.insert(
        "x-request-id",
        axum::http::HeaderValue::from_str(&request_id).unwrap_or_else(|_| {
            axum::http::HeaderValue::from_static("unknown")
        }),
    );

    if let Some(traceparent) = incoming_traceparent {
        if let Ok(val) = axum::http::HeaderValue::from_str(&traceparent) {
            parts.headers.insert("traceparent", val);
        }
    }

    axum::response::Response::from_parts(parts, body)
}

/// GET /metrics — Prometheus text exposition format.
///
/// Refreshes subsystem and container-population gauges on scrape so the
/// snapshot is current, then renders the registry. Unauthenticated by design:
/// it is meant to be scraped on the internal network; restrict via network
/// policy / reverse proxy in production.
async fn metrics_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
) -> impl axum::response::IntoResponse {
    // Refresh point-in-time gauges so a scrape reflects live state even between
    // event-driven updates.
    let db_up = state.db.as_ref().map(|d| d.health_check()).unwrap_or(false);
    metrics::set_subsystem_up("database", db_up);
    metrics::set_subsystem_up("docker", state.container_manager.is_some());

    if let Some(db) = &state.db {
        let containers = db.list_all_containers();
        let running = containers.iter().filter(|c| c.status == "running").count() as i64;
        let stopped = (containers.len() as i64) - running;
        metrics::set_container_population(running, stopped);
    }

    match metrics::render() {
        Ok(body) => (
            axum::http::StatusCode::OK,
            [(
                axum::http::header::CONTENT_TYPE,
                "text/plain; version=0.0.4; charset=utf-8",
            )],
            body,
        )
            .into_response(),
        Err(e) => {
            tracing::error!("failed to render metrics: {e}");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to render metrics",
            )
                .into_response()
        }
    }
}

fn is_production_env() -> bool {
    ["CORTEX_ENV", "APP_ENV", "ENVIRONMENT"]
        .iter()
        .filter_map(|key| std::env::var(key).ok())
        .any(|value| value.eq_ignore_ascii_case("production"))
}

/// Build router with only Cortex routes (cortex.heyvera.org).
pub fn build_cortex_router(state: Arc<AppState>) -> Router {
    let cortex_static_dir = std::env::var("CORTEX_STATIC_DIR")
        .unwrap_or_else(|_| "cortex/dist".to_string());

    async fn spa_fallback_cortex(_req: axum::http::Request<axum::body::Body>) -> Result<axum::response::Response, std::convert::Infallible> {
        let static_dir = std::env::var("CORTEX_STATIC_DIR")
            .unwrap_or_else(|_| "cortex/dist".to_string());
        let index_path = format!("{}/index.html", static_dir);
        let response = match std::fs::read_to_string(&index_path) {
            Ok(content) => axum::response::Html(content).into_response(),
            Err(_) => (
                axum::http::StatusCode::NOT_FOUND,
                axum::response::Html("<!DOCTYPE html><html><body><h1>Cortex Frontend Not Available</h1></body></html>")
            ).into_response(),
        };
        Ok(response)
    }

    let static_service = ServeDir::new(&cortex_static_dir)
        .not_found_service(tower::service_fn(spa_fallback_cortex));

    let rate_limited = Router::new()
        .route("/api/route", post(routes::route_task))
        .route("/api/execute", post(sse::execute_task))
        .route("/api/chat", post(chat::chat))
        .route("/api/runs", get(routes::list_runs).post(routes::create_run))
        .route("/api/runs/estimate", post(routes::estimate_run))
        .route("/api/runs/{id}", get(routes::get_run))
        .route("/api/runs/{id}/events", get(routes::get_run_events))
        .route("/api/runs/{run_id}/steps/{step_id}/verifier-report/{report_id}", get(routes::get_verifier_report))
        .route("/api/runs/{id}/pr", post(routes::create_pr))
        .route("/api/runs/{id}/stream", get(run_stream::stream_run))
        .route("/api/chat/suggestions", get(chat::chat_suggestions))
        .route("/api/chat/options", post(chat::chat_options))
        .route("/api/conversations", post(conversations::create_conversation))
        .route("/api/conversations/{id}/messages", post(conversations::add_message))
        .route("/api/context/runs/{run_id}/artifacts", get(context_api::list_artifacts_for_run))
        .route("/api/context/runs/{run_id}/context", get(context_api::preview_context_for_run))
        .route("/api/context/stats", get(context_api::get_context_stats))
        .route("/api/context/health", get(context_api::get_context_health))
        .route("/api/context/test", post(context_api::test_context_assembly))
        .route("/api/keys", get(api_keys::list_api_keys))
        .route("/api/keys/{provider}", put(api_keys::save_api_key).delete(api_keys::delete_api_key))
        .route("/api/github/repos", get(github_repos::list_repos))
        .route("/api/github/imports", get(github_repos::list_imports))
        .route("/api/github/import", post(github_repos::import_repo))
        .route("/api/github/status/{import_id}", get(github_repos::import_status))
        .route("/api/github/sync/{import_id}", post(github_repos::sync_repo))
        .route("/api/projects", get(replit::list_projects).post(replit::create_project))
        .route("/api/projects/import", post(replit::import_project))
        .route("/api/projects/{id}", get(replit::get_project).delete(replit::delete_project))
        .route("/api/projects/{id}/chat", post(replit::proxy_chat_to_workspace))
        .layer(middleware::from_fn_with_state(state.clone(), ratelimit::rate_limit_middleware));

    let admin_routes = Router::new()
        .route("/api/admin/workers", get(admin::get_workers))
        .route("/api/admin/stats", get(admin::system_stats))
        .route("/api/admin/decisions", get(admin::list_decisions))
        .route("/api/admin/runs", get(admin::list_all_runs))
        .route("/api/admin/runs/{id}", get(admin::get_run_detail))
        .route("/api/admin/pressure", get(admin::pressure_dashboard))
        .route("/api/admin/usage", get(usage_api::admin_usage))
        .route("/api/admin/usage/users", get(usage_api::admin_usage_users))
        .route("/api/admin/codes", get(admin::list_promo_codes).post(admin::create_promo_code))
        .route("/api/admin/codes/{id}", patch(admin::update_promo_code).delete(admin::delete_promo_code))
        .route("/api/admin/redemptions", get(admin::list_redemptions))
        .route("/api/admin/accounts/{clerk_user_id}/suspend", post(admin::suspend_account))
        .route("/api/admin/accounts/{clerk_user_id}/unsuspend", post(admin::unsuspend_account))
        .route("/api/admin/audit-log", get(admin::get_audit_log))
        .route("/api/admin/reconcile-counters", post(admin::reconcile_counters))
        .route("/api/admin/containers", get(admin::list_containers))
        .route("/api/admin/containers/stats", get(admin::container_stats))
        .layer(middleware::from_fn_with_state(state.clone(), admin::require_admin_middleware));

    Router::new()
        .route("/v1/health", get(v1_health))
        .route("/v1/ready", get(v1_ready))
        .route("/metrics", get(metrics_handler))
        .route("/api/health", get(routes::health))
        .route("/api/deploy-info", get(routes::deploy_info))
        .route("/api/deploy-metadata", get(deploy_metadata))
        .route("/api/deploy-status", get(deploy_status::deploy_status))
        .route("/api/deployment/status", get(deploy_status::deploy_status))
        .route("/api/deployment/events", get(deploy_status::deployment_events))
        .route("/api/deployment/adapters", get(routes::get_deployment_adapters))
        .route("/api/providers", get(routes::get_providers))
        .route("/api/ledger", get(routes::get_ledger))
        .route("/api/auth/status", get(auth::auth_status))
        .route("/api/auth/start", post(auth::auth_start))
        .route("/api/auth/submit", post(auth::auth_submit))
        .route("/api/auth/refresh", post(auth::auth_refresh))
        .route("/api/auth/credential/delete", post(auth::credential_delete))
        .route("/api/auth/credential/default", post(auth::credential_set_default))
        .route("/api/credentials/assign", post(credentials::assign_credential))
        .route("/api/credentials/assignments", get(credentials::list_assignments))
        .route("/api/credentials/assignments/{id}", delete(credentials::remove_assignment))
        .route("/api/conversations", get(conversations::list_conversations))
        .route("/api/conversations/{id}", get(conversations::get_conversation))
        .route("/api/conversations/{id}", patch(conversations::update_conversation))
        .route("/api/conversations/{id}", delete(conversations::delete_conversation))
        .route("/api/user/profile", get(user::get_profile))
        .route("/api/user/routing", get(user::get_routing_profile))
        .route("/api/user/routing", post(user::update_profile))
        .route("/api/user/github/status", get(user::github_status))
        .route("/api/user/repos/select", post(user::select_repos))
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
        .route("/api/groups/{group_id}/tasks", post(integrations::create_group_task))
        .route("/api/groups/{group_id}/tasks", put(integrations::update_group_tasks))
        .route("/api/groups/{group_id}/tasks/actions", post(integrations::apply_group_task_actions))
        .route("/api/groups/{group_id}/tasks/{task_id}", patch(integrations::patch_group_task))
        .route("/api/groups/{group_id}/tasks/{task_id}/chats", post(integrations::attach_group_task_chat))
        .route("/api/groups/{group_id}/tasks/{task_id}/projection", get(integrations::get_group_task_projection))
        .route("/api/operations/summary", get(integrations::get_personal_operations_summary))
        .route("/api/authority/scopes", get(integrations::list_authority_scopes))
        .route("/api/authority/scopes", post(integrations::create_authority_scope))
        .route("/api/authority/scopes/{scope_id}", patch(integrations::update_authority_scope))
        .route("/api/authority/delegations", get(integrations::list_authority_delegations))
        .route("/api/authority/delegations", post(integrations::delegate_authority))
        .route("/api/authority/delegations/{delegation_id}", delete(integrations::revoke_authority_delegation))
        .route("/api/groups/{group_id}/operations/summary", get(integrations::get_group_operations_summary))
        .route("/api/groups/{group_id}/operations/graph", get(integrations::get_group_operations_graph))
        .route("/api/groups/{group_id}/approvals", get(integrations::list_group_approval_requests))
        .route("/api/groups/{group_id}/approvals", post(integrations::create_group_approval_request))
        .route("/api/groups/{group_id}/approvals/{request_id}", patch(integrations::resolve_group_approval_request))
        .route("/api/billing/status", get(billing::get_billing_status))
        .route("/api/billing/checkout", post(billing::create_checkout))
        .route("/api/billing/portal", post(billing::create_portal))
        .route("/api/billing/referral/validate", post(billing::validate_referral))
        .route("/api/billing/history", get(billing::get_billing_history))
        .route("/api/stripe/webhook", post(billing::stripe_webhook))
        .route("/api/clerk/webhooks", post(clerk_webhooks::clerk_webhook))
        .route("/api/usage", get(usage_api::get_usage))
        .route("/api/usage/daily", get(usage_api::get_daily_usage))
        .route("/api/ws", get(ws::ws_handler))
        .route("/api/mc", get(mission_control::mc_handler))
        .route("/api/mc/snapshot", get(mission_control::mc_snapshot))
        // Social layer served through api.heyvera.org/v1/social/*.
        .route("/v1/social/trending", get(social::get_trending))
        .route("/v1/social/search", get(social::search))
        .route("/v1/social/profiles/featured", get(social::get_featured_profiles))
        .route("/v1/social/feed/home", get(social::get_home_feed))
        .route("/v1/social/profiles", get(social::get_profiles).post(social::create_profile))
        .route("/v1/social/profiles/{handle}/stats", get(social::get_user_profile_stats))
        .route("/v1/social/communities", get(social::get_communities))
        .route("/v1/social/longform", get(social::get_longform).post(social::create_longform))
        .route("/v1/social/profile/me", get(social::get_my_profile))
        .route("/v1/social/posts", post(social::create_post))
        .route("/v1/social/media/upload-url", post(media::request_upload_url))
        .route("/v1/social/media/{id}/finalize", post(media::finalize_upload))
        .route(
            "/v1/social/media/mock-upload/{*storage_key}",
            put(media::mock_upload).get(media::mock_serve),
        )
        .route("/v1/social/linked-agents", get(social::list_my_linked_agents).post(social::create_linked_agent))
        .route("/v1/social/posts/{id}/like", post(social::like_post).delete(social::unlike_post))
        .route("/v1/social/posts/{id}/repost", post(social::repost_post).delete(social::unrepost_post))
        .route("/v1/social/posts/{id}/bookmark", post(social::bookmark_post).delete(social::unbookmark_post))
        .route("/v1/social/follows/{handle}", post(social::follow_by_handle).delete(social::unfollow_by_handle))
        .route("/v1/social/users/{handle}", get(social::get_user_profile))
        .route("/v1/social/users/{handle}/posts", get(social::get_user_posts))
        .route("/v1/social/posts/{id}", get(social::get_single_post).delete(social::delete_post))
        .route("/v1/social/feed/following", get(social::get_following_feed))
        .route("/v1/social/me/profile", get(social::get_me_profile).post(social::create_me_profile).patch(social::update_me_profile))
        .route("/v1/social/notifications", get(notifications::get_notifications))
        .route("/v1/social/notifications/read", post(notifications::mark_notifications_read))
        .route("/v1/social/communities/{id}/feed", get(social::get_community_feed))
        .route("/v1/social/communities/{id}/join", post(social::join_community))
        .route("/v1/social/communities/{id}/leave", delete(social::leave_community))
        .route("/v1/social/communities/{id}/members", get(social::list_community_members))
        .route("/v1/social/conversations", get(messaging::list_conversations).post(messaging::create_conversation))
        .route("/v1/social/conversations/{id}/messages", get(messaging::list_messages).post(messaging::send_message))
        .route("/v1/social/users/{id}/block", post(moderation::block_user).delete(moderation::unblock_user))
        .route("/v1/social/users/{id}/mute", post(moderation::mute_user).delete(moderation::unmute_user))
        .route("/v1/social/report", post(moderation::create_report))
        .merge(admin_routes)
        .merge(rate_limited)
        // 12 MB: mock media PUT may carry image bytes when R2 is not configured.
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), soma::soma_headers_middleware))
        .layer(cors_layer())
        .layer(middleware::from_fn(request_id_middleware))
        .with_state(state)
        .fallback_service(static_service)
}

/// Build router with only HeyVera Social routes (heyvera.org).
pub fn build_heyvera_router(state: Arc<AppState>) -> Router {
    let heyvera_static_dir = std::env::var("HEYVERA_STATIC_DIR")
        .unwrap_or_else(|_| "heyvera/dist".to_string());

    async fn spa_fallback_heyvera(_req: axum::http::Request<axum::body::Body>) -> Result<axum::response::Response, std::convert::Infallible> {
        let static_dir = std::env::var("HEYVERA_STATIC_DIR")
            .unwrap_or_else(|_| "heyvera/dist".to_string());
        let index_path = format!("{}/index.html", static_dir);
        let response = match std::fs::read_to_string(&index_path) {
            Ok(content) => axum::response::Html(content).into_response(),
            Err(_) => (
                axum::http::StatusCode::NOT_FOUND,
                axum::response::Html("<!DOCTYPE html><html><body><h1>HeyVera Frontend Not Available</h1></body></html>")
            ).into_response(),
        };
        Ok(response)
    }

    let static_service = ServeDir::new(&heyvera_static_dir)
        .not_found_service(tower::service_fn(spa_fallback_heyvera));

    let admin_routes = Router::new()
        .route("/api/admin/stats", get(admin::system_stats))
        .route("/api/admin/codes", get(admin::list_promo_codes).post(admin::create_promo_code))
        .route("/api/admin/codes/{id}", patch(admin::update_promo_code).delete(admin::delete_promo_code))
        .route("/api/admin/redemptions", get(admin::list_redemptions))
        .route("/api/admin/accounts/{clerk_user_id}/suspend", post(admin::suspend_account))
        .route("/api/admin/accounts/{clerk_user_id}/unsuspend", post(admin::unsuspend_account))
        .route("/api/admin/cleanup-orphaned-media", post(admin::cleanup_orphaned_media))
        .route("/api/admin/reports", get(moderation::list_reports))
        .route("/api/admin/audit-log", get(admin::get_audit_log))
        .layer(middleware::from_fn_with_state(state.clone(), admin::require_admin_middleware));

    Router::new()
        .route("/v1/health", get(v1_health))
        .route("/v1/ready", get(v1_ready))
        .route("/metrics", get(metrics_handler))
        .route("/api/health", get(routes::health))
        // Social endpoints
        .route("/v1/social/trending", get(social::get_trending))
        .route("/v1/social/search", get(social::search))
        .route("/v1/social/profiles/featured", get(social::get_featured_profiles))
        .route("/v1/social/feed/home", get(social::get_home_feed))
        .route("/v1/social/profiles", get(social::get_profiles).post(social::create_profile))
        .route("/v1/social/profiles/{handle}", get(social::get_profile_by_handle))
        .route("/v1/social/profiles/{handle}/linked-agents", get(social::get_profile_linked_agents))
        .route("/v1/social/profiles/{handle}/stats", get(social::get_user_profile_stats))
        .route("/v1/social/communities", get(social::get_communities))
        .route("/v1/social/longform", get(social::get_longform).post(social::create_longform))
        .route("/v1/social/profile/me", get(social::get_my_profile))
        .route("/v1/social/profile", patch(social::update_me_profile))
        .route("/v1/social/linked-agents", get(social::list_my_linked_agents).post(social::create_linked_agent))
        .route("/v1/social/posts", post(social::create_post))
        .route("/v1/social/media/upload-url", post(media::request_upload_url))
        .route("/v1/social/media/{id}/finalize", post(media::finalize_upload))
        .route(
            "/v1/social/media/mock-upload/{*storage_key}",
            put(media::mock_upload).get(media::mock_serve),
        )
        .route("/v1/social/posts/{id}/like", post(social::like_post).delete(social::unlike_post))
        .route("/v1/social/posts/{id}/repost", post(social::repost_post).delete(social::unrepost_post))
        .route("/v1/social/posts/{id}/bookmark", post(social::bookmark_post).delete(social::unbookmark_post))
        .route("/v1/social/bookmarks", get(social::get_bookmarks))
        .route("/v1/social/follows/{handle}", post(social::follow_by_handle).delete(social::unfollow_by_handle))
        .route("/v1/social/follows/{handle}/status", get(social::get_follow_status))
        .route("/v1/social/users/{handle}", get(social::get_user_profile))
        .route("/v1/social/users/{handle}/posts", get(social::get_user_posts))
        .route("/v1/social/posts/{id}", get(social::get_single_post).delete(social::delete_post))
        .route("/v1/social/feed/following", get(social::get_following_feed))
        .route("/v1/social/me/profile", get(social::get_me_profile).post(social::create_me_profile).patch(social::update_me_profile))
        .route("/v1/social/notifications", get(notifications::get_notifications))
        .route("/v1/social/notifications/read", post(notifications::mark_notifications_read))
        .route("/v1/social/communities/{id}/feed", get(social::get_community_feed))
        .route("/v1/social/communities/{id}/join", post(social::join_community))
        .route("/v1/social/communities/{id}/leave", delete(social::leave_community))
        .route("/v1/social/communities/{id}/members", get(social::list_community_members))
        .route("/v1/social/conversations", get(messaging::list_conversations).post(messaging::create_conversation))
        .route("/v1/social/conversations/{id}/messages", get(messaging::list_messages).post(messaging::send_message))
        .route("/v1/social/users/{id}/block", post(moderation::block_user).delete(moderation::unblock_user))
        .route("/v1/social/users/{id}/mute", post(moderation::mute_user).delete(moderation::unmute_user))
        .route("/v1/social/report", post(moderation::create_report))
        .route("/v1/pulse/drafts", get(pulse::list_drafts).post(pulse::create_draft))
        .route("/v1/pulse/drafts/{id}", get(pulse::get_draft))
        .route("/v1/pulse/drafts/{id}/approve", post(pulse::approve_draft))
        .route("/v1/pulse/drafts/{id}/reject", post(pulse::reject_draft))
        .route("/v1/pulse/drafts/{id}/publish", post(pulse::publish_draft))
        .route("/v1/pulse/drafts/{id}/audit", get(pulse::get_draft_audit))
        .route("/v1/pulse/chat", post(pulse::pulse_chat))
        .route("/v1/pulse/schedules", get(pulse::list_schedules).post(pulse::schedule_draft))
        .route("/v1/pulse/schedules/process", post(pulse::process_due_schedules))
        // Shared auth/billing (heyvera router)
        .route("/api/auth/status", get(auth::auth_status))
        .route("/api/billing/status", get(billing::get_billing_status))
        .route("/api/billing/checkout", post(billing::create_checkout))
        .route("/api/billing/portal", post(billing::create_portal))
        .route("/api/stripe/webhook", post(billing::stripe_webhook))
        .route("/api/clerk/webhooks", post(clerk_webhooks::clerk_webhook))
        .merge(admin_routes)
        // Rate-limit all HeyVera API routes (IP + account category limits).
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ratelimit::rate_limit_middleware,
        ))
        // 12 MB: mock media PUT may carry image bytes when R2 is not configured.
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(cors_layer())
        .layer(middleware::from_fn(request_id_middleware))
        .with_state(state)
        .fallback_service(static_service)
}

/// Build the full axum Router with all routes (legacy — both products combined).
/// Use build_cortex_router() or build_heyvera_router() for separate deployments.
pub fn build_router(state: Arc<AppState>) -> Router {
    // Static file serving for Cortex frontend
    let cortex_static_dir = std::env::var("CORTEX_STATIC_DIR")
        .unwrap_or_else(|_| "cortex/dist".to_string());

    // Create fallback handler for SPA routing
    async fn spa_fallback(_req: axum::http::Request<axum::body::Body>) -> Result<axum::response::Response, std::convert::Infallible> {
        let static_dir = std::env::var("CORTEX_STATIC_DIR")
            .unwrap_or_else(|_| "cortex/dist".to_string());
        let index_path = format!("{}/index.html", static_dir);

        let response = match std::fs::read_to_string(&index_path) {
            Ok(content) => axum::response::Html(content).into_response(),
            Err(_) => {
                tracing::warn!("Could not find Cortex frontend at {}, serving fallback", index_path);
                (
                    axum::http::StatusCode::NOT_FOUND,
                    axum::response::Html("<!DOCTYPE html><html><head><title>Cortex</title></head><body><h1>Cortex Frontend Not Available</h1><p>The Cortex frontend files could not be found. Please build the frontend first.</p></body></html>")
                ).into_response()
            }
        };
        Ok(response)
    }

    let static_service = ServeDir::new(&cortex_static_dir)
        .not_found_service(tower::service_fn(spa_fallback));
    // Rate-limited routes (expensive endpoints)
    let rate_limited = Router::new()
        .route("/api/route", post(routes::route_task))
        .route("/api/execute", post(sse::execute_task))
        .route("/api/chat", post(chat::chat))
        .route("/api/runs", get(routes::list_runs).post(routes::create_run))
        .route("/api/runs/estimate", post(routes::estimate_run))
        .route("/api/runs/{id}", get(routes::get_run))
        .route("/api/runs/{id}/events", get(routes::get_run_events))
        .route(
            "/api/runs/{run_id}/steps/{step_id}/verifier-report/{report_id}",
            get(routes::get_verifier_report),
        )
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
        .route("/api/context/runs/{run_id}/artifacts", get(context_api::list_artifacts_for_run))
        .route("/api/context/runs/{run_id}/context", get(context_api::preview_context_for_run))
        .route("/api/context/stats", get(context_api::get_context_stats))
        .route("/api/context/health", get(context_api::get_context_health))
        .route("/api/context/test", post(context_api::test_context_assembly))
        // API Keys (BYOK) — rate-limited
        .route("/api/keys", get(api_keys::list_api_keys))
        .route("/api/keys/{provider}", put(api_keys::save_api_key).delete(api_keys::delete_api_key))
        // GitHub repo import + sync (BYOS container clones) — rate-limited
        .route("/api/github/repos", get(github_repos::list_repos))
        .route("/api/github/imports", get(github_repos::list_imports))
        .route("/api/github/import", post(github_repos::import_repo))
        .route("/api/github/status/{import_id}", get(github_repos::import_status))
        .route("/api/github/sync/{import_id}", post(github_repos::sync_repo))
        // Project Workspaces (Replit integration) — rate-limited
        .route("/api/projects", get(replit::list_projects).post(replit::create_project))
        .route("/api/projects/import", post(replit::import_project))
        .route("/api/projects/{id}", get(replit::get_project).delete(replit::delete_project))
        .route("/api/projects/{id}/chat", post(replit::proxy_chat_to_workspace))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ratelimit::rate_limit_middleware,
        ));

    let admin_routes = Router::new()
        .route("/api/admin/workers", get(admin::get_workers))
        .route("/api/admin/stats", get(admin::system_stats))
        .route("/api/admin/decisions", get(admin::list_decisions))
        .route("/api/admin/runs", get(admin::list_all_runs))
        .route("/api/admin/runs/{id}", get(admin::get_run_detail))
        .route("/api/admin/pressure", get(admin::pressure_dashboard))
        .route("/api/admin/usage", get(usage_api::admin_usage))
        .route("/api/admin/usage/users", get(usage_api::admin_usage_users))
        .route("/api/admin/codes", get(admin::list_promo_codes).post(admin::create_promo_code))
        .route("/api/admin/codes/{id}", patch(admin::update_promo_code).delete(admin::delete_promo_code))
        .route("/api/admin/redemptions", get(admin::list_redemptions))
        .route("/api/admin/accounts/{clerk_user_id}/suspend", post(admin::suspend_account))
        .route("/api/admin/accounts/{clerk_user_id}/unsuspend", post(admin::unsuspend_account))
        .route("/api/admin/cleanup-orphaned-media", post(admin::cleanup_orphaned_media))
        .route("/api/admin/reports", get(moderation::list_reports))
        .route("/api/admin/audit-log", get(admin::get_audit_log))
        .route("/api/admin/reconcile-counters", post(admin::reconcile_counters))
        .route("/api/admin/containers", get(admin::list_containers))
        .route("/api/admin/containers/stats", get(admin::container_stats))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            admin::require_admin_middleware,
        ));

    // Non-rate-limited routes
    Router::new()
        // Public — v1 health/ready
        .route("/v1/health", get(v1_health))
        .route("/v1/ready", get(v1_ready))
        // Prometheus metrics (scrape target — restrict via network policy)
        .route("/metrics", get(metrics_handler))
        // Public
        .route("/api/health", get(routes::health))
        .route("/api/deploy-info", get(routes::deploy_info))
        .route("/api/deploy-metadata", get(deploy_metadata))
        .route("/api/deploy-status", get(deploy_status::deploy_status))
        .route("/api/deployment/status", get(deploy_status::deploy_status))
        .route("/api/deployment/events", get(deploy_status::deployment_events))
        .route("/api/deployment/adapters", get(routes::get_deployment_adapters))
        // auth/status moved to protected layer (requires ClerkUser)
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
        // Social layer (HeyVera) — real DB-backed endpoints
        .route("/v1/social/trending", get(social::get_trending))
        .route("/v1/social/search", get(social::search))
        .route("/v1/social/profiles/featured", get(social::get_featured_profiles))
        .route("/v1/social/feed/home", get(social::get_home_feed))
        .route("/v1/social/profiles", get(social::get_profiles).post(social::create_profile))
        .route("/v1/social/profiles/{handle}/stats", get(social::get_user_profile_stats))
        .route("/v1/social/communities", get(social::get_communities))
        .route("/v1/social/longform", get(social::get_longform).post(social::create_longform))
        .route("/v1/social/profile/me", get(social::get_my_profile))
        .route("/v1/social/linked-agents", get(social::list_my_linked_agents).post(social::create_linked_agent))
        .route("/v1/social/posts", post(social::create_post))
        // Task #47: Media uploads
        .route("/v1/social/media/upload-url", post(media::request_upload_url))
        .route("/v1/social/media/{id}/finalize", post(media::finalize_upload))
        .route(
            "/v1/social/media/mock-upload/{*storage_key}",
            put(media::mock_upload).get(media::mock_serve),
        )
        // Task #30: Social action endpoints
        .route("/v1/social/posts/{id}/like", post(social::like_post).delete(social::unlike_post))
        .route("/v1/social/posts/{id}/repost", post(social::repost_post).delete(social::unrepost_post))
        .route("/v1/social/posts/{id}/bookmark", post(social::bookmark_post).delete(social::unbookmark_post))
        .route("/v1/social/bookmarks", get(social::get_bookmarks))
        .route("/v1/social/follows/{handle}", post(social::follow_by_handle).delete(social::unfollow_by_handle))
        // Task #31: User profile endpoints
        .route("/v1/social/users/{handle}", get(social::get_user_profile))
        .route("/v1/social/users/{handle}/posts", get(social::get_user_posts))
        // Task #32: Single post + following feed
        .route("/v1/social/posts/{id}", get(social::get_single_post).delete(social::delete_post))
        .route("/v1/social/feed/following", get(social::get_following_feed))
        // Task #33: /me/profile CRUD
        .route("/v1/social/me/profile", get(social::get_me_profile).post(social::create_me_profile).patch(social::update_me_profile))
        // Task #34: Notifications
        .route("/v1/social/notifications", get(notifications::get_notifications))
        .route("/v1/social/notifications/read", post(notifications::mark_notifications_read))
        // Task #36: Community feed
        .route("/v1/social/communities/{id}/feed", get(social::get_community_feed))
        // Community membership
        .route("/v1/social/communities/{id}/join", post(social::join_community))
        .route("/v1/social/communities/{id}/leave", delete(social::leave_community))
        .route("/v1/social/communities/{id}/members", get(social::list_community_members))
        // Task #35: Conversations & Messages
        .route("/v1/social/conversations", get(messaging::list_conversations).post(messaging::create_conversation))
        .route("/v1/social/conversations/{id}/messages", get(messaging::list_messages).post(messaging::send_message))
        // Task #45: Block/Mute/Report
        .route("/v1/social/users/{id}/block", post(moderation::block_user).delete(moderation::unblock_user))
        .route("/v1/social/users/{id}/mute", post(moderation::mute_user).delete(moderation::unmute_user))
        .route("/v1/social/report", post(moderation::create_report))
        // Pulse — AI draft pipeline
        .route("/v1/pulse/drafts", get(pulse::list_drafts).post(pulse::create_draft))
        .route("/v1/pulse/drafts/{id}", get(pulse::get_draft))
        .route("/v1/pulse/drafts/{id}/approve", post(pulse::approve_draft))
        .route("/v1/pulse/drafts/{id}/reject", post(pulse::reject_draft))
        .route("/v1/pulse/drafts/{id}/publish", post(pulse::publish_draft))
        .route("/v1/pulse/drafts/{id}/audit", get(pulse::get_draft_audit))
        .route("/v1/pulse/chat", post(pulse::pulse_chat))
        .route("/v1/pulse/schedules", get(pulse::list_schedules).post(pulse::schedule_draft))
        .route("/v1/pulse/schedules/process", post(pulse::process_due_schedules))
        // Protected — lightweight
        .route("/api/providers", get(routes::get_providers))
        .route("/api/ledger", get(routes::get_ledger))
        .route("/api/auth/status", get(auth::auth_status))
        .route("/api/auth/start", post(auth::auth_start))
        .route("/api/auth/submit", post(auth::auth_submit))
        .route("/api/auth/refresh", post(auth::auth_refresh))
        .route("/api/auth/credential/delete", post(auth::credential_delete))
        .route("/api/auth/credential/default", post(auth::credential_set_default))
        // Credential assignments
        .route("/api/credentials/assign", post(credentials::assign_credential))
        .route("/api/credentials/assignments", get(credentials::list_assignments))
        .route("/api/credentials/assignments/{id}", delete(credentials::remove_assignment))
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
        .route("/api/groups/{group_id}/tasks", post(integrations::create_group_task))
        .route("/api/groups/{group_id}/tasks", put(integrations::update_group_tasks))
        .route("/api/groups/{group_id}/tasks/actions", post(integrations::apply_group_task_actions))
        .route("/api/groups/{group_id}/tasks/{task_id}", patch(integrations::patch_group_task))
        .route("/api/groups/{group_id}/tasks/{task_id}/chats", post(integrations::attach_group_task_chat))
        .route("/api/groups/{group_id}/tasks/{task_id}/projection", get(integrations::get_group_task_projection))
        .route("/api/operations/summary", get(integrations::get_personal_operations_summary))
        .route("/api/authority/scopes", get(integrations::list_authority_scopes))
        .route("/api/authority/scopes", post(integrations::create_authority_scope))
        .route("/api/authority/scopes/{scope_id}", patch(integrations::update_authority_scope))
        .route("/api/authority/delegations", get(integrations::list_authority_delegations))
        .route("/api/authority/delegations", post(integrations::delegate_authority))
        .route("/api/authority/delegations/{delegation_id}", delete(integrations::revoke_authority_delegation))
        .route("/api/groups/{group_id}/operations/summary", get(integrations::get_group_operations_summary))
        .route("/api/groups/{group_id}/operations/graph", get(integrations::get_group_operations_graph))
        .route("/api/groups/{group_id}/approvals", get(integrations::list_group_approval_requests))
        .route("/api/groups/{group_id}/approvals", post(integrations::create_group_approval_request))
        .route("/api/groups/{group_id}/approvals/{request_id}", patch(integrations::resolve_group_approval_request))
        // Billing & Subscription
        .route("/api/billing/status", get(billing::get_billing_status))
        .route("/api/billing/checkout", post(billing::create_checkout))
        .route("/api/billing/portal", post(billing::create_portal))
        .route("/api/billing/referral/validate", post(billing::validate_referral))
        .route("/api/billing/history", get(billing::get_billing_history))
        // Stripe webhook (no auth — verified by signature)
        .route("/api/stripe/webhook", post(billing::stripe_webhook))
        // Clerk webhook (no auth — verified by svix signature)
        .route("/api/clerk/webhooks", post(clerk_webhooks::clerk_webhook))
        // Usage
        .route("/api/usage", get(usage_api::get_usage))
        .route("/api/usage/daily", get(usage_api::get_daily_usage))
        // Worker WebSocket
        .route("/api/ws", get(ws::ws_handler))
        // Mission Control WebSocket (frontend observers) + snapshot
        .route("/api/mc", get(mission_control::mc_handler))
        .route("/api/mc/snapshot", get(mission_control::mc_snapshot))
        .merge(admin_routes)
        // Merge rate-limited routes
        .merge(rate_limited)
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024)) // mock media PUT without R2
        .layer(middleware::from_fn_with_state(
            state.clone(),
            soma::soma_headers_middleware,
        ))
        .layer(cors_layer())
        .layer(middleware::from_fn(request_id_middleware))
        .with_state(state)
        // Serve static files last (fallback for unmatched routes)
        .fallback_service(static_service)
}
