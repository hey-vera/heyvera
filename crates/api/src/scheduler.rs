use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use cortex_core::evaluator::{
    AutoMode, BudgetEvidence, CandidateScore, DecisionEvidence, DefaultPolicy,
    IntentEvidence, PressureState, Profile, ProviderFitEvidence, RiskEvidence,
    WINDOW_SECS, token_budget,
};
use cortex_core::protocol::{
    BrainMessage, PredecessorSummary, StepContext,
};
use cortex_core::provider::{ProviderId, Tier};
use cortex_core::routing::{Intent, RiskLevel, RoutingDecision};
use cortex_engine::captain::{
    check_run_completion, plan_heal, EdgeType, RunStatus, SchedulerEvent, SchedulerState,
    StepKind, StepRef, StepStatus,
};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::db::Database;
use crate::mission_control::MissionControlEvent;
use crate::state::AppState;

pub type SchedulerTx = mpsc::Sender<SchedulerEvent>;

pub fn spawn_scheduler(state: Arc<AppState>) -> SchedulerTx {
    let (tx, rx) = mpsc::channel::<SchedulerEvent>(256);

    tokio::spawn(async move {
        scheduler_loop(state, rx).await;
    });

    tx
}

async fn scheduler_loop(state: Arc<AppState>, mut rx: mpsc::Receiver<SchedulerEvent>) {
    let mut sched = SchedulerState::new();
    let mut reconcile_interval = tokio::time::interval(Duration::from_secs(30));
    let mut prune_interval = tokio::time::interval(Duration::from_secs(600));

    tracing::info!("scheduler started");

    recover_from_db(&state, &mut sched).await;

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                apply_event(&state, &mut sched, &event).await;
                schedule_until_blocked(&state, &mut sched).await;
            }
            _ = reconcile_interval.tick() => {
                expire_stale_leases(&state, &mut sched).await;
                expire_grace_periods(&state, &mut sched).await;
                cleanup_expired_keys(&state);
                state.rate_limiter.cleanup();
                reconcile_ready_steps(&state, &mut sched).await;
                schedule_until_blocked(&state, &mut sched).await;
            }
            _ = prune_interval.tick() => {
                // Prune spend logs for delegations inactive for 48h (2x default session TTL)
                if let Some(heart) = &state.soma_heart {
                    heart.prune_spend_logs(48 * 3600 * 1000);
                }
            }
        }
    }
}

async fn apply_event(state: &AppState, sched: &mut SchedulerState, event: &SchedulerEvent) {
    match event {
        SchedulerEvent::RunCreated { run_id } => {
            tracing::info!("scheduler: run created {run_id}");
            if let Some(db) = &state.db {
                db.update_run_status(run_id, "running", None);

                // Emit MC event for run creation
                let user_id = get_run_user(db, run_id);
                let goal = db.get_run_goal(run_id).unwrap_or_default();
                let step_count = db.get_all_step_statuses(run_id).len();
                state
                    .emit_mc_event(
                        &user_id,
                        MissionControlEvent::RunCreated {
                            run_id: run_id.clone(),
                            goal,
                            step_count,
                        },
                    )
                    .await;
            }
            load_ready_steps_for_run(state, sched, run_id).await;
        }

        SchedulerEvent::StepCompleted { run_id, step_id, cost_estimate } => {
            tracing::info!("scheduler: step completed {step_id} in run {run_id}");
            if let Some(heart) = &state.soma_heart {
                heart.record_heartbeat(
                    soma::heartbeat::HeartbeatEventType::RouteCompleted,
                    &serde_json::json!({"step_id": step_id, "run_id": run_id, "cost": cost_estimate}).to_string(),
                );
            }
            if let Some(db) = &state.db {
                let user_id = get_run_user(db, run_id);
                sched.mark_step_done(&user_id);
                match db.get_latest_verifier_report(step_id) {
                    Some(report) if report.is_verified_success() => {
                        update_bandit_from_outcome(state, db, step_id, true, *cost_estimate).await;
                    }
                    Some(report) => {
                        tracing::info!(
                            step_id = %step_id,
                            report_id = %report.id,
                            status = %report.status,
                            verdict = %report.verdict,
                            "skipping positive bandit reward for unverified step completion"
                        );
                    }
                    None => {
                        tracing::info!(
                            step_id = %step_id,
                            "skipping positive bandit reward for step completion without verifier report"
                        );
                    }
                }
            }
            load_ready_steps_for_run(state, sched, run_id).await;
            check_run_done(state, run_id).await;
        }

        SchedulerEvent::StepFailed { run_id, step_id } => {
            tracing::info!("scheduler: step failed {step_id} in run {run_id}");
            if let Some(heart) = &state.soma_heart {
                heart.record_heartbeat(
                    soma::heartbeat::HeartbeatEventType::RouteFailed,
                    &serde_json::json!({"step_id": step_id, "run_id": run_id}).to_string(),
                );
            }
            if let Some(db) = &state.db {
                let user_id = get_run_user(db, run_id);
                sched.mark_step_done(&user_id);
                update_bandit_from_outcome(state, db, step_id, false, None).await;

                // Check for auth-related failures — these are not healable
                let last_error = db.get_step_last_error(step_id);
                let is_auth_failure = last_error
                    .as_deref()
                    .map(|e| e.contains("CliNotAuthenticated") || e.contains("CliAuthExpired"))
                    .unwrap_or(false);

                if is_auth_failure {
                    tracing::warn!(
                        "skipping heal for step {step_id} — auth failure, cascading"
                    );
                    let skipped = db.cascade_failure(step_id);
                    if !skipped.is_empty() {
                        tracing::info!(
                            "cascaded failure from step {step_id}: skipped {} downstream steps",
                            skipped.len()
                        );
                    }
                } else {
                    try_heal(state, sched, run_id, step_id).await;
                }
            }
            load_ready_steps_for_run(state, sched, run_id).await;
            check_run_done(state, run_id).await;
        }

        SchedulerEvent::WorkerConnected { worker_id } => {
            tracing::info!("scheduler: worker connected {worker_id}");
        }

        SchedulerEvent::WorkerDisconnected { worker_id } => {
            tracing::info!("scheduler: worker disconnected {worker_id}");
        }

        SchedulerEvent::ProviderAuthExpired { worker_id, provider, user_id } => {
            tracing::warn!(
                "scheduler: provider {provider} auth expired for worker {worker_id} — \
                 user {user_id} needs to re-authenticate"
            );

            // Resolve provider string to ProviderId and mark unhealthy
            if let Some(provider_id) = parse_provider_id(provider) {
                state.mark_provider_unhealthy(worker_id, provider_id).await;
            }
        }

        SchedulerEvent::Reconcile => {
            tracing::debug!("scheduler: reconcile tick");
        }
    }
}

