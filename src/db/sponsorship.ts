import { nanoid } from 'nanoid';
import { getDb, logAudit } from './connection';
import { logger } from '../utils/logger';
import { round6 } from '../core/credits';

// ─── Skill Sponsorships ──────────────────────────────────────────────────────

export interface Sponsorship {
  id: string;
  sponsor_key: string;
  skill_id: string;
  total_credits: number;
  remaining_credits: number;
  daily_limit_per_user: number;
  max_uses_per_user: number;
  active: number;
  expires_at: string | null;
  created_at: string;
}

export interface SponsorshipUsage {
  id: string;
  sponsorship_id: string;
  user_key: string;
  credits_used: number;
  used_at: string;
}

export function createSponsorship(params: {
  sponsorKey: string;
  skillId: string;
  totalCredits: number;
  dailyLimitPerUser?: number;
  maxUsesPerUser?: number;
  expiresAt?: string;
}): Sponsorship {
  if (params.totalCredits <= 0) {
    throw new Error('totalCredits must be greater than 0');
  }

  const id = nanoid(12);
  const dailyLimit = params.dailyLimitPerUser ?? 10;
  const maxUses = params.maxUsesPerUser ?? 100;

  getDb().prepare(`
    INSERT INTO sponsorships (id, sponsor_key, skill_id, total_credits, remaining_credits, daily_limit_per_user, max_uses_per_user, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.sponsorKey, params.skillId, params.totalCredits, params.totalCredits, dailyLimit, maxUses, params.expiresAt ?? null);

  logAudit({
    entityType: 'sponsorship',
    entityId: id,
    action: 'SPONSORSHIP_CREATED',
    actorId: params.sponsorKey,
    data: { skillId: params.skillId, totalCredits: params.totalCredits, dailyLimit, maxUses },
  });

  logger.info({ sponsorshipId: id, skillId: params.skillId, totalCredits: params.totalCredits }, 'sponsorship created');

  return getDb().prepare('SELECT * FROM sponsorships WHERE id = ?').get(id) as Sponsorship;
}

export function getSponsorship(id: string): Sponsorship | undefined {
  return getDb().prepare('SELECT * FROM sponsorships WHERE id = ?').get(id) as Sponsorship | undefined;
}

export function getSponsorshipForSkill(skillId: string): Sponsorship | undefined {
  return getDb().prepare(`
    SELECT * FROM sponsorships
    WHERE skill_id = ? AND active = 1 AND remaining_credits > 0
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(skillId) as Sponsorship | undefined;
}

export function listSponsorships(sponsorKey: string): Sponsorship[] {
  return getDb().prepare(
    'SELECT * FROM sponsorships WHERE sponsor_key = ? ORDER BY created_at DESC'
  ).all(sponsorKey) as Sponsorship[];
}

export function consumeSponsoredCredits(params: {
  sponsorshipId: string;
  userKey: string;
  creditsNeeded: number;
}): { sponsored: boolean; creditsSponsored: number; creditsRemaining: number } {
  const { sponsorshipId, userKey, creditsNeeded } = params;

  const result = { sponsored: false, creditsSponsored: 0, creditsRemaining: 0 };

  getDb().transaction(() => {
    const sponsorship = getDb().prepare(`
      SELECT * FROM sponsorships
      WHERE id = ? AND active = 1 AND remaining_credits > 0
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(sponsorshipId) as Sponsorship | undefined;

    if (!sponsorship) return;

    // Check max uses per user
    const totalUses = getDb().prepare(
      'SELECT COUNT(*) AS cnt FROM sponsorship_usage WHERE sponsorship_id = ? AND user_key = ?'
    ).get(sponsorshipId, userKey) as { cnt: number };

    if (totalUses.cnt >= sponsorship.max_uses_per_user) return;

    // Check daily limit per user
    const todayUsage = getDb().prepare(`
      SELECT COALESCE(SUM(credits_used), 0) AS total FROM sponsorship_usage
      WHERE sponsorship_id = ? AND user_key = ? AND used_at >= date('now')
    `).get(sponsorshipId, userKey) as { total: number };

    const dailyRemaining = round6(sponsorship.daily_limit_per_user - todayUsage.total);
    if (dailyRemaining <= 0) return;

    // Calculate how many credits we can actually sponsor
    const available = Math.min(creditsNeeded, dailyRemaining, sponsorship.remaining_credits);
    const creditsSponsored = round6(available);
    if (creditsSponsored <= 0) return;

    // Deduct from sponsorship pool
    getDb().prepare(
      'UPDATE sponsorships SET remaining_credits = round(remaining_credits - ?, 6) WHERE id = ?'
    ).run(creditsSponsored, sponsorshipId);

    // Record usage
    const usageId = nanoid(12);
    getDb().prepare(`
      INSERT INTO sponsorship_usage (id, sponsorship_id, user_key, credits_used)
      VALUES (?, ?, ?, ?)
    `).run(usageId, sponsorshipId, userKey, creditsSponsored);

    const updated = getDb().prepare(
      'SELECT remaining_credits FROM sponsorships WHERE id = ?'
    ).get(sponsorshipId) as { remaining_credits: number };

    result.sponsored = true;
    result.creditsSponsored = creditsSponsored;
    result.creditsRemaining = updated.remaining_credits;
  })();

  return result;
}

export function getSponsorshipUsageToday(sponsorshipId: string, userKey: string): number {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(credits_used), 0) AS total FROM sponsorship_usage
    WHERE sponsorship_id = ? AND user_key = ? AND used_at >= date('now')
  `).get(sponsorshipId, userKey) as { total: number };
  return row.total;
}

export function getSponsorshipUsageTotal(sponsorshipId: string, userKey: string): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) AS cnt FROM sponsorship_usage WHERE sponsorship_id = ? AND user_key = ?'
  ).get(sponsorshipId, userKey) as { cnt: number };
  return row.cnt;
}

export function deactivateSponsorship(id: string, sponsorKey: string): boolean {
  const result = getDb().prepare(
    'UPDATE sponsorships SET active = 0 WHERE id = ? AND sponsor_key = ?'
  ).run(id, sponsorKey);

  if (result.changes > 0) {
    logAudit({ entityType: 'sponsorship', entityId: id, action: 'SPONSORSHIP_DEACTIVATED', actorId: sponsorKey });
    logger.info({ sponsorshipId: id }, 'sponsorship deactivated');
  }
  return result.changes > 0;
}

export function topUpSponsorship(id: string, sponsorKey: string, additionalCredits: number): boolean {
  if (additionalCredits <= 0) throw new Error('additionalCredits must be greater than 0');

  const result = getDb().prepare(`
    UPDATE sponsorships
    SET total_credits = round(total_credits + ?, 6),
        remaining_credits = round(remaining_credits + ?, 6)
    WHERE id = ? AND sponsor_key = ?
  `).run(additionalCredits, additionalCredits, id, sponsorKey);

  if (result.changes > 0) {
    logAudit({
      entityType: 'sponsorship',
      entityId: id,
      action: 'SPONSORSHIP_TOPUP',
      actorId: sponsorKey,
      data: { additionalCredits },
    });
    logger.info({ sponsorshipId: id, additionalCredits }, 'sponsorship topped up');
  }
  return result.changes > 0;
}
