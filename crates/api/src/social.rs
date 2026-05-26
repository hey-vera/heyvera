use std::sync::Arc;

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    #[serde(rename = "type")]
    pub search_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FeedQuery {
    pub limit: Option<i64>,
    pub cursor: Option<i64>,
    pub filter: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    pub handle: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub bio: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePostRequest {
    pub body: String,
    pub visibility: Option<String>,
    #[serde(rename = "authorMode")]
    pub author_mode: Option<String>,
    #[serde(rename = "linkedAgentId")]
    pub linked_agent_id: Option<String>,
    #[serde(rename = "replyToPostId")]
    pub reply_to_post_id: Option<String>,
    #[serde(rename = "quotePostId")]
    pub quote_post_id: Option<String>,
}

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

// ─── Public endpoints ────────────────────────────────────────────────────────

pub async fn get_trending(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let topics = db(&state).social_get_trending_hashtags(10);
    Json(serde_json::json!({ "topics": topics }))
}

pub async fn search(
    Query(params): Query<SearchQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let query = params.q.unwrap_or_default();
    let search_type = params.search_type.unwrap_or_else(|| "all".to_string());

    if query.trim().is_empty() {
        return Json(serde_json::json!({ "posts": [], "profiles": [] }));
    }

    let posts = if search_type == "profiles" {
        vec![]
    } else {
        db(&state).social_search_posts(&query, 20)
    };

    let profiles = if search_type == "posts" {
        vec![]
    } else {
        db(&state).social_search_profiles(&query, 20)
    };

    Json(serde_json::json!({ "posts": posts, "profiles": profiles }))
}

pub async fn get_featured_profiles(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match db(&state).social_get_first_profile() {
        Some(profile) => {
            let profile_id = profile["id"].as_str().unwrap_or("");
            let agents = db(&state).social_get_linked_agents(profile_id);
            Json(serde_json::json!({ "profile": profile, "linkedAgents": agents }))
        }
        None => Json(serde_json::json!({ "error": "No featured profile", "code": "NOT_FOUND" })),
    }
}

pub async fn get_home_feed(
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(100);
    let cursor = params.cursor.unwrap_or(0).max(0);
    let filter = params.filter.as_deref();
    let posts = db(&state).social_list_feed_posts(limit, cursor, filter);
    let next_cursor = if posts.len() as i64 == limit {
        Some((cursor + limit).to_string())
    } else {
        None
    };
    Json(serde_json::json!({
        "feed": posts,
        "pageInfo": { "limit": limit, "nextCursor": next_cursor },
    }))
}

pub async fn get_profiles(
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(100);
    let profiles = db(&state).social_list_profiles(limit);
    Json(serde_json::json!({ "profiles": profiles }))
}

pub async fn get_communities(
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(100);
    let communities = db(&state).social_list_communities(limit);
    Json(serde_json::json!({ "communities": communities }))
}

// ─── Authenticated endpoints ─────────────────────────────────────────────────

pub async fn get_my_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(profile) => {
            let profile_id = profile["id"].as_str().unwrap_or("");
            let agents = db(&state).social_get_linked_agents(profile_id);
            Json(serde_json::json!({ "profile": profile, "linkedAgents": agents }))
        }
        None => Json(serde_json::json!({ "error": "No profile found", "code": "NOT_FOUND" })),
    }
}

pub async fn create_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    if db(&state).social_find_profile_by_clerk_id(&user.user_id).is_some() {
        return Json(serde_json::json!({ "error": "Profile already exists", "code": "CONFLICT" }));
    }

    let handle = req.handle.trim().to_lowercase();
    if handle.len() < 2 || handle.len() > 30 {
        return Json(serde_json::json!({ "error": "Handle must be 2-30 characters", "code": "INVALID_INPUT" }));
    }

    if db(&state).social_find_profile_by_handle(&handle).is_some() {
        return Json(serde_json::json!({ "error": "Handle is already taken", "code": "CONFLICT" }));
    }

    let bio = req.bio.unwrap_or_default();
    let profile = db(&state).social_create_profile(&user.user_id, &handle, &req.display_name, &bio);
    Json(serde_json::json!({ "ok": true, "profile": profile }))
}

pub async fn create_post(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePostRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "No profile found — create a profile first", "code": "NOT_FOUND" })),
    };

    let body = req.body.trim().to_string();
    if body.is_empty() {
        return Json(serde_json::json!({ "error": "Post body is required", "code": "INVALID_INPUT" }));
    }
    if body.len() > 5000 {
        return Json(serde_json::json!({ "error": "Post body exceeds 5000 characters", "code": "INVALID_INPUT" }));
    }

    let profile_id = profile["id"].as_str().unwrap_or("");
    let visibility = req.visibility.as_deref().unwrap_or("public");
    let author_mode = req.author_mode.as_deref().unwrap_or("person");
    let post = db(&state).social_create_post(
        profile_id,
        &body,
        visibility,
        author_mode,
        req.linked_agent_id.as_deref(),
        req.reply_to_post_id.as_deref(),
        req.quote_post_id.as_deref(),
    );
    Json(serde_json::json!({ "ok": true, "post": post }))
}
