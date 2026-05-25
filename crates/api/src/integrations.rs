use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

type ApiResult<T> = Result<T, (StatusCode, Json<ErrorResponse>)>;

fn db_ref(state: &AppState) -> ApiResult<&crate::db::Database> {
    state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "database not available".into(),
            }),
        )
    })
}

#[derive(Serialize)]
pub struct IntegrationStatusResponse {
    pub connections: Vec<crate::db::IntegrationConnection>,
    pub mappings: Vec<crate::db::IntegrationMapping>,
    pub slack_configured: bool,
    pub replit_configured: bool,
}

pub async fn integration_status(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> ApiResult<Json<IntegrationStatusResponse>> {
    let db = db_ref(&state)?;
    Ok(Json(IntegrationStatusResponse {
        connections: db.list_integration_connections(&user.user_id),
        mappings: db.list_integration_mappings(&user.user_id),
        slack_configured: std::env::var("SLACK_CLIENT_ID").is_ok()
            && std::env::var("SLACK_CLIENT_SECRET").is_ok(),
        replit_configured: std::env::var("REPLIT_API_TOKEN").is_ok(),
    }))
}

#[derive(Deserialize)]
pub struct OAuthStartRequest {
    pub redirect_after: Option<String>,
}

#[derive(Serialize)]
pub struct OAuthStartResponse {
    pub auth_url: String,
    pub state: String,
}

pub async fn slack_oauth_start(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<OAuthStartRequest>,
) -> ApiResult<Json<OAuthStartResponse>> {
    let client_id = std::env::var("SLACK_CLIENT_ID").map_err(|_| {
        (
            StatusCode::PRECONDITION_FAILED,
            Json(ErrorResponse {
                error: "Slack OAuth is not configured".into(),
            }),
        )
    })?;
    let redirect_uri = std::env::var("SLACK_REDIRECT_URI").unwrap_or_else(|_| {
        "http://localhost:3402/api/integrations/slack/oauth/callback".to_string()
    });
    let scopes = "channels:read,groups:read,users:read,chat:write,commands,app_mentions:read";
    let oauth_state = Uuid::new_v4().to_string();
    db_ref(&state)?.store_oauth_state(
        &user.user_id,
        "slack",
        &oauth_state,
        req.redirect_after.as_deref(),
    );
    let auth_url = format!(
        "https://slack.com/oauth/v2/authorize?client_id={}&scope={}&state={}&redirect_uri={}",
        url_encode(&client_id),
        url_encode(scopes),
        url_encode(&oauth_state),
        url_encode(&redirect_uri),
    );
    Ok(Json(OAuthStartResponse {
        auth_url,
        state: oauth_state,
    }))
}

#[derive(Deserialize)]
pub struct SlackOAuthCallback {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct SlackOauthAccess {
    ok: bool,
    access_token: Option<String>,
    scope: Option<String>,
    team: Option<SlackTeam>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct SlackTeam {
    id: String,
    name: String,
}

pub async fn slack_oauth_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SlackOAuthCallback>,
) -> impl IntoResponse {
    if let Some(error) = query.error {
        return (
            StatusCode::BAD_REQUEST,
            Html(format!(
                "<p>Slack authorization failed: {}</p>",
                html_escape(&error)
            )),
        );
    }
    let Some(code) = query.code else {
        return (
            StatusCode::BAD_REQUEST,
            Html("<p>Missing Slack OAuth code.</p>".to_string()),
        );
    };
    let Some(oauth_state) = query.state else {
        return (
            StatusCode::BAD_REQUEST,
            Html("<p>Missing Slack OAuth state.</p>".to_string()),
        );
    };
    let Ok(db) = db_ref(&state) else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Html("<p>Database unavailable.</p>".to_string()),
        );
    };
    let Some((user_id, redirect_after)) = db.consume_oauth_state("slack", &oauth_state) else {
        return (
            StatusCode::BAD_REQUEST,
            Html("<p>Expired Slack OAuth state.</p>".to_string()),
        );
    };
    let client_id = std::env::var("SLACK_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("SLACK_CLIENT_SECRET").unwrap_or_default();
    let redirect_uri = std::env::var("SLACK_REDIRECT_URI").unwrap_or_else(|_| {
        "http://localhost:3402/api/integrations/slack/oauth/callback".to_string()
    });
    let client = reqwest::Client::new();
    let access_response = client
        .post("https://slack.com/api/oauth.v2.access")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .and_then(|res| res.error_for_status());

    let Ok(access_response) = access_response else {
        return (
            StatusCode::BAD_GATEWAY,
            Html("<p>Slack token exchange failed.</p>".to_string()),
        );
    };
    let Ok(access) = access_response.json::<SlackOauthAccess>().await else {
        return (
            StatusCode::BAD_GATEWAY,
            Html("<p>Slack token response was invalid.</p>".to_string()),
        );
    };
    if !access.ok {
        return (
            StatusCode::BAD_GATEWAY,
            Html(format!(
                "<p>Slack token exchange failed: {}</p>",
                html_escape(access.error.as_deref().unwrap_or("unknown_error")),
            )),
        );
    }

    let team = access.team.unwrap_or(SlackTeam {
        id: "unknown".into(),
        name: "Slack workspace".into(),
    });
    let scopes = access
        .scope
        .unwrap_or_default()
        .split(',')
        .filter(|scope| !scope.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    db.upsert_integration_connection(
        &user_id,
        "slack",
        Some(&team.id),
        &team.name,
        "connected",
        &scopes,
        access.access_token.as_deref(),
        None,
        &serde_json::json!({ "team_id": team.id, "team_name": team.name }),
    );

    let target = redirect_after
        .unwrap_or_else(|| "/groups/personal/tasks?settings=integrations".to_string());
    (
        StatusCode::OK,
        Html(format!(
            "<script>window.location.href = '{}';</script><p>Slack connected. You can close this tab.</p>",
            html_escape(&target)
        )),
    )
}

#[derive(Serialize)]
pub struct SlackChannel {
    pub id: String,
    pub name: String,
    pub is_private: bool,
    pub member_count: i64,
}

#[derive(Deserialize)]
struct SlackConversationList {
    ok: bool,
    channels: Option<Vec<SlackConversation>>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct SlackConversation {
    id: String,
    name: String,
    #[serde(default)]
    is_private: bool,
    #[serde(default)]
    num_members: Option<i64>,
}

pub async fn slack_channels(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> ApiResult<Json<Vec<SlackChannel>>> {
    let db = db_ref(&state)?;
    let Some(token) = db.get_integration_token(&user.user_id, "slack") else {
        return Ok(Json(vec![
            SlackChannel {
                id: "CDEV".into(),
                name: "dev".into(),
                is_private: false,
                member_count: 8,
            },
            SlackChannel {
                id: "COPS".into(),
                name: "ops".into(),
                is_private: false,
                member_count: 4,
            },
        ]));
    };
    let url = "https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200";
    let res = reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(api_error)?
        .json::<SlackConversationList>()
        .await
        .map_err(api_error)?;
    if !res.ok {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(ErrorResponse {
                error: format!(
                    "Slack channel fetch failed: {}",
                    res.error.unwrap_or_else(|| "unknown_error".into())
                ),
            }),
        ));
    }
    Ok(Json(
        res.channels
            .unwrap_or_default()
            .into_iter()
            .map(|channel| SlackChannel {
                id: channel.id,
                name: channel.name,
                is_private: channel.is_private,
                member_count: channel.num_members.unwrap_or(0),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct ImportSlackChannelsRequest {
    pub channels: Vec<SlackChannelSelection>,
}

#[derive(Deserialize)]
pub struct SlackChannelSelection {
    pub id: String,
    pub name: String,
    pub member_count: Option<i64>,
}

#[derive(Serialize)]
pub struct ImportGroupsResponse {
    pub groups: Vec<crate::db::CortexGroup>,
    pub mappings: Vec<crate::db::IntegrationMapping>,
}

pub async fn import_slack_channels(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<ImportSlackChannelsRequest>,
) -> ApiResult<Json<ImportGroupsResponse>> {
    let db = db_ref(&state)?;
    let mut groups = Vec::new();
    let mut mappings = Vec::new();
    for channel in req.channels.into_iter().take(50) {
        let group_id = format!("slack-{}", channel.id.to_lowercase());
        let group = db.upsert_group(
            &user.user_id,
            &group_id,
            &format!("#{}", channel.name),
            "team",
            "Slack channel coordination",
            channel.member_count.unwrap_or(1).max(1),
            "#8fb4ff",
            "slack",
            Some(&channel.id),
        );
        let mapping = db.upsert_integration_mapping(
            &user.user_id,
            "slack",
            &group.id,
            &channel.id,
            &channel.name,
            "channel_group",
            &serde_json::json!({ "task_sync": true, "notifications": true }),
        );
        groups.push(group);
        mappings.push(mapping);
    }
    Ok(Json(ImportGroupsResponse { groups, mappings }))
}

pub async fn get_group_tasks(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Path(group_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    // If using local auth (no real user), return empty task state to prevent frontend crashes
    if user.user_id == "local" && state.clerk_secret_key.is_none() {
        return Ok(Json(empty_task_state(&group_id)));
    }

    let db = db_ref(&state)?;
    let state = db
        .get_group_task_state(&user.user_id, &group_id)
        .and_then(|value| normalize_task_state(&group_id, &value).ok())
        .unwrap_or_else(|| empty_task_state(&group_id));
    Ok(Json(state))
}

pub async fn get_group_task_projection(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Path((group_id, task_id)): Path<(String, String)>,
) -> ApiResult<Json<serde_json::Value>> {
    let db = db_ref(&state)?;
    let projection = db
        .get_cortex_task_projection(&user.user_id, &group_id, &task_id, 100)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "task not found".into(),
                }),
            )
        })?;
    Ok(Json(projection))
}

pub async fn get_group_operations_summary(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Path(group_id): Path<String>,
) -> ApiResult<Json<serde_json::Value>> {
    let db = db_ref(&state)?;
    Ok(Json(db.get_group_operations_summary(&user.user_id, &group_id, 25)))
}

pub async fn update_group_tasks(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Path(group_id): Path<String>,
    Json(state_json): Json<serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    let db = db_ref(&state)?;
    let normalized = normalize_task_state(&group_id, &state_json)
        .map_err(|error| (StatusCode::BAD_REQUEST, Json(ErrorResponse { error })))?;
    let saved = db.upsert_group_task_state(&user.user_id, &group_id, &normalized);
    db.record_integration_event(
        &user.user_id,
        "cortex",
        Some(&group_id),
        "task_state_updated",
        "queued",
        &normalized,
    );
    Ok(Json(saved))
}

#[derive(Deserialize)]
pub struct SlackCommandForm {
    pub text: Option<String>,
    pub user_name: Option<String>,
    pub team_id: Option<String>,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
}

pub async fn slack_command(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    if !verify_slack_signature(&headers, &body).unwrap_or(true) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "invalid signature" })),
        );
    }
    let form = parse_slack_form(&body);
    let user_id = form.team_id.clone().unwrap_or_else(|| "slack".into());
    let group_id = form
        .channel_id
        .as_ref()
        .map(|id| format!("slack-{}", id.to_lowercase()));
    if let (Ok(db), Some(group_id), Some(text)) = (db_ref(&state), group_id, form.text.clone()) {
        let task_state = db
            .get_group_task_state(&user_id, &group_id)
            .unwrap_or_else(|| empty_task_state(&group_id));
        db.record_integration_event(
            &user_id,
            "slack",
            Some(&group_id),
            "slash_command_task",
            "queued",
            &serde_json::json!({
                "text": text,
                "actor": form.user_name.unwrap_or_else(|| "Slack".into()),
                "channel": form.channel_name,
                "current_state": task_state,
            }),
        );
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "response_type": "ephemeral",
            "text": "Cortex captured that task and queued it for the mapped task manager."
        })),
    )
}

