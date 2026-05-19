use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::extract::State;
use axum::http::{HeaderValue, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64, // tokens per second
    last_refill: Instant,
}

impl TokenBucket {
    fn new(max_tokens: f64, refill_rate: f64) -> Self {
        Self {
            tokens: max_tokens,
            max_tokens,
            refill_rate,
            last_refill: Instant::now(),
        }
    }

    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.max_tokens);
        self.last_refill = now;
    }

    /// Try to consume one token. Returns true if allowed.
    fn try_consume(&mut self) -> bool {
        self.refill();
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Seconds until the next token is available.
    fn retry_after(&self) -> f64 {
        if self.tokens >= 1.0 {
            return 0.0;
        }
        (1.0 - self.tokens) / self.refill_rate
    }
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<String, TokenBucket>>,
    max_tokens: f64,
    refill_rate: f64,
}

impl RateLimiter {
    /// Create a rate limiter with the given per-user limits.
    /// `max_requests` is the burst capacity, `per_seconds` is the refill window.
    pub fn new(max_requests: u32, per_seconds: u64) -> Self {
        let max_tokens = max_requests as f64;
        let refill_rate = max_tokens / per_seconds as f64;
        Self {
            buckets: Mutex::new(HashMap::new()),
            max_tokens,
            refill_rate,
        }
    }

    /// Default: 60 requests per 60 seconds (1 req/sec sustained, 60 burst).
    pub fn default_per_user() -> Self {
        Self::new(60, 60)
    }

    /// Check if a request from `key` is allowed. Returns Ok(()) or Err(retry_after_secs).
    pub fn check(&self, key: &str) -> Result<(), f64> {
        let mut buckets = self.buckets.lock().unwrap();
        let bucket = buckets
            .entry(key.to_string())
            .or_insert_with(|| TokenBucket::new(self.max_tokens, self.refill_rate));

        if bucket.try_consume() {
            Ok(())
        } else {
            Err(bucket.retry_after())
        }
    }

    /// Remove buckets that haven't been accessed in over 10 minutes.
    pub fn cleanup(&self) {
        let mut buckets = self.buckets.lock().unwrap();
        let cutoff = Instant::now() - std::time::Duration::from_secs(600);
        buckets.retain(|_, bucket| bucket.last_refill > cutoff);
    }
}

/// Extract user identity from the Authorization header for rate limiting.
/// Parses the JWT subject claim without full verification (rate limiting runs
/// before auth, so we just need a consistent key). Falls back to "anonymous".
fn extract_user_key(req: &Request<axum::body::Body>) -> String {
    req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .and_then(|token| {
            // JWT is header.payload.signature — decode the payload for `sub`
            let parts: Vec<&str> = token.splitn(3, '.').collect();
            if parts.len() < 2 {
                return None;
            }
            // base64url decode the payload
            let payload = base64url_decode(parts[1])?;
            let value: serde_json::Value = serde_json::from_slice(&payload).ok()?;
            value.get("sub").and_then(|s| s.as_str()).map(String::from)
        })
        .unwrap_or_else(|| "anonymous".to_string())
}

/// Minimal base64url decode (no padding required).
fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    // Replace URL-safe chars with standard base64 chars
    let mut s = input.replace('-', "+").replace('_', "/");
    // Add padding
    match s.len() % 4 {
        2 => s.push_str("=="),
        3 => s.push('='),
        0 => {}
        _ => return None,
    }
    // Use a simple decode — we only need this for JWT payload extraction
    general_base64_decode(&s)
}

fn general_base64_decode(input: &str) -> Option<Vec<u8>> {
    static TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let bytes = input.as_bytes();
    if bytes.len() % 4 != 0 {
        return None;
    }

    let mut output = Vec::with_capacity(bytes.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        let mut pad = 0;
        for (i, &b) in chunk.iter().enumerate() {
            if b == b'=' {
                buf[i] = 0;
                pad += 1;
            } else if let Some(pos) = TABLE.iter().position(|&c| c == b) {
                buf[i] = pos as u8;
            } else {
                return None;
            }
        }

        output.push((buf[0] << 2) | (buf[1] >> 4));
        if pad < 2 {
            output.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if pad < 1 {
            output.push((buf[2] << 6) | buf[3]);
        }
    }

    Some(output)
}

/// Axum middleware function for per-user rate limiting.
pub async fn rate_limit_middleware(
    State(state): State<Arc<AppState>>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let user_key = extract_user_key(&req);

    match state.rate_limiter.check(&user_key) {
        Ok(()) => next.run(req).await,
        Err(retry_after) => {
            let retry_secs = retry_after.ceil() as u64;
            let mut response = (
                StatusCode::TOO_MANY_REQUESTS,
                format!("rate limit exceeded — retry after {retry_secs}s"),
            )
                .into_response();
            response.headers_mut().insert(
                "retry-after",
                HeaderValue::from_str(&retry_secs.to_string()).unwrap(),
            );
            response
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allows_within_limit() {
        let limiter = RateLimiter::new(5, 60);
        for _ in 0..5 {
            assert!(limiter.check("user1").is_ok());
        }
        assert!(limiter.check("user1").is_err());
    }

    #[test]
    fn test_separate_users() {
        let limiter = RateLimiter::new(2, 60);
        assert!(limiter.check("user1").is_ok());
        assert!(limiter.check("user1").is_ok());
        assert!(limiter.check("user1").is_err());
        // user2 should still have tokens
        assert!(limiter.check("user2").is_ok());
    }

    #[test]
    fn test_cleanup_preserves_recent() {
        let limiter = RateLimiter::new(10, 60);
        limiter.check("user1").ok();
        limiter.cleanup();
        // recent bucket should survive cleanup
        assert!(limiter.check("user1").is_ok());
    }

    #[test]
    fn test_base64url_decode() {
        // "hello" in base64url
        let encoded = "aGVsbG8";
        let decoded = base64url_decode(encoded).unwrap();
        assert_eq!(decoded, b"hello");
    }
}
