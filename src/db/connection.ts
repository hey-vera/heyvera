import Database from 'better-sqlite3';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import * as sqliteVec from 'sqlite-vec';

export const DB_PATH = path.join(process.cwd(), 'data', 'orchestrator.db');

/** Safe JSON.parse that returns a fallback on error instead of throwing. */
export function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    logger.warn({ json: json.slice(0, 100) }, 'Failed to parse stored JSON');
    return fallback;
  }
}

/**
 * Append a row to audit_log — fire-and-forget, never throws.
 * Used to track all credit movements for accounting and debugging.
 */
export function logAudit(params: {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, data_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        nanoid(16),
        params.entityType,
        params.entityId,
        params.action,
        params.actorId ?? null,
        params.data ? JSON.stringify(params.data) : null,
      );
  } catch {
    // Never let audit failures crash the caller
  }
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

export function closeDb(): void {
  if (db) {
    // Checkpoint WAL before closing — flushes pending writes to the main DB file
    // and truncates the WAL, preventing it from growing across restarts.
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      logger.warn({ err }, 'WAL checkpoint failed during close');
    }
    db.close();
    logger.info('Database closed');
  }
}

// ─── Migrations ───────────────────────────────────────────────────────────────

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 1, sql: `ALTER TABLE orchestrations ADD COLUMN api_key TEXT` },
  { version: 2, sql: `ALTER TABLE orchestrations ADD COLUMN skill_id TEXT` },
  { version: 3, sql: `ALTER TABLE skills ADD COLUMN version TEXT NOT NULL DEFAULT '1.0.0'` },
  { version: 4, sql: `ALTER TABLE skills ADD COLUMN input_schema_json TEXT` },
  { version: 5, sql: `ALTER TABLE skills ADD COLUMN output_schema_json TEXT` },
  { version: 6, sql: `ALTER TABLE skills ADD COLUMN published_at TEXT` },
  { version: 7, sql: `ALTER TABLE skills ADD COLUMN tags_json TEXT` },
  { version: 8, sql: `ALTER TABLE skills ADD COLUMN forked_from TEXT` },
  { version: 9, sql: `ALTER TABLE skills ADD COLUMN ab_challenger TEXT` },
  { version: 10, sql: `ALTER TABLE skills ADD COLUMN active INTEGER NOT NULL DEFAULT 1` },
  { version: 11, sql: `UPDATE skills SET revenue_share_pct = 0.97 WHERE revenue_share_pct = 0.10` },
  // Marketplace v2 columns
  { version: 12, sql: `ALTER TABLE skills ADD COLUMN readme TEXT` },
  { version: 13, sql: `ALTER TABLE skills ADD COLUMN license TEXT DEFAULT 'MIT'` },
  { version: 14, sql: `ALTER TABLE skills ADD COLUMN runtime_json TEXT` },
  { version: 15, sql: `ALTER TABLE skills ADD COLUMN stars INTEGER NOT NULL DEFAULT 0` },
  { version: 16, sql: `ALTER TABLE skills ADD COLUMN views INTEGER NOT NULL DEFAULT 0` },
  { version: 17, sql: `ALTER TABLE skills ADD COLUMN forks INTEGER NOT NULL DEFAULT 0` },
  { version: 18, sql: `ALTER TABLE skills ADD COLUMN security_status TEXT NOT NULL DEFAULT 'UNSCANNED'` },
  { version: 19, sql: `ALTER TABLE skills ADD COLUMN scanned_at TEXT` },
  { version: 20, sql: `ALTER TABLE skills ADD COLUMN status TEXT NOT NULL DEFAULT 'PUBLISHED'` },
  { version: 21, sql: `CREATE TABLE IF NOT EXISTS skill_stars (skill_id TEXT NOT NULL, agent_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (skill_id, agent_key))` },
  { version: 22, sql: `ALTER TABLE skills ADD COLUMN display_name TEXT` },
  { version: 23, sql: `ALTER TABLE skills ADD COLUMN changelog TEXT` },
  { version: 24, sql: `ALTER TABLE skill_versions ADD COLUMN changelog TEXT` },
  { version: 25, sql: `ALTER TABLE skills ADD COLUMN category TEXT NOT NULL DEFAULT 'general'` },
  { version: 26, sql: `ALTER TABLE skills ADD COLUMN skill_type TEXT NOT NULL DEFAULT 'prompt_template'` },
  { version: 27, sql: `ALTER TABLE skills ADD COLUMN proxy_url TEXT` },
  { version: 28, sql: `ALTER TABLE skills ADD COLUMN proxy_method TEXT NOT NULL DEFAULT 'POST'` },
  { version: 29, sql: `CREATE TABLE IF NOT EXISTS endpoint_health (
    endpoint_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    last_checked TEXT,
    last_status TEXT NOT NULL DEFAULT 'unknown',
    uptime_pct REAL NOT NULL DEFAULT 100.0,
    avg_latency_ms INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  )` },
  { version: 30, sql: `CREATE TABLE IF NOT EXISTS skill_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    skill_id TEXT NOT NULL,
    reporter_key TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(skill_id, reporter_key)
  )` },
  { version: 31, sql: `CREATE TABLE IF NOT EXISTS telegram_subscribers (
    chat_id INTEGER PRIMARY KEY,
    subscribed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )` },
  { version: 32, sql: `CREATE TABLE IF NOT EXISTS stripe_refunded_charges (
    charge_id TEXT PRIMARY KEY,
    amount_refunded_cents INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )` },
  { version: 33, sql: `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    requester_key TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error TEXT,
    idempotency_key TEXT UNIQUE,
    webhook_url TEXT,
    cost_credits INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_requester ON tasks(requester_key);
  CREATE INDEX IF NOT EXISTS idx_tasks_skill ON tasks(skill_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key)` },
  { version: 34, sql: `CREATE TABLE IF NOT EXISTS task_ratings (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE,
    rated_by TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_ratings_task ON task_ratings(task_id)` },
  { version: 35, sql: `ALTER TABLE skills ADD COLUMN execution_plan_json TEXT` },
  { version: 36, sql: `CREATE TABLE IF NOT EXISTS skill_ratings (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    buyer_key TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(skill_id, buyer_key)
  );
  CREATE INDEX IF NOT EXISTS idx_skill_ratings_skill ON skill_ratings(skill_id);
  CREATE INDEX IF NOT EXISTS idx_skill_ratings_buyer ON skill_ratings(buyer_key)` },
  { version: 37, sql: `ALTER TABLE skills ADD COLUMN featured INTEGER NOT NULL DEFAULT 0` },
  { version: 38, sql: `
    CREATE INDEX IF NOT EXISTS idx_skill_metrics_timestamp ON skill_metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_solana_sigs_processed_at ON solana_processed_sigs(processed_at)
  ` },
  { version: 39, sql: `CREATE INDEX IF NOT EXISTS idx_skills_author_active ON skills(author_key, active)` },
  { version: 40, sql: `CREATE INDEX IF NOT EXISTS idx_task_ratings_rater ON task_ratings(rated_by)` },
  { version: 41, sql: `
    UPDATE orchestrations SET planned_steps = 0 WHERE planned_steps IS NULL;
    UPDATE orchestrations SET executed_steps = 0 WHERE executed_steps IS NULL;
    UPDATE orchestrations SET successful_steps = 0 WHERE successful_steps IS NULL;
    UPDATE orchestrations SET cache_hits = 0 WHERE cache_hits IS NULL;
    UPDATE orchestrations SET total_duration_ms = 0 WHERE total_duration_ms IS NULL;
    UPDATE orchestrations SET api_cost = 0 WHERE api_cost IS NULL;
    UPDATE orchestrations SET markup = 0 WHERE markup IS NULL;
    UPDATE orchestrations SET total = 0 WHERE total IS NULL;
    UPDATE orchestrations SET success = 0 WHERE success IS NULL
  ` },
  // Ch02 audit: financial safety triggers — prevent credits from ever going negative
  { version: 42, sql: `
    CREATE TRIGGER IF NOT EXISTS trg_credits_non_negative
    BEFORE UPDATE OF credits ON api_keys
    WHEN NEW.credits < 0
    BEGIN
      SELECT RAISE(ABORT, 'credits cannot go negative');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_credit_cost_non_negative
    BEFORE INSERT ON skills
    WHEN NEW.credit_cost < 0
    BEGIN
      SELECT RAISE(ABORT, 'credit_cost cannot be negative');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_credit_cost_update_non_negative
    BEFORE UPDATE OF credit_cost ON skills
    WHEN NEW.credit_cost < 0
    BEGIN
      SELECT RAISE(ABORT, 'credit_cost cannot be negative');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_escrow_amount_positive
    BEFORE INSERT ON escrows
    WHEN NEW.amount_credits <= 0
    BEGIN
      SELECT RAISE(ABORT, 'escrow amount_credits must be positive');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_stake_amount_positive
    BEFORE INSERT ON stakes
    WHEN NEW.amount_credits <= 0
    BEGIN
      SELECT RAISE(ABORT, 'stake amount_credits must be positive');
    END
  ` },
  // Ch02 audit: missing indexes on columns used by cleanup queries
  { version: 43, sql: `
    CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
    CREATE INDEX IF NOT EXISTS idx_stripe_sessions_processed ON stripe_processed_sessions(processed_at);
    CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_processed_events(processed_at);
    CREATE INDEX IF NOT EXISTS idx_peers_last_seen ON peers(last_seen);
    CREATE INDEX IF NOT EXISTS idx_claim_tokens_expires ON claim_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);
    CREATE INDEX IF NOT EXISTS idx_swarms_created ON swarms(created_at);
    CREATE INDEX IF NOT EXISTS idx_reputation_timestamp ON reputation_events(timestamp)
  ` },
  // Ch03 audit: covering index for getCreatorStats — avoids full table scan on transactions
  { version: 44, sql: `
    CREATE INDEX IF NOT EXISTS idx_transactions_creator_stats
      ON transactions(to_agent, type, skill_id, amount_credits, fee_credits)
      WHERE type = 'SKILL_SALE'
  ` },
  // Skill classes: standard, recursive, self_checking — foundation for composable skills
  { version: 45, sql: `ALTER TABLE skills ADD COLUMN skill_class TEXT NOT NULL DEFAULT 'standard'` },
  // Webhook delivery tracking for retry reliability
  { version: 46, sql: `ALTER TABLE tasks ADD COLUMN webhook_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tasks ADD COLUMN webhook_status TEXT` },
  // Agent Context Layer — per-agent persistent cache for sub-10ms lookups
  // EVM wallet for x402 auto-split payouts (Option C lite)
  { version: 48, sql: `ALTER TABLE skills ADD COLUMN creator_evm_wallet TEXT` },
  // Payout tx hash — track on-chain tx after cron settlement
  { version: 49, sql: `ALTER TABLE payout_requests ADD COLUMN tx_hash TEXT` },
  // Data skills: sample output for marketplace cards + smart cache TTL by update frequency
  { version: 50, sql: `ALTER TABLE skills ADD COLUMN sample_output_json TEXT` },
  { version: 51, sql: `ALTER TABLE skills ADD COLUMN update_frequency TEXT NOT NULL DEFAULT 'static'` },
  // Paired skills: link LLM analysis ↔ data variant for marketplace toggle cards
  { version: 52, sql: `ALTER TABLE skills ADD COLUMN paired_skill_id TEXT` },
  // Agent Economy: credit transfers (agent-to-agent payments)
  { version: 53, sql: `
    CREATE TABLE IF NOT EXISTS credit_transfers (
      id TEXT PRIMARY KEY,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      memo TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_from ON credit_transfers(from_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transfers_to ON credit_transfers(to_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transfers_idempotency ON credit_transfers(idempotency_key)
  ` },
  // Agent Economy: delegated sub-keys with spending caps
  { version: 54, sql: `
    CREATE TABLE IF NOT EXISTS delegated_keys (
      child_key TEXT PRIMARY KEY,
      parent_key TEXT NOT NULL,
      label TEXT,
      spend_limit REAL NOT NULL,
      spent REAL NOT NULL DEFAULT 0,
      expires_at TEXT,
      permissions_json TEXT NOT NULL DEFAULT '["invoke","query"]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_delegated_parent ON delegated_keys(parent_key)
  ` },
  // Agent Economy: auto-payout threshold config
  { version: 55, sql: `
    CREATE TABLE IF NOT EXISTS auto_payout_config (
      agent_key TEXT PRIMARY KEY,
      threshold_credits REAL NOT NULL,
      usdc_wallet TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  ` },
  // Agent Economy: safety trigger — transfer amount must be positive
  { version: 56, sql: `
    CREATE TRIGGER IF NOT EXISTS trg_transfer_amount_positive
    BEFORE INSERT ON credit_transfers
    WHEN NEW.amount <= 0
    BEGIN
      SELECT RAISE(ABORT, 'transfer amount must be positive');
    END
  ` },
  // v57: increase subscription allotment from 40k → 50k credits/month
  { version: 57, sql: `UPDATE subscriptions SET credits_per_month = 50000 WHERE credits_per_month = 40000` },
  { version: 47, sql: `
    CREATE TABLE IF NOT EXISTS agent_contexts (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      params_hash TEXT NOT NULL,
      category TEXT,
      data_json TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      UNIQUE(api_key, endpoint_id, params_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_ctx_key ON agent_contexts(api_key);
    CREATE INDEX IF NOT EXISTS idx_agent_ctx_expires ON agent_contexts(expires_at);
    CREATE INDEX IF NOT EXISTS idx_agent_ctx_lookup ON agent_contexts(api_key, endpoint_id, params_hash);
  ` },
];

