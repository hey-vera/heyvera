import crypto from 'crypto';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';
import { getDb, logAudit } from './connection';
import { round6 } from '../core/credits';
import { maskApiKey } from '../utils/mask';

// ─── Credit Transfers (Agent-to-Agent) ───────────────────────────────────────

// Fee spine v1: zero-fee transfers — encourage agent economy, don't tax it.
// Old: 1% platform fee. New: 0%. Every transfer still gets a fee breakdown
// pulse tree leaf proving we took nothing (see fee-spine.ts).
const TRANSFER_FEE_PCT = 0;    // 0% — free transfers
const TRANSFER_FEE_MIN = 0;    // no minimum fee
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
      data: { toKey: maskApiKey(toKey), amount, fee } });

    return { ok: true, transferId, fee, newBalance };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
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
  // v65: budget account extensions
  daily_limit: number | null;
  weekly_limit: number | null;
  daily_spent: number;
  weekly_spent: number;
  last_daily_reset: string | null;
  last_weekly_reset: string | null;
  auto_topup: number;
  auto_topup_amount: number | null;
  account_type: 'delegated' | 'budget';
  // v108: granular policy engine (x204 trust delegation)
  policy_json: string | null;
  max_per_transaction: number | null;
  allowed_skills_json: string | null;
  allowed_providers_json: string | null;
  active_hours_json: string | null;
  // v149: Soma Delegation Spec v0.1 fields
  depth: number;
  max_depth: number;
  branch_spend_limit: number | null;
  intent_declaration: string | null;
  data_domain: string | null;
  scope_endpoints_glob: string | null;
  scope_methods_csv: string | null;
  revoked_at: string | null;
}

