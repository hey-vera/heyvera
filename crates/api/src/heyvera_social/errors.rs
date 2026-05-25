use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::{Map, Value};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HeyVeraErrorCode {
    InvalidRequest,
    Unauthorized,
    Forbidden,
    ProfileNotFound,
    PostNotFound,
    CommunityNotFound,
    ConversationNotFound,
    Conflict,
    PayloadTooLarge,
    UnsupportedMediaType,
    ValidationFailed,
    RateLimited,
    Internal,
}

impl HeyVeraErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::Unauthorized => "unauthorized",
            Self::Forbidden => "forbidden",
            Self::ProfileNotFound => "profile_not_found",
            Self::PostNotFound => "post_not_found",
            Self::CommunityNotFound => "community_not_found",
            Self::ConversationNotFound => "conversation_not_found",
            Self::Conflict => "conflict",
            Self::PayloadTooLarge => "payload_too_large",
            Self::UnsupportedMediaType => "unsupported_media_type",
            Self::ValidationFailed => "validation_failed",
            Self::RateLimited => "rate_limited",
            Self::Internal => "internal",
        }
    }

    pub const fn status_code(self) -> StatusCode {
        match self {
            Self::InvalidRequest => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::ProfileNotFound
            | Self::PostNotFound
            | Self::CommunityNotFound
            | Self::ConversationNotFound => StatusCode::NOT_FOUND,
            Self::Conflict => StatusCode::CONFLICT,
            Self::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::UnsupportedMediaType => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::ValidationFailed => StatusCode::UNPROCESSABLE_ENTITY,
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl fmt::Display for HeyVeraErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorDetail {
    pub code: HeyVeraErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl ErrorBody {
    pub fn new(
        code: HeyVeraErrorCode,
        message: impl Into<String>,
        details: Option<Value>,
    ) -> Self {
        Self {
            error: ErrorDetail {
                code,
                message: message.into(),
                details,
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct HeyVeraSocialError {
    pub code: HeyVeraErrorCode,
    pub message: String,
    pub details: Option<Value>,
}

impl HeyVeraSocialError {
    pub fn new(code: HeyVeraErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn with_detail_field(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        let mut object = match self.details.take() {
            Some(Value::Object(existing)) => existing,
            Some(other) => {
                let mut map = Map::new();
                map.insert("value".into(), other);
                map
            }
            None => Map::new(),
        };
        object.insert(key.into(), value.into());
        self.details = Some(Value::Object(object));
        self
    }

    pub fn status_code(&self) -> StatusCode {
        self.code.status_code()
    }

    pub fn body(&self) -> ErrorBody {
        ErrorBody::new(self.code, self.message.clone(), self.details.clone())
    }

    pub fn into_parts(self) -> (StatusCode, Json<ErrorBody>) {
        let status = self.status_code();
        let body = ErrorBody::new(self.code, self.message, self.details);
        (status, Json(body))
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::InvalidRequest, message)
    }

    pub fn unauthorized() -> Self {
        Self::new(
            HeyVeraErrorCode::Unauthorized,
            "Missing, expired, or invalid bearer token.",
        )
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::Forbidden, message)
    }

    pub fn profile_not_found() -> Self {
        Self::new(
            HeyVeraErrorCode::ProfileNotFound,
            "HeyVera profile not found.",
        )
    }

    pub fn post_not_found() -> Self {
        Self::new(HeyVeraErrorCode::PostNotFound, "Post not found.")
    }

    pub fn community_not_found() -> Self {
        Self::new(HeyVeraErrorCode::CommunityNotFound, "Community not found.")
    }

    pub fn conversation_not_found() -> Self {
        Self::new(
            HeyVeraErrorCode::ConversationNotFound,
            "Conversation not found.",
        )
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::Conflict, message)
    }

    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::PayloadTooLarge, message)
    }

    pub fn unsupported_media_type(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::UnsupportedMediaType, message)
    }

    pub fn validation_failed(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::ValidationFailed, message)
    }

    pub fn validation_failed_with_details(
        message: impl Into<String>,
        details: Value,
    ) -> Self {
        Self::validation_failed(message).with_details(details)
    }

    pub fn rate_limited(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::RateLimited, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(HeyVeraErrorCode::Internal, message)
    }
}

impl fmt::Display for HeyVeraSocialError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for HeyVeraSocialError {}

impl IntoResponse for HeyVeraSocialError {
    fn into_response(self) -> Response {
        self.into_parts().into_response()
    }
}

impl From<HeyVeraSocialError> for ErrorBody {
    fn from(error: HeyVeraSocialError) -> Self {
        ErrorBody::new(error.code, error.message, error.details)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn profile_not_found_maps_to_contract_shape() {
        let error = HeyVeraSocialError::profile_not_found();
        let body = error.body();

        assert_eq!(error.status_code(), StatusCode::NOT_FOUND);
        assert_eq!(body.error.code, HeyVeraErrorCode::ProfileNotFound);
        assert_eq!(body.error.message, "HeyVera profile not found.");
        assert!(body.error.details.is_none());
    }

    #[test]
    fn validation_details_are_preserved() {
        let error = HeyVeraSocialError::validation_failed_with_details(
            "Validation failed.",
            json!({
                "fields": {
                    "handle": ["must be lowercase", "must be unique"]
                }
            }),
        );
        let body = error.body();

        assert_eq!(error.status_code(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body.error.code, HeyVeraErrorCode::ValidationFailed);
        assert_eq!(
            body.error.details,
            Some(json!({
                "fields": {
                    "handle": ["must be lowercase", "must be unique"]
                }
            }))
        );
    }
}
