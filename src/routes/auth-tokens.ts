import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { getSkill, getUsageStats } from '../db/index';
import { maskApiKey } from '../utils/mask';

export const authRouter = new Hono();

// ─── GET /v1/auth/me — current key info ───────────────────────────────────────

authRouter.get('/me', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');

  return c.json({
    key: maskApiKey(keyInfo.key),
    email: keyInfo.email,
    credits: keyInfo.credits === Infinity ? null : keyInfo.credits,
    creditsUsed: keyInfo.creditsUsed,
    amountPaid: keyInfo.amountPaid,
    isEnvKey: keyInfo.isEnvKey,
  });
});

// ─── GET /v1/auth/estimate?skillId= — estimate cost for a skill invocation ────

authRouter.get('/estimate', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const skillId = c.req.query('skillId');
  if (!skillId) return c.json({ error: 'skillId query param required' }, 400);

  const skill = getSkill(skillId);
  if (!skill) return c.json({ error: 'Skill not found' }, 404);
  if (!skill.public && skill.author_key !== keyInfo.key) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  const minCost = Math.max(1, skill.credit_cost);

  return c.json({
    skillId,
    skillName: skill.display_name ?? skill.name,
    estimatedCredits: minCost,
    note: skill.skill_type === 'prompt_template'
      ? 'Prompt template skills may cost more depending on API usage'
      : 'Fixed cost per invocation',
    creditCost: skill.credit_cost,
    canAfford: keyInfo.isEnvKey || keyInfo.credits >= minCost,
  });
});

// ─── GET /v1/auth/usage — usage summary for current key ──────────────────────

authRouter.get('/usage', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const stats = getUsageStats(keyInfo.key);
  return c.json({
    credits: keyInfo.credits === Infinity ? null : keyInfo.credits,
    creditsUsed: keyInfo.creditsUsed,
    ...stats,
  });
});