export function createDelegatedKey(params: {
  parentKey: string;
  label?: string;
  spendLimit: number;
  expiresInHours?: number;
  permissions?: string[];
  // v149 Soma Delegation Spec v0.1 — all optional + backward compatible.
  maxDepth?: number;                // how many further hops this child may delegate (default 0)
  branchSpendLimit?: number;        // per-immediate-grandchild cap
  intentDeclaration?: string;       // free-text "why does this agent exist"
  dataDomain?: 'public-chain-data' | 'private-user-data' | 'model-output' | 'training-data' | 'other';
  scopeEndpointsGlob?: string[];    // e.g. ["helius.rpc.*","claw.solscan.*"]
  scopeMethodsCsv?: string;         // e.g. "GET,POST"
}): { ok: boolean; childKey?: string; error?: string } {
  const db = getDb();

  if (params.spendLimit < 10) return { ok: false, error: 'Minimum spend limit is 10 credits' };
  if (params.spendLimit > 1_000_000) return { ok: false, error: 'Maximum spend limit is 1,000,000 credits' };

  // Depth-aware chain validation (Soma Delegation Spec §4.1/4.2).
  // If the caller's key is itself a delegated key, enforce:
  //   - parent.max_depth > 0  (parent allowed to delegate further)
  //   - child scope ⊆ parent scope
  //   - child spend_limit <= parent.branch_spend_limit (if set)
  const parentDelegation = db.prepare(
    'SELECT * FROM delegated_keys WHERE child_key = ? AND active = 1'
  ).get(params.parentKey) as DelegatedKey | undefined;

  let childDepth = 0;
  if (parentDelegation) {
    if (parentDelegation.max_depth <= 0) {
      return { ok: false, error: 'DEPTH_EXCEEDED: parent key is not allowed to delegate further (max_depth=0)' };
    }
    childDepth = parentDelegation.depth + 1;

    // Branch cap enforcement.
    if (parentDelegation.branch_spend_limit !== null
        && params.spendLimit > parentDelegation.branch_spend_limit) {
      return {
        ok: false,
        error: `BRANCH_CAP_EXCEEDED: spend_limit ${params.spendLimit} > parent.branch_spend_limit ${parentDelegation.branch_spend_limit}`,
      };
    }

    // Child's max_depth must strictly decrease: child.max_depth <= parent.max_depth - 1.
    const requestedMaxDepth = params.maxDepth ?? 0;
    if (requestedMaxDepth > parentDelegation.max_depth - 1) {
      return {
        ok: false,
        error: `DEPTH_EXCEEDED: requested max_depth ${requestedMaxDepth} must be <= parent.max_depth-1 (${parentDelegation.max_depth - 1})`,
      };
    }

    // Scope narrowing: child endpoint globs must be subset of parent's.
    if (params.scopeEndpointsGlob && parentDelegation.scope_endpoints_glob) {
      const parentGlobs: string[] = JSON.parse(parentDelegation.scope_endpoints_glob);
      const narrowed = params.scopeEndpointsGlob.every(g => isGlobSubset(g, parentGlobs));
      if (!narrowed) {
        return { ok: false, error: 'SCOPE_VIOLATION: child endpoint globs are not a subset of parent scope' };
      }
    }
  }

  // Get parent info (from api_keys — all delegated children are also api_keys rows)
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
        `INSERT INTO delegated_keys (
           child_key, parent_key, label, spend_limit, expires_at, permissions_json,
           depth, max_depth, branch_spend_limit, intent_declaration, data_domain,
           scope_endpoints_glob, scope_methods_csv
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        childKey, params.parentKey, params.label ?? null, params.spendLimit, expiresAt, JSON.stringify(permissions),
        childDepth,
        params.maxDepth ?? 0,
        params.branchSpendLimit ?? null,
        params.intentDeclaration ?? null,
        params.dataDomain ?? null,
        params.scopeEndpointsGlob ? JSON.stringify(params.scopeEndpointsGlob) : null,
        params.scopeMethodsCsv ?? null,
      );
    })();

    logAudit({ entityType: 'delegated_key', entityId: childKey, action: 'DELEGATE_CREATE', actorId: params.parentKey,
      data: {
        spendLimit: params.spendLimit, expiresAt, permissions,
        depth: childDepth, maxDepth: params.maxDepth ?? 0,
        branchSpendLimit: params.branchSpendLimit ?? null,
        intentDeclaration: params.intentDeclaration ?? null,
      },
    });

    return { ok: true, childKey };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Returns true if glob `candidate` is a subset of the union of globs in `parents`.
 * Simple shell-glob check: candidate matches if at least one parent glob's prefix
 * (up to first wildcard) is a prefix of candidate. This is conservative — good
 * enough for v0.1. See internal/soma-delegation-spec.md §4.2 + §8 open Q #2.
 */
function isGlobSubset(candidate: string, parents: string[]): boolean {
  if (parents.length === 0) return false;
  // If parent has a pure wildcard "*" in any position, accept anything that
  // shares prefix before the wildcard.
  for (const p of parents) {
    const starIdx = p.indexOf('*');
    if (starIdx === -1) {
      if (p === candidate) return true;
      continue;
    }
    const prefix = p.slice(0, starIdx);
    if (candidate.startsWith(prefix)) return true;
  }
  return false;
}

export function getDelegatedKeys(parentKey: string): DelegatedKey[] {
  return getDb()
    .prepare('SELECT * FROM delegated_keys WHERE parent_key = ? AND active = 1 ORDER BY created_at DESC')
    .all(parentKey) as DelegatedKey[];
}

/**
 * Revoke a delegated key AND all of its descendants recursively.
 * Implements cascade revoke per Soma Delegation Spec §4.4.
 * Safe for depth-0 chains (current default) — in that case no descendants exist
 * and behavior matches the original 1-hop revoke.
 */
export function revokeDelegatedKey(parentKey: string, childKey: string): { ok: boolean; revokedCount?: number; error?: string } {
  const db = getDb();
  let revokedCount = 0;
  try {
    db.transaction(() => {
      const row = db.prepare('SELECT 1 FROM delegated_keys WHERE child_key = ? AND parent_key = ? AND active = 1').get(childKey, parentKey);
      if (!row) throw new Error('Delegated key not found or already revoked');

      // BFS the subtree rooted at `childKey`.
      const toRevoke: string[] = [childKey];
      const frontier: string[] = [childKey];
      while (frontier.length > 0) {
        const placeholders = frontier.map(() => '?').join(',');
        const descendants = db
          .prepare(`SELECT child_key FROM delegated_keys WHERE parent_key IN (${placeholders}) AND active = 1`)
          .all(...frontier) as { child_key: string }[];
        frontier.length = 0;
        for (const d of descendants) {
          toRevoke.push(d.child_key);
          frontier.push(d.child_key);
        }
      }

      const now = new Date().toISOString();
      const placeholders = toRevoke.map(() => '?').join(',');
      const delRes = db
        .prepare(`UPDATE delegated_keys SET active = 0, revoked_at = ? WHERE child_key IN (${placeholders})`)
        .run(now, ...toRevoke);
      db.prepare(`UPDATE api_keys SET active = 0 WHERE key IN (${placeholders})`).run(...toRevoke);
      revokedCount = delRes.changes;
    })();

    logAudit({
      entityType: 'delegated_key', entityId: childKey, action: 'DELEGATE_REVOKE', actorId: parentKey,
      data: { cascade: true, revokedCount },
    });
    return { ok: true, revokedCount };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

export function getDelegationInfo(childKey: string): DelegatedKey | undefined {
  return getDb()
    .prepare('SELECT * FROM delegated_keys WHERE child_key = ? AND active = 1')
    .get(childKey) as DelegatedKey | undefined;
}

/**
 * Walk the delegation chain from `childKey` up to the root key.
 * Returns [leaf, ..., root-delegation] with the leaf delegation first.
 * If `childKey` is not a delegated key, returns [].
 * Used by GET /v1/economy/keys/delegated/:childKey/chain + the
 * X-Soma-Delegation-Chain header builder. Soma Delegation Spec §5.
 *
 * Safe against cycles — capped at 32 hops (well above any sane max_depth).
 */
export function getDelegationChain(childKey: string): DelegatedKey[] {
  const db = getDb();
  const chain: DelegatedKey[] = [];
  const seen = new Set<string>();
  let cursor: string | null = childKey;
  let hops = 0;
  while (cursor && hops < 32) {
    if (seen.has(cursor)) break; // cycle guard
    seen.add(cursor);
    const row = db
      .prepare('SELECT * FROM delegated_keys WHERE child_key = ?')
      .get(cursor) as DelegatedKey | undefined;
    if (!row) break;
    chain.push(row);
    cursor = row.parent_key;
    hops++;
  }
  return chain;
}

/**
 * Aggregate metrics over delegated_keys + audit_log. Used by
 * GET /v1/stats/delegation to publish evidence that Soma Delegation v0.1
 * is enforcing chains in production. Returns counts, not keys — safe to
 * expose on an unauthenticated endpoint.
 *
 * Soma Delegation Spec v0.1 §5 / internal/soma-delegation-spec.md.
 */
export interface DelegationMetrics {
  protocol: 'soma-delegation/0.1';
  generated_at: string;
  totals: {
    active_delegations: number;
    revoked_all_time: number;
    max_depth_observed: number;
    chains_depth_gte_2: number;
  };
  depth_distribution: Record<string, number>;
  fanout: {
    parents_with_children: number;
    avg_children_per_parent: number;
    max_children_per_parent: number;
  };
  window_24h: {
    created: number;
    cascade_revokes: number;
    cascade_total_revoked: number;
    scope_violations: number;
  };
  intent_distribution: Record<string, number>;
}

export function getDelegationMetrics(): DelegationMetrics {
  const db = getDb();

  // ── Totals ──────────────────────────────────────────────────────────────
  const active = (db.prepare(
    'SELECT COUNT(*) as n FROM delegated_keys WHERE active = 1'
  ).get() as { n: number }).n;

  const revoked = (db.prepare(
    'SELECT COUNT(*) as n FROM delegated_keys WHERE revoked_at IS NOT NULL'
  ).get() as { n: number }).n;

  const maxDepth = (db.prepare(
    'SELECT COALESCE(MAX(depth), 0) as d FROM delegated_keys WHERE active = 1'
  ).get() as { d: number }).d;

  const deepChains = (db.prepare(
    'SELECT COUNT(*) as n FROM delegated_keys WHERE active = 1 AND depth >= 2'
  ).get() as { n: number }).n;

  // ── Depth distribution (active only) ────────────────────────────────────
  const depthRows = db.prepare(
    'SELECT depth, COUNT(*) as n FROM delegated_keys WHERE active = 1 GROUP BY depth ORDER BY depth ASC'
  ).all() as { depth: number; n: number }[];
  const depthDistribution: Record<string, number> = {};
  for (const row of depthRows) depthDistribution[String(row.depth)] = row.n;

  // ── Fanout (active parents with active children) ────────────────────────
  const fanoutRows = db.prepare(
    `SELECT parent_key, COUNT(*) as children
     FROM delegated_keys WHERE active = 1 GROUP BY parent_key`
  ).all() as { parent_key: string; children: number }[];
  const parentsWithChildren = fanoutRows.length;
  const maxChildren = fanoutRows.reduce((m, r) => Math.max(m, r.children), 0);
  const avgChildren = parentsWithChildren > 0
    ? round6(fanoutRows.reduce((s, r) => s + r.children, 0) / parentsWithChildren)
    : 0;

  // ── 24h window from audit_log ───────────────────────────────────────────
  const created24h = (db.prepare(
    `SELECT COUNT(*) as n FROM audit_log
     WHERE action = 'DELEGATE_CREATE' AND timestamp > datetime('now', '-24 hours')`
  ).get() as { n: number }).n;

  const cascadeRows = db.prepare(
    `SELECT data_json FROM audit_log
     WHERE action = 'DELEGATE_REVOKE' AND timestamp > datetime('now', '-24 hours')`
  ).all() as { data_json: string | null }[];
  let cascadeTotal = 0;
  for (const row of cascadeRows) {
    if (!row.data_json) continue;
    try {
      const d = JSON.parse(row.data_json) as { revokedCount?: number };
      if (typeof d.revokedCount === 'number') cascadeTotal += d.revokedCount;
    } catch { /* ignore malformed rows */ }
  }

  const scope24h = (db.prepare(
    `SELECT COUNT(*) as n FROM audit_log
     WHERE action = 'DELEGATE_SCOPE_REJECT' AND timestamp > datetime('now', '-24 hours')`
  ).get() as { n: number }).n;

  // ── Intent distribution (active, non-null data_domain) ──────────────────
  const intentRows = db.prepare(
    `SELECT COALESCE(data_domain, 'unspecified') as domain, COUNT(*) as n
     FROM delegated_keys WHERE active = 1 GROUP BY domain`
  ).all() as { domain: string; n: number }[];
  const intentDistribution: Record<string, number> = {};
  for (const row of intentRows) intentDistribution[row.domain] = row.n;

  return {
    protocol: 'soma-delegation/0.1',
    generated_at: new Date().toISOString(),
    totals: {
      active_delegations: active,
      revoked_all_time: revoked,
      max_depth_observed: maxDepth,
      chains_depth_gte_2: deepChains,
    },
    depth_distribution: depthDistribution,
    fanout: {
      parents_with_children: parentsWithChildren,
      avg_children_per_parent: avgChildren,
      max_children_per_parent: maxChildren,
    },
    window_24h: {
      created: created24h,
      cascade_revokes: cascadeRows.length,
      cascade_total_revoked: cascadeTotal,
      scope_violations: scope24h,
    },
    intent_distribution: intentDistribution,
  };
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

// ─── Agent Budget Accounts ───────────────────────────────────────────────────

export function createBudgetAccount(params: {
  parentKey: string;
  label?: string;
  spendLimit: number;
  dailyLimit?: number;
  weeklyLimit?: number;
  autoTopup?: boolean;
  autoTopupAmount?: number;
  expiresInHours?: number;
  permissions?: string[];
}): { ok: boolean; childKey?: string; error?: string } {
  const db = getDb();

  if (params.spendLimit < 10) return { ok: false, error: 'Minimum spend limit is 10 credits' };
  if (params.spendLimit > 1_000_000) return { ok: false, error: 'Maximum spend limit is 1,000,000 credits' };
  if (params.dailyLimit !== undefined && params.dailyLimit < 1) return { ok: false, error: 'Daily limit must be at least 1 credit' };
  if (params.weeklyLimit !== undefined && params.weeklyLimit < 1) return { ok: false, error: 'Weekly limit must be at least 1 credit' };
  if (params.autoTopupAmount !== undefined && params.autoTopupAmount < 10) return { ok: false, error: 'Auto-topup amount must be at least 10 credits' };

  // No sub-keys from sub-keys
  const parentDelegation = db.prepare('SELECT 1 FROM delegated_keys WHERE child_key = ? AND active = 1').get(params.parentKey);
  if (parentDelegation) return { ok: false, error: 'Cannot create budget accounts from a delegated key' };

  const parentRow = db.prepare('SELECT email, active FROM api_keys WHERE key = ? AND active = 1').get(params.parentKey) as { email: string; active: number } | undefined;
  if (!parentRow) return { ok: false, error: 'Parent key not found or inactive' };

  const existing = (db.prepare('SELECT COUNT(*) as n FROM delegated_keys WHERE parent_key = ? AND active = 1').get(params.parentKey) as { n: number }).n;
  if (existing >= 20) return { ok: false, error: 'Maximum 20 active delegated keys per parent' };

  const childKey = 'cn-' + crypto.randomBytes(24).toString('hex');
  const expiresAt = params.expiresInHours
    ? new Date(Date.now() + params.expiresInHours * 3600_000).toISOString()
    : null;
  const permissions = params.permissions ?? ['invoke', 'query'];

  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO api_keys (key, email, credits, credits_used, created_at, active)
         VALUES (?, ?, 0, 0, datetime('now'), 1)`
      ).run(childKey, parentRow.email);

      db.prepare(
        `INSERT INTO delegated_keys (child_key, parent_key, label, spend_limit, expires_at, permissions_json,
         daily_limit, weekly_limit, auto_topup, auto_topup_amount, account_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'budget')`
      ).run(
        childKey, params.parentKey, params.label ?? null, params.spendLimit, expiresAt,
        JSON.stringify(permissions), params.dailyLimit ?? null, params.weeklyLimit ?? null,
        params.autoTopup ? 1 : 0, params.autoTopupAmount ?? null,
      );
    })();

    logAudit({ entityType: 'budget_account', entityId: childKey, action: 'BUDGET_ACCOUNT_CREATE', actorId: params.parentKey,
      data: { spendLimit: params.spendLimit, dailyLimit: params.dailyLimit, weeklyLimit: params.weeklyLimit, autoTopup: params.autoTopup } });

    return { ok: true, childKey };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)) };
  }
}

