use std::collections::HashSet;
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
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
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;
use tokio::time::Instant;
use uuid::Uuid;

use crate::clerk;
use crate::clerk::ClerkUser;
use crate::state::{AppState, DmSubscriber, DmSubscriberId};

type ApiResponse = (
    StatusCode,
    [(header::HeaderName, HeaderValue); 1],
    Json<serde_json::Value>,
);

fn api_response(status: StatusCode, value: serde_json::Value) -> ApiResponse {
    (
        status,
        [(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-store"),
        )],
        Json(value),
    )
}

fn ok(v: serde_json::Value) -> ApiResponse {
    api_response(StatusCode::OK, v)
}
fn not_found(msg: &str) -> ApiResponse {
    api_response(
        StatusCode::NOT_FOUND,
        serde_json::json!({ "error": msg, "code": "NOT_FOUND" }),
    )
}
fn bad_request(msg: &str) -> ApiResponse {
    api_response(
        StatusCode::BAD_REQUEST,
        serde_json::json!({ "error": msg, "code": "BAD_REQUEST" }),
    )
}
fn conflict(msg: &str) -> ApiResponse {
    api_response(
        StatusCode::CONFLICT,
        serde_json::json!({ "error": msg, "code": "CONFLICT" }),
    )
}
fn unavailable() -> ApiResponse {
    api_response(
        StatusCode::SERVICE_UNAVAILABLE,
        serde_json::json!({
            "error": "Messaging is temporarily unavailable",
            "code": "SERVICE_UNAVAILABLE"
        }),
    )
}

const MAX_CONVERSATION_PARTICIPANTS: usize = 20;
const MAX_PROFILE_ID_BYTES: usize = 128;
const MAX_MESSAGE_CHARS: usize = 4_000;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_CLIENT_ID_BYTES: usize = 128;
const MAX_MESSAGE_PAGE_SIZE: i64 = 100;
const MAX_WS_SUBSCRIPTIONS: usize = 64;
const MAX_WS_FRAMES_PER_MINUTE: u32 = 120;

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub participant_ids: Vec<String>,
    pub client_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub client_message_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MarkReadRequest {
    pub through_message_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessagesQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MessageCursor {
    conversation_id: String,
    profile_id: String,
    before_sequence: i64,
}

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

fn conversation_is_accessible(
    database: &crate::db::Database,
    conversation_id: &str,
    profile_id: &str,
) -> bool {
    database.social_conversation_is_accessible(conversation_id, profile_id)
}

fn valid_opaque_id(value: &str, max_bytes: usize) -> bool {
    let len = value.len();
    len >= 8
        && len <= max_bytes
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn normalize_message_content(content: &str) -> Result<String, &'static str> {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = normalized.trim();
    if normalized.is_empty() {
        return Err("content must not be empty");
    }
    if normalized.chars().count() > MAX_MESSAGE_CHARS || normalized.len() > MAX_MESSAGE_BYTES {
        return Err("content exceeds the 4,000 character or 16 KiB limit");
    }
    if normalized
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
    {
        return Err("content contains unsupported control characters");
    }
    Ok(normalized.to_string())
}

fn message_cursor_key() -> Option<[u8; 32]> {
    let secret = std::env::var("CLERK_SECRET_KEY")
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var("CORTEX_KEY_ENCRYPTION_SECRET")
                .ok()
                .filter(|v| !v.is_empty())
        })
        .or_else(|| {
            (!crate::is_production_env()).then(|| "heyvera-local-message-cursor-key".into())
        })?;
    let digest = Sha256::digest(
        [
            b"heyvera-social-message-cursor:v1:".as_slice(),
            secret.as_bytes(),
        ]
        .concat(),
    );
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    Some(key)
}
const MESSAGE_CURSOR_PREFIX: &str = "hvm1.";
const MESSAGE_CURSOR_NONCE_LEN: usize = 12;

