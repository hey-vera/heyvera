use std::path::PathBuf;
use std::sync::Arc;

use cortex_core::provider::{ProviderStatus, Tier};
use cortex_engine::ledger::Ledger;
use cortex_worker::executor::detect_available_providers;
use tokio::sync::RwLock;

use crate::clerk::JwksCache;

pub struct AppState {
    pub providers: RwLock<Vec<ProviderStatus>>,
    pub ledger: Ledger,
    pub workspace_dir: PathBuf,
    pub clerk_secret_key: Option<String>,
    pub jwks_cache: RwLock<JwksCache>,
}

impl AppState {
    pub fn new(
        ledger_path: impl Into<std::path::PathBuf>,
        workspace_dir: PathBuf,
        clerk_secret_key: Option<String>,
    ) -> Arc<Self> {
        let detected = detect_available_providers();
        let all_tiers = vec![Tier::Search, Tier::Execute, Tier::Think];

        let providers: Vec<ProviderStatus> = detected
            .into_iter()
            .map(|id| ProviderStatus {
                provider: id,
                authenticated: true,
                pressure: 0.0,
                available_tiers: all_tiers.clone(),
            })
            .collect();

        tracing::info!(
            "detected {} provider(s): {}",
            providers.len(),
            providers.iter().map(|p| p.provider.to_string()).collect::<Vec<_>>().join(", ")
        );

        tracing::info!("workspace directory: {}", workspace_dir.display());
        if clerk_secret_key.is_some() {
            tracing::info!("clerk auth enabled");
        } else {
            tracing::info!("clerk auth disabled (no CLERK_SECRET_KEY)");
        }

        Arc::new(Self {
            providers: RwLock::new(providers),
            ledger: Ledger::new(ledger_path),
            workspace_dir,
            clerk_secret_key,
            jwks_cache: RwLock::new(JwksCache::empty()),
        })
    }
}
