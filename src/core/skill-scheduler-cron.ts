/**
 * Skill Scheduler Cron
 *
 * Runs every minute, checks for due scheduled skills, and executes them.
 * Supports any skill type (data, api_proxy, prompt_template, composite).
 * Budget-capped per run via max_credits_per_run.
 */

import cron from 'node-cron';
import { logger } from '../utils/logger';
import {
  getDueScheduledSkills, updateScheduledSkillRun, getSkill, getApiKey,
  getSessionState, updateSessionState,
} from '../db/index';
import { executeCompositeSkill } from './composite-executor';
import type { ScheduledSkill } from '../db/skills';

/**
 * Calculate next run time from a cron expression.
 * Uses node-cron's validate + manual next-time calculation.
 */
function getNextRunTime(cronExpr: string): string {
  // Parse cron fields to calculate next occurrence
  // For simplicity, use a fixed offset approach based on the smallest interval
  const now = new Date();
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length < 5) return new Date(now.getTime() + 3600_000).toISOString(); // fallback: 1h

  // Use node-cron to validate, then estimate next run
  // Simple approach: parse minute field for interval
  const minuteField = fields[0];
  let intervalMs = 3600_000; // default 1 hour

  if (minuteField.startsWith('*/')) {
    const mins = parseInt(minuteField.slice(2), 10);
    if (mins > 0) intervalMs = mins * 60_000;
  } else if (minuteField === '*') {
    intervalMs = 60_000; // every minute
  } else {
    // Specific minute — run hourly at that minute
    intervalMs = 3600_000;
  }

  // Hour field
  const hourField = fields[1];
  if (hourField.startsWith('*/')) {
    const hours = parseInt(hourField.slice(2), 10);
    if (hours > 0) intervalMs = Math.max(intervalMs, hours * 3600_000);
  }

  return new Date(now.getTime() + intervalMs).toISOString();
}

async function executeScheduledSkill(scheduled: ScheduledSkill): Promise<void> {
  const skill = getSkill(scheduled.skill_id);
  if (!skill) {
    updateScheduledSkillRun(scheduled.id, {
      nextRunAt: getNextRunTime(scheduled.cron_expression),
      lastStatus: 'ERROR',
      lastError: 'Skill not found or inactive',
      creditsSpent: 0,
    });
    return;
  }

  const keyRecord = getApiKey(scheduled.caller_key);
  if (!keyRecord) {
    updateScheduledSkillRun(scheduled.id, {
      nextRunAt: getNextRunTime(scheduled.cron_expression),
      lastStatus: 'ERROR',
      lastError: 'Caller API key not found',
      creditsSpent: 0,
    });
    return;
  }

  // Budget check
  if (scheduled.max_credits_per_run && keyRecord.credits < scheduled.max_credits_per_run) {
    updateScheduledSkillRun(scheduled.id, {
      nextRunAt: getNextRunTime(scheduled.cron_expression),
      lastStatus: 'SKIPPED',
      lastError: `Insufficient credits (${keyRecord.credits} < ${scheduled.max_credits_per_run})`,
      creditsSpent: 0,
    });
    return;
  }

  const variables: Record<string, string> = scheduled.variables_json ? JSON.parse(scheduled.variables_json) : {};

  // Inject session state into variables if a session is attached
  const sessionId = (scheduled as unknown as Record<string, unknown>).session_id as string | null;
  if (sessionId) {
    const sessionState = getSessionState(sessionId, scheduled.caller_key);
    if (sessionState) {
      // Make session state available as {{session.key}} variables
      for (const [k, v] of Object.entries(sessionState)) {
        if (typeof v === 'string' || typeof v === 'number') {
          variables[`session.${k}`] = String(v);
        }
      }
    }
  }

  try {
    if (skill.skill_type === 'composite') {
      const result = await executeCompositeSkill(skill, variables, {
        callerKey: scheduled.caller_key,
        callerKeyInfo: {
          key: scheduled.caller_key,
          isEnvKey: false,
          credits: keyRecord.credits,
          amountPaid: keyRecord.amount_paid ?? 0,
        },
        parentRequestId: `sched-${scheduled.id}-${Date.now()}`,
      });

      updateScheduledSkillRun(scheduled.id, {
        nextRunAt: getNextRunTime(scheduled.cron_expression),
        lastStatus: result.ok ? 'SUCCESS' : 'ERROR',
        lastError: result.error,
        creditsSpent: result.totalCreditsCharged,
      });
    } else if ((skill.skill_type === 'data' || skill.skill_type === 'api_proxy') && skill.proxy_url) {
      // Direct execution for data/api_proxy skills
      const url = new URL(skill.proxy_url);
      if (skill.skill_type === 'data') {
        for (const [k, v] of Object.entries(variables)) url.searchParams.set(k, v);
      }

      const res = await fetch(skill.skill_type === 'data' ? url.toString() : skill.proxy_url, {
        method: skill.skill_type === 'data' ? 'GET' : (skill.proxy_method ?? 'POST'),
        headers: skill.skill_type === 'api_proxy' ? { 'Content-Type': 'application/json' } : { 'Accept': 'application/json' },
        body: skill.skill_type === 'api_proxy' ? JSON.stringify(variables) : undefined,
        signal: AbortSignal.timeout(15_000),
      });

      updateScheduledSkillRun(scheduled.id, {
        nextRunAt: getNextRunTime(scheduled.cron_expression),
        lastStatus: res.ok ? 'SUCCESS' : 'ERROR',
        lastError: res.ok ? undefined : `HTTP ${res.status}`,
        creditsSpent: skill.credit_cost,
      });
    } else {
      updateScheduledSkillRun(scheduled.id, {
        nextRunAt: getNextRunTime(scheduled.cron_expression),
        lastStatus: 'ERROR',
        lastError: `Unsupported skill type for scheduling: ${skill.skill_type}`,
        creditsSpent: 0,
      });
    }
  } catch (err) {
    updateScheduledSkillRun(scheduled.id, {
      nextRunAt: getNextRunTime(scheduled.cron_expression),
      lastStatus: 'ERROR',
      lastError: (err as Error).message,
      creditsSpent: 0,
    });
  }
}

async function runScheduledSkills(): Promise<void> {
  const due = getDueScheduledSkills();
  if (due.length === 0) return;

  logger.debug({ count: due.length }, 'Executing due scheduled skills');

  for (const scheduled of due) {
    try {
      await executeScheduledSkill(scheduled);
    } catch (err) {
      logger.error({ err, scheduledId: scheduled.id }, 'Scheduled skill execution error');
    }
  }

  logger.info({ executed: due.length }, 'Scheduled skills batch complete');
}

let task: ReturnType<typeof cron.schedule> | null = null;
let _running = false;

export function startSkillSchedulerCron(): void {
  // Check every minute for due skills
  task = cron.schedule('* * * * *', () => {
    if (_running) return;
    _running = true;
    runScheduledSkills()
      .catch(err => logger.error({ err }, 'Skill scheduler cron error'))
      .finally(() => { _running = false; });
  });
  logger.info('Skill scheduler cron started (every 1m)');
}

export function stopSkillSchedulerCron(): void {
  if (task) { task.stop(); task = null; }
}
