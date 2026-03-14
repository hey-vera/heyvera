import { Hono } from 'hono';
import { z } from 'zod';
import { getDbStats, getAllPendingPayouts, updatePayoutStatus, getReconciliation, getRevenueBreakdown, getTreasuryStatus, revokeKeyByKey, revokeKeysByEmail, logAudit, getDb } from '../db/index';
import { cacheStats } from '../cache/index';
import { getUsageStats } from '../utils/usage';
import { getCircuitStats } from '../core/circuit-breaker';
import { requireAdmin } from '../middleware/admin-auth';
import { escapeHtml } from '../utils/html';
import { maskApiKey } from '../utils/mask';

export const adminRouter = new Hono();

// Router-level guard — every route below is protected. Defense-in-depth: individual
// routes also call requireAdmin() so adding a new route without the check is safe.
adminRouter.use('*', async (c, next) => {
  if (!requireAdmin(c)) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  }
  return next();
});

adminRouter.get('/dashboard', (c) => {
  if (!requireAdmin(c)) {
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

// ─── GET /v1/admin/payouts — list pending creator withdrawal requests ──────────

adminRouter.get('/payouts', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const payouts = getAllPendingPayouts();
  return c.json({
    total: payouts.length,
    payouts: payouts.map(p => ({
      id: p.id,
      agentKey: maskApiKey(p.agent_key),
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
  return c.json({
    ...getReconciliation(),
    note: 'drift should be 0. Nonzero indicates accounting inconsistency.',
  });
});

// ─── GET /v1/admin/revenue — platform revenue breakdown ──────────────────────

adminRouter.get('/revenue', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({
    ...getRevenueBreakdown(),
    note: 'Marketplace fees are credited to clawhub-treasury. Use GET /v1/admin/treasury for treasury balance.',
  });
});

// ─── GET /v1/admin/treasury — platform treasury balance and transaction history ─

adminRouter.get('/treasury', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(getTreasuryStatus());
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

  const revoked = body.key
    ? revokeKeyByKey(body.key, body.reason)
    : revokeKeysByEmail(body.email!, body.reason);

  if (revoked === 0) {
    return c.json({ ok: false, error: 'No active key found matching that identifier' }, 404);
  }

  return c.json({ ok: true, revokedCount: revoked });
});

// ─── Validator Promotion ─────────────────────────────────────────────────────

adminRouter.post('/validators/promote', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  let body: { key?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }
  if (!body.key || typeof body.key !== 'string') return c.json({ error: 'key is required', code: 'MISSING_KEY' }, 400);

  const db = getDb();
  const existing = db.prepare('SELECT key, is_validator FROM api_keys WHERE key = ? AND active = 1').get(body.key) as { key: string; is_validator: number } | undefined;
  if (!existing) return c.json({ error: 'API key not found', code: 'NOT_FOUND' }, 404);
  if (existing.is_validator) return c.json({ error: 'Key is already a validator', code: 'ALREADY_VALIDATOR' }, 409);

  db.prepare('UPDATE api_keys SET is_validator = 1 WHERE key = ?').run(body.key);
  logAudit({ entityType: 'validator', entityId: body.key, action: 'VALIDATOR_PROMOTED', actorId: 'admin' });
  return c.json({ ok: true, key: body.key, isValidator: true });
});

adminRouter.delete('/validators/demote', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  let body: { key?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }
  if (!body.key || typeof body.key !== 'string') return c.json({ error: 'key is required', code: 'MISSING_KEY' }, 400);

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET is_validator = 0 WHERE key = ? AND active = 1 AND is_validator = 1').run(body.key);
  if (result.changes === 0) return c.json({ error: 'Validator not found', code: 'NOT_FOUND' }, 404);

  logAudit({ entityType: 'validator', entityId: body.key, action: 'VALIDATOR_DEMOTED', actorId: 'admin' });
  return c.json({ ok: true, key: body.key, isValidator: false });
});

adminRouter.patch('/payouts/:id', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized' }, 401);
  const { id } = c.req.param();
  let body: z.infer<typeof UpdatePayoutBody>;
  try { body = UpdatePayoutBody.parse(await c.req.json()); } catch (err) {
    const details = err instanceof z.ZodError ? err.flatten().fieldErrors : undefined;
    return c.json({ error: 'Invalid body', details }, 400);
  }

  // Q7: Restore credits on REJECTED — credits were deducted when the payout request was created.
  // If admin rejects, the credits must be returned to the user's balance.
  if (body.status === 'REJECTED') {
    const db = getDb();
    db.transaction(() => {
      const payout = db.prepare('SELECT agent_key, amount_credits, status FROM payout_requests WHERE id = ?')
        .get(id) as { agent_key: string; amount_credits: number; status: string } | undefined;
      if (!payout) throw new Error('Payout not found');
      if (payout.status === 'REJECTED' || payout.status === 'PAID') {
        throw new Error(`Cannot reject payout in ${payout.status} state`);
      }
      // Restore credits to user
      db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1')
        .run(payout.amount_credits, payout.agent_key);
      updatePayoutStatus(id, 'REJECTED', body.notes);
    })();
    logAudit({ entityType: 'payout', entityId: id, action: 'PAYOUT_REJECTED_CREDITS_RESTORED', actorId: 'admin', data: { notes: body.notes } });
    return c.json({ ok: true, id, status: 'REJECTED', creditsRestored: true });
  }

  updatePayoutStatus(id, body.status, body.notes);
  logAudit({ entityType: 'payout', entityId: id, action: 'PAYOUT_STATUS', actorId: 'admin', data: { status: body.status, notes: body.notes } });
  return c.json({ ok: true, id, status: body.status });
});