use std::sync::Arc;

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub participant_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagesQuery {
    pub limit: Option<i64>,
}

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

/// GET /v1/social/conversations — list viewer's conversations
pub async fn list_conversations(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "error": "No profile found — create a profile first",
                "code": "NOT_FOUND"
            }))
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    let conversations = db(&state).social_list_conversations(profile_id);

    Json(serde_json::json!({ "conversations": conversations }))
}

/// POST /v1/social/conversations — create a new conversation
pub async fn create_conversation(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateConversationRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "error": "No profile found — create a profile first",
                "code": "NOT_FOUND"
            }))
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("").to_string();

    if body.participant_ids.is_empty() {
        return Json(serde_json::json!({
            "error": "participant_ids must not be empty",
            "code": "BAD_REQUEST"
        }));
    }

    // Include the creator in the participant list
    let mut all_participants = body.participant_ids.clone();
    if !all_participants.contains(&profile_id) {
        all_participants.push(profile_id.clone());
    }

    let conversation = db(&state).social_create_conversation(&all_participants);

    Json(conversation)
}

/// GET /v1/social/conversations/{id}/messages — list messages in a conversation
pub async fn list_messages(
    user: ClerkUser,
    Path(conversation_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<MessagesQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "error": "No profile found — create a profile first",
                "code": "NOT_FOUND"
            }))
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(50).min(200);

    let messages = match db(&state).social_list_messages(&conversation_id, profile_id, limit) {
        Some(msgs) => msgs,
        None => {
            return Json(serde_json::json!({
                "error": "Not a participant of this conversation",
                "code": "FORBIDDEN"
            }))
        }
    };

    // Mark messages as read now that the user has viewed them
    db(&state).social_mark_messages_read(&conversation_id, profile_id);

    Json(serde_json::json!({ "messages": messages }))
}

/// POST /v1/social/conversations/{id}/messages — send a message
pub async fn send_message(
    user: ClerkUser,
    Path(conversation_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SendMessageRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "error": "No profile found — create a profile first",
                "code": "NOT_FOUND"
            }))
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");

    if body.content.trim().is_empty() {
        return Json(serde_json::json!({
            "error": "content must not be empty",
            "code": "BAD_REQUEST"
        }));
    }

    let message = match db(&state).social_send_message(&conversation_id, profile_id, &body.content) {
        Some(msg) => msg,
        None => {
            return Json(serde_json::json!({
                "error": "Not a participant of this conversation",
                "code": "FORBIDDEN"
            }))
        }
    };

    Json(message)
}
