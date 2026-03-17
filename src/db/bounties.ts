import { nanoid } from 'nanoid';
import { getDb, logAudit } from './connection';
import { logger } from '../utils/logger';
import { round6 } from '../core/credits';

export interface Bounty {
  id: string;
  creator_key: string;
  title: string;
  description: string;
  requirements_json: string | null;
  reward_credits: number;
  deadline: string | null;
  status: 'open' | 'claimed' | 'submitted' | 'completed' | 'expired' | 'cancelled';
  claimed_by: string | null;
  claimed_at: string | null;
  submission_url: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  tags_json: string | null;
  category: string;
  created_at: string;
}

export function createBounty(params: {
  creatorKey: string;
  title: string;
  description: string;
  requirements?: Record<string, unknown>;
  rewardCredits: number;
  deadline?: string;
  tags?: string[];
  category?: string;
}): Bounty {
  const id = nanoid(12);
  const rewardCredits = round6(params.rewardCredits);
  const requirementsJson = params.requirements ? JSON.stringify(params.requirements) : null;
  const tagsJson = params.tags ? JSON.stringify(params.tags) : null;
  const category = params.category ?? 'general';

  getDb()
    .prepare(
      `INSERT INTO bounties (id, creator_key, title, description, requirements_json, reward_credits, deadline, tags_json, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, params.creatorKey, params.title, params.description, requirementsJson, rewardCredits, params.deadline ?? null, tagsJson, category);

  logAudit({ entityType: 'bounty', entityId: id, action: 'BOUNTY_CREATED', actorId: params.creatorKey, data: { rewardCredits, category } });

  return getBounty(id)!;
}

export function getBounty(id: string): Bounty | undefined {
  return getDb().prepare('SELECT * FROM bounties WHERE id = ?').get(id) as Bounty | undefined;
}

export function listBounties(params: {
  status?: string;
  category?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}): Bounty[] {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.status) {
    conditions.push('status = ?');
    values.push(params.status);
  }
  if (params.category) {
    conditions.push('category = ?');
    values.push(params.category);
  }
  if (params.tag) {
    conditions.push('tags_json LIKE ?');
    values.push(`%"${params.tag}"%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;

  return getDb()
    .prepare(`SELECT * FROM bounties ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset) as Bounty[];
}

export function countBounties(params: { status?: string; category?: string }): number {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.status) {
    conditions.push('status = ?');
    values.push(params.status);
  }
  if (params.category) {
    conditions.push('category = ?');
    values.push(params.category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM bounties ${where}`)
    .get(...values) as { count: number };

  return row.count;
}

export function claimBounty(id: string, claimerKey: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE bounties SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now')
       WHERE id = ? AND status = 'open'`
    )
    .run(claimerKey, id);

  if (result.changes > 0) {
    logAudit({ entityType: 'bounty', entityId: id, action: 'BOUNTY_CLAIMED', actorId: claimerKey });
  }
  return result.changes > 0;
}

export function submitBounty(id: string, claimerKey: string, submissionUrl: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE bounties SET status = 'submitted', submission_url = ?, submitted_at = datetime('now')
       WHERE id = ? AND status = 'claimed' AND claimed_by = ?`
    )
    .run(submissionUrl, id, claimerKey);

  if (result.changes > 0) {
    logAudit({ entityType: 'bounty', entityId: id, action: 'BOUNTY_SUBMITTED', actorId: claimerKey, data: { submissionUrl } });
  }
  return result.changes > 0;
}

export function completeBounty(id: string, creatorKey: string): boolean {
  const db = getDb();
  try {
    db.transaction(() => {
      const bounty = db.prepare('SELECT * FROM bounties WHERE id = ?').get(id) as Bounty | undefined;
      if (!bounty) throw new Error('Bounty not found');
      if (bounty.status !== 'submitted') throw new Error('Bounty is not in submitted status');
      if (bounty.creator_key !== creatorKey) throw new Error('Not the bounty creator');
      if (!bounty.claimed_by) throw new Error('No claimer to pay');

      const reward = round6(bounty.reward_credits);

      // Credit the claimer
      const creditResult = db
        .prepare('UPDATE api_keys SET credits = credits + ? WHERE key = ? AND active = 1')
        .run(reward, bounty.claimed_by);
      if (creditResult.changes === 0) throw new Error('Claimer key not found or inactive');

      db.prepare(
        `UPDATE bounties SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
      ).run(id);

      logAudit({ entityType: 'bounty', entityId: id, action: 'BOUNTY_COMPLETED', actorId: creatorKey, data: { reward, claimedBy: bounty.claimed_by } });
    })();
    return true;
  } catch (err) {
    logger.error({ err, bountyId: id }, 'Failed to complete bounty');
    return false;
  }
}

export function cancelBounty(id: string, creatorKey: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE bounties SET status = 'cancelled' WHERE id = ? AND status = 'open' AND creator_key = ?`
    )
    .run(id, creatorKey);

  if (result.changes > 0) {
    logAudit({ entityType: 'bounty', entityId: id, action: 'BOUNTY_CANCELLED', actorId: creatorKey });
  }
  return result.changes > 0;
}

export function expireBounties(): number {
  const result = getDb()
    .prepare(
      `UPDATE bounties SET status = 'expired'
       WHERE status = 'open' AND deadline IS NOT NULL AND deadline < datetime('now')`
    )
    .run();

  if (result.changes > 0) {
    logger.info({ count: result.changes }, 'Expired bounties past deadline');
  }
  return result.changes;
}
