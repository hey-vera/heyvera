/**
 * trust-scoring-v2.ts — Trust Score v2 (11 dimensions, 3 categories)
 *
 * Expands from 4 dimensions (v1.0) to 11 dimensions across 3 categories:
 *   BEHAVIORAL (50%): successRate, latencyConsistency, chainCoverage, uptimeScore, outcomeReports, manifestAdherence
 *   MARKET (30%):     stakingDemand, consumerDiversity, crossConsumption, volumeGrowth
 *   COMMUNITY (20%):  validatorVerdicts, reportPenalty, verificationTier
 *
 * Progressive weight rebalancing (per AID spec Section 19.5):
 *   Phase 1-2: Behavioral 65%, Community 35% (no market layer yet)
 *   Phase 3:   Behavioral 60%, Community 25%, Market 15%
 *   Phase 4+:  Behavioral 50%, Market 30%, Community 20%
 */

import { getDb } from '../db/connection';
import { aidHash } from '../utils/crypto-agility';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrustScoreV2 {
  score: number;
  verdict: string;
  verificationMultiplier: number;
  categories: {
    behavioral: { weight: number; score: number; dimensions: Record<string, number> };
    market: { weight: number; score: number; dimensions: Record<string, number> };
    community: { weight: number; score: number; dimensions: Record<string, number> };
  };
  proofHash: string;
  computedAt: string;
}

// ─── Current Phase Weights ──────────────────────────────────────────────────

const CURRENT_PHASE = 2; // Phase 1-2: no market layer

function getCategoryWeights(): { behavioral: number; market: number; community: number } {
  switch (CURRENT_PHASE) {
    case 1:
    case 2: return { behavioral: 0.65, market: 0, community: 0.35 };
    case 3: return { behavioral: 0.60, market: 0.15, community: 0.25 };
    default: return { behavioral: 0.50, market: 0.30, community: 0.20 };
  }
}

// ─── Dimension Computation ──────────────────────────────────────────────────

function computeBehavioral(ownerKey: string): Record<string, number> {
  const stats = getDb().prepare(`
    SELECT success_count, total_attestations, manifest_aligned, manifest_unaligned
    FROM attestation_stats WHERE owner_key = ? LIMIT 1
  `).get(ownerKey) as any;

  if (!stats || stats.total_attestations === 0) {
    return { successRate: 0, latencyConsistency: 0.5, chainCoverage: 0.5, uptimeScore: 0.5, outcomeReports: 0, manifestAdherence: 0.5 };
  }

  // successRate
  const successRate = stats.success_count / stats.total_attestations;

  // latencyConsistency — how consistent are response times?
  let latencyConsistency = 0.5;
  try {
    const latencies = getDb().prepare(`
      SELECT duration_ms FROM attestations
      WHERE owner_key = ? AND duration_ms IS NOT NULL
      ORDER BY created_at DESC LIMIT 100
    `).all(ownerKey) as { duration_ms: number }[];

    if (latencies.length >= 10) {
      const mean = latencies.reduce((s, l) => s + l.duration_ms, 0) / latencies.length;
      const variance = latencies.reduce((s, l) => s + Math.pow(l.duration_ms - mean, 2), 0) / latencies.length;
      const cv = Math.sqrt(variance) / Math.max(mean, 1); // coefficient of variation
      latencyConsistency = Math.max(0, 1 - cv); // lower CV = more consistent
    }
  } catch { /* non-critical */ }

  // chainCoverage — hash-chain integrity
  const chainCoverage = 0.5; // TODO: compute from attestation hash chain

  // uptimeScore — based on proof-of-life heartbeats
  let uptimeScore = 0.5;
  try {
    const key = getDb().prepare(
      `SELECT last_heartbeat, heartbeat_interval_days FROM aid_keys WHERE owner_key = ? AND key_status = 'active' LIMIT 1`
    ).get(ownerKey) as any;
    if (key?.last_heartbeat) {
      const daysSinceHeartbeat = (Date.now() - new Date(key.last_heartbeat).getTime()) / 86_400_000;
      const interval = key.heartbeat_interval_days || 7;
      uptimeScore = daysSinceHeartbeat <= interval ? 1.0 : Math.max(0, 1 - (daysSinceHeartbeat - interval) / (interval * 3));
    }
  } catch { /* non-critical */ }

  // outcomeReports — positive feedback received
  let outcomeReports = 0;
  try {
    const feedback = getDb().prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as positive
      FROM aid_feedback WHERE provider_did IN (
        SELECT did FROM aid_keys WHERE owner_key = ?
      )
    `).get(ownerKey) as { total: number; positive: number } | undefined;
    if (feedback && feedback.total > 0) {
      outcomeReports = feedback.positive / feedback.total;
    }
  } catch { /* non-critical */ }

  // manifestAdherence
  const manifestTotal = stats.manifest_aligned + stats.manifest_unaligned;
  const manifestAdherence = manifestTotal > 0 ? stats.manifest_aligned / manifestTotal : 0.5;

  return { successRate, latencyConsistency, chainCoverage, uptimeScore, outcomeReports, manifestAdherence };
}

function computeMarket(ownerKey: string): Record<string, number> {
  if (CURRENT_PHASE <= 2) {
    // No market layer yet — use proxies
    return { stakingDemand: 0.5, consumerDiversity: 0.5, crossConsumption: 0.5, volumeGrowth: 0.5 };
  }

  // Phase 3+: real market data
  let consumerDiversity = 0;
  let crossConsumption = 0;
  let volumeGrowth = 0;

  try {
    // consumerDiversity
    const consumers = getDb().prepare(`
      SELECT COUNT(DISTINCT source_key) as unique_consumers,
             COUNT(*) as total
      FROM attestations WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
    `).get(ownerKey) as { unique_consumers: number; total: number };
    consumerDiversity = consumers.total > 0 ? Math.min(consumers.unique_consumers / 20, 1) : 0;

    // crossConsumption — does this agent USE other agents?
    const consumed = getDb().prepare(`
      SELECT COUNT(DISTINCT source_key) as providers
      FROM attestations
      WHERE owner_key = ? AND action_type IN ('skill_invoke', 'data_query')
      AND created_at > datetime('now', '-30 days')
    `).get(ownerKey) as { providers: number };
    crossConsumption = Math.min(consumed.providers / 5, 1);

    // volumeGrowth — 7-day vs 30-day volume
    const recent = getDb().prepare(`
      SELECT COUNT(*) as n FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-7 days')
    `).get(ownerKey) as { n: number };
    const older = getDb().prepare(`
      SELECT COUNT(*) as n FROM attestations
      WHERE owner_key = ? AND created_at BETWEEN datetime('now', '-30 days') AND datetime('now', '-7 days')
    `).get(ownerKey) as { n: number };
    const weeklyRate = recent.n / 7;
    const olderWeeklyRate = older.n / 23;
    volumeGrowth = olderWeeklyRate > 0 ? Math.min(weeklyRate / olderWeeklyRate, 2) / 2 : 0.5;
  } catch { /* non-critical */ }

  return { stakingDemand: 0.5, consumerDiversity, crossConsumption, volumeGrowth };
}

function computeCommunity(ownerKey: string, did: string): Record<string, number> {
  let validatorVerdicts = 0.5;
  let reportPenalty = 0;
  let verificationTier = 0;

  try {
    // validatorVerdicts — weighted validator ratings
    const validations = getDb().prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN verdict = 'legitimate' THEN 1 ELSE 0 END) as positive
      FROM validations WHERE target_key = ?
    `).get(ownerKey) as { total: number; positive: number } | undefined;

    if (validations && validations.total > 0) {
      validatorVerdicts = validations.positive / validations.total;
    }
  } catch { /* non-critical */ }

  try {
    // reportPenalty — structured reports against this agent
    const reports = getDb().prepare(`
      SELECT COUNT(*) as n FROM aid_disputes
      WHERE respondent_did = ? AND outcome = 'refund'
    `).get(did) as { n: number } | undefined;
    reportPenalty = reports ? Math.min(reports.n * 0.1, 1) : 0;
  } catch { /* non-critical */ }

  try {
    // verificationTier — social graph endorsement score
    const endorsements = getDb().prepare(`
      SELECT COALESCE(SUM(weight), 0) as total FROM aid_social_graph
      WHERE to_did = ? AND relation_type = 'endorse'
    `).get(did) as { total: number } | undefined;
    verificationTier = endorsements ? Math.min(endorsements.total / 10, 1) : 0;
  } catch { /* non-critical */ }

  return {
    validatorVerdicts,
    reportPenalty: 1 - reportPenalty, // invert: 0 penalty = 1.0 score
    verificationTier,
  };
}

