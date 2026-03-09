import Database from 'better-sqlite3';
import path from 'path';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = path.join(process.cwd(), 'data', 'orchestrator.db');
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
      revenue_share_pct REAL NOT NULL DEFAULT 0.10,
      uses INTEGER NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_stakes_agent ON stakes(agent_key);
    CREATE INDEX IF NOT EXISTS idx_stakes_skill ON stakes(skill_id);

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
    CREATE INDEX IF NOT EXISTS idx_email_send_log ON email_send_log(email, type, sent_at);
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
    } catch { /* column/index may already exist on fresh DBs */ }
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
}

export function topUpCreditsForClerk(clerkUserId: string, credits: number, _signature: string) {
  db.prepare(`
    UPDATE api_keys
    SET credits = credits + ?
    WHERE clerk_user_id = ?
  `).run(credits, clerkUserId);
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
    .prepare('SELECT key FROM api_keys WHERE stripe_session_id = ?')
    .get(sessionId) as { key: string } | undefined;
}

export function deductCredit(key: string, amount: number = 1): boolean {
  const result = getDb()
    .prepare(
      `UPDATE api_keys
       SET credits = credits - @amount,
           credits_used = credits_used + @amount,
           last_used_at = datetime('now')
       WHERE key = @key AND credits >= @amount AND active = 1`
    )
    .run({ key, amount });
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

export function topUpCredits(key: string, credits: number, stripeSessionId?: string): void {
  if (stripeSessionId) {
    getDb()
      .prepare(
        `UPDATE api_keys
         SET credits = credits + ?,
             stripe_session_id = ?,
             amount_paid = amount_paid + ?
         WHERE key = ?`
      )
      .run(credits, stripeSessionId, credits / 1000, key); // credits / 1000 = dollar value
  } else {
    getDb()
      .prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ?')
      .run(credits, key);
  }
}

// ─── Stripe Session Dedup (atomic idempotency) ───────────────────────────────

/** Returns true if this is the first time this session is seen (safe to process). */
export function claimStripeSession(sessionId: string): boolean {
  const result = getDb()
    .prepare('INSERT OR IGNORE INTO stripe_processed_sessions (session_id) VALUES (?)')
    .run(sessionId);
  return result.changes > 0;
}

// ─── Solana Signature Dedup ───────────────────────────────────────────────────

export function isSignatureProcessed(signature: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM solana_processed_sigs WHERE signature = ?').get(signature);
  return row != null;
}

export function markSignatureProcessed(signature: string): void {
  try {
    getDb()
      .prepare('INSERT OR IGNORE INTO solana_processed_sigs (signature) VALUES (?)')
      .run(signature);
  } catch (err) {
    logger.error({ err }, 'Failed to mark signature processed');
  }
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

    // Insert new key copying all financial data
    db.prepare(`
      INSERT INTO api_keys (key, email, credits, credits_used, amount_paid, clerk_user_id, active, stripe_session_id)
      SELECT ?, email, credits, credits_used, amount_paid, clerk_user_id, 1, stripe_session_id
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
}

export function createSkill(params: {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  authorKey: string;
  public: boolean;
  creditCost: number;
}): void {
  getDb()
    .prepare(`INSERT INTO skills (id, name, description, prompt_template, author_key, public, credit_cost)
              VALUES (@id, @name, @description, @promptTemplate, @authorKey, @public, @creditCost)`)
    .run({ ...params, public: params.public ? 1 : 0 });
}

export function getSkill(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id) as Skill | undefined;
}

export function listPublicSkills(): Skill[] {
  return getDb()
    .prepare('SELECT * FROM skills WHERE public = 1 ORDER BY uses DESC, created_at DESC')
    .all() as Skill[];
}

export function getSkillsByAuthor(authorKey: string): Skill[] {
  return getDb()
    .prepare('SELECT * FROM skills WHERE author_key = ? ORDER BY created_at DESC')
    .all(authorKey) as Skill[];
}

export function countSkillsByAuthor(authorKey: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM skills WHERE author_key = ?')
    .get(authorKey) as { count: number };
  return row.count;
}

export function incrementSkillUses(id: string): void {
  getDb().prepare('UPDATE skills SET uses = uses + 1 WHERE id = ?').run(id);
}

export function deleteSkill(id: string, authorKey: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM skills WHERE id = ? AND author_key = ?')
    .run(id, authorKey);
  return result.changes > 0;
}

export function updateSkillVisibility(id: string, authorKey: string, isPublic: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE skills SET public = ? WHERE id = ? AND author_key = ?')
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
    .prepare('SELECT id FROM discovery_cache')
    .all() as { id: string }[])
    .map(r => r.id);
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

export function listEscrowsForUser(clerkUserId: string): Escrow[] {
  return getDb()
    .prepare('SELECT * FROM escrows WHERE hirer_id = ? OR worker_id = ? ORDER BY created_at DESC')
    .all(clerkUserId, clerkUserId) as Escrow[];
}

/** Transition escrow state. Returns false if transition is not allowed. */
export function transitionEscrow(id: string, to: EscrowState, completedAt?: string): boolean {
  const db = getDb();
  const escrow = db.prepare('SELECT state FROM escrows WHERE id = ?').get(id) as { state: EscrowState } | undefined;
  if (!escrow || !canTransition(escrow.state, to)) return false;
  db.prepare(`UPDATE escrows SET state = ?, completed_at = ? WHERE id = ?`)
    .run(to, completedAt ?? null, id);
  return true;
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
  return db.transaction(() => {
    const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
    if (!escrow) return { ok: false, error: 'Escrow not found' };
    if (!canTransition(escrow.state, 'COMPLETED')) return { ok: false, error: `Cannot release from state ${escrow.state}` };

    db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
      .run(escrow.amount_credits, escrow.worker_id);
    db.prepare(`UPDATE escrows SET state = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
    return { ok: true };
  })();
}

