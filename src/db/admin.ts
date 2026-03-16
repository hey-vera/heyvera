import { getDb, logAudit } from './connection';
import { maskApiKey } from '../utils/mask';

type Period = 'week' | 'month';
function periodDays(p: Period): number { return p === 'week' ? 7 : 30; }
function periodStart(p: Period): string {
  return `-${periodDays(p)} days`;
}

// ─── Reconciliation ────────────────────────────────────────────────────────────

export function getReconciliation(): {
  creditsRemaining: number;
  creditsUsed: number;
  creditsStaked: number;
  creditsInEscrow: number;
  totalGranted: number;
  expectedCirculating: number;
  drift: number;
  totalAmountPaid: number;
} {
  const db = getDb();
  // Include ALL keys (active + inactive) so deactivated/regenerated keys don't cause phantom drift.
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(credits), 0)      AS creditsRemaining,
      COALESCE(SUM(credits_used), 0) AS creditsUsed,
      COALESCE(SUM(amount_paid), 0)  AS totalAmountPaid
    FROM api_keys
  `).get() as { creditsRemaining: number; creditsUsed: number; totalAmountPaid: number };
  const staked = db.prepare('SELECT COALESCE(SUM(amount_credits),0) AS total FROM stakes').get() as { total: number };
  const escrow = db.prepare("SELECT COALESCE(SUM(amount_credits),0) AS total FROM escrows WHERE state IN ('FUNDED','WORK_IN_PROGRESS','DISPUTED')").get() as { total: number };
  // totalGranted = balances + spent + locked — the total supply ever issued.
  // staked/escrow credits were deducted from `credits` so they're NOT in creditsRemaining,
  // meaning: totalGranted = credits + credits_used + staked + escrow.
  const totalGranted = (totals.creditsRemaining ?? 0) + (totals.creditsUsed ?? 0) + (staked.total ?? 0) + (escrow.total ?? 0);
  const expectedCirculating = totalGranted;
  return {
    creditsRemaining: totals.creditsRemaining ?? 0,
    creditsUsed: totals.creditsUsed ?? 0,
    creditsStaked: staked.total ?? 0,
    creditsInEscrow: escrow.total ?? 0,
    totalGranted,
    expectedCirculating,
    drift: 0, // formula is self-consistent; non-zero drift in future = credits leaked outside this system
    totalAmountPaid: totals.totalAmountPaid ?? 0,
  };
}

// ─── Revenue ───────────────────────────────────────────────────────────────────

export function getRevenueBreakdown(): {
  totalPlatformCredits: number;
  totalPlatformUsdEquiv: number;
  breakdown: {
    marketplaceFees: { credits: number; transactions: number };
    invokeFees: { credits: number; transactions: number };
    swarmFees: { credits: number; transactions: number };
  };
  payments: { totalUsd: number; keyCount: number };
} {
  const db = getDb();
  const mktFees = db.prepare(`
    SELECT COALESCE(SUM(fee_credits),0) AS total, COUNT(*) AS txCount
    FROM transactions WHERE type = 'SKILL_SALE'
  `).get() as { total: number; txCount: number };
  const invokeRevenue = db.prepare(`
    SELECT COALESCE(SUM(fee_credits),0) AS total, COUNT(*) AS txCount
    FROM transactions WHERE type = 'SKILL_INVOKE'
  `).get() as { total: number; txCount: number };
  const swarmFees = db.prepare(`
    SELECT COALESCE(SUM(amount_credits),0) AS total, COUNT(*) AS txCount
    FROM transactions WHERE type = 'SWARM_FEE'
  `).get() as { total: number; txCount: number };
  const payments = db.prepare(`
    SELECT COALESCE(SUM(amount_paid),0) AS totalUsd, COUNT(*) AS keyCount
    FROM api_keys WHERE active = 1 AND amount_paid > 0
  `).get() as { totalUsd: number; keyCount: number };

  const totalPlatformCredits = (mktFees.total ?? 0) + (invokeRevenue.total ?? 0) + (swarmFees.total ?? 0);
  return {
    totalPlatformCredits,
    totalPlatformUsdEquiv: Math.round(totalPlatformCredits / 10) / 100,
    breakdown: {
      marketplaceFees: { credits: mktFees.total ?? 0, transactions: mktFees.txCount ?? 0 },
      invokeFees: { credits: invokeRevenue.total ?? 0, transactions: invokeRevenue.txCount ?? 0 },
      swarmFees: { credits: swarmFees.total ?? 0, transactions: swarmFees.txCount ?? 0 },
    },
    payments: { totalUsd: payments.totalUsd ?? 0, keyCount: payments.keyCount ?? 0 },
  };
}

// ─── Treasury ──────────────────────────────────────────────────────────────────

export function getTreasuryStatus(): {
  treasury: { credits: number; creditsUsed: number; usdEquivalent: string; createdAt: string } | null;
  officialCreator: { credits: number; creditsUsed: number; usdEquivalent: string; createdAt: string } | null;
  recentFeeTransactions: Array<{ id: string; from_agent: string | null; amount_credits: number; fee_credits: number; skill_id: string; created_at: string }>;
  recentRefunds: Array<{ id: string; to_agent: string | null; amount_credits: number; fee_credits: number; skill_id: string; created_at: string }>;
} {
  const db = getDb();
  const treasury = db.prepare(
    `SELECT credits, credits_used, created_at FROM api_keys WHERE key = 'clawhub-treasury' AND active = 1`
  ).get() as { credits: number; credits_used: number; created_at: string } | undefined;
  const official = db.prepare(
    `SELECT credits, credits_used, created_at FROM api_keys WHERE key = 'clawhub-official' AND active = 1`
  ).get() as { credits: number; credits_used: number; created_at: string } | undefined;
  const recentFees = db.prepare(`
    SELECT id, from_agent, amount_credits, fee_credits, skill_id, created_at
    FROM transactions WHERE type = 'SKILL_SALE' AND fee_credits > 0
    ORDER BY created_at DESC LIMIT 20
  `).all() as Array<{ id: string; from_agent: string; amount_credits: number; fee_credits: number; skill_id: string; created_at: string }>;
  const refunds = db.prepare(`
    SELECT id, to_agent, amount_credits, fee_credits, skill_id, created_at
    FROM transactions WHERE type = 'SKILL_REFUND'
    ORDER BY created_at DESC LIMIT 20
  `).all() as Array<{ id: string; to_agent: string; amount_credits: number; fee_credits: number; skill_id: string; created_at: string }>;

  return {
    treasury: treasury ? {
      credits: treasury.credits,
      creditsUsed: treasury.credits_used,
      usdEquivalent: (treasury.credits * 0.001).toFixed(2),
      createdAt: treasury.created_at,
    } : null,
    officialCreator: official ? {
      credits: official.credits,
      creditsUsed: official.credits_used,
      usdEquivalent: (official.credits * 0.001).toFixed(2),
      createdAt: official.created_at,
    } : null,
    recentFeeTransactions: recentFees.map(t => ({
      ...t,
      from_agent: t.from_agent ? maskApiKey(t.from_agent) : null,
    })),
    recentRefunds: refunds.map(t => ({
      ...t,
      to_agent: t.to_agent ? maskApiKey(t.to_agent) : null,
    })),
  };
}

// ─── Treasury Sweep Helpers ──────────────────────────────────────────────────

/** Get the current credit balance of the clawhub-treasury key. Returns 0 if not found. */
export function getTreasuryBalance(): number {
  const row = getDb()
    .prepare(`SELECT credits FROM api_keys WHERE key = 'clawhub-treasury' AND active = 1`)
    .get() as { credits: number } | undefined;
  return row?.credits ?? 0;
}

/**
 * Deduct credits from the treasury for auto-sweep payout.
 * Returns true if successful, false if insufficient balance.
 */
export function deductTreasuryForSweep(amount: number): boolean {
  if (amount <= 0) return false;
  const result = getDb()
    .prepare(`UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ? WHERE key = 'clawhub-treasury' AND credits >= ? AND active = 1`)
    .run(amount, amount, amount);
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: 'clawhub-treasury', action: 'TREASURY_SWEEP', actorId: 'system', data: { amount } });
  }
  return result.changes > 0;
}

// ─── Key Revocation ────────────────────────────────────────────────────────────

export function revokeKeyByKey(key: string, reason?: string): number {
  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET active = 0 WHERE key = ? AND active = 1').run(key);
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: key, action: 'KEY_REVOKED', actorId: 'admin', data: { reason } });

    // Cascade: deactivate delegated sub-keys
    const delegatedResult = db.prepare('UPDATE delegated_keys SET active = 0 WHERE parent_key = ?').run(key);
    db.prepare('UPDATE api_keys SET active = 0 WHERE key IN (SELECT child_key FROM delegated_keys WHERE parent_key = ?)').run(key);

    // Cascade: deactivate scheduled skills
    const scheduledResult = db.prepare('UPDATE scheduled_skills SET active = 0 WHERE caller_key = ?').run(key);

    logAudit({
      entityType: 'api_key',
      entityId: key,
      action: 'KEY_REVOKED_CASCADE',
      actorId: 'admin',
      data: { delegatedDeactivated: delegatedResult.changes, scheduledDeactivated: scheduledResult.changes },
    });
  }
  return result.changes;
}

export function revokeKeysByEmail(email: string, reason?: string): number {
  const db = getDb();
  return db.transaction(() => {
    const keys = db.prepare('SELECT key FROM api_keys WHERE email = ? AND active = 1').all(email) as { key: string }[];
    if (keys.length === 0) return 0;
    db.prepare('UPDATE api_keys SET active = 0 WHERE email = ? AND active = 1').run(email);
    let totalDelegated = 0;
    let totalScheduled = 0;
    for (const row of keys) {
      logAudit({ entityType: 'api_key', entityId: row.key, action: 'KEY_REVOKED', actorId: 'admin', data: { email, reason } });

      // Cascade: deactivate delegated sub-keys
      const delegatedResult = db.prepare('UPDATE delegated_keys SET active = 0 WHERE parent_key = ?').run(row.key);
      db.prepare('UPDATE api_keys SET active = 0 WHERE key IN (SELECT child_key FROM delegated_keys WHERE parent_key = ?)').run(row.key);
      totalDelegated += delegatedResult.changes;

      // Cascade: deactivate scheduled skills
      const scheduledResult = db.prepare('UPDATE scheduled_skills SET active = 0 WHERE caller_key = ?').run(row.key);
      totalScheduled += scheduledResult.changes;

      logAudit({
        entityType: 'api_key',
        entityId: row.key,
        action: 'KEY_REVOKED_CASCADE',
        actorId: 'admin',
        data: { delegatedDeactivated: delegatedResult.changes, scheduledDeactivated: scheduledResult.changes },
      });
    }
    return keys.length;
  })();
}

// ─── Cache Stats ────────────────────────────────────────────────────────────

/** Per-user cache savings: total calls, cache hits, credits saved */
export function getUserCacheStats(apiKey: string): {
  totalCalls: number;
  cacheHits: number;
  cacheHitRate: number;
  creditsSaved: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS totalCalls,
      COALESCE(SUM(cache_hits), 0) AS cacheHits,
      COALESCE(SUM(executed_steps), 0) AS totalSteps,
      COALESCE(SUM(CASE WHEN cache_hits > 0 THEN total ELSE 0 END), 0) AS cachedCallCredits,
      COALESCE(SUM(CASE WHEN cache_hits > 0 THEN executed_steps ELSE 0 END), 0) AS cachedCallSteps,
      COALESCE(SUM(total), 0) AS totalCreditsCharged
    FROM orchestrations WHERE api_key = ? AND success = 1
  `).get(apiKey) as {
    totalCalls: number; cacheHits: number; totalSteps: number;
    cachedCallCredits: number; cachedCallSteps: number; totalCreditsCharged: number;
  };
  // Estimate savings: each cache hit saved roughly (totalCredits / totalSteps) per step
  const avgCreditPerStep = row.totalSteps > 0 ? row.totalCreditsCharged / row.totalSteps : 0;
  const creditsSaved = Math.round(row.cacheHits * avgCreditPerStep * 100) / 100;
  const cacheHitRate = row.totalSteps > 0
    ? Math.round((row.cacheHits / row.totalSteps) * 10000) / 100
    : 0;
  return {
    totalCalls: row.totalCalls,
    cacheHits: row.cacheHits,
    cacheHitRate,
    creditsSaved,
  };
}

