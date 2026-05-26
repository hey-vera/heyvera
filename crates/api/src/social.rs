use std::sync::Arc;

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::clerk::ClerkUser;
use crate::state::AppState;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SocialProfile {
    pub id: String,
    pub account_id: String, // Clerk user ID
    pub handle: String,
    pub display_name: String,
    pub bio: String,
    pub avatar_url: Option<String>,
    pub banner_url: Option<String>,
    pub location: Option<String>,
    pub website_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SocialPost {
    pub id: String,
    pub profile_id: String,
    pub body: String,
    pub visibility: String, // "public", "followers", "community"
    pub author_mode: String, // "person", "agent", "collaboration"
    pub agent_context: Option<AgentContext>,
    pub reply_to_post_id: Option<String>,
    pub quote_post_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentContext {
    pub agent_name: String,
    pub agent_slug: String,
    pub assistance_level: String, // "draft", "assisted", "guided"
    pub original_prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateProfileRequest {
    pub handle: String,
    pub display_name: String,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub location: Option<String>,
    pub website_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreatePostRequest {
    pub body: String,
    pub visibility: Option<String>,
    pub author_mode: Option<String>,
    pub agent_context: Option<AgentContext>,
    pub reply_to_post_id: Option<String>,
    pub quote_post_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrendingTopic {
    pub tag: String,
    pub post_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    #[serde(rename = "type")]
    pub search_type: Option<String>,
}

// ─── Public endpoints ────────────────────────────────────────────────────────

/// GET /v1/social/trending - Get trending hashtags
pub async fn get_trending(State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    // For now, return empty - will implement with real data later
    Json(serde_json::json!({
        "topics": []
    }))
}

/// GET /v1/social/search - Search posts and profiles
pub async fn search(
    Query(params): Query<SearchQuery>,
    State(_state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let _query = params.q.unwrap_or_default();
    let _search_type = params.search_type.unwrap_or_else(|| "all".to_string());

    // Return empty results for now
    Json(serde_json::json!({
        "posts": [],
        "profiles": []
    }))
}

/// GET /v1/social/profiles/featured - Get featured profiles
pub async fn get_featured_profiles(State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "profiles": []
    }))
}

/// GET /v1/social/feed/home - Get user's home feed (requires auth)
pub async fn get_home_feed(
    user: ClerkUser,
    State(_state): State<Arc<AppState>>,
) -> impl IntoResponse {
    Json(serde_json::json!({
        "posts": [],
        "message": format!("Home feed for user {}", user.user_id)
    }))
}

// ─── Authenticated endpoints ─────────────────────────────────────────────────

/// GET /v1/social/profile/me - Get current user's profile
pub async fn get_my_profile(
    user: ClerkUser,
    State(_state): State<Arc<AppState>>,
) -> impl IntoResponse {
    // TODO: Look up profile in database
    Json(serde_json::json!({
        "message": format!("Profile for user {}", user.user_id),
        "profile": null
    }))
}

/// POST /v1/social/profiles - Create user profile
pub async fn create_profile(
    user: ClerkUser,
    State(_state): State<Arc<AppState>>,
    Json(req): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    let profile = SocialProfile {
        id: Uuid::new_v4().to_string(),
        account_id: user.user_id.clone(),
        handle: req.handle,
        display_name: req.display_name,
        bio: req.bio.unwrap_or_default(),
        avatar_url: req.avatar_url,
        banner_url: None,
        location: req.location,
        website_url: req.website_url,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    // TODO: Save to database

    Json(serde_json::json!({
        "ok": true,
        "profile": profile
    }))
}

/// POST /v1/social/posts - Create a post (with optional agent assistance)
pub async fn create_post(
    user: ClerkUser,
    State(_state): State<Arc<AppState>>,
    Json(req): Json<CreatePostRequest>,
) -> impl IntoResponse {
    let post = SocialPost {
        id: Uuid::new_v4().to_string(),
        profile_id: user.user_id.clone(), // TODO: Get actual profile ID from DB
        body: req.body,
        visibility: req.visibility.unwrap_or_else(|| "public".to_string()),
        author_mode: req.author_mode.unwrap_or_else(|| "person".to_string()),
        agent_context: req.agent_context,
        reply_to_post_id: req.reply_to_post_id,
        quote_post_id: req.quote_post_id,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    // TODO: Save to database

    Json(serde_json::json!({
        "ok": true,
        "post": post
    }))
}

// ─── Helper functions ─────────────────────────────────────────────────────────

pub fn init_social_tables(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS social_profiles (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL UNIQUE,
            handle TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            bio TEXT NOT NULL DEFAULT '',
            avatar_url TEXT,
            banner_url TEXT,
            location TEXT,
            website_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS social_posts (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL REFERENCES social_profiles(id),
            body TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'public',
            author_mode TEXT NOT NULL DEFAULT 'person',
            agent_context_json TEXT,
            reply_to_post_id TEXT REFERENCES social_posts(id),
            quote_post_id TEXT REFERENCES social_posts(id),
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_social_profiles_account ON social_profiles(account_id);
        CREATE INDEX IF NOT EXISTS idx_social_profiles_handle ON social_profiles(handle);
        CREATE INDEX IF NOT EXISTS idx_social_posts_profile ON social_posts(profile_id);
        CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at);
        "#,
    )
}