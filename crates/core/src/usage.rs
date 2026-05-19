use serde::{Deserialize, Serialize};

/// Aggregated usage summary, optionally broken down by provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub total_tokens_in: i64,
    pub total_tokens_out: i64,
    pub total_cost_estimate: f64,
    pub step_count: i64,
    pub by_provider: Vec<ProviderUsage>,
}

/// Usage breakdown for a single provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub provider: String,
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_estimate: f64,
    pub step_count: i64,
}

/// Daily usage aggregation for charts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyUsage {
    pub date: String, // "2026-05-19"
    pub tokens_in: i64,
    pub tokens_out: i64,
    pub cost_estimate: f64,
    pub step_count: i64,
}

/// Configurable usage limits for billing gating.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageLimits {
    pub daily_cost_limit: f64,
    pub daily_step_limit: i64,
    pub monthly_cost_limit: f64,
}

impl Default for UsageLimits {
    fn default() -> Self {
        Self {
            daily_cost_limit: 10.0,    // $10/day
            daily_step_limit: 100,     // 100 steps/day
            monthly_cost_limit: 200.0, // $200/month
        }
    }
}

/// Rough cost estimation based on token counts and provider/tier.
/// These are approximate $/1K-token rates; real billing would come from provider APIs.
pub fn estimate_cost(provider: &str, tokens_in: i64, tokens_out: i64) -> f64 {
    let (in_rate, out_rate) = match provider {
        "claude" => (0.003, 0.015),   // Sonnet-class pricing per 1K tokens
        "openai" => (0.005, 0.015),   // GPT-4-class pricing per 1K tokens
        "gemini" => (0.00035, 0.001), // Gemini pricing per 1K tokens
        _ => (0.003, 0.015),
    };
    (tokens_in as f64 / 1000.0) * in_rate + (tokens_out as f64 / 1000.0) * out_rate
}
