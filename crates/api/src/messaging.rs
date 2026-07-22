use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::clerk;
use crate::clerk::ClerkUser;
use crate::state::{AppState, DmSubscriber, DmSubscriberId};

type ApiResponse = (StatusCode, Json<serde_json::Value>);

fn ok(v: serde_json::Value) -> ApiResponse {
    (StatusCode::OK, Json(v))
}
fn not_found(msg: &str) -> ApiResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": msg, "code": "NOT_FOUND" })),
    )
}
fn bad_request(msg: &str) -> ApiResponse {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": msg, "code": "BAD_REQUEST" })),
    )
}
fn forbidden(msg: &str) -> ApiResponse {
    (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({ "error": msg, "code": "FORBIDDEN" })),
    )
}

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

    // Soft-realtime: push to WebSocket subscribers of this conversation.
    state
        .broadcast_dm_message(&conversation_id, message.clone())
        .await;

    ok(message)
}

// ─── Social DM WebSocket (Wave 8b) ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SocialWsQuery {
    pub token: Option<String>,
}

/// Client → server frames (JSON text).
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[allow(non_snake_case)] // protocol uses camelCase conversationId
pub enum SocialWsClientMessage {
    #[serde(rename = "subscribe")]
    Subscribe {
        #[serde(alias = "conversation_id")]
        conversationId: String,
    },
    #[serde(rename = "unsubscribe")]
    Unsubscribe {
        #[serde(alias = "conversation_id")]
        conversationId: String,
    },
    #[serde(rename = "ping")]
    Ping,
}

/// Parse a client WebSocket text frame into a typed message.
/// Pure helper — unit-tested.
pub fn parse_social_ws_client_message(text: &str) -> Result<SocialWsClientMessage, String> {
    serde_json::from_str(text).map_err(|e| format!("invalid client message: {e}"))
}

/// GET /v1/social/ws?token=<jwt> — social DM realtime (subscribe per conversation).
pub async fn social_ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<SocialWsQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_social_ws(socket, state, params))
}

async fn handle_social_ws(mut socket: WebSocket, state: Arc<AppState>, params: SocialWsQuery) {
    let user_id = match authenticate_social_ws(&state, params.token.as_deref().unwrap_or("")).await {
        Ok(uid) => uid,
        Err(e) => {
            tracing::warn!("social dm ws auth failed: {e}");
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

    // Resolve social profile (optional — subscribe checks participant via profile).
    let profile_id = state
        .db
        .as_ref()
        .and_then(|db| db.social_find_profile_by_clerk_id(&user_id))
        .and_then(|p| p["id"].as_str().map(|s| s.to_string()));

    let welcome = serde_json::json!({
        "type": "welcome",
        "protocol": "social-dm/v1",
        "user_id": user_id,
        "profile_id": profile_id,
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

    tracing::info!("social dm ws connected: user={user_id}");

    // One fan-out channel for this socket; map conversation_id → sub id for cleanup.
    let (tx, mut rx) = mpsc::channel::<serde_json::Value>(64);
    let sub_id = DmSubscriberId(Uuid::new_v4());
    let mut active_conversations: Vec<String> = Vec::new();

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".into());
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            result = socket.recv() => {
                match result {
                    Some(Ok(Message::Text(text))) => {
                        match parse_social_ws_client_message(&text) {
                            Ok(SocialWsClientMessage::Subscribe { conversationId }) => {
                                let Some(ref pid) = profile_id else {
                                    let err = serde_json::json!({
                                        "type": "error",
                                        "code": "no_profile",
                                        "message": "create a social profile before subscribing",
                                    });
                                    let _ = socket.send(Message::Text(
                                        serde_json::to_string(&err).unwrap().into()
                                    )).await;
                                    continue;
                                };

                                let is_participant = state
                                    .db
                                    .as_ref()
                                    .map(|db| db.social_is_conversation_participant(&conversationId, pid))
                                    .unwrap_or(false);

                                if !is_participant {
                                    let err = serde_json::json!({
                                        "type": "error",
                                        "code": "forbidden",
                                        "message": "not a participant of this conversation",
                                        "conversationId": conversationId,
                                    });
                                    let _ = socket.send(Message::Text(
                                        serde_json::to_string(&err).unwrap().into()
                                    )).await;
                                    continue;
                                }

                                if !active_conversations.iter().any(|c| c == &conversationId) {
                                    state
                                        .subscribe_dm(
                                            &conversationId,
                                            DmSubscriber {
                                                id: sub_id,
                                                tx: tx.clone(),
                                            },
                                        )
                                        .await;
                                    active_conversations.push(conversationId.clone());
                                }

                                let ack = serde_json::json!({
                                    "type": "subscribed",
                                    "conversationId": conversationId,
                                });
                                if socket
                                    .send(Message::Text(serde_json::to_string(&ack).unwrap().into()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Ok(SocialWsClientMessage::Unsubscribe { conversationId }) => {
                                if active_conversations.iter().any(|c| c == &conversationId) {
                                    state.unsubscribe_dm(&conversationId, sub_id).await;
                                    active_conversations.retain(|c| c != &conversationId);
                                }
                                let ack = serde_json::json!({
                                    "type": "unsubscribed",
                                    "conversationId": conversationId,
                                });
                                let _ = socket
                                    .send(Message::Text(serde_json::to_string(&ack).unwrap().into()))
                                    .await;
                            }
                            Ok(SocialWsClientMessage::Ping) => {
                                let pong = serde_json::json!({ "type": "pong" });
                                if socket
                                    .send(Message::Text(serde_json::to_string(&pong).unwrap().into()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            Err(e) => {
                                let err = serde_json::json!({
                                    "type": "error",
                                    "code": "bad_message",
                                    "message": e,
                                });
                                let _ = socket
                                    .send(Message::Text(serde_json::to_string(&err).unwrap().into()))
                                    .await;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = socket.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => continue,
                }
            }
        }
    }

    for conv in &active_conversations {
        state.unsubscribe_dm(conv, sub_id).await;
    }
    tracing::info!("social dm ws disconnected: user={user_id}");
}

async fn authenticate_social_ws(state: &AppState, token: &str) -> Result<String, String> {
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

    let keys =
        clerk::get_or_refresh_jwks_pub(&state.jwks_cache, &state.jwks_stampede, clerk_secret, false)
            .await?;

    match clerk::verify_token_pub(token, &keys) {
        Ok(user_id) => Ok(user_id),
        Err(_) => {
            let keys = clerk::get_or_refresh_jwks_pub(
                &state.jwks_cache,
                &state.jwks_stampede,
                clerk_secret,
                true,
            )
            .await?;
            clerk::verify_token_pub(token, &keys)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_subscribe_camel_case() {
        let msg = parse_social_ws_client_message(r#"{"type":"subscribe","conversationId":"c1"}"#)
            .expect("parse");
        match msg {
            SocialWsClientMessage::Subscribe { conversationId } => {
                assert_eq!(conversationId, "c1");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parse_subscribe_snake_case_alias() {
        let msg =
            parse_social_ws_client_message(r#"{"type":"subscribe","conversation_id":"conv-9"}"#)
                .expect("parse");
        match msg {
            SocialWsClientMessage::Subscribe { conversationId } => {
                assert_eq!(conversationId, "conv-9");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parse_ping() {
        let msg = parse_social_ws_client_message(r#"{"type":"ping"}"#).expect("parse");
        assert!(matches!(msg, SocialWsClientMessage::Ping));
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse_social_ws_client_message("not-json").is_err());
        assert!(parse_social_ws_client_message(r#"{"type":"nope"}"#).is_err());
    }
}
