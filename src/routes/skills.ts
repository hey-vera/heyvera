import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { renderTemplate } from '../utils/template';
import { checkApiKey } from '../middleware/auth';
import {
  createSkill, getSkill, listPublicSkills, countPublicSkills, getSkillsByAuthor,
  countSkillsByAuthor, incrementSkillUses, deleteSkill,
  updateSkillVisibility, topUpCredits, deductCredit, insertOrchestration, getDb,
  updateSkillSchemas, recordReputation, getReputationScore,
  recordSkillMetric, getSkillMetricsSummary, recordSkillVersion, getSkillWithAb, promoteChallenger,
  writeAuditLog, upsertDiscovery, updateSkillSecurityStatus, setAbChallenger, recordTransaction,
  getSkillCostAnalytics, checkVerificationEligibility, autoVerifyPublisher, safeJsonParse,
} from '../db/index';
import { embed } from '../core/embeddings';
import { scanSkillTemplate, scanProxyResponse } from '../core/skill-scanner';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { buildIntentFromPlan } from '../core/skill-executor';
import { creditsForExecution } from '../core/credits';
import { findEndpoint } from '../config/api-registry';
import { logUsage } from '../utils/usage';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logger } from '../utils/logger';
import { env, isSimulationMode, rateTier } from '../config/index';

export const skillsRouter = new Hono();

// ─── SSRF protection for api_proxy skills ────────────────────────────────────

/** Block proxy URLs pointing to private/internal addresses (SSRF prevention). */
function isProxyUrlSafe(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    // Enforce HTTPS in production (HTTP only allowed in dev for local testing)
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') return false;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    // Block localhost variants
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return false;
    // Block private IP ranges
    if (/^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^192\.168\./.test(host)) return false;
    // Block link-local and metadata
    if (/^169\.254\./.test(host)) return false;
    // Block IPv6 private ranges — after URL parsing, hostname has NO brackets
    // ULA (fc00::/7): fc** and fd**
    if (host.startsWith('fc') || host.startsWith('fd')) return false;
    // Link-local (fe80::/10): fe80 through febf
    if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return false;
    // IPv4-mapped IPv6 (::ffff:192.168.x.x bypasses IPv4 blocks)
    if (host.startsWith('::ffff:')) return false;
    return true;
  } catch {
    return false;
  }
}

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
  category: z.enum(['general', 'defi', 'security', 'social', 'ai', 'search', 'media', 'enrichment', 'utility', 'infrastructure', 'weather', 'analytics', 'data']).default('general'),
  description: z.string().min(10).max(500).trim(),
  // prompt_template and data skills don't need a prompt — defaults to '' for data skills
  promptTemplate: z.string().max(2000).trim().default(''),
  public: z.boolean().default(false),
  creditCost: z.number().int().min(0).max(10000).default(0),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  changelog: z.string().max(1000).trim().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  tags: z.array(z.string().max(32)).max(10).optional(),
  skillType: z.enum(['prompt_template', 'api_proxy', 'data']).default('prompt_template'),
  proxyUrl: z.string().url().optional(),
  proxyMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  executionPlanJson: z.string().max(10000).optional(), // third-party deterministic execution plan
  skillClass: z.enum(['standard', 'recursive', 'self_checking']).default('standard'),
  creatorEvmWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address (0x...)').optional(),
  // ── Data skill fields ───────────────────────────────────────────────────────
  /** A real example of what this skill returns. Shown on marketplace card so agents know exactly what they'll get. */
  sampleOutput: z.record(z.unknown()).optional(),
  /** How often the underlying data source updates. Controls Redis cache TTL automatically. */
  updateFrequency: z.enum(['realtime', 'hourly', 'daily', 'weekly', 'static']).default('static'),
});

