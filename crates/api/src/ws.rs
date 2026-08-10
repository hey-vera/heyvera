use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use tokio::sync::mpsc;
use uuid::Uuid;

use cortex_core::failure::WorkerFailureKind;
use cortex_core::protocol::{BrainMessage, PROTOCOL_VERSION, StepOutput, WorkerMessage};
use cortex_core::routing::RiskLevel;
use cortex_core::task::TaskContract;
use cortex_engine::captain::SchedulerEvent;
use cortex_engine::verifier::{
    CheckEvidence as VerifierCheckEvidence, CheckStatus, StructuredStepEvidence, VerifierInput,
    VerifierVerdict, VerifierWorkContract, verify_step,
};

use crate::clerk;
use crate::context_flow::{ArtifactKind, ContextBus};
use crate::mission_control::MissionControlEvent;
use crate::state::{AppState, StepEvent};

const GRACE_PERIOD_MS: i64 = 60_000;
const REGISTER_TIMEOUT_SECS: u64 = 10;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
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
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<WorkerMessage>(&text) {
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
        },
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
            let provider_strings: Vec<String> =
                provider_ids.iter().map(|p| p.to_string()).collect();

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
            lease_gen,
            provider,
            model,
            execution_job,
            ..
        } => {
            tracing::info!("step {step_id} started: {provider}/{model} (msg={message_id})");
            if let Some(db) = &state.db {
                if !db.verify_step_worker(&step_id, worker_id) {
                    tracing::warn!(
                        "SECURITY: worker {worker_id} attempted StepStarted for step {step_id} \
                         which is not assigned to it — dropping message (msg={message_id})"
                    );
                    return;
                }
                if !db.start_step(&step_id, lease_gen) {
                    tracing::warn!(
                        "start_step returned false for step {step_id} lease_gen={lease_gen} — \
                         step may already be terminal or stale"
                    );
                }

                // Provenance for the receipt: image, isolation class, resource
                // profile, network policy, model identity, budgets. Recorded
                // after the worker-authenticity check above, so an unassigned
                // worker cannot write a job row.
                match &execution_job {
                    Some(job) => {
                        let run_id = resolve_run_id(step_run_cache, state, &step_id)
                            .unwrap_or_default();
                        if !db.record_execution_job(&run_id, job) {
                            // Idempotent on (attempt_id, lease_gen): a
                            // resubmission is the same logical execution.
                            tracing::debug!(
                                step_id = %step_id,
                                attempt_id = %job.attempt_id,
                                "execution job already recorded for this attempt"
                            );
                        }
                    }
                    // A worker that predates the job field. Recorded as absent
                    // rather than reconstructed — a receipt that guesses its
                    // own provenance is worse than one that admits it has none.
                    None => tracing::warn!(
                        step_id = %step_id,
                        "worker reported no execution job; provenance for this attempt is unavailable"
                    ),
                }
            }

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
                let _ = tx
                    .send(StepEvent::Output {
                        step_id: step_id.clone(),
                        line: line.clone(),
                    })
                    .await;
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
            attempt_id,
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
            let mut completion_accepted = false;
            let mut completion_error = "step failed before verification".to_string();
            let mut step_transitioned = false;
            if let Some(db) = &state.db {
                // Record usage for pressure tracking
                record_step_usage(
                    db,
                    &step_id,
                    lease_gen,
                    authed_user_id.as_deref(),
                    output.tokens_in,
                    output.tokens_out,
                );

                let resolved_run_id = resolve_run_id(step_run_cache, state, &step_id);
                let mut verified_success = exit_code == 0;
                let mut verifier_failure = String::new();

                if let Some(run_id) = resolved_run_id.as_deref() {
                    let (
                        verifier_status,
                        verifier_verdict,
                        verifier_diagnostic,
                        evidence_json,
                        report_passed,
                    ) = verify_worker_completion(
                        db,
                        run_id,
                        &step_id,
                        &attempt_id,
                        lease_gen,
                        worker_id,
                        exit_code,
                        &output,
                        base_commit.as_deref(),
                        head_commit.as_deref(),
                        branch.as_deref(),
                        &truncated_summary,
                        &message_id,
                    );

                    verified_success = report_passed;
                    if !report_passed {
                        verifier_failure = verifier_diagnostic;
                    }

                    db.record_verifier_report(
                        &step_id,
                        run_id,
                        lease_gen,
                        Some(worker_id),
                        "engine_verifier",
                        &verifier_status,
                        &verifier_verdict,
                        &evidence_json,
                    );
                } else {
                    verifier_failure =
                        "verifier could not resolve run for completed step".to_string();
                    verified_success = false;
                }

                if verified_success {
                    step_transitioned = db.deliver_step(
                        &step_id,
                        &attempt_id,
                        lease_gen,
                        Some(&truncated_summary),
                        files_json.as_deref(),
                        base_commit.as_deref(),
                        head_commit.as_deref(),
                    );
                    if !step_transitioned {
                        tracing::warn!(
                            "deliver_step returned false for step {step_id} lease_gen={lease_gen} — \
                             likely stale lease_gen (step may have been re-leased or already delivered)"
                        );
                        completion_error =
                            "stale worker completion ignored: step is no longer leased to this attempt"
                                .to_string();
                    } else {
                        db.deliver_attempt(&step_id, lease_gen);

                        // The step is `delivered`: a tree exists and nothing
                        // has been checked. It is not done, and nothing
                        // downstream may treat it as done.
                        //
                        // Reaching this branch means deliver_step's CAS on
                        // lease_gen held, so this delivery is the live one — a
                        // superseded attempt never gets here and so can never
                        // bill. `lease_gen` is the attempt discriminator: it is
                        // already the token the step machine uses to mean "which
                        // try at this step".
                        //
                        // Spawned rather than awaited because checks run in a
                        // container and the completion handler must not sit on
                        // the websocket for container time. The task opens its
                        // own database handle: AppState holds `Database` by
                        // value and this function borrows it, so nothing here
                        // can be moved into a task.
                        //
                        // KNOWN GAP, closed by the durable verifier (PR B): if
                        // this process dies between the `verifying` transition
                        // and the verdict, the step sits in `verifying` with
                        // nothing to resume it. There is deliberately no
                        // timeout here — a timeout that invents a verdict is
                        // the same fault as trusting the worker, one layer
                        // down.
                        if let (Some(run_id), Some(head)) =
                            (resolved_run_id.clone(), head_commit.clone())
                        {
                            if db.begin_verifying_step(&step_id, &attempt_id, lease_gen) {
                                let facts = crate::verification_driver::DeliveryFacts {
                                    run_id,
                                    step_id: step_id.clone(),
                                    attempt_id: attempt_id.clone(),
                                    attempt: lease_gen,
                                    workspace_dir: state.workspace_dir.clone(),
                                    head_commit: head,
                                    // No per-step price is persisted anywhere
                                    // yet, so the verdict is recorded and the
                                    // ledger is left alone. Inventing a price
                                    // is never right.
                                    quoted_credits: None,
                                };
                                let db_path = crate::state::cortex_db_path(&state.workspace_dir);
                                tokio::spawn(async move {
                                    let db = crate::db::Database::open(&db_path);
                                    match crate::check_runner::ContainerCheckRunner::new(
                                        crate::verification_driver::runner_image(),
                                    ) {
                                        Ok(runner) => {
                                            crate::verification_driver::verify_delivery(
                                                &db, &runner, &facts,
                                            )
                                            .await;
                                        }
                                        Err(e) => {
                                            // We cannot grade it. That is our
                                            // failure, so the step is
                                            // inconclusive — never a pass, and
                                            // never a failure charged to the
                                            // customer.
                                            tracing::error!(
                                                error = %e,
                                                "no container runner available; delivery is inconclusive"
                                            );
                                            db.record_verification_outcome(
                                                &facts.step_id,
                                                &facts.attempt_id,
                                                facts.attempt,
                                                "inconclusive",
                                                Some("no container runner available"),
                                            );
                                        }
                                    }
                                });
                            }
                        } else {
                            // No run or no commit means there is nothing to
                            // grade against. The step stays `delivered` rather
                            // than being promoted, which is the honest state.
                            tracing::warn!(
                                step_id = %step_id,
                                "delivered with no resolvable run or head commit; \
                                 nothing to verify against, step stays delivered"
                            );
                        }
                    }
                } else {
                    if verifier_failure.is_empty() {
                        verifier_failure = "verifier rejected worker completion".to_string();
                    }
                    completion_error = verifier_failure.clone();
                    db.record_failed_step_output(
                        &step_id,
                        lease_gen,
                        Some(&truncated_summary),
                        files_json.as_deref(),
                        base_commit.as_deref(),
                        head_commit.as_deref(),
                    );
                    step_transitioned = db.fail_step(
                        &step_id,
                        lease_gen,
                        &verifier_failure,
                        Some("VerifierRejected"),
                    );
                    if step_transitioned {
                        db.fail_attempt(
                            &step_id,
                            lease_gen,
                            Some("VerifierRejected"),
                            Some(&verifier_failure),
                        );
                    } else {
                        tracing::warn!(
                            "fail_step returned false for verifier-rejected step {step_id} lease_gen={lease_gen} — \
                             likely stale lease_gen (step may have been re-leased or already completed)"
                        );
                        completion_error =
                            "stale verifier rejection ignored: step is no longer leased to this attempt"
                                .to_string();
                    }
                }
                completion_accepted = verified_success && step_transitioned;

                if step_transitioned {
                    if let Some(run_id) = resolved_run_id {
                        if verified_success {
                            if let Some(ref branch_name) = branch {
                                db.record_run_branch(&run_id, branch_name);
                            }
                        }

                        if verified_success {
                            state
                                .emit_scheduler_event(SchedulerEvent::StepDelivered {
                                    run_id: run_id.clone(),
                                    step_id: step_id.clone(),
                                    cost_estimate: output.cost_estimate,
                                })
                                .await;
                        } else {
                            state
                                .emit_scheduler_event(SchedulerEvent::StepFailed {
                                    run_id: run_id.clone(),
                                    step_id: step_id.clone(),
                                })
                                .await;
                        }

                        if let Some(user_id) = authed_user_id.as_deref() {
                            if verified_success {
                                state
                                    .emit_mc_event(
                                        user_id,
                                        MissionControlEvent::StepDelivered {
                                            run_id: run_id.clone(),
                                            step_id: step_id.clone(),
                                            exit_code,
                                            files_changed: output.files_changed.clone(),
                                            cost_estimate: output.cost_estimate,
                                        },
                                    )
                                    .await;
                            } else {
                                state
                                    .emit_mc_event(
                                        user_id,
                                        MissionControlEvent::StepFailed {
                                            run_id: run_id.clone(),
                                            step_id: step_id.clone(),
                                            error: verifier_failure.clone(),
                                            failure_kind: "VerifierRejected".to_string(),
                                        },
                                    )
                                    .await;
                            }
                        }

                        let artifact_kind = if verified_success {
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

                        // A delivered artifact carries the worker's own account
                        // of its work, and nothing has checked it. It is still
                        // the best context a downstream step has, so it is kept
                        // — but it cannot claim the confidence of a verified
                        // result. Raising it is the verifier's job, once there
                        // is a verdict to raise it on.
                        let confidence = if verified_success { 0.5 } else { 0.1 };
                        let artifact = ContextBus::create_artifact(
                            &step_id,
                            &run_id,
                            artifact_kind,
                            &output.summary,
                            &truncated_summary,
                            output.files_changed.clone(),
                            confidence,
                        );

                        state
                            .context_bus
                            .add_artifact(state.db.as_ref(), artifact)
                            .await;

                        tracing::debug!("artifact added to context-flow pipeline for run {run_id}");
                    }

                    if let Some(user_id) = authed_user_id.as_deref() {
                        if !verified_success {
                            state.vera_tracker.record_step_failed(
                                user_id,
                                "VerifierRejected",
                                None,
                            );
                        }
                        // No success interaction is recorded on delivery.
                        // `record_step_completed` derives its outcome from the
                        // worker's exit code, which is precisely the signal
                        // invariant 6 forbids from improving a score.
                        //
                        // KNOWN GAP: it is not recorded from the verdict path
                        // either. `VeraTracker` lives in `AppState` by value
                        // and cannot be moved into the spawned verifier task,
                        // so PR A suspends the positive signal rather than
                        // crediting unverified work. PR B's durable verifier
                        // restores it against a real verdict.
                    }
                }
            }

            // Forward to SSE channel (chat endpoint)
            if let Some(tx) = state.get_step_sender(&step_id).await {
                if completion_accepted {
                    let _ = tx
                        .send(StepEvent::Completed {
                            step_id: step_id.clone(),
                            exit_code,
                        })
                        .await;
                } else {
                    let _ = tx
                        .send(StepEvent::Failed {
                            step_id: step_id.clone(),
                            error: completion_error,
                        })
                        .await;
                }
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

            tracing::warn!("step {step_id} failed: {:?} msg={message_id}", failure.kind);

            let error_msg = failure.stderr_excerpt.as_deref().unwrap_or("unknown error");
            let kind_str = format!("{:?}", failure.kind);
            let is_cancelled = matches!(failure.kind, WorkerFailureKind::Cancelled);

            // Classify the failure to detect auth expiry
            let is_auth_expired = matches!(
                failure.kind,
                WorkerFailureKind::CliNotAuthenticated | WorkerFailureKind::CliAuthExpired
            );

            if let Some(db) = &state.db {
                let step_transitioned = if is_cancelled {
                    db.cancel_step(&step_id, lease_gen, error_msg)
                } else {
                    db.fail_step(&step_id, lease_gen, error_msg, Some(&kind_str))
                };
                if !step_transitioned {
                    tracing::warn!(
                        "terminal failure transition returned false for step {step_id} lease_gen={lease_gen} — \
                         likely stale lease_gen (step may have been re-leased or already completed)"
                    );
                    if let Some(tx) = state.get_step_sender(&step_id).await {
                        let _ = tx
                            .send(StepEvent::Failed {
                                step_id: step_id.clone(),
                                error: "stale worker failure ignored: step is no longer leased to this attempt".to_string(),
                            })
                            .await;
                    }
                    state.remove_step_sender(&step_id).await;
                    return;
                }
                db.fail_attempt(&step_id, lease_gen, Some(&kind_str), Some(error_msg));

                // Record usage even on failure (still consumed tokens/time)
                record_step_usage(
                    db,
                    &step_id,
                    lease_gen,
                    authed_user_id.as_deref(),
                    None,
                    None,
                );

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
                    state
                        .vera_tracker
                        .record_step_failed(user_id, &kind_str, None);
                }

                // Forward to SSE channel (chat endpoint)
                if let Some(tx) = state.get_step_sender(&step_id).await {
                    let _ = tx
                        .send(StepEvent::Failed {
                            step_id: step_id.clone(),
                            error: error_msg.to_string(),
                        })
                        .await;
                }
                state.remove_step_sender(&step_id).await;

                // Emit ProviderAuthExpired so scheduler disables the provider on this worker
                if is_auth_expired {
                    let provider_name = failure
                        .tool
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string());
                    let user_id = authed_user_id
                        .clone()
                        .unwrap_or_else(|| "local".to_string());
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

        WorkerMessage::StepBlocked {
            message_id,
            step_id,
            attempt_id,
            lease_gen,
            blocked,
        } => {
            if let Some(db) = &state.db {
                if !db.verify_step_worker(&step_id, worker_id) {
                    tracing::warn!(
                        "SECURITY: worker {worker_id} attempted StepBlocked for step {step_id} \
                         which is not assigned to it — dropping message (msg={message_id})"
                    );
                    return;
                }
            }

            // The worker refused to execute because it could not establish the
            // isolation the job required. That is our infrastructure failing,
            // not the customer's step, so it is recorded as `execution_failed`
            // and never as `failed`. Nothing is charged, and no bandit learns
            // that a provider did badly — it never ran.
            tracing::error!(
                step_id = %step_id,
                reason = %blocked.reason.as_str(),
                detail = %blocked.detail,
                "worker refused to execute; the sandbox could not be established"
            );

            if let Some(db) = &state.db {
                let reason = blocked.to_string();
                let transitioned =
                    db.record_execution_failure(&step_id, &attempt_id, lease_gen, &reason);
                if !transitioned {
                    tracing::warn!(
                        "execution failure did not apply to step {step_id} lease_gen={lease_gen} — \
                         likely a stale attempt"
                    );
                }
                db.fail_attempt(
                    &step_id,
                    lease_gen,
                    Some(blocked.reason.as_str()),
                    Some(&reason),
                );

                if transitioned {
                    if let Some(run_id) = resolve_run_id(step_run_cache, state, &step_id) {
                        state
                            .emit_scheduler_event(SchedulerEvent::StepFailed {
                                run_id: run_id.clone(),
                                step_id: step_id.clone(),
                            })
                            .await;

                        if let Some(user_id) = authed_user_id.as_deref() {
                            state
                                .emit_mc_event(
                                    user_id,
                                    MissionControlEvent::StepFailed {
                                        run_id,
                                        step_id: step_id.clone(),
                                        error: reason.clone(),
                                        // Named for what it is. An operator
                                        // reading this needs to know the cause
                                        // is theirs to fix, not the task's.
                                        failure_kind: "ExecutionBlocked".to_string(),
                                    },
                                )
                                .await;
                        }
                    }
                }
            }

            if let Some(tx) = state.get_step_sender(&step_id).await {
                let _ = tx
                    .send(StepEvent::Failed {
                        step_id: step_id.clone(),
                        error: blocked.to_string(),
                    })
                    .await;
            }
            state.remove_step_sender(&step_id).await;
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
                    tracing::warn!(
                        "lease renewal failed for step {step_id} gen={lease_gen} — stale or not leased"
                    );
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

fn verify_worker_completion(
    db: &crate::db::Database,
    run_id: &str,
    step_id: &str,
    attempt_id: &str,
    lease_gen: i64,
    worker_id: &str,
    exit_code: i32,
    output: &StepOutput,
    base_commit: Option<&str>,
    head_commit: Option<&str>,
    branch: Option<&str>,
    truncated_summary: &str,
    message_id: &str,
) -> (String, String, String, String, bool) {
    let persisted_contract = db.get_step_work_contract(step_id, lease_gen);
    let (risk, objective) = db
        .get_step_details(step_id)
        .map(|(_, _, _, risk, objective)| (parse_verifier_risk(&risk), objective))
        .unwrap_or((RiskLevel::Medium, String::new()));

    let git = output
        .evidence
        .as_ref()
        .and_then(|packet| packet.git.as_ref());
    let checks = output
        .evidence
        .as_ref()
        .map(|packet| {
            packet
                .checks
                .iter()
                .map(|check| VerifierCheckEvidence {
                    name: check.name.clone(),
                    status: check_status(check.exit_code, check.timed_out),
                    summary: check_summary(check),
                })
                .collect()
        })
        .unwrap_or_default();
    let evidence = StructuredStepEvidence {
        step_id: Some(step_id.to_string()),
        attempt_id: Some(attempt_id.to_string()),
        summary: output.summary.clone(),
        exit_code: Some(exit_code),
        files_changed: output.files_changed.clone(),
        base_commit: git
            .and_then(|evidence| evidence.base_commit.clone())
            .or_else(|| base_commit.map(str::to_string)),
        head_commit: git
            .and_then(|evidence| evidence.head_commit.clone())
            .or_else(|| head_commit.map(str::to_string)),
        commands: Vec::new(),
        checks,
        signals: Vec::new(),
    };

    let fallback_allowed_paths = db.get_run_file_paths(run_id);
    let fallback_base_commit = base_commit.map(str::to_string);
    let contract = persisted_contract
        .as_ref()
        .map(|task| {
            VerifierWorkContract::from_task_contract(
                task,
                fallback_allowed_paths.clone(),
                fallback_base_commit.clone(),
            )
        })
        .unwrap_or_else(|| {
            VerifierWorkContract::from_task_contract(
                &fallback_task_contract(objective, risk),
                fallback_allowed_paths,
                fallback_base_commit,
            )
        });

    let input = VerifierInput { contract, evidence };

    let report = verify_step(input.clone());
    let status = verifier_status(report.verdict).to_string();
    let verdict = verifier_verdict(report.verdict).to_string();
    let passed = report.verdict.is_success();
    let diagnostic = verifier_diagnostic(&status, &verdict, &report);
    let evidence_json = serde_json::json!({
        "source": "engine_verifier",
        "message_id": message_id,
        "step_id": step_id,
        "run_id": run_id,
        "lease_gen": lease_gen,
        "worker_id": worker_id,
        "worker_completed": {
            "exit_code": exit_code,
            "summary": truncated_summary,
            "files_changed": output.files_changed.clone(),
            "base_commit": base_commit,
            "head_commit": head_commit,
            "branch": branch,
            "cost_estimate": output.cost_estimate,
            "structured": output.structured.clone(),
        },
        "verifier_input": input,
        "verifier_report": report,
    })
    .to_string();

    (status, verdict, diagnostic, evidence_json, passed)
}

fn fallback_task_contract(objective: String, risk: RiskLevel) -> TaskContract {
    TaskContract::new(objective, cortex_core::provider::Tier::Execute, risk)
}

fn check_status(exit_code: Option<i32>, timed_out: bool) -> CheckStatus {
    if timed_out {
        CheckStatus::Failed
    } else {
        match exit_code {
            Some(0) => CheckStatus::Passed,
            Some(_) => CheckStatus::Failed,
            None => CheckStatus::Unknown,
        }
    }
}

fn check_summary(check: &cortex_core::protocol::CheckEvidence) -> Option<String> {
    let mut parts = Vec::new();
    if check.timed_out {
        parts.push("timed out".to_string());
    }
    if let Some(code) = check.exit_code {
        parts.push(format!("exit code {code}"));
    }
    if let Some(stderr) = check
        .stderr_excerpt
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        parts.push(stderr.clone());
    } else if let Some(stdout) = check
        .stdout_excerpt
        .as_ref()
        .filter(|s| !s.trim().is_empty())
    {
        parts.push(stdout.clone());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(": "))
    }
}

fn verifier_diagnostic(
    status: &str,
    verdict: &str,
    report: &cortex_engine::verifier::VerifierReport,
) -> String {
    let mut parts = vec![format!(
        "verifier rejected worker completion: status={status}, verdict={verdict}, next_action={:?}",
        report.next_action
    )];

    if !report.evidence_floor.satisfied && !report.evidence_floor.missing.is_empty() {
        parts.push(format!(
            "missing evidence: {}",
            report.evidence_floor.missing.join(", ")
        ));
    }

    if !report.allowed_path_violations.is_empty() {
        let violations = report
            .allowed_path_violations
            .iter()
            .take(5)
            .map(|violation| format!("{} ({})", violation.path, violation.reason))
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("path violations: {violations}"));
    }

    if !report.stale_base_notes.is_empty() {
        let notes = report
            .stale_base_notes
            .iter()
            .take(3)
            .map(|note| note.note.clone())
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("base mismatch: {notes}"));
    }

    if !report.required_check_summary.missing.is_empty() {
        let missing = report
            .required_check_summary
            .missing
            .iter()
            .take(5)
            .map(|check| check.name.clone())
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("missing required checks: {missing}"));
    }

    if !report.required_check_summary.failed.is_empty() {
        let failed = report
            .required_check_summary
            .failed
            .iter()
            .take(5)
            .map(|check| {
                check
                    .summary
                    .as_ref()
                    .filter(|summary| !summary.trim().is_empty())
                    .map(|summary| format!("{} ({summary})", check.name))
                    .unwrap_or_else(|| check.name.clone())
            })
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("failed required checks: {failed}"));
    }

    if !report.check_summary.failures.is_empty() {
        let failed = report
            .check_summary
            .failures
            .iter()
            .take(5)
            .map(|failure| {
                failure
                    .summary
                    .as_ref()
                    .filter(|summary| !summary.trim().is_empty())
                    .map(|summary| format!("{} ({summary})", failure.name))
                    .unwrap_or_else(|| failure.name.clone())
            })
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("check failures: {failed}"));
    }

    if report.command_summary.failed > 0 {
        let failed = report
            .command_summary
            .failures
            .iter()
            .take(5)
            .map(|failure| {
                failure
                    .summary
                    .as_ref()
                    .filter(|summary| !summary.trim().is_empty())
                    .map(|summary| format!("{} ({summary})", failure.command))
                    .unwrap_or_else(|| failure.command.clone())
            })
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("command failures: {failed}"));
    }

    truncate_diagnostic(&parts.join("; "), 2_000)
}

