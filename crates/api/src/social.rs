use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    #[serde(rename = "type")]
    pub search_type: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FeedQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub filter: Option<String>,
}

/// Decode a keyset cursor from base64 into (created_at, id).
fn decode_cursor(cursor: &str) -> Option<(String, String)> {
    let bytes = URL_SAFE_NO_PAD.decode(cursor).ok()?;
    let s = String::from_utf8(bytes).ok()?;
    let parts: Vec<&str> = s.splitn(2, '|').collect();
    if parts.len() == 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

/// Encode (created_at, id) into an opaque base64 cursor.
fn encode_cursor(created_at: &str, id: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("{created_at}|{id}"))
}

/// Build the next cursor from the last post in a list, if we got a full page.
fn next_cursor_from_posts(posts: &[serde_json::Value], limit: i64) -> Option<String> {
    if posts.len() as i64 == limit {
        posts.last().and_then(|p| {
            let created_at = p["createdAt"].as_str()?;
            let id = p["id"].as_str()?;
            Some(encode_cursor(created_at, id))
        })
    } else {
        None
    }
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
    #[serde(rename = "mediaIds", default)]
    pub media_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    #[serde(rename = "display_name")]
    pub display_name: Option<String>,
    pub bio: Option<String>,
    #[serde(rename = "avatar_url")]
    pub avatar_url: Option<String>,
    #[serde(rename = "banner_url")]
    pub banner_url: Option<String>,
    pub location: Option<String>,
    #[serde(rename = "website")]
    pub website: Option<String>,
}

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

/// Try to extract a viewer profile_id from the Authorization header (best-effort, no rejection).
async fn optional_viewer_profile_id(
    headers: &HeaderMap,
    state: &Arc<AppState>,
) -> Option<String> {
    let auth = headers.get("authorization")?.to_str().ok()?;
    let token = auth.strip_prefix("Bearer ")?;
    let user_id = crate::clerk::verify_clerk_jwt(token, state).await.ok()?;
    let profile = db(state).social_find_profile_by_clerk_id(&user_id)?;
    profile["id"].as_str().map(|s| s.to_string())
}

// ─── Public endpoints ────────────────────────────────────────────────────────

pub async fn get_trending(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let topics = db(&state).social_get_trending_hashtags(10);
    Json(serde_json::json!({ "topics": topics }))
}

