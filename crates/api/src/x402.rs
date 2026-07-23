//! x402 agent micropayments — Social product production path (Wave 14m/n/o).
//!
//! # Env contract (never log private keys)
//!
//! | Variable | Required | Purpose |
//! |----------|----------|---------|
//! | `X402_ENABLED` | no (default off) | Exactly `"1"` enables verify path; anything else = disabled |
//! | `X402_NETWORK` | no | e.g. `base-sepolia` / `base` (default `base-sepolia` when enabled) |
//! | `X402_FACILITATOR_URL` | no | HTTP facilitator base URL; when set → mode `facilitator` |
//! | `X402_PAY_TO` | no | Public recipient address returned on status (never a private key) |
//!
//! **Do not** put private keys / wallet secrets in these vars. This module never
//! reads, logs, or stores private keys.
//!
//! # Modes
//!
//! - `disabled` — `X402_ENABLED` ≠ `"1"`; verify / paid-ping return 501
//! - `shape_only` — enabled, no facilitator URL; shape validation + receipt `pending`
//! - `facilitator` — enabled + `X402_FACILITATOR_URL`; POST verify to facilitator HTTP API
//!
//! # Product gate (Wave 14o)
//!
//! `POST /v1/social/x402/paid-ping` — authenticated Social surface that requires
//! payment proof when mode is not disabled. Fail-closed in facilitator mode.
//!
//! Receipts: table `social_x402_receipts` (idempotent by `idempotency_key`).

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::clerk::ClerkUser;
use crate::db::Database;
use crate::state::AppState;

// ─── Config ──────────────────────────────────────────────────────────────────

/// Operating mode derived from env (honest; no fake settlement claims).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum X402Mode {
    Disabled,
    ShapeOnly,
    Facilitator,
}

impl X402Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::ShapeOnly => "shape_only",
            Self::Facilitator => "facilitator",
        }
    }
}

/// Parsed x402 configuration from environment (pure given explicit inputs).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct X402Config {
    pub enabled: bool,
    pub network: String,
    pub facilitator_url: Option<String>,
    pub pay_to: Option<String>,
    pub mode: X402Mode,
}

impl X402Config {
    /// Pure parser for unit tests — does not read process env.
    pub fn from_parts(
        enabled_raw: Option<&str>,
        network: Option<&str>,
        facilitator_url: Option<&str>,
        pay_to: Option<&str>,
    ) -> Self {
        let enabled = enabled_raw == Some("1");
        let facilitator = facilitator_url
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.trim_end_matches('/').to_string());
        let pay_to = pay_to
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let network = network
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if enabled {
                    "base-sepolia".to_string()
                } else {
                    "placeholder".to_string()
                }
            });

        let mode = if !enabled {
            X402Mode::Disabled
        } else if facilitator.is_some() {
            X402Mode::Facilitator
        } else {
            X402Mode::ShapeOnly
        };

        Self {
            enabled,
            network,
            facilitator_url: facilitator,
            pay_to,
            mode,
        }
    }

    /// Load from process environment.
    ///
    /// Reads only: `X402_ENABLED`, `X402_NETWORK`, `X402_FACILITATOR_URL`, `X402_PAY_TO`.
    /// Never reads or logs private keys.
    pub fn from_env() -> Self {
        Self::from_parts(
            std::env::var("X402_ENABLED").ok().as_deref(),
            std::env::var("X402_NETWORK").ok().as_deref(),
            std::env::var("X402_FACILITATOR_URL").ok().as_deref(),
            std::env::var("X402_PAY_TO").ok().as_deref(),
        )
    }

    pub fn honesty_note(&self) -> &'static str {
        match self.mode {
            X402Mode::Disabled => {
                "x402 disabled (set X402_ENABLED=1 to enable). No settlement."
            }
            X402Mode::ShapeOnly => {
                "x402 shape_only: payload shape validated and receipt stored as pending; no facilitator settlement."
            }
            X402Mode::Facilitator => {
                "x402 facilitator mode: verify POSTs to X402_FACILITATOR_URL; receipt status reflects facilitator response. Private keys are never handled by this API."
            }
        }
    }
}

/// True only when env `X402_ENABLED` is exactly `"1"`.
pub fn is_x402_enabled() -> bool {
    X402Config::from_env().enabled
}

// ─── Status ──────────────────────────────────────────────────────────────────

/// Public status payload for GET /v1/social/x402/status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct X402Status {
    pub enabled: bool,
    pub network: String,
    /// `disabled` | `shape_only` | `facilitator`
    pub mode: String,
    /// Public recipient address when configured (never a private key).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pay_to: Option<String>,
    pub note: String,
}

