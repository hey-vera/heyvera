/**
 * Creator Growth Notifications — milestone tracking + alerts for skill creators.
 *
 * Tracks invocation counts, ratings, and revenue milestones per skill.
 * Fires webhooks (SKILL_MILESTONE) and logs events for creator growth.
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../db/connection';
import { logger } from '../utils/logger';
import { fireWebhookEvent, type WebhookEventType } from '../utils/webhooks';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Milestone {
  skillId: string;
  skillName: string;
  milestone: string;
  value: number;
  reachedAt: string;
}

interface MilestoneState {
  [skillId: string]: string[];  // array of milestone keys already fired
}

interface SkillRow {
  id: string;
  name: string;
  author_key: string;
}

interface CountRow {
  cnt: number;
}

interface RevenueRow {
  total_credits: number;
}

interface RatingRow {
  rating_count: number;
  has_five_star: number;
}

interface KeyEmailRow {
  email: string;
}

// ─── Milestone definitions ───────────────────────────────────────────────────

const INVOCATION_MILESTONES = [1, 10, 50, 100, 500, 1000];
const REVENUE_MILESTONES = [100, 1000, 10000];

// ─── State persistence ───────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'creator-milestones.json');

function loadState(): MilestoneState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load milestone state — starting fresh');
  }
  return {};
}

function saveState(state: MilestoneState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to save milestone state');
  }
}

// ─── Check milestones (call periodically) ────────────────────────────────────

export function checkMilestones(): void {
  const db = getDb();
  const state = loadState();
  let changed = false;

  // Get all skills with their author keys
  const skills = db.prepare(
    `SELECT id, name, author_key FROM skills WHERE is_public = 1`
  ).all() as SkillRow[];

  for (const skill of skills) {
    if (!state[skill.id]) {
      state[skill.id] = [];
    }
    const fired = state[skill.id];

    // ── Invocation milestones ─────────────────────────────────────────
    const invocations = (db.prepare(
      `SELECT COUNT(*) AS cnt FROM transactions WHERE skill_id = ?`
    ).get(skill.id) as CountRow | undefined)?.cnt ?? 0;

    for (const threshold of INVOCATION_MILESTONES) {
      const key = `invocations:${threshold}`;
      if (invocations >= threshold && !fired.includes(key)) {
        fireMilestone(skill, key, `${threshold} invocations`, invocations);
        fired.push(key);
        changed = true;
      }
    }

    // ── Rating milestones ─────────────────────────────────────────────
    const ratingData = db.prepare(
      `SELECT
         COUNT(*) AS rating_count,
         MAX(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS has_five_star
       FROM reputation
       WHERE skill_id = ?`
    ).get(skill.id) as RatingRow | undefined;

    if (ratingData) {
      if (ratingData.rating_count >= 1 && !fired.includes('first_rating')) {
        fireMilestone(skill, 'first_rating', 'First rating received', ratingData.rating_count);
        fired.push('first_rating');
        changed = true;
      }

      if (ratingData.has_five_star && !fired.includes('first_five_star')) {
        fireMilestone(skill, 'first_five_star', 'First 5-star rating', 5);
        fired.push('first_five_star');
        changed = true;
      }
    }

    // ── Revenue milestones ────────────────────────────────────────────
    const revenue = (db.prepare(
      `SELECT COALESCE(SUM(author_credits), 0) AS total_credits
       FROM transactions
       WHERE skill_id = ? AND author_credits IS NOT NULL`
    ).get(skill.id) as RevenueRow | undefined)?.total_credits ?? 0;

    for (const threshold of REVENUE_MILESTONES) {
      const key = `revenue:${threshold}`;
      if (revenue >= threshold && !fired.includes(key)) {
        fireMilestone(skill, key, `${threshold} credits earned`, revenue);
        fired.push(key);
        changed = true;
      }
    }
  }

  if (changed) {
    saveState(state);
  }
}

// ─── Fire a single milestone ─────────────────────────────────────────────────

function fireMilestone(
  skill: SkillRow,
  milestoneKey: string,
  milestone: string,
  currentValue: number,
): void {
  logger.info(
    { skillId: skill.id, skillName: skill.name, milestone, currentValue, creatorKey: skill.author_key },
    'Creator milestone reached',
  );

  // Fire webhook (SKILL_MILESTONE as a custom event — cast through the event type)
  try {
    fireWebhookEvent(
      skill.author_key,
      'SKILL_INVOKED' as WebhookEventType, // Closest existing event type; payload distinguishes it
      {
        type: 'SKILL_MILESTONE',
        skillId: skill.id,
        skillName: skill.name,
        milestone,
        currentValue,
        reachedAt: new Date().toISOString(),
      },
    );
  } catch (err) {
    logger.warn({ err, skillId: skill.id, milestone }, 'Failed to fire milestone webhook');
  }
}

// ─── Get creator milestones ──────────────────────────────────────────────────

export function getCreatorMilestones(apiKey: string): Milestone[] {
  const db = getDb();
  const state = loadState();

  // Get all skills by this creator
  const skills = db.prepare(
    `SELECT id, name FROM skills WHERE author_key = ?`
  ).all(apiKey) as Array<{ id: string; name: string }>;

  const milestones: Milestone[] = [];

  for (const skill of skills) {
    const fired = state[skill.id] ?? [];

    for (const key of fired) {
      let milestone = key;
      let value = 0;

      if (key.startsWith('invocations:')) {
        value = parseInt(key.split(':')[1], 10);
        milestone = `${value} invocations`;
      } else if (key.startsWith('revenue:')) {
        value = parseInt(key.split(':')[1], 10);
        milestone = `${value} credits earned`;
      } else if (key === 'first_rating') {
        milestone = 'First rating received';
        value = 1;
      } else if (key === 'first_five_star') {
        milestone = 'First 5-star rating';
        value = 5;
      }

      milestones.push({
        skillId: skill.id,
        skillName: skill.name,
        milestone,
        value,
        reachedAt: '', // Exact time not tracked in state file; use empty string
      });
    }
  }

  return milestones;
}

// ─── Cron wrapper ────────────────────────────────────────────────────────────

export function startCreatorNotificationsCron(): void {
  setInterval(() => {
    try {
      checkMilestones();
    } catch (err) {
      logger.warn({ err }, 'Creator milestone check failed');
    }
  }, 30 * 60_000).unref();
  logger.info('Creator notifications cron started (every 30m)');
}
