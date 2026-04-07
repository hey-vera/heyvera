import { Hono } from 'hono';
import { z } from 'zod';
import { getDbStats, getAllPendingPayouts, updatePayoutStatus, getReconciliation, getRevenueBreakdown, getTreasuryStatus, revokeKeyByKey, revokeKeysByEmail, logAudit, getDb, createPromoCode, listPromoCodes, getPromoCode, deactivatePromoCode, getRedemptionsForCode } from '../db/index';
import { cacheStats } from '../cache/index';
import { cacheAdminRouter } from './cache-admin';
import { getUsageStats } from '../utils/usage';
import { getCircuitStats } from '../core/circuit-breaker';
import { requireAdmin } from '../middleware/admin-auth';
import { escapeHtml } from '../utils/html';
import { maskApiKey } from '../utils/mask';
import { runEasAnchorCycle } from '../core/eas-anchor-cron';

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
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
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
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  return c.json({
    ...getReconciliation(),
    note: 'drift should be 0. Nonzero indicates accounting inconsistency.',
  });
});

// ─── GET /v1/admin/revenue — platform revenue breakdown ──────────────────────

adminRouter.get('/revenue', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  return c.json({
    ...getRevenueBreakdown(),
    note: 'Marketplace fees are credited to clawhub-treasury. Use GET /v1/admin/treasury for treasury balance.',
  });
});

// ─── GET /v1/admin/treasury — platform treasury balance and transaction history ─

adminRouter.get('/treasury', (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  return c.json(getTreasuryStatus());
});

// ─── POST /v1/admin/revoke-key — deactivate an API key by key or email ──────

const RevokeKeyBody = z.object({
  key: z.string().optional(),
  email: z.string().email().optional(),
  reason: z.string().optional(),
}).refine((d) => d.key || d.email, { message: 'Either key or email is required' });

adminRouter.post('/revoke-key', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  let body: z.infer<typeof RevokeKeyBody>;
  try { body = RevokeKeyBody.parse(await c.req.json()); } catch (err) {
    const details = err instanceof z.ZodError ? err.flatten().fieldErrors : undefined;
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details }, 400);
  }

  const revoked = body.key
    ? revokeKeyByKey(body.key, body.reason)
    : revokeKeysByEmail(body.email!, body.reason);

  if (revoked === 0) {
    return c.json({ ok: false, error: 'No active key found matching that identifier', code: 'NOT_FOUND' }, 404);
  }

  return c.json({ ok: true, revokedCount: revoked });
});

// ─── Validator Promotion ─────────────────────────────────────────────────────

