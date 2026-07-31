use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::social_policy::{PolicyDecision, PostAction, ProfileAction};
use crate::state::AppState;

type MediaResponse = (StatusCode, Json<serde_json::Value>);

fn media_ok(v: serde_json::Value) -> MediaResponse {
    (StatusCode::OK, Json(v))
}
fn media_err(status: StatusCode, code: &str, msg: &str) -> MediaResponse {
    (
        status,
        Json(serde_json::json!({ "error": msg, "code": code })),
    )
}

/// Allowed MIME types for media uploads.
const ALLOWED_IMAGE_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
];

const ALLOWED_VIDEO_TYPES: &[&str] = &[
    "video/mp4",
    "video/webm",
];

/// Max file sizes in bytes.
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE: u64 = 50 * 1024 * 1024; // 50 MB
const MEDIA_DELIVERY_TTL_SECONDS: i64 = 300;

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
}

#[derive(Debug, Deserialize)]
pub struct MediaDeliveryQuery {
    exp: i64,
    sig: String,
    post: Option<String>,
    viewer: Option<String>,
}

fn media_signing_secret() -> Option<String> {
    std::env::var("SOCIAL_MEDIA_SIGNING_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("CLERK_SECRET_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            if crate::is_production_env() {
                None
            } else {
                Some("heyvera-local-media-delivery-only".to_string())
            }
        })
}

fn media_delivery_payload(
    media_id: &str,
    post_id: Option<&str>,
    viewer_profile_id: Option<&str>,
    expires_at: i64,
) -> String {
    format!(
        "heyvera-media-v1\n{}\n{}\n{}\n{}",
        media_id,
        post_id.unwrap_or(""),
        viewer_profile_id.unwrap_or(""),
        expires_at
    )
}

fn sign_media_delivery(
    secret: &[u8],
    media_id: &str,
    post_id: Option<&str>,
    viewer_profile_id: Option<&str>,
    expires_at: i64,
) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts media signing keys");
    mac.update(
        media_delivery_payload(media_id, post_id, viewer_profile_id, expires_at).as_bytes(),
    );
    mac.finalize().into_bytes().to_vec()
}

fn verify_media_delivery(
    secret: &[u8],
    media_id: &str,
    post_id: Option<&str>,
    viewer_profile_id: Option<&str>,
    expires_at: i64,
    signature_hex: &str,
    now: i64,
) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    if expires_at < now || expires_at > now + MEDIA_DELIVERY_TTL_SECONDS + 30 {
        return false;
    }
    let Ok(signature) = hex::decode(signature_hex) else {
        return false;
    };
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC accepts media signing keys");
    mac.update(
        media_delivery_payload(media_id, post_id, viewer_profile_id, expires_at).as_bytes(),
    );
    mac.verify_slice(&signature).is_ok()
}

/// Short-lived, audience-bound capability URL. The storage key is never exposed.
pub fn signed_media_delivery_url(
    media_id: &str,
    post_id: Option<&str>,
    viewer_profile_id: Option<&str>,
) -> Option<String> {
    let secret = media_signing_secret()?;
    let expires_at = chrono::Utc::now().timestamp() + MEDIA_DELIVERY_TTL_SECONDS;
    let signature = sign_media_delivery(
        secret.as_bytes(),
        media_id,
        post_id,
        viewer_profile_id,
        expires_at,
    );
    let mut url = format!(
        "/v1/social/media/{}/content?exp={}&sig={}",
        media_id,
        expires_at,
        hex::encode(signature)
    );
    if let Some(post_id) = post_id {
        url.push_str("&post=");
        url.push_str(post_id);
    }
    if let Some(viewer_profile_id) = viewer_profile_id {
        url.push_str("&viewer=");
        url.push_str(viewer_profile_id);
    }
    Some(url)
}

#[derive(Debug, Deserialize)]
pub struct UploadUrlRequest {
    pub filename: String,
    pub content_type: String,
    pub size: u64,
}

