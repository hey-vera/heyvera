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
    // Sentry must be initialized before the tracing subscriber so the tracing
    // layer can attach to it. The guard must live for the entire duration of
    // main; dropping it flushes pending events.
    // ── Sentry (optional feature) ────────────────────────────────────────────
    // Initialize before the tracing subscriber so the sentry tracing layer
    // can be wired in. The guard must live for the entire duration of main.
    #[cfg(feature = "sentry-tracking")]
    let _sentry_guard = if let Ok(dsn) = std::env::var("SENTRY_DSN") {
        let guard = sentry::init((dsn, sentry::ClientOptions {
            release: Some(env!("CARGO_PKG_VERSION").into()),
            traces_sample_rate: 0.1,
            ..Default::default()
        }));
        Some(guard)
    } else {
        None
    };

    // ── Tracing subscriber ───────────────────────────────────────────────────
    #[cfg(feature = "sentry-tracking")]
    {
        use tracing_subscriber::prelude::*;
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info".parse().unwrap());
        let sentry_active = std::env::var("SENTRY_DSN").is_ok();
        if sentry_active {
            tracing_subscriber::registry()
                .with(tracing_subscriber::fmt::layer().with_filter(env_filter))
                .with(sentry::integrations::tracing::layer())
                .init();
            eprintln!("Sentry error tracking enabled");
        } else {
            tracing_subscriber::fmt()
                .with_env_filter(env_filter)
                .init();
            eprintln!("SENTRY_DSN not set, error tracking disabled");
        }
    }

    #[cfg(not(feature = "sentry-tracking"))]
    {
        let env_filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info".parse().unwrap());
        // Use structured JSON logging when CORTEX_JSON_LOGS=true (production default)
        let use_json = std::env::var("CORTEX_JSON_LOGS")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if use_json {
            tracing_subscriber::fmt()
                .json()
                .with_env_filter(env_filter)
                .init();
        } else {
            tracing_subscriber::fmt()
                .with_env_filter(env_filter)
                .init();
        }
        if std::env::var("SENTRY_DSN").is_ok() {
            tracing::warn!(
                "SENTRY_DSN is set but the sentry-tracking feature was not compiled in; \
                 rebuild with --features sentry-tracking to enable it"
            );
        }
    }

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
        tracing::info!("auth: disabled (no CLERK_SECRET_KEY) — all requests treated as user \"local\"");
    }

    let state = AppState::new(ledger_path, workspace_dir, clerk_secret_key).await;

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