async fn schedule_until_blocked(state: &AppState, sched: &mut SchedulerState) {
    loop {
        let step = match sched.next_assignable() {
            Some(s) => s,
            None => break,
        };

        let dispatched = dispatch_step(state, &step).await;
        if !dispatched {
            sched.mark_step_done(&step.user_id);
            sched.enqueue_ready_step(step);
            break;
        }
    }
}

async fn dispatch_step(state: &AppState, step: &StepRef) -> bool {
    let (worker_id, worker_tx) = match state.find_worker_for_user(&step.user_id).await {
        Some(pair) => pair,
        None => {
            tracing::warn!(
                "no worker for user {} — step {} stays queued",
                step.user_id,
                step.step_id
            );
            return false;
        }
    };

    let db = match &state.db {
        Some(db) => db,
        None => return false,
    };

    // --- Billing gate check ---
    let gate = crate::billing::check_usage_gate(db, &step.user_id, &state.usage_limits, state.billing_enforced);
    if !gate.allowed {
        tracing::warn!(
            "billing gate blocked step {} for user {} — {:?} (step stays pending, will retry next tick)",
            step.step_id,
            step.user_id,
            gate.violation
        );
        return false;
    }

    // --- Build evidence and route through evaluator ---
    let tier = parse_tier(&step.tier);
    let risk = parse_risk(&step.risk);

    let ucb_guard = state.ucb_scorer.read().await;
    let (decision, evidence) = route_step(
        db,
        &step.user_id,
        step,
        tier,
        risk,
        Some(&*ucb_guard),
    );
    drop(ucb_guard);

    // --- Evidence floor check ---
    // For high/critical risk, the evidence floor may block dispatch until
    // sufficient clean evidence is gathered. Currently signals are empty at
    // dispatch time (evidence accumulates after execution), so we log a warning
    // for high-risk steps to ensure observability.
    {
        use cortex_engine::evidence_floor::{check_floor, FloorVerdict};
        let verdict = check_floor(risk, &[]);
        match verdict {
            FloorVerdict::Blocked { missing, .. } => {
                tracing::info!(
                    "evidence floor for step {} ({:?} risk): {} requirement(s) must be satisfied post-execution: {}",
                    step.step_id,
                    risk,
                    missing.len(),
                    missing.join(", "),
                );
            }
            FloorVerdict::Satisfied { .. } => {}
        }
    }

    // --- Autonomy gate ---
    // Determine if this step can proceed autonomously or needs user approval.
    {
        let confidence = decision.score / 100.0; // normalize evaluator score to 0-1
        let is_first = state.cortex_store.as_ref()
            .and_then(|s| s.lock().ok())
            .and_then(|s| s.event_count().ok())
            .map(|c| c == 0)
            .unwrap_or(false);
        let autonomy = cortex_core::autonomy::decide_autonomy(
            confidence.clamp(0.0, 1.0),
            risk,
            is_first,
        );
        if autonomy.requires_user_input() && risk >= RiskLevel::Critical {
            tracing::warn!(
                "autonomy gate: step {} requires explicit approval ({:?} risk, confidence={:.2})",
                step.step_id,
                risk,
                confidence,
            );
        }
    }

    // --- Soma heartbeat: record routing decision ---
    if let Some(heart) = &state.soma_heart {
        heart.record_heartbeat(
            soma::heartbeat::HeartbeatEventType::RouteSelected,
            &serde_json::json!({
                "step_id": step.step_id,
                "provider": decision.provider.to_string(),
                "model": decision.model_id,
                "risk": format!("{:?}", risk),
                "tier": format!("{:?}", tier),
                "score": decision.score,
            }).to_string(),
        );
    }

    // Don't dispatch if no provider is actually available
    if decision.rationale.iter().any(|r| {
        matches!(r, cortex_core::routing::RationaleCode::ProviderUnavailable)
    }) {
        tracing::warn!(
            "no available provider for step {} — all candidates vetoed",
            step.step_id
        );
        db.fail_step(&step.step_id, 0, "no available provider", Some("NoProvider"));
        return false; // Will trigger heal via StepFailed event
    }

    let attempt_id = Uuid::new_v4().to_string();
    let lease_duration = step.kind.lease_duration_ms();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let deadline = now_ms + lease_duration;

    let lease_gen = match db.lease_step(&step.step_id, "scheduler", deadline) {
        Some(g) => g,
        None => {
            tracing::warn!("CAS lease failed for step {} — skipping", step.step_id);
            return false;
        }
    };

    // Record attempt
    db.record_attempt(
        &step.step_id,
        &step.run_id,
        1,
        "scheduler",
        lease_gen,
        Some(&decision.provider.to_string()),
        Some(&decision.model_id),
    );

    // Record decision + evidence
    let decision_id = Uuid::new_v4().to_string();
    let rationale_str = decision
        .rationale
        .iter()
        .map(|r| format!("{:?}", r))
        .collect::<Vec<_>>()
        .join(", ");

    db.record_decision(
        &decision_id,
        &step.user_id,
        Some(&step.run_id),
        Some(&step.step_id),
        &format!("{:?}", evidence.intent.intent),
        &step.risk,
        &step.tier,
        &decision.provider.to_string(),
        &decision.model_id,
        None,
        &rationale_str,
        "auto",
    );

    // Record score evidence per evaluator
    record_evidence(db, &decision_id, &evidence);

    // Build task contract
    let task = cortex_core::task::TaskContract::new(step.objective.clone(), tier, risk);

    // Build step context from predecessors
    let context = build_step_context(db, &step.run_id, &step.step_id);

    // Workspace context: use run_id as logical workspace, look up latest commit
    // from predecessor steps, and pass file_paths from the run's goal
    let base_commit = db.get_run_latest_commit(&step.run_id);
    let allowed_paths = db.get_run_file_paths(&step.run_id);

    // Capture values before decision is moved into msg
    let mc_provider = decision.provider.to_string();
    let mc_model = decision.model_id.clone();
    let mc_pressure = evidence
        .budget
        .pressure_for(decision.provider, tier);

    // Issue a step-scoped sub-delegation from Cortex's heart to the worker
    let step_delegation = issue_step_delegation(state, &step.step_id, deadline, &worker_id);

    let msg = BrainMessage::ExecuteStep {
        run_id: step.run_id.clone(),
        step_id: step.step_id.clone(),
        attempt_id,
        lease_gen,
        lease_deadline_ms: deadline,
        workspace_id: step.run_id.clone(),
        base_commit,
        allowed_paths,
        task,
        decision,
        context,
        delegation: step_delegation,
    };

    match worker_tx.send(msg).await {
        Ok(()) => {
            tracing::info!(
                "dispatched step {} to worker for user {}",
                step.step_id,
                step.user_id
            );

            // Emit MC events for dispatch and routing decision
            state
                .emit_mc_event(
                    &step.user_id,
                    MissionControlEvent::StepDispatched {
                        run_id: step.run_id.clone(),
                        step_id: step.step_id.clone(),
                        provider: mc_provider.clone(),
                        model: mc_model.clone(),
                        tier: step.tier.clone(),
                    },
                )
                .await;
            state
                .emit_mc_event(
                    &step.user_id,
                    MissionControlEvent::RoutingDecision {
                        step_id: step.step_id.clone(),
                        provider: mc_provider,
                        model: mc_model,
                        rationale: rationale_str,
                        pressure: mc_pressure,
                    },
                )
                .await;

            true
        }
        Err(_) => {
            tracing::error!("worker channel closed for user {} — unleasing step {}", step.user_id, step.step_id);
            db.unlease_step(&step.step_id, lease_gen);
            false
        }
    }
}

