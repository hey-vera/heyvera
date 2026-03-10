import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { checkApiKey } from '../middleware/auth';
import {
  createSkill, getSkill, listPublicSkills, countPublicSkills, getSkillsByAuthor,
  countSkillsByAuthor, incrementSkillUses, deleteSkill,
  updateSkillVisibility, topUpCredits, deductCredit, insertOrchestration, getDb,
  updateSkillSchemas, recordReputation, getReputationScore,
  recordSkillMetric, getSkillMetricsSummary, recordSkillVersion, getSkillWithAb, promoteChallenger,
  writeAuditLog, upsertDiscovery, updateSkillSecurityStatus,
} from '../db/index';
import { embed } from '../core/embeddings';
import { scanSkillTemplate } from '../core/skill-scanner';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { logUsage } from '../utils/usage';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logger } from '../utils/logger';
import { env, isSimulationMode } from '../config/index';

export const skillsRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function embedSkillInBackground(id: string, name: string, description: string, tags: string[]): void {
  const text = `${name}: ${description}${tags.length ? '. Tags: ' + tags.join(', ') : ''}`;
  embed(text)
    .then((vector) => upsertDiscovery({ id: `skill:${id}`, skillName: name, skillDesc: description, provider: 'clawhub', embedding: vector }))
    .catch((err) => logger.warn({ err, skillId: id }, 'Skill embedding failed'));
}

const CreateSkillSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens only'),
  displayName: z.string().min(2).max(80).trim().optional(),
  category: z.enum(['general', 'defi', 'security', 'social', 'ai', 'search', 'media', 'enrichment', 'utility', 'infrastructure', 'weather', 'analytics']).default('general'),
  description: z.string().min(10).max(500).trim(),
  promptTemplate: z.string().min(10).max(2000).trim(),
  public: z.boolean().default(false),
  creditCost: z.number().int().min(0).max(10000).default(0),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  changelog: z.string().max(1000).trim().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  tags: z.array(z.string().max(32)).max(10).optional(),
  skillType: z.enum(['prompt_template', 'api_proxy']).default('prompt_template'),
  proxyUrl: z.string().url().optional(),
  proxyMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
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
    displayName: data.displayName,
    description: data.description,
    promptTemplate: data.promptTemplate,
    authorKey: keyInfo.key,
    public: data.public,
    creditCost: data.creditCost,
    changelog: data.changelog,
    category: data.category,
    skillType: data.skillType,
    proxyUrl: data.proxyUrl,
    proxyMethod: data.proxyMethod,
  });

  // Scan prompt template for injection patterns
  const scan = scanSkillTemplate(data.promptTemplate);
  if (scan.status !== 'CLEAN') {
    updateSkillSecurityStatus(id, scan.status, scan.flags);
    logger.warn({ id, flags: scan.flags }, 'Skill template flagged by scanner');
  } else {
    updateSkillSecurityStatus(id, 'CLEAN');
  }

  updateSkillSchemas(id, {
    version: data.version,
    inputSchemaJson: data.inputSchema ? JSON.stringify(data.inputSchema) : undefined,
    outputSchemaJson: data.outputSchema ? JSON.stringify(data.outputSchema) : undefined,
    tagsJson: data.tags ? JSON.stringify(data.tags) : undefined,
    publishedAt: data.public ? new Date().toISOString() : undefined,
  });

  // Embed into discovery index if published publicly
  if (data.public) {
    embedSkillInBackground(id, data.name, data.description, data.tags ?? []);
  }

  logger.info({ id, name: data.name, author: keyInfo.key.slice(0, 8) }, 'Skill created');

  return c.json({
    id,
    name: data.name,
    description: data.description,
    version: data.version,
    variables,
    public: data.public,
    creditCost: data.creditCost,
    invokeUrl: `POST /v1/skills/${id}/invoke`,
  }, 201);
});

// ─── GET /v1/skills — list public skills (ClawHub registry) ───────────────────

skillsRouter.get('/', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  const skills = listPublicSkills(offset, limit);
  const total = countPublicSkills();

  return c.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
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
    if (!key || key.length !== skill.author_key.length ||
        !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(skill.author_key))) {
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

// ─── GET /v1/skills/:id/reputation — public reputation score ─────────────────

skillsRouter.get('/:id/reputation', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  const score = getReputationScore(skill.author_key);
  return c.json({ skillId: id, authorScore: score, skillUses: skill.uses });
});

// ─── PATCH /v1/skills/:id/visibility — publish or unpublish ───────────────────

