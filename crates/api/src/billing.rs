use cortex_core::usage::UsageLimits;
use serde::Serialize;

use crate::db::Database;

/// Billing gate errors. Each variant carries current and limit values for diagnostics.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BillingError {
    DailyCostLimitExceeded {
        current: f64,
        limit: f64,
    },
    DailyStepLimitExceeded {
        current: i64,
        limit: i64,
    },
    MonthlyCostLimitExceeded {
        current: f64,
        limit: f64,
    },
}

impl std::fmt::Display for BillingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DailyCostLimitExceeded { current, limit } => {
                write!(f, "daily cost limit exceeded: ${current:.2} / ${limit:.2}")
            }
            Self::DailyStepLimitExceeded { current, limit } => {
                write!(f, "daily step limit exceeded: {current} / {limit}")
            }
            Self::MonthlyCostLimitExceeded { current, limit } => {
                write!(f, "monthly cost limit exceeded: ${current:.2} / ${limit:.2}")
            }
        }
    }
}

/// Result of a billing gate check.
#[derive(Debug, Clone, Serialize)]
pub struct GateResult {
    /// Whether the gate passed (user is within limits).
    pub allowed: bool,
    /// If not allowed, the specific violation.
    pub violation: Option<BillingError>,
    /// Whether enforcement is active (if false, violations are warnings only).
    pub enforced: bool,
    /// Current daily cost for observability.
    pub daily_cost: f64,
    /// Current daily step count for observability.
    pub daily_steps: i64,
    /// Current monthly cost for observability.
    pub monthly_cost: f64,
}

/// Check whether a user is within usage limits.
///
/// When `enforce` is false (default for v1), violations are logged as warnings
/// but the gate returns `allowed: true` so work continues.
pub fn check_usage_gate(
    db: &Database,
    user_id: &str,
    limits: &UsageLimits,
    enforce: bool,
) -> GateResult {
    let (daily_cost, daily_steps) = db.get_user_daily_cost(user_id);
    let monthly_cost = db.get_user_monthly_cost(user_id);

    // Check daily cost
    if daily_cost > limits.daily_cost_limit {
        let violation = BillingError::DailyCostLimitExceeded {
            current: daily_cost,
            limit: limits.daily_cost_limit,
        };
        tracing::warn!(
            "billing gate: user {user_id} — {}{}",
            violation,
            if enforce { " [BLOCKED]" } else { " [warn-only]" }
        );
        return GateResult {
            allowed: !enforce,
            violation: Some(violation),
            enforced: enforce,
            daily_cost,
            daily_steps,
            monthly_cost,
        };
    }

    // Check daily step count
    if daily_steps > limits.daily_step_limit {
        let violation = BillingError::DailyStepLimitExceeded {
            current: daily_steps,
            limit: limits.daily_step_limit,
        };
        tracing::warn!(
            "billing gate: user {user_id} — {}{}",
            violation,
            if enforce { " [BLOCKED]" } else { " [warn-only]" }
        );
        return GateResult {
            allowed: !enforce,
            violation: Some(violation),
            enforced: enforce,
            daily_cost,
            daily_steps,
            monthly_cost,
        };
    }

    // Check monthly cost
    if monthly_cost > limits.monthly_cost_limit {
        let violation = BillingError::MonthlyCostLimitExceeded {
            current: monthly_cost,
            limit: limits.monthly_cost_limit,
        };
        tracing::warn!(
            "billing gate: user {user_id} — {}{}",
            violation,
            if enforce { " [BLOCKED]" } else { " [warn-only]" }
        );
        return GateResult {
            allowed: !enforce,
            violation: Some(violation),
            enforced: enforce,
            daily_cost,
            daily_steps,
            monthly_cost,
        };
    }

    GateResult {
        allowed: true,
        violation: None,
        enforced: enforce,
        daily_cost,
        daily_steps,
        monthly_cost,
    }
}