// --- Evaluator integration ---

fn route_step(
    db: &Database,
    user_id: &str,
    step: &StepRef,
    tier: Tier,
    risk: RiskLevel,
    ucb_scorer: Option<&cortex_engine::bandit::UcbScorer>,
) -> (RoutingDecision, DecisionEvidence) {
    let intent_ev = IntentEvidence {
        intent: kind_to_intent(step.kind),
        confidence: 0.95,
        default_tier: tier,
    };

    let risk_ev = RiskEvidence {
        level: risk,
        basis: cortex_core::evaluator::RiskBasis::Static,
        static_level: risk,
        file_risk: None,
        history_success_rate: None,
    };

    // Load real pressure from usage_events
    let window_ms = WINDOW_SECS * 1000;
    let raw_pressures = db.pressure_for_user(user_id, window_ms);
    let mut pressures = HashMap::new();
    for (provider_str, tier_str, tokens) in &raw_pressures {
        if let (Some(p), Some(t)) = (parse_provider_id(provider_str), parse_tier_opt(tier_str)) {
            let budget = token_budget(p, t) as f64;
            let ratio = if budget > 0.0 {
                *tokens as f64 / budget
            } else {
                0.0
            };
            pressures.insert((p, t), PressureState::from_ratio(ratio));
        }
    }

    let budget_ev = BudgetEvidence { pressures };

    // Load provider reliability
    let reliability = db.provider_reliability(user_id, 24);
    let reliability_map: HashMap<String, (i64, i64)> = reliability
        .into_iter()
        .map(|(p, total, successes)| (p, (total, successes)))
        .collect();

    // Build candidate scores for all available providers × requested tier
    let providers = [ProviderId::Claude, ProviderId::Openai, ProviderId::Gemini];
    let mut candidates = Vec::new();

    for &provider in &providers {
        let provider_str = provider.to_string();

        // Check if any worker has this provider
        // For now, assume all detected providers are available
        let pressure = budget_ev.pressure_for(provider, tier);

        let (success_rate, sample_count) =
            if let Some(&(total, successes)) = reliability_map.get(&provider_str) {
                if total > 0 {
                    (Some(successes as f64 / total as f64), total as u64)
                } else {
                    (None, 0)
                }
            } else {
                (None, 0)
            };

        // Check capability status from DB
        // No capability record = not available (unknown providers default to unauthenticated)
        let cap_status = db.get_provider_status(user_id, &provider_str);
        let authenticated = cap_status
            .as_deref()
            .map(|s| s != "unavailable")
            .unwrap_or(false);

        let estimated_duration = match step.kind {
            StepKind::Search => 30_000,
            StepKind::Execute | StepKind::Heal => 120_000,
            StepKind::Think | StepKind::Review => 180_000,
            StepKind::Test | StepKind::Build | StepKind::Lint => 90_000,
            StepKind::Gate => 30_000,
        };

        // Blend UCB bandit history into success rate for adaptive learning.
        // The bandit tracks contamination-weighted outcomes per (TaskFamily, RiskLevel, Provider),
        // which is more granular than the DB's per-provider reliability.
        let (blended_rate, blended_count) = if let Some(scorer) = ucb_scorer {
            use cortex_engine::bandit::{ArmKey, TaskFamily};
            let intent = kind_to_intent(step.kind);
            let task_family = TaskFamily::from_intent(&intent);
            let arm_key = ArmKey { task_family, risk_level: risk, provider };
            if let Some(arm_stats) = scorer.arms.get(&arm_key) {
                let bandit_rate = arm_stats.mean_reward();
                let bandit_count = arm_stats.trials as u64;
                // Weighted blend: bandit history + DB reliability
                match (success_rate, sample_count) {
                    (Some(db_rate), db_count) if db_count > 0 => {
                        let total = db_count + bandit_count;
                        let blended = (db_rate * db_count as f64 + bandit_rate * bandit_count as f64) / total as f64;
                        (Some(blended), total)
                    }
                    _ => (Some(bandit_rate), bandit_count),
                }
            } else {
                (success_rate, sample_count)
            }
        } else {
            (success_rate, sample_count)
        };

        candidates.push(CandidateScore {
            provider,
            tier,
            worker_id: None,
            authenticated,
            pressure,
            success_rate: blended_rate,
            sample_count: blended_count,
            estimated_duration_ms: estimated_duration,
        });
    }

    let fit_ev = ProviderFitEvidence { candidates };

    let evidence = DecisionEvidence {
        intent: intent_ev,
        risk: risk_ev,
        budget: budget_ev,
        provider_fit: fit_ev,
    };

    // Get user profile (or default to auto)
    let profile = db
        .get_user_profile(user_id)
        .and_then(|p| Profile::from_alias(&p))
        .unwrap_or(Profile::Auto);

    let auto_mode = db
        .get_user_auto_mode(user_id)
        .and_then(|m| parse_auto_mode(&m))
        .unwrap_or(AutoMode::Normal);

    let policy = DefaultPolicy;
    let decision = policy.decide(&evidence, profile, auto_mode);

    (decision, evidence)
}