/// POST /v1/social/media/upload-url
///
/// Returns a signed upload URL for the client to PUT the file to.
/// Auth required.
pub async fn request_upload_url(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Json(req): Json<UploadUrlRequest>,
) -> impl IntoResponse {
    // Resolve the caller's social profile
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return Json(serde_json::json!({
                "error": "No profile found — create a profile first",
                "code": "NOT_FOUND"
            }));
        }
    };

    let content_type = req.content_type.to_lowercase();

    // Determine media category and validate MIME type
    let is_image = ALLOWED_IMAGE_TYPES.contains(&content_type.as_str());
    let is_video = ALLOWED_VIDEO_TYPES.contains(&content_type.as_str());

    if !is_image && !is_video {
        return Json(serde_json::json!({
            "error": format!(
                "Unsupported content type '{}'. Allowed: image/jpeg, image/png, image/gif, image/webp, video/mp4, video/webm",
                content_type
            ),
            "code": "INVALID_CONTENT_TYPE"
        }));
    }

    // Validate file size
    let max_size = if is_video { MAX_VIDEO_SIZE } else { MAX_IMAGE_SIZE };
    if req.size > max_size {
        let max_mb = max_size / (1024 * 1024);
        return Json(serde_json::json!({
            "error": format!(
                "File size {} bytes exceeds maximum {} MB for {}",
                req.size, max_mb, if is_video { "video" } else { "image" }
            ),
            "code": "FILE_TOO_LARGE"
        }));
    }

    if req.size == 0 {
        return Json(serde_json::json!({
            "error": "File size must be greater than 0",
            "code": "INVALID_INPUT"
        }));
    }

    // Sanitize filename
    let filename = sanitize_filename(&req.filename);
    if filename.is_empty() {
        return Json(serde_json::json!({
            "error": "Invalid filename",
            "code": "INVALID_INPUT"
        }));
    }

    let profile_id = profile["id"].as_str().unwrap_or("");
    let media_type = if is_video { "video" } else { "image" };

    // Fail-closed before creating a pending media row (production without storage).
    if must_refuse_mock_upload(crate::is_production_env(), storage_fully_configured()) {
        tracing::error!("refusing media upload URL: storage not configured in production");
        return Json(serde_json::json!({
            "error": "Object storage is not fully configured (STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY). Mock media uploads are disabled in production.",
            "code": "STORAGE_NOT_CONFIGURED"
        }));
    }

    // Create media object in DB (status = "pending")
    let media = db(&state).social_create_media_object(
        profile_id,
        &filename,
        &content_type,
        req.size as i64,
        media_type,
    );

    let media_id = media["id"].as_str().unwrap_or("");
    let storage_key = media["storageKey"].as_str().unwrap_or("");

    // Generate the upload URL (timed for latency observability)
    let presign_start = std::time::Instant::now();
    let (upload_url, expires_in) = match generate_upload_url(storage_key, &content_type) {
        Ok(pair) => pair,
        Err(err) => {
            tracing::error!(
                media_id = %media_id,
                error = %err,
                "refusing media upload URL"
            );
            return Json(serde_json::json!({
                "error": err,
                "code": "STORAGE_NOT_CONFIGURED"
            }));
        }
    };
    tracing::info!(
        method = "presign_upload_url",
        duration_ms = presign_start.elapsed().as_millis() as u64,
        media_type = media_type,
        "presigned upload URL generated"
    );

    Json(serde_json::json!({
        "upload_url": upload_url,
        "media_id": media_id,
        "expires_in": expires_in,
    }))
}

/// Directory for mock media bytes when R2/S3 is not configured.
pub fn mock_media_root() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("HEYVERA_MOCK_MEDIA_DIR") {
        return std::path::PathBuf::from(dir);
    }
    std::env::temp_dir().join("heyvera-mock-media")
}

/// Sanitize storage_key segments so it cannot escape the mock root.
fn mock_media_path(storage_key: &str) -> Result<std::path::PathBuf, String> {
    let key = storage_key.trim().trim_start_matches('/');
    if key.is_empty() {
        return Err("empty storage key".into());
    }
    if key.contains("..") {
        return Err("invalid storage key".into());
    }
    let path = mock_media_root().join(key);
    // Ensure resolved path stays under root
    let root = mock_media_root();
    if !path.starts_with(&root) {
        return Err("invalid storage key path".into());
    }
    Ok(path)
}

/// Persist mock upload bytes (used by PUT handler and tests).
pub fn mock_store_put(storage_key: &str, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    let path = mock_media_path(storage_key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("write: {e}"))?;
    Ok(path)
}

/// Read mock object bytes if present.
pub fn mock_store_get(storage_key: &str) -> Result<Vec<u8>, String> {
    let path = mock_media_path(storage_key)?;
    std::fs::read(&path).map_err(|e| format!("read: {e}"))
}

pub fn mock_store_exists(storage_key: &str) -> bool {
    mock_media_path(storage_key)
        .map(|p| p.is_file())
        .unwrap_or(false)
}

/// PUT /v1/social/media/mock-upload/{*storage_key}
///
/// Accepts and **persists** a body when real object storage is not configured.
/// Fail-closed in production even if a client crafts the mock path.
pub async fn mock_upload(
    Path(storage_key): Path<String>,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if crate::is_production_env() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "error": "Mock media uploads are disabled in production",
                "code": "STORAGE_NOT_CONFIGURED"
            })),
        )
            .into_response();
    }
    match mock_store_put(&storage_key, &body) {
        Ok(path) => {
            tracing::info!(
                storage_key = %storage_key,
                bytes = body.len(),
                path = %path.display(),
                "mock media upload persisted"
            );
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "ok": true,
                    "storageKey": storage_key,
                    "bytes": body.len(),
                })),
            )
                .into_response()
        }
        Err(err) => {
            tracing::warn!(storage_key = %storage_key, error = %err, "mock media upload failed");
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": err,
                    "code": "MOCK_UPLOAD_FAILED",
                })),
            )
                .into_response()
        }
    }
}

