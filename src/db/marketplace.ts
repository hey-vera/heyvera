import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';
import type { Skill } from './skills';

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  from_agent: string | null;
  to_agent: string | null;
  amount_credits: number;
  type: string;
  skill_id: string | null;
  fee_credits: number;
  metadata_json: string | null;
  created_at: string;
}

export function recordTransaction(params: {
  fromAgent?: string;
  toAgent?: string;
  amountCredits: number;
  type: string;
  skillId?: string;
  feeCredits?: number;
  metadata?: Record<string, unknown>;
}): string {
  const id = nanoid(16);
  getDb()
    .prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, params.fromAgent ?? null, params.toAgent ?? null,
      params.amountCredits, params.type, params.skillId ?? null,
      params.feeCredits ?? 0, params.metadata ? JSON.stringify(params.metadata) : null);
  return id;
}

export function getTransactions(agentKey: string, limit = 50): Transaction[] {
  return getDb()
    .prepare(`SELECT * FROM transactions WHERE from_agent = ? OR to_agent = ? ORDER BY created_at DESC LIMIT ?`)
    .all(agentKey, agentKey, limit) as Transaction[];
}

export function getCreatorStats(authorKey: string): {
  totalEarned: number;
  totalSales: number;
  skillBreakdown: { skillId: string; earned: number; sales: number }[];
} {
  const db = getDb();
  const rows = db.prepare(`
    SELECT skill_id, SUM(amount_credits) as earned, COUNT(*) as sales
    FROM transactions
    WHERE to_agent = ? AND type = 'SKILL_SALE'
    GROUP BY skill_id
    LIMIT 1000
  `).all(authorKey) as { skill_id: string; earned: number; sales: number }[];

  const totalEarned = rows.reduce((s, r) => s + r.earned, 0);
  const totalSales  = rows.reduce((s, r) => s + r.sales, 0);
  return {
    totalEarned,
    totalSales,
    skillBreakdown: rows.map(r => ({ skillId: r.skill_id, earned: r.earned, sales: r.sales })),
  };
}