/**
 * Check and reset daily/weekly spend counters if needed.
 * Called from auth middleware for budget accounts.
 */
export function resetBudgetCountersIfNeeded(childKey: string): void {
  const db = getDb();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  const row = db.prepare('SELECT last_daily_reset, last_weekly_reset FROM delegated_keys WHERE child_key = ? AND active = 1')
    .get(childKey) as { last_daily_reset: string | null; last_weekly_reset: string | null } | undefined;
  if (!row) return;

  // Reset daily counter if last reset was a different day
  if (!row.last_daily_reset || row.last_daily_reset !== todayStr) {
    db.prepare('UPDATE delegated_keys SET daily_spent = 0, last_daily_reset = ? WHERE child_key = ?')
      .run(todayStr, childKey);
  }

  // Reset weekly counter if last reset was > 7 days ago
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString().split('T')[0];
  if (!row.last_weekly_reset || row.last_weekly_reset < weekAgo) {
    db.prepare('UPDATE delegated_keys SET weekly_spent = 0, last_weekly_reset = ? WHERE child_key = ?')
      .run(todayStr, childKey);
  }
}

/**
 * Check if a budget account can spend the given amount.
 * Returns { allowed, reason } — call before deducting.
 */
export function checkBudgetLimits(childKey: string, amount: number): { allowed: boolean; reason?: string } {
  const row = getDb().prepare(
    `SELECT spend_limit, spent, daily_limit, weekly_limit, daily_spent, weekly_spent, account_type
     FROM delegated_keys WHERE child_key = ? AND active = 1`
  ).get(childKey) as {
    spend_limit: number; spent: number; daily_limit: number | null; weekly_limit: number | null;
    daily_spent: number; weekly_spent: number; account_type: string;
  } | undefined;
  if (!row) return { allowed: false, reason: 'Key not found' };

  // Overall spend limit
  if (row.spent + amount > row.spend_limit) {
    return { allowed: false, reason: `Total spend limit reached (${row.spend_limit} credits)` };
  }

  // Budget account daily/weekly limits
  if (row.account_type === 'budget') {
    if (row.daily_limit !== null && row.daily_spent + amount > row.daily_limit) {
      return { allowed: false, reason: `Daily budget limit reached (${row.daily_limit} credits/day)` };
    }
    if (row.weekly_limit !== null && row.weekly_spent + amount > row.weekly_limit) {
      return { allowed: false, reason: `Weekly budget limit reached (${row.weekly_limit} credits/week)` };
    }
  }

  return { allowed: true };
}

