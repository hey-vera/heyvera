/**
 * sybil-signal.ts — Sybil risk as supplementary signal in trust scoring
 *
 * Computes a Sybil risk score based on behavioral patterns, not wallet analysis.
 * Detects suspicious patterns that suggest an agent may be part of a Sybil cluster.
 *
 * Signals analyzed (4 implemented):
 *   1. Counterparty concentration — transacts with very few unique counterparties
 *   2. Temporal clustering — bursts of activity followed by inactivity
 *   3. Feedback reciprocity — mutual positive feedback patterns
 *   4. Volume/diversity ratio — high volume but low counterparty diversity
 */

import { getDb } from '../db/connection';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SybilRiskAssessment {
  /** Overall Sybil risk score (0-1, higher = more suspicious) */
  riskScore: number;
  /** Risk level classification */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** Individual signal scores */
  signals: {
    counterpartyConcentration: number; // 0-1
    temporalClustering: number;        // 0-1
    feedbackReciprocity: number;       // 0-1
    volumeDiversityRatio: number;      // 0-1
  };
  /** Human-readable explanation */
  explanation: string;
  /** Number of data points analyzed */
  dataPoints: number;
}

// ─── Risk Assessment ────────────────────────────────────────────────────────

/**
 * Assess Sybil risk for an agent based on behavioral patterns.
 *
 * @param ownerKey - The agent's owner key
 * @param did - The agent's DID
 */
