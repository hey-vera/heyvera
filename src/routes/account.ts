import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { getDb, logAudit, getHardBudgetLock, setHardBudgetLock, removeHardBudgetLock, getMonthlySpend } from '../db/index';
import { getBillingReceipts } from '../db/credits';
import { somaHash } from '../utils/crypto-agility';
import { getEASScanUrl } from '../utils/eas';

const router = new Hono();

router.use('*', checkApiKey);

// ─── Helpers ────────────────────────────────────────────────────────────────

interface PeriodStats {
  creditsSpent: number;
  queriesCount: number;
  cacheHits: number;
  cacheSavings: number;
  topEndpoints: Array<{ endpoint: string; credits: number; calls: number }>;
}

function getPeriodStats(apiKey: string, since: string): PeriodStats {
  const summary = getDb()
    .prepare(
      `SELECT COUNT(*) as queries, COALESCE(SUM(total), 0) as credits,
              COALESCE(SUM(cache_hits), 0) as cache_hits
       FROM orchestrations
       WHERE api_key = ? AND timestamp >= ?`
    )
    .get(apiKey, since) as { queries: number; credits: number; cache_hits: number };

  // Estimate cache savings: each cache hit saved roughly the avg live cost per step
  const avgCostRow = getDb()
    .prepare(
      `SELECT CASE WHEN SUM(executed_steps) > 0
              THEN SUM(total) / SUM(executed_steps)
              ELSE 1.0 END as avg_step_cost
       FROM orchestrations
       WHERE api_key = ? AND timestamp >= ? AND cache_hits = 0`
    )
    .get(apiKey, since) as { avg_step_cost: number };

  const cacheSavings = Math.round(summary.cache_hits * (avgCostRow.avg_step_cost || 1) * 100) / 100;

  const topEndpoints = getDb()
    .prepare(
      `SELECT skill_id as endpoint, COALESCE(SUM(total), 0) as credits, COUNT(*) as calls
       FROM orchestrations
       WHERE api_key = ? AND timestamp >= ? AND skill_id IS NOT NULL
       GROUP BY skill_id ORDER BY credits DESC LIMIT 10`
    )
    .all(apiKey, since) as Array<{ endpoint: string; credits: number; calls: number }>;

  return {
    creditsSpent: summary.credits,
    queriesCount: summary.queries,
    cacheHits: summary.cache_hits,
    cacheSavings,
    topEndpoints,
  };
}

function getNextMonthStart(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}

// ─── GET /v1/account/spending ───────────────────────────────────────────────

router.get('/spending', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const apiKey = keyInfo.key;

  const today = getPeriodStats(apiKey, new Date().toISOString().slice(0, 10));

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const thisWeek = getPeriodStats(apiKey, weekAgo.toISOString().slice(0, 10));

  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const thisMonth = getPeriodStats(apiKey, monthStart);

  // Daily history (last 30 days)
  const dailyHistory = getDb()
    .prepare(
      `SELECT date(timestamp) as date, COUNT(*) as queries,
              COALESCE(SUM(total), 0) as creditsSpent,
              CASE WHEN SUM(executed_steps) > 0
                THEN ROUND(CAST(SUM(cache_hits) AS REAL) / SUM(executed_steps) * 100, 1)
                ELSE 0 END as cacheHitRate
       FROM orchestrations
       WHERE api_key = ? AND timestamp >= date('now', '-30 days')
       GROUP BY date(timestamp) ORDER BY date`
    )
    .all(apiKey) as Array<{ date: string; queries: number; creditsSpent: number; cacheHitRate: number }>;

  // Per-endpoint breakdown
  const endpointBreakdown = getDb()
    .prepare(
      `SELECT skill_id as endpointId, COUNT(*) as calls,
              COALESCE(SUM(total), 0) as totalCredits,
              ROUND(COALESCE(AVG(total), 0), 4) as avgCreditsPerCall,
              CASE WHEN SUM(executed_steps) > 0
                THEN ROUND(CAST(SUM(cache_hits) AS REAL) / SUM(executed_steps) * 100, 1)
                ELSE 0 END as cacheHitRate,
              MAX(timestamp) as lastUsed
       FROM orchestrations
       WHERE api_key = ? AND skill_id IS NOT NULL
       GROUP BY skill_id ORDER BY totalCredits DESC LIMIT 50`
    )
    .all(apiKey) as Array<{
    endpointId: string; calls: number; totalCredits: number;
    avgCreditsPerCall: number; cacheHitRate: number; lastUsed: string;
  }>;

  // Budget status
  const lock = getHardBudgetLock(apiKey);
  const monthlySpent = getMonthlySpend(apiKey);
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const dayOfMonth = new Date().getDate();
  const monthlyEstimate = dayOfMonth > 0 ? Math.round((monthlySpent / dayOfMonth) * daysInMonth * 100) / 100 : 0;

  // Cost comparison vs OpenClaw
  const totalQueries = thisMonth.queriesCount;
  const clawnetCost = Math.round(thisMonth.creditsSpent * 0.001 * 100) / 100; // credits → USD
  const estimatedOpenClawCost = Math.round(totalQueries * 0.014 * 100) / 100; // $0.014 avg per query
  const savings = Math.round((estimatedOpenClawCost - clawnetCost) * 100) / 100;
  const savingsPct = estimatedOpenClawCost > 0 ? Math.round((savings / estimatedOpenClawCost) * 100) : 0;

  return c.json({
    overview: {
      creditsRemaining: keyInfo.credits,
      creditsUsed: keyInfo.creditsUsed,
      totalPurchased: keyInfo.credits + keyInfo.creditsUsed,
      lifetimeSpendUsd: Math.round(keyInfo.amountPaid * 100) / 100,
    },
    today,
    thisWeek,
    thisMonth,
    dailyHistory,
    endpointBreakdown,
    budget: {
      dailyCap: 0,
      dailyUsed: today.creditsSpent,
      monthlyEstimate,
      hardLock: lock ? { enabled: lock.enabled, limitCredits: lock.limitCredits, currentUsed: monthlySpent } : null,
    },
    vsOpenClaw: {
      clawnetCost,
      estimatedOpenClawCost,
      savings,
      savingsPct,
    },
  });
});

