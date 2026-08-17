use cortex_core::error::CortexError;
use cortex_core::provider::ProviderStatus;
use cortex_core::routing::{Intent, RiskLevel, RoutingDecision};
use cortex_core::task::TaskContract;

use crate::classifier::classify_intent;
use crate::models::resolve_model;
use crate::risk::classify_risk;
use crate::scorer::{score_providers, ScoringContext};

pub struct Router;

impl Router {
    pub fn route(
        input: &str,
        file_paths: &[&str],
        providers: &[ProviderStatus],
    ) -> Result<(TaskContract, RoutingDecision), CortexError> {
        let intent = classify_intent(input).ok_or(CortexError::IntentUnclassifiable)?;
        let risk = classify_risk(file_paths);
        let tier = effective_tier(intent, risk);

        let mut decision = score_providers(&ScoringContext {
            tier,
            risk,
            providers,
        })
        .ok_or_else(|| CortexError::NoProviderAvailable {
            tier: tier.to_string(),
        })?;

        if let Some(model) = resolve_model(decision.provider, decision.tier) {
            decision.model_id = model.model_id;
        }

        let task = TaskContract::new(input.to_string(), tier, risk);

        Ok((task, decision))
    }
}

fn effective_tier(intent: Intent, risk: RiskLevel) -> cortex_core::provider::Tier {
    let intent_tier = intent.default_tier();
    let risk_tier = risk.minimum_tier();

    if risk_tier.rank() > intent_tier.rank() {
        risk_tier
    } else {
        intent_tier
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cortex_core::provider::{ProviderId, Tier};

    fn two_providers() -> Vec<ProviderStatus> {
        vec![
            ProviderStatus {
                provider: ProviderId::Claude,
                authenticated: true,
                pressure: 0.4,
                available_tiers: vec![Tier::Search, Tier::Execute, Tier::Think],
            },
            ProviderStatus {
                provider: ProviderId::Openai,
                authenticated: true,
                pressure: 0.6,
                available_tiers: vec![Tier::Search, Tier::Execute, Tier::Think],
            },
        ]
    }

    #[test]
    fn routes_fix_to_execute_tier() {
        let (task, decision) = Router::route(
            "fix the login bug",
            &["src/components/Login.tsx"],
            &two_providers(),
        )
        .unwrap();

        assert_eq!(task.tier, Tier::Execute);
        assert_eq!(decision.tier, Tier::Execute);
    }

    #[test]
    fn routes_explore_to_search_tier() {
        let (task, _) = Router::route(
            "where is the database setup?",
            &["src/app.ts"],
            &two_providers(),
        )
        .unwrap();

        assert_eq!(task.tier, Tier::Search);
    }

    #[test]
    fn critical_risk_escalates_to_think() {
        let (task, _) = Router::route(
            "fix the auth middleware",
            &["src/auth/middleware.ts"],
            &two_providers(),
        )
        .unwrap();

        assert_eq!(task.risk, RiskLevel::Critical);
        assert_eq!(task.tier, Tier::Think);
    }

    #[test]
    fn prefers_lower_pressure_provider() {
        let (_, decision) =
            Router::route("fix the button", &["src/Button.tsx"], &two_providers()).unwrap();

        assert_eq!(decision.provider, ProviderId::Claude);
    }

    #[test]
    fn fails_on_unclassifiable_input() {
        let result = Router::route("", &[], &two_providers());
        assert!(result.is_err());
    }

    #[test]
    fn fails_with_no_providers() {
        let result = Router::route("fix the bug", &["src/app.ts"], &[]);
        assert!(result.is_err());
    }
}
