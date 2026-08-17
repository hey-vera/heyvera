use serde::{Deserialize, Serialize};

use crate::provider::ProviderId;

// --- Worker-reported failure (raw evidence) ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerFailureReport {
    pub kind: WorkerFailureKind,
    pub exit_code: Option<i32>,
    pub stderr_excerpt: Option<String>,
    pub tool: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkerFailureKind {
    CliNotFound,
    CliNotAuthenticated,
    CliAuthExpired,
    CliRateLimited,
    CliModelUnavailable,
    CliCrashed,
    ProcessTimeout,
    ProcessKilled,
    Cancelled,
    NetworkError,
    PermissionDenied,
    OutputEmpty,
    Unknown,
}

// --- Brain-classified failure (enriched) ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskFailureKind {
    ProviderAuthExpired,
    ProviderQuotaExceeded,
    ProviderRateLimited,
    ProviderModelUnavailable,
    ProviderServiceDown,
    ProviderSafetyRefusal,

    CliNotInstalled,
    CliNotAuthenticated,
    WorkerCrashed,
    WorkerDisconnected,
    WorkerResourceExhausted,

    TaskTimeout,
    TaskCancelled,
    PermissionDenied,
    TestsFailed,
    BuildFailed,
    QualityFailure,
    OutputEmpty,
    OutputInvalid,

    GitConflict,
    GitPushRejected,
    WorkspaceDirty,
    ConflictingEdits,

    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureScope {
    Provider,
    ProviderAccount,
    ProviderModel,
    Worker,
    WorkerTooling,
    Task,
    Workspace,
    User,
    Unknown,
}

impl TaskFailureKind {
    pub fn scope(&self) -> FailureScope {
        match self {
            Self::ProviderServiceDown => FailureScope::Provider,
            Self::ProviderAuthExpired | Self::ProviderQuotaExceeded => {
                FailureScope::ProviderAccount
            }
            Self::ProviderRateLimited
            | Self::ProviderModelUnavailable
            | Self::ProviderSafetyRefusal => FailureScope::ProviderModel,

            Self::WorkerCrashed | Self::WorkerDisconnected | Self::WorkerResourceExhausted => {
                FailureScope::Worker
            }

            Self::CliNotInstalled | Self::CliNotAuthenticated => FailureScope::WorkerTooling,

            Self::TaskTimeout
            | Self::TaskCancelled
            | Self::PermissionDenied
            | Self::TestsFailed
            | Self::BuildFailed
            | Self::QualityFailure
            | Self::OutputEmpty
            | Self::OutputInvalid => FailureScope::Task,

            Self::GitConflict
            | Self::GitPushRejected
            | Self::WorkspaceDirty
            | Self::ConflictingEdits => FailureScope::Workspace,

            Self::Unknown => FailureScope::Unknown,
        }
    }

    pub fn should_retry(&self) -> bool {
        matches!(
            self,
            Self::ProviderRateLimited
                | Self::ProviderServiceDown
                | Self::WorkerCrashed
                | Self::WorkerDisconnected
                | Self::TaskTimeout
                | Self::TestsFailed
                | Self::BuildFailed
        )
    }

    pub fn should_try_different_provider(&self) -> bool {
        matches!(
            self,
            Self::ProviderAuthExpired
                | Self::ProviderQuotaExceeded
                | Self::ProviderModelUnavailable
                | Self::ProviderServiceDown
                | Self::CliNotInstalled
                | Self::CliNotAuthenticated
        )
    }

    pub fn penalizes_provider(&self) -> bool {
        matches!(
            self.scope(),
            FailureScope::Provider | FailureScope::ProviderAccount | FailureScope::ProviderModel
        )
    }

    pub fn penalizes_worker(&self) -> bool {
        matches!(
            self.scope(),
            FailureScope::Worker | FailureScope::WorkerTooling
        )
    }
}

// --- Classification: Worker report → Brain classification ---

pub fn classify_failure(
    report: &WorkerFailureReport,
    provider: Option<ProviderId>,
    worker_disconnected: bool,
) -> (TaskFailureKind, FailureScope) {
    if worker_disconnected {
        return (TaskFailureKind::WorkerDisconnected, FailureScope::Worker);
    }

    let kind = match report.kind {
        WorkerFailureKind::CliNotFound => TaskFailureKind::CliNotInstalled,
        WorkerFailureKind::CliNotAuthenticated => {
            if provider.is_some() {
                TaskFailureKind::CliNotAuthenticated
            } else {
                TaskFailureKind::CliNotAuthenticated
            }
        }
        WorkerFailureKind::CliAuthExpired => TaskFailureKind::ProviderAuthExpired,
        WorkerFailureKind::CliRateLimited => TaskFailureKind::ProviderRateLimited,
        WorkerFailureKind::CliModelUnavailable => TaskFailureKind::ProviderModelUnavailable,
        WorkerFailureKind::CliCrashed => {
            if let Some(ref stderr) = report.stderr_excerpt {
                if stderr.contains("out of memory") || stderr.contains("OOM") {
                    TaskFailureKind::WorkerResourceExhausted
                } else {
                    TaskFailureKind::WorkerCrashed
                }
            } else {
                TaskFailureKind::WorkerCrashed
            }
        }
        WorkerFailureKind::ProcessTimeout => TaskFailureKind::TaskTimeout,
        WorkerFailureKind::ProcessKilled => TaskFailureKind::TaskCancelled,
        WorkerFailureKind::Cancelled => TaskFailureKind::TaskCancelled,
        WorkerFailureKind::NetworkError => TaskFailureKind::ProviderServiceDown,
        WorkerFailureKind::PermissionDenied => TaskFailureKind::PermissionDenied,
        WorkerFailureKind::OutputEmpty => TaskFailureKind::OutputEmpty,
        WorkerFailureKind::Unknown => {
            if let Some(ref stderr) = report.stderr_excerpt {
                classify_from_stderr(stderr)
            } else {
                TaskFailureKind::Unknown
            }
        }
    };

    (kind, kind.scope())
}