/// Build status from config (pure).
pub fn build_status_from_config(cfg: &X402Config) -> X402Status {
    X402Status {
        enabled: cfg.enabled,
        network: cfg.network.clone(),
        mode: cfg.mode.as_str().to_string(),
        pay_to: cfg.pay_to.clone(),
        note: cfg.honesty_note().to_string(),
    }
}

/// Back-compat helper used by older tests — maps enabled flag only.
pub fn build_status_response(enabled: bool) -> X402Status {
    let cfg = X402Config::from_parts(
        if enabled { Some("1") } else { None },
        None,
        None,
        None,
    );
    build_status_from_config(&cfg)
}

/// GET /v1/social/x402/status
pub async fn get_status() -> impl IntoResponse {
    let cfg = X402Config::from_env();
    Json(build_status_from_config(&cfg))
}

// ─── Verify request / shape ──────────────────────────────────────────────────

/// Minimal body accepted when X402 is enabled.
#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    /// Opaque payment / x402 payload object.
    #[serde(default)]
    pub payload: Option<Value>,
    /// Alternate payment field name some clients may send.
    #[serde(default)]
    pub payment: Option<Value>,
    /// Optional amount string.
    #[serde(default)]
    pub amount: Option<String>,
    /// Optional network id (falls back to config network).
    #[serde(default)]
    pub network: Option<String>,
    /// Client idempotency key (also accepted via `Idempotency-Key` header).
    #[serde(default)]
    pub idempotency_key: Option<String>,
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
        .map(|v| !v.is_null() && !is_empty_value(v))
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

/// SHA-256 hex of a stable representation of the payment payload for receipt dedupe/audit.
pub fn payload_hash(req: &VerifyRequest) -> String {
    let material = json!({
        "payload": req.payload,
        "payment": req.payment,
        "amount": req.amount,
        "network": req.network,
    });
    let bytes = serde_json::to_vec(&material).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hex::encode(hasher.finalize())
}

/// Resolve idempotency key: body field, then header, then hash-derived key.
pub fn resolve_idempotency_key(req: &VerifyRequest, headers: &HeaderMap) -> String {
    if let Some(k) = req
        .idempotency_key
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return k.to_string();
    }
    if let Some(v) = headers.get("idempotency-key").and_then(|v| v.to_str().ok()) {
        let t = v.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    // Stable derived key so identical payloads without client key still dedupe.
    format!("auto:{}", payload_hash(req))
}

// ─── Receipt status helpers (pure) ───────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiptStatus {
    Pending,
    Verified,
    Failed,
}

impl ReceiptStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Verified => "verified",
            Self::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "verified" => Some(Self::Verified),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// Map a facilitator JSON body to verified/failed (pure, testable).
///
/// Accepts common shapes:
/// - `{ "isValid": true }` / `{ "valid": true }` / `{ "verified": true }`
/// - `{ "ok": true, "verified": true }`
/// - HTTP-level success alone is not enough if body explicitly says invalid.
pub fn map_facilitator_body(body: &Value, http_success: bool) -> (bool, ReceiptStatus) {
    if !http_success {
        return (false, ReceiptStatus::Failed);
    }
    let explicit_false = body
        .get("isValid")
        .or_else(|| body.get("valid"))
        .or_else(|| body.get("verified"))
        .and_then(|v| v.as_bool())
        == Some(false);
    if explicit_false {
        return (false, ReceiptStatus::Failed);
    }
    let explicit_true = body.get("isValid").and_then(|v| v.as_bool()) == Some(true)
        || body.get("valid").and_then(|v| v.as_bool()) == Some(true)
        || body.get("verified").and_then(|v| v.as_bool()) == Some(true);
    if explicit_true {
        return (true, ReceiptStatus::Verified);
    }
    // 2xx with no explicit validity flag: treat as failed (honest — do not invent success).
    (false, ReceiptStatus::Failed)
}

/// Build facilitator verify URL from base (pure).
///
/// - If base already ends with `/verify`, use as-is.
/// - Otherwise append `/verify`.
pub fn facilitator_verify_url(base: &str) -> String {
    let base = base.trim_end_matches('/');
    if base.ends_with("/verify") {
        base.to_string()
    } else {
        format!("{base}/verify")
    }
}

/// Build the JSON body we POST to the facilitator (pure).
pub fn build_facilitator_request_body(req: &VerifyRequest) -> Value {
    // Prefer structured payload/payment; include amount/network when present.
    let mut body = json!({});
    if let Some(p) = &req.payload {
        if let Some(obj) = p.as_object() {
            for (k, v) in obj {
                body[k] = v.clone();
            }
        } else {
            body["payload"] = p.clone();
        }
    }
    if let Some(p) = &req.payment {
        body["payment"] = p.clone();
    }
    if let Some(a) = &req.amount {
        body["amount"] = json!(a);
    }
    if let Some(n) = &req.network {
        body["network"] = json!(n);
    }
    body
}

