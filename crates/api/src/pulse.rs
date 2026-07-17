use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::agent_auth::SocialWriteAuth;
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
    auth: SocialWriteAuth,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateDraftRequest>,
) -> ApiResponse {
    // Dual auth: Clerk or Agent bearer. Agent forces profile + author_mode=agent.
    let (profile_id, author_mode, linked_agent_id): (String, String, Option<String>) = match &auth {
        SocialWriteAuth::Agent(agent) => (
            agent.profile_id.clone(),
            "agent".to_string(),
            Some(agent.agent_id.clone()),
        ),
        SocialWriteAuth::Clerk(user) => {
            let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
                Some(p) => p,
                None => return not_found("Create a profile first"),
            };
            let profile_id = profile["id"].as_str().unwrap_or("").to_string();
            let author_mode = req.author_mode.as_deref().unwrap_or("person").to_string();
            if let Err(resp) = crate::social::ensure_linked_agent_allowed(
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
    let draft = db(&state).pulse_create_draft(
        &profile_id,
        &req.body,
        req.visibility.as_deref().unwrap_or("public"),
        &author_mode,
        linked_agent_id.as_deref(),
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
pub(crate) fn extract_draft_body(message: &str) -> Option<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_lowercase();
    // Avoid treating "approve draft …" / "reject draft …" as create-draft.
    if lower.starts_with("approve ")
        || lower.starts_with("reject ")
        || lower.starts_with("publish ")
        || lower.starts_with("list ")
    {
        return None;
    }
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

/// Extract a draft id from phrases like "approve draft <id>" or "approve <id>".
pub(crate) fn extract_draft_id(message: &str, verbs: &[&str]) -> Option<String> {
    let trimmed = message.trim();
    let lower = trimmed.to_lowercase();
    for verb in verbs {
        let verb_lower = verb.to_lowercase();
        if !lower.starts_with(&verb_lower) {
            continue;
        }
        let rest = trimmed[verb.len()..].trim();
        let rest = rest
            .strip_prefix("draft")
            .or_else(|| rest.strip_prefix("Draft"))
            .map(|r| r.trim())
            .unwrap_or(rest);
        let rest = rest.trim_start_matches(':').trim();
        let id = rest.split_whitespace().next().unwrap_or("").trim();
        if is_plausible_id(id) {
            return Some(id.to_string());
        }
    }
    None
}

fn is_plausible_id(id: &str) -> bool {
    let len = id.len();
    if len < 8 || len > 64 {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

const TOOLS_V1_HELP: &str = "I'm Pulse draft tools (v1) — not a full marketing AI yet.\n\n\
• \"draft a post about …\" — create a draft\n\
• \"list drafts\" — show pending drafts\n\
• \"approve draft <id>\" / \"approve <id>\" — approve a draft\n\
• \"reject draft <id>\" / \"reject <id>\" — reject a draft\n\
• \"publish draft <id>\" — publish an approved draft\n\
• \"list my posts\" / \"my posts\" — show your recent posts\n\n\
I use the same server mutations as the Drafts API. I won't post publicly without approval.\n\
Coming later: real LLM chat, schedule, autopilot.";

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

    // list my posts
    if lower.contains("list my posts")
        || lower == "my posts"
        || lower.contains("show my posts")
        || lower.contains("my recent posts")
    {
        let posts = db(&state).social_get_user_posts(&profile_id, 10, 0);
        let count = posts.len();
        let preview: Vec<String> = posts
            .iter()
            .take(5)
            .filter_map(|p| {
                let body = p["body"].as_str().unwrap_or("");
                let id = p["id"].as_str().unwrap_or("");
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
            "You have no public posts yet. Draft something, approve it, then publish.".to_string()
        } else {
            format!(
                "Your {count} most recent public post(s):\n{}",
                preview.join("\n")
            )
        };
        return ok(json!({
            "reply": reply,
            "mode": "tools_v1",
            "toolsUsed": ["list_my_posts"],
            "draft": null,
            "postCount": count,
            "posts": posts,
        }));
    }

    // approve draft <id>
    if let Some(id) = extract_draft_id(message, &["approve draft", "approve"]) {
        match db(&state).pulse_update_draft_status(&id, &profile_id, "approved") {
            Some(draft) => {
                db(&state).pulse_add_audit(&id, &profile_id, "approved", None);
                return ok(json!({
                    "reply": format!("Approved draft {id}. You can publish it with \"publish draft {id}\"."),
                    "mode": "tools_v1",
                    "toolsUsed": ["approve_draft"],
                    "draft": draft,
                }));
            }
            None => {
                return ok(json!({
                    "reply": format!("I couldn't find draft {id} on your profile."),
                    "mode": "tools_v1",
                    "toolsUsed": ["approve_draft"],
                    "draft": null,
                }));
            }
        }
    }

    // reject draft <id>
    if let Some(id) = extract_draft_id(message, &["reject draft", "reject"]) {
        match db(&state).pulse_update_draft_status(&id, &profile_id, "rejected") {
            Some(draft) => {
                db(&state).pulse_add_audit(&id, &profile_id, "rejected", None);
                return ok(json!({
                    "reply": format!("Rejected draft {id}."),
                    "mode": "tools_v1",
                    "toolsUsed": ["reject_draft"],
                    "draft": draft,
                }));
            }
            None => {
                return ok(json!({
                    "reply": format!("I couldn't find draft {id} on your profile."),
                    "mode": "tools_v1",
                    "toolsUsed": ["reject_draft"],
                    "draft": null,
                }));
            }
        }
    }

    // publish draft <id> (must already be approved — same as publish_draft handler)
    if let Some(id) = extract_draft_id(message, &["publish draft", "publish"]) {
        let draft = match db(&state).pulse_get_draft(&id, &profile_id) {
            Some(d) => d,
            None => {
                return ok(json!({
                    "reply": format!("I couldn't find draft {id} on your profile."),
                    "mode": "tools_v1",
                    "toolsUsed": ["publish_draft"],
                    "draft": null,
                }));
            }
        };
        if draft["status"].as_str() != Some("approved") {
            return ok(json!({
                "reply": format!(
                    "Draft {id} must be approved before publishing (status is '{}'). Try \"approve draft {id}\" first.",
                    draft["status"].as_str().unwrap_or("unknown")
                ),
                "mode": "tools_v1",
                "toolsUsed": ["publish_draft"],
                "draft": draft,
            }));
        }
        let body = draft["body"].as_str().unwrap_or("");
        let visibility = draft["visibility"].as_str().unwrap_or("public");
        let author_mode = draft["authorMode"].as_str().unwrap_or("person");
        let linked_agent_id = draft["linkedAgentId"].as_str();
        let post = db(&state).social_create_post(
            &profile_id,
            body,
            visibility,
            author_mode,
            linked_agent_id,
            None,
            None,
        );
        let post_id = post["id"].as_str().unwrap_or("").to_string();
        let updated_draft = db(&state).pulse_update_draft_status(&id, &profile_id, "published");
        db(&state).pulse_add_audit(
            &id,
            &profile_id,
            "published",
            Some(&json!({ "postId": post_id }).to_string()),
        );
        return ok(json!({
            "reply": format!("Published draft {id} as post {post_id}."),
            "mode": "tools_v1",
            "toolsUsed": ["publish_draft"],
            "draft": updated_draft,
            "postId": post_id,
            "post": post,
        }));
    }

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
                "You have {count} pending draft(s). Approve with \"approve draft <id>\", then publish.\n{}",
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
            "reply": TOOLS_V1_HELP,
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
                "Saved a draft: \"{short}\". Approve with \"approve draft {}\" then publish. I won't post publicly without your approval.",
                draft["id"].as_str().unwrap_or("")
            ),
            "mode": "tools_v1",
            "toolsUsed": ["create_draft"],
            "draft": draft,
        }));
    }

    // default honest reply
    ok(json!({
        "reply": "I can create, list, approve, reject, and publish drafts for your HeyVera profile (same mutations as the Drafts API). Try \"help\", \"draft a post about …\", \"list drafts\", or \"list my posts\". Full conversational AI is not live yet — this is the server-side tools_v1 path.",
        "mode": "tools_v1",
        "toolsUsed": [],
        "draft": null,
    }))
}

#[derive(Debug, Deserialize)]
pub struct ScheduleDraftRequest {
    #[serde(rename = "draftId")]
    pub draft_id: String,
    /// ISO-8601 time when the approved draft should publish.
    #[serde(rename = "publishAt")]
    pub publish_at: String,
}

/// POST /v1/pulse/schedules — schedule an **approved** draft for later publish.
pub async fn schedule_draft(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<ScheduleDraftRequest>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return not_found("Create a profile first"),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    if req.draft_id.trim().is_empty() || req.publish_at.trim().is_empty() {
        return bad_request("draftId and publishAt are required");
    }
    match db(&state).pulse_schedule_draft(profile_id, req.draft_id.trim(), req.publish_at.trim()) {
        Some(sched) => {
            db(&state).pulse_add_audit(
                req.draft_id.trim(),
                profile_id,
                "scheduled",
                Some(&json!({ "publishAt": req.publish_at }).to_string()),
            );
            ok(json!({ "ok": true, "schedule": sched }))
        }
        None => bad_request("Draft must exist, be owned by you, and be approved before scheduling"),
    }
}

/// GET /v1/pulse/schedules
pub async fn list_schedules(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> ApiResponse {
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => return ok(json!({ "schedules": [] })),
    };
    let profile_id = profile["id"].as_str().unwrap_or("");
    let schedules = db(&state).pulse_list_schedules(profile_id);
    ok(json!({ "schedules": schedules }))
}

/// POST /v1/pulse/schedules/process — process due schedules (admin/cron or owner self-call).
pub async fn process_due_schedules(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> ApiResponse {
    // Authenticated; processes global due queue (single-tenant SQLite early product).
    let _ = user;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let published = db(&state).pulse_process_due_schedules(&now);
    ok(json!({ "ok": true, "published": published }))
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
    fn extract_draft_body_strips_common_prefixes() {
        assert_eq!(
            extract_draft_body("draft a post about shipping tools"),
            Some("shipping tools".to_string())
        );
        assert_eq!(
            extract_draft_body("write a post: hello world friends"),
            Some("hello world friends".to_string())
        );
        assert!(extract_draft_body("approve draft abc-123").is_none());
        assert!(extract_draft_body("list my posts").is_none());
        assert!(extract_draft_body("").is_none());
    }

    #[test]
    fn extract_draft_id_parses_approve_reject_publish() {
        assert_eq!(
            extract_draft_id("approve draft abc-123-def", &["approve draft", "approve"]),
            Some("abc-123-def".to_string())
        );
        assert_eq!(
            extract_draft_id("approve 01234567-89ab-cdef-0123-456789abcdef", &["approve draft", "approve"]),
            Some("01234567-89ab-cdef-0123-456789abcdef".to_string())
        );
        assert_eq!(
            extract_draft_id("reject draft short", &["reject draft", "reject"]),
            None // "short" too short
        );
        assert_eq!(
            extract_draft_id("publish draft draft_id_01", &["publish draft", "publish"]),
            Some("draft_id_01".to_string())
        );
    }

    #[test]
    fn pulse_create_draft_and_list_roundtrip() {
        let db = test_db();
        let profile = db.social_create_profile("clerk_pulse_test", "pulseuser", "Pulse User", "");
        let profile_id = profile["id"].as_str().unwrap();

        let draft = db.pulse_create_draft(profile_id, "Hello from unit test", "public", "person", None);
        assert_eq!(draft["status"], "pending");
        assert_eq!(draft["body"], "Hello from unit test");

        let listed = db.pulse_list_drafts(profile_id, Some("pending"));
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0]["id"], draft["id"]);

        let id = draft["id"].as_str().unwrap();
        let approved = db.pulse_update_draft_status(id, profile_id, "approved").unwrap();
        assert_eq!(approved["status"], "approved");

        let pending = db.pulse_list_drafts(profile_id, Some("pending"));
        assert!(pending.is_empty());
    }
}