// Extract {{variable}} placeholders from a template
function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
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

  // SSRF prevention — block proxy/data source URLs pointing to internal addresses
  if ((data.skillType === 'api_proxy' || data.skillType === 'data') && data.proxyUrl && !isProxyUrlSafe(data.proxyUrl)) {
    return c.json({ error: 'Source URL must be a public HTTPS URL (no localhost, private IPs, or metadata endpoints)', code: 'INVALID_PROXY_URL' }, 400);
  }

  // Data skills must have a source URL
  if (data.skillType === 'data' && !data.proxyUrl) {
    return c.json({ error: 'Data skills require a proxyUrl (the URL of your data source)', code: 'MISSING_DATA_SOURCE' }, 400);
  }

  // prompt_template skills must have a non-empty template
  if (data.skillType === 'prompt_template' && data.promptTemplate.length < 10) {
    return c.json({ error: 'prompt_template skills require a promptTemplate of at least 10 characters', code: 'MISSING_PROMPT' }, 400);
  }

  const variables = data.skillType === 'data' ? [] : extractVariables(data.promptTemplate);
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
    proxyMethod: data.skillType === 'data' ? 'GET' : data.proxyMethod,
    executionPlanJson: data.executionPlanJson,
    skillClass: data.skillClass,
    creatorEvmWallet: data.creatorEvmWallet,
    sampleOutputJson: data.sampleOutput ? JSON.stringify(data.sampleOutput) : undefined,
    updateFrequency: data.updateFrequency,
  });

  // Scan prompt template for injection patterns (data skills have no template to scan)
  if (data.skillType !== 'data') {
    const scan = scanSkillTemplate(data.promptTemplate);
    if (scan.status !== 'CLEAN') {
      updateSkillSecurityStatus(id, scan.status, scan.flags);
      logger.warn({ id, flags: scan.flags }, 'Skill template flagged by scanner');
    } else {
      updateSkillSecurityStatus(id, 'CLEAN');
    }
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
    skillType: data.skillType,
    version: data.version,
    public: data.public,
    creditCost: data.creditCost,
    ...(data.skillType === 'data'
      ? { updateFrequency: data.updateFrequency, queryUrl: `GET /v1/skills/${id}/query` }
      : { variables, invokeUrl: `POST /v1/skills/${id}/invoke` }
    ),
  }, 201);
});

// ─── GET /v1/skills — list public skills (ClawHub registry) ───────────────────

skillsRouter.get('/', (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;
  // Optional filter: ?type=data | prompt_template | api_proxy
  const typeFilter = c.req.query('type') as string | undefined;

  const skills = listPublicSkills(offset, limit, typeFilter);
  const total = countPublicSkills(typeFilter);

  return c.json({
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      displayName: s.display_name ?? s.name,
      description: s.description,
      skillType: s.skill_type,
      category: s.category,
      creditCost: s.credit_cost,
      uses: s.uses,
      stars: s.stars,
      // Data skills: expose update cadence + whether sample output is available
      ...(s.skill_type === 'data' && {
        updateFrequency: s.update_frequency,
        hasSampleOutput: !!s.sample_output_json,
        queryUrl: `GET /v1/skills/${s.id}/query`,
      }),
      // Other skills: expose template variables
      ...(s.skill_type !== 'data' && {
        variables: extractVariables(s.prompt_template),
        invokeUrl: `POST /v1/skills/${s.id}/invoke`,
      }),
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
      displayName: s.display_name ?? s.name,
      description: s.description,
      skillType: s.skill_type,
      category: s.category,
      public: s.public === 1,
      creditCost: s.credit_cost,
      revenueSharePct: s.revenue_share_pct,
      uses: s.uses,
      stars: s.stars,
      ...(s.skill_type === 'data'
        ? { updateFrequency: s.update_frequency, hasSampleOutput: !!s.sample_output_json, queryUrl: `GET /v1/skills/${s.id}/query` }
        : { variables: extractVariables(s.prompt_template), invokeUrl: `POST /v1/skills/${s.id}/invoke` }
      ),
      createdAt: s.created_at,
    })),
  });
});

// ─── GET /v1/skills/:id — get skill details ────────────────────────────────────

