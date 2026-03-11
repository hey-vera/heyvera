import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { maskApiKey } from '../utils/mask';
import { checkApiKey } from '../middleware/auth';
import {
  getMarketplaceSkills, marketplacePurchase, marketplaceRefund, stakeCredits, unstakeCredits,
  getStakes, getSkillStakeTotal, getTransactions, getSkill, writeAuditLog,
  getCreatorStats, getSkillsByAuthor,
  createPayoutRequest, getPayoutRequests,
  safeJsonParse, incrementSkillUses, recordSkillMetric, recordReputation,
  insertOrchestration, starSkill, unstarSkill, hasStarred, incrementSkillViews,
  reportSkill, getSkillVersionHistory,
} from '../db/index';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { buildIntentFromPlan } from '../core/skill-executor';
import { isSimulationMode } from '../config/index';
import { logger } from '../utils/logger';

export const marketplaceRouter = new Hono();

const PLATFORM_FEE_PCT = 0.03; // 3% platform fee on all marketplace purchases

/** Calculate platform fee credits for a skill. Official skills are fee-exempt.
 *  Third-party skills priced ≥10 credits pay at least 1 credit. */
function calcFee(creditCost: number, authorKey: string): number {
  if (authorKey === 'clawhub-official') return 0;
  const fee = Math.floor(creditCost * PLATFORM_FEE_PCT);
  return fee === 0 && creditCost >= 10 ? 1 : fee;
}

// ─── GET /v1/marketplace/skills — browse the skill catalog ───────────────────

const ListQuery = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  sort:     z.enum(['popular', 'price_asc', 'price_desc', 'newest', 'reputation', 'stars']).default('popular'),
  tags:     z.string().optional(),
  search:   z.string().optional(),
  category: z.string().optional(),
});

marketplaceRouter.get('/skills', (c) => {
  let q: z.infer<typeof ListQuery>;
  try { q = ListQuery.parse(c.req.query()); } catch { return c.json({ error: 'Invalid query params' }, 400); }

  const { skills, total } = getMarketplaceSkills({
    page: q.page, limit: q.limit, sort: q.sort,
    tags: q.tags, search: q.search, category: q.category,
  });

  return c.json({
    page: q.page,
    limit: q.limit,
    total,
    pages: Math.ceil(total / q.limit),
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      displayName: s.display_name ?? s.name,
      description: s.description,
      version: s.version ?? '1.0.0',
      creditCost: s.credit_cost,
      uses: s.uses,
      stars: s.stars ?? 0,
      views: s.views ?? 0,
      forks: s.forks ?? 0,
      stakeTotal: s.stake_total,
      tags: safeJsonParse(s.tags_json, []),
      category: s.category ?? 'general',
      license: s.license ?? 'MIT',
      securityStatus: s.security_status ?? 'UNSCANNED',
      status: s.status ?? 'PUBLISHED',
      publishedAt: s.published_at,
      invokeUrl: `POST /v1/skills/${s.id}/invoke`,
    })),
    platformFeePct: PLATFORM_FEE_PCT,
  });
});

// ─── GET /v1/marketplace/skills/:id — single skill detail ─────────────────────

marketplaceRouter.get('/skills/:id', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  incrementSkillViews(id);
  const stakeTotal = getSkillStakeTotal(id);
  return c.json({
    id: skill.id,
    name: skill.name,
    displayName: skill.display_name ?? skill.name,
    description: skill.description,
    version: skill.version ?? '1.0.0',
    changelog: skill.changelog ?? null,
    creditCost: skill.credit_cost,
    uses: skill.uses,
    stars: skill.stars ?? 0,
    views: (skill.views ?? 0) + 1,
    forks: skill.forks ?? 0,
    stakeTotal,
    tags: safeJsonParse(skill.tags_json, []),
    category: skill.category ?? 'general',
    inputSchema: safeJsonParse(skill.input_schema_json, null),
    outputSchema: safeJsonParse(skill.output_schema_json, null),
    readme: skill.readme ?? null,
    license: skill.license ?? 'MIT',
    runtime: safeJsonParse(skill.runtime_json, null),
    securityStatus: skill.security_status ?? 'UNSCANNED',
    scannedAt: skill.scanned_at ?? null,
    status: skill.status ?? 'PUBLISHED',
    publishedAt: skill.published_at,
    platformFeePct: PLATFORM_FEE_PCT,
    totalCost: skill.credit_cost,
    feeCredits: calcFee(skill.credit_cost, skill.author_key),
    sellerReceives: skill.credit_cost - calcFee(skill.credit_cost, skill.author_key),
  });
});

