import Database from 'better-sqlite3';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = path.join(process.cwd(), 'data', 'orchestrator.db');

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
      credits_per_month INTEGER NOT NULL DEFAULT 40000,
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

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info('Database closed');
  }
}

// ─── Orchestrations ───────────────────────────────────────────────────────────

export function insertOrchestration(entry: {
  id: string;
  timestamp: string;
  query: string;
  plannedSteps: number;
  executedSteps: number;
  successfulSteps: number;
  cacheHits: number;
  totalDurationMs: number;
  apiCost: number;
  markup: number;
  total: number;
  success: boolean;
  llmProvider: string;
  apiKey?: string;
  skillId?: string;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO orchestrations
          (id, timestamp, query, planned_steps, executed_steps, successful_steps,
           cache_hits, total_duration_ms, api_cost, markup, total, success, llm_provider, api_key, skill_id)
         VALUES
          (@id, @timestamp, @query, @plannedSteps, @executedSteps, @successfulSteps,
           @cacheHits, @totalDurationMs, @apiCost, @markup, @total, @success, @llmProvider, @apiKey, @skillId)`
      )
      .run({ ...entry, success: entry.success ? 1 : 0, apiKey: entry.apiKey ?? null, skillId: entry.skillId ?? null });
  } catch (err) {
    logger.error({ err }, 'Failed to insert orchestration');
  }
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export function insertFeedback(entry: {
  id: string;
  requestId: string;
  rating: number;
  comment: string | undefined;
  timestamp: string;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO feedback (id, request_id, rating, comment, timestamp)
         VALUES (@id, @requestId, @rating, @comment, @timestamp)`
      )
      .run(entry);
  } catch (err) {
    logger.error({ err }, 'Failed to insert feedback');
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getDbStats(): {
  totalOrchestrations: number;
  total: number;
  totalRevenue: number;
  avgDurationMs: number;
  successRate: number;
  errorRate: number;
  feedbackCount: number;
  avgRating: number;
  topQueries: { query: string; count: number }[];
} {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(total), 0) as revenue,
      COALESCE(AVG(total_duration_ms), 0) as avgDuration,
      COALESCE(AVG(CASE WHEN success = 1 THEN 100.0 ELSE 0 END), 0) as successRate,
      COALESCE(AVG(CASE WHEN success = 0 THEN 100.0 ELSE 0 END), 0) as errorRate
    FROM orchestrations
  `).get() as { total: number; revenue: number; avgDuration: number; successRate: number; errorRate: number };

  const topQueries = db.prepare(`
    SELECT query, COUNT(*) as count
    FROM orchestrations
    GROUP BY query
    ORDER BY count DESC
    LIMIT 10
  `).all() as { query: string; count: number }[];

  const feedbackStats = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(AVG(rating), 0) as avgRating FROM feedback
  `).get() as { count: number; avgRating: number };

  return {
    totalOrchestrations: totals.total,
    total: totals.total,
    totalRevenue: Math.round(totals.revenue * 10000) / 10000,
    avgDurationMs: Math.round(totals.avgDuration),
    successRate: Math.round(totals.successRate),
    errorRate: Math.round(totals.errorRate),
    feedbackCount: feedbackStats.count,
    avgRating: Math.round(feedbackStats.avgRating * 10) / 10,
    topQueries,
  };
}

// ── Solana / Clerk helpers ─────────────────────────────────────
export function getApiKeyByClerkId(clerkUserId: string): {
  key: string; email: string; credits: number; amount_paid: number;
} | undefined {
  return db.prepare('SELECT key, email, credits, amount_paid FROM api_keys WHERE clerk_user_id = ? AND active = 1')
    .get(clerkUserId) as { key: string; email: string; credits: number; amount_paid: number } | undefined;
}

export function createApiKeyForClerk(opts: {
  key: string;
  clerkUserId: string;
  email: string;
  credits: number;
  solanaSignature: string;
  amountPaid: number;
}) {
  db.prepare(`
    INSERT INTO api_keys (key, email, credits, credits_used, created_at, stripe_session_id, clerk_user_id)
    VALUES (?, ?, ?, 0, datetime('now'), ?, ?)
  `).run(opts.key, opts.email, opts.credits, opts.solanaSignature, opts.clerkUserId);
  logAudit({ entityType: 'api_key', entityId: opts.key, action: 'CREDIT_GRANT', actorId: opts.clerkUserId, data: { credits: opts.credits, amountPaid: opts.amountPaid, via: 'usdc' } });
}

export function topUpCreditsForClerk(clerkUserId: string, credits: number, _signature: string, amountPaid = 0): { ok: boolean } {
  if (credits <= 0) throw new Error(`topUpCreditsForClerk: credits must be positive, got ${credits}`);
  const result = db.prepare(`
    UPDATE api_keys
    SET credits = credits + ?,
        amount_paid = amount_paid + ?
    WHERE clerk_user_id = ? AND active = 1
  `).run(credits, amountPaid, clerkUserId);
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: clerkUserId, action: 'CREDIT_TOPUP', data: { credits, amountPaid, via: 'usdc' } });
  }
  return { ok: result.changes > 0 };
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export function createApiKey(params: {
  key: string;
  email: string;
  credits: number;
  stripeSessionId: string;
  amountPaid: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO api_keys (key, email, credits, stripe_session_id, amount_paid)
       VALUES (@key, @email, @credits, @stripeSessionId, @amountPaid)`
    )
    .run(params);
  logAudit({ entityType: 'api_key', entityId: params.key, action: 'CREDIT_GRANT', data: { credits: params.credits, amountPaid: params.amountPaid, via: 'stripe' } });
}

export function getApiKey(key: string): {
  key: string;
  email: string;
  credits: number;
  credits_used: number;
  active: number;
  last_used_at: string | null;
} | undefined {
  return getDb()
    .prepare('SELECT * FROM api_keys WHERE key = ? AND active = 1')
    .get(key) as ReturnType<typeof getApiKey>;
}

export function getApiKeyByStripeSession(sessionId: string): { key: string } | undefined {
  return getDb()
    .prepare('SELECT key FROM api_keys WHERE stripe_session_id = ? AND active = 1')
    .get(sessionId) as { key: string } | undefined;
}

export function deductCredit(key: string, amount: number = 1): boolean {
  if (amount <= 0) throw new Error(`deductCredit: amount must be positive, got ${amount}`);
  const result = getDb()
    .prepare(
      `UPDATE api_keys
       SET credits = credits - @amount,
           credits_used = credits_used + @amount,
           last_used_at = datetime('now')
       WHERE key = @key AND credits >= @amount AND active = 1`
    )
    .run({ key, amount });
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: key, action: 'CREDIT_DEDUCT', data: { amount } });
  }
  return result.changes > 0;
}

export function getApiKeyBalance(key: string): {
  credits: number;
  credits_used: number;
  email: string;
  created_at: string;
} | undefined {
  return getDb()
    .prepare('SELECT credits, credits_used, email, created_at FROM api_keys WHERE key = ? AND active = 1')
    .get(key) as ReturnType<typeof getApiKeyBalance>;
}

export function getApiKeyByEmail(email: string): {
  key: string;
  email: string;
  credits: number;
  credits_used: number;
  amount_paid: number;
} | undefined {
  return getDb()
    .prepare(
      `SELECT key, email, credits, credits_used, amount_paid
       FROM api_keys WHERE email = ? AND active = 1
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(email) as ReturnType<typeof getApiKeyByEmail>;
}

export function topUpCredits(key: string, credits: number, stripeSessionId?: string, amountPaid?: number): { ok: boolean } {
  if (credits <= 0) throw new Error(`topUpCredits: credits must be positive, got ${credits}`);
  let result;
  if (stripeSessionId) {
    // Use the explicit amountPaid when provided (avoids inflating amount_paid for bonus tiers).
    // Fall back to credits / 1000 only for subscription top-ups that don't pass an amount.
    const dollarValue = amountPaid != null ? amountPaid : credits / 1000;
    result = getDb()
      .prepare(
        `UPDATE api_keys
         SET credits = credits + ?,
             stripe_session_id = ?,
             amount_paid = amount_paid + ?
         WHERE key = ? AND active = 1`
      )
      .run(credits, stripeSessionId, dollarValue, key);
  } else {
    result = getDb()
      .prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1')
      .run(credits, key);
  }
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: key, action: 'CREDIT_TOPUP', data: { credits, stripeSessionId, amountPaid } });
  }
  return { ok: result.changes > 0 };
}

