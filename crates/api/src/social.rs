use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    http::HeaderMap,
    response::IntoResponse,
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;

use crate::agent_auth::{generate_agent_api_key, SocialWriteAuth};
use crate::clerk::ClerkUser;
use crate::state::AppState;

type ApiResponse = (StatusCode, Json<serde_json::Value>);

fn ok(v: serde_json::Value) -> ApiResponse { (StatusCode::OK, Json(v)) }
fn not_found(msg: &str) -> ApiResponse { (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": msg, "code": "NOT_FOUND" }))) }
fn bad_request(msg: &str) -> ApiResponse { (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg, "code": "BAD_REQUEST" }))) }
fn conflict(msg: &str) -> ApiResponse { (StatusCode::CONFLICT, Json(serde_json::json!({ "error": msg, "code": "CONFLICT" }))) }
fn forbidden(msg: &str) -> ApiResponse { (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": msg, "code": "FORBIDDEN" }))) }
fn internal_error(msg: &str) -> ApiResponse { (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": msg, "code": "INTERNAL_ERROR" }))) }

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

fn next_cursor_from_longform(entries: &[serde_json::Value], limit: i64) -> Option<String> {
    if entries.len() as i64 == limit {
        entries.last().and_then(|entry| {
            let created_at = entry["createdAt"].as_str()?;
            let id = entry["id"].as_str()?;
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
    /// Optional community to attach the post to (uuid or will be stored as-is if valid).
    #[serde(default, rename = "communityId", alias = "community_id")]
    pub community_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCommunityRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLongformRequest {
    pub title: String,
    pub summary: Option<String>,
    pub body: String,
    #[serde(rename = "formatType")]
    pub format_type: Option<String>,
    pub visibility: Option<String>,
    #[serde(rename = "authorMode")]
    pub author_mode: Option<String>,
    #[serde(rename = "linkedAgentId")]
    pub linked_agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    /// Accept camelCase (FE) and snake_case (legacy clients).
    #[serde(default, rename = "displayName", alias = "display_name")]
    pub display_name: Option<String>,
    pub bio: Option<String>,
    #[serde(default, rename = "avatarUrl", alias = "avatar_url")]
    pub avatar_url: Option<String>,
    #[serde(default, rename = "bannerUrl", alias = "banner_url")]
    pub banner_url: Option<String>,
    pub location: Option<String>,
    #[serde(default, rename = "websiteUrl", alias = "website_url")]
    pub website: Option<String>,
}

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

/// When author_mode is agent/linked_pair and a linked_agent_id is set, require that
/// agent to belong to the caller's profile. Returns Ok(()) or a forbidden/bad_request response.
pub fn ensure_linked_agent_allowed(
    state: &AppState,
    profile_id: &str,
    author_mode: &str,
    linked_agent_id: Option<&str>,
) -> Result<(), ApiResponse> {
    let needs_agent = matches!(author_mode, "agent" | "linked_pair");
    if !needs_agent {
        // Person mode may still attach a linked agent id; if present, verify ownership.
        if let Some(agent_id) = linked_agent_id {
            if !db(state).social_linked_agent_belongs_to(profile_id, agent_id) {
                return Err(forbidden("linkedAgentId is not linked to your profile"));
            }
        }
        return Ok(());
    }
    let Some(agent_id) = linked_agent_id else {
        return Err(bad_request(
            "linkedAgentId is required when authorMode is agent or linked_pair",
        ));
    };
    if !db(state).social_linked_agent_belongs_to(profile_id, agent_id) {
        return Err(forbidden("linkedAgentId is not linked to your profile"));
    }
    Ok(())
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
    ok(serde_json::json!({ "topics": topics }))
}

pub async fn search(
    Query(params): Query<SearchQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let query = params.q.unwrap_or_default();
    let search_type = params.search_type.unwrap_or_else(|| "all".to_string());

    if query.trim().is_empty() {
        return ok(serde_json::json!({ "posts": [], "profiles": [], "cursor": null }));
    }

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let (blocked_ids, muted_ids) = if let Some(ref pid) = viewer_pid {
        (
            db(&state).social_get_blocked_ids(pid),
            db(&state).social_get_muted_ids(pid),
        )
    } else {
        (vec![], vec![])
    };

    let mut posts = if search_type == "profiles" {
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
    db(&state).social_enrich_feed_posts(&mut posts, viewer_pid.as_deref());

    let profiles = if search_type == "posts" {
        vec![]
    } else {
        db(&state).social_search_profiles(&query, 20)
    };

    let next_cursor = next_cursor_from_posts(&posts, 20);

    ok(serde_json::json!({ "posts": posts, "profiles": profiles, "cursor": next_cursor }))
}

pub async fn get_featured_profiles(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match db(&state).social_get_first_profile() {
        Some(profile) => {
            let profile_id = profile["id"].as_str().unwrap_or("");
            let agents = db(&state).social_get_linked_agents(profile_id);
            ok(serde_json::json!({ "profile": profile, "linkedAgents": agents }))
        }
        None => not_found("No featured profile"),
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

    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let (blocked_ids, muted_ids) = if let Some(ref pid) = viewer_pid {
        (
            db(&state).social_get_blocked_ids(pid),
            db(&state).social_get_muted_ids(pid),
        )
    } else {
        (vec![], vec![])
    };

    let mut posts = db(&state).social_list_feed_posts_keyset(
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
        filter,
        &blocked_ids,
        &muted_ids,
    );
    db(&state).social_enrich_feed_posts(&mut posts, viewer_pid.as_deref());
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    ok(serde_json::json!({
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
    ok(serde_json::json!({ "profiles": profiles }))
}

pub async fn get_communities(
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).min(100);
    let communities = db(&state).social_list_communities(limit);
    ok(serde_json::json!({ "communities": communities }))
}

pub async fn get_longform(
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let limit = params.limit.unwrap_or(20).clamp(1, 100);
    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let longform = db(&state).social_list_longform_keyset(
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
    );
    let next_cursor = next_cursor_from_longform(&longform, limit);
    let has_more = longform.len() as i64 == limit;

    ok(serde_json::json!({
        "longform": longform,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
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
            ok(serde_json::json!({ "profile": profile, "linkedAgents": agents }))
        }
        None => not_found("Profile not found"),
    }
}

pub async fn create_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    if db(&state).social_find_profile_by_clerk_id(&user.user_id).is_some() {
        return conflict("Profile already exists");
    }

    let handle = req.handle.trim().to_lowercase();
    if handle.len() < 2 || handle.len() > 30 {
        return bad_request("Handle must be 2-30 characters");
    }

    if db(&state).social_find_profile_by_handle(&handle).is_some() {
        return conflict("Handle is already taken");
    }

    let bio = req.bio.unwrap_or_default();
    let profile = db(&state).social_create_profile(&user.user_id, &handle, &req.display_name, &bio);
    ok(serde_json::json!({ "ok": true, "profile": profile }))
}

pub async fn create_post(
    auth: SocialWriteAuth,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePostRequest>,
) -> impl IntoResponse {
    // Dual auth: Clerk (human) or Agent bearer (hvak_). Agent forces profile + author_mode.
    let (profile_id, author_mode, linked_agent_id): (String, String, Option<String>) = match &auth {
        SocialWriteAuth::Agent(agent) => (
            agent.profile_id.clone(),
            "agent".to_string(),
            Some(agent.agent_id.clone()),
        ),
        SocialWriteAuth::Clerk(user) => {
            let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
                Some(p) => p,
                None => return not_found("No profile found — create a profile first"),
            };
            let profile_id = profile["id"].as_str().unwrap_or("").to_string();
            let author_mode = req.author_mode.as_deref().unwrap_or("person").to_string();
            if let Err(resp) = ensure_linked_agent_allowed(
                &state,
                &profile_id,
                &author_mode,
                req.linked_agent_id.as_deref(),
            ) {
                return resp;
            }
            (profile_id, author_mode, req.linked_agent_id.clone())
        }
    };

    let body = req.body.trim().to_string();
    // Allow image-only posts when mediaIds are present; still require some body otherwise.
    if body.is_empty() && req.media_ids.is_empty() {
        return bad_request("Post body is required");
    }
    if body.len() > 5000 {
        return bad_request("Post body exceeds 5000 characters");
    }

    let visibility = req.visibility.as_deref().unwrap_or("public");

    // Resolve optional communityId (uuid or slug) before insert.
    let community_id = if let Some(ref raw) = req.community_id {
        let raw = raw.trim();
        if raw.is_empty() {
            None
        } else {
            match db(&state).social_resolve_community_id(raw) {
                Some(id) => Some(id),
                None => return bad_request("communityId not found"),
            }
        }
    } else {
        None
    };

    let post = db(&state).social_create_post(
        &profile_id,
        &body,
        visibility,
        &author_mode,
        linked_agent_id.as_deref(),
        req.reply_to_post_id.as_deref(),
        req.quote_post_id.as_deref(),
        community_id.as_deref(),
    );

    let post_id = post["id"].as_str().unwrap_or("").to_string();
    if let Some(reply_to_id) = &req.reply_to_post_id {
        if let Some(parent_author_id) = db(&state).social_get_post_author_profile_id(reply_to_id) {
            db(&state).social_create_notification(&parent_author_id, &profile_id, "reply", Some(&post_id));
        }
    }
    if let Some(quoted_id) = &req.quote_post_id {
        if let Some(quoted_author_id) = db(&state).social_get_post_author_profile_id(quoted_id) {
            db(&state).social_create_notification(&quoted_author_id, &profile_id, "quote", Some(&post_id));
        }
    }

    let media = if !req.media_ids.is_empty() {
        let post_id = post["id"].as_str().unwrap_or("");
        let linked = db(&state).social_link_media_to_post(post_id, &req.media_ids, &profile_id);
        if !linked.is_empty() {
            Some(db(&state).social_get_post_media(post_id))
        } else {
            None
        }
    } else {
        None
    };

    let mut post_out = post;
    let mut result = serde_json::json!({ "ok": true });
    if let Some(media_list) = media {
        if let Some(obj) = post_out.as_object_mut() {
            obj.insert("media".into(), serde_json::json!(media_list.clone()));
        }
        result["media"] = serde_json::json!(media_list);
    }
    result["post"] = post_out;
    ok(result)
}

pub async fn create_longform(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateLongformRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(profile_id) => profile_id,
        Err(response) => return response,
    };

    let title = req.title.trim();
    let summary = req.summary.unwrap_or_default();
    let summary = summary.trim();
    let body = req.body.trim();
    let format_type = req.format_type.as_deref().unwrap_or("essay");
    let visibility = req.visibility.as_deref().unwrap_or("public");
    let author_mode = req.author_mode.as_deref().unwrap_or("person");

    if title.is_empty() {
        return bad_request("Title is required");
    }
    if title.len() > 200 {
        return bad_request("Title exceeds 200 characters");
    }
    if summary.len() > 500 {
        return bad_request("Summary exceeds 500 characters");
    }
    if body.is_empty() {
        return bad_request("Body is required");
    }
    if body.len() > 50_000 {
        return bad_request("Body exceeds 50000 characters");
    }

    if let Err(resp) = ensure_linked_agent_allowed(
        &state,
        &profile_id,
        author_mode,
        req.linked_agent_id.as_deref(),
    ) {
        return resp;
    }

    let longform = db(&state).social_create_longform(
        &profile_id,
        title,
        summary,
        body,
        format_type,
        visibility,
        author_mode,
        req.linked_agent_id.as_deref(),
    );

    ok(serde_json::json!({ "ok": true, "longform": longform }))
}

// ─── Task #30: Social action endpoints ──────────────────────────────────────

/// Helper: resolve ClerkUser -> profile_id, returning error if no profile.
fn require_profile(state: &AppState, user: &ClerkUser) -> Result<String, ApiResponse> {
    match db(state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => Ok(p["id"].as_str().unwrap_or("").to_string()),
        None => Err(not_found("No profile found — create a profile first")),
    }
}

pub async fn like_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if !db(&state).social_post_exists(&id) {
        return not_found("Post not found");
    }
    db(&state).social_like(&profile_id, &id);
    if let Some(author_profile_id) = db(&state).social_get_post_author_profile_id(&id) {
        db(&state).social_create_notification(&author_profile_id, &profile_id, "like", Some(&id));
    }
    ok(serde_json::json!({ "ok": true }))
}

pub async fn unlike_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unlike(&profile_id, &id);
    ok(serde_json::json!({ "ok": true }))
}

pub async fn repost_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if !db(&state).social_post_exists(&id) {
        return not_found("Post not found");
    }
    db(&state).social_repost(&profile_id, &id);
    if let Some(author_profile_id) = db(&state).social_get_post_author_profile_id(&id) {
        db(&state).social_create_notification(&author_profile_id, &profile_id, "repost", Some(&id));
    }
    ok(serde_json::json!({ "ok": true }))
}

pub async fn unrepost_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unrepost(&profile_id, &id);
    ok(serde_json::json!({ "ok": true }))
}

pub async fn bookmark_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if !db(&state).social_post_exists(&id) {
        return not_found("Post not found");
    }
    db(&state).social_bookmark(&profile_id, &id);
    ok(serde_json::json!({ "ok": true }))
}

pub async fn unbookmark_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unbookmark(&profile_id, &id);
    ok(serde_json::json!({ "ok": true }))
}

/// List posts bookmarked by the authenticated viewer.
pub async fn get_bookmarks(
    user: ClerkUser,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let mut posts = db(&state).social_list_bookmarked_posts(
        &profile_id,
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
    );
    db(&state).social_enrich_feed_posts(&mut posts, Some(&profile_id));

    // Cursor is keyed on bookmark time (bookmarkedAt), not post createdAt.
    let next_cursor = if posts.len() as i64 == limit {
        posts.last().and_then(|p| {
            let bookmarked_at = p["bookmarkedAt"].as_str()?;
            let id = p["id"].as_str()?;
            Some(encode_cursor(bookmarked_at, id))
        })
    } else {
        None
    };
    let has_more = posts.len() as i64 == limit;

    ok(serde_json::json!({
        "posts": posts,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
}

pub async fn follow_by_handle(
    user: ClerkUser,
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let target = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let target_id = target["id"].as_str().unwrap_or("").to_string();
    if target_id == profile_id {
        return bad_request("Cannot follow yourself");
    }
    db(&state).social_follow(&profile_id, &target_id);
    db(&state).social_create_notification(&target_id, &profile_id, "follow", None);
    ok(serde_json::json!({ "ok": true }))
}

pub async fn unfollow_by_handle(
    user: ClerkUser,
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let target = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let target_id = target["id"].as_str().unwrap_or("").to_string();
    db(&state).social_unfollow(&profile_id, &target_id);
    ok(serde_json::json!({ "ok": true }))
}

// ─── Task #31: User profile endpoints ───────────────────────────────────────

pub async fn get_user_profile(
    Path(handle): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    match db(&state).social_get_profile_by_handle_with_viewer(&handle, viewer_pid.as_deref()) {
        Some(profile) => ok(profile),
        None => not_found("User not found"),
    }
}

/// FE-friendly alias: `{ profile, linkedAgents }` for `/profiles/{handle}`.
pub async fn get_profile_by_handle(
    Path(handle): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    match db(&state).social_get_profile_by_handle_with_viewer(&handle, viewer_pid.as_deref()) {
        Some(profile) => {
            let profile_id = profile["id"].as_str().unwrap_or("");
            let agents = db(&state).social_get_linked_agents(profile_id);
            ok(serde_json::json!({ "profile": profile, "linkedAgents": agents }))
        }
        None => not_found("User not found"),
    }
}

/// Linked agents for a public profile handle.
pub async fn get_profile_linked_agents(
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let agents = db(&state).social_get_linked_agents(profile_id);
    ok(serde_json::json!({ "linkedAgents": agents }))
}

// ─── Linked-agent CRUD (authenticated) ──────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateLinkedAgentRequest {
    #[serde(alias = "agentName")]
    pub agent_name: String,
    #[serde(alias = "agentSlug")]
    pub agent_slug: String,
    /// Ignored for secret generation (legacy clients may still send a label).
    /// Server always generates an `hvak_` API key.
    #[serde(default, alias = "agentKey")]
    pub agent_key: Option<String>,
    #[serde(default, alias = "agentType")]
    pub agent_type: Option<String>,
    pub visibility: Option<String>,
    #[serde(default, alias = "proofState")]
    pub proof_state: Option<String>,
    #[serde(default, alias = "isPrimary")]
    pub is_primary: Option<bool>,
}

/// GET /v1/social/linked-agents — list linked agents for the authenticated profile.
/// Never returns full API key secrets (prefix only).
pub async fn list_my_linked_agents(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let agents = db(&state).social_get_linked_agents(&profile_id);
    ok(serde_json::json!({ "linkedAgents": agents }))
}

/// POST /v1/social/linked-agents — link an agent identity and issue a one-time API key.
/// Returns `agentKey` (plaintext) once; subsequent list responses only show `agentKeyPrefix`.
pub async fn create_linked_agent(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateLinkedAgentRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let agent_name = req.agent_name.trim();
    if agent_name.is_empty() || agent_name.len() > 80 {
        return bad_request("agentName must be 1-80 characters");
    }

    let agent_slug = req
        .agent_slug
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if agent_slug.len() < 2 || agent_slug.len() > 40 {
        return bad_request("agentSlug must be 2-40 alphanumeric characters (dash/underscore ok)");
    }

    // Always generate a CSPRNG hvak_ secret; ignore client-supplied agentKey for auth.
    let (plaintext_key, key_prefix, key_hash) = generate_agent_api_key();
    let _ = req.agent_key; // intentionally ignored for secret material

    let agent_type = req.agent_type.as_deref().unwrap_or("general").trim();
    let visibility = req.visibility.as_deref().unwrap_or("public");
    let proof_state = req.proof_state.as_deref().unwrap_or("pending");
    let is_primary = req.is_primary.unwrap_or(false);

    match db(&state).social_create_linked_agent(
        &profile_id,
        agent_name,
        &agent_slug,
        &key_prefix,
        &key_hash,
        agent_type,
        visibility,
        proof_state,
        is_primary,
    ) {
        Ok(mut agent) => {
            // One-time plaintext secret — only on create.
            if let Some(obj) = agent.as_object_mut() {
                obj.insert("agentKey".into(), serde_json::json!(plaintext_key));
            }
            ok(serde_json::json!({ "ok": true, "linkedAgent": agent }))
        }
        Err(msg) => conflict(&msg),
    }
}

/// POST /v1/social/linked-agents/{id}/rotate-key — Clerk only; returns new key once.
pub async fn rotate_linked_agent_key(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let (plaintext_key, key_prefix, key_hash) = generate_agent_api_key();
    match db(&state).social_rotate_linked_agent_key(&profile_id, &id, &key_prefix, &key_hash) {
        Ok(mut agent) => {
            if let Some(obj) = agent.as_object_mut() {
                obj.insert("agentKey".into(), serde_json::json!(plaintext_key));
            }
            ok(serde_json::json!({ "ok": true, "linkedAgent": agent }))
        }
        Err(msg) if msg.contains("not found") => not_found(&msg),
        Err(msg) => bad_request(&msg),
    }
}

/// Whether the authenticated viewer follows `{handle}`.
pub async fn get_follow_status(
    user: ClerkUser,
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let target = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let target_id = target["id"].as_str().unwrap_or("");
    let following = db(&state).social_get_follow_status(&profile_id, target_id);
    ok(serde_json::json!({ "following": following }))
}

pub async fn get_user_profile_stats(
    Path(handle): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let stats = db(&state).social_get_profile_stats(profile_id);
    ok(serde_json::json!({ "stats": stats }))
}

/// GET /v1/social/profiles/{handle}/followers — list profiles that follow this Page.
pub async fn get_profile_followers(
    Path(handle): Path<String>,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(20).min(100);
    // Opaque string cursor = decimal offset (followers are not keyset-paginated).
    let offset = params
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let followers = db(&state).social_list_followers(profile_id, limit, offset);
    let next_cursor = if followers.len() as i64 == limit {
        Some((offset + limit).to_string())
    } else {
        None
    };
    ok(serde_json::json!({
        "profile": profile,
        "followers": followers,
        "cursor": next_cursor,
        "has_more": next_cursor.is_some(),
    }))
}

/// GET /v1/social/profiles/{handle}/following — list profiles this Page follows.
pub async fn get_profile_following(
    Path(handle): Path<String>,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(20).min(100);
    let offset = params
        .cursor
        .as_deref()
        .and_then(|c| c.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    let following = db(&state).social_list_following(profile_id, limit, offset);
    let next_cursor = if following.len() as i64 == limit {
        Some((offset + limit).to_string())
    } else {
        None
    };
    ok(serde_json::json!({
        "profile": profile,
        "following": following,
        "cursor": next_cursor,
        "has_more": next_cursor.is_some(),
    }))
}

pub async fn get_user_posts(
    Path(handle): Path<String>,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_handle(&handle) {
        Some(p) => p,
        None => return not_found("User not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let mut posts = db(&state).social_get_user_posts(
        profile_id,
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
    );
    db(&state).social_enrich_feed_posts(&mut posts, None);
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    ok(serde_json::json!({
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
        Some(mut post) => {
            // Light view increment on open (no dedupe; FE hides zeros).
            if let Some(new_count) = db(&state).social_record_post_view(&id) {
                if let Some(obj) = post.as_object_mut() {
                    obj.insert("viewCount".into(), serde_json::json!(new_count));
                }
            }
            // Attach media so thread PostCard can render images without a separate call.
            let media = db(&state).social_get_post_media(&id);
            if let Some(obj) = post.as_object_mut() {
                obj.insert("media".into(), serde_json::json!(media));
            }
            // Full descendant list (flat) with replyToPostId for nested thread UI.
            let mut replies = db(&state).social_get_thread_replies(&id, viewer_pid.as_deref());
            db(&state).social_enrich_feed_posts(&mut replies, viewer_pid.as_deref());
            ok(serde_json::json!({
                "post": post,
                "replies": replies,
            }))
        },
        None => not_found("Post not found"),
    }
}

pub async fn get_following_feed(
    user: ClerkUser,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let blocked_ids = db(&state).social_get_blocked_ids(&profile_id);
    let muted_ids = db(&state).social_get_muted_ids(&profile_id);

    let mut posts = db(&state).social_get_following_feed(
        &profile_id,
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
        &blocked_ids,
        &muted_ids,
    );
    db(&state).social_enrich_feed_posts(&mut posts, Some(&profile_id));
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    ok(serde_json::json!({
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
            ok(obj)
        }
        None => not_found("Profile not found"),
    }
}

pub async fn create_me_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateProfileRequest>,
) -> impl IntoResponse {
    if db(&state).social_find_profile_by_clerk_id(&user.user_id).is_some() {
        return conflict("Profile already exists");
    }

    let handle = req.handle.trim().to_lowercase();
    if handle.len() < 2 || handle.len() > 30 {
        return bad_request("Handle must be 2-30 characters");
    }

    if db(&state).social_find_profile_by_handle(&handle).is_some() {
        return conflict("Handle is already taken");
    }

    let bio = req.bio.unwrap_or_default();
    let profile = db(&state).social_create_profile(&user.user_id, &handle, &req.display_name, &bio);
    ok(serde_json::json!({ "ok": true, "profile": profile }))
}

pub async fn update_me_profile(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdateProfileRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("No profile found — create a profile first"),
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
        Some(updated) => ok(serde_json::json!({ "ok": true, "profile": updated })),
        None => internal_error("Update failed"),
    }
}

// ─── Soft-delete post ──────────────────────────────────────────────────────

pub async fn delete_post(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    match db(&state).social_get_post_author_profile_id(&id) {
        Some(author_id) if author_id == profile_id => {}
        Some(_) => return forbidden("Not the post author"),
        None => return not_found("Post not found"),
    }
    db(&state).social_soft_delete_post(&id);
    ok(serde_json::json!({ "ok": true }))
}

// ─── Task #36: Community feed ──────────────────────────────────────────────

/// Resolve path param as community uuid id, else slug.
fn resolve_community_path(state: &AppState, id_or_slug: &str) -> Result<String, ApiResponse> {
    match db(state).social_resolve_community_id(id_or_slug) {
        Some(id) => Ok(id),
        None => Err(not_found("Community not found")),
    }
}

pub async fn create_community(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateCommunityRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 80 {
        return bad_request("name must be 1-80 characters");
    }

    let slug = req.slug.trim().to_lowercase();
    if slug.len() < 2 || slug.len() > 40 {
        return bad_request("slug must be 2-40 characters");
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return bad_request("slug may only contain a-z, 0-9, hyphen, underscore");
    }

    let description = req.description.unwrap_or_default();
    let visibility = req.visibility.as_deref().unwrap_or("public");
    if visibility != "public" && visibility != "private" {
        return bad_request("visibility must be public or private");
    }

    match db(&state).social_create_community(
        &profile_id,
        &slug,
        &name,
        description.trim(),
        visibility,
    ) {
        Ok(community) => ok(serde_json::json!({ "ok": true, "community": community })),
        Err(msg) if msg.contains("already taken") => conflict(&msg),
        Err(msg) => internal_error(&msg),
    }
}

pub async fn list_my_communities(
    user: ClerkUser,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let limit = params.limit.unwrap_or(20).min(100);
    let communities = db(&state).social_list_my_communities(&profile_id, limit);
    ok(serde_json::json!({ "communities": communities }))
}

pub async fn get_community_feed(
    Path(community_id): Path<String>,
    Query(params): Query<FeedQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let community_id = match resolve_community_path(&state, &community_id) {
        Ok(id) => id,
        Err(e) => return e,
    };
    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let (blocked_ids, muted_ids) = if let Some(ref pid) = viewer_pid {
        (
            db(&state).social_get_blocked_ids(pid),
            db(&state).social_get_muted_ids(pid),
        )
    } else {
        (vec![], vec![])
    };

    let mut posts = db(&state).social_get_community_feed(
        &community_id,
        limit,
        cursor_created_at.as_deref(),
        cursor_id.as_deref(),
        &blocked_ids,
        &muted_ids,
    );
    db(&state).social_enrich_feed_posts(&mut posts, viewer_pid.as_deref());
    let next_cursor = next_cursor_from_posts(&posts, limit);
    let has_more = posts.len() as i64 == limit;

    ok(serde_json::json!({
        "posts": posts,
        "cursor": next_cursor,
        "has_more": has_more,
    }))
}

// ─── Community Membership ─────────────────────────────────────────────────────

pub async fn join_community(
    user: ClerkUser,
    Path(community_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let community_id = match resolve_community_path(&state, &community_id) {
        Ok(id) => id,
        Err(e) => return e,
    };
    let joined = db(&state).social_join_community(&community_id, &profile_id);
    if joined {
        ok(serde_json::json!({ "ok": true, "joined": true }))
    } else {
        ok(serde_json::json!({ "ok": true, "joined": false, "message": "already a member" }))
    }
}

pub async fn leave_community(
    user: ClerkUser,
    Path(community_id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let community_id = match resolve_community_path(&state, &community_id) {
        Ok(id) => id,
        Err(e) => return e,
    };
    let left = db(&state).social_leave_community(&community_id, &profile_id);
    if left {
        ok(serde_json::json!({ "ok": true, "left": true }))
    } else {
        ok(serde_json::json!({ "ok": true, "left": false, "message": "not a member" }))
    }
}

pub async fn list_community_members(
    Path(community_id): Path<String>,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let community_id = match resolve_community_path(&state, &community_id) {
        Ok(id) => id,
        Err(e) => return e,
    };
    let limit = params.limit.unwrap_or(50).min(200);
    let members = db(&state).social_list_community_members(&community_id, limit);
    let count = members.len();
    ok(serde_json::json!({
        "members": members,
        "count": count,
    }))
}
