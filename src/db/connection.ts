import Database from 'better-sqlite3';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import * as sqliteVec from 'sqlite-vec';
import { apiRegistry, setEndpointDbLookup, type ApiEndpoint } from '../config/api-registry';

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
        params.entityId?.startsWith('cn-') ? maskApiKey(params.entityId) : params.entityId,
        params.action,
        params.actorId?.startsWith('cn-') ? maskApiKey(params.actorId) : (params.actorId ?? null),
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
  // v58: x402 payment receipts — proof-of-payment for agent audit trails
  { version: 58, sql: `
    CREATE TABLE IF NOT EXISTS x402_receipts (
      request_id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      price_usdc TEXT NOT NULL,
      network TEXT NOT NULL,
      payer_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_x402_receipts_skill ON x402_receipts(skill_id);
    CREATE INDEX IF NOT EXISTS idx_x402_receipts_created ON x402_receipts(created_at DESC);
  ` },
  // v59: missing indexes on hot query columns — authentication, listing, filtering
  { version: 59, sql: `
    CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
    CREATE INDEX IF NOT EXISTS idx_skills_security_status ON skills(security_status);
    CREATE INDEX IF NOT EXISTS idx_skills_skill_type ON skills(skill_type);
    CREATE INDEX IF NOT EXISTS idx_skills_skill_class ON skills(skill_class);
    CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
    CREATE INDEX IF NOT EXISTS idx_skills_public_active ON skills(public, active, security_status);
    CREATE INDEX IF NOT EXISTS idx_orchestrations_skill_ts ON orchestrations(skill_id, timestamp);
  ` },
  // v60: per-skill rate limit — creator-configurable max calls per hour
  { version: 60, sql: `ALTER TABLE skills ADD COLUMN max_calls_per_hour INTEGER` },
  // v61: skill health status for data skill monitoring cron
  { version: 61, sql: `ALTER TABLE skills ADD COLUMN health_status TEXT NOT NULL DEFAULT 'HEALTHY';
    ALTER TABLE skills ADD COLUMN health_checked_at TEXT;
    ALTER TABLE skills ADD COLUMN health_fail_count INTEGER NOT NULL DEFAULT 0` },
  // v62: webhook signing secret per task creator — HMAC verification for outbound webhooks
  { version: 62, sql: `ALTER TABLE api_keys ADD COLUMN webhook_secret TEXT` },
  // v63: revenue split 97/3 → 85/15 — 15% platform fee is competitive (industry norm 20-30%)
  { version: 63, sql: `UPDATE skills SET revenue_share_pct = 0.85 WHERE revenue_share_pct = 0.97` },
  // v64: Agent Economy — trust signal denormalization, cryptographic receipts, composite skill dependencies
  { version: 64, sql: `
    ALTER TABLE skills ADD COLUMN avg_rating REAL NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN success_rate REAL NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN avg_latency_ms REAL NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN dependencies_json TEXT;
    ALTER TABLE transactions ADD COLUMN request_hash TEXT;
    ALTER TABLE transactions ADD COLUMN result_hash TEXT;
    UPDATE skills SET avg_rating = COALESCE((SELECT ROUND(AVG(rating),1) FROM skill_ratings WHERE skill_id = skills.id), 0),
      rating_count = COALESCE((SELECT COUNT(*) FROM skill_ratings WHERE skill_id = skills.id), 0);
    UPDATE skills SET success_rate = COALESCE((SELECT ROUND(AVG(success)*100,1) FROM skill_metrics WHERE skill_id = skills.id), 0),
      avg_latency_ms = COALESCE((SELECT ROUND(AVG(latency_ms),0) FROM skill_metrics WHERE skill_id = skills.id), 0)` },
  // v65: SLA contracts, output contracts, agent budget accounts, event webhooks
  { version: 65, sql: `
    ALTER TABLE skills ADD COLUMN sla_json TEXT;
    ALTER TABLE skills ADD COLUMN output_contract_json TEXT;
    ALTER TABLE delegated_keys ADD COLUMN daily_limit REAL;
    ALTER TABLE delegated_keys ADD COLUMN weekly_limit REAL;
    ALTER TABLE delegated_keys ADD COLUMN daily_spent REAL NOT NULL DEFAULT 0;
    ALTER TABLE delegated_keys ADD COLUMN weekly_spent REAL NOT NULL DEFAULT 0;
    ALTER TABLE delegated_keys ADD COLUMN last_daily_reset TEXT;
    ALTER TABLE delegated_keys ADD COLUMN last_weekly_reset TEXT;
    ALTER TABLE delegated_keys ADD COLUMN auto_topup INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE delegated_keys ADD COLUMN auto_topup_amount REAL;
    ALTER TABLE delegated_keys ADD COLUMN account_type TEXT NOT NULL DEFAULT 'delegated';
    CREATE TABLE IF NOT EXISTS agent_webhooks (
      id TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL,
      url TEXT NOT NULL,
      events_json TEXT NOT NULL DEFAULT '["*"]',
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_triggered_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_webhooks_key ON agent_webhooks(agent_key);
    CREATE TABLE IF NOT EXISTS sla_violations (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      violation_type TEXT NOT NULL,
      measured_value REAL NOT NULL,
      sla_threshold REAL NOT NULL,
      penalty_credits REAL NOT NULL DEFAULT 0,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sla_violations_skill ON sla_violations(skill_id)` },
  // v66: composability upgrades, scheduled execution, trust decay, penalty escalation, proposal bonds, report categories
  { version: 66, sql: `
    ALTER TABLE skills ADD COLUMN composite_config_json TEXT;
    ALTER TABLE skills ADD COLUMN penalty_tier INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN penalty_updated_at TEXT;
    ALTER TABLE skill_reports ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
    ALTER TABLE skill_ratings ADD COLUMN decay_weight REAL NOT NULL DEFAULT 1.0;
    ALTER TABLE proposals ADD COLUMN bond_credits REAL NOT NULL DEFAULT 0;
    ALTER TABLE proposals ADD COLUMN bond_released INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS scheduled_skills (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      caller_key TEXT NOT NULL,
      variables_json TEXT,
      cron_expression TEXT NOT NULL,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      last_status TEXT,
      last_error TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      max_credits_per_run REAL,
      total_runs INTEGER NOT NULL DEFAULT 0,
      total_credits_spent REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_skills_next ON scheduled_skills(next_run_at, active);
    CREATE INDEX IF NOT EXISTS idx_scheduled_skills_caller ON scheduled_skills(caller_key)` },
  // v67: dynamic pricing, composite-of-composite, autonomous hiring/firing, quorum governance, validator roles, persistent agents
  { version: 67, sql: `
    ALTER TABLE skills ADD COLUMN pricing_config_json TEXT;
    ALTER TABLE skills ADD COLUMN composite_depth INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE skills ADD COLUMN auto_replace INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS skill_demand (
      skill_id TEXT NOT NULL,
      hour_bucket TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (skill_id, hour_bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_skill_demand_hour ON skill_demand(hour_bucket);
    CREATE TABLE IF NOT EXISTS caller_skill_usage (
      caller_key TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      period TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (caller_key, skill_id, period)
    );
    CREATE TABLE IF NOT EXISTS composite_swaps (
      id TEXT PRIMARY KEY,
      composite_id TEXT NOT NULL,
      original_skill_id TEXT NOT NULL,
      replacement_skill_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      reverted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_composite_swaps_composite ON composite_swaps(composite_id);
    ALTER TABLE proposals ADD COLUMN quorum_pct REAL NOT NULL DEFAULT 0;
    ALTER TABLE proposals ADD COLUMN action_type TEXT;
    ALTER TABLE proposals ADD COLUMN action_payload_json TEXT;
    ALTER TABLE proposals ADD COLUMN executed_at TEXT;
    ALTER TABLE proposals ADD COLUMN execution_result_json TEXT;
    ALTER TABLE api_keys ADD COLUMN is_validator INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS validations (
      id TEXT PRIMARY KEY,
      validator_key TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      skill_id TEXT,
      verdict TEXT NOT NULL CHECK(verdict IN ('VALID', 'INVALID', 'INCONCLUSIVE')),
      notes TEXT,
      reward_credits REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(validator_key, transaction_id)
    );
    CREATE INDEX IF NOT EXISTS idx_validations_tx ON validations(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_validations_skill ON validations(skill_id);
    CREATE INDEX IF NOT EXISTS idx_validations_validator ON validations(validator_key);
    ALTER TABLE scheduled_skills ADD COLUMN session_id TEXT;
    ALTER TABLE scheduled_skills ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'cron';
    ALTER TABLE scheduled_skills ADD COLUMN trigger_config_json TEXT;
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      name TEXT,
      state_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_key ON agent_sessions(api_key)` },
  // v68: smart cache — adaptive TTL, cache warming, cache analytics
  { version: 68, sql: `
    CREATE TABLE IF NOT EXISTS cache_volatility (
      cache_key_prefix TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      check_count INTEGER NOT NULL DEFAULT 0,
      change_count INTEGER NOT NULL DEFAULT 0,
      last_hash TEXT,
      avg_ttl_seconds REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cache_vol_endpoint ON cache_volatility(endpoint_id);
    CREATE TABLE IF NOT EXISTS cache_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      hit INTEGER NOT NULL DEFAULT 0,
      stale_served INTEGER NOT NULL DEFAULT 0,
      content_changed INTEGER,
      credits_saved REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cache_access_created ON cache_access_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_cache_access_endpoint ON cache_access_log(endpoint_id)` },
  // v69: agent referrals — move from JSON file to SQLite
  { version: 69, sql: `
    CREATE TABLE IF NOT EXISTS agent_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_key TEXT NOT NULL,
      referred_key TEXT NOT NULL UNIQUE,
      credits_awarded REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON agent_referrals(referrer_key)` },
  // v70: hard budget locks — users set monthly spending caps, enforced in auth middleware
  { version: 70, sql: `
    CREATE TABLE IF NOT EXISTS budget_locks (
      api_key TEXT PRIMARY KEY,
      monthly_limit REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )` },
  { version: 71, sql: `
    CREATE INDEX IF NOT EXISTS idx_orchestrations_apikey_ts ON orchestrations(api_key, timestamp);
    ALTER TABLE orchestrations ADD COLUMN cache_strategy TEXT DEFAULT NULL;
    ALTER TABLE orchestrations ADD COLUMN credits_used REAL DEFAULT 0;
    DELETE FROM endpoint_health WHERE last_checked < datetime('now', '-30 days');
    CREATE INDEX IF NOT EXISTS idx_transactions_from_type ON transactions(from_agent, type);
    CREATE INDEX IF NOT EXISTS idx_payouts_agent_status ON payout_requests(agent_key, status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_apikey ON subscriptions(api_key);
    CREATE INDEX IF NOT EXISTS idx_escrows_deadline ON escrows(deadline);
    DROP INDEX IF EXISTS idx_transactions_created;
    DROP INDEX IF EXISTS idx_skills_public;
    DROP INDEX IF EXISTS idx_agent_ctx_key` },
  // v72: skill sponsorships — creators fund free-tier credits for their skills
  { version: 72, sql: `
    CREATE TABLE IF NOT EXISTS sponsorships (
      id TEXT PRIMARY KEY,
      sponsor_key TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      total_credits REAL NOT NULL,
      remaining_credits REAL NOT NULL,
      daily_limit_per_user REAL NOT NULL DEFAULT 10,
      max_uses_per_user INTEGER NOT NULL DEFAULT 100,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sponsorships_skill ON sponsorships(skill_id, active);
    CREATE INDEX IF NOT EXISTS idx_sponsorships_sponsor ON sponsorships(sponsor_key);
    CREATE TABLE IF NOT EXISTS sponsorship_usage (
      id TEXT PRIMARY KEY,
      sponsorship_id TEXT NOT NULL,
      user_key TEXT NOT NULL,
      credits_used REAL NOT NULL,
      used_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sponsorship_id) REFERENCES sponsorships(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sponsorship_usage_lookup ON sponsorship_usage(sponsorship_id, user_key)` },
  // v73: bounty system — demand-side marketplace
  { version: 73, sql: `
    CREATE TABLE IF NOT EXISTS bounties (
      id TEXT PRIMARY KEY,
      creator_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirements_json TEXT,
      reward_credits REAL NOT NULL,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      claimed_by TEXT,
      claimed_at TEXT,
      submission_url TEXT,
      submitted_at TEXT,
      completed_at TEXT,
      tags_json TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
    CREATE INDEX IF NOT EXISTS idx_bounties_creator ON bounties(creator_key);
    CREATE INDEX IF NOT EXISTS idx_bounties_category ON bounties(category)` },
  // v74: verification tiers, payment-proof reviews, composite metrics
  { version: 74, sql: `
    ALTER TABLE skills ADD COLUMN verification_tier INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE skill_ratings ADD COLUMN payment_proof_type TEXT DEFAULT 'none';
    ALTER TABLE skill_ratings ADD COLUMN payment_proof_id TEXT;
    ALTER TABLE skill_ratings ADD COLUMN payment_amount REAL DEFAULT 0;
    ALTER TABLE skill_ratings ADD COLUMN verified_purchase INTEGER DEFAULT 0;
    CREATE TABLE IF NOT EXISTS composite_metrics (
      skill_id TEXT PRIMARY KEY,
      tool_calls_compressed INTEGER NOT NULL DEFAULT 0,
      estimated_token_savings INTEGER NOT NULL DEFAULT 0,
      avg_execution_time_ms REAL NOT NULL DEFAULT 0,
      total_executions INTEGER NOT NULL DEFAULT 0,
      success_rate REAL NOT NULL DEFAULT 0,
      last_execution_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_skill_ratings_verified ON skill_ratings(skill_id, verified_purchase);
    CREATE INDEX IF NOT EXISTS idx_skills_verification_tier ON skills(verification_tier)` },
  // v75: x402 test mode column
  { version: 75, sql: `ALTER TABLE x402_receipts ADD COLUMN test INTEGER NOT NULL DEFAULT 0` },
  // v76: OAuth authorization codes for "Sign in with ClawNet"
  { version: 76, sql: `CREATE TABLE IF NOT EXISTS oauth_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    api_key TEXT NOT NULL,
    app TEXT NOT NULL,
    email TEXT DEFAULT '',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )` },
  // v77: Verified Intelligence Engine (VIE) — historical pattern database
  { version: 77, sql: `
    CREATE TABLE IF NOT EXISTS vie_reports (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'token',
      chain TEXT NOT NULL DEFAULT 'solana',
      trust_score INTEGER NOT NULL,
      risk_level TEXT NOT NULL,
      confidence REAL NOT NULL,
      factors_json TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      outcome TEXT,
      outcome_at TEXT,
      outcome_notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vie_target ON vie_reports(target, chain);
    CREATE INDEX IF NOT EXISTS idx_vie_score ON vie_reports(trust_score);
    CREATE INDEX IF NOT EXISTS idx_vie_outcome ON vie_reports(outcome) WHERE outcome IS NOT NULL` },
  // v78: Intelligence Suite shared tables — foundation for Context Engine, Agent Trust Score, Predictive Alerts
  { version: 78, sql: `
    CREATE TABLE IF NOT EXISTS intel_entities (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'token',
      chain TEXT NOT NULL DEFAULT 'solana',
      name TEXT,
      metadata_json TEXT,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_scored TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(address, entity_type, chain)
    );
    CREATE INDEX IF NOT EXISTS idx_intel_entities_address ON intel_entities(address, chain);
    CREATE INDEX IF NOT EXISTS idx_intel_entities_type ON intel_entities(entity_type);

    CREATE TABLE IF NOT EXISTS intel_scores (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      entity_address TEXT NOT NULL,
      entity_chain TEXT NOT NULL DEFAULT 'solana',
      skill_id TEXT NOT NULL,
      score_value INTEGER NOT NULL,
      score_confidence REAL NOT NULL,
      score_level TEXT NOT NULL,
      summary TEXT,
      detail_json TEXT,
      previous_score INTEGER,
      score_delta INTEGER,
      scored_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_scores_entity_skill ON intel_scores(entity_address, entity_chain, skill_id);
    CREATE INDEX IF NOT EXISTS idx_intel_scores_skill ON intel_scores(skill_id, scored_at);
    CREATE INDEX IF NOT EXISTS idx_intel_scores_level ON intel_scores(score_level);

    CREATE TABLE IF NOT EXISTS intel_events (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      entity_address TEXT NOT NULL,
      entity_chain TEXT NOT NULL DEFAULT 'solana',
      skill_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      payload_json TEXT NOT NULL,
      api_key_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_intel_events_entity ON intel_events(entity_address, entity_chain, created_at);
    CREATE INDEX IF NOT EXISTS idx_intel_events_type ON intel_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_intel_events_skill ON intel_events(skill_id, created_at);

    CREATE TABLE IF NOT EXISTS intel_subscriptions (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      entity_address TEXT NOT NULL,
      entity_chain TEXT NOT NULL DEFAULT 'solana',
      entity_type TEXT NOT NULL DEFAULT 'token',
      alert_types TEXT NOT NULL DEFAULT '["SCORE_CHANGE","ANOMALY"]',
      threshold_json TEXT,
      webhook_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      last_fired_at TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_intel_subs_key ON intel_subscriptions(api_key, active);
    CREATE INDEX IF NOT EXISTS idx_intel_subs_entity ON intel_subscriptions(entity_address, entity_chain, active)` },
  // v79: Manifest — universal data verification + decision memory
  { version: 79, sql: `
    CREATE TABLE IF NOT EXISTS manifest_memory (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      request_hash TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT 'general',
      subject TEXT,
      action_type TEXT,
      overall_verdict TEXT NOT NULL,
      verify_overall TEXT,
      verify_claims_checked INTEGER DEFAULT 0,
      verify_claims_verified INTEGER DEFAULT 0,
      verify_claims_disputed INTEGER DEFAULT 0,
      assess_status TEXT,
      assess_premises_valid INTEGER,
      preflight_status TEXT,
      preflight_risk_score INTEGER,
      confidence REAL NOT NULL,
      summary TEXT,
      detail_json TEXT NOT NULL,
      outcome TEXT,
      outcome_data TEXT,
      outcome_at TEXT,
      outcome_value REAL
    );
    CREATE INDEX IF NOT EXISTS idx_manifest_key ON manifest_memory(api_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_subject ON manifest_memory(api_key, subject, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_hash ON manifest_memory(request_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_verdict ON manifest_memory(overall_verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_manifest_outcome ON manifest_memory(outcome) WHERE outcome IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_manifest_domain ON manifest_memory(domain, created_at DESC)` },
  // v80: Attestation — signed, verifiable proof of agent actions
  { version: 80, sql: `
    CREATE TABLE IF NOT EXISTS attestations (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      attestation_type TEXT NOT NULL DEFAULT 'automatic',
      manifest_id TEXT,
      manifest_verdict TEXT,
      manifest_confidence REAL,
      manifest_aligned INTEGER,
      action_type TEXT NOT NULL,
      action_endpoint TEXT,
      action_description TEXT,
      input_hash TEXT NOT NULL,
      response_hash TEXT,
      source_hashes_json TEXT,
      credits_charged REAL DEFAULT 0,
      duration_ms INTEGER,
      outcome_status TEXT NOT NULL DEFAULT 'success',
      outcome_data_json TEXT,
      signature TEXT,
      signed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_attest_key ON attestations(api_key_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attest_key_seq ON attestations(api_key_hash, sequence_number DESC);
    CREATE INDEX IF NOT EXISTS idx_attest_manifest ON attestations(manifest_id) WHERE manifest_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_attest_type ON attestations(attestation_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attest_action ON attestations(action_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attest_aligned ON attestations(manifest_aligned) WHERE manifest_aligned IS NOT NULL;

    CREATE TABLE IF NOT EXISTS attestation_stats (
      api_key_hash TEXT PRIMARY KEY,
      total_attestations INTEGER NOT NULL DEFAULT 0,
      manifest_aligned INTEGER NOT NULL DEFAULT 0,
      manifest_unaligned INTEGER NOT NULL DEFAULT 0,
      manifest_unchecked INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_attestation_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )` },
  // v81: LLM reseller — per-key markup, model restrictions, child rate limits
  { version: 81, sql: `
    CREATE TABLE IF NOT EXISTS reseller_configs (
      api_key TEXT PRIMARY KEY,
      markup_pct REAL NOT NULL DEFAULT 0,
      models_allowed TEXT,
      rate_limit_per_child INTEGER,
      billing_label TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )` },

  // x402 idempotency + receipt extension (Coinbase receipt + attestation link)
  { version: 82, sql: `
    ALTER TABLE x402_receipts ADD COLUMN payment_hash TEXT;
  ` },
  { version: 83, sql: `
    ALTER TABLE x402_receipts ADD COLUMN facilitator_receipt_json TEXT;
  ` },
  { version: 84, sql: `
    ALTER TABLE x402_receipts ADD COLUMN payer_address_verified INTEGER NOT NULL DEFAULT 0;
  ` },
  { version: 85, sql: `
    ALTER TABLE x402_receipts ADD COLUMN attestation_id TEXT;
  ` },
  { version: 86, sql: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_x402_receipts_payment_hash ON x402_receipts(payment_hash);
    CREATE INDEX IF NOT EXISTS idx_x402_receipts_attestation ON x402_receipts(attestation_id);
  ` },
  { version: 87, sql: `
    CREATE TABLE IF NOT EXISTS agent_identities (
      id TEXT PRIMARY KEY,
      api_key_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      agent_type TEXT NOT NULL DEFAULT 'autonomous',
      capabilities_json TEXT,
      owner_verified INTEGER NOT NULL DEFAULT 0,
      verification_method TEXT,
      identity_jwt TEXT,
      jwt_issued_at TEXT,
      jwt_expires_at TEXT,
      public_profile INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_identity_key ON agent_identities(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_agent_identity_type ON agent_identities(agent_type);
  ` },
  { version: 88, sql: `
    CREATE TABLE IF NOT EXISTS xmtp_subscribers (
      address TEXT PRIMARY KEY,
      api_key TEXT,
      subscribed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  ` },
  { version: 89, sql: `
    CREATE TABLE IF NOT EXISTS external_registrations (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      protocol TEXT NOT NULL DEFAULT 'x402',
      http_method TEXT NOT NULL DEFAULT 'POST',
      price_usd REAL,
      payment_asset TEXT DEFAULT 'USDC',
      payment_network TEXT,
      category TEXT DEFAULT 'uncategorized',
      provider TEXT,
      contact_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      health_status TEXT DEFAULT 'unknown',
      last_probed TEXT,
      probe_result TEXT,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      registered_ip TEXT,
      UNIQUE(url, protocol)
    );
    CREATE INDEX IF NOT EXISTS idx_ext_reg_status ON external_registrations(status);
    CREATE INDEX IF NOT EXISTS idx_ext_reg_protocol ON external_registrations(protocol);
  ` },
  { version: 90, sql: `
    ALTER TABLE api_keys ADD COLUMN wallet_address TEXT;
    CREATE INDEX IF NOT EXISTS idx_api_keys_wallet ON api_keys(wallet_address);
  ` },
  { version: 91, sql: `
    CREATE TABLE IF NOT EXISTS reputation_anchors (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      anchor_hash TEXT NOT NULL,
      data_snapshot TEXT NOT NULL,
      anchor_type TEXT NOT NULL DEFAULT 'periodic',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rep_anchors_skill ON reputation_anchors(skill_id);
    CREATE INDEX IF NOT EXISTS idx_rep_anchors_created ON reputation_anchors(created_at);
  ` },
  // v92: direct x402 payout — opt-in per skill, routes x402 payment to creator's wallet
  { version: 92, sql: `ALTER TABLE skills ADD COLUMN direct_payout INTEGER NOT NULL DEFAULT 0` },
  // v93: 402index.io catalog sync — stores external x402 endpoints for orchestration
  { version: 93, sql: `
    CREATE TABLE IF NOT EXISTS indexed_endpoints (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      url TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'x402',
      price_usd REAL,
      payment_asset TEXT DEFAULT 'USDC',
      payment_network TEXT,
      category TEXT DEFAULT 'uncategorized',
      provider TEXT,
      health_status TEXT DEFAULT 'unknown',
      uptime_30d REAL,
      latency_p50_ms INTEGER,
      reliability_score REAL,
      http_method TEXT DEFAULT 'GET',
      last_synced TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(url, protocol)
    );
    CREATE INDEX IF NOT EXISTS idx_indexed_ep_category ON indexed_endpoints(category);
    CREATE INDEX IF NOT EXISTS idx_indexed_ep_protocol ON indexed_endpoints(protocol);
    CREATE INDEX IF NOT EXISTS idx_indexed_ep_health ON indexed_endpoints(health_status);
  ` },
  // v94: multi-source index sync — track which registry each endpoint came from
  { version: 94, sql: `
    ALTER TABLE indexed_endpoints ADD COLUMN source TEXT NOT NULL DEFAULT '402index';
    CREATE INDEX IF NOT EXISTS idx_indexed_ep_source ON indexed_endpoints(source);
  ` },
  // v95: Merkle root anchoring — on-chain attestation proofs
  { version: 95, sql: `
    CREATE TABLE IF NOT EXISTS attestation_anchors (
      id TEXT PRIMARY KEY,
      merkle_root TEXT NOT NULL,
      attestation_count INTEGER NOT NULL,
      solana_tx_hash TEXT,
      tree_json TEXT,
      anchored_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_attest_anchors_status ON attestation_anchors(status);
    CREATE INDEX IF NOT EXISTS idx_attest_anchors_created ON attestation_anchors(anchored_at DESC);
  ` },
  { version: 96, sql: `ALTER TABLE attestations ADD COLUMN anchor_id TEXT` },
  { version: 97, sql: `ALTER TABLE attestations ADD COLUMN anchored_at TEXT` },
  { version: 98, sql: `CREATE INDEX IF NOT EXISTS idx_attest_anchor ON attestations(anchor_id) WHERE anchor_id IS NOT NULL` },
  // v99: Index for replay protection — fast duplicate check on (api_key_hash, input_hash, created_at).
  // Also supports the longer 32-char api_key_hash (was 16-char). Old 16-char hashes are grandfathered.
  { version: 99, sql: `CREATE INDEX IF NOT EXISTS idx_attest_replay ON attestations(api_key_hash, input_hash, created_at)` },
  // v100: Signing key rotation — store which key signed each attestation
  { version: 100, sql: `ALTER TABLE attestations ADD COLUMN signing_key_id TEXT` },
  // v101: Attestation hash-chaining — each attestation references predecessor for tamper detection
  { version: 101, sql: `ALTER TABLE attestations ADD COLUMN prev_attestation_hash TEXT` },

  // ─── AID (Agent Identity Document) tables ────────────────────────────────

  // v102: AID key management — DID-linked cryptographic keys with rotation/revocation
  { version: 102, sql: `
    CREATE TABLE IF NOT EXISTS aid_keys (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      public_key_multibase TEXT NOT NULL,
      did TEXT NOT NULL,
      key_status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      rotated_at TEXT,
      rotated_to TEXT,
      revocation_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aid_keys_did ON aid_keys(did);
    CREATE INDEX IF NOT EXISTS idx_aid_keys_identity ON aid_keys(identity_id);
    CREATE INDEX IF NOT EXISTS idx_aid_keys_pubkey ON aid_keys(public_key_multibase);
  ` },

  // v103: AID trust snapshots — Merkle-anchored trust state with dual signatures
  { version: 103, sql: `
    CREATE TABLE IF NOT EXISTS aid_trust_snapshots (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      did TEXT NOT NULL,
      merkle_root TEXT NOT NULL,
      attestation_count INTEGER NOT NULL,
      chain_length INTEGER NOT NULL,
      stats_json TEXT NOT NULL,
      anchor_tx_hash TEXT,
      agent_signature TEXT NOT NULL,
      platform_signature TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_snap_identity ON aid_trust_snapshots(identity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aid_snap_did ON aid_trust_snapshots(did, created_at DESC);
  ` },

  // v104: AID cross-platform attestations — external platform verification records
  { version: 104, sql: `
    CREATE TABLE IF NOT EXISTS aid_cross_platform_attestations (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      did TEXT NOT NULL,
      platform TEXT NOT NULL,
      attestation_type TEXT NOT NULL,
      attestation_data_json TEXT NOT NULL,
      attestation_hash TEXT NOT NULL,
      platform_signature TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_xplat_identity ON aid_cross_platform_attestations(identity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aid_xplat_platform ON aid_cross_platform_attestations(platform);
  ` },

  // v105: AID capabilities — tracked agent capabilities with invocation counts
  { version: 105, sql: `
    CREATE TABLE IF NOT EXISTS aid_capabilities (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      category TEXT NOT NULL,
      actions_json TEXT NOT NULL DEFAULT '[]',
      invoke_count INTEGER NOT NULL DEFAULT 0,
      last_invoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(identity_id, category)
    );
    CREATE INDEX IF NOT EXISTS idx_aid_cap_identity ON aid_capabilities(identity_id);
  ` },

  // v106: Extend agent_identities with AID fields (DID, public key, active key, version)
  { version: 106, sql: `
    ALTER TABLE agent_identities ADD COLUMN did TEXT;
    ALTER TABLE agent_identities ADD COLUMN public_key_multibase TEXT;
    ALTER TABLE agent_identities ADD COLUMN active_key_id TEXT;
    ALTER TABLE agent_identities ADD COLUMN aid_version TEXT DEFAULT '1.0.0';
    ALTER TABLE agent_identities ADD COLUMN aid_exported_at TEXT;
  ` },

  // v107: Add missing columns to aid_keys (owner, display, service endpoints, updated_at)
  { version: 107, sql: `
    ALTER TABLE aid_keys ADD COLUMN owner_key TEXT;
    ALTER TABLE aid_keys ADD COLUMN display_name TEXT;
    ALTER TABLE aid_keys ADD COLUMN service_endpoints TEXT;
    ALTER TABLE aid_keys ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
    CREATE INDEX IF NOT EXISTS idx_aid_keys_owner ON aid_keys(owner_key);
    CREATE INDEX IF NOT EXISTS idx_aid_xplat_did ON aid_cross_platform_attestations(did, created_at DESC);
  ` },

  // v108: Granular policy engine for delegated keys (x204 trust delegation)
  { version: 108, sql: `
    ALTER TABLE delegated_keys ADD COLUMN policy_json TEXT DEFAULT '{}';
    ALTER TABLE delegated_keys ADD COLUMN max_per_transaction REAL;
    ALTER TABLE delegated_keys ADD COLUMN allowed_skills_json TEXT;
    ALTER TABLE delegated_keys ADD COLUMN allowed_providers_json TEXT;
    ALTER TABLE delegated_keys ADD COLUMN active_hours_json TEXT;
  ` },

  // v109: Guardian key for autonomous agent recovery + AID freeze + GDPR tombstones
  { version: 109, sql: `
    ALTER TABLE aid_keys ADD COLUMN guardian_address TEXT;
    ALTER TABLE aid_keys ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE aid_keys ADD COLUMN frozen_at TEXT;
    ALTER TABLE aid_keys ADD COLUMN frozen_by TEXT;
    CREATE TABLE IF NOT EXISTS aid_tombstones (
      did TEXT PRIMARY KEY,
      erased_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  ` },
  { version: 110, sql: `
    CREATE TABLE IF NOT EXISTS aid_feedback (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      reporter_did TEXT NOT NULL,
      reporter_owner_key TEXT NOT NULL,
      provider_did TEXT,
      skill_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'partial', 'failure')),
      quality_score INTEGER CHECK (quality_score BETWEEN 1 AND 10),
      latency_acceptable INTEGER,
      notes TEXT,
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_feedback_receipt ON aid_feedback(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_aid_feedback_reporter ON aid_feedback(reporter_did, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aid_feedback_provider ON aid_feedback(provider_did, created_at DESC);
  ` },
  { version: 111, sql: `
    ALTER TABLE aid_keys ADD COLUMN last_heartbeat TEXT;
    ALTER TABLE aid_keys ADD COLUMN heartbeat_interval_days INTEGER NOT NULL DEFAULT 7;
    ALTER TABLE aid_keys ADD COLUMN heartbeat_grace_days INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE aid_keys ADD COLUMN heartbeat_decay_applied REAL NOT NULL DEFAULT 0;
    ALTER TABLE aid_keys ADD COLUMN proof_of_life_status TEXT NOT NULL DEFAULT 'active';
  ` },
  { version: 112, sql: `
    CREATE TABLE IF NOT EXISTS aid_guardians (
      id TEXT PRIMARY KEY,
      guardian_did TEXT NOT NULL,
      guardian_owner_key TEXT NOT NULL,
      guardian_type TEXT NOT NULL DEFAULT 'primary',
      status TEXT NOT NULL DEFAULT 'active',
      agents_guarded INTEGER NOT NULL DEFAULT 0,
      successful_freezes INTEGER NOT NULL DEFAULT 0,
      false_positives INTEGER NOT NULL DEFAULT 0,
      trust_score REAL NOT NULL DEFAULT 0,
      max_agents INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_guardians_did ON aid_guardians(guardian_did);
    CREATE INDEX IF NOT EXISTS idx_aid_guardians_status ON aid_guardians(status);

    CREATE TABLE IF NOT EXISTS aid_guardian_assignments (
      id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      guardian_did TEXT NOT NULL,
      assignment_type TEXT NOT NULL DEFAULT 'primary',
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_aid_assignments_agent ON aid_guardian_assignments(agent_did, status);
    CREATE INDEX IF NOT EXISTS idx_aid_assignments_guardian ON aid_guardian_assignments(guardian_did, status);

    CREATE TABLE IF NOT EXISTS aid_trust_trajectory (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      score INTEGER NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_trajectory_did ON aid_trust_trajectory(did, month DESC);

    CREATE TABLE IF NOT EXISTS aid_onboarding_milestones (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      stage TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_milestones_did ON aid_onboarding_milestones(did);

    CREATE TABLE IF NOT EXISTS aid_succession (
      id TEXT PRIMARY KEY,
      previous_did TEXT NOT NULL,
      new_did TEXT NOT NULL,
      reason TEXT NOT NULL,
      penalty_applied REAL NOT NULL DEFAULT 0.20,
      succession_number INTEGER NOT NULL DEFAULT 1,
      recovery_key_signature TEXT,
      platform_signature TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_succession_prev ON aid_succession(previous_did);
    CREATE INDEX IF NOT EXISTS idx_aid_succession_new ON aid_succession(new_did);

    CREATE TABLE IF NOT EXISTS aid_appeals (
      id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      appeal_reason TEXT NOT NULL,
      evidence TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      recovery_key_signature TEXT,
      reviewed_at TEXT,
      reviewed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_appeals_did ON aid_appeals(agent_did, status);

    CREATE TABLE IF NOT EXISTS aid_trust_escrow (
      id TEXT PRIMARY KEY,
      initiator_did TEXT NOT NULL,
      acceptor_did TEXT NOT NULL,
      initiator_stake REAL NOT NULL DEFAULT 7,
      acceptor_stake REAL NOT NULL DEFAULT 3,
      transaction_ref TEXT,
      outcome TEXT,
      fault_party TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aid_escrow_initiator ON aid_trust_escrow(initiator_did);

    CREATE TABLE IF NOT EXISTS aid_insurance_fund (
      id TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0,
      total_premiums_collected REAL NOT NULL DEFAULT 0,
      total_claims_paid REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS aid_insurance_claims (
      id TEXT PRIMARY KEY,
      claimant_did TEXT NOT NULL,
      target_did TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      affected_receipts TEXT,
      total_loss REAL NOT NULL DEFAULT 0,
      payout_amount REAL,
      payout_rate REAL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aid_claims_target ON aid_insurance_claims(target_did);
  ` },

  // v113: Protocol canary (Cherry 15) — liveness proof hash chain
  { version: 113, sql: `
    CREATE TABLE IF NOT EXISTS aid_canary (
      sequence INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      signer_did TEXT NOT NULL,
      stats_json TEXT NOT NULL DEFAULT '{}',
      merkle_root TEXT,
      tx_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aid_canary_ts ON aid_canary(timestamp DESC);
  ` },

  // v114: Formal dispute resolution (Flaw 6)
  { version: 114, sql: `
    CREATE TABLE IF NOT EXISTS aid_disputes (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      claimant_did TEXT NOT NULL,
      claimant_key TEXT NOT NULL,
      respondent_did TEXT,
      reason TEXT NOT NULL,
      evidence_hash TEXT,
      status TEXT NOT NULL DEFAULT 'filed',
      outcome TEXT,
      response_text TEXT,
      response_evidence_hash TEXT,
      resolution_text TEXT,
      credits_refunded REAL,
      auto_resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aid_disputes_receipt ON aid_disputes(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_aid_disputes_claimant ON aid_disputes(claimant_did);
    CREATE INDEX IF NOT EXISTS idx_aid_disputes_status ON aid_disputes(status);
  ` },

  // v115: Bad debt insurance fund (Flaw 4) + trust events for consumer alerts
  { version: 115, sql: `
    CREATE TABLE IF NOT EXISTS aid_insurance_fund (
      id TEXT PRIMARY KEY DEFAULT 'primary',
      balance REAL NOT NULL DEFAULT 0,
      total_collected REAL NOT NULL DEFAULT 0,
      total_paid REAL NOT NULL DEFAULT 0,
      last_collection_at TEXT,
      last_payout_at TEXT
    );
    INSERT OR IGNORE INTO aid_insurance_fund (id) VALUES ('primary');

    CREATE TABLE IF NOT EXISTS aid_trust_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      consumer_did TEXT,
      provider_did TEXT,
      old_score INTEGER,
      new_score INTEGER,
      data_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_trust_events_consumer ON aid_trust_events(consumer_did, created_at DESC);
  ` },

  // v116: Onboarding milestones (from AgentSign, Section 4.2) + recovery keys (Section 39.18)
  { version: 116, sql: `
    CREATE TABLE IF NOT EXISTS aid_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      did TEXT NOT NULL,
      milestone_type TEXT NOT NULL,
      milestone_data TEXT,
      signature TEXT NOT NULL,
      achieved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_milestones_did ON aid_milestones(did, milestone_type);

    CREATE TABLE IF NOT EXISTS aid_recovery_keys (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      recovery_key_hash TEXT NOT NULL,
      key_index INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aid_recovery_did_idx ON aid_recovery_keys(did, key_index);
  ` },

  // v117: Trust decay columns on attestation_stats
  { version: 117, sql: `
    ALTER TABLE attestation_stats ADD COLUMN last_decay_at TEXT;
    ALTER TABLE attestation_stats ADD COLUMN decay_factor REAL DEFAULT 1.0;
  ` },

  // v118: Structured agent memory (from RecallNet) + social graph (from ClawstrAI)
  { version: 118, sql: `
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'context',
      content TEXT NOT NULL,
      metadata_json TEXT DEFAULT '{}',
      tags_json TEXT DEFAULT '[]',
      content_hash TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_mem_owner ON agent_memories(owner_key, session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_mem_type ON agent_memories(memory_type, importance DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_mem_expires ON agent_memories(expires_at);

    CREATE TABLE IF NOT EXISTS aid_social_graph (
      id TEXT PRIMARY KEY,
      from_did TEXT NOT NULL,
      to_did TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_social_unique ON aid_social_graph(from_did, to_did, relation_type);
    CREATE INDEX IF NOT EXISTS idx_social_to ON aid_social_graph(to_did, relation_type);
    CREATE INDEX IF NOT EXISTS idx_social_from ON aid_social_graph(from_did, relation_type);
  ` },

  // v119: Season framework (Phase 4) + AID receipts table
  { version: 119, sql: `
    CREATE TABLE IF NOT EXISTS aid_seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'upcoming',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS aid_season_entries (
      season_id TEXT NOT NULL,
      did TEXT NOT NULL,
      dimensions_json TEXT DEFAULT '{}',
      total_score REAL NOT NULL DEFAULT 0,
      rank INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (season_id, did)
    );
    CREATE INDEX IF NOT EXISTS idx_season_entries_rank ON aid_season_entries(season_id, rank);

    CREATE TABLE IF NOT EXISTS aid_receipts (
      id TEXT PRIMARY KEY,
      payer_did TEXT NOT NULL,
      provider_did TEXT,
      amount_credits REAL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aid_receipts_payer ON aid_receipts(payer_did);
  ` },

  // v120: Trust delegation + cross-protocol import
  { version: 120, sql: `
    CREATE TABLE IF NOT EXISTS aid_delegations (
      id TEXT PRIMARY KEY,
      parent_did TEXT NOT NULL,
      child_did TEXT NOT NULL,
      inheritance_pct REAL NOT NULL,
      effective_score REAL NOT NULL,
      expires_at TEXT NOT NULL,
      signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deleg_parent ON aid_delegations(parent_did, status);
    CREATE INDEX IF NOT EXISTS idx_deleg_child ON aid_delegations(child_did, status);

    CREATE TABLE IF NOT EXISTS aid_trust_imports (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      source TEXT NOT NULL,
      source_identifier TEXT NOT NULL,
      imported_score REAL NOT NULL,
      capped_score REAL NOT NULL,
      verified INTEGER NOT NULL DEFAULT 0,
      verification_hash TEXT NOT NULL,
      local_tx_required INTEGER NOT NULL DEFAULT 20,
      local_tx_completed INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      imported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trust_imports_did ON aid_trust_imports(did, active);
  ` },

  // v121: AgentKit bridge
  { version: 121, sql: `
    CREATE TABLE IF NOT EXISTS aid_agentkit_links (
      did TEXT PRIMARY KEY,
      agentkit_wallet TEXT NOT NULL,
      world_id_hash TEXT,
      world_id_verified INTEGER NOT NULL DEFAULT 0,
      trust_multiplier REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  ` },

  // ── Soma verdict infrastructure (Phase 3) ──────────────────────────────
  // Replaces AID attestation-based trust with physics-based verification.
  // Verdicts come from external observers running soma-sense, not self-attestation.
  { version: 122, sql: `
    CREATE TABLE IF NOT EXISTS soma_verdicts (
      id TEXT PRIMARY KEY,
      subject_did TEXT NOT NULL,
      observer_did TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('GREEN','AMBER','RED','UNCANNY')),
      confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
      genome_hash TEXT NOT NULL,
      claimed_model TEXT,
      detected_model TEXT,
      session_id TEXT,
      temporal_score REAL,
      topology_score REAL,
      vocabulary_score REAL,
      atlas_match TEXT,
      atlas_distance REAL,
      drift_velocity REAL,
      profile_maturity TEXT CHECK(profile_maturity IN ('embryonic','juvenile','adult','elder')),
      observation_count INTEGER,
      hmac_verified INTEGER NOT NULL DEFAULT 0,
      heartbeat_chain_valid INTEGER NOT NULL DEFAULT 0,
      birth_certificates_valid INTEGER NOT NULL DEFAULT 0,
      seed_verified INTEGER NOT NULL DEFAULT 0,
      observer_signature TEXT NOT NULL,
      subject_signature TEXT,
      anchor_id TEXT,
      anchored_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_soma_verdict_subject ON soma_verdicts(subject_did, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_soma_verdict_observer ON soma_verdicts(observer_did, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_soma_verdict_type ON soma_verdicts(verdict, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_soma_verdict_genome ON soma_verdicts(genome_hash);
    CREATE INDEX IF NOT EXISTS idx_soma_verdict_anchor ON soma_verdicts(anchor_id) WHERE anchor_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS soma_verdict_stats (
      subject_did TEXT PRIMARY KEY,
      total_verdicts INTEGER NOT NULL DEFAULT 0,
      green_count INTEGER NOT NULL DEFAULT 0,
      amber_count INTEGER NOT NULL DEFAULT 0,
      red_count INTEGER NOT NULL DEFAULT 0,
      uncanny_count INTEGER NOT NULL DEFAULT 0,
      unique_observers INTEGER NOT NULL DEFAULT 0,
      avg_confidence REAL NOT NULL DEFAULT 0,
      last_verdict TEXT,
      last_verdict_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS soma_verdict_anchors (
      id TEXT PRIMARY KEY,
      merkle_root TEXT NOT NULL,
      verdict_count INTEGER NOT NULL,
      solana_tx_hash TEXT,
      tree_json TEXT,
      erc8004_agent_id INTEGER,
      anchored_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_soma_anchor_status ON soma_verdict_anchors(status);
    CREATE INDEX IF NOT EXISTS idx_soma_anchor_created ON soma_verdict_anchors(anchored_at DESC);
  ` },
  { version: 123, sql: `
    CREATE TABLE IF NOT EXISTS deduction_idempotency (
      idempotency_key TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dedup_key ON deduction_idempotency(api_key);
  ` },

  // ─── v124: Soma Receipt Layer — unified cryptographic receipts ───────────
  { version: 124, sql: `
    CREATE TABLE IF NOT EXISTS soma_receipts (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      api_key_hash TEXT,
      payment_method TEXT NOT NULL,
      payment_ref TEXT,
      credits_cost REAL NOT NULL DEFAULT 0,
      request_hash TEXT,
      response_hash TEXT,
      soma_data_hash TEXT,
      heartbeat_index INTEGER,
      eas_attestation_json TEXT,
      eas_uid TEXT,
      signature_ed25519 TEXT,
      signature_mldsa65 TEXT,
      algorithm_version TEXT NOT NULL DEFAULT '1.0',
      anchor_id TEXT,
      anchored_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_soma_receipts_request ON soma_receipts(request_id);
    CREATE INDEX IF NOT EXISTS idx_soma_receipts_key ON soma_receipts(api_key_hash);
    CREATE INDEX IF NOT EXISTS idx_soma_receipts_eas ON soma_receipts(eas_uid);
    CREATE INDEX IF NOT EXISTS idx_soma_receipts_anchor ON soma_receipts(anchor_id);
    CREATE INDEX IF NOT EXISTS idx_soma_receipts_unanchored ON soma_receipts(anchored_at) WHERE anchored_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_soma_receipts_created ON soma_receipts(created_at DESC);
  ` },

  // ─── v125-130: Provider Umbrella + Dual-Sign Protocol ──────────────────

  // v125: Providers table — x402 providers who route through ClawNet
  { version: 125, sql: `
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      clerk_user_id TEXT,
      evm_wallet TEXT,
      solana_wallet TEXT,
      soma_public_key TEXT,
      soma_discovery_url TEXT,
      description TEXT,
      website_url TEXT,
      revenue_share_pct REAL NOT NULL DEFAULT 0.85,
      status TEXT NOT NULL DEFAULT 'pending',
      verified INTEGER NOT NULL DEFAULT 0,
      soma_enabled INTEGER NOT NULL DEFAULT 0,
      total_calls INTEGER NOT NULL DEFAULT 0,
      total_cache_hits INTEGER NOT NULL DEFAULT 0,
      total_revenue_usdc REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_providers_slug ON providers(slug);
    CREATE INDEX IF NOT EXISTS idx_providers_clerk ON providers(clerk_user_id) WHERE clerk_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_providers_status ON providers(status);
  ` },

  // v126: Provider endpoints mapping — which endpoints belong to which provider
  { version: 126, sql: `
    CREATE TABLE IF NOT EXISTS provider_endpoints (
      provider_id TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (provider_id, endpoint_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prov_ep_provider ON provider_endpoints(provider_id);
    CREATE INDEX IF NOT EXISTS idx_prov_ep_endpoint ON provider_endpoints(endpoint_id);
  ` },

  // v127: Provider-scoped API keys — link api_keys to a provider
  { version: 127, sql: `ALTER TABLE api_keys ADD COLUMN provider_id TEXT` },

  // v128: Provider analytics — daily aggregates for dashboard
  { version: 128, sql: `
    CREATE TABLE IF NOT EXISTS provider_analytics (
      provider_id TEXT NOT NULL,
      date TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      cache_savings_credits REAL NOT NULL DEFAULT 0,
      revenue_usdc REAL NOT NULL DEFAULT 0,
      avg_latency_ms REAL NOT NULL DEFAULT 0,
      errors INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, date)
    );
  ` },

  // v129: Dual-sign fields on soma_receipts — stores provider provenance alongside platform
  { version: 129, sql: `ALTER TABLE soma_receipts ADD COLUMN provider_id TEXT` },
  { version: 130, sql: `ALTER TABLE soma_receipts ADD COLUMN provider_signature TEXT` },
  { version: 131, sql: `ALTER TABLE soma_receipts ADD COLUMN provider_public_key TEXT` },
  { version: 132, sql: `ALTER TABLE soma_receipts ADD COLUMN provider_data_hash TEXT` },
  { version: 133, sql: `ALTER TABLE soma_receipts ADD COLUMN provider_heartbeat_index INTEGER` },
  { version: 134, sql: `ALTER TABLE soma_receipts ADD COLUMN dual_signed INTEGER NOT NULL DEFAULT 0` },
  { version: 135, sql: `CREATE INDEX IF NOT EXISTS idx_soma_receipts_provider ON soma_receipts(provider_id) WHERE provider_id IS NOT NULL` },
  { version: 136, sql: `CREATE INDEX IF NOT EXISTS idx_soma_receipts_dual ON soma_receipts(dual_signed) WHERE dual_signed = 1` },

  // ─── v137-139: zkTLS Proofs (Reclaim Protocol) ────────────────────────────
  { version: 137, sql: `
    CREATE TABLE IF NOT EXISTS zktls_proofs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      response_hash TEXT NOT NULL,
      proof_identifier TEXT,
      proof_json TEXT NOT NULL,
      witnesses_json TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 0,
      claim_timestamp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_zktls_hash ON zktls_proofs(response_hash);
    CREATE INDEX IF NOT EXISTS idx_zktls_created ON zktls_proofs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_zktls_verified ON zktls_proofs(verified);
  ` },
  { version: 138, sql: `ALTER TABLE soma_receipts ADD COLUMN zktls_proof_id TEXT` },
  { version: 139, sql: `CREATE INDEX IF NOT EXISTS idx_soma_receipts_zktls ON soma_receipts(zktls_proof_id) WHERE zktls_proof_id IS NOT NULL` },
  { version: 140, sql: `
    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      credits_amount REAL NOT NULL DEFAULT 100,
      max_uses INTEGER NOT NULL DEFAULT 100,
      current_uses INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      event_name TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_code ON promo_codes(code);
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id TEXT PRIMARY KEY,
      promo_code_id TEXT NOT NULL REFERENCES promo_codes(id),
      api_key TEXT NOT NULL,
      credits_granted REAL NOT NULL,
      redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_one_per_key ON promo_redemptions(promo_code_id, api_key);
    CREATE INDEX IF NOT EXISTS idx_promo_redemptions_key ON promo_redemptions(api_key);
  ` },
  { version: 141, sql: `UPDATE providers SET revenue_share_pct = 0.90 WHERE revenue_share_pct = 0.85` },

  // ─── v142-146: Phase B-D — Cache economics, trust flywheel, tiers ────────

  // v142: Provider cache revenue share + tier system
  { version: 142, sql: `
    ALTER TABLE providers ADD COLUMN cache_revenue_share_pct REAL NOT NULL DEFAULT 0.50;
    ALTER TABLE providers ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';
    ALTER TABLE providers ADD COLUMN platform_fee_pct REAL NOT NULL DEFAULT 0.10;
    ALTER TABLE providers ADD COLUMN trust_score REAL NOT NULL DEFAULT 50.0;
    ALTER TABLE providers ADD COLUMN cache_revenue_credits REAL NOT NULL DEFAULT 0;
  ` },

  // v143: Provider freshness declarations + cache warming on endpoints
  { version: 143, sql: `
    ALTER TABLE provider_endpoints ADD COLUMN declared_ttl_seconds INTEGER;
    ALTER TABLE provider_endpoints ADD COLUMN cache_warm INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE provider_endpoints ADD COLUMN update_frequency_seconds INTEGER;
  ` },

  // v144: Cache certificates table — Certified Cache Layer
  { version: 144, sql: `
    CREATE TABLE IF NOT EXISTS cache_certificates (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      original_data_hash TEXT NOT NULL,
      original_signature TEXT,
      original_public_key TEXT,
      original_heartbeat_index INTEGER,
      original_timestamp TEXT NOT NULL,
      cache_data_hash TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      fresh_until TEXT NOT NULL,
      served_count INTEGER NOT NULL DEFAULT 0,
      platform_signature TEXT NOT NULL,
      platform_public_key TEXT NOT NULL,
      chain_hash TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'Ed25519'
    );
    CREATE INDEX IF NOT EXISTS idx_cache_cert_key ON cache_certificates(cache_key);
    CREATE INDEX IF NOT EXISTS idx_cache_cert_endpoint ON cache_certificates(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_cache_cert_fresh ON cache_certificates(fresh_until);
  ` },

  // v145: Provider analytics — add cache_revenue_credits column
  { version: 145, sql: `ALTER TABLE provider_analytics ADD COLUMN cache_revenue_credits REAL NOT NULL DEFAULT 0` },

  // v146: Cache warming schedule table
  { version: 146, sql: `
    CREATE TABLE IF NOT EXISTS cache_warm_schedule (
      endpoint_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      frequency_seconds INTEGER NOT NULL DEFAULT 60,
      last_warmed_at TEXT,
      next_warm_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_cache_warm_next ON cache_warm_schedule(next_warm_at) WHERE enabled = 1;
  ` },
  { version: 147, sql: `
    CREATE TABLE IF NOT EXISTS soma_check_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint_id TEXT NOT NULL,
      request_id TEXT,
      cache_key TEXT,
      hash TEXT NOT NULL,
      client_if_none_match TEXT,
      would_have_hit INTEGER NOT NULL DEFAULT 0,
      was_hit INTEGER NOT NULL DEFAULT 0,
      origin_price_credits REAL,
      hit_price_credits REAL,
      rail TEXT NOT NULL DEFAULT 'credits',
      tier INTEGER NOT NULL DEFAULT 0,
      shadow_mode INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_soma_check_events_endpoint ON soma_check_events(endpoint_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_soma_check_events_hit ON soma_check_events(endpoint_id, was_hit) WHERE was_hit = 1;
    CREATE INDEX IF NOT EXISTS idx_soma_check_events_would ON soma_check_events(endpoint_id, would_have_hit) WHERE would_have_hit = 1;
  ` },

  // v148: Soma Check tier per provider (0=shadow, 1=passive, 2=verified, 3=champion).
  // Distinct from the legacy `tier` text column which drives UI badges.
  // See internal/soma-onboarding-ladder.md for the 4-tier definition.
  { version: 148, sql: `
    ALTER TABLE providers ADD COLUMN soma_check_tier INTEGER NOT NULL DEFAULT 0;
  ` },

  // v149: Soma Delegation Spec v0.1 fields on delegated_keys.
  // Adds depth/max_depth/branch_spend_limit/intent/scope for scoped multi-hop
  // agent-to-agent delegation. Backward-compatible: existing rows default to
  // depth=0, max_depth=0 (= current 1-hop behavior). See
  // internal/soma-delegation-spec.md.
  { version: 149, sql: `
    ALTER TABLE delegated_keys ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE delegated_keys ADD COLUMN max_depth INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE delegated_keys ADD COLUMN branch_spend_limit REAL;
    ALTER TABLE delegated_keys ADD COLUMN intent_declaration TEXT;
    ALTER TABLE delegated_keys ADD COLUMN data_domain TEXT;
    ALTER TABLE delegated_keys ADD COLUMN scope_endpoints_glob TEXT;
    ALTER TABLE delegated_keys ADD COLUMN scope_methods_csv TEXT;
    ALTER TABLE delegated_keys ADD COLUMN revoked_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_delegated_child ON delegated_keys(child_key);
  ` },

  // v150: Dynamic endpoint registry — single source of truth for all callable endpoints.
  // Replaces in-memory apiRegistry[] lookup with DB-driven findEndpoint().
  // Seeded from static api-registry.ts on first run (see seedEndpointsTable).
  { version: 150, sql: `
    CREATE TABLE IF NOT EXISTS endpoints (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT,
      base_url TEXT,
      path TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'utility',
      cost_per_call REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      input_schema_json TEXT,
      output_fields_json TEXT,
      rate_limit INTEGER,
      cache_ttl INTEGER,
      credit_cost REAL,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'seed',
      http_method TEXT NOT NULL DEFAULT 'POST',
      health_status TEXT NOT NULL DEFAULT 'healthy',
      reliability_score REAL,
      submitted_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_endpoints_category ON endpoints(category);
    CREATE INDEX IF NOT EXISTS idx_endpoints_provider ON endpoints(provider);
    CREATE INDEX IF NOT EXISTS idx_endpoints_provider_id ON endpoints(provider_id);
    CREATE INDEX IF NOT EXISTS idx_endpoints_status ON endpoints(status);
    CREATE INDEX IF NOT EXISTS idx_endpoints_source ON endpoints(source);
  ` },

  // v151: Fix provider tier defaults — standard tier is 5% fee / 95% revenue, not 10% / 85%
  { version: 151, sql: `UPDATE providers SET platform_fee_pct = 0.05, revenue_share_pct = 0.95 WHERE tier = 'standard' AND (platform_fee_pct = 0.10 OR revenue_share_pct < 0.95)` },

  // ─── v152-154: Founding Protocol — Signal points, Founding Vault, milestones ──

  // v152: Signal points ledger — every earned point is an event row
  { version: 152, sql: `
    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      provider_id TEXT,
      action TEXT NOT NULL,
      signal INTEGER NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signal_key ON signal_events(api_key);
    CREATE INDEX IF NOT EXISTS idx_signal_provider ON signal_events(provider_id);
    CREATE INDEX IF NOT EXISTS idx_signal_action ON signal_events(action);

    CREATE TABLE IF NOT EXISTS signal_balances (
      api_key TEXT PRIMARY KEY,
      provider_id TEXT,
      total_signal INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signal_bal_provider ON signal_balances(provider_id);
    CREATE INDEX IF NOT EXISTS idx_signal_bal_total ON signal_balances(total_signal DESC);
  ` },

  // v153: Founding Vault — credit lockups with bonus multipliers
  { version: 153, sql: `
    CREATE TABLE IF NOT EXISTS founding_vault (
      id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      provider_id TEXT,
      credits_locked REAL NOT NULL,
      lock_days INTEGER NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      unlocks_at TEXT NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1.25,
      status TEXT NOT NULL DEFAULT 'locked',
      unlocked_at TEXT,
      signal_earned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_vault_key ON founding_vault(api_key);
    CREATE INDEX IF NOT EXISTS idx_vault_status ON founding_vault(status);
  ` },

  // v154: Network milestones — cooperative unlock tracking
  { version: 154, sql: `
    CREATE TABLE IF NOT EXISTS network_milestones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      target_value INTEGER NOT NULL,
      current_value INTEGER NOT NULL DEFAULT 0,
      reward_type TEXT NOT NULL,
      reward_value TEXT NOT NULL,
      reached INTEGER NOT NULL DEFAULT 0,
      reached_at TEXT
    );
  ` },
  { version: 155, sql: `UPDATE providers SET platform_fee_pct = 0.10, revenue_share_pct = 0.90, cache_revenue_share_pct = 0.50, tier = 'flat' WHERE tier IN ('open', 'standard', 'verified')` },
  { version: 156, sql: `UPDATE providers SET platform_fee_pct = 0, revenue_share_pct = 1.00, tier = 'founding'` },

  // v157: Provider withdrawal system — payout wallet + withdrawal requests
  { version: 157, sql: `
    ALTER TABLE providers ADD COLUMN payout_wallet TEXT;
    ALTER TABLE providers ADD COLUMN payout_wallet_verified INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE providers ADD COLUMN withdrawable_credits REAL NOT NULL DEFAULT 0;
  ` },
  { version: 158, sql: `
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      amount_credits REAL NOT NULL,
      amount_usdc REAL NOT NULL,
      payout_wallet TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      hold_until TEXT NOT NULL,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT,
      reviewed_by TEXT,
      completed_at TEXT,
      tx_hash TEXT,
      reject_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawals_provider ON withdrawal_requests(provider_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status);
  ` },

  // ── v159: Clean up test ClawAPIs registration (CoinGecko test data) ───────
  { version: 159, sql: `
    DELETE FROM provider_endpoints WHERE provider_id = 'prov-LlL21xSq36dwG8-m';
    DELETE FROM api_keys WHERE provider_id = 'prov-LlL21xSq36dwG8-m';
    DELETE FROM providers WHERE id = 'prov-LlL21xSq36dwG8-m';
  ` },

  // ── v160: RESERVED — 10% live call fee activates when Soma provenance ships.
  // Founding era stays at 0% platform fee on live calls.
  // Revenue comes from cache splits (50/50) and Soma Check (90/10).
  // See internal/founding-protocol.md Phase 2.

  // ── v161: Fix skills revenue share — stuck at 85% since v63, should be 90/10 ──
  { version: 161, sql: `UPDATE skills SET revenue_share_pct = 0.90 WHERE revenue_share_pct < 0.90` },

  // ── v162: Ensure new skills default to 90/10 (table DEFAULT was 0.85 from original schema) ──
  // Can't ALTER TABLE to change DEFAULT in SQLite, so catch any stragglers on boot.
  { version: 162, sql: `UPDATE skills SET revenue_share_pct = 0.90 WHERE revenue_share_pct < 0.90` },

  // ── v163: Golden model — 10% rule everywhere ──
  // Cache revenue: 50/50 → 90/10 (provider keeps 90%, matches all other revenue paths).
  // Soma Check: T0 shadow → T1 active for all providers (instant revenue, no free tier).
  // "ClawNet takes 10%. Always. Everywhere."
  { version: 163, sql: `
    UPDATE providers SET cache_revenue_share_pct = 0.90 WHERE cache_revenue_share_pct < 0.90;
    UPDATE providers SET soma_check_tier = 1 WHERE soma_check_tier = 0;
  ` },

  // ── v164: Delegated API keys — parent→child key hierarchy with constraints ──
  // Agents can create scoped child keys with credit caps, endpoint restrictions, expiry, and rate limits.
  // Children inherit parent identity but can only narrow constraints, never widen.
  // Max delegation depth: 3 levels.
  { version: 164, sql: `
    ALTER TABLE api_keys ADD COLUMN parent_key TEXT REFERENCES api_keys(key);
    ALTER TABLE api_keys ADD COLUMN label TEXT;
    ALTER TABLE api_keys ADD COLUMN max_credits REAL;
    ALTER TABLE api_keys ADD COLUMN credits_delegated REAL NOT NULL DEFAULT 0;
    ALTER TABLE api_keys ADD COLUMN allowed_endpoints_json TEXT;
    ALTER TABLE api_keys ADD COLUMN expires_at TEXT;
    ALTER TABLE api_keys ADD COLUMN rate_limit_rpm INTEGER;
    ALTER TABLE api_keys ADD COLUMN delegation_depth INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE api_keys ADD COLUMN revoked_at TEXT;
  ` },
  { version: 165, sql: `CREATE INDEX IF NOT EXISTS idx_api_keys_parent ON api_keys(parent_key) WHERE parent_key IS NOT NULL` },

  // ── v166: Computation certificates (Heartbeat Fraud Proofs Phase A) ─────────
  { version: 166, sql: `
    CREATE TABLE IF NOT EXISTS computation_certificates (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      computation_type TEXT NOT NULL,
      computation_class TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      seed_commitment TEXT NOT NULL,
      seed TEXT NOT NULL,
      output_commitment TEXT NOT NULL,
      spot_checks_json TEXT NOT NULL DEFAULT '[]',
      all_passed INTEGER NOT NULL DEFAULT 0,
      birth_cert_hash TEXT,
      signature TEXT NOT NULL,
      public_key TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'Ed25519',
      chain_hash TEXT NOT NULL,
      bond_tier INTEGER NOT NULL DEFAULT 0,
      bond_amount REAL NOT NULL DEFAULT 0,
      bond_currency TEXT NOT NULL DEFAULT 'credits',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  ` },
  { version: 167, sql: `CREATE INDEX IF NOT EXISTS idx_comp_certs_request ON computation_certificates(request_id)` },
  { version: 168, sql: `CREATE INDEX IF NOT EXISTS idx_comp_certs_type ON computation_certificates(computation_type)` },

  // ── v169: Add spot-check fields to soma_receipts ────────────────────────────
  { version: 169, sql: `
    ALTER TABLE soma_receipts ADD COLUMN spot_checks_json TEXT;
    ALTER TABLE soma_receipts ADD COLUMN seed_commitment TEXT;
    ALTER TABLE soma_receipts ADD COLUMN computation_cert_id TEXT;
  ` },

  // ── v170-173: Phase B — challenge protocol ────────────────────────────────
  { version: 170, sql: `
    ALTER TABLE computation_certificates ADD COLUMN challenge_window_end TEXT;
    ALTER TABLE computation_certificates ADD COLUMN finalized INTEGER NOT NULL DEFAULT 1;
  ` },
  { version: 171, sql: `
    CREATE TABLE IF NOT EXISTS computation_challenges (
      id TEXT PRIMARY KEY,
      cert_id TEXT NOT NULL,
      challenger_api_key_hash TEXT NOT NULL,
      challenger_bond REAL NOT NULL DEFAULT 0,
      agent_bond REAL NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'filed',
      reason TEXT,
      bisection_rounds_json TEXT,
      current_disputed_range_start INTEGER,
      current_disputed_range_end INTEGER,
      resolution TEXT,
      resolution_detail TEXT,
      winner TEXT,
      slash_winner REAL,
      slash_treasury REAL,
      slash_burned REAL,
      response_deadline TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (cert_id) REFERENCES computation_certificates(id)
    )
  ` },
  { version: 172, sql: `CREATE INDEX IF NOT EXISTS idx_challenges_cert ON computation_challenges(cert_id)` },
  { version: 173, sql: `CREATE INDEX IF NOT EXISTS idx_challenges_state ON computation_challenges(state)` },

  // ── Agent Lifecycle: burner agents + death certificates ──────────────────
  { version: 174, sql: `
    CREATE TABLE IF NOT EXISTS burner_agents (
      id TEXT PRIMARY KEY,
      parent_did TEXT NOT NULL,
      parent_public_key TEXT NOT NULL,
      public_key TEXT NOT NULL,
      derivation_path TEXT NOT NULL,
      ttl_seconds INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      bond_amount REAL NOT NULL DEFAULT 5,
      max_spend REAL NOT NULL DEFAULT 50,
      spent REAL NOT NULL DEFAULT 0,
      allowed_endpoints_json TEXT,
      allowed_actions_json TEXT NOT NULL DEFAULT '["query","skill","discover"]',
      inherited_trust REAL NOT NULL DEFAULT 0,
      trust_decay_per_hour REAL NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked','dead')),
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      death_cert_hash TEXT,
      creation_signature TEXT NOT NULL
    )
  ` },
  { version: 175, sql: `
    CREATE TABLE IF NOT EXISTS death_certificates (
      id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      agent_public_key TEXT NOT NULL,
      final_trust_score REAL NOT NULL DEFAULT 0,
      total_transactions INTEGER NOT NULL DEFAULT 0,
      total_credits REAL NOT NULL DEFAULT 0,
      active_duration_hours REAL NOT NULL DEFAULT 0,
      pending_bonds_settled INTEGER NOT NULL DEFAULT 0,
      burners_revoked INTEGER NOT NULL DEFAULT 0,
      wallet_swept_to TEXT,
      wallet_swept_amount REAL NOT NULL DEFAULT 0,
      successor_did TEXT,
      trust_transfer_amount REAL NOT NULL DEFAULT 0,
      trust_transfer_pending INTEGER NOT NULL DEFAULT 0,
      contestation_ends_at TEXT,
      final_heartbeat_index INTEGER NOT NULL DEFAULT 0,
      chain_hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'graceful',
      created_at TEXT NOT NULL
    )
  ` },
  { version: 176, sql: `CREATE INDEX IF NOT EXISTS idx_burners_parent ON burner_agents(parent_did, status)` },
  { version: 177, sql: `CREATE INDEX IF NOT EXISTS idx_burners_expires ON burner_agents(expires_at) WHERE status = 'active'` },
  { version: 178, sql: `CREATE INDEX IF NOT EXISTS idx_death_certs_did ON death_certificates(agent_did)` },

  // ── v179-180: Soma Pulse Tree — per-agent MMR state + leaf storage ─────
  { version: 179, sql: `
    CREATE TABLE IF NOT EXISTS agent_pulse_state (
      agent_did TEXT PRIMARY KEY,
      heartbeat_index INTEGER NOT NULL DEFAULT 0,
      leaf_count INTEGER NOT NULL DEFAULT 0,
      total_credits REAL NOT NULL DEFAULT 0,
      root_hash TEXT NOT NULL DEFAULT '',
      peaks_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  ` },
  { version: 180, sql: `
    CREATE TABLE IF NOT EXISTS pulse_tree_leaves (
      id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      leaf_index INTEGER NOT NULL,
      position INTEGER NOT NULL,
      type INTEGER NOT NULL,
      heartbeat_index INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      credit_delta REAL NOT NULL DEFAULT 0,
      root_after TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ptl_agent ON pulse_tree_leaves(agent_did, leaf_index);
    CREATE INDEX IF NOT EXISTS idx_ptl_type ON pulse_tree_leaves(agent_did, type);
    CREATE INDEX IF NOT EXISTS idx_ptl_heartbeat ON pulse_tree_leaves(agent_did, heartbeat_index);
  ` },
  { version: 181, sql: `
    CREATE TABLE IF NOT EXISTS soma_checkpoints (
      agent_did TEXT NOT NULL,
      checkpoint_index INTEGER NOT NULL,
      heartbeat_start INTEGER NOT NULL,
      heartbeat_end INTEGER NOT NULL,
      action_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      total_credits_delta REAL NOT NULL DEFAULT 0,
      prev_checkpoint_hash TEXT NOT NULL DEFAULT '',
      pulse_root TEXT NOT NULL,
      summary TEXT NOT NULL,
      checkpoint_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_did, checkpoint_index)
    );
    CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON soma_checkpoints(agent_did, checkpoint_index DESC);
  ` },
  { version: 182, sql: `
    CREATE TABLE IF NOT EXISTS trust_queries (
      id TEXT PRIMARY KEY,
      querier_key TEXT NOT NULL,
      subject_did TEXT NOT NULL,
      tier TEXT NOT NULL CHECK(tier IN ('basic', 'dimensional', 'full')),
      credits_charged REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tq_querier ON trust_queries(querier_key);
    CREATE INDEX IF NOT EXISTS idx_tq_subject ON trust_queries(subject_did);
    CREATE INDEX IF NOT EXISTS idx_tq_created ON trust_queries(created_at DESC);
  ` },
  { version: 183, sql: `
    -- Revenue architecture v2: routing is free. Provider gets 100% of all call revenue.
    -- ClawNet revenue comes from trust queries, not routing cuts.
    UPDATE providers SET cache_revenue_share_pct = 1.00 WHERE cache_revenue_share_pct < 1.00;
    UPDATE providers SET platform_fee_pct = 0 WHERE platform_fee_pct > 0;
  ` },
  { version: 184, sql: `
    CREATE TABLE IF NOT EXISTS vouch_stakes (
      id TEXT PRIMARY KEY,
      voucher_did TEXT NOT NULL,
      vouchee_did TEXT NOT NULL,
      stake_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked', 'slashed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      revoked_at TEXT,
      slash_reason TEXT,
      UNIQUE(voucher_did, vouchee_did, status)
    );
    CREATE INDEX IF NOT EXISTS idx_vs_voucher ON vouch_stakes(voucher_did, status);
    CREATE INDEX IF NOT EXISTS idx_vs_vouchee ON vouch_stakes(vouchee_did, status);
    CREATE INDEX IF NOT EXISTS idx_vs_expires ON vouch_stakes(expires_at) WHERE expires_at IS NOT NULL;
  ` },
  { version: 185, sql: `
    ALTER TABLE agent_pulse_state ADD COLUMN last_groth16_at TEXT;
  ` },
  { version: 186, sql: `
    CREATE TABLE IF NOT EXISTS agent_identity_verification (
      agent_did TEXT PRIMARY KEY,
      identity_tier TEXT NOT NULL DEFAULT 'anonymous'
        CHECK(identity_tier IN ('biometric', 'kyc-attested', 'passport', 'anonymous')),
      provider TEXT,
      verification_hash TEXT,
      verified_at TEXT,
      expires_at TEXT,
      wallet_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  ` },
  { version: 187, sql: `
    CREATE TABLE IF NOT EXISTS agentkit_usage (
      endpoint TEXT NOT NULL,
      human_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (endpoint, human_id)
    );
    CREATE TABLE IF NOT EXISTS agentkit_nonces (
      nonce TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  ` },
  { version: 188, sql: `
    CREATE TABLE IF NOT EXISTS agent_identity_signals (
      agent_did TEXT NOT NULL,
      signal_type TEXT NOT NULL CHECK(signal_type IN ('biometric', 'kyc', 'passport')),
      provider TEXT NOT NULL,
      signal_score REAL NOT NULL DEFAULT 1.0,
      verification_hash TEXT,
      verified_at TEXT,
      expires_at TEXT,
      wallet_address TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_did, signal_type)
    );
    CREATE INDEX IF NOT EXISTS idx_ais_expires ON agent_identity_signals(expires_at) WHERE expires_at IS NOT NULL;

    INSERT OR IGNORE INTO agent_identity_signals (agent_did, signal_type, provider, signal_score, verification_hash, verified_at, expires_at, wallet_address, created_at, updated_at)
      SELECT agent_did,
        CASE identity_tier
          WHEN 'biometric' THEN 'biometric'
          WHEN 'kyc-attested' THEN 'kyc'
          WHEN 'passport' THEN 'passport'
        END,
        provider, 1.0, verification_hash, verified_at, expires_at, wallet_address, created_at, updated_at
      FROM agent_identity_verification
      WHERE identity_tier != 'anonymous';
  ` },
  { version: 189, sql: `
    CREATE TABLE IF NOT EXISTS agent_identity_composite (
      agent_did TEXT PRIMARY KEY,
      composite_score REAL NOT NULL DEFAULT 0,
      effective_multiplier REAL NOT NULL DEFAULT 0.5,
      biometric_signal REAL NOT NULL DEFAULT 0,
      kyc_signal REAL NOT NULL DEFAULT 0,
      passport_signal REAL NOT NULL DEFAULT 0,
      behavioral_signal REAL NOT NULL DEFAULT 0,
      social_signal REAL NOT NULL DEFAULT 0,
      signal_count INTEGER NOT NULL DEFAULT 0,
      last_recomputed TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  ` },
  { version: 190, sql: `
    CREATE TABLE IF NOT EXISTS custody_events (
      id TEXT PRIMARY KEY,
      agent_did TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('accept', 'access', 'release')),
      dek_fingerprint TEXT,
      destruction_proof TEXT,
      fields_manifest_json TEXT,
      fields_accessed_json TEXT,
      access_reason TEXT,
      pulse_leaf_index INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_custody_agent_subject ON custody_events(agent_did, subject_id);
    CREATE INDEX IF NOT EXISTS idx_custody_agent_type ON custody_events(agent_did, event_type);
  ` },
  // ── Bilateral commitment: cross-reference pulse tree entries ──
  { version: 191, sql: `ALTER TABLE pulse_tree_leaves ADD COLUMN bilateral_ref TEXT` },
  { version: 192, sql: `CREATE INDEX IF NOT EXISTS idx_ptl_bilateral ON pulse_tree_leaves(bilateral_ref) WHERE bilateral_ref IS NOT NULL` },
  // ── Conservation of trust: vouching transfers trust with decay + cost ──
  { version: 193, sql: `ALTER TABLE vouch_stakes ADD COLUMN trust_cost REAL NOT NULL DEFAULT 0` },
  { version: 194, sql: `ALTER TABLE vouch_stakes ADD COLUMN trust_transferred REAL NOT NULL DEFAULT 0` },
  // ── Epoch snapshots: multi-subtree Merkle tree for PoTW ──
  { version: 195, sql: `
    CREATE TABLE IF NOT EXISTS epoch_snapshots (
      epoch_number INTEGER PRIMARY KEY,
      epoch_timestamp TEXT NOT NULL,
      previous_epoch_root TEXT,
      scoring_circuit_hash TEXT NOT NULL,
      pulse_entries_root TEXT NOT NULL,
      vouch_graph_root TEXT NOT NULL,
      attestation_stats_root TEXT NOT NULL,
      metadata_root TEXT NOT NULL,
      epoch_root TEXT NOT NULL,
      agent_count INTEGER NOT NULL DEFAULT 0,
      entry_count INTEGER NOT NULL DEFAULT 0,
      vouch_count INTEGER NOT NULL DEFAULT 0,
      tree_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_epoch_root ON epoch_snapshots(epoch_root);
  ` },
  // ── Weighted bilateral credit (Q6): 1.0 routed, 0.75 verify, 0 direct ──
  { version: 196, sql: `ALTER TABLE pulse_tree_leaves ADD COLUMN bilateral_weight REAL NOT NULL DEFAULT 1.0` },
  // ── Credential rotation backend state (Soma primitive dogfood) ──
  // Two tables own the durable half of ClawNetApiKeyBackend: minted credentials
  // (active + revoked, kept until the controller's verify-before-revoke drops
  // them) and per-identity staging pointers. No touch to `api_keys` yet — that
  // migration is a separate step, see backlog credential-rotation-architecture.md §9.
  { version: 197, sql: `
    CREATE TABLE IF NOT EXISTS api_key_rotation_credentials (
      credential_id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      algorithm_suite TEXT NOT NULL,
      class TEXT NOT NULL,
      public_key TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      next_manifest_commitment TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_akrc_identity ON api_key_rotation_credentials(identity_id);
    CREATE TABLE IF NOT EXISTS api_key_rotation_identities (
      identity_id TEXT PRIMARY KEY,
      current_credential_id TEXT NOT NULL,
      next_public_key TEXT NOT NULL,
      next_secret_key TEXT NOT NULL,
      ttl_ms INTEGER NOT NULL
    );
  ` },

  // Shadow-adopt-cutover Phase 1: maps an existing api_keys.key to a Soma
  // rotation identity so checkApiKey can perform a non-authoritative shadow
  // lookup against the rotation backend. `authoritative = 0` means legacy
  // still wins (Phase 1); flipping to 1 promotes the rotation backend to
  // primary for this key (Phase 2). See credential-rotation-architecture.md §9a.
  { version: 198, sql: `
    CREATE TABLE IF NOT EXISTS api_key_rotation_adoptions (
      api_key TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL UNIQUE,
      adopted_at INTEGER NOT NULL,
      authoritative INTEGER NOT NULL DEFAULT 0
    );
  ` },
  // Real action-outcome column. Prior state: soma-checkpoint hardcoded
  // successCount = actionCount and trust-oracle.computeReliability used
  // credit_delta >= 0 as a proxy, neither reflecting actual outcome.
  // Callers of appendAction already pass success in the payload; this
  // column persists it for downstream trust computation.
  { version: 199, sql: `ALTER TABLE pulse_tree_leaves ADD COLUMN success INTEGER NOT NULL DEFAULT 1` },
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
  if (db) {
    logger.warn('initDb() called twice — ignoring');
    return;
  }
  db = new Database(DB_PATH);
  try {
    sqliteVec.load(db);
  } catch (err) {
    logger.warn({ err }, 'sqlite-vec failed to load — vector search unavailable (binary incompatibility?)');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

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
      revenue_share_pct REAL NOT NULL DEFAULT 0.85,
      uses INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_skills_author ON skills(author_key);

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

  // Seed endpoints table from static registry (one-time, idempotent)
  seedEndpointsTable();

  // Inject DB-backed findEndpoint() lookup — all callers now resolve from endpoints table
  setEndpointDbLookup((id: string): ApiEndpoint | undefined => {
    const row = db.prepare(
      'SELECT * FROM endpoints WHERE id = ? AND status = ?'
    ).get(id, 'active') as any;
    if (!row) return undefined;
    return dbRowToApiEndpoint(row);
  });

  logger.info({ path: DB_PATH }, 'Database initialised');
}

/**
 * Convert an endpoints DB row back to ApiEndpoint interface.
 */
export function dbRowToApiEndpoint(row: any): ApiEndpoint {
  return {
    id: row.id,
    provider: row.provider,
    baseUrl: row.base_url ?? undefined,
    path: row.path ?? undefined,
    name: row.name,
    description: row.description,
    category: row.category,
    costPerCall: row.cost_per_call,
    latencyMs: row.latency_ms,
    inputSchema: safeJsonParse(row.input_schema_json, {}),
    outputFields: safeJsonParse(row.output_fields_json, []),
    rateLimit: row.rate_limit ?? undefined,
    cacheTtl: row.cache_ttl ?? undefined,
    creditCost: row.credit_cost ?? undefined,
  };
}

/**
 * Seed the endpoints table from the static apiRegistry array.
 * Runs once — skips if the table already has seed data.
 * Uses INSERT OR IGNORE so re-runs are safe.
 */
function seedEndpointsTable(): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM endpoints WHERE source = ?').get('seed') as any)?.c ?? 0;
  if (count > 0) {
    logger.debug({ seedCount: count }, 'Endpoints table already seeded — skipping');
    return;
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO endpoints (
      id, provider, base_url, path, name, description, category,
      cost_per_call, latency_ms, input_schema_json, output_fields_json,
      rate_limit, cache_ttl, credit_cost, status, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'seed')
  `);

  db.transaction(() => {
    for (const ep of apiRegistry) {
      stmt.run(
        ep.id,
        ep.provider,
        ep.baseUrl ?? null,
        ep.path ?? null,
        ep.name,
        ep.description,
        ep.category,
        ep.costPerCall,
        ep.latencyMs,
        JSON.stringify(ep.inputSchema),
        JSON.stringify(ep.outputFields),
        ep.rateLimit ?? null,
        ep.cacheTtl ?? null,
        ep.creditCost ?? null,
      );
    }
  })();

  logger.info({ seeded: apiRegistry.length }, 'Endpoints table seeded from static registry');
}
