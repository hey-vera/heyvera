//! x402 agent micropayments scaffold (Wave 8g).
//!
//! Honest status + verify stubs only. No payment settlement, facilitators, or wallet keys.
//! Enable shape-only verify with `X402_ENABLED=1`. Default remains disabled.

use axum::{
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Public status payload for GET /v1/social/x402/status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct X402Status {
    pub enabled: bool,
    pub network: String,
    pub note: String,
}

/// Build the status response from an explicit enabled flag (pure — easy to unit test).
pub fn build_status_response(enabled: bool) -> X402Status {
    X402Status {
        enabled,
        network: "placeholder".to_string(),
        note: "agent micropayments scaffold".to_string(),
    }
}

/// True only when env `X402_ENABLED` is exactly `"1"`.
pub fn is_x402_enabled() -> bool {
    std::env::var("X402_ENABLED")
        .map(|v| v == "1")
        .unwrap_or(false)
}

/// GET /v1/social/x402/status
pub async fn get_status() -> impl IntoResponse {
    Json(build_status_response(is_x402_enabled()))
}

/// Minimal body accepted when X402 is enabled (shape-only).
#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    /// Opaque payment / x402 payload object.
    #[serde(default)]
    pub payload: Option<Value>,
    /// Alternate payment field name some clients may send.
    #[serde(default)]
    pub payment: Option<Value>,
    /// Optional amount string (not settled).
    #[serde(default)]
    pub amount: Option<String>,
    /// Optional network id (ignored; status network is placeholder).
    #[serde(default)]
    pub network: Option<String>,
}

/// Result of shape-only validation (pure).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyShapeResult {
    /// Request has at least one recognized payment field with non-empty content.
    Ok,
    /// Missing or empty payment fields.
    InvalidShape,
}

/// Validate request shape only — no cryptographic or on-chain checks.
pub fn validate_verify_shape(req: &VerifyRequest) -> VerifyShapeResult {
    let has_payload = req
        .payload
        .as_ref()
        .map(|v| !v.is_null() && v != &Value::Null && !is_empty_value(v))
        .unwrap_or(false);
    let has_payment = req
        .payment
        .as_ref()
        .map(|v| !v.is_null() && !is_empty_value(v))
        .unwrap_or(false);
    let has_amount = req
        .amount
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    if has_payload || has_payment || has_amount {
        VerifyShapeResult::Ok
    } else {
        VerifyShapeResult::InvalidShape
    }
}

fn is_empty_value(v: &Value) -> bool {
    match v {
        Value::Object(m) => m.is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::String(s) => s.trim().is_empty(),
        Value::Null => true,
        _ => false,
    }
}

/// POST /v1/social/x402/verify
///
/// When disabled: 501 + `{ ok: false, reason: "not configured" }`.
/// When enabled: shape-only validation; never settles payments.
pub async fn verify(Json(req): Json<VerifyRequest>) -> impl IntoResponse {
    if !is_x402_enabled() {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({
                "ok": false,
                "reason": "not configured"
            })),
        );
    }

    match validate_verify_shape(&req) {
        VerifyShapeResult::Ok => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "verified": false,
                "note": "shape-only scaffold; no payment settlement"
            })),
        ),
        VerifyShapeResult::InvalidShape => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "reason": "invalid shape",
                "note": "provide payload, payment, or amount for shape-only validation"
            })),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn status_disabled_by_default_builder() {
        let status = build_status_response(false);
        assert_eq!(status.enabled, false);
        assert_eq!(status.network, "placeholder");
        assert_eq!(status.note, "agent micropayments scaffold");
    }

    #[test]
    fn status_enabled_builder() {
        let status = build_status_response(true);
        assert!(status.enabled);
        assert_eq!(status.network, "placeholder");
        assert_eq!(status.note, "agent micropayments scaffold");
    }

    #[test]
    fn status_serializes_expected_keys() {
        let status = build_status_response(false);
        let v = serde_json::to_value(&status).unwrap();
        assert_eq!(v["enabled"], false);
        assert_eq!(v["network"], "placeholder");
        assert_eq!(v["note"], "agent micropayments scaffold");
    }

    #[test]
    fn verify_shape_rejects_empty() {
        let req = VerifyRequest {
            payload: None,
            payment: None,
            amount: None,
            network: None,
        };
        assert_eq!(validate_verify_shape(&req), VerifyShapeResult::InvalidShape);
    }

    #[test]
    fn verify_shape_accepts_payload_object() {
        let req = VerifyRequest {
            payload: Some(json!({ "x402": "v1", "token": "stub" })),
            payment: None,
            amount: None,
            network: None,
        };
        assert_eq!(validate_verify_shape(&req), VerifyShapeResult::Ok);
    }

    #[test]
    fn verify_shape_accepts_amount() {
        let req = VerifyRequest {
            payload: None,
            payment: None,
            amount: Some("0.01".into()),
            network: Some("placeholder".into()),
        };
        assert_eq!(validate_verify_shape(&req), VerifyShapeResult::Ok);
    }

    #[test]
    fn verify_shape_rejects_empty_objects() {
        let req = VerifyRequest {
            payload: Some(json!({})),
            payment: Some(json!([])),
            amount: Some("  ".into()),
            network: None,
        };
        assert_eq!(validate_verify_shape(&req), VerifyShapeResult::InvalidShape);
    }
}
