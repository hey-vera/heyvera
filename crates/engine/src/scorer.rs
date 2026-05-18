use cortex_core::provider::{ProviderStatus, Tier};
use cortex_core::routing::{RationaleCode, RiskLevel, RoutingDecision, ScoredRoute};

pub struct ScoringContext<'a> {
    pub tier: Tier,
    pub risk: RiskLevel,
    pub providers: &'a [ProviderStatus],
}

pub fn score_providers(ctx: &ScoringContext) -> Option<RoutingDecision> {
    let mut candidates: Vec<ScoredRoute> = Vec::new();

    for provider in ctx.providers {
        if !provider.authenticated {
            continue;
        }
        if !provider.available_tiers.contains(&ctx.tier) {
            continue;
        }

        let score = compute_score(provider, ctx.tier, ctx.risk);
        candidates.push(ScoredRoute {
            provider: provider.provider,
            tier: ctx.tier,
            score,
        });
    }

    candidates.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let winner = candidates.first()?;

    let mut rationale = Vec::new();
    rationale.push(RationaleCode::BestAvailableForTier);

    if candidates.len() > 1 {
        let runner_up = &candidates[1];
        let winner_status = ctx.providers.iter().find(|p| p.provider == winner.provider)?;
        let runner_status = ctx.providers.iter().find(|p| p.provider == runner_up.provider)?;
        if winner_status.pressure < runner_status.pressure {
            rationale.push(RationaleCode::LowerPressure);
        }
    }

    Some(RoutingDecision {
        provider: winner.provider,
        tier: ctx.tier,
        model_id: String::new(),
        rationale,
        score: winner.score,
        alternatives_considered: candidates[1..].to_vec(),
    })
}

fn compute_score(provider: &ProviderStatus, _tier: Tier, _risk: RiskLevel) -> f64 {
    let mut score = 100.0;

    // Lower pressure = higher score (0.0 pressure = +50, 1.0 pressure = +0)
    score += (1.0 - provider.pressure) * 50.0;

    // Penalize high pressure providers
    if provider.pressure > 0.82 {
        score -= 30.0;
    }
    if provider.pressure > 0.95 {
        score -= 50.0;
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;
    use cortex_core::provider::ProviderId;

    fn make_provider(id: ProviderId, pressure: f64) -> ProviderStatus {
        ProviderStatus {
            provider: id,
            authenticated: true,
            pressure,
            available_tiers: vec![Tier::Search, Tier::Execute, Tier::Think],
        }
    }

    #[test]
    fn picks_lower_pressure_provider() {
        let providers = vec![
            make_provider(ProviderId::Claude, 0.8),
            make_provider(ProviderId::Openai, 0.3),
        ];

        let decision = score_providers(&ScoringContext {
            tier: Tier::Execute,
            risk: RiskLevel::Medium,
            providers: &providers,
        })
        .unwrap();

        assert_eq!(decision.provider, ProviderId::Openai);
    }

    #[test]
    fn skips_unauthenticated() {
        let providers = vec![
            ProviderStatus {
                provider: ProviderId::Claude,
                authenticated: false,
                pressure: 0.0,
                available_tiers: vec![Tier::Execute],
            },
            make_provider(ProviderId::Openai, 0.5),
        ];

        let decision = score_providers(&ScoringContext {
            tier: Tier::Execute,
            risk: RiskLevel::Low,
            providers: &providers,
        })
        .unwrap();

        assert_eq!(decision.provider, ProviderId::Openai);
    }

    #[test]
    fn no_providers_returns_none() {
        let result = score_providers(&ScoringContext {
            tier: Tier::Execute,
            risk: RiskLevel::Low,
            providers: &[],
        });

        assert!(result.is_none());
    }

    #[test]
    fn heavily_penalizes_throttled_provider() {
        let providers = vec![
            make_provider(ProviderId::Claude, 0.96),
            make_provider(ProviderId::Openai, 0.7),
        ];

        let decision = score_providers(&ScoringContext {
            tier: Tier::Execute,
            risk: RiskLevel::Low,
            providers: &providers,
        })
        .unwrap();

        assert_eq!(decision.provider, ProviderId::Openai);
    }
}
