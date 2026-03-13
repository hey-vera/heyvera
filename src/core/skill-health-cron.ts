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
import { getDb } from '../db/index';
import { logger } from '../utils/logger';

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
}

export function startSkillHealthCron(): void {
  // Run every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    runSkillHealthChecks().catch(err =>
      logger.error({ err }, 'Skill health cron error')
    );
  });
  logger.info('Skill health monitor cron started (every 15m)');
}
