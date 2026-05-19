use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::IntoResponse;
use tokio::sync::mpsc;
use uuid::Uuid;

use cortex_core::protocol::{BrainMessage, WorkerMessage, PROTOCOL_VERSION};
use cortex_engine::captain::SchedulerEvent;

use crate::clerk;
use crate::state::AppState;

const GRACE_PERIOD_MS: i64 = 60_000;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_worker_connection(socket, state))
}

async fn handle_worker_connection(mut socket: WebSocket, state: Arc<AppState>) {
    let worker_id = format!("w-{}", &Uuid::new_v4().to_string()[..12]);
    let session_id = Uuid::new_v4().to_string();
    tracing::info!("worker websocket connected: session={session_id}, worker={worker_id}");

    let welcome = serde_json::to_string(&BrainMessage::Welcome {
        session_id: session_id.clone(),
        worker_id: worker_id.clone(),
        protocol_version: PROTOCOL_VERSION,
    })
    .unwrap();

    if socket.send(Message::Text(welcome.into())).await.is_err() {
        return;
    }

    let (brain_tx, mut brain_rx) = mpsc::channel::<BrainMessage>(32);

    let mut registered = false;
    let mut authed_user_id: Option<String> = None;

    loop {
        tokio::select! {
            Some(msg) = brain_rx.recv() => {
                let json = serde_json::to_string(&msg).unwrap();
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }

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
                        handle_worker_msg(
                            &state, &worker_id, &session_id,
                            &mut registered, &mut authed_user_id,
                            &brain_tx, worker_msg
                        ).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => continue,
                }
            }
        }
    }

    if registered {
        let user_id = authed_user_id.as_deref().unwrap_or("local");
        tracing::info!("worker disconnected: {worker_id} (user={user_id})");

        if let Some(db) = &state.db {
            db.disconnect_worker_session(&session_id);
            db.set_worker_status(&worker_id, "disconnected");

            let grace_deadline = chrono::Utc::now().timestamp_millis() + GRACE_PERIOD_MS;
            db.set_worker_grace_deadline(&worker_id, grace_deadline);
            tracing::info!(
                "worker {worker_id} grace period: {}s",
                GRACE_PERIOD_MS / 1000
            );
        }

        state.unregister_worker(&worker_id).await;
        state
            .emit_scheduler_event(SchedulerEvent::WorkerDisconnected {
                worker_id: worker_id.clone(),
            })
            .await;
    }
}