skillsRouter.get('/:id', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);

  if (!skill) return c.json({ error: 'Skill not found' }, 404);

  // Private skills only visible to author — SHA-256 normalization gives constant-time
  // comparison without leaking key length (same pattern as admin-auth.ts).
  if (!skill.public) {
    const key = c.req.header('X-API-Key') ?? '';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const authorHash = crypto.createHash('sha256').update(skill.author_key).digest();
    if (!crypto.timingSafeEqual(keyHash, authorHash)) {
      return c.json({ error: 'Skill not found' }, 404);
    }
  }

  return c.json({
    id: skill.id,
    name: skill.name,
    displayName: skill.display_name ?? skill.name,
    description: skill.description,
    readme: skill.readme,
    skillType: skill.skill_type,
    skillClass: skill.skill_class ?? 'standard',
    category: skill.category,
    version: skill.version,
    tags: safeJsonParse(skill.tags_json, []),
    inputSchema: safeJsonParse(skill.input_schema_json, null),
    outputSchema: safeJsonParse(skill.output_schema_json, null),
    public: skill.public === 1,
    creditCost: skill.credit_cost,
    uses: skill.uses,
    stars: skill.stars,
    securityStatus: skill.security_status,
    createdAt: skill.created_at,
    // Data skills: full contract so agents know exactly what they'll receive
    ...(skill.skill_type === 'data' && {
      updateFrequency: skill.update_frequency,
      sampleOutput: safeJsonParse(skill.sample_output_json, null),
      queryUrl: `GET /v1/skills/${skill.id}/query`,
    }),
    // Other skills: template variables + invoke endpoint
    ...(skill.skill_type !== 'data' && {
      variables: extractVariables(skill.prompt_template),
      invokeUrl: `POST /v1/skills/${skill.id}/invoke`,
    }),
  });
});

// ─── GET /v1/skills/:id/query — query a data skill ───────────────────────────
// Data skills return structured JSON directly. No LLM, no orchestration.
// Smart Redis caching with TTL driven by the skill's update_frequency.
// Cache hits cost 1 credit; live fetches cost skill.credit_cost (min 1).

function getDataSkillTtl(updateFrequency: string): number {
  switch (updateFrequency) {
    case 'realtime': return 60;        // 1 min — still cache to protect source
    case 'hourly':   return 3_600;     // 1 hour
    case 'daily':    return 86_400;    // 24 hours
    case 'weekly':   return 604_800;   // 7 days
    case 'static':   return 2_592_000; // 30 days
    default:         return 3_600;
  }
}

