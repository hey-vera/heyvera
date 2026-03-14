/**
 * Agent Economy routes — credit transfers, delegated keys, receipts, auto-payout, reputation.
 *
 * All routes require API key auth (checkApiKey middleware).
 * Mounted at /v1/economy in index.ts.
 */

import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { maskApiKey } from '../utils/mask';
import {
  transferCredits,
  getTransferHistory,
  createDelegatedKey,
  getDelegatedKeys,
  revokeDelegatedKey,
  getReceipts,
  setAutoPayoutConfig,
  getAutoPayoutConfig,
  deleteAutoPayoutConfig,
  getReputationScore,
  getReputationEvents,
  logAudit,
  getDb,
  createBudgetAccount,
  getBudgetAccountStatus,
  getSLAViolations,
} from '../db/index';
import {
  createWebhook,
  getWebhooks,
  deleteWebhook,
  type WebhookEventType,
} from '../utils/webhooks';
import crypto from 'crypto';

const economyRouter = new Hono();

// All economy routes require API key
economyRouter.use('*', checkApiKey);

// ─── Credit Transfers ────────────────────────────────────────────────────────

economyRouter.post('/transfer', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot transfer credits', code: 'FORBIDDEN' }, 403);

  let body: { toKey?: string; amount?: number; memo?: string; idempotencyKey?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const { toKey, amount, memo, idempotencyKey } = body;

  if (!toKey || typeof toKey !== 'string') {
    return c.json({ error: 'toKey is required', code: 'MISSING_TO_KEY' }, 400);
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return c.json({ error: 'amount must be a positive number', code: 'INVALID_AMOUNT' }, 400);
  }
  if (memo && typeof memo === 'string' && memo.length > 256) {
    return c.json({ error: 'memo must be 256 characters or less', code: 'MEMO_TOO_LONG' }, 400);
  }

  const result = transferCredits({
    fromKey: keyInfo.key,
    toKey,
    amount,
    memo: typeof memo === 'string' ? memo : undefined,
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
  });

  if (!result.ok) {
    const status = result.error === 'Insufficient credits' ? 402 : 400;
    return c.json({ error: result.error, code: 'TRANSFER_FAILED' }, status);
  }

  return c.json({
    ok: true,
    transferId: result.transferId,
    fee: result.fee,
    newBalance: result.newBalance,
  });
});

economyRouter.get('/transfers', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;
  const direction = c.req.query('direction') as 'sent' | 'received' | 'all' | undefined;

  const { transfers, total } = getTransferHistory(keyInfo.key, { limit, offset, direction });

  // Mask counterparty keys for privacy
  const masked = transfers.map((t) => ({
    ...t,
    from_key: t.from_key === keyInfo.key ? t.from_key : maskApiKey(t.from_key),
    to_key: t.to_key === keyInfo.key ? t.to_key : maskApiKey(t.to_key),
  }));

  return c.json({ transfers: masked, total, limit, offset });
});

// ─── Delegated Keys ──────────────────────────────────────────────────────────

