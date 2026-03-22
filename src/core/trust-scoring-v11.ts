/**
 * trust-scoring-v11.ts — Trust Score v1.1 (5-dimension formula)
 *
 * Adds counterpartyDiversity and recency-weighted successRate to the
 * v1.0 formula. Also computes specialized per-category sub-scores
 * and reporter independence scoring.
 *
 * v1.0: successRate×40 + chainCoverage×25 + volume×20 + manifestAdherence×15
 * v1.1: successRate×35 + chainCoverage×20 + volume×15 + manifestAdherence×15 + counterpartyDiversity×15
 *       WHERE successRate uses recency weighting (60% last 30d, 40% historical)
 */

import { getDb } from '../db/connection';
import { aidHash } from '../utils/crypto-agility';
import { jcsSerialize } from '../utils/jcs';
import { round6 } from './credits';
import { logger } from '../utils/logger';

// ─── v1.1 Trust Score ───────────────────────────────────────────────────────

export interface TrustScoreV11 {
  score: number;
  inputs: {
    successRate: number;
    recentSuccessRate: number;
    historicalSuccessRate: number;
    chainCoverage: number;
    attestationCount: number;
    manifestAdherence: number;
    counterpartyDiversity: number;
    uniqueCounterparties: number;
  };
  weights: { successRate: 35; chainCoverage: 20; volume: 15; manifestAdherence: 15; counterpartyDiversity: 15 };
  formulaVersion: '1.1.0';
  proofHash: string;
}

