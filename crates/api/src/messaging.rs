use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::state::AppState;

type ApiResponse = (StatusCode, Json<serde_json::Value>);

fn ok(v: serde_json::Value) -> ApiResponse { (StatusCode::OK, Json(v)) }
fn not_found(msg: &str) -> ApiResponse { (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": msg, "code": "NOT_FOUND" }))) }
fn bad_request(msg: &str) -> ApiResponse { (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg, "code": "BAD_REQUEST" }))) }
fn forbidden(msg: &str) -> ApiResponse { (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": msg, "code": "FORBIDDEN" }))) }

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
        None => return ok(serde_json::json!({ "conversations": [] })),
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    let conversations = db(&state).social_list_conversations(profile_id);

    ok(serde_json::json!({ "conversations": conversations }))
}

/// POST /v1/social/conversations — create a new conversation
pub async fn create_conversation(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateConversationRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("No profile found — create a profile first"),
    };

    let profile_id = profile["id"].as_str().unwrap_or("").to_string();

    if body.participant_ids.is_empty() {
        return bad_request("participant_ids must not be empty");
    }

    let mut all_participants = body.participant_ids.clone();
    if !all_participants.contains(&profile_id) {
        all_participants.push(profile_id.clone());
    }

    let conversation = db(&state).social_create_conversation(&all_participants);

    ok(conversation)
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
        None => return ok(serde_json::json!({ "messages": [] })),
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(50).min(200);

    let messages = match db(&state).social_list_messages(&conversation_id, profile_id, limit) {
        Some(msgs) => msgs,
        None => return forbidden("Not a participant of this conversation"),
    };

    db(&state).social_mark_messages_read(&conversation_id, profile_id);

    ok(serde_json::json!({ "messages": messages }))
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
        None => return not_found("No profile found — create a profile first"),
    };

    let profile_id = profile["id"].as_str().unwrap_or("");

    if body.content.trim().is_empty() {
        return bad_request("content must not be empty");
    }

    let message = match db(&state).social_send_message(&conversation_id, profile_id, &body.content) {
        Some(msg) => msg,
        None => return forbidden("Not a participant of this conversation"),
    };

    ok(message)
}