skillsRouter.get('/:id/query', checkApiKey, async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill || skill.skill_type !== 'data') {
    return c.json({ requestId, error: 'Data skill not found', code: 'NOT_FOUND' }, 404);
  }

  if (!skill.public && skill.author_key !== keyInfo.key) {
    return c.json({ requestId, error: 'Skill not found' }, 404);
  }

  if (skill.security_status === 'FLAGGED') {
    return c.json({ requestId, error: 'This skill has been flagged for review', code: 'SKILL_FLAGGED' }, 403);
  }

  if (!skill.proxy_url) {
    return c.json({ requestId, error: 'Data skill has no source URL configured', code: 'NO_SOURCE' }, 503);
  }

  const creditCost = Math.max(1, skill.credit_cost);
  if (!keyInfo.isEnvKey && keyInfo.credits < 1) {
    return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: 1 }, 402);
  }

  // Build cache key: skill id + sorted query params
  const params = c.req.query();
  const cacheKey = 'data:' + crypto.createHash('sha256')
    .update(JSON.stringify({ id, p: Object.fromEntries(Object.entries(params).sort()) }))
    .digest('hex').slice(0, 16);

  const ttl = getDataSkillTtl(skill.update_frequency ?? 'static');
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);

  if (cached) {
    if (!keyInfo.isEnvKey) {
      const ok = deductCredit(keyInfo.key, 1);
      if (!ok) return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
    }
    incrementSkillUses(id);
    logger.info({ requestId, skillId: id }, 'Data skill cache hit');
    return c.json({
      requestId, skillId: id,
      data: cached,
      _meta: { cacheHit: true, creditsUsed: 1, updateFrequency: skill.update_frequency ?? 'static' },
    });
  }

  // SSRF guard on source URL at query time (creator may have misconfigured after creation)
  if (!isProxyUrlSafe(skill.proxy_url)) {
    return c.json({ requestId, error: 'Data source URL is blocked', code: 'SSRF_BLOCKED' }, 403);
  }

  try {
    const url = new URL(skill.proxy_url);
    // Forward caller query params to the upstream data source
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.warn({ requestId, skillId: id, status: res.status }, 'Data skill source error');
      recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: false, costCredits: 0 });
      return c.json({ requestId, error: 'Data source error', status: res.status, code: 'SOURCE_ERROR' }, 502);
    }

    const data = await res.json().catch(async () => ({ raw: await res.text() }));

    // Cache result with TTL appropriate to data freshness
    await cacheSet(cacheKey, data, ttl);

    // Billing + 97/3 revenue share (same as invoke)
    if (!keyInfo.isEnvKey) {
      const revenueSharePct = skill.revenue_share_pct;
      const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;
      const ok = getDb().transaction(() => {
        const deducted = deductCredit(keyInfo.key, creditCost);
        if (!deducted) return false;
        if (shouldPayAuthor) {
          const authorShare = Math.floor(creditCost * revenueSharePct);
          const feeCredits = creditCost - authorShare;
          if (authorShare > 0) {
            topUpCredits(skill.author_key, authorShare);
            if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
            recordTransaction({
              fromAgent: keyInfo.key, toAgent: skill.author_key,
              amountCredits: creditCost, type: 'SKILL_SALE',
              skillId: id, feeCredits,
            });
          }
        }
        return true;
      })();
      if (!ok) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: creditCost }, 402);
      }
    }

    incrementSkillUses(id);
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: true, costCredits: creditCost });

    if (skill.author_key && skill.author_key !== keyInfo.key) {
      recordReputation({ agentId: skill.author_key, skillId: id, eventType: 'SKILL_INVOKED', scoreDelta: 0.1 });
    }

    logger.info({ requestId, skillId: id, durationMs: Date.now() - start }, 'Data skill query complete');

    return c.json({
      requestId, skillId: id,
      data,
      _meta: {
        cacheHit: false, creditsUsed: creditCost,
        updateFrequency: skill.update_frequency ?? 'static',
        ttlSeconds: ttl,
        sourceLatencyMs: Date.now() - start,
      },
    });

  } catch (err) {
    logger.error({ requestId, skillId: id, err }, 'Data skill query failed');
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: false, costCredits: 0 });
    return c.json({ requestId, error: 'Data fetch failed', code: 'FETCH_ERROR' }, 502);
  }
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

  // Scan forked template for injection patterns
  const forkScan = scanSkillTemplate(body.promptTemplate);
  if (forkScan.status !== 'CLEAN') {
    updateSkillSecurityStatus(forkId, forkScan.status, forkScan.flags);
    logger.warn({ forkId, flags: forkScan.flags }, 'Forked skill template flagged by scanner');
  } else {
    updateSkillSecurityStatus(forkId, 'CLEAN');
  }

  // Record the fork relationship
  recordSkillVersion({
    id: nanoid(12), skillId: forkId, version: newVersion,
    forkedFromSkill: id, forkedFromVersion: original.version ?? '1.0.0',
    forkedByAgent: keyInfo.key,
  });

  // Only the original author can set a challenger for A/B testing
  if (original.author_key === keyInfo.key) {
    setAbChallenger(id, forkId);
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

  // Data skills are queried, not invoked — redirect callers to the right endpoint
  if (baseSkill.skill_type === 'data') {
    return c.json({
      requestId,
      error: 'Data skills use GET /v1/skills/:id/query — not the invoke endpoint',
      code: 'USE_QUERY_ENDPOINT',
      queryUrl: `GET /v1/skills/${id}/query`,
    }, 400);
  }

  // Block invocation of flagged skills
  if (baseSkill.security_status === 'FLAGGED') {
    return c.json({ requestId, error: 'This skill has been flagged for review', code: 'SKILL_FLAGGED' }, 403);
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; } // empty body OK — variables optional

  const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = InvokeBody.safeParse(rawBody);
  if (!bodyParsed.success) return c.json({ requestId, error: 'Invalid variables', details: bodyParsed.error.flatten().fieldErrors }, 400);
  const variables = bodyParsed.data.variables ?? {};

  // Check variable values against injection patterns — prevent bypassing template-level scanning
  if (Object.keys(variables).length > 0) {
    const varScan = scanSkillTemplate(Object.values(variables).join(' '));
    if (varScan.status !== 'CLEAN') {
      logger.warn({ requestId, skillId: id, flags: varScan.flags }, 'Skill invoke: variable values flagged');
      return c.json({ requestId, error: 'Variable values contain suspicious content', code: 'INJECTION_DETECTED', flags: varScan.flags }, 400);
    }
  }

  // Render the prompt template
  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err as Error).message, code: 'MISSING_VARIABLES' }, 400);
  }

  // Per-key rate limit (same tiered system as orchestrate)
  if (!keyInfo.isEnvKey) {
    const tierLimit = rateTier(keyInfo.amountPaid).perMinute;
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
    // Charge 1 credit for cache hits — prevents unlimited free re-invocations
    if (!keyInfo.isEnvKey) {
      const ok = deductCredit(keyInfo.key, 1);
      if (!ok) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
    }
    incrementSkillUses(activeSkillId);
    return c.json({ ...cachedResponse, requestId, metadata: { ...(cachedResponse.metadata as Record<string, unknown>), cacheHit: true, creditsUsed: 1 } });
  }

  logger.info({ requestId, skillId: id, name: skill.name }, 'Skill invocation');

  // ── API proxy execution (skill_type = 'api_proxy') ───────────────────────
  if (skill.skill_type === 'api_proxy' && skill.proxy_url) {
    // Q8: Runtime SSRF check — prevents pre-existing skills with internal URLs from being exploited
    if (!isProxyUrlSafe(skill.proxy_url)) {
      return c.json({ error: 'Skill proxy URL points to a blocked address', code: 'SSRF_BLOCKED' }, 403);
    }
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

      // Content safety scan — catches wallet drainers, phishing, social engineering
      const responseScan = scanProxyResponse(proxyData);
      if (!responseScan.safe) {
        logger.warn({ requestId, skillId: id, flags: responseScan.flags }, 'Proxy response flagged as unsafe');
        recordSkillMetric({ skillId: activeSkillId, version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
          latencyMs: Date.now() - start, success: false, costCredits: 0 });
        // Auto-flag the skill after dangerous response
        updateSkillSecurityStatus(id, 'FLAGGED', responseScan.flags);
        return c.json({ requestId, error: 'Response flagged for safety review', code: 'CONTENT_UNSAFE', flags: responseScan.flags }, 451);
      }

      const creditsToDeduct = Math.max(1, skill.credit_cost);
      if (!keyInfo.isEnvKey) {
        const revenueSharePct = skill.revenue_share_pct;
        const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;
        const ok = getDb().transaction(() => {
          const deducted = deductCredit(keyInfo.key, creditsToDeduct);
          if (!deducted) return false;
          if (shouldPayAuthor) {
            const authorShare = Math.floor(creditsToDeduct * revenueSharePct);
            const feeCredits = creditsToDeduct - authorShare;
            if (authorShare > 0) {
              topUpCredits(skill.author_key, authorShare);
              // Credit platform fee to treasury (was missing — fees were being destroyed)
              if (feeCredits > 0) {
                topUpCredits('clawhub-treasury', feeCredits);
              }
              recordTransaction({
                fromAgent: keyInfo.key, toAgent: skill.author_key,
                amountCredits: creditsToDeduct, type: 'SKILL_SALE',
                skillId: activeSkillId, feeCredits,
              });
            }
          }
          return true;
        })();
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
      return c.json({ requestId, error: 'Proxy request failed', details: env.NODE_ENV === 'production' ? undefined : String(err) }, 502);
    }
  }

  // Block prompt_template execution when data providers are offline.
  // api_proxy skills already returned above; this path always uses the LLM pipeline.
  if (isSimulationMode) {
    return c.json({
      requestId,
      error: 'Live data provider offline',
      code: 'SIMULATION_MODE',
      hint: 'This skill requires live blockchain data. The data provider is not currently connected. No credits were charged.',
    }, 503);
  }

  try {
    // Use deterministic execution plan if skill has one — skips LLM intent parsing (~3-5s saved)
    const skillWithPlan = skill as typeof skill & { execution_plan_json?: string | null };
    const intentFromPlan = skillWithPlan.execution_plan_json
      ? buildIntentFromPlan(skillWithPlan.execution_plan_json, variables, skill.name)
      : null;
    const intent = intentFromPlan ?? await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    let execution = await executePlan(intent, undefined, keyInfo.key);
    let formatted = await formatResponse(query, intent, execution);
    let totalApiCosts = execution.totalCost;
    // Accumulate ALL execution steps for accurate credit billing (recursive/self_checking run 2 passes)
    const allExecutionSteps = [...execution.steps];

    // ── Self-checking: validate output, retry once if schema validation fails ──
    if (skill.skill_class === 'self_checking' && skill.output_schema_json) {
      try {
        const schema = JSON.parse(skill.output_schema_json);
        const requiredFields = schema.required ?? Object.keys(schema.properties ?? {});
        const answerObj = JSON.parse(formatted.answer);
        const missing = requiredFields.filter((f: string) => !(f in answerObj));
        if (missing.length > 0) {
          logger.info({ requestId, missing }, 'Self-checking skill: output missing fields, retrying');
          const refinedQuery = `${query}\n\nIMPORTANT: Your response MUST include these fields: ${missing.join(', ')}`;
          const retryIntent = intentFromPlan
            ? buildIntentFromPlan(skillWithPlan.execution_plan_json!, variables, skill.name)
            : await parseIntent(refinedQuery);
          if (retryIntent) {
            const retryExec = await executePlan(retryIntent, undefined, keyInfo.key);
            const retryFormatted = await formatResponse(refinedQuery, retryIntent, retryExec);
            execution = retryExec;
            formatted = retryFormatted;
            totalApiCosts += retryExec.totalCost;
            allExecutionSteps.push(...retryExec.steps);
          }
        }
      } catch {
        // Schema parse or answer parse failed — use original response
        logger.debug({ requestId }, 'Self-checking: validation skipped (parse error)');
      }
    }

    // ── Recursive: refine output with a second pass (max 1 refinement) ─────────
    if (skill.skill_class === 'recursive' && formatted.answer) {
      try {
        const refineQuery = `Given this initial analysis:\n"${formatted.answer.slice(0, 1000)}"\n\nRefine and improve the analysis for: "${query}"`;
        const refineIntent = await parseIntent(refineQuery);
        if (refineIntent.steps.length > 5) refineIntent.steps = refineIntent.steps.slice(0, 5);
        const refineExec = await executePlan(refineIntent, undefined, keyInfo.key);
        const refineFormatted = await formatResponse(refineQuery, refineIntent, refineExec);
        if (refineFormatted.answer && refineFormatted.answer.length > formatted.answer.length * 0.5) {
          formatted = refineFormatted;
          totalApiCosts += refineExec.totalCost;
          execution = refineExec; // for step counts below
          allExecutionSteps.push(...refineExec.steps);
        }
      } catch (refineErr) {
        logger.warn({ requestId, err: refineErr }, 'Recursive refinement failed, using initial result');
      }
    }

    const apiCosts = totalApiCosts;
    const cacheHits = allExecutionSteps.filter((s) => s.cached).length;
    const totalDurationMs = Date.now() - start;

    // Credit cost: max of skill's fixed price and actual execution cost across ALL passes
    const actualCost = creditsForExecution(allExecutionSteps, findEndpoint);
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
          const feeCredits = creditsToDeduct - authorShare;
          if (authorShare > 0) {
            topUpCredits(skill.author_key, authorShare);
            // Credit platform fee to treasury (was missing — fees were being destroyed)
            if (feeCredits > 0) {
              topUpCredits('clawhub-treasury', feeCredits);
            }
            // Record in ledger so creator stats and payout availability are accurate
            recordTransaction({
              fromAgent: keyInfo.key,
              toAgent: skill.author_key,
              amountCredits: creditsToDeduct,
              type: 'SKILL_SALE',
              skillId: activeSkillId,
              feeCredits,
            });
          }
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
        skillId: activeSkillId,
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
      skill: { id: skill.id, name: skill.name, class: skill.skill_class ?? 'standard' },
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
        ...(skill.skill_class !== 'standard' && { skillClass: skill.skill_class }),
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
        agentId: skill.author_key, skillId: activeSkillId,
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

// ─── GET /v1/skills/:id/analytics — per-skill cost & performance analytics ────

skillsRouter.get('/:id/analytics', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found' }, 404);

  const analytics = getSkillCostAnalytics(id);
  return c.json({
    skillId: id,
    skillName: skill.name,
    skillClass: skill.skill_class ?? 'standard',
    ...analytics,
  });
});