// ─── GET /v1/account/budget ─────────────────────────────────────────────────

router.get('/budget', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const lock = getHardBudgetLock(keyInfo.key);
  const monthlySpent = getMonthlySpend(keyInfo.key);

  return c.json({
    creditsRemaining: keyInfo.credits,
    monthlySpent,
    hardLock: lock ? {
      enabled: lock.enabled,
      limitCredits: lock.limitCredits,
      currentUsed: monthlySpent,
      resetsAt: getNextMonthStart(),
    } : null,
  });
});

// ─── POST /v1/account/budget/lock ───────────────────────────────────────────

const BudgetLockSchema = z.object({
  monthlyLimit: z.number().min(1).max(10_000_000),
});

router.post('/budget/lock', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) {
    return c.json({ error: 'Budget locks not available for env keys', code: 'ENV_KEY_UNSUPPORTED' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = BudgetLockSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }

  setHardBudgetLock(keyInfo.key, parsed.data.monthlyLimit);
  logAudit({ entityType: 'budget_lock', entityId: keyInfo.key, action: 'SET', data: { monthlyLimit: parsed.data.monthlyLimit } });

  const monthlySpent = getMonthlySpend(keyInfo.key);

  return c.json({
    ok: true,
    hardLock: {
      enabled: true,
      limitCredits: parsed.data.monthlyLimit,
      currentUsed: monthlySpent,
      resetsAt: getNextMonthStart(),
    },
  });
});

// ─── DELETE /v1/account/budget/lock ─────────────────────────────────────────

router.delete('/budget/lock', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  removeHardBudgetLock(keyInfo.key);
  logAudit({ entityType: 'budget_lock', entityId: keyInfo.key, action: 'REMOVED' });

  return c.json({ ok: true, hardLock: null });
});

// ─── Soma-Verified Billing Receipts ─────────────────────────────────────────

router.get('/receipts', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const url = new URL(c.req.url);
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));

  const receipts = getBillingReceipts(keyInfo.key, limit);

  return c.json({
    receipts,
    count: receipts.length,
    verificationInfo: {
      description: 'Each receipt contains a SHA-256 data hash and an Ed25519 signature from the platform DID. Verify the signature against the data hash to prove the charge is authentic and unmodified.',
      platformDid: process.env.PLATFORM_DID || 'did:web:api.claw-net.org',
      algorithm: 'Ed25519',
    },
  });
});

// ─── Soma Receipts (for dashboard) ──────────────────────────────────────────

router.get('/soma-receipts', async (c) => {
  const keyInfo = c.get('apiKeyInfo') as { key: string };
  const url = new URL(c.req.url);
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

  const apiKeyHash = somaHash(keyInfo.key);

  const rows = getDb().prepare(`
    SELECT id, request_id, payment_method, credits_cost, request_hash, response_hash,
           soma_data_hash, eas_uid, algorithm_version, anchor_id, anchored_at, created_at
    FROM soma_receipts
    WHERE api_key_hash = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(apiKeyHash, limit, offset) as any[];

  const total = (getDb().prepare(
    'SELECT COUNT(*) as c FROM soma_receipts WHERE api_key_hash = ?'
  ).get(apiKeyHash) as any).c;

  return c.json({
    receipts: rows.map(r => ({
      id: r.id,
      requestId: r.request_id,
      paymentMethod: r.payment_method,
      creditsCost: r.credits_cost,
      requestHash: r.request_hash,
      responseHash: r.response_hash,
      hasProvenance: !!r.soma_data_hash,
      easUid: r.eas_uid,
      easScanUrl: r.eas_uid ? getEASScanUrl(r.eas_uid) : null,
      algorithm: r.algorithm_version === '2.0' ? 'Ed25519+ML-DSA-65' : 'Ed25519',
      anchored: !!r.anchored_at,
      createdAt: r.created_at,
    })),
    total,
    limit,
    offset,
  });
});

export { router as accountRouter };
