use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::clerk::ClerkUser;
use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Serialize)]
pub struct UserProfile {
    pub user_id: String,
    pub github_linked: bool,
    pub selected_repos: Vec<String>,
}

#[derive(Serialize)]
pub struct GitHubStatus {
    pub linked: bool,
    pub username: Option<String>,
    pub repos: Vec<GitHubRepo>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitHubRepo {
    pub id: u64,
    pub full_name: String,
    pub description: Option<String>,
    pub html_url: String,
    pub private: bool,
    pub language: Option<String>,
}

#[derive(Deserialize)]
pub struct SelectReposRequest {
    pub repo_ids: Vec<u64>,
}

#[derive(Serialize, Deserialize, Default)]
struct UserData {
    #[serde(default)]
    selected_repos: Vec<u64>,
}

fn user_data_path(state: &AppState, user_id: &str) -> std::path::PathBuf {
    state
        .workspace_dir
        .join(".cortex")
        .join("users")
        .join(format!("{user_id}.json"))
}

fn read_user_data(state: &AppState, user_id: &str) -> UserData {
    let path = user_data_path(state, user_id);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_user_data(state: &AppState, user_id: &str, data: &UserData) -> Result<(), String> {
    let path = user_data_path(state, user_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| format!("serialize failed: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

pub async fn get_profile(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Json<UserProfile> {
    let data = read_user_data(&state, &user.user_id);
    Json(UserProfile {
        user_id: user.user_id,
        github_linked: false,
        selected_repos: data
            .selected_repos
            .iter()
            .map(|id| id.to_string())
            .collect(),
    })
}

pub async fn github_status(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Result<Json<GitHubStatus>, (StatusCode, Json<ErrorResponse>)> {
    let clerk_secret = match &state.clerk_secret_key {
        Some(key) => key.clone(),
        None => {
            return Ok(Json(GitHubStatus {
                linked: false,
                username: None,
                repos: Vec::new(),
            }));
        }
    };

    let client = reqwest::Client::new();

    let token_res = client
        .get(format!(
            "https://api.clerk.com/v1/users/{}/oauth_access_tokens/oauth_github",
            user.user_id
        ))
        .bearer_auth(&clerk_secret)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Clerk API error: {e}"),
                }),
            )
        })?;

    if !token_res.status().is_success() {
        return Ok(Json(GitHubStatus {
            linked: false,
            username: None,
            repos: Vec::new(),
        }));
    }

    let tokens: Vec<serde_json::Value> = token_res.json().await.unwrap_or_default();
    let github_token = tokens
        .first()
        .and_then(|t| t.get("token"))
        .and_then(|t| t.as_str());

    let github_token = match github_token {
        Some(t) => t.to_string(),
        None => {
            return Ok(Json(GitHubStatus {
                linked: false,
                username: None,
                repos: Vec::new(),
            }));
        }
    };

    let repos_res = client
        .get("https://api.github.com/user/repos?per_page=50&sort=updated")
        .header("Authorization", format!("Bearer {github_token}"))
        .header("User-Agent", "Cortex/1.0")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;

    let repos: Vec<GitHubRepo> = match repos_res {
        Ok(res) if res.status().is_success() => res.json().await.unwrap_or_default(),
        _ => Vec::new(),
    };

    let user_res = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {github_token}"))
        .header("User-Agent", "Cortex/1.0")
        .send()
        .await;

    let username = match user_res {
        Ok(res) if res.status().is_success() => {
            let v: serde_json::Value = res.json().await.unwrap_or_default();
            v.get("login").and_then(|l| l.as_str()).map(|s| s.to_string())
        }
        _ => None,
    };

    Ok(Json(GitHubStatus {
        linked: true,
        username,
        repos,
    }))
}

pub async fn select_repos(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<SelectReposRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let mut data = read_user_data(&state, &user.user_id);
    data.selected_repos = req.repo_ids;
    write_user_data(&state, &user.user_id, &data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse { error: e }),
        )
    })?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Routing profile ---

#[derive(Deserialize)]
pub struct UpdateProfileRequest {
    pub profile: String,
}

pub async fn update_profile(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    use cortex_core::evaluator::Profile;

    let profile = Profile::from_alias(&req.profile).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "unknown profile '{}' — use: auto, balanced, cost-saver, quality-first",
                    req.profile
                ),
            }),
        )
    })?;

    let canonical = match profile {
        Profile::Auto => "auto",
        Profile::Balanced => "balanced",
        Profile::CostSaver => "cost-saver",
        Profile::QualityFirst => "quality-first",
    };

    if let Some(db) = &state.db {
        db.upsert_user_profile(&user.user_id, canonical);
    }

    Ok(Json(serde_json::json!({
        "profile": canonical,
        "user_id": user.user_id,
    })))
}

pub async fn get_routing_profile(
    State(state): State<Arc<AppState>>,
    user: ClerkUser,
) -> Json<serde_json::Value> {
    let (profile, auto_mode) = state
        .db
        .as_ref()
        .and_then(|db| db.get_full_user_profile(&user.user_id))
        .unwrap_or_else(|| ("auto".into(), "normal".into()));

    let pressure = state
        .db
        .as_ref()
        .map(|db| {
            let raw = db.pressure_for_user(
                &user.user_id,
                cortex_core::evaluator::WINDOW_SECS * 1000,
            );
            raw.into_iter()
                .map(|(provider, tier, tokens)| {
                    serde_json::json!({
                        "provider": provider,
                        "tier": tier,
                        "tokens": tokens,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Json(serde_json::json!({
        "user_id": user.user_id,
        "profile": profile,
        "auto_mode": auto_mode,
        "pressure": pressure,
    }))
}
