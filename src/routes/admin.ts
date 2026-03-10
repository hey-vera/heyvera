import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'crypto';
import { getDbStats, getAllPendingPayouts, updatePayoutStatus, getDb, logAudit } from '../db/index';
import { cacheStats } from '../cache/index';
import { getUsageStats } from '../utils/usage';
import { getCircuitStats } from '../core/circuit-breaker';
import { env } from '../config/index';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const adminRouter = new Hono();

adminRouter.get('/dashboard', (c) => {
  const adminKey = c.req.header('X-Admin-Key');
  const expectedKey = env.ADMIN_API_KEY;
  if (!adminKey || !expectedKey || !safeEqual(adminKey, expectedKey)) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }

  const dbStats = getDbStats();
  const cache = cacheStats();
  const usage = getUsageStats();
  const circuits = getCircuitStats();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClawNet Admin Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; }
    h1 { color: #00ff88; margin-bottom: 24px; font-size: 24px; }
    h2 { color: #888; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; }
    .metric { font-size: 32px; font-weight: bold; color: #00ff88; }
    .label { font-size: 12px; color: #666; margin-top: 4px; }
    .table { width: 100%; border-collapse: collapse; }
    .table th { text-align: left; padding: 8px 12px; background: #1a1a1a; color: #666; font-size: 12px; }
    .table td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; font-size: 13px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
    .badge-green { background: #00ff8820; color: #00ff88; }
    .badge-red { background: #ff444420; color: #ff4444; }
    .badge-yellow { background: #ffaa0020; color: #ffaa00; }
    .section { margin-bottom: 32px; }
    a { color: #00ff88; text-decoration: none; margin-left: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>🦀 ClawNet Admin <a href="javascript:location.reload()">Refresh</a></h1>

  <div class="section">
    <h2>Overview</h2>
    <div class="grid">
      <div class="card">
        <div class="metric">${dbStats?.total ?? usage.total}</div>
        <div class="label">Total Requests</div>
      </div>
      <div class="card">
        <div class="metric">$${dbStats?.totalRevenue ?? usage.totalRevenue}</div>
        <div class="label">Total Revenue (Markup)</div>
      </div>
      <div class="card">
        <div class="metric">${dbStats?.errorRate ?? 0}%</div>
        <div class="label">Error Rate</div>
      </div>
      <div class="card">
        <div class="metric">${dbStats?.avgDurationMs ?? usage.avgDurationMs}ms</div>
        <div class="label">Avg Response Time</div>
      </div>
      <div class="card">
        <div class="metric">${usage.cacheHitRate}%</div>
        <div class="label">Cache Hit Rate</div>
      </div>
      <div class="card">
        <div class="metric">${cache.memory.items}</div>
        <div class="label">Cached Items</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Top Queries</h2>
    <table class="table">
      <tr><th>Query</th><th>Count</th></tr>
      ${dbStats?.topQueries.map((q) => `
        <tr>
          <td>${escapeHtml(q.query.slice(0, 80))}${q.query.length > 80 ? '...' : ''}</td>
          <td>${escapeHtml(String(q.count))}</td>
        </tr>
      `).join('') ?? '<tr><td colspan="2">No data yet</td></tr>'}
    </table>
  </div>

  <div class="section">
    <h2>Circuit Breakers</h2>
    <table class="table">
      <tr><th>Endpoint</th><th>State</th><th>Failures</th></tr>
      ${Object.entries(circuits).map(([id, s]) => `
        <tr>
          <td>${escapeHtml(id)}</td>
          <td><span class="badge ${s.state === 'CLOSED' ? 'badge-green' : s.state === 'OPEN' ? 'badge-red' : 'badge-yellow'}">${escapeHtml(s.state)}</span></td>
          <td>${escapeHtml(String(s.failures))}</td>
        </tr>
      `).join('') || '<tr><td colspan="3">No circuit data yet</td></tr>'}
    </table>
  </div>

  <div class="section">
    <h2>Infrastructure</h2>
    <div class="grid">
      <div class="card">
        <div class="metric">
          <span class="badge ${cache.redisConnected ? 'badge-green' : 'badge-red'}">
            ${cache.redisConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div class="label">Redis</div>
      </div>
      <div class="card">
        <div class="metric">${Math.floor(process.uptime())}s</div>
        <div class="label">Uptime</div>
      </div>
      <div class="card">
        <div class="metric">${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB</div>
        <div class="label">Memory Usage</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Feedback</h2>
    <div class="grid">
      <div class="card">
        <div class="metric">${dbStats?.feedbackCount ?? 0}</div>
        <div class="label">Total Feedback</div>
      </div>
      <div class="card">
        <div class="metric">${dbStats?.avgRating ?? 0}/5</div>
        <div class="label">Average Rating</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  return c.html(html);
});

// ─── Admin auth helper ─────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  // Hash both to normalize length — avoids leaking secret length via timing
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAdmin(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const key = c.req.header('X-Admin-Key');
  return !!(key && env.ADMIN_API_KEY && safeEqual(key, env.ADMIN_API_KEY));
}

// ─── GET /v1/admin/payouts — list pending creator withdrawal requests ──────────

adminRouter.get('/payouts', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const payouts = getAllPendingPayouts();
  return c.json({
    total: payouts.length,
    payouts: payouts.map(p => ({
      id: p.id,
      agentKey: p.agent_key,
      amountCredits: p.amount_credits,
      usdcEquivalent: (p.amount_credits * 0.001).toFixed(4),
      usdcWallet: p.usdc_wallet,
      status: p.status,
      createdAt: p.created_at,
    })),
  });
});

// ─── PATCH /v1/admin/payouts/:id — mark payout as PAID or REJECTED ────────────

const UpdatePayoutBody = z.object({
  status: z.enum(['PAID', 'REJECTED', 'PROCESSING']),
  notes: z.string().optional(),
});

// ─── GET /v1/admin/reconcile — verify credit accounting invariants ────────────

adminRouter.get('/reconcile', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const db = getDb();
  const totals = db.prepare(`
    SELECT
      SUM(credits)        AS creditsRemaining,
      SUM(credits_used)   AS creditsUsed,
      SUM(amount_paid)    AS totalAmountPaid
    FROM api_keys WHERE active = 1
  `).get() as { creditsRemaining: number; creditsUsed: number; totalAmountPaid: number };
  const staked = db.prepare('SELECT COALESCE(SUM(amount_credits),0) AS total FROM stakes').get() as { total: number };
  const escrow = db.prepare("SELECT COALESCE(SUM(amount_credits),0) AS total FROM escrows WHERE state IN ('FUNDED','WORK_IN_PROGRESS','DISPUTED')").get() as { total: number };
  const granted = db.prepare('SELECT COALESCE(SUM(credits),0) AS total FROM api_keys').get() as { total: number };
  const expectedCirculating = (totals.creditsRemaining ?? 0) + (totals.creditsUsed ?? 0) + (staked.total ?? 0) + (escrow.total ?? 0);
  return c.json({
    creditsRemaining: totals.creditsRemaining ?? 0,
    creditsUsed: totals.creditsUsed ?? 0,
    creditsStaked: staked.total ?? 0,
    creditsInEscrow: escrow.total ?? 0,
    totalGranted: granted.total ?? 0,
    expectedCirculating,
    drift: expectedCirculating - (granted.total ?? 0),
    totalAmountPaid: totals.totalAmountPaid ?? 0,
    note: 'drift should be 0. Nonzero indicates accounting inconsistency.',
  });
});

// ─── GET /v1/admin/revenue — platform revenue breakdown ──────────────────────

adminRouter.get('/revenue', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const db = getDb();

  // Marketplace fees collected (3% of each skill sale)
  const mktFees = db.prepare(`
    SELECT COALESCE(SUM(fee_credits),0) AS total, COUNT(*) AS txCount
    FROM transactions WHERE type = 'SKILL_SALE'
  `).get() as { total: number; txCount: number };

  // Skill invocation revenue (3% kept from author share)
  const invokeRevenue = db.prepare(`
    SELECT COALESCE(SUM(fee_credits),0) AS total, COUNT(*) AS txCount
    FROM transactions WHERE type = 'SKILL_INVOKE'
  `).get() as { total: number; txCount: number };

  // Swarm base fees
  const swarmFees = db.prepare(`
    SELECT COALESCE(SUM(amount_credits),0) AS total, COUNT(*) AS txCount
    FROM transactions WHERE type = 'SWARM_FEE'
  `).get() as { total: number; txCount: number };

  // Total USD paid in
  const payments = db.prepare(`
    SELECT COALESCE(SUM(amount_paid),0) AS totalUsd, COUNT(*) AS keyCount
    FROM api_keys WHERE active = 1 AND amount_paid > 0
  `).get() as { totalUsd: number; keyCount: number };

  const totalPlatformCredits = (mktFees.total ?? 0) + (invokeRevenue.total ?? 0) + (swarmFees.total ?? 0);

  return c.json({
    totalPlatformCredits,
    totalPlatformUsdEquiv: Math.round(totalPlatformCredits / 10) / 100, // credits / 1000 credits per $
    breakdown: {
      marketplaceFees: { credits: mktFees.total ?? 0, transactions: mktFees.txCount ?? 0 },
      invokeFees: { credits: invokeRevenue.total ?? 0, transactions: invokeRevenue.txCount ?? 0 },
      swarmFees: { credits: swarmFees.total ?? 0, transactions: swarmFees.txCount ?? 0 },
    },
    payments: { totalUsd: payments.totalUsd ?? 0, keyCount: payments.keyCount ?? 0 },
    note: 'credits are platform-retained revenue (not paid out to authors)',
  });
});

// ─── POST /v1/admin/revoke-key — deactivate an API key by key or email ──────

const RevokeKeyBody = z.object({
  key: z.string().optional(),
  email: z.string().email().optional(),
  reason: z.string().optional(),
}).refine((d) => d.key || d.email, { message: 'Either key or email is required' });

adminRouter.post('/revoke-key', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  let body: z.infer<typeof RevokeKeyBody>;
  try { body = RevokeKeyBody.parse(await c.req.json()); } catch (err) {
    const details = err instanceof z.ZodError ? err.flatten().fieldErrors : undefined;
    return c.json({ error: 'Invalid body', details }, 400);
  }

  const db = getDb();
  let revoked = 0;

  if (body.key) {
    const result = db.prepare('UPDATE api_keys SET active = 0 WHERE key = ? AND active = 1').run(body.key);
    revoked = result.changes;
    if (revoked > 0) {
      logAudit({ entityType: 'api_key', entityId: body.key, action: 'KEY_REVOKED', actorId: 'admin', data: { reason: body.reason } });
    }
  } else if (body.email) {
    const keys = db.prepare('SELECT key FROM api_keys WHERE email = ? AND active = 1').all(body.email) as { key: string }[];
    for (const row of keys) {
      db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(row.key);
      logAudit({ entityType: 'api_key', entityId: row.key, action: 'KEY_REVOKED', actorId: 'admin', data: { email: body.email, reason: body.reason } });
    }
    revoked = keys.length;
  }

  if (revoked === 0) {
    return c.json({ ok: false, error: 'No active key found matching that identifier' }, 404);
  }

  return c.json({ ok: true, revokedCount: revoked });
});

adminRouter.patch('/payouts/:id', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { id } = c.req.param();
  let body: z.infer<typeof UpdatePayoutBody>;
  try { body = UpdatePayoutBody.parse(await c.req.json()); } catch (err) {
    const details = err instanceof z.ZodError ? err.flatten().fieldErrors : undefined;
    return c.json({ error: 'Invalid body', details }, 400);
  }
  updatePayoutStatus(id, body.status, body.notes);
  logAudit({ entityType: 'payout', entityId: id, action: 'PAYOUT_STATUS', actorId: 'admin', data: { status: body.status, notes: body.notes } });
  return c.json({ ok: true, id, status: body.status });
});