fn encode_message_cursor(cursor: &MessageCursor) -> Option<String> {
    let cipher = Aes256Gcm::new_from_slice(&message_cursor_key()?).ok()?;
    let mut nonce_bytes = [0u8; MESSAGE_CURSOR_NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let plaintext = serde_json::to_vec(cursor).ok()?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_slice())
        .ok()?;
    let mut payload = nonce_bytes.to_vec();
    payload.extend_from_slice(&ciphertext);
    Some(format!(
        "{MESSAGE_CURSOR_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(payload)
    ))
}

fn decode_message_cursor(
    encoded: &str,
    expected_conversation_id: &str,
    expected_profile_id: &str,
) -> Option<i64> {
    let payload = URL_SAFE_NO_PAD
        .decode(encoded.strip_prefix(MESSAGE_CURSOR_PREFIX)?)
        .ok()?;
    if payload.len() <= MESSAGE_CURSOR_NONCE_LEN {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(&message_cursor_key()?).ok()?;
    let (nonce, ciphertext) = payload.split_at(MESSAGE_CURSOR_NONCE_LEN);
    let plaintext = cipher.decrypt(Nonce::from_slice(nonce), ciphertext).ok()?;
    let cursor: MessageCursor = serde_json::from_slice(&plaintext).ok()?;
    (cursor.conversation_id == expected_conversation_id
        && cursor.profile_id == expected_profile_id
        && cursor.before_sequence > 0)
        .then_some(cursor.before_sequence)
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
    let mut conversations = db(&state).social_list_conversations(profile_id, 100);
    conversations.retain(|conversation| {
        conversation["id"].as_str().map(|conversation_id| {
            conversation_is_accessible(db(&state), conversation_id, profile_id)
        }).unwrap_or(false)
    });

    ok(serde_json::json!({ "conversations": conversations }))
}

pub async fn create_conversation(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateConversationRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(profile) => profile,
        None => return not_found("No profile found - create a profile first"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("").to_string();
    if body.participant_ids.len() > MAX_CONVERSATION_PARTICIPANTS {
        return bad_request("conversations support at most 20 total participants");
    }
    let mut seen = HashSet::with_capacity(body.participant_ids.len() + 1);
    let mut participants = Vec::with_capacity(body.participant_ids.len() + 1);
    for raw_id in body.participant_ids {
        let participant_id = raw_id.trim();
        if !valid_opaque_id(participant_id, MAX_PROFILE_ID_BYTES) {
            return bad_request("participant_ids contains an invalid profile id");
        }
        if seen.insert(participant_id.to_string()) {
            participants.push(participant_id.to_string());
        }
    }
    if seen.insert(profile_id.clone()) {
        participants.push(profile_id.clone());
    }
    if !(2..=MAX_CONVERSATION_PARTICIPANTS).contains(&participants.len()) {
        return bad_request("conversations require 2 to 20 total participants");
    }
    let group_creation_key = if participants.len() > 2 {
        let Some(key) = body.client_request_id.as_deref() else {
            return bad_request("client_request_id is required for group conversations");
        };
        if !valid_opaque_id(key, MAX_CLIENT_ID_BYTES) {
            return bad_request("client_request_id is invalid");
        }
        Some(key)
    } else {
        None
    };
    match db(&state).social_create_conversation(&profile_id, &participants, group_creation_key) {
        Ok(conversation) => ok(conversation),
        Err(crate::db::SocialMessagingError::NotFound) => not_found("User not found"),
        Err(crate::db::SocialMessagingError::Conflict) => {
            conflict("client_request_id was already used for different participants")
        }
        Err(crate::db::SocialMessagingError::Database(error)) => {
            tracing::error!(%error, "failed to create Socials conversation");
            unavailable()
        }
        }
    }

pub async fn list_messages(
    user: ClerkUser,
    Path(conversation_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<MessagesQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if !valid_opaque_id(&conversation_id, MAX_PROFILE_ID_BYTES) {
        return not_found("Conversation not found");
    }
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(profile) => profile,
        None => return not_found("Conversation not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(50);
    if !(1..=MAX_MESSAGE_PAGE_SIZE).contains(&limit) {
        return bad_request("limit must be between 1 and 100");
    }
    let before_sequence = match params.cursor.as_deref() {
        Some(cursor) => match decode_message_cursor(cursor, &conversation_id, profile_id) {
            Some(sequence) => Some(sequence),
            None => return bad_request("cursor is invalid for this conversation"),
        },
        None => None,
    };
    match db(&state).social_list_messages(&conversation_id, profile_id, limit, before_sequence) {
        Ok(page) => {
            let next_cursor = match page.next_before_sequence {
                Some(sequence) => match encode_message_cursor(&MessageCursor {
                    conversation_id: conversation_id.clone(),
                    profile_id: profile_id.to_string(),
                    before_sequence: sequence,
                }) {
                    Some(cursor) => Some(cursor),
                    None => return unavailable(),
                },
                None => None,
            };
            ok(serde_json::json!({
                "messages": page.messages,
                "next_cursor": next_cursor,
                "has_more": next_cursor.is_some(),
            }))
        }
        Err(crate::db::SocialMessagingError::NotFound) => not_found("Conversation not found"),
        Err(error) => {
            tracing::error!(?error, "failed to list Socials messages");
            unavailable()
        }
    }
}

pub async fn mark_conversation_read(
    user: ClerkUser,
    Path(conversation_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<MarkReadRequest>,
) -> impl IntoResponse {
    if !valid_opaque_id(&conversation_id, MAX_PROFILE_ID_BYTES)
        || !valid_opaque_id(&body.through_message_id, MAX_PROFILE_ID_BYTES)
    {
        return not_found("Conversation not found");
    }
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(profile) => profile,
        None => return not_found("Conversation not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).social_mark_message_read(
        &conversation_id,
        profile_id,
        &body.through_message_id,
    ) {
        Ok(receipt) => {
            if receipt.advanced {
                state
                    .broadcast_dm_read(&conversation_id, profile_id, &receipt.message_id)
                    .await;
            }
            ok(serde_json::json!({
                "ok": true,
                "through_message_id": receipt.message_id,
                "unread_count": receipt.unread_count,
            }))
        }
        Err(crate::db::SocialMessagingError::NotFound) => not_found("Conversation not found"),
        Err(error) => {
            tracing::error!(?error, "failed to update Socials read state");
            unavailable()
        }
    }
}

pub async fn send_message(
    user: ClerkUser,
    Path(conversation_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SendMessageRequest>,
) -> impl IntoResponse {
    if !valid_opaque_id(&conversation_id, MAX_PROFILE_ID_BYTES) {
        return not_found("Conversation not found");
    }
    if !valid_opaque_id(&body.client_message_id, MAX_CLIENT_ID_BYTES) {
        return bad_request("client_message_id is invalid");
    }
    let content = match normalize_message_content(&body.content) {
        Ok(content) => content,
        Err(error) => return bad_request(error),
    };
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(profile) => profile,
        None => return not_found("Conversation not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).social_send_message(
        &conversation_id,
        profile_id,
        &content,
        &body.client_message_id,
    ) {
        Ok(outcome) => {
            if !outcome.replayed {
    state
                    .broadcast_dm_message(&conversation_id, outcome.message.clone())
        .await;
            }
            api_response(
                if outcome.replayed {
                    StatusCode::OK
                } else {
                    StatusCode::CREATED
                },
                outcome.message,
            )
        }
        Err(crate::db::SocialMessagingError::NotFound) => not_found("Conversation not found"),
        Err(crate::db::SocialMessagingError::Conflict) => {
            conflict("client_message_id was already used for different content")
        }
        Err(crate::db::SocialMessagingError::Database(error)) => {
            tracing::error!(%error, "failed to send Socials message");
            unavailable()
        }
    }
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
            .max_frame_size(MAX_MESSAGE_BYTES + 1024)
            .max_message_size(MAX_MESSAGE_BYTES + 1024)
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
    let mut frame_window_started = Instant::now();
    let mut frames_in_window = 0u32;

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
                        if frame_window_started.elapsed().as_secs() >= 60 {
                            frame_window_started = Instant::now();
                            frames_in_window = 0;
                        }
                        frames_in_window = frames_in_window.saturating_add(1);
                        if frames_in_window > MAX_WS_FRAMES_PER_MINUTE
                            || clerk::account_access_error(&state, &user_id).is_some()
                        {
                            let error = serde_json::json!({
                                "type": "error",
                                "code": "policy_closed",
                                "message": "realtime session is no longer authorized",
                            });
                            let _ = socket.send(Message::Text(
                                serde_json::to_string(&error).unwrap().into()
                            )).await;
                            break;
                        }
                        match parse_social_ws_client_message(&text) {
                            Ok(SocialWsClientMessage::Subscribe { conversationId }) => {
                                if !valid_opaque_id(&conversationId, MAX_PROFILE_ID_BYTES)
                                    || (active_conversations.len() >= MAX_WS_SUBSCRIPTIONS
                                        && !active_conversations.iter().any(|id| id == &conversationId))
                                {
                                    let error = serde_json::json!({
                                        "type": "error",
                                        "code": "subscription_limit",
                                        "message": "invalid conversation or subscription limit reached",
                                    });
                                    let _ = socket.send(Message::Text(
                                        serde_json::to_string(&error).unwrap().into()
                                    )).await;
                                    continue;
                                }
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
                                                profile_id: pid.clone(),
                                                tx: tx.clone(),
                                            },
                                        )
                                        .await;
                                    active_conversations.push(conversationId.clone());
                                }
                                let still_authorized = state.db.as_ref()
                                    .map(|database| conversation_is_accessible(
                                        database, &conversationId, pid,
                                    ))
                                    .unwrap_or(false);
                                if !still_authorized {
                                    state.unsubscribe_dm(&conversationId, sub_id).await;
                                    active_conversations.retain(|id| id != &conversationId);
                                    continue;
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
                                if !valid_opaque_id(&conversationId, MAX_PROFILE_ID_BYTES) {
                                    continue;
                                }
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
    #[test]
    fn message_content_limits_are_unicode_and_byte_aware() {
        assert_eq!(
            normalize_message_content("  hello\r\nworld  ").unwrap(),
            "hello\nworld"
        );
        assert!(normalize_message_content("   \n\t  ").is_err());
        assert!(normalize_message_content(&"a".repeat(MAX_MESSAGE_CHARS)).is_ok());
        assert!(normalize_message_content(&"a".repeat(MAX_MESSAGE_CHARS + 1)).is_err());
        assert!(normalize_message_content("hello\u{0000}world").is_err());
        assert!(normalize_message_content("hello\u{0007}world").is_err());
        assert!(normalize_message_content("line one\n\tline two").is_ok());

        let multibyte_at_limit = "\u{1F980}".repeat(MAX_MESSAGE_CHARS);
        assert_eq!(multibyte_at_limit.len(), 16_000);
        assert!(normalize_message_content(&multibyte_at_limit).is_ok());
        assert!(normalize_message_content(
            &(multibyte_at_limit + "\u{1F980}")
        ).is_err());
    }

    #[test]
    fn message_cursor_is_randomized_tamper_evident_and_context_bound() {
        let cursor = MessageCursor {
            conversation_id: "conversation-1234".into(),
            profile_id: "profile-1234".into(),
            before_sequence: 42,
        };
        let first = encode_message_cursor(&cursor).expect("cursor key");
        let second = encode_message_cursor(&cursor).expect("cursor key");
        assert_ne!(first, second);
        assert_eq!(
            decode_message_cursor(&first, "conversation-1234", "profile-1234"),
            Some(42),
        );
        assert_eq!(
            decode_message_cursor(&first, "other-conversation", "profile-1234"),
            None,
        );
        assert_eq!(
            decode_message_cursor(&first, "conversation-1234", "other-profile"),
            None,
        );

        let mut tampered = first.into_bytes();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == b'A' { b'B' } else { b'A' };
        let tampered = String::from_utf8(tampered).unwrap();
        assert_eq!(
            decode_message_cursor(&tampered, "conversation-1234", "profile-1234"),
            None,
        );
    }

    #[test]
    fn messaging_json_responses_are_private_and_not_cached() {
        let response = ok(serde_json::json!({ "ok": true })).into_response();
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "private, no-store"
        );
    }
}
