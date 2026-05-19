use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::clerk;
use crate::state::AppState;

/// Events pushed to Mission Control frontend clients.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MissionControlEvent {
    RunCreated {
        run_id: String,
        goal: String,
        step_count: usize,
    },
    StepDispatched {
        run_id: String,
        step_id: String,
        provider: String,
        model: String,
        tier: String,
    },
    StepStarted {
        run_id: String,
        step_id: String,
        provider: String,
        model: String,
    },
    StepOutput {
        run_id: String,
        step_id: String,
        line: String,
    },
    StepCompleted {
        run_id: String,
        step_id: String,
        exit_code: i32,
        files_changed: Vec<String>,
        cost_estimate: Option<f64>,
    },
    StepFailed {
        run_id: String,
        step_id: String,
        error: String,
        failure_kind: String,
    },
    RunCompleted {
        run_id: String,
        status: String,
        total_cost: Option<f64>,
    },
    WorkerConnected {
        worker_id: String,
        providers: Vec<String>,
    },
    WorkerDisconnected {
        worker_id: String,
    },
    RoutingDecision {
        step_id: String,
        provider: String,
        model: String,
        rationale: String,
        pressure: f64,
    },
}

/// Unique ID for each subscriber so we can remove the right one on disconnect.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SubscriberId(Uuid);

pub struct McSubscriber {
    pub id: SubscriberId,
    pub tx: mpsc::Sender<MissionControlEvent>,
}

/// Per-step throttle state for StepOutput events.
struct OutputThrottle {
    last_sent: Instant,
    pending: Option<MissionControlEvent>,
}

#[derive(Debug, Deserialize)]
pub struct McQueryParams {
    pub token: Option<String>,
}

pub async fn mc_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<McQueryParams>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_mc_connection(socket, state, params))
}

async fn handle_mc_connection(
    mut socket: WebSocket,
    state: Arc<AppState>,
    params: McQueryParams,
) {
    // Authenticate via JWT token from query param
    let user_id = match authenticate_mc(&state, params.token.as_deref().unwrap_or("")).await {
        Ok(uid) => uid,
        Err(e) => {
            tracing::warn!("mission control auth failed: {e}");
            let err = serde_json::json!({
                "type": "error",
                "code": "auth_failed",
                "message": e,
            });
            let _ = socket
                .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
                .await;
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    tracing::info!("mission control client connected: user={user_id}");

    // Send welcome
    let welcome = serde_json::json!({
        "type": "welcome",
        "user_id": user_id,
    });
    if socket
        .send(Message::Text(
            serde_json::to_string(&welcome).unwrap().into(),
        ))
        .await
        .is_err()
    {
        return;
    }

    // Subscribe to MC events for this user
    let (tx, mut rx) = mpsc::channel::<MissionControlEvent>(128);
    let sub_id = SubscriberId(Uuid::new_v4());
    state.subscribe_mc(&user_id, sub_id, tx).await;

    // Per-step output throttling: max 1 StepOutput per 500ms per step
    let mut throttles: HashMap<String, OutputThrottle> = HashMap::new();
    let throttle_interval = Duration::from_millis(500);

    // Create a flush ticker for throttled output
    let mut flush_interval = tokio::time::interval(Duration::from_millis(250));
    flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                // Apply throttling for StepOutput events
                if let MissionControlEvent::StepOutput { ref step_id, .. } = event {
                    let step_key = step_id.clone();
                    let throttle = throttles.entry(step_key).or_insert_with(|| OutputThrottle {
                        last_sent: Instant::now() - throttle_interval,
                        pending: None,
                    });

                    if throttle.last_sent.elapsed() >= throttle_interval {
                        // Enough time has passed, send immediately
                        throttle.last_sent = Instant::now();
                        throttle.pending = None;
                        let json = serde_json::to_string(&event).unwrap();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    } else {
                        // Too soon, buffer the latest (drop intermediate lines)
                        throttle.pending = Some(event);
                    }
                } else {
                    // Non-output events: send immediately
                    // If this is a StepCompleted/StepFailed, flush any pending output first
                    let flush_step = match &event {
                        MissionControlEvent::StepCompleted { step_id, .. }
                        | MissionControlEvent::StepFailed { step_id, .. } => Some(step_id.clone()),
                        _ => None,
                    };

                    if let Some(step_key) = flush_step {
                        if let Some(throttle) = throttles.remove(&step_key) {
                            if let Some(pending) = throttle.pending {
                                let json = serde_json::to_string(&pending).unwrap();
                                if socket.send(Message::Text(json.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }

                    let json = serde_json::to_string(&event).unwrap();
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            }

            _ = flush_interval.tick() => {
                // Flush any pending throttled output whose interval has passed
                let now = Instant::now();
                let mut to_remove = Vec::new();

                for (step_key, throttle) in throttles.iter_mut() {
                    if throttle.pending.is_some() && now.duration_since(throttle.last_sent) >= throttle_interval {
                        if let Some(pending) = throttle.pending.take() {
                            throttle.last_sent = now;
                            let json = serde_json::to_string(&pending).unwrap();
                            if socket.send(Message::Text(json.into())).await.is_err() {
                                to_remove.clear(); // will break outer loop
                                break;
                            }
                        }
                    }
                    // Clean up throttle entries for steps that haven't had output in a while
                    if throttle.pending.is_none() && now.duration_since(throttle.last_sent) > Duration::from_secs(60) {
                        to_remove.push(step_key.clone());
                    }
                }

                for key in to_remove {
                    throttles.remove(&key);
                }
            }

            result = socket.recv() => {
                match result {
                    // MC clients are read-only observers; we accept pings/pongs but
                    // ignore any text messages. Close on disconnect.
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => continue,
                }
            }
        }
    }

    state.unsubscribe_mc(&user_id, sub_id).await;
    tracing::info!("mission control client disconnected: user={user_id}");
}

async fn authenticate_mc(state: &AppState, token: &str) -> Result<String, String> {
    let clerk_secret = match &state.clerk_secret_key {
        Some(key) => key,
        None => {
            // No Clerk configured — local dev mode
            return Ok("local".to_string());
        }
    };

    if token.is_empty() {
        return Err("missing token query parameter — connect with ?token=<jwt>".into());
    }

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
