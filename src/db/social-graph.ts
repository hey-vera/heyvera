/**
 * social-graph.ts — Agent social graph (Phase 3, from ClawstrAI)
 *
 * Lightweight follow/endorse between agents. Social signals feed the
 * COMMUNITY trust dimension in Trust Score v2.
 *
 * Relationships:
 *   follow   — agent A follows agent B (discovery signal)
 *   endorse  — agent A endorses agent B (trust signal, weighted by A's score)
 *   block    — agent A blocks agent B (negative signal)
 *
 * Anti-gaming:
 *   - Mutual endorsements weighted at 0.1x (Section 39.9)
 *   - Endorsement weight = endorser's trust score / 100
 *   - Max 100 endorsements per agent (prevent spam)
 *   - Block signals are private (not exposed in public APIs)
 */

import { getDb, logAudit } from './connection';
import { nanoid } from 'nanoid';

// ─── Types ──────────────────────────────────────────────────────────────────

export type RelationType = 'follow' | 'endorse' | 'block';

export interface SocialRelation {
  id: string;
  fromDid: string;
  toDid: string;
  relationType: RelationType;
  weight: number;
  note: string | null;
  createdAt: string;
}

export interface SocialStats {
  followers: number;
  following: number;
  endorsements: number;
  endorsedBy: number;
  endorsementScore: number; // sum of weighted endorsements
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function createRelation(data: {
  fromDid: string;
  toDid: string;
  relationType: RelationType;
  weight?: number;
  note?: string;
}): SocialRelation {
  if (data.fromDid === data.toDid) {
    throw new Error('Cannot create self-relation');
  }

  // Check for existing relation of same type
  const existing = getDb().prepare(`
    SELECT id FROM aid_social_graph
    WHERE from_did = ? AND to_did = ? AND relation_type = ?
  `).get(data.fromDid, data.toDid, data.relationType) as { id: string } | undefined;

  if (existing) {
    throw new Error(`${data.relationType} relation already exists`);
  }

  // Endorsement limit
  if (data.relationType === 'endorse') {
    const count = getDb().prepare(`
      SELECT COUNT(*) as n FROM aid_social_graph
      WHERE from_did = ? AND relation_type = 'endorse'
    `).get(data.fromDid) as { n: number };

    if (count.n >= 100) {
      throw new Error('Maximum 100 endorsements per agent');
    }
  }

  const id = `rel-${nanoid(16)}`;
  const weight = data.weight ?? 1.0;

  getDb().prepare(`
    INSERT INTO aid_social_graph (id, from_did, to_did, relation_type, weight, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.fromDid, data.toDid, data.relationType, weight, data.note || null);

  return {
    id, fromDid: data.fromDid, toDid: data.toDid,
    relationType: data.relationType, weight, note: data.note || null,
    createdAt: new Date().toISOString(),
  };
}

export function removeRelation(fromDid: string, toDid: string, relationType: RelationType): boolean {
  return getDb().prepare(`
    DELETE FROM aid_social_graph WHERE from_did = ? AND to_did = ? AND relation_type = ?
  `).run(fromDid, toDid, relationType).changes > 0;
}

export function getFollowers(did: string, limit: number = 50): SocialRelation[] {
  return getDb().prepare(`
    SELECT * FROM aid_social_graph
    WHERE to_did = ? AND relation_type = 'follow'
    ORDER BY created_at DESC LIMIT ?
  `).all(did, limit) as any[];
}

export function getFollowing(did: string, limit: number = 50): SocialRelation[] {
  return getDb().prepare(`
    SELECT * FROM aid_social_graph
    WHERE from_did = ? AND relation_type = 'follow'
    ORDER BY created_at DESC LIMIT ?
  `).all(did, limit) as any[];
}

export function getEndorsements(did: string, limit: number = 50): SocialRelation[] {
  return getDb().prepare(`
    SELECT * FROM aid_social_graph
    WHERE to_did = ? AND relation_type = 'endorse'
    ORDER BY weight DESC, created_at DESC LIMIT ?
  `).all(did, limit) as any[];
}

export function getSocialStats(did: string): SocialStats {
  const followers = getDb().prepare(
    `SELECT COUNT(*) as n FROM aid_social_graph WHERE to_did = ? AND relation_type = 'follow'`
  ).get(did) as { n: number };

  const following = getDb().prepare(
    `SELECT COUNT(*) as n FROM aid_social_graph WHERE from_did = ? AND relation_type = 'follow'`
  ).get(did) as { n: number };

  const endorsements = getDb().prepare(
    `SELECT COUNT(*) as n FROM aid_social_graph WHERE from_did = ? AND relation_type = 'endorse'`
  ).get(did) as { n: number };

  const endorsedBy = getDb().prepare(
    `SELECT COUNT(*) as n, COALESCE(SUM(weight), 0) as total_weight FROM aid_social_graph WHERE to_did = ? AND relation_type = 'endorse'`
  ).get(did) as { n: number; total_weight: number };

  // Apply mutual endorsement decay (Section 39.9)
  // Mutual endorsements count at 0.1x weight
  const mutualCount = getDb().prepare(`
    SELECT COUNT(*) as n FROM aid_social_graph a
    INNER JOIN aid_social_graph b ON a.from_did = b.to_did AND a.to_did = b.from_did
    WHERE a.to_did = ? AND a.relation_type = 'endorse' AND b.relation_type = 'endorse'
  `).get(did) as { n: number };

  const effectiveScore = endorsedBy.total_weight - (mutualCount.n * 0.9); // mutual = 0.1x, so subtract 0.9x

  return {
    followers: followers.n,
    following: following.n,
    endorsements: endorsements.n,
    endorsedBy: endorsedBy.n,
    endorsementScore: Math.max(0, Number(effectiveScore.toFixed(2))),
  };
}

/**
 * Get cross-consumption stats for an agent (Phase 4 trust signal).
 * Tracks how many different providers this agent uses.
 */
export function getCrossConsumptionStats(ownerKey: string): {
  uniqueProviders: number;
  totalConsumption: number;
  diversityScore: number;
} {
  try {
    const stats = getDb().prepare(`
      SELECT COUNT(DISTINCT
        CASE WHEN action_type IN ('skill_invoke', 'data_query', 'orchestrate')
        THEN tx_id END
      ) as total,
      COUNT(DISTINCT
        CASE WHEN action_type IN ('skill_invoke', 'data_query', 'orchestrate')
        THEN source_key END
      ) as unique_providers
      FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
    `).get(ownerKey) as { total: number; unique_providers: number };

    const diversityScore = stats.total > 0
      ? Math.min(1, stats.unique_providers / Math.max(3, stats.total * 0.1))
      : 0;

    return {
      uniqueProviders: stats.unique_providers,
      totalConsumption: stats.total,
      diversityScore: Number(diversityScore.toFixed(3)),
    };
  } catch {
    return { uniqueProviders: 0, totalConsumption: 0, diversityScore: 0 };
  }
}
