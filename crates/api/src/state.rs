use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cortex_core::protocol::{BrainMessage, StepContext};
use cortex_core::provider::{ProviderId, ProviderStatus};
use cortex_core::routing::RoutingDecision;
use cortex_core::task::TaskContract;
use cortex_core::usage::UsageLimits;
use cortex_engine::bandit::UcbScorer;
use cortex_engine::captain::SchedulerEvent;
use cortex_engine::ledger::Ledger;
use cortex_engine::store::CortexStore;
use std::sync::Mutex;
use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

use crate::clerk::{JwksCache, JwksStampedeGuard};
use crate::db::Database;
use crate::github::GitHubClient;
use crate::mission_control::{McSubscriber, MissionControlEvent, SubscriberId};
// Removed problematic module imports
use crate::ratelimit::RateLimiter;

/// Unique ID for each social-DM WebSocket subscriber (per socket).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct DmSubscriberId(pub Uuid);

/// Fan-out target for a conversation's realtime message pushes.
pub struct DmSubscriber {
    pub id: DmSubscriberId,
    pub tx: mpsc::Sender<serde_json::Value>,
}
use crate::soma::CortexHeart;
use crate::storage::Storage;
use crate::vera::VeraTracker;
use crate::context_flow::{ContextBus, ContextBusConfig};