// ─── POST /v1/marketplace/skills/:id/star — star a skill ─────────────────────

marketplaceRouter.post('/skills/:id/star', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  const result = starSkill(id, keyInfo.key);
  if (!result.ok) return c.json({ error: 'Already starred' }, 409);
  return c.json({ ok: true, stars: (skill.stars ?? 0) + 1 });
});

// ─── DELETE /v1/marketplace/skills/:id/star — unstar a skill ─────────────────

marketplaceRouter.delete('/skills/:id/star', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  const result = unstarSkill(id, keyInfo.key);
  if (!result.ok) return c.json({ error: 'Not starred' }, 409);
  return c.json({ ok: true, stars: Math.max(0, (skill.stars ?? 0) - 1) });
});

// ─── GET /v1/marketplace/skills/:id/starred — check if you starred a skill ───

marketplaceRouter.get('/skills/:id/starred', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ starred: hasStarred(id, keyInfo.key), stars: skill.stars ?? 0 });
});

// ─── POST /v1/marketplace/skills/:id/purchase — buy AND execute in one call ───
// Payment is settled atomically, then the skill executes immediately.
// The user is charged ONCE (credit_cost to seller). No second charge on invoke.

const PurchaseBody = z.object({
  variables: z.record(z.string().max(500)).optional().default({}),
});