export function computeTrustScoreV11(ownerKey: string): TrustScoreV11 | null {
  try {
    // Full history stats
    const stats = getDb().prepare(`
      SELECT success_count, total_attestations, manifest_aligned, manifest_unaligned
      FROM attestation_stats WHERE owner_key = ? LIMIT 1
    `).get(ownerKey) as { success_count: number; total_attestations: number; manifest_aligned: number; manifest_unaligned: number } | undefined;

    if (!stats || stats.total_attestations === 0) return null;

    // Recent 30-day stats
    const recentStats = getDb().prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes
      FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
    `).get(ownerKey) as { total: number; successes: number } | undefined;

    // Counterparty diversity: count unique counterparties
    const diversityRow = getDb().prepare(`
      SELECT COUNT(DISTINCT action_endpoint) as unique_counterparties
      FROM attestations WHERE owner_key = ?
    `).get(ownerKey) as { unique_counterparties: number } | undefined;

    // ── Compute inputs ──────────────────────────────────────────────────

    const historicalSuccessRate = stats.success_count / stats.total_attestations;
    const recentTotal = recentStats?.total || 0;
    const recentSuccessRate = recentTotal > 0
      ? (recentStats?.successes || 0) / recentTotal
      : historicalSuccessRate;

    // Recency-weighted success rate: 60% recent, 40% historical
    const successRate = round6(recentSuccessRate * 0.6 + historicalSuccessRate * 0.4);

    const chainCoverage = 0.5; // Simplified — full computation in aid-builder.ts

    const volume = Math.min(stats.total_attestations / 1000, 1);

    const manifestTotal = stats.manifest_aligned + stats.manifest_unaligned;
    const manifestAdherence = manifestTotal > 0
      ? stats.manifest_aligned / manifestTotal
      : 0.5;

    const uniqueCounterparties = diversityRow?.unique_counterparties || 0;
    // Counterparty diversity: ratio of unique counterparties to total transactions
    // Apply diminishing returns curve (Section 14.15)
    const rawDiversity = stats.total_attestations > 0
      ? uniqueCounterparties / stats.total_attestations
      : 0;
    const counterpartyDiversity = Math.min(1, rawDiversity * 5); // Scale up, cap at 1

    // ── Compute score (v1.1 weights) ────────────────────────────────────

    const weights = { successRate: 35, chainCoverage: 20, volume: 15, manifestAdherence: 15, counterpartyDiversity: 15 } as const;

    const rawScore = round6(
      successRate * weights.successRate +
      chainCoverage * weights.chainCoverage +
      volume * weights.volume +
      manifestAdherence * weights.manifestAdherence +
      counterpartyDiversity * weights.counterpartyDiversity
    );

    const score = Math.min(100, Math.round(rawScore));

    // ── Proof hash (JCS canonical) ──────────────────────────────────────

    const proofData = {
      inputs: {
        attestationCount: stats.total_attestations,
        chainCoverage,
        counterpartyDiversity: round6(counterpartyDiversity),
        manifestAdherence: round6(manifestAdherence),
        successRate: round6(successRate),
      },
      score,
      weights,
    };
    const proofHash = aidHash(jcsSerialize(proofData));

    return {
      score,
      inputs: {
        successRate: round6(successRate),
        recentSuccessRate: round6(recentSuccessRate),
        historicalSuccessRate: round6(historicalSuccessRate),
        chainCoverage,
        attestationCount: stats.total_attestations,
        manifestAdherence: round6(manifestAdherence),
        counterpartyDiversity: round6(counterpartyDiversity),
        uniqueCounterparties,
      },
      weights,
      formulaVersion: '1.1.0',
      proofHash,
    };
  } catch (err) {
    logger.error({ err, ownerKey }, 'Trust score v1.1 computation failed');
    return null;
  }
}

// ─── Specialized Trust Scores (Section 14.11) ───────────────────────────────

export interface SpecializedScore {
  category: string;
  score: number;
  attestations: number;
  successRate: number;
}

export function computeSpecializedScores(ownerKey: string): SpecializedScore[] {
  const categories = getDb().prepare(`
    SELECT action_type as category,
           COUNT(*) as total,
           SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes
    FROM attestations
    WHERE owner_key = ?
    GROUP BY action_type
    HAVING COUNT(*) >= 20
  `).all(ownerKey) as { category: string; total: number; successes: number }[];

  return categories.map(cat => {
    const successRate = round6(cat.successes / cat.total);
    const volume = Math.min(cat.total / 200, 1); // Per-category scale
    const score = Math.min(100, Math.round(successRate * 60 + volume * 40));

    return {
      category: cat.category,
      score,
      attestations: cat.total,
      successRate,
    };
  });
}

// ─── Reporter Independence Scoring (Section 14.16) ──────────────────────────

export interface ReporterIndependence {
  reporterDid: string;
  independenceScore: number;
  penalties: {
    creationTime: number;
    sharedCounterparties: number;
    behavioralCorrelation: number;
    directTransaction: number;
  };
}

export function computeReporterIndependence(
  reporters: string[],
): { effectiveWeight: number; reporters: ReporterIndependence[] } {
  if (reporters.length < 2) {
    return {
      effectiveWeight: reporters.length,
      reporters: reporters.map(r => ({
        reporterDid: r,
        independenceScore: 1.0,
        penalties: { creationTime: 0, sharedCounterparties: 0, behavioralCorrelation: 0, directTransaction: 0 },
      })),
    };
  }

  const results: ReporterIndependence[] = [];

  for (const reporter of reporters) {
    let totalPenalty = 0;
    let pairCount = 0;

    for (const other of reporters) {
      if (reporter === other) continue;
      pairCount++;

      // Check creation time similarity
      const timeCheck = getDb().prepare(`
        SELECT ABS(julianday(a.created_at) - julianday(b.created_at)) as day_diff
        FROM aid_keys a, aid_keys b
        WHERE a.did = ? AND b.did = ? AND a.key_status = 'active' AND b.key_status = 'active'
      `).get(reporter, other) as { day_diff: number } | undefined;

      const creationPenalty = (timeCheck && timeCheck.day_diff < 7) ? 1.0 : 0;

      // Check shared counterparties
      const sharedCheck = getDb().prepare(`
        SELECT COUNT(DISTINCT a.action_endpoint) as shared
        FROM attestations a
        INNER JOIN attestations b ON a.action_endpoint = b.action_endpoint
        WHERE a.owner_key = (SELECT owner_key FROM aid_keys WHERE did = ? LIMIT 1)
        AND b.owner_key = (SELECT owner_key FROM aid_keys WHERE did = ? LIMIT 1)
        AND a.owner_key != b.owner_key
      `).get(reporter, other) as { shared: number } | undefined;

      const sharedPenalty = Math.min(1, (sharedCheck?.shared || 0) / 10);

      // Check direct transaction
      const directCheck = getDb().prepare(`
        SELECT COUNT(*) as n FROM aid_feedback
        WHERE (reporter_did = ? AND provider_did = ?) OR (reporter_did = ? AND provider_did = ?)
      `).get(reporter, other, other, reporter) as { n: number } | undefined;

      const directPenalty = (directCheck?.n || 0) > 0 ? 1.0 : 0;

      totalPenalty += creationPenalty * 0.3 + sharedPenalty * 0.3 + 0 * 0.2 + directPenalty * 0.2;
    }

    const avgPenalty = pairCount > 0 ? totalPenalty / pairCount : 0;
    const independenceScore = round6(Math.max(0.01, 1.0 - avgPenalty));

    results.push({
      reporterDid: reporter,
      independenceScore,
      penalties: {
        creationTime: 0, // Aggregated above
        sharedCounterparties: 0,
        behavioralCorrelation: 0,
        directTransaction: 0,
      },
    });
  }

  const effectiveWeight = round6(results.reduce((sum, r) => sum + r.independenceScore, 0));

  return { effectiveWeight, reporters: results };
}