/** Refund escrow to hirer (timeout / cancellation). */
export function refundEscrow(escrowId: string): { ok: boolean; error?: string } {
  const db = getDb();
  return db.transaction(() => {
    const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
    if (!escrow) return { ok: false, error: 'Escrow not found' };
    if (!canTransition(escrow.state, 'REFUNDED')) return { ok: false, error: `Cannot refund from state ${escrow.state}` };

    db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
      .run(escrow.amount_credits, escrow.hirer_id);
    db.prepare(`UPDATE escrows SET state = 'REFUNDED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
    return { ok: true };
  })();
}

/** Admin resolve: split credits between hirer and worker. */
export function resolveEscrow(escrowId: string, workerPct: number): { ok: boolean; error?: string } {
  const db = getDb();
  return db.transaction(() => {
    const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId) as Escrow | undefined;
    if (!escrow) return { ok: false, error: 'Escrow not found' };
    if (!canTransition(escrow.state, 'RESOLVED')) return { ok: false, error: `Cannot resolve from state ${escrow.state}` };

    const workerShare = Math.floor(escrow.amount_credits * workerPct / 100);
    const hirerShare = escrow.amount_credits - workerShare;
    if (workerShare > 0) {
      db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
        .run(workerShare, escrow.worker_id);
    }
    if (hirerShare > 0) {
      db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE clerk_user_id = ? AND active = 1`)
        .run(hirerShare, escrow.hirer_id);
    }
    db.prepare(`UPDATE escrows SET state = 'RESOLVED', completed_at = datetime('now') WHERE id = ?`).run(escrowId);
    return { ok: true };
  })();
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

export function getAuditLog(entityType: string, entityId: string): {
  id: string; action: string; actor_id: string | null; data_json: string | null; timestamp: string;
}[] {
  return getDb()
    .prepare('SELECT id, action, actor_id, data_json, timestamp FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp ASC')
    .all(entityType, entityId) as { id: string; action: string; actor_id: string | null; data_json: string | null; timestamp: string; }[];
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
  getDb().prepare(`UPDATE skills SET ${fields.join(', ')} WHERE id = ?`).run(...values);
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

    // Swap prompt template and version from challenger → original
    db.prepare(`UPDATE skills SET prompt_template = ?, version = ?, ab_challenger = NULL WHERE id = ?`)
      .run(challenger.prompt_template, challenger.version ?? '1.0.0', skillId);

    // Mark challenger as promoted in skill_versions
    db.prepare(`UPDATE skill_versions SET promoted = 1 WHERE skill_id = ?`).run(skill.ab_challenger);

    // Deactivate challenger skill
    db.prepare(`UPDATE skills SET active = 0 WHERE id = ?`).run(skill.ab_challenger);

    return true;
  })();
}