// ─── GET /v1/skills/verification/status — check publisher verification eligibility ──

skillsRouter.get('/verification/status', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const eligibility = checkVerificationEligibility(keyInfo.key);
  return c.json(eligibility);
});

// ─── POST /v1/skills/verification/apply — apply for verified publisher status ──

skillsRouter.post('/verification/apply', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const eligibility = checkVerificationEligibility(keyInfo.key);

  if (!eligibility.eligible) {
    return c.json({
      ok: false,
      error: 'Not yet eligible for verification',
      code: 'NOT_ELIGIBLE',
      reasons: eligibility.reasons,
      metrics: eligibility.metrics,
    }, 403);
  }

  const verified = autoVerifyPublisher(keyInfo.key);
  writeAuditLog({
    entityType: 'publisher', entityId: keyInfo.key,
    action: 'VERIFIED', actorId: keyInfo.key,
    data: { skillsVerified: verified, metrics: eligibility.metrics },
  });
  logger.info({ authorKey: keyInfo.key.slice(0, 8), skillsVerified: verified }, 'Publisher verified');

  return c.json({
    ok: true,
    skillsVerified: verified,
    metrics: eligibility.metrics,
  });
});

// ─── POST /v1/skills/:id/test — dry-run a skill (owner only, no billing) ──────