pub async fn search(
    Query(params): Query<SearchQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let query = params.q.unwrap_or_default();
    let search_type = params.search_type.unwrap_or_else(|| "all".to_string());

    if query.trim().is_empty() {
        return Json(serde_json::json!({ "posts": [], "profiles": [], "cursor": null }));
    }

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    // If authenticated, fetch block/mute lists to filter search results
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let (blocked_ids, muted_ids) = if let Some(ref pid) = viewer_pid {
        (
            db(&state).social_get_blocked_ids(pid),
            db(&state).social_get_muted_ids(pid),
        )
    } else {
        (vec![], vec![])
    };

    let posts = if search_type == "profiles" {
        vec![]
    } else {
        db(&state).social_search_posts_keyset(
            &query,
            20,
            cursor_created_at.as_deref(),
            cursor_id.as_deref(),
            &blocked_ids,
            &muted_ids,
        )
    };

    let profiles = if search_type == "posts" {
        vec![]
    } else {
        db(&state).social_search_profiles(&query, 20)
    };

    let next_cursor = next_cursor_from_posts(&posts, 20);

    Json(serde_json::json!({ "posts": posts, "profiles": profiles, "cursor": next_cursor }))
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
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(100);
    let filter = params.filter.as_deref();

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    // If authenticated, fetch block/mute lists to filter feed
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let (blocked_ids, muted_ids) = if let Some(ref pid) = viewer_pid {
        (
            db(&state).social_get_blocked_ids(pid),
            db(&state).social_get_muted_ids(pid),
        )
    } else {
        (vec![], vec![])
    };

    let posts = db(&state).social_list_feed_posts_keyset(
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
        filter,
        &blocked_ids,
        &muted_ids,
    );
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    Json(serde_json::json!({
        "posts": posts,
        "cursor": next_cursor,
        "has_more": has_more,
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

    // Notifications for reply and quote
    let post_id = post["id"].as_str().unwrap_or("").to_string();
    if let Some(reply_to_id) = &req.reply_to_post_id {
        if let Some(parent_author_id) = db(&state).social_get_post_author_profile_id(reply_to_id) {
            db(&state).social_create_notification(&parent_author_id, profile_id, "reply", Some(&post_id));
        }
    }
    if let Some(quoted_id) = &req.quote_post_id {
        if let Some(quoted_author_id) = db(&state).social_get_post_author_profile_id(quoted_id) {
            db(&state).social_create_notification(&quoted_author_id, profile_id, "quote", Some(&post_id));
        }
    }

    // Link media objects to the post if any were provided
    let media = if !req.media_ids.is_empty() {
        let post_id = post["id"].as_str().unwrap_or("");
        let linked = db(&state).social_link_media_to_post(post_id, &req.media_ids, profile_id);
        if !linked.is_empty() {
            Some(db(&state).social_get_post_media(post_id))
        } else {
            None
        }
    } else {
        None
    };

    let mut result = serde_json::json!({ "ok": true, "post": post });
    if let Some(media_list) = media {
        result["media"] = serde_json::json!(media_list);
    }
    Json(result)
}

// ─── Task #30: Social action endpoints ──────────────────────────────────────

/// Helper: resolve ClerkUser -> profile_id, returning error JSON if no profile.
fn require_profile(state: &AppState, user: &ClerkUser) -> Result<String, Json<serde_json::Value>> {
    match db(state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => Ok(p["id"].as_str().unwrap_or("").to_string()),
        None => Err(Json(serde_json::json!({ "error": "No profile found — create a profile first", "code": "NOT_FOUND" }))),
    }
}

pub async fn like_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if !db(&state).social_post_exists(&id) {
        return Json(serde_json::json!({ "error": "Post not found", "code": "NOT_FOUND" }));
    }
    db(&state).social_like(&profile_id, &id);
    // Notify the post author
    if let Some(author_profile_id) = db(&state).social_get_post_author_profile_id(&id) {
        db(&state).social_create_notification(&author_profile_id, &profile_id, "like", Some(&id));
    }
    Json(serde_json::json!({ "ok": true }))
}

pub async fn unlike_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unlike(&profile_id, &id);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn repost_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if !db(&state).social_post_exists(&id) {
        return Json(serde_json::json!({ "error": "Post not found", "code": "NOT_FOUND" }));
    }
    db(&state).social_repost(&profile_id, &id);
    // Notify the post author
    if let Some(author_profile_id) = db(&state).social_get_post_author_profile_id(&id) {
        db(&state).social_create_notification(&author_profile_id, &profile_id, "repost", Some(&id));
    }
    Json(serde_json::json!({ "ok": true }))
}

pub async fn unrepost_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unrepost(&profile_id, &id);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn bookmark_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if !db(&state).social_post_exists(&id) {
        return Json(serde_json::json!({ "error": "Post not found", "code": "NOT_FOUND" }));
    }
    db(&state).social_bookmark(&profile_id, &id);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn unbookmark_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unbookmark(&profile_id, &id);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn follow_by_handle(
    user: ClerkUser,
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let target = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "User not found", "code": "NOT_FOUND" })),
    };
    let target_id = target["id"].as_str().unwrap_or("").to_string();
    if target_id == profile_id {
        return Json(serde_json::json!({ "error": "Cannot follow yourself", "code": "INVALID_INPUT" }));
    }
    db(&state).social_follow(&profile_id, &target_id);
    // Notify the followed user
    db(&state).social_create_notification(&target_id, &profile_id, "follow", None);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn unfollow_by_handle(
    user: ClerkUser,
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let target = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "User not found", "code": "NOT_FOUND" })),
    };
    let target_id = target["id"].as_str().unwrap_or("").to_string();
    db(&state).social_unfollow(&profile_id, &target_id);
    Json(serde_json::json!({ "ok": true }))
}

// ─── Task #31: User profile endpoints ───────────────────────────────────────

pub async fn get_user_profile(
    Path(handle): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    match db(&state).social_get_profile_by_handle_with_viewer(&handle, viewer_pid.as_deref()) {
        Some(profile) => Json(profile),
        None => Json(serde_json::json!({ "error": "User not found", "code": "NOT_FOUND" })),
    }
}