// ─── Stored receipt → HTTP response ──────────────────────────────────────────

fn receipt_to_response(row: &Value) -> (StatusCode, Json<Value>) {
    let status = row["status"].as_str().unwrap_or("pending");
    let verified = status == "verified";
    let mode = row
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("shape_only");
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "verified": verified,
            "mode": mode,
            "status": status,
            "receiptId": row.get("id"),
            "idempotencyKey": row.get("idempotencyKey"),
            "network": row.get("network"),
            "amount": row.get("amount"),
            "note": row.get("note").cloned().unwrap_or(json!(
                "idempotent replay of stored receipt"
            )),
            "replay": true,
        })),
    )
}

// ─── Product gate (Wave 14o) — pure logic ────────────────────────────────────

/// Payment proof state after shape check / facilitator verify (pure input).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaidPaymentState {
    /// No usable payment fields on the request.
    Missing,
    /// Shape looks valid; facilitator not consulted (shape_only path).
    ShapeOk,
    /// Facilitator explicitly verified the payment.
    FacilitatorOk,
    /// Facilitator rejected or failed to verify (fail closed).
    FacilitatorFailed,
}

/// Outcome of evaluating the Social paid product gate (pure).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaidGateOutcome {
    /// X402 disabled — payments off.
    PaymentsOff,
    /// Payment proof missing or incomplete for the active mode.
    PaymentRequired,
    /// shape_only: accept action; not settled.
    AllowShapeOnly,
    /// facilitator: verified payment; settled.
    AllowFacilitatorVerified,
    /// facilitator: verify failed — deny action (fail closed).
    FacilitatorRejected,
}

impl PaidGateOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PaymentsOff => "payments_off",
            Self::PaymentRequired => "payment_required",
            Self::AllowShapeOnly => "allow_shape_only",
            Self::AllowFacilitatorVerified => "allow_facilitator_verified",
            Self::FacilitatorRejected => "facilitator_rejected",
        }
    }

    /// True when the gated product action may proceed.
    pub fn allows_action(self) -> bool {
        matches!(
            self,
            Self::AllowShapeOnly | Self::AllowFacilitatorVerified
        )
    }

    /// True only when facilitator settled the payment.
    pub fn settled(self) -> bool {
        matches!(self, Self::AllowFacilitatorVerified)
    }
}

/// Pure fail-closed product gate evaluator.
///
/// | mode         | Missing | ShapeOk | FacilitatorOk | FacilitatorFailed |
/// |--------------|---------|---------|---------------|-------------------|
/// | disabled     | Off     | Off     | Off           | Off               |
/// | shape_only   | Required| Allow   | Allow*        | Allow*            |
/// | facilitator  | Required| Required† | Allow       | Reject            |
///
/// \* shape_only never claims settlement even if a facilitator flag is present.
/// † Shape alone is not enough in facilitator mode — must verify.
pub fn evaluate_paid_gate(mode: X402Mode, payment: PaidPaymentState) -> PaidGateOutcome {
    match mode {
        X402Mode::Disabled => PaidGateOutcome::PaymentsOff,
        X402Mode::ShapeOnly => match payment {
            PaidPaymentState::Missing => PaidGateOutcome::PaymentRequired,
            PaidPaymentState::ShapeOk
            | PaidPaymentState::FacilitatorOk
            | PaidPaymentState::FacilitatorFailed => PaidGateOutcome::AllowShapeOnly,
        },
        X402Mode::Facilitator => match payment {
            PaidPaymentState::Missing | PaidPaymentState::ShapeOk => {
                PaidGateOutcome::PaymentRequired
            }
            PaidPaymentState::FacilitatorOk => PaidGateOutcome::AllowFacilitatorVerified,
            PaidPaymentState::FacilitatorFailed => PaidGateOutcome::FacilitatorRejected,
        },
    }
}

/// HTTP status for a gate outcome (pure mapping).
pub fn paid_gate_http_status(outcome: PaidGateOutcome) -> StatusCode {
    match outcome {
        PaidGateOutcome::PaymentsOff => StatusCode::NOT_IMPLEMENTED,
        PaidGateOutcome::PaymentRequired | PaidGateOutcome::FacilitatorRejected => {
            StatusCode::PAYMENT_REQUIRED
        }
        PaidGateOutcome::AllowShapeOnly | PaidGateOutcome::AllowFacilitatorVerified => {
            StatusCode::OK
        }
    }
}

