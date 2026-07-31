use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
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

fn conversation_is_accessible(
    database: &crate::db::Database,
    conversation_id: &str,
    profile_id: &str,
) -> bool {
    if !database.social_is_conversation_participant(conversation_id, profile_id) {
        return false;
    }
    database
        .social_conversation_participant_ids(conversation_id, Some(profile_id))
        .into_iter()
        .all(|other| !database.social_is_blocked_either_direction(profile_id, &other))
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
    let mut conversations = db(&state).social_list_conversations(profile_id);
    conversations.retain(|conversation| {
        conversation["id"].as_str().map(|conversation_id| {
            conversation_is_accessible(db(&state), conversation_id, profile_id)
        }).unwrap_or(false)
    });

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

    let mut all_participants: Vec<String> = Vec::new();
    for raw_id in body.participant_ids {
        let participant_id = raw_id.trim();
        if participant_id.is_empty() {
            return bad_request("participant_ids must contain valid profile ids");
        }
        if !all_participants.iter().any(|existing| existing == participant_id) {
            all_participants.push(participant_id.to_string());
        }
    }
    if all_participants.len() > 20 {
        return bad_request("conversations support at most 20 participants");
    }
    if !all_participants.contains(&profile_id) {
        all_participants.push(profile_id.clone());
    }

    // Block either direction → 403.
    for other in all_participants.iter().filter(|id| *id != &profile_id) {
        if db(&state).social_find_profile_by_id(other).is_none()
            || db(&state).social_is_blocked_either_direction(&profile_id, other)
        {
            return not_found("User not found");
        }
        let prefs = db(&state).social_get_or_create_profile_prefs(other);
        let policy = prefs["dmPolicy"].as_str().unwrap_or("verified");
        let allowed = match policy {
            "everyone" => true,
            "verified" => profile["proofState"].as_str() == Some("verified"),
            "following" => db(&state).social_get_follow_status(other, &profile_id),
            _ => false,
        };
        if !allowed {
            return not_found("User not found");
        }
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

    if !conversation_is_accessible(db(&state), &conversation_id, profile_id) {
        return not_found("Conversation not found");
    }

    let messages = match db(&state).social_list_messages(&conversation_id, profile_id, limit) {
        Some(msgs) => msgs,
        None => return not_found("Conversation not found"),
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

    // Block either direction with any other participant → 403.
    if !conversation_is_accessible(db(&state), &conversation_id, profile_id) {
        return not_found("Conversation not found");
    }
    let others =
        db(&state).social_conversation_participant_ids(&conversation_id, Some(profile_id));
    for other in &others {
        if db(&state).social_is_blocked_either_direction(profile_id, other) {
            return not_found("Conversation not found");
        }
    }

    let message = match db(&state).social_send_message(&conversation_id, profile_id, &body.content) {
        Some(msg) => msg,
        None => return not_found("Conversation not found"),
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
    pub ticket: Option<String>,
}

const SOCIAL_WS_TICKET_TTL_SECONDS: i64 = 30;

fn hash_social_ws_ticket(ticket: &str) -> String {
    hex::encode(Sha256::digest(ticket.as_bytes()))
}

fn generate_social_ws_ticket() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    format!("hvws_{}", URL_SAFE_NO_PAD.encode(bytes))
}

fn valid_social_ws_ticket_shape(ticket: &str) -> bool {
    ticket.len() == 48
        && ticket
            .strip_prefix("hvws_")
            .is_some_and(|body| {
                body.bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            })
}

/// POST /v1/social/ws-ticket — exchange a bearer session for a one-use WS ticket.
pub async fn issue_social_ws_ticket(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let ticket = generate_social_ws_ticket();
    let expires_at = Utc::now().timestamp() + SOCIAL_WS_TICKET_TTL_SECONDS;
    let result = state
        .db
        .as_ref()
        .ok_or_else(|| "database unavailable".to_string())
        .and_then(|db| {
            db.social_create_ws_ticket(&hash_social_ws_ticket(&ticket), &user.user_id, expires_at)
        });
    match result {
        Ok(()) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            (
                StatusCode::CREATED,
                headers,
                Json(serde_json::json!({
                    "ticket": ticket,
                    "expiresInSeconds": SOCIAL_WS_TICKET_TTL_SECONDS,
                })),
            )
                .into_response()
        }
        Err(error) => {
            tracing::error!(%error, "failed to issue Socials WebSocket ticket");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "realtime authentication unavailable" })),
            )
                .into_response()
        }
    }
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

