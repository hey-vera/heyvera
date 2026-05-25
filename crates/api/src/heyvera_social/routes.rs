use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::clerk::ClerkUser;
use crate::state::AppState;

use super::types::{CreatePostInput, CreateUserProfileInput, UpdateUserProfileInput};

#[derive(Debug, Serialize)]
struct StubErrorBody {
    error: &'static str,
    message: String,
}

#[derive(Debug)]
struct SocialStubError {
    status: StatusCode,
    message: String,
}

impl SocialStubError {
    fn not_implemented(operation: &'static str) -> Self {
        Self {
            status: StatusCode::NOT_IMPLEMENTED,
            message: format!("HeyVera social endpoint stubbed: {operation}"),
        }
    }
}

impl IntoResponse for SocialStubError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(StubErrorBody {
                error: "not_implemented",
                message: self.message,
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Deserialize)]
pub struct CursorPagination {
    pub cursor: Option<String>,
    #[serde(default = "default_page_size")]
    pub limit: usize,
}

fn default_page_size() -> usize {
    20
}

#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    #[serde(flatten)]
    pub payload: CreateUserProfileInput,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    #[serde(flatten)]
    pub payload: UpdateUserProfileInput,
}

#[derive(Debug, Deserialize)]
pub struct CreatePostRequest {
    #[serde(flatten)]
    pub payload: CreatePostInput,
}

#[derive(Debug, Serialize)]
pub struct StubAck {
    pub ok: bool,
    pub operation: &'static str,
}

pub async fn get_me_profile(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
) -> Result<Json<Value>, SocialStubError> {
    Err(SocialStubError::not_implemented("get_me_profile"))
}

pub async fn create_me_profile(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(_request): Json<CreateProfileRequest>,
) -> Result<Json<Value>, SocialStubError> {
    Err(SocialStubError::not_implemented("create_me_profile"))
}

pub async fn update_me_profile(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(_request): Json<UpdateProfileRequest>,
) -> Result<Json<Value>, SocialStubError> {
    Err(SocialStubError::not_implemented("update_me_profile"))
}

pub async fn get_public_profile(
    State(_state): State<Arc<AppState>>,
    Path(handle): Path<String>,
) -> Result<Json<Value>, SocialStubError> {
    let _ = handle;
    Err(SocialStubError::not_implemented("get_public_profile"))
}

pub async fn list_profile_posts(
    State(_state): State<Arc<AppState>>,
    Path(handle): Path<String>,
    Query(_pagination): Query<CursorPagination>,
) -> Result<Json<Value>, SocialStubError> {
    let _ = handle;
    Err(SocialStubError::not_implemented("list_profile_posts"))
}

pub async fn create_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Json(_request): Json<CreatePostRequest>,
) -> Result<Json<Value>, SocialStubError> {
    Err(SocialStubError::not_implemented("create_post"))
}

pub async fn get_post(
    State(_state): State<Arc<AppState>>,
    Path(post_id): Path<String>,
) -> Result<Json<Value>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("get_post"))
}

pub async fn get_feed(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Query(_pagination): Query<CursorPagination>,
) -> Result<Json<Value>, SocialStubError> {
    Err(SocialStubError::not_implemented("get_feed"))
}

pub async fn get_following_feed(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Query(_pagination): Query<CursorPagination>,
) -> Result<Json<Value>, SocialStubError> {
    Err(SocialStubError::not_implemented("get_following_feed"))
}

pub async fn like_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(post_id): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("like_post"))
}

pub async fn unlike_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(post_id): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("unlike_post"))
}

pub async fn repost_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(post_id): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("repost_post"))
}

pub async fn unrepost_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(post_id): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("unrepost_post"))
}

pub async fn bookmark_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(post_id): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("bookmark_post"))
}

pub async fn unbookmark_post(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(post_id): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = post_id;
    Err(SocialStubError::not_implemented("unbookmark_post"))
}

pub async fn follow_profile(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(handle): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = handle;
    Err(SocialStubError::not_implemented("follow_profile"))
}

pub async fn unfollow_profile(
    State(_state): State<Arc<AppState>>,
    _user: ClerkUser,
    Path(handle): Path<String>,
) -> Result<Json<StubAck>, SocialStubError> {
    let _ = handle;
    Err(SocialStubError::not_implemented("unfollow_profile"))
}

pub fn stub_contract() -> Json<Value> {
    Json(json!({
        "module": "heyvera_social",
        "status": "stubbed",
        "handlers": [
            "get_me_profile",
            "create_me_profile",
            "update_me_profile",
            "get_public_profile",
            "list_profile_posts",
            "create_post",
            "get_post",
            "get_feed",
            "get_following_feed",
            "like_post",
            "unlike_post",
            "repost_post",
            "unrepost_post",
            "bookmark_post",
            "unbookmark_post",
            "follow_profile",
            "unfollow_profile"
        ]
    }))
}