#[derive(Debug, Clone)]
pub struct PendingAuthSession {
    pub user_id: String,
    pub provider: String,
    pub session_code: String,
    pub created_at: i64,
}

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
    pub jwks_stampede: JwksStampedeGuard,
    pub db: Option<Database>,
    pub workers: RwLock<HashMap<String, ConnectedWorker>>,
    pub step_senders: RwLock<HashMap<String, mpsc::Sender<StepEvent>>>,
    pub scheduler_tx: RwLock<Option<mpsc::Sender<SchedulerEvent>>>,
    pub rate_limiter: Arc<RateLimiter>,
    pub billing_enforced: bool,
    pub usage_limits: UsageLimits,
    pub is_shutting_down: AtomicBool,
    /// Mission Control WebSocket subscribers, keyed by user_id.
    pub mc_subscribers: RwLock<HashMap<String, Vec<McSubscriber>>>,
    /// Social DM WebSocket subscribers, keyed by conversation_id.
    pub dm_subscribers: RwLock<HashMap<String, Vec<DmSubscriber>>>,
    /// GitHub API client, initialized from `GITHUB_TOKEN` env var.
    pub github_client: Option<GitHubClient>,
    /// Cortex routing intelligence store (UCB bandit stats, evidence signals).
    pub cortex_store: Option<Mutex<CortexStore>>,
    /// UCB bandit scorer for adaptive provider selection.
    pub ucb_scorer: RwLock<UcbScorer>,
    /// Cortex's Soma heart — cryptographic identity for this agent.
    pub soma_heart: Option<CortexHeart>,
    /// Stripe API client for billing operations.
    pub stripe_client: Option<crate::stripe_client::StripeClient>,
    /// Stripe webhook signing secret for verifying incoming events.
    pub stripe_webhook_secret: Option<String>,
    /// Vera observation layer — every Cortex interaction flows through here.
    pub vera_tracker: VeraTracker,
    /// Context-Flow Pipeline — enables AI models to feed each other.
    pub context_bus: ContextBus,
    /// Docker container manager for BYOS credential isolation.
    pub container_manager: Option<crate::docker::ContainerManager>,
    /// Pending interactive container auth sessions (user_id → session).
    pub pending_container_auths: RwLock<HashMap<String, crate::docker::PendingContainerAuth>>,
    /// Pending BYOS auth sessions for subscription flows (session_code → session).
    pub pending_auth_sessions: Option<RwLock<HashMap<String, PendingAuthSession>>>,
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
    pub async fn new(
        ledger_path: impl Into<std::path::PathBuf>,
        workspace_dir: PathBuf,
        clerk_secret_key: Option<String>,
    ) -> Arc<Self> {
        let providers: Vec<ProviderStatus> = Vec::new();
        tracing::info!("provider detection disabled — credentials are per-user via user_credentials table");

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

        let github_client = GitHubClient::from_env();
        if github_client.is_some() {
            tracing::info!("GitHub API client initialized (GITHUB_TOKEN set)");
        } else {
            tracing::info!("GitHub API client not available (no GITHUB_TOKEN), will fall back to gh CLI");
        }

        let cortex_store_path = workspace_dir.join(".cortex").join("routing.db");
        let (cortex_store, ucb_scorer) = match CortexStore::open(&cortex_store_path) {
            Ok(store) => {
                let arm_stats = store.load_arm_stats().unwrap_or_default();
                let total_trials = arm_stats.values().map(|s| s.trials).sum();
                let scorer = UcbScorer {
                    arms: arm_stats,
                    exploration_weight: UcbScorer::exploration_weight_for_dial(5),
                    total_trials,
                };
                tracing::info!(
                    "cortex routing store opened at {} ({} arms, {} total trials)",
                    cortex_store_path.display(),
                    scorer.arms.len(),
                    scorer.total_trials,
                );
                (Some(Mutex::new(store)), scorer)
            }
            Err(e) => {
                tracing::warn!("failed to open cortex routing store: {e} — bandit scoring disabled");
                (None, UcbScorer::new(1.0))
            }
        };

        let soma_heart = match CortexHeart::new() {
            Ok(heart) => {
                tracing::info!("soma heart alive — DID: {}", heart.did());
                Some(heart)
            }
            Err(e) => {
                tracing::error!("failed to initialize soma heart: {e}");
                None
            }
        };

        let (stripe_client, stripe_webhook_secret) =
            match crate::stripe_client::StripeClient::from_env() {
                Some((client, secret)) => {
                    tracing::info!("Stripe billing configured");
                    (Some(client), Some(secret))
                }
                None => {
                    tracing::info!("STRIPE_SECRET_KEY not set — billing stubs active");
                    (None, None)
                }
            };

        let cortex_heart_id = soma_heart
            .as_ref()
            .map(|h| {
                let did_bytes = h.did().as_bytes();
                let mut id = [0u8; 32];
                for (i, b) in did_bytes.iter().enumerate().take(32) {
                    id[i] = *b;
                }
                soma_core::types::HeartId(id)
            })
            .unwrap_or_else(|| {
                use std::collections::hash_map::DefaultHasher;
                use std::hash::{Hash, Hasher};
                let mut hasher = DefaultHasher::new();
                "cortex-heart-v1".hash(&mut hasher);
                let hash = hasher.finish().to_le_bytes();
                let mut id = [0u8; 32];
                id[..8].copy_from_slice(&hash);
                id[8..16].copy_from_slice(&hash);
                id[16..24].copy_from_slice(&hash);
                id[24..32].copy_from_slice(&hash);
                soma_core::types::HeartId(id)
            });
        let vera_tracker = VeraTracker::new(cortex_heart_id);
        tracing::info!("vera tracker alive — cortex heart: {cortex_heart_id}");

        let context_config = ContextBusConfig::from_env();
        tracing::info!(
            "context-flow pipeline config: max_predecessors={}, max_total_tokens={}, target_tokens={:?}, summarize_code={}",
            context_config.max_predecessors,
            context_config.max_total_tokens,
            context_config.default_transform.target_tokens,
            context_config.default_transform.summarize_code,
        );
        let context_bus = ContextBus::new(context_config);
        tracing::info!("context-flow pipeline initialized — AI models can now feed each other");

        // Memory system removed for Context-Flow Pipeline deployment

        let container_manager = match crate::docker::ContainerManager::new() {
            Ok(cm) => {
                tracing::info!("Docker container manager initialized for BYOS");
                Some(cm)
            }
            Err(e) => {
                tracing::warn!("Docker not available — BYOS containers disabled: {e}");
                None
            }
        };

        Arc::new(Self {
            providers: RwLock::new(providers),
            ledger: Ledger::new(ledger_path),
            workspace_dir,
            clerk_secret_key,
            jwks_cache: RwLock::new(JwksCache::empty()),
            jwks_stampede: JwksStampedeGuard::new(),
            db: Some(db),
            workers: RwLock::new(HashMap::new()),
            step_senders: RwLock::new(HashMap::new()),
            scheduler_tx: RwLock::new(None),
            rate_limiter: Arc::new(RateLimiter::default_per_user()),
            billing_enforced,
            usage_limits,
            is_shutting_down: AtomicBool::new(false),
            mc_subscribers: RwLock::new(HashMap::new()),
            dm_subscribers: RwLock::new(HashMap::new()),
            github_client,
            cortex_store,
            ucb_scorer: RwLock::new(ucb_scorer),
            soma_heart,
            stripe_client,
            stripe_webhook_secret,
            vera_tracker,
            context_bus,
            container_manager,
            pending_container_auths: RwLock::new(HashMap::new()),
            pending_auth_sessions: Some(RwLock::new(HashMap::new())),
        })
    }

    /// Return a reference to the database as a trait object, enabling
    /// backend-agnostic code.  Returns `None` only if the database failed
    /// to open (should not happen in practice).
    pub fn storage(&self) -> Option<&dyn Storage> {
        self.db.as_ref().map(|d| d as &dyn Storage)
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

    pub async fn find_worker_for_user(&self, user_id: &str) -> Option<(String, mpsc::Sender<BrainMessage>)> {
        let workers = self.workers.read().await;
        workers
            .iter()
            .find(|(_, w)| {
                w.user_id == user_id && {
                    let has_usable = w.available_providers.iter()
                        .any(|p| !w.disabled_providers.contains(p));
                    has_usable || w.available_providers.is_empty()
                }
            })
            .map(|(id, w)| (id.clone(), w.tx.clone()))
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
        let (worker_id, worker_tx) = self
            .find_worker_for_user(user_id)
            .await
            .ok_or_else(|| {
                "no connected worker — run `npx cortex connect` in your environment".to_string()
            })?;

        let attempt_id = Uuid::new_v4().to_string();
        let lease_gen = 1;
        let now = chrono::Utc::now().timestamp_millis();
        let lease_deadline_ms = now + 600_000;

        // Register run + step in DB so worker ownership verification passes
        let (run_id, step_id) = if let Some(db) = &self.db {
            let rid = db.create_run(user_id, &task.objective, "chat", &[]);
            let sid = db.create_step(
                &rid, "chat",
                &format!("{:?}", decision.tier),
                &format!("{:?}", task.risk),
                &task.objective,
            );
            db.lease_step(&sid, &worker_id, lease_deadline_ms);
            (rid, sid)
        } else {
            (Uuid::new_v4().to_string(), Uuid::new_v4().to_string())
        };

        self.step_senders
            .write()
            .await
            .insert(step_id.clone(), result_tx);

        // Assemble context from previous step artifacts in this run
        let context = self
            .context_bus
            .assemble_context(self.db.as_ref(), &run_id, &task.objective, None)
            .await;

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
                context,
                delegation: None,
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

    // --- Social DM subscriber management (Wave 8b) ---

    pub async fn subscribe_dm(&self, conversation_id: &str, sub: DmSubscriber) {
        let mut subs = self.dm_subscribers.write().await;
        // Avoid duplicate registration of the same socket for one conversation.
        let list = subs.entry(conversation_id.to_string()).or_default();
        list.retain(|s| s.id != sub.id);
        list.push(sub);
        tracing::debug!("dm: subscribed to conversation {conversation_id}");
    }

    pub async fn unsubscribe_dm(&self, conversation_id: &str, id: DmSubscriberId) {
        let mut subs = self.dm_subscribers.write().await;
        if let Some(list) = subs.get_mut(conversation_id) {
            list.retain(|s| s.id != id);
            if list.is_empty() {
                subs.remove(conversation_id);
            }
        }
        tracing::debug!("dm: unsubscribed from conversation {conversation_id}");
    }

    /// Push a new DM to all WebSocket subscribers of `conversation_id`.
    /// Payload shape: `{ type: "message", conversationId, message }`.
    pub async fn broadcast_dm_message(&self, conversation_id: &str, message: serde_json::Value) {
        let event = serde_json::json!({
            "type": "message",
            "conversationId": conversation_id,
            "message": message,
        });

        let mut closed = Vec::new();
        {
            let subs = self.dm_subscribers.read().await;
            if let Some(list) = subs.get(conversation_id) {
                for sub in list {
                    if sub.tx.try_send(event.clone()).is_err() {
                        closed.push(sub.id);
                    }
                }
            }
        }

        if !closed.is_empty() {
            let mut subs = self.dm_subscribers.write().await;
            if let Some(list) = subs.get_mut(conversation_id) {
                list.retain(|s| !closed.contains(&s.id));
                if list.is_empty() {
                    subs.remove(conversation_id);
                }
            }
        }
    }

    // --- Mission Control subscriber management ---

    pub async fn subscribe_mc(
        &self,
        user_id: &str,
        id: SubscriberId,
        tx: mpsc::Sender<MissionControlEvent>,
    ) {
        let mut subs = self.mc_subscribers.write().await;
        subs.entry(user_id.to_string())
            .or_default()
            .push(McSubscriber { id, tx });
        tracing::debug!("mc: subscribed {id:?} for user {user_id}");
    }

    pub async fn unsubscribe_mc(&self, user_id: &str, id: SubscriberId) {
        let mut subs = self.mc_subscribers.write().await;
        if let Some(list) = subs.get_mut(user_id) {
            list.retain(|s| s.id != id);
            if list.is_empty() {
                subs.remove(user_id);
            }
        }
        tracing::debug!("mc: unsubscribed {id:?} for user {user_id}");
    }

    /// Emit a Mission Control event to all subscribers for a given user.
    /// Drops subscribers whose channels are closed.
    pub async fn emit_mc_event(&self, user_id: &str, event: MissionControlEvent) {
        let subs = self.mc_subscribers.read().await;
        if let Some(list) = subs.get(user_id) {
            let mut closed = Vec::new();
            for sub in list {
                if sub.tx.try_send(event.clone()).is_err() {
                    // Channel full or closed — mark for removal
                    closed.push(sub.id);
                }
            }
            drop(subs);

            if !closed.is_empty() {
                let mut subs = self.mc_subscribers.write().await;
                if let Some(list) = subs.get_mut(user_id) {
                    list.retain(|s| !closed.contains(&s.id));
                    if list.is_empty() {
                        subs.remove(user_id);
                    }
                }
            }
        }
    }

    /// Graceful shutdown: cancel active steps, wait for workers, persist state.
    pub async fn shutdown(&self) {
        tracing::info!("initiating graceful shutdown");
        self.is_shutting_down.store(true, Ordering::SeqCst);

        // Send CancelStep to all workers for their active steps
        let workers = self.workers.read().await;
        let worker_count = workers.len();
        tracing::info!("shutting down {worker_count} connected worker(s)");

        for (worker_id, worker) in workers.iter() {
            // Look up active steps from DB if available
            let active_steps: Vec<String> = if let Some(db) = &self.db {
                db.get_worker_active_steps(worker_id)
            } else {
                Vec::new()
            };

            for step_id in &active_steps {
                tracing::info!("cancelling step {step_id} on worker {worker_id}");
                let _ = worker.tx.send(BrainMessage::CancelStep {
                    step_id: step_id.clone(),
                    reason: "server shutting down".to_string(),
                }).await;
            }
        }
        drop(workers);

        // Wait up to 30 seconds for workers to disconnect
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let count = self.workers.read().await.len();
            if count == 0 {
                tracing::info!("all workers disconnected cleanly");
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                tracing::warn!("{count} worker(s) still connected after 30s timeout, proceeding with shutdown");
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }

        // Persist final state
        if let Some(db) = &self.db {
            // Mark any remaining leased steps as cancelled
            let remaining_steps: Vec<String> = self.step_senders.read().await.keys().cloned().collect();
            for step_id in &remaining_steps {
                tracing::info!("marking in-flight step {step_id} as cancelled in DB");
                db.cancel_assigned_step(step_id, "server shutdown");
            }
        }

        // Persist Soma state on shutdown
        if let Some(heart) = &self.soma_heart {
            heart.persist_heartbeats();
            heart.persist_spend_logs();
            heart.persist_invocation_counts();
        }

        let final_workers = self.workers.read().await.len();
        let final_steps = self.step_senders.read().await.len();
        tracing::info!(
            "shutdown complete: workers_remaining={final_workers}, steps_remaining={final_steps}"
        );
    }
}