// ─── Stripe Session Dedup (atomic idempotency) ───────────────────────────────

/** Read-only check — returns true if this session has already been processed.
 *  Use this as a fast pre-flight check before async Stripe API calls. */
export function isStripeSessionClaimed(sessionId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM stripe_processed_sessions WHERE session_id = ?').get(sessionId);
  return row != null;
}

/** Atomically claim a session inside an already-open transaction.
 *  Returns true if the INSERT succeeded (first caller), false if already claimed.
 *  MUST be called inside getDb().transaction() alongside the credit grant. */
export function claimStripeSession(sessionId: string): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO stripe_processed_sessions (session_id) VALUES (?)')
    .run(sessionId);
  return result.changes > 0;
}

// ─── Solana Signature Dedup ───────────────────────────────────────────────────

/** Atomic claim: INSERT OR IGNORE + check changes. Returns true only for the first caller.
 *  Use this as the idempotency gate BEFORE any async on-chain verification to prevent
 *  TOCTOU race conditions where concurrent requests both pass an isProcessed SELECT check. */
export function tryClaimSolanaSignature(signature: string): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO solana_processed_sigs (signature) VALUES (?)')
    .run(signature);
  return result.changes > 0;
}

/** Release a previously claimed signature so the user can retry verification.
 *  Call this on ALL non-success paths after tryClaimSolanaSignature returns true
 *  (tx not found, on-chain fail, amount mismatch, RPC error) so a user whose
 *  legitimate tx had a transient RPC error is not permanently locked out. */
export function releaseClaimSolanaSignature(signature: string): void {
  getDb().prepare('DELETE FROM solana_processed_sigs WHERE signature = ?').run(signature);
}

/** @deprecated Use tryClaimSolanaSignature instead */
export function isSignatureProcessed(signature: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM solana_processed_sigs WHERE signature = ?').get(signature);
  return row != null;
}

/** @deprecated Use tryClaimSolanaSignature instead */
export function markSignatureProcessed(signature: string): void {
  try {
    getDb()
      .prepare('INSERT OR IGNORE INTO solana_processed_sigs (signature) VALUES (?)')
      .run(signature);
  } catch (err) {
    logger.error({ err }, 'Failed to mark signature processed');
  }
}

// ─── Stripe Event Dedup ──────────────────────────────────────────────────────

export function isStripeEventProcessed(eventId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM stripe_processed_events WHERE event_id = ?').get(eventId);
  return row != null;
}

export function markStripeEventProcessed(eventId: string): void {
  try {
    getDb()
      .prepare('INSERT OR IGNORE INTO stripe_processed_events (event_id) VALUES (?)')
      .run(eventId);
  } catch (err) {
    logger.error({ err }, 'Failed to mark Stripe event processed');
  }
}

// ─── Stripe Charge Refund Dedup ───────────────────────────────────────────────

/** Returns how many cents of refund we have already processed for this charge. */
export function getStripeChargeRefundedCents(chargeId: string): number {
  const row = getDb()
    .prepare('SELECT amount_refunded_cents FROM stripe_refunded_charges WHERE charge_id = ?')
    .get(chargeId) as { amount_refunded_cents: number } | undefined;
  return row?.amount_refunded_cents ?? 0;
}

/** Upserts the running total of refunded cents for a charge.
 *  Call atomically alongside the credit deduction. */
export function upsertStripeChargeRefundedCents(chargeId: string, totalCents: number): void {
  getDb()
    .prepare(`INSERT INTO stripe_refunded_charges (charge_id, amount_refunded_cents)
              VALUES (?, ?)
              ON CONFLICT(charge_id) DO UPDATE SET
                amount_refunded_cents = excluded.amount_refunded_cents,
                processed_at = datetime('now')`)
    .run(chargeId, totalCents);
}

// ─── Referral Codes ───────────────────────────────────────────────────────────

export function createReferralCode(code: string, ownerKey: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO referral_codes (code, owner_key) VALUES (?, ?)')
    .run(code, ownerKey);
}

export function getReferralCode(code: string): { code: string; owner_key: string; uses: number } | undefined {
  return getDb()
    .prepare('SELECT code, owner_key, uses FROM referral_codes WHERE code = ?')
    .get(code) as { code: string; owner_key: string; uses: number } | undefined;
}

export function incrementReferralUse(code: string): void {
  getDb().prepare('UPDATE referral_codes SET uses = uses + 1 WHERE code = ?').run(code);
}

export function getReferralCodeByOwner(ownerKey: string): { code: string; uses: number } | undefined {
  return getDb()
    .prepare('SELECT code, uses FROM referral_codes WHERE owner_key = ? LIMIT 1')
    .get(ownerKey) as { code: string; uses: number } | undefined;
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export function upsertSubscription(params: {
  subscriptionId: string;
  apiKey: string;
  email: string;
  creditsPerMonth: number;
  currentPeriodEnd: string;
  status: string;
}): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO subscriptions
      (subscription_id, api_key, email, status, credits_per_month, current_period_end)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(params.subscriptionId, params.apiKey, params.email, params.status, params.creditsPerMonth, params.currentPeriodEnd);
}

export function getSubscriptionByApiKey(apiKey: string): {
  subscription_id: string; status: string; credits_per_month: number;
} | undefined {
  return getDb()
    .prepare('SELECT subscription_id, status, credits_per_month FROM subscriptions WHERE api_key = ? AND status = \'active\' LIMIT 1')
    .get(apiKey) as { subscription_id: string; status: string; credits_per_month: number } | undefined;
}

// ─── Email Send Log ───────────────────────────────────────────────────────────

export function wasEmailSentRecently(email: string, type: string, withinMs: number): boolean {
  const cutoff = new Date(Date.now() - withinMs).toISOString();
  const row = getDb()
    .prepare('SELECT 1 FROM email_send_log WHERE email = ? AND type = ? AND sent_at > ?')
    .get(email, type, cutoff);
  return row != null;
}

export function logEmailSend(email: string, type: string): void {
  getDb()
    .prepare('INSERT INTO email_send_log (id, email, type) VALUES (?, ?, ?)')
    .run(nanoid(12), email, type);
}

// ─── API Key Full Info (for tiered rate limiting) ─────────────────────────────

export function getApiKeyAmountPaid(key: string): number {
  const row = getDb()
    .prepare('SELECT amount_paid FROM api_keys WHERE key = ? AND active = 1')
    .get(key) as { amount_paid: number } | undefined;
  return row?.amount_paid ?? 0;
}

// ─── Mesh Peers ───────────────────────────────────────────────────────────────

