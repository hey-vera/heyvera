/**
 * Creator routes — onboarding helpers for skill publishers.
 *
 * Mounted at /v1/creator in index.ts.
 * All routes require API key auth.
 */

import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import {
  generateSkillTemplate,
  validateSkillConfig,
  estimateSkillRevenue,
  getCreatorStats,
} from '../core/creator-tools';

export const creatorRouter = new Hono();

creatorRouter.use('*', checkApiKey);

// ─── Creator Stats ────────────────────────────────────────────────────────────

creatorRouter.get('/stats', (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const stats = getCreatorStats(keyInfo.key);
  return c.json({ stats });
});

// ─── Skill Template Generator ─────────────────────────────────────────────────

creatorRouter.post('/template', async (c) => {
  let body: { type?: string; name?: string; description?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const { type, name, description } = body;

  if (!type || !['api_proxy', 'prompt_template', 'data', 'composite'].includes(type)) {
    return c.json({
      error: 'type is required and must be one of: api_proxy, prompt_template, data, composite',
      code: 'INVALID_TYPE',
    }, 400);
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'name is required', code: 'MISSING_NAME' }, 400);
  }
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return c.json({ error: 'description is required', code: 'MISSING_DESCRIPTION' }, 400);
  }

  const template = generateSkillTemplate(
    type as 'api_proxy' | 'prompt_template' | 'data' | 'composite',
    name.trim(),
    description.trim(),
  );

  return c.json({ template });
});

// ─── Skill Config Validator ───────────────────────────────────────────────────

creatorRouter.post('/validate', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const result = validateSkillConfig(body);
  return c.json({ validation: result });
});

// ─── Revenue Estimate ─────────────────────────────────────────────────────────

creatorRouter.get('/revenue-estimate', (c) => {
  const creditCost = Number(c.req.query('creditCost') ?? 0);
  const dailyUses = Number(c.req.query('dailyUses') ?? 0);

  if (creditCost <= 0) {
    return c.json({ error: 'creditCost must be a positive number', code: 'INVALID_CREDIT_COST' }, 400);
  }
  if (dailyUses <= 0) {
    return c.json({ error: 'dailyUses must be a positive number', code: 'INVALID_DAILY_USES' }, 400);
  }

  const estimate = estimateSkillRevenue(creditCost, dailyUses);
  return c.json({ estimate });
});