async fn handle_worker_msg(
    state: &AppState,
    worker_id: &str,
    session_id: &str,
    registered: &mut bool,
    authed_user_id: &mut Option<String>,
    brain_tx: &mpsc::Sender<BrainMessage>,
    msg: WorkerMessage,
) {
    match msg {
        WorkerMessage::Register {
            token,
            protocol_version,
            providers,
            workspace_dir,
            repos,
        } => {
            // Authenticate worker via JWT if Clerk is configured
            let user_id = match authenticate_worker(state, &token).await {
                Ok(uid) => uid,
                Err(e) => {
                    tracing::warn!("worker auth failed: {e}");
                    let err_msg = serde_json::to_string(&serde_json::json!({
                        "type": "error",
                        "code": "auth_failed",
                        "message": e
                    }))
                    .unwrap();
                    let _ = brain_tx
                        .send(BrainMessage::CancelStep {
                            step_id: "auth".into(),
                            reason: err_msg,
                        })
                        .await;
                    return;
                }
            };

            *authed_user_id = Some(user_id.clone());

            let provider_ids: Vec<_> = providers.iter().map(|p| p.provider).collect();

            tracing::info!(
                "worker registered: id={worker_id}, user={user_id}, protocol=v{protocol_version}, \
                 providers={:?}, dir={workspace_dir}, repos={}",
                provider_ids,
                repos.len()
            );

            *registered = true;

            // Persist to DB
            if let Some(db) = &state.db {
                db.register_worker(worker_id, &user_id);
                db.create_worker_session(session_id, worker_id);

                for claim in &providers {
                    db.upsert_provider_capability(
                        worker_id,
                        &user_id,
                        &claim.provider.to_string(),
                        claim.cli_version.as_deref(),
                    );
                }
            }

            state
                .register_worker(
                    worker_id.to_string(),
                    user_id,
                    provider_ids,
                    brain_tx.clone(),
                )
                .await;

            state
                .emit_scheduler_event(SchedulerEvent::WorkerConnected {
                    worker_id: worker_id.to_string(),
                })
                .await;
        }

        WorkerMessage::StepStarted {
            message_id,
            step_id,
            provider,
            model,
            ..
        } => {
            tracing::info!("step {step_id} started: {provider}/{model} (msg={message_id})");
        }

        WorkerMessage::StepOutput { step_id, line, .. } => {
            tracing::debug!("step {step_id}: {}", &line[..line.len().min(80)]);
        }

        WorkerMessage::StepCompleted {
            message_id,
            step_id,
            lease_gen,
            exit_code,
            output,
            base_commit,
            head_commit,
            branch,
            ..
        } => {
            tracing::info!(
                "step {step_id} completed (exit {exit_code}, files_changed={}, branch={:?}) msg={message_id}",
                output.files_changed.len(),
                branch,
            );

            let files_json = serde_json::to_string(&output.files_changed).ok();
            if let Some(db) = &state.db {
                db.complete_step(
                    &step_id,
                    lease_gen,
                    Some(&output.summary),
                    files_json.as_deref(),
                    base_commit.as_deref(),
                    head_commit.as_deref(),
                );
                db.complete_attempt(&step_id, lease_gen);

                // If this step produced a branch, record it on the run
                if let Some(ref branch_name) = branch {
                    if let Some(run_id) = db.get_step_run_id(&step_id) {
                        db.record_run_branch(&run_id, branch_name);
                    }
                }

                // Record usage for pressure tracking
                record_step_usage(db, &step_id, lease_gen, authed_user_id.as_deref());

                if let Some(run_id) = db.get_step_run_id(&step_id) {
                    state
                        .emit_scheduler_event(SchedulerEvent::StepCompleted {
                            run_id,
                            step_id: step_id.clone(),
                        })
                        .await;
                }
            }
        }

        WorkerMessage::StepFailed {
            message_id,
            step_id,
            lease_gen,
            failure,
            ..
        } => {
            tracing::warn!(
                "step {step_id} failed: {:?} msg={message_id}",
                failure.kind
            );

            let error_msg = failure.stderr_excerpt.as_deref().unwrap_or("unknown error");
            let kind_str = format!("{:?}", failure.kind);
            if let Some(db) = &state.db {
                db.fail_step(&step_id, lease_gen, error_msg, Some(&kind_str));
                db.fail_attempt(&step_id, lease_gen, Some(&kind_str), Some(error_msg));

                // Record usage even on failure (still consumed tokens/time)
                record_step_usage(db, &step_id, lease_gen, authed_user_id.as_deref());

                if let Some(run_id) = db.get_step_run_id(&step_id) {
                    state
                        .emit_scheduler_event(SchedulerEvent::StepFailed {
                            run_id,
                            step_id: step_id.clone(),
                        })
                        .await;
                }
            }
        }

        WorkerMessage::LeaseRenew { step_id, lease_gen } => {
            if let Some(db) = &state.db {
                // Extend lease by 5 minutes from now
                let new_deadline = chrono::Utc::now().timestamp_millis() + 5 * 60 * 1000;
                let renewed = db.renew_lease(&step_id, lease_gen, new_deadline);
                if renewed {
                    tracing::debug!("lease renewed for step {step_id} gen={lease_gen}");
                } else {
                    tracing::warn!("lease renewal failed for step {step_id} gen={lease_gen} — stale or not leased");
                }
            }
        }

        WorkerMessage::Heartbeat { active_steps } => {
            tracing::debug!("heartbeat: {} active steps", active_steps.len());
            if let Some(db) = &state.db {
                db.update_worker_seen(worker_id);
                db.update_heartbeat(worker_id);
            }
        }

        WorkerMessage::Pong => {}
    }
}

fn record_step_usage(
    db: &crate::db::Database,
    step_id: &str,
    lease_gen: i64,
    user_id: Option<&str>,
) {
    let user_id = user_id.unwrap_or("local");

    if let Some((provider, model, started_at)) = db.get_attempt_provider_model(step_id, lease_gen) {
        let now = chrono::Utc::now().timestamp_millis();
        let duration_ms = now - started_at;

        let tier = if let Some((_, tier_str, _, _)) = db.get_step_details(step_id) {
            tier_str
        } else {
            "execute".to_string()
        };

        db.record_usage(
            user_id,
            &provider,
            &tier,
            &model,
            None,
            None,
            None,
            Some(duration_ms),
        );
    }
}

async fn authenticate_worker(state: &AppState, token: &str) -> Result<String, String> {
    let clerk_secret = match &state.clerk_secret_key {
        Some(key) => key,
        None => {
            // No Clerk configured — local dev mode
            return Ok("local".to_string());
        }
    };

    if token.is_empty() {
        return Err("empty auth token".into());
    }

    // Verify JWT using same JWKS as HTTP endpoints
    let keys = clerk::get_or_refresh_jwks_pub(&state.jwks_cache, clerk_secret, false).await?;

    match clerk::verify_token_pub(token, &keys) {
        Ok(user_id) => Ok(user_id),
        Err(_) => {
            // Retry with fresh JWKS (key rotation)
            let keys =
                clerk::get_or_refresh_jwks_pub(&state.jwks_cache, clerk_secret, true).await?;
            clerk::verify_token_pub(token, &keys)
        }
    }
}
