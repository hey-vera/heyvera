/**
 * aid-explain.ts — Trust Score Explanation + Prediction APIs (Cherry 1 + Cherry 8)
 *
 * Endpoints:
 *   GET /aid/trust/:did/explain  — why is this agent's score what it is?
 *   GET /aid/trust/:did/predict  — where will this score be in 7/30/90 days?
 *   GET /aid/explore              — public agent explorer with search
 *
 * No competitor offers forward-looking trust intelligence or score explanations.
 */

import { Hono } from 'hono';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── GET /trust/:did/explain — Trust Score Explanation (Cherry 1) ────────────

router.get('/trust/:did/explain', async (c) => {
  const did = c.req.param('did');

  try {
    const aidKey = getDb().prepare(
      `SELECT owner_key FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1`
    ).get(did) as { owner_key: string } | undefined;

    if (!aidKey) {
      return c.json({ error: 'Agent not found', code: 'AID_DID_NOT_FOUND' }, 404);
    }

    // Get attestation stats
    const stats = getDb().prepare(`
      SELECT success_count, total_attestations, manifest_aligned, manifest_unaligned,
             last_decay_at, decay_factor
      FROM attestation_stats WHERE owner_key = ? LIMIT 1
    `).get(aidKey.owner_key) as {
      success_count: number; total_attestations: number;
      manifest_aligned: number; manifest_unaligned: number;
      last_decay_at: string | null; decay_factor: number | null;
    } | undefined;

    if (!stats || stats.total_attestations === 0) {
      return c.json({
        did,
        score: 0,
        verdict: 'new',
        explanation: 'No transaction history yet. Score will increase with successful attestations.',
        dimensions: [],
        recommendations: [
          { action: 'Complete your first transaction', impact: '+5-10 points', priority: 'high' },
          { action: 'Register recovery keys', impact: 'Enables freeze recovery', priority: 'medium' },
        ],
        cohortPercentile: 0,
      });
    }

    // Compute each dimension
    const successRate = stats.success_count / stats.total_attestations;
    const volume = Math.min(stats.total_attestations / 1000, 1);
    const manifestTotal = stats.manifest_aligned + stats.manifest_unaligned;
    const manifestAdherence = manifestTotal > 0 ? stats.manifest_aligned / manifestTotal : 0.5;
    const chainCoverage = 0.5; // Default for non-snapshot lookups

    const dimensions = [
      {
        name: 'successRate',
        weight: 40,
        value: Number(successRate.toFixed(3)),
        contribution: Number((successRate * 40).toFixed(1)),
        status: successRate >= 0.95 ? 'strong' : successRate >= 0.8 ? 'good' : successRate >= 0.5 ? 'weak' : 'poor',
        description: `${stats.success_count}/${stats.total_attestations} successful transactions (${(successRate * 100).toFixed(1)}%)`,
      },
      {
        name: 'chainCoverage',
        weight: 25,
        value: Number(chainCoverage.toFixed(3)),
        contribution: Number((chainCoverage * 25).toFixed(1)),
        status: 'neutral',
        description: 'Hash-chain integrity percentage',
      },
      {
        name: 'volume',
        weight: 20,
        value: Number(volume.toFixed(3)),
        contribution: Number((volume * 20).toFixed(1)),
        status: volume >= 0.5 ? 'strong' : volume >= 0.1 ? 'good' : 'weak',
        description: `${stats.total_attestations} attestations (${(volume * 100).toFixed(0)}% of 1,000 target)`,
      },
      {
        name: 'manifestAdherence',
        weight: 15,
        value: Number(manifestAdherence.toFixed(3)),
        contribution: Number((manifestAdherence * 15).toFixed(1)),
        status: manifestAdherence >= 0.9 ? 'strong' : manifestAdherence >= 0.7 ? 'good' : 'weak',
        description: manifestTotal > 0
          ? `${stats.manifest_aligned}/${manifestTotal} aligned with declared manifest`
          : 'No manifests declared (defaulting to 0.5)',
      },
    ];

    const rawScore = Math.min(100, Math.round(
      successRate * 40 + chainCoverage * 25 + volume * 20 + manifestAdherence * 15
    ));

    // Generate recommendations
    const recommendations: Array<{ action: string; impact: string; priority: string }> = [];

    if (successRate < 0.95) {
      recommendations.push({
        action: 'Improve success rate (currently ' + (successRate * 100).toFixed(1) + '%)',
        impact: `+${Math.round((0.95 - successRate) * 40)} points`,
        priority: 'high',
      });
    }
    if (volume < 0.5) {
      recommendations.push({
        action: `Complete more transactions (${stats.total_attestations}/500 for 50% volume)`,
        impact: `+${Math.round((0.5 - volume) * 20)} points`,
        priority: 'medium',
      });
    }
    if (manifestTotal === 0) {
      recommendations.push({
        action: 'Declare manifests for your skills (+15% weight when aligned)',
        impact: '+3-7 points',
        priority: 'medium',
      });
    }
    if (stats.total_attestations >= 100 && successRate >= 0.9 && recommendations.length === 0) {
      recommendations.push({
        action: 'Maintain current performance — you are on track for trusted tier',
        impact: 'Score stability',
        priority: 'low',
      });
    }

    // Cohort percentile (rough estimate)
    const totalAgents = getDb().prepare(
      `SELECT COUNT(*) as n FROM attestation_stats WHERE total_attestations > 0`
    ).get() as { n: number };
    const agentsBelow = getDb().prepare(`
      SELECT COUNT(*) as n FROM attestation_stats
      WHERE total_attestations > 0
      AND (success_count * 1.0 / total_attestations) < ?
    `).get(successRate) as { n: number };
    const percentile = totalAgents.n > 0 ? Math.round((agentsBelow.n / totalAgents.n) * 100) : 50;

    const verdict = rawScore >= 90 ? 'proceed' : rawScore >= 80 ? 'trusted' :
      rawScore >= 60 ? 'standard' : rawScore >= 40 ? 'caution' :
      rawScore >= 20 ? 'building' : 'new';

    return c.json({
      did,
      score: rawScore,
      verdict,
      dimensions,
      recommendations,
      cohortPercentile: percentile,
      decay: stats.last_decay_at ? {
        lastDecayAt: stats.last_decay_at,
        decayFactor: stats.decay_factor,
      } : null,
    });
  } catch (err: any) {
    logger.error({ err }, 'Trust explanation failed');
    return c.json({ error: 'Explanation failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

// ─── GET /trust/:did/predict — Trust Score Prediction (Cherry 8) ────────────

router.get('/trust/:did/predict', async (c) => {
  const did = c.req.param('did');

  try {
    const aidKey = getDb().prepare(
      `SELECT owner_key, created_at FROM aid_keys WHERE did = ? AND key_status = 'active' LIMIT 1`
    ).get(did) as { owner_key: string; created_at: string } | undefined;

    if (!aidKey) {
      return c.json({ error: 'Agent not found', code: 'AID_DID_NOT_FOUND' }, 404);
    }

    // Get recent attestation velocity
    const recent7d = getDb().prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes
      FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-7 days')
    `).get(aidKey.owner_key) as { total: number; successes: number };

    const recent30d = getDb().prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN outcome_status = 'success' THEN 1 ELSE 0 END) as successes
      FROM attestations
      WHERE owner_key = ? AND created_at > datetime('now', '-30 days')
    `).get(aidKey.owner_key) as { total: number; successes: number };

    // Current stats
    const stats = getDb().prepare(`
      SELECT success_count, total_attestations FROM attestation_stats WHERE owner_key = ? LIMIT 1
    `).get(aidKey.owner_key) as { success_count: number; total_attestations: number } | undefined;

    const currentTotal = stats?.total_attestations ?? 0;
    const currentSuccess = stats?.success_count ?? 0;
    const currentRate = currentTotal > 0 ? currentSuccess / currentTotal : 0;

    // Calculate velocity (attestations per day)
    const velocity7d = recent7d.total / 7;
    const velocity30d = recent30d.total / 30;
    const avgVelocity = (velocity7d + velocity30d) / 2;
    const recentSuccessRate = recent30d.total > 0 ? recent30d.successes / recent30d.total : currentRate;

    // Project scores at 7d, 30d, 90d
    function projectScore(daysAhead: number): number {
      const projectedNew = Math.round(avgVelocity * daysAhead);
      const projectedSuccesses = Math.round(projectedNew * recentSuccessRate);
      const totalAttest = currentTotal + projectedNew;
      const totalSuccess = currentSuccess + projectedSuccesses;

      if (totalAttest === 0) return 0;

      const successRate = totalSuccess / totalAttest;
      const volume = Math.min(totalAttest / 1000, 1);
      return Math.min(100, Math.round(successRate * 40 + 0.5 * 25 + volume * 20 + 0.5 * 15));
    }

    const current = projectScore(0);
    const predicted7d = projectScore(7);
    const predicted30d = projectScore(30);
    const predicted90d = projectScore(90);

    // Determine trend
    const trend7d = predicted7d - current;
    const trend30d = predicted30d - current;
    let trajectory: string;
    if (trend30d > 5) trajectory = 'ascending';
    else if (trend30d < -5) trajectory = 'declining';
    else if (avgVelocity < 0.1) trajectory = 'stagnant';
    else trajectory = 'stable';

    return c.json({
      did,
      current: {
        score: current,
        attestations: currentTotal,
        successRate: Number(currentRate.toFixed(3)),
      },
      predicted: {
        '7d': { score: predicted7d, delta: trend7d },
        '30d': { score: predicted30d, delta: trend30d },
        '90d': { score: predicted90d, delta: predicted90d - current },
      },
      velocity: {
        attestationsPerDay7d: Number(velocity7d.toFixed(2)),
        attestationsPerDay30d: Number(velocity30d.toFixed(2)),
        recentSuccessRate: Number(recentSuccessRate.toFixed(3)),
      },
      trajectory,
      trendPerMonth: Number((trend30d).toFixed(1)),
      milestones: [
        predicted30d >= 40 && current < 40 ? { tier: 'caution', estimatedDays: estimateDaysToScore(40, current, trend30d) } : null,
        predicted90d >= 60 && current < 60 ? { tier: 'standard', estimatedDays: estimateDaysToScore(60, current, trend30d) } : null,
        predicted90d >= 80 && current < 80 ? { tier: 'trusted', estimatedDays: estimateDaysToScore(80, current, trend30d) } : null,
      ].filter(Boolean),
    });
  } catch (err: any) {
    logger.error({ err }, 'Trust prediction failed');
    return c.json({ error: 'Prediction failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

function estimateDaysToScore(target: number, current: number, monthlyDelta: number): number | null {
  if (monthlyDelta <= 0) return null;
  return Math.ceil(((target - current) / monthlyDelta) * 30);
}

// ─── GET /explore — Public agent explorer (Section 34.6) ────────────────────

router.get('/explore', async (c) => {
  const search = c.req.query('q') || '';
  const category = c.req.query('category') || '';
  const sortBy = c.req.query('sort') || 'attestations'; // attestations | score | recent
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  try {
    let query = `
      SELECT ak.did, ak.display_name, ak.created_at,
             COALESCE(ast.success_count, 0) as success_count,
             COALESCE(ast.total_attestations, 0) as total_attestations
      FROM aid_keys ak
      LEFT JOIN attestation_stats ast ON ast.owner_key = ak.owner_key
      WHERE ak.key_status = 'active' AND ak.frozen = 0
    `;
    const params: unknown[] = [];

    if (search) {
      query += ` AND (ak.display_name LIKE ? OR ak.did LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category) {
      query += ` AND EXISTS (SELECT 1 FROM aid_capabilities ac WHERE ac.identity_id = ak.owner_key AND ac.category = ?)`;
      params.push(category);
    }

    const orderMap: Record<string, string> = {
      attestations: 'COALESCE(ast.total_attestations, 0) DESC',
      recent: 'ak.created_at DESC',
      name: 'ak.display_name ASC',
    };
    query += ` ORDER BY ${orderMap[sortBy] || orderMap.attestations}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const agents = getDb().prepare(query).all(...params) as any[];

    const results = agents.map(a => {
      const rate = a.total_attestations > 0 ? a.success_count / a.total_attestations : 0;
      const volume = Math.min(a.total_attestations / 1000, 1);
      const score = Math.min(100, Math.round(rate * 40 + 0.5 * 25 + volume * 20 + 0.5 * 15));
      const verdict = score >= 90 ? 'proceed' : score >= 80 ? 'trusted' :
        score >= 60 ? 'standard' : score >= 40 ? 'caution' :
        score >= 20 ? 'building' : 'new';

      return {
        did: a.did,
        displayName: a.display_name,
        trustScore: score,
        verdict,
        attestations: a.total_attestations,
        successRate: Number(rate.toFixed(3)),
        registeredAt: a.created_at,
      };
    });

    // Get category list
    let categories: string[] = [];
    try {
      const cats = getDb().prepare(
        `SELECT DISTINCT category FROM aid_capabilities ORDER BY category`
      ).all() as { category: string }[];
      categories = cats.map(c => c.category);
    } catch { /* non-critical */ }

    // Total count for pagination
    let totalCount = 0;
    try {
      const countRow = getDb().prepare(
        `SELECT COUNT(*) as n FROM aid_keys WHERE key_status = 'active' AND frozen = 0`
      ).get() as { n: number };
      totalCount = countRow.n;
    } catch { /* non-critical */ }

    return c.json({
      agents: results,
      total: totalCount,
      offset,
      limit,
      categories,
      filters: { search: search || null, category: category || null, sort: sortBy },
    });
  } catch (err: any) {
    logger.error({ err }, 'Explorer query failed');
    return c.json({ error: 'Explorer failed', code: 'AID_INTERNAL_ERROR' }, 500);
  }
});

export { router as aidExplainRouter };
