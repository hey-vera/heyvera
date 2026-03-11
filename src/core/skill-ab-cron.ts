import { getDb, promoteChallenger, writeAuditLog, type SkillMetricsSummary, getSkillMetricsSummary } from '../db/index';
import { logger } from '../utils/logger';

// Auto-promote challenger if it beats original by this threshold
const PROMOTE_THRESHOLD = 0.10; // 10% better success rate
const MIN_INVOCATIONS = 20;     // need at least 20 data points before deciding

let timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function startSkillAbCron(): void {
  if (timer) return;
  Promise.resolve().then(() => runAbCheck()).catch((err) => logger.error({ err }, 'Skill A/B cron: startup check failed'));
  timer = setInterval(runAbCheck, 30 * 60 * 1000); // every 30 minutes
  logger.info('Skill A/B auto-promote cron started');
}

export function stopSkillAbCron(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

function runAbCheck(): void {
  if (_running) return;
  _running = true;
  try {
    // Find all skills that have an active challenger
    const skills = getDb()
      .prepare(`SELECT id, ab_challenger FROM skills WHERE ab_challenger IS NOT NULL AND public = 1 AND active = 1`)
      .all() as { id: string; ab_challenger: string }[];

    for (const skill of skills) {
      evaluateAndMaybePromote(skill.id, skill.ab_challenger);
    }
  } catch (err) {
    logger.error({ err }, 'Skill A/B check failed');
  } finally {
    _running = false;
  }
}

function evaluateAndMaybePromote(originalId: string, challengerId: string): void {
  // Verify challenger still exists and is active — may have been manually deleted
  const challActive = getDb().prepare('SELECT 1 FROM skills WHERE id = ? AND active = 1').get(challengerId);
  if (!challActive) {
    getDb().prepare('UPDATE skills SET ab_challenger = NULL WHERE id = ?').run(originalId);
    logger.info({ originalId, challengerId }, 'A/B cron: challenger no longer active — reference cleared');
    return;
  }

  const origMetrics = getSkillMetricsSummary(originalId);
  const challMetrics = getSkillMetricsSummary(challengerId);

  // Get the most recent version's metrics for each (results are ORDER BY version DESC)
  const orig = origMetrics[0];
  const chall = challMetrics[0];

  if (!orig || !chall) return;
  if (chall.invocations < MIN_INVOCATIONS) return; // not enough data yet

  const origRate = orig.successRate / 100;
  const challRate = chall.successRate / 100;
  const improvement = challRate - origRate;

  if (improvement >= PROMOTE_THRESHOLD) {
    const promoted = promoteChallenger(originalId);
    if (promoted) {
      writeAuditLog({
        entityType: 'skill', entityId: originalId,
        action: 'AUTO_PROMOTED', actorId: null,
        data: {
          challengerId,
          origSuccessRate: orig.successRate,
          challSuccessRate: chall.successRate,
          improvementPct: Math.round(improvement * 100),
          challInvocations: chall.invocations,
        },
      });
      logger.info({ originalId, challengerId, improvement: Math.round(improvement * 100) + '%' },
        'Challenger auto-promoted via A/B test');
    }
  } else if (improvement < -PROMOTE_THRESHOLD && chall.invocations >= MIN_INVOCATIONS) {
    // Challenger is significantly worse — discard it
    getDb().transaction(() => {
      getDb().prepare(`UPDATE skills SET ab_challenger = NULL WHERE id = ?`).run(originalId);
      getDb().prepare(`UPDATE skills SET active = 0 WHERE id = ?`).run(challengerId);
    })();
    writeAuditLog({
      entityType: 'skill', entityId: originalId,
      action: 'CHALLENGER_DISCARDED', actorId: null,
      data: { challengerId, reason: 'underperformed', improvementPct: Math.round(improvement * 100) },
    });
    logger.info({ originalId, challengerId }, 'Challenger discarded — underperformed original');
  }
}