skillsRouter.patch('/:id/visibility', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const VisibilityBody = z.object({ public: z.boolean() }).strict();
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON' }, 400);
  const parsed = VisibilityBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'Field "public" (boolean) required', details: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;

  const updated = updateSkillVisibility(id, keyInfo.key, body.public);
  if (!updated) return c.json({ error: 'Skill not found or not yours' }, 404);

  if (body.public) {
    updateSkillSchemas(id, { publishedAt: new Date().toISOString() });
    const skill = getSkill(id);
    if (skill) embedSkillInBackground(id, skill.name, skill.description, []);
  }

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

// ─── GET /v1/skills/:id/metrics — performance metrics by version ──────────────

skillsRouter.get('/:id/metrics', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  const summary = getSkillMetricsSummary(id);
  return c.json({ skillId: id, versions: summary });
});

// ─── POST /v1/skills/:id/fork — fork a skill into a challenger variant ────────

skillsRouter.post('/:id/fork', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const original = getSkillWithAb(id);
  if (!original) return c.json({ error: 'Skill not found' }, 404);
  if (!original.public && original.author_key !== keyInfo.key)
    return c.json({ error: 'Skill not found' }, 404);
  if (original.ab_challenger)
    return c.json({ error: 'Skill already has an active challenger — promote or discard it first' }, 409);

  const ForkSchema = z.object({
    promptTemplate: z.string().min(10).max(5000),
    creditCost: z.number().int().min(0).max(10000).optional(),
    description: z.string().max(500).optional(),
  }).strict();

  let raw: unknown;
  try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const parsed = ForkSchema.safeParse(raw);
  if (!parsed.success)
    return c.json({ error: 'Invalid fork data', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;

  // Bump version: 1.0.0 → 1.1.0
  const parts = (original.version ?? '1.0.0').split('.').map(Number);
  parts[1] = (parts[1] ?? 0) + 1;
  parts[2] = 0;
  const newVersion = parts.join('.');

  const forkId = nanoid(12);
  createSkill({
    id: forkId,
    name: (original.name + '-v' + newVersion).slice(0, 50),
    description: body.description ?? original.description,
    promptTemplate: body.promptTemplate,
    authorKey: keyInfo.key,
    public: false, // challenger starts private
    creditCost: body.creditCost ?? original.credit_cost,
  });
  updateSkillSchemas(forkId, {
    version: newVersion,
    inputSchemaJson: original.input_schema_json ?? undefined,
    outputSchemaJson: original.output_schema_json ?? undefined,
    tagsJson: original.tags_json ?? undefined,
  });

  // Record the fork relationship
  recordSkillVersion({
    id: nanoid(12), skillId: forkId, version: newVersion,
    forkedFromSkill: id, forkedFromVersion: original.version ?? '1.0.0',
    forkedByAgent: keyInfo.key,
  });

  // Only the original author can set a challenger for A/B testing
  if (original.author_key === keyInfo.key) {
    getDb().prepare(`UPDATE skills SET ab_challenger = ? WHERE id = ?`).run(forkId, id);
  }

  writeAuditLog({ entityType: 'skill', entityId: forkId, action: 'FORKED', actorId: keyInfo.key,
    data: { originalId: id, newVersion, fromVersion: original.version } });

  logger.info({ forkId, originalId: id, version: newVersion, author: keyInfo.key.slice(0, 8) }, 'Skill forked');
  return c.json({ id: forkId, version: newVersion, forkedFrom: id, abEnabled: original.author_key === keyInfo.key }, 201);
});

// ─── POST /v1/skills/:id/promote — promote challenger to canonical ─────────────

skillsRouter.post('/:id/promote', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill) return c.json({ error: 'Skill not found' }, 404);
  if (skill.author_key !== keyInfo.key) return c.json({ error: 'Not the author' }, 403);

  const promoted = promoteChallenger(id);
  if (!promoted) return c.json({ error: 'No active challenger to promote' }, 400);

  writeAuditLog({ entityType: 'skill', entityId: id, action: 'CHALLENGER_PROMOTED', actorId: keyInfo.key });
  return c.json({ ok: true, message: 'Challenger promoted to canonical version' });
});

// ─── POST /v1/skills/:id/invoke — run a skill ─────────────────────────────────