export function assessSybilRisk(ownerKey: string, did: string): SybilRiskAssessment {
  let dataPoints = 0;

  // 1. Counterparty concentration (trust-weighted diversity)
  //    Raw unique count is trivially gameable — 100 Sybil counterparties score the same as 100 real ones.
  //    Trust-weighted: each counterparty weighted by their pulse tree activity level.
  //    Interacting with 100 zero-activity Sybils < interacting with 10 active agents.
  let counterpartyConcentration = 0;
  try {
    // Get counterparties from bilateral pulse entries (more reliable than attestation source_key)
    const counterparties = getDb().prepare(`
      SELECT DISTINCT b.agent_did as counterparty_did
      FROM pulse_tree_leaves a
      JOIN pulse_tree_leaves b ON a.bilateral_ref = b.id
      WHERE a.agent_did = ? AND a.timestamp > datetime('now', '-30 days')
    `).all(did) as Array<{ counterparty_did: string }>;

    const totalEntries = (getDb().prepare(`
      SELECT COUNT(*) as n FROM pulse_tree_leaves
      WHERE agent_did = ? AND timestamp > datetime('now', '-30 days')
    `).get(did) as { n: number }).n;

    dataPoints += totalEntries;

    if (totalEntries >= 10) {
      // Weight each counterparty by their own activity (pulse heartbeat count)
      // Active agents contribute 1.0, new/empty agents contribute near 0
      let weightedDiversity = 0;
      for (const cp of counterparties) {
        const cpState = getDb().prepare(
          'SELECT heartbeat_index FROM agent_pulse_state WHERE agent_did = ?'
        ).get(cp.counterparty_did) as { heartbeat_index: number } | undefined;
        // Weight: min(heartbeats / 50, 1.0) — 50+ heartbeats = fully trusted counterparty
        const weight = Math.min((cpState?.heartbeat_index ?? 0) / 50, 1.0);
        weightedDiversity += weight;
      }

      // Trust-weighted ratio: high-quality counterparties score better than raw count
      const weightedRatio = weightedDiversity / Math.max(1, totalEntries);
      counterpartyConcentration = Math.max(0, 1 - weightedRatio * 5);
    }

    // Fallback: also check attestation-based diversity for agents without bilateral entries
    if (dataPoints === 0) {
      const stats = getDb().prepare(`
        SELECT COUNT(*) as total,
               COUNT(DISTINCT source_key) as unique_counterparties
        FROM attestations
        WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
      `).get(ownerKey) as { total: number; unique_counterparties: number };

      dataPoints += stats.total;
      if (stats.total >= 10) {
        const ratio = stats.unique_counterparties / Math.max(1, stats.total);
        counterpartyConcentration = Math.max(0, 1 - ratio * 5);
      }
    }
  } catch { /* non-critical */ }

  // 2. Temporal clustering (bursts of activity)
  let temporalClustering = 0;
  try {
    // Check if >50% of attestations happened in a single 1-hour window
    const burstCheck = getDb().prepare(`
      SELECT strftime('%Y-%m-%d %H', created_at) as hour_bucket, COUNT(*) as n
      FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
      GROUP BY hour_bucket
      ORDER BY n DESC LIMIT 1
    `).get(ownerKey) as { hour_bucket: string; n: number } | undefined;

    const totalRecent = getDb().prepare(`
      SELECT COUNT(*) as n FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
    `).get(ownerKey) as { n: number };

    if (burstCheck && totalRecent.n >= 10) {
      const burstRatio = burstCheck.n / totalRecent.n;
      temporalClustering = Math.max(0, burstRatio - 0.3) / 0.7; // >30% in one hour = suspicious
    }
  } catch { /* non-critical */ }

  // 3. Feedback reciprocity (mutual positive feedback)
  let feedbackReciprocity = 0;
  try {
    const totalFeedback = getDb().prepare(`
      SELECT COUNT(*) as n FROM aid_feedback WHERE reporter_did = ?
    `).get(did) as { n: number };

    const mutualFeedback = getDb().prepare(`
      SELECT COUNT(*) as n FROM aid_feedback a
      WHERE a.reporter_did = ?
      AND EXISTS (
        SELECT 1 FROM aid_feedback b
        WHERE b.reporter_did = a.provider_did AND b.provider_did = a.reporter_did
        AND b.created_at > datetime('now', '-30 days')
      )
    `).get(did) as { n: number };

    if (totalFeedback.n >= 3) {
      feedbackReciprocity = mutualFeedback.n / totalFeedback.n;
    }
  } catch { /* non-critical */ }

  // 4. Volume/diversity ratio
  let volumeDiversityRatio = 0;
  try {
    const vd = getDb().prepare(`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT action_type) as unique_actions,
             COUNT(DISTINCT source_key) as unique_sources
      FROM attestations WHERE owner_key = ?
    `).get(ownerKey) as { total: number; unique_actions: number; unique_sources: number };

    if (vd.total >= 20) {
      // High volume but low diversity = suspicious
      const actionDiversity = vd.unique_actions / Math.min(vd.total, 10);
      const sourceDiversity = vd.unique_sources / Math.min(vd.total, 50);
      volumeDiversityRatio = Math.max(0, 1 - (actionDiversity + sourceDiversity));
    }
  } catch { /* non-critical */ }

  // Composite risk score (weighted)
  const riskScore = Number((
    counterpartyConcentration * 0.35 +
    temporalClustering * 0.25 +
    feedbackReciprocity * 0.25 +
    volumeDiversityRatio * 0.15
  ).toFixed(3));

  const riskLevel = riskScore >= 0.7 ? 'critical'
    : riskScore >= 0.5 ? 'high'
    : riskScore >= 0.3 ? 'medium'
    : 'low';

  const explanations: string[] = [];
  if (counterpartyConcentration > 0.5) explanations.push('high counterparty concentration');
  if (temporalClustering > 0.5) explanations.push('suspicious temporal clustering');
  if (feedbackReciprocity > 0.5) explanations.push('mutual feedback pattern detected');
  if (volumeDiversityRatio > 0.5) explanations.push('low action diversity for volume');

  return {
    riskScore,
    riskLevel,
    signals: {
      counterpartyConcentration,
      temporalClustering,
      feedbackReciprocity,
      volumeDiversityRatio,
    },
    explanation: explanations.length > 0
      ? `Sybil risk: ${explanations.join(', ')}`
      : 'No suspicious patterns detected',
    dataPoints,
  };
}
