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

pub async fn list_conversations(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Json<serde_json::Value> {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));

    let conversations = tokio::task::spawn_blocking({
        let db = Arc::clone(&state);
        let user_id = user_id.clone();
        move || db.db.as_ref().unwrap().list_conversations(&user_id)
    }).await.unwrap();

    Json(serde_json::to_value(conversations).unwrap())
}

pub async fn create_conversation(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateConversationRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let user_id = get_user_id(req.user_id.as_deref());
    let title = req.title.clone();

    let conversation = tokio::task::spawn_blocking({
        let db = Arc::clone(&state);
        move || db.db.as_ref().unwrap().create_conversation(&user_id, title.as_deref())
    }).await.unwrap();

    (StatusCode::CREATED, Json(serde_json::to_value(conversation).unwrap()))
}

pub async fn get_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));

    let result = tokio::task::spawn_blocking({
        let db = Arc::clone(&state);
        let id = id.clone();
        move || db.db.as_ref().unwrap().get_conversation(&id, &user_id)
    }).await.unwrap();

    match result {
        Some(conv) => Ok(Json(serde_json::to_value(conv).unwrap())),
        None => Err((StatusCode::NOT_FOUND, Json(ErrorResponse { error: "conversation not found".to_string() }))),
    }
}

pub async fn delete_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> StatusCode {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));

    let deleted = tokio::task::spawn_blocking({
        let db = Arc::clone(&state);
        let id = id.clone();
        move || db.db.as_ref().unwrap().delete_conversation(&id, &user_id)
    }).await.unwrap();

    if deleted { StatusCode::NO_CONTENT } else { StatusCode::NOT_FOUND }
}

pub async fn update_conversation(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    Json(req): Json<UpdateTitleRequest>,
) -> StatusCode {
    let user_id = get_user_id(params.get("user_id").map(|s| s.as_str()));

    let updated = tokio::task::spawn_blocking({
        let db = Arc::clone(&state);
        let id = id.clone();
        let title = req.title.clone();
        move || db.db.as_ref().unwrap().update_conversation_title(&id, &user_id, &title)
    }).await.unwrap();

    if updated { StatusCode::OK } else { StatusCode::NOT_FOUND }
}

pub async fn add_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<AddMessageRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let message = tokio::task::spawn_blocking({
        let db = Arc::clone(&state);
        let id = id.clone();
        move || db.db.as_ref().unwrap().add_message(
            &id,
            &req.role,
            &req.content,
            req.provider.as_deref(),
            req.model.as_deref(),
        )
    }).await.unwrap();

    (StatusCode::CREATED, Json(serde_json::to_value(message).unwrap()))
}
