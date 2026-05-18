mod auth;
mod chat;
mod clerk;
mod routes;
mod sse;
mod state;
mod user;

use std::net::SocketAddr;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

use state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".parse().unwrap()))
        .init();

    let ledger_path = std::env::var("CORTEX_LEDGER_PATH")
        .unwrap_or_else(|_| ".cortex/ledger.jsonl".to_string());

    if let Some(parent) = std::path::Path::new(&ledger_path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let workspace_dir = std::env::var("CORTEX_WORKSPACE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| ".".into()));

    let clerk_secret_key = std::env::var("CLERK_SECRET_KEY").ok().filter(|s| !s.is_empty());

    let state = AppState::new(ledger_path, workspace_dir, clerk_secret_key);

    let app = Router::new()
        // Public
        .route("/api/health", get(routes::health))
        .route("/api/auth/status", get(auth::auth_status))
        // Protected
        .route("/api/route", post(routes::route_task))
        .route("/api/providers", get(routes::get_providers))
        .route("/api/ledger", get(routes::get_ledger))
        .route("/api/execute", post(sse::execute_task))
        .route("/api/chat", post(chat::chat))
        .route("/api/auth/start", post(auth::auth_start))
        .route("/api/auth/refresh", post(auth::auth_refresh))
        // User endpoints
        .route("/api/user/profile", get(user::get_profile))
        .route("/api/user/github/status", get(user::github_status))
        .route("/api/user/repos/select", post(user::select_repos))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("CORTEX_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("cortex server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