export function upsertPeer(id: string, multiaddr: string, metadata?: Record<string, unknown>): void {
  if (!id || typeof id !== 'string' || id.length > 256) return;
  if (typeof multiaddr !== 'string' || multiaddr.length > 512) return;
  if (multiaddr && !multiaddr.startsWith('/')) return;

  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO peers (id, multiaddr, last_seen, metadata_json)
         VALUES (?, ?, datetime('now'), ?)`
      )
      .run(id, multiaddr, metadata ? JSON.stringify(metadata) : null);
  } catch (err) {
    logger.error({ err }, 'Failed to upsert peer');
  }
}

export function getPeers(): { id: string; multiaddr: string; last_seen: string; metadata_json: string | null }[] {
  return getDb()
    .prepare('SELECT id, multiaddr, last_seen, metadata_json FROM peers ORDER BY last_seen DESC')
    .all() as { id: string; multiaddr: string; last_seen: string; metadata_json: string | null }[];
}

// ─── API Key Regeneration ─────────────────────────────────────────────────────

/**
 * Atomically deactivates the current key for a Clerk user and inserts a new one
 * with the same credits, email, and amount_paid. Returns null if no active key found.
 */
export function regenerateApiKey(
  clerkUserId: string,
  newKey: string,
): { oldKey: string; credits: number; email: string } | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db
      .prepare(
        'SELECT key, credits, credits_used, email, amount_paid FROM api_keys WHERE clerk_user_id = ? AND active = 1 LIMIT 1',
      )
      .get(clerkUserId) as
      | { key: string; credits: number; credits_used: number; email: string; amount_paid: number }
      | undefined;

    if (!row) return null;

    // Insert new key copying all financial data (stripe_session_id left NULL to avoid UNIQUE violation)
    db.prepare(`
      INSERT INTO api_keys (key, email, credits, credits_used, amount_paid, clerk_user_id, active)
      SELECT ?, email, credits, credits_used, amount_paid, clerk_user_id, 1
      FROM api_keys WHERE key = ?
    `).run(newKey, row.key);

    // Deactivate old key
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(row.key);

    return { oldKey: row.key, credits: row.credits, email: row.email };
  })();
}

// ─── Skills / ClawHub ─────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt_template: string;
  author_key: string;
  public: number;
  credit_cost: number;
  revenue_share_pct: number;
  uses: number;
  created_at: string;
  // migration-added columns (may be null on old rows)
  version: string;
  input_schema_json: string | null;
  output_schema_json: string | null;
  published_at: string | null;
  tags_json: string | null;
  forked_from: string | null;
  ab_challenger: string | null;
  // v2 marketplace columns
  readme: string | null;
  license: string | null;
  runtime_json: string | null;
  stars: number;
  views: number;
  forks: number;
  security_status: string;
  scanned_at: string | null;
  status: string;
  display_name: string | null;
  changelog: string | null;
  category: string;
  skill_type: 'prompt_template' | 'api_proxy';
  proxy_url: string | null;
  proxy_method: string;
}

export function createSkill(params: {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  authorKey: string;
  public: boolean;
  creditCost: number;
  displayName?: string;
  changelog?: string;
  category?: string;
  skillType?: 'prompt_template' | 'api_proxy';
  proxyUrl?: string;
  proxyMethod?: string;
}): void {
  getDb()
    .prepare(`INSERT INTO skills (id, name, description, prompt_template, author_key, public, credit_cost, display_name, changelog, category, skill_type, proxy_url, proxy_method)
              VALUES (@id, @name, @description, @promptTemplate, @authorKey, @public, @creditCost, @displayName, @changelog, @category, @skillType, @proxyUrl, @proxyMethod)`)
    .run({
      ...params,
      public: params.public ? 1 : 0,
      displayName: params.displayName ?? null,
      changelog: params.changelog ?? null,
      category: params.category ?? 'general',
      skillType: params.skillType ?? 'prompt_template',
      proxyUrl: params.proxyUrl ?? null,
      proxyMethod: params.proxyMethod ?? 'POST',
    });
}

export function getSkill(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(id) as Skill | undefined;
}

export function listPublicSkills(offset = 0, limit = 50): Skill[] {
  return getDb()
    .prepare('SELECT * FROM skills WHERE public = 1 AND active = 1 ORDER BY uses DESC, created_at DESC LIMIT ? OFFSET ?')
    .all(Math.min(limit, 100), offset) as Skill[];
}

export function countPublicSkills(): number {
  return (getDb()
    .prepare('SELECT COUNT(*) as n FROM skills WHERE public = 1 AND active = 1')
    .get() as { n: number }).n;
}

export function getSkillsByAuthor(authorKey: string, limit = 200): Skill[] {
  return getDb()
    .prepare('SELECT * FROM skills WHERE author_key = ? AND active = 1 ORDER BY created_at DESC LIMIT ?')
    .all(authorKey, limit) as Skill[];
}

export function countSkillsByAuthor(authorKey: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM skills WHERE author_key = ? AND active = 1')
    .get(authorKey) as { count: number };
  return row.count;
}

export function incrementSkillUses(id: string): void {
  getDb().prepare('UPDATE skills SET uses = uses + 1 WHERE id = ?').run(id);
}

export function deleteSkill(id: string, authorKey: string): boolean {
  const result = getDb()
    .prepare('UPDATE skills SET active = 0 WHERE id = ? AND author_key = ? AND active = 1')
    .run(id, authorKey);
  return result.changes > 0;
}

export function updateSkillVisibility(id: string, authorKey: string, isPublic: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE skills SET public = ? WHERE id = ? AND author_key = ? AND active = 1')
    .run(isPublic ? 1 : 0, id, authorKey);
  return result.changes > 0;
}

// ─── Discovery / Vector Search ────────────────────────────────────────────────

export function upsertDiscovery(params: {
  id: string;
  skillName: string;
  skillDesc: string;
  provider: string;
  embedding: Float32Array;
}): void {
  const db = getDb();
  db.transaction(() => {
    // Remove old vector row if exists
    const existing = db
      .prepare('SELECT rowid_vec FROM discovery_cache WHERE id = ?')
      .get(params.id) as { rowid_vec: number } | undefined;
    if (existing?.rowid_vec) {
      db.prepare('DELETE FROM skill_embeddings WHERE rowid = ?').run(existing.rowid_vec);
    }

    // Insert new vector, get its rowid
    const insert = db.prepare('INSERT INTO skill_embeddings(embedding) VALUES (?)');
    const result = insert.run(params.embedding);

    db.prepare(`
      INSERT OR REPLACE INTO discovery_cache (id, skill_name, skill_desc, provider, rowid_vec, ttl_expires)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+24 hours'))
    `).run(params.id, params.skillName, params.skillDesc, params.provider, result.lastInsertRowid);
  })();
}

export function searchDiscovery(queryEmbedding: Float32Array, limit = 10): {
  id: string; skillName: string; skillDesc: string; provider: string; distance: number;
}[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT dc.id, dc.skill_name, dc.skill_desc, dc.provider, se.distance
    FROM skill_embeddings se
    JOIN discovery_cache dc ON dc.rowid_vec = se.rowid
    WHERE se.embedding MATCH ?
      AND k = ?
    ORDER BY se.distance
  `).all(queryEmbedding, limit) as {
    id: string; skill_name: string; skill_desc: string; provider: string; distance: number;
  }[];

  return rows.map(r => ({
    id: r.id,
    skillName: r.skill_name,
    skillDesc: r.skill_desc,
    provider: r.provider,
    distance: r.distance,
  }));
}

export function getDiscoveryCacheIds(): string[] {
  return (getDb()
    .prepare('SELECT id FROM discovery_cache LIMIT 10000')
    .all() as { id: string }[])
    .map(r => r.id);
}

export function cleanExpiredDiscoveryCache(): number {
  return getDb()
    .prepare(`DELETE FROM discovery_cache WHERE ttl_expires < datetime('now')`)
    .run().changes;
}

// ─── Escrow ───────────────────────────────────────────────────────────────────

export type EscrowState =
  | 'CREATED' | 'FUNDED' | 'WORK_IN_PROGRESS'
  | 'COMPLETED' | 'DISPUTED' | 'RESOLVED' | 'REFUNDED';

export interface Escrow {
  id: string;
  hirer_id: string;
  worker_id: string;
  amount_credits: number;
  state: EscrowState;
  created_at: string;
  deadline: string | null;
  completed_at: string | null;
  metadata_json: string | null;
}

