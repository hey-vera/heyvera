/**
 * vouch-graph.ts — Agent-to-Agent Trust Staking (Layer 4)
 *
 * Agents stake credits to vouch for other agents. Creates a directed trust
 * graph with transitive resolution. If a vouchee misbehaves (proven by
 * Pulse Tree), voucher stakes are slashed.
 *
 * This is a PAID query layer — resolving trust paths costs credits.
 * Staking and revoking are free (they strengthen the graph).
 *
 * Graph properties:
 *   - Directed: A vouches for B ≠ B vouches for A
 *   - Weighted: stake amount = trust strength
 *   - Slashable: bad behavior burns voucher stakes
 *   - Transitive: A→B→C means A has an indirect trust path to C
 *   - TTL: vouches can expire (optional)
 */

import { nanoid } from 'nanoid';
import { getDb, logAudit } from '../db/connection';
import { round6 } from './credits';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VouchStake {
  id: string;
  voucherDid: string;
  voucheeDid: string;
  stakeAmount: number;
  trustCost: number;          // what voucher paid (stake × COST_FACTOR)
  trustTransferred: number;   // what vouchee received (stake × DECAY_FACTOR)
  status: 'active' | 'revoked' | 'slashed';
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  slashReason: string | null;
}

export interface VouchPath {
  from: string;
  to: string;
  hops: Array<{ did: string; stakeAmount: number }>;
  depth: number;
  minStake: number; // weakest link in the chain
}