function runMigrations(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(r => r.version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    try {
      db.exec(m.sql);
    } catch (err) {
      // Column/index may already exist — log but don't fail startup
      logger.warn({ version: m.version, err }, 'DB migration warning (may already be applied)');
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(m.version);
    logger.info({ version: m.version }, 'DB migration applied');
  }
}

export function initDb(): void {
  db = new Database(DB_PATH);
  try {
    sqliteVec.load(db);
  } catch (err) {
    logger.warn({ err }, 'sqlite-vec failed to load — vector search unavailable (binary incompatibility?)');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestrations (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      query TEXT NOT NULL,
      planned_steps INTEGER,
      executed_steps INTEGER,
      successful_steps INTEGER,
      cache_hits INTEGER,
      total_duration_ms INTEGER,
      api_cost REAL,
      markup REAL,
      total REAL,
      success INTEGER,
      llm_provider TEXT,
      api_key TEXT,
      skill_id TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      rating INTEGER,
      comment TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      credits INTEGER NOT NULL DEFAULT 0,
      credits_used INTEGER NOT NULL DEFAULT 0,
      stripe_session_id TEXT UNIQUE,
      amount_paid REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      clerk_user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS claim_tokens (
      token TEXT PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      purchase_email TEXT NOT NULL,
      api_key TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
      clerk_user_id TEXT PRIMARY KEY,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      multiaddr TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS solana_processed_sigs (
      signature TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stripe_processed_sessions (
      session_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stripe_processed_events (
      event_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      subscription_id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      credits_per_month INTEGER NOT NULL DEFAULT 50000,
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_send_log (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_uses (
      referree_key TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      prompt_template TEXT NOT NULL,
      author_key TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0,
      credit_cost INTEGER NOT NULL DEFAULT 0,
      revenue_share_pct REAL NOT NULL DEFAULT 0.97,
      uses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skills_author ON skills(author_key);
    CREATE INDEX IF NOT EXISTS idx_skills_public ON skills(public);

    CREATE TABLE IF NOT EXISTS reputation_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      skill_id TEXT,
      event_type TEXT NOT NULL,
      score_delta REAL,
      data_json TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reputation_agent ON reputation_events(agent_id);
    CREATE INDEX IF NOT EXISTS idx_reputation_skill ON reputation_events(skill_id);

    CREATE TABLE IF NOT EXISTS skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL,
      forked_from_skill TEXT,
      forked_from_version TEXT,
      forked_by_agent TEXT,
      promoted INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skill_metrics (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      latency_ms INTEGER,
      success INTEGER NOT NULL DEFAULT 0,
      cost_credits INTEGER,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_metrics_skill ON skill_metrics(skill_id);
    CREATE INDEX IF NOT EXISTS idx_skill_metrics_version ON skill_metrics(skill_id, version);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      from_agent TEXT,
      to_agent TEXT,
      amount_credits INTEGER NOT NULL,
      type TEXT NOT NULL,
      skill_id TEXT,
      fee_credits INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stakes (
      id TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL,
      skill_id TEXT,
      amount_credits INTEGER NOT NULL,
      staked_at TEXT NOT NULL DEFAULT (datetime('now')),
      unlocks_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_agent);
    CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_agent);
    CREATE INDEX IF NOT EXISTS idx_transactions_skill ON transactions(skill_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_stakes_agent ON stakes(agent_key);
    CREATE INDEX IF NOT EXISTS idx_stakes_skill ON stakes(skill_id);
    CREATE INDEX IF NOT EXISTS idx_stakes_unlocks ON stakes(unlocks_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

    CREATE TABLE IF NOT EXISTS escrows (
      id TEXT PRIMARY KEY,
      hirer_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      amount_credits INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'CREATED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deadline TEXT,
      completed_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id TEXT,
      data_json TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_escrows_hirer ON escrows(hirer_id);
    CREATE INDEX IF NOT EXISTS idx_escrows_worker ON escrows(worker_id);
    CREATE INDEX IF NOT EXISTS idx_escrows_state ON escrows(state);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

    CREATE INDEX IF NOT EXISTS idx_orchestrations_timestamp ON orchestrations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_orchestrations_query ON orchestrations(query);
    CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);
    CREATE INDEX IF NOT EXISTS idx_api_keys_stripe ON api_keys(stripe_session_id);
    CREATE INDEX IF NOT EXISTS idx_api_keys_clerk ON api_keys(clerk_user_id);
    CREATE INDEX IF NOT EXISTS idx_email_send_log ON email_send_log(email, type, sent_at);

    CREATE TABLE IF NOT EXISTS payout_requests (
      id TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL,
      amount_credits INTEGER NOT NULL,
      usdc_wallet TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_payouts_agent ON payout_requests(agent_key);
    CREATE INDEX IF NOT EXISTS idx_payouts_status ON payout_requests(status);

    CREATE TABLE IF NOT EXISTS swarms (
      id TEXT PRIMARY KEY,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      agent_key TEXT NOT NULL,
      sub_tasks_json TEXT,
      results_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_swarms_agent ON swarms(agent_key);

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      proposed_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      votes_for INTEGER NOT NULL DEFAULT 0,
      votes_against INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closes_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      voter_key TEXT NOT NULL,
      direction TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(proposal_id, voter_key)
    );
    CREATE INDEX IF NOT EXISTS idx_votes_proposal ON votes(proposal_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_payouts_created ON payout_requests(created_at DESC);
  `);

  // sqlite-vec virtual table (only available if extension loaded successfully)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS skill_embeddings USING vec0(
        embedding float[384]
      );
    `);
  } catch { /* extension not loaded — skip virtual table */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_cache (
      id TEXT PRIMARY KEY,
      skill_name TEXT,
      skill_desc TEXT,
      provider TEXT,
      rowid_vec INTEGER,
      ttl_expires TEXT
    );
  `);

  // Migrations run first so columns exist before we index them
  runMigrations();

  // Indexes on migration-added columns (safe only after migrations run)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orchestrations_api_key ON orchestrations(api_key);
    CREATE INDEX IF NOT EXISTS idx_discovery_cache_ttl ON discovery_cache(ttl_expires);
    CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(active);
    CREATE INDEX IF NOT EXISTS idx_skills_uses ON skills(uses DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_stars ON skills(stars DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_published_at ON skills(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_skills_credit_cost ON skills(credit_cost ASC);
    CREATE INDEX IF NOT EXISTS idx_skills_public_active ON skills(public, active);
  `);

  logger.info({ path: DB_PATH }, 'Database initialised');
}
