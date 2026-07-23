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
use rand::RngCore;
use sha2::{Digest, Sha256};

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
    /// Optional Page id from listMyPages: person → person post; agent → agent authorship;
    /// brand → person post as steward (v1; brand-as-author later).
    #[serde(default, rename = "pageId", alias = "page_id")]
    pub page_id: Option<String>,
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
pub struct CreatePageRequest {
    /// v1: only `"brand"` is accepted (person/agent are derived).
    pub kind: String,
    pub slug: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCommunityRequest {
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub visibility: Option<String>,
}

/// Owner-create invite for a community (private guilds primarily).
#[derive(Debug, Deserialize)]
pub struct CreateCommunityInviteRequest {
    /// Optional max redemptions. Omit / null = unlimited.
    #[serde(default, rename = "maxUses", alias = "max_uses")]
    pub max_uses: Option<i64>,
    /// Optional TTL in hours from now. Omit / null = no expiry.
    #[serde(default, rename = "expiresInHours", alias = "expires_in_hours")]
    pub expires_in_hours: Option<i64>,
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

/// Wave 11b — create an empty Page-owned media shelf (no items yet).
#[derive(Debug, Deserialize)]
pub struct CreateShelfRequest {
    pub title: String,
    pub description: Option<String>,
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

/// Resolve optional `pageId` into (author_mode, linked_agent_id).
/// - person page (id == profile_id) → person
/// - agent page (linked agent owned by profile) → agent + linked_agent_id
/// - brand page owned by profile → person (steward posts; brand-as-author later)
fn resolve_page_authorship(
    state: &AppState,
    profile_id: &str,
    page_id: &str,
) -> Result<(String, Option<String>), ApiResponse> {
    if page_id == profile_id {
        return Ok(("person".to_string(), None));
    }
    if db(state).social_linked_agent_belongs_to(profile_id, page_id) {
        return Ok(("agent".to_string(), Some(page_id.to_string())));
    }
    if let Some(page) = db(state).social_find_page_by_id(page_id) {
        let kind = page["kind"].as_str().unwrap_or("");
        let owner = page["ownerProfileId"].as_str().unwrap_or("");
        if kind == "brand" && owner == profile_id {
            // Brand posts still use steward person authorship in v1.
            return Ok(("person".to_string(), None));
        }
        return Err(forbidden("pageId is not owned by your profile"));
    }
    Err(bad_request("pageId not found"))
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

            // pageId maps Page selector → authorship (overrides bare authorMode when set).
            let (author_mode, linked_agent_id) = if let Some(ref page_id) = req.page_id {
                let page_id = page_id.trim();
                if page_id.is_empty() {
                    let author_mode = req.author_mode.as_deref().unwrap_or("person").to_string();
                    (author_mode, req.linked_agent_id.clone())
                } else {
                    match resolve_page_authorship(&state, &profile_id, page_id) {
                        Ok(pair) => pair,
                        Err(resp) => return resp,
                    }
                }
            } else {
                let author_mode = req.author_mode.as_deref().unwrap_or("person").to_string();
                (author_mode, req.linked_agent_id.clone())
            };

            if let Err(resp) = ensure_linked_agent_allowed(
                &state,
                &profile_id,
                &author_mode,
                linked_agent_id.as_deref(),
            ) {
                return resp;
            }
            (profile_id, author_mode, linked_agent_id)
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
    // Document resolved authorship on the envelope (also present on post.authorMode).
    let mut result = serde_json::json!({
        "ok": true,
        "authorMode": author_mode,
    });
    if let Some(media_list) = media {
        if let Some(obj) = post_out.as_object_mut() {
            obj.insert("media".into(), serde_json::json!(media_list.clone()));
        }
        result["media"] = serde_json::json!(media_list);
    }
    // Enrich so create response includes nested quotePost (and counts/media) for FE adapters.
    let mut enriched = vec![post_out];
    db(&state).social_enrich_feed_posts(&mut enriched, Some(&profile_id));
    result["post"] = enriched.remove(0);
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

// ─── Wave 12a — agent policy foundation (steward-gated flags) ────────────────

#[derive(Debug, Deserialize)]
pub struct PatchLinkedAgentRequest {
    /// When true, steward prefers auto-reply for this linked agent.
    /// Foundation only: no auto-reply worker runs yet.
    #[serde(default, alias = "autoReplyEnabled")]
    pub auto_reply_enabled: Option<bool>,
    /// When true, steward prefers auto-follow for this linked agent.
    /// Foundation only: no auto-follow worker runs yet.
    #[serde(default, alias = "autoFollowEnabled")]
    pub auto_follow_enabled: Option<bool>,
}

/// Honesty note returned with policy patches so clients never claim live automation.
pub const AGENT_POLICY_FOUNDATION_NOTE: &str =
    "Policy flags saved. Auto-reply and auto-follow are foundation only — not fully automated yet (no worker runs these flags).";

/// Pure helper: whether a policy patch body has at least one recognized flag.
pub fn has_policy_patch(req: &PatchLinkedAgentRequest) -> bool {
    req.auto_reply_enabled.is_some() || req.auto_follow_enabled.is_some()
}

/// PATCH /v1/social/linked-agents/{id} — steward-only policy flags.
///
/// Persists `autoReplyEnabled` / `autoFollowEnabled` (default false). Does **not**
/// start silent auto-reply bots; workers that honor these flags are not shipped.
pub async fn patch_linked_agent(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<PatchLinkedAgentRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if !has_policy_patch(&req) {
        return bad_request("at least one of autoReplyEnabled or autoFollowEnabled is required");
    }
    match db(&state).social_update_linked_agent_policies(
        &profile_id,
        &id,
        req.auto_reply_enabled,
        req.auto_follow_enabled,
    ) {
        Ok(agent) => ok(serde_json::json!({
            "ok": true,
            "linkedAgent": agent,
            "note": AGENT_POLICY_FOUNDATION_NOTE,
        })),
        Err(msg) if msg.contains("not found") => not_found(&msg),
        Err(msg) => bad_request(&msg),
    }
}

#[cfg(test)]
mod agent_policy_tests {
    use super::*;

    #[test]
    fn has_policy_patch_false_when_empty() {
        let req = PatchLinkedAgentRequest {
            auto_reply_enabled: None,
            auto_follow_enabled: None,
        };
        assert!(!has_policy_patch(&req));
    }

    #[test]
    fn has_policy_patch_true_for_reply_or_follow() {
        assert!(has_policy_patch(&PatchLinkedAgentRequest {
            auto_reply_enabled: Some(true),
            auto_follow_enabled: None,
        }));
        assert!(has_policy_patch(&PatchLinkedAgentRequest {
            auto_reply_enabled: None,
            auto_follow_enabled: Some(false),
        }));
    }

    #[test]
    fn foundation_note_is_honest() {
        let lower = AGENT_POLICY_FOUNDATION_NOTE.to_lowercase();
        assert!(lower.contains("foundation") || lower.contains("not fully automated"));
        assert!(lower.contains("no worker") || lower.contains("not fully automated"));
        assert!(!lower.contains("agents active"));
        assert!(!lower.contains("live automation"));
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
            // Cap 100 / max depth 8 — surface honesty when walk stopped early.
            let (mut replies, replies_truncated) =
                db(&state).social_get_thread_replies(&id, viewer_pid.as_deref());
            db(&state).social_enrich_feed_posts(&mut replies, viewer_pid.as_deref());
            ok(serde_json::json!({
                "post": post,
                "replies": replies,
                "repliesTruncated": replies_truncated,
                "repliesCap": 100,
            }))
        },
        None => not_found("Post not found"),
    }
}

/// Wave 14a: related posts via shared hashtags + same author + recency (not ML).
#[derive(Debug, Deserialize)]
pub struct RelatedPostsQuery {
    pub limit: Option<i64>,
}

pub async fn get_related_posts(
    Path(id): Path<String>,
    Query(params): Query<RelatedPostsQuery>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    // Default 8; hard cap 20 (enforced again in db).
    let limit = params.limit.unwrap_or(8).clamp(1, 20);
    match db(&state).social_get_related_posts(&id, limit, viewer_pid.as_deref()) {
        Some(mut posts) => {
            db(&state).social_enrich_feed_posts(&mut posts, viewer_pid.as_deref());
            ok(serde_json::json!({
                "posts": posts,
                "sourcePostId": id,
            }))
        }
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

// ─── Batch B1: /me/prefs privacy preferences ────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct UpdatePrefsRequest {
    #[serde(default, rename = "dmPolicy", alias = "dm_policy")]
    pub dm_policy: Option<String>,
    #[serde(default, rename = "discoverableByContact", alias = "discoverable_by_contact")]
    pub discoverable_by_contact: Option<bool>,
    #[serde(default, rename = "showInSearch", alias = "show_in_search")]
    pub show_in_search: Option<bool>,
    #[serde(default, rename = "protectedPosts", alias = "protected_posts")]
    pub protected_posts: Option<bool>,
    #[serde(default, rename = "profileVisibility", alias = "profile_visibility")]
    pub profile_visibility: Option<String>,
    #[serde(default, rename = "allowAgentDms", alias = "allow_agent_dms")]
    pub allow_agent_dms: Option<bool>,
    #[serde(default, rename = "allowAgentMentions", alias = "allow_agent_mentions")]
    pub allow_agent_mentions: Option<bool>,
}

fn normalize_dm_policy(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "everyone" | "all" | "open" => Some("everyone"),
        "verified" | "verified_users" => Some("verified"),
        "following" | "people_you_follow" | "followers" => Some("following"),
        _ => None,
    }
}

fn normalize_profile_visibility(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().replace('-', "_").as_str() {
        "public" => Some("public"),
        "signed_in" | "signedin" | "signed_in_users" => Some("signed_in"),
        "followers" | "followers_only" => Some("followers"),
        _ => None,
    }
}

/// GET /v1/social/me/prefs — lazy-create defaults on first read.
pub async fn get_me_prefs(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("No profile found — create a profile first"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let prefs = db(&state).social_get_or_create_profile_prefs(profile_id);
    ok(prefs)
}

/// PATCH /v1/social/me/prefs — partial update; camelCase preferred.
pub async fn patch_me_prefs(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpdatePrefsRequest>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("No profile found — create a profile first"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");

    let dm_policy = match &req.dm_policy {
        None => None,
        Some(s) => match normalize_dm_policy(s) {
            Some(v) => Some(v),
            None => return bad_request("dmPolicy must be everyone, verified, or following"),
        },
    };
    let profile_visibility = match &req.profile_visibility {
        None => None,
        Some(s) => match normalize_profile_visibility(s) {
            Some(v) => Some(v),
            None => {
                return bad_request("profileVisibility must be public, signed_in, or followers")
            }
        },
    };

    let prefs = db(&state).social_update_profile_prefs(
        profile_id,
        dm_policy,
        req.discoverable_by_contact,
        req.show_in_search,
        req.protected_posts,
        profile_visibility,
        req.allow_agent_dms,
        req.allow_agent_mentions,
    );
    ok(prefs)
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

    // Private guilds require membership (Wave 8e).
    let community = match db(&state).social_get_community_by_id(&community_id) {
        Some(c) => c,
        None => return not_found("Community not found"),
    };
    let visibility = community["visibility"].as_str().unwrap_or("public");
    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    if visibility == "private" {
        let is_member = viewer_pid
            .as_deref()
            .map(|pid| db(&state).social_is_community_member(&community_id, pid))
            .unwrap_or(false);
        if !is_member {
            return forbidden("Private community — membership required");
        }
    }

    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_id) = params
        .cursor
        .as_deref()
        .and_then(decode_cursor)
        .map(|(c, i)| (Some(c), Some(i)))
        .unwrap_or((None, None));

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

/// SHA-256 hex of a community invite token (plaintext never stored).
fn hash_community_invite_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate invite token: `hvinv_` + 24 CSPRNG bytes base64url. Returns (plaintext, hash).
fn generate_community_invite_token() -> (String, String) {
    let mut bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let secret = format!("hvinv_{}", URL_SAFE_NO_PAD.encode(bytes));
    let hash = hash_community_invite_token(&secret);
    (secret, hash)
}

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

    // Private guilds: open join is closed — redeem an invite instead (Batch C).
    let community = match db(&state).social_get_community_by_id(&community_id) {
        Some(c) => c,
        None => return not_found("Community not found"),
    };
    let visibility = community["visibility"].as_str().unwrap_or("public");
    if visibility == "private" {
        // Already a member: treat as no-op success (leave still works).
        if db(&state).social_is_community_member(&community_id, &profile_id) {
            return ok(serde_json::json!({
                "ok": true,
                "joined": false,
                "message": "already a member"
            }));
        }
        return forbidden("Private community — invite required");
    }

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
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let community_id = match resolve_community_path(&state, &community_id) {
        Ok(id) => id,
        Err(e) => return e,
    };

    // Private guilds: members list requires membership (Batch C ACL).
    let community = match db(&state).social_get_community_by_id(&community_id) {
        Some(c) => c,
        None => return not_found("Community not found"),
    };
    let visibility = community["visibility"].as_str().unwrap_or("public");
    if visibility == "private" {
        let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
        let is_member = viewer_pid
            .as_deref()
            .map(|pid| db(&state).social_is_community_member(&community_id, pid))
            .unwrap_or(false);
        if !is_member {
            return forbidden("Private community — membership required to view members");
        }
    }

    let limit = params.limit.unwrap_or(50).min(200);
    let members = db(&state).social_list_community_members(&community_id, limit);
    let count = members.len();
    ok(serde_json::json!({
        "members": members,
        "count": count,
    }))
}

// ─── Community invites (Batch C) ─────────────────────────────────────────────

/// POST /v1/social/communities/{id}/invites — owner creates an invite (token once).
pub async fn create_community_invite(
    user: ClerkUser,
    Path(community_id): Path<String>,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateCommunityInviteRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let community_id = match resolve_community_path(&state, &community_id) {
        Ok(id) => id,
        Err(e) => return e,
    };

    let role = db(&state).social_community_member_role(&community_id, &profile_id);
    if role.as_deref() != Some("owner") {
        return forbidden("Only the community owner can create invites");
    }

    if let Some(max) = req.max_uses {
        if max < 1 || max > 10_000 {
            return bad_request("maxUses must be between 1 and 10000");
        }
    }
    if let Some(hours) = req.expires_in_hours {
        if hours < 1 || hours > 24 * 365 {
            return bad_request("expiresInHours must be between 1 and 8760");
        }
    }

    let expires_at = req.expires_in_hours.map(|h| {
        // SQLite-friendly datetime relative to now.
        format!(
            "{}",
            chrono::Utc::now()
                .checked_add_signed(chrono::Duration::hours(h))
                .unwrap_or_else(chrono::Utc::now)
                .format("%Y-%m-%d %H:%M:%S")
        )
    });

    let (token, token_hash) = generate_community_invite_token();
    match db(&state).social_create_community_invite(
        &community_id,
        &profile_id,
        &token_hash,
        req.max_uses,
        expires_at.as_deref(),
    ) {
        Ok(mut invite) => {
            // Plaintext token returned once — never stored.
            if let Some(obj) = invite.as_object_mut() {
                obj.insert("token".into(), serde_json::Value::String(token));
            }
            ok(serde_json::json!({ "ok": true, "invite": invite }))
        }
        Err(msg) => internal_error(&msg),
    }
}

/// GET /v1/social/communities/{id}/invites — owner lists invites (no tokens).
pub async fn list_community_invites(
    user: ClerkUser,
    Path(community_id): Path<String>,
    Query(params): Query<FeedQuery>,
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

    let role = db(&state).social_community_member_role(&community_id, &profile_id);
    if role.as_deref() != Some("owner") {
        return forbidden("Only the community owner can list invites");
    }

    let limit = params.limit.unwrap_or(50).min(200);
    let invites = db(&state).social_list_community_invites(&community_id, limit);
    ok(serde_json::json!({ "invites": invites, "count": invites.len() }))
}

/// DELETE /v1/social/communities/{id}/invites/{inviteId} — owner revokes.
pub async fn revoke_community_invite(
    user: ClerkUser,
    Path((community_id, invite_id)): Path<(String, String)>,
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

    let role = db(&state).social_community_member_role(&community_id, &profile_id);
    if role.as_deref() != Some("owner") {
        return forbidden("Only the community owner can revoke invites");
    }

    let revoked = db(&state).social_revoke_community_invite(&community_id, &invite_id);
    if revoked {
        ok(serde_json::json!({ "ok": true, "revoked": true }))
    } else {
        not_found("Invite not found or already revoked")
    }
}

/// POST /v1/social/invites/{token}/redeem — join via invite (auth required).
pub async fn redeem_community_invite(
    user: ClerkUser,
    Path(token): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let token = token.trim();
    if token.is_empty() || token.len() > 200 {
        return bad_request("invalid invite token");
    }
    if !token.starts_with("hvinv_") {
        return bad_request("invalid invite token");
    }

    let token_hash = hash_community_invite_token(token);
    match db(&state).social_redeem_community_invite(&token_hash, &profile_id) {
        Ok((community_id, joined)) => {
            let community = db(&state).social_get_community_by_id(&community_id);
            ok(serde_json::json!({
                "ok": true,
                "joined": joined,
                "communityId": community_id,
                "community": community,
                "message": if joined { "joined" } else { "already a member" },
            }))
        }
        Err(msg) if msg.to_lowercase().contains("not found") => not_found(&msg),
        Err(msg)
            if msg.to_lowercase().contains("revoked")
                || msg.to_lowercase().contains("expired")
                || msg.to_lowercase().contains("limit") =>
        {
            forbidden(&msg)
        }
        Err(msg) => bad_request(&msg),
    }
}

// ─── Wave 6 / 8d: Page multi-surface ─────────────────────────────────────────

/// GET /v1/social/pages/{slug} — public brand page by slug (also accepts page id).
pub async fn get_page_by_slug(
    Path(slug): Path<String>,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let slug = slug.trim().to_lowercase();
    if slug.is_empty() {
        return bad_request("slug is required");
    }

    let brand = db(&state)
        .social_find_page_by_slug(&slug)
        .or_else(|| db(&state).social_find_page_by_id(&slug));
    let brand = match brand {
        Some(b) if b["kind"].as_str() == Some("brand") => b,
        _ => return not_found("Page not found"),
    };

    let page_id = brand["id"].as_str().unwrap_or("").to_string();
    let owner_id = brand["ownerProfileId"].as_str().unwrap_or("").to_string();
    let follower_count = db(&state).social_page_follower_count(&page_id);

    let viewer_pid = optional_viewer_profile_id(&headers, &state).await;
    let is_following = viewer_pid
        .as_deref()
        .map(|pid| db(&state).social_page_is_following(&page_id, pid))
        .unwrap_or(false);
    let is_owner = viewer_pid
        .as_deref()
        .map(|pid| pid == owner_id)
        .unwrap_or(false);

    ok(serde_json::json!({
        "page": {
            "id": brand["id"],
            "kind": "brand",
            "handle": brand["slug"],
            "slug": brand["slug"],
            "displayName": brand["displayName"],
            "description": brand["description"],
            "avatarUrl": brand["avatarUrl"],
            "parentProfileId": brand["ownerProfileId"],
            "isDefault": false,
            "createdAt": brand["createdAt"],
            "followerCount": follower_count,
            "isFollowing": is_following,
            "isOwner": is_owner,
        }
    }))
}

/// GET /v1/social/pages/mine — steward's person Page + linked agent Pages + brand Pages.
pub async fn list_my_pages(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("No profile found — create a profile first"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("").to_string();

    let mut pages = Vec::new();

    // Person Page (always; 1:1 with social_profile; isDefault).
    pages.push(serde_json::json!({
        "id": profile_id,
        "kind": "person",
        "handle": profile["handle"],
        "displayName": profile["displayName"],
        "avatarUrl": profile["avatarUrl"],
        "isDefault": true,
    }));

    // Agent Pages (linked agents as publish actors).
    for agent in db(&state).social_get_linked_agents(&profile_id) {
        let agent_id = agent["id"].as_str().unwrap_or("").to_string();
        let handle = agent["agentSlug"].as_str().unwrap_or("").to_string();
        let display_name = agent["agentName"].as_str().unwrap_or("").to_string();
        pages.push(serde_json::json!({
            "id": agent_id,
            "kind": "agent",
            "handle": handle,
            "displayName": display_name,
            "avatarUrl": null,
            "parentProfileId": profile_id,
            "isDefault": false,
        }));
    }

    // Brand Pages (social_pages rows).
    for brand in db(&state).social_list_brand_pages(&profile_id) {
        pages.push(serde_json::json!({
            "id": brand["id"],
            "kind": "brand",
            "handle": brand["slug"],
            "displayName": brand["displayName"],
            "avatarUrl": brand["avatarUrl"],
            "parentProfileId": profile_id,
            "description": brand["description"],
            "isDefault": false,
        }));
    }

    ok(serde_json::json!({ "pages": pages }))
}

/// POST /v1/social/pages — create a brand Page (kind must be "brand").
pub async fn create_page(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePageRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };

    let kind = req.kind.trim().to_lowercase();
    if kind != "brand" {
        return bad_request("Only kind \"brand\" can be created; person/agent Pages are derived");
    }

    let slug = req
        .slug
        .trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if slug.len() < 2 || slug.len() > 40 {
        return bad_request("slug must be 2-40 alphanumeric characters (dash/underscore ok)");
    }

    let display_name = req.display_name.trim();
    if display_name.is_empty() || display_name.len() > 80 {
        return bad_request("displayName must be 1-80 characters");
    }

    let description = req.description.unwrap_or_default();
    let description = description.trim();
    if description.len() > 500 {
        return bad_request("description exceeds 500 characters");
    }

    match db(&state).social_create_brand_page(&profile_id, &slug, display_name, description) {
        Ok(brand) => {
            let page = serde_json::json!({
                "id": brand["id"],
                "kind": "brand",
                "handle": brand["slug"],
                "displayName": brand["displayName"],
                "avatarUrl": brand["avatarUrl"],
                "parentProfileId": profile_id,
                "description": brand["description"],
                "isDefault": false,
            });
            ok(serde_json::json!({ "ok": true, "page": page }))
        }
        Err(msg) if msg.contains("taken") => conflict(&msg),
        Err(msg) => bad_request(&msg),
    }
}

/// POST /v1/social/pages/{id}/follow — follow a brand Page (person/agent still use handle follow).
pub async fn follow_page(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };

    // Brand page → social_page_follows.
    if let Some(page) = db(&state).social_find_page_by_id(&id) {
        let owner = page["ownerProfileId"].as_str().unwrap_or("");
        if owner == profile_id {
            return bad_request("Cannot follow your own page");
        }
        db(&state).social_page_follow(&id, &profile_id);
        return ok(serde_json::json!({ "ok": true, "kind": "brand" }));
    }

    // Agent page id → follow the owner person profile (v1 seam).
    if let Some(agent) = db(&state).social_find_linked_agent_by_id(&id) {
        let owner = agent["profileId"].as_str().unwrap_or("").to_string();
        if owner.is_empty() {
            return not_found("Page not found");
        }
        if owner == profile_id {
            return bad_request("Cannot follow your own page");
        }
        db(&state).social_follow(&profile_id, &owner);
        db(&state).social_create_notification(&owner, &profile_id, "follow", None);
        return ok(serde_json::json!({ "ok": true, "kind": "agent", "followedProfileId": owner }));
    }

    // Person page id (= profile id) → standard profile follow.
    if let Some(target) = db(&state).social_find_profile_by_id(&id) {
        let target_id = target["id"].as_str().unwrap_or("").to_string();
        if target_id == profile_id {
            return bad_request("Cannot follow yourself");
        }
        db(&state).social_follow(&profile_id, &target_id);
        db(&state).social_create_notification(&target_id, &profile_id, "follow", None);
        return ok(serde_json::json!({ "ok": true, "kind": "person" }));
    }

    not_found("Page not found")
}

/// DELETE /v1/social/pages/{id}/follow
pub async fn unfollow_page(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };

    if db(&state).social_find_page_by_id(&id).is_some() {
        db(&state).social_page_unfollow(&id, &profile_id);
        return ok(serde_json::json!({ "ok": true, "kind": "brand" }));
    }

    if let Some(agent) = db(&state).social_find_linked_agent_by_id(&id) {
        let owner = agent["profileId"].as_str().unwrap_or("");
        if !owner.is_empty() {
            db(&state).social_unfollow(&profile_id, owner);
        }
        return ok(serde_json::json!({ "ok": true, "kind": "agent" }));
    }

    if db(&state).social_find_profile_by_id(&id).is_some() {
        db(&state).social_unfollow(&profile_id, &id);
        return ok(serde_json::json!({ "ok": true, "kind": "person" }));
    }

    not_found("Page not found")
}

// ─── Wave 11b: Page-owned media shelves (empty foundation) ───────────────────

/// GET /v1/social/shelves/mine — list empty shelves for the steward person Page.
/// Never invents video cards; itemCount is always 0 until items ship.
pub async fn list_my_shelves(
    user: ClerkUser,
    Query(params): Query<FeedQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let limit = params.limit.unwrap_or(50).clamp(1, 100);
    let shelves = db(&state).social_list_media_shelves(&profile_id, limit);
    ok(serde_json::json!({ "shelves": shelves }))
}

/// POST /v1/social/shelves — create an empty shelf owned by the steward person Page.
/// No items / playlist membership yet — foundation only.
pub async fn create_shelf(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateShelfRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let description = req.description.unwrap_or_default();
    match db(&state).social_create_media_shelf(&profile_id, &req.title, &description) {
        Ok(shelf) => ok(serde_json::json!({ "ok": true, "shelf": shelf })),
        Err(msg) => bad_request(&msg),
    }
}
