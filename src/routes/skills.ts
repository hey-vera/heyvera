import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { checkApiKey } from '../middleware/auth';
import {
  createSkill, getSkill, listPublicSkills, getSkillsByAuthor,
  countSkillsByAuthor, incrementSkillUses, deleteSkill,
  updateSkillVisibility, topUpCredits, deductCredit, insertOrchestration,
} from '../db/index';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { logUsage } from '../utils/usage';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logger } from '../utils/logger';
import { env, isSimulationMode } from '../config/index';
import crypto from 'crypto';

export const skillsRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CreateSkillSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens only'),
  description: z.string().min(10).max(500).trim(),
  promptTemplate: z.string().min(10).max(2000).trim(),
  public: z.boolean().default(false),
  creditCost: z.number().int().min(0).max(10000).default(0),
});

// Extract {{variable}} placeholders from a template
function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

// Replace {{variable}} placeholders with provided values
function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in variables)) throw new Error(`Missing required variable: ${key}`);
    return String(variables[key]).slice(0, 500); // cap individual variable length
  });
}

function skillCacheKey(skillId: string, variables: Record<string, string>): string {
  const normalized = JSON.stringify({ skillId, variables: Object.fromEntries(Object.entries(variables).sort()) });
  return 'skill:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ─── POST /v1/skills — create a skill ─────────────────────────────────────────

skillsRouter.post('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  // Cap at 20 skills per API key
  const count = countSkillsByAuthor(keyInfo.key);
  if (count >= 20) {
    return c.json({ error: 'Maximum 20 skills per API key' }, 409);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const parsed = CreateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const data = parsed.data;
  const variables = extractVariables(data.promptTemplate);
  const id = nanoid(12);

  createSkill({
    id,
    name: data.name,
    description: data.description,
    promptTemplate: data.promptTemplate,
    authorKey: keyInfo.key,
    public: data.public,
    creditCost: data.creditCost,
  });

  logger.info({ id, name: data.name, author: keyInfo.key.slice(0, 8) }, 'Skill created');

  return c.json({
    id,
    name: data.name,
    description: data.description,
    variables,
    public: data.public,
    creditCost: data.creditCost,
    invokeUrl: `POST /v1/skills/${id}/invoke`,
  }, 201);
});

// ─── GET /v1/skills — list public skills (ClawHub registry) ───────────────────

skillsRouter.get('/', (c) => {
  const skills = listPublicSkills();
  return c.json({
    total: skills.length,
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      variables: extractVariables(s.prompt_template),
      creditCost: s.credit_cost,
      uses: s.uses,
      createdAt: s.created_at,
    })),
  });
});

// ─── GET /v1/skills/mine — list your own skills ────────────────────────────────

skillsRouter.get('/mine', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const skills = getSkillsByAuthor(keyInfo.key);
  return c.json({
    total: skills.length,
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      variables: extractVariables(s.prompt_template),
      public: s.public === 1,
      creditCost: s.credit_cost,
      revenueSharePct: s.revenue_share_pct,
      uses: s.uses,
      createdAt: s.created_at,
    })),
  });
});

// ─── GET /v1/skills/:id — get skill details ────────────────────────────────────

skillsRouter.get('/:id', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);

  if (!skill) return c.json({ error: 'Skill not found' }, 404);

  // Private skills only visible to author (check API key if provided)
  if (!skill.public) {
    const key = c.req.header('X-API-Key');
    if (!key || key !== skill.author_key) {
      return c.json({ error: 'Skill not found' }, 404);
    }
  }

  return c.json({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    variables: extractVariables(skill.prompt_template),
    public: skill.public === 1,
    creditCost: skill.credit_cost,
    uses: skill.uses,
    createdAt: skill.created_at,
  });
});

// ─── PATCH /v1/skills/:id/visibility — publish or unpublish ───────────────────

skillsRouter.patch('/:id/visibility', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  let body: { public?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  if (typeof body.public !== 'boolean') {
    return c.json({ error: 'Field "public" (boolean) required' }, 400);
  }

  const updated = updateSkillVisibility(id, keyInfo.key, body.public);
  if (!updated) return c.json({ error: 'Skill not found or not yours' }, 404);

  logger.info({ id, public: body.public, author: keyInfo.key.slice(0, 8) }, 'Skill visibility updated');
  return c.json({ ok: true, public: body.public });
});

// ─── DELETE /v1/skills/:id — delete a skill ───────────────────────────────────

skillsRouter.delete('/:id', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const deleted = deleteSkill(id, keyInfo.key);
  if (!deleted) return c.json({ error: 'Skill not found or not yours' }, 404);

  logger.info({ id, author: keyInfo.key.slice(0, 8) }, 'Skill deleted');
  return c.json({ ok: true });
});

