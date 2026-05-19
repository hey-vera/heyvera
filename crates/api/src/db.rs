use std::path::Path;
use std::sync::Mutex;

use chrono::{Datelike, Utc};
use cortex_core::usage::{DailyUsage, ProviderUsage, UsageSummary, estimate_cost};
use rusqlite::{params, Connection};
use serde::Serialize;
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

// --- Schema version ---

const SCHEMA_VERSION: i64 = 3;

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

// --- Database implementation ---

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

    pub fn create_run(&self, user_id: &str, goal: &str, profile: &str) -> String {
        let conn = self.conn.lock().unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO runs (id, user_id, goal, status, profile, created_at, updated_at) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?5)",
            params![id, user_id, goal, profile, now],
        ).expect("failed to create run");
        id
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

    pub fn update_run_status(&self, run_id: &str, status: &str, failure_reason: Option<&str>) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let finished = if matches!(status, "succeeded" | "failed" | "cancelled") { Some(now) } else { None };
        let rows = conn.execute(
            "UPDATE runs SET status = ?1, failure_reason = ?2, finished_at = ?3, updated_at = ?4, version = version + 1
             WHERE id = ?5",
            params![status, failure_reason, finished, now, run_id],
        ).unwrap_or(0);
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
            "INSERT INTO steps (id, run_id, kind, status, tier, risk, objective, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?7)",
            params![id, run_id, kind, tier, risk, objective, now],
        ).expect("failed to create step");
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
        let mut stmt = conn.prepare(
            "SELECT s.id FROM steps s
             WHERE s.run_id = ?1 AND s.status = 'pending'
             AND NOT EXISTS (
                 SELECT 1 FROM step_dependencies sd
                 JOIN steps dep ON dep.id = sd.depends_on_id
                 WHERE sd.step_id = s.id
                 AND (
                     (sd.edge_type = 'success_required' AND dep.status != 'succeeded')
                     OR (sd.edge_type = 'completion_required' AND dep.status NOT IN ('succeeded', 'failed'))
                 )
             )"
        ).unwrap();

        stmt.query_map(params![run_id], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }

    pub fn lease_step(&self, step_id: &str, worker_id: &str, deadline_ms: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'leased', assigned_worker = ?1, lease_deadline = ?2,
                 lease_gen = lease_gen + 1, attempt_count = attempt_count + 1,
                 updated_at = ?3, version = version + 1
             WHERE id = ?4 AND status IN ('pending', 'ready')",
            params![worker_id, deadline_ms, now, step_id],
        ).unwrap_or(0);
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
        rows > 0
    }

    pub fn fail_step(&self, step_id: &str, lease_gen: i64, error: &str, failure_kind: Option<&str>) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET status = 'failed', last_error = ?1, updated_at = ?2, version = version + 1
             WHERE id = ?3 AND lease_gen = ?4 AND status IN ('leased', 'running')",
            params![error, now, step_id, lease_gen],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn expire_stale_leases(&self) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let mut stmt = conn.prepare(
            "UPDATE steps SET status = 'orphaned', updated_at = ?1, version = version + 1
             WHERE status = 'leased' AND lease_deadline < ?1
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

    pub fn pressure_for_user(&self, user_id: &str, window_ms: i64) -> Vec<(String, String, i64)> {
        let conn = self.conn.lock().unwrap();
        let cutoff = Utc::now().timestamp_millis() - window_ms;
        let mut stmt = conn.prepare(
            "SELECT provider, tier, COALESCE(SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)), 0)
             FROM usage_events
             WHERE user_id = ?1 AND timestamp > ?2
             GROUP BY provider, tier"
        ).unwrap();

        stmt.query_map(params![user_id, cutoff], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
        }).unwrap().filter_map(|r| r.ok()).collect()
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
        tier: &str,
        risk: &str,
        objective: &str,
        created_at: i64,
    ) {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO steps (id, run_id, kind, status, tier, risk, objective, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?7)",
            params![id, run_id, kind, tier, risk, objective, created_at],
        ).expect("failed to create step");
    }

    pub fn get_step_details(&self, step_id: &str) -> Option<(String, String, String, String)> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT kind, tier, risk, objective FROM steps WHERE id = ?1",
            params![step_id],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            )),
        ).ok()
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
            "SELECT id, goal, status, profile, created_at, updated_at, started_at, finished_at, heal_attempts
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
            "SELECT id, status FROM steps WHERE run_id = ?1"
        ).unwrap();
        stmt.query_map(params![run_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
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
            "SELECT depends_on_id FROM step_dependencies WHERE step_id = ?1"
        ).unwrap();
        stmt.query_map(params![step_id], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
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

    pub fn renew_lease(&self, step_id: &str, lease_gen: i64, new_deadline: i64) -> bool {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        let rows = conn.execute(
            "UPDATE steps SET lease_deadline = ?1, updated_at = ?2
             WHERE id = ?3 AND lease_gen = ?4 AND status = 'leased'",
            params![new_deadline, now, step_id, lease_gen],
        ).unwrap_or(0);
        rows > 0
    }

    pub fn orphan_step(&self, step_id: &str) {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE steps SET status = 'orphaned', updated_at = ?1, version = version + 1
             WHERE id = ?2 AND status IN ('leased', 'running')",
            params![now, step_id],
        ).ok();
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
            let cost = estimate_cost(&provider, tokens_in, tokens_out);
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
            let cost_estimate = estimate_cost("claude", tokens_in, tokens_out);
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
            let cost = estimate_cost(&provider, tokens_in, tokens_out);
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

}
