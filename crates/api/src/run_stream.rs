use std::convert::Infallible;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use futures_core::Stream;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

pub async fn stream_run(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Path(run_id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })?;

    db.get_run_goal(&run_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "run not found".into(),
            }),
        )
    })?;

    // Verify the requesting user owns this run
    if !db.verify_run_owner(&run_id, &user.user_id) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "access denied: run belongs to another user".into(),
            }),
        ));
    }

    let run_id_clone = run_id.clone();
    let state_clone = state.clone();

    let stream = async_stream::stream! {
        let mut last_snapshot = String::new();
        let mut tick = 0u64;

        loop {
            let db = match &state_clone.db {
                Some(db) => db,
                None => break,
            };

            let steps = db.get_all_step_statuses(&run_id_clone);
            let goal = db.get_run_goal(&run_id_clone).unwrap_or_default();
            let heal_count = db.get_run_heal_count(&run_id_clone);

            let snapshot = serde_json::json!({
                "run_id": run_id_clone,
                "goal": goal,
                "heal_attempts": heal_count,
                "steps": steps.iter().map(|(sid, status)| {
                    let details = db.get_step_details(sid);
                    let mut step = serde_json::json!({
                        "id": sid,
                        "status": status,
                    });
                    if let Some((kind, tier, risk, objective)) = details {
                        step["kind"] = serde_json::json!(kind);
                        step["tier"] = serde_json::json!(tier);
                        step["risk"] = serde_json::json!(risk);
                        step["objective"] = serde_json::json!(objective);
                    }
                    if status == "succeeded" {
                        if let Some(summary) = db.get_step_output_summary(sid) {
                            step["output_summary"] = serde_json::json!(summary);
                        }
                    }
                    if status == "failed" {
                        if let Some(err) = db.get_step_last_error(sid) {
                            step["last_error"] = serde_json::json!(err);
                        }
                    }
                    step
                }).collect::<Vec<_>>(),
                "tick": tick,
            });

            let snapshot_str = serde_json::to_string(&snapshot).unwrap_or_default();

            // Only send if state changed (or first tick)
            if snapshot_str != last_snapshot {
                last_snapshot = snapshot_str.clone();
                yield Ok(Event::default().event("run_update").data(snapshot_str));
            }

            // Check if run is terminal
            let all_terminal = steps.iter().all(|(_, s)| {
                matches!(s.as_str(), "succeeded" | "failed" | "cancelled" | "skipped")
            });

            if all_terminal && !steps.is_empty() {
                let any_failed = steps.iter().any(|(_, s)| s == "failed");
                let final_status = if any_failed { "failed" } else { "succeeded" };
                yield Ok(Event::default().event("run_complete").data(
                    serde_json::json!({
                        "run_id": run_id_clone,
                        "status": final_status,
                    }).to_string()
                ));
                break;
            }

            tick += 1;
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
