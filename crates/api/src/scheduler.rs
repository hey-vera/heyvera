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
        }
    }
}

async fn apply_event(state: &AppState, sched: &mut SchedulerState, event: &SchedulerEvent) {
    match event {
        SchedulerEvent::RunCreated { run_id } => {
            tracing::info!("scheduler: run created {run_id}");
            if let Some(db) = &state.db {
                db.update_run_status(run_id, "running", None);
            }
            load_ready_steps_for_run(state, sched, run_id).await;
        }

        SchedulerEvent::StepCompleted { run_id, step_id } => {
            tracing::info!("scheduler: step completed {step_id} in run {run_id}");
            if let Some(db) = &state.db {
                let user_id = get_run_user(db, run_id);
                sched.mark_step_done(&user_id);
            }
            load_ready_steps_for_run(state, sched, run_id).await;
            check_run_done(state, run_id).await;
        }

        SchedulerEvent::StepFailed { run_id, step_id } => {
            tracing::info!("scheduler: step failed {step_id} in run {run_id}");
            if let Some(db) = &state.db {
                let user_id = get_run_user(db, run_id);
                sched.mark_step_done(&user_id);
            }
            try_heal(state, sched, run_id, step_id).await;
            load_ready_steps_for_run(state, sched, run_id).await;
            check_run_done(state, run_id).await;
        }

        SchedulerEvent::WorkerConnected { worker_id } => {
            tracing::info!("scheduler: worker connected {worker_id}");
        }

        SchedulerEvent::WorkerDisconnected { worker_id } => {
            tracing::info!("scheduler: worker disconnected {worker_id}");
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
    let worker_tx = match state.find_worker_for_user(&step.user_id).await {
        Some(tx) => tx,
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

    // --- Billing gate check (soft by default) ---
    let limits = cortex_core::usage::UsageLimits::default();
    let gate = crate::billing::check_usage_gate(db, &step.user_id, &limits, false);
    if !gate.allowed {
        tracing::warn!(
            "billing gate blocked step {} for user {} — {:?}",
            step.step_id,
            step.user_id,
            gate.violation
        );
        return false;
    }

    // --- Build evidence and route through evaluator ---
    let tier = parse_tier(&step.tier);
    let risk = parse_risk(&step.risk);

    let (decision, evidence) = route_step(db, &step.user_id, step, tier, risk);

    let attempt_id = Uuid::new_v4().to_string();
    let lease_duration = step.kind.lease_duration_ms();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let deadline = now_ms + lease_duration;

    let leased = db.lease_step(&step.step_id, "scheduler", deadline);
    if !leased {
        tracing::warn!("CAS lease failed for step {} — skipping", step.step_id);
        return false;
    }

    let lease_gen = 1;

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

    let msg = BrainMessage::ExecuteStep {
        run_id: step.run_id.clone(),
        step_id: step.step_id.clone(),
        attempt_id,
        lease_gen,
        lease_deadline_ms: deadline,
        workspace_id: "default".to_string(),
        base_commit: None,
        allowed_paths: vec![],
        task,
        decision,
        context,
    };

    match worker_tx.send(msg).await {
        Ok(()) => {
            tracing::info!(
                "dispatched step {} to worker for user {}",
                step.step_id,
                step.user_id
            );
            true
        }
        Err(_) => {
            tracing::error!("worker channel closed for user {}", step.user_id);
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
        let cap_status = db.get_provider_status(user_id, &provider_str);
        let authenticated = cap_status
            .as_deref()
            .map(|s| s != "unavailable")
            .unwrap_or(false);

        // If no capability record exists but provider is in detected list, assume available
        let authenticated = authenticated || cap_status.is_none();

        let estimated_duration = match step.kind {
            StepKind::Search => 30_000,
            StepKind::Execute | StepKind::Heal => 120_000,
            StepKind::Think | StepKind::Review => 180_000,
            StepKind::Test | StepKind::Build | StepKind::Lint => 90_000,
            StepKind::Gate => 30_000,
        };

        candidates.push(CandidateScore {
            provider,
            tier,
            worker_id: None,
            authenticated,
            pressure,
            success_rate,
            sample_count,
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

async fn try_heal(state: &AppState, sched: &mut SchedulerState, run_id: &str, step_id: &str) {
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

    db.create_step_with_id(
        &plan.heal_step_id,
        run_id,
        "heal",
        &tier,
        &risk,
        &plan.heal_objective,
        now_ms,
    );
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
        "inserted heal chain for step {step_id}: heal={} → retry={}",
        plan.heal_step_id,
        plan.retry_step_id
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

    let active_runs = db.get_active_run_ids();
    for run_id in active_runs {
        load_ready_steps_for_run(state, sched, &run_id).await;
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

    let run_id = db.create_run(user_id, goal, profile);

    for step in builder.steps() {
        db.create_step_with_id(
            &step.id,
            &run_id,
            step.kind.as_str(),
            &step.tier,
            &step.risk,
            &step.objective,
            now_ms,
        );
    }

    for &(from_idx, to_idx, edge_type) in builder.edges() {
        let from_id = builder.step_id(from_idx);
        let to_id = builder.step_id(to_idx);
        db.add_step_dependency(to_id, from_id, edge_type.as_str());
    }

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