export function getPlatformRevenue(): { totalFeeCredits: number; totalSales: number } {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(fee_credits), 0) as totalFeeCredits, COUNT(*) as totalSales
              FROM transactions WHERE type = 'SKILL_SALE'`)
    .get() as { totalFeeCredits: number; totalSales: number };
  return row;
}

// ─── Marketplace Purchase / Refund ───────────────────────────────────────────

export function marketplacePurchase(params: {
  buyerKey: string;
  sellerKey: string;
  amountCredits: number;
  feePct: number;
  skillId: string;
}): { ok: boolean; txId?: string; error?: string; feeCredits?: number; sellerCredits?: number } {
  const db = getDb();
  if (params.buyerKey === params.sellerKey) {
    return { ok: false, error: 'Cannot purchase your own skill' };
  }

  let txId = '';
  let feeCredits = 0;
  let sellerCredits = 0;
  try {
    db.transaction(() => {
      feeCredits = params.sellerKey === 'clawhub-official'
        ? 0
        : Math.floor(params.amountCredits * params.feePct);
      if (feeCredits === 0 && params.sellerKey !== 'clawhub-official' && params.amountCredits >= 10) {
        feeCredits = 1;
      }
      sellerCredits = params.amountCredits - feeCredits;

      const buyerEmail = (db.prepare('SELECT email FROM api_keys WHERE key = ? AND active = 1').get(params.buyerKey) as { email: string } | undefined)?.email;
      const sellerEmail = (db.prepare('SELECT email FROM api_keys WHERE key = ? AND active = 1').get(params.sellerKey) as { email: string } | undefined)?.email;
      if (buyerEmail && sellerEmail && buyerEmail === sellerEmail) {
        throw new Error('Cannot purchase your own skill');
      }

      const deducted = db.prepare(
        `UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ?
         WHERE key = ? AND credits >= ? AND active = 1`
      ).run(params.amountCredits, params.amountCredits, params.buyerKey, params.amountCredits);
      if (deducted.changes === 0) throw new Error('Insufficient credits');

      const sellerResult = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1`)
        .run(sellerCredits, params.sellerKey);
      if (sellerResult.changes === 0) throw new Error('Seller has no active API key');

      if (feeCredits > 0) {
        const treasuryResult = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = 'clawhub-treasury' AND active = 1`)
          .run(feeCredits);
        if (treasuryResult.changes === 0) throw new Error('Treasury account not found or inactive');
      }

      txId = nanoid(16);
      db.prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
                  VALUES (?, ?, ?, ?, 'SKILL_SALE', ?, ?, ?)`)
        .run(txId, params.buyerKey, params.sellerKey, params.amountCredits,
          params.skillId, feeCredits, JSON.stringify({ feePct: params.feePct }));
    })();
    return { ok: true, txId, feeCredits, sellerCredits };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function marketplaceRefund(params: {
  buyerKey: string;
  sellerKey: string;
  amountCredits: number;
  feeCredits: number;
  sellerCredits: number;
  originalTxId: string;
  skillId: string;
  reason: string;
}): { ok: boolean; refundTxId?: string; error?: string } {
  const db = getDb();
  try {
    let refundTxId = '';
    db.transaction(() => {
      db.prepare(`UPDATE api_keys SET credits = credits + ?, credits_used = credits_used - ? WHERE key = ? AND active = 1`)
        .run(params.amountCredits, params.amountCredits, params.buyerKey);

      // Compute actual debits (balance may be less than requested — record deficit for audit)
      const sellerBal = db.prepare('SELECT credits FROM api_keys WHERE key = ? AND active = 1')
        .get(params.sellerKey) as { credits: number } | undefined;
      const actualSellerDebit = Math.min(params.sellerCredits, sellerBal?.credits ?? 0);
      const sellerDeficit = params.sellerCredits - actualSellerDebit;
      if (sellerDeficit > 0) {
        logger.warn({ sellerKey: params.sellerKey.slice(0, 8), requested: params.sellerCredits, actual: actualSellerDebit, deficit: sellerDeficit },
          'marketplaceRefund: seller balance insufficient — partial debit, deficit recorded in tx metadata');
      }
      db.prepare(`UPDATE api_keys SET credits = MAX(0, credits - ?) WHERE key = ? AND active = 1`)
        .run(params.sellerCredits, params.sellerKey);

      let treasuryDeficit = 0;
      if (params.feeCredits > 0) {
        const treasuryBal = db.prepare(`SELECT credits FROM api_keys WHERE key = 'clawhub-treasury' AND active = 1`)
          .get() as { credits: number } | undefined;
        treasuryDeficit = params.feeCredits - Math.min(params.feeCredits, treasuryBal?.credits ?? 0);
        db.prepare(`UPDATE api_keys SET credits = MAX(0, credits - ?) WHERE key = 'clawhub-treasury' AND active = 1`)
          .run(params.feeCredits);
      }

      refundTxId = nanoid(16);
      db.prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
                  VALUES (?, ?, ?, ?, 'SKILL_REFUND', ?, ?, ?)`)
        .run(refundTxId, params.sellerKey, params.buyerKey, params.amountCredits,
          params.skillId, params.feeCredits, JSON.stringify({
            originalTxId: params.originalTxId,
            reason: params.reason,
            sellerDeficit,
            treasuryDeficit,
          }));
    })();
    return { ok: true, refundTxId };
  } catch (err) {
    logger.error({ err, buyerKey: params.buyerKey.slice(0, 8), skillId: params.skillId }, 'marketplaceRefund: transaction failed — manual intervention may be required');
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Marketplace Listing ──────────────────────────────────────────────────────

export function getMarketplaceSkills(params: {
  page: number;
  limit: number;
  sort: 'popular' | 'price_asc' | 'price_desc' | 'newest' | 'reputation' | 'stars';
  tags?: string;
  search?: string;
  category?: string;
}): { skills: (Skill & { stake_total: number })[]; total: number } {
  const offset = (params.page - 1) * params.limit;
  const orderMap = {
    popular:     'uses DESC',
    price_asc:   'credit_cost ASC',
    price_desc:  'credit_cost DESC',
    newest:      'published_at DESC',
    reputation:  'uses DESC',
    stars:       'stars DESC',
  };
  if (!(params.sort in orderMap)) throw new Error(`Invalid sort: ${params.sort}`);
  const order = orderMap[params.sort];

  let where = `s.public = 1 AND s.active = 1 AND (s.status IS NULL OR s.status = 'PUBLISHED')`;
  const args: unknown[] = [];

  if (params.tags) {
    where += ` AND s.tags_json LIKE ? ESCAPE '\\'`;
    args.push(`%${escapeLike(params.tags)}%`);
  }
  if (params.category) {
    where += ` AND (s.category = ? OR s.tags_json LIKE ? ESCAPE '\\')`;
    args.push(params.category, `%${escapeLike(params.category)}%`);
  }
  if (params.search) {
    where += ` AND (s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\')`;
    args.push(`%${escapeLike(params.search)}%`, `%${escapeLike(params.search)}%`);
  }

  const countRow = getDb()
    .prepare(`SELECT COUNT(*) as n FROM skills s WHERE ${where}`)
    .get(...args) as { n: number };

  const skills = getDb()
    .prepare(`
      SELECT s.*, COALESCE(st.total, 0) as stake_total
      FROM skills s
      LEFT JOIN (SELECT skill_id, SUM(amount_credits) as total FROM stakes GROUP BY skill_id) st
        ON st.skill_id = s.id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `)
    .all(...args, params.limit, offset) as (Skill & { stake_total: number })[];

  return { skills, total: countRow.n };
}

// ─── Staking ──────────────────────────────────────────────────────────────────

export interface Stake {
  id: string;
  agent_key: string;
  skill_id: string | null;
  amount_credits: number;
  staked_at: string;
  unlocks_at: string;
}

export function stakeCredits(params: {
  agentKey: string;
  amountCredits: number;
  skillId?: string;
  lockDays: number;
}): { ok: boolean; stakeId?: string; error?: string } {
  const db = getDb();
  const days = Math.max(1, Math.min(365, Math.floor(params.lockDays)));
  let stakeId = '';
  try {
    db.transaction(() => {
      const deducted = db.prepare(
        `UPDATE api_keys SET credits = credits - ? WHERE key = ? AND credits >= ? AND active = 1`
      ).run(params.amountCredits, params.agentKey, params.amountCredits);
      if (deducted.changes === 0) throw new Error('Insufficient credits');

      stakeId = nanoid(12);
      db.prepare(`INSERT INTO stakes (id, agent_key, skill_id, amount_credits, unlocks_at)
                  VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' days'))`)
        .run(stakeId, params.agentKey, params.skillId ?? null, params.amountCredits, days);
    })();
    logAudit({ entityType: 'stake', entityId: stakeId, action: 'STAKE_LOCK', actorId: params.agentKey, data: { amount: params.amountCredits, lockDays: days, skillId: params.skillId } });
    return { ok: true, stakeId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function unstakeCredits(stakeId: string, agentKey: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const stake = db.prepare(`SELECT * FROM stakes WHERE id = ? AND agent_key = ?`).get(stakeId, agentKey) as Stake | undefined;
      if (!stake) throw new Error('Stake not found');
      if (new Date(stake.unlocks_at) > new Date()) throw new Error(`Locked until ${stake.unlocks_at}`);

      db.prepare(`DELETE FROM stakes WHERE id = ?`).run(stakeId);
      const result = db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1`)
        .run(stake.amount_credits, agentKey);
      if (result.changes === 0) throw new Error('API key inactive — credits cannot be returned');
    })();
    logAudit({ entityType: 'stake', entityId: stakeId, action: 'STAKE_UNLOCK', actorId: agentKey });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getStakes(agentKey: string, limit = 200): Stake[] {
  return getDb()
    .prepare('SELECT * FROM stakes WHERE agent_key = ? ORDER BY staked_at DESC LIMIT ?')
    .all(agentKey, limit) as Stake[];
}

export function getSkillStakeTotal(skillId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount_credits), 0) as total FROM stakes WHERE skill_id = ?')
    .get(skillId) as { total: number };
  return row.total;
}

// ─── Payout Requests ──────────────────────────────────────────────────────────

export interface PayoutRequest {
  id: string;
  agent_key: string;
  amount_credits: number;
  usdc_wallet: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'REJECTED';
  notes: string | null;
  created_at: string;
  processed_at: string | null;
}

export function createPayoutRequest(params: {
  agentKey: string;
  amountCredits: number;
  usdcWallet: string;
}): { ok: boolean; id?: string; error?: string } {
  const db = getDb();
  const MIN_CREDITS = 1000;

  return db.transaction(() => {
    const earned = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits - fee_credits),0) as total FROM transactions WHERE to_agent = ? AND type = 'SKILL_SALE'`
    ).get(params.agentKey) as { total: number }).total;

    if (earned < MIN_CREDITS) return { ok: false, error: `Minimum ${MIN_CREDITS} credits earned required (you have ${earned})` };

    const pendingCount = (db.prepare(
      `SELECT COUNT(*) as cnt FROM payout_requests WHERE agent_key = ? AND status IN ('PENDING','PROCESSING')`
    ).get(params.agentKey) as { cnt: number }).cnt;
    if (pendingCount >= 3) return { ok: false, error: 'Maximum 3 pending withdrawal requests. Wait for existing requests to be processed.' };

    const pendingTotal = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM payout_requests WHERE agent_key = ? AND status IN ('PENDING','PROCESSING')`
    ).get(params.agentKey) as { total: number }).total;

    const alreadyPaid = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM payout_requests WHERE agent_key = ? AND status = 'PAID'`
    ).get(params.agentKey) as { total: number }).total;

    const staked = (db.prepare(
      `SELECT COALESCE(SUM(amount_credits),0) as total FROM stakes WHERE agent_key = ?`
    ).get(params.agentKey) as { total: number }).total;

    const keyRow = db.prepare(`SELECT credits FROM api_keys WHERE key = ?`).get(params.agentKey) as { credits: number } | undefined;
    const liquidBalance = (keyRow?.credits ?? 0) - pendingTotal - staked;

    const available = Math.min(earned - alreadyPaid - pendingTotal - staked, liquidBalance);
    if (params.amountCredits > available) return { ok: false, error: `Only ${available} credits available for withdrawal (${staked} locked in stakes)` };
    if (params.amountCredits < MIN_CREDITS) return { ok: false, error: `Minimum withdrawal is ${MIN_CREDITS} credits` };

    const id = nanoid(16);
    db.prepare(`INSERT INTO payout_requests (id, agent_key, amount_credits, usdc_wallet) VALUES (?, ?, ?, ?)`)
      .run(id, params.agentKey, params.amountCredits, params.usdcWallet);

    // Record in transactions ledger so creator stats and reconciliation can trace outflows.
    db.prepare(`INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
                VALUES (?, ?, NULL, ?, 'PAYOUT_REQUEST', NULL, 0, ?)`)
      .run(nanoid(16), params.agentKey, params.amountCredits, JSON.stringify({ payoutId: id, usdcWallet: params.usdcWallet }));

    const deductResult = db.prepare(`UPDATE api_keys SET credits = credits - ? WHERE key = ? AND credits >= ? AND active = 1`)
      .run(params.amountCredits, params.agentKey, params.amountCredits);
    if (deductResult.changes === 0) throw new Error('Credit deduction failed — key may be inactive or balance changed');

    return { ok: true, id };
  })();
}

