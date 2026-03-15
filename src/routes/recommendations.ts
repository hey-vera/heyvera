/**
 * Recommendation routes — usage-driven skill discovery flywheel.
 *
 * Mounted at /v1/recommendations in index.ts.
 * All routes require API key auth.
 */

import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import {
  getRecommendationsForSkill,
  getRecommendationsForAgent,
  getPopularSkills,
  getTrendingSkills,
} from '../core/recommendations';

export const recommendationsRouter = new Hono();

recommendationsRouter.use('*', checkApiKey);

// ─── Skill-based recommendations ─────────────────────────────────────────────

recommendationsRouter.get('/skills/:skillId', (c) => {
  const { skillId } = c.req.param();
  const limit = Math.min(Number(c.req.query('limit') ?? 5), 20);

  const recommendations = getRecommendationsForSkill(skillId, limit);
  return c.json({ recommendations });
});

// ─── Agent-personalised recommendations ───────────────────────────────────────

recommendationsRouter.get('/agent', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 50);

  const recommendations = getRecommendationsForAgent(keyInfo.key, limit);
  return c.json({ recommendations });
});

// ─── Popular skills ───────────────────────────────────────────────────────────

recommendationsRouter.get('/popular', (c) => {
  const period = (c.req.query('period') ?? 'week') as 'day' | 'week' | 'month';
  if (!['day', 'week', 'month'].includes(period)) {
    return c.json({ error: 'Invalid period — must be day, week, or month', code: 'INVALID_PERIOD' }, 400);
  }
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 50);

  const skills = getPopularSkills(period, limit);
  return c.json({ skills });
});

// ─── Trending skills ─────────────────────────────────────────────────────────

recommendationsRouter.get('/trending', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 50);

  const skills = getTrendingSkills(limit);
  return c.json({ skills });
});