marketplaceRouter.post('/skills/:id/purchase', checkApiKey, async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ requestId, error: 'Skill not found' }, 404);
  if (skill.author_key === keyInfo.key) return c.json({ requestId, error: 'Cannot purchase your own skill' }, 400);
  if (skill.credit_cost === 0) return c.json({ requestId, error: 'This skill is free — use POST /v1/skills/:id/invoke directly' }, 400);

  let body: z.infer<typeof PurchaseBody>;
  try {
    body = PurchaseBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ requestId, error: 'Invalid body', details: (err as Error).message }, 400);
  }

  // Pre-validate template variables BEFORE payment — avoid unnecessary refund transactions.
  const requiredVars = [...skill.prompt_template.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  const missingVars = requiredVars.filter(v => !(v in body.variables));
  if (missingVars.length > 0) {
    return c.json({ requestId, error: `Missing required variables: ${missingVars.join(', ')}`, code: 'MISSING_VARIABLES' }, 400);
  }

  // Block prompt_template skills when data providers are offline (simulation mode).
  // api_proxy skills fetch external URLs directly and are unaffected.
  const skillType = (skill as typeof skill & { skill_type?: string }).skill_type ?? 'prompt_template';
  if (isSimulationMode && skillType !== 'api_proxy') {
    return c.json({
      requestId,
      error: 'Live data provider offline',
      code: 'SIMULATION_MODE',
      hint: 'This skill requires live blockchain data. The data provider is not currently connected. No credits were charged.',
    }, 503);
  }

  // Settle payment atomically BEFORE execution — buyer pays credit_cost to seller.
  // The invoke endpoint is NOT called after this; execution happens inline below.
  const purchase = marketplacePurchase({
    buyerKey: keyInfo.key,
    sellerKey: skill.author_key,
    amountCredits: skill.credit_cost,
    feePct: PLATFORM_FEE_PCT,
    skillId: id,
  });

  if (!purchase.ok) {
    return c.json({
      requestId,
      error: purchase.error,
      code: 'INSUFFICIENT_CREDITS',
      creditsRequired: skill.credit_cost,
      creditsAvailable: keyInfo.credits,
    }, 402);
  }

  writeAuditLog({
    entityType: 'marketplace', entityId: id,
    action: 'PURCHASE', actorId: keyInfo.key,
    data: { txId: purchase.txId, amount: skill.credit_cost, fee: purchase.feeCredits, sellerReceives: purchase.sellerCredits },
  });

  logger.info({ requestId, skillId: id, buyer: keyInfo.key.slice(0, 8), txId: purchase.txId }, 'Marketplace purchase + execute');

  // Execute the skill inline — no second credit charge.
  // Render the prompt template with provided variables.
  let query: string;
  try {
    query = skill.prompt_template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (!(key in body.variables)) throw new Error(`Missing required variable: ${key}`);
      return String(body.variables[key]).slice(0, 500);
    });
  } catch (err) {
    // Refund — execution failed due to missing variables (user error, but no work was done)
    const refund = marketplaceRefund({
      buyerKey: keyInfo.key, sellerKey: skill.author_key,
      amountCredits: skill.credit_cost, feeCredits: purchase.feeCredits ?? 0,
      sellerCredits: purchase.sellerCredits ?? 0, originalTxId: purchase.txId!,
      skillId: id, reason: 'Missing template variables',
    });
    return c.json({
      requestId, ok: false,
      refunded: refund.ok, refundTxId: refund.refundTxId,
      error: (err as Error).message, code: 'MISSING_VARIABLES',
      hint: 'Payment refunded. Call again with all required variables.',
    }, 400);
  }

  try {
    // Use deterministic execution plan if skill has one — skips LLM intent parsing (~3-5s saved)
    const skillWithPlan = skill as typeof skill & { execution_plan_json?: string | null };
    const intent = (skillWithPlan.execution_plan_json
      ? buildIntentFromPlan(skillWithPlan.execution_plan_json, body.variables, skill.name)
      : null) ?? await parseIntent(query);
    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    incrementSkillUses(id);
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: true, costCredits: skill.credit_cost });
    if (skill.author_key !== keyInfo.key) {
      recordReputation({ agentId: skill.author_key, skillId: id, eventType: 'SKILL_INVOKED', scoreDelta: 0.1, data: { via: 'marketplace' } });
    }
    insertOrchestration({
      id: requestId, timestamp: new Date().toISOString(), query: query.slice(0, 500), plannedSteps: intent.steps.length,
      executedSteps: execution.steps.length, successfulSteps: execution.steps.filter(s => s.success).length,
      cacheHits: execution.steps.filter(s => s.cached).length, totalDurationMs: Date.now() - start,
      apiCost: execution.totalCost, markup: 0, total: skill.credit_cost,
      success: true, llmProvider: 'openai', apiKey: keyInfo.key, skillId: id,
    });

    return c.json({
      requestId, ok: true,
      txId: purchase.txId,
      creditsCharged: skill.credit_cost,
      feeCredits: purchase.feeCredits,
      sellerReceives: purchase.sellerCredits,
      answer: formatted.answer,
      steps: execution.steps.length,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    logger.error({ requestId, skillId: id, err }, 'Marketplace execute failed after payment — refunding');
    // Refund buyer — skill execution failed, no value delivered
    const refund = marketplaceRefund({
      buyerKey: keyInfo.key, sellerKey: skill.author_key,
      amountCredits: skill.credit_cost, feeCredits: purchase.feeCredits ?? 0,
      sellerCredits: purchase.sellerCredits ?? 0, originalTxId: purchase.txId!,
      skillId: id, reason: 'Execution failed',
    });
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: false, costCredits: 0 });
    return c.json({
      requestId, ok: false,
      refunded: refund.ok, refundTxId: refund.refundTxId,
      error: 'Skill execution failed. Payment has been refunded.',
      code: 'EXECUTION_ERROR',
    }, 500);
  }
});

// ─── GET /v1/marketplace/transactions — caller's transaction history ──────────