adminRouter.post('/validators/promote', async (c) => {
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
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
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
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
  if (!requireAdmin(c)) return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const { id } = c.req.param();
  let body: z.infer<typeof UpdatePayoutBody>;
  try { body = UpdatePayoutBody.parse(await c.req.json()); } catch (err) {
    const details = err instanceof z.ZodError ? err.flatten().fieldErrors : undefined;
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR', details }, 400);
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

// ─── Promo Codes ────────────────────────────────────────────────────────────

const CreatePromoBody = z.object({
  code: z.string().min(3).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Code must be alphanumeric with dashes/underscores'),
  creditsAmount: z.number().min(1).max(100_000).default(100),
  maxUses: z.number().int().min(1).max(1_000_000).default(100),
  expiresAt: z.string().optional(),
  eventName: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

adminRouter.post('/promo-codes', async (c) => {
  const body = await c.req.json();
  const parsed = CreatePromoBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid promo code data', code: 'INVALID_DATA', details: parsed.error.flatten().fieldErrors }, 400);
  }
  try {
    const promo = createPromoCode({ ...parsed.data, createdBy: 'admin' });
    logAudit({ entityType: 'promo_code', entityId: promo.id, action: 'PROMO_CREATED', actorId: 'admin', data: { code: promo.code, credits: promo.credits_amount, maxUses: promo.max_uses, event: promo.event_name } });
    return c.json({ ok: true, promoCode: promo }, 201);
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return c.json({ error: 'Promo code already exists', code: 'DUPLICATE_CODE' }, 409);
    }
    throw err;
  }
});

adminRouter.get('/promo-codes', (c) => {
  return c.json({ promoCodes: listPromoCodes() });
});

adminRouter.get('/promo-codes/:id', (c) => {
  const promo = getPromoCode(c.req.param('id'));
  if (!promo) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  const redemptions = getRedemptionsForCode(promo.id);
  return c.json({ promoCode: promo, redemptions });
});

adminRouter.post('/promo-codes/:id/deactivate', (c) => {
  const ok = deactivatePromoCode(c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
  logAudit({ entityType: 'promo_code', entityId: c.req.param('id'), action: 'PROMO_DEACTIVATED', actorId: 'admin' });
  return c.json({ ok: true });
});

// ─── Endpoint moderation (post-hoc) ─────────────────────────────────────────

adminRouter.post('/endpoints/:id/disable', (c) => {
  const id = c.req.param('id');
  const ep = getDb().prepare('SELECT id, status FROM endpoints WHERE id = ?').get(id) as any;
  if (!ep) return c.json({ error: 'Endpoint not found', code: 'NOT_FOUND' }, 404);

  getDb().prepare("UPDATE endpoints SET status = 'disabled', updated_at = datetime('now') WHERE id = ?").run(id);
  logAudit({ entityType: 'endpoint', entityId: id, action: 'ENDPOINT_DISABLED', actorId: 'admin' });
  return c.json({ ok: true, endpointId: id, status: 'disabled' });
});

adminRouter.post('/endpoints/:id/enable', (c) => {
  const id = c.req.param('id');
  const ep = getDb().prepare('SELECT id, status FROM endpoints WHERE id = ?').get(id) as any;
  if (!ep) return c.json({ error: 'Endpoint not found', code: 'NOT_FOUND' }, 404);

  getDb().prepare("UPDATE endpoints SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id);
  logAudit({ entityType: 'endpoint', entityId: id, action: 'ENDPOINT_ENABLED', actorId: 'admin' });
  return c.json({ ok: true, endpointId: id, status: 'active' });
});

adminRouter.get('/endpoints/pending', (c) => {
  const pending = getDb().prepare("SELECT id, provider, provider_id, name, category, source, submitted_by, created_at FROM endpoints WHERE status = 'pending' ORDER BY created_at DESC").all();
  return c.json({ endpoints: pending, count: pending.length });
});

// ─── EAS anchor (manual trigger — normally runs hourly via cron) ────────────
adminRouter.post('/eas/anchor', async (c) => {
  const result = await runEasAnchorCycle();
  logAudit({ entityType: 'eas_receipt_anchor', entityId: result.anchorId ?? 'n/a', action: 'EAS_ANCHOR_MANUAL_TRIGGER', actorId: 'admin', data: result });
  return c.json(result);
});

// ─── EAS schema registration (one-time — call once to get EAS_SCHEMA_UID) ──
adminRouter.post('/eas/register-schema', async (c) => {
  const { isEASReady, registerSchema } = await import('../utils/eas');
  if (isEASReady()) {
    return c.json({ error: 'EAS already configured — schema UID is set', code: 'ALREADY_CONFIGURED' }, 409);
  }
  const uid = await registerSchema();
  if (!uid) {
    return c.json({ error: 'Schema registration failed — check EVM_PRIVATE_KEY and Base wallet balance', code: 'REGISTRATION_FAILED' }, 500);
  }
  logAudit({ entityType: 'eas_schema', entityId: uid, action: 'EAS_SCHEMA_REGISTERED', actorId: 'admin' });
  return c.json({ ok: true, schemaUid: uid, next: `Set EAS_SCHEMA_UID=${uid} in VPS .env and restart` });
});

// ─── EAS status check ──────────────────────────────────────────────────────
adminRouter.get('/eas/status', async (c) => {
  const { isEASReady, getAttesterAddress } = await import('../utils/eas');
  const { getSomaReceiptStats } = await import('../core/soma-receipt');
  const stats = getSomaReceiptStats();
  return c.json({
    ready: isEASReady(),
    attesterAddress: getAttesterAddress(),
    schemaUidSet: !!env.EAS_SCHEMA_UID,
    anchorEnabled: !!env.EAS_ANCHOR_ENABLED,
    receipts: stats,
  });
});

// ─── Provider Withdrawal Admin ──────────────────────────────────────────────

// GET /v1/admin/withdrawals/pending — list withdrawals ready for approval
adminRouter.get('/withdrawals/pending', async (c) => {
  const { getPendingWithdrawals } = await import('../db/providers');
  return c.json({ ok: true, withdrawals: getPendingWithdrawals() });
});

// POST /v1/admin/withdrawals/:id/approve — approve + execute payout
adminRouter.post('/withdrawals/:id/approve', async (c) => {
  const id = c.req.param('id');
  const { approveWithdrawal, getWithdrawal, completeWithdrawal, failWithdrawal } = await import('../db/providers');

  const withdrawal = getWithdrawal(id);
  if (!withdrawal) return c.json({ error: 'Withdrawal not found', code: 'NOT_FOUND' }, 404);
  if (withdrawal.status !== 'pending') return c.json({ error: `Cannot approve: status is ${withdrawal.status}`, code: 'INVALID_STATUS' }, 400);

  const holdDate = new Date(withdrawal.holdUntil);
  if (holdDate > new Date()) {
    return c.json({ error: `Hold period not elapsed. Eligible after ${withdrawal.holdUntil}`, code: 'HOLD_ACTIVE' }, 400);
  }

  const approved = approveWithdrawal(id, 'admin');
  if (!approved) return c.json({ error: 'Approval failed', code: 'APPROVAL_FAILED' }, 500);

  // Execute payout
  try {
    const { sendSolanaUsdc } = await import('../utils/solana-payout');
    const txHash = await sendSolanaUsdc(withdrawal.payoutWallet, withdrawal.amountUsdc);
    completeWithdrawal(id, txHash);
    return c.json({ ok: true, withdrawal: getWithdrawal(id), txHash, message: `Paid $${withdrawal.amountUsdc} USDC to ${withdrawal.payoutWallet}` });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    failWithdrawal(id, errMsg);
    return c.json({ error: `Payout failed: ${errMsg}`, code: 'PAYOUT_FAILED', withdrawal: getWithdrawal(id) }, 500);
  }
});

// POST /v1/admin/withdrawals/:id/reject — reject + refund credits
adminRouter.post('/withdrawals/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason || 'No reason provided';

  const { rejectWithdrawal, getWithdrawal } = await import('../db/providers');
  const rejected = rejectWithdrawal(id, 'admin', reason);
  if (!rejected) return c.json({ error: 'Rejection failed (not found or wrong status)', code: 'REJECTION_FAILED' }, 400);

  return c.json({ ok: true, withdrawal: getWithdrawal(id), message: 'Withdrawal rejected, credits refunded' });
});

// ─── Cache Admin Sub-Router ─────────────────────────────────────────────────
adminRouter.route('/', cacheAdminRouter);