async fn update_bandit_from_outcome(state: &AppState, db: &Database, step_id: &str, success: bool, cost_estimate: Option<f64>) {
    use cortex_engine::bandit::{ArmKey, TaskFamily};

    let step_info = db.get_step_info(step_id);
    let (provider_str, kind_str, risk_str) = match step_info {
        Some(info) => info,
        None => return,
    };

    let provider = match parse_provider_id(&provider_str) {
        Some(p) => p,
        None => return,
    };
    let risk = parse_risk(&risk_str);
    let kind = parse_step_kind(&kind_str);
    let intent = kind_to_intent(kind);
    let task_family = TaskFamily::from_intent(&intent);

    // Contamination: AI-executed steps have base contamination of 0.3.
    // Success from compiler/test evidence would be lower, but we don't have
    // signal details at this point. Use a conservative default.
    let contamination = 0.3;

    let arm_key = ArmKey {
        task_family,
        risk_level: risk,
        provider,
    };

    let reward = if success { 1.0 } else { 0.0 };

    let mut scorer = state.ucb_scorer.write().await;
    scorer.update(arm_key, reward, contamination);

    // Persist to store
    if let Some(store_mutex) = &state.cortex_store {
        if let Ok(store) = store_mutex.lock() {
            if let Some(stats) = scorer.arms.get(&arm_key) {
                let _ = store.save_arm_stats(&arm_key, stats);
            }
        }
    }

    let trials = scorer.arms.get(&arm_key).map(|s| s.trials).unwrap_or(0);
    let mean_reward = scorer.arms.get(&arm_key).map(|s| s.mean_reward()).unwrap_or(0.0);

    tracing::debug!(
        "bandit update: {:?}/{:?}/{:?} reward={:.2} contamination={:.2} trials={}",
        task_family, risk, provider, reward, contamination, trials,
    );

    // Record Soma spend receipt with real cost (falls back to 1.0 credit if no estimate)
    if success {
        if let Some(heart) = &state.soma_heart {
            let cost = cost_estimate.unwrap_or(1.0);
            if let Err(e) = heart.record_spend(
                step_id,
                cost,
                &format!("route:{:?}", intent),
            ) {
                tracing::warn!("soma spend receipt failed: {e}");
            }
        }
    }

    // Emit MC event for real-time routing intelligence visibility
    if let Some(db) = &state.db {
        let user_id = db.get_step_run_id(step_id)
            .and_then(|run_id| db.get_run_user_id(&run_id));
        if let Some(user_id) = user_id {
            state.emit_mc_event(
                &user_id,
                MissionControlEvent::BanditUpdate {
                    provider: provider.to_string(),
                    task_family: format!("{:?}", task_family),
                    risk: format!("{:?}", risk),
                    trials,
                    mean_reward,
                    success,
                },
            ).await;
        }
    }
}

