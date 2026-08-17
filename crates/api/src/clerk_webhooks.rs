//! Clerk webhook processing — receives Clerk events via svix-signed webhooks.
//!
//! Endpoint: `POST /api/clerk/webhooks`
//!
//! Handles:
//! - `user.created` — creates an internal account record
//! - `user.updated` — updates account metadata
//! - `user.deleted` — marks account as deleted
//!
//! All processing is idempotent: duplicate event IDs are detected and skipped.

use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::state::AppState;

/// Svix webhook signature headers.
const SVIX_ID_HEADER: &str = "svix-id";
const SVIX_TIMESTAMP_HEADER: &str = "svix-timestamp";
const SVIX_SIGNATURE_HEADER: &str = "svix-signature";

/// Maximum age of a webhook event (5 minutes) to prevent replay attacks.
const MAX_TIMESTAMP_AGE_SECS: i64 = 300;

/// Clerk webhook event envelope.
#[derive(Debug, Deserialize)]
struct WebhookEvent {
    /// Event type, e.g. "user.created", "user.updated", "user.deleted"
    #[serde(rename = "type")]
    event_type: String,
    /// Event payload — the actual user data
    data: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct WebhookResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// `POST /api/clerk/webhooks` — receive and process Clerk webhook events.
pub async fn clerk_webhook(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    // 1. Extract webhook signing secret
    let webhook_secret = match std::env::var("CLERK_WEBHOOK_SECRET") {
        Ok(s) if !s.is_empty() => s,
        _ => {
            tracing::warn!("clerk webhook received but CLERK_WEBHOOK_SECRET not configured");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("webhook secret not configured".into()),
                }),
            );
        }
    };

    // 2. Extract svix headers
    let svix_id = match headers.get(SVIX_ID_HEADER).and_then(|v| v.to_str().ok()) {
        Some(id) => id.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("missing svix-id header".into()),
                }),
            );
        }
    };

    let svix_timestamp = match headers
        .get(SVIX_TIMESTAMP_HEADER)
        .and_then(|v| v.to_str().ok())
    {
        Some(ts) => ts.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("missing svix-timestamp header".into()),
                }),
            );
        }
    };

    let svix_signature = match headers
        .get(SVIX_SIGNATURE_HEADER)
        .and_then(|v| v.to_str().ok())
    {
        Some(sig) => sig.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("missing svix-signature header".into()),
                }),
            );
        }
    };

    // 3. Verify timestamp freshness (prevent replay attacks)
    let timestamp_secs: i64 = match svix_timestamp.parse() {
        Ok(ts) => ts,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("invalid svix-timestamp".into()),
                }),
            );
        }
    };

    let now = chrono::Utc::now().timestamp();
    if (now - timestamp_secs).abs() > MAX_TIMESTAMP_AGE_SECS {
        return (
            StatusCode::BAD_REQUEST,
            Json(WebhookResponse {
                status: "error".into(),
                message: Some("webhook timestamp too old or too far in the future".into()),
            }),
        );
    }

    // 4. Verify svix signature
    if let Err(e) = verify_svix_signature(
        &webhook_secret,
        &svix_id,
        &svix_timestamp,
        &body,
        &svix_signature,
    ) {
        tracing::warn!("clerk webhook signature verification failed: {e}");
        return (
            StatusCode::UNAUTHORIZED,
            Json(WebhookResponse {
                status: "error".into(),
                message: Some("invalid webhook signature".into()),
            }),
        );
    }

    // 5. Parse event
    let event: WebhookEvent = match serde_json::from_slice(&body) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("clerk webhook: failed to parse event body: {e}");
            return (
                StatusCode::BAD_REQUEST,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("invalid event body".into()),
                }),
            );
        }
    };

    // 6. Idempotency check — skip if we already processed this event
    let db = match &state.db {
        Some(db) => db,
        None => {
            tracing::error!("clerk webhook: database not available");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some("database unavailable".into()),
                }),
            );
        }
    };

    if db.is_webhook_event_processed(&svix_id) {
        tracing::info!("clerk webhook: duplicate event {svix_id}, skipping");
        return (
            StatusCode::OK,
            Json(WebhookResponse {
                status: "duplicate".into(),
                message: Some("event already processed".into()),
            }),
        );
    }

    // 7. Process event by type
    let result = match event.event_type.as_str() {
        "user.created" => handle_user_created(db, &event.data),
        "user.updated" => handle_user_updated(db, &event.data),
        "user.deleted" => handle_user_deleted(db, &event.data),
        other => {
            tracing::debug!("clerk webhook: ignoring event type {other}");
            Ok(())
        }
    };

    match result {
        Ok(()) => {
            // Record successful processing
            db.record_webhook_event(&svix_id, &event.event_type, timestamp_secs);
            tracing::info!(
                "clerk webhook: processed {} (id={})",
                event.event_type,
                svix_id
            );
            (
                StatusCode::OK,
                Json(WebhookResponse {
                    status: "processed".into(),
                    message: None,
                }),
            )
        }
        Err(e) => {
            tracing::error!("clerk webhook: failed to process {}: {e}", event.event_type);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(WebhookResponse {
                    status: "error".into(),
                    message: Some(format!("processing failed: {e}")),
                }),
            )
        }
    }
}

