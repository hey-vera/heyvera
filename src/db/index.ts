import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger';

const DB_PATH = path.join(process.cwd(), 'data', 'orchestrator.db');
let db: Database.Database;

export function initDb(): void {
  db = new Database(DB_PATH);
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
      llm_provider TEXT
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
      credits_per_month INTEGER NOT NULL DEFAULT 35000,
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_send_log (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orchestrations_timestamp ON orchestrations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(email);
    CREATE INDEX IF NOT EXISTS idx_api_keys_stripe ON api_keys(stripe_session_id);
    CREATE INDEX IF NOT EXISTS idx_email_send_log ON email_send_log(email, type, sent_at);
  `);

  logger.info({ path: DB_PATH }, 'Database initialised');
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
}): void {
  try {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO orchestrations
          (id, timestamp, query, planned_steps, executed_steps, successful_steps,
           cache_hits, total_duration_ms, api_cost, markup, total, success, llm_provider)
         VALUES
          (@id, @timestamp, @query, @plannedSteps, @executedSteps, @successfulSteps,
           @cacheHits, @totalDurationMs, @apiCost, @markup, @total, @success, @llmProvider)`
      )
      .run({ ...entry, success: entry.success ? 1 : 0 });
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
export function getApiKeyByClerkId(clerkUserId: string) {
  return db.prepare(`
    SELECT * FROM api_keys WHERE clerk_user_id = ?
  `).get(clerkUserId) as any;
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

export function topUpCreditsForClerk(clerkUserId: string, credits: number, signature: string) {
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
  const { nanoid } = require('nanoid') as typeof import('nanoid');
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