/// GET /v1/social/media/{media_id}/content
///
/// Validates a short-lived audience-bound capability, re-checks current post
/// authorization, then serves local bytes or redirects to a short-lived S3 GET.
pub async fn serve_media(
    Path(media_id): Path<String>,
    Query(query): Query<MediaDeliveryQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let post_id = query.post.as_deref().filter(|value| !value.is_empty());
    let viewer_profile_id = query.viewer.as_deref().filter(|value| !value.is_empty());
    let Some(secret) = media_signing_secret() else {
        return media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "Media not found").into_response();
    };
    if !verify_media_delivery(
        secret.as_bytes(),
        &media_id,
        post_id,
        viewer_profile_id,
        query.exp,
        &query.sig,
        chrono::Utc::now().timestamp(),
    ) {
        return media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "Media not found").into_response();
    }

    let Some((owner_profile_id, storage_key, content_type, status)) =
        db(&state).social_get_media_delivery_context(&media_id)
    else {
        return media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "Media not found").into_response();
    };

    let authorized = if let Some(post_id) = post_id {
        status == "attached"
            && db(&state).social_media_is_attached_to_post(&media_id, post_id)
            && db(&state).social_authorize_post(
                post_id,
                viewer_profile_id,
                PostAction::ViewMedia,
            ) == PolicyDecision::Allow
    } else {
        matches!(status.as_str(), "ready" | "attached")
            && viewer_profile_id == Some(owner_profile_id.as_str())
            && db(&state).social_authorize_profile(
                &owner_profile_id,
                viewer_profile_id,
                ProfileAction::View,
            ) == PolicyDecision::Allow
    };
    if !authorized {
        return media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "Media not found").into_response();
    }

    if storage_fully_configured() {
        let endpoint = std::env::var("STORAGE_ENDPOINT").unwrap_or_default();
        let bucket = std::env::var("STORAGE_BUCKET").unwrap_or_default();
        let access_key = std::env::var("STORAGE_ACCESS_KEY").unwrap_or_default();
        let secret_key = std::env::var("STORAGE_SECRET_KEY").unwrap_or_default();
        let url = generate_s3_presigned_get(
            &endpoint,
            &bucket,
            &storage_key,
            60,
            &access_key,
            &secret_key,
        );
        return axum::response::Redirect::temporary(&url).into_response();
    }

    match mock_store_get(&storage_key) {
        Ok(bytes) => {
            let mut response = axum::response::Response::new(axum::body::Body::from(bytes));
            *response.status_mut() = StatusCode::OK;
            if let Ok(value) = axum::http::HeaderValue::from_str(&content_type) {
                response
                    .headers_mut()
                    .insert(axum::http::header::CONTENT_TYPE, value);
            }
            response.headers_mut().insert(
                axum::http::header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("private, max-age=60"),
            );
            response.headers_mut().insert(
                axum::http::header::X_CONTENT_TYPE_OPTIONS,
                axum::http::HeaderValue::from_static("nosniff"),
            );
            response
        }
        Err(_) => media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "Media not found").into_response(),
    }
}

