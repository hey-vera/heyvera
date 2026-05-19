use std::sync::Arc;

use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use soma::delegation::{
    verify_delegation, verify_delegation_chain, Delegation, InvocationContext,
};
use soma::heartbeat::{HeartbeatChain, HeartbeatEventType};
use soma::identity::HeartIdentity;
use soma::lineage::HeartLineage;
use soma::spend::SpendLog;

use crate::state::AppState;

/// Cortex's own Soma heart identity — the agent's cryptographic self.
/// Created once at startup, used to sign heartbeats, birth certificates, and spend receipts.
pub struct CortexHeart {
    pub identity: HeartIdentity,
    pub heartbeat_chain: std::sync::Mutex<HeartbeatChain>,
    pub spend_logs: std::sync::Mutex<std::collections::HashMap<String, SpendLog>>,
    pub lineage: Option<HeartLineage>,
    pub root_did: Option<String>,
}

impl CortexHeart {
    pub fn new() -> Result<Self, soma::SomaError> {
        let heart_path = dirs_next::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join(".cortex")
            .join("soma-heart.json");
        let existed = heart_path.exists();
        let identity =
            HeartIdentity::load_or_create(&heart_path, "heyvera", "cortex-router", "cortex-v0.1")?;
        if existed {
            tracing::info!("soma heart loaded from {} — DID: {}", heart_path.display(), identity.did);
        } else {
            tracing::info!("soma heart created at {} — DID: {}", heart_path.display(), identity.did);
        }

        // Load lineage chain if available
        let lineage_path = heart_path.parent().unwrap().join("lineage.json");
        let (lineage, root_did) = if lineage_path.exists() {
            match std::fs::read_to_string(&lineage_path) {
                Ok(json) => match serde_json::from_str::<HeartLineage>(&json) {
                    Ok(l) => {
                        let root = l.root_did.clone();
                        match soma::lineage::verify_lineage_chain(&l) {
                            Ok(true) => {
                                let caps = soma::lineage::effective_capabilities(&l);
                                tracing::info!(
                                    "soma lineage verified — root: {}, capabilities: [{}]",
                                    root,
                                    caps.join(", ")
                                );
                                (Some(l), Some(root))
                            }
                            Ok(false) => {
                                tracing::warn!("soma lineage chain INVALID — running without lineage");
                                (None, None)
                            }
                            Err(e) => {
                                tracing::warn!("soma lineage verification error: {e}");
                                (None, None)
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("soma lineage parse error: {e}");
                        (None, None)
                    }
                },
                Err(e) => {
                    tracing::warn!("soma lineage read error: {e}");
                    (None, None)
                }
            }
        } else {
            tracing::info!("no soma lineage found at {} — running as standalone heart", lineage_path.display());
            (None, None)
        };

        Ok(Self {
            identity,
            heartbeat_chain: std::sync::Mutex::new(HeartbeatChain::new()),
            spend_logs: std::sync::Mutex::new(std::collections::HashMap::new()),
            lineage,
            root_did,
        })
    }

    /// Record a heartbeat event.
    pub fn record_heartbeat(
        &self,
        event_type: HeartbeatEventType,
        event_data: &str,
    ) -> soma::heartbeat::Heartbeat {
        self.heartbeat_chain
            .lock()
            .unwrap()
            .record(event_type, event_data)
    }

    /// Record a spend against a delegation.
    pub fn record_spend(
        &self,
        delegation_id: &str,
        amount: f64,
        capability: &str,
    ) -> Result<soma::spend::SpendReceipt, soma::SomaError> {
        let mut logs = self.spend_logs.lock().unwrap();
        let log = logs
            .entry(delegation_id.to_string())
            .or_insert_with(|| SpendLog::new(delegation_id));
        log.record(
            amount,
            capability,
            &self.identity.did,
            &self.identity.secret_key,
            &self.identity.public_key,
        )
    }

    /// Get cumulative spend for a delegation.
    pub fn cumulative_spend(&self, delegation_id: &str) -> f64 {
        let logs = self.spend_logs.lock().unwrap();
        logs.get(delegation_id)
            .map(|l| l.cumulative())
            .unwrap_or(0.0)
    }

    pub fn did(&self) -> &str {
        &self.identity.did
    }
}

/// The authenticated identity extracted from a request.
/// Supports three auth methods:
/// 1. Soma delegation token (preferred)
/// 2. Clerk JWT (legacy, for web UI users)
/// 3. API key (for programmatic access)
#[derive(Debug, Clone, Serialize)]
pub struct AuthenticatedIdentity {
    /// The user's identifier (Clerk user_id, DID, or API key hash)
    pub user_id: String,
    /// The auth method used
    pub method: AuthMethod,
    /// Soma DID (if authenticated via Soma delegation)
    pub did: Option<String>,
    /// Active delegation (if using Soma auth)
    pub delegation_id: Option<String>,
    /// Capabilities granted to this identity
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    SomaDelegation,
    ClerkJwt,
    ApiKey,
    Anonymous,
}

/// Soma delegation headers per SOMA-DELEGATION-SPEC.
const SOMA_AUTH_PREFIX: &str = "Soma ";
const SOMA_DELEGATION_CHAIN_HEADER: &str = "X-Soma-Delegation-Chain";

/// Extract an authenticated identity from the request.
/// Priority: Soma delegation > Clerk JWT > API key > anonymous (dev mode only)
pub async fn extract_identity(
    parts: &Parts,
    state: &Arc<AppState>,
) -> Result<AuthenticatedIdentity, AuthError> {
    let auth_header = parts
        .headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok());

    // 1. Check for Soma delegation token
    if let Some(header) = auth_header {
        if header.starts_with(SOMA_AUTH_PREFIX) {
            let token = &header[SOMA_AUTH_PREFIX.len()..];
            return verify_soma_token(token, parts, state).await;
        }
    }

    // 2. Check for Clerk JWT (Bearer token)
    if let Some(header) = auth_header {
        if header.starts_with("Bearer ") {
            let token = &header[7..];
            return verify_clerk_token(token, state).await;
        }
    }

    // 3. Check for API key
    if let Some(api_key) = parts.headers.get("X-Api-Key").and_then(|v| v.to_str().ok()) {
        return verify_api_key(api_key, state).await;
    }

    // 4. Anonymous access (dev mode only)
    let is_production = std::env::var("CORTEX_PRODUCTION")
        .ok()
        .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
    if !is_production {
        return Ok(AuthenticatedIdentity {
            user_id: "anonymous".into(),
            method: AuthMethod::Anonymous,
            did: None,
            delegation_id: None,
            capabilities: vec!["*".into()],
        });
    }

    Err(AuthError::Unauthorized(
        "no valid authentication provided".into(),
    ))
}

async fn verify_soma_token(
    token: &str,
    parts: &Parts,
    state: &Arc<AppState>,
) -> Result<AuthenticatedIdentity, AuthError> {
    // Parse the delegation token
    let delegation: Delegation = serde_json::from_str(token).map_err(|e| {
        AuthError::InvalidToken(format!("malformed soma delegation token: {e}"))
    })?;

    // Check for delegation chain header
    let chain_header = parts
        .headers
        .get(SOMA_DELEGATION_CHAIN_HEADER)
        .and_then(|v| v.to_str().ok());

    if let Some(chain_json) = chain_header {
        // Full chain verification
        let chain: Vec<Delegation> = serde_json::from_str(chain_json).map_err(|e| {
            AuthError::InvalidToken(format!("malformed delegation chain: {e}"))
        })?;

        let cortex_did = state
            .soma_heart
            .as_ref()
            .map(|h| h.did().to_string())
            .unwrap_or_default();

        let ctx = InvocationContext {
            invoker_did: delegation.subject_did.clone(),
            audience_did: Some(cortex_did),
            capability: "route:*".into(),
            ..Default::default()
        };

        let result = verify_delegation_chain(&chain, &ctx).map_err(|e| {
            AuthError::VerificationFailed(format!("chain verification error: {e}"))
        })?;

        if !result.is_valid() {
            return Err(AuthError::Unauthorized(format!(
                "delegation chain invalid: {result:?}"
            )));
        }
    } else {
        // Single delegation verification
        let cortex_did = state
            .soma_heart
            .as_ref()
            .map(|h| h.did().to_string())
            .unwrap_or_default();

        let ctx = InvocationContext {
            invoker_did: delegation.subject_did.clone(),
            audience_did: Some(cortex_did),
            capability: "route:*".into(),
            ..Default::default()
        };

        let result = verify_delegation(&delegation, &ctx).map_err(|e| {
            AuthError::VerificationFailed(format!("delegation verification error: {e}"))
        })?;

        if !result.is_valid() {
            return Err(AuthError::Unauthorized(format!(
                "delegation invalid: {result:?}"
            )));
        }
    }

    // Record heartbeat for the authenticated request
    if let Some(heart) = &state.soma_heart {
        heart.record_heartbeat(
            HeartbeatEventType::QueryReceived,
            &serde_json::json!({
                "delegation_id": delegation.id,
                "subject_did": delegation.subject_did,
                "capabilities": delegation.capabilities,
            })
            .to_string(),
        );
    }

    Ok(AuthenticatedIdentity {
        user_id: delegation.subject_did.clone(),
        method: AuthMethod::SomaDelegation,
        did: Some(delegation.subject_did),
        delegation_id: Some(delegation.id),
        capabilities: delegation.capabilities,
    })
}

async fn verify_clerk_token(
    token: &str,
    state: &Arc<AppState>,
) -> Result<AuthenticatedIdentity, AuthError> {
    // Delegate to existing Clerk verification
    let user_id = crate::clerk::verify_clerk_jwt(token, state)
        .await
        .map_err(|e| AuthError::Unauthorized(format!("clerk JWT invalid: {e}")))?;

    Ok(AuthenticatedIdentity {
        user_id: user_id.clone(),
        method: AuthMethod::ClerkJwt,
        did: None,
        delegation_id: None,
        capabilities: vec!["route:*".into(), "chat:*".into()],
    })
}

async fn verify_api_key(
    _api_key: &str,
    _state: &Arc<AppState>,
) -> Result<AuthenticatedIdentity, AuthError> {
    // API key verification will be implemented when we add API key management
    Err(AuthError::Unauthorized(
        "API key auth not yet implemented".into(),
    ))
}

#[derive(Debug)]
pub enum AuthError {
    Unauthorized(String),
    InvalidToken(String),
    VerificationFailed(String),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AuthError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AuthError::InvalidToken(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AuthError::VerificationFailed(msg) => (StatusCode::FORBIDDEN, msg.clone()),
        };
        let body = serde_json::json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}

/// Soma response headers per SOMA-DELEGATION-SPEC.
pub fn soma_response_headers(
    delegation: &Delegation,
    heart: &CortexHeart,
) -> Vec<(String, String)> {
    let mut headers = Vec::new();
    headers.push((
        "X-Soma-Protocol".into(),
        "soma-delegation/0.1".into(),
    ));
    headers.push((
        "X-Soma-Delegation-Depth".into(),
        "1".into(),
    ));
    headers.push((
        "X-Soma-Heart-DID".into(),
        heart.did().to_string(),
    ));

    // Mask the delegation ID for privacy (first 4 + last 4 chars)
    let masked = if delegation.id.len() > 8 {
        format!(
            "{}...{}",
            &delegation.id[..4],
            &delegation.id[delegation.id.len() - 4..]
        )
    } else {
        delegation.id.clone()
    };
    headers.push(("X-Soma-Delegation-Root".into(), masked));

    headers
}