fn truncate_diagnostic(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let mut truncated = value.chars().take(max_chars).collect::<String>();
    truncated.push_str("...");
    truncated
}

fn parse_verifier_risk(risk: &str) -> RiskLevel {
    match risk.to_ascii_lowercase().as_str() {
        "low" => RiskLevel::Low,
        "high" => RiskLevel::High,
        "critical" => RiskLevel::Critical,
        _ => RiskLevel::Medium,
    }
}

fn verifier_status(verdict: VerifierVerdict) -> &'static str {
    match verdict {
        VerifierVerdict::Success | VerifierVerdict::Failed | VerifierVerdict::Blocked => "verified",
        VerifierVerdict::NeedsEvidence => "needs_evidence",
    }
}

fn verifier_verdict(verdict: VerifierVerdict) -> &'static str {
    match verdict {
        VerifierVerdict::Success => "pass",
        VerifierVerdict::NeedsEvidence => "needs_evidence",
        VerifierVerdict::Failed => "fail",
        VerifierVerdict::Blocked => "blocked",
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

        let tier = if let Some((_, _, tier_str, _, _)) = db.get_step_details(step_id) {
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
                    delegation.issuer_did,
                    heart.did()
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

        tracing::info!(
            "worker authenticated via soma delegation: {}",
            delegation.subject_did
        );
        return Ok(delegation.subject_did);
    }

    // Fall back to Clerk JWT
    let clerk_secret = match &state.clerk_secret_key {
        Some(key) => key,
        None => {
            return Ok("local".to_string());
        }
    };

    let keys = clerk::get_or_refresh_jwks_pub(&state.jwks_cache, &state.jwks_stampede, clerk_secret, false).await?;

    match clerk::verify_token_pub(token, &keys) {
        Ok(user_id) => Ok(user_id),
        Err(_) => {
            let keys =
                clerk::get_or_refresh_jwks_pub(&state.jwks_cache, &state.jwks_stampede, clerk_secret, true).await?;
            clerk::verify_token_pub(token, &keys)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cortex_engine::verifier::{
        AcceptanceCoverage, AllowedPathViolation, CheckEvidence as EngineCheckEvidence,
        CheckFailure, CheckStatus as EngineCheckStatus, CheckSummary, CommandSummary,
        RequiredCheckSummary, VerifierFloorSummary, VerifierNextAction,
        VerifierReport as EngineVerifierReport,
    };

    fn rejected_report() -> EngineVerifierReport {
        EngineVerifierReport {
            verdict: VerifierVerdict::Failed,
            risk: RiskLevel::High,
            evidence_signals: Vec::new(),
            evidence_floor: VerifierFloorSummary {
                satisfied: false,
                signals_met: Vec::new(),
                missing: vec!["independent verification".into()],
            },
            allowed_path_violations: Vec::new(),
            command_summary: CommandSummary {
                total: 0,
                succeeded: 0,
                failed: 0,
                unknown: 0,
                failures: Vec::new(),
            },
            check_summary: CheckSummary {
                total: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                unknown: 0,
                failures: Vec::new(),
            },
            required_check_summary: RequiredCheckSummary::default(),
            acceptance_coverage: AcceptanceCoverage {
                evaluated: false,
                total: 0,
                covered: 0,
                uncovered: Vec::new(),
                note: "not evaluated".into(),
            },
            stale_base_notes: Vec::new(),
            next_action: VerifierNextAction::AddEvidence,
        }
    }

    #[test]
    fn verifier_diagnostic_includes_missing_evidence_and_next_action() {
        let report = rejected_report();

        let diagnostic = verifier_diagnostic("needs_evidence", "needs_evidence", &report);

        assert!(diagnostic.contains("next_action=AddEvidence"));
        assert!(diagnostic.contains("missing evidence: independent verification"));
    }

    #[test]
    fn verifier_diagnostic_includes_path_and_required_check_failures() {
        let mut report = rejected_report();
        report.allowed_path_violations.push(AllowedPathViolation {
            path: "docs/readme.md".into(),
            reason: "changed path is outside the allowed path contract".into(),
        });
        report
            .required_check_summary
            .failed
            .push(EngineCheckEvidence {
                name: "npm:build".into(),
                status: EngineCheckStatus::Failed,
                summary: Some("exit code 1".into()),
            });
        report.check_summary.failures.push(CheckFailure {
            name: "npm:build".into(),
            summary: Some("exit code 1".into()),
        });

        let diagnostic = verifier_diagnostic("verified", "fail", &report);

        assert!(diagnostic.contains("path violations: docs/readme.md"));
        assert!(diagnostic.contains("failed required checks: npm:build (exit code 1)"));
        assert!(diagnostic.contains("check failures: npm:build (exit code 1)"));
    }

    #[test]
    fn truncate_diagnostic_caps_long_messages() {
        let diagnostic = truncate_diagnostic("abcdef", 3);

        assert_eq!(diagnostic, "abc...");
    }
}