/// Build a stable product-gate idempotency key (pure).
///
/// Prefixes client keys with `paid-ping:` so verify receipts and product-gate
/// receipts do not silently collide when clients reuse the same client key.
pub fn paid_ping_idempotency_key(base: &str) -> String {
    let t = base.trim();
    if t.is_empty() {
        return "paid-ping:auto".to_string();
    }
    if t.starts_with("paid-ping:") {
        t.to_string()
    } else {
        format!("paid-ping:{t}")
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/// POST /v1/social/x402/verify
///
/// - disabled → 501 `{ ok: false, reason: "not configured" }`
/// - shape_only → shape check, store receipt `pending`, `verified: false`
/// - facilitator → POST facilitator, store receipt, return honest `verified`
/// - same idempotency key → return stored result
pub async fn verify(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<VerifyRequest>,
) -> impl IntoResponse {
    let cfg = X402Config::from_env();

    if cfg.mode == X402Mode::Disabled {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({
                "ok": false,
                "reason": "not configured",
                "mode": "disabled"
            })),
        )
            .into_response();
    }

    if validate_verify_shape(&req) == VerifyShapeResult::InvalidShape {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "reason": "invalid shape",
                "mode": cfg.mode.as_str(),
                "note": "provide payload, payment, or amount for validation"
            })),
        )
            .into_response();
    }

    let idem = resolve_idempotency_key(&req, &headers);
    let hash = payload_hash(&req);
    let network = req
        .network
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(cfg.network.as_str())
        .to_string();
    let amount = req.amount.clone();

    // Idempotent replay
    if let Some(db) = state.db.as_ref() {
        if let Some(existing) = db.social_x402_get_receipt_by_idempotency(&idem) {
            return receipt_to_response(&existing).into_response();
        }
    }

    match cfg.mode {
        X402Mode::Disabled => unreachable!("handled above"),
        X402Mode::ShapeOnly => {
            let note = "shape_only: receipt stored as pending; no facilitator settlement";
            let receipt = store_receipt(
                state.db.as_ref(),
                &idem,
                &hash,
                amount.as_deref(),
                &network,
                ReceiptStatus::Pending,
                None,
                X402Mode::ShapeOnly,
                note,
            );
            (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "verified": false,
                    "mode": "shape_only",
                    "status": "pending",
                    "receiptId": receipt.as_ref().and_then(|r| r.get("id").cloned()),
                    "idempotencyKey": idem,
                    "network": network,
                    "amount": amount,
                    "note": note,
                })),
            )
                .into_response()
        }
        X402Mode::Facilitator => {
            let base = cfg
                .facilitator_url
                .as_deref()
                .expect("facilitator mode requires URL");
            let url = facilitator_verify_url(base);
            let body = build_facilitator_request_body(&req);

            let (verified, status, raw) = call_facilitator_verify(&url, &body).await;
            let note = if verified {
                "facilitator verified payment"
            } else {
                "facilitator did not verify payment"
            };
            let raw_str = serde_json::to_string(&raw).ok();
            let receipt = store_receipt(
                state.db.as_ref(),
                &idem,
                &hash,
                amount.as_deref(),
                &network,
                status,
                raw_str.as_deref(),
                X402Mode::Facilitator,
                note,
            );
            (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "verified": verified,
                    "mode": "facilitator",
                    "status": status.as_str(),
                    "receiptId": receipt.as_ref().and_then(|r| r.get("id").cloned()),
                    "idempotencyKey": idem,
                    "network": network,
                    "amount": amount,
                    "note": note,
                })),
            )
                .into_response()
        }
    }
}

fn store_receipt(
    db: Option<&Database>,
    idempotency_key: &str,
    payload_hash: &str,
    amount: Option<&str>,
    network: &str,
    status: ReceiptStatus,
    raw_response: Option<&str>,
    mode: X402Mode,
    note: &str,
) -> Option<Value> {
    let db = db?;
    match db.social_x402_insert_receipt(
        idempotency_key,
        payload_hash,
        amount,
        network,
        status.as_str(),
        raw_response,
        mode.as_str(),
        note,
    ) {
        Ok(row) => Some(row),
        Err(e) => {
            // Unique race: another request inserted the same key — return existing.
            tracing::warn!(error = %e, "x402 receipt insert failed; attempting idempotent read");
            db.social_x402_get_receipt_by_idempotency(idempotency_key)
        }
    }
}

