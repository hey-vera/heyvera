use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploySurfaceStatus {
    Match,
    Drift,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FrontendAssets {
    pub js: Option<String>,
    pub css: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployMeta {
    pub service: Option<String>,
    pub branch: Option<String>,
    pub commit: Option<String>,
    #[serde(rename = "commitShort")]
    pub commit_short: Option<String>,
    #[serde(rename = "deployedAt")]
    pub deployed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackendDeployStatus {
    pub service: &'static str,
    pub version: &'static str,
    pub commit: Option<String>,
    pub commit_short: Option<String>,
    pub branch: Option<String>,
    pub deployed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FrontendDeployStatus {
    pub public_url: String,
    pub local_root: String,
    pub expected_assets: FrontendAssets,
    pub live_assets: Option<FrontendAssets>,
    pub status: DeploySurfaceStatus,
    pub drift: bool,
    pub checked_at: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeployStatusResponse {
    pub status: DeploySurfaceStatus,
    pub service: &'static str,
    pub observed_at: String,
    pub generated_at: String,
    pub backend: BackendDeployStatus,
    pub frontend: FrontendDeployStatus,
}

pub async fn deploy_status() -> Json<DeployStatusResponse> {
    Json(build_deploy_status().await)
}

async fn build_deploy_status() -> DeployStatusResponse {
    let generated_at = Utc::now().to_rfc3339();
    let meta = read_deploy_meta();
    let backend = BackendDeployStatus {
        service: "cortex",
        version: env!("CARGO_PKG_VERSION"),
        commit: option_env!("GITHUB_SHA")
            .map(str::to_string)
            .or_else(|| std::env::var("GITHUB_SHA").ok())
            .or_else(|| std::env::var("DEPLOY_COMMIT").ok())
            .or_else(|| meta.as_ref().and_then(|m| m.commit.clone())),
        commit_short: std::env::var("DEPLOY_COMMIT_SHORT")
            .ok()
            .or_else(|| meta.as_ref().and_then(|m| m.commit_short.clone())),
        branch: std::env::var("GIT_BRANCH")
            .ok()
            .or_else(|| meta.as_ref().and_then(|m| m.branch.clone())),
        deployed_at: std::env::var("DEPLOY_TIMESTAMP")
            .ok()
            .or_else(|| meta.and_then(|m| m.deployed_at)),
    };

    let frontend = build_frontend_status().await;
    let status = if frontend.status == DeploySurfaceStatus::Drift {
        DeploySurfaceStatus::Drift
    } else if backend.commit.is_none() || frontend.status == DeploySurfaceStatus::Unknown {
        DeploySurfaceStatus::Unknown
    } else {
        DeploySurfaceStatus::Match
    };

    DeployStatusResponse {
        status,
        service: "cortex",
        observed_at: generated_at.clone(),
        generated_at,
        backend,
        frontend,
    }
}

async fn build_frontend_status() -> FrontendDeployStatus {
    let public_url = std::env::var("CORTEX_FRONTEND_PUBLIC_URL")
        .unwrap_or_else(|_| "https://cortex.heyvera.org/".to_string());
    let local_root = frontend_root();
    let expected_assets = read_frontend_assets(&local_root);
    let checked_at = Utc::now().to_rfc3339();

    let live_result = if should_check_live_frontend() {
        fetch_live_assets(&public_url).await
    } else {
        Err("live frontend check disabled for this build".to_string())
    };
    let (live_assets, status, error) = match live_result {
        Ok(assets) => {
            let status = if expected_assets.js.is_some()
                && assets.js.is_some()
                && expected_assets.js != assets.js
            {
                DeploySurfaceStatus::Drift
            } else if expected_assets.js.is_some() && assets.js.is_some() {
                DeploySurfaceStatus::Match
            } else {
                DeploySurfaceStatus::Unknown
            };
            (Some(assets), status, None)
        }
        Err(err) => (None, DeploySurfaceStatus::Unknown, Some(err)),
    };

    let drift = status == DeploySurfaceStatus::Drift;
    FrontendDeployStatus {
        public_url,
        local_root: local_root.display().to_string(),
        expected_assets,
        live_assets,
        status,
        drift,
        checked_at,
        error,
    }
}

fn should_check_live_frontend() -> bool {
    match std::env::var("CORTEX_DEPLOY_STATUS_LIVE_CHECK") {
        Ok(value) => value != "0" && !value.eq_ignore_ascii_case("false"),
        Err(_) => !cfg!(debug_assertions),
    }
}

fn read_deploy_meta() -> Option<DeployMeta> {
    let path = std::env::var("CORTEX_DEPLOY_META_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("deploy-meta.json"));
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn frontend_root() -> PathBuf {
    std::env::var("CORTEX_FRONTEND_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/www/cortex"))
}

fn read_frontend_assets(root: &Path) -> FrontendAssets {
    let html = std::fs::read_to_string(root.join("index.html")).unwrap_or_default();
    parse_frontend_assets(&html)
}

async fn fetch_live_assets(public_url: &str) -> Result<FrontendAssets, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .user_agent("cortex-deploy-status/0.1")
        .build()
        .map_err(|err| err.to_string())?;
    let html = client
        .get(public_url)
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|err| err.to_string())?
        .error_for_status()
        .map_err(|err| err.to_string())?
        .text()
        .await
        .map_err(|err| err.to_string())?;
    Ok(parse_frontend_assets(&html))
}

pub fn parse_frontend_assets(html: &str) -> FrontendAssets {
    FrontendAssets {
        js: find_asset(html, "/assets/index-", ".js"),
        css: find_asset(html, "/assets/index-", ".css"),
    }
}

fn find_asset(html: &str, prefix: &str, suffix: &str) -> Option<String> {
    for (start, _) in html.match_indices(prefix) {
        let rest = &html[start..];
        let end = rest
            .find(|ch: char| ch == '"' || ch == '\'' || ch.is_whitespace() || ch == '>')
            .unwrap_or(rest.len());
        let candidate = &rest[..end];
        if candidate.ends_with(suffix) {
            return Some(candidate.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_vite_index_assets() {
        let html = r#"
            <link rel="stylesheet" crossorigin href="/assets/index-DCTLbVzF.css">
            <script type="module" crossorigin src="/assets/index-8M8EThK7.js"></script>
        "#;

        let assets = parse_frontend_assets(html);

        assert_eq!(assets.js.as_deref(), Some("/assets/index-8M8EThK7.js"));
        assert_eq!(assets.css.as_deref(), Some("/assets/index-DCTLbVzF.css"));
    }
}
