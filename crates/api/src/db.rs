use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use chrono::{Datelike, Utc};
use cortex_core::task::TaskContract;
use cortex_core::usage::{DailyUsage, ProviderUsage, UsageSummary, estimate_cost_by_provider};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub struct Database {
    conn: Mutex<Connection>,
}

// --- Conversation types (existing) ---

#[derive(Debug, Serialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub user_id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationWithMessages {
    #[serde(flatten)]
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

#[derive(Debug, Serialize)]
pub struct ConversationSummary {
    pub id: String,
    pub title: Option<String>,
    pub updated_at: String,
    pub message_count: i64,
    pub last_message_preview: Option<String>,
}

pub struct ActiveRunSummary {
    pub id: String,
    pub goal: String,
    pub status: String,
    pub created_at: String,
    pub step_count: usize,
    pub steps_completed: usize,
    pub steps_failed: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VerifierReport {
    pub id: String,
    pub step_id: String,
    pub run_id: String,
    pub lease_gen: i64,
    pub worker_id: Option<String>,
    pub verifier: String,
    pub status: String,
    pub verdict: String,
    pub evidence_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl VerifierReport {
    pub fn is_verified_success(&self) -> bool {
        self.status == "verified" && self.verdict == "pass"
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationsEvent {
    pub id: String,
    pub created_at: i64,
    pub actor_user_id: Option<String>,
    pub scope_id: Option<String>,
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    pub run_id: Option<String>,
    pub step_id: Option<String>,
    pub attempt_id: Option<String>,
    pub event_type: String,
    pub entity_type: String,
    pub entity_id: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepDependencyEdge {
    pub step_id: String,
    pub depends_on_id: String,
    pub edge_type: String,
}

pub struct RunStepSnapshot {
    pub id: String,
    pub status: String,
    pub kind: String,
    pub work_kind: String,
    pub tier: String,
    pub risk: String,
    pub objective: String,
    pub attempt_count: i64,
    pub max_attempts: i64,
    pub lease_gen: i64,
    pub lease_deadline: Option<i64>,
    pub assigned_worker: Option<String>,
    pub recipe_seed_json: Option<String>,
    pub output_summary: Option<String>,
    pub files_changed: Option<String>,
    pub last_error: Option<String>,
    pub predecessors: Vec<String>,
    pub verifier_report: Option<VerifierReport>,
    pub work_contract: Option<TaskContract>,
    pub latest_attempt: Option<RunStepAttemptSnapshot>,
}

pub struct RunStepAttemptSnapshot {
    pub attempt_number: i64,
    pub worker_id: Option<String>,
    pub lease_gen: i64,
    pub status: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub failure_kind: Option<String>,
    pub error_summary: Option<String>,
}

// --- Billing types ---

pub struct SubscriptionRecord {
    pub clerk_user_id: String,
    pub stripe_customer_id: String,
    pub stripe_subscription_id: Option<String>,
    pub plan_type: String,
    pub status: String,
    pub trial_end: Option<String>,
    pub current_period_start: Option<String>,
    pub current_period_end: Option<String>,
}

pub struct CreditBalanceRecord {
    pub subscription_remaining: f64,
    pub subscription_total: f64,
    pub pack_remaining: f64,
}

pub struct BillingHistoryRecord {
    pub id: String,
    pub amount_cents: i64,
    pub description: String,
    pub status: String,
    pub created_at: String,
}

pub struct ReferralCodeRecord {
    pub code: String,
    pub creator_user_id: String,
    pub uses_remaining: i32,
    pub total_uses: i32,
    pub weeks_earned: i32,
}

#[derive(Debug, Serialize, Clone)]
pub struct PromoCode {
    pub id: String,
    pub code: String,
    pub discount_type: String,
    pub discount_value: f64,
    pub max_uses: i32,
    pub current_uses: i32,
    pub expires_at: Option<String>,
    pub active: bool,
    pub created_by: String,
    pub created_at: String,
    pub description: Option<String>,
    pub discount_options: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CodeRedemption {
    pub id: String,
    pub promo_code_id: String,
    pub code: String,
    pub user_id: String,
    pub redeemed_at: String,
}

// --- Schema version ---

const SCHEMA_VERSION: i64 = 21;

fn apply_migrations(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        );"
    ).expect("failed to create schema_version table");

    let current: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))
        .unwrap_or(0);

    if current < 1 {
        migrate_v1(conn);
    }
    if current < 2 {
        migrate_v2(conn);
    }
    if current < 3 {
        migrate_v3(conn);
    }
    if current < 4 {
        migrate_v4(conn);
    }
    if current < 5 {
        migrate_v5(conn);
    }
    if current < 6 {
        migrate_v6(conn);
    }
    if current < 7 {
        migrate_v7(conn);
    }
    if current < 8 {
        migrate_v8(conn);
    }
    if current < 9 {
        migrate_v9(conn);
    }
    if current < 10 {
        migrate_v10(conn);
    }
    if current < 11 {
        migrate_v11(conn);
    }
    if current < 12 {
        migrate_v12(conn);
    }
    if current < 13 {
        migrate_v13(conn);
    }
    if current < 14 {
        migrate_v14(conn);
    }
    if current < 15 {
        migrate_v15(conn);
    }
    if current < 16 {
        migrate_v16(conn);
    }
    if current < 17 {
        migrate_v17(conn);
    }
    if current < 18 {
        migrate_v18(conn);
    }
    if current < 19 {
        migrate_v19(conn);
    }
    if current < 20 {
        migrate_v20(conn);
    }
    if current < 21 {
        migrate_v21(conn);
    }
}

fn migrate_v1(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            provider TEXT,
            model TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_user
            ON conversations(user_id, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_messages_conversation
            ON messages(conversation_id, created_at ASC);

        INSERT OR REPLACE INTO schema_version (version) VALUES (1);"
    ).expect("migration v1 failed");

    tracing::info!("applied migration v1: conversations + messages");
}

fn migrate_v2(conn: &Connection) {
    conn.execute_batch(
        "-- Workers (Brain-minted identities)
        CREATE TABLE IF NOT EXISTS workers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'connected',
            created_at INTEGER NOT NULL,
            last_seen INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS worker_sessions (
            id TEXT PRIMARY KEY,
            worker_id TEXT NOT NULL REFERENCES workers(id),
            connected_at INTEGER NOT NULL,
            disconnected_at INTEGER,
            last_heartbeat INTEGER NOT NULL,
            grace_deadline INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_worker_sessions_worker
            ON worker_sessions(worker_id);

        -- Provider capabilities
        CREATE TABLE IF NOT EXISTS provider_capabilities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            worker_id TEXT NOT NULL REFERENCES workers(id),
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            cli_version TEXT,
            status TEXT NOT NULL DEFAULT 'claimed',
            last_reported INTEGER NOT NULL,
            last_verified INTEGER,
            last_success INTEGER,
            last_failure INTEGER,
            failure_streak INTEGER NOT NULL DEFAULT 0,
            UNIQUE(worker_id, provider)
        );

        CREATE INDEX IF NOT EXISTS idx_capabilities_user
            ON provider_capabilities(user_id, provider);

        -- User profiles
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            active_profile TEXT NOT NULL DEFAULT 'auto',
            auto_mode TEXT NOT NULL DEFAULT 'normal',
            auto_mode_since INTEGER,
            custom_overrides TEXT,
            updated_at INTEGER NOT NULL
        );

        -- Decision ledger
        CREATE TABLE IF NOT EXISTS decisions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            run_id TEXT,
            step_id TEXT,
            timestamp INTEGER NOT NULL,
            intent TEXT NOT NULL,
            risk TEXT NOT NULL,
            tier TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            worker_id TEXT,
            rationale TEXT NOT NULL,
            profile TEXT NOT NULL DEFAULT 'auto'
        );

        CREATE INDEX IF NOT EXISTS idx_decisions_user_ts
            ON decisions(user_id, timestamp DESC);

        CREATE TABLE IF NOT EXISTS outcomes (
            id TEXT PRIMARY KEY,
            decision_id TEXT NOT NULL REFERENCES decisions(id),
            timestamp INTEGER NOT NULL,
            success INTEGER NOT NULL,
            duration_ms INTEGER,
            failure_kind TEXT,
            failure_scope TEXT,
            files_changed TEXT,
            exit_code INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_outcomes_decision
            ON outcomes(decision_id);

        CREATE INDEX IF NOT EXISTS idx_outcomes_ts
            ON outcomes(timestamp DESC);

        -- Score evidence
        CREATE TABLE IF NOT EXISTS score_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            decision_id TEXT NOT NULL REFERENCES decisions(id),
            evaluator TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            score REAL,
            timestamp INTEGER NOT NULL
        );

        -- Usage tracking (pressure calculation)
        CREATE TABLE IF NOT EXISTS usage_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            provider TEXT NOT NULL,
            tier TEXT NOT NULL,
            model TEXT NOT NULL,
            worker_id TEXT,
            tokens_in INTEGER,
            tokens_out INTEGER,
            duration_ms INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_usage_window
            ON usage_events(user_id, provider, timestamp);

        -- Runs (Ship Captain orchestration)
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            goal TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            profile TEXT NOT NULL DEFAULT 'auto',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            started_at INTEGER,
            finished_at INTEGER,
            failure_reason TEXT,
            heal_attempts INTEGER NOT NULL DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_runs_user_status
            ON runs(user_id, status);

        -- Steps
        CREATE TABLE IF NOT EXISTS steps (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES runs(id),
            kind TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            work_kind TEXT NOT NULL DEFAULT 'modify',
            recipe_seed_json TEXT,
            tier TEXT NOT NULL,
            risk TEXT NOT NULL,
            objective TEXT NOT NULL,
            required_provider TEXT,
            required_repo TEXT,
            input_context TEXT,
            output_summary TEXT,
            files_changed TEXT,
            base_commit TEXT,
            head_commit TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            lease_gen INTEGER NOT NULL DEFAULT 0,
            lease_deadline INTEGER,
            assigned_worker TEXT REFERENCES workers(id),
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_steps_run
            ON steps(run_id, status);

        CREATE INDEX IF NOT EXISTS idx_steps_pending
            ON steps(run_id, status) WHERE status = 'pending';

        CREATE INDEX IF NOT EXISTS idx_steps_leased
            ON steps(status, lease_deadline) WHERE status = 'leased';

        -- Step dependencies (normalized, typed edges)
        CREATE TABLE IF NOT EXISTS step_dependencies (
            step_id TEXT NOT NULL REFERENCES steps(id),
            depends_on_id TEXT NOT NULL REFERENCES steps(id),
            edge_type TEXT NOT NULL DEFAULT 'success_required',
            PRIMARY KEY (step_id, depends_on_id)
        );

        -- Step attempts (minimal history for debugging)
        CREATE TABLE IF NOT EXISTS step_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step_id TEXT NOT NULL REFERENCES steps(id),
            run_id TEXT NOT NULL,
            attempt_number INTEGER NOT NULL,
            worker_id TEXT,
            lease_gen INTEGER NOT NULL,
            status TEXT NOT NULL,
            provider TEXT,
            model TEXT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            failure_kind TEXT,
            error_summary TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_attempts_step
            ON step_attempts(step_id, attempt_number);

        -- Artifacts
        CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            step_id TEXT NOT NULL REFERENCES steps(id),
            attempt_number INTEGER NOT NULL,
            kind TEXT NOT NULL,
            uri TEXT NOT NULL,
            sha256 TEXT,
            size_bytes INTEGER,
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_artifacts_step
            ON artifacts(step_id);

        -- Idempotency keys (message dedup)
        CREATE TABLE IF NOT EXISTS idempotency_keys (
            key TEXT PRIMARY KEY,
            result_json TEXT,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );

        UPDATE schema_version SET version = 2;"
    ).expect("migration v2 failed");

    tracing::info!("applied migration v2: workers, capabilities, profiles, decisions, runs, steps, dependencies, attempts, artifacts");
}

fn migrate_v3(conn: &Connection) {
    // Add a branch column to runs for PR creation after step completion.
    conn.execute_batch(
        "ALTER TABLE runs ADD COLUMN branch TEXT;

        UPDATE schema_version SET version = 3;"
    ).expect("migration v3 failed");

    tracing::info!("applied migration v3: runs.branch column for PR creation");
}

fn migrate_v4(conn: &Connection) {
    // Add earliest_dispatch_at column for retry backoff on heal steps.
    // NULL means "dispatch immediately" (backwards-compatible default).
    conn.execute_batch(
        "ALTER TABLE steps ADD COLUMN earliest_dispatch_at INTEGER;

        UPDATE schema_version SET version = 4;"
    ).expect("migration v4 failed");

    tracing::info!("applied migration v4: steps.earliest_dispatch_at for retry backoff");
}

fn migrate_v5(conn: &Connection) {
    // Add file_paths column to runs for workspace context.
    // Stored as JSON text (array of strings). NULL means no specific paths.
    conn.execute_batch(
        "ALTER TABLE runs ADD COLUMN file_paths TEXT;

        UPDATE schema_version SET version = 5;"
    ).expect("migration v5 failed");

    tracing::info!("applied migration v5: runs.file_paths for workspace context");
}

fn migrate_v6(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS subscriptions (
            clerk_user_id TEXT PRIMARY KEY,
            stripe_customer_id TEXT NOT NULL,
            stripe_subscription_id TEXT,
            plan_type TEXT NOT NULL DEFAULT 'monthly',
            status TEXT NOT NULL DEFAULT 'trialing',
            trial_end TEXT,
            current_period_start TEXT,
            current_period_end TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS credit_balances (
            clerk_user_id TEXT PRIMARY KEY,
            subscription_remaining REAL NOT NULL DEFAULT 200.0,
            subscription_total REAL NOT NULL DEFAULT 200.0,
            pack_remaining REAL NOT NULL DEFAULT 0.0,
            last_reset_at TEXT
        );

        CREATE TABLE IF NOT EXISTS credit_transactions (
            id TEXT PRIMARY KEY,
            clerk_user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_type TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS billing_history (
            id TEXT PRIMARY KEY,
            clerk_user_id TEXT NOT NULL,
            stripe_event_id TEXT UNIQUE,
            amount_cents INTEGER NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS referral_codes (
            code TEXT PRIMARY KEY,
            creator_user_id TEXT NOT NULL,
            uses_remaining INTEGER NOT NULL DEFAULT 1,
            total_uses INTEGER NOT NULL DEFAULT 0,
            credits_earned REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        UPDATE schema_version SET version = 6;"
    ).expect("migration v6 failed");

    tracing::info!("applied migration v6: subscriptions, credit_balances, credit_transactions, billing_history, referral_codes");
}

fn migrate_v7(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS promo_codes (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            discount_type TEXT NOT NULL DEFAULT 'trial_extension',
            discount_value REAL NOT NULL DEFAULT 14.0,
            max_uses INTEGER NOT NULL DEFAULT 25,
            current_uses INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS code_redemptions (
            id TEXT PRIMARY KEY,
            promo_code_id TEXT NOT NULL REFERENCES promo_codes(id),
            code TEXT NOT NULL,
            user_id TEXT NOT NULL,
            redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(code, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_code_redemptions_user ON code_redemptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_code_redemptions_code ON code_redemptions(code);

        UPDATE schema_version SET version = 7;"
    ).expect("migration v7 failed");

    tracing::info!("applied migration v7: promo_codes, code_redemptions");
}

fn migrate_v8(conn: &Connection) {
    conn.execute(
        "ALTER TABLE referral_codes ADD COLUMN weeks_earned INTEGER NOT NULL DEFAULT 0",
        [],
    ).ok();

    conn.execute(
        "ALTER TABLE referral_codes ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 50",
        [],
    ).ok();

    conn.execute_batch(
        "UPDATE schema_version SET version = 8;"
    ).expect("migration v8 failed");

    tracing::info!("applied migration v8: referral_codes weeks_earned + max_uses");
}

fn migrate_v9(conn: &Connection) {
    conn.execute(
        "ALTER TABLE promo_codes ADD COLUMN discount_options TEXT",
        [],
    ).ok();

    conn.execute_batch(
        "UPDATE schema_version SET version = 9;"
    ).expect("migration v9 failed");

    tracing::info!("applied migration v9: promo_codes discount_options JSON column");
}

fn migrate_v10(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cortex_groups (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'team',
            description TEXT NOT NULL DEFAULT 'Shared coordination',
            members INTEGER NOT NULL DEFAULT 1,
            accent TEXT NOT NULL DEFAULT '#9cc7b8',
            source TEXT NOT NULL DEFAULT 'manual',
            external_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, source, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_cortex_groups_user
            ON cortex_groups(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS group_task_state (
            group_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (group_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS integration_connections (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            external_id TEXT,
            display_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'connected',
            scopes TEXT NOT NULL DEFAULT '[]',
            access_token TEXT,
            refresh_token TEXT,
            token_expires_at TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            last_sync_at TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, provider, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_integration_connections_user
            ON integration_connections(user_id, provider);

        CREATE TABLE IF NOT EXISTS integration_mappings (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            group_id TEXT NOT NULL,
            external_id TEXT NOT NULL,
            external_name TEXT NOT NULL,
            mapping_type TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, provider, external_id, mapping_type)
        );
        CREATE INDEX IF NOT EXISTS idx_integration_mappings_group
            ON integration_mappings(user_id, group_id);

        CREATE TABLE IF NOT EXISTS integration_events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            group_id TEXT,
            event_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            payload_json TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            processed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_integration_events_status
            ON integration_events(status, next_attempt_at);

        CREATE TABLE IF NOT EXISTS integration_oauth_states (
            state TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            redirect_after TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL
        );

        UPDATE schema_version SET version = 10;"
    ).expect("migration v10 failed");

    tracing::info!("applied migration v10: Cortex groups, task state, Slack/Replit integration tables");
}

fn migrate_v11(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS context_flow_artifacts (
            id TEXT PRIMARY KEY,
            producer_step_id TEXT NOT NULL,
            producer_run_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            content TEXT NOT NULL,
            summary TEXT NOT NULL,
            files_changed TEXT, -- JSON array
            confidence REAL NOT NULL,
            tokens INTEGER NOT NULL,
            created_at INTEGER NOT NULL, -- milliseconds since epoch
            metadata TEXT -- JSON object
        );

        CREATE INDEX IF NOT EXISTS idx_context_artifacts_run
            ON context_flow_artifacts(producer_run_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_context_artifacts_step
            ON context_flow_artifacts(producer_step_id);

        UPDATE schema_version SET version = 11;"
    ).expect("migration v11 failed");

    tracing::info!("applied migration v11: context_flow_artifacts table for AI model context pipeline");
}

fn migrate_v12(conn: &Connection) {
    conn.execute(
        "ALTER TABLE steps ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'",
        [],
    ).ok();
    conn.execute(
        "ALTER TABLE steps ADD COLUMN verifier_report_id TEXT",
        [],
    ).ok();
    conn.execute(
        "ALTER TABLE steps ADD COLUMN verified_at INTEGER",
        [],
    ).ok();

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS verifier_reports (
            id TEXT PRIMARY KEY,
            step_id TEXT NOT NULL REFERENCES steps(id),
            run_id TEXT NOT NULL REFERENCES runs(id),
            lease_gen INTEGER NOT NULL,
            worker_id TEXT,
            verifier TEXT NOT NULL,
            status TEXT NOT NULL,
            verdict TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_verifier_reports_step
            ON verifier_reports(step_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_verifier_reports_run
            ON verifier_reports(run_id, created_at DESC);

        UPDATE schema_version SET version = 12;"
    ).expect("migration v12 failed");

    tracing::info!("applied migration v12: verifier reports and step verification status");
}

fn migrate_v13(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS step_work_contracts (
            step_id TEXT NOT NULL REFERENCES steps(id),
            lease_gen INTEGER NOT NULL,
            run_id TEXT NOT NULL REFERENCES runs(id),
            contract_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (step_id, lease_gen)
        );

        CREATE INDEX IF NOT EXISTS idx_step_work_contracts_run
            ON step_work_contracts(run_id, created_at DESC);

        UPDATE schema_version SET version = 13;"
    ).expect("migration v13 failed");

    tracing::info!("applied migration v13: persisted step work contracts");
}

fn migrate_v14(conn: &Connection) {
    conn.execute(
        "ALTER TABLE steps ADD COLUMN work_kind TEXT NOT NULL DEFAULT 'modify'",
        [],
    )
    .ok();
    conn.execute_batch("UPDATE schema_version SET version = 14;")
        .expect("migration v14 failed");

    tracing::info!("applied migration v14: steps.work_kind planner recipe intent");
}

fn migrate_v15(conn: &Connection) {
    conn.execute("ALTER TABLE steps ADD COLUMN recipe_seed_json TEXT", [])
        .ok();
    conn.execute_batch("UPDATE schema_version SET version = 15;")
        .expect("migration v15 failed");

    tracing::info!("applied migration v15: steps.recipe_seed_json planner recipe seeds");
}

fn migrate_v16(conn: &Connection) {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_steps_run_created
            ON steps(run_id, created_at ASC, id ASC);

        CREATE INDEX IF NOT EXISTS idx_verifier_reports_run_step_latest
            ON verifier_reports(run_id, step_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_step_work_contracts_run_step_latest
            ON step_work_contracts(run_id, step_id, lease_gen DESC, created_at DESC);

        UPDATE schema_version SET version = 16;"
    ).expect("migration v16 failed");

    tracing::info!("applied migration v16: run payload snapshot indexes");
}

fn migrate_v17(conn: &Connection) {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_step_attempts_run_step_latest
            ON step_attempts(run_id, step_id, attempt_number DESC);

        UPDATE schema_version SET version = 17;"
    ).expect("migration v17 failed");

    tracing::info!("applied migration v17: latest attempt snapshot index");
}

fn migrate_v18(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS operations_events (
            id TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            actor_user_id TEXT,
            scope_id TEXT,
            project_id TEXT,
            task_id TEXT,
            run_id TEXT,
            step_id TEXT,
            attempt_id TEXT,
            event_type TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_operations_events_created_at
            ON operations_events(created_at);

        CREATE INDEX IF NOT EXISTS idx_operations_events_run
            ON operations_events(run_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_operations_events_step
            ON operations_events(step_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_operations_events_entity
            ON operations_events(entity_type, entity_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_operations_events_actor
            ON operations_events(actor_user_id, created_at);

        UPDATE schema_version SET version = 18;"
    ).expect("migration v18 failed");

    tracing::info!("applied migration v18: operations room event log");
}

fn migrate_v19(conn: &Connection) {
    conn.execute("ALTER TABLE runs ADD COLUMN task_id TEXT", []).ok();
    conn.execute("ALTER TABLE runs ADD COLUMN group_id TEXT", []).ok();
    conn.execute("ALTER TABLE runs ADD COLUMN conversation_id TEXT", []).ok();
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_runs_task
            ON runs(user_id, task_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_runs_group
            ON runs(user_id, group_id, created_at DESC);

        UPDATE schema_version SET version = 19;"
    ).expect("migration v19 failed");

    tracing::info!("applied migration v19: task-aware run metadata");
}

fn migrate_v20(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cortex_tasks (
            id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            group_id TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            priority TEXT,
            conversation_id TEXT,
            latest_run_id TEXT,
            source_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            version INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (user_id, group_id, id)
        );

        CREATE INDEX IF NOT EXISTS idx_cortex_tasks_group_status
            ON cortex_tasks(user_id, group_id, status, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_cortex_tasks_latest_run
            ON cortex_tasks(user_id, latest_run_id);

        CREATE TABLE IF NOT EXISTS cortex_task_chats (
            user_id TEXT NOT NULL,
            group_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            attached_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, group_id, task_id, conversation_id)
        );"
    ).expect("migration v20 failed");

    let task_states = {
        let mut stmt = conn
            .prepare("SELECT user_id, group_id, state_json FROM group_task_state")
            .expect("failed to prepare task state backfill");
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .expect("failed to query task state backfill")
        .filter_map(|row| row.ok())
        .collect::<Vec<_>>()
    };

    for (user_id, group_id, raw) in task_states {
        if let Ok(state) = serde_json::from_str::<serde_json::Value>(&raw) {
            index_group_task_state(conn, &user_id, &group_id, &state);
        }
    }

    conn.execute("UPDATE schema_version SET version = 20", [])
        .expect("failed to mark migration v20");

    tracing::info!("applied migration v20: cortex task shadow index");
}

fn migrate_v21(conn: &Connection) {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_operations_events_scope_created
            ON operations_events(scope_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_operations_events_scope_task_created
            ON operations_events(scope_id, task_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_runs_group_status_created
            ON runs(user_id, group_id, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_cortex_task_chats_group_attached
            ON cortex_task_chats(user_id, group_id, task_id, attached_at DESC);

        UPDATE schema_version SET version = 21;"
    ).expect("migration v21 failed");

    tracing::info!("applied migration v21: operations summary query indexes");
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CortexGroup {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub members: i64,
    pub accent: String,
    pub source: String,
    pub external_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrationConnection {
    pub id: String,
    pub provider: String,
    pub external_id: Option<String>,
    pub display_name: String,
    pub status: String,
    pub scopes: Vec<String>,
    pub metadata: serde_json::Value,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IntegrationMapping {
    pub id: String,
    pub provider: String,
    pub group_id: String,
    pub external_id: String,
    pub external_name: String,
    pub mapping_type: String,
    pub metadata: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

// --- Database implementation ---

fn json_text<'a>(object: &'a serde_json::Map<String, serde_json::Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(|value| value.as_str())
}

fn index_group_task_state(
    conn: &Connection,
    user_id: &str,
    group_id: &str,
    state: &serde_json::Value,
) {
    let Some(tasks) = state.get("tasks").and_then(|value| value.as_array()) else {
        conn.execute(
            "DELETE FROM cortex_tasks WHERE user_id = ?1 AND group_id = ?2",
            params![user_id, group_id],
        ).ok();
        return;
    };

    let mut seen_ids = HashSet::new();
    for task in tasks {
        let Some(object) = task.as_object() else {
            continue;
        };
        let Some(id) = json_text(object, "id") else {
            continue;
        };
        let Some(title) = json_text(object, "title") else {
            continue;
        };
        let Some(status) = json_text(object, "status") else {
            continue;
        };
        if json_text(object, "groupId") != Some(group_id) {
            continue;
        }

        seen_ids.insert(id.to_string());
        let priority = json_text(object, "priority");
        let conversation_id = json_text(object, "projectChatConversationId");
        let latest_run_id = json_text(object, "latestRunId");
        let source_json = serde_json::to_string(task).unwrap_or_else(|_| "{}".to_string());

        conn.execute(
            "INSERT INTO cortex_tasks (
                id, user_id, group_id, title, status, priority, conversation_id,
                latest_run_id, source_json, created_at, updated_at, version
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'), 1)
             ON CONFLICT(user_id, group_id, id) DO UPDATE SET
                title = excluded.title,
                status = excluded.status,
                priority = excluded.priority,
                conversation_id = excluded.conversation_id,
                latest_run_id = excluded.latest_run_id,
                source_json = excluded.source_json,
                updated_at = datetime('now'),
                version = cortex_tasks.version + 1",
            params![
                id,
                user_id,
                group_id,
                title,
                status,
                priority,
                conversation_id,
                latest_run_id,
                source_json
            ],
        ).ok();

        if let Some(conversation_id) = conversation_id {
            conn.execute(
                "INSERT OR IGNORE INTO cortex_task_chats (
                    user_id, group_id, task_id, conversation_id, attached_at
                 )
                 VALUES (?1, ?2, ?3, ?4, datetime('now'))",
                params![user_id, group_id, id, conversation_id],
            ).ok();
        }
    }

    let existing_ids = {
        let mut stmt = match conn.prepare("SELECT id FROM cortex_tasks WHERE user_id = ?1 AND group_id = ?2") {
            Ok(stmt) => stmt,
            Err(_) => return,
        };
        stmt.query_map(params![user_id, group_id], |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|row| row.ok()).collect::<Vec<_>>())
            .unwrap_or_default()
    };

    for existing_id in existing_ids {
        if !seen_ids.contains(&existing_id) {
            conn.execute(
                "DELETE FROM cortex_tasks WHERE user_id = ?1 AND group_id = ?2 AND id = ?3",
                params![user_id, group_id, existing_id],
            ).ok();
        }
    }
}

fn attach_run_to_cortex_task(
    conn: &Connection,
    user_id: &str,
    group_id: Option<&str>,
    task_id: Option<&str>,
    conversation_id: Option<&str>,
    run_id: &str,
) {
    let (Some(group_id), Some(task_id)) = (group_id, task_id) else {
        return;
    };

    conn.execute(
        "UPDATE cortex_tasks
         SET latest_run_id = ?1,
             conversation_id = COALESCE(?2, conversation_id),
             updated_at = datetime('now'),
             version = version + 1
         WHERE user_id = ?3 AND group_id = ?4 AND id = ?5",
        params![run_id, conversation_id, user_id, group_id, task_id],
    ).ok();

    if let Some(conversation_id) = conversation_id {
        conn.execute(
            "INSERT OR IGNORE INTO cortex_task_chats (
                user_id, group_id, task_id, conversation_id, attached_at
             )
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            params![user_id, group_id, task_id, conversation_id],
        ).ok();
    }
}

fn insert_operations_event(
    conn: &Connection,
    actor_user_id: Option<&str>,
    scope_id: Option<&str>,
    project_id: Option<&str>,
    task_id: Option<&str>,
    run_id: Option<&str>,
    step_id: Option<&str>,
    attempt_id: Option<&str>,
    event_type: &str,
    entity_type: &str,
    entity_id: &str,
    payload: &serde_json::Value,
) {
    let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
    let result = conn.execute(
        "INSERT INTO operations_events (
            id, created_at, actor_user_id, scope_id, project_id, task_id, run_id, step_id,
            attempt_id, event_type, entity_type, entity_id, payload_json
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            Uuid::new_v4().to_string(),
            Utc::now().timestamp_millis(),
            actor_user_id,
            scope_id,
            project_id,
            task_id,
            run_id,
            step_id,
            attempt_id,
            event_type,
            entity_type,
            entity_id,
            payload_json,
        ],
    );

    if let Err(err) = result {
        tracing::warn!(
            event_type = event_type,
            entity_type = entity_type,
            entity_id = entity_id,
            error = %err,
            "failed to record operations event"
        );
    }
}

fn step_event_context(conn: &Connection, step_id: &str) -> Option<(String, String)> {
    conn.query_row(
        "SELECT s.run_id, r.user_id
         FROM steps s
         JOIN runs r ON r.id = s.run_id
         WHERE s.id = ?1",
        params![step_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .ok()
}

impl Database {
    pub fn open(path: &Path) -> Self {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(path).expect("failed to open database");

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA temp_store = MEMORY;"
        ).expect("failed to set pragmas");

        apply_migrations(&conn);

        Self { conn: Mutex::new(conn) }
    }

    // --- Schema info ---

    pub fn schema_version(&self) -> i64 {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))
            .unwrap_or(0)
    }

    pub fn list_run_operations_events(&self, run_id: &str, limit: usize) -> Vec<OperationsEvent> {
        let conn = self.conn.lock().unwrap();
        let limit = limit.clamp(1, 500) as i64;
        let mut stmt = conn.prepare(
            "SELECT id, created_at, actor_user_id, scope_id, project_id, task_id, run_id,
                    step_id, attempt_id, event_type, entity_type, entity_id, payload_json
             FROM operations_events
             WHERE run_id = ?1
             ORDER BY created_at ASC, id ASC
             LIMIT ?2"
        ).unwrap();

        stmt.query_map(params![run_id, limit], |row| {
            let payload_json: String = row.get(12)?;
            Ok(OperationsEvent {
                id: row.get(0)?,
                created_at: row.get(1)?,
                actor_user_id: row.get(2)?,
                scope_id: row.get(3)?,
                project_id: row.get(4)?,
                task_id: row.get(5)?,
                run_id: row.get(6)?,
                step_id: row.get(7)?,
                attempt_id: row.get(8)?,
                event_type: row.get(9)?,
                entity_type: row.get(10)?,
                entity_id: row.get(11)?,
                payload: serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({})),
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_run_binding(&self, run_id: &str) -> Option<(Option<String>, Option<String>, Option<String>)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT task_id, group_id, conversation_id FROM runs WHERE id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).ok()
    }

    // --- Conversations ---

    pub fn create_conversation(&self, user_id: &str, title: Option<&str>) -> Conversation {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, user_id, title, now, now],
        ).expect("failed to insert conversation");

        Conversation { id, user_id: user_id.to_string(), title: title.map(String::from), created_at: now.clone(), updated_at: now }
    }

    pub fn list_conversations(&self, user_id: &str) -> Vec<ConversationSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.title, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count,
                    (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_msg
             FROM conversations c
             WHERE c.user_id = ?1
             ORDER BY c.updated_at DESC"
        ).unwrap();

        stmt.query_map(params![user_id], |row| {
            let preview: Option<String> = row.get(4)?;
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                message_count: row.get(3)?,
                last_message_preview: preview.map(|s| if s.len() > 100 { format!("{}...", &s[..97]) } else { s }),
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_conversation(&self, conversation_id: &str, user_id: &str) -> Option<ConversationWithMessages> {
        let conn = self.conn.lock().unwrap();

        let conversation = conn.query_row(
            "SELECT id, user_id, title, created_at, updated_at FROM conversations WHERE id = ?1 AND user_id = ?2",
            params![conversation_id, user_id],
            |row| Ok(Conversation {
                id: row.get(0)?,
                user_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }),
        ).ok()?;

        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, provider, model, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC"
        ).unwrap();

        let messages = stmt.query_map(params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                provider: row.get(4)?,
                model: row.get(5)?,
                created_at: row.get(6)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect();

        Some(ConversationWithMessages { conversation, messages })
    }

    pub fn delete_conversation(&self, conversation_id: &str, user_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "DELETE FROM conversations WHERE id = ?1 AND user_id = ?2",
            params![conversation_id, user_id],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn update_conversation_title(&self, conversation_id: &str, user_id: &str, title: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3 AND user_id = ?4",
            params![title, now, conversation_id, user_id],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Message {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, provider, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, conversation_id, role, content, provider, model, now],
        ).expect("failed to insert message");

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        ).ok();

        Message {
            id,
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            provider: provider.map(String::from),
            model: model.map(String::from),
            created_at: now,
        }
    }

    // --- Cortex groups + task state ---

    pub fn upsert_group(
        &self,
        user_id: &str,
        id: &str,
        name: &str,
        kind: &str,
        description: &str,
        members: i64,
        accent: &str,
        source: &str,
        external_id: Option<&str>,
    ) -> CortexGroup {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO cortex_groups
                (id, user_id, name, kind, description, members, accent, source, external_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
             ON CONFLICT(user_id, source, external_id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                members = excluded.members,
                accent = excluded.accent,
                updated_at = datetime('now')",
            params![id, user_id, name, kind, description, members, accent, source, external_id],
        ).expect("failed to upsert cortex group");

        self.get_group(user_id, id).unwrap_or_else(|| CortexGroup {
            id: id.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            description: description.to_string(),
            members,
            accent: accent.to_string(),
            source: source.to_string(),
            external_id: external_id.map(String::from),
        })
    }

    pub fn list_groups(&self, user_id: &str) -> Vec<CortexGroup> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, description, members, accent, source, external_id
             FROM cortex_groups WHERE user_id = ?1 ORDER BY updated_at DESC"
        ).unwrap();

        stmt.query_map(params![user_id], |row| Ok(CortexGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            kind: row.get(2)?,
            description: row.get(3)?,
            members: row.get(4)?,
            accent: row.get(5)?,
            source: row.get(6)?,
            external_id: row.get(7)?,
        })).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_group(&self, user_id: &str, group_id: &str) -> Option<CortexGroup> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, name, kind, description, members, accent, source, external_id
             FROM cortex_groups WHERE user_id = ?1 AND id = ?2",
            params![user_id, group_id],
            |row| Ok(CortexGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                kind: row.get(2)?,
                description: row.get(3)?,
                members: row.get(4)?,
                accent: row.get(5)?,
                source: row.get(6)?,
                external_id: row.get(7)?,
            }),
        ).ok()
    }

    pub fn get_group_task_state(&self, user_id: &str, group_id: &str) -> Option<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let raw: String = conn.query_row(
            "SELECT state_json FROM group_task_state WHERE user_id = ?1 AND group_id = ?2",
            params![user_id, group_id],
            |row| row.get(0),
        ).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn upsert_group_task_state(
        &self,
        user_id: &str,
        group_id: &str,
        state: &serde_json::Value,
    ) -> serde_json::Value {
        let conn = self.conn.lock().unwrap();
        let raw = serde_json::to_string(state).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "INSERT INTO group_task_state (group_id, user_id, state_json, updated_at)
             VALUES (?1, ?2, ?3, datetime('now'))
             ON CONFLICT(group_id, user_id) DO UPDATE SET
                state_json = excluded.state_json,
                updated_at = datetime('now')",
            params![group_id, user_id, raw],
        ).expect("failed to upsert group task state");
        index_group_task_state(&conn, user_id, group_id, state);
        state.clone()
    }

    pub fn cortex_task_exists(&self, user_id: &str, group_id: &str, task_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM cortex_tasks WHERE user_id = ?1 AND group_id = ?2 AND id = ?3",
            params![user_id, group_id, task_id],
            |_| Ok(()),
        ).is_ok()
    }

    pub fn get_cortex_task_projection(
        &self,
        user_id: &str,
        group_id: &str,
        task_id: &str,
        event_limit: usize,
    ) -> Option<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let (
            id,
            title,
            status,
            priority,
            conversation_id,
            latest_run_id,
            source_json,
            created_at,
            updated_at,
            version,
        ): (
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            String,
            i64,
        ) = conn
            .query_row(
                "SELECT id, title, status, priority, conversation_id, latest_run_id,
                        source_json, created_at, updated_at, version
                 FROM cortex_tasks
                 WHERE user_id = ?1 AND group_id = ?2 AND id = ?3",
                params![user_id, group_id, task_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                    ))
                },
            )
            .ok()?;
        let source = serde_json::from_str(&source_json).unwrap_or_else(|_| serde_json::json!({}));

        let mut runs_stmt = conn
            .prepare(
                "SELECT id, goal, status, profile, created_at, updated_at, started_at, finished_at,
                        heal_attempts, task_id, group_id, conversation_id
                 FROM runs
                 WHERE user_id = ?1 AND group_id = ?2 AND task_id = ?3
                 ORDER BY created_at DESC, id DESC
                 LIMIT 25",
            )
            .unwrap();
        let runs: Vec<serde_json::Value> = runs_stmt
            .query_map(params![user_id, group_id, task_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "goal": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "profile": row.get::<_, String>(3)?,
                    "created_at": row.get::<_, i64>(4)?,
                    "updated_at": row.get::<_, i64>(5)?,
                    "started_at": row.get::<_, Option<i64>>(6)?,
                    "finished_at": row.get::<_, Option<i64>>(7)?,
                    "heal_attempts": row.get::<_, i32>(8)?,
                    "task_id": row.get::<_, Option<String>>(9)?,
                    "group_id": row.get::<_, Option<String>>(10)?,
                    "conversation_id": row.get::<_, Option<String>>(11)?,
                }))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect();

        let mut chats_stmt = conn
            .prepare(
                "SELECT c.id, c.title, c.created_at, c.updated_at, tc.attached_at
                 FROM cortex_task_chats tc
                 JOIN conversations c ON c.id = tc.conversation_id AND c.user_id = tc.user_id
                 WHERE tc.user_id = ?1 AND tc.group_id = ?2 AND tc.task_id = ?3
                 ORDER BY tc.attached_at DESC, c.updated_at DESC
                 LIMIT 25",
            )
            .unwrap();
        let chats: Vec<serde_json::Value> = chats_stmt
            .query_map(params![user_id, group_id, task_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, Option<String>>(1)?,
                    "created_at": row.get::<_, String>(2)?,
                    "updated_at": row.get::<_, String>(3)?,
                    "attached_at": row.get::<_, String>(4)?,
                }))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect();

        let event_limit = event_limit.clamp(1, 500) as i64;
        let mut events_stmt = conn
            .prepare(
                "SELECT id, created_at, actor_user_id, scope_id, project_id, task_id, run_id,
                        step_id, attempt_id, event_type, entity_type, entity_id, payload_json
                 FROM operations_events
                 WHERE task_id = ?1
                    AND (actor_user_id = ?2 OR actor_user_id IS NULL)
                    AND (scope_id = ?3 OR scope_id IS NULL)
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?4",
            )
            .unwrap();
        let events: Vec<serde_json::Value> = events_stmt
            .query_map(params![task_id, user_id, group_id, event_limit], |row| {
                let payload_json: String = row.get(12)?;
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "created_at": row.get::<_, i64>(1)?,
                    "actor_user_id": row.get::<_, Option<String>>(2)?,
                    "scope_id": row.get::<_, Option<String>>(3)?,
                    "project_id": row.get::<_, Option<String>>(4)?,
                    "task_id": row.get::<_, Option<String>>(5)?,
                    "run_id": row.get::<_, Option<String>>(6)?,
                    "step_id": row.get::<_, Option<String>>(7)?,
                    "attempt_id": row.get::<_, Option<String>>(8)?,
                    "event_type": row.get::<_, String>(9)?,
                    "entity_type": row.get::<_, String>(10)?,
                    "entity_id": row.get::<_, String>(11)?,
                    "payload": serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({})),
                }))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect();

        Some(serde_json::json!({
            "task": {
                "id": id,
                "group_id": group_id,
                "title": title,
                "status": status,
                "priority": priority,
                "conversation_id": conversation_id,
                "latest_run_id": latest_run_id,
                "source": source,
                "created_at": created_at,
                "updated_at": updated_at,
                "version": version,
            },
            "runs": runs,
            "chats": chats,
            "events": events,
        }))
    }

    pub fn get_group_operations_summary(
        &self,
        user_id: &str,
        group_id: &str,
        event_limit: usize,
    ) -> serde_json::Value {
        let conn = self.conn.lock().unwrap();
        let generated_at = Utc::now().timestamp_millis();

        let mut tasks_stmt = conn
            .prepare(
                "SELECT id, title, status, priority, latest_run_id, source_json, updated_at
                 FROM cortex_tasks
                 WHERE user_id = ?1 AND group_id = ?2",
            )
            .unwrap();
        let task_rows = tasks_stmt
            .query_map(params![user_id, group_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();

        let mut task_created = 0;
        let mut task_assigned = 0;
        let mut task_active = 0;
        let mut task_done = 0;
        let mut task_urgent = 0;
        let mut task_unassigned = 0;
        let mut task_without_run = 0;
        let mut attention: Vec<serde_json::Value> = Vec::new();

        for (task_id, title, status, priority, latest_run_id, source_json, updated_at) in &task_rows {
            match status.as_str() {
                "created" => task_created += 1,
                "assigned" => task_assigned += 1,
                "in-progress" => task_active += 1,
                "done" => task_done += 1,
                _ => {}
            }
            if priority == "urgent" {
                task_urgent += 1;
                if status != "in-progress" && status != "done" && attention.len() < 10 {
                    attention.push(serde_json::json!({
                        "kind": "urgent_not_active",
                        "task_id": task_id,
                        "title": title,
                        "priority": priority,
                        "status": status,
                        "updated_at": updated_at,
                    }));
                }
            }
            if latest_run_id.is_none() {
                task_without_run += 1;
                if status == "in-progress" && attention.len() < 10 {
                    attention.push(serde_json::json!({
                        "kind": "active_without_run",
                        "task_id": task_id,
                        "title": title,
                        "status": status,
                        "updated_at": updated_at,
                    }));
                }
            }
            let source = serde_json::from_str::<serde_json::Value>(source_json)
                .unwrap_or_else(|_| serde_json::json!({}));
            let assignee = source.get("assigneeId").and_then(|value| value.as_str());
            if assignee.map(|value| value.trim().is_empty()).unwrap_or(true) {
                task_unassigned += 1;
            }
        }

        let mut runs_stmt = conn
            .prepare(
                "SELECT id, status, task_id, created_at
                 FROM runs
                 WHERE user_id = ?1 AND group_id = ?2
                 ORDER BY created_at DESC, id DESC",
            )
            .unwrap();
        let run_rows = runs_stmt
            .query_map(params![user_id, group_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();

        let mut runs_active = 0;
        let mut runs_failed = 0;
        let mut runs_succeeded = 0;
        for (run_id, status, task_id, created_at) in &run_rows {
            match status.as_str() {
                "pending" | "planning" | "ready" | "leased" | "running" => runs_active += 1,
                "failed" | "orphaned" => {
                    runs_failed += 1;
                    if attention.len() < 10 {
                        attention.push(serde_json::json!({
                            "kind": "failed_run",
                            "run_id": run_id,
                            "task_id": task_id,
                            "status": status,
                            "created_at": created_at,
                        }));
                    }
                }
                "succeeded" | "recovered" => runs_succeeded += 1,
                _ => {}
            }
        }
        let latest_run_id = run_rows.first().map(|(run_id, _, _, _)| run_id.clone());

        let mut steps_stmt = conn
            .prepare(
                "SELECT s.id, s.run_id, s.status, s.verification_status, r.task_id
                 FROM steps s
                 JOIN runs r ON r.id = s.run_id
                 WHERE r.user_id = ?1 AND r.group_id = ?2",
            )
            .unwrap();
        let step_rows = steps_stmt
            .query_map(params![user_id, group_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();

        let mut steps_active = 0;
        let mut steps_failed = 0;
        let mut steps_orphaned = 0;
        let mut steps_verified_pass = 0;
        let mut steps_verified_fail = 0;
        for (step_id, run_id, status, verification_status, task_id) in &step_rows {
            match status.as_str() {
                "leased" | "running" => steps_active += 1,
                "failed" => {
                    steps_failed += 1;
                    if attention.len() < 10 {
                        attention.push(serde_json::json!({
                            "kind": "failed_step",
                            "step_id": step_id,
                            "run_id": run_id,
                            "task_id": task_id,
                            "status": status,
                        }));
                    }
                }
                "orphaned" => {
                    steps_orphaned += 1;
                    if attention.len() < 10 {
                        attention.push(serde_json::json!({
                            "kind": "orphaned_step",
                            "step_id": step_id,
                            "run_id": run_id,
                            "task_id": task_id,
                            "status": status,
                        }));
                    }
                }
                _ => {}
            }
            match verification_status.as_deref() {
                Some("verified_pass") => steps_verified_pass += 1,
                Some("verified_fail") => steps_verified_fail += 1,
                _ => {}
            }
        }

        let event_limit = event_limit.clamp(1, 100) as i64;
        let mut events_stmt = conn
            .prepare(
                "SELECT id, created_at, actor_user_id, scope_id, project_id, task_id, run_id,
                        step_id, attempt_id, event_type, entity_type, entity_id, payload_json
                 FROM operations_events
                 WHERE scope_id = ?1
                    AND (actor_user_id = ?2 OR actor_user_id IS NULL)
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?3",
            )
            .unwrap();
        let recent_events: Vec<serde_json::Value> = events_stmt
            .query_map(params![group_id, user_id, event_limit], |row| {
                let payload_json: String = row.get(12)?;
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "created_at": row.get::<_, i64>(1)?,
                    "actor_user_id": row.get::<_, Option<String>>(2)?,
                    "scope_id": row.get::<_, Option<String>>(3)?,
                    "project_id": row.get::<_, Option<String>>(4)?,
                    "task_id": row.get::<_, Option<String>>(5)?,
                    "run_id": row.get::<_, Option<String>>(6)?,
                    "step_id": row.get::<_, Option<String>>(7)?,
                    "attempt_id": row.get::<_, Option<String>>(8)?,
                    "event_type": row.get::<_, String>(9)?,
                    "entity_type": row.get::<_, String>(10)?,
                    "entity_id": row.get::<_, String>(11)?,
                    "payload": serde_json::from_str(&payload_json).unwrap_or_else(|_| serde_json::json!({})),
                }))
            })
            .unwrap()
            .filter_map(|row| row.ok())
            .collect();

        let open_tasks = task_created + task_assigned + task_active;
        serde_json::json!({
            "group_id": group_id,
            "scope": "group",
            "generated_at": generated_at,
            "tasks": {
                "total": task_rows.len(),
                "open": open_tasks,
                "active": task_active,
                "done_raw": task_done,
                "urgent": task_urgent,
                "unassigned": task_unassigned,
                "without_run": task_without_run,
                "by_status": {
                    "created": task_created,
                    "assigned": task_assigned,
                    "in_progress": task_active,
                    "done": task_done,
                },
                "completion": {
                    "gated_done_available": false,
                    "raw_done": task_done,
                },
            },
            "runs": {
                "total": run_rows.len(),
                "active": runs_active,
                "failed": runs_failed,
                "succeeded": runs_succeeded,
                "latest_run_id": latest_run_id,
            },
            "steps": {
                "total": step_rows.len(),
                "active": steps_active,
                "failed": steps_failed,
                "orphaned": steps_orphaned,
                "verified_pass": steps_verified_pass,
                "verified_fail": steps_verified_fail,
            },
            "attention": attention,
            "recent_events": recent_events,
        })
    }

    pub fn conversation_exists(&self, user_id: &str, conversation_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM conversations WHERE user_id = ?1 AND id = ?2",
            params![user_id, conversation_id],
            |_| Ok(()),
        ).is_ok()
    }

    // --- Integrations ---

    pub fn upsert_integration_connection(
        &self,
        user_id: &str,
        provider: &str,
        external_id: Option<&str>,
        display_name: &str,
        status: &str,
        scopes: &[String],
        access_token: Option<&str>,
        refresh_token: Option<&str>,
        metadata: &serde_json::Value,
    ) -> IntegrationConnection {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let scopes_json = serde_json::to_string(scopes).unwrap_or_else(|_| "[]".to_string());
        let metadata_json = serde_json::to_string(metadata).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "INSERT INTO integration_connections
                (id, user_id, provider, external_id, display_name, status, scopes, access_token, refresh_token, metadata_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))
             ON CONFLICT(user_id, provider, external_id) DO UPDATE SET
                display_name = excluded.display_name,
                status = excluded.status,
                scopes = excluded.scopes,
                access_token = COALESCE(excluded.access_token, access_token),
                refresh_token = COALESCE(excluded.refresh_token, refresh_token),
                metadata_json = excluded.metadata_json,
                last_error = NULL,
                updated_at = datetime('now')",
            params![id, user_id, provider, external_id, display_name, status, scopes_json, access_token, refresh_token, metadata_json],
        ).expect("failed to upsert integration connection");

        self.get_integration_connection(user_id, provider, external_id)
            .expect("integration connection should exist after upsert")
    }

    pub fn get_integration_connection(
        &self,
        user_id: &str,
        provider: &str,
        external_id: Option<&str>,
    ) -> Option<IntegrationConnection> {
        let conn = self.conn.lock().unwrap();
        let sql = if external_id.is_some() {
            "SELECT id, provider, external_id, display_name, status, scopes, metadata_json, last_sync_at, last_error, created_at, updated_at
             FROM integration_connections WHERE user_id = ?1 AND provider = ?2 AND external_id = ?3"
        } else {
            "SELECT id, provider, external_id, display_name, status, scopes, metadata_json, last_sync_at, last_error, created_at, updated_at
             FROM integration_connections WHERE user_id = ?1 AND provider = ?2 ORDER BY updated_at DESC LIMIT 1"
        };

        let mut stmt = conn.prepare(sql).ok()?;
        let mut rows = if let Some(external_id) = external_id {
            stmt.query(params![user_id, provider, external_id]).ok()?
        } else {
            stmt.query(params![user_id, provider]).ok()?
        };
        let row = rows.next().ok()??;
        let scopes_raw: String = row.get(5).ok()?;
        let metadata_raw: String = row.get(6).ok()?;
        Some(IntegrationConnection {
            id: row.get(0).ok()?,
            provider: row.get(1).ok()?,
            external_id: row.get(2).ok()?,
            display_name: row.get(3).ok()?,
            status: row.get(4).ok()?,
            scopes: serde_json::from_str(&scopes_raw).unwrap_or_default(),
            metadata: serde_json::from_str(&metadata_raw).unwrap_or_else(|_| serde_json::json!({})),
            last_sync_at: row.get(7).ok()?,
            last_error: row.get(8).ok()?,
            created_at: row.get(9).ok()?,
            updated_at: row.get(10).ok()?,
        })
    }

    pub fn get_integration_token(&self, user_id: &str, provider: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT access_token FROM integration_connections
             WHERE user_id = ?1 AND provider = ?2 AND status = 'connected'
             ORDER BY updated_at DESC LIMIT 1",
            params![user_id, provider],
            |row| row.get(0),
        ).ok()
    }

    pub fn list_integration_connections(&self, user_id: &str) -> Vec<IntegrationConnection> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, provider, external_id, display_name, status, scopes, metadata_json, last_sync_at, last_error, created_at, updated_at
             FROM integration_connections WHERE user_id = ?1 ORDER BY provider ASC, updated_at DESC"
        ).unwrap();

        stmt.query_map(params![user_id], |row| {
            let scopes_raw: String = row.get(5)?;
            let metadata_raw: String = row.get(6)?;
            Ok(IntegrationConnection {
                id: row.get(0)?,
                provider: row.get(1)?,
                external_id: row.get(2)?,
                display_name: row.get(3)?,
                status: row.get(4)?,
                scopes: serde_json::from_str(&scopes_raw).unwrap_or_default(),
                metadata: serde_json::from_str(&metadata_raw).unwrap_or_else(|_| serde_json::json!({})),
                last_sync_at: row.get(7)?,
                last_error: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn upsert_integration_mapping(
        &self,
        user_id: &str,
        provider: &str,
        group_id: &str,
        external_id: &str,
        external_name: &str,
        mapping_type: &str,
        metadata: &serde_json::Value,
    ) -> IntegrationMapping {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let metadata_json = serde_json::to_string(metadata).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "INSERT INTO integration_mappings
                (id, user_id, provider, group_id, external_id, external_name, mapping_type, metadata_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
             ON CONFLICT(user_id, provider, external_id, mapping_type) DO UPDATE SET
                group_id = excluded.group_id,
                external_name = excluded.external_name,
                metadata_json = excluded.metadata_json,
                updated_at = datetime('now')",
            params![id, user_id, provider, group_id, external_id, external_name, mapping_type, metadata_json],
        ).expect("failed to upsert integration mapping");

        IntegrationMapping {
            id,
            provider: provider.to_string(),
            group_id: group_id.to_string(),
            external_id: external_id.to_string(),
            external_name: external_name.to_string(),
            mapping_type: mapping_type.to_string(),
            metadata: metadata.clone(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn list_integration_mappings(&self, user_id: &str) -> Vec<IntegrationMapping> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, provider, group_id, external_id, external_name, mapping_type, metadata_json, created_at, updated_at
             FROM integration_mappings WHERE user_id = ?1 ORDER BY updated_at DESC"
        ).unwrap();

        stmt.query_map(params![user_id], |row| {
            let metadata_raw: String = row.get(6)?;
            Ok(IntegrationMapping {
                id: row.get(0)?,
                provider: row.get(1)?,
                group_id: row.get(2)?,
                external_id: row.get(3)?,
                external_name: row.get(4)?,
                mapping_type: row.get(5)?,
                metadata: serde_json::from_str(&metadata_raw).unwrap_or_else(|_| serde_json::json!({})),
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn record_integration_event(
        &self,
        user_id: &str,
        provider: &str,
        group_id: Option<&str>,
        event_type: &str,
        status: &str,
        payload: &serde_json::Value,
    ) {
        let conn = self.conn.lock().unwrap();
        let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
        let _ = conn.execute(
            "INSERT INTO integration_events (id, user_id, provider, group_id, event_type, status, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![Uuid::new_v4().to_string(), user_id, provider, group_id, event_type, status, payload_json],
        );
    }

    pub fn store_oauth_state(&self, user_id: &str, provider: &str, state: &str, redirect_after: Option<&str>) {
        let conn = self.conn.lock().unwrap();
        let expires_at = (Utc::now() + chrono::Duration::minutes(10)).to_rfc3339();
        let _ = conn.execute(
            "INSERT OR REPLACE INTO integration_oauth_states (state, user_id, provider, redirect_after, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![state, user_id, provider, redirect_after, expires_at],
        );
    }

    pub fn consume_oauth_state(&self, provider: &str, state: &str) -> Option<(String, Option<String>)> {
        let conn = self.conn.lock().unwrap();
        let row = conn.query_row(
            "SELECT user_id, redirect_after FROM integration_oauth_states
             WHERE provider = ?1 AND state = ?2 AND expires_at > datetime('now')",
            params![provider, state],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        ).ok();
        let _ = conn.execute("DELETE FROM integration_oauth_states WHERE state = ?1", params![state]);
        row
    }

    // --- Workers ---

    pub fn register_worker(&self, worker_id: &str, user_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO workers (id, user_id, status, created_at, last_seen) VALUES (?1, ?2, 'connected', ?3, ?3)",
            params![worker_id, user_id, now],
        ).ok();
    }

    pub fn update_worker_seen(&self, worker_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE workers SET last_seen = ?1 WHERE id = ?2",
            params![now, worker_id],
        ).ok();
    }

    pub fn set_worker_status(&self, worker_id: &str, status: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE workers SET status = ?1 WHERE id = ?2",
            params![status, worker_id],
        ).ok();
    }

    pub fn upsert_provider_capability(
        &self,
        worker_id: &str,
        user_id: &str,
        provider: &str,
        cli_version: Option<&str>,
    ) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO provider_capabilities (worker_id, user_id, provider, cli_version, status, last_reported)
             VALUES (?1, ?2, ?3, ?4, 'claimed', ?5)
             ON CONFLICT(worker_id, provider) DO UPDATE SET
                cli_version = excluded.cli_version,
                last_reported = excluded.last_reported",
            params![worker_id, user_id, provider, cli_version, now],
        ).ok();
    }

    // --- Runs ---

    pub fn create_run(&self, user_id: &str, goal: &str, profile: &str, file_paths: &[String]) -> String {
        self.create_run_with_metadata(user_id, goal, profile, file_paths, None, None, None)
    }

    pub fn create_run_with_metadata(
        &self,
        user_id: &str,
        goal: &str,
        profile: &str,
        file_paths: &[String],
        task_id: Option<&str>,
        group_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> String {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        let file_paths_json = if file_paths.is_empty() {
            None
        } else {
            serde_json::to_string(file_paths).ok()
        };
        conn.execute(
            "INSERT INTO runs (id, user_id, goal, status, profile, file_paths, task_id, group_id, conversation_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, user_id, goal, profile, file_paths_json, task_id, group_id, conversation_id, now],
        ).expect("failed to create run");
        attach_run_to_cortex_task(&conn, user_id, group_id, task_id, conversation_id, &id);
        insert_operations_event(
            &conn,
            Some(user_id),
            group_id,
            None,
            task_id,
            Some(&id),
            None,
            None,
            "run.created",
            "run",
            &id,
            &serde_json::json!({
                "status": "pending",
                "profile": profile,
                "file_paths": file_paths,
                "task_id": task_id,
                "group_id": group_id,
                "conversation_id": conversation_id,
            }),
        );
        id
    }

    /// Create a run with all its steps and dependency edges in a single transaction.
    /// This avoids N+1 lock acquisitions that occur when calling create_run + N*create_step_with_id
    /// + N*add_step_dependency individually.
    pub fn create_run_with_steps(
        &self,
        user_id: &str,
        goal: &str,
        profile: &str,
        file_paths: &[String],
        task_id: Option<&str>,
        group_id: Option<&str>,
        conversation_id: Option<&str>,
        steps: &[(String, String, String, Option<String>, String, String, String, i64)], // (id, kind, work_kind, recipe_seed_json, tier, risk, objective, created_at)
        edges: &[(String, String, String)], // (step_id, depends_on_id, edge_type)
    ) -> String {
        let conn = self.conn.lock().unwrap();
        let run_id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        let file_paths_json = if file_paths.is_empty() {
            None
        } else {
            serde_json::to_string(file_paths).ok()
        };

        conn.execute("BEGIN", []).ok();

        conn.execute(
            "INSERT INTO runs (id, user_id, goal, status, profile, file_paths, task_id, group_id, conversation_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![run_id, user_id, goal, profile, file_paths_json, task_id, group_id, conversation_id, now],
        ).expect("failed to create run in batch");
        attach_run_to_cortex_task(&conn, user_id, group_id, task_id, conversation_id, &run_id);
        insert_operations_event(
            &conn,
            Some(user_id),
            group_id,
            None,
            task_id,
            Some(&run_id),
            None,
            None,
            "run.created",
            "run",
            &run_id,
            &serde_json::json!({
                "status": "pending",
                "profile": profile,
                "file_paths": file_paths,
                "step_count": steps.len(),
                "edge_count": edges.len(),
                "task_id": task_id,
                "group_id": group_id,
                "conversation_id": conversation_id,
            }),
        );

        for (id, kind, work_kind, recipe_seed_json, tier, risk, objective, created_at) in steps {
            conn.execute(
                "INSERT INTO steps (id, run_id, kind, work_kind, recipe_seed_json, status, tier, risk, objective, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9, ?9)",
                params![id, run_id, kind, work_kind, recipe_seed_json, tier, risk, objective, created_at],
            ).expect("failed to create step in batch");
            insert_operations_event(
                &conn,
                Some(user_id),
                group_id,
                None,
                task_id,
                Some(&run_id),
                Some(id.as_str()),
                None,
                "step.planned",
                "step",
                id,
                &serde_json::json!({
                    "status": "pending",
                    "kind": kind,
                    "work_kind": work_kind,
                    "tier": tier,
                    "risk": risk,
                    "objective": objective,
                }),
            );
        }

        for (step_id, depends_on_id, edge_type) in edges {
            conn.execute(
                "INSERT OR IGNORE INTO step_dependencies (step_id, depends_on_id, edge_type) VALUES (?1, ?2, ?3)",
                params![step_id, depends_on_id, edge_type],
            ).ok();
        }

        conn.execute("COMMIT", []).ok();
        run_id
    }

    /// Record (or update) the branch name associated with a run.
    ///
    /// Called when a step completes with changes — the branch is preserved so
    /// a PR can be created after the run finishes.  If multiple steps produce
    /// branches, the last one recorded wins.
    pub fn record_run_branch(&self, run_id: &str, branch_name: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE runs SET branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![branch_name, now, run_id],
        ).ok();
    }

    /// Retrieve the branch name recorded for a run, if any.
    pub fn get_run_branch(&self, run_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT branch FROM runs WHERE id = ?1",
            params![run_id],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    /// Get the latest head_commit from any completed step in the given run.
    /// Used to pass as base_commit to subsequent steps for workspace continuity.
    pub fn get_run_latest_commit(&self, run_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT head_commit FROM steps
             WHERE run_id = ?1 AND status = 'succeeded' AND head_commit IS NOT NULL
             ORDER BY updated_at DESC LIMIT 1",
            params![run_id],
            |row| row.get::<_, String>(0),
        ).ok()
    }

    /// Get the file_paths stored for a run (from the original goal decomposition).
    pub fn get_run_file_paths(&self, run_id: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let json: Option<String> = conn.query_row(
            "SELECT file_paths FROM runs WHERE id = ?1",
            params![run_id],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten();

        json.and_then(|j| serde_json::from_str::<Vec<String>>(&j).ok())
            .unwrap_or_default()
    }

    pub fn update_run_status(&self, run_id: &str, status: &str, failure_reason: Option<&str>) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let finished = if matches!(status, "succeeded" | "failed" | "cancelled") { Some(now) } else { None };
        let rows = conn.execute(
            "UPDATE runs SET status = ?1, failure_reason = ?2, finished_at = ?3, updated_at = ?4, version = version + 1
             WHERE id = ?5",
            params![status, failure_reason, finished, now, run_id],
        ).unwrap_or(0);
        if rows > 0 {
            let actor_user_id = conn
                .query_row("SELECT user_id FROM runs WHERE id = ?1", params![run_id], |row| {
                    row.get::<_, String>(0)
                })
                .ok();
            insert_operations_event(
                &conn,
                actor_user_id.as_deref(),
                None,
                None,
                None,
                Some(run_id),
                None,
                None,
                "run.status_changed",
                "run",
                run_id,
                &serde_json::json!({
                    "status": status,
                    "failure_reason": failure_reason,
                    "finished_at": finished,
                }),
            );
        }
        rows > 0
    }

    // --- Steps ---

    pub fn create_step(
        &self,
        run_id: &str,
        kind: &str,
        tier: &str,
        risk: &str,
        objective: &str,
    ) -> String {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO steps (id, run_id, kind, work_kind, status, tier, risk, objective, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'modify', 'pending', ?4, ?5, ?6, ?7, ?7)",
            params![id, run_id, kind, tier, risk, objective, now],
        ).expect("failed to create step");
        let actor_user_id = conn
            .query_row("SELECT user_id FROM runs WHERE id = ?1", params![run_id], |row| {
                row.get::<_, String>(0)
            })
            .ok();
        insert_operations_event(
            &conn,
            actor_user_id.as_deref(),
            None,
            None,
            None,
            Some(run_id),
            Some(&id),
            None,
            "step.planned",
            "step",
            &id,
            &serde_json::json!({
                "status": "pending",
                "kind": kind,
                "work_kind": "modify",
                "tier": tier,
                "risk": risk,
                "objective": objective,
            }),
        );
        id
    }

    pub fn add_step_dependency(&self, step_id: &str, depends_on_id: &str, edge_type: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO step_dependencies (step_id, depends_on_id, edge_type) VALUES (?1, ?2, ?3)",
            params![step_id, depends_on_id, edge_type],
        ).ok();
    }

    pub fn find_ready_steps(&self, run_id: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT s.id FROM steps s
             WHERE s.run_id = ?1 AND s.status IN ('pending', 'orphaned')
             AND (s.earliest_dispatch_at IS NULL OR s.earliest_dispatch_at <= ?2)
             AND NOT EXISTS (
                 SELECT 1 FROM step_dependencies sd
                 JOIN steps dep ON dep.id = sd.depends_on_id
                 WHERE sd.step_id = s.id
                 AND (
                     (sd.edge_type = 'success_required' AND dep.status != 'succeeded')
                     OR (sd.edge_type = 'completion_required' AND dep.status NOT IN ('succeeded', 'failed', 'recovered', 'cancelled', 'skipped'))
                 )
             )"
        ).unwrap();

        stmt.query_map(params![run_id, now], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    /// Find all ready steps across all active runs in a single query.
    /// Returns (step_id, run_id, user_id, kind, work_kind, tier, risk, objective) tuples.
    /// This replaces the N+1 pattern of get_active_run_ids() + find_ready_steps() per run.
    pub fn find_all_ready_steps(&self) -> Vec<(String, String, String, String, String, String, String, String)> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT s.id, s.run_id, r.user_id, s.kind, s.work_kind, s.tier, s.risk, s.objective
             FROM steps s
             JOIN runs r ON s.run_id = r.id
             WHERE r.status IN ('planning', 'running')
             AND s.status IN ('pending', 'orphaned')
             AND (s.earliest_dispatch_at IS NULL OR s.earliest_dispatch_at <= ?1)
             AND NOT EXISTS (
                 SELECT 1 FROM step_dependencies sd
                 JOIN steps dep ON dep.id = sd.depends_on_id
                 WHERE sd.step_id = s.id
                 AND (
                     (sd.edge_type = 'success_required' AND dep.status != 'succeeded')
                     OR (sd.edge_type = 'completion_required' AND dep.status NOT IN ('succeeded', 'failed', 'recovered', 'cancelled', 'skipped'))
                 )
             )"
        ).unwrap();

        stmt.query_map(params![now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn lease_step(&self, step_id: &str, worker_id: &str, deadline_ms: i64) -> Option<i64> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'leased', assigned_worker = ?1, lease_deadline = ?2,
                 lease_gen = lease_gen + 1, attempt_count = attempt_count + 1,
                 updated_at = ?3, version = version + 1
             WHERE id = ?4 AND status IN ('pending', 'ready', 'orphaned')",
            params![worker_id, deadline_ms, now, step_id],
        ).unwrap_or(0);
        if rows == 0 {
            return None;
        }
        let lease_gen = conn.query_row(
            "SELECT lease_gen FROM steps WHERE id = ?1",
            params![step_id],
            |row| row.get::<_, i64>(0),
        ).ok();
        if let Some(lease_gen) = lease_gen {
            let context = step_event_context(&conn, step_id);
            insert_operations_event(
                &conn,
                context.as_ref().map(|(_, user_id)| user_id.as_str()),
                None,
                None,
                None,
                context.as_ref().map(|(run_id, _)| run_id.as_str()),
                Some(step_id),
                None,
                "step.leased",
                "step",
                step_id,
                &serde_json::json!({
                    "status": "leased",
                    "worker_id": worker_id,
                    "lease_gen": lease_gen,
                    "lease_deadline": deadline_ms,
                }),
            );
        }
        lease_gen
    }

    pub fn start_step(&self, step_id: &str, lease_gen: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'running', updated_at = ?1, version = version + 1
             WHERE id = ?2 AND lease_gen = ?3 AND status IN ('leased', 'running')",
            params![now, step_id, lease_gen],
        ).unwrap_or(0);
        if rows > 0 {
            let context = step_event_context(&conn, step_id);
            insert_operations_event(
                &conn,
                context.as_ref().map(|(_, user_id)| user_id.as_str()),
                None,
                None,
                None,
                context.as_ref().map(|(run_id, _)| run_id.as_str()),
                Some(step_id),
                None,
                "step.started",
                "step",
                step_id,
                &serde_json::json!({
                    "status": "running",
                    "lease_gen": lease_gen,
                }),
            );
        }
        rows > 0
    }

    pub fn complete_step(
        &self,
        step_id: &str,
        lease_gen: i64,
        output_summary: Option<&str>,
        files_changed: Option<&str>,
        base_commit: Option<&str>,
        head_commit: Option<&str>,
    ) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'succeeded', output_summary = ?1, files_changed = ?2,
                 base_commit = ?3, head_commit = ?4, updated_at = ?5, version = version + 1
             WHERE id = ?6 AND lease_gen = ?7 AND status IN ('leased', 'running')",
            params![output_summary, files_changed, base_commit, head_commit, now, step_id, lease_gen],
        ).unwrap_or(0);
        if rows > 0 {
            let context = step_event_context(&conn, step_id);
            insert_operations_event(
                &conn,
                context.as_ref().map(|(_, user_id)| user_id.as_str()),
                None,
                None,
                None,
                context.as_ref().map(|(run_id, _)| run_id.as_str()),
                Some(step_id),
                None,
                "step.completed",
                "step",
                step_id,
                &serde_json::json!({
                    "status": "succeeded",
                    "lease_gen": lease_gen,
                    "output_summary": output_summary,
                    "files_changed": files_changed,
                    "base_commit": base_commit,
                    "head_commit": head_commit,
                }),
            );
        }
        rows > 0
    }

    pub fn fail_step(&self, step_id: &str, lease_gen: i64, error: &str, _failure_kind: Option<&str>) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'failed', last_error = ?1, updated_at = ?2, version = version + 1
             WHERE id = ?3 AND lease_gen = ?4 AND status IN ('leased', 'running')",
            params![error, now, step_id, lease_gen],
        ).unwrap_or(0);
        if rows > 0 {
            let context = step_event_context(&conn, step_id);
            insert_operations_event(
                &conn,
                context.as_ref().map(|(_, user_id)| user_id.as_str()),
                None,
                None,
                None,
                context.as_ref().map(|(run_id, _)| run_id.as_str()),
                Some(step_id),
                None,
                "step.failed",
                "step",
                step_id,
                &serde_json::json!({
                    "status": "failed",
                    "lease_gen": lease_gen,
                    "error": error,
                }),
            );
        }
        rows > 0
    }

    pub fn fail_unleased_step(&self, step_id: &str, error: &str, _failure_kind: Option<&str>) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'failed', last_error = ?1, updated_at = ?2, version = version + 1
             WHERE id = ?3 AND status IN ('pending', 'ready', 'orphaned')",
            params![error, now, step_id],
        ).unwrap_or(0);
        if rows > 0 {
            let context = step_event_context(&conn, step_id);
            insert_operations_event(
                &conn,
                context.as_ref().map(|(_, user_id)| user_id.as_str()),
                None,
                None,
                None,
                context.as_ref().map(|(run_id, _)| run_id.as_str()),
                Some(step_id),
                None,
                "step.failed",
                "step",
                step_id,
                &serde_json::json!({
                    "status": "failed",
                    "error": error,
                }),
            );
        }
        rows > 0
    }

    pub fn cancel_step(&self, step_id: &str, lease_gen: i64, reason: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'cancelled', last_error = ?1, assigned_worker = NULL,
                 lease_deadline = NULL, updated_at = ?2, version = version + 1
             WHERE id = ?3 AND lease_gen = ?4 AND status IN ('leased', 'running')",
            params![reason, now, step_id, lease_gen],
        ).unwrap_or(0);
        if rows > 0 {
            let context = step_event_context(&conn, step_id);
            insert_operations_event(
                &conn,
                context.as_ref().map(|(_, user_id)| user_id.as_str()),
                None,
                None,
                None,
                context.as_ref().map(|(run_id, _)| run_id.as_str()),
                Some(step_id),
                None,
                "step.cancelled",
                "step",
                step_id,
                &serde_json::json!({
                    "status": "cancelled",
                    "lease_gen": lease_gen,
                    "reason": reason,
                }),
            );
        }
        rows > 0
    }

    pub fn cancel_assigned_step(&self, step_id: &str, reason: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'cancelled', last_error = ?1, assigned_worker = NULL,
                 lease_deadline = NULL, updated_at = ?2, version = version + 1
             WHERE id = ?3 AND status IN ('leased', 'running')",
            params![reason, now, step_id],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn mark_step_recovered(&self, step_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'recovered', updated_at = ?1, version = version + 1
             WHERE id = ?2 AND status = 'failed'",
            params![now, step_id],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn record_failed_step_output(
        &self,
        step_id: &str,
        lease_gen: i64,
        output_summary: Option<&str>,
        files_changed: Option<&str>,
        base_commit: Option<&str>,
        head_commit: Option<&str>,
    ) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps
             SET output_summary = ?1,
                 files_changed = ?2,
                 base_commit = ?3,
                 head_commit = ?4,
                 updated_at = ?5,
                 version = version + 1
             WHERE id = ?6
               AND lease_gen = ?7
               AND status IN ('leased', 'running', 'failed')",
            params![output_summary, files_changed, base_commit, head_commit, now, step_id, lease_gen],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn expire_stale_leases(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "UPDATE steps SET status = 'orphaned', assigned_worker = NULL, lease_deadline = NULL,
                 updated_at = ?1, version = version + 1
             WHERE status IN ('leased', 'running') AND lease_deadline < ?1
             RETURNING id"
        ).unwrap();

        stmt.query_map(params![now], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    // --- Step Attempts ---

    pub fn record_attempt(
        &self,
        step_id: &str,
        run_id: &str,
        attempt_number: i32,
        worker_id: &str,
        lease_gen: i64,
        provider: Option<&str>,
        model: Option<&str>,
    ) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO step_attempts (step_id, run_id, attempt_number, worker_id, lease_gen, status, provider, model, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'started', ?6, ?7, ?8)",
            params![step_id, run_id, attempt_number, worker_id, lease_gen, provider, model, now],
        ).ok();
    }

    pub fn complete_attempt(&self, step_id: &str, lease_gen: i64) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE step_attempts SET status = 'succeeded', finished_at = ?1
             WHERE step_id = ?2 AND lease_gen = ?3 AND status = 'started'",
            params![now, step_id, lease_gen],
        ).ok();
    }

    pub fn fail_attempt(&self, step_id: &str, lease_gen: i64, failure_kind: Option<&str>, error: Option<&str>) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE step_attempts SET status = 'failed', finished_at = ?1, failure_kind = ?2, error_summary = ?3
             WHERE step_id = ?4 AND lease_gen = ?5 AND status = 'started'",
            params![now, failure_kind, error, step_id, lease_gen],
        ).ok();
    }

    // --- Decisions & Outcomes ---

    pub fn record_decision(
        &self,
        id: &str,
        user_id: &str,
        run_id: Option<&str>,
        step_id: Option<&str>,
        intent: &str,
        risk: &str,
        tier: &str,
        provider: &str,
        model: &str,
        worker_id: Option<&str>,
        rationale: &str,
        profile: &str,
    ) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO decisions (id, user_id, run_id, step_id, timestamp, intent, risk, tier, provider, model, worker_id, rationale, profile)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![id, user_id, run_id, step_id, now, intent, risk, tier, provider, model, worker_id, rationale, profile],
        ).ok();
    }

    pub fn record_outcome(
        &self,
        decision_id: &str,
        success: bool,
        duration_ms: Option<i64>,
        failure_kind: Option<&str>,
        failure_scope: Option<&str>,
        files_changed: Option<&str>,
        exit_code: Option<i32>,
    ) {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO outcomes (id, decision_id, timestamp, success, duration_ms, failure_kind, failure_scope, files_changed, exit_code)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, decision_id, now, success as i32, duration_ms, failure_kind, failure_scope, files_changed, exit_code],
        ).ok();
    }

    // --- Usage Events ---

    pub fn record_usage(
        &self,
        user_id: &str,
        provider: &str,
        tier: &str,
        model: &str,
        worker_id: Option<&str>,
        tokens_in: Option<i64>,
        tokens_out: Option<i64>,
        duration_ms: Option<i64>,
    ) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO usage_events (user_id, timestamp, provider, tier, model, worker_id, tokens_in, tokens_out, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![user_id, now, provider, tier, model, worker_id, tokens_in, tokens_out, duration_ms],
        ).ok();
    }

    /// Compute pressure per (provider, tier) using exponential time-decay.
    ///
    /// Each usage event's tokens are weighted by `exp(-lambda * age_seconds)` where
    /// `lambda = ln(2) / HALF_LIFE_SECS`. This means usage from 1 hour ago counts 50%,
    /// 2 hours ago 25%, etc. Events older than `window_ms` are still excluded entirely.
    pub fn pressure_for_user(&self, user_id: &str, window_ms: i64) -> Vec<(String, String, i64)> {
        const HALF_LIFE_SECS: f64 = 3600.0; // 1 hour
        let lambda = (2.0_f64).ln() / HALF_LIFE_SECS;

        let conn = self.conn.lock().unwrap();
        let now_ms = Utc::now().timestamp_millis();
        let cutoff = now_ms - window_ms;

        // Fetch individual events so we can apply per-event decay weights
        let mut stmt = conn.prepare(
            "SELECT provider, tier, timestamp, COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)
             FROM usage_events
             WHERE user_id = ?1 AND timestamp > ?2
             ORDER BY provider, tier"
        ).unwrap();

        let rows: Vec<(String, String, i64, i64)> = stmt
            .query_map(params![user_id, cutoff], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Aggregate with exponential decay
        let mut accum: std::collections::HashMap<(String, String), f64> =
            std::collections::HashMap::new();
        for (provider, tier, ts, tokens) in rows {
            let age_secs = ((now_ms - ts) as f64 / 1000.0).max(0.0);
            let weight = (-lambda * age_secs).exp();
            *accum.entry((provider, tier)).or_insert(0.0) += tokens as f64 * weight;
        }

        accum
            .into_iter()
            .map(|((provider, tier), weighted)| (provider, tier, weighted.round() as i64))
            .collect()
    }

    // --- Provider Reliability ---

    pub fn provider_reliability(&self, user_id: &str, hours: i64) -> Vec<(String, i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let cutoff = Utc::now().timestamp_millis() - (hours * 3600 * 1000);
        let mut stmt = conn.prepare(
            "SELECT d.provider, COUNT(*) as total, SUM(o.success) as successes
             FROM outcomes o
             JOIN decisions d ON o.decision_id = d.id
             WHERE o.timestamp > ?1 AND d.user_id = ?2
             GROUP BY d.provider"
        ).unwrap();

        stmt.query_map(params![cutoff, user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    // --- Idempotency ---

    pub fn check_idempotency(&self, key: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.query_row(
            "SELECT result_json FROM idempotency_keys WHERE key = ?1 AND expires_at > ?2",
            params![key, now],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    pub fn set_idempotency(&self, key: &str, result: Option<&str>, ttl_ms: i64) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT OR REPLACE INTO idempotency_keys (key, result_json, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![key, result, now, now + ttl_ms],
        ).ok();
    }

    pub fn cleanup_expired_idempotency(&self) -> usize {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute("DELETE FROM idempotency_keys WHERE expires_at < ?1", params![now])
            .unwrap_or(0)
    }

    // --- Scheduler helpers ---

    pub fn create_step_with_id(
        &self,
        id: &str,
        run_id: &str,
        kind: &str,
        work_kind: &str,
        tier: &str,
        risk: &str,
        objective: &str,
        created_at: i64,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO steps (id, run_id, kind, work_kind, status, tier, risk, objective, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7, ?8, ?8)",
            params![id, run_id, kind, work_kind, tier, risk, objective, created_at],
        ).expect("failed to create step");
    }

    /// Returns (provider, kind, risk) for bandit outcome tracking.
    pub fn get_step_info(&self, step_id: &str) -> Option<(String, String, String)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(a.provider, 'Claude'), s.kind, s.risk
             FROM steps s
             LEFT JOIN step_attempts a ON a.step_id = s.id
             WHERE s.id = ?1
             ORDER BY a.attempt_number DESC
             LIMIT 1",
            params![step_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            )),
        ).ok()
    }

    pub fn get_step_details(&self, step_id: &str) -> Option<(String, String, String, String, String)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT kind, work_kind, tier, risk, objective FROM steps WHERE id = ?1",
            params![step_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            )),
        ).ok()
    }

    pub fn get_step_recipe_seed_json(&self, step_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT recipe_seed_json FROM steps WHERE id = ?1",
            params![step_id],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    pub fn get_run_user_id(&self, run_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT user_id FROM runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        ).ok()
    }

    /// Check if a run belongs to the given user. Returns true if the run exists and is owned by user_id.
    pub fn verify_run_owner(&self, run_id: &str, user_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT 1 FROM runs WHERE id = ?1 AND user_id = ?2",
            params![run_id, user_id],
            |_| Ok(()),
        ).is_ok()
    }

    /// List runs for a specific user, ordered by creation time descending.
    pub fn list_user_runs(&self, user_id: &str, limit: usize, offset: usize) -> Vec<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, goal, status, profile, created_at, updated_at, started_at, finished_at, heal_attempts,
                    task_id, group_id, conversation_id
             FROM runs WHERE user_id = ?1
             ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
        ).unwrap();
        stmt.query_map(params![user_id, limit as i64, offset as i64], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "goal": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "profile": row.get::<_, String>(3)?,
                "created_at": row.get::<_, i64>(4)?,
                "updated_at": row.get::<_, i64>(5)?,
                "started_at": row.get::<_, Option<i64>>(6)?,
                "finished_at": row.get::<_, Option<i64>>(7)?,
                "heal_attempts": row.get::<_, i32>(8)?,
                "task_id": row.get::<_, Option<String>>(9)?,
                "group_id": row.get::<_, Option<String>>(10)?,
                "conversation_id": row.get::<_, Option<String>>(11)?,
            }))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_run_goal(&self, run_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT goal FROM runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        ).ok()
    }

    /// Return timing metadata for a single run (used for PR body generation).
    pub fn list_user_runs_by_id(&self, run_id: &str) -> Option<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, goal, status, profile, created_at, updated_at, started_at, finished_at,
                    task_id, group_id, conversation_id
             FROM runs WHERE id = ?1",
            params![run_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "goal": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "profile": row.get::<_, String>(3)?,
                    "created_at": row.get::<_, i64>(4)?,
                    "updated_at": row.get::<_, i64>(5)?,
                    "started_at": row.get::<_, Option<i64>>(6)?,
                    "finished_at": row.get::<_, Option<i64>>(7)?,
                    "task_id": row.get::<_, Option<String>>(8)?,
                    "group_id": row.get::<_, Option<String>>(9)?,
                    "conversation_id": row.get::<_, Option<String>>(10)?,
                }))
            },
        ).ok()
    }

    pub fn get_run_heal_count(&self, run_id: &str) -> i32 {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT heal_attempts FROM runs WHERE id = ?1",
            params![run_id],
            |row| row.get::<_, i32>(0),
        ).unwrap_or(0)
    }

    pub fn increment_heal_count(&self, run_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE runs SET heal_attempts = heal_attempts + 1, updated_at = ?1 WHERE id = ?2",
            params![now, run_id],
        ).ok();
    }

    pub fn get_step_last_error(&self, step_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT last_error FROM steps WHERE id = ?1",
            params![step_id],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    pub fn get_all_step_statuses(&self, run_id: &str) -> Vec<(String, String)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, status FROM steps WHERE run_id = ?1 ORDER BY created_at ASC, id ASC"
        ).unwrap();
        stmt.query_map(params![run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_run_step_snapshots(&self, run_id: &str) -> Vec<RunStepSnapshot> {
        let conn = self.conn.lock().unwrap();

        let mut predecessors_by_step: HashMap<String, Vec<String>> = HashMap::new();
        let mut predecessor_stmt = conn.prepare(
            "SELECT sd.step_id, sd.depends_on_id
             FROM step_dependencies sd
             JOIN steps s ON s.id = sd.step_id
             WHERE s.run_id = ?1
             ORDER BY sd.step_id ASC, sd.depends_on_id ASC"
        ).unwrap();
        for row in predecessor_stmt
            .query_map(params![run_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
        {
            predecessors_by_step.entry(row.0).or_default().push(row.1);
        }

        let mut verifier_by_step: HashMap<String, VerifierReport> = HashMap::new();
        let mut verifier_stmt = conn.prepare(
            "SELECT id, step_id, run_id, lease_gen, worker_id, verifier, status, verdict,
                    evidence_json, created_at, updated_at
             FROM verifier_reports
             WHERE run_id = ?1
             ORDER BY step_id ASC, created_at DESC"
        ).unwrap();
        for report in verifier_stmt
            .query_map(params![run_id], |row| Ok(VerifierReport {
                id: row.get(0)?,
                step_id: row.get(1)?,
                run_id: row.get(2)?,
                lease_gen: row.get(3)?,
                worker_id: row.get(4)?,
                verifier: row.get(5)?,
                status: row.get(6)?,
                verdict: row.get(7)?,
                evidence_json: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            }))
            .unwrap()
            .filter_map(|r| r.ok())
        {
            verifier_by_step.entry(report.step_id.clone()).or_insert(report);
        }

        let mut contract_by_step: HashMap<String, TaskContract> = HashMap::new();
        let mut contract_stmt = conn.prepare(
            "SELECT step_id, contract_json
             FROM step_work_contracts
             WHERE run_id = ?1
             ORDER BY step_id ASC, lease_gen DESC, created_at DESC"
        ).unwrap();
        for (step_id, contract_json) in contract_stmt
            .query_map(params![run_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
        {
            if contract_by_step.contains_key(&step_id) {
                continue;
            }
            match serde_json::from_str::<TaskContract>(&contract_json) {
                Ok(contract) => {
                    contract_by_step.insert(step_id, contract);
                }
                Err(err) => {
                    tracing::error!(
                        step_id = %step_id,
                        error = %err,
                        "failed to deserialize latest step work contract"
                    );
                }
            }
        }

        let mut attempt_by_step: HashMap<String, RunStepAttemptSnapshot> = HashMap::new();
        let mut attempt_stmt = conn.prepare(
            "SELECT step_id, attempt_number, worker_id, lease_gen, status, provider, model,
                    started_at, finished_at, failure_kind, error_summary
             FROM step_attempts
             WHERE run_id = ?1
             ORDER BY step_id ASC, attempt_number DESC"
        ).unwrap();
        for attempt in attempt_stmt
            .query_map(params![run_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    RunStepAttemptSnapshot {
                        attempt_number: row.get(1)?,
                        worker_id: row.get(2)?,
                        lease_gen: row.get(3)?,
                        status: row.get(4)?,
                        provider: row.get(5)?,
                        model: row.get(6)?,
                        started_at: row.get(7)?,
                        finished_at: row.get(8)?,
                        failure_kind: row.get(9)?,
                        error_summary: row.get(10)?,
                    },
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
        {
            attempt_by_step.entry(attempt.0).or_insert(attempt.1);
        }

        let mut stmt = conn.prepare(
            "SELECT id, status, kind, work_kind, tier, risk, objective, attempt_count, max_attempts,
                    lease_gen, lease_deadline, assigned_worker, recipe_seed_json, output_summary,
                    files_changed, last_error
             FROM steps
             WHERE run_id = ?1
             ORDER BY created_at ASC, id ASC"
        ).unwrap();
        stmt.query_map(params![run_id], |row| {
            let id = row.get::<_, String>(0)?;
            Ok(RunStepSnapshot {
                predecessors: predecessors_by_step.remove(&id).unwrap_or_default(),
                verifier_report: verifier_by_step.remove(&id),
                work_contract: contract_by_step.remove(&id),
                latest_attempt: attempt_by_step.remove(&id),
                id,
                status: row.get(1)?,
                kind: row.get(2)?,
                work_kind: row.get(3)?,
                tier: row.get(4)?,
                risk: row.get(5)?,
                objective: row.get(6)?,
                attempt_count: row.get(7)?,
                max_attempts: row.get(8)?,
                lease_gen: row.get(9)?,
                lease_deadline: row.get(10)?,
                assigned_worker: row.get(11)?,
                recipe_seed_json: row.get(12)?,
                output_summary: row.get(13)?,
                files_changed: row.get(14)?,
                last_error: row.get(15)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_step_run_id(&self, step_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT run_id FROM steps WHERE id = ?1",
            params![step_id],
            |row| row.get(0),
        ).ok()
    }

    pub fn get_active_run_ids(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id FROM runs WHERE status IN ('planning', 'running')"
        ).unwrap();
        stmt.query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn get_provider_status(&self, user_id: &str, provider: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT status FROM provider_capabilities WHERE user_id = ?1 AND provider = ?2
             ORDER BY last_reported DESC LIMIT 1",
            params![user_id, provider],
            |row| row.get(0),
        ).ok()
    }

    pub fn get_user_profile(&self, user_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT active_profile FROM user_profiles WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        ).ok()
    }

    pub fn get_user_auto_mode(&self, user_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT auto_mode FROM user_profiles WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        ).ok()
    }

    pub fn record_score_evidence(
        &self,
        decision_id: &str,
        evaluator: &str,
        evidence_json: &str,
        score: Option<f64>,
        timestamp: i64,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO score_evidence (decision_id, evaluator, evidence_json, score, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![decision_id, evaluator, evidence_json, score, timestamp],
        ).ok();
    }

    pub fn get_step_predecessors(&self, step_id: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT depends_on_id FROM step_dependencies WHERE step_id = ?1 ORDER BY depends_on_id ASC"
        ).unwrap();
        stmt.query_map(params![step_id], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn get_run_step_dependency_edges(&self, run_id: &str) -> Vec<StepDependencyEdge> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT sd.step_id, sd.depends_on_id, sd.edge_type
             FROM step_dependencies sd
             JOIN steps s ON s.id = sd.step_id
             WHERE s.run_id = ?1
             ORDER BY sd.step_id ASC, sd.depends_on_id ASC"
        ).unwrap();
        stmt.query_map(params![run_id], |row| {
            Ok(StepDependencyEdge {
                step_id: row.get::<_, String>(0)?,
                depends_on_id: row.get::<_, String>(1)?,
                edge_type: row.get::<_, String>(2)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_step_output_summary(&self, step_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT output_summary FROM steps WHERE id = ?1",
            params![step_id],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    pub fn get_step_files_changed(&self, step_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT files_changed FROM steps WHERE id = ?1",
            params![step_id],
            |row| row.get::<_, Option<String>>(0),
        ).ok().flatten()
    }

    pub fn record_verifier_report(
        &self,
        step_id: &str,
        run_id: &str,
        lease_gen: i64,
        worker_id: Option<&str>,
        verifier: &str,
        status: &str,
        verdict: &str,
        evidence_json: &str,
    ) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO verifier_reports (
                id, step_id, run_id, lease_gen, worker_id, verifier, status, verdict,
                evidence_json, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                id,
                step_id,
                run_id,
                lease_gen,
                worker_id,
                verifier,
                status,
                verdict,
                evidence_json,
                now
            ],
        ).ok()?;

        let step_verification_status = match (status, verdict) {
            ("verified", "pass") => "verified_pass",
            ("verified", "fail") => "verified_fail",
            ("verified", "blocked") => "verified_blocked",
            ("needs_evidence", _) => "needs_evidence",
            ("error", _) => "verification_error",
            _ => "unverified",
        };
        let verified_at = if status == "verified" { Some(now) } else { None };

        conn.execute(
            "UPDATE steps
             SET verification_status = ?1,
                 verifier_report_id = ?2,
                 verified_at = ?3,
                 updated_at = ?4
             WHERE id = ?5",
            params![step_verification_status, id, verified_at, now, step_id],
        ).ok();
        let context = step_event_context(&conn, step_id);
        insert_operations_event(
            &conn,
            context.as_ref().map(|(_, user_id)| user_id.as_str()),
            None,
            None,
            None,
            Some(run_id),
            Some(step_id),
            None,
            "verifier.reported",
            "verifier_report",
            &id,
            &serde_json::json!({
                "step_id": step_id,
                "lease_gen": lease_gen,
                "worker_id": worker_id,
                "verifier": verifier,
                "status": status,
                "verdict": verdict,
                "step_verification_status": step_verification_status,
            }),
        );

        Some(id)
    }

    pub fn get_latest_verifier_report(&self, step_id: &str) -> Option<VerifierReport> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, step_id, run_id, lease_gen, worker_id, verifier, status, verdict,
                    evidence_json, created_at, updated_at
             FROM verifier_reports
             WHERE step_id = ?1
             ORDER BY created_at DESC
             LIMIT 1",
            params![step_id],
            |row| Ok(VerifierReport {
                id: row.get(0)?,
                step_id: row.get(1)?,
                run_id: row.get(2)?,
                lease_gen: row.get(3)?,
                worker_id: row.get(4)?,
                verifier: row.get(5)?,
                status: row.get(6)?,
                verdict: row.get(7)?,
                evidence_json: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            }),
        ).ok()
    }

    pub fn record_step_work_contract(
        &self,
        step_id: &str,
        run_id: &str,
        lease_gen: i64,
        contract: &TaskContract,
    ) -> bool {
        let contract_json = match serde_json::to_string(contract) {
            Ok(json) => json,
            Err(err) => {
                tracing::error!(
                    step_id = %step_id,
                    lease_gen,
                    error = %err,
                    "failed to serialize step work contract"
                );
                return false;
            }
        };

        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "INSERT INTO step_work_contracts (step_id, lease_gen, run_id, contract_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(step_id, lease_gen) DO UPDATE SET
                run_id = excluded.run_id,
                contract_json = excluded.contract_json,
                created_at = excluded.created_at",
            params![step_id, lease_gen, run_id, contract_json, now],
        ).unwrap_or_else(|err| {
            tracing::error!(
                step_id = %step_id,
                run_id = %run_id,
                lease_gen,
                error = %err,
                "failed to persist step work contract"
            );
            0
        });

        rows > 0
    }

    pub fn get_step_work_contract(
        &self,
        step_id: &str,
        lease_gen: i64,
    ) -> Option<TaskContract> {
        let conn = self.conn.lock().unwrap();
        let contract_json: String = conn.query_row(
            "SELECT contract_json FROM step_work_contracts
             WHERE step_id = ?1 AND lease_gen = ?2",
            params![step_id, lease_gen],
            |row| row.get(0),
        ).ok()?;

        serde_json::from_str(&contract_json)
            .map_err(|err| {
                tracing::error!(
                    step_id = %step_id,
                    lease_gen,
                    error = %err,
                    "failed to deserialize step work contract"
                );
                err
            })
            .ok()
    }

    pub fn get_latest_step_work_contract(&self, step_id: &str) -> Option<TaskContract> {
        let conn = self.conn.lock().unwrap();
        let contract_json: String = conn.query_row(
            "SELECT contract_json FROM step_work_contracts
             WHERE step_id = ?1
             ORDER BY lease_gen DESC, created_at DESC
             LIMIT 1",
            params![step_id],
            |row| row.get(0),
        ).ok()?;

        serde_json::from_str(&contract_json)
            .map_err(|err| {
                tracing::error!(
                    step_id = %step_id,
                    error = %err,
                    "failed to deserialize latest step work contract"
                );
                err
            })
            .ok()
    }

    pub fn get_run_profile(&self, run_id: &str) -> Option<String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT profile FROM runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        ).ok()
    }

    // --- Attempt details (for usage recording) ---

    pub fn get_attempt_provider_model(
        &self,
        step_id: &str,
        lease_gen: i64,
    ) -> Option<(String, String, i64)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(provider, ''), COALESCE(model, ''), started_at
             FROM step_attempts WHERE step_id = ?1 AND lease_gen = ?2
             ORDER BY attempt_number DESC LIMIT 1",
            params![step_id, lease_gen],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).ok()
    }

    // --- Worker sessions ---

    pub fn create_worker_session(&self, session_id: &str, worker_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO worker_sessions (id, worker_id, connected_at, last_heartbeat)
             VALUES (?1, ?2, ?3, ?3)",
            params![session_id, worker_id, now],
        ).ok();
    }

    pub fn disconnect_worker_session(&self, session_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE worker_sessions SET disconnected_at = ?1 WHERE id = ?2",
            params![now, session_id],
        ).ok();
    }

    pub fn set_worker_grace_deadline(&self, worker_id: &str, deadline_ms: i64) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE worker_sessions SET grace_deadline = ?1
             WHERE worker_id = ?2 AND disconnected_at IS NOT NULL AND grace_deadline IS NULL",
            params![deadline_ms, worker_id],
        ).ok();
    }

    pub fn update_heartbeat(&self, worker_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE worker_sessions SET last_heartbeat = ?1
             WHERE worker_id = ?2 AND disconnected_at IS NULL",
            params![now, worker_id],
        ).ok();
    }

    pub fn workers_past_grace(&self) -> Vec<(String, String)> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "SELECT ws.worker_id, s.id FROM worker_sessions ws
             JOIN steps s ON s.assigned_worker = ws.worker_id AND s.status IN ('leased', 'running')
             WHERE ws.disconnected_at IS NOT NULL
             AND ws.grace_deadline IS NOT NULL
             AND ws.grace_deadline < ?1"
        ).unwrap();
        stmt.query_map(params![now], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    // --- User profile mutations ---

    pub fn upsert_user_profile(&self, user_id: &str, profile: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO user_profiles (user_id, active_profile, auto_mode, updated_at)
             VALUES (?1, ?2, 'normal', ?3)
             ON CONFLICT(user_id) DO UPDATE SET active_profile = ?2, updated_at = ?3",
            params![user_id, profile, now],
        ).ok();
    }

    pub fn get_full_user_profile(&self, user_id: &str) -> Option<(String, String)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT active_profile, auto_mode FROM user_profiles WHERE user_id = ?1",
            params![user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok()
    }

    /// List runs with active (non-terminal) status for the MC snapshot.
    pub fn list_active_runs(&self) -> Vec<ActiveRunSummary> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT r.id, r.goal, r.status, r.created_at,
                    COUNT(s.id) as step_count,
                    SUM(CASE WHEN s.status = 'succeeded' THEN 1 ELSE 0 END) as steps_completed,
                    SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) as steps_failed
             FROM runs r
             LEFT JOIN steps s ON s.run_id = r.id
             WHERE r.status IN ('pending', 'running', 'leased')
             GROUP BY r.id
             ORDER BY r.created_at DESC
             LIMIT 50"
        ).unwrap();
        stmt.query_map([], |row| {
            Ok(ActiveRunSummary {
                id: row.get(0)?,
                goal: row.get(1)?,
                status: row.get(2)?,
                created_at: row.get::<_, i64>(3)?.to_string(),
                step_count: row.get::<_, i64>(4)? as usize,
                steps_completed: row.get::<_, i64>(5)? as usize,
                steps_failed: row.get::<_, i64>(6)? as usize,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    // --- Admin queries ---

    pub fn list_all_runs(&self, limit: usize, offset: usize) -> Vec<(String, String, String, String, String)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, goal, status, created_at FROM runs
             ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
        ).unwrap();
        stmt.query_map(params![limit as i64, offset as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?.to_string(),
            ))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn list_decisions(
        &self,
        limit: usize,
        user_id: Option<&str>,
    ) -> Vec<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let (sql, params_vec): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(uid) = user_id {
            (
                "SELECT id, user_id, run_id, step_id, timestamp, intent, risk, tier, provider, model, rationale, profile
                 FROM decisions WHERE user_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
                vec![Box::new(uid.to_string()), Box::new(limit as i64)],
            )
        } else {
            (
                "SELECT id, user_id, run_id, step_id, timestamp, intent, risk, tier, provider, model, rationale, profile
                 FROM decisions ORDER BY timestamp DESC LIMIT ?1",
                vec![Box::new(limit as i64)],
            )
        };

        let mut stmt = conn.prepare(sql).unwrap();
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        stmt.query_map(params_refs.as_slice(), |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "user_id": row.get::<_, String>(1)?,
                "run_id": row.get::<_, Option<String>>(2)?,
                "step_id": row.get::<_, Option<String>>(3)?,
                "timestamp": row.get::<_, i64>(4)?,
                "intent": row.get::<_, String>(5)?,
                "risk": row.get::<_, String>(6)?,
                "tier": row.get::<_, String>(7)?,
                "provider": row.get::<_, String>(8)?,
                "model": row.get::<_, String>(9)?,
                "rationale": row.get::<_, String>(10)?,
                "profile": row.get::<_, String>(11)?,
            }))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn system_stats(&self) -> serde_json::Value {
        let conn = self.conn.lock().unwrap();

        let total_runs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM runs", [], |r| r.get(0)
        ).unwrap_or(0);

        let active_runs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM runs WHERE status IN ('planning', 'running')", [], |r| r.get(0)
        ).unwrap_or(0);

        let total_steps: i64 = conn.query_row(
            "SELECT COUNT(*) FROM steps", [], |r| r.get(0)
        ).unwrap_or(0);

        let succeeded_steps: i64 = conn.query_row(
            "SELECT COUNT(*) FROM steps WHERE status = 'succeeded'", [], |r| r.get(0)
        ).unwrap_or(0);

        let failed_steps: i64 = conn.query_row(
            "SELECT COUNT(*) FROM steps WHERE status = 'failed'", [], |r| r.get(0)
        ).unwrap_or(0);

        let total_decisions: i64 = conn.query_row(
            "SELECT COUNT(*) FROM decisions", [], |r| r.get(0)
        ).unwrap_or(0);

        let connected_workers: i64 = conn.query_row(
            "SELECT COUNT(*) FROM workers WHERE status = 'connected'", [], |r| r.get(0)
        ).unwrap_or(0);

        let total_users: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT user_id) FROM runs", [], |r| r.get(0)
        ).unwrap_or(0);

        serde_json::json!({
            "runs": { "total": total_runs, "active": active_runs },
            "steps": { "total": total_steps, "succeeded": succeeded_steps, "failed": failed_steps },
            "decisions": total_decisions,
            "workers": { "connected": connected_workers },
            "users": total_users,
        })
    }

    pub fn get_worker_list(&self) -> Vec<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT w.id, w.user_id, w.status, w.last_seen,
                    GROUP_CONCAT(pc.provider, ',') as providers
             FROM workers w
             LEFT JOIN provider_capabilities pc ON pc.worker_id = w.id
             GROUP BY w.id
             ORDER BY w.last_seen DESC"
        ).unwrap();
        stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "user_id": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "last_seen": row.get::<_, i64>(3)?,
                "providers": row.get::<_, Option<String>>(4)?
                    .map(|s| s.split(',').map(String::from).collect::<Vec<_>>())
                    .unwrap_or_default(),
            }))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    // --- Steps assigned to a worker (for orphaning on disconnect) ---

    pub fn get_worker_active_steps(&self, worker_id: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id FROM steps WHERE assigned_worker = ?1 AND status IN ('leased', 'running')"
        ).unwrap();
        stmt.query_map(params![worker_id], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    /// Verify that a step is currently assigned to the given worker.
    /// Used to prevent workers from spoofing step completion for steps they don't own.
    pub fn verify_step_worker(&self, step_id: &str, worker_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM steps
                 WHERE id = ?1 AND assigned_worker = ?2
                 AND status IN ('leased', 'running')
                 AND lease_deadline IS NOT NULL AND lease_deadline >= ?3",
                params![step_id, worker_id, Utc::now().timestamp_millis()],
                |row| row.get(0),
            )
            .unwrap_or(0);
        count > 0
    }

    pub fn renew_lease(&self, step_id: &str, lease_gen: i64, new_deadline: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET lease_deadline = ?1, updated_at = ?2
             WHERE id = ?3 AND lease_gen = ?4 AND status IN ('leased', 'running')",
            params![new_deadline, now, step_id, lease_gen],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn set_step_earliest_dispatch(&self, step_id: &str, earliest_ms: i64) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE steps SET earliest_dispatch_at = ?1, updated_at = ?2
             WHERE id = ?3",
            params![earliest_ms, now, step_id],
        ).ok();
    }

    pub fn unlease_step(&self, step_id: &str, lease_gen: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'pending', assigned_worker = NULL, lease_deadline = NULL,
                 updated_at = ?1, version = version + 1
             WHERE id = ?2 AND lease_gen = ?3 AND status = 'leased'",
            params![now, step_id, lease_gen],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn orphan_step(&self, step_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE steps SET status = 'orphaned', assigned_worker = NULL, lease_deadline = NULL,
                 updated_at = ?1, version = version + 1
             WHERE id = ?2 AND status IN ('leased', 'running')",
            params![now, step_id],
        ).ok();
    }

    /// Cascade failure from a failed step to all downstream steps that depend on it
    /// via `success_required` edges. Transitively marks them as 'skipped'.
    /// Returns the list of all skipped step IDs.
    pub fn cascade_failure(&self, failed_step_id: &str) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let mut skipped = Vec::new();
        let mut visited = std::collections::HashSet::new();
        let mut queue = std::collections::VecDeque::new();

        queue.push_back(failed_step_id.to_string());
        visited.insert(failed_step_id.to_string());

        while let Some(current_id) = queue.pop_front() {
            // Find all steps that depend on current_id with success_required edge
            let mut stmt = conn.prepare(
                "SELECT sd.step_id FROM step_dependencies sd
                 JOIN steps s ON s.id = sd.step_id
                 WHERE sd.depends_on_id = ?1 AND sd.edge_type = 'success_required'
                 AND s.status NOT IN ('succeeded', 'failed', 'recovered', 'cancelled', 'skipped')"
            ).unwrap();

            let dependents: Vec<String> = stmt
                .query_map(params![current_id], |row| row.get::<_, String>(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();

            for dep_id in dependents {
                if visited.contains(&dep_id) {
                    continue;
                }
                visited.insert(dep_id.clone());

                conn.execute(
                    "UPDATE steps SET status = 'skipped', updated_at = ?1, version = version + 1
                     WHERE id = ?2 AND status NOT IN ('succeeded', 'failed', 'recovered', 'cancelled', 'skipped')",
                    params![now, dep_id],
                ).ok();

                skipped.push(dep_id.clone());
                queue.push_back(dep_id);
            }
        }

        skipped
    }

    // --- Usage aggregation ---

    /// Get aggregated usage summary for a user since a given timestamp.
    pub fn get_user_usage_summary(&self, user_id: &str, since_ms: i64) -> UsageSummary {
        let conn = self.conn.lock().unwrap();

        // Per-provider breakdown
        let mut stmt = conn.prepare(
            "SELECT provider,
                    COALESCE(SUM(COALESCE(tokens_in, 0)), 0),
                    COALESCE(SUM(COALESCE(tokens_out, 0)), 0),
                    COUNT(*)
             FROM usage_events
             WHERE user_id = ?1 AND timestamp > ?2
             GROUP BY provider"
        ).unwrap();

        let by_provider: Vec<ProviderUsage> = stmt.query_map(params![user_id, since_ms], |row| {
            let provider: String = row.get(0)?;
            let tokens_in: i64 = row.get(1)?;
            let tokens_out: i64 = row.get(2)?;
            let step_count: i64 = row.get(3)?;
            let cost = estimate_cost_by_provider(&provider, tokens_in, tokens_out);
            Ok(ProviderUsage { provider, tokens_in, tokens_out, cost_estimate: cost, step_count })
        }).unwrap().filter_map(|r| r.ok()).collect();

        let total_tokens_in = by_provider.iter().map(|p| p.tokens_in).sum();
        let total_tokens_out = by_provider.iter().map(|p| p.tokens_out).sum();
        let total_cost_estimate = by_provider.iter().map(|p| p.cost_estimate).sum();
        let step_count = by_provider.iter().map(|p| p.step_count).sum();

        UsageSummary {
            total_tokens_in,
            total_tokens_out,
            total_cost_estimate,
            step_count,
            by_provider,
        }
    }

    /// Get daily usage breakdown for a user over the last N days.
    pub fn get_user_daily_usage(&self, user_id: &str, days: u32) -> Vec<DailyUsage> {
        let conn = self.conn.lock().unwrap();
        let cutoff_ms = Utc::now().timestamp_millis() - (days as i64 * 86_400_000);

        let mut stmt = conn.prepare(
            "SELECT DATE(timestamp / 1000, 'unixepoch') as day,
                    COALESCE(SUM(COALESCE(tokens_in, 0)), 0),
                    COALESCE(SUM(COALESCE(tokens_out, 0)), 0),
                    COUNT(*)
             FROM usage_events
             WHERE user_id = ?1 AND timestamp > ?2
             GROUP BY day
             ORDER BY day ASC"
        ).unwrap();

        stmt.query_map(params![user_id, cutoff_ms], |row| {
            let date: String = row.get(0)?;
            let tokens_in: i64 = row.get(1)?;
            let tokens_out: i64 = row.get(2)?;
            let step_count: i64 = row.get(3)?;
            // Use a blended rate for daily aggregation
            let cost_estimate = estimate_cost_by_provider("claude", tokens_in, tokens_out);
            Ok(DailyUsage { date, tokens_in, tokens_out, cost_estimate, step_count })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    /// Get system-wide usage summary since a given timestamp (admin).
    pub fn get_system_usage_summary(&self, since_ms: i64) -> UsageSummary {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT provider,
                    COALESCE(SUM(COALESCE(tokens_in, 0)), 0),
                    COALESCE(SUM(COALESCE(tokens_out, 0)), 0),
                    COUNT(*)
             FROM usage_events
             WHERE timestamp > ?1
             GROUP BY provider"
        ).unwrap();

        let by_provider: Vec<ProviderUsage> = stmt.query_map(params![since_ms], |row| {
            let provider: String = row.get(0)?;
            let tokens_in: i64 = row.get(1)?;
            let tokens_out: i64 = row.get(2)?;
            let step_count: i64 = row.get(3)?;
            let cost = estimate_cost_by_provider(&provider, tokens_in, tokens_out);
            Ok(ProviderUsage { provider, tokens_in, tokens_out, cost_estimate: cost, step_count })
        }).unwrap().filter_map(|r| r.ok()).collect();

        let total_tokens_in = by_provider.iter().map(|p| p.tokens_in).sum();
        let total_tokens_out = by_provider.iter().map(|p| p.tokens_out).sum();
        let total_cost_estimate = by_provider.iter().map(|p| p.cost_estimate).sum();
        let step_count = by_provider.iter().map(|p| p.step_count).sum();

        UsageSummary {
            total_tokens_in,
            total_tokens_out,
            total_cost_estimate,
            step_count,
            by_provider,
        }
    }

    /// Get per-user usage breakdown (admin). Returns (user_id, UsageSummary) pairs.
    pub fn get_per_user_usage(&self, since_ms: i64) -> Vec<(String, UsageSummary)> {
        let conn = self.conn.lock().unwrap();

        // Get distinct users with usage in the window
        let mut user_stmt = conn.prepare(
            "SELECT DISTINCT user_id FROM usage_events WHERE timestamp > ?1"
        ).unwrap();

        let user_ids: Vec<String> = user_stmt
            .query_map(params![since_ms], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        drop(user_stmt);
        drop(conn);

        // Aggregate per user (reuses get_user_usage_summary)
        user_ids
            .into_iter()
            .map(|uid| {
                let summary = self.get_user_usage_summary(&uid, since_ms);
                (uid, summary)
            })
            .collect()
    }

    /// Get historical average step costs for a (user, tier, provider) combination
    /// over the last 7 days. Returns (avg_tokens_in, avg_tokens_out, avg_duration_ms, sample_count).
    pub fn get_historical_step_costs(
        &self,
        user_id: &str,
        tier: &str,
        provider: &str,
    ) -> Option<(i64, i64, i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let cutoff_ms = Utc::now().timestamp_millis() - (7 * 86_400_000);
        conn.query_row(
            "SELECT
                COALESCE(AVG(COALESCE(tokens_in, 0)), 0),
                COALESCE(AVG(COALESCE(tokens_out, 0)), 0),
                COALESCE(AVG(COALESCE(duration_ms, 0)), 0),
                COUNT(*)
             FROM usage_events
             WHERE user_id = ?1 AND tier = ?2 AND provider = ?3 AND timestamp > ?4",
            params![user_id, tier, provider, cutoff_ms],
            |row| {
                let avg_in: f64 = row.get(0)?;
                let avg_out: f64 = row.get(1)?;
                let avg_dur: f64 = row.get(2)?;
                let count: i64 = row.get(3)?;
                Ok((avg_in as i64, avg_out as i64, avg_dur as i64, count))
            },
        )
        .ok()
        .filter(|(_, _, _, count)| *count > 0)
    }

    /// Get a user's usage cost for the current day (since midnight UTC).
    pub fn get_user_daily_cost(&self, user_id: &str) -> (f64, i64) {
        let now = Utc::now();
        let midnight = now.date_naive().and_hms_opt(0, 0, 0).unwrap();
        let midnight_ms = chrono::DateTime::<Utc>::from_naive_utc_and_offset(midnight, Utc)
            .timestamp_millis();
        let summary = self.get_user_usage_summary(user_id, midnight_ms);
        (summary.total_cost_estimate, summary.step_count)
    }

    /// Get a user's usage cost for the current month (since 1st of month UTC).
    pub fn get_user_monthly_cost(&self, user_id: &str) -> f64 {
        let now = Utc::now();
        let first_of_month = now.date_naive().with_day(1).unwrap().and_hms_opt(0, 0, 0).unwrap();
        let first_ms = chrono::DateTime::<Utc>::from_naive_utc_and_offset(first_of_month, Utc)
            .timestamp_millis();
        let summary = self.get_user_usage_summary(user_id, first_ms);
        summary.total_cost_estimate
    }

    // --- Billing & Credits ---

    pub fn get_subscription(&self, clerk_user_id: &str) -> Option<SubscriptionRecord> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT clerk_user_id, stripe_customer_id, stripe_subscription_id, plan_type, status,
                    trial_end, current_period_start, current_period_end
             FROM subscriptions WHERE clerk_user_id = ?1",
            params![clerk_user_id],
            |row| Ok(SubscriptionRecord {
                clerk_user_id: row.get(0)?,
                stripe_customer_id: row.get(1)?,
                stripe_subscription_id: row.get(2)?,
                plan_type: row.get(3)?,
                status: row.get(4)?,
                trial_end: row.get(5)?,
                current_period_start: row.get(6)?,
                current_period_end: row.get(7)?,
            }),
        ).ok()
    }

    pub fn upsert_subscription(&self, sub: &SubscriptionRecord) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO subscriptions
                (clerk_user_id, stripe_customer_id, stripe_subscription_id, plan_type, status,
                 trial_end, current_period_start, current_period_end, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
            params![
                sub.clerk_user_id,
                sub.stripe_customer_id,
                sub.stripe_subscription_id,
                sub.plan_type,
                sub.status,
                sub.trial_end,
                sub.current_period_start,
                sub.current_period_end,
            ],
        ).expect("failed to upsert subscription");
    }

    pub fn get_subscription_by_customer(&self, stripe_customer_id: &str) -> Option<SubscriptionRecord> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT clerk_user_id, stripe_customer_id, stripe_subscription_id, plan_type, status,
                    trial_end, current_period_start, current_period_end
             FROM subscriptions WHERE stripe_customer_id = ?1",
            params![stripe_customer_id],
            |row| Ok(SubscriptionRecord {
                clerk_user_id: row.get(0)?,
                stripe_customer_id: row.get(1)?,
                stripe_subscription_id: row.get(2)?,
                plan_type: row.get(3)?,
                status: row.get(4)?,
                trial_end: row.get(5)?,
                current_period_start: row.get(6)?,
                current_period_end: row.get(7)?,
            }),
        ).ok()
    }

    pub fn get_credit_balance(&self, clerk_user_id: &str) -> CreditBalanceRecord {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT subscription_remaining, subscription_total, pack_remaining
             FROM credit_balances WHERE clerk_user_id = ?1",
            params![clerk_user_id],
            |row| Ok(CreditBalanceRecord {
                subscription_remaining: row.get(0)?,
                subscription_total: row.get(1)?,
                pack_remaining: row.get(2)?,
            }),
        ).unwrap_or(CreditBalanceRecord {
            subscription_remaining: 200.0,
            subscription_total: 200.0,
            pack_remaining: 0.0,
        })
    }

    pub fn deduct_credits(
        &self,
        clerk_user_id: &str,
        amount: f64,
        description: &str,
    ) -> Result<CreditBalanceRecord, String> {
        let conn = self.conn.lock().unwrap();

        conn.execute("BEGIN IMMEDIATE", [])
            .map_err(|e| format!("failed to begin transaction: {e}"))?;

        let (sub_rem, pack_rem) = conn.query_row(
            "SELECT subscription_remaining, pack_remaining FROM credit_balances WHERE clerk_user_id = ?1",
            params![clerk_user_id],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
        ).unwrap_or((200.0, 0.0));

        let total_available = sub_rem + pack_rem;
        if total_available < amount {
            conn.execute("ROLLBACK", []).ok();
            return Err(format!(
                "insufficient credits: need {amount:.2}, have {total_available:.2}"
            ));
        }

        let from_sub = amount.min(sub_rem);
        let from_pack = amount - from_sub;

        let new_sub_rem = sub_rem - from_sub;
        let new_pack_rem = pack_rem - from_pack;

        conn.execute(
            "INSERT INTO credit_balances (clerk_user_id, subscription_remaining, subscription_total, pack_remaining)
             VALUES (?1, ?2, 200.0, ?3)
             ON CONFLICT(clerk_user_id) DO UPDATE SET
                subscription_remaining = ?2, pack_remaining = ?3",
            params![clerk_user_id, new_sub_rem, new_pack_rem],
        ).map_err(|e| {
            conn.execute("ROLLBACK", []).ok();
            format!("failed to update credit balance: {e}")
        })?;

        if from_sub > 0.0 {
            let tx_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO credit_transactions (id, clerk_user_id, amount, balance_type, description)
                 VALUES (?1, ?2, ?3, 'subscription', ?4)",
                params![tx_id, clerk_user_id, -from_sub, description],
            ).map_err(|e| {
                conn.execute("ROLLBACK", []).ok();
                format!("failed to record subscription transaction: {e}")
            })?;
        }

        if from_pack > 0.0 {
            let tx_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO credit_transactions (id, clerk_user_id, amount, balance_type, description)
                 VALUES (?1, ?2, ?3, 'pack', ?4)",
                params![tx_id, clerk_user_id, -from_pack, description],
            ).map_err(|e| {
                conn.execute("ROLLBACK", []).ok();
                format!("failed to record pack transaction: {e}")
            })?;
        }

        conn.execute("COMMIT", [])
            .map_err(|e| format!("failed to commit transaction: {e}"))?;

        let sub_total = conn.query_row(
            "SELECT subscription_total FROM credit_balances WHERE clerk_user_id = ?1",
            params![clerk_user_id],
            |row| row.get::<_, f64>(0),
        ).unwrap_or(200.0);

        Ok(CreditBalanceRecord {
            subscription_remaining: new_sub_rem,
            subscription_total: sub_total,
            pack_remaining: new_pack_rem,
        })
    }

    pub fn reset_subscription_credits(&self, clerk_user_id: &str, total: f64) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO credit_balances (clerk_user_id, subscription_remaining, subscription_total, pack_remaining, last_reset_at)
             VALUES (?1, ?2, ?2, 0.0, datetime('now'))
             ON CONFLICT(clerk_user_id) DO UPDATE SET
                subscription_remaining = ?2, subscription_total = ?2, last_reset_at = datetime('now')",
            params![clerk_user_id, total],
        ).expect("failed to reset subscription credits");
    }

    pub fn init_credit_balance(&self, clerk_user_id: &str, subscription_total: f64) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO credit_balances (clerk_user_id, subscription_remaining, subscription_total, pack_remaining)
             VALUES (?1, ?2, ?2, 0.0)",
            params![clerk_user_id, subscription_total],
        ).expect("failed to init credit balance");
    }

    pub fn add_pack_credits(&self, clerk_user_id: &str, amount: f64) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO credit_balances (clerk_user_id, subscription_remaining, subscription_total, pack_remaining)
             VALUES (?1, 200.0, 200.0, ?2)
             ON CONFLICT(clerk_user_id) DO UPDATE SET pack_remaining = pack_remaining + ?2",
            params![clerk_user_id, amount],
        ).expect("failed to add pack credits");
    }

    pub fn record_billing_event(
        &self,
        clerk_user_id: &str,
        stripe_event_id: &str,
        amount_cents: i64,
        description: &str,
        status: &str,
    ) -> bool {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let rows = conn.execute(
            "INSERT OR IGNORE INTO billing_history (id, clerk_user_id, stripe_event_id, amount_cents, description, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, clerk_user_id, stripe_event_id, amount_cents, description, status],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn get_billing_history(&self, clerk_user_id: &str, limit: i64) -> Vec<BillingHistoryRecord> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, amount_cents, description, status, created_at
             FROM billing_history WHERE clerk_user_id = ?1
             ORDER BY created_at DESC LIMIT ?2"
        ).unwrap();

        stmt.query_map(params![clerk_user_id, limit], |row| {
            Ok(BillingHistoryRecord {
                id: row.get(0)?,
                amount_cents: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_referral_code(&self, code: &str) -> Option<ReferralCodeRecord> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT code, creator_user_id, uses_remaining, total_uses, weeks_earned
             FROM referral_codes WHERE code = ?1",
            params![code],
            |row| Ok(ReferralCodeRecord {
                code: row.get(0)?,
                creator_user_id: row.get(1)?,
                uses_remaining: row.get(2)?,
                total_uses: row.get(3)?,
                weeks_earned: row.get(4)?,
            }),
        ).ok()
    }

    pub fn get_user_referral_code(&self, user_id: &str) -> Option<ReferralCodeRecord> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT code, creator_user_id, uses_remaining, total_uses, weeks_earned
             FROM referral_codes WHERE creator_user_id = ?1",
            params![user_id],
            |row| Ok(ReferralCodeRecord {
                code: row.get(0)?,
                creator_user_id: row.get(1)?,
                uses_remaining: row.get(2)?,
                total_uses: row.get(3)?,
                weeks_earned: row.get(4)?,
            }),
        ).ok()
    }

    pub fn create_user_referral_code(&self, user_id: &str) -> ReferralCodeRecord {
        if let Some(existing) = self.get_user_referral_code(user_id) {
            return existing;
        }
        let short_id = &user_id[user_id.len().saturating_sub(5)..];
        let code = format!("REF-{}", short_id.to_uppercase());
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO referral_codes (code, creator_user_id, uses_remaining, max_uses, total_uses, weeks_earned)
             VALUES (?1, ?2, 50, 50, 0, 0)",
            params![code, user_id],
        ).ok();
        drop(conn);
        self.get_user_referral_code(user_id).unwrap_or(ReferralCodeRecord {
            code,
            creator_user_id: user_id.to_string(),
            uses_remaining: 50,
            total_uses: 0,
            weeks_earned: 0,
        })
    }

    pub fn consume_referral(&self, code: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let rows = conn.execute(
            "UPDATE referral_codes SET uses_remaining = uses_remaining - 1, total_uses = total_uses + 1
             WHERE code = ?1 AND uses_remaining > 0",
            params![code],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn reward_referrer(&self, code: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE referral_codes SET weeks_earned = weeks_earned + 1 WHERE code = ?1",
            params![code],
        ).ok();
    }

    // --- Promo Codes ---

    pub fn create_promo_code(
        &self,
        code: &str,
        discount_type: &str,
        discount_value: f64,
        max_uses: i32,
        expires_at: Option<&str>,
        created_by: &str,
        description: Option<&str>,
        discount_options: Option<&str>,
    ) -> Result<PromoCode, String> {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO promo_codes (id, code, discount_type, discount_value, max_uses, expires_at, created_by, description, discount_options)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, code.to_uppercase(), discount_type, discount_value, max_uses, expires_at, created_by, description, discount_options],
        ).map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                "a promo code with that name already exists".to_string()
            } else {
                format!("failed to create promo code: {e}")
            }
        })?;
        Ok(PromoCode {
            id,
            code: code.to_uppercase(),
            discount_type: discount_type.to_string(),
            discount_value,
            max_uses,
            current_uses: 0,
            expires_at: expires_at.map(String::from),
            active: true,
            created_by: created_by.to_string(),
            created_at: Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            description: description.map(String::from),
            discount_options: discount_options.map(String::from),
        })
    }

    pub fn list_promo_codes(&self) -> Vec<PromoCode> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, code, discount_type, discount_value, max_uses, current_uses, expires_at, active, created_by, created_at, description, discount_options
             FROM promo_codes ORDER BY created_at DESC"
        ).unwrap();
        stmt.query_map([], |row| {
            Ok(PromoCode {
                id: row.get(0)?,
                code: row.get(1)?,
                discount_type: row.get(2)?,
                discount_value: row.get(3)?,
                max_uses: row.get(4)?,
                current_uses: row.get(5)?,
                expires_at: row.get(6)?,
                active: row.get::<_, i32>(7)? != 0,
                created_by: row.get(8)?,
                created_at: row.get(9)?,
                description: row.get(10)?,
                discount_options: row.get(11)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn get_promo_code(&self, code: &str) -> Option<PromoCode> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, code, discount_type, discount_value, max_uses, current_uses, expires_at, active, created_by, created_at, description, discount_options
             FROM promo_codes WHERE code = ?1 COLLATE NOCASE",
            params![code],
            |row| Ok(PromoCode {
                id: row.get(0)?,
                code: row.get(1)?,
                discount_type: row.get(2)?,
                discount_value: row.get(3)?,
                max_uses: row.get(4)?,
                current_uses: row.get(5)?,
                expires_at: row.get(6)?,
                active: row.get::<_, i32>(7)? != 0,
                created_by: row.get(8)?,
                created_at: row.get(9)?,
                description: row.get(10)?,
                discount_options: row.get(11)?,
            }),
        ).ok()
    }

    pub fn update_promo_code(
        &self,
        id: &str,
        active: Option<bool>,
        max_uses: Option<i32>,
        expires_at: Option<Option<&str>>,
        description: Option<Option<&str>>,
    ) -> bool {
        let conn = self.conn.lock().unwrap();
        let mut sets = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(a) = active {
            sets.push("active = ?");
            values.push(Box::new(a as i32));
        }
        if let Some(m) = max_uses {
            sets.push("max_uses = ?");
            values.push(Box::new(m));
        }
        if let Some(e) = expires_at {
            sets.push("expires_at = ?");
            values.push(Box::new(e.map(String::from)));
        }
        if let Some(d) = description {
            sets.push("description = ?");
            values.push(Box::new(d.map(String::from)));
        }
        if sets.is_empty() {
            return false;
        }
        values.push(Box::new(id.to_string()));
        let sql = format!("UPDATE promo_codes SET {} WHERE id = ?", sets.join(", "));
        let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice()).unwrap_or(0) > 0
    }

    pub fn delete_promo_code(&self, id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM promo_codes WHERE id = ?1", params![id]).unwrap_or(0) > 0
    }

    pub fn validate_promo_code(&self, code: &str, user_id: &str) -> Result<PromoCode, String> {
        let promo = self.get_promo_code(code).ok_or("invalid promo code")?;
        if !promo.active {
            return Err("this promo code is no longer active".into());
        }
        if promo.current_uses >= promo.max_uses {
            return Err("this promo code has reached its usage limit".into());
        }
        if let Some(ref exp) = promo.expires_at {
            if let Ok(expiry) = chrono::NaiveDateTime::parse_from_str(exp, "%Y-%m-%d %H:%M:%S") {
                if expiry < Utc::now().naive_utc() {
                    return Err("this promo code has expired".into());
                }
            }
        }
        let conn = self.conn.lock().unwrap();
        let already_used: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM code_redemptions WHERE code = ?1 COLLATE NOCASE AND user_id = ?2",
            params![code, user_id],
            |row| row.get(0),
        ).unwrap_or(false);
        if already_used {
            return Err("you have already used this promo code".into());
        }
        Ok(promo)
    }

    pub fn redeem_promo_code(&self, code: &str, user_id: &str) -> Result<PromoCode, String> {
        let promo = self.validate_promo_code(code, user_id)?;
        let conn = self.conn.lock().unwrap();
        let redemption_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO code_redemptions (id, promo_code_id, code, user_id) VALUES (?1, ?2, ?3, ?4)",
            params![redemption_id, promo.id, promo.code, user_id],
        ).map_err(|e| format!("redemption failed: {e}"))?;
        conn.execute(
            "UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?1",
            params![promo.id],
        ).map_err(|e| format!("usage update failed: {e}"))?;
        Ok(promo)
    }

    pub fn list_redemptions(&self, code: Option<&str>) -> Vec<CodeRedemption> {
        let conn = self.conn.lock().unwrap();
        let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match code {
            Some(c) => (
                "SELECT id, promo_code_id, code, user_id, redeemed_at FROM code_redemptions WHERE code = ?1 COLLATE NOCASE ORDER BY redeemed_at DESC",
                vec![Box::new(c.to_string())],
            ),
            None => (
                "SELECT id, promo_code_id, code, user_id, redeemed_at FROM code_redemptions ORDER BY redeemed_at DESC",
                vec![],
            ),
        };
        let mut stmt = conn.prepare(sql).unwrap();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|v| v.as_ref()).collect();
        stmt.query_map(param_refs.as_slice(), |row| {
            Ok(CodeRedemption {
                id: row.get(0)?,
                promo_code_id: row.get(1)?,
                code: row.get(2)?,
                user_id: row.get(3)?,
                redeemed_at: row.get(4)?,
            })
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    // --- Context Flow Artifacts ---

    pub fn store_context_artifact(
        &self,
        id: &str,
        producer_step_id: &str,
        producer_run_id: &str,
        kind: &str,
        content: &str,
        summary: &str,
        files_changed: &[String],
        confidence: f32,
        tokens: u32,
        created_at: i64,
        metadata: &serde_json::Value,
    ) {
        let conn = self.conn.lock().unwrap();
        let files_json = serde_json::to_string(files_changed).unwrap();
        let metadata_json = serde_json::to_string(metadata).unwrap();

        conn.execute(
            "INSERT INTO context_flow_artifacts
            (id, producer_step_id, producer_run_id, kind, content, summary, files_changed, confidence, tokens, created_at, metadata)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, producer_step_id, producer_run_id, kind, content, summary, files_json, confidence, tokens, created_at, metadata_json],
        ).expect("failed to store context artifact");
    }

    pub fn get_context_artifacts_for_run(&self, run_id: &str) -> Vec<(String, String, String, String, String, Vec<String>, f32, u32, i64)> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, producer_step_id, kind, content, summary, files_changed, confidence, tokens, created_at
            FROM context_flow_artifacts
            WHERE producer_run_id = ?1
            ORDER BY created_at ASC"
        ).unwrap();

        stmt.query_map([run_id], |row| {
            let files_json: String = row.get(5)?;
            let files_changed: Vec<String> = serde_json::from_str(&files_json).unwrap_or_default();
            Ok((
                row.get(0)?, // id
                row.get(1)?, // producer_step_id
                row.get(2)?, // kind
                row.get(3)?, // content
                row.get(4)?, // summary
                files_changed,
                row.get(6)?, // confidence
                row.get(7)?, // tokens
                row.get(8)?, // created_at
            ))
        }).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn cleanup_context_artifacts_for_run(&self, run_id: &str) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM context_flow_artifacts WHERE producer_run_id = ?1",
            params![run_id],
        ).expect("failed to cleanup context artifacts");
    }

    pub fn get_context_artifact_stats(&self) -> (usize, std::collections::HashMap<String, usize>, f32) {
        let conn = self.conn.lock().unwrap();

        // Total count
        let total: usize = conn
            .query_row("SELECT COUNT(*) FROM context_flow_artifacts", [], |row| {
                Ok(row.get::<_, i64>(0)? as usize)
            })
            .unwrap_or(0);

        // Count by kind
        let mut stmt = conn.prepare(
            "SELECT kind, COUNT(*) FROM context_flow_artifacts GROUP BY kind"
        ).unwrap();
        let kind_counts: std::collections::HashMap<String, usize> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        // Average tokens
        let avg_tokens: f32 = conn
            .query_row("SELECT AVG(CAST(tokens AS REAL)) FROM context_flow_artifacts", [], |row| {
                Ok(row.get::<_, f64>(0)? as f32)
            })
            .unwrap_or(0.0);

        (total, kind_counts, avg_tokens)
    }

    pub fn get_recent_runs_with_artifacts(&self, limit: usize) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT producer_run_id FROM context_flow_artifacts
             ORDER BY created_at DESC LIMIT ?1"
        ).unwrap();

        stmt.query_map([limit], |row| {
            Ok(row.get::<_, String>(0)?)
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let dir = tempfile::tempdir().unwrap().keep();
        Database::open(&dir.join("cortex.sqlite"))
    }

    fn task_state(task_id: &str, title: &str) -> serde_json::Value {
        serde_json::json!({
            "tasks": [{
                "id": task_id,
                "groupId": "group-1",
                "title": title,
                "status": "created",
                "priority": "normal",
                "createdAt": "2026-05-25T00:00:00Z",
                "updatedAt": "2026-05-25T00:00:00Z",
                "createdBy": "You"
            }],
            "members": [],
            "activity": [],
            "updatedAt": "2026-05-25T00:00:00Z"
        })
    }

    fn task_state_with_tasks(tasks: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "tasks": tasks,
            "members": [],
            "activity": [],
            "updatedAt": "2026-05-25T00:00:00Z"
        })
    }

    #[test]
    fn upsert_group_task_state_indexes_and_reconciles_cortex_tasks() {
        let db = test_db();
        db.upsert_group_task_state("user-1", "group-1", &task_state("task-1", "First task"));

        assert!(db.cortex_task_exists("user-1", "group-1", "task-1"));

        db.upsert_group_task_state("user-1", "group-1", &task_state("task-2", "Second task"));

        assert!(!db.cortex_task_exists("user-1", "group-1", "task-1"));
        assert!(db.cortex_task_exists("user-1", "group-1", "task-2"));
    }

    #[test]
    fn create_run_with_metadata_updates_cortex_task_latest_run() {
        let db = test_db();
        db.upsert_group_task_state("user-1", "group-1", &task_state("task-1", "First task"));
        let conversation = db.create_conversation("user-1", Some("Project Chat"));

        let run_id = db.create_run_with_metadata(
            "user-1",
            "Ship task",
            "auto",
            &[],
            Some("task-1"),
            Some("group-1"),
            Some(&conversation.id),
        );

        let conn = db.conn.lock().unwrap();
        let (latest_run_id, conversation_id): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT latest_run_id, conversation_id FROM cortex_tasks
                 WHERE user_id = ?1 AND group_id = ?2 AND id = ?3",
                params!["user-1", "group-1", "task-1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(latest_run_id.as_deref(), Some(run_id.as_str()));
        assert_eq!(conversation_id.as_deref(), Some(conversation.id.as_str()));

        assert!(conn
            .query_row(
                "SELECT 1 FROM cortex_task_chats
                 WHERE user_id = ?1 AND group_id = ?2 AND task_id = ?3 AND conversation_id = ?4",
                params!["user-1", "group-1", "task-1", conversation.id],
                |_| Ok(())
            )
            .is_ok());
    }

    #[test]
    fn get_cortex_task_projection_returns_task_runs_chats_and_events() {
        let db = test_db();
        db.upsert_group_task_state("user-1", "group-1", &task_state("task-1", "First task"));
        let conversation = db.create_conversation("user-1", Some("Project Chat"));

        let run_id = db.create_run_with_metadata(
            "user-1",
            "Ship task",
            "auto",
            &[],
            Some("task-1"),
            Some("group-1"),
            Some(&conversation.id),
        );

        let projection = db
            .get_cortex_task_projection("user-1", "group-1", "task-1", 100)
            .expect("task projection");

        assert_eq!(projection["task"]["id"], "task-1");
        assert_eq!(projection["task"]["group_id"], "group-1");
        assert_eq!(projection["task"]["latest_run_id"], run_id);
        assert_eq!(projection["task"]["conversation_id"], conversation.id);
        assert_eq!(projection["runs"][0]["id"], run_id);
        assert_eq!(projection["chats"][0]["id"], conversation.id);
        assert!(projection["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event["event_type"] == "run.created"
                && event["run_id"] == run_id
                && event["task_id"] == "task-1"));
    }

    #[test]
    fn get_group_operations_summary_counts_user_scoped_backend_state() {
        let db = test_db();
        db.upsert_group_task_state("user-1", "group-1", &task_state_with_tasks(serde_json::json!([
            {
                "id": "task-urgent",
                "groupId": "group-1",
                "title": "Urgent queued task",
                "status": "created",
                "priority": "urgent",
                "assigneeId": null,
                "createdAt": "2026-05-25T00:00:00Z",
                "updatedAt": "2026-05-25T00:00:00Z",
                "createdBy": "You"
            },
            {
                "id": "task-active",
                "groupId": "group-1",
                "title": "Active backend task",
                "status": "in-progress",
                "priority": "normal",
                "assigneeId": "user-1",
                "createdAt": "2026-05-25T00:00:00Z",
                "updatedAt": "2026-05-25T00:00:00Z",
                "createdBy": "You"
            }
        ])));
        db.upsert_group_task_state("user-2", "group-1", &task_state("task-other-user", "Other user task"));

        let run_id = db.create_run_with_metadata(
            "user-1",
            "Ship active backend task",
            "auto",
            &[],
            Some("task-active"),
            Some("group-1"),
            None,
        );
        assert!(db.update_run_status(&run_id, "failed", Some("test failure")));

        let other_run_id = db.create_run_with_metadata(
            "user-2",
            "Other user run",
            "auto",
            &[],
            Some("task-other-user"),
            Some("group-1"),
            None,
        );
        assert!(db.update_run_status(&other_run_id, "failed", Some("should not leak")));

        let summary = db.get_group_operations_summary("user-1", "group-1", 25);

        assert_eq!(summary["group_id"], "group-1");
        assert_eq!(summary["scope"], "group");
        assert_eq!(summary["tasks"]["total"], 2);
        assert_eq!(summary["tasks"]["open"], 2);
        assert_eq!(summary["tasks"]["active"], 1);
        assert_eq!(summary["tasks"]["urgent"], 1);
        assert_eq!(summary["tasks"]["without_run"], 1);
        assert_eq!(summary["tasks"]["completion"]["gated_done_available"], false);
        assert_eq!(summary["runs"]["total"], 1);
        assert_eq!(summary["runs"]["failed"], 1);
        assert_eq!(summary["runs"]["latest_run_id"], run_id);
        assert!(summary["attention"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["kind"] == "urgent_not_active"
                && item["task_id"] == "task-urgent"));
        assert!(summary["attention"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["kind"] == "failed_run"
                && item["run_id"] == run_id));
        assert!(summary["recent_events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|event| event["actor_user_id"] == "user-1"));
    }
}
