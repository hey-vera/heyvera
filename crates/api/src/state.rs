use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use cortex_core::protocol::{BrainMessage, StepContext};
use cortex_core::provider::{ProviderId, ProviderStatus, Tier};
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use cortex_core::usage::UsageLimits;
use cortex_engine::captain::SchedulerEvent;
use cortex_engine::ledger::Ledger;
use cortex_worker::executor::detect_available_providers;
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::clerk::JwksCache;
use crate::db::Database;
use crate::ratelimit::RateLimiter;

pub struct ConnectedWorker {
    pub worker_id: String,
    pub user_id: String,
    pub available_providers: Vec<ProviderId>,
    pub disabled_providers: HashSet<ProviderId>,
    pub tx: mpsc::Sender<BrainMessage>,
}

pub struct AppState {
    pub providers: RwLock<Vec<ProviderStatus>>,
    pub ledger: Ledger,
    pub workspace_dir: PathBuf,
    pub clerk_secret_key: Option<String>,
    pub jwks_cache: RwLock<JwksCache>,
    pub pending_auths: RwLock<HashMap<String, ChildStdin>>,
    pub db: Option<Database>,
    pub workers: RwLock<HashMap<String, ConnectedWorker>>,
    pub step_senders: RwLock<HashMap<String, mpsc::Sender<StepEvent>>>,
    pub scheduler_tx: RwLock<Option<mpsc::Sender<SchedulerEvent>>>,
    pub rate_limiter: Arc<RateLimiter>,
    pub billing_enforced: bool,
    pub usage_limits: UsageLimits,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StepEvent {
    Started {
        step_id: String,
        provider: String,
        model: String,
    },
    Output {
        step_id: String,
        line: String,
    },
    Completed {
        step_id: String,
        exit_code: i32,
    },
    Failed {
        step_id: String,
        error: String,
    },
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
            providers
                .iter()
                .map(|p| p.provider.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );

        tracing::info!("workspace directory: {}", workspace_dir.display());
        if clerk_secret_key.is_some() {
            tracing::info!("clerk auth enabled");
        } else {
            tracing::info!("clerk auth disabled (no CLERK_SECRET_KEY)");
        }

        let db_path = workspace_dir.join(".cortex").join("cortex.db");
        let db = Database::open(&db_path);
        tracing::info!("database opened at {}", db_path.display());

        // Billing enforcement: default true, unless CORTEX_AUTH_DISABLED is set
        let auth_disabled = std::env::var("CORTEX_AUTH_DISABLED")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let billing_enforced = std::env::var("CORTEX_BILLING_ENFORCE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(!auth_disabled); // default true in production, false when auth disabled

        // Configurable usage limits
        let usage_limits = UsageLimits {
            daily_cost_limit: std::env::var("CORTEX_DAILY_COST_LIMIT")
                .ok()
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(10.0),
            daily_step_limit: std::env::var("CORTEX_DAILY_STEP_LIMIT")
                .ok()
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or(100),
            monthly_cost_limit: std::env::var("CORTEX_MONTHLY_COST_LIMIT")
                .ok()
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(200.0),
        };

        tracing::info!(
            "billing: enforced={}, daily_cost=${:.0}, daily_steps={}, monthly_cost=${:.0}",
            billing_enforced,
            usage_limits.daily_cost_limit,
            usage_limits.daily_step_limit,
            usage_limits.monthly_cost_limit,
        );

        Arc::new(Self {
            providers: RwLock::new(providers),
            ledger: Ledger::new(ledger_path),
            workspace_dir,
            clerk_secret_key,
            jwks_cache: RwLock::new(JwksCache::empty()),
            pending_auths: RwLock::new(HashMap::new()),
            db: Some(db),
            workers: RwLock::new(HashMap::new()),
            step_senders: RwLock::new(HashMap::new()),
            scheduler_tx: RwLock::new(None),
            rate_limiter: Arc::new(RateLimiter::default_per_user()),
            billing_enforced,
            usage_limits,
        })
    }

    pub async fn register_worker(
        &self,
        worker_id: String,
        user_id: String,
        available_providers: Vec<ProviderId>,
        tx: mpsc::Sender<BrainMessage>,
    ) {
        tracing::info!("registering worker {worker_id} for user {user_id}");
        let mut workers = self.workers.write().await;
        workers.insert(
            worker_id.clone(),
            ConnectedWorker {
                worker_id,
                user_id,
                available_providers,
                disabled_providers: HashSet::new(),
                tx,
            },
        );
        tracing::info!("active workers: {}", workers.len());
    }

    pub async fn unregister_worker(&self, worker_id: &str) {
        let mut workers = self.workers.write().await;
        workers.remove(worker_id);
        tracing::info!("worker {worker_id} removed, active: {}", workers.len());
    }

    pub async fn find_worker_for_user(&self, user_id: &str) -> Option<mpsc::Sender<BrainMessage>> {
        let workers = self.workers.read().await;
        workers
            .values()
            .find(|w| {
                w.user_id == user_id && {
                    // Skip workers whose every provider is disabled
                    let has_usable = w.available_providers.iter()
                        .any(|p| !w.disabled_providers.contains(p));
                    has_usable || w.available_providers.is_empty()
                }
            })
            .map(|w| w.tx.clone())
    }

    /// Mark a specific provider as unhealthy on a worker (e.g. auth expired).
    /// The worker will not be selected for dispatch if all its providers are disabled.
    pub async fn mark_provider_unhealthy(&self, worker_id: &str, provider: ProviderId) {
        let mut workers = self.workers.write().await;
        if let Some(w) = workers.get_mut(worker_id) {
            w.disabled_providers.insert(provider);
            tracing::warn!(
                "provider {} disabled on worker {} — disabled: {:?}, available: {:?}",
                provider, worker_id, w.disabled_providers, w.available_providers
            );
        }
    }

    /// Clear all disabled providers for a worker (called on re-registration).
    pub async fn clear_disabled_providers(&self, worker_id: &str) {
        let mut workers = self.workers.write().await;
        if let Some(w) = workers.get_mut(worker_id) {
            if !w.disabled_providers.is_empty() {
                tracing::info!(
                    "clearing disabled providers for worker {} (re-registered)",
                    worker_id
                );
                w.disabled_providers.clear();
            }
        }
    }

    pub async fn dispatch_step(
        &self,
        user_id: &str,
        task: TaskContract,
        decision: RoutingDecision,
        result_tx: mpsc::Sender<StepEvent>,
    ) -> Result<String, String> {
        let worker_tx = self
            .find_worker_for_user(user_id)
            .await
            .ok_or_else(|| {
                "no connected worker — run `npx cortex connect` in your environment".to_string()
            })?;

        let step_id = Uuid::new_v4().to_string();
        let attempt_id = Uuid::new_v4().to_string();
        let run_id = Uuid::new_v4().to_string();
        let lease_gen = 1;
        let lease_deadline_ms = chrono::Utc::now().timestamp_millis() + 600_000;

        self.step_senders
            .write()
            .await
            .insert(step_id.clone(), result_tx);

        worker_tx
            .send(BrainMessage::ExecuteStep {
                run_id,
                step_id: step_id.clone(),
                attempt_id,
                lease_gen,
                lease_deadline_ms,
                workspace_id: "default".to_string(),
                base_commit: None,
                allowed_paths: vec![],
                task,
                decision,
                context: StepContext::default(),
            })
            .await
            .map_err(|_| "worker connection lost".to_string())?;

        Ok(step_id)
    }

    pub async fn get_step_sender(&self, step_id: &str) -> Option<mpsc::Sender<StepEvent>> {
        self.step_senders.read().await.get(step_id).cloned()
    }

    pub async fn remove_step_sender(&self, step_id: &str) {
        self.step_senders.write().await.remove(step_id);
    }

    pub async fn set_scheduler_tx(&self, tx: mpsc::Sender<SchedulerEvent>) {
        *self.scheduler_tx.write().await = Some(tx);
    }

    pub async fn emit_scheduler_event(&self, event: SchedulerEvent) {
        if let Some(tx) = self.scheduler_tx.read().await.as_ref() {
            if tx.send(event).await.is_err() {
                tracing::error!("scheduler channel closed");
            }
        }
    }
}