/// POST /v1/social/x402/paid-ping — Wave 14o Social product gate (fail-closed).
///
/// Authenticated. Requires valid payment proof when mode ≠ disabled:
/// - **disabled** → **501** `{ reason: "payments off" }`
/// - **shape_only** → shape payment + receipt `pending`; `settled: false`
/// - **facilitator** → must verify successfully; otherwise **402** (fail closed)
///
/// On allow, stores a receipt noting product-gate usage (`product_gate:paid-ping`).
pub async fn paid_ping(
    user: ClerkUser,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<VerifyRequest>,
) -> impl IntoResponse {
    let cfg = X402Config::from_env();

    // Early exit for disabled (honest payments-off).
    if cfg.mode == X402Mode::Disabled {
        let outcome = evaluate_paid_gate(X402Mode::Disabled, PaidPaymentState::Missing);
        return (
            paid_gate_http_status(outcome),
            Json(json!({
                "ok": false,
                "action": "paid-ping",
                "reason": "payments off",
                "mode": "disabled",
                "settled": false,
                "note": "x402 disabled (set X402_ENABLED=1 to enable). No settlement.",
            })),
        )
            .into_response();
    }

    // Missing payment shape → 402 payment required (fail closed).
    if validate_verify_shape(&req) == VerifyShapeResult::InvalidShape {
        let outcome = evaluate_paid_gate(cfg.mode, PaidPaymentState::Missing);
        return (
            paid_gate_http_status(outcome),
            Json(json!({
                "ok": false,
                "action": "paid-ping",
                "reason": "payment required",
                "mode": cfg.mode.as_str(),
                "settled": false,
                "note": "provide payload, payment, or amount for the paid product gate",
            })),
        )
            .into_response();
    }

    let base_idem = resolve_idempotency_key(&req, &headers);
    let idem = paid_ping_idempotency_key(&base_idem);
    let hash = payload_hash(&req);
    let network = req
        .network
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(cfg.network.as_str())
        .to_string();
    let amount = req.amount.clone();
    let actor = user.user_id.clone();

    // Idempotent replay of a prior paid-ping for this key.
    if let Some(db) = state.db.as_ref() {
        if let Some(existing) = db.social_x402_get_receipt_by_idempotency(&idem) {
            return paid_ping_receipt_replay(&existing, cfg.mode).into_response();
        }
    }

    match cfg.mode {
        X402Mode::Disabled => unreachable!("handled above"),
        X402Mode::ShapeOnly => {
            let payment_state = PaidPaymentState::ShapeOk;
            let outcome = evaluate_paid_gate(X402Mode::ShapeOnly, payment_state);
            debug_assert!(outcome.allows_action());
            let note = "product_gate:paid-ping used (shape_only; not settled)";
            let receipt = store_receipt(
                state.db.as_ref(),
                &idem,
                &hash,
                amount.as_deref(),
                &network,
                ReceiptStatus::Pending,
                None,
                X402Mode::ShapeOnly,
                note,
            );
            (
                paid_gate_http_status(outcome),
                Json(json!({
                    "ok": true,
                    "action": "paid-ping",
                    "pong": true,
                    "mode": "shape_only",
                    "settled": false,
                    "verified": false,
                    "status": "pending",
                    "receiptId": receipt.as_ref().and_then(|r| r.get("id").cloned()),
                    "idempotencyKey": idem,
                    "network": network,
                    "amount": amount,
                    "actor": actor,
                    "note": note,
                    "message": "paid-ping accepted in shape_only (not settled)",
                })),
            )
                .into_response()
        }
        X402Mode::Facilitator => {
            let base = cfg
                .facilitator_url
                .as_deref()
                .expect("facilitator mode requires URL");
            let url = facilitator_verify_url(base);
            let body = build_facilitator_request_body(&req);
            let (verified, status, raw) = call_facilitator_verify(&url, &body).await;
            let payment_state = if verified {
                PaidPaymentState::FacilitatorOk
            } else {
                PaidPaymentState::FacilitatorFailed
            };
            let outcome = evaluate_paid_gate(X402Mode::Facilitator, payment_state);
            let note = if outcome.allows_action() {
                "product_gate:paid-ping used (facilitator verified)"
            } else {
                "product_gate:paid-ping rejected (facilitator not verified)"
            };
            let raw_str = serde_json::to_string(&raw).ok();
            let receipt = store_receipt(
                state.db.as_ref(),
                &idem,
                &hash,
                amount.as_deref(),
                &network,
                status,
                raw_str.as_deref(),
                X402Mode::Facilitator,
                note,
            );
            if outcome.allows_action() {
                (
                    paid_gate_http_status(outcome),
                    Json(json!({
                        "ok": true,
                        "action": "paid-ping",
                        "pong": true,
                        "mode": "facilitator",
                        "settled": true,
                        "verified": true,
                        "status": status.as_str(),
                        "receiptId": receipt.as_ref().and_then(|r| r.get("id").cloned()),
                        "idempotencyKey": idem,
                        "network": network,
                        "amount": amount,
                        "actor": actor,
                        "note": note,
                        "message": "paid-ping completed with verified payment",
                    })),
                )
                    .into_response()
            } else {
                (
                    paid_gate_http_status(outcome),
                    Json(json!({
                        "ok": false,
                        "action": "paid-ping",
                        "reason": "payment not verified",
                        "mode": "facilitator",
                        "settled": false,
                        "verified": false,
                        "status": status.as_str(),
                        "receiptId": receipt.as_ref().and_then(|r| r.get("id").cloned()),
                        "idempotencyKey": idem,
                        "network": network,
                        "amount": amount,
                        "actor": actor,
                        "note": note,
                    })),
                )
                    .into_response()
            }
        }
    }
}

