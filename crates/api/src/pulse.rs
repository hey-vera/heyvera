use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::clerk::ClerkUser;
use crate::state::AppState;

type ApiResponse = (StatusCode, Json<serde_json::Value>);

fn ok(v: serde_json::Value) -> ApiResponse { (StatusCode::OK, Json(v)) }
fn not_found(msg: &str) -> ApiResponse { (StatusCode::NOT_FOUND, Json(json!({ "error": msg, "code": "NOT_FOUND" }))) }
fn bad_request(msg: &str) -> ApiResponse { (StatusCode::BAD_REQUEST, Json(json!({ "error": msg, "code": "BAD_REQUEST" }))) }

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
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return ok(json!({ "drafts": [] })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let drafts = db(&state).pulse_list_drafts(profile_id, query.status.as_deref());
    ok(json!({ "drafts": drafts }))
}

pub async fn create_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateDraftRequest>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Create a profile first"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("").to_string();
    let draft = db(&state).pulse_create_draft(
        &profile_id,
        &req.body,
        req.visibility.as_deref().unwrap_or("public"),
        req.author_mode.as_deref().unwrap_or("person"),
        req.linked_agent_id.as_deref(),
    );
    ok(json!({ "ok": true, "draft": draft }))
}

pub async fn get_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).pulse_get_draft(&id, profile_id) {
        Some(draft) => ok(json!({ "draft": draft })),
        None => not_found("Draft not found"),
    }
}

pub async fn approve_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).pulse_update_draft_status(&id, profile_id, "approved") {
        Some(draft) => {
            db(&state).pulse_add_audit(&id, profile_id, "approved", None);
            ok(json!({ "ok": true, "draft": draft }))
        }
        None => not_found("Draft not found"),
    }
}

pub async fn reject_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<RejectDraftRequest>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    match db(&state).pulse_update_draft_status(&id, profile_id, "rejected") {
        Some(draft) => {
            let details = req.reason.as_deref().map(|r| json!({ "reason": r }).to_string());
            db(&state).pulse_add_audit(&id, profile_id, "rejected", details.as_deref());
            ok(json!({ "ok": true, "draft": draft }))
        }
        None => not_found("Draft not found"),
    }
}

pub async fn publish_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");

    let draft = match db(&state).pulse_get_draft(&id, profile_id) {
        Some(d) => d,
        None => return not_found("Draft not found"),
    };

    if draft["status"].as_str() != Some("approved") {
        return bad_request("Draft must be approved before publishing");
    }

    let body = draft["body"].as_str().unwrap_or("");
    let visibility = draft["visibility"].as_str().unwrap_or("public");
    let author_mode = draft["authorMode"].as_str().unwrap_or("person");
    let linked_agent_id = draft["linkedAgentId"].as_str();

    let post = db(&state).social_create_post(profile_id, body, visibility, author_mode, linked_agent_id, None, None);
    let post_id = post["id"].as_str().unwrap_or("").to_string();

    let updated_draft = db(&state).pulse_update_draft_status(&id, profile_id, "published");
    db(&state).pulse_add_audit(&id, profile_id, "published", Some(&json!({ "postId": post_id }).to_string()));

    ok(json!({ "ok": true, "draft": updated_draft, "postId": post_id }))
}

pub async fn get_draft_audit(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Not found"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    if db(&state).pulse_get_draft(&id, profile_id).is_none() {
        return not_found("Draft not found");
    }
    let audit = db(&state).pulse_get_audit(&id);
    ok(json!({ "audit": audit }))
}

// ─── Pulse chat (v1 tool router — same mutations as draft APIs) ─────────────

#[derive(Debug, Deserialize)]
pub struct PulseChatRequest {
    pub message: String,
    /// Optional prior messages for future LLM context (ignored by deterministic router).
    #[serde(default)]
    #[allow(dead_code)]
    pub history: Vec<PulseChatHistoryItem>,
}

#[derive(Debug, Deserialize)]
pub struct PulseChatHistoryItem {
    #[allow(dead_code)]
    pub role: Option<String>,
    #[allow(dead_code)]
    pub content: Option<String>,
}

