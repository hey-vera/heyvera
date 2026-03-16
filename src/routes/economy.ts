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
  getSkill,
  getPenaltyInfo,
  createScheduledSkill,
  getScheduledSkills,
  deleteScheduledSkill,
  createSession,
  getSession,
  updateSessionState,
  listSessions,
  deleteSession,
  safeJsonParse,
} from '../db/index';
import { estimateCompositeCost } from '../core/composite-executor';
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
      permissions: safeJsonParse(k.permissions_json, []),
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

// ─── Receipt Verification (public intent — but router-level auth applies) ──
// IMPORTANT: Must be defined BEFORE /receipts/:id to avoid route shadowing

economyRouter.get('/receipts/verify/:transactionId', (c) => {
  const txId = c.req.param('transactionId');
  const db = getDb();
  const tx = db.prepare(
    `SELECT id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, request_hash, result_hash, created_at
     FROM transactions WHERE id = ?`
  ).get(txId) as {
    id: string; from_agent: string | null; to_agent: string | null;
    amount_credits: number; type: string; skill_id: string | null;
    fee_credits: number; request_hash: string | null; result_hash: string | null; created_at: string;
  } | undefined;

  if (!tx) return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404);

  return c.json({
    verified: !!(tx.request_hash && tx.result_hash),
    transaction: {
      id: tx.id,
      type: tx.type,
      credits: tx.amount_credits,
      fee: tx.fee_credits,
      skillId: tx.skill_id,
      from: tx.from_agent ? maskApiKey(tx.from_agent) : null,
      to: tx.to_agent ? maskApiKey(tx.to_agent) : null,
      requestHash: tx.request_hash,
      resultHash: tx.result_hash,
      timestamp: tx.created_at,
    },
    integrity: tx.request_hash && tx.result_hash
      ? 'Both request and result hashes present — transaction is cryptographically verifiable'
      : 'Missing hash(es) — transaction predates receipt system or was not hash-eligible',
  });
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
      events: safeJsonParse(h.events_json, ['*']),
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

// ─── Cost Estimation ────────────────────────────────────────────────────────

economyRouter.get('/estimate/:skillId', (c) => {
  const skillId = c.req.param('skillId');
  const skill = getSkill(skillId);
  if (!skill) return c.json({ error: 'Skill not found', code: 'NOT_FOUND' }, 404);
  if (skill.skill_type !== 'composite') {
    return c.json({
      skillId, skillType: skill.skill_type,
      totalCredits: Math.max(0.001, skill.credit_cost),
      assemblyFee: 0, dependencies: [],
      maxCredits: Math.max(0.001, skill.credit_cost),
    });
  }
  const estimate = estimateCompositeCost(skill);
  if ('error' in estimate) return c.json({ error: estimate.error, code: 'ESTIMATION_FAILED' }, 400);
  return c.json({ skillId, ...estimate });
});

// ─── Penalty Info ───────────────────────────────────────────────────────────

economyRouter.get('/penalty/:skillId', (c) => {
  const skillId = c.req.param('skillId');
  const info = getPenaltyInfo(skillId);
  return c.json({
    skillId,
    penaltyTier: info.tier,
    tierLabel: info.tier === 0 ? 'CLEAN' : info.tier === 1 ? 'WARNING' : info.tier === 2 ? 'REDUCED_VISIBILITY' : 'DELISTED',
    recentViolations: info.recentViolations,
    updatedAt: info.updatedAt,
    description: info.tier === 0 ? 'No penalties — skill in good standing'
      : info.tier === 1 ? 'Warning issued — 3+ SLA violations in last 7 days'
      : info.tier === 2 ? 'Reduced visibility — excluded from featured and compare results'
      : 'Delisted — skill has been automatically unpublished due to repeated SLA violations',
  });
});

// ─── Scheduled Skills ───────────────────────────────────────────────────────

economyRouter.post('/scheduled-skills', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot schedule skills', code: 'FORBIDDEN' }, 403);

  let body: {
    skillId?: string; variables?: Record<string, string>; cronExpression?: string;
    maxCreditsPerRun?: number; sessionId?: string;
    triggerType?: 'cron' | 'context_change' | 'threshold'; triggerConfig?: Record<string, unknown>;
  };
  try { body = await c.req.json(); } catch {
    return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400);
  }

  if (!body.skillId || typeof body.skillId !== 'string') {
    return c.json({ error: 'skillId required', code: 'VALIDATION_ERROR' }, 400);
  }

  if (!body.cronExpression || typeof body.cronExpression !== 'string') {
    return c.json({ error: 'cronExpression required (e.g., "*/30 * * * *" for every 30 min)', code: 'VALIDATION_ERROR' }, 400);
  }

  // Validate trigger type
  const validTriggers = ['cron', 'context_change', 'threshold'];
  if (body.triggerType && !validTriggers.includes(body.triggerType)) {
    return c.json({ error: `triggerType must be one of: ${validTriggers.join(', ')}`, code: 'VALIDATION_ERROR' }, 400);
  }

  // Validate session exists if provided
  if (body.sessionId) {
    const session = getSession(body.sessionId, keyInfo.key);
    if (!session) return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
  }

  // Validate skill exists
  const skill = getSkill(body.skillId);
  if (!skill) return c.json({ error: 'Skill not found', code: 'NOT_FOUND' }, 404);

  // Limit to 20 scheduled skills per key
  const existing = getScheduledSkills(keyInfo.key);
  if (existing.length >= 20) {
    return c.json({ error: 'Maximum 20 scheduled skills per key', code: 'LIMIT_REACHED' }, 400);
  }

  // Simple next run calculation — 1 minute from now
  const nextRunAt = new Date(Date.now() + 60_000).toISOString();

  const id = createScheduledSkill({
    skillId: body.skillId,
    callerKey: keyInfo.key,
    variables: body.variables,
    cronExpression: body.cronExpression,
    nextRunAt,
    maxCreditsPerRun: body.maxCreditsPerRun,
  });

  // If v2 params are provided, update the record with session/trigger info
  if (body.sessionId || body.triggerType || body.triggerConfig) {
    const db = getDb();
    db.prepare('UPDATE scheduled_skills SET session_id = ?, trigger_type = ?, trigger_config_json = ? WHERE id = ?')
      .run(body.sessionId ?? null, body.triggerType ?? 'cron', body.triggerConfig ? JSON.stringify(body.triggerConfig) : null, id);
  }

  return c.json({
    ok: true,
    scheduledId: id,
    skillId: body.skillId,
    cronExpression: body.cronExpression,
    nextRunAt,
    maxCreditsPerRun: body.maxCreditsPerRun ?? null,
    sessionId: body.sessionId ?? null,
    triggerType: body.triggerType ?? 'cron',
  }, 201);
});