/// Replay a stored paid-ping receipt as an HTTP response (honest settled flag).
fn paid_ping_receipt_replay(row: &Value, mode: X402Mode) -> (StatusCode, Json<Value>) {
    let status = row["status"].as_str().unwrap_or("pending");
    let verified = status == "verified";
    let receipt_mode = row
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or(mode.as_str());
    let payment_state = match (receipt_mode, verified) {
        ("facilitator", true) => PaidPaymentState::FacilitatorOk,
        ("facilitator", false) => PaidPaymentState::FacilitatorFailed,
        ("shape_only", _) => PaidPaymentState::ShapeOk,
        _ if verified => PaidPaymentState::FacilitatorOk,
        _ => PaidPaymentState::ShapeOk,
    };
    let gate_mode = match receipt_mode {
        "facilitator" => X402Mode::Facilitator,
        "shape_only" => X402Mode::ShapeOnly,
        "disabled" => X402Mode::Disabled,
        _ => mode,
    };
    let outcome = evaluate_paid_gate(gate_mode, payment_state);
    let settled = outcome.settled();
    if outcome.allows_action() {
        (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "action": "paid-ping",
                "pong": true,
                "mode": receipt_mode,
                "settled": settled,
                "verified": verified,
                "status": status,
                "receiptId": row.get("id"),
                "idempotencyKey": row.get("idempotencyKey"),
                "network": row.get("network"),
                "amount": row.get("amount"),
                "note": row.get("note").cloned().unwrap_or(json!(
                    "idempotent replay of paid-ping receipt"
                )),
                "message": "paid-ping replay of stored receipt",
                "replay": true,
            })),
        )
    } else {
        (
            paid_gate_http_status(outcome),
            Json(json!({
                "ok": false,
                "action": "paid-ping",
                "reason": if matches!(outcome, PaidGateOutcome::FacilitatorRejected) {
                    "payment not verified"
                } else {
                    "payment required"
                },
                "mode": receipt_mode,
                "settled": false,
                "verified": verified,
                "status": status,
                "receiptId": row.get("id"),
                "idempotencyKey": row.get("idempotencyKey"),
                "network": row.get("network"),
                "amount": row.get("amount"),
                "note": row.get("note").cloned().unwrap_or(json!(
                    "idempotent replay of paid-ping receipt"
                )),
                "replay": true,
            })),
        )
    }
}