const ALLOWED_TRANSITIONS: Record<EscrowState, EscrowState[]> = {
  CREATED:          ['FUNDED'],
  FUNDED:           ['WORK_IN_PROGRESS', 'REFUNDED'],
  WORK_IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED:        [],
  DISPUTED:         ['RESOLVED'],
  RESOLVED:         [],
  REFUNDED:         [],
};

export function canTransition(from: EscrowState, to: EscrowState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function createEscrow(params: {
  id: string;
  hirerId: string;
  workerId: string;
  amountCredits: number;
  deadline?: string;
  metadata?: Record<string, unknown>;
}): void {
  getDb()
    .prepare(`INSERT INTO escrows (id, hirer_id, worker_id, amount_credits, deadline, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      params.id, params.hirerId, params.workerId, params.amountCredits,
      params.deadline ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null
    );
}

export function getEscrow(id: string): Escrow | undefined {
  return getDb().prepare('SELECT * FROM escrows WHERE id = ?').get(id) as Escrow | undefined;
}

export function listEscrowsForUser(clerkUserId: string, limit = 50, offset = 0): Escrow[] {
  return getDb()
    .prepare('SELECT * FROM escrows WHERE hirer_id = ? OR worker_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(clerkUserId, clerkUserId, limit, offset) as Escrow[];
}

/** Transition escrow state. Returns false if transition is not allowed. */
export function transitionEscrow(id: string, to: EscrowState, completedAt?: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const escrow = db.prepare('SELECT state FROM escrows WHERE id = ?').get(id) as { state: EscrowState } | undefined;
    if (!escrow || !canTransition(escrow.state, to)) return false;
    db.prepare(`UPDATE escrows SET state = ?, completed_at = ? WHERE id = ?`)
      .run(to, completedAt ?? null, id);
    return true;
  })();
}

/** Fund escrow: deduct credits from hirer atomically with state transition. */
export function fundEscrow(escrowId: string, hirerId: string): { ok: boolean; error?: string } {
  const db = getDb();
  return db.transaction(() => {
    const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
    if (!escrow) return { ok: false, error: 'Escrow not found' };
    if (escrow.hirer_id !== hirerId) return { ok: false, error: 'Not the hirer' };
    if (!canTransition(escrow.state, 'FUNDED')) return { ok: false, error: `Cannot fund from state ${escrow.state}` };

    const result = db.prepare(
      `UPDATE api_keys SET credits = credits - ? WHERE clerk_user_id = ? AND credits >= ? AND active = 1`
    ).run(escrow.amount_credits, hirerId, escrow.amount_credits);
    if (result.changes === 0) return { ok: false, error: 'Insufficient credits' };

    db.prepare(`UPDATE escrows SET state = 'FUNDED' WHERE id = ?`).run(escrowId);
    return { ok: true };
  })();
}

/** Release escrow: credit worker atomically with state transition. */
export function releaseEscrow(escrowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
      if (!escrow) throw new Error('Escrow not found');
      if (!canTransition(escrow.state, 'COMPLETED')) throw new Error(`Cannot release from state ${escrow.state}`);

      const result = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
        .run(escrow.amount_credits, escrow.worker_id);
      if (result.changes === 0) throw new Error('Worker has no active API key — credits cannot be disbursed');
      db.prepare(`UPDATE escrows SET state = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Refund escrow to hirer (timeout / cancellation). */
export function refundEscrow(escrowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
      if (!escrow) throw new Error('Escrow not found');
      if (!canTransition(escrow.state, 'REFUNDED')) throw new Error(`Cannot refund from state ${escrow.state}`);

      const result = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
        .run(escrow.amount_credits, escrow.hirer_id);
      if (result.changes === 0) throw new Error('Hirer has no active API key — credits cannot be refunded');
      db.prepare(`UPDATE escrows SET state = 'REFUNDED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Admin resolve: split credits between hirer and worker. */
export function resolveEscrow(escrowId: string, workerPct: number): { ok: boolean; error?: string } {
  const db = getDb();
  const pct = Math.max(0, Math.min(100, Math.floor(workerPct)));
  try {
    db.transaction(() => {
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
      if (!escrow) throw new Error('Escrow not found');
      if (!canTransition(escrow.state, 'RESOLVED')) throw new Error(`Cannot resolve from state ${escrow.state}`);

      const workerShare = Math.floor(escrow.amount_credits * pct / 100);
      const hirerShare = escrow.amount_credits - workerShare;
      if (workerShare > 0) {
        const r = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
          .run(workerShare, escrow.worker_id);
        if (r.changes === 0) throw new Error('Worker has no active API key');
      }
      if (hirerShare > 0) {
        const r = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
          .run(hirerShare, escrow.hirer_id);
        if (r.changes === 0) throw new Error('Hirer has no active API key');
      }
      db.prepare(`UPDATE escrows SET state = 'RESOLVED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
    })();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Find expired FUNDED/WORK_IN_PROGRESS escrows past their deadline. */
export function getExpiredEscrows(): Escrow[] {
  return getDb()
    .prepare(`SELECT * FROM escrows WHERE deadline IS NOT NULL AND deadline < datetime('now')
              AND state IN ('FUNDED', 'WORK_IN_PROGRESS')`)
    .all() as Escrow[];
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export function writeAuditLog(params: {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string | null;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(`INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, data_json)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        nanoid(16), params.entityType, params.entityId, params.action,
        params.actorId ?? null,
        params.data ? JSON.stringify(params.data) : null
      );
  } catch (err) {
    logger.error({ err }, 'Failed to write audit log');
  }
}

export function getAuditLog(entityType: string, entityId: string, limit = 200): {
  id: string; action: string; actor_id: string | null; data_json: string | null; timestamp: string;
}[] {
  return getDb()
    .prepare('SELECT id, action, actor_id, data_json, timestamp FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC LIMIT ?')
    .all(entityType, entityId, limit) as { id: string; action: string; actor_id: string | null; data_json: string | null; timestamp: string; }[];
}

// ─── Reputation ───────────────────────────────────────────────────────────────

export function recordReputation(params: {
  agentId: string;
  skillId?: string;
  eventType: string;
  scoreDelta?: number;
  data?: Record<string, unknown>;
}): void {
  try {
    getDb()
      .prepare(`INSERT INTO reputation_events (id, agent_id, skill_id, event_type, score_delta, data_json)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        nanoid(16), params.agentId, params.skillId ?? null,
        params.eventType, params.scoreDelta ?? null,
        params.data ? JSON.stringify(params.data) : null
      );
  } catch (err) {
    logger.error({ err }, 'Failed to record reputation event');
  }
}

export function getReputationScore(agentId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(score_delta), 0) as score FROM reputation_events WHERE agent_id = ?`)
    .get(agentId) as { score: number };
  return Math.round((row.score ?? 0) * 100) / 100;
}

export function getReputationEvents(agentId: string, limit = 50): {
  id: string; skill_id: string | null; event_type: string; score_delta: number | null; data_json: string | null; timestamp: string;
}[] {
  return getDb()
    .prepare('SELECT id, skill_id, event_type, score_delta, data_json, timestamp FROM reputation_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(agentId, limit) as { id: string; skill_id: string | null; event_type: string; score_delta: number | null; data_json: string | null; timestamp: string; }[];
}

// ─── Skills (extended) ────────────────────────────────────────────────────────

export function updateSkillSchemas(id: string, params: {
  version?: string;
  inputSchemaJson?: string;
  outputSchemaJson?: string;
  publishedAt?: string;
  tagsJson?: string;
}): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (params.version !== undefined)       { fields.push('version = ?');          values.push(params.version); }
  if (params.inputSchemaJson !== undefined){ fields.push('input_schema_json = ?'); values.push(params.inputSchemaJson); }
  if (params.outputSchemaJson !== undefined){ fields.push('output_schema_json = ?'); values.push(params.outputSchemaJson); }
  if (params.publishedAt !== undefined)   { fields.push('published_at = ?');     values.push(params.publishedAt); }
  if (params.tagsJson !== undefined)      { fields.push('tags_json = ?');        values.push(params.tagsJson); }
  if (fields.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id = ? AND active = 1`).run(...values);
}

// ─── Skill Metrics ────────────────────────────────────────────────────────────

export function recordSkillMetric(params: {
  skillId: string;
  version: string;
  latencyMs: number;
  success: boolean;
  costCredits: number;
}): void {
  try {
    getDb()
      .prepare(`INSERT INTO skill_metrics (id, skill_id, version, latency_ms, success, cost_credits)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(nanoid(12), params.skillId, params.version, params.latencyMs, params.success ? 1 : 0, params.costCredits);
  } catch (err) {
    logger.error({ err }, 'Failed to record skill metric');
  }
}

export interface SkillMetricsSummary {
  version: string;
  invocations: number;
  successRate: number;
  avgLatencyMs: number;
  avgCostCredits: number;
}

export function getSkillMetricsSummary(skillId: string): SkillMetricsSummary[] {
  return getDb()
    .prepare(`
      SELECT version,
             COUNT(*) as invocations,
             ROUND(AVG(success) * 100, 1) as successRate,
             ROUND(AVG(latency_ms), 0) as avgLatencyMs,
             ROUND(AVG(cost_credits), 2) as avgCostCredits
      FROM skill_metrics WHERE skill_id = ?
      GROUP BY version ORDER BY version DESC
    `)
    .all(skillId) as SkillMetricsSummary[];
}

// ─── Skill Versions / Forking ─────────────────────────────────────────────────

export function recordSkillVersion(params: {
  id: string;
  skillId: string;
  version: string;
  forkedFromSkill?: string;
  forkedFromVersion?: string;
  forkedByAgent?: string;
}): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO skill_versions (id, skill_id, version, forked_from_skill, forked_from_version, forked_by_agent)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(params.id, params.skillId, params.version,
      params.forkedFromSkill ?? null, params.forkedFromVersion ?? null, params.forkedByAgent ?? null);
}

export function promoteChallenger(skillId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(skillId) as Skill | undefined;
    if (!skill?.ab_challenger) return false;

    const challenger = db.prepare('SELECT * FROM skills WHERE id = ?').get(skill.ab_challenger) as Skill | undefined;
    if (!challenger) return false;

    // Swap all content fields from challenger → original
    db.prepare(`UPDATE skills SET prompt_template = ?, description = ?, credit_cost = ?,
      input_schema_json = ?, output_schema_json = ?, tags_json = ?,
      version = ?, ab_challenger = NULL WHERE id = ?`)
      .run(challenger.prompt_template, challenger.description, challenger.credit_cost,
        challenger.input_schema_json, challenger.output_schema_json, challenger.tags_json,
        challenger.version ?? '1.0.0', skillId);

    // Mark challenger as promoted in skill_versions
    db.prepare(`UPDATE skill_versions SET promoted = 1 WHERE skill_id = ?`).run(skill.ab_challenger);

    // Deactivate challenger skill
    db.prepare(`UPDATE skills SET active = 0 WHERE id = ?`).run(skill.ab_challenger);

    return true;
  })();
}

export function getSkillWithAb(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ? AND active = 1').get(id) as Skill | undefined;
}

// ─── Marketplace: Transactions ────────────────────────────────────────────────

export interface Transaction {
  id: string;
  from_agent: string | null;
  to_agent: string | null;
  amount_credits: number;
  type: string;
  skill_id: string | null;
  fee_credits: number;
  metadata_json: string | null;
  created_at: string;
}

export function recordTransaction(params: {
  fromAgent?: string;
  toAgent?: string;
  amountCredits: number;
  type: string;
  skillId?: string;
  feeCredits?: number;
  metadata?: Record<string, unknown>;
}): string {
  const id = nanoid(16);
  getDb()
    .prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, params.fromAgent ?? null, params.toAgent ?? null,
      params.amountCredits, params.type, params.skillId ?? null,
      params.feeCredits ?? 0, params.metadata ? JSON.stringify(params.metadata) : null);
  return id;
}

export function getTransactions(agentKey: string, limit = 50): Transaction[] {
  return getDb()
    .prepare(`SELECT * FROM transactions WHERE from_agent = ? OR to_agent = ? ORDER BY created_at DESC LIMIT ?`)
    .all(agentKey, agentKey, limit) as Transaction[];
}

export function getCreatorStats(authorKey: string): {
  totalEarned: number;
  totalSales: number;
  skillBreakdown: { skillId: string; earned: number; sales: number }[];
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT skill_id, SUM(amount_credits) as earned, COUNT(*) as sales
    FROM transactions
    WHERE to_agent = ? AND type = 'SKILL_SALE'
    GROUP BY skill_id
    LIMIT 1000
  `).all(authorKey) as { skill_id: string; earned: number; sales: number }[];

  const totalEarned = rows.reduce((s, r) => s + r.earned, 0);
  const totalSales  = rows.reduce((s, r) => s + r.sales, 0);
  return {
    totalEarned,
    totalSales,
    skillBreakdown: rows.map(r => ({ skillId: r.skill_id, earned: r.earned, sales: r.sales })),
  };
}

/** Total credits collected by the platform as fees across all SKILL_SALE transactions. */
export function getPlatformRevenue(): { totalFeeCredits: number; totalSales: number } {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(fee_credits), 0) as totalFeeCredits, COUNT(*) as totalSales
              FROM transactions WHERE type = 'SKILL_SALE'`)
    .get() as { totalFeeCredits: number; totalSales: number };
  return row;
}

/**
 * Atomic marketplace purchase:
 * - Deducts total from buyer
 * - Applies platform fee (kept by platform, i.e. not distributed)
 * - Credits seller with amount minus fee
 * - Records transaction
 * Returns transaction id or error
 */
export function marketplacePurchase(params: {
  buyerKey: string;
  sellerKey: string;
  amountCredits: number;
  feePct: number;        // e.g. 0.03 = 3%
  skillId: string;
}): { ok: boolean; txId?: string; error?: string; feeCredits?: number; sellerCredits?: number } {
  const db = getDb();
  if (params.buyerKey === params.sellerKey) {
    return { ok: false, error: 'Cannot purchase your own skill' };
  }

  let txId = '';
  let feeCredits = 0;
  let sellerCredits = 0;
  try {
    db.transaction(() => {
      // Official platform skills are fee-exempt (seller and treasury are both platform-owned)
      feeCredits = params.sellerKey === 'clawhub-official'
        ? 0
        : Math.floor(params.amountCredits * params.feePct);
      // Minimum 1-credit fee for third-party skills priced ≥10 credits (prevents fee rounding to 0)
      if (feeCredits === 0 && params.sellerKey !== 'clawhub-official' && params.amountCredits >= 10) {
        feeCredits = 1;
      }
      sellerCredits = params.amountCredits - feeCredits;

      // Check buyer and seller emails don't match (prevents secondary-key self-purchase)
      const buyerEmail = (db.prepare('SELECT email FROM api_keys WHERE key = ? AND active = 1').get(params.buyerKey) as { email: string } | undefined)?.email;
      const sellerEmail = (db.prepare('SELECT email FROM api_keys WHERE key = ? AND active = 1').get(params.sellerKey) as { email: string } | undefined)?.email;
      if (buyerEmail && sellerEmail && buyerEmail === sellerEmail) {
        throw new Error('Cannot purchase your own skill');
      }

      // Deduct from buyer
      const deducted = db.prepare(
        `UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ?
         WHERE key = ? AND credits >= ? AND active = 1`
      ).run(params.amountCredits, params.amountCredits, params.buyerKey, params.amountCredits);
      if (deducted.changes === 0) throw new Error('Insufficient credits');

      // Credit seller (97%)
      const sellerResult = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1`)
        .run(sellerCredits, params.sellerKey);
      if (sellerResult.changes === 0) throw new Error('Seller has no active API key');

      // Credit treasury with platform fee (3%)
      if (feeCredits > 0) {
        db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = 'clawhub-treasury' AND active = 1`)
          .run(feeCredits);
      }

      txId = nanoid(16);
      db.prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
                  VALUES (?, ?, ?, ?, 'SKILL_SALE', ?, ?, ?)`)
        .run(txId, params.buyerKey, params.sellerKey, params.amountCredits,
          params.skillId, feeCredits, JSON.stringify({ feePct: params.feePct }));
    })();
    return { ok: true, txId, feeCredits, sellerCredits };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Refund a marketplace purchase — reverses buyer deduction, seller credit, and treasury fee.
 * Used when skill execution fails after payment was settled.
 */