/// GET /v1/social/ws?ticket=<opaque> — social DM realtime (subscribe per conversation).
pub async fn social_ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<SocialWsQuery>,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(error) = validate_social_ws_origin(&headers) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": error }))).into_response();
    }
    let ticket = params.ticket.as_deref().unwrap_or("");
    match authenticate_social_ws(&state, ticket) {
        Ok(user_id) => ws
            .on_upgrade(move |socket| handle_social_ws(socket, state, user_id))
            .into_response(),
        Err(error) => {
            tracing::warn!("social dm ws ticket rejected: {error}");
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
                "error": "invalid or expired realtime ticket"
            })))
                .into_response()
        }
    }
}

async fn handle_social_ws(mut socket: WebSocket, state: Arc<AppState>, user_id: String) {

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
                                    .map(|db| conversation_is_accessible(db, &conversationId, pid))
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

fn validate_social_ws_origin(headers: &HeaderMap) -> Result<(), String> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    let expected = std::env::var("CLERK_AUTHORIZED_PARTY")
        .ok()
        .filter(|value| !value.trim().is_empty());
    validate_social_ws_origin_values(
        origin,
        expected.as_deref(),
        clerk::is_production_runtime(),
    )
}

fn validate_social_ws_origin_values(
    origin: Option<&str>,
    expected: Option<&str>,
    production: bool,
) -> Result<(), String> {
    match (origin, expected) {
        (Some(actual), Some(expected))
            if actual.trim_end_matches('/') == expected.trim_end_matches('/') => Ok(()),
        (None, _) | (_, None) if !production => Ok(()),
        _ => Err("WebSocket origin is not authorized".into()),
    }
}

fn authenticate_social_ws(state: &Arc<AppState>, ticket: &str) -> Result<String, String> {
    if !valid_social_ws_ticket_shape(ticket) {
        return Err("missing or malformed WebSocket ticket".into());
    }
    let user_id = state
        .db
        .as_ref()
        .ok_or("database unavailable")?
        .social_consume_ws_ticket(&hash_social_ws_ticket(ticket))?;
    if let Some(message) = clerk::account_access_error(state, &user_id) {
        return Err(message.into());
    }
    Ok(user_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_tickets_are_random_opaque_and_hashable() {
        let first = generate_social_ws_ticket();
        let second = generate_social_ws_ticket();
        assert!(first.starts_with("hvws_"));
        assert_eq!(first.len(), 48);
        assert_ne!(first, second);
        assert_eq!(hash_social_ws_ticket(&first).len(), 64);
        assert_ne!(hash_social_ws_ticket(&first), first);
        assert!(valid_social_ws_ticket_shape(&first));
        assert!(!valid_social_ws_ticket_shape("hvws_short"));
        assert!(!valid_social_ws_ticket_shape(
            "hvws_abcdefghijklmnopqrstuvwxyz0123456789ABCDE!"
        ));
    }

    #[test]
    fn production_ws_origin_must_match_exactly() {
        let expected = Some("https://heyvera.org");
        assert!(validate_social_ws_origin_values(expected, expected, true).is_ok());
        assert!(
            validate_social_ws_origin_values(Some("https://evil.example"), expected, true).is_err()
        );
        assert!(validate_social_ws_origin_values(None, expected, true).is_err());
        assert!(
            validate_social_ws_origin_values(Some("https://heyvera.org"), None, true).is_err()
        );
        assert!(validate_social_ws_origin_values(None, None, false).is_ok());
    }

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
