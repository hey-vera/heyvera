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

/// Both extractors are kept although the handler no longer reads them: `ClerkUser`
/// is what authenticates the request, so dropping it would silently make this
/// endpoint public.
pub async fn auth_start(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(req): Json<AuthStartRequest>,
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    let provider = req.provider.to_lowercase();
    // Operator-funded API keys are the only supported credential. Anything else
    // is rejected below, so an omitted type means `api_key` rather than the
    // subscription flow this endpoint used to default to.
    let cred_type = req.credential_type.as_deref().unwrap_or("api_key");

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

    if cred_type != "api_key" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "unsupported credential_type `{cred_type}` — Cortex only accepts API keys. \
                     Provider subscription credentials are not supported in third-party tools."
                ),
            }),
        ));
    }

    let (auth_url, message) = match provider_normalized {
        "claude" => (
            "https://console.anthropic.com/settings/keys",
            "Create an API key at Anthropic Console and paste it in the next step.",
        ),
        _ => (
            "https://platform.openai.com/api-keys",
            "Create an API key at OpenAI and paste it in the next step.",
        ),
    };

    Ok(Json(AuthStartResponse {
        provider: provider_normalized.into(),
        auth_url: Some(auth_url.into()),
        message: message.into(),
    }))
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

    // Mirrors `auth_start`: API keys are the only credential Cortex accepts, so
    // an omitted type means `api_key` and anything else is refused outright.
    let credential_type = req.credential_type.as_deref().unwrap_or("api_key");
    if credential_type != "api_key" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "unsupported credential_type `{credential_type}` — Cortex only accepts API keys. \
                     Provider subscription credentials are not supported in third-party tools."
                ),
            }),
        ));
    }

    let code = req.code.trim();
    if code.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "code cannot be empty".into() }),
        ));
    }

    let encrypted = crate::crypto::encrypt(code).map_err(|e| {
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

    db.audit_log(
        &user.user_id, "user", "credential.created",
        Some("credential"), Some(&cred_id),
        Some(&format!("{{\"provider\":\"{provider_normalized}\",\"type\":\"{credential_type}\"}}")),
        None,
    );

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

    // Check if this is a subscription credential — if so, clean up the container
    if let Some((cred, _)) = db.get_credential(&req.credential_id) {
        if cred.credential_type == "subscription" {
            if let Some(cm) = &state.container_manager {
                if let Some(container) = db.get_user_container(&user.user_id) {
                    let _ = cm.remove_container(&container.container_id).await;
                    db.delete_user_container(&user.user_id);
                    tracing::info!(user_id = %user.user_id, "removed BYOS container on credential delete");
                }
            }
        }
    }

    let deleted = db.delete_credential(&user.user_id, &req.credential_id);
    if deleted {
        db.audit_log(
            &user.user_id, "user", "credential.deleted",
            Some("credential"), Some(&req.credential_id), None, None,
        );
    }
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