export function marketplaceRefund(params: {
  buyerKey: string;
  sellerKey: string;
  amountCredits: number;
  feeCredits: number;
  sellerCredits: number;
  originalTxId: string;
  skillId: string;
  reason: string;
}): { ok: boolean; refundTxId?: string } {
  const db = getDb();
  try {
    let refundTxId = '';
    db.transaction(() => {
      // Refund buyer
      db.prepare(`UPDATE api_keys SET credits = credits + ?, credits_used = credits_used - ? WHERE key = ? AND active = 1`)
        .run(params.amountCredits, params.amountCredits, params.buyerKey);

      // Debit seller — clamp at 0 if insufficient balance, but log a warning
      const sellerBal = db.prepare('SELECT credits FROM api_keys WHERE key = ? AND active = 1')
        .get(params.sellerKey) as { credits: number } | undefined;
      if (!sellerBal || sellerBal.credits < params.sellerCredits) {
        logger.warn({ sellerKey: params.sellerKey.slice(0, 8), requested: params.sellerCredits, available: sellerBal?.credits ?? 0 },
          'marketplaceRefund: seller balance insufficient — partial debit (clamped to 0)');
      }
      db.prepare(`UPDATE api_keys SET credits = MAX(0, credits - ?) WHERE key = ? AND active = 1`)
        .run(params.sellerCredits, params.sellerKey);

      // Debit treasury
      if (params.feeCredits > 0) {
        db.prepare(`UPDATE api_keys SET credits = MAX(0, credits - ?) WHERE key = 'clawhub-treasury' AND active = 1`)
          .run(params.feeCredits);
      }

      refundTxId = nanoid(16);
      db.prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
                  VALUES (?, ?, ?, ?, 'SKILL_REFUND', ?, ?, ?)`)
        .run(refundTxId, params.sellerKey, params.buyerKey, params.amountCredits,
          params.skillId, params.feeCredits, JSON.stringify({ originalTxId: params.originalTxId, reason: params.reason }));
    })();
    return { ok: true, refundTxId };
  } catch {
    return { ok: false };
  }
}

// ─── Marketplace: Staking ─────────────────────────────────────────────────────

export interface Stake {
  id: string;
  agent_key: string;
  skill_id: string | null;
  amount_credits: number;
  staked_at: string;
  unlocks_at: string;
}

export function stakeCredits(params: {
  agentKey: string;
  amountCredits: number;
  skillId?: string;
  lockDays: number;
}): { ok: boolean; stakeId?: string; error?: string } {
  const db = getDb();
  const days = Math.max(1, Math.min(365, Math.floor(params.lockDays)));
  let stakeId = '';
  try {
    db.transaction(() => {
      const deducted = db.prepare(
        `UPDATE api_keys SET credits = credits - ? WHERE key = ? AND credits >= ? AND active = 1`
      ).run(params.amountCredits, params.agentKey, params.amountCredits);
      if (deducted.changes === 0) throw new Error('Insufficient credits');

      stakeId = nanoid(12);
      db.prepare(`INSERT INTO stakes (id, agent_key, skill_id, amount_credits, unlocks_at)
                  VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'))`)
        .run(stakeId, params.agentKey, params.skillId ?? null, params.amountCredits, days);
    })();
    logAudit({ entityType: 'stake', entityId: stakeId, action: 'STAKE_LOCK', actorId: params.agentKey, data: { amount: params.amountCredits, lockDays: days, skillId: params.skillId } });
    return { ok: true, stakeId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function unstakeCredits(stakeId: string, agentKey: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const stake = db.prepare(`SELECT * FROM stakes WHERE id = ? AND agent_key = ?`).get(stakeId, agentKey) as Stake | undefined;
      if (!stake) throw new Error('Stake not found');
      if (new Date(stake.unlocks_at) > new Date()) throw new Error(`Locked until ${stake.unlocks_at}`);

      db.prepare(`DELETE FROM stakes WHERE id = ?`).run(stakeId);
      const result = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1`)
        .run(stake.amount_credits, agentKey);
      if (result.changes === 0) throw new Error('API key inactive — credits cannot be returned');
    })();
    logAudit({ entityType: 'stake', entityId: stakeId, action: 'STAKE_UNLOCK', actorId: agentKey });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getStakes(agentKey: string, limit = 200): Stake[] {
  return getDb()
    .prepare('SELECT * FROM stakes WHERE agent_key = ? ORDER BY staked_at DESC LIMIT ?')
    .all(agentKey, limit) as Stake[];
}

export function getSkillStakeTotal(skillId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount_credits), 0) as total FROM stakes WHERE skill_id = ?')
    .get(skillId) as { total: number };
  return row.total;
}

export function incrementSkillViews(skillId: string): void {
  getDb().prepare('UPDATE skills SET views = views + 1 WHERE id = ?').run(skillId);
}

export function starSkill(skillId: string, agentKey: string): { ok: boolean; alreadyStarred: boolean } {
  const db = getDb();
  const info = db.prepare('INSERT OR IGNORE INTO skill_stars (skill_id, agent_key) VALUES (?, ?)').run(skillId, agentKey);
  if (info.changes === 0) return { ok: false, alreadyStarred: true };
  db.prepare('UPDATE skills SET stars = stars + 1 WHERE id = ?').run(skillId);
  return { ok: true, alreadyStarred: false };
}

export function unstarSkill(skillId: string, agentKey: string): { ok: boolean } {
  const db = getDb();
  const info = db.prepare('DELETE FROM skill_stars WHERE skill_id = ? AND agent_key = ?').run(skillId, agentKey);
  if (info.changes === 0) return { ok: false };
  db.prepare('UPDATE skills SET stars = CASE WHEN stars > 0 THEN stars - 1 ELSE 0 END WHERE id = ?').run(skillId);
  return { ok: true };
}

export function hasStarred(skillId: string, agentKey: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM skill_stars WHERE skill_id = ? AND agent_key = ?').get(skillId, agentKey);
  return !!row;
}

// ─── Skill Security / Reporting ───────────────────────────────────────────────

export function updateSkillSecurityStatus(skillId: string, status: 'UNSCANNED' | 'CLEAN' | 'SUSPICIOUS' | 'FLAGGED' | 'VERIFIED', flags?: string[]): void {
  getDb().prepare(
    `UPDATE skills SET security_status = ?, scanned_at = datetime('now') WHERE id = ?`
  ).run(status, skillId);
  if (flags && flags.length > 0) {
    logger.warn({ skillId, status, flags }, 'Skill security scan flagged');
  }
}

export function reportSkill(skillId: string, reporterKey: string, reason: string): { ok: boolean; error?: string; reportCount?: number } {
  const db = getDb();
  const info = db.prepare(
    `INSERT OR IGNORE INTO skill_reports (skill_id, reporter_key, reason) VALUES (?, ?, ?)`
  ).run(skillId, reporterKey, reason);
  if (info.changes === 0) return { ok: false, error: 'Already reported' };

  const { count } = db.prepare(
    `SELECT COUNT(*) as count FROM skill_reports WHERE skill_id = ?`
  ).get(skillId) as { count: number };

  // Auto-flag at 3+ community reports
  if (count >= 3) {
    db.prepare(`UPDATE skills SET security_status = 'FLAGGED' WHERE id = ? AND security_status NOT IN ('VERIFIED','FLAGGED')`).run(skillId);
  }
  return { ok: true, reportCount: count };
}

export function getSkillReportCount(skillId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM skill_reports WHERE skill_id = ?')
    .get(skillId) as { count: number };
  return row.count;
}

export function getSkillVersionHistory(skillId: string): { id: string; version: string; changelog: string | null; published_at: string }[] {
  return getDb()
    .prepare(`SELECT id, version, changelog, published_at FROM skill_versions WHERE skill_id = ? ORDER BY published_at DESC LIMIT 20`)
    .all(skillId) as { id: string; version: string; changelog: string | null; published_at: string }[];
}

export function getMarketplaceSkills(params: {
  page: number;
  limit: number;
  sort: 'popular' | 'price_asc' | 'price_desc' | 'newest' | 'reputation' | 'stars';
  tags?: string;
  search?: string;
  category?: string;
}): { skills: (Skill & { stake_total: number })[]; total: number } {
  const offset = (params.page - 1) * params.limit;
  const orderMap = {
    popular:     'uses DESC',
    price_asc:   'credit_cost ASC',
    price_desc:  'credit_cost DESC',
    newest:      'published_at DESC',
    reputation:  'uses DESC',
    stars:       'stars DESC',
  };
  if (!(params.sort in orderMap)) throw new Error(`Invalid sort: ${params.sort}`);
  const order = orderMap[params.sort];

  // Only show PUBLISHED skills (status column defaults to 'PUBLISHED' for existing rows)
  let where = `s.public = 1 AND s.active = 1 AND (s.status IS NULL OR s.status = 'PUBLISHED')`;
  const args: unknown[] = [];

  if (params.tags) {
    where += ` AND s.tags_json LIKE ? ESCAPE '\\'`;
    args.push(`%${params.tags.replace(/[%_\\]/g, '\\$&')}%`);
  }
  if (params.category) {
    where += ` AND (s.category = ? OR s.tags_json LIKE ? ESCAPE '\\')`;
    const escaped = params.category.replace(/[%_\\]/g, '\\$&');
    args.push(params.category, `%${escaped}%`);
  }
  if (params.search) {
    const escaped = params.search.replace(/[%_\\]/g, '\\$&');
    where += ` AND (s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')`;
    args.push(`%${escaped}%`, `%${escaped}%`);
  }

  const countRow = getDb()
    .prepare(`SELECT COUNT(*) as n FROM skills s WHERE ${where}`)
    .get(...args) as { n: number };

  const skills = getDb()
    .prepare(`
      SELECT s.*, COALESCE(st.total, 0) as stake_total
      FROM skills s
      LEFT JOIN (SELECT skill_id, SUM(amount_credits) as total FROM stakes GROUP BY skill_id) st
        ON st.skill_id = s.id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `)
    .all(...args, params.limit, offset) as (Skill & { stake_total: number })[];

  return { skills, total: countRow.n };
}

// ─── Payout Requests ──────────────────────────────────────────────────────────

export interface PayoutRequest {
  id: string;
  agent_key: string;
  amount_credits: number;
  usdc_wallet: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'REJECTED';
  notes: string | null;
  created_at: string;
  processed_at: string | null;
}

export function createPayoutRequest(params: {
  agentKey: string;
  amountCredits: number;
  usdcWallet: string;
}): { ok: boolean; id?: string; error?: string } {
  const db = getDb();
  const MIN_CREDITS = 1000;

  return db.transaction(() => {
    // Verify earned enough
    const earned = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM transactions WHERE to_agent = ? AND type = 'SKILL_SALE'`
    ).get(params.agentKey) as { total: number }).total;

    if (earned < MIN_CREDITS) return { ok: false, error: `Minimum ${MIN_CREDITS} credits earned required (you have ${earned})` };

    // Check pending payouts won't exceed earned
    const pendingTotal = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM payout_requests WHERE agent_key = ? AND status IN ('PENDING','PROCESSING')`
    ).get(params.agentKey) as { total: number }).total;

    const alreadyPaid = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM payout_requests WHERE agent_key = ? AND status = 'PAID'`
    ).get(params.agentKey) as { total: number }).total;

    // Subtract staked credits (locked, not liquid)
    const staked = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM stakes WHERE agent_key = ?`
    ).get(params.agentKey) as { total: number }).total;

    // Liquid balance = actual key balance minus pending payouts already requested
    const keyRow = db.prepare(`SELECT credits FROM api_keys WHERE key = ?`).get(params.agentKey) as { credits: number } | undefined;
    const liquidBalance = (keyRow?.credits ?? 0) - pendingTotal - staked;

    const available = Math.min(earned - alreadyPaid - pendingTotal - staked, liquidBalance);
    if (params.amountCredits > available) return { ok: false, error: `Only ${available} credits available for withdrawal (${staked} locked in stakes)` };
    if (params.amountCredits < MIN_CREDITS) return { ok: false, error: `Minimum withdrawal is ${MIN_CREDITS} credits` };

    const id = nanoid(16);
    db.prepare(`INSERT INTO payout_requests (id, agent_key, amount_credits, usdc_wallet) VALUES (?, ?, ?, ?)`)
      .run(id, params.agentKey, params.amountCredits, params.usdcWallet);

    // Atomically hold the credits so they cannot be double-spent while payout is pending.
    // Admin credits them back if the payout is rejected.
    db.prepare(`UPDATE api_keys SET credits = credits - ? WHERE key = ? AND credits >= ?`)
      .run(params.amountCredits, params.agentKey, params.amountCredits);

    return { ok: true, id };
  })();
}

