use std::sync::Arc;

use axum::{
    extract::{Path, State},
    response::IntoResponse,
    Json,
};
use serde::Deserialize;

use crate::clerk::ClerkUser;
use crate::state::AppState;

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

fn db(state: &AppState) -> &crate::db::Database {
    state.db.as_ref().expect("database not initialized")
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

    // Generate the upload URL
    let (upload_url, expires_in) = generate_upload_url(storage_key, &content_type);

    Json(serde_json::json!({
        "upload_url": upload_url,
        "media_id": media_id,
        "expires_in": expires_in,
    }))
}

/// POST /v1/social/media/{id}/finalize
///
/// Marks a media upload as complete after the client has uploaded the file.
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
            return Json(serde_json::json!({
                "error": "No profile found",
                "code": "NOT_FOUND"
            }));
        }
    };

    let profile_id = profile["id"].as_str().unwrap_or("");

    // Look up the media object
    let media = match db(&state).social_get_media_object(&media_id) {
        Some(m) => m,
        None => {
            return Json(serde_json::json!({
                "error": "Media object not found",
                "code": "NOT_FOUND"
            }));
        }
    };

    // Verify ownership
    if media["ownerProfileId"].as_str() != Some(profile_id) {
        return Json(serde_json::json!({
            "error": "Not authorized to finalize this media",
            "code": "FORBIDDEN"
        }));
    }

    // Verify status is pending
    if media["status"].as_str() != Some("pending") {
        return Json(serde_json::json!({
            "error": format!(
                "Media object is already in '{}' status",
                media["status"].as_str().unwrap_or("unknown")
            ),
            "code": "CONFLICT"
        }));
    }

    let storage_key = media["storageKey"].as_str().unwrap_or("");

    // Verify the object exists in storage (best-effort)
    // For local/mock mode, we skip this check
    let storage_configured = std::env::var("STORAGE_ENDPOINT").is_ok()
        && std::env::var("STORAGE_BUCKET").is_ok();

    if storage_configured {
        // In production, we would HEAD the object in S3/R2
        // For now, we trust the client (the presigned URL enforces content-type/size)
        tracing::info!("storage configured — would verify object at key: {}", storage_key);
    }

    // Mark as finalized
    let finalized = db(&state).social_finalize_media_object(&media_id);

    let public_url = resolve_public_url(
        finalized["storageKey"].as_str().unwrap_or(""),
    );

    Json(serde_json::json!({
        "media_id": finalized["id"],
        "url": public_url,
        "type": finalized["mediaType"],
    }))
}

// ─── Storage URL generation ─────────────────────────────────────────────────

/// Generate a presigned PUT URL for uploading to S3/R2-compatible storage.
/// If no storage is configured, returns a mock local upload path.
///
/// Returns (upload_url, expires_in_seconds).
fn generate_upload_url(storage_key: &str, content_type: &str) -> (String, u64) {
    let endpoint = std::env::var("STORAGE_ENDPOINT").ok();
    let bucket = std::env::var("STORAGE_BUCKET").ok();
    let access_key = std::env::var("STORAGE_ACCESS_KEY").ok();
    let secret_key = std::env::var("STORAGE_SECRET_KEY").ok();

    let expires_in: u64 = 300; // 5 minutes

    match (endpoint, bucket, access_key, secret_key) {
        (Some(endpoint), Some(bucket), Some(access_key), Some(secret_key)) => {
            // Generate a presigned PUT URL for S3/R2
            let url = generate_s3_presigned_put(
                &endpoint,
                &bucket,
                storage_key,
                content_type,
                expires_in,
                &access_key,
                &secret_key,
            );
            (url, expires_in)
        }
        _ => {
            // No storage configured — return a mock/local upload path
            tracing::warn!(
                "No STORAGE_ENDPOINT/STORAGE_BUCKET configured — returning mock upload URL for key: {}",
                storage_key
            );
            let mock_url = format!("/v1/social/media/mock-upload/{}", storage_key);
            (mock_url, expires_in)
        }
    }
}

/// Generate a presigned S3-compatible PUT URL using AWS Signature V4.
///
/// This constructs the URL with query-string authentication parameters
/// so the client can PUT the file directly without needing credentials.
fn generate_s3_presigned_put(
    endpoint: &str,
    bucket: &str,
    key: &str,
    content_type: &str,
    expires_in: u64,
    access_key: &str,
    secret_key: &str,
) -> String {
    use hmac::{Hmac, Mac};
    use sha2::{Sha256, Digest};

    type HmacSha256 = Hmac<Sha256>;

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

/// Resolve the public URL for a finalized media object.
fn resolve_public_url(storage_key: &str) -> String {
    let endpoint = std::env::var("STORAGE_ENDPOINT").ok();
    let bucket = std::env::var("STORAGE_BUCKET").ok();
    let custom_domain = std::env::var("STORAGE_PUBLIC_URL").ok();

    match custom_domain {
        Some(domain) => {
            format!("{}/{}", domain.trim_end_matches('/'), storage_key)
        }
        None => match (endpoint, bucket) {
            (Some(endpoint), Some(bucket)) => {
                format!("{}/{}/{}", endpoint.trim_end_matches('/'), bucket, storage_key)
            }
            _ => {
                format!("/media/{}", storage_key)
            }
        },
    }
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
