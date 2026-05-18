use std::env;
use std::path::PathBuf;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use cortex_core::protocol::{BrainMessage, WorkerMessage};
use cortex_worker::executor::{detect_available_providers, Executor};
use cortex_worker::stream::WorkerEvent;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".parse().unwrap()))
        .init();

    let brain_url = env::var("CORTEX_BRAIN_URL")
        .unwrap_or_else(|_| "wss://cortex.heyvera.org/api/ws".to_string());

    let user_id = env::var("CORTEX_USER_ID")
        .unwrap_or_else(|_| "local".to_string());

    let token = env::var("CORTEX_TOKEN").unwrap_or_default();

    let workspace_dir = env::current_dir()
        .unwrap_or_else(|_| ".".into())
        .to_string_lossy()
        .to_string();

    let worker_id = format!("worker-{}", &Uuid::new_v4().to_string()[..8]);
    let available_providers = detect_available_providers();

    tracing::info!("cortex worker {worker_id}");
    tracing::info!("user: {user_id}");
    tracing::info!("brain: {brain_url}");
    tracing::info!("workspace: {workspace_dir}");
    tracing::info!(
        "providers: {}",
        if available_providers.is_empty() { "none".to_string() }
        else { available_providers.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(", ") }
    );

    if available_providers.is_empty() {
        tracing::warn!("no CLI providers found — install and authenticate claude or codex first");
    }

    loop {
        tracing::info!("connecting to brain...");
        match connect_and_run(&brain_url, &worker_id, &user_id, &token, &available_providers, &workspace_dir).await {
            Ok(()) => tracing::info!("disconnected"),
            Err(e) => tracing::error!("connection error: {e}"),
        }
        tracing::info!("reconnecting in 5s...");
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
    }
}

async fn connect_and_run(
    url: &str,
    worker_id: &str,
    user_id: &str,
    token: &str,
    available_providers: &[cortex_core::provider::ProviderId],
    workspace_dir: &str,
) -> Result<(), String> {
    let (ws, _) = connect_async(url).await.map_err(|e| format!("connect: {e}"))?;
    let (mut write, mut read) = ws.split();

    tracing::info!("connected");

    // Channel for sending messages to the WebSocket from task threads
    let (out_tx, mut out_rx) = mpsc::channel::<WorkerMessage>(64);

    // Send registration
    let register = WorkerMessage::Register {
        worker_id: worker_id.to_string(),
        user_id: user_id.to_string(),
        token: token.to_string(),
        available_providers: available_providers.to_vec(),
        workspace_dir: workspace_dir.to_string(),
    };
    let json = serde_json::to_string(&register).unwrap();
    write.send(Message::Text(json.into())).await.map_err(|e| format!("send: {e}"))?;
    tracing::info!("registered");

    let ws_dir = workspace_dir.to_string();

    loop {
        tokio::select! {
            // Forward outbound messages (task results) to WebSocket
            Some(msg) = out_rx.recv() => {
                let json = serde_json::to_string(&msg).unwrap();
                if write.send(Message::Text(json.into())).await.is_err() {
                    return Err("write failed".to_string());
                }
            }

            // Receive inbound messages (tasks) from Brain
            result = read.next() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        let brain_msg: BrainMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                tracing::warn!("bad message: {e}");
                                continue;
                            }
                        };

                        match brain_msg {
                            BrainMessage::Welcome { session_id } => {
                                tracing::info!("session: {session_id}");
                            }
                            BrainMessage::ExecuteTask { task, decision } => {
                                tracing::info!("task {}: {}", task.id, task.objective);
                                let out = out_tx.clone();
                                let dir = PathBuf::from(&ws_dir);
                                tokio::spawn(async move {
                                    execute_and_report(task, decision, dir, out).await;
                                });
                            }
                            BrainMessage::CancelTask { task_id } => {
                                tracing::info!("cancel {task_id} (not implemented)");
                            }
                            BrainMessage::Ping => {
                                let pong = serde_json::to_string(&WorkerMessage::Pong).unwrap();
                                let _ = write.send(Message::Text(pong.into())).await;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = write.send(Message::Pong(data)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(()),
                    Some(Err(e)) => return Err(format!("ws: {e}")),
                    _ => {}
                }
            }
        }
    }
}

async fn execute_and_report(
    task: cortex_core::task::TaskContract,
    decision: cortex_core::routing::RoutingDecision,
    dir: PathBuf,
    out: mpsc::Sender<WorkerMessage>,
) {
    let (tx, mut rx) = mpsc::channel::<WorkerEvent>(64);

    let task_clone = task.clone();
    let decision_clone = decision.clone();

    tokio::spawn(async move {
        let _ = Executor::execute(&task_clone, &decision_clone, tx, Some(dir.as_path())).await;
    });

    while let Some(event) = rx.recv().await {
        let msg = match event {
            WorkerEvent::Started { task_id, provider, model } =>
                WorkerMessage::TaskStarted { task_id, provider, model },
            WorkerEvent::Output { task_id, line } =>
                WorkerMessage::TaskOutput { task_id, line },
            WorkerEvent::Completed { task_id, exit_code } =>
                WorkerMessage::TaskCompleted { task_id, exit_code },
            WorkerEvent::Failed { task_id, error } =>
                WorkerMessage::TaskFailed { task_id, error },
        };
        if out.send(msg).await.is_err() {
            break;
        }
    }
}
