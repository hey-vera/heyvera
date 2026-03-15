import { getDb } from '../db/connection';
import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ReferralStats {
  totalReferred: number;
  creditsEarned: number;
  referrals: Array<{ referredKey: string; creditAwarded: number; createdAt: string }>;
  referralLink: string;
}

export interface TopReferrer {
  key: string;
  count: number;
  creditsEarned: number;
}

// ─── Internal row types ─────────────────────────────────────────────────────────

interface ReferralRow {
  referred_key: string;
  credits_awarded: number;
  created_at: string;
}

interface TopReferrerRow {
  referrer_key: string;
  cnt: number;
  total_credits: number;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Record a referral: track who referred whom (no credit bonuses awarded).
 * Called during onboarding when `referredBy` is provided.
 */
export function recordReferral(referrerKey: string, newKey: string): void {
  const db = getDb();

  // Check for duplicate
  const existing = db.prepare(
    `SELECT 1 FROM agent_referrals WHERE referred_key = ?`
  ).get(newKey);

  if (existing) {
    logger.warn({ newKey: maskApiKey(newKey) }, 'Duplicate referral attempt ignored');
    return;
  }

  // Track referral relationship only — no credit bonuses
  db.prepare(
    `INSERT INTO agent_referrals (referrer_key, referred_key, credits_awarded) VALUES (?, ?, 0)`
  ).run(referrerKey, newKey);

  logger.info(
    { referrer: maskApiKey(referrerKey), referred: maskApiKey(newKey) },
    'Referral recorded (tracking only, no credit bonus)',
  );
}

/**
 * Get referral statistics for a specific API key.
 */
export function getReferralStats(apiKey: string): ReferralStats {
  const rows = getDb().prepare(
    `SELECT referred_key, credits_awarded, created_at
     FROM agent_referrals
     WHERE referrer_key = ?
     ORDER BY created_at DESC`
  ).all(apiKey) as ReferralRow[];

  return {
    totalReferred: rows.length,
    creditsEarned: rows.reduce((sum, r) => sum + r.credits_awarded, 0),
    referrals: rows.map((r) => ({
      referredKey: maskApiKey(r.referred_key),
      creditAwarded: r.credits_awarded,
      createdAt: r.created_at,
    })),
    referralLink: `POST /v1/onboard with { referredBy: '${maskApiKey(apiKey)}' }`,
  };
}

/**
 * Get the top referrers, sorted by referral count descending.
 */
export function getTopReferrers(limit: number = 10): TopReferrer[] {
  const rows = getDb().prepare(
    `SELECT referrer_key,
            COUNT(*) AS cnt,
            COALESCE(SUM(credits_awarded), 0) AS total_credits
     FROM agent_referrals
     GROUP BY referrer_key
     ORDER BY cnt DESC
     LIMIT ?`
  ).all(limit) as TopReferrerRow[];

  return rows.map((r) => ({
    key: maskApiKey(r.referrer_key),
    count: r.cnt,
    creditsEarned: r.total_credits,
  }));
}