/// HTTP call to facilitator verify endpoint.
///
/// Never logs request/response bodies that might contain secrets beyond public payment proofs.
async fn call_facilitator_verify(url: &str, body: &Value) -> (bool, ReceiptStatus, Value) {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "x402 facilitator client build failed");
            return (
                false,
                ReceiptStatus::Failed,
                json!({ "error": "client_build_failed" }),
            );
        }
    };

    // Log URL host only — never private keys (we do not have them).
    tracing::info!(target: "x402", url = %url, "POST facilitator verify");

    match client.post(url).json(body).send().await {
        Ok(resp) => {
            let http_ok = resp.status().is_success();
            let status_code = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            let parsed: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
                json!({ "raw": text.chars().take(2000).collect::<String>() })
            });
            let (verified, receipt_status) = map_facilitator_body(&parsed, http_ok);
            tracing::info!(
                target: "x402",
                http_status = status_code,
                verified,
                "facilitator verify response"
            );
            let mut out = parsed;
            if let Some(obj) = out.as_object_mut() {
                obj.insert("_httpStatus".into(), json!(status_code));
            }
            (verified, receipt_status, out)
        }
        Err(e) => {
            tracing::warn!(target: "x402", error = %e, "facilitator verify request failed");
            (
                false,
                ReceiptStatus::Failed,
                json!({ "error": "facilitator_unreachable", "message": e.to_string() }),
            )
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn config_disabled_by_default() {
        let cfg = X402Config::from_parts(None, None, None, None);
        assert!(!cfg.enabled);
        assert_eq!(cfg.mode, X402Mode::Disabled);
        assert_eq!(cfg.network, "placeholder");
        assert!(cfg.facilitator_url.is_none());
        assert!(cfg.pay_to.is_none());
    }

    #[test]
    fn config_enabled_shape_only_without_facilitator() {
        let cfg = X402Config::from_parts(Some("1"), Some("base"), None, Some("0xabc"));
        assert!(cfg.enabled);
        assert_eq!(cfg.mode, X402Mode::ShapeOnly);
        assert_eq!(cfg.network, "base");
        assert_eq!(cfg.pay_to.as_deref(), Some("0xabc"));
    }

    #[test]
    fn config_enabled_facilitator_when_url_set() {
        let cfg = X402Config::from_parts(
            Some("1"),
            Some("base-sepolia"),
            Some("https://x402.org/facilitator/"),
            Some("0xpay"),
        );
        assert_eq!(cfg.mode, X402Mode::Facilitator);
        assert_eq!(
            cfg.facilitator_url.as_deref(),
            Some("https://x402.org/facilitator")
        );
        assert_eq!(cfg.network, "base-sepolia");
    }

    #[test]
    fn config_enabled_requires_exact_one() {
        for bad in ["true", "yes", "0", ""] {
            let cfg = X402Config::from_parts(Some(bad), None, Some("https://f"), None);
            assert!(!cfg.enabled, "expected disabled for {bad}");
            assert_eq!(cfg.mode, X402Mode::Disabled);
        }
    }

    #[test]
    fn config_default_network_when_enabled() {
        let cfg = X402Config::from_parts(Some("1"), None, None, None);
        assert_eq!(cfg.network, "base-sepolia");
    }

    #[test]
    fn status_from_config_includes_mode_and_pay_to() {
        let cfg = X402Config::from_parts(Some("1"), Some("base"), None, Some("0x1"));
        let status = build_status_from_config(&cfg);
        assert!(status.enabled);
        assert_eq!(status.mode, "shape_only");
        assert_eq!(status.pay_to.as_deref(), Some("0x1"));
        assert_eq!(status.network, "base");
        assert!(status.note.contains("shape_only") || status.note.contains("shape"));
    }

    #[test]
    fn status_disabled_builder_compat() {
        let status = build_status_response(false);
        assert!(!status.enabled);
        assert_eq!(status.mode, "disabled");
        assert_eq!(status.network, "placeholder");
    }

    #[test]
    fn status_enabled_builder_compat() {
        let status = build_status_response(true);
        assert!(status.enabled);
        assert_eq!(status.mode, "shape_only");
        assert_eq!(status.network, "base-sepolia");
    }

    #[test]
    fn status_serializes_expected_keys() {
        let status = build_status_from_config(&X402Config::from_parts(
            Some("1"),
            Some("base"),
            Some("https://fac.example"),
            Some("0xpay"),
        ));
        let v = serde_json::to_value(&status).unwrap();
        assert_eq!(v["enabled"], true);
        assert_eq!(v["network"], "base");
        assert_eq!(v["mode"], "facilitator");
        assert_eq!(v["payTo"], "0xpay");
        assert!(v["note"].as_str().unwrap().contains("facilitator"));
    }

    #[test]
    fn verify_shape_rejects_empty() {
        let req = VerifyRequest {
            payload: None,
            payment: None,
            amount: None,
            network: None,
            idempotency_key: None,
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
            idempotency_key: None,
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
            idempotency_key: None,
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
            idempotency_key: None,
        };
        assert_eq!(validate_verify_shape(&req), VerifyShapeResult::InvalidShape);
    }

    #[test]
    fn payload_hash_stable() {
        let req = VerifyRequest {
            payload: Some(json!({ "a": 1 })),
            payment: None,
            amount: Some("1".into()),
            network: Some("base".into()),
            idempotency_key: Some("k".into()),
        };
        let h1 = payload_hash(&req);
        let h2 = payload_hash(&req);
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn map_facilitator_valid_true() {
        let (v, s) = map_facilitator_body(&json!({ "isValid": true }), true);
        assert!(v);
        assert_eq!(s, ReceiptStatus::Verified);
    }

    #[test]
    fn map_facilitator_valid_false() {
        let (v, s) = map_facilitator_body(&json!({ "isValid": false }), true);
        assert!(!v);
        assert_eq!(s, ReceiptStatus::Failed);
    }

    #[test]
    fn map_facilitator_http_fail() {
        let (v, s) = map_facilitator_body(&json!({ "isValid": true }), false);
        assert!(!v);
        assert_eq!(s, ReceiptStatus::Failed);
    }

    #[test]
    fn map_facilitator_ambiguous_2xx_is_not_verified() {
        let (v, s) = map_facilitator_body(&json!({ "message": "ok" }), true);
        assert!(!v);
        assert_eq!(s, ReceiptStatus::Failed);
    }

    #[test]
    fn facilitator_url_appends_verify() {
        assert_eq!(
            facilitator_verify_url("https://x402.org/facilitator/"),
            "https://x402.org/facilitator/verify"
        );
        assert_eq!(
            facilitator_verify_url("https://x402.org/facilitator/verify"),
            "https://x402.org/facilitator/verify"
        );
    }

    #[test]
    fn receipt_status_roundtrip() {
        for s in ["pending", "verified", "failed"] {
            assert_eq!(ReceiptStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(ReceiptStatus::parse("shape_only").is_none());
    }

    #[test]
    fn resolve_idempotency_prefers_body() {
        let req = VerifyRequest {
            payload: Some(json!({ "x": 1 })),
            payment: None,
            amount: None,
            network: None,
            idempotency_key: Some(" client-key ".into()),
        };
        let headers = HeaderMap::new();
        assert_eq!(resolve_idempotency_key(&req, &headers), "client-key");
    }

    #[test]
    fn build_facilitator_body_merges_payload() {
        let req = VerifyRequest {
            payload: Some(json!({ "x402Version": 1, "paymentHeader": "abc" })),
            payment: None,
            amount: Some("0.05".into()),
            network: Some("base".into()),
            idempotency_key: None,
        };
        let body = build_facilitator_request_body(&req);
        assert_eq!(body["x402Version"], 1);
        assert_eq!(body["paymentHeader"], "abc");
        assert_eq!(body["amount"], "0.05");
        assert_eq!(body["network"], "base");
    }

    // ─── Wave 14o product gate (pure) ───────────────────────────────────────

    #[test]
    fn paid_gate_disabled_always_off() {
        for payment in [
            PaidPaymentState::Missing,
            PaidPaymentState::ShapeOk,
            PaidPaymentState::FacilitatorOk,
            PaidPaymentState::FacilitatorFailed,
        ] {
            let o = evaluate_paid_gate(X402Mode::Disabled, payment);
            assert_eq!(o, PaidGateOutcome::PaymentsOff);
            assert!(!o.allows_action());
            assert!(!o.settled());
            assert_eq!(paid_gate_http_status(o), StatusCode::NOT_IMPLEMENTED);
        }
    }

    #[test]
    fn paid_gate_shape_only_requires_shape_not_settled() {
        assert_eq!(
            evaluate_paid_gate(X402Mode::ShapeOnly, PaidPaymentState::Missing),
            PaidGateOutcome::PaymentRequired
        );
        let allow = evaluate_paid_gate(X402Mode::ShapeOnly, PaidPaymentState::ShapeOk);
        assert_eq!(allow, PaidGateOutcome::AllowShapeOnly);
        assert!(allow.allows_action());
        assert!(!allow.settled());
        assert_eq!(paid_gate_http_status(allow), StatusCode::OK);
        // Even facilitator flags do not claim settlement in shape_only.
        let still = evaluate_paid_gate(X402Mode::ShapeOnly, PaidPaymentState::FacilitatorOk);
        assert_eq!(still, PaidGateOutcome::AllowShapeOnly);
        assert!(!still.settled());
    }

    #[test]
    fn paid_gate_facilitator_fail_closed() {
        assert_eq!(
            evaluate_paid_gate(X402Mode::Facilitator, PaidPaymentState::Missing),
            PaidGateOutcome::PaymentRequired
        );
        // Shape alone is not enough — fail closed until facilitator verifies.
        assert_eq!(
            evaluate_paid_gate(X402Mode::Facilitator, PaidPaymentState::ShapeOk),
            PaidGateOutcome::PaymentRequired
        );
        let reject =
            evaluate_paid_gate(X402Mode::Facilitator, PaidPaymentState::FacilitatorFailed);
        assert_eq!(reject, PaidGateOutcome::FacilitatorRejected);
        assert!(!reject.allows_action());
        assert!(!reject.settled());
        assert_eq!(
            paid_gate_http_status(reject),
            StatusCode::PAYMENT_REQUIRED
        );
        let ok = evaluate_paid_gate(X402Mode::Facilitator, PaidPaymentState::FacilitatorOk);
        assert_eq!(ok, PaidGateOutcome::AllowFacilitatorVerified);
        assert!(ok.allows_action());
        assert!(ok.settled());
        assert_eq!(paid_gate_http_status(ok), StatusCode::OK);
    }

    #[test]
    fn paid_ping_idempotency_prefixes() {
        assert_eq!(
            paid_ping_idempotency_key("client-1"),
            "paid-ping:client-1"
        );
        assert_eq!(
            paid_ping_idempotency_key("paid-ping:already"),
            "paid-ping:already"
        );
        assert_eq!(paid_ping_idempotency_key("  "), "paid-ping:auto");
    }

    #[test]
    fn paid_gate_http_status_payment_required_is_402() {
        assert_eq!(
            paid_gate_http_status(PaidGateOutcome::PaymentRequired),
            StatusCode::PAYMENT_REQUIRED
        );
        assert_eq!(StatusCode::PAYMENT_REQUIRED.as_u16(), 402);
    }
}