export function getPayoutRequests(agentKey: string, limit = 100, offset = 0): PayoutRequest[] {
  return getDb()
    .prepare(`SELECT * FROM payout_requests WHERE agent_key = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(agentKey, limit, offset) as PayoutRequest[];
}

export function getAllPendingPayouts(): PayoutRequest[] {
  return getDb()
    .prepare(`SELECT * FROM payout_requests WHERE status IN ('PENDING','PROCESSING') ORDER BY created_at ASC`)
    .all() as PayoutRequest[];
}

export function updatePayoutStatus(id: string, status: PayoutRequest['status'], notes?: string): void {
  getDb()
    .prepare(`UPDATE payout_requests SET status = ?, notes = ?, processed_at = datetime('now') WHERE id = ?`)
    .run(status, notes ?? null, id);
}

export function getPurchaseHistory(buyerKey: string): Array<{
  skill_id: string; last_purchased: string; times: number; total_spent: number;
  name: string | null; display_name: string | null; description: string | null;
  credit_cost: number | null; uses: number | null; stars: number | null; category: string | null;
}> {
  return getDb().prepare(`
    SELECT DISTINCT t.skill_id, MAX(t.created_at) as last_purchased, COUNT(*) as times,
           SUM(t.amount_credits) as total_spent,
           s.name, s.display_name, s.description, s.credit_cost, s.uses, s.stars, s.category
    FROM transactions t
    LEFT JOIN skills s ON s.id = t.skill_id AND s.active = 1
    WHERE t.from_agent = ? AND t.type = 'SKILL_SALE' AND t.skill_id IS NOT NULL
    GROUP BY t.skill_id
    ORDER BY last_purchased DESC
    LIMIT 100
  `).all(buyerKey) as Array<{
    skill_id: string; last_purchased: string; times: number; total_spent: number;
    name: string | null; display_name: string | null; description: string | null;
    credit_cost: number | null; uses: number | null; stars: number | null; category: string | null;
  }>;
}
