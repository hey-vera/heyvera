use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::clerk::ClerkUser;
use crate::state::AppState;

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

#[derive(Debug, Deserialize)]
pub struct ListDraftsQuery {
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDraftRequest {
    pub body: String,
    pub visibility: Option<String>,
    #[serde(rename = "authorMode")]
    pub author_mode: Option<String>,
    #[serde(rename = "linkedAgentId")]
    pub linked_agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RejectDraftRequest {
    pub reason: Option<String>,
}

pub async fn list_drafts(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListDraftsQuery>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "drafts": [] })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let drafts = db(&state).pulse_list_drafts(profile_id, query.status.as_deref());
    Json(json!({ "drafts": drafts }))
}

pub async fn create_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateDraftRequest>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "error": "Create a profile first", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("").to_string();
    let draft = db(&state).pulse_create_draft(
        &profile_id,
        &req.body,
        req.visibility.as_deref().unwrap_or("public"),
        req.author_mode.as_deref().unwrap_or("person"),
        req.linked_agent_id.as_deref(),
    );
    Json(json!({ "ok": true, "draft": draft }))
}

pub async fn get_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "error": "Not found", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).pulse_get_draft(&id, profile_id) {
        Some(draft) => Json(json!({ "draft": draft })),
        None => Json(json!({ "error": "Draft not found", "code": "NOT_FOUND" })),
    }
}

pub async fn approve_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "error": "Not found", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).pulse_update_draft_status(&id, profile_id, "approved") {
        Some(draft) => {
            db(&state).pulse_add_audit(&id, profile_id, "approved", None);
            Json(json!({ "ok": true, "draft": draft }))
        }
        None => Json(json!({ "error": "Draft not found", "code": "NOT_FOUND" })),
    }
}

pub async fn reject_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<RejectDraftRequest>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "error": "Not found", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).pulse_update_draft_status(&id, profile_id, "rejected") {
        Some(draft) => {
            let details = req.reason.as_deref().map(|r| json!({ "reason": r }).to_string());
            db(&state).pulse_add_audit(&id, profile_id, "rejected", details.as_deref());
            Json(json!({ "ok": true, "draft": draft }))
        }
        None => Json(json!({ "error": "Draft not found", "code": "NOT_FOUND" })),
    }
}

pub async fn publish_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "error": "Not found", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");

    let draft = match db(&state).pulse_get_draft(&id, profile_id) {
        Some(d) => d,
        None => return Json(json!({ "error": "Draft not found", "code": "NOT_FOUND" })),
    };

    if draft["status"].as_str() != Some("approved") {
        return Json(json!({ "error": "Draft must be approved before publishing", "code": "BAD_REQUEST" }));
    }

    let body = draft["body"].as_str().unwrap_or("");
    let visibility = draft["visibility"].as_str().unwrap_or("public");
    let author_mode = draft["authorMode"].as_str().unwrap_or("person");
    let linked_agent_id = draft["linkedAgentId"].as_str();

    let post = db(&state).social_create_post(profile_id, body, visibility, author_mode, linked_agent_id, None, None);
    let post_id = post["id"].as_str().unwrap_or("").to_string();

    let updated_draft = db(&state).pulse_update_draft_status(&id, profile_id, "published");
    db(&state).pulse_add_audit(&id, profile_id, "published", Some(&json!({ "postId": post_id }).to_string()));

    Json(json!({ "ok": true, "draft": updated_draft, "postId": post_id }))
}

pub async fn get_draft_audit(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return Json(json!({ "error": "Not found", "code": "NOT_FOUND" })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    // Verify draft belongs to user
    if db(&state).pulse_get_draft(&id, profile_id).is_none() {
        return Json(json!({ "error": "Draft not found", "code": "NOT_FOUND" }));
    }
    let audit = db(&state).pulse_get_audit(&id);
    Json(json!({ "audit": audit }))
}