economyRouter.post('/keys/delegate', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot delegate', code: 'FORBIDDEN' }, 403);

  let body: { label?: string; spendLimit?: number; expiresInHours?: number; permissions?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  if (!body.spendLimit || typeof body.spendLimit !== 'number' || body.spendLimit <= 0) {
    return c.json({ error: 'spendLimit is required and must be positive', code: 'INVALID_SPEND_LIMIT' }, 400);
  }

  const validPerms = ['invoke', 'query', 'transfer'];
  if (body.permissions) {
    const invalid = body.permissions.filter((p) => !validPerms.includes(p));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid permissions: ${invalid.join(', ')}. Valid: ${validPerms.join(', ')}`, code: 'INVALID_PERMISSIONS' }, 400);
    }
  }

  const result = createDelegatedKey({
    parentKey: keyInfo.key,
    label: body.label,
    spendLimit: body.spendLimit,
    expiresInHours: body.expiresInHours,
    permissions: body.permissions,
  });

  if (!result.ok) return c.json({ error: result.error, code: 'DELEGATION_FAILED' }, 400);

  return c.json({
    ok: true,
    childKey: result.childKey,
    spendLimit: body.spendLimit,
    expiresInHours: body.expiresInHours ?? null,
    permissions: body.permissions ?? ['invoke', 'query'],
  }, 201);
});

economyRouter.get('/keys/delegated', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const keys = getDelegatedKeys(keyInfo.key);

  return c.json({
    keys: keys.map((k) => ({
      childKey: k.child_key,
      label: k.label,
      spendLimit: k.spend_limit,
      spent: k.spent,
      remaining: Math.max(0, k.spend_limit - k.spent),
      expiresAt: k.expires_at,
      permissions: JSON.parse(k.permissions_json),
      createdAt: k.created_at,
    })),
  });
});

economyRouter.delete('/keys/delegated/:childKey', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const childKey = c.req.param('childKey');

  const result = revokeDelegatedKey(keyInfo.key, childKey);
  if (!result.ok) return c.json({ error: result.error, code: 'REVOKE_FAILED' }, 400);

  return c.json({ ok: true, revoked: childKey });
});

// ─── Receipts ────────────────────────────────────────────────────────────────

economyRouter.get('/receipts', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;
  const type = c.req.query('type');

  const { receipts, total } = getReceipts(keyInfo.key, { limit, offset, type });

  // Mask counterparty keys
  const masked = receipts.map((r) => ({
    ...r,
    counterparty: r.counterparty ? maskApiKey(r.counterparty) : null,
  }));

  return c.json({ receipts: masked, total, limit, offset });
});

// ─── Auto-Payout Threshold ──────────────────────────────────────────────────

economyRouter.put('/auto-payout', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Not available for env keys', code: 'FORBIDDEN' }, 403);

  let body: { thresholdCredits?: number; usdcWallet?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  if (!body.thresholdCredits || typeof body.thresholdCredits !== 'number' || body.thresholdCredits < 1000) {
    return c.json({ error: 'thresholdCredits must be at least 1000', code: 'INVALID_THRESHOLD' }, 400);
  }
  if (!body.usdcWallet || typeof body.usdcWallet !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.usdcWallet)) {
    return c.json({ error: 'Invalid Solana wallet address', code: 'INVALID_WALLET' }, 400);
  }

  setAutoPayoutConfig(keyInfo.key, body.thresholdCredits, body.usdcWallet);

  return c.json({
    ok: true,
    thresholdCredits: body.thresholdCredits,
    usdcWallet: body.usdcWallet,
  });
});

economyRouter.get('/auto-payout', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const config = getAutoPayoutConfig(keyInfo.key);
  if (!config) return c.json({ error: 'No auto-payout configured', code: 'NOT_CONFIGURED' }, 404);

  return c.json({
    thresholdCredits: config.threshold_credits,
    usdcWallet: config.usdc_wallet,
    enabled: config.enabled === 1,
    createdAt: config.created_at,
  });
});

economyRouter.delete('/auto-payout', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const deleted = deleteAutoPayoutConfig(keyInfo.key);
  if (!deleted) return c.json({ error: 'No auto-payout configured', code: 'NOT_CONFIGURED' }, 404);
  return c.json({ ok: true });
});

// ─── Reputation ──────────────────────────────────────────────────────────────

economyRouter.get('/reputation', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  return reputationResponse(c, keyInfo.key);
});

economyRouter.get('/reputation/:key', (c) => {
  const targetKey = c.req.param('key');
  return reputationResponse(c, targetKey);
});

// ─── Credit Gifting ──────────────────────────────────────────────────────────

economyRouter.post('/gift', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot gift credits', code: 'FORBIDDEN' }, 403);

  let body: { toKey?: string; amount?: number; message?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400); }

  const { toKey, amount, message } = body;
  if (!toKey || typeof toKey !== 'string') return c.json({ error: 'toKey is required', code: 'MISSING_TO_KEY' }, 400);
  if (!amount || typeof amount !== 'number' || amount <= 0) return c.json({ error: 'amount must be positive', code: 'INVALID_AMOUNT' }, 400);
  if (amount > 50000) return c.json({ error: 'Maximum gift is 50,000 credits', code: 'AMOUNT_TOO_LARGE' }, 400);

  // Gifts use the transfer system with 0% fee (memo indicates gift)
  const result = transferCredits({
    fromKey: keyInfo.key,
    toKey,
    amount,
    memo: `🎁 Gift${message ? ': ' + (typeof message === 'string' ? message.slice(0, 200) : '') : ''}`,
  });

  if (!result.ok) {
    const status = result.error === 'Insufficient credits' ? 402 : 400;
    return c.json({ error: result.error, code: 'GIFT_FAILED' }, status);
  }

  return c.json({
    ok: true,
    giftId: result.transferId,
    amount,
    fee: result.fee,
    newBalance: result.newBalance,
  });
});

// ─── Webhook Secret ──────────────────────────────────────────────────────────

economyRouter.put('/webhook-secret', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Not available for env keys', code: 'FORBIDDEN' }, 403);

  let body: { secret?: string; regenerate?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  let secret: string;
  if (body.regenerate) {
    secret = crypto.randomBytes(32).toString('hex');
  } else if (body.secret && typeof body.secret === 'string' && body.secret.length >= 16) {
    secret = body.secret;
  } else {
    return c.json({ error: 'Provide secret (min 16 chars) or set regenerate: true', code: 'INVALID_SECRET' }, 400);
  }

  getDb().prepare('UPDATE api_keys SET webhook_secret = ? WHERE key = ?').run(secret, keyInfo.key);
  logAudit({ entityType: 'webhook_secret', entityId: keyInfo.key, action: 'WEBHOOK_SECRET_SET' });

  return c.json({ ok: true, secret, hint: 'Use this secret to verify X-ClawNet-Signature headers on webhook deliveries' });
});

economyRouter.delete('/webhook-secret', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  getDb().prepare('UPDATE api_keys SET webhook_secret = NULL WHERE key = ?').run(keyInfo.key);
  return c.json({ ok: true });
});

// ─── Cryptographic Receipt Lookup ───────────────────────────────────────────

economyRouter.get('/receipts/:id', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const txId = c.req.param('id');

  const tx = getDb().prepare(
    'SELECT * FROM transactions WHERE id = ?'
  ).get(txId) as {
    id: string; from_agent: string | null; to_agent: string | null;
    amount_credits: number; type: string; skill_id: string | null;
    fee_credits: number; metadata_json: string | null; created_at: string;
    request_hash: string | null; result_hash: string | null;
  } | undefined;

  if (!tx) return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404);

  // Only sender or receiver can view the receipt
  if (tx.from_agent !== keyInfo.key && tx.to_agent !== keyInfo.key) {
    return c.json({ error: 'Not authorized to view this receipt', code: 'FORBIDDEN' }, 403);
  }

  return c.json({
    id: tx.id,
    type: tx.type,
    skillId: tx.skill_id,
    amountCredits: tx.amount_credits,
    feeCredits: tx.fee_credits,
    direction: tx.from_agent === keyInfo.key ? 'OUT' : 'IN',
    counterparty: (() => {
      const k = tx.from_agent === keyInfo.key ? tx.to_agent : tx.from_agent;
      return k ? maskApiKey(k) : null;
    })(),
    requestHash: tx.request_hash,
    resultHash: tx.result_hash,
    createdAt: tx.created_at,
    verifiable: !!(tx.request_hash && tx.result_hash),
  });
});

// ─── Agent Budget Accounts ───────────────────────────────────────────────────

economyRouter.post('/keys/budget-account', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot create budget accounts', code: 'FORBIDDEN' }, 403);

  let body: { label?: string; spendLimit?: number; dailyLimit?: number; weeklyLimit?: number;
    autoTopup?: boolean; autoTopupAmount?: number; expiresInHours?: number; permissions?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400); }

  if (!body.spendLimit || typeof body.spendLimit !== 'number' || body.spendLimit <= 0) {
    return c.json({ error: 'spendLimit is required and must be positive', code: 'INVALID_SPEND_LIMIT' }, 400);
  }

  const validPerms = ['invoke', 'query', 'transfer'];
  if (body.permissions) {
    const invalid = (body.permissions as string[]).filter((p: string) => !validPerms.includes(p));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid permissions: ${invalid.join(', ')}`, code: 'INVALID_PERMISSIONS' }, 400);
    }
  }

  const result = createBudgetAccount({
    parentKey: keyInfo.key,
    label: body.label,
    spendLimit: body.spendLimit,
    dailyLimit: body.dailyLimit,
    weeklyLimit: body.weeklyLimit,
    autoTopup: body.autoTopup,
    autoTopupAmount: body.autoTopupAmount,
    expiresInHours: body.expiresInHours,
    permissions: body.permissions,
  });

  if (!result.ok) return c.json({ error: result.error, code: 'BUDGET_ACCOUNT_FAILED' }, 400);

  return c.json({
    ok: true,
    childKey: result.childKey,
    accountType: 'budget',
    spendLimit: body.spendLimit,
    dailyLimit: body.dailyLimit ?? null,
    weeklyLimit: body.weeklyLimit ?? null,
    autoTopup: body.autoTopup ?? false,
  }, 201);
});