// ─── Main Computation ───────────────────────────────────────────────────────

/**
 * Compute Trust Score v2 with 11 dimensions across 3 categories.
 */
export function computeTrustScoreV2(ownerKey: string, did: string): TrustScoreV2 {
  const weights = getCategoryWeights();

  const behavioral = computeBehavioral(ownerKey);
  const market = computeMarket(ownerKey);
  const community = computeCommunity(ownerKey, did);

  // Average each category
  const behavioralValues = Object.values(behavioral);
  const marketValues = Object.values(market);
  const communityValues = Object.values(community);

  const behavioralAvg = behavioralValues.reduce((s, v) => s + v, 0) / behavioralValues.length;
  const marketAvg = marketValues.reduce((s, v) => s + v, 0) / marketValues.length;
  const communityAvg = communityValues.reduce((s, v) => s + v, 0) / communityValues.length;

  // Weighted composite
  const rawScore = (behavioralAvg * weights.behavioral + marketAvg * weights.market + communityAvg * weights.community) * 100;

  // Verification multiplier
  let verificationMultiplier = 1.0;
  try {
    const recoveryKeys = getDb().prepare(
      `SELECT COUNT(*) as n FROM aid_recovery_keys WHERE did = ? AND status = 'active'`
    ).get(did) as { n: number } | undefined;
    if (recoveryKeys && recoveryKeys.n >= 2) verificationMultiplier = 1.1;
  } catch { /* non-critical */ }

  const finalScore = Math.min(100, Math.round(rawScore * verificationMultiplier));

  // Verdict
  const verdict = finalScore >= 90 ? 'proceed' : finalScore >= 80 ? 'trusted' :
    finalScore >= 60 ? 'standard' : finalScore >= 40 ? 'caution' :
    finalScore >= 20 ? 'building' : 'new';

  // Proof hash
  const proofInput = JSON.stringify({
    behavioral, market, community, weights,
    rawScore, verificationMultiplier, finalScore,
  });
  const proofHash = aidHash(proofInput);

  return {
    score: finalScore,
    verdict,
    verificationMultiplier,
    categories: {
      behavioral: { weight: weights.behavioral, score: Number(behavioralAvg.toFixed(4)), dimensions: behavioral },
      market: { weight: weights.market, score: Number(marketAvg.toFixed(4)), dimensions: market },
      community: { weight: weights.community, score: Number(communityAvg.toFixed(4)), dimensions: community },
    },
    proofHash,
    computedAt: new Date().toISOString(),
  };
}