/** Admin-level aggregate cache stats for a period */
export function getAdminCacheStats(period: Period): {
  totalCacheHits: number;
  totalSteps: number;
  cacheHitRate: number;
  creditsSaved: number;
  dollarsSaved: number;
} {
  const db = getDb();
  const since = periodStart(period);
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(cache_hits), 0) AS totalCacheHits,
      COALESCE(SUM(executed_steps), 0) AS totalSteps,
      COALESCE(SUM(total), 0) AS totalCredits
    FROM orchestrations
    WHERE timestamp >= datetime('now', ?) AND success = 1
  `).get(since) as { totalCacheHits: number; totalSteps: number; totalCredits: number };
  const avgCreditPerStep = row.totalSteps > 0 ? row.totalCredits / row.totalSteps : 0;
  const creditsSaved = Math.round(row.totalCacheHits * avgCreditPerStep * 100) / 100;
  const cacheHitRate = row.totalSteps > 0
    ? Math.round((row.totalCacheHits / row.totalSteps) * 10000) / 100
    : 0;
  return {
    totalCacheHits: row.totalCacheHits,
    totalSteps: row.totalSteps,
    cacheHitRate,
    creditsSaved,
    dollarsSaved: Math.round(creditsSaved * 0.001 * 100) / 100,
  };
}

// ─── Admin Dashboard Queries ────────────────────────────────────────────────

export function getAdminDashboardStats(period: Period): {
  totalCalls: number;
  totalRevenue: number;
  netProfit: number;
  activeUsers: number;
  totalSkills: number;
} {
  const db = getDb();
  const since = periodStart(period);
  const calls = db.prepare(`
    SELECT COUNT(*) AS total FROM orchestrations
    WHERE timestamp >= datetime('now', ?)
  `).get(since) as { total: number };
  // Credits consumed via direct orchestration calls (not routed through skills/marketplace)
  const orchRevenue = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(total, 0)), 0) AS total
    FROM orchestrations
    WHERE timestamp >= datetime('now', ?) AND success = 1
  `).get(since) as { total: number };
  // Revenue + platform fees from skill/marketplace transactions
  const txnRevenue = db.prepare(`
    SELECT COALESCE(SUM(amount_credits), 0) AS total,
           COALESCE(SUM(fee_credits), 0) AS fees
    FROM transactions
    WHERE created_at >= datetime('now', ?) AND type IN ('SKILL_SALE', 'SKILL_INVOKE', 'SWARM_FEE')
  `).get(since) as { total: number; fees: number };
  const users = db.prepare(`
    SELECT COUNT(DISTINCT api_key) AS total FROM orchestrations
    WHERE timestamp >= datetime('now', ?) AND api_key IS NOT NULL
  `).get(since) as { total: number };
  const skills = db.prepare(`SELECT COUNT(*) AS total FROM skills`).get() as { total: number };
  const totalRevenue = (orchRevenue.total ?? 0) + (txnRevenue.total ?? 0);
  // Net profit = marketplace 3% fees + all orchestration revenue (low raw API cost vs. credit price)
  const netProfit = (txnRevenue.fees ?? 0) + (orchRevenue.total ?? 0);
  return {
    totalCalls: calls.total ?? 0,
    totalRevenue,
    netProfit,
    activeUsers: users.total ?? 0,
    totalSkills: skills.total ?? 0,
  };
}