economyRouter.get('/scheduled-skills', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const schedules = getScheduledSkills(keyInfo.key);
  return c.json({
    schedules: schedules.map(s => ({
      id: s.id,
      skillId: s.skill_id,
      cronExpression: s.cron_expression,
      nextRunAt: s.next_run_at,
      lastRunAt: s.last_run_at,
      lastStatus: s.last_status,
      lastError: s.last_error,
      totalRuns: s.total_runs,
      totalCreditsSpent: s.total_credits_spent,
      maxCreditsPerRun: s.max_credits_per_run,
      createdAt: s.created_at,
    })),
    count: schedules.length,
  });
});

economyRouter.delete('/scheduled-skills/:id', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const id = c.req.param('id');
  const deleted = deleteScheduledSkill(keyInfo.key, id);
  if (!deleted) return c.json({ error: 'Scheduled skill not found', code: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, deleted: id });
});

// ─── Agent Sessions ──────────────────────────────────────────────────────────

economyRouter.post('/sessions', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  if (keyInfo.isEnvKey) return c.json({ error: 'Env keys cannot create sessions', code: 'FORBIDDEN' }, 403);

  let body: { name?: string };
  try { body = await c.req.json(); } catch { body = {}; }

  try {
    const session = createSession(keyInfo.key, typeof body.name === 'string' ? body.name.slice(0, 100) : undefined);
    return c.json({ ok: true, ...session }, 201);
  } catch (err) {
    return c.json({ error: env.NODE_ENV === 'production' ? 'Failed to create session' : (err instanceof Error ? err.message : String(err)), code: 'SESSION_ERROR' }, 400);
  }
});

economyRouter.get('/sessions', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const sessions = listSessions(keyInfo.key);
  return c.json({ sessions, count: sessions.length });
});

economyRouter.get('/sessions/:id', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const session = getSession(c.req.param('id'), keyInfo.key);
  if (!session) return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
  return c.json(session);
});

economyRouter.patch('/sessions/:id', async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  let body: { state?: Record<string, unknown> };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  if (!body.state || typeof body.state !== 'object') {
    return c.json({ error: 'state object required', code: 'VALIDATION_ERROR' }, 400);
  }

  try {
    const merged = updateSessionState(c.req.param('id'), keyInfo.key, body.state);
    return c.json({ ok: true, state: merged });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Update failed';
    const status = msg === 'Session not found' ? 404 : 400;
    const safeMsg = env.NODE_ENV === 'production' ? (status === 404 ? 'Session not found' : 'Update failed') : msg;
    return c.json({ error: safeMsg, code: status === 404 ? 'NOT_FOUND' : 'SESSION_ERROR' }, status);
  }
});

economyRouter.delete('/sessions/:id', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const deleted = deleteSession(c.req.param('id'), keyInfo.key);
  if (!deleted) return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, deleted: c.req.param('id') });
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