/// Verify the svix webhook signature using HMAC-SHA256.
///
/// The signature is computed over "{msg_id}.{timestamp}.{body}" using the
/// webhook secret (base64-decoded after stripping the "whsec_" prefix).
fn verify_svix_signature(
    secret: &str,
    msg_id: &str,
    timestamp: &str,
    body: &[u8],
    signature_header: &str,
) -> Result<(), String> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    // Clerk webhook secrets are prefixed with "whsec_" and base64-encoded
    let secret_bytes = {
        let raw = secret.strip_prefix("whsec_").unwrap_or(secret);
        base64_decode(raw).map_err(|e| format!("invalid webhook secret encoding: {e}"))?
    };

    // Construct the signed content: "{msg_id}.{timestamp}.{body}"
    let body_str = std::str::from_utf8(body).map_err(|e| format!("body not utf8: {e}"))?;
    let signed_content = format!("{msg_id}.{timestamp}.{body_str}");

    let mut mac = Hmac::<Sha256>::new_from_slice(&secret_bytes)
        .map_err(|e| format!("HMAC key error: {e}"))?;
    mac.update(signed_content.as_bytes());
    let expected = mac.finalize().into_bytes();
    let expected_b64 = base64_encode(&expected);

    // The signature header may contain multiple signatures separated by spaces,
    // each prefixed with "v1,"
    for sig_entry in signature_header.split(' ') {
        if let Some(sig_b64) = sig_entry.strip_prefix("v1,") {
            if constant_time_eq(sig_b64.as_bytes(), expected_b64.as_bytes()) {
                return Ok(());
            }
        }
    }

    Err("no matching signature found".to_string())
}

/// Constant-time byte comparison to prevent timing attacks.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Standard base64 decode (for webhook secret).
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    static TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut s = input.to_string();
    // Add padding if needed
    while s.len() % 4 != 0 {
        s.push('=');
    }

    let bytes = s.as_bytes();
    let mut output = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        if chunk.len() != 4 {
            return Err("invalid base64 length".into());
        }
        let mut buf = [0u8; 4];
        let mut pad = 0;
        for (i, &b) in chunk.iter().enumerate() {
            if b == b'=' {
                buf[i] = 0;
                pad += 1;
            } else if let Some(pos) = TABLE.iter().position(|&c| c == b) {
                buf[i] = pos as u8;
            } else {
                return Err(format!("invalid base64 character: {}", b as char));
            }
        }
        output.push((buf[0] << 2) | (buf[1] >> 4));
        if pad < 2 {
            output.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if pad < 1 {
            output.push((buf[2] << 6) | buf[3]);
        }
    }

    Ok(output)
}

/// Standard base64 encode (for computing expected signature).
fn base64_encode(input: &[u8]) -> String {
    static TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut output = String::with_capacity((input.len() + 2) / 3 * 4);

    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 {
            chunk[1] as usize
        } else {
            0
        };
        let b2 = if chunk.len() > 2 {
            chunk[2] as usize
        } else {
            0
        };

        output.push(TABLE[(b0 >> 2)] as char);
        output.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);

        if chunk.len() > 1 {
            output.push(TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char);
        } else {
            output.push('=');
        }

        if chunk.len() > 2 {
            output.push(TABLE[b2 & 0x3f] as char);
        } else {
            output.push('=');
        }
    }

    output
}

// --- Event handlers ---

fn handle_user_created(db: &crate::db::Database, data: &serde_json::Value) -> Result<(), String> {
    let clerk_user_id = data
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("user.created: missing id")?;

    let email = data
        .get("email_addresses")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|e| e.get("email_address"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let first_name = data
        .get("first_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let last_name = data.get("last_name").and_then(|v| v.as_str()).unwrap_or("");
    let display_name = format!("{first_name} {last_name}").trim().to_string();

    db.upsert_account(clerk_user_id, email, &display_name, "active");
    tracing::info!("clerk webhook: created account for {clerk_user_id}");
    Ok(())
}

fn handle_user_updated(db: &crate::db::Database, data: &serde_json::Value) -> Result<(), String> {
    let clerk_user_id = data
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("user.updated: missing id")?;

    let email = data
        .get("email_addresses")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|e| e.get("email_address"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let first_name = data
        .get("first_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let last_name = data.get("last_name").and_then(|v| v.as_str()).unwrap_or("");
    let display_name = format!("{first_name} {last_name}").trim().to_string();

    db.upsert_account(clerk_user_id, email, &display_name, "active");
    tracing::info!("clerk webhook: updated account for {clerk_user_id}");
    Ok(())
}

fn handle_user_deleted(db: &crate::db::Database, data: &serde_json::Value) -> Result<(), String> {
    let clerk_user_id = data
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("user.deleted: missing id")?;

    db.mark_account_deleted(clerk_user_id);
    tracing::info!("clerk webhook: marked account {clerk_user_id} as deleted");
    Ok(())
}
