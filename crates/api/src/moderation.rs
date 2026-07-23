use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::admin;
use crate::clerk::ClerkUser;
use crate::state::AppState;

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

fn require_profile(state: &AppState, user: &ClerkUser) -> Result<String, Json<serde_json::Value>> {
    match db(state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => Ok(p["id"].as_str().unwrap_or("").to_string()),
        None => Err(Json(serde_json::json!({ "error": "No profile found — create a profile first", "code": "NOT_FOUND" }))),
    }
}

// ─── Block endpoints ────────────────────────────────────────────────────────

pub async fn block_user(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if profile_id == id {
        return Json(serde_json::json!({ "error": "Cannot block yourself", "code": "INVALID_INPUT" }));
    }
    db(&state).social_block_user(&profile_id, &id);
    db(&state).audit_log(&profile_id, "user", "block", Some("user"), Some(&id), None, None);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn unblock_user(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unblock_user(&profile_id, &id);
    db(&state).audit_log(&profile_id, "user", "unblock", Some("user"), Some(&id), None, None);
    Json(serde_json::json!({ "ok": true }))
}

/// GET /v1/social/me/blocks — list profiles the viewer has blocked.
pub async fn list_my_blocks(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let blocks = db(&state).social_list_blocks(&profile_id);
    Json(serde_json::json!({ "blocks": blocks }))
}

// ─── Mute endpoints ─────────────────────────────────────────────────────────

pub async fn mute_user(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if profile_id == id {
        return Json(serde_json::json!({ "error": "Cannot mute yourself", "code": "INVALID_INPUT" }));
    }
    db(&state).social_mute_user(&profile_id, &id);
    db(&state).audit_log(&profile_id, "user", "mute", Some("user"), Some(&id), None, None);
    Json(serde_json::json!({ "ok": true }))
}

pub async fn unmute_user(
    user: ClerkUser,
    Path(id): Path<String>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    db(&state).social_unmute_user(&profile_id, &id);
    db(&state).audit_log(&profile_id, "user", "unmute", Some("user"), Some(&id), None, None);
    Json(serde_json::json!({ "ok": true }))
}

/// GET /v1/social/me/mutes — list profiles the viewer has muted.
pub async fn list_my_mutes(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let mutes = db(&state).social_list_mutes(&profile_id);
    Json(serde_json::json!({ "mutes": mutes }))
}

// ─── Report endpoint ────────────────────────────────────────────────────────

/// Accepts camelCase (FE) and snake_case aliases for report body fields.
#[derive(Debug, Deserialize)]
pub struct CreateReportRequest {
    #[serde(alias = "targetType")]
    pub target_type: String,
    #[serde(alias = "targetId")]
    pub target_id: String,
    pub reason: String,
}

pub async fn create_report(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateReportRequest>,
) -> impl IntoResponse {
    let profile_id = match require_profile(&state, &user) { Ok(p) => p, Err(e) => return e };
    if req.target_type != "user" && req.target_type != "post" {
        return Json(serde_json::json!({ "error": "target_type must be 'user' or 'post'", "code": "INVALID_INPUT" }));
    }
    if req.reason.trim().is_empty() {
        return Json(serde_json::json!({ "error": "reason is required", "code": "INVALID_INPUT" }));
    }
    let report = db(&state).social_create_report(&profile_id, &req.target_type, &req.target_id, &req.reason);
    let details = format!("reason: {}", req.reason);
    db(&state).audit_log(&profile_id, "user", "report", Some(&req.target_type), Some(&req.target_id), Some(&details), None);
    Json(report)
}

// ─── Admin endpoint ─────────────────────────────────────────────────────────

pub async fn list_reports(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if admin::authorize_admin(&state, &user).await.is_err() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "admin access required", "code": "FORBIDDEN" })),
        );
    }
    let reports = db(&state).social_list_reports();
    (StatusCode::OK, Json(serde_json::json!({ "reports": reports })))
}

#[cfg(test)]
mod report_request_tests {
    use super::CreateReportRequest;

    #[test]
    fn accepts_camel_case_report_body() {
        let raw = r#"{"targetType":"post","targetId":"p1","reason":"spam"}"#;
        let req: CreateReportRequest = serde_json::from_str(raw).expect("camelCase");
        assert_eq!(req.target_type, "post");
        assert_eq!(req.target_id, "p1");
        assert_eq!(req.reason, "spam");
    }

    #[test]
    fn accepts_snake_case_report_body() {
        let raw = r#"{"target_type":"user","target_id":"u1","reason":"abuse"}"#;
        let req: CreateReportRequest = serde_json::from_str(raw).expect("snake_case");
        assert_eq!(req.target_type, "user");
        assert_eq!(req.target_id, "u1");
    }
}