// ─── POST /v1/skills/:id/invoke — run a skill ─────────────────────────────────

skillsRouter.post('/:id/invoke', checkApiKey, async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill) return c.json({ requestId, error: 'Skill not found' }, 404);

  // Access check: public skills anyone can invoke, private only the author
  if (!skill.public && skill.author_key !== keyInfo.key) {
    return c.json({ requestId, error: 'Skill not found' }, 404);
  }

  let body: { variables?: Record<string, string> };
  try { body = await c.req.json(); } catch { body = {}; }

  const variables = body.variables ?? {};

  // Render the prompt template
  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err as Error).message, code: 'MISSING_VARIABLES' }, 400);
  }

  // Per-key rate limit (same tiered system as orchestrate)
  if (!keyInfo.isEnvKey) {
    const tierLimit = keyInfo.amountPaid >= 500 ? 300
      : keyInfo.amountPaid >= 100 ? 120
      : keyInfo.amountPaid >= 20  ? 60
      : 30;
    const rlCount = await cacheIncr(`rl:orch:${keyInfo.key}`, 60);
    if (rlCount > tierLimit) {
      return c.json({ requestId, error: 'Rate limit exceeded', code: 'RATE_LIMITED', limit: tierLimit }, 429);
    }
  }

  // Skill-level cache
  const qKey = skillCacheKey(id, variables);
  const cachedResponse = await cacheGet<Record<string, unknown>>(qKey);
  if (cachedResponse) {
    logger.info({ requestId, skillId: id }, 'Skill cache hit');
    return c.json({ ...cachedResponse, requestId, metadata: { ...(cachedResponse.metadata as Record<string, unknown>), cacheHit: true } });
  }

  logger.info({ requestId, skillId: id, name: skill.name }, 'Skill invocation');

  try {
    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent);
    const formatted = await formatResponse(query, intent, execution);

    const apiCosts = execution.totalCost;
    const cacheHits = execution.steps.filter((s) => s.cached).length;
    const totalDurationMs = Date.now() - start;

    // Credit cost: max of skill's fixed price and actual cost
    const actualCost = Math.max(1, Math.ceil(apiCosts * 2000));
    const creditsToDeduct = Math.max(actualCost, skill.credit_cost);

    if (!keyInfo.isEnvKey) {
      const deducted = deductCredit(keyInfo.key, creditsToDeduct);
      if (!deducted) {
        return c.json({
          requestId,
          error: 'Insufficient credits',
          code: 'INSUFFICIENT_CREDITS',
          creditsRequired: creditsToDeduct,
          creditsAvailable: keyInfo.credits,
          hint: 'Top up your credits at claw-net.org',
        }, 402);
      }

      // Revenue share: pay author a % of credits used (if author != invoker)
      if (skill.author_key !== keyInfo.key && skill.revenue_share_pct > 0) {
        const authorShare = Math.floor(creditsToDeduct * skill.revenue_share_pct);
        if (authorShare > 0) topUpCredits(skill.author_key, authorShare);
      }
    }

    incrementSkillUses(id);

    const usageEntry = {
      requestId,
      timestamp: new Date().toISOString(),
      query,
      plannedSteps: intent.steps.length,
      executedSteps: execution.steps.length,
      successfulSteps: execution.steps.filter((s) => s.success).length,
      cacheHits,
      totalDurationMs,
      apiCost: apiCosts,
      markup: 0,
      total: apiCosts,
      success: true,
      llmProvider: env.LLM_PROVIDER,
    };
    logUsage(usageEntry);
    insertOrchestration({ id: requestId, ...usageEntry });

    const responsePayload = {
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions,
      skill: { id: skill.id, name: skill.name },
      costBreakdown: {
        costUsd: Math.round(apiCosts * 10000) / 10000,
        creditsUsed: creditsToDeduct,
      },
      metadata: {
        stepsExecuted: execution.steps.length,
        cacheHits,
        totalDurationMs,
        llmProvider: env.LLM_PROVIDER,
        simulationMode: isSimulationMode,
      },
    };

    await cacheSet(qKey, responsePayload);
    return c.json({ requestId, ...responsePayload });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const code = (err as { code?: string }).code ?? 'INTERNAL_ERROR';
    logger.error({ requestId, skillId: id, error: error.message }, 'Skill invocation failed');

    logUsage({
      requestId, timestamp: new Date().toISOString(), query,
      plannedSteps: 0, executedSteps: 0, successfulSteps: 0, cacheHits: 0,
      totalDurationMs: Date.now() - start, apiCost: 0, markup: 0, total: 0,
      success: false, llmProvider: env.LLM_PROVIDER,
    });

    return c.json({
      requestId,
      error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      code,
    }, 500);
  }
});