export function getSkillWithAb(id: string): Skill | undefined {
  return getDb().prepare('SELECT * FROM skills WHERE id = ?').get(id) as Skill | undefined;
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
  return db.transaction(() => {
    const feeCredits = Math.floor(params.amountCredits * params.feePct);
    const sellerCredits = params.amountCredits - feeCredits;

    // Deduct from buyer
    const deducted = db.prepare(
      `UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ?
       WHERE key = ? AND credits >= ? AND active = 1`
    ).run(params.amountCredits, params.amountCredits, params.buyerKey, params.amountCredits);
    if (deducted.changes === 0) return { ok: false, error: 'Insufficient credits' };

    // Credit seller (fee stays on platform — not redistributed in v1)
    db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1`)
      .run(sellerCredits, params.sellerKey);

    const txId = nanoid(16);
    db.prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
                VALUES (?, ?, ?, ?, 'PURCHASE', ?, ?, ?)`)
      .run(txId, params.buyerKey, params.sellerKey, params.amountCredits,
        params.skillId, feeCredits, JSON.stringify({ feePct: params.feePct }));

    return { ok: true, txId, feeCredits, sellerCredits };
  })();
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
  return db.transaction(() => {
    const deducted = db.prepare(
      `UPDATE api_keys SET credits = credits - ? WHERE key = ? AND credits >= ? AND active = 1`
    ).run(params.amountCredits, params.agentKey, params.amountCredits);
    if (deducted.changes === 0) return { ok: false, error: 'Insufficient credits' };

    const stakeId = nanoid(12);
    db.prepare(`INSERT INTO stakes (id, agent_key, skill_id, amount_credits, unlocks_at)
                VALUES (?, ?, ?, ?, datetime('now', ?))`)
      .run(stakeId, params.agentKey, params.skillId ?? null, params.amountCredits,
        `+${params.lockDays} days`);
    return { ok: true, stakeId };
  })();
}

export function unstakeCredits(stakeId: string, agentKey: string): { ok: boolean; error?: string } {
  const db = getDb();
  return db.transaction(() => {
    const stake = db.prepare(`SELECT * FROM stakes WHERE id = ? AND agent_key = ?`).get(stakeId, agentKey) as Stake | undefined;
    if (!stake) return { ok: false, error: 'Stake not found' };
    if (new Date(stake.unlocks_at) > new Date()) return { ok: false, error: `Locked until ${stake.unlocks_at}` };

    db.prepare(`DELETE FROM stakes WHERE id = ?`).run(stakeId);
    db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1`)
      .run(stake.amount_credits, agentKey);
    return { ok: true };
  })();
}

export function getStakes(agentKey: string): Stake[] {
  return getDb()
    .prepare('SELECT * FROM stakes WHERE agent_key = ? ORDER BY staked_at DESC')
    .all(agentKey) as Stake[];
}

export function getSkillStakeTotal(skillId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount_credits), 0) as total FROM stakes WHERE skill_id = ?')
    .get(skillId) as { total: number };
  return row.total;
}

export function getMarketplaceSkills(params: {
  page: number;
  limit: number;
  sort: 'popular' | 'price_asc' | 'price_desc' | 'newest' | 'reputation';
  tags?: string;
  search?: string;
}): { skills: (Skill & { stake_total: number })[]; total: number } {
  const offset = (params.page - 1) * params.limit;
  const orderMap = {
    popular:     'uses DESC',
    price_asc:   'credit_cost ASC',
    price_desc:  'credit_cost DESC',
    newest:      'published_at DESC',
    reputation:  'uses DESC',
  };
  const order = orderMap[params.sort] ?? 'uses DESC';

  let where = `s.public = 1`;
  const args: unknown[] = [];

  if (params.tags) {
    where += ` AND s.tags_json LIKE ?`;
    args.push(`%${params.tags}%`);
  }
  if (params.search) {
    where += ` AND (s.name LIKE ? OR s.description LIKE ?)`;
    args.push(`%${params.search}%`, `%${params.search}%`);
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