pub async fn slack_events(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    if !verify_slack_signature(&headers, &body).unwrap_or(true) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "invalid signature" })),
        );
    }
    let payload: serde_json::Value =
        serde_json::from_str(&body).unwrap_or_else(|_| serde_json::json!({}));
    if payload.get("type").and_then(|v| v.as_str()) == Some("url_verification") {
        return (
            StatusCode::OK,
            Json(
                serde_json::json!({ "challenge": payload.get("challenge").cloned().unwrap_or_default() }),
            ),
        );
    }
    let team_id = payload
        .get("team_id")
        .and_then(|v| v.as_str())
        .unwrap_or("slack");
    let channel_id = payload.pointer("/event/channel").and_then(|v| v.as_str());
    let group_id = channel_id.map(|id| format!("slack-{}", id.to_lowercase()));
    if let Ok(db) = db_ref(&state) {
        db.record_integration_event(
            team_id,
            "slack",
            group_id.as_deref(),
            "event_callback",
            "queued",
            &payload,
        );
    }
    (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
}

#[derive(Serialize)]
pub struct ReplitWorkspace {
    pub id: String,
    pub title: String,
    pub language: String,
    pub url: Option<String>,
}

pub async fn replit_workspaces(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> ApiResult<Json<Vec<ReplitWorkspace>>> {
    let db = db_ref(&state)?;
    db.upsert_integration_connection(
        &user.user_id,
        "replit",
        Some("account"),
        "Replit",
        if std::env::var("REPLIT_API_TOKEN").is_ok() {
            "connected"
        } else {
            "needs_config"
        },
        &["read:repls".to_string(), "write:tasks".to_string()],
        std::env::var("REPLIT_API_TOKEN").ok().as_deref(),
        None,
        &serde_json::json!({ "container_strategy": "replit-containers" }),
    );
    Ok(Json(vec![
        ReplitWorkspace {
            id: "repl-main".into(),
            title: "Main workspace".into(),
            language: "Node.js".into(),
            url: None,
        },
        ReplitWorkspace {
            id: "repl-worker".into(),
            title: "Worker sandbox".into(),
            language: "Rust".into(),
            url: None,
        },
    ]))
}

#[derive(Deserialize)]
pub struct ImportReplitRequest {
    pub workspace_id: String,
    pub title: String,
    pub language: Option<String>,
}

pub async fn import_replit_workspace(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<ImportReplitRequest>,
) -> ApiResult<Json<ImportGroupsResponse>> {
    let db = db_ref(&state)?;
    let group_id = format!("replit-{}", slug(&req.workspace_id));
    let group = db.upsert_group(
        &user.user_id,
        &group_id,
        &req.title,
        "team",
        "Replit development workspace",
        2,
        "#f3c969",
        "replit",
        Some(&req.workspace_id),
    );
    let mapping = db.upsert_integration_mapping(
        &user.user_id,
        "replit",
        &group.id,
        &req.workspace_id,
        &req.title,
        "workspace_group",
        &serde_json::json!({
            "conversation_import": true,
            "container_strategy": "replit-containers",
            "language": req.language,
        }),
    );
    let conversation = db.create_conversation(
        &user.user_id,
        Some(&format!("Replit import: {}", req.title)),
    );
    db.add_message(
        &conversation.id,
        "assistant",
        "Imported Replit workspace context. Conversation history and code snippets will attach here when the Replit API token has chat-history scope.",
        Some("replit"),
        Some("workspace-import"),
    );
    Ok(Json(ImportGroupsResponse {
        groups: vec![group],
        mappings: vec![mapping],
    }))
}

fn empty_task_state(group_id: &str) -> serde_json::Value {
    serde_json::json!({
        "tasks": [],
        "members": [],
        "activity": [{
            "id": format!("activity-{}", Uuid::new_v4()),
            "groupId": group_id,
            "kind": "note",
            "actor": "Cortex",
            "summary": "Task manager is ready for Slack and Replit coordination.",
            "createdAt": chrono::Utc::now().to_rfc3339()
        }],
        "updatedAt": chrono::Utc::now().to_rfc3339()
    })
}

fn normalize_task_state(
    group_id: &str,
    value: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    const MAX_TASKS: usize = 250;
    const MAX_MEMBERS: usize = 100;
    const MAX_ACTIVITY: usize = 500;

    let object = value
        .as_object()
        .ok_or_else(|| "task state must be an object".to_string())?;
    let tasks = object
        .get("tasks")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "task state requires a tasks array".to_string())?;
    let members = object
        .get("members")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "task state requires a members array".to_string())?;
    let activity = object
        .get("activity")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "task state requires an activity array".to_string())?;

    if tasks.len() > MAX_TASKS {
        return Err(format!("task state exceeds {MAX_TASKS} tasks"));
    }
    if members.len() > MAX_MEMBERS {
        return Err(format!("task state exceeds {MAX_MEMBERS} members"));
    }
    if activity.len() > MAX_ACTIVITY {
        return Err(format!(
            "task state exceeds {MAX_ACTIVITY} activity entries"
        ));
    }

    let normalized_tasks: Result<Vec<_>, _> = tasks
        .iter()
        .enumerate()
        .map(|(index, task)| normalize_task(group_id, task, index))
        .collect();
    let normalized_members: Result<Vec<_>, _> = members
        .iter()
        .enumerate()
        .map(|(index, member)| normalize_member(member, index))
        .collect();
    let normalized_activity: Result<Vec<_>, _> = activity
        .iter()
        .enumerate()
        .map(|(index, entry)| normalize_activity(group_id, entry, index))
        .collect();

    Ok(serde_json::json!({
        "tasks": normalized_tasks?,
        "members": normalized_members?,
        "activity": normalized_activity?,
        "updatedAt": optional_string(object.get("updatedAt"), 64)?.unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
    }))
}