export interface VouchScore {
  did: string;
  totalStaked: number;    // total credits staked on this agent
  uniqueVouchers: number; // distinct agents vouching
  avgStake: number;
  strongestVouch: number; // highest single stake
  slashCount: number;     // times this agent caused slashes
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MIN_STAKE = 10.0;      // minimum credits to vouch (prevents cheap Sybil boosting)
const MAX_VOUCHES_PER_AGENT = 20; // max agents one agent can vouch for
const MAX_PATH_DEPTH = 3;    // max hops for transitive trust
const SLASH_PENALTY = 1.0;   // slash burns 100% of stake

// ── Conservation of Trust (Innovation 3) ────────────────────────────────────
// Vouching TRANSFERS trust, it doesn't create it. Self-punishing cycles:
//   A→B costs A 13cr of trust, B gains 6cr → 7cr destroyed per vouch
//   Mutual A↔B: both lose 7cr each → Sybil farming is net-negative
const COST_FACTOR = 1.3;         // voucher pays 30% premium (trust_cost = stake × 1.3)
const DECAY_FACTOR = 0.6;        // vouchee receives 60% (trust_transferred = stake × 0.6)
const REVOKE_RETURN_RATE = 0.5;  // revoking returns 50% of trust_cost (not full refund)

// ─── Core Operations ────────────────────────────────────────────────────────

/**
 * Stake a vouch: agent A trusts agent B enough to stake credits.
 *
 * Conservation of trust:
 *   - Voucher's trust_cost = stake × COST_FACTOR (1.3) — what it costs to vouch
 *   - Vouchee's trust_transferred = stake × DECAY_FACTOR (0.6) — what they receive
 *   - Net trust destroyed per vouch = trust_cost - trust_transferred = stake × 0.7
 *   - This makes Sybil farming net-negative: creating fake trust always destroys more than it creates
 */
export function stakeVouch(
  voucherDid: string,
  voucheeDid: string,
  stakeAmount: number,
  expiresAt?: string,
): VouchStake {
  if (voucherDid === voucheeDid) {
    throw new Error('Cannot vouch for yourself');
  }
  if (stakeAmount < MIN_STAKE) {
    throw new Error(`Minimum stake is ${MIN_STAKE} credits`);
  }

  // Check max vouches
  const count = (getDb().prepare(
    "SELECT COUNT(*) as n FROM vouch_stakes WHERE voucher_did = ? AND status = 'active'"
  ).get(voucherDid) as { n: number }).n;
  if (count >= MAX_VOUCHES_PER_AGENT) {
    throw new Error(`Maximum ${MAX_VOUCHES_PER_AGENT} active vouches per agent`);
  }

  // Check for existing active vouch
  const existing = getDb().prepare(
    "SELECT id FROM vouch_stakes WHERE voucher_did = ? AND vouchee_did = ? AND status = 'active'"
  ).get(voucherDid, voucheeDid);
  if (existing) {
    throw new Error('Active vouch already exists — revoke first to re-stake');
  }

  // Conservation of trust: compute transfer costs
  const trustCost = round6(stakeAmount * COST_FACTOR);
  const trustTransferred = round6(stakeAmount * DECAY_FACTOR);

  const id = `vs-${nanoid(12)}`;
  getDb().prepare(`
    INSERT INTO vouch_stakes (id, voucher_did, vouchee_did, stake_amount, status, expires_at, trust_cost, trust_transferred)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, voucherDid, voucheeDid, stakeAmount, expiresAt ?? null, trustCost, trustTransferred);

  logAudit({
    entityType: 'vouch_stake',
    entityId: id,
    action: 'vouch_staked',
    actorId: voucherDid,
    data: { vouchee: voucheeDid, amount: stakeAmount, trustCost, trustTransferred },
  });

  return getVouchStake(id)!;
}

/**
 * Revoke a vouch: agent withdraws trust.
 * Conservation: only 50% of trust_cost is recovered — revoking is not free.
 * This prevents rapid stake/revoke cycling to game the system.
 */
export function revokeVouch(voucherDid: string, voucheeDid: string): boolean {
  // Fetch the vouch to log conservation details
  const vouch = getDb().prepare(
    "SELECT id, trust_cost, trust_transferred FROM vouch_stakes WHERE voucher_did = ? AND vouchee_did = ? AND status = 'active'"
  ).get(voucherDid, voucheeDid) as { id: string; trust_cost: number; trust_transferred: number } | undefined;

  if (!vouch) return false;

  const trustReturned = round6(vouch.trust_cost * REVOKE_RETURN_RATE);
  const trustBurned = round6(vouch.trust_cost - trustReturned);

  getDb().prepare(`
    UPDATE vouch_stakes SET status = 'revoked', revoked_at = datetime('now')
    WHERE id = ?
  `).run(vouch.id);

  logAudit({
    entityType: 'vouch_stake',
    entityId: vouch.id,
    action: 'vouch_revoked',
    actorId: voucherDid,
    data: { vouchee: voucheeDid, trustReturned, trustBurned },
  });

  return true;
}

/**
 * Slash all active vouches for a misbehaving agent.
 * Called when Pulse Tree evidence proves bad behavior (red verdicts, death, etc).
 * Burns 100% of voucher stakes.
 */
export function slashVouches(voucheeDid: string, reason: string): number {
  const stakes = getDb().prepare(`
    SELECT id, voucher_did, stake_amount FROM vouch_stakes
    WHERE vouchee_did = ? AND status = 'active'
  `).all(voucheeDid) as Array<{ id: string; voucher_did: string; stake_amount: number }>;

  if (stakes.length === 0) return 0;

  let totalSlashed = 0;
  getDb().transaction(() => {
    for (const stake of stakes) {
      getDb().prepare(`
        UPDATE vouch_stakes SET status = 'slashed', slash_reason = ?, revoked_at = datetime('now')
        WHERE id = ?
      `).run(reason, stake.id);
      totalSlashed += stake.stake_amount;
    }
  })();

  logAudit({
    entityType: 'vouch_slash',
    entityId: voucheeDid,
    action: 'vouches_slashed',
    data: { reason, stakesSlashed: stakes.length, totalCreditsSlashed: round6(totalSlashed) },
  });

  logger.info({ voucheeDid, reason, slashed: stakes.length, total: round6(totalSlashed) }, 'Vouch stakes slashed');
  return stakes.length;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get a specific vouch stake by ID. */
export function getVouchStake(id: string): VouchStake | null {
  const row = getDb().prepare('SELECT * FROM vouch_stakes WHERE id = ?').get(id) as any;
  return row ? rowToVouchStake(row) : null;
}

/** Get all active vouches FOR an agent (who trusts them). */
export function getVouchesFor(did: string): VouchStake[] {
  const rows = getDb().prepare(
    "SELECT * FROM vouch_stakes WHERE vouchee_did = ? AND status = 'active' ORDER BY stake_amount DESC"
  ).all(did) as any[];
  return rows.map(rowToVouchStake);
}

/** Get all active vouches BY an agent (who they trust). */
export function getVouchesBy(did: string): VouchStake[] {
  const rows = getDb().prepare(
    "SELECT * FROM vouch_stakes WHERE voucher_did = ? AND status = 'active' ORDER BY stake_amount DESC"
  ).all(did) as any[];
  return rows.map(rowToVouchStake);
}

/**
 * Compute aggregate vouch score for an agent, using conservation-adjusted values.
 * Uses trust_transferred (decayed) instead of raw stake_amount, plus circular discount.
 *
 * Conservation makes the score honest:
 *   - Each vouch contributes trust_transferred (stake × 0.6), not the raw stake
 *   - Circular vouches (A↔B) get an additional 50% discount
 *   - Combined: circular vouch contributes stake × 0.6 × 0.5 = stake × 0.3
 *   - This makes Sybil rings extremely expensive to maintain
 */
export function getVouchScore(did: string): VouchScore {
  // Get all active vouchers for this agent — use trust_transferred for conservation
  const vouchers = getDb().prepare(`
    SELECT voucher_did, stake_amount, trust_transferred FROM vouch_stakes
    WHERE vouchee_did = ? AND status = 'active'
  `).all(did) as Array<{ voucher_did: string; stake_amount: number; trust_transferred: number }>;

  // Detect circular vouches: A→B and B→A (reciprocal)
  // These are discounted 50% — legitimate mutual trust exists, but it's easier to game
  const reciprocals = new Set<string>();
  if (vouchers.length > 0) {
    const placeholders = vouchers.map(() => '?').join(',');
    const reverseVouches = getDb().prepare(`
      SELECT vouchee_did FROM vouch_stakes
      WHERE voucher_did = ? AND vouchee_did IN (${placeholders}) AND status = 'active'
    `).all(did, ...vouchers.map(v => v.voucher_did)) as Array<{ vouchee_did: string }>;
    for (const rv of reverseVouches) reciprocals.add(rv.vouchee_did);
  }

  // Compute totals with conservation + circular discount
  let totalStaked = 0;
  let uniqueVouchers = 0;
  let strongestVouch = 0;
  for (const v of vouchers) {
    // Use trust_transferred (conservation-adjusted) instead of raw stake
    const effectiveValue = v.trust_transferred || (v.stake_amount * DECAY_FACTOR); // fallback for pre-conservation vouches
    const weight = reciprocals.has(v.voucher_did) ? 0.5 : 1.0;
    totalStaked += effectiveValue * weight;
    uniqueVouchers += weight; // circular vouchers count as 0.5
    strongestVouch = Math.max(strongestVouch, effectiveValue * weight);
  }
  const avgStake = uniqueVouchers > 0 ? totalStaked / uniqueVouchers : 0;

  const slashCount = (getDb().prepare(
    "SELECT COUNT(*) as n FROM vouch_stakes WHERE vouchee_did = ? AND status = 'slashed'"
  ).get(did) as { n: number }).n;

  return {
    did,
    totalStaked: round6(totalStaked),
    uniqueVouchers: Math.round(uniqueVouchers), // rounded since 0.5 weights
    avgStake: round6(avgStake),
    strongestVouch: round6(strongestVouch),
    slashCount,
  };
}

// ─── Transitive Trust Resolution (BFS) ──────────────────────────────────────

/**
 * Find the shortest trust path from one agent to another via the vouch graph.
 * Uses BFS with max depth. This is the PAID query.
 *
 * Returns null if no path exists within MAX_PATH_DEPTH hops.
 */
export function resolveVouchPath(fromDid: string, toDid: string): VouchPath | null {
  if (fromDid === toDid) return null;

  // BFS
  const visited = new Set<string>();
  const parent = new Map<string, { did: string; stakeAmount: number }>();

  const queue: Array<{ did: string; depth: number }> = [{ did: fromDid, depth: 0 }];
  visited.add(fromDid);

  while (queue.length > 0) {
    const { did, depth } = queue.shift()!;
    if (depth >= MAX_PATH_DEPTH) continue;

    // Get all agents this DID vouches for
    const vouches = getDb().prepare(`
      SELECT vouchee_did, stake_amount FROM vouch_stakes
      WHERE voucher_did = ? AND status = 'active'
    `).all(did) as Array<{ vouchee_did: string; stake_amount: number }>;

    for (const v of vouches) {
      if (visited.has(v.vouchee_did)) continue;
      visited.add(v.vouchee_did);
      parent.set(v.vouchee_did, { did, stakeAmount: v.stake_amount });

      if (v.vouchee_did === toDid) {
        // Reconstruct path
        return reconstructPath(fromDid, toDid, parent);
      }

      queue.push({ did: v.vouchee_did, depth: depth + 1 });
    }
  }

  return null; // no path found
}

function reconstructPath(
  fromDid: string,
  toDid: string,
  parent: Map<string, { did: string; stakeAmount: number }>,
): VouchPath {
  const hops: Array<{ did: string; stakeAmount: number }> = [];
  let current = toDid;
  let minStake = Infinity;

  while (current !== fromDid) {
    const p = parent.get(current)!;
    hops.unshift({ did: current, stakeAmount: p.stakeAmount });
    minStake = Math.min(minStake, p.stakeAmount);
    current = p.did;
  }

  return {
    from: fromDid,
    to: toDid,
    hops,
    depth: hops.length,
    minStake: minStake === Infinity ? 0 : round6(minStake),
  };
}

// ─── Expiry Cleanup ─────────────────────────────────────────────────────────

/** Expire vouches past their TTL. Call from a cron. */
export function expireVouches(): number {
  const result = getDb().prepare(`
    UPDATE vouch_stakes SET status = 'revoked', revoked_at = datetime('now')
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')
  `).run();
  return result.changes;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Total trust_cost committed by an agent across all active vouches.
 * This is the "trust budget spent" — how much trust the voucher has given away.
 * Useful for computing remaining trust capacity or as a penalty in scoring.
 */
export function getVouchCostCommitted(did: string): number {
  const row = getDb().prepare(
    "SELECT COALESCE(SUM(trust_cost), 0) as total FROM vouch_stakes WHERE voucher_did = ? AND status = 'active'"
  ).get(did) as { total: number };
  return round6(row.total);
}

function rowToVouchStake(row: any): VouchStake {
  return {
    id: row.id,
    voucherDid: row.voucher_did,
    voucheeDid: row.vouchee_did,
    stakeAmount: row.stake_amount,
    trustCost: row.trust_cost ?? 0,
    trustTransferred: row.trust_transferred ?? 0,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    slashReason: row.slash_reason,
  };
}
