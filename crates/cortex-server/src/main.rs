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
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info".parse().unwrap());
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
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

    if clerk_secret_key.is_some() {
        tracing::info!("auth: Clerk JWT verification enabled");
    } else {
        tracing::info!("auth: disabled (no CLERK_SECRET_KEY)");
    }

    let state = AppState::new(ledger_path, workspace_dir, clerk_secret_key).await;

    let scheduler_tx = scheduler::spawn_scheduler(state.clone());
    state.set_scheduler_tx(scheduler_tx).await;

    cortex_api::token_refresh::spawn_token_refresh_job(state.clone());
    cortex_api::docker::spawn_idle_reaper(state.clone());

    let app = cortex_api::build_cortex_router(state.clone());

    let port: u16 = std::env::var("CORTEX_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::STREAM,
        Some(socket2::Protocol::TCP),
    )
    .expect("failed to create socket");
    socket.set_reuse_address(true).expect("failed to set SO_REUSEADDR");
    socket.set_nonblocking(true).expect("failed to set nonblocking");
    socket.bind(&addr.into()).unwrap_or_else(|e| {
        panic!("failed to bind {addr}: {e}");
    });
    socket.listen(1024).expect("failed to listen");

    let listener = tokio::net::TcpListener::from_std(socket.into()).expect("failed to create listener");
    tracing::info!("cortex server listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    tracing::info!("shutting down");
    state.shutdown().await;
    tracing::info!("cortex server exited");
}
