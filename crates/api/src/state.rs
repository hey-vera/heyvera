use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use cortex_core::protocol::BrainMessage;
use cortex_core::provider::{ProviderId, ProviderStatus, Tier};
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use cortex_engine::ledger::Ledger;
use cortex_worker::executor::detect_available_providers;
use cortex_worker::stream::WorkerEvent;
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::clerk::JwksCache;
use crate::db::Database;

pub struct ConnectedWorker {
    pub worker_id: String,
    pub user_id: String,
    pub available_providers: Vec<ProviderId>,
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
    pub task_senders: RwLock<HashMap<Uuid, mpsc::Sender<WorkerEvent>>>,
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

        let db_path = workspace_dir.join(".cortex").join("cortex.db");
        let db = Database::open(&db_path);
        tracing::info!("database opened at {}", db_path.display());

        Arc::new(Self {
            providers: RwLock::new(providers),
            ledger: Ledger::new(ledger_path),
            workspace_dir,
            clerk_secret_key,
            jwks_cache: RwLock::new(JwksCache::empty()),
            pending_auths: RwLock::new(HashMap::new()),
            db: Some(db),
            workers: RwLock::new(HashMap::new()),
            task_senders: RwLock::new(HashMap::new()),
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
        workers.insert(worker_id.clone(), ConnectedWorker {
            worker_id,
            user_id,
            available_providers,
            tx,
        });
        tracing::info!("active workers: {}", workers.len());
    }

    pub async fn unregister_worker(&self, worker_id: &str) {
        let mut workers = self.workers.write().await;
        workers.remove(worker_id);
        tracing::info!("worker {worker_id} removed, active: {}", workers.len());
    }

    pub async fn find_worker_for_user(&self, user_id: &str) -> Option<mpsc::Sender<BrainMessage>> {
        let workers = self.workers.read().await;
        workers.values()
            .find(|w| w.user_id == user_id)
            .map(|w| w.tx.clone())
    }

    pub async fn dispatch_task(
        &self,
        user_id: &str,
        task: TaskContract,
        decision: RoutingDecision,
        result_tx: mpsc::Sender<WorkerEvent>,
    ) -> Result<(), String> {
        let worker_tx = self.find_worker_for_user(user_id).await
            .ok_or_else(|| "no connected worker — run `npx cortex connect` in your environment".to_string())?;

        self.task_senders.write().await.insert(task.id, result_tx);

        worker_tx.send(BrainMessage::ExecuteTask { task, decision }).await
            .map_err(|_| "worker connection lost".to_string())
    }

    pub async fn get_task_sender(&self, task_id: Uuid) -> Option<mpsc::Sender<WorkerEvent>> {
        self.task_senders.read().await.get(&task_id).cloned()
    }

    pub async fn remove_task_sender(&self, task_id: Uuid) {
        self.task_senders.write().await.remove(&task_id);
    }
}