fn record_evidence(db: &Database, decision_id: &str, evidence: &DecisionEvidence) {
    let now = chrono::Utc::now().timestamp_millis();

    // Intent evidence
    if let Ok(json) = serde_json::to_string(&evidence.intent) {
        db.record_score_evidence(decision_id, "intent", &json, Some(evidence.intent.confidence), now);
    }

    // Risk evidence
    if let Ok(json) = serde_json::to_string(&evidence.risk) {
        db.record_score_evidence(decision_id, "risk", &json, None, now);
    }

    // Budget evidence (just store pressure ratios)
    let budget_summary: HashMap<String, f64> = evidence
        .budget
        .pressures
        .iter()
        .map(|((p, t), s)| (format!("{}:{}", p, t), s.ratio()))
        .collect();
    if let Ok(json) = serde_json::to_string(&budget_summary) {
        db.record_score_evidence(decision_id, "budget", &json, None, now);
    }

    // Provider fit evidence (candidate count)
    if let Ok(json) = serde_json::to_string(&evidence.provider_fit) {
        db.record_score_evidence(
            decision_id,
            "provider_fit",
            &json,
            None,
            now,
        );
    }
}

// --- Sub-delegation for worker steps ---

fn issue_step_delegation(state: &AppState, step_id: &str, lease_deadline_ms: i64, worker_id: &str) -> Option<serde_json::Value> {
    let heart = state.soma_heart.as_ref()?;

    let caveats = vec![
        soma::delegation::Caveat::ExpiresAt {
            timestamp: lease_deadline_ms as u64,
        },
        soma::delegation::Caveat::Capabilities {
            allow: vec![format!("execute:step:{step_id}")],
        },
        soma::delegation::Caveat::MaxInvocations { count: 1 },
        soma::delegation::Caveat::Audience {
            did: heart.identity.did.clone(),
        },
    ];

    // Use the worker_id as subject — workers don't have DIDs yet,
    // so we use a deterministic DID-like identifier derived from the worker_id.
    let worker_subject = format!("did:cortex:worker:{worker_id}");

    match soma::delegation::create_delegation(
        &heart.identity.secret_key,
        &heart.identity.public_key,
        &heart.identity.did,
        &worker_subject,
        vec![format!("execute:step:{step_id}")],
        caveats,
        None,
    ) {
        Ok(delegation) => {
            heart.record_heartbeat(
                soma::heartbeat::HeartbeatEventType::DelegationIssued,
                &serde_json::json!({
                    "delegation_id": delegation.id,
                    "step_id": step_id,
                    "worker_id": worker_id,
                    "subject": worker_subject,
                    "capability": format!("execute:step:{step_id}"),
                })
                .to_string(),
            );
            serde_json::to_value(&delegation).ok()
        }
        Err(e) => {
            tracing::warn!("failed to issue step delegation: {e}");
            None
        }
    }
}