fn classify_from_stderr(stderr: &str) -> TaskFailureKind {
    let lower = stderr.to_lowercase();

    if lower.contains("rate limit") || lower.contains("429") {
        TaskFailureKind::ProviderRateLimited
    } else if lower.contains("unauthorized") || lower.contains("401") || lower.contains("auth") {
        TaskFailureKind::ProviderAuthExpired
    } else if lower.contains("quota") || lower.contains("billing") {
        TaskFailureKind::ProviderQuotaExceeded
    } else if lower.contains("test") && (lower.contains("fail") || lower.contains("assert")) {
        TaskFailureKind::TestsFailed
    } else if lower.contains("build") && lower.contains("fail") {
        TaskFailureKind::BuildFailed
    } else if lower.contains("conflict") {
        TaskFailureKind::GitConflict
    } else if lower.contains("safety") || lower.contains("content policy") {
        TaskFailureKind::ProviderSafetyRefusal
    } else {
        TaskFailureKind::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_mapping() {
        assert_eq!(
            TaskFailureKind::ProviderAuthExpired.scope(),
            FailureScope::ProviderAccount
        );
        assert_eq!(TaskFailureKind::WorkerCrashed.scope(), FailureScope::Worker);
        assert_eq!(TaskFailureKind::TestsFailed.scope(), FailureScope::Task);
        assert_eq!(
            TaskFailureKind::GitConflict.scope(),
            FailureScope::Workspace
        );
    }

    #[test]
    fn retry_decisions() {
        assert!(TaskFailureKind::ProviderRateLimited.should_retry());
        assert!(TaskFailureKind::TestsFailed.should_retry());
        assert!(!TaskFailureKind::ProviderAuthExpired.should_retry());
        assert!(!TaskFailureKind::PermissionDenied.should_retry());
    }

    #[test]
    fn provider_switch_decisions() {
        assert!(TaskFailureKind::ProviderAuthExpired.should_try_different_provider());
        assert!(TaskFailureKind::ProviderQuotaExceeded.should_try_different_provider());
        assert!(!TaskFailureKind::TestsFailed.should_try_different_provider());
    }

    #[test]
    fn classify_rate_limit() {
        let report = WorkerFailureReport {
            kind: WorkerFailureKind::CliRateLimited,
            exit_code: Some(1),
            stderr_excerpt: None,
            tool: Some("claude".into()),
        };
        let (kind, scope) = classify_failure(&report, Some(ProviderId::Claude), false);
        assert_eq!(kind, TaskFailureKind::ProviderRateLimited);
        assert_eq!(scope, FailureScope::ProviderModel);
    }

    #[test]
    fn classify_disconnected_overrides_report() {
        let report = WorkerFailureReport {
            kind: WorkerFailureKind::OutputEmpty,
            exit_code: None,
            stderr_excerpt: None,
            tool: None,
        };
        let (kind, _) = classify_failure(&report, None, true);
        assert_eq!(kind, TaskFailureKind::WorkerDisconnected);
    }

    #[test]
    fn classify_unknown_with_stderr() {
        let report = WorkerFailureReport {
            kind: WorkerFailureKind::Unknown,
            exit_code: Some(1),
            stderr_excerpt: Some("Error: rate limit exceeded (429)".into()),
            tool: Some("codex".into()),
        };
        let (kind, _) = classify_failure(&report, Some(ProviderId::Openai), false);
        assert_eq!(kind, TaskFailureKind::ProviderRateLimited);
    }

    #[test]
    fn classify_oom_crash() {
        let report = WorkerFailureReport {
            kind: WorkerFailureKind::CliCrashed,
            exit_code: Some(137),
            stderr_excerpt: Some("out of memory".into()),
            tool: Some("claude".into()),
        };
        let (kind, _) = classify_failure(&report, Some(ProviderId::Claude), false);
        assert_eq!(kind, TaskFailureKind::WorkerResourceExhausted);
    }
}
