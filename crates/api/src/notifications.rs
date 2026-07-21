use std::sync::Arc;

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct NotificationQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

/// Decode a keyset cursor from base64 into (created_at, id).
fn decode_cursor(cursor: &str) -> Option<(String, String)> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let s = String::from_utf8(bytes).ok()?;
    let parts: Vec<&str> = s.splitn(2, '|').collect();
    if parts.len() == 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

/// Encode (created_at, id) into an opaque base64 cursor.
fn encode_cursor(created_at: &str, id: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("{created_at}|{id}"))
}

/// GET /v1/social/notifications — returns notifications for the authenticated user
pub async fn get_notifications(
    user: ClerkUser,
    Query(params): Query<NotificationQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "notifications": [],
                "cursor": null,
                "has_more": false,
            }))
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let notifications = db(&state).social_get_notifications(
        profile_id,
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
    );

    let next_cursor = if notifications.len() as i64 == limit {
        notifications.last().and_then(|n| {
            // Prefer camelCase createdAt (current shape); fall back for safety.
            let created_at = n["createdAt"].as_str().or_else(|| n["created_at"].as_str())?;
            let id = n["id"].as_str()?;
            Some(encode_cursor(created_at, id))
        })
    } else {
        None
    };

    let has_more = notifications.len() as i64 == limit;

    Json(serde_json::json!({
        "notifications": notifications,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
}

/// POST /v1/social/notifications/read — mark all notifications as read
pub async fn mark_notifications_read(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({ "ok": true, "updated": 0 }))
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    let updated = db(&state).social_mark_notifications_read(profile_id);

    Json(serde_json::json!({ "ok": true, "updated": updated }))
}
