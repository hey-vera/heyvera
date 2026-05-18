use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use tokio::sync::mpsc;
use uuid::Uuid;

use cortex_core::protocol::{BrainMessage, WorkerMessage};
use cortex_worker::stream::WorkerEvent;

use crate::state::AppState;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_worker_connection(socket, state))
}

async fn handle_worker_connection(mut socket: WebSocket, state: Arc<AppState>) {
    let session_id = Uuid::new_v4().to_string();
    tracing::info!("worker websocket connected: {session_id}");

    let welcome = serde_json::to_string(&BrainMessage::Welcome {
        session_id: session_id.clone(),
    }).unwrap();

    if socket.send(Message::Text(welcome.into())).await.is_err() {
        return;
    }

    // Channel for Brain→Worker messages (tasks to dispatch)
    let (brain_tx, mut brain_rx) = mpsc::channel::<BrainMessage>(32);

    let mut worker_id: Option<String> = None;

    loop {
        tokio::select! {
            // Outbound: Brain sends task to Worker
            Some(msg) = brain_rx.recv() => {
                let json = serde_json::to_string(&msg).unwrap();
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }

            // Inbound: Worker sends results to Brain
            result = socket.recv() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        let worker_msg: WorkerMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                tracing::warn!("invalid worker message: {e}");
                                continue;
                            }
                        };
                        handle_worker_msg(&state, &mut worker_id, &brain_tx, worker_msg).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => continue,
                }
            }
        }
    }

    if let Some(wid) = &worker_id {
        tracing::info!("worker disconnected: {wid}");
        state.unregister_worker(wid).await;
    }
}

async fn handle_worker_msg(
    state: &AppState,
    worker_id: &mut Option<String>,
    brain_tx: &mpsc::Sender<BrainMessage>,
    msg: WorkerMessage,
) {
    match msg {
        WorkerMessage::Register {
            worker_id: wid,
            user_id: uid,
            available_providers,
            workspace_dir,
            ..
        } => {
            tracing::info!(
                "worker registered: id={wid}, user={uid}, providers={:?}, dir={workspace_dir}",
                available_providers
            );
            *worker_id = Some(wid.clone());
            state.register_worker(wid, uid, available_providers, brain_tx.clone()).await;
        }

        WorkerMessage::TaskStarted { task_id, provider, model } => {
            if let Some(tx) = state.get_task_sender(task_id).await {
                let _ = tx.send(WorkerEvent::Started { task_id, provider, model }).await;
            }
        }

        WorkerMessage::TaskOutput { task_id, line } => {
            if let Some(tx) = state.get_task_sender(task_id).await {
                let _ = tx.send(WorkerEvent::Output { task_id, line }).await;
            }
        }

        WorkerMessage::TaskCompleted { task_id, exit_code } => {
            tracing::info!("task {task_id} completed (exit {exit_code})");
            if let Some(tx) = state.get_task_sender(task_id).await {
                let _ = tx.send(WorkerEvent::Completed { task_id, exit_code }).await;
            }
            state.remove_task_sender(task_id).await;
        }

        WorkerMessage::TaskFailed { task_id, error } => {
            tracing::warn!("task {task_id} failed: {error}");
            if let Some(tx) = state.get_task_sender(task_id).await {
                let _ = tx.send(WorkerEvent::Failed { task_id, error }).await;
            }
            state.remove_task_sender(task_id).await;
        }

        WorkerMessage::Heartbeat { .. } | WorkerMessage::Pong => {}
    }
}