export function getPayoutRequests(agentKey: string, limit = 100, offset = 0): PayoutRequest[] {
  return getDb()
    .prepare(`SELECT * FROM payout_requests WHERE agent_key = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(agentKey, limit, offset) as PayoutRequest[];
}

export function getAllPendingPayouts(): PayoutRequest[] {
  return getDb()
    .prepare(`SELECT * FROM payout_requests WHERE status IN ('PENDING','PROCESSING') ORDER BY created_at ASC`)
    .all() as PayoutRequest[];
}

export function updatePayoutStatus(id: string, status: PayoutRequest['status'], notes?: string): void {
  getDb()
    .prepare(`UPDATE payout_requests SET status = ?, notes = ?, processed_at = datetime('now') WHERE id = ?`)
    .run(status, notes ?? null, id);
}

// ─── Swarms ────────────────────────────────────────────────────────────────────

export interface SwarmTask {
  id: string;
  task: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  agent_key: string;
  sub_tasks_json: string | null;
  results_json: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export function createSwarmTask(agentKey: string, task: string): string {
  const id = nanoid(16);
  getDb().prepare(`INSERT INTO swarms (id, task, agent_key) VALUES (?, ?, ?)`)
    .run(id, task, agentKey);
  return id;
}

export function getSwarmTask(id: string): SwarmTask | undefined {
  return getDb().prepare(`SELECT * FROM swarms WHERE id = ?`).get(id) as SwarmTask | undefined;
}

export function updateSwarmTask(id: string, params: {
  status: SwarmTask['status'];
  subTasks?: unknown[];
  results?: unknown[];
  error?: string;
}): void {
  getDb().prepare(`
    UPDATE swarms SET status = ?, sub_tasks_json = ?, results_json = ?, error = ?,
    completed_at = CASE WHEN ? IN ('COMPLETED','FAILED') THEN datetime('now') ELSE NULL END
    WHERE id = ?
  `).run(
    params.status,
    params.subTasks ? JSON.stringify(params.subTasks) : null,
    params.results ? JSON.stringify(params.results) : null,
    params.error ?? null,
    params.status, id
  );
}

// ─── Agent Usage Stats (OpenClaw gateway) ─────────────────────────────────────

export function getAgentUsageStats(apiKey: string): {
  totalOrchestrations: number;
  totalSkillInvocations: number;
  lastActive: string | null;
} {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN skill_id IS NOT NULL THEN 1 ELSE 0 END) as skill_invocations,
             MAX(timestamp) as last_active
      FROM orchestrations WHERE api_key = ?
    `)
    .get(apiKey) as { total: number; skill_invocations: number; last_active: string | null } | undefined;

  return {
    totalOrchestrations: row?.total ?? 0,
    totalSkillInvocations: row?.skill_invocations ?? 0,
    lastActive: row?.last_active ?? null,
  };
}