/// POST /v1/social/media/{id}/finalize
///
/// Marks a media upload as complete after the client has uploaded the file.
/// When STORAGE_ENDPOINT + STORAGE_BUCKET are set, verifies the object exists
/// via HTTP HEAD (or GET with Range) before finalizing.
/// Auth required.
pub async fn finalize_upload(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    Path(media_id): Path<String>,
) -> impl IntoResponse {
    // Resolve the caller's social profile
    let profile = match db(&state).social_find_profile_by_clerk_id(&user.user_id) {
        Some(p) => p,
        None => {
            return media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "No profile found");
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");

    // Look up the media object
    let media = match db(&state).social_get_media_object(&media_id) {
        Some(m) => m,
        None => {
            return media_err(StatusCode::NOT_FOUND, "NOT_FOUND", "Media object not found");
        }
    };

    // Verify ownership
    if media["ownerProfileId"].as_str() != Some(profile_id) {
        return media_err(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Not authorized to finalize this media",
        );
    }

    // Verify status is pending
    if media["status"].as_str() != Some("pending") {
        return media_err(
            StatusCode::CONFLICT,
            "CONFLICT",
            &format!(
                "Media object is already in '{}' status",
                media["status"].as_str().unwrap_or("unknown")
            ),
        );
    }

    let storage_key = media["storageKey"].as_str().unwrap_or("");

    // When storage is configured, require a real object HEAD before finalize.
    // Mock/local mode requires the mock file to have been PUT already.
    let storage_configured = std::env::var("STORAGE_ENDPOINT").is_ok()
        && std::env::var("STORAGE_BUCKET").is_ok();

    if storage_configured {
        let storage_check_start = std::time::Instant::now();
        match verify_storage_object_exists(storage_key).await {
            Ok(true) => {
                tracing::info!(
                    method = "storage_finalize_check",
                    duration_ms = storage_check_start.elapsed().as_millis() as u64,
                    storage_key = storage_key,
                    result = "found",
                    "storage object finalize check"
                );
            }
            Ok(false) => {
                tracing::warn!(
                    method = "storage_finalize_check",
                    duration_ms = storage_check_start.elapsed().as_millis() as u64,
                    storage_key = storage_key,
                    result = "missing",
                    "storage object not found — refusing finalize"
                );
                return media_err(
                    StatusCode::NOT_FOUND,
                    "OBJECT_NOT_FOUND",
                    "Upload object not found in storage — complete the upload before finalizing",
                );
            }
            Err(err) => {
                tracing::error!(
                    method = "storage_finalize_check",
                    duration_ms = storage_check_start.elapsed().as_millis() as u64,
                    storage_key = storage_key,
                    error = %err,
                    "storage object finalize check failed"
                );
                return media_err(
                    StatusCode::BAD_REQUEST,
                    "STORAGE_VERIFY_FAILED",
                    &format!("Could not verify upload object in storage: {err}"),
                );
            }
        }
    } else if !mock_store_exists(storage_key) {
        return media_err(
            StatusCode::NOT_FOUND,
            "OBJECT_NOT_FOUND",
            "Mock upload object not found — PUT to mock-upload URL before finalizing",
        );
    }

    // Mark as finalized
    let finalized = db(&state).social_finalize_media_object(&media_id);

    let delivery_url = signed_media_delivery_url(
        finalized["id"].as_str().unwrap_or(""),
        None,
        Some(profile_id),
    );

    media_ok(serde_json::json!({
        "media_id": finalized["id"],
        "url": delivery_url,
        "type": finalized["mediaType"],
    }))
}

/// HEAD (or ranged GET) the object URL. Returns Ok(true) if present, Ok(false) if 404.
async fn verify_storage_object_exists(storage_key: &str) -> Result<bool, String> {
    let object_url = storage_object_url(storage_key)
        .ok_or_else(|| "STORAGE_ENDPOINT/STORAGE_BUCKET not fully configured".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    // Prefer HEAD; some gateways disallow HEAD — fall back to ranged GET.
    let head = client.head(&object_url).send().await;
    match head {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                return Ok(true);
            }
            if status.as_u16() == 404 || status.as_u16() == 403 {
                // 403 can mean missing on private buckets without signed GET; try signed-less public URL only.
                // Still treat clear not-found as missing.
                if status.as_u16() == 404 {
                    return Ok(false);
                }
            }
            // Retry with Range GET when HEAD is not allowed (405/501) or ambiguous.
            if status.as_u16() == 405 || status.as_u16() == 501 || status.as_u16() == 403 {
                // fall through to GET range
            } else if status.is_client_error() {
                return Ok(false);
            } else {
                return Err(format!("HEAD {} returned {}", object_url, status));
            }
        }
        Err(e) => {
            tracing::debug!(error = %e, "HEAD failed, trying ranged GET");
        }
    }

    let get = client
        .get(&object_url)
        .header("Range", "bytes=0-0")
        .send()
        .await
        .map_err(|e| format!("GET range: {e}"))?;
    let status = get.status();
    if status.is_success() || status.as_u16() == 206 {
        return Ok(true);
    }
    if status.as_u16() == 404 {
        return Ok(false);
    }
    Err(format!("GET range {} returned {}", object_url, status))
}

/// Public/object URL for a storage key (no signature — object must be readable or HEAD-able).
fn storage_object_url(storage_key: &str) -> Option<String> {
    if let Ok(domain) = std::env::var("STORAGE_PUBLIC_URL") {
        return Some(format!(
            "{}/{}",
            domain.trim_end_matches('/'),
            storage_key
        ));
    }
    let endpoint = std::env::var("STORAGE_ENDPOINT").ok()?;
    let bucket = std::env::var("STORAGE_BUCKET").ok()?;
    Some(format!(
        "{}/{}/{}",
        endpoint.trim_end_matches('/'),
        bucket,
        storage_key
    ))
}

// ─── Storage URL generation ─────────────────────────────────────────────────

/// True when all four storage credentials/env vars are set non-empty.
pub fn storage_fully_configured() -> bool {
    storage_credentials_present(
        std::env::var("STORAGE_ENDPOINT").ok().as_deref(),
        std::env::var("STORAGE_BUCKET").ok().as_deref(),
        std::env::var("STORAGE_ACCESS_KEY").ok().as_deref(),
        std::env::var("STORAGE_SECRET_KEY").ok().as_deref(),
    )
}