marketplaceRouter.get('/transactions', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const limit = Math.min(100, parseInt(c.req.query('limit') ?? '50', 10) || 50);
  const txs = getTransactions(keyInfo.key, limit);

  return c.json({
    total: txs.length,
    transactions: txs.map(t => ({
      id: t.id,
      type: t.type,
      skillId: t.skill_id,
      amountCredits: t.amount_credits,
      feeCredits: t.fee_credits,
      direction: t.from_agent === keyInfo.key ? 'OUT' : 'IN',
      counterparty: (() => { const k = t.from_agent === keyInfo.key ? t.to_agent : t.from_agent; return k ? maskApiKey(k) : null; })(),
      createdAt: t.created_at,
    })),
  });
});

// ─── POST /v1/marketplace/stake — stake credits to boost skill visibility ──────

const StakeBody = z.object({
  amountCredits: z.number().int().min(1),
  skillId: z.string().optional(),
  lockDays: z.number().int().min(1).max(365).default(30),
});

marketplaceRouter.post('/stake', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  let body: z.infer<typeof StakeBody>;
  try { body = StakeBody.parse(await c.req.json()); } catch (err) {
    return c.json({ error: 'Invalid body', details: (err as Error).message }, 400);
  }

  // Validate skill exists if provided
  if (body.skillId) {
    const skill = getSkill(body.skillId);
    if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);
  }

  const result = stakeCredits({
    agentKey: keyInfo.key,
    amountCredits: body.amountCredits,
    skillId: body.skillId,
    lockDays: body.lockDays,
  });

  if (!result.ok) return c.json({ error: result.error, code: 'INSUFFICIENT_CREDITS' }, 402);

  writeAuditLog({
    entityType: 'stake', entityId: result.stakeId!,
    action: 'STAKED', actorId: keyInfo.key,
    data: { amount: body.amountCredits, skillId: body.skillId, lockDays: body.lockDays },
  });

  return c.json({
    stakeId: result.stakeId,
    amountCredits: body.amountCredits,
    skillId: body.skillId ?? null,
    lockDays: body.lockDays,
    message: `${body.amountCredits} credits staked for ${body.lockDays} days`,
  }, 201);
});

// ─── POST /v1/marketplace/unstake/:stakeId — reclaim staked credits ────────────

marketplaceRouter.post('/unstake/:stakeId', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { stakeId } = c.req.param();

  const result = unstakeCredits(stakeId, keyInfo.key);
  if (!result.ok) return c.json({ error: result.error }, 400);

  writeAuditLog({ entityType: 'stake', entityId: stakeId, action: 'UNSTAKED', actorId: keyInfo.key });
  return c.json({ ok: true, stakeId, message: 'Credits returned to your balance' });
});

// ─── GET /v1/marketplace/stakes — view your active stakes ─────────────────────

marketplaceRouter.get('/stakes', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const stakes = getStakes(keyInfo.key);
  return c.json({
    total: stakes.length,
    stakes: stakes.map(s => ({
      id: s.id,
      skillId: s.skill_id,
      amountCredits: s.amount_credits,
      stakedAt: s.staked_at,
      unlocksAt: s.unlocks_at,
      locked: new Date(s.unlocks_at) > new Date(),
    })),
  });
});

// ─── GET /v1/marketplace/creator/stats — earnings dashboard ───────────────────

marketplaceRouter.get('/creator/stats', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const stats = getCreatorStats(keyInfo.key);
  const mySkills = getSkillsByAuthor(keyInfo.key);

  return c.json({
    totalEarned: stats.totalEarned,
    totalSales: stats.totalSales,
    publishedSkills: mySkills.length,
    skills: mySkills.map(s => {
      const breakdown = stats.skillBreakdown.find(b => b.skillId === s.id);
      return {
        id: s.id,
        name: s.name,
        creditCost: s.credit_cost,
        uses: s.uses,
        public: !!s.public,
        earned: breakdown?.earned ?? 0,
        sales: breakdown?.sales ?? 0,
        version: s.version ?? '1.0.0',
        publishedAt: s.published_at,
      };
    }),
  });
});

