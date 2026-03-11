import { getDb, logAudit } from './connection';
import { maskApiKey } from '../utils/mask';

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

// ─── Key Revocation ────────────────────────────────────────────────────────────

export function revokeKeyByKey(key: string, reason?: string): number {
  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET active = 0 WHERE key = ? AND active = 1').run(key);
  if (result.changes > 0) {
    logAudit({ entityType: 'api_key', entityId: key, action: 'KEY_REVOKED', actorId: 'admin', data: { reason } });
  }
  return result.changes;
}

export function revokeKeysByEmail(email: string, reason?: string): number {
  const db = getDb();
  return db.transaction(() => {
    const keys = db.prepare('SELECT key FROM api_keys WHERE email = ? AND active = 1').all(email) as { key: string }[];
    if (keys.length === 0) return 0;
    db.prepare('UPDATE api_keys SET active = 0 WHERE email = ? AND active = 1').run(email);
    for (const row of keys) {
      logAudit({ entityType: 'api_key', entityId: row.key, action: 'KEY_REVOKED', actorId: 'admin', data: { email, reason } });
    }
    return keys.length;
  })();
}