/// Pure helper: all four storage fields must be Some and non-empty after trim.
pub fn storage_credentials_present(
    endpoint: Option<&str>,
    bucket: Option<&str>,
    access_key: Option<&str>,
    secret_key: Option<&str>,
) -> bool {
    matches!(
        (
            non_empty(endpoint),
            non_empty(bucket),
            non_empty(access_key),
            non_empty(secret_key),
        ),
        (true, true, true, true)
    )
}

fn non_empty(v: Option<&str>) -> bool {
    v.map(|s| !s.trim().is_empty()).unwrap_or(false)
}

/// Pure helper: mock upload URLs are forbidden when production and storage incomplete.
pub fn must_refuse_mock_upload(is_production: bool, storage_configured: bool) -> bool {
    is_production && !storage_configured
}

/// Generate a presigned PUT URL for uploading to S3/R2-compatible storage.
///
/// - When storage is fully configured: returns a presigned PUT URL.
/// - When storage is incomplete and **not** production: returns a mock local upload path.
/// - When storage is incomplete and production (`HEYVERA_ENV`/`CORTEX_ENV`/…): **errors**
///   (fail-closed — never return mock URLs in prod).
///
/// Returns Ok((upload_url, expires_in_seconds)) or Err(message).
fn generate_upload_url(storage_key: &str, content_type: &str) -> Result<(String, u64), String> {
    let endpoint = std::env::var("STORAGE_ENDPOINT").ok();
    let bucket = std::env::var("STORAGE_BUCKET").ok();
    let access_key = std::env::var("STORAGE_ACCESS_KEY").ok();
    let secret_key = std::env::var("STORAGE_SECRET_KEY").ok();

    let expires_in: u64 = 300; // 5 minutes
    let configured = storage_credentials_present(
        endpoint.as_deref(),
        bucket.as_deref(),
        access_key.as_deref(),
        secret_key.as_deref(),
    );

    if configured {
        let url = generate_s3_presigned_put(
            endpoint.as_deref().unwrap(),
            bucket.as_deref().unwrap(),
            storage_key,
            content_type,
            expires_in,
            access_key.as_deref().unwrap(),
            secret_key.as_deref().unwrap(),
        );
        return Ok((url, expires_in));
    }

    if must_refuse_mock_upload(crate::is_production_env(), false) {
        return Err(
            "Object storage is not fully configured (STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY). Mock media uploads are disabled in production."
                .to_string(),
        );
    }

    // Dev/local only — mock/local upload path
    tracing::warn!(
        "No STORAGE_ENDPOINT/STORAGE_BUCKET configured — returning mock upload URL for key: {}",
        storage_key
    );
    let mock_url = format!("/v1/social/media/mock-upload/{}", storage_key);
    Ok((mock_url, expires_in))
}

