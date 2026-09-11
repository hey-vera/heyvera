//! Capability-authenticated Anthropic Messages surface for the private gateway.
//!
//! This increment is intentionally stub-only. A production supplier transport
//! does not exist here, so setting any mode other than the exact `stub` value
//! leaves the listener unavailable.

use std::future::Future;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::Value;

use crate::provider_gateway::{
    sign_capability, GatewayCapability, GatewayError, GatewayRequest, ObservedUsage,
    ProviderGateway, ProviderTransport, SignedCapability, TransportFailure, TransportResponse,
};
use crate::state::AppState;

const STUB_SUPPLIER_KEY: &str = "STUB-PROVIDER-NOT-A-REAL-KEY";
const GATEWAY_BASE_URL: &str = "https://cortex.heyvera.org/internal/provider";

pub(crate) fn issue_stub_access(
    db: &crate::db::Database,
    user_id: &str,
    run_id: &str,
    attempt_id: &str,
    provider: cortex_core::provider::ProviderId,
    model: &str,
    lease_deadline_ms: i64,
    now_ms: i64,
) -> Option<cortex_core::protocol::ProviderGatewayAccess> {
    if std::env::var("CORTEX_PROVIDER_GATEWAY_MODE").as_deref() != Ok("stub")
        || provider != cortex_core::provider::ProviderId::Claude
    {
        return None;
    }
    let signing_key = std::env::var("CORTEX_PROVIDER_GATEWAY_SIGNING_KEY").ok()?;
    if signing_key.len() < 32 {
        tracing::error!("gateway signing key must contain at least 32 bytes");
        return None;
    }
    let max_micro_usd = positive_env("CORTEX_PROVIDER_GATEWAY_MAX_MICRO_USD")?;
    let funded_micro_usd = positive_env("CORTEX_PROVIDER_GATEWAY_FUNDED_MICRO_USD")?;
    let price_list = db.active_price_list()?;
    if price_list.model("claude", model).is_none() {
        tracing::error!(model, "stub gateway has no immutable model rate");
        return None;
    }
    db.set_supplier_capacity("claude", funded_micro_usd, now_ms)
        .ok()?;
    let expires_at_ms = lease_deadline_ms;
    if expires_at_ms <= now_ms {
        return None;
    }
    let authorization_id = format!("gateway-auth:{attempt_id}");
    db.create_spend_authorization(
        &crate::db::SpendAuthorization {
            id: authorization_id.clone(),
            user_id: user_id.to_string(),
            run_id: run_id.to_string(),
            attempt_id: attempt_id.to_string(),
            provider: "claude".into(),
            model: model.to_string(),
            price_list_id: price_list.id,
            max_micro_usd,
            expires_at_ms,
        },
        now_ms,
    )
    .ok()?;
    let claims = GatewayCapability::new(
        authorization_id.clone(),
        user_id,
        run_id,
        attempt_id,
        model,
        expires_at_ms,
    );
    let signed = sign_capability(signing_key.as_bytes(), &claims).ok()?;
    Some(cortex_core::protocol::ProviderGatewayAccess {
        authorization_id,
        run_id: run_id.to_string(),
        attempt_id: attempt_id.to_string(),
        provider: "claude".into(),
        model: model.to_string(),
        base_url: GATEWAY_BASE_URL.into(),
        expires_at_ms,
        bearer: cortex_core::protocol::GatewayBearer::new(signed.expose()),
    })
}

fn positive_env(name: &str) -> Option<i64> {
    std::env::var(name)
        .ok()?
        .parse()
        .ok()
        .filter(|value| *value > 0)
}

#[derive(Clone, Copy)]
struct StubTransport;

impl ProviderTransport for StubTransport {
    fn forward(
        &self,
        _supplier_key: &str,
        request: &GatewayRequest,
    ) -> impl Future<Output = Result<TransportResponse, TransportFailure>> + Send {
        let model = request.model.clone();
        std::future::ready(Ok(TransportResponse {
            body: serde_json::json!({
                "id": "msg_cortex_stub",
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [{"type": "text", "text": "cortex gateway stub"}],
                "stop_reason": "end_turn",
                "stop_sequence": null,
                "usage": {"input_tokens": 1, "output_tokens": 1}
            }),
            upstream_request_id: Some("cortex-stub-upstream".into()),
            usage: Some(ObservedUsage {
                input_tokens: 1,
                cached_input_tokens: 0,
                output_tokens: 1,
            }),
        }))
    }
}

pub async fn messages(
    State(state): State<std::sync::Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    if std::env::var("CORTEX_PROVIDER_GATEWAY_MODE").as_deref() != Ok("stub") {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "provider gateway is disabled",
        )
            .into_response();
    }
    let Ok(signing_key) = std::env::var("CORTEX_PROVIDER_GATEWAY_SIGNING_KEY") else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "gateway signing key is absent",
        )
            .into_response();
    };
    if signing_key.len() < 32 {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "gateway signing key is invalid",
        )
            .into_response();
    }
    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "gateway database is absent",
        )
            .into_response();
    };
    handle_stub_message(
        db,
        signing_key.as_bytes(),
        &headers,
        body,
        chrono::Utc::now().timestamp_millis(),
    )
    .await
}

