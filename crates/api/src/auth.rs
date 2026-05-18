use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
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

#[derive(Deserialize)]
pub struct AuthSubmitRequest {
    pub provider: String,
    pub code: String,
}

#[derive(Serialize)]
pub struct AuthSubmitResponse {
    pub success: bool,
    pub message: String,
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
        "claude" => start_provider_auth(&state, "claude", "claude", &["auth", "login"]).await,
        "openai" | "codex" => start_provider_auth(&state, "openai", "codex", &["login", "--device-auth"]).await,
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("unknown provider: {provider}"),
            }),
        )),
    }
}

pub async fn auth_submit(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AuthSubmitRequest>,
) -> Result<Json<AuthSubmitResponse>, (StatusCode, Json<ErrorResponse>)> {
    let provider = req.provider.to_lowercase();

    let mut pending = state.pending_auths.write().await;
    let stdin = pending.remove(&provider).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("no pending auth for {provider}"),
            }),
        )
    })?;
    drop(pending);

    let mut stdin = stdin;
    let code_with_newline = format!("{}\n", req.code.trim());

    stdin.write_all(code_with_newline.as_bytes()).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("failed to send code: {e}"),
            }),
        )
    })?;

    stdin.flush().await.ok();

    // Give the CLI a moment to process
    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

    // Check if auth succeeded
    let authenticated = match provider.as_str() {
        "claude" => check_claude_auth().await.is_some_and(|i| i.authenticated),
        "openai" => check_codex_auth().await.is_some_and(|i| i.authenticated),
        _ => false,
    };

    if authenticated {
        // Update provider list
        let mut providers = state.providers.write().await;
        let all_tiers = vec![Tier::Search, Tier::Execute, Tier::Think];
        let id = if provider == "claude" { ProviderId::Claude } else { ProviderId::Openai };

        if !providers.iter().any(|p| p.provider == id) {
            providers.push(ProviderStatus {
                provider: id,
                authenticated: true,
                pressure: 0.0,
                available_tiers: all_tiers,
            });
        }
    }

    Ok(Json(AuthSubmitResponse {
        success: authenticated,
        message: if authenticated {
            format!("{provider} connected successfully")
        } else {
            format!("Code submitted — verifying {provider} auth...")
        },
    }))
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

async fn start_provider_auth(
    state: &AppState,
    provider_name: &str,
    cmd: &str,
    args: &[&str],
) -> Result<Json<AuthStartResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Kill any existing pending auth for this provider
    {
        let mut pending = state.pending_auths.write().await;
        pending.remove(provider_name);
    }

    let mut child = Command::new(cmd)
        .args(args)
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            tracing::error!("failed to spawn {cmd} {}: {e}", args.join(" "));
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("{cmd} not found or failed to start — is it installed?"),
                }),
            )
        })?;

    // Take stdin before scanning output
    let stdin = child.stdin.take();

    // Scan stdout/stderr for URL and device code
    let result = scan_for_auth_info(&mut child).await;

    // Store stdin for later code submission
    if let Some(stdin) = stdin {
        let mut pending = state.pending_auths.write().await;
        pending.insert(provider_name.to_string(), stdin);
    }

    // Let the child process keep running in background
    tokio::spawn(async move {
        let _ = child.wait().await;
    });

    Ok(Json(AuthStartResponse {
        provider: provider_name.to_string(),
        auth_url: result.url.clone(),
        device_code: result.code,
        message: if result.url.is_some() {
            format!("Open the link, authorize, and paste the code below")
        } else {
            format!("Authentication started — waiting for response...")
        },
    }))
}

struct AuthScanResult {
    url: Option<String>,
    code: Option<String>,
}

async fn scan_for_auth_info(child: &mut tokio::process::Child) -> AuthScanResult {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(64);

    if let Some(stdout) = child.stdout.take() {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!("auth stdout: {}", line);
                let _ = tx2.send(line).await;
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx2 = tx.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!("auth stderr: {}", line);
                let _ = tx2.send(line).await;
            }
        });
    }
    drop(tx);

    let mut url = None;
    let mut code = None;

    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(15);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(tokio::time::Duration::from_secs(3), rx.recv()).await {
            Ok(Some(line)) => {
                if url.is_none() {
                    if let Some(u) = extract_url(&line) {
                        url = Some(u);
                    }
                }
                if code.is_none() {
                    if let Some(c) = extract_device_code(&line) {
                        code = Some(c);
                    }
                }
            }
            Ok(None) => break,
            Err(_) => {
                if url.is_some() && code.is_some() {
                    break;
                }
            }
        }
    }

    tracing::info!("auth scan complete — url: {:?}, code: {:?}", url, code);
    AuthScanResult { url, code }
}

fn strip_ansi(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&next) = chars.peek() {
                    chars.next();
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn extract_url(text: &str) -> Option<String> {
    let clean = strip_ansi(text);
    clean
        .split_whitespace()
        .find(|word| word.starts_with("http://") || word.starts_with("https://"))
        .map(|url| {
            url.trim_matches(|c: char| {
                !c.is_alphanumeric() && c != ':' && c != '/' && c != '?' && c != '=' && c != '&' && c != '.' && c != '-' && c != '_' && c != '%'
            })
            .to_string()
        })
}

fn extract_device_code(text: &str) -> Option<String> {
    let text = &strip_ansi(text);
    for word in text.split_whitespace() {
        let clean = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-');
        if clean.len() < 7 || clean.len() > 20 || !clean.contains('-') {
            continue;
        }
        let parts: Vec<&str> = clean.split('-').collect();
        if parts.len() < 2 || parts.len() > 4 {
            continue;
        }
        if !parts.iter().all(|p| p.len() >= 2 && p.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())) {
            continue;
        }
        return Some(clean.to_string());
    }
    None
}
