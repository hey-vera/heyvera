use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use axum::extract::FromRef;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::{Notify, RwLock};

use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct ClerkUser {
    pub user_id: String,
}

fn local_auth_allowed() -> bool {
    std::env::var("CORTEX_AUTH_DISABLED")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// True when we must fail closed without Clerk (misconfigured prod).
fn is_production_runtime() -> bool {
    for key in ["HEYVERA_ENV", "APP_ENV", "RUST_ENV", "CORTEX_ENV"] {
        if let Ok(v) = std::env::var(key) {
            if v.eq_ignore_ascii_case("production") || v.eq_ignore_ascii_case("prod") {
                return true;
            }
        }
    }
    std::env::var("HEYVERA_REQUIRE_AUTH")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Block suspended/deleted accounts after JWT verification.
fn reject_if_account_blocked(
    app_state: &AppState,
    user_id: &str,
) -> Result<(), (StatusCode, Json<ErrorResponse>)> {
    if user_id == "local" {
        return Ok(());
    }
    let Some(db) = app_state.db.as_ref() else {
        return Ok(());
    };
    match db.get_account_status(user_id).as_deref() {
        Some("suspended") => Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "account suspended".into(),
            }),
        )),
        Some("deleted") => Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "account deleted".into(),
            }),
        )),
        _ => Ok(()),
    }
}

