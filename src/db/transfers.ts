import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';
import { round6 } from '../core/credits';

// ─── Credit Transfers (Agent-to-Agent) ───────────────────────────────────────

const TRANSFER_FEE_PCT = 0.01; // 1% platform fee
const TRANSFER_FEE_MIN = 1;    // minimum 1 credit fee
const TRANSFER_MIN = 10;       // minimum 10 credits per transfer
const TRANSFER_MAX = 100_000;  // maximum per transfer (intentional friction for large amounts)

export interface CreditTransfer {
  id: string;
  from_key: string;
  to_key: string;
  amount: number;
  fee: number;
  memo: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export function transferCredits(params: {
  fromKey: string;
  toKey: string;
  amount: number;
  memo?: string;
  idempotencyKey?: string;
}): { ok: boolean; transferId?: string; fee?: number; newBalance?: number; error?: string } {
  const db = getDb();
  const { fromKey, toKey, amount } = params;

  // Validation
  if (fromKey === toKey) return { ok: false, error: 'Cannot transfer to yourself' };
  if (amount < TRANSFER_MIN) return { ok: false, error: `Minimum transfer is ${TRANSFER_MIN} credits` };
  if (amount > TRANSFER_MAX) return { ok: false, error: `Maximum transfer is ${TRANSFER_MAX} credits per transaction` };

  // Idempotency check
  if (params.idempotencyKey) {
    const existing = db.prepare('SELECT id, amount, fee FROM credit_transfers WHERE idempotency_key = ?')
      .get(params.idempotencyKey) as CreditTransfer | undefined;
    if (existing) {
      return { ok: true, transferId: existing.id, fee: existing.fee };
    }
  }

  const fee = round6(Math.max(TRANSFER_FEE_MIN, amount * TRANSFER_FEE_PCT));
  const totalDeduct = round6(amount + fee);
  let transferId = '';
  let newBalance = 0;

  try {
    db.transaction(() => {
      // Verify receiver exists and is active
      const receiver = db.prepare('SELECT key FROM api_keys WHERE key = ? AND active = 1').get(toKey);
      if (!receiver) throw new Error('Recipient key not found or inactive');

      // Deduct from sender (amount + fee)
      const deducted = db.prepare(
        `UPDATE api_keys SET credits = credits - ?, credits_used = credits_used + ?, last_used_at = datetime('now')
         WHERE key = ? AND credits >= ? AND active = 1`
      ).run(totalDeduct, totalDeduct, fromKey, totalDeduct);
      if (deducted.changes === 0) throw new Error('Insufficient credits');

      // Credit receiver
      const credited = db.prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1')
        .run(amount, toKey);
      if (credited.changes === 0) throw new Error('Recipient key not found or inactive');

      // Fee to treasury
      if (fee > 0) {
        db.prepare(`UPDATE api_keys SET credits = credits + ? WHERE key = 'clawhub-treasury' AND active = 1`)
          .run(fee);
      }

      // Record transfer
      transferId = nanoid(16);
      db.prepare(
        `INSERT INTO credit_transfers (id, from_key, to_key, amount, fee, memo, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(transferId, fromKey, toKey, amount, fee, params.memo ?? null, params.idempotencyKey ?? null);

      // Record in transactions ledger for reconciliation
      db.prepare(
        `INSERT INTO transactions (id, from_agent, to_agent, amount_credits, type, skill_id, fee_credits, metadata_json)
         VALUES (?, ?, ?, ?, 'CREDIT_TRANSFER', NULL, ?, ?)`
      ).run(nanoid(16), fromKey, toKey, amount, fee, JSON.stringify({
        transferId, memo: params.memo ?? null,
      }));

      // Get new balance
      const bal = db.prepare('SELECT credits FROM api_keys WHERE key = ?').get(fromKey) as { credits: number };
      newBalance = bal.credits;
    })();

    logAudit({ entityType: 'transfer', entityId: transferId, action: 'CREDIT_TRANSFER', actorId: fromKey,
      data: { toKey: toKey.slice(0, 8) + '...', amount, fee } });

    return { ok: true, transferId, fee, newBalance };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getTransferHistory(
  key: string,
  opts: { limit?: number; offset?: number; direction?: 'sent' | 'received' | 'all' } = {},
): { transfers: CreditTransfer[]; total: number } {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const direction = opts.direction ?? 'all';

  let where = '';
  const args: unknown[] = [];
  if (direction === 'sent') {
    where = 'WHERE from_key = ?';
    args.push(key);
  } else if (direction === 'received') {
    where = 'WHERE to_key = ?';
    args.push(key);
  } else {
    where = 'WHERE from_key = ? OR to_key = ?';
    args.push(key, key);
  }

  const total = (db.prepare(`SELECT COUNT(*) as n FROM credit_transfers ${where}`).get(...args) as { n: number }).n;
  const transfers = db.prepare(
    `SELECT * FROM credit_transfers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset) as CreditTransfer[];

  return { transfers, total };
}

// ─── Delegated Keys (Sub-Keys with Spending Caps) ────────────────────────────

export interface DelegatedKey {
  child_key: string;
  parent_key: string;
  label: string | null;
  spend_limit: number;
  spent: number;
  expires_at: string | null;
  permissions_json: string;
  active: number;
  created_at: string;
}

export function createDelegatedKey(params: {
  parentKey: string;
  label?: string;
  spendLimit: number;
  expiresInHours?: number;
  permissions?: string[];
}): { ok: boolean; childKey?: string; error?: string } {
  const db = getDb();

  if (params.spendLimit < 10) return { ok: false, error: 'Minimum spend limit is 10 credits' };
  if (params.spendLimit > 1_000_000) return { ok: false, error: 'Maximum spend limit is 1,000,000 credits' };

  // Don't allow creating sub-keys from sub-keys (max 1 level deep)
  const parentDelegation = db.prepare('SELECT 1 FROM delegated_keys WHERE child_key = ? AND active = 1').get(params.parentKey);
  if (parentDelegation) return { ok: false, error: 'Cannot create sub-keys from a delegated key' };

  // Get parent info
  const parentRow = db.prepare('SELECT email, active FROM api_keys WHERE key = ? AND active = 1').get(params.parentKey) as { email: string; active: number } | undefined;
  if (!parentRow) return { ok: false, error: 'Parent key not found or inactive' };

  // Limit total delegated keys per parent
  const existing = (db.prepare('SELECT COUNT(*) as n FROM delegated_keys WHERE parent_key = ? AND active = 1').get(params.parentKey) as { n: number }).n;
  if (existing >= 20) return { ok: false, error: 'Maximum 20 active delegated keys per parent' };

  const childKey = 'cn-' + crypto.randomBytes(24).toString('hex');
  const expiresAt = params.expiresInHours
    ? new Date(Date.now() + params.expiresInHours * 3600_000).toISOString()
    : null;
  const permissions = params.permissions ?? ['invoke', 'query'];

  try {
    db.transaction(() => {
      // Insert API key entry (credits=0 — billing goes to parent)
      db.prepare(
        `INSERT INTO api_keys (key, email, credits, credits_used, created_at, active)
         VALUES (?, ?, 0, 0, datetime('now'), 1)`
      ).run(childKey, parentRow.email);

      // Insert delegation record
      db.prepare(
        `INSERT INTO delegated_keys (child_key, parent_key, label, spend_limit, expires_at, permissions_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(childKey, params.parentKey, params.label ?? null, params.spendLimit, expiresAt, JSON.stringify(permissions));
    })();

    logAudit({ entityType: 'delegated_key', entityId: childKey, action: 'DELEGATE_CREATE', actorId: params.parentKey,
      data: { spendLimit: params.spendLimit, expiresAt, permissions } });

    return { ok: true, childKey };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getDelegatedKeys(parentKey: string): DelegatedKey[] {
  return getDb()
    .prepare('SELECT * FROM delegated_keys WHERE parent_key = ? AND active = 1 ORDER BY created_at DESC')
    .all(parentKey) as DelegatedKey[];
}

export function revokeDelegatedKey(parentKey: string, childKey: string): { ok: boolean; error?: string } {
  const db = getDb();
  try {
    db.transaction(() => {
      const row = db.prepare('SELECT 1 FROM delegated_keys WHERE child_key = ? AND parent_key = ? AND active = 1').get(childKey, parentKey);
      if (!row) throw new Error('Delegated key not found or already revoked');

      db.prepare('UPDATE delegated_keys SET active = 0 WHERE child_key = ?').run(childKey);
      db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(childKey);
    })();

    logAudit({ entityType: 'delegated_key', entityId: childKey, action: 'DELEGATE_REVOKE', actorId: parentKey });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function getDelegationInfo(childKey: string): DelegatedKey | undefined {
  return getDb()
    .prepare('SELECT * FROM delegated_keys WHERE child_key = ? AND active = 1')
    .get(childKey) as DelegatedKey | undefined;
}

export function incrementDelegatedSpend(childKey: string, amount: number): boolean {
  const result = getDb()
    .prepare(
      `UPDATE delegated_keys SET spent = spent + ?
       WHERE child_key = ? AND active = 1 AND (spent + ?) <= spend_limit`
    )
    .run(amount, childKey, amount);
  return result.changes > 0;
}

// ─── Auto-Payout Threshold ───────────────────────────────────────────────────

export interface AutoPayoutConfig {
  agent_key: string;
  threshold_credits: number;
  usdc_wallet: string;
  enabled: number;
  created_at: string;
}

export function setAutoPayoutConfig(agentKey: string, thresholdCredits: number, usdcWallet: string): void {
  getDb().prepare(
    `INSERT OR REPLACE INTO auto_payout_config (agent_key, threshold_credits, usdc_wallet, enabled)
     VALUES (?, ?, ?, 1)`
  ).run(agentKey, thresholdCredits, usdcWallet);

  logAudit({ entityType: 'auto_payout', entityId: agentKey, action: 'AUTO_PAYOUT_SET',
    data: { thresholdCredits, usdcWallet: usdcWallet.slice(0, 8) + '...' } });
}

export function getAutoPayoutConfig(agentKey: string): AutoPayoutConfig | undefined {
  return getDb()
    .prepare('SELECT * FROM auto_payout_config WHERE agent_key = ? AND enabled = 1')
    .get(agentKey) as AutoPayoutConfig | undefined;
}

export function deleteAutoPayoutConfig(agentKey: string): boolean {
  const result = getDb()
    .prepare('UPDATE auto_payout_config SET enabled = 0 WHERE agent_key = ?')
    .run(agentKey);
  return result.changes > 0;
}

export function getAllAutoPayoutConfigs(): AutoPayoutConfig[] {
  return getDb()
    .prepare('SELECT * FROM auto_payout_config WHERE enabled = 1')
    .all() as AutoPayoutConfig[];
}

// ─── Receipts (assembled from transactions + transfers) ──────────────────────

export interface Receipt {
  id: string;
  type: string;
  amount: number;
  fee: number;
  counterparty: string | null;
  memo: string | null;
  timestamp: string;
  tx_hash: string | null;
}

export function getReceipts(
  key: string,
  opts: { limit?: number; offset?: number; type?: string } = {},
): { receipts: Receipt[]; total: number } {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  // Simpler approach: query transfers and transactions separately, merge in JS
  const transfers = db.prepare(
    `SELECT id, 'CREDIT_TRANSFER' as type, amount, fee,
       CASE WHEN from_key = ? THEN to_key ELSE from_key END as counterparty,
       memo, created_at as timestamp, NULL as tx_hash
     FROM credit_transfers WHERE from_key = ? OR to_key = ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(key, key, key, limit + offset) as Receipt[];

  let typeWhere = "AND t.type != 'CREDIT_TRANSFER'";
  const txArgs: unknown[] = [key, key, key, key];
  if (opts.type && opts.type !== 'CREDIT_TRANSFER') {
    typeWhere += ' AND t.type = ?';
    txArgs.push(opts.type);
  }
  txArgs.push(limit + offset);

  const txRows = db.prepare(
    `SELECT t.id, t.type, t.amount_credits as amount, t.fee_credits as fee,
       CASE WHEN t.from_agent = ? THEN t.to_agent ELSE t.from_agent END as counterparty,
       NULL as memo, t.created_at as timestamp,
       CASE WHEN t.type = 'PAYOUT_REQUEST' THEN json_extract(t.metadata_json, '$.txHash') ELSE NULL END as tx_hash
     FROM transactions t WHERE (t.from_agent = ? OR t.to_agent = ?) ${typeWhere}
     ORDER BY t.created_at DESC LIMIT ?`
  ).all(...txArgs) as Receipt[];

  // Merge, sort, paginate
  const all = (opts.type === 'CREDIT_TRANSFER' ? transfers : opts.type ? txRows : [...transfers, ...txRows])
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const total = all.length;
  const receipts = all.slice(offset, offset + limit);

  return { receipts, total };
}

// ─── Reputation — use getReputationScore/getReputationEvents from skills.ts ──

/** Earned balance = total SKILL_SALE income minus already paid out minus pending payouts */
export function getCreatorEarnedBalance(agentKey: string): number {
  const db = getDb();
  const earned = (db.prepare(
    `SELECT COALESCE(SUM(amount_credits - fee_credits), 0) as total
     FROM transactions WHERE to_agent = ? AND type = 'SKILL_SALE'`
  ).get(agentKey) as { total: number }).total;

  const paidOut = (db.prepare(
    `SELECT COALESCE(SUM(amount_credits), 0) as total
     FROM payout_requests WHERE agent_key = ? AND status = 'PAID'`
  ).get(agentKey) as { total: number }).total;

  const pending = (db.prepare(
    `SELECT COALESCE(SUM(amount_credits), 0) as total
     FROM payout_requests WHERE agent_key = ? AND status IN ('PENDING', 'PROCESSING')`
  ).get(agentKey) as { total: number }).total;

  return Math.max(0, earned - paidOut - pending);
}
