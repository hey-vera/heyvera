use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateConversationRequest {
    pub title: Option<String>,
    pub user_id: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateTitleRequest {
    pub title: String,
}

#[derive(Deserialize)]
pub struct AddMessageRequest {
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
}

fn get_user_id(req_user_id: Option<&str>) -> String {
    req_user_id.unwrap_or("local").to_string()
}

fn db_ref(state: &AppState) -> Result<&crate::db::Database, (StatusCode, Json<ErrorResponse>)> {
    state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: "database not available".into() }),
        )
    })
}

pub async fn list_conversations(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));
    let db = db_ref(&state)?;

    let conversations = db.list_conversations(&user_id);
    serde_json::to_value(conversations)
        .map(Json)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "serialization failed".into() })))
}

pub async fn create_conversation(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateConversationRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id(req.user_id.as_deref());
    let db = db_ref(&state)?;

    let conversation = db.create_conversation(&user_id, req.title.as_deref());
    let value = serde_json::to_value(conversation)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "serialization failed".into() })))?;
    Ok((StatusCode::CREATED, Json(value)))
}

pub async fn get_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));
    let db = db_ref(&state)?;

    match db.get_conversation(&id, &user_id) {
        Some(conv) => serde_json::to_value(conv)
            .map(Json)
            .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "serialization failed".into() }))),
        None => Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "conversation not found".into() }))),
    }
}

pub async fn delete_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> StatusCode {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));
    match &state.db {
        Some(db) if db.delete_conversation(&id, &user_id) => StatusCode::NO_CONTENT,
        Some(_) => StatusCode::NOT_FOUND,
        None => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn update_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    Json(req): Json<UpdateTitleRequest>,
) -> StatusCode {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));
    match &state.db {
        Some(db) if db.update_conversation_title(&id, &user_id, &req.title) => StatusCode::OK,
        Some(_) => StatusCode::NOT_FOUND,
        None => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn add_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<AddMessageRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let db = db_ref(&state)?;

    let message = db.add_message(
        &id,
        &req.role,
        &req.content,
        req.provider.as_deref(),
        req.model.as_deref(),
    );

    let value = serde_json::to_value(message)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: "serialization failed".into() })))?;
    Ok((StatusCode::CREATED, Json(value)))
}
