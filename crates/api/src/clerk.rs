use std::sync::Arc;

use axum::extract::FromRef;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct ClerkUser {
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ClerkClaims {
    sub: String,
    exp: usize,
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
        self.fetched_at.elapsed() > std::time::Duration::from_secs(3600)
    }
}

pub async fn fetch_jwks(clerk_secret_key: &str) -> Result<Vec<JwkKey>, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.clerk.com/v1/jwks")
        .bearer_auth(clerk_secret_key)
        .send()
        .await
        .map_err(|e| format!("JWKS fetch failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("JWKS fetch returned {}", res.status()));
    }

    let jwks: JwksResponse = res.json().await.map_err(|e| format!("JWKS parse failed: {e}"))?;
    Ok(jwks.keys)
}

async fn get_or_refresh_jwks(
    cache: &RwLock<JwksCache>,
    clerk_secret_key: &str,
    force: bool,
) -> Result<Vec<JwkKey>, String> {
    {
        let c = cache.read().await;
        if !force && !c.is_stale() && !c.keys.is_empty() {
            return Ok(c.keys.clone());
        }
    }

    let keys = fetch_jwks(clerk_secret_key).await?;
    let mut c = cache.write().await;
    c.keys = keys.clone();
    c.fetched_at = std::time::Instant::now();
    Ok(keys)
}

pub async fn get_or_refresh_jwks_pub(
    cache: &RwLock<JwksCache>,
    clerk_secret_key: &str,
    force: bool,
) -> Result<Vec<JwkKey>, String> {
    get_or_refresh_jwks(cache, clerk_secret_key, force).await
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

    let token_data = decode::<ClerkClaims>(token, &decoding_key, &validation)
        .map_err(|e| format!("JWT verification failed: {e}"))?;

    Ok(token_data.claims)
}

/// Verify a Clerk JWT and return the user_id. Called by the Soma auth layer
/// for backward-compatible Clerk JWT authentication.
pub async fn verify_clerk_jwt(token: &str, state: &Arc<AppState>) -> Result<String, String> {
    let clerk_secret = state
        .clerk_secret_key
        .as_ref()
        .ok_or("clerk auth not configured")?;

    let keys = get_or_refresh_jwks(&state.jwks_cache, clerk_secret, false).await?;
    match verify_token(token, &keys) {
        Ok(claims) => Ok(claims.sub),
        Err(_) => {
            let keys = get_or_refresh_jwks(&state.jwks_cache, clerk_secret, true).await?;
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
                if raw_auth.is_some() {
                    return Err((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(ErrorResponse {
                            error: "CLERK_SECRET_KEY not configured — cannot verify token".to_string(),
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
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        error: "missing authorization header".to_string(),
                    }),
                ));
            }
        };

        // Try with cached JWKS first
        let keys = get_or_refresh_jwks(&app_state.jwks_cache, &clerk_secret, false)
            .await
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse { error: e }),
                )
            })?;

        match verify_token(&token, &keys) {
            Ok(claims) => Ok(ClerkUser {
                user_id: claims.sub,
            }),
            Err(_first_err) => {
                // Key rotation: retry with fresh JWKS
                let keys = get_or_refresh_jwks(&app_state.jwks_cache, &clerk_secret, true)
                    .await
                    .map_err(|e| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(ErrorResponse { error: e }),
                        )
                    })?;

                verify_token(&token, &keys)
                    .map(|claims| ClerkUser {
                        user_id: claims.sub,
                    })
                    .map_err(|e| {
                        (
                            StatusCode::UNAUTHORIZED,
                            Json(ErrorResponse { error: e }),
                        )
                    })
            }
        }
    }
}
