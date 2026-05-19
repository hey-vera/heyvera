use std::net::SocketAddr;

use tracing_subscriber::EnvFilter;

use cortex_api::scheduler;
use cortex_api::state::AppState;

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install SIGINT handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => tracing::info!("received SIGINT"),
        _ = terminate => tracing::info!("received SIGTERM"),
    }
}

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

    let is_production = std::env::var("CORTEX_PRODUCTION")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if is_production && clerk_secret_key.is_none() {
        tracing::error!("CORTEX_PRODUCTION=true but CLERK_SECRET_KEY is not set — refusing to start without authentication");
        std::process::exit(1);
    }

    if is_production {
        tracing::info!("running in PRODUCTION mode — auth enforced, CORS restricted");
    } else {
        tracing::info!("running in DEVELOPMENT mode — auth optional, CORS permissive");
    }

    let state = AppState::new(ledger_path, workspace_dir, clerk_secret_key);

    // Start the scheduler loop
    let scheduler_tx = scheduler::spawn_scheduler(state.clone());
    state.set_scheduler_tx(scheduler_tx).await;

    let app = cortex_api::build_router(state.clone());

    let port: u16 = std::env::var("CORTEX_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("cortex server listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    // Signal received — run graceful shutdown logic
    tracing::info!("server stopped accepting connections, running shutdown sequence");
    state.shutdown().await;
    tracing::info!("cortex server exited cleanly");
}