pub async fn get_user_posts(
    Path(handle): Path<String>,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "User not found", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(20).min(100);

    // Support both keyset cursor (opaque string) and legacy offset (numeric string)
    let legacy_offset = match params.cursor.as_deref() {
        Some(c) => match decode_cursor(c) {
            Some(_) => 0i64, // keyset cursor provided; start from beginning for legacy path
            None => c.parse::<i64>().unwrap_or(0).max(0),
        },
        None => 0,
    };

    // Use legacy offset path until profile timeline DB method gets keyset support
    let posts = db(&state).social_get_user_posts(profile_id, limit, legacy_offset);
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    Json(serde_json::json!({
        "posts": posts,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
}

// ─── Task #32: Single post + following feed ─────────────────────────────────

pub async fn get_single_post(
    Path(id): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    match db(&state).social_get_post_by_id(&id, viewer_pid.as_deref()) {
        Some(post) => Json(post),
        None => Json(serde_json::json!({ "error": "Post not found", "code": "NOT_FOUND" })),
    }
}

pub async fn get_following_feed(
    user: ClerkUser,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let limit = params.limit.unwrap_or(20).min(100);

    // Support both keyset cursor and legacy offset
    let legacy_offset = match params.cursor.as_deref() {
        Some(c) => c.parse::<i64>().unwrap_or(0).max(0),
        None => 0,
    };

    // Fetch block/mute lists to filter feed
    let blocked_ids = db(&state).social_get_blocked_ids(&profile_id);
    let muted_ids = db(&state).social_get_muted_ids(&profile_id);

    let posts = db(&state).social_get_following_feed(&profile_id, limit, legacy_offset, &blocked_ids, &muted_ids);
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    Json(serde_json::json!({
        "posts": posts,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
}

// ─── Task #33: /me/profile CRUD ─────────────────────────────────────────────

pub async fn get_me_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(profile) => {
            let profile_id = profile["id"].as_str().unwrap_or("");
            let agents = db(&state).social_get_linked_agents(profile_id);
            let stats = db(&state).social_get_profile_stats(profile_id);
            let mut obj = profile;
            if let Some(m) = obj.as_object_mut() {
                m.insert("linkedAgents".into(), serde_json::json!(agents));
                m.insert("stats".into(), stats);
            }
            Json(obj)
        }
        None => Json(serde_json::json!({ "error": "No profile found", "code": "NOT_FOUND" })),
    }
}

pub async fn create_me_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    // Delegate to existing create_profile logic
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

pub async fn update_me_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateProfileRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(serde_json::json!({ "error": "No profile found — create a profile first", "code": "NOT_FOUND" })),
    };

    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).social_update_profile(
        profile_id,
        req.display_name.as_deref(),
        req.bio.as_deref(),
        req.avatar_url.as_deref(),
        req.banner_url.as_deref(),
        req.location.as_deref(),
        req.website.as_deref(),
    ) {
        Some(updated) => Json(serde_json::json!({ "ok": true, "profile": updated })),
        None => Json(serde_json::json!({ "error": "Update failed", "code": "INTERNAL_ERROR" })),
    }
}

// ─── Soft-delete post ──────────────────────────────────────────────────────

pub async fn delete_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    // Verify ownership
    match db(&state).social_get_post_author_profile_id(&id) {
        Some(author_id) if author_id == profile_id => {}
        Some(_) => return Json(serde_json::json!({ "error": "Not the post author", "code": "FORBIDDEN" })),
        None => return Json(serde_json::json!({ "error": "Post not found", "code": "NOT_FOUND" })),
    }
    db(&state).social_soft_delete_post(&id);
    Json(serde_json::json!({ "ok": true }))
}

// ─── Task #36: Community feed ──────────────────────────────────────────────

pub async fn get_community_feed(
    Path(community_id): Path<String>,
    Query(params): Query<FeedQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    // If authenticated, fetch block/mute lists to filter feed
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let (blocked_ids, muted_ids) = if let Some(ref pid) = viewer_pid {
        (
            db(&state).social_get_blocked_ids(pid),
            db(&state).social_get_muted_ids(pid),
        )
    } else {
        (vec![], vec![])
    };

    let posts = db(&state).social_get_community_feed(
        &community_id,
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
        &blocked_ids,
        &muted_ids,
    );
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    Json(serde_json::json!({
        "posts": posts,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
}
