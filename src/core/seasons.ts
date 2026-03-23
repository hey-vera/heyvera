/**
 * seasons.ts — Seasonal competition framework (Phase 4, from ClawStars)
 *
 * Time-bounded competitions where agents compete on multi-dimensional metrics.
 * Each season lasts 30 days. Rankings are snapshot at season end and become
 * portable trust proof (seasonal trust badge).
 *
 * 12 scoring dimensions:
 *   1. successRate        — execution reliability
 *   2. consumerCount      — unique consumers served
 *   3. volumeScore        — total transaction value
 *   4. crossConsumption   — uses other agents' services
 *   5. diversityScore     — varied consumer base
 *   6. uptimeScore        — availability consistency
 *   7. latencyScore       — response time performance
 *   8. feedbackScore      — positive outcome reports received
 *   9. verifiedBonus      — verification tier multiplier
 *  10. referralScore      — new agents onboarded
 *  11. manifestScore      — manifest adherence rate
 *  12. defenseScore       — guardian/recovery setup
 */

import { getDb, logAudit } from '../db/connection';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Season {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'upcoming' | 'active' | 'completed';
  participantCount: number;
}

export interface SeasonEntry {
  did: string;
  displayName: string | null;
  dimensions: Record<string, number>;
  totalScore: number;
  rank: number;
}

// ─── Season Management ──────────────────────────────────────────────────────

export function createSeason(name: string, durationDays: number = 30): Season {
  const id = `season-${nanoid(8)}`;
  const startDate = new Date().toISOString();
  const endDate = new Date(Date.now() + durationDays * 86_400_000).toISOString();

  getDb().prepare(`
    INSERT INTO aid_seasons (id, name, start_date, end_date, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(id, name, startDate, endDate);

  logAudit({ entityType: 'season', entityId: id, action: 'created', data: { name, durationDays } });

  return { id, name, startDate, endDate, status: 'active', participantCount: 0 };
}

export function getActiveSeason(): Season | null {
  const row = getDb().prepare(`
    SELECT id, name, start_date, end_date, status,
           (SELECT COUNT(DISTINCT did) FROM aid_season_entries WHERE season_id = aid_seasons.id) as participants
    FROM aid_seasons WHERE status = 'active' LIMIT 1
  `).get() as any;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    participantCount: row.participants,
  };
}

/**
 * Compute seasonal scores for all active agents.
 * Called at season end or on-demand for leaderboard.
 */
export function computeSeasonScores(seasonId: string): SeasonEntry[] {
  const agents = getDb().prepare(`
    SELECT ak.did, ak.display_name, ak.owner_key, ak.created_at
    FROM aid_keys ak
    WHERE ak.key_status = 'active' AND ak.frozen = 0
  `).all() as Array<{ did: string; display_name: string | null; owner_key: string; created_at: string }>;

  const season = getDb().prepare(`SELECT start_date, end_date FROM aid_seasons WHERE id = ?`).get(seasonId) as { start_date: string; end_date: string } | undefined;
  if (!season) return [];

  const entries: SeasonEntry[] = [];

  for (const agent of agents) {
    // Get attestation stats for the season period
    const stats = getDb().prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes,
        COUNT(DISTINCT source_key) as unique_consumers,
        AVG(duration_ms) as avg_latency
      FROM attestations
      WHERE owner_key = ? AND created_at BETWEEN ? AND ?
    `).get(agent.owner_key, season.start_date, season.end_date) as any;

    if (!stats || stats.total === 0) continue;

    // Compute 12 dimensions
    const dimensions: Record<string, number> = {
      successRate: stats.total > 0 ? stats.successes / stats.total : 0,
      consumerCount: Math.min(stats.unique_consumers / 50, 1),
      volumeScore: Math.min(stats.total / 500, 1),
      crossConsumption: 0, // Would need cross-consumption data
      diversityScore: Math.min(stats.unique_consumers / Math.max(stats.total * 0.2, 1), 1),
      uptimeScore: 0.8, // Default — would need health check data
      latencyScore: stats.avg_latency ? Math.max(0, 1 - stats.avg_latency / 5000) : 0.5,
      feedbackScore: 0.5, // Default — would need feedback data
      verifiedBonus: 0, // Would need verification status
      referralScore: 0, // Would need referral data
      manifestScore: 0.5, // Default
      defenseScore: 0, // Would need guardian/recovery data
    };

    // Check for recovery keys (defense score)
    try {
      const recoveryKeys = getDb().prepare(
        `SELECT COUNT(*) as n FROM aid_recovery_keys WHERE did = ? AND status = 'active'`
      ).get(agent.did) as { n: number };
      dimensions.defenseScore = Math.min(recoveryKeys.n / 2, 1); // 2+ keys = 1.0
    } catch { /* non-critical */ }

    // Check for manifest adherence
    try {
      const manifest = getDb().prepare(`
        SELECT manifest_aligned, manifest_unaligned
        FROM attestation_stats WHERE owner_key = ?
      `).get(agent.owner_key) as { manifest_aligned: number; manifest_unaligned: number } | undefined;
      if (manifest) {
        const total = manifest.manifest_aligned + manifest.manifest_unaligned;
        dimensions.manifestScore = total > 0 ? manifest.manifest_aligned / total : 0.5;
      }
    } catch { /* non-critical */ }

    // Total score (equal weight across all 12 dimensions)
    const totalScore = Object.values(dimensions).reduce((sum, v) => sum + v, 0) / 12;

    entries.push({
      did: agent.did,
      displayName: agent.display_name,
      dimensions,
      totalScore: Number(totalScore.toFixed(4)),
      rank: 0,
    });
  }

  // Assign ranks
  entries.sort((a, b) => b.totalScore - a.totalScore);
  entries.forEach((e, i) => { e.rank = i + 1; });

  // Store entries
  const insertStmt = getDb().prepare(`
    INSERT OR REPLACE INTO aid_season_entries (season_id, did, dimensions_json, total_score, rank)
    VALUES (?, ?, ?, ?, ?)
  `);

  getDb().transaction(() => {
    for (const entry of entries) {
      insertStmt.run(seasonId, entry.did, JSON.stringify(entry.dimensions), entry.totalScore, entry.rank);
    }
  })();

  logger.info({ seasonId, participants: entries.length }, 'Season scores computed');

  return entries;
}

/**
 * Get season leaderboard.
 */
export function getSeasonLeaderboard(seasonId: string, limit: number = 50): SeasonEntry[] {
  const rows = getDb().prepare(`
    SELECT se.did, se.dimensions_json, se.total_score, se.rank,
           ak.display_name
    FROM aid_season_entries se
    LEFT JOIN aid_keys ak ON ak.did = se.did AND ak.key_status = 'active'
    WHERE se.season_id = ?
    ORDER BY se.rank ASC LIMIT ?
  `).all(seasonId, limit) as any[];

  return rows.map(r => ({
    did: r.did,
    displayName: r.display_name,
    dimensions: JSON.parse(r.dimensions_json || '{}'),
    totalScore: r.total_score,
    rank: r.rank,
  }));
}

/**
 * Close a season and snapshot final rankings.
 */
export function closeSeason(seasonId: string): void {
  // Compute final scores
  computeSeasonScores(seasonId);

  // Mark season as completed
  getDb().prepare(`UPDATE aid_seasons SET status = 'completed' WHERE id = ?`).run(seasonId);

  logAudit({ entityType: 'season', entityId: seasonId, action: 'closed' });
  logger.info({ seasonId }, 'Season closed');
}
