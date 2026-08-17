//! Linked-agent bearer authentication (`hvak_` API keys).
//!
//! Agents call scoped write routes with:
//!   Authorization: Bearer hvak_...
//! or Authorization: Agent hvak_...
//!
//! The full secret is hashed (SHA-256 hex) and looked up against
//! `social_linked_agents.agent_key_hash` where `link_state = 'active'`.

use std::sync::Arc;

use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;

use crate::clerk::ClerkUser;
use crate::key_material;
use crate::routes::ErrorResponse;
use crate::state::AppState;

/// Authenticated linked agent principal.
#[derive(Debug, Clone)]
pub struct AgentIdentity {
    pub agent_id: String,
    pub profile_id: String,
    pub agent_slug: String,
}

/// Dual principal for agent-scoped write routes (create post / create draft).
#[derive(Debug, Clone)]
pub enum SocialWriteAuth {
    Clerk(ClerkUser),
    Agent(AgentIdentity),
}

impl SocialWriteAuth {
    pub fn is_agent(&self) -> bool {
        matches!(self, SocialWriteAuth::Agent(_))
    }

    pub fn agent(&self) -> Option<&AgentIdentity> {
        match self {
            SocialWriteAuth::Agent(a) => Some(a),
            SocialWriteAuth::Clerk(_) => None,
        }
    }

    pub fn clerk(&self) -> Option<&ClerkUser> {
        match self {
            SocialWriteAuth::Clerk(u) => Some(u),
            SocialWriteAuth::Agent(_) => None,
        }
    }
}

/// Scheme tag for HeyVera Socials linked-agent keys.
pub const AGENT_KEY_PREFIX: &str = "hvak_";

/// Generate a new agent API key: `hvak_` + 32 CSPRNG bytes (base64url).
/// Returns `(plaintext_secret, display_prefix, sha256_hex_hash)`.
///
/// The key material itself is product-neutral and lives in
/// [`crate::key_material`]; what is specific to Socials is the `hvak_` tag and
/// the fact that the hash resolves against `social_linked_agents`. The tuple
/// shape is kept so the Socials call sites in `social.rs` are unchanged.
pub fn generate_agent_api_key() -> (String, String, String) {
    let key = key_material::generate_api_key(AGENT_KEY_PREFIX);
    (key.secret, key.display_prefix, key.hash)
}

/// Display prefix: first 12 characters + ellipsis.
pub fn agent_key_prefix(secret: &str) -> String {
    key_material::display_prefix(secret)
}

/// SHA-256 hex of the full secret (including `hvak_` prefix).
pub fn hash_agent_api_key(secret: &str) -> String {
    key_material::hash_api_key(secret)
}

/// Extract an agent key from Authorization if present.
/// Accepts `Bearer hvak_...` or `Agent hvak_...`.
pub fn extract_agent_token(raw_auth: Option<&str>) -> Option<&str> {
    let header = raw_auth?;
    let token = if let Some(t) = header.strip_prefix("Bearer ") {
        t.trim()
    } else if let Some(t) = header.strip_prefix("Agent ") {
        t.trim()
    } else {
        return None;
    };
    if token.starts_with(AGENT_KEY_PREFIX) {
        Some(token)
    } else {
        None
    }
}

fn unauthorized(msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse {
            error: msg.into(),
        }),
    )
}

fn forbidden(msg: &str) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::FORBIDDEN,
        Json(ErrorResponse {
            error: msg.into(),
        }),
    )
}

/// Resolve agent key → AgentIdentity. Checks owner account suspension when possible.
pub fn resolve_agent_identity(
    state: &AppState,
    token: &str,
) -> Result<AgentIdentity, (StatusCode, Json<ErrorResponse>)> {
    let Some(db) = state.db.as_ref() else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        ));
    };

    let key_hash = hash_agent_api_key(token);
    let agent = db
        .social_find_linked_agent_by_key_hash(&key_hash)
        .ok_or_else(|| unauthorized("invalid agent API key"))?;

    let agent_id = agent["id"].as_str().unwrap_or("").to_string();
    let profile_id = agent["profileId"].as_str().unwrap_or("").to_string();
    let agent_slug = agent["agentSlug"].as_str().unwrap_or("").to_string();
    if agent_id.is_empty() || profile_id.is_empty() {
        return Err(unauthorized("invalid agent API key"));
    }

    // Suspended owner: map profile → clerk_user_id and check accounts table.
    if let Some(clerk_user_id) = db.social_profile_clerk_user_id(&profile_id) {
        if let Some(message) = crate::clerk::account_access_error(state, &clerk_user_id) {
            return Err(forbidden(message));
        }
    }

    Ok(AgentIdentity {
        agent_id,
        profile_id,
        agent_slug,
    })
}

impl<S> FromRequestParts<S> for AgentIdentity
where
    Arc<AppState>: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state: Arc<AppState> = Arc::from_ref(state);
        let raw_auth = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok());

        let token = extract_agent_token(raw_auth)
            .ok_or_else(|| unauthorized("agent API key required (Bearer hvak_...)"))?;

        resolve_agent_identity(&app_state, token)
    }
}

