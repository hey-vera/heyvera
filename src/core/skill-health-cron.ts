/**
 * Skill Health Monitor Cron
 *
 * Pings data skills' proxy_url endpoints every 15 minutes.
 * If a data skill's source fails 3 consecutive times, marks it DEGRADED.
 * If it recovers, resets to HEALTHY.
 *
 * Only checks skills with skill_type='data' and a non-null proxy_url.
 */

import cron from 'node-cron';
import { getDb, checkSLACompliance, recordSLAViolation, escalatePenalty, runTrustDecay } from '../db/index';
import { logger } from '../utils/logger';
import { fireWebhookEvent } from '../utils/webhooks';
import { round6 } from './credits';

interface DataSkillRow {
  id: string;
  name: string;
  proxy_url: string;
  health_status: string;
  health_fail_count: number;
}

const CONSECUTIVE_FAILURES_THRESHOLD = 3;

async function checkSkillHealth(skill: DataSkillRow): Promise<'up' | 'down'> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(skill.proxy_url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status === 405 ? 'up' : 'down'; // 405 = Method Not Allowed (HEAD not supported, but server is up)
  } catch {
    return 'down';
  }
}

async function runSkillHealthChecks(): Promise<void> {
  const db = getDb();
  const dataSkills = db.prepare(
    `SELECT id, name, proxy_url, health_status, health_fail_count
     FROM skills
     WHERE skill_type = 'data' AND proxy_url IS NOT NULL AND active = 1 AND public = 1
     LIMIT 100`
  ).all() as DataSkillRow[];

  if (dataSkills.length === 0) return;

  logger.debug({ count: dataSkills.length }, 'Skill health check starting');

  let degraded = 0;
  let recovered = 0;

  for (const skill of dataSkills) {
    const result = await checkSkillHealth(skill);

    if (result === 'up') {
      // Reset fail count, mark healthy if was degraded
      if (skill.health_status !== 'HEALTHY' || skill.health_fail_count > 0) {
        db.prepare(
          `UPDATE skills SET health_status = 'HEALTHY', health_fail_count = 0, health_checked_at = datetime('now') WHERE id = ?`
        ).run(skill.id);
        if (skill.health_status === 'DEGRADED') recovered++;
      } else {
        db.prepare(`UPDATE skills SET health_checked_at = datetime('now') WHERE id = ?`).run(skill.id);
      }
    } else {
      // Increment fail count
      const newCount = (skill.health_fail_count ?? 0) + 1;
      const newStatus = newCount >= CONSECUTIVE_FAILURES_THRESHOLD ? 'DEGRADED' : skill.health_status;
      db.prepare(
        `UPDATE skills SET health_status = ?, health_fail_count = ?, health_checked_at = datetime('now') WHERE id = ?`
      ).run(newStatus, newCount, skill.id);

      if (newStatus === 'DEGRADED' && skill.health_status !== 'DEGRADED') {
        degraded++;
        logger.warn({ skillId: skill.id, name: skill.name, failCount: newCount }, 'Data skill marked DEGRADED');
      }
    }
  }

  logger.info({ checked: dataSkills.length, degraded, recovered }, 'Skill health check complete');

  // SLA compliance check for all skills with SLA contracts
  await checkSLAContracts();
}

async function checkSLAContracts(): Promise<void> {
  const db = getDb();
  const skillsWithSLA = db.prepare(
    `SELECT id, name, author_key, sla_json, credit_cost FROM skills
     WHERE sla_json IS NOT NULL AND active = 1 AND public = 1 LIMIT 200`
  ).all() as { id: string; name: string; author_key: string; sla_json: string; credit_cost: number }[];

  if (skillsWithSLA.length === 0) return;

  let violationCount = 0;

  for (const skill of skillsWithSLA) {
    const { compliant, violations } = checkSLACompliance(skill.id);
    if (compliant) continue;

    let sla: { penalty_pct?: number };
    try { sla = JSON.parse(skill.sla_json); } catch { continue; }

    for (const v of violations) {
      const penaltyCredits = round6(skill.credit_cost * ((sla.penalty_pct ?? 10) / 100));

      recordSLAViolation({
        skillId: skill.id,
        violationType: v.type,
        measuredValue: v.measured,
        slaThreshold: v.threshold,
        penaltyCredits,
      });

      violationCount++;

      // Notify skill author via webhook
      fireWebhookEvent(skill.author_key, 'SLA_VIOLATED', {
        skillId: skill.id,
        skillName: skill.name,
        violationType: v.type,
        measured: v.measured,
        threshold: v.threshold,
        penaltyCredits,
      });
    }
  }

  if (violationCount > 0) {
    logger.warn({ violations: violationCount, checked: skillsWithSLA.length }, 'SLA violations detected');
  }

  // Penalty escalation — check all skills with SLA for tier changes
  let escalations = 0;
  for (const skill of skillsWithSLA) {
    const { newTier, changed } = escalatePenalty(skill.id);
    if (changed) {
      escalations++;
      fireWebhookEvent(skill.author_key, 'SLA_VIOLATED', {
        skillId: skill.id,
        skillName: skill.name,
        penaltyTier: newTier,
        penaltyAction: newTier === 1 ? 'WARNING' : newTier === 2 ? 'REDUCED_VISIBILITY' : newTier === 3 ? 'DELISTED' : 'CLEARED',
      });
    }
  }
  if (escalations > 0) {
    logger.warn({ escalations }, 'Penalty tier changes applied');
  }

  // Trust decay — run once per cycle (every 15 minutes is fine, weights change slowly)
  try {
    const { updated } = runTrustDecay();
    if (updated > 0) logger.debug({ updated }, 'Trust decay weights refreshed');
  } catch (err) {
    logger.error({ err }, 'Trust decay failed');
  }
}

let task: ReturnType<typeof cron.schedule> | null = null;

export function startSkillHealthCron(): void {
  // Run every 15 minutes
  task = cron.schedule('*/15 * * * *', () => {
    runSkillHealthChecks().catch(err =>
      logger.error({ err }, 'Skill health cron error')
    );
  });
  logger.info('Skill health monitor cron started (every 15m)');
}

export function stopSkillHealthCron(): void {
  if (task) { task.stop(); task = null; }
}
