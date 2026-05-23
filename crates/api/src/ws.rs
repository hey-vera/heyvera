use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use tokio::sync::mpsc;
use uuid::Uuid;

use cortex_core::failure::WorkerFailureKind;
use cortex_core::protocol::{BrainMessage, WorkerMessage, PROTOCOL_VERSION};
use cortex_engine::captain::SchedulerEvent;

use crate::clerk;
use crate::mission_control::MissionControlEvent;
use crate::state::{AppState, StepEvent};
use crate::context_flow::{ContextBus, ArtifactKind};

const GRACE_PERIOD_MS: i64 = 60_000;
const REGISTER_TIMEOUT_SECS: u64 = 10;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Response {
    if state.is_shutting_down.load(Ordering::SeqCst) {
        return (StatusCode::SERVICE_UNAVAILABLE, "server is shutting down").into_response();
    }
    ws.on_upgrade(move |socket| handle_worker_connection(socket, state))
        .into_response()
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
    let mut step_run_cache: HashMap<String, String> = HashMap::new();

    // --- Registration timeout: first message must be a valid Register within REGISTER_TIMEOUT_SECS ---
    let first_msg = match tokio::time::timeout(
        Duration::from_secs(REGISTER_TIMEOUT_SECS),
        socket.recv(),
    )
    .await
    {
        Ok(Some(Ok(Message::Text(text)))) => {
            match serde_json::from_str::<WorkerMessage>(&text) {
                Ok(msg @ WorkerMessage::Register { .. }) => Some(msg),
                Ok(_) => {
                    tracing::warn!(
                        "worker {worker_id}: first message was not Register, closing connection"
                    );
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                }
                Err(e) => {
                    tracing::warn!(
                        "worker {worker_id}: invalid first message: {e}, closing connection"
                    );
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                }
            }
        }
        Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
            tracing::info!("worker {worker_id}: disconnected before registration");
            return;
        }
        Ok(Some(Err(e))) => {
            tracing::warn!("worker {worker_id}: socket error before registration: {e}");
            return;
        }
        Ok(_) => {
            tracing::warn!("worker {worker_id}: non-text message before registration, closing");
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
        Err(_) => {
            tracing::warn!(
                "worker {worker_id}: registration timeout ({REGISTER_TIMEOUT_SECS}s), closing connection"
            );
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    // Process the Register message
    if let Some(register_msg) = first_msg {
        handle_worker_msg(
            &state,
            &worker_id,
            &session_id,
            &mut registered,
            &mut authed_user_id,
            &brain_tx,
            register_msg,
            &mut step_run_cache,
        )
        .await;
    }

    // If registration/auth failed, close immediately
    if !registered {
        tracing::warn!("worker {worker_id}: registration failed, closing connection");
        let _ = socket.send(Message::Close(None)).await;
        return;
    }

    // --- Main event loop (only reached after successful registration) ---
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
                            &brain_tx, worker_msg,
                            &mut step_run_cache,
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

        // Emit MC event for worker disconnected
        state
            .emit_mc_event(
                user_id,
                MissionControlEvent::WorkerDisconnected {
                    worker_id: worker_id.clone(),
                },
            )
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
    step_run_cache: &mut HashMap<String, String>,
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

            // Clear any disabled providers from previous sessions (re-auth resets)
            state.clear_disabled_providers(worker_id).await;

            // Capture provider strings before moving provider_ids
            let provider_strings: Vec<String> = provider_ids.iter().map(|p| p.to_string()).collect();

            state
                .register_worker(
                    worker_id.to_string(),
                    user_id.clone(),
                    provider_ids,
                    brain_tx.clone(),
                )
                .await;

            state
                .emit_scheduler_event(SchedulerEvent::WorkerConnected {
                    worker_id: worker_id.to_string(),
                })
                .await;

            // Emit MC event for worker connected
            state
                .emit_mc_event(
                    &user_id,
                    MissionControlEvent::WorkerConnected {
                        worker_id: worker_id.to_string(),
                        providers: provider_strings,
                    },
                )
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

            // Emit MC event
            if let Some(user_id) = authed_user_id.as_deref() {
                let run_id = resolve_run_id(step_run_cache, state, &step_id);
                if let Some(run_id) = run_id {
                    state
                        .emit_mc_event(
                            user_id,
                            MissionControlEvent::StepStarted {
                                run_id,
                                step_id: step_id.clone(),
                                provider: provider.clone(),
                                model: model.clone(),
                            },
                        )
                        .await;
                }
            }
        }

        WorkerMessage::StepOutput { step_id, line, .. } => {
            tracing::debug!("step {step_id}: {}", &line[..line.len().min(80)]);

            // Forward to SSE channel (chat endpoint)
            if let Some(tx) = state.get_step_sender(&step_id).await {
                let _ = tx.send(StepEvent::Output {
                    step_id: step_id.clone(),
                    line: line.clone(),
                }).await;
            }

            // Emit MC event (throttled by the MC connection handler)
            if let Some(user_id) = authed_user_id.as_deref() {
                let run_id = resolve_run_id(step_run_cache, state, &step_id);
                if let Some(run_id) = run_id {
                    state
                        .emit_mc_event(
                            user_id,
                            MissionControlEvent::StepOutput {
                                run_id,
                                step_id: step_id.clone(),
                                line: line.clone(),
                            },
                        )
                        .await;
                }
            }
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
            // Verify this worker owns the step
            if let Some(db) = &state.db {
                if !db.verify_step_worker(&step_id, worker_id) {
                    tracing::warn!(
                        "SECURITY: worker {worker_id} attempted StepCompleted for step {step_id} \
                         which is not assigned to it — dropping message (msg={message_id})"
                    );
                    return;
                }
            }

            tracing::info!(
                "step {step_id} completed (exit {exit_code}, files_changed={}, branch={:?}) msg={message_id}",
                output.files_changed.len(),
                branch,
            );

            let files_json = serde_json::to_string(&output.files_changed).ok();
            let truncated_summary = if output.summary.len() > 2000 {
                format!("{}...[truncated]", &output.summary[..2000])
            } else {
                output.summary.clone()
            };
            if let Some(db) = &state.db {
                let step_updated = db.complete_step(
                    &step_id,
                    lease_gen,
                    Some(&truncated_summary),
                    files_json.as_deref(),
                    base_commit.as_deref(),
                    head_commit.as_deref(),
                );
                if !step_updated {
                    tracing::warn!(
                        "complete_step returned false for step {step_id} lease_gen={lease_gen} — \
                         likely stale lease_gen (step may have been re-leased or already completed)"
                    );
                }
                db.complete_attempt(&step_id, lease_gen);

                // Record usage for pressure tracking
                record_step_usage(db, &step_id, lease_gen, authed_user_id.as_deref(), output.tokens_in, output.tokens_out);

                if let Some(run_id) = resolve_run_id(step_run_cache, state, &step_id) {
                    // If this step produced a branch, record it on the run
                    if let Some(ref branch_name) = branch {
                        db.record_run_branch(&run_id, branch_name);
                    }

                    state
                        .emit_scheduler_event(SchedulerEvent::StepCompleted {
                            run_id: run_id.clone(),
                            step_id: step_id.clone(),
                            cost_estimate: output.cost_estimate,
                        })
                        .await;

                    // Emit MC event
                    if let Some(user_id) = authed_user_id.as_deref() {
                        state
                            .emit_mc_event(
                                user_id,
                                MissionControlEvent::StepCompleted {
                                    run_id: run_id.clone(),
                                    step_id: step_id.clone(),
                                    exit_code,
                                    files_changed: output.files_changed.clone(),
                                    cost_estimate: output.cost_estimate,
                                },
                            )
                            .await;
                    }

                    // Add artifact to Context-Flow Pipeline for future steps
                    let artifact_kind = if exit_code == 0 {
                        // Determine artifact type based on output content
                        if !output.files_changed.is_empty() {
                            ArtifactKind::Code
                        } else if output.summary.to_lowercase().contains("analy") {
                            ArtifactKind::Analysis
                        } else if output.summary.to_lowercase().contains("plan") {
                            ArtifactKind::Plan
                        } else {
                            ArtifactKind::Answer
                        }
                    } else {
                        ArtifactKind::Error
                    };

                    let confidence = if exit_code == 0 { 0.8 } else { 0.1 };

                    let artifact = ContextBus::create_artifact(
                        &step_id,
                        &run_id,
                        artifact_kind,
                        &output.summary,
                        &truncated_summary,
                        output.files_changed.clone(),
                        confidence,
                    );

                    state.context_bus.add_artifact(state.db.as_ref(), artifact).await;

                    tracing::debug!("artifact added to context-flow pipeline for run {run_id}");
                }

                // Vera observes the completed step
                if let Some(user_id) = authed_user_id.as_deref() {
                    let duration_ms = if let Some((_, _, started_at)) = db.get_attempt_provider_model(&step_id, lease_gen) {
                        let now = chrono::Utc::now().timestamp_millis();
                        (now - started_at).max(0) as u64
                    } else {
                        0
                    };
                    state.vera_tracker.record_step_completed(user_id, duration_ms, exit_code, None);
                }
            }

            // Forward to SSE channel (chat endpoint)
            if let Some(tx) = state.get_step_sender(&step_id).await {
                let _ = tx.send(StepEvent::Completed {
                    step_id: step_id.clone(),
                    exit_code,
                }).await;
            }
            state.remove_step_sender(&step_id).await;
        }

        WorkerMessage::StepFailed {
            message_id,
            step_id,
            lease_gen,
            failure,
            ..
        } => {
            // Verify this worker owns the step
            if let Some(db) = &state.db {
                if !db.verify_step_worker(&step_id, worker_id) {
                    tracing::warn!(
                        "SECURITY: worker {worker_id} attempted StepFailed for step {step_id} \
                         which is not assigned to it — dropping message (msg={message_id})"
                    );
                    return;
                }
            }

            tracing::warn!(
                "step {step_id} failed: {:?} msg={message_id}",
                failure.kind
            );

            let error_msg = failure.stderr_excerpt.as_deref().unwrap_or("unknown error");
            let kind_str = format!("{:?}", failure.kind);

            // Classify the failure to detect auth expiry
            let is_auth_expired = matches!(
                failure.kind,
                WorkerFailureKind::CliNotAuthenticated | WorkerFailureKind::CliAuthExpired
            );

            if let Some(db) = &state.db {
                db.fail_step(&step_id, lease_gen, error_msg, Some(&kind_str));
                db.fail_attempt(&step_id, lease_gen, Some(&kind_str), Some(error_msg));

                // Record usage even on failure (still consumed tokens/time)
                record_step_usage(db, &step_id, lease_gen, authed_user_id.as_deref(), None, None);

                if let Some(run_id) = resolve_run_id(step_run_cache, state, &step_id) {
                    state
                        .emit_scheduler_event(SchedulerEvent::StepFailed {
                            run_id: run_id.clone(),
                            step_id: step_id.clone(),
                        })
                        .await;

                    // Emit MC event
                    if let Some(user_id) = authed_user_id.as_deref() {
                        state
                            .emit_mc_event(
                                user_id,
                                MissionControlEvent::StepFailed {
                                    run_id,
                                    step_id: step_id.clone(),
                                    error: error_msg.to_string(),
                                    failure_kind: kind_str.clone(),
                                },
                            )
                            .await;
                    }
                }

                // Vera observes the failed step
                if let Some(user_id) = authed_user_id.as_deref() {
                    state.vera_tracker.record_step_failed(user_id, &kind_str, None);
                }

                // Forward to SSE channel (chat endpoint)
                if let Some(tx) = state.get_step_sender(&step_id).await {
                    let _ = tx.send(StepEvent::Failed {
                        step_id: step_id.clone(),
                        error: error_msg.to_string(),
                    }).await;
                }
                state.remove_step_sender(&step_id).await;

                // Emit ProviderAuthExpired so scheduler disables the provider on this worker
                if is_auth_expired {
                    let provider_name = failure.tool.clone().unwrap_or_else(|| "unknown".to_string());
                    let user_id = authed_user_id.clone().unwrap_or_else(|| "local".to_string());
                    tracing::warn!(
                        "provider auth expired: provider={provider_name}, worker={worker_id}, user={user_id}"
                    );
                    state
                        .emit_scheduler_event(SchedulerEvent::ProviderAuthExpired {
                            worker_id: worker_id.to_string(),
                            provider: provider_name,
                            user_id,
                        })
                        .await;
                }
            }
        }

        WorkerMessage::LeaseRenew { step_id, lease_gen } => {
            // Verify this worker owns the step
            if let Some(db) = &state.db {
                if !db.verify_step_worker(&step_id, worker_id) {
                    tracing::warn!(
                        "SECURITY: worker {worker_id} attempted LeaseRenew for step {step_id} \
                         which is not assigned to it — dropping message"
                    );
                    return;
                }
            }

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

/// Resolve step_id to run_id using a per-connection cache to avoid repeated DB lookups.
/// A step producing 100 output lines would otherwise trigger 100 DB queries with Mutex locks.
fn resolve_run_id(
    cache: &mut HashMap<String, String>,
    state: &AppState,
    step_id: &str,
) -> Option<String> {
    if let Some(cached) = cache.get(step_id) {
        return Some(cached.clone());
    }
    if let Some(db) = &state.db {
        if let Some(rid) = db.get_step_run_id(step_id) {
            cache.insert(step_id.to_string(), rid.clone());
            return Some(rid);
        }
    }
    None
}

fn record_step_usage(
    db: &crate::db::Database,
    step_id: &str,
    lease_gen: i64,
    user_id: Option<&str>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
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
            tokens_in,
            tokens_out,
            Some(duration_ms),
        );
    }
}

async fn authenticate_worker(state: &AppState, token: &str) -> Result<String, String> {
    if token.is_empty() {
        // No Clerk configured — local dev mode
        if state.clerk_secret_key.is_none() {
            return Ok("local".to_string());
        }
        return Err("empty auth token".into());
    }

    // Try Soma delegation first (token is JSON starting with '{')
    if token.starts_with('{') {
        let delegation: soma::delegation::Delegation =
            serde_json::from_str(token).map_err(|e| format!("invalid soma token: {e}"))?;

        let cortex_did = state
            .soma_heart
            .as_ref()
            .map(|h| h.did().to_string())
            .unwrap_or_default();

        let ctx = soma::delegation::InvocationContext {
            invoker_did: delegation.subject_did.clone(),
            audience_did: Some(cortex_did),
            capability: "route:*".into(),
            ..Default::default()
        };

        // Verify issuer is Cortex's heart — reject self-issued delegations
        if let Some(heart) = &state.soma_heart {
            if delegation.issuer_did != heart.did() {
                return Err(format!(
                    "delegation issuer {} is not Cortex heart {}",
                    delegation.issuer_did, heart.did()
                ));
            }
        }

        let result = soma::delegation::verify_delegation(&delegation, &ctx)
            .map_err(|e| format!("soma verification error: {e}"))?;

        if !result.is_valid() {
            return Err(format!("soma delegation invalid: {result:?}"));
        }

        if let Some(heart) = &state.soma_heart {
            heart.record_heartbeat(
                soma::heartbeat::HeartbeatEventType::QueryReceived,
                &serde_json::json!({
                    "type": "worker_connect",
                    "delegation_id": delegation.id,
                    "subject_did": delegation.subject_did,
                })
                .to_string(),
            );
        }

        tracing::info!("worker authenticated via soma delegation: {}", delegation.subject_did);
        return Ok(delegation.subject_did);
    }

    // Fall back to Clerk JWT
    let clerk_secret = match &state.clerk_secret_key {
        Some(key) => key,
        None => {
            return Ok("local".to_string());
        }
    };

    let keys = clerk::get_or_refresh_jwks_pub(&state.jwks_cache, clerk_secret, false).await?;

    match clerk::verify_token_pub(token, &keys) {
        Ok(user_id) => Ok(user_id),
        Err(_) => {
            let keys =
                clerk::get_or_refresh_jwks_pub(&state.jwks_cache, clerk_secret, true).await?;
            clerk::verify_token_pub(token, &keys)
        }
    }
}