impl<S> FromRequestParts<S> for SocialWriteAuth
where
    Arc<AppState>: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = (StatusCode, Json<ErrorResponse>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state: Arc<AppState> = Arc::from_ref(state);
        let raw_auth = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // Prefer hvak_ detection after Bearer/Agent strip so JWT path still works
        // for non-hvak tokens.
        if let Some(token) = extract_agent_token(raw_auth.as_deref()) {
            let identity = resolve_agent_identity(&app_state, token)?;
            return Ok(SocialWriteAuth::Agent(identity));
        }

        let clerk = ClerkUser::from_request_parts(parts, state).await?;
        Ok(SocialWriteAuth::Clerk(clerk))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap().keep();
        Database::open(&dir.join("cortex.sqlite"))
    }

    #[test]
    fn generate_key_format_and_hash_roundtrip() {
        let (secret, prefix, hash) = generate_agent_api_key();
        assert!(secret.starts_with("hvak_"));
        assert!(secret.len() > 20);
        assert!(prefix.ends_with('…'));
        assert_eq!(prefix.chars().count(), 13); // 12 + ellipsis
        assert_eq!(hash.len(), 64);
        assert_eq!(hash_agent_api_key(&secret), hash);
        assert_ne!(hash, secret);
    }

    #[test]
    fn extract_agent_token_accepts_bearer_and_agent_schemes() {
        assert_eq!(
            extract_agent_token(Some("Bearer hvak_abc123")),
            Some("hvak_abc123")
        );
        assert_eq!(
            extract_agent_token(Some("Agent hvak_abc123")),
            Some("hvak_abc123")
        );
        // JWT-looking tokens must NOT be treated as agent keys
        assert_eq!(extract_agent_token(Some("Bearer eyJhbGciOi")), None);
        assert_eq!(extract_agent_token(Some("Bearer sk_live_x")), None);
        assert_eq!(extract_agent_token(None), None);
    }

    #[test]
    fn create_agent_hash_lookup_and_list_redacts_secret() {
        let db = test_db();
        let profile = db.social_create_profile("clerk_agent_auth", "agentowner", "Owner", "");
        let profile_id = profile["id"].as_str().unwrap();

        let (secret, prefix, hash) = generate_agent_api_key();
        let agent = db
            .social_create_linked_agent(
                profile_id,
                "Bot",
                "bot-one",
                &prefix,
                &hash,
                "general",
                "public",
                "pending",
                true,
            )
            .unwrap();

        // Hash lookup finds active agent
        let found = db.social_find_linked_agent_by_key_hash(&hash).unwrap();
        assert_eq!(found["id"], agent["id"]);
        assert_eq!(found["profileId"], profile_id);

        // Wrong key fails
        let wrong_hash = hash_agent_api_key("hvak_not_the_real_key_xxxxxxxxxxxx");
        assert!(db.social_find_linked_agent_by_key_hash(&wrong_hash).is_none());

        // List does not return full key / hash
        let listed = db.social_get_linked_agents(profile_id);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["agentKeyPrefix"], prefix);
        assert!(listed[0].get("agentKey").is_none());
        assert!(listed[0].get("agentKeyHash").is_none());
        let list_str = listed[0].to_string();
        assert!(!list_str.contains(&secret));
        assert!(!list_str.contains(&hash));

        // create_post forces agent author (DB layer)
        let post = db.social_create_post(
            profile_id,
            "hello from agent",
            "public",
            "agent",
            agent["id"].as_str(),
            None,
            None,
            None,
        );
        assert_eq!(post["authorMode"], "agent");
        assert_eq!(post["linkedAgent"]["id"], agent["id"]);
    }

    #[test]
    fn rotate_key_invalidates_old_hash() {
        let db = test_db();
        let profile = db.social_create_profile("clerk_rotate", "rotateuser", "Rotate", "");
        let profile_id = profile["id"].as_str().unwrap();
        let (secret1, prefix1, hash1) = generate_agent_api_key();
        let agent = db
            .social_create_linked_agent(
                profile_id,
                "RotBot",
                "rot-bot",
                &prefix1,
                &hash1,
                "general",
                "public",
                "pending",
                false,
            )
            .unwrap();
        let agent_id = agent["id"].as_str().unwrap();

        let (_secret2, prefix2, hash2) = generate_agent_api_key();
        let updated = db
            .social_rotate_linked_agent_key(profile_id, agent_id, &prefix2, &hash2)
            .unwrap();
        assert_eq!(updated["agentKeyPrefix"], prefix2);
        assert!(db.social_find_linked_agent_by_key_hash(&hash1).is_none());
        assert!(db.social_find_linked_agent_by_key_hash(&hash2).is_some());
        let _ = secret1; // old secret must no longer authenticate (hash1 miss above)
    }
}