/// Configurable TTL for the JWKS cache (default 5 minutes).
fn jwks_ttl_secs() -> u64 {
    std::env::var("CORTEX_JWKS_TTL_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(300)
}

/// Expected issuer prefix for Clerk JWTs.
fn clerk_issuer_prefix() -> Option<String> {
    std::env::var("CLERK_ISSUER").ok()
}

/// Authorized party (azp) claim — the Clerk frontend API key or app ID.
fn clerk_authorized_party() -> Option<String> {
    std::env::var("CLERK_AUTHORIZED_PARTY").ok()
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ClerkClaims {
    sub: String,
    exp: usize,
    /// Issuer — should match the Clerk instance URL.
    #[serde(default)]
    iss: Option<String>,
    /// Authorized party — frontend app that generated the token.
    #[serde(default)]
    azp: Option<String>,
    #[serde(flatten)]
    _extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct JwksResponse {
    keys: Vec<JwkKey>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JwkKey {
    kid: String,
    kty: String,
    n: String,
    e: String,
}

#[derive(Debug, Clone)]
pub struct JwksCache {
    keys: Vec<JwkKey>,
    fetched_at: std::time::Instant,
}

impl JwksCache {
    pub fn empty() -> Self {
        Self {
            keys: Vec::new(),
            fetched_at: std::time::Instant::now() - std::time::Duration::from_secs(7200),
        }
    }

    fn is_stale(&self) -> bool {
        self.fetched_at.elapsed() > std::time::Duration::from_secs(jwks_ttl_secs())
    }
}

/// Stampede guard: prevents multiple concurrent JWKS fetches.
/// When a cache miss occurs, the first caller fetches while others wait on the Notify.
pub struct JwksStampedeGuard {
    pub fetching: AtomicBool,
    pub notify: Notify,
}

impl JwksStampedeGuard {
    pub fn new() -> Self {
        Self {
            fetching: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }
}

pub async fn fetch_jwks(clerk_secret_key: &str) -> Result<Vec<JwkKey>, String> {
    let start = std::time::Instant::now();
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.clerk.com/v1/jwks")
        .bearer_auth(clerk_secret_key)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(
                method = "jwks_fetch",
                duration_ms = start.elapsed().as_millis() as u64,
                error = %e,
                "JWKS fetch failed"
            );
            format!("JWKS fetch failed: {e}")
        })?;

    if !res.status().is_success() {
        let status = res.status();
        tracing::warn!(
            method = "jwks_fetch",
            duration_ms = start.elapsed().as_millis() as u64,
            http_status = status.as_u16(),
            "JWKS fetch returned non-success status"
        );
        return Err(format!("JWKS fetch returned {}", status));
    }

    let jwks: JwksResponse = res.json().await.map_err(|e| format!("JWKS parse failed: {e}"))?;
    tracing::info!(
        method = "jwks_fetch",
        duration_ms = start.elapsed().as_millis() as u64,
        key_count = jwks.keys.len(),
        "JWKS refresh"
    );
    Ok(jwks.keys)
}

async fn get_or_refresh_jwks(
    cache: &RwLock<JwksCache>,
    stampede: &JwksStampedeGuard,
    clerk_secret_key: &str,
    force: bool,
) -> Result<Vec<JwkKey>, String> {
    // Fast path: return cached keys if fresh
    {
        let c = cache.read().await;
        if !force && !c.is_stale() && !c.keys.is_empty() {
            return Ok(c.keys.clone());
        }
    }

    // Stampede protection: only one caller fetches, others wait
    if stampede.fetching.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        // We won the race — fetch JWKS
        let result = fetch_jwks(clerk_secret_key).await;
        match result {
            Ok(keys) => {
                let mut c = cache.write().await;
                c.keys = keys.clone();
                c.fetched_at = std::time::Instant::now();
                drop(c);
                stampede.fetching.store(false, Ordering::SeqCst);
                stampede.notify.notify_waiters();
                Ok(keys)
            }
            Err(e) => {
                stampede.fetching.store(false, Ordering::SeqCst);
                stampede.notify.notify_waiters();
                Err(e)
            }
        }
    } else {
        // Another caller is fetching — wait for notification then read cache
        stampede.notify.notified().await;
        let c = cache.read().await;
        if c.keys.is_empty() {
            Err("JWKS fetch by another request failed".to_string())
        } else {
            Ok(c.keys.clone())
        }
    }
}

pub async fn get_or_refresh_jwks_pub(
    cache: &RwLock<JwksCache>,
    stampede: &JwksStampedeGuard,
    clerk_secret_key: &str,
    force: bool,
) -> Result<Vec<JwkKey>, String> {
    get_or_refresh_jwks(cache, stampede, clerk_secret_key, force).await
}

pub fn verify_token_pub(token: &str, keys: &[JwkKey]) -> Result<String, String> {
    verify_token(token, keys).map(|claims| claims.sub)
}

fn verify_token(token: &str, keys: &[JwkKey]) -> Result<ClerkClaims, String> {
    let header = decode_header(token).map_err(|e| format!("invalid JWT header: {e}"))?;
    let kid = header.kid.ok_or("JWT missing kid")?;

    let key = keys
        .iter()
        .find(|k| k.kid == kid)
        .ok_or_else(|| format!("no JWK matching kid={kid}"))?;

    if key.kty != "RSA" {
        return Err(format!("unsupported key type: {}", key.kty));
    }

    let decoding_key = DecodingKey::from_rsa_components(&key.n, &key.e)
        .map_err(|e| format!("invalid RSA components: {e}"))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_required_spec_claims(&["exp", "sub"]);
    validation.validate_exp = true;
    validation.validate_aud = false;

    // If CLERK_ISSUER is set, validate the issuer claim
    if let Some(expected_iss) = clerk_issuer_prefix() {
        validation.set_issuer(&[&expected_iss]);
    }

    let token_data = decode::<ClerkClaims>(token, &decoding_key, &validation)
        .map_err(|e| format!("JWT verification failed: {e}"))?;

    // Validate authorized party (azp) if configured
    if let Some(expected_azp) = clerk_authorized_party() {
        match &token_data.claims.azp {
            Some(azp) if azp == &expected_azp => {}
            Some(azp) => {
                return Err(format!("JWT azp mismatch: expected {expected_azp}, got {azp}"));
            }
            None => {
                return Err("JWT missing azp claim".to_string());
            }
        }
    }

    Ok(token_data.claims)
}

/// Verify a Clerk JWT and return the user_id. Called by the Soma auth layer
/// for backward-compatible Clerk JWT authentication.
pub async fn verify_clerk_jwt(token: &str, state: &Arc<AppState>) -> Result<String, String> {
    let clerk_secret = state
        .clerk_secret_key
        .as_ref()
        .ok_or("clerk auth not configured")?;

    let keys = get_or_refresh_jwks(&state.jwks_cache, &state.jwks_stampede, clerk_secret, false).await?;
    match verify_token(token, &keys) {
        Ok(claims) => Ok(claims.sub),
        Err(_) => {
            let keys = get_or_refresh_jwks(&state.jwks_cache, &state.jwks_stampede, clerk_secret, true).await?;
            verify_token(token, &keys).map(|c| c.sub)
        }
    }
}

impl<S> FromRequestParts<S> for ClerkUser
where
    Arc<AppState>: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state: Arc<AppState> = Arc::from_ref(state);

        // Try Soma auth first — if the header starts with "Soma ", delegate to extract_identity
        let raw_auth = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        if let Some(ref header) = raw_auth {
            if header.starts_with("Soma ") {
                match crate::soma::extract_identity(parts, &app_state).await {
                    Ok(identity) => {
                        reject_if_account_blocked(&app_state, &identity.user_id)?;
                        return Ok(ClerkUser {
                            user_id: identity.user_id,
                        });
                    }
                    Err(e) => {
                        let msg = format!("{e:?}");
                        return Err((
                            StatusCode::UNAUTHORIZED,
                            Json(ErrorResponse { error: msg }),
                        ));
                    }
                }
            }
        }

        let clerk_secret = match &app_state.clerk_secret_key {
            Some(key) => key.clone(),
            None => {
                // No Clerk secret: local/dev only. Production must fail closed.
                if is_production_runtime() && !local_auth_allowed() {
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: "clerk auth not configured".into(),
                        }),
                    ));
                }
                return Ok(ClerkUser {
                    user_id: "local".to_string(),
                });
            }
        };

        let token = match raw_auth.as_deref().and_then(|v| v.strip_prefix("Bearer ")) {
            Some(t) => t.to_string(),
            None => {
                if local_auth_allowed() {
                    return Ok(ClerkUser {
                        user_id: "local".to_string(),
                    });
                }
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse { error: "bearer token required".into() }),
                ));
            }
        };

        // Try with cached JWKS first (with stampede protection)
        let keys = get_or_refresh_jwks(&app_state.jwks_cache, &app_state.jwks_stampede, &clerk_secret, false)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse { error: e }),
                )
            })?;

        match verify_token(&token, &keys) {
            Ok(claims) => {
                reject_if_account_blocked(&app_state, &claims.sub)?;
                Ok(ClerkUser {
                    user_id: claims.sub,
                })
            }
            Err(_first_err) => {
                // Key rotation: retry with fresh JWKS
                let keys = match get_or_refresh_jwks(&app_state.jwks_cache, &app_state.jwks_stampede, &clerk_secret, true).await {
                    Ok(keys) => keys,
                    Err(_) => {
                        return Err((
                            StatusCode::SERVICE_UNAVAILABLE,
                            Json(ErrorResponse { error: "clerk jwks unavailable".into() }),
                        ));
                    }
                };

                let claims = verify_token(&token, &keys).map_err(|_| {
                    (
                        StatusCode::UNAUTHORIZED,
                        Json(ErrorResponse {
                            error: "invalid bearer token".into(),
                        }),
                    )
                })?;
                reject_if_account_blocked(&app_state, &claims.sub)?;
                Ok(ClerkUser {
                    user_id: claims.sub,
                })
            }
        }
    }
}