// --- Step context builder ---

fn build_step_context(db: &Database, run_id: &str, step_id: &str) -> StepContext {
    let goal = db
        .get_run_goal(run_id)
        .unwrap_or_else(|| "unknown goal".into());

    // Get predecessor step IDs from dependencies
    let predecessors = db.get_step_predecessors(step_id);

    let summaries: Vec<PredecessorSummary> = predecessors
        .into_iter()
        .filter_map(|pred_id| {
            let (kind, _, _, _) = db.get_step_details(&pred_id)?;
            let summary = db.get_step_output_summary(&pred_id).unwrap_or_default();
            let files = db
                .get_step_files_changed(&pred_id)
                .and_then(|json| serde_json::from_str::<Vec<String>>(&json).ok())
                .unwrap_or_default();

            if summary.is_empty() && files.is_empty() {
                return None;
            }

            Some(PredecessorSummary {
                step_id: pred_id,
                kind,
                summary,
                files_changed: files,
            })
        })
        .collect();

    StepContext {
        predecessor_summaries: summaries,
        user_goal: goal,
        conversation_excerpt: None,
    }
}

// --- Load ready steps ---

async fn load_ready_steps_for_run(state: &AppState, sched: &mut SchedulerState, run_id: &str) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    let ready_ids = db.find_ready_steps(run_id);
    let user_id = get_run_user(db, run_id);

    for step_id in ready_ids {
        if let Some((kind, tier, risk, objective)) = db.get_step_details(&step_id) {
            let step_kind = parse_step_kind(&kind);
            sched.enqueue_ready_step(StepRef {
                step_id,
                run_id: run_id.to_string(),
                user_id: user_id.clone(),
                kind: step_kind,
                tier,
                risk,
                objective,
            });
        }
    }
}

// --- Heal insertion ---

async fn try_heal(state: &AppState, _sched: &mut SchedulerState, run_id: &str, step_id: &str) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    let (kind_str, tier, risk, objective) = match db.get_step_details(step_id) {
        Some(d) => d,
        None => return,
    };

    let kind = parse_step_kind(&kind_str);
    if !kind.is_healable() {
        return;
    }

    let heal_count = db.get_run_heal_count(run_id);

    // Get max heals from profile
    let profile = db
        .get_run_profile(run_id)
        .and_then(|p| Profile::from_alias(&p))
        .unwrap_or(Profile::Auto);
    let max_heals = profile.heal_attempts() as i32;

    if heal_count >= max_heals {
        tracing::info!(
            "run {run_id} exhausted heal budget ({heal_count}/{max_heals}), not healing step {step_id}"
        );
        let skipped = db.cascade_failure(step_id);
        if !skipped.is_empty() {
            tracing::info!(
                "cascaded failure from step {step_id}: skipped {} downstream steps",
                skipped.len()
            );
        }
        return;
    }

    let last_error = db.get_step_last_error(step_id);

    let plan = plan_heal(
        step_id,
        kind,
        &objective,
        &tier,
        &risk,
        last_error.as_deref(),
        heal_count as u32 + 1,
    );

    let now_ms = chrono::Utc::now().timestamp_millis();

    // Calculate exponential backoff with jitter before re-dispatching heal steps.
    // base_delay * 2^(attempt-1), capped at 120s, with ±25% hash-based jitter.
    let attempt = heal_count as u32 + 1;
    let base_delay_ms: i64 = 5_000;
    let max_delay_ms: i64 = 120_000;
    let raw_delay = base_delay_ms.saturating_mul(1_i64 << (attempt - 1).min(20));
    let capped_delay = raw_delay.min(max_delay_ms);

    // Hash-based jitter: use step_id bytes to get a deterministic ±25% offset
    let hash_val: u64 = step_id
        .bytes()
        .fold(0xcbf29ce484222325_u64, |h, b| {
            h.wrapping_mul(0x100000001b3).wrapping_add(b as u64)
        });
    let jitter_range = capped_delay / 4; // 25%
    let jitter = if jitter_range > 0 {
        (hash_val % (jitter_range as u64 * 2)) as i64 - jitter_range
    } else {
        0
    };
    let backoff_delay = (capped_delay + jitter).max(1_000); // at least 1s
    let earliest_dispatch_at = now_ms + backoff_delay;

    db.create_step_with_id(
        &plan.heal_step_id,
        run_id,
        "heal",
        &tier,
        &risk,
        &plan.heal_objective,
        now_ms,
    );
    db.set_step_earliest_dispatch(&plan.heal_step_id, earliest_dispatch_at);
    db.add_step_dependency(
        &plan.heal_step_id,
        step_id,
        EdgeType::CompletionRequired.as_str(),
    );

    db.create_step_with_id(
        &plan.retry_step_id,
        run_id,
        &kind_str,
        &tier,
        &risk,
        &plan.retry_objective,
        now_ms,
    );
    db.add_step_dependency(
        &plan.retry_step_id,
        &plan.heal_step_id,
        EdgeType::SuccessRequired.as_str(),
    );

    db.increment_heal_count(run_id);

    tracing::info!(
        "inserted heal chain for step {step_id}: heal={} → retry={} (backoff {backoff_delay}ms, dispatch after {})",
        plan.heal_step_id,
        plan.retry_step_id,
        earliest_dispatch_at,
    );
}