skillsRouter.post('/:id/invoke', checkApiKey, async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  // A/B routing: 30% of requests go to challenger if one is active
  const baseSkill = getSkillWithAb(id);
  if (!baseSkill) return c.json({ requestId, error: 'Skill not found' }, 404);

  const useChallenger = baseSkill.ab_challenger && Math.random() < 0.30;
  const skill = useChallenger ? (getSkill(baseSkill.ab_challenger!) ?? baseSkill) : baseSkill;
  const activeSkillId = useChallenger ? (baseSkill.ab_challenger ?? id) : id;

  // Access check: public skills anyone can invoke, private only the author
  if (!baseSkill.public && baseSkill.author_key !== keyInfo.key) {
    return c.json({ requestId, error: 'Skill not found' }, 404);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; } // empty body OK — variables optional

  const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = InvokeBody.safeParse(rawBody);
  if (!bodyParsed.success) return c.json({ requestId, error: 'Invalid variables', details: bodyParsed.error.flatten().fieldErrors }, 400);
  const variables = bodyParsed.data.variables ?? {};

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

  // Pre-check: reject zero-balance users BEFORE expensive LLM work
  if (!keyInfo.isEnvKey && keyInfo.credits < Math.max(1, skill.credit_cost)) {
    return c.json({
      requestId,
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      creditsRequired: Math.max(1, skill.credit_cost),
      creditsAvailable: keyInfo.credits,
      hint: 'Top up your credits at claw-net.org',
    }, 402);
  }

  // Skill-level cache
  const qKey = skillCacheKey(activeSkillId, variables);
  const cachedResponse = await cacheGet<Record<string, unknown>>(qKey);
  if (cachedResponse) {
    logger.info({ requestId, skillId: id }, 'Skill cache hit');
    return c.json({ ...cachedResponse, requestId, metadata: { ...(cachedResponse.metadata as Record<string, unknown>), cacheHit: true } });
  }

  logger.info({ requestId, skillId: id, name: skill.name }, 'Skill invocation');

  // ── API proxy execution (skill_type = 'api_proxy') ───────────────────────
  if (skill.skill_type === 'api_proxy' && skill.proxy_url) {
    try {
      const proxyRes = await fetch(skill.proxy_url, {
        method: skill.proxy_method ?? 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: skill.proxy_method !== 'GET' ? JSON.stringify(variables) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const proxyData = await proxyRes.json().catch(async () => ({ raw: await proxyRes.text() }));

      if (!proxyRes.ok) {
        recordSkillMetric({ skillId: activeSkillId, version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
          latencyMs: Date.now() - start, success: false, costCredits: 0 });
        return c.json({ requestId, error: 'Proxy upstream error', status: proxyRes.status, data: proxyData }, 502);
      }

      const creditsToDeduct = Math.max(1, skill.credit_cost);
      if (!keyInfo.isEnvKey) {
        const ok = getDb().transaction(() => deductCredit(keyInfo.key, creditsToDeduct))();
        if (!ok) {
          return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS',
            creditsRequired: creditsToDeduct, creditsAvailable: keyInfo.credits }, 402);
        }
      }
      incrementSkillUses(activeSkillId);
      recordSkillMetric({ skillId: activeSkillId, version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
        latencyMs: Date.now() - start, success: true, costCredits: creditsToDeduct });

      return c.json({ requestId, status: proxyRes.status, data: proxyData,
        skill: { id: skill.id, name: skill.name }, creditsUsed: creditsToDeduct });
    } catch (err) {
      logger.error({ requestId, skillId: id, err }, 'API proxy skill failed');
      return c.json({ requestId, error: 'Proxy request failed', details: String(err) }, 502);
    }
  }

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
      // Atomically deduct credits and pay revenue share in a single transaction
      const revenueSharePct = skill.revenue_share_pct;
      const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;

      const txResult = getDb().transaction(() => {
        const deducted = deductCredit(keyInfo.key, creditsToDeduct);
        if (!deducted) return false;
        if (shouldPayAuthor) {
          const authorShare = Math.floor(creditsToDeduct * revenueSharePct);
          if (authorShare > 0) topUpCredits(skill.author_key, authorShare);
        }
        return true;
      })();

      if (!txResult) {
        return c.json({
          requestId,
          error: 'Insufficient credits',
          code: 'INSUFFICIENT_CREDITS',
          creditsRequired: creditsToDeduct,
          creditsAvailable: keyInfo.credits,
          hint: 'Top up your credits at claw-net.org',
        }, 402);
      }
    }

    incrementSkillUses(activeSkillId);

    // Record performance metrics for A/B comparison
    recordSkillMetric({
      skillId: activeSkillId,
      version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
      latencyMs: Date.now() - start,
      success: true,
      costCredits: creditsToDeduct,
    });

    // Reputation: reward the skill author for successful invocations
    if (skill.author_key && skill.author_key !== keyInfo.key) {
      recordReputation({
        agentId: skill.author_key,
        skillId: id,
        eventType: 'SKILL_INVOKED',
        scoreDelta: 0.1,
        data: { invokerKey: keyInfo.key.slice(0, 8), creditsCharged: creditsToDeduct },
      });
    }

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
    insertOrchestration({ id: requestId, ...usageEntry, apiKey: keyInfo.key, skillId: skill.id });

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

    recordSkillMetric({
      skillId: activeSkillId,
      version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
      latencyMs: Date.now() - start,
      success: false,
      costCredits: 0,
    });

    if (skill.author_key && skill.author_key !== keyInfo.key) {
      recordReputation({
        agentId: skill.author_key, skillId: id,
        eventType: 'SKILL_FAILED', scoreDelta: -0.05,
        data: { error: error.message },
      });
    }

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