/** Increment daily and weekly spend counters for budget accounts. */
export function incrementBudgetSpend(childKey: string, amount: number): void {
  getDb().prepare(
    `UPDATE delegated_keys SET daily_spent = daily_spent + ?, weekly_spent = weekly_spent + ?
     WHERE child_key = ? AND active = 1 AND account_type = 'budget'`
  ).run(amount, amount, childKey);
}

/** Get budget account summary (for dashboard/status endpoints). */
export function getBudgetAccountStatus(childKey: string): {
  spendLimit: number; totalSpent: number; dailyLimit: number | null; dailySpent: number;
  weeklyLimit: number | null; weeklySpent: number; autoTopup: boolean; autoTopupAmount: number | null;
} | null {
  const row = getDb().prepare(
    `SELECT spend_limit, spent, daily_limit, daily_spent, weekly_limit, weekly_spent,
            auto_topup, auto_topup_amount
     FROM delegated_keys WHERE child_key = ? AND active = 1 AND account_type = 'budget'`
  ).get(childKey) as {
    spend_limit: number; spent: number; daily_limit: number | null; daily_spent: number;
    weekly_limit: number | null; weekly_spent: number; auto_topup: number; auto_topup_amount: number | null;
  } | undefined;
  if (!row) return null;

  return {
    spendLimit: row.spend_limit,
    totalSpent: row.spent,
    dailyLimit: row.daily_limit,
    dailySpent: row.daily_spent,
    weeklyLimit: row.weekly_limit,
    weeklySpent: row.weekly_spent,
    autoTopup: row.auto_topup === 1,
    autoTopupAmount: row.auto_topup_amount,
  };
}

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