// ─── POST /v1/marketplace/creator/withdraw — request USDC payout ───────────────

const WithdrawBody = z.object({
  amountCredits: z.number().int().min(1000),
  usdcWallet: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana address'),
});

marketplaceRouter.post('/creator/withdraw', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  let body: z.infer<typeof WithdrawBody>;
  try { body = WithdrawBody.parse(await c.req.json()); } catch (err) {
    return c.json({ error: 'Invalid body', details: (err as Error).message }, 400);
  }

  const result = createPayoutRequest({
    agentKey: keyInfo.key,
    amountCredits: body.amountCredits,
    usdcWallet: body.usdcWallet,
  });

  if (!result.ok) return c.json({ error: result.error }, 400);

  writeAuditLog({
    entityType: 'payout', entityId: result.id!,
    action: 'WITHDRAW_REQUESTED', actorId: keyInfo.key,
    data: { amountCredits: body.amountCredits, usdcWallet: maskApiKey(body.usdcWallet) },
  });

  logger.info({ id: result.id, key: keyInfo.key.slice(0, 8), credits: body.amountCredits }, 'Payout requested');

  return c.json({
    ok: true,
    payoutId: result.id,
    amountCredits: body.amountCredits,
    usdcEquivalent: (body.amountCredits * 0.00075).toFixed(4), // $0.75/1K — below min buy rate to prevent arbitrage
    status: 'PENDING',
    message: 'Payout queued. USDC will be sent to your wallet within 48h. You will be notified.',
  }, 201);
});

// ─── GET /v1/marketplace/creator/withdrawals — payout history ─────────────────

marketplaceRouter.get('/creator/withdrawals', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const payouts = getPayoutRequests(keyInfo.key);
  return c.json({
    total: payouts.length,
    withdrawals: payouts.map(p => ({
      id: p.id,
      amountCredits: p.amount_credits,
      usdcEquivalent: (p.amount_credits * 0.00075).toFixed(4),
      usdcWallet: p.usdc_wallet,
      status: p.status,
      notes: p.notes,
      createdAt: p.created_at,
      processedAt: p.processed_at,
    })),
  });
});

// ─── POST /v1/marketplace/skills/:id/report — community flagging ──────────────

const ReportBody = z.object({
  reason: z.string().min(5).max(500).trim(),
});

marketplaceRouter.post('/skills/:id/report', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  let body: z.infer<typeof ReportBody>;
  try { body = ReportBody.parse(await c.req.json()); }
  catch { return c.json({ error: 'reason is required (5-500 chars)' }, 400); }

  const result = reportSkill(id, keyInfo.key, body.reason);
  if (!result.ok) return c.json({ error: result.error ?? 'Report failed' }, 409);

  return c.json({ ok: true, reportCount: result.reportCount, message: 'Thank you for your report. Our team will review it.' });
});

// ─── GET /v1/marketplace/skills/:id/versions — version history ────────────────

marketplaceRouter.get('/skills/:id/versions', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  const versions = getSkillVersionHistory(id);
  return c.json({ skillId: id, versions });
});

// ─── GET /v1/marketplace/search — semantic skill search ───────────────────────

marketplaceRouter.get('/search', async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2) return c.json({ error: 'q is required (min 2 chars)' }, 400);

  // Fall back to text-based marketplace search
  const { skills } = getMarketplaceSkills({ page: 1, limit: 20, sort: 'popular', search: q });
  return c.json({
    query: q,
    results: skills.map(s => ({
      id: s.id,
      name: s.name,
      displayName: s.display_name ?? s.name,
      description: s.description,
      creditCost: s.credit_cost,
      uses: s.uses,
      stars: s.stars ?? 0,
      securityStatus: s.security_status ?? 'UNSCANNED',
      category: s.category ?? 'general',
      tags: safeJsonParse(s.tags_json, []),
    })),
  });
});