/// Strip common "draft a post about …" prefixes to get the body.
fn extract_draft_body(message: &str) -> Option<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_lowercase();
    let prefixes = [
        "draft a post about ",
        "draft a post saying ",
        "draft a post that says ",
        "draft a post: ",
        "draft a post ",
        "write a post about ",
        "write a post saying ",
        "write a post: ",
        "write a post ",
        "create a draft about ",
        "create a draft: ",
        "create a draft ",
        "draft about ",
        "draft: ",
        "post about ",
        "post: ",
    ];
    for prefix in prefixes {
        if lower.starts_with(prefix) {
            let body = trimmed[prefix.len()..].trim();
            if body.len() >= 3 {
                return Some(body.to_string());
            }
        }
    }
    // "draft ..." with content after keyword
    if lower.starts_with("draft ") || lower.starts_with("write ") {
        let rest = trimmed.split_once(' ').map(|(_, r)| r.trim()).unwrap_or("");
        let rest = rest
            .trim_start_matches(|c: char| c.is_ascii_whitespace())
            .trim_start_matches("a ")
            .trim_start_matches("post ")
            .trim_start_matches("about ")
            .trim_start_matches("saying ")
            .trim();
        if rest.len() >= 8 {
            return Some(rest.to_string());
        }
    }
    None
}

/// Deterministic chat tools for Pulse v1.
/// Full LLM tool-calling comes later; this keeps tools server-side and honest.
pub async fn pulse_chat(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<PulseChatRequest>,
) -> ApiResponse {
    let message = req.message.trim();
    if message.is_empty() {
        return bad_request("message is required");
    }
    if message.len() > 4000 {
        return bad_request("message too long");
    }

    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return ok(json!({
                "reply": "Create a HeyVera profile first, then I can save drafts to your account.",
                "mode": "tools_v1",
                "toolsUsed": [],
                "draft": null,
            }));
        }
    };
    let profile_id = profile["id"].as_str().unwrap_or("").to_string();
    let lower = message.to_lowercase();

    // list drafts
    if lower.contains("list draft")
        || lower.contains("show draft")
        || lower.contains("my draft")
        || lower == "drafts"
        || lower.contains("pending draft")
    {
        let drafts = db(&state).pulse_list_drafts(&profile_id, Some("pending"));
        let count = drafts.len();
        let preview: Vec<String> = drafts
            .iter()
            .take(5)
            .filter_map(|d| {
                let body = d["body"].as_str().unwrap_or("");
                let id = d["id"].as_str().unwrap_or("");
                if body.is_empty() {
                    None
                } else {
                    let short = if body.len() > 60 {
                        format!("{}…", &body[..60])
                    } else {
                        body.to_string()
                    };
                    Some(format!("• {short} ({id})"))
                }
            })
            .collect();
        let reply = if count == 0 {
            "You have no pending drafts. Try: \"draft a post about …\"".to_string()
        } else {
            format!(
                "You have {count} pending draft(s). Open the Drafts tab to approve, dismiss, or publish.\n{}",
                preview.join("\n")
            )
        };
        return ok(json!({
            "reply": reply,
            "mode": "tools_v1",
            "toolsUsed": ["list_drafts"],
            "draft": null,
            "draftCount": count,
        }));
    }

    // help
    if lower.contains("help") || lower.contains("what can") || lower == "?" {
        return ok(json!({
            "reply": "I'm Pulse draft tools (v1) — not a full marketing AI yet.\n\n• \"draft a post about …\" — create a draft\n• \"list drafts\" — show pending drafts\n• Drafts tab — approve / dismiss / publish\n\nComing later: real LLM chat, schedule, autopilot.",
            "mode": "tools_v1",
            "toolsUsed": [],
            "draft": null,
        }));
    }

    // create draft
    if let Some(body) = extract_draft_body(message) {
        if body.len() > 5000 {
            return bad_request("draft body too long");
        }
        let draft = db(&state).pulse_create_draft(
            &profile_id,
            &body,
            "public",
            "person",
            None,
        );
        let short = if body.len() > 100 {
            format!("{}…", &body[..100])
        } else {
            body.clone()
        };
        return ok(json!({
            "reply": format!(
                "Saved a draft: \"{short}\". Open the Drafts tab to approve and publish. I won't post publicly without your approval."
            ),
            "mode": "tools_v1",
            "toolsUsed": ["create_draft"],
            "draft": draft,
        }));
    }

    // default honest reply
    ok(json!({
        "reply": "I can create and list drafts for your HeyVera profile. Try \"draft a post about …\" or \"list drafts\". Full conversational AI is not live yet — this is the server-side tools path (same as the Drafts API).",
        "mode": "tools_v1",
        "toolsUsed": [],
        "draft": null,
    }))
}
