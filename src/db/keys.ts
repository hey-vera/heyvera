import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';

// ─── Solana / Clerk helpers ────────────────────────────────────────────────────

export function getApiKeyByClerkId(clerkUserId: string): {
  key: string; email: string; credits: number; amount_paid: number;
} | undefined {
  return getDb()
    .prepare('SELECT key, email, credits, amount_paid FROM api_keys WHERE clerk_user_id = ? AND active = 1')
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
  getDb().prepare(`
    INSERT INTO api_keys (key, email, credits, credits_used, created_at, stripe_session_id, clerk_user_id, amount_paid)
    VALUES (?, ?, ?, 0, datetime('now'), ?, ?, ?)
  `).run(opts.key, opts.email, opts.credits, opts.solanaSignature, opts.clerkUserId, opts.amountPaid);
  logAudit({ entityType: 'api_key', entityId: opts.key, action: 'CREDIT_GRANT', actorId: opts.clerkUserId, data: { credits: opts.credits, amountPaid: opts.amountPaid, via: 'usdc' } });
}

export function topUpCreditsForClerk(clerkUserId: string, credits: number, _signature: string, amountPaid = 0): { ok: boolean } {
  if (credits <= 0) throw new Error(`topUpCreditsForClerk: credits must be positive, got ${credits}`);
  const result = getDb().prepare(`
    UPDATE api_keys
    SET credits = credits + ?,
        amount_paid = amount_paid + ?
    WHERE key = (
      SELECT key FROM api_keys WHERE clerk_user_id = ? AND active = 1
      ORDER BY created_at DESC LIMIT 1
    )
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
  amount_paid: number;
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

export function getApiKeyAmountPaid(key: string): number {
  const row = getDb()
    .prepare('SELECT amount_paid FROM api_keys WHERE key = ? AND active = 1')
    .get(key) as { amount_paid: number } | undefined;
  return row?.amount_paid ?? 0;
}

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

    // Transfer stakes from old key to new key (prevents orphaned locked credits)
    db.prepare('UPDATE stakes SET agent_key = ? WHERE agent_key = ?').run(newKey, row.key);

    // Transfer pending payout requests to new key
    db.prepare(`UPDATE payout_requests SET agent_key = ? WHERE agent_key = ? AND status IN ('PENDING','PROCESSING')`)
      .run(newKey, row.key);

    // Cascade-deactivate any delegated sub-keys of the old key
    db.prepare('UPDATE api_keys SET active = 0 WHERE key IN (SELECT child_key FROM delegated_keys WHERE parent_key = ?)').run(row.key);
    db.prepare('UPDATE delegated_keys SET active = 0 WHERE parent_key = ?').run(row.key);

    // Deactivate old key
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(row.key);

    return { oldKey: row.key, credits: row.credits, email: row.email };
  })();
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

export function hasAppliedReferral(referreeKey: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM referral_uses WHERE referree_key = ?').get(referreeKey);
  return row != null;
}

export function applyReferralCode(
  referreeKey: string,
  code: string,
  ownerKey: string,
  bonusReceiver: number,
  bonusOwner: number,
): 'ok' | 'already_used' | 'self_referral' {
  if (referreeKey === ownerKey) return 'self_referral';
  const db = getDb();
  return db.transaction(() => {
    const already = db.prepare('SELECT 1 FROM referral_uses WHERE referree_key = ?').get(referreeKey);
    if (already) return 'already_used';

    db.prepare('INSERT INTO referral_uses (referree_key, code) VALUES (?, ?)').run(referreeKey, code);
    db.prepare('UPDATE referral_codes SET uses = uses + 1 WHERE code = ?').run(code);

    if (bonusReceiver > 0) {
      db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1').run(bonusReceiver, referreeKey);
      logAudit({ entityType: 'api_key', entityId: referreeKey, action: 'CREDIT_GRANT', actorId: 'system', data: { credits: bonusReceiver, via: 'referral_receiver', code } });
    }
    if (bonusOwner > 0) {
      db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1').run(bonusOwner, ownerKey);
      logAudit({ entityType: 'api_key', entityId: ownerKey, action: 'CREDIT_GRANT', actorId: 'system', data: { credits: bonusOwner, via: 'referral_owner', code } });
    }

    return 'ok';
  })();
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
    .prepare("SELECT subscription_id, status, credits_per_month FROM subscriptions WHERE api_key = ? AND status = 'active' LIMIT 1")
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

// ─── Key / Clerk helpers ───────────────────────────────────────────────────────

export function getClerkIdForKey(key: string): string | undefined {
  const row = getDb()
    .prepare('SELECT clerk_user_id FROM api_keys WHERE key = ?')
    .get(key) as { clerk_user_id: string | null } | undefined;
  return row?.clerk_user_id ?? undefined;
}

export function linkKeyToClerkUser(key: string, clerkUserId: string): void {
  getDb()
    .prepare('UPDATE api_keys SET clerk_user_id = ? WHERE key = ?')
    .run(clerkUserId, key);
}

export function getKeyStats(key: string): { queriesToday: number; queriesTotal: number; lastUsed: string | null } {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const total = db
    .prepare('SELECT COUNT(*) as count FROM orchestrations WHERE api_key = ?')
    .get(key) as { count: number };

  // Use range comparison instead of DATE() function — allows the idx_orchestrations_timestamp index to be used.
  // DATE(timestamp) wraps every row in a function call, preventing index use on large tables.
  const todayCount = db
    .prepare('SELECT COUNT(*) as count FROM orchestrations WHERE api_key = ? AND timestamp >= ? AND timestamp < ?')
    .get(key, today + 'T00:00:00.000Z', today + 'T23:59:59.999Z') as { count: number };

  const lastUsed = db
    .prepare('SELECT last_used_at FROM api_keys WHERE key = ?')
    .get(key) as { last_used_at: string | null } | undefined;

  return {
    queriesToday: todayCount.count,
    queriesTotal: total.count,
    lastUsed: lastUsed?.last_used_at ?? null,
  };
}

export function getActiveUserCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as activeUsers FROM api_keys WHERE active = 1 AND credits >= 1 AND last_used_at >= datetime('now', '-30 days')`)
    .get() as { activeUsers: number };
  return row.activeUsers;
}

export function getUsageStats(key: string): {
  tasks: { total: number; completed: number; failed: number; creditsSpent: number };
  marketplace: { purchases: number; creditsSpent: number };
} {
  const db = getDb();

  const taskStats = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
           COALESCE(SUM(cost_credits), 0) as creditsSpent
    FROM tasks WHERE requester_key = ?
  `).get(key) as { total: number; completed: number; failed: number; creditsSpent: number } | undefined;

  const skillStats = db.prepare(`
    SELECT COUNT(*) as total, COALESCE(SUM(amount_credits), 0) as totalSpent
    FROM transactions WHERE from_agent = ? AND type = 'SKILL_SALE'
  `).get(key) as { total: number; totalSpent: number } | undefined;

  return {
    tasks: {
      total: taskStats?.total ?? 0,
      completed: taskStats?.completed ?? 0,
      failed: taskStats?.failed ?? 0,
      creditsSpent: taskStats?.creditsSpent ?? 0,
    },
    marketplace: {
      purchases: skillStats?.total ?? 0,
      creditsSpent: skillStats?.totalSpent ?? 0,
    },
  };
}