skillsRouter.post('/:id/test', checkApiKey, async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill) return c.json({ requestId, error: 'Skill not found' }, 404);

  // Owner-only: only the author can dry-run their skill
  if (skill.author_key !== keyInfo.key) {
    return c.json({ requestId, error: 'Only the skill author can run a test' }, 403);
  }

  // Rate limit test runs: 10/min per key (prevents free API resource abuse)
  if (!keyInfo.isEnvKey) {
    const rlCount = await cacheIncr(`rl:skill-test:${keyInfo.key}`, 60);
    if (rlCount > 10) {
      return c.json({ requestId, error: 'Test rate limit exceeded (max 10/min)', code: 'RATE_LIMITED' }, 429);
    }
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; }

  const TestBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = TestBody.safeParse(rawBody);
  if (!bodyParsed.success) return c.json({ requestId, error: 'Invalid variables' }, 400);
  const variables = bodyParsed.data.variables ?? {};

  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err as Error).message, code: 'MISSING_VARIABLES' }, 400);
  }

  if (isSimulationMode) {
    return c.json({
      requestId, test: true,
      error: 'Live data provider offline (SIMULATION_MODE) — no credits charged',
      code: 'SIMULATION_MODE',
      hint: 'Set SOLANA_PRIVATE_KEY to enable live data',
    }, 503);
  }

  try {
    const skillWithPlan = skill as typeof skill & { execution_plan_json?: string | null };
    const intentFromPlan = skillWithPlan.execution_plan_json
      ? buildIntentFromPlan(skillWithPlan.execution_plan_json, variables, skill.name)
      : null;
    const intent = intentFromPlan ?? await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent, undefined, keyInfo.key);
    const formatted = await formatResponse(query, intent, execution);

    logger.info({ requestId, skillId: id, durationMs: Date.now() - start }, 'Skill test run complete');

    return c.json({
      requestId, test: true,
      answer: formatted.answer,
      ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
      ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
      suggestedActions: formatted.suggestedActions ?? [],
      dataSources: execution.steps.filter(s => s.success).map(s => s.endpointId),
      cachedSteps: execution.steps.filter(s => s.cached).length,
      steps: execution.steps.length,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    logger.error({ requestId, skillId: id, err }, 'Skill test run failed');
    return c.json({
      requestId, test: true,
      error: env.NODE_ENV === 'production' ? 'Test run failed' : (err as Error).message,
      code: 'EXECUTION_ERROR',
    }, 500);
  }
});
