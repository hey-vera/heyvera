import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import {
  getMarketplaceSkills, marketplacePurchase, stakeCredits, unstakeCredits,
  getStakes, getSkillStakeTotal, getTransactions, getSkill, writeAuditLog,
  getCreatorStats, getSkillsByAuthor,
} from '../db/index';
import { logger } from '../utils/logger';

export const marketplaceRouter = new Hono();

const PLATFORM_FEE_PCT = 0.03; // 3% platform fee on all marketplace purchases

// ─── GET /v1/marketplace/skills — browse the skill catalog ───────────────────

const ListQuery = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  sort:   z.enum(['popular', 'price_asc', 'price_desc', 'newest', 'reputation']).default('popular'),
  tags:   z.string().optional(),
  search: z.string().optional(),
});

marketplaceRouter.get('/skills', (c) => {
  let q: z.infer<typeof ListQuery>;
  try { q = ListQuery.parse(c.req.query()); } catch { return c.json({ error: 'Invalid query params' }, 400); }

  const { skills, total } = getMarketplaceSkills({
    page: q.page, limit: q.limit, sort: q.sort,
    tags: q.tags, search: q.search,
  });

  return c.json({
    page: q.page,
    limit: q.limit,
    total,
    pages: Math.ceil(total / q.limit),
    skills: skills.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      version: s.version ?? '1.0.0',
      creditCost: s.credit_cost,
      uses: s.uses,
      stakeTotal: s.stake_total,
      tags: s.tags_json ? JSON.parse(s.tags_json) : [],
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

  const stakeTotal = getSkillStakeTotal(id);
  return c.json({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version ?? '1.0.0',
    creditCost: skill.credit_cost,
    uses: skill.uses,
    stakeTotal,
    tags: skill.tags_json ? JSON.parse(skill.tags_json) : [],
    inputSchema: skill.input_schema_json ? JSON.parse(skill.input_schema_json) : null,
    outputSchema: skill.output_schema_json ? JSON.parse(skill.output_schema_json) : null,
    publishedAt: skill.published_at,
    platformFeePct: PLATFORM_FEE_PCT,
    totalCost: skill.credit_cost,
    feeCredits: Math.floor(skill.credit_cost * PLATFORM_FEE_PCT),
    sellerReceives: skill.credit_cost - Math.floor(skill.credit_cost * PLATFORM_FEE_PCT),
  });
});

// ─── POST /v1/marketplace/skills/:id/purchase — buy + invoke ──────────────────

const PurchaseBody = z.object({
  variables: z.record(z.string()).optional().default({}),
});

marketplaceRouter.post('/skills/:id/purchase', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);
  if (skill.author_key === keyInfo.key) return c.json({ error: 'Cannot purchase your own skill' }, 400);
  if (skill.credit_cost === 0) return c.json({ error: 'This skill is free — use POST /v1/skills/:id/invoke directly' }, 400);

  let body: z.infer<typeof PurchaseBody>;
  try { body = PurchaseBody.parse(await c.req.json()); } catch { body = { variables: {} }; }

  // Process payment atomically
  const purchase = marketplacePurchase({
    buyerKey: keyInfo.key,
    sellerKey: skill.author_key,
    amountCredits: skill.credit_cost,
    feePct: PLATFORM_FEE_PCT,
    skillId: id,
  });

  if (!purchase.ok) {
    return c.json({
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

  logger.info({ skillId: id, buyer: keyInfo.key.slice(0, 8), txId: purchase.txId }, 'Marketplace purchase');

  // Redirect buyer to invoke the skill directly (payment already settled)
  return c.json({
    ok: true,
    txId: purchase.txId,
    creditsCharged: skill.credit_cost,
    feeCredits: purchase.feeCredits,
    sellerReceives: purchase.sellerCredits,
    message: 'Payment settled. Invoke the skill at POST /v1/skills/:id/invoke with your variables.',
    invokeUrl: `POST /v1/skills/${id}/invoke`,
    hint: `Pass { "variables": ${JSON.stringify(body.variables)} } to the invoke endpoint.`,
  });
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
      counterparty: t.from_agent === keyInfo.key ? t.to_agent : t.from_agent,
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
