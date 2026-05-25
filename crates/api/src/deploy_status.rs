use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::Json;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeploySurfaceStatus {
    Match,
    Drift,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CommitAlignmentStatus {
    Match,
    Mismatch,
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
    pub expected_source: String,
    pub expected_assets: FrontendAssets,
    pub live_assets: Option<FrontendAssets>,
    pub status: DeploySurfaceStatus,
    pub drift: bool,
    pub checked_at: String,
    pub error: Option<String>,
    pub cloudflare_pages: CloudflarePagesStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloudflarePagesStatus {
    pub configured: bool,
    pub project: String,
    pub status: DeploySurfaceStatus,
    pub deployment_id: Option<String>,
    pub environment: Option<String>,
    pub branch: Option<String>,
    pub commit: Option<String>,
    pub url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeploymentCommitStatus {
    pub status: CommitAlignmentStatus,
    pub backend_commit: Option<String>,
    pub backend_commit_short: Option<String>,
    pub frontend_commit: Option<String>,
    pub frontend_commit_short: Option<String>,
    pub backend_branch: Option<String>,
    pub frontend_branch: Option<String>,
    pub branch_match: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeployStatusResponse {
    pub status: DeploySurfaceStatus,
    pub service: &'static str,
    pub observed_at: String,
    pub generated_at: String,
    pub backend: BackendDeployStatus,
    pub frontend: FrontendDeployStatus,
    pub commits: DeploymentCommitStatus,
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
    let commits = build_commit_status(&backend, &frontend);
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
        commits,
    }
}

fn build_commit_status(
    backend: &BackendDeployStatus,
    frontend: &FrontendDeployStatus,
) -> DeploymentCommitStatus {
    let backend_commit = backend.commit.clone();
    let frontend_commit = frontend.cloudflare_pages.commit.clone();
    let status = match (backend_commit.as_deref(), frontend_commit.as_deref()) {
        (Some(backend_commit), Some(frontend_commit)) if backend_commit == frontend_commit => {
            CommitAlignmentStatus::Match
        }
        (Some(_), Some(_)) => CommitAlignmentStatus::Mismatch,
        _ => CommitAlignmentStatus::Unknown,
    };
    let backend_branch = backend.branch.clone();
    let frontend_branch = frontend.cloudflare_pages.branch.clone();
    let branch_match = match (backend_branch.as_deref(), frontend_branch.as_deref()) {
        (Some(backend_branch), Some(frontend_branch)) => Some(backend_branch == frontend_branch),
        _ => None,
    };

    DeploymentCommitStatus {
        status,
        backend_commit_short: backend
            .commit_short
            .clone()
            .or_else(|| backend_commit.as_deref().map(short_commit)),
        frontend_commit_short: frontend_commit.as_deref().map(short_commit),
        backend_commit,
        frontend_commit,
        backend_branch,
        frontend_branch,
        branch_match,
    }
}

fn short_commit(commit: &str) -> String {
    commit.chars().take(7).collect()
}

async fn build_frontend_status() -> FrontendDeployStatus {
    let public_url = std::env::var("CORTEX_FRONTEND_PUBLIC_URL")
        .unwrap_or_else(|_| "https://cortex.heyvera.org/".to_string());
    let local_root = frontend_root();
    let checked_at = Utc::now().to_rfc3339();
    let cloudflare_pages = inspect_cloudflare_pages().await;
    let (expected_source, expected_assets) =
        expected_frontend_assets(&cloudflare_pages, &local_root).await;

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
        expected_source,
        expected_assets,
        live_assets,
        status,
        drift,
        checked_at,
        error,
        cloudflare_pages,
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

async fn expected_frontend_assets(
    cloudflare_pages: &CloudflarePagesStatus,
    local_root: &Path,
) -> (String, FrontendAssets) {
    if let Some(url) = cloudflare_pages.url.as_deref() {
        if let Ok(assets) = fetch_live_assets(url).await {
            return ("cloudflare_pages".to_string(), assets);
        }
    }
    (
        "vps_static_fallback".to_string(),
        read_frontend_assets(local_root),
    )
}

async fn inspect_cloudflare_pages() -> CloudflarePagesStatus {
    let project = std::env::var("CLOUDFLARE_PAGES_PROJECT")
        .or_else(|_| std::env::var("CF_PAGES_PROJECT"))
        .unwrap_or_else(|_| "cortex".to_string());
    let account_id = std::env::var("CLOUDFLARE_ACCOUNT_ID")
        .or_else(|_| std::env::var("CF_ACCOUNT_ID"))
        .ok();
    let api_token = std::env::var("CLOUDFLARE_API_TOKEN")
        .or_else(|_| std::env::var("CF_API_TOKEN"))
        .ok();

    let (Some(account_id), Some(api_token)) = (account_id, api_token) else {
        return CloudflarePagesStatus {
            configured: false,
            project,
            status: DeploySurfaceStatus::Unknown,
            deployment_id: None,
            environment: None,
            branch: None,
            commit: None,
            url: None,
            error: Some("Cloudflare Pages read credentials are not configured".to_string()),
        };
    };

    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{}/pages/projects/{}",
        account_id, project
    );
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent("cortex-deploy-status/0.1")
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            return CloudflarePagesStatus {
                configured: true,
                project,
                status: DeploySurfaceStatus::Unknown,
                deployment_id: None,
                environment: None,
                branch: None,
                commit: None,
                url: None,
                error: Some(err.to_string()),
            };
        }
    };

    let response = client
        .get(url)
        .bearer_auth(api_token)
        .send()
        .await
        .and_then(|res| res.error_for_status());

    let body = match response {
        Ok(res) => match res.json::<Value>().await {
            Ok(body) => body,
            Err(err) => {
                return cloudflare_error_status(
                    project,
                    true,
                    redact_cloudflare_error(err, &account_id),
                );
            }
        },
        Err(err) => {
            return cloudflare_error_status(
                project,
                true,
                redact_cloudflare_error(err, &account_id),
            );
        }
    };

    let deployment = body
        .pointer("/result/canonical_deployment")
        .or_else(|| body.pointer("/result/latest_deployment"));

    match deployment {
        Some(deployment) => CloudflarePagesStatus {
            configured: true,
            project,
            status: deployment_status_from_json(deployment),
            deployment_id: json_string(deployment, &["id"]),
            environment: json_string(deployment, &["environment"]),
            branch: deployment_branch(deployment),
            commit: deployment_commit(deployment),
            url: json_string(deployment, &["url"]),
            error: None,
        },
        None => CloudflarePagesStatus {
            configured: true,
            project,
            status: DeploySurfaceStatus::Unknown,
            deployment_id: None,
            environment: None,
            branch: None,
            commit: None,
            url: None,
            error: Some(
                "Cloudflare Pages project response did not include a deployment".to_string(),
            ),
        },
    }
}

fn cloudflare_error_status(
    project: String,
    configured: bool,
    error: String,
) -> CloudflarePagesStatus {
    CloudflarePagesStatus {
        configured,
        project,
        status: DeploySurfaceStatus::Unknown,
        deployment_id: None,
        environment: None,
        branch: None,
        commit: None,
        url: None,
        error: Some(error),
    }
}

fn redact_cloudflare_error(err: reqwest::Error, account_id: &str) -> String {
    err.to_string().replace(account_id, "[cloudflare-account]")
}

fn deployment_status_from_json(deployment: &Value) -> DeploySurfaceStatus {
    match json_string(deployment, &["latest_stage", "status"])
        .or_else(|| json_string(deployment, &["stages", "0", "status"]))
        .as_deref()
    {
        Some("success") => DeploySurfaceStatus::Match,
        Some(_) => DeploySurfaceStatus::Unknown,
        None => DeploySurfaceStatus::Unknown,
    }
}

fn deployment_branch(deployment: &Value) -> Option<String> {
    json_string(deployment, &["deployment_trigger", "metadata", "branch"])
        .or_else(|| json_string(deployment, &["source", "config", "branch"]))
}

fn deployment_commit(deployment: &Value) -> Option<String> {
    json_string(
        deployment,
        &["deployment_trigger", "metadata", "commit_hash"],
    )
    .or_else(|| json_string(deployment, &["source", "config", "commit_hash"]))
    .or_else(|| json_string(deployment, &["source", "config", "commit"]))
}

fn json_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        if let Ok(index) = segment.parse::<usize>() {
            current = current.get(index)?;
        } else {
            current = current.get(*segment)?;
        }
    }
    current.as_str().map(ToString::to_string)
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

    #[test]
    fn parses_cloudflare_pages_deployment_metadata() {
        let deployment = serde_json::json!({
            "id": "deployment-123",
            "environment": "production",
            "url": "https://deployment.cortex.pages.dev",
            "latest_stage": { "status": "success" },
            "deployment_trigger": {
                "metadata": {
                    "branch": "main",
                    "commit_hash": "abc123"
                }
            }
        });

        assert_eq!(
            deployment_status_from_json(&deployment),
            DeploySurfaceStatus::Match
        );
        assert_eq!(deployment_branch(&deployment).as_deref(), Some("main"));
        assert_eq!(deployment_commit(&deployment).as_deref(), Some("abc123"));
        assert_eq!(
            json_string(&deployment, &["id"]).as_deref(),
            Some("deployment-123")
        );
    }

    #[test]
    fn commit_alignment_matches_equal_commits() {
        let backend = test_backend(Some("abc123456789"), Some("main"));
        let frontend = test_frontend(Some("abc123456789"), Some("main"));

        let commits = build_commit_status(&backend, &frontend);

        assert_eq!(commits.status, CommitAlignmentStatus::Match);
        assert_eq!(commits.backend_commit_short.as_deref(), Some("abc1234"));
        assert_eq!(commits.frontend_commit_short.as_deref(), Some("abc1234"));
        assert_eq!(commits.branch_match, Some(true));
    }

    #[test]
    fn commit_alignment_reports_mismatched_commits() {
        let backend = test_backend(Some("abc123456789"), Some("main"));
        let frontend = test_frontend(Some("def987654321"), Some("main"));

        let commits = build_commit_status(&backend, &frontend);

        assert_eq!(commits.status, CommitAlignmentStatus::Mismatch);
        assert_eq!(commits.branch_match, Some(true));
    }

    #[test]
    fn commit_alignment_is_unknown_when_a_surface_is_missing_commit() {
        let backend = test_backend(Some("abc123456789"), Some("main"));
        let frontend = test_frontend(None, Some("main"));

        let commits = build_commit_status(&backend, &frontend);

        assert_eq!(commits.status, CommitAlignmentStatus::Unknown);
        assert_eq!(commits.branch_match, Some(true));
    }

    fn test_backend(commit: Option<&str>, branch: Option<&str>) -> BackendDeployStatus {
        BackendDeployStatus {
            service: "cortex",
            version: "0.1.0",
            commit: commit.map(ToString::to_string),
            commit_short: None,
            branch: branch.map(ToString::to_string),
            deployed_at: None,
        }
    }

    fn test_frontend(commit: Option<&str>, branch: Option<&str>) -> FrontendDeployStatus {
        FrontendDeployStatus {
            public_url: "https://cortex.heyvera.org/".to_string(),
            local_root: "/var/www/cortex".to_string(),
            expected_source: "cloudflare_pages".to_string(),
            expected_assets: FrontendAssets {
                js: Some("/assets/index-test.js".to_string()),
                css: Some("/assets/index-test.css".to_string()),
            },
            live_assets: Some(FrontendAssets {
                js: Some("/assets/index-test.js".to_string()),
                css: Some("/assets/index-test.css".to_string()),
            }),
            status: DeploySurfaceStatus::Match,
            drift: false,
            checked_at: "2026-05-25T00:00:00Z".to_string(),
            error: None,
            cloudflare_pages: CloudflarePagesStatus {
                configured: true,
                project: "cortex".to_string(),
                status: DeploySurfaceStatus::Match,
                deployment_id: Some("deployment-123".to_string()),
                environment: Some("production".to_string()),
                branch: branch.map(ToString::to_string),
                commit: commit.map(ToString::to_string),
                url: Some("https://deployment.cortex.pages.dev".to_string()),
                error: None,
            },
        }
    }
}
