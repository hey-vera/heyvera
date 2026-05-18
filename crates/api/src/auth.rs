use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

use cortex_core::provider::{ProviderId, ProviderStatus, Tier};

use crate::routes::ErrorResponse;
use crate::state::AppState;

#[derive(Serialize)]
pub struct ProviderAuthInfo {
    pub provider: String,
    pub authenticated: bool,
    pub email: Option<String>,
    pub subscription: Option<String>,
}

#[derive(Serialize)]
pub struct AuthStartResponse {
    pub provider: String,
    pub auth_url: Option<String>,
    pub device_code: Option<String>,
    pub message: String,
}

#[derive(Deserialize)]
pub struct AuthStartRequest {
    pub provider: String,
}

pub async fn auth_status() -> Json<Vec<ProviderAuthInfo>> {
    let mut results = Vec::new();

    if let Some(info) = check_claude_auth().await {
        results.push(info);
    } else {
        results.push(ProviderAuthInfo {
            provider: "claude".to_string(),
            authenticated: false,
            email: None,
            subscription: None,
        });
    }

    if let Some(info) = check_codex_auth().await {
        results.push(info);
    } else {
        results.push(ProviderAuthInfo {
            provider: "openai".to_string(),
            authenticated: false,
            email: None,
            subscription: None,
        });
    }

    Json(results)
}

pub async fn auth_start(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AuthStartRequest>,
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    let provider = req.provider.to_lowercase();

    match provider.as_str() {
        "claude" => start_claude_auth(state).await,
        "openai" | "codex" => start_codex_auth(state).await,
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unknown provider: {provider}"),
            }),
        )),
    }
}

pub async fn auth_refresh(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<ProviderAuthInfo>> {
    let mut providers = state.providers.write().await;
    providers.clear();

    let all_tiers = vec![Tier::Search, Tier::Execute, Tier::Think];

    if check_claude_auth().await.is_some_and(|i| i.authenticated) {
        providers.push(ProviderStatus {
            provider: ProviderId::Claude,
            authenticated: true,
            pressure: 0.0,
            available_tiers: all_tiers.clone(),
        });
    }

    if check_codex_auth().await.is_some_and(|i| i.authenticated) {
        providers.push(ProviderStatus {
            provider: ProviderId::Openai,
            authenticated: true,
            pressure: 0.0,
            available_tiers: all_tiers,
        });
    }

    drop(providers);
    auth_status().await
}

async fn check_claude_auth() -> Option<ProviderAuthInfo> {
    let output = Command::new("claude")
        .args(["auth", "status", "--json"])
        .output()
        .await
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let v: serde_json::Value = serde_json::from_str(&stdout).ok()?;

    let logged_in = v.get("loggedIn")?.as_bool().unwrap_or(false);

    Some(ProviderAuthInfo {
        provider: "claude".to_string(),
        authenticated: logged_in,
        email: v.get("email").and_then(|e| e.as_str()).map(|s| s.to_string()),
        subscription: v
            .get("subscriptionType")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string()),
    })
}

async fn check_codex_auth() -> Option<ProviderAuthInfo> {
    let output = Command::new("codex")
        .args(["login", "status"])
        .output()
        .await
        .ok()?;

    let all_output = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let authenticated = all_output.contains("Logged in");

    Some(ProviderAuthInfo {
        provider: "openai".to_string(),
        authenticated,
        email: None,
        subscription: if authenticated {
            Some("pro".to_string())
        } else {
            None
        },
    })
}

struct AuthScanResult {
    url: Option<String>,
    code: Option<String>,
}

async fn scan_for_auth_info(child: &mut tokio::process::Child) -> AuthScanResult {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(32);

    if let Some(stdout) = child.stdout.take() {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx2.send(line).await;
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx2.send(line).await;
            }
        });
    }
    drop(tx);

    let mut url = None;
    let mut code = None;

    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(10);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(tokio::time::Duration::from_secs(2), rx.recv()).await {
            Ok(Some(line)) => {
                if url.is_none() {
                    url = extract_url(&line);
                }
                if code.is_none() {
                    code = extract_device_code(&line);
                }
                if url.is_some() && code.is_some() {
                    break;
                }
            }
            _ => break,
        }
    }

    AuthScanResult { url, code }
}

async fn start_cli_auth(
    cmd: &str,
    args: &[&str],
    provider_name: &str,
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("failed to start {cmd} auth: {e}"),
                }),
            )
        })?;

    let result = scan_for_auth_info(&mut child).await;

    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(Json(AuthStartResponse {
        provider: provider_name.to_string(),
        auth_url: result.url.clone(),
        device_code: result.code,
        message: if result.url.is_some() {
            format!("Open the link and authorize your {provider_name} account")
        } else {
            format!("Authentication started — complete the flow in your browser")
        },
    }))
}

async fn start_claude_auth(
    _state: Arc<AppState>,
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    start_cli_auth("claude", &["auth", "login"], "claude").await
}

async fn start_codex_auth(
    _state: Arc<AppState>,
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    start_cli_auth("codex", &["login", "--device-auth"], "openai").await
}

fn extract_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|word| word.starts_with("http://") || word.starts_with("https://"))
        .map(|url| {
            url.trim_matches(|c: char| {
                !c.is_alphanumeric() && c != ':' && c != '/' && c != '?' && c != '=' && c != '&' && c != '.' && c != '-' && c != '_'
            })
            .to_string()
        })
}

fn extract_device_code(text: &str) -> Option<String> {
    // Match patterns like "XXXX-XXXX", "code: ABCD-1234", "one-time code: ABCD-1234"
    let lower = text.to_lowercase();
    if lower.contains("code") {
        for word in text.split_whitespace() {
            let clean = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-');
            if clean.len() >= 8 && clean.contains('-') && clean.chars().all(|c| c.is_alphanumeric() || c == '-') {
                let parts: Vec<&str> = clean.split('-').collect();
                if parts.len() == 2 && parts.iter().all(|p| p.len() >= 4) {
                    return Some(clean.to_string());
                }
            }
        }
    }
    None
}