economyRouter.get('/keys/budget-account/:childKey', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const childKey = c.req.param('childKey');

  // Verify ownership
  const delegation = getDb().prepare(
    'SELECT parent_key FROM delegated_keys WHERE child_key = ? AND active = 1'
  ).get(childKey) as { parent_key: string } | undefined;
  if (!delegation || delegation.parent_key !== keyInfo.key) {
    return c.json({ error: 'Budget account not found', code: 'NOT_FOUND' }, 404);
  }

  const status = getBudgetAccountStatus(childKey);
  if (!status) return c.json({ error: 'Not a budget account', code: 'NOT_BUDGET_ACCOUNT' }, 400);

  return c.json(status);
});

// ─── Event Webhooks ──────────────────────────────────────────────────────────

economyRouter.post('/webhooks', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot register webhooks', code: 'FORBIDDEN' }, 403);

  let body: { url?: string; events?: string[]; secret?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400); }

  if (!body.url || typeof body.url !== 'string') {
    return c.json({ error: 'url is required', code: 'MISSING_URL' }, 400);
  }
  try { new URL(body.url); } catch { return c.json({ error: 'Invalid URL', code: 'INVALID_URL' }, 400); }

  const validEvents = ['*', 'SKILL_INVOKED', 'CREDIT_LOW', 'BUDGET_DEPLETED', 'SLA_VIOLATED', 'PAYOUT_SENT', 'TRANSFER_RECEIVED', 'OUTPUT_CONTRACT_VIOLATION'];
  if (body.events) {
    const invalid = body.events.filter((e: string) => !validEvents.includes(e));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid events: ${invalid.join(', ')}. Valid: ${validEvents.join(', ')}`, code: 'INVALID_EVENTS' }, 400);
    }
  }

  const result = createWebhook({
    agentKey: keyInfo.key,
    url: body.url,
    events: body.events as WebhookEventType[],
    secret: body.secret,
  });

  if (!result.ok) return c.json({ error: result.error, code: 'WEBHOOK_FAILED' }, 400);

  return c.json({ ok: true, webhookId: result.id, url: body.url, events: body.events ?? ['*'] }, 201);
});

economyRouter.get('/webhooks', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const hooks = getWebhooks(keyInfo.key);
  return c.json({
    webhooks: hooks.map(h => ({
      id: h.id,
      url: h.url,
      events: JSON.parse(h.events_json),
      active: h.active === 1,
      failureCount: h.failure_count,
      lastTriggeredAt: h.last_triggered_at,
      createdAt: h.created_at,
    })),
  });
});

economyRouter.delete('/webhooks/:id', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const webhookId = c.req.param('id');
  const deleted = deleteWebhook(keyInfo.key, webhookId);
  if (!deleted) return c.json({ error: 'Webhook not found', code: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, deleted: webhookId });
});

// ─── SLA Violations ──────────────────────────────────────────────────────────

economyRouter.get('/sla-violations/:skillId', (c) => {
  const skillId = c.req.param('skillId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 100);
  const violations = getSLAViolations(skillId, limit);
  return c.json({ skillId, violations, count: violations.length });
});

// ─── Skill Dependency Graph ──────────────────────────────────────────────────

economyRouter.get('/dependency-graph', (c) => {
  const db = getDb();
  const composites = db.prepare(
    `SELECT id, name, display_name, dependencies_json, credit_cost
     FROM skills WHERE skill_type = 'composite' AND active = 1 AND public = 1`
  ).all() as { id: string; name: string; display_name: string | null; dependencies_json: string | null; credit_cost: number }[];

  const nodes: { id: string; name: string; type: 'composite' | 'dependency'; creditCost: number }[] = [];
  const edges: { from: string; to: string; outputKey: string }[] = [];
  const seenNodes = new Set<string>();

  for (const comp of composites) {
    if (!seenNodes.has(comp.id)) {
      nodes.push({ id: comp.id, name: comp.display_name ?? comp.name, type: 'composite', creditCost: comp.credit_cost });
      seenNodes.add(comp.id);
    }
    if (!comp.dependencies_json) continue;

    let deps: { skillId: string; outputKey: string }[];
    try { deps = JSON.parse(comp.dependencies_json); } catch { continue; }

    for (const dep of deps) {
      if (!seenNodes.has(dep.skillId)) {
        const depSkill = db.prepare('SELECT name, display_name, credit_cost FROM skills WHERE id = ?')
          .get(dep.skillId) as { name: string; display_name: string | null; credit_cost: number } | undefined;
        if (depSkill) {
          nodes.push({ id: dep.skillId, name: depSkill.display_name ?? depSkill.name, type: 'dependency', creditCost: depSkill.credit_cost });
          seenNodes.add(dep.skillId);
        }
      }
      edges.push({ from: comp.id, to: dep.skillId, outputKey: dep.outputKey });
    }
  }

  return c.json({ nodes, edges, compositeCount: composites.length });
});

function reputationResponse(c: any, agentKey: string) {
  const score = getReputationScore(agentKey);
  const events = getReputationEvents(agentKey, 20);

  // Trust level based on event count
  let trustLevel: string;
  if (events.length >= 200) trustLevel = 'trusted';
  else if (events.length >= 50) trustLevel = 'established';
  else if (events.length >= 10) trustLevel = 'emerging';
  else trustLevel = 'new';

  return c.json({
    agentKey: maskApiKey(agentKey),
    score,
    trustLevel,
    recentEvents: events,
  });
}

export { economyRouter };