// ─── Governance ────────────────────────────────────────────────────────────────

export interface Proposal {
  id: string;
  title: string;
  description: string;
  proposed_by: string;
  status: 'OPEN' | 'CLOSED' | 'EXECUTED';
  votes_for: number;
  votes_against: number;
  created_at: string;
  closes_at: string;
}

export function createProposal(params: {
  title: string;
  description: string;
  proposedBy: string;
  closeDays?: number;
}): string {
  const id = nanoid(16);
  const days = Math.max(1, Math.min(90, Math.floor(params.closeDays ?? 7)));
  getDb().prepare(`
    INSERT INTO proposals (id, title, description, proposed_by, closes_at)
    VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
  `).run(id, params.title, params.description, params.proposedBy, days);
  return id;
}

export function getProposals(status?: string, limit = 50, offset = 0): Proposal[] {
  const db = getDb();
  // Auto-close expired proposals
  db.prepare(`UPDATE proposals SET status = 'CLOSED' WHERE status = 'OPEN' AND closes_at < datetime('now')`).run();
  const where = status ? `WHERE status = ?` : ``;
  return db.prepare(`SELECT * FROM proposals ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...(status ? [status] : []), limit, offset) as Proposal[];
}

export function getProposal(id: string): Proposal | undefined {
  return getDb().prepare(`SELECT * FROM proposals WHERE id = ?`).get(id) as Proposal | undefined;
}

export function castVote(params: {
  proposalId: string;
  voterKey: string;
  direction: 'FOR' | 'AGAINST';
  weight: number;
}): { ok: boolean; error?: string } {
  if (!Number.isFinite(params.weight) || params.weight <= 0) return { ok: false, error: 'Vote weight must be a positive number' };
  const weight = Math.max(0, Math.min(1_000_000, params.weight));

  const db = getDb();
  return db.transaction(() => {
    const proposal = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(params.proposalId) as Proposal | undefined;
    if (!proposal) return { ok: false, error: 'Proposal not found' };
    if (proposal.status !== 'OPEN') return { ok: false, error: 'Proposal is not open for voting' };

    try {
      db.prepare(`INSERT INTO votes (id, proposal_id, voter_key, direction, weight) VALUES (?, ?, ?, ?, ?)`)
        .run(nanoid(16), params.proposalId, params.voterKey, params.direction, weight);
    } catch {
      return { ok: false, error: 'Already voted on this proposal' };
    }

    if (params.direction === 'FOR') {
      db.prepare(`UPDATE proposals SET votes_for = votes_for + ? WHERE id = ?`).run(weight, params.proposalId);
    } else {
      db.prepare(`UPDATE proposals SET votes_against = votes_against + ? WHERE id = ?`).run(weight, params.proposalId);
    }
    return { ok: true };
  })();
}

// ─── Endpoint Health ──────────────────────────────────────────────────────────

export interface EndpointHealth {
  endpoint_id: string;
  provider: string;
  last_checked: string | null;
  last_status: 'up' | 'down' | 'degraded' | 'unknown';
  uptime_pct: number;
  avg_latency_ms: number;
  success_count: number;
  failure_count: number;
  last_error: string | null;
}

export function recordEndpointHealth(params: {
  endpointId: string;
  provider: string;
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  error?: string;
}): void {
  const existing = getDb()
    .prepare('SELECT success_count, failure_count, avg_latency_ms FROM endpoint_health WHERE endpoint_id = ?')
    .get(params.endpointId) as { success_count: number; failure_count: number; avg_latency_ms: number } | undefined;

  const isSuccess = params.status === 'up';
  const successCount = (existing?.success_count ?? 0) + (isSuccess ? 1 : 0);
  const failureCount = (existing?.failure_count ?? 0) + (isSuccess ? 0 : 1);
  const totalChecks = successCount + failureCount;
  const uptimePct = totalChecks > 0 ? (successCount / totalChecks) * 100 : 100;

  // Rolling average latency
  const prevAvg = existing?.avg_latency_ms ?? 0;
  const prevTotal = (existing?.success_count ?? 0) + (existing?.failure_count ?? 0);
  const avgLatency = prevTotal > 0
    ? Math.round((prevAvg * prevTotal + params.latencyMs) / (prevTotal + 1))
    : params.latencyMs;

  getDb().prepare(`
    INSERT INTO endpoint_health (endpoint_id, provider, last_checked, last_status, uptime_pct, avg_latency_ms, success_count, failure_count, last_error)
    VALUES (@endpointId, @provider, datetime('now'), @status, @uptimePct, @avgLatency, @successCount, @failureCount, @error)
    ON CONFLICT(endpoint_id) DO UPDATE SET
      last_checked = datetime('now'),
      last_status = @status,
      uptime_pct = @uptimePct,
      avg_latency_ms = @avgLatency,
      success_count = @successCount,
      failure_count = @failureCount,
      last_error = @error
  `).run({
    endpointId: params.endpointId,
    provider: params.provider,
    status: params.status,
    uptimePct,
    avgLatency,
    successCount,
    failureCount,
    error: params.error ?? null,
  });
}

export function getEndpointHealth(endpointId?: string): EndpointHealth[] {
  if (endpointId) {
    const row = getDb().prepare('SELECT * FROM endpoint_health WHERE endpoint_id = ?').get(endpointId);
    return row ? [row as EndpointHealth] : [];
  }
  return getDb().prepare('SELECT * FROM endpoint_health ORDER BY uptime_pct ASC, last_checked DESC').all() as EndpointHealth[];
}

// ─── Retention / Cleanup ───────────────────────────────────────────────────────

export function cleanupOldAuditLogs(daysToKeep = 90): number {
  const result = getDb()
    .prepare(`DELETE FROM audit_log WHERE timestamp < datetime('now', '-' || ? || ' days')`)
    .run(daysToKeep);
  return result.changes;
}

export function cleanupOldSkillMetrics(daysToKeep = 90): number {
  const result = getDb()
    .prepare(`DELETE FROM skill_metrics WHERE recorded_at < datetime('now', '-' || ? || ' days')`)
    .run(daysToKeep);
  return result.changes;
}

export function cleanupOldSolanaSigs(daysToKeep = 30): number {
  const result = getDb()
    .prepare(`DELETE FROM solana_processed_sigs WHERE processed_at < datetime('now', '-' || ? || ' days')`)
    .run(daysToKeep);
  return result.changes;
}

// ─── Telegram Subscribers (SQLite-backed) ─────────────────────────────────────

export function addTelegramSubscriber(chatId: number): boolean {
  const info = getDb()
    .prepare(`INSERT OR IGNORE INTO telegram_subscribers (chat_id) VALUES (?)`)
    .run(chatId);
  return info.changes > 0;
}

export function removeTelegramSubscriber(chatId: number): boolean {
  const info = getDb()
    .prepare(`DELETE FROM telegram_subscribers WHERE chat_id = ?`)
    .run(chatId);
  return info.changes > 0;
}

export function getTelegramSubscribers(): number[] {
  const rows = getDb()
    .prepare(`SELECT chat_id FROM telegram_subscribers`)
    .all() as { chat_id: number }[];
  return rows.map((r) => r.chat_id);
}

export function isTelegramSubscriber(chatId: number): boolean {
  const row = getDb()
    .prepare(`SELECT 1 FROM telegram_subscribers WHERE chat_id = ?`)
    .get(chatId);
  return !!row;
}