fn normalize_task(
    group_id: &str,
    value: &serde_json::Value,
    index: usize,
) -> Result<serde_json::Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("task {index} must be an object"))?;
    let task_group_id =
        required_string(object.get("groupId"), 256, &format!("task {index} groupId"))?;
    if task_group_id != group_id {
        return Err(format!("task {index} groupId does not match route group"));
    }
    let status = required_string(object.get("status"), 32, &format!("task {index} status"))?;
    if !matches!(
        status.as_str(),
        "created" | "assigned" | "in-progress" | "done"
    ) {
        return Err(format!("task {index} has invalid status"));
    }
    let priority = required_string(
        object.get("priority"),
        32,
        &format!("task {index} priority"),
    )?;
    if !matches!(priority.as_str(), "normal" | "high" | "urgent") {
        return Err(format!("task {index} has invalid priority"));
    }

    Ok(serde_json::json!({
        "id": required_string(object.get("id"), 256, &format!("task {index} id"))?,
        "groupId": task_group_id,
        "title": required_string(object.get("title"), 256, &format!("task {index} title"))?,
        "description": optional_string(object.get("description"), 4096)?,
        "status": status,
        "assigneeId": optional_string(object.get("assigneeId"), 256)?,
        "repo": optional_string(object.get("repo"), 512)?,
        "priority": priority,
        "createdAt": required_string(object.get("createdAt"), 64, &format!("task {index} createdAt"))?,
        "updatedAt": required_string(object.get("updatedAt"), 64, &format!("task {index} updatedAt"))?,
        "createdBy": required_string(object.get("createdBy"), 256, &format!("task {index} createdBy"))?,
        "sourceMessageId": optional_string(object.get("sourceMessageId"), 256)?,
        "projectChatConversationId": optional_string(object.get("projectChatConversationId"), 256)?,
        "projectChatLaunchedAt": optional_string(object.get("projectChatLaunchedAt"), 64)?,
        "latestRunId": optional_string(object.get("latestRunId"), 256)?,
        "latestRunStatus": optional_string(object.get("latestRunStatus"), 64)?,
        "latestRunSyncedAt": optional_string(object.get("latestRunSyncedAt"), 64)?,
        "latestRunStepSummary": normalize_step_summary(object.get("latestRunStepSummary"), index)?,
    }))
}

fn normalize_member(value: &serde_json::Value, index: usize) -> Result<serde_json::Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("member {index} must be an object"))?;
    let status = required_string(object.get("status"), 32, &format!("member {index} status"))?;
    if !matches!(status.as_str(), "online" | "working" | "away") {
        return Err(format!("member {index} has invalid status"));
    }

    Ok(serde_json::json!({
        "id": required_string(object.get("id"), 256, &format!("member {index} id"))?,
        "name": required_string(object.get("name"), 256, &format!("member {index} name"))?,
        "initials": required_string(object.get("initials"), 16, &format!("member {index} initials"))?,
        "status": status,
        "currentTaskId": optional_string(object.get("currentTaskId"), 256)?,
        "color": required_string(object.get("color"), 32, &format!("member {index} color"))?,
    }))
}

fn normalize_activity(
    group_id: &str,
    value: &serde_json::Value,
    index: usize,
) -> Result<serde_json::Value, String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("activity {index} must be an object"))?;
    let activity_group_id = required_string(
        object.get("groupId"),
        256,
        &format!("activity {index} groupId"),
    )?;
    if activity_group_id != group_id {
        return Err(format!(
            "activity {index} groupId does not match route group"
        ));
    }
    let kind = required_string(object.get("kind"), 32, &format!("activity {index} kind"))?;
    if !matches!(
        kind.as_str(),
        "created" | "assigned" | "status" | "handoff" | "linked" | "note"
    ) {
        return Err(format!("activity {index} has invalid kind"));
    }

    Ok(serde_json::json!({
        "id": required_string(object.get("id"), 256, &format!("activity {index} id"))?,
        "groupId": activity_group_id,
        "taskId": optional_string(object.get("taskId"), 256)?,
        "kind": kind,
        "actor": required_string(object.get("actor"), 256, &format!("activity {index} actor"))?,
        "summary": required_string(object.get("summary"), 1024, &format!("activity {index} summary"))?,
        "createdAt": required_string(object.get("createdAt"), 64, &format!("activity {index} createdAt"))?,
    }))
}

fn normalize_step_summary(
    value: Option<&serde_json::Value>,
    task_index: usize,
) -> Result<serde_json::Value, String> {
    let Some(value) = value else {
        return Ok(serde_json::Value::Null);
    };
    if value.is_null() {
        return Ok(serde_json::Value::Null);
    }
    let object = value
        .as_object()
        .ok_or_else(|| format!("task {task_index} latestRunStepSummary must be an object"))?;
    Ok(serde_json::json!({
        "total": required_count(object.get("total"), &format!("task {task_index} total"))?,
        "active": required_count(object.get("active"), &format!("task {task_index} active"))?,
        "done": required_count(object.get("done"), &format!("task {task_index} done"))?,
        "failed": required_count(object.get("failed"), &format!("task {task_index} failed"))?,
    }))
}

fn required_count(value: Option<&serde_json::Value>, label: &str) -> Result<u64, String> {
    let count = value
        .and_then(|value| value.as_u64())
        .ok_or_else(|| format!("{label} must be a non-negative integer"))?;
    if count > 10_000 {
        return Err(format!("{label} is too large"));
    }
    Ok(count)
}

fn required_string(
    value: Option<&serde_json::Value>,
    max_len: usize,
    label: &str,
) -> Result<String, String> {
    optional_string(value, max_len)?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{label} is required"))
}