// --- Run completion ---

async fn check_run_done(state: &AppState, run_id: &str) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    let step_statuses = db.get_all_step_statuses(run_id);
    let parsed: Vec<(String, StepStatus)> = step_statuses
        .into_iter()
        .filter_map(|(id, status_str)| StepStatus::from_str(&status_str).map(|s| (id, s)))
        .collect();

    if let Some(final_status) = check_run_completion(&parsed) {
        let status_str = match final_status {
            RunStatus::Succeeded => "succeeded",
            RunStatus::Failed => "failed",
            _ => return,
        };

        // Guard against double completion: check if run is already terminal
        if let Some(run_info) = db.list_user_runs_by_id(run_id) {
            if let Some(current_status) = run_info.get("status").and_then(|s| s.as_str()) {
                if let Some(rs) = RunStatus::from_str(current_status) {
                    if rs.is_terminal() {
                        tracing::debug!("run {run_id} already in terminal state '{current_status}', skipping update");
                        return;
                    }
                }
            }
        }

        db.update_run_status(run_id, status_str, None);

        // Log branch info for PR creation if the run succeeded with changes
        if final_status == RunStatus::Succeeded {
            if let Some(branch) = db.get_run_branch(run_id) {
                tracing::info!(
                    run_id = %run_id,
                    branch = %branch,
                    "run succeeded with branch — ready for PR creation via POST /api/runs/{}/pr",
                    run_id,
                );
            }
        }

        // Emit MC event for run completion
        let user_id = get_run_user(db, run_id);
        state
            .emit_mc_event(
                &user_id,
                MissionControlEvent::RunCompleted {
                    run_id: run_id.to_string(),
                    status: status_str.to_string(),
                    total_cost: None, // TODO: aggregate from step cost_estimates
                },
            )
            .await;

        tracing::info!("run {run_id} → {status_str}");
    }
}

// --- Lease expiry & reconciliation ---

async fn expire_stale_leases(state: &AppState, _sched: &mut SchedulerState) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    let expired = db.expire_stale_leases();
    if !expired.is_empty() {
        tracing::warn!("expired {} stale leases: {:?}", expired.len(), expired);
    }
}

async fn reconcile_ready_steps(state: &AppState, sched: &mut SchedulerState) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    // Single query fetches all ready steps across all active runs,
    // replacing the N+1 pattern of get_active_run_ids() + find_ready_steps() per run.
    let ready = db.find_all_ready_steps();
    for (step_id, run_id, user_id, kind, tier, risk, objective) in ready {
        let step_kind = parse_step_kind(&kind);
        sched.enqueue_ready_step(StepRef {
            step_id,
            run_id,
            user_id,
            kind: step_kind,
            tier,
            risk,
            objective,
        });
    }
}

async fn recover_from_db(state: &AppState, sched: &mut SchedulerState) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    let expired = db.expire_stale_leases();
    if !expired.is_empty() {
        tracing::info!("recovery: expired {} stale leases", expired.len());
    }

    let active_runs = db.get_active_run_ids();
    tracing::info!("recovery: {} active runs found", active_runs.len());

    for run_id in active_runs {
        load_ready_steps_for_run(state, sched, &run_id).await;
    }
}

// --- Grace period expiry ---