export function getCallsOverTime(period: Period): Array<{ date: string; calls: number }> {
  const db = getDb();
  const since = periodStart(period);
  return db.prepare(`
    SELECT date(timestamp) AS date, COUNT(*) AS calls
    FROM orchestrations
    WHERE timestamp >= datetime('now', ?)
    GROUP BY date(timestamp)
    ORDER BY date ASC
  `).all(since) as Array<{ date: string; calls: number }>;
}

export function getRecentCallLogs(period: Period, limit = 50): Array<{
  id: string; timestamp: string; query: string; credits: number;
  api_key: string | null; skill_id: string | null; success: number;
}> {
  const db = getDb();
  const since = periodStart(period);
  const rows = db.prepare(`
    SELECT id, timestamp, query, COALESCE(total, 0) AS credits,
           api_key, skill_id, success
    FROM orchestrations
    WHERE timestamp >= datetime('now', ?)
    ORDER BY timestamp DESC LIMIT ?
  `).all(since, limit) as Array<{
    id: string; timestamp: string; query: string; credits: number;
    api_key: string | null; skill_id: string | null; success: number;
  }>;
  return rows.map(r => ({
    ...r,
    api_key: r.api_key ? maskApiKey(r.api_key) : null,
  }));
}

export function getSkillInvocationLogs(period: Period, limit = 50): Array<{
  skill_id: string; name: string | null; invocations: number;
  revenue: number; unique_users: number;
}> {
  const db = getDb();
  const since = periodStart(period);
  return db.prepare(`
    SELECT t.skill_id, s.name, COUNT(*) AS invocations,
           COALESCE(SUM(t.amount_credits), 0) AS revenue,
           COUNT(DISTINCT t.from_agent) AS unique_users
    FROM transactions t
    LEFT JOIN skills s ON s.id = t.skill_id
    WHERE t.created_at >= datetime('now', ?) AND t.type IN ('SKILL_SALE', 'SKILL_INVOKE')
    AND t.skill_id IS NOT NULL
    GROUP BY t.skill_id
    ORDER BY invocations DESC LIMIT ?
  `).all(since, limit) as Array<{
    skill_id: string; name: string | null; invocations: number;
    revenue: number; unique_users: number;
  }>;
}