fn optional_string(
    value: Option<&serde_json::Value>,
    max_len: usize,
) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let string = value
        .as_str()
        .ok_or_else(|| "expected string or null".to_string())?;
    if string.len() > max_len {
        return Err(format!("string exceeds {max_len} characters"));
    }
    Ok(Some(string.to_string()))
}

fn api_error(err: reqwest::Error) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::BAD_GATEWAY,
        Json(ErrorResponse {
            error: format!("upstream integration request failed: {err}"),
        }),
    )
}

fn verify_slack_signature(headers: &HeaderMap, body: &str) -> Option<bool> {
    let secret = std::env::var("SLACK_SIGNING_SECRET").ok()?;
    let timestamp = headers.get("x-slack-request-timestamp")?.to_str().ok()?;
    let signature = headers.get("x-slack-signature")?.to_str().ok()?;
    let base = format!("v0:{timestamp}:{body}");
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(base.as_bytes());
    let expected = format!("v0={}", hex::encode(mac.finalize().into_bytes()));
    Some(constant_time_eq(expected.as_bytes(), signature.as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => vec![b as char],
            _ => format!("%{b:02X}").chars().collect(),
        })
        .collect()
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn slug(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn parse_slack_form(body: &str) -> SlackCommandForm {
    let mut form = SlackCommandForm {
        text: None,
        user_name: None,
        team_id: None,
        channel_id: None,
        channel_name: None,
    };
    for pair in body.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = percent_decode(parts.next().unwrap_or_default());
        match key {
            "text" => form.text = Some(value),
            "user_name" => form.user_name = Some(value),
            "team_id" => form.team_id = Some(value),
            "channel_id" => form.channel_id = Some(value),
            "channel_name" => form.channel_name = Some(value),
            _ => {}
        }
    }
    form
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &value[i + 1..i + 3];
                if let Ok(decoded) = u8::from_str_radix(hex, 16) {
                    out.push(decoded);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_task_state() -> serde_json::Value {
        serde_json::json!({
            "tasks": [{
                "id": "task-1",
                "groupId": "group-1",
                "title": "Ship the operation queue",
                "description": "Make the live map useful",
                "status": "in-progress",
                "assigneeId": "user-1",
                "repo": "hey-vera/heyvera",
                "priority": "high",
                "createdAt": "2026-05-25T00:00:00Z",
                "updatedAt": "2026-05-25T00:01:00Z",
                "createdBy": "You",
                "sourceMessageId": "message-1",
                "projectChatConversationId": "conversation-1",
                "projectChatLaunchedAt": "2026-05-25T00:02:00Z",
                "latestRunId": "run-1",
                "latestRunStatus": "running",
                "latestRunSyncedAt": "2026-05-25T00:03:00Z",
                "latestRunStepSummary": {
                    "total": 4,
                    "active": 1,
                    "done": 2,
                    "failed": 1
                },
                "ignored": "field"
            }],
            "members": [{
                "id": "user-1",
                "name": "You",
                "initials": "Y",
                "status": "working",
                "currentTaskId": "task-1",
                "color": "#9cc7b8",
                "ignored": "field"
            }],
            "activity": [{
                "id": "activity-1",
                "groupId": "group-1",
                "taskId": "task-1",
                "kind": "linked",
                "actor": "You",
                "summary": "Opened in Project Chat.",
                "createdAt": "2026-05-25T00:02:00Z",
                "ignored": "field"
            }],
            "updatedAt": "2026-05-25T00:03:00Z",
            "ignored": "field"
        })
    }

    #[test]
    fn normalize_task_state_accepts_known_shape_and_strips_unknown_fields() {
        let normalized = normalize_task_state("group-1", &valid_task_state()).unwrap();

        assert_eq!(normalized["tasks"][0]["id"], "task-1");
        assert_eq!(normalized["tasks"][0]["latestRunStepSummary"]["failed"], 1);
        assert!(normalized["tasks"][0].get("ignored").is_none());
        assert!(normalized.get("ignored").is_none());
    }

    #[test]
    fn normalize_task_state_rejects_cross_group_task() {
        let mut state = valid_task_state();
        state["tasks"][0]["groupId"] = serde_json::json!("other-group");

        let error = normalize_task_state("group-1", &state).unwrap_err();
        assert!(error.contains("groupId does not match"));
    }

    #[test]
    fn normalize_task_state_rejects_invalid_status() {
        let mut state = valid_task_state();
        state["tasks"][0]["status"] = serde_json::json!("paused");

        let error = normalize_task_state("group-1", &state).unwrap_err();
        assert!(error.contains("invalid status"));
    }

    #[test]
    fn normalize_task_state_rejects_oversized_task_sets() {
        let mut state = valid_task_state();
        state["tasks"] = serde_json::Value::Array(vec![state["tasks"][0].clone(); 251]);

        let error = normalize_task_state("group-1", &state).unwrap_err();
        assert!(error.contains("exceeds 250 tasks"));
    }
}