async fn handle_stub_message(
    db: &crate::db::Database,
    signing_key: &[u8],
    headers: &HeaderMap,
    body: Value,
    now_ms: i64,
) -> Response {
    let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
    else {
        return (StatusCode::UNAUTHORIZED, "missing gateway bearer").into_response();
    };
    let gateway = ProviderGateway::new(db, signing_key, STUB_SUPPLIER_KEY, StubTransport);
    let capability = SignedCapability::from_exposed(token);
    let claims = match gateway.verified_claims(&capability) {
        Ok(claims) => claims,
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid gateway bearer").into_response(),
    };
    let request_key = match headers
        .get("x-cortex-request-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
    {
        Some(explicit) => format!("claude:{}:{explicit}", claims.authorization_id),
        None => {
            let attempt = headers
                .get("x-cortex-attempt")
                .and_then(|value| value.to_str().ok());
            if attempt != Some(claims.attempt_id.as_str()) {
                return (StatusCode::BAD_REQUEST, "missing request identity").into_response();
            }
            use sha2::Digest as _;
            let encoded = serde_json::to_vec(&body).unwrap_or_default();
            format!(
                "claude:{}:sha256:{}",
                claims.authorization_id,
                hex::encode(sha2::Sha256::digest(encoded))
            )
        }
    };
    let Some(max_output_tokens) = body.get("max_tokens").and_then(Value::as_i64) else {
        return (StatusCode::BAD_REQUEST, "missing bounded max_tokens").into_response();
    };
    let request = GatewayRequest {
        request_key,
        tenant_id: claims.tenant_id,
        run_id: claims.run_id,
        attempt_id: claims.attempt_id,
        model: claims.model,
        max_output_tokens,
        body,
        capability,
    };
    match gateway.forward(request, now_ms).await {
        Ok(outcome) => match outcome.body {
            Some(body) => Json(body).into_response(),
            None => (
                StatusCode::CONFLICT,
                "request already has a durable outcome",
            )
                .into_response(),
        },
        Err(error) => gateway_error_response(error),
    }
}

fn gateway_error_response(error: GatewayError) -> Response {
    let status = match error {
        GatewayError::InvalidCapability | GatewayError::ExpiredCapability => {
            StatusCode::UNAUTHORIZED
        }
        GatewayError::UnsupportedProvider
        | GatewayError::ScopeMismatch
        | GatewayError::UnboundedRequest(_)
        | GatewayError::MissingRate => StatusCode::BAD_REQUEST,
        GatewayError::Reservation(_) => StatusCode::CONFLICT,
        GatewayError::CostOverflow
        | GatewayError::Transport(_)
        | GatewayError::CredentialExposure
        | GatewayError::Reconciliation(_) => StatusCode::BAD_GATEWAY,
    };
    (status, error.to_string()).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::SpendAuthorization;

    const NOW: i64 = 1_800_000_000_000;
    const MODEL: &str = "claude-sonnet-4-6";
    const SIGNING_KEY: &[u8] = b"stub-http-signing-key-with-32-bytes";

    struct Fixture {
        _dir: tempfile::TempDir,
        db: crate::db::Database,
        token: SignedCapability,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let db = crate::db::Database::open(&dir.path().join("gateway-http.sqlite"));
            let price_list_id = db.active_price_list().unwrap().id;
            db.set_supplier_capacity("claude", 100_000, NOW).unwrap();
            db.create_spend_authorization(
                &SpendAuthorization {
                    id: "auth-http".into(),
                    user_id: "tenant-http".into(),
                    run_id: "run-http".into(),
                    attempt_id: "attempt-http".into(),
                    provider: "claude".into(),
                    model: MODEL.into(),
                    price_list_id,
                    max_micro_usd: 100_000,
                    expires_at_ms: NOW + 60_000,
                },
                NOW,
            )
            .unwrap();
            let token = sign_capability(
                SIGNING_KEY,
                &GatewayCapability::new(
                    "auth-http",
                    "tenant-http",
                    "run-http",
                    "attempt-http",
                    MODEL,
                    NOW + 60_000,
                ),
            )
            .unwrap();
            Self {
                _dir: dir,
                db,
                token,
            }
        }

        fn headers(&self, request_key: &str) -> HeaderMap {
            let mut headers = HeaderMap::new();
            headers.insert(
                axum::http::header::AUTHORIZATION,
                format!("Bearer {}", self.token.expose()).parse().unwrap(),
            );
            headers.insert("x-cortex-request-key", request_key.parse().unwrap());
            headers
        }
    }

    #[tokio::test]
    async fn stub_listener_authenticates_reserves_and_settles() {
        let fixture = Fixture::new();
        let response = handle_stub_message(
            &fixture.db,
            SIGNING_KEY,
            &fixture.headers("http-request-1"),
            serde_json::json!({
                "model": MODEL,
                "max_tokens": 100,
                "messages": [{"role": "user", "content": "stub only"}]
            }),
            NOW,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let reservation = fixture
            .db
            .get_provider_reservation("claude:auth-http:http-request-1")
            .unwrap();
        assert_eq!(reservation.status, "settled");
        assert_eq!(
            fixture
                .db
                .provider_spend_row_count("claude:auth-http:http-request-1"),
            1
        );
    }

    #[tokio::test]
    async fn listener_rejects_missing_auth_and_idempotency_before_reserving() {
        let fixture = Fixture::new();
        let body = serde_json::json!({"model": MODEL, "max_tokens": 100, "messages": []});
        let unauthenticated = handle_stub_message(
            &fixture.db,
            SIGNING_KEY,
            &HeaderMap::new(),
            body.clone(),
            NOW,
        )
        .await;
        assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

        let mut no_key = fixture.headers("temporary");
        no_key.remove("x-cortex-request-key");
        let no_key = handle_stub_message(&fixture.db, SIGNING_KEY, &no_key, body, NOW).await;
        assert_eq!(no_key.status(), StatusCode::BAD_REQUEST);
        assert!(fixture
            .db
            .get_provider_reservation("claude:auth-http:http-request-1")
            .is_none());
    }
}