/// Generate a presigned S3-compatible PUT URL using AWS Signature V4.
///
/// This constructs the URL with query-string authentication parameters
/// so the client can PUT the file directly without needing credentials.
fn generate_s3_presigned_get(
    endpoint: &str,
    bucket: &str,
    key: &str,
    expires_in: u64,
    access_key: &str,
    secret_key: &str,
) -> String {
    use sha2::Digest;

    let now = chrono::Utc::now();
    let date_stamp = now.format("%Y%m%d").to_string();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let region = std::env::var("STORAGE_REGION").unwrap_or_else(|_| "auto".to_string());
    let credential_scope = format!("{}/{}/s3/aws4_request", date_stamp, region);
    let credential = format!("{}/{}", access_key, credential_scope);
    let host = endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    let mut params = vec![
        ("X-Amz-Algorithm", "AWS4-HMAC-SHA256".to_string()),
        ("X-Amz-Credential", credential),
        ("X-Amz-Date", amz_date.clone()),
        ("X-Amz-Expires", expires_in.to_string()),
        ("X-Amz-SignedHeaders", "host".to_string()),
    ];
    params.sort_by(|a, b| a.0.cmp(b.0));
    let canonical_query: String = params
        .iter()
        .map(|(key, value)| format!("{}={}", uri_encode(key), uri_encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    let canonical_request = format!(
        "GET\n/{}/{}\n{}\nhost:{}\n\nhost\nUNSIGNED-PAYLOAD",
        bucket, key, canonical_query, host
    );
    let canonical_hash = hex::encode(sha2::Sha256::digest(canonical_request.as_bytes()));
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date, credential_scope, canonical_hash
    );
    let k_date = hmac_sha256(format!("AWS4{}", secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"s3");
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
    format!(
        "{}/{}/{}?{}&X-Amz-Signature={}",
        endpoint.trim_end_matches('/'),
        bucket,
        key,
        canonical_query,
        signature
    )
}

fn generate_s3_presigned_put(
    endpoint: &str,
    bucket: &str,
    key: &str,
    content_type: &str,
    expires_in: u64,
    access_key: &str,
    secret_key: &str,
) -> String {
    let now = chrono::Utc::now();
    let date_stamp = now.format("%Y%m%d").to_string();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();

    // Extract region from endpoint or default to "auto" (R2 uses "auto")
    let region = std::env::var("STORAGE_REGION").unwrap_or_else(|_| "auto".to_string());
    let service = "s3";

    let credential_scope = format!("{}/{}/{}/aws4_request", date_stamp, region, service);
    let credential = format!("{}/{}", access_key, credential_scope);

    // Canonical headers
    let host = endpoint
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');

    // Build the canonical query string (parameters must be sorted)
    let mut params = vec![
        ("X-Amz-Algorithm", "AWS4-HMAC-SHA256".to_string()),
        ("X-Amz-Credential", credential.clone()),
        ("X-Amz-Date", amz_date.clone()),
        ("X-Amz-Expires", expires_in.to_string()),
        ("X-Amz-SignedHeaders", "content-type;host".to_string()),
    ];
    params.sort_by(|a, b| a.0.cmp(&b.0));

    let canonical_querystring: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", uri_encode(k), uri_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    // Canonical request
    let canonical_headers = format!("content-type:{}\nhost:{}\n", content_type, host);
    let signed_headers = "content-type;host";

    let canonical_request = format!(
        "PUT\n/{}/{}\n{}\n{}\n{}\nUNSIGNED-PAYLOAD",
        bucket, key, canonical_querystring, canonical_headers, signed_headers
    );

    // String to sign
    let canonical_request_hash = hex_sha256(canonical_request.as_bytes());
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date, credential_scope, canonical_request_hash
    );

    // Signing key
    let k_date = hmac_sha256(format!("AWS4{}", secret_key).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");

    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    format!(
        "{}/{}/{}?{}&X-Amz-Signature={}",
        endpoint.trim_end_matches('/'),
        bucket,
        key,
        canonical_querystring,
        signature
    )
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex_sha256(data: &[u8]) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn uri_encode(s: &str) -> String {
    let mut result = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

/// Sanitize a filename: keep only alphanumeric, dash, underscore, dot.
fn sanitize_filename(name: &str) -> String {
    let name = name.trim();
    // Take only the filename portion (no path traversal)
    let name = name.rsplit('/').next().unwrap_or(name);
    let name = name.rsplit('\\').next().unwrap_or(name);
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize tests that touch env + shared temp dir.
    static MOCK_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn storage_credentials_require_all_four_non_empty() {
        assert!(!storage_credentials_present(None, None, None, None));
        assert!(!storage_credentials_present(
            Some("https://r2.example"),
            Some("bucket"),
            Some("ak"),
            None
        ));
        assert!(!storage_credentials_present(
            Some("https://r2.example"),
            Some("bucket"),
            Some(""),
            Some("sk")
        ));
        assert!(!storage_credentials_present(
            Some("  "),
            Some("bucket"),
            Some("ak"),
            Some("sk")
        ));
        assert!(storage_credentials_present(
            Some("https://r2.example"),
            Some("bucket"),
            Some("ak"),
            Some("sk")
        ));
    }

    #[test]
    fn media_delivery_signature_binds_post_viewer_and_expiry() {
        let secret = b"test-media-secret";
        let now = 1_800_000_000;
        let expires_at = now + 120;
        let signature = hex::encode(sign_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            expires_at,
        ));

        assert!(verify_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            expires_at,
            &signature,
            now,
        ));
        assert!(!verify_media_delivery(
            secret,
            "media-2",
            Some("post-1"),
            Some("viewer-1"),
            expires_at,
            &signature,
            now,
        ));
        assert!(!verify_media_delivery(
            secret,
            "media-1",
            Some("post-2"),
            Some("viewer-1"),
            expires_at,
            &signature,
            now,
        ));
        assert!(!verify_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-2"),
            expires_at,
            &signature,
            now,
        ));
        assert!(!verify_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            expires_at,
            &signature,
            expires_at + 1,
        ));
        assert!(!verify_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            expires_at,
            "not-hex",
            now,
        ));
        assert!(!verify_media_delivery(
            b"different-secret",
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            expires_at,
            &signature,
            now,
        ));

        let excessive_expiry = now + MEDIA_DELIVERY_TTL_SECONDS + 31;
        let excessive_signature = hex::encode(sign_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            excessive_expiry,
        ));
        assert!(!verify_media_delivery(
            secret,
            "media-1",
            Some("post-1"),
            Some("viewer-1"),
            excessive_expiry,
            &excessive_signature,
            now,
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn media_delivery_rechecks_attachment_and_revoked_audience_access() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".cortex")).unwrap();
        std::env::set_var("HEYVERA_MOCK_MEDIA_DIR", dir.path());
        std::env::set_var("SOCIAL_MEDIA_SIGNING_SECRET", "media-route-test-secret");
        std::env::remove_var("STORAGE_ENDPOINT");
        std::env::remove_var("STORAGE_BUCKET");
        std::env::remove_var("STORAGE_ACCESS_KEY");
        std::env::remove_var("STORAGE_SECRET_KEY");

        let state = AppState::new(
            dir.path().join(".cortex/ledger.jsonl"),
            dir.path().to_path_buf(),
            None,
        )
        .await;
        let database = state.db.as_ref().expect("database");
        let owner = database.social_create_profile(
            "clerk_media_route_owner",
            "media_route_owner",
            "Owner",
            "",
        );
        let viewer = database.social_create_profile(
            "clerk_media_route_viewer",
            "media_route_viewer",
            "Viewer",
            "",
        );
        let owner_id = owner["id"].as_str().unwrap();
        let viewer_id = viewer["id"].as_str().unwrap();
        database.social_update_profile_prefs(
            owner_id,
            None,
            None,
            None,
            Some(true),
            None,
            None,
            None,
        );

        let media = database.social_create_media_object(
            owner_id,
            "private.png",
            "image/png",
            12,
            "image",
        );
        let media_id = media["id"].as_str().unwrap();
        let storage_key = media["storageKey"].as_str().unwrap();
        mock_store_put(storage_key, b"private bytes").expect("mock media");
        database.social_finalize_media_object(media_id);

        let protected_post = database.social_create_post(
            owner_id,
            "protected media",
            "public",
            "person",
            None,
            None,
            None,
            None,
        );
        let post_id = protected_post["id"].as_str().unwrap();
        assert_eq!(
            database.social_link_media_to_post(post_id, &[media_id.to_string()], owner_id),
            vec![media_id.to_string()]
        );

        let unrelated_post = database.social_create_post(
            owner_id,
            "unrelated",
            "public",
            "person",
            None,
            None,
            None,
            None,
        );
        let unrelated_post_id = unrelated_post["id"].as_str().unwrap();

        fn delivery_query(url: &str) -> MediaDeliveryQuery {
            let query = url.split_once('?').expect("signed query").1;
            let params: std::collections::HashMap<&str, &str> = query
                .split('&')
                .filter_map(|part| part.split_once('='))
                .collect();
            MediaDeliveryQuery {
                exp: params["exp"].parse().unwrap(),
                sig: params["sig"].to_string(),
                post: params.get("post").map(|value| (*value).to_string()),
                viewer: params.get("viewer").map(|value| (*value).to_string()),
            }
        }

        let pending_url =
            signed_media_delivery_url(media_id, Some(post_id), Some(viewer_id)).unwrap();
        let pending_response = serve_media(
            Path(media_id.to_string()),
            Query(delivery_query(&pending_url)),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(pending_response.status(), StatusCode::NOT_FOUND);

        let request_id = match database
            .social_follow_or_request(viewer_id, owner_id)
            .expect("follow request")
        {
            crate::db::SocialFollowOutcome::Pending(request_id) => request_id,
            other => panic!("expected pending request, got {other:?}"),
        };
        database
            .social_resolve_follow_request(&request_id, owner_id, true)
            .expect("approve");

        let allowed_url =
            signed_media_delivery_url(media_id, Some(post_id), Some(viewer_id)).unwrap();
        let allowed_response = serve_media(
            Path(media_id.to_string()),
            Query(delivery_query(&allowed_url)),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(allowed_response.status(), StatusCode::OK);

        let wrong_attachment_url =
            signed_media_delivery_url(media_id, Some(unrelated_post_id), Some(viewer_id)).unwrap();
        let wrong_attachment_response = serve_media(
            Path(media_id.to_string()),
            Query(delivery_query(&wrong_attachment_url)),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(wrong_attachment_response.status(), StatusCode::NOT_FOUND);

        database.upsert_account(
            "clerk_media_route_viewer",
            "",
            "Viewer",
            "suspended",
        );
        let suspended_response = serve_media(
            Path(media_id.to_string()),
            Query(delivery_query(&allowed_url)),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(suspended_response.status(), StatusCode::NOT_FOUND);
        database.upsert_account("clerk_media_route_viewer", "", "Viewer", "active");

        database.social_unfollow(viewer_id, owner_id);
        let revoked_response = serve_media(
            Path(media_id.to_string()),
            Query(delivery_query(&allowed_url)),
            State(state.clone()),
        )
        .await
        .into_response();
        assert_eq!(revoked_response.status(), StatusCode::NOT_FOUND);

        std::env::remove_var("HEYVERA_MOCK_MEDIA_DIR");
        std::env::remove_var("SOCIAL_MEDIA_SIGNING_SECRET");
    }

    #[test]
    fn refuse_mock_upload_only_in_production_without_storage() {
        assert!(!must_refuse_mock_upload(false, false));
        assert!(!must_refuse_mock_upload(false, true));
        assert!(!must_refuse_mock_upload(true, true));
        assert!(must_refuse_mock_upload(true, false));
    }

    #[test]
    fn generate_upload_url_fails_closed_in_production_without_storage() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        std::env::remove_var("STORAGE_ENDPOINT");
        std::env::remove_var("STORAGE_BUCKET");
        std::env::remove_var("STORAGE_ACCESS_KEY");
        std::env::remove_var("STORAGE_SECRET_KEY");
        std::env::set_var("HEYVERA_ENV", "production");
        // Avoid panicking CORS helpers in other tests; clear after.
        let result = generate_upload_url("uploads/u/f.png", "image/png");
        std::env::remove_var("HEYVERA_ENV");
        assert!(result.is_err(), "expected Err, got {:?}", result);
        let msg = result.unwrap_err();
        assert!(
            msg.contains("Mock media uploads are disabled in production")
                || msg.contains("not fully configured"),
            "unexpected message: {msg}"
        );
    }

    #[test]
    fn generate_upload_url_allows_mock_outside_production() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        std::env::remove_var("STORAGE_ENDPOINT");
        std::env::remove_var("STORAGE_BUCKET");
        std::env::remove_var("STORAGE_ACCESS_KEY");
        std::env::remove_var("STORAGE_SECRET_KEY");
        std::env::remove_var("HEYVERA_ENV");
        std::env::remove_var("CORTEX_ENV");
        std::env::remove_var("APP_ENV");
        std::env::remove_var("ENVIRONMENT");
        let result = generate_upload_url("uploads/u/f.png", "image/png");
        assert!(result.is_ok(), "expected Ok mock URL, got {:?}", result);
        let (url, expires) = result.unwrap();
        assert!(url.contains("/v1/social/media/mock-upload/"));
        assert_eq!(expires, 300);
    }

    #[test]
    fn mock_put_get_roundtrip_preserves_bytes() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HEYVERA_MOCK_MEDIA_DIR", dir.path());
        // Ensure no R2 mode for resolve_public_url
        std::env::remove_var("STORAGE_ENDPOINT");
        std::env::remove_var("STORAGE_BUCKET");
        std::env::remove_var("STORAGE_PUBLIC_URL");

        let key = "uploads/test-user/photo.png";
        let payload = b"\x89PNG\r\n\x1a\nmock-image-bytes";
        mock_store_put(key, payload).expect("put");
        assert!(mock_store_exists(key));
        let got = mock_store_get(key).expect("get");
        assert_eq!(got, payload);

        // Finalize path requires object present
        assert!(mock_store_exists(key));
        std::env::remove_var("HEYVERA_MOCK_MEDIA_DIR");
    }

    #[test]
    fn mock_finalize_refuses_missing_object() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HEYVERA_MOCK_MEDIA_DIR", dir.path());
        std::env::remove_var("STORAGE_ENDPOINT");
        std::env::remove_var("STORAGE_BUCKET");

        let key = "uploads/missing/file.jpg";
        assert!(!mock_store_exists(key));
        std::env::remove_var("HEYVERA_MOCK_MEDIA_DIR");
    }

    #[test]
    fn mock_path_rejects_traversal() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HEYVERA_MOCK_MEDIA_DIR", dir.path());
        assert!(mock_store_put("../etc/passwd", b"x").is_err());
        std::env::remove_var("HEYVERA_MOCK_MEDIA_DIR");
    }

    /// Full mock media path: create media row → PUT body → finalize requires file → public URL points at GET route.
    #[test]
    fn mock_put_finalize_public_url_roundtrip() {
        let _guard = MOCK_TEST_LOCK.lock().unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("HEYVERA_MOCK_MEDIA_DIR", dir.path());
        std::env::remove_var("STORAGE_ENDPOINT");
        std::env::remove_var("STORAGE_BUCKET");
        std::env::remove_var("STORAGE_PUBLIC_URL");

        let db = crate::db::Database::open(&dir.path().join("media-test.sqlite"));
        let profile = db.social_create_profile("clerk_media", "mediauser", "Media User", "");
        let profile_id = profile["id"].as_str().unwrap();
        let media = db.social_create_media_object(
            profile_id,
            "shot.png",
            "image/png",
            12,
            "image",
        );
        let media_id = media["id"].as_str().unwrap();
        let storage_key = media["storageKey"].as_str().unwrap();

        let payload = b"hello-png-bytes";
        mock_store_put(storage_key, payload).expect("mock put");
        assert!(mock_store_exists(storage_key));

        // finalize requires object present (same gate as finalize_upload mock branch)
        assert!(
            mock_store_exists(storage_key),
            "finalize would succeed only after mock PUT"
        );
        let finalized = db.social_finalize_media_object(media_id);
        assert_eq!(finalized["status"], "ready");

        let got = mock_store_get(storage_key).expect("GET path reads same store");
        assert_eq!(got, payload);

        std::env::remove_var("HEYVERA_MOCK_MEDIA_DIR");
    }
}