async fn expire_grace_periods(state: &AppState, sched: &mut SchedulerState) {
    let db = match &state.db {
        Some(db) => db,
        None => return,
    };

    let expired = db.workers_past_grace();
    if expired.is_empty() {
        return;
    }

    let mut orphaned_steps = Vec::new();
    for (worker_id, step_id) in &expired {
        db.orphan_step(step_id);
        orphaned_steps.push(step_id.clone());
        tracing::warn!(
            "grace period expired for worker {worker_id} — orphaning step {step_id}"
        );
    }

    // Re-enqueue orphaned steps from active runs
    for step_id in &orphaned_steps {
        if let Some(run_id) = db.get_step_run_id(step_id) {
            load_ready_steps_for_run(state, sched, &run_id).await;
        }
    }
}

fn cleanup_expired_keys(state: &AppState) {
    if let Some(db) = &state.db {
        let cleaned = db.cleanup_expired_idempotency();
        if cleaned > 0 {
            tracing::debug!("cleaned {cleaned} expired idempotency keys");
        }
    }
}

// --- Helpers ---

fn get_run_user(db: &Database, run_id: &str) -> String {
    db.get_run_user_id(run_id)
        .unwrap_or_else(|| "unknown".into())
}

fn parse_tier(s: &str) -> Tier {
    match s {
        "search" => Tier::Search,
        "think" => Tier::Think,
        _ => Tier::Execute,
    }
}

fn parse_tier_opt(s: &str) -> Option<Tier> {
    match s {
        "search" => Some(Tier::Search),
        "execute" => Some(Tier::Execute),
        "think" => Some(Tier::Think),
        _ => None,
    }
}

fn parse_risk(s: &str) -> RiskLevel {
    match s {
        "low" => RiskLevel::Low,
        "high" => RiskLevel::High,
        "critical" => RiskLevel::Critical,
        _ => RiskLevel::Medium,
    }
}

fn parse_provider_id(s: &str) -> Option<ProviderId> {
    match s {
        "claude" => Some(ProviderId::Claude),
        "openai" => Some(ProviderId::Openai),
        "gemini" => Some(ProviderId::Gemini),
        _ => None,
    }
}

fn parse_auto_mode(s: &str) -> Option<AutoMode> {
    match s {
        "normal" => Some(AutoMode::Normal),
        "protect_budget" => Some(AutoMode::ProtectBudget),
        "protect_quality" => Some(AutoMode::ProtectQuality),
        "recovering" => Some(AutoMode::Recovering),
        _ => None,
    }
}

fn parse_step_kind(s: &str) -> StepKind {
    match s {
        "search" => StepKind::Search,
        "execute" => StepKind::Execute,
        "think" => StepKind::Think,
        "test" => StepKind::Test,
        "build" => StepKind::Build,
        "lint" => StepKind::Lint,
        "heal" => StepKind::Heal,
        "review" => StepKind::Review,
        "gate" => StepKind::Gate,
        _ => StepKind::Execute,
    }
}

fn kind_to_intent(kind: StepKind) -> Intent {
    match kind {
        StepKind::Search => Intent::Explore,
        StepKind::Execute | StepKind::Heal => Intent::Fix,
        StepKind::Think | StepKind::Review => Intent::Think,
        StepKind::Test | StepKind::Build | StepKind::Lint | StepKind::Gate => Intent::Test,
    }
}

// --- Public API for creating runs ---

pub async fn create_run_from_goal(
    state: &AppState,
    scheduler_tx: &SchedulerTx,
    user_id: &str,
    goal: &str,
    file_paths: &[String],
    profile: &str,
) -> Result<String, String> {
    use cortex_engine::decomposer::decompose_goal;

    let builder = decompose_goal(user_id, goal, file_paths, profile)?;

    let db = state.db.as_ref().ok_or("database not available")?;
    let now_ms = chrono::Utc::now().timestamp_millis();

    // Collect steps and edges for batch insertion in a single transaction
    let steps: Vec<(String, String, String, String, String, i64)> = builder
        .steps()
        .iter()
        .map(|step| {
            (
                step.id.clone(),
                step.kind.as_str().to_string(),
                step.tier.clone(),
                step.risk.clone(),
                step.objective.clone(),
                now_ms,
            )
        })
        .collect();

    let edges: Vec<(String, String, String)> = builder
        .edges()
        .iter()
        .map(|&(from_idx, to_idx, edge_type)| {
            let from_id = builder.step_id(from_idx);
            let to_id = builder.step_id(to_idx);
            (to_id.to_string(), from_id.to_string(), edge_type.as_str().to_string())
        })
        .collect();

    let run_id = db.create_run_with_steps(user_id, goal, profile, file_paths, &steps, &edges);

    scheduler_tx
        .send(SchedulerEvent::RunCreated {
            run_id: run_id.clone(),
        })
        .await
        .map_err(|_| "scheduler channel closed")?;

    tracing::info!(
        "created run {run_id}: {} steps, {} edges",
        builder.steps().len(),
        builder.edges().len()
    );

    Ok(run_id)
}
