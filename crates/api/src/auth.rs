use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Serialize)]
pub struct ProviderAuthInfo {
    pub provider: String,
    pub credential_type: String,
    pub label: Option<String>,
    pub authenticated: bool,
    pub email: Option<String>,
    pub is_default: bool,
    pub credential_id: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct AuthStartResponse {
    pub provider: String,
    pub auth_url: Option<String>,
    pub device_code: Option<String>,
    pub message: String,
}

#[derive(Deserialize)]
pub struct AuthStartRequest {
    pub provider: String,
    #[serde(default)]
    pub credential_type: Option<String>,
}

#[derive(Deserialize)]
pub struct AuthSubmitRequest {
    pub provider: String,
    pub code: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub credential_type: Option<String>,
}

#[derive(Serialize)]
pub struct AuthSubmitResponse {
    pub success: bool,
    pub message: String,
    pub credential_id: Option<String>,
}

#[derive(Deserialize)]
pub struct CredentialDeleteRequest {
    pub credential_id: String,
}

#[derive(Deserialize)]
pub struct SetDefaultRequest {
    pub credential_id: String,
}

pub async fn auth_status(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Json<Vec<ProviderAuthInfo>> {
    let db = match &state.db {
        Some(db) => db,
        None => return Json(vec![]),
    };

    let creds = db.list_credentials(&user.user_id);
    let results: Vec<ProviderAuthInfo> = creds
        .into_iter()
        .map(|c| ProviderAuthInfo {
            provider: c.provider,
            credential_type: c.credential_type,
            label: c.label,
            authenticated: c.status == "active",
            email: c.email,
            is_default: c.is_default,
            credential_id: c.id,
            status: c.status,
        })
        .collect();

    Json(results)
}

pub async fn auth_start(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<AuthStartRequest>,
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    let provider = req.provider.to_lowercase();
    let cred_type = req.credential_type.as_deref().unwrap_or("subscription");

    match (provider.as_str(), cred_type) {
        ("claude", "subscription") => Ok(Json(AuthStartResponse {
            provider: "claude".into(),
            auth_url: Some("https://console.anthropic.com/settings/keys".into()),
            device_code: None,
            message: "Open the link and copy your session token or API key. Paste it in the next step.".into(),
        })),
        ("openai" | "codex", "subscription") => Ok(Json(AuthStartResponse {
            provider: "openai".into(),
            auth_url: Some("https://platform.openai.com/account/api-keys".into()),
            device_code: None,
            message: "Open the link to authorize. Copy the code shown and paste it in the next step.".into(),
        })),
        ("claude", "api_key") => Ok(Json(AuthStartResponse {
            provider: "claude".into(),
            auth_url: Some("https://console.anthropic.com/settings/keys".into()),
            device_code: None,
            message: "Create an API key at Anthropic Console and paste it in the next step.".into(),
        })),
        ("openai" | "codex", "api_key") => Ok(Json(AuthStartResponse {
            provider: "openai".into(),
            auth_url: Some("https://platform.openai.com/api-keys".into()),
            device_code: None,
            message: "Create an API key at OpenAI and paste it in the next step.".into(),
        })),
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unknown provider: {}", req.provider),
            }),
        )),
    }
}

pub async fn auth_submit(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<AuthSubmitRequest>,
) -> Result<Json<AuthSubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: "database unavailable".into() }),
        )
    })?;

    let provider = req.provider.to_lowercase();
    let provider_normalized = match provider.as_str() {
        "claude" | "anthropic" => "claude",
        "openai" | "codex" => "openai",
        other => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse { error: format!("unknown provider: {other}") }),
            ));
        }
    };

    let credential_type = req.credential_type.as_deref().unwrap_or("subscription");
    let code = req.code.trim();
    if code.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "code cannot be empty".into() }),
        ));
    }

    // Build the data blob to encrypt
    let data_to_encrypt = match credential_type {
        "api_key" => code.to_string(),
        "subscription" => {
            serde_json::json!({
                "auth_code": code,
                "provider": provider_normalized,
                "authed_at": chrono::Utc::now().timestamp(),
            }).to_string()
        }
        _ => code.to_string(),
    };

    let encrypted = crate::crypto::encrypt(&data_to_encrypt).map_err(|e| {
        tracing::error!("encryption failed: {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: "failed to encrypt credential".into() }),
        )
    })?;

    let now = chrono::Utc::now().timestamp();
    let cred_id = Uuid::new_v4().to_string();

    let cred = crate::db::UserCredential {
        id: cred_id.clone(),
        user_id: user.user_id.clone(),
        provider: provider_normalized.to_string(),
        credential_type: credential_type.to_string(),
        label: req.label.or_else(|| Some(format!("{} {}", provider_normalized, credential_type))),
        email: None,
        is_default: db.list_credentials(&user.user_id)
            .iter()
            .filter(|c| c.provider == provider_normalized)
            .count() == 0,
        status: "active".to_string(),
        last_used_at: None,
        token_expires_at: None,
        created_at: now,
        updated_at: now,
    };

    db.insert_credential_with_data(&cred, &encrypted);

    tracing::info!(
        user_id = %user.user_id,
        provider = provider_normalized,
        credential_type,
        credential_id = %cred_id,
        "credential stored"
    );

    Ok(Json(AuthSubmitResponse {
        success: true,
        message: format!("{} {} connected successfully", provider_normalized, credential_type),
        credential_id: Some(cred_id),
    }))
}

pub async fn auth_refresh(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Result<Json<Vec<ProviderAuthInfo>>, (StatusCode, Json<ErrorResponse>)> {
    Ok(auth_status(State(state), user).await)
}

pub async fn credential_delete(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<CredentialDeleteRequest>,
) -> Result<Json<AuthSubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: "database unavailable".into() }),
        )
    })?;

    let deleted = db.delete_credential(&user.user_id, &req.credential_id);
    Ok(Json(AuthSubmitResponse {
        success: deleted,
        message: if deleted {
            "credential removed".into()
        } else {
            "credential not found".into()
        },
        credential_id: None,
    }))
}

pub async fn credential_set_default(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<SetDefaultRequest>,
) -> Result<Json<AuthSubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
    let db = state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: "database unavailable".into() }),
        )
    })?;

    db.set_default_credential(&user.user_id, &req.credential_id);
    Ok(Json(AuthSubmitResponse {
        success: true,
        message: "default credential updated".into(),
        credential_id: Some(req.credential_id),
    }))
}
