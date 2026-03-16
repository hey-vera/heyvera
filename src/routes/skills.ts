import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { trackDelegatedSpend } from '../utils/billing';
import crypto from 'crypto';
import { renderTemplate } from '../utils/template';
import { maskApiKey } from '../utils/mask';
import { checkApiKey } from '../middleware/auth';
import {
  createSkill, getSkill, listPublicSkills, countPublicSkills, getSkillsByAuthor,
  countSkillsByAuthor, incrementSkillUses, deleteSkill,
  updateSkillVisibility, topUpCredits, deductCredit, insertOrchestration, getDb,
  updateSkillSchemas, recordReputation, getReputationScore,
  recordSkillMetric, getSkillMetricsSummary, recordSkillVersion, getSkillWithAb, promoteChallenger,
  writeAuditLog, upsertDiscovery, updateSkillSecurityStatus, setAbChallenger, recordTransaction,
  getSkillCostAnalytics, checkVerificationEligibility, autoVerifyPublisher, safeJsonParse,
  searchDiscovery,
  validateOutputContract,
  recordSkillDemand, getSkillDemand, recordCallerUsage, getCallerUsageCount,
} from '../db/index';
import { embed, isEmbeddingModelReady } from '../core/embeddings';
import { scanSkillTemplate, scanProxyResponse } from '../core/skill-scanner';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { buildIntentFromPlan } from '../core/skill-executor';
import { creditsForExecution, x402SurchargeCredits, round6, cacheCreditCost, dynamicCreditCost } from '../core/credits';
import { computeRequestHash, computeResultHash } from '../utils/receipt-hash';
import { fireWebhookEvent } from '../utils/webhooks';
import { executeCompositeSkill } from '../core/composite-executor';
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
  skillType: z.enum(['prompt_template', 'api_proxy', 'data', 'composite']).default('prompt_template'),
  proxyUrl: z.string().url().optional(),
  proxyMethod: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  executionPlanJson: z.string().max(10000).optional(), // third-party deterministic execution plan
  skillClass: z.enum(['standard', 'recursive', 'self_checking']).default('standard'),
  creatorEvmWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address (0x...)')
    .refine(addr => addr !== '0x0000000000000000000000000000000000000000', 'Cannot use zero/burn address')
    .optional(),
  // ── Data skill fields ───────────────────────────────────────────────────────
  /** A real example of what this skill returns. Shown on marketplace card so agents know exactly what they'll get. */
  sampleOutput: z.record(z.unknown()).optional(),
  /** How often the underlying data source updates. Controls Redis cache TTL automatically. */
  updateFrequency: z.enum(['realtime', 'hourly', 'daily', 'weekly', 'static']).default('static'),
  /** Link to the paired skill (LLM ↔ data variant) for marketplace toggle cards. Must be a skill you own. */
  pairedSkillId: z.string().max(50).optional(),
  /** Max invocations per hour (rate limit). Null = unlimited. */
  maxCallsPerHour: z.number().int().min(1).max(100000).optional(),
  // ── Composite skill fields ──────────────────────────────────────────────────
  /** Dependencies for composite skills — supports output piping, parallel groups, conditionals, retry/fallback. Max 5. */
  dependencies: z.array(z.object({
    skillId: z.string(),
    paramMapping: z.record(z.string()),
    outputKey: z.string(),
    group: z.number().int().min(0).max(10).optional(),
    condition: z.object({
      field: z.string(),
      op: z.enum(['exists', 'not_exists', 'eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']),
      value: z.union([z.string(), z.number()]).optional(),
    }).optional(),
    fallbackSkillId: z.string().optional(),
    retries: z.number().int().min(1).max(3).optional(),
  })).max(5).optional(),
  /** Composite config — caching, execution mode, budget cap. */
  compositeConfig: z.object({
    cacheTtl: z.number().int().min(0).max(86400).optional(),
    executionMode: z.enum(['sequential', 'grouped']).optional(),
    maxTotalCredits: z.number().min(0).optional(),
  }).optional(),
  // ── SLA & Output Contract fields ────────────────────────────────────────────
  /** SLA guarantees — agents trust these commitments when selecting skills. */
  sla: z.object({
    guaranteed_uptime: z.number().min(0).max(100).default(99),
    max_latency_ms: z.number().int().min(0).max(60000).default(5000),
    min_success_rate: z.number().min(0).max(100).default(95),
    penalty_pct: z.number().min(0).max(100).default(10),
  }).optional(),
  /** Output contract — JSON Schema that output must conform to. Agents can validate trust. */
  outputContract: z.object({
    type: z.enum(['object', 'array', 'string', 'number']).optional(),
    required: z.array(z.string()).optional(),
    properties: z.record(z.object({ type: z.string().optional() })).optional(),
  }).optional(),
  // ── Dynamic pricing ─────────────────────────────────────────────────────────
  /** Configure surge pricing, volume discounts, and off-peak discounts. */
  pricingConfig: z.object({
    surge: z.object({
      thresholdPerHour: z.number().int().min(1).max(100000),
      multiplier: z.number().min(1).max(5),
      maxMultiplier: z.number().min(1).max(5).optional(),
    }).optional(),
    volumeDiscounts: z.array(z.object({
      minCalls: z.number().int().min(1),
      discountPct: z.number().min(1).max(50),
    })).max(5).optional(),
    offPeak: z.object({
      utcHoursStart: z.number().int().min(0).max(23),
      utcHoursEnd: z.number().int().min(0).max(23),
      discountPct: z.number().min(1).max(50),
    }).optional(),
  }).optional(),
  /** Allow autonomous replacement in composites when this skill degrades. */
  autoReplace: z.boolean().default(false),
});

/** Build provider trust object with optional SLA for responses. */
function buildProviderInfo(skill: { security_status: string; success_rate: number; avg_rating: number; author_key: string; sla_json: string | null; output_contract_json: string | null }) {
  const info: Record<string, unknown> = {
    verified: skill.security_status === 'VERIFIED',
    successRate: skill.success_rate ?? 0,
    avgRating: skill.avg_rating ?? 0,
    reputationScore: getReputationScore(skill.author_key),
  };
  if (skill.sla_json) {
    try { info.sla = JSON.parse(skill.sla_json); } catch { /* ignore */ }
  }
  if (skill.output_contract_json) {
    info.hasOutputContract = true;
  }
  return info;
}

// Extract {{variable}} placeholders from a template
function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}


function skillCacheKey(skillId: string, variables: Record<string, string>): string {
  const normalized = JSON.stringify({ skillId, variables: Object.fromEntries(Object.entries(variables).sort()) });
  return 'skill:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ─── Per-Skill Rate Limit ────────────────────────────────────────────────────

/** Apply dynamic pricing to a skill's base credit cost. Tracks demand + caller usage. */
async function applyDynamicPricing(skill: { id: string; credit_cost: number; pricing_config_json: string | null }, callerKey: string): Promise<number> {
  const baseCost = Math.max(0.001, skill.credit_cost);
  if (!skill.pricing_config_json) return baseCost;

  let config: import('../core/credits').DynamicPricingConfig;
  try { config = JSON.parse(skill.pricing_config_json); } catch { return baseCost; }

  // Record demand for surge tracking
  recordSkillDemand(skill.id);
  recordCallerUsage(callerKey, skill.id);

  const currentDemand = getSkillDemand(skill.id);
  const callerUsage = getCallerUsageCount(callerKey, skill.id);
  const currentHourUtc = new Date().getUTCHours();

  return dynamicCreditCost(baseCost, config, currentDemand, callerUsage, currentHourUtc);
}

/** Check if a skill has a per-skill rate limit and enforce it via Redis INCR. */
async function checkSkillRateLimit(skillId: string, maxCallsPerHour: number | null): Promise<{ allowed: boolean; remaining?: number }> {
  if (!maxCallsPerHour || maxCallsPerHour <= 0) return { allowed: true };
  const key = `skill_rl:${skillId}`;
  const current = await cacheIncr(key, 3600); // 1-hour window
  if (current > maxCallsPerHour) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: maxCallsPerHour - current };
}

// ─── POST /v1/skills — create a skill ─────────────────────────────────────────

skillsRouter.post('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  // Cap at 20 skills per API key
  const count = countSkillsByAuthor(keyInfo.key);
  if (count >= 20) {
    return c.json({ error: 'Maximum 20 skills per API key', code: 'LIMIT_REACHED' }, 409);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const parsed = CreateSkillSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
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

  // Composite skills must have dependencies
  if (data.skillType === 'composite' && (!data.dependencies || data.dependencies.length === 0)) {
    return c.json({ error: 'Composite skills require at least 1 dependency', code: 'MISSING_DEPENDENCIES' }, 400);
  }

  // Validate pairedSkillId — must exist and belong to the same author
  if (data.pairedSkillId) {
    const paired = getSkill(data.pairedSkillId);
    if (!paired || paired.author_key !== keyInfo.key) {
      return c.json({ error: 'pairedSkillId must reference a skill you own', code: 'INVALID_PAIRED_SKILL' }, 400);
    }
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
    pairedSkillId: data.pairedSkillId,
    dependenciesJson: data.dependencies ? JSON.stringify(data.dependencies) : undefined,
    slaJson: data.sla ? JSON.stringify(data.sla) : undefined,
    outputContractJson: data.outputContract ? JSON.stringify(data.outputContract) : undefined,
    compositeConfigJson: data.compositeConfig ? JSON.stringify(data.compositeConfig) : undefined,
    pricingConfigJson: data.pricingConfig ? JSON.stringify(data.pricingConfig) : undefined,
    autoReplace: data.autoReplace,
  });

  // Set per-skill rate limit if specified
  if (data.maxCallsPerHour) {
    getDb().prepare('UPDATE skills SET max_calls_per_hour = ? WHERE id = ?').run(data.maxCallsPerHour, id);
  }

  // Set reverse link on the paired skill so both point at each other
  if (data.pairedSkillId) {
    getDb().prepare('UPDATE skills SET paired_skill_id = ? WHERE id = ? AND author_key = ?')
      .run(id, data.pairedSkillId, keyInfo.key);
  }

  // Scan prompt template + execution plan for injection patterns (data skills have no template)
  if (data.skillType !== 'data') {
    // Scan both the prompt template and execution plan param values
    const scanTarget = data.executionPlanJson
      ? data.promptTemplate + ' ' + data.executionPlanJson
      : data.promptTemplate;
    const scan = scanSkillTemplate(scanTarget);
    if (scan.status !== 'CLEAN') {
      updateSkillSecurityStatus(id, scan.status, scan.flags);
      logger.warn({ id, flags: scan.flags }, 'Skill template/plan flagged by scanner');
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

  logger.info({ id, name: data.name, author: maskApiKey(keyInfo.key) }, 'Skill created');

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
  // Optional filters: ?type=data | prompt_template | api_proxy  &  ?tag=defi
  const typeFilter = c.req.query('type') as string | undefined;
  const tagFilter = c.req.query('tag') as string | undefined;

  const skills = listPublicSkills(offset, limit, typeFilter, tagFilter);
  const total = countPublicSkills(typeFilter, tagFilter);

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
      tags: safeJsonParse<string[]>(s.tags_json, []),
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
      ...(s.paired_skill_id && { pairedSkillId: s.paired_skill_id }),
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
      ...(s.paired_skill_id && { pairedSkillId: s.paired_skill_id }),
      createdAt: s.created_at,
    })),
  });
});

// ─── GET /v1/skills/:id — get skill details ────────────────────────────────────

skillsRouter.get('/:id', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);

  if (!skill) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  // Private skills only visible to author — SHA-256 normalization gives constant-time
  // comparison without leaking key length (same pattern as admin-auth.ts).
  if (!skill.public) {
    const key = c.req.header('X-API-Key') ?? '';
    const keyHash = crypto.createHash('sha256').update(key).digest();
    const authorHash = crypto.createHash('sha256').update(skill.author_key).digest();
    if (!crypto.timingSafeEqual(keyHash, authorHash)) {
      return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
    }
  }

  // Resolve paired skill summary (LLM ↔ data toggle for marketplace cards)
  let pairedSkill: { id: string; name: string; skillType: string; creditCost: number; updateFrequency?: string } | undefined;
  if (skill.paired_skill_id) {
    const pair = getSkill(skill.paired_skill_id);
    if (pair && pair.public && pair.security_status !== 'FLAGGED') {
      pairedSkill = {
        id: pair.id,
        name: pair.name,
        skillType: pair.skill_type,
        creditCost: pair.credit_cost,
        ...(pair.skill_type === 'data' && { updateFrequency: pair.update_frequency }),
      };
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
    // Paired skill for marketplace toggle card (LLM Analysis ↔ Data)
    ...(pairedSkill && { pairedSkill }),
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
    default: break;
  }
  // Custom duration: "30s", "5m", "2h", "3d"
  const match = updateFrequency.match(/^(\d+)(s|m|h|d)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3_600 : 86_400;
    const ttl = n * multiplier;
    // Clamp: minimum 10s, maximum 30 days
    return Math.max(10, Math.min(ttl, 2_592_000));
  }
  return 3_600; // fallback: 1 hour
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
    return c.json({ requestId, error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
  }

  if (skill.security_status === 'FLAGGED') {
    return c.json({ requestId, error: 'This skill has been flagged for review', code: 'SKILL_FLAGGED' }, 403);
  }

  if (!skill.proxy_url) {
    return c.json({ requestId, error: 'Data skill has no source URL configured', code: 'NO_SOURCE' }, 503);
  }

  // Per-skill rate limit (creator-configurable)
  const skillRow = skill as typeof skill & { max_calls_per_hour?: number | null };
  if (skillRow.max_calls_per_hour) {
    const rl = await checkSkillRateLimit(id, skillRow.max_calls_per_hour);
    if (!rl.allowed) {
      return c.json({ requestId, error: 'Skill rate limit exceeded', code: 'SKILL_RATE_LIMITED', retryAfterSeconds: 3600 }, 429);
    }
  }

  const creditCost = await applyDynamicPricing(skill, keyInfo.key);
  if (!keyInfo.isEnvKey && keyInfo.credits < 1) {
    return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: 1 }, 402);
  }

  // Build cache key: skill id + sorted query params
  const params = c.req.query();
  // Cap query params to prevent upstream URL abuse
  if (Object.keys(params).length > 20) {
    return c.json({ requestId, error: 'Too many query parameters (max 20)', code: 'VALIDATION_ERROR' }, 400);
  }
  const cacheKey = 'data:' + crypto.createHash('sha256')
    .update(JSON.stringify({ id, p: Object.fromEntries(Object.entries(params).sort()) }))
    .digest('hex').slice(0, 16);

  const ttl = getDataSkillTtl(skill.update_frequency ?? 'static');
  const cached = await cacheGet<Record<string, unknown>>(cacheKey);

  if (cached) {
    const liveCost = Math.max(0.001, skill.credit_cost);
    const cacheCredits = cacheCreditCost(liveCost);
    if (!keyInfo.isEnvKey) {
      const ok = deductCredit(keyInfo.key, cacheCredits);
      if (ok) trackDelegatedSpend(keyInfo, cacheCredits);
      if (!ok) return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
    }
    incrementSkillUses(id);
    logger.info({ requestId, skillId: id, creditsUsed: cacheCredits }, 'Data skill cache hit');
    return c.json({
      requestId, skillId: id,
      data: cached,
      _meta: { cacheHit: true, creditsUsed: cacheCredits, updateFrequency: skill.update_frequency ?? 'static' },
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
      return c.json({
        requestId, error: 'Data source error', status: res.status, code: 'SOURCE_ERROR',
        hint: 'The upstream data source rejected this request. If you searched by token name or symbol, try using the contract/mint address instead (e.g. the Solana base58 address). Not all data sources support every token — meme coins and new launches may require the exact on-chain address.',
        creditsCharged: 0,
      }, 502);
    }

    const data = await res.json().catch(async () => ({ raw: await res.text() }));

    // Cache result with TTL appropriate to data freshness
    await cacheSet(cacheKey, data, ttl);

    // Billing + 85/15 revenue share (same as invoke)
    if (!keyInfo.isEnvKey) {
      const revenueSharePct = skill.revenue_share_pct;
      const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;
      const ok = getDb().transaction(() => {
        const deducted = deductCredit(keyInfo.key, creditCost);
        if (!deducted) return false;
        if (shouldPayAuthor) {
          const authorShare = round6(creditCost * revenueSharePct);
          const feeCredits = round6(creditCost - authorShare);
          if (authorShare > 0) {
            topUpCredits(skill.author_key, authorShare);
            if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
            const timestamp = new Date().toISOString();
            recordTransaction({
              fromAgent: keyInfo.key, toAgent: skill.author_key,
              amountCredits: creditCost, type: 'SKILL_SALE',
              skillId: id, feeCredits,
              requestHash: computeRequestHash({ skillId: id, variables: params, timestamp }),
              resultHash: computeResultHash({ data, costCredits: creditCost }),
            });
          }
        }
        return true;
      })();
      if (ok) trackDelegatedSpend(keyInfo, creditCost);
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
      provider: buildProviderInfo(skill),
      ...(skill.output_contract_json && (() => {
        const validation = validateOutputContract(data, skill.output_contract_json);
        if (!validation.valid) {
          fireWebhookEvent(skill.author_key, 'OUTPUT_CONTRACT_VIOLATION', { skillId: id, errors: validation.errors });
        }
        return { _outputContract: { valid: validation.valid, errors: validation.valid ? undefined : validation.errors } };
      })()),
    });

  } catch (err) {
    logger.error({ requestId, skillId: id, err }, 'Data skill query failed');
    recordSkillMetric({ skillId: id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: false, costCredits: 0 });
    return c.json({
      requestId, error: 'Data fetch failed', code: 'FETCH_ERROR',
      hint: 'The data source could not be reached (timeout or network error). Try again in a moment, or check if the skill\'s data source is currently healthy.',
      creditsCharged: 0,
    }, 502);
  }
});

// ─── GET /v1/skills/:id/reputation — public reputation score ─────────────────

skillsRouter.get('/:id/reputation', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  const score = getReputationScore(skill.author_key);
  return c.json({ skillId: id, authorScore: score, skillUses: skill.uses });
});

// ─── PATCH /v1/skills/:id/visibility — publish or unpublish ───────────────────

skillsRouter.patch('/:id/visibility', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const VisibilityBody = z.object({ public: z.boolean() }).strict();
  const raw = await c.req.json().catch(() => null);
  if (!raw) return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  const parsed = VisibilityBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'Field "public" (boolean) required', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors }, 400);
  const body = parsed.data;

  const updated = updateSkillVisibility(id, keyInfo.key, body.public);
  if (!updated) return c.json({ error: 'Skill not found or not yours', code: 'SKILL_NOT_FOUND' }, 404);

  if (body.public) {
    updateSkillSchemas(id, { publishedAt: new Date().toISOString() });
    const skill = getSkill(id);
    if (skill) embedSkillInBackground(id, skill.name, skill.description, []);
  }

  logger.info({ id, public: body.public, author: maskApiKey(keyInfo.key) }, 'Skill visibility updated');
  return c.json({ ok: true, public: body.public });
});

// ─── DELETE /v1/skills/:id — delete a skill ───────────────────────────────────

skillsRouter.delete('/:id', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const deleted = deleteSkill(id, keyInfo.key);
  if (!deleted) return c.json({ error: 'Skill not found or not yours', code: 'SKILL_NOT_FOUND' }, 404);

  logger.info({ id, author: maskApiKey(keyInfo.key) }, 'Skill deleted');
  return c.json({ ok: true });
});

// ─── GET /v1/skills/:id/metrics — performance metrics by version ──────────────

skillsRouter.get('/:id/metrics', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  const summary = getSkillMetricsSummary(id);
  return c.json({ skillId: id, versions: summary });
});

// ─── POST /v1/skills/:id/fork — fork a skill into a challenger variant ────────

skillsRouter.post('/:id/fork', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const original = getSkillWithAb(id);
  if (!original) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
  if (!original.public && original.author_key !== keyInfo.key)
    return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
  if (original.ab_challenger)
    return c.json({ error: 'Skill already has an active challenger — promote or discard it first', code: 'CHALLENGER_EXISTS' }, 409);

  const ForkSchema = z.object({
    promptTemplate: z.string().min(10).max(5000),
    creditCost: z.number().int().min(0).max(10000).optional(),
    description: z.string().max(500).optional(),
  }).strict();

  let raw: unknown;
  try { raw = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
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

  logger.info({ forkId, originalId: id, version: newVersion, author: maskApiKey(keyInfo.key) }, 'Skill forked');
  return c.json({ id: forkId, version: newVersion, forkedFrom: id, abEnabled: original.author_key === keyInfo.key }, 201);
});

// ─── POST /v1/skills/:id/promote — promote challenger to canonical ─────────────

skillsRouter.post('/:id/promote', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const skill = getSkill(id);
  if (!skill) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
  if (skill.author_key !== keyInfo.key) return c.json({ error: 'Not the author', code: 'FORBIDDEN' }, 403);

  const promoted = promoteChallenger(id);
  if (!promoted) return c.json({ error: 'No active challenger to promote', code: 'NO_CHALLENGER' }, 400);

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
  if (!baseSkill) return c.json({ requestId, error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  const useChallenger = baseSkill.ab_challenger && Math.random() < 0.30;
  const skill = useChallenger ? (getSkill(baseSkill.ab_challenger!) ?? baseSkill) : baseSkill;
  const activeSkillId = useChallenger ? (baseSkill.ab_challenger ?? id) : id;

  // Access check: public skills anyone can invoke, private only the author
  if (!baseSkill.public && baseSkill.author_key !== keyInfo.key) {
    return c.json({ requestId, error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);
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

  // ── Composite skill execution ──────────────────────────────────────────────
  if (baseSkill.skill_type === 'composite') {
    let rawBody: unknown;
    try { rawBody = await c.req.json(); } catch { rawBody = {}; }
    const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
    const bodyParsed = InvokeBody.safeParse(rawBody);
    if (!bodyParsed.success) return c.json({ requestId, error: 'Invalid variables', code: 'VALIDATION_ERROR' }, 400);
    const variables = bodyParsed.data.variables ?? {};

    const result = await executeCompositeSkill(baseSkill, variables, {
      callerKey: keyInfo.key,
      callerKeyInfo: keyInfo,
      parentRequestId: requestId,
    });

    const reputationScore = getReputationScore(baseSkill.author_key);
    return c.json({
      requestId,
      ok: result.ok,
      results: result.results,
      costBreakdown: result.costBreakdown,
      totalCreditsCharged: result.totalCreditsCharged,
      durationMs: result.durationMs,
      ...(result.error && { error: result.error }),
      provider: buildProviderInfo(baseSkill),
    }, result.ok ? 200 : 500);
  }

  // Per-skill rate limit (creator-configurable)
  const invokeSkillRow = baseSkill as typeof baseSkill & { max_calls_per_hour?: number | null };
  if (invokeSkillRow.max_calls_per_hour) {
    const rl = await checkSkillRateLimit(id, invokeSkillRow.max_calls_per_hour);
    if (!rl.allowed) {
      return c.json({ requestId, error: 'Skill rate limit exceeded', code: 'SKILL_RATE_LIMITED', retryAfterSeconds: 3600 }, 429);
    }
  }

  let rawBody: unknown;
  try { rawBody = await c.req.json(); } catch { rawBody = {}; } // empty body OK — variables optional

  const InvokeBody = z.object({ variables: z.record(z.string().max(500)).optional() });
  const bodyParsed = InvokeBody.safeParse(rawBody);
  if (!bodyParsed.success) return c.json({ requestId, error: 'Invalid variables', code: 'VALIDATION_ERROR', details: bodyParsed.error.flatten().fieldErrors }, 400);
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
    return c.json({ requestId, error: (err instanceof Error ? err.message : String(err)), code: 'MISSING_VARIABLES' }, 400);
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
  if (!keyInfo.isEnvKey && keyInfo.credits < Math.max(0.001, skill.credit_cost)) {
    return c.json({
      requestId,
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      creditsRequired: Math.max(0.001, skill.credit_cost),
      creditsAvailable: keyInfo.credits,
      hint: 'Top up your credits at claw-net.org',
    }, 402);
  }

  // Skill-level cache
  const qKey = skillCacheKey(activeSkillId, variables);
  const cachedResponse = await cacheGet<Record<string, unknown>>(qKey);
  if (cachedResponse) {
    const liveCost = Math.max(0.001, skill.credit_cost);
    const cacheCredits = cacheCreditCost(liveCost);
    logger.info({ requestId, skillId: id, creditsUsed: cacheCredits }, 'Skill cache hit');
    if (!keyInfo.isEnvKey) {
      const ok = deductCredit(keyInfo.key, cacheCredits);
      if (ok) trackDelegatedSpend(keyInfo, cacheCredits);
      if (!ok) {
        return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
    }
    incrementSkillUses(activeSkillId);
    return c.json({ ...cachedResponse, requestId, metadata: { ...(cachedResponse.metadata as Record<string, unknown>), cacheHit: true, creditsUsed: cacheCredits } });
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
        return c.json({ requestId, error: 'Proxy upstream error', code: 'PROXY_ERROR', status: proxyRes.status, data: proxyData }, 502);
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

      const creditsToDeduct = await applyDynamicPricing(skill, keyInfo.key);
      if (!keyInfo.isEnvKey) {
        const revenueSharePct = skill.revenue_share_pct;
        const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;
        const ok = getDb().transaction(() => {
          const deducted = deductCredit(keyInfo.key, creditsToDeduct);
          if (!deducted) return false;
          if (shouldPayAuthor) {
            const authorShare = round6(creditsToDeduct * revenueSharePct);
            const feeCredits = round6(creditsToDeduct - authorShare);
            if (authorShare > 0) {
              topUpCredits(skill.author_key, authorShare);
              // Credit platform fee to treasury (was missing — fees were being destroyed)
              if (feeCredits > 0) {
                topUpCredits('clawhub-treasury', feeCredits);
              }
              const timestamp = new Date().toISOString();
              recordTransaction({
                fromAgent: keyInfo.key, toAgent: skill.author_key,
                amountCredits: creditsToDeduct, type: 'SKILL_SALE',
                skillId: activeSkillId, feeCredits,
                requestHash: computeRequestHash({ skillId: activeSkillId, variables, timestamp }),
                resultHash: computeResultHash({ data: proxyData, costCredits: creditsToDeduct }),
              });
            }
          }
          return true;
        })();
        if (ok) trackDelegatedSpend(keyInfo, creditsToDeduct);
        if (!ok) {
          return c.json({ requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS',
            creditsRequired: creditsToDeduct, creditsAvailable: keyInfo.credits }, 402);
        }
      }
      incrementSkillUses(activeSkillId);
      recordSkillMetric({ skillId: activeSkillId, version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
        latencyMs: Date.now() - start, success: true, costCredits: creditsToDeduct });

      return c.json({ requestId, status: proxyRes.status, data: proxyData,
        skill: { id: skill.id, name: skill.name }, creditsUsed: creditsToDeduct,
        provider: buildProviderInfo(skill) });
    } catch (err) {
      logger.error({ requestId, skillId: id, err }, 'API proxy skill failed');
      return c.json({ requestId, error: 'Proxy request failed', code: 'PROXY_ERROR', details: env.NODE_ENV === 'production' ? undefined : String(err) }, 502);
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
    const baseSkillCredits = Math.max(actualCost, skill.credit_cost);
    // Apply dynamic pricing (surge/volume/off-peak) to skill credits
    const skillCredits = await applyDynamicPricing({ ...skill, credit_cost: baseSkillCredits }, keyInfo.key);

    // x402 surcharge: pass upstream API cost through to caller for third-party skills.
    // Official skills bake x402 cost into their credit_cost — no surcharge needed.
    // api_proxy/data skills don't use x402 — surcharge is always 0 for them.
    const surcharge = skill.author_key !== 'clawhub-official' ? x402SurchargeCredits(apiCosts) : 0;
    const creditsToDeduct = skillCredits + surcharge;

    if (!keyInfo.isEnvKey) {
      // Atomically deduct credits and pay revenue share in a single transaction
      const revenueSharePct = skill.revenue_share_pct;
      const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;

      const txResult = getDb().transaction(() => {
        const deducted = deductCredit(keyInfo.key, creditsToDeduct);
        if (!deducted) return false;
        if (shouldPayAuthor) {
          // Revenue split applies to skillCredits only — surcharge goes 100% to platform
          const authorShare = round6(skillCredits * revenueSharePct);
          const feeCredits = round6(skillCredits - authorShare);
          if (authorShare > 0) {
            topUpCredits(skill.author_key, authorShare);
            if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
            const timestamp = new Date().toISOString();
            recordTransaction({
              fromAgent: keyInfo.key,
              toAgent: skill.author_key,
              amountCredits: skillCredits,
              type: 'SKILL_SALE',
              skillId: activeSkillId,
              feeCredits,
              requestHash: computeRequestHash({ skillId: activeSkillId, variables, timestamp }),
              resultHash: computeResultHash({ answer: formatted.answer, costCredits: creditsToDeduct }),
              ...(surcharge > 0 && { metadata: { x402Surcharge: surcharge } }),
            });
          }
        }
        // Credit x402 surcharge to treasury — covers real USDC spent by hot wallet
        if (surcharge > 0) topUpCredits('clawhub-treasury', surcharge);
        return true;
      })();
      if (txResult) trackDelegatedSpend(keyInfo, creditsToDeduct);

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
        data: { invokerKey: maskApiKey(keyInfo.key), creditsCharged: creditsToDeduct },
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
        ...(surcharge > 0 && { skillCost: skillCredits, x402Surcharge: surcharge }),
      },
      metadata: {
        stepsExecuted: execution.steps.length,
        cacheHits,
        totalDurationMs,
        llmProvider: env.LLM_PROVIDER,
        simulationMode: isSimulationMode,
        ...(skill.skill_class !== 'standard' && { skillClass: skill.skill_class }),
      },
      provider: buildProviderInfo(skill),
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
  if (!skill || !skill.public) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

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
  logger.info({ authorKey: maskApiKey(keyInfo.key), skillsVerified: verified }, 'Publisher verified');

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
  if (!skill) return c.json({ requestId, error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  // Owner-only: only the author can dry-run their skill
  if (skill.author_key !== keyInfo.key) {
    return c.json({ requestId, error: 'Only the skill author can run a test', code: 'FORBIDDEN' }, 403);
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
  if (!bodyParsed.success) return c.json({ requestId, error: 'Invalid variables', code: 'VALIDATION_ERROR' }, 400);
  const variables = bodyParsed.data.variables ?? {};

  let query: string;
  try {
    query = renderTemplate(skill.prompt_template, variables);
  } catch (err) {
    return c.json({ requestId, error: (err instanceof Error ? err.message : String(err)), code: 'MISSING_VARIABLES' }, 400);
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
      error: env.NODE_ENV === 'production' ? 'Test run failed' : (err instanceof Error ? err.message : String(err)),
      code: 'EXECUTION_ERROR',
    }, 500);
  }
});

// ─── GET /v1/skills/:id/similar — vector similarity search ──────────────────

skillsRouter.get('/:id/similar', async (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  if (!isEmbeddingModelReady()) {
    return c.json({ error: 'Embedding model not loaded', code: 'MODEL_UNAVAILABLE' }, 503);
  }

  const limitRaw = parseInt(c.req.query('limit') ?? '5', 10);
  const limit = Math.max(1, Math.min(20, limitRaw));

  try {
    const text = `${skill.name}: ${skill.description}`;
    const vec = await embed(text);
    // Request limit+1 so we can exclude the skill itself
    const results = searchDiscovery(vec, limit + 1);
    const filtered = results
      .filter(r => r.id !== `skill:${id}`)
      .slice(0, limit);

    return c.json({
      skillId: id,
      similar: filtered.map(r => ({
        id: r.id.replace('skill:', ''),
        name: r.skillName,
        description: r.skillDesc,
        similarity: +(1 - r.distance).toFixed(4),
      })),
    });
  } catch (err) {
    logger.warn({ skillId: id, err }, 'Similar skills search failed');
    return c.json({ error: 'Similarity search failed', code: 'SEARCH_FAILED' }, 500);
  }
});

// ─── GET /v1/skills/:id/mcp — MCP tool manifest for a single skill ──────────

skillsRouter.get('/:id/mcp', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  const inputSchema = safeJsonParse<Record<string, unknown> | null>(skill.input_schema_json, null);
  const outputSchema = safeJsonParse<Record<string, unknown> | null>(skill.output_schema_json, null);
  const tags = safeJsonParse<string[]>(skill.tags_json, []);

  // Build MCP-compatible tool definition (Model Context Protocol spec)
  const mcpTool: Record<string, unknown> = {
    name: `clawnet_${skill.name.replace(/-/g, '_')}`,
    description: skill.description,
    inputSchema: inputSchema ?? {
      type: 'object',
      properties: Object.fromEntries(
        extractVariables(skill.prompt_template).map(v => [v, { type: 'string', description: `Input: ${v}` }])
      ),
      required: extractVariables(skill.prompt_template),
    },
  };

  return c.json({
    schema_version: '2024-11-05',
    server_info: {
      name: 'clawnet',
      version: '1.0.0',
    },
    tool: mcpTool,
    metadata: {
      skillId: id,
      skillType: skill.skill_type,
      creditCost: skill.credit_cost,
      category: skill.category,
      tags,
      ...(outputSchema && { outputSchema }),
      ...(skill.skill_type === 'data' && {
        queryEndpoint: `GET /v1/skills/${id}/query`,
        updateFrequency: skill.update_frequency,
        sampleOutput: safeJsonParse(skill.sample_output_json, null),
      }),
      ...(skill.skill_type !== 'data' && {
        invokeEndpoint: `POST /v1/skills/${id}/invoke`,
      }),
    },
  });
});

// ─── GET /v1/skills/:id/openapi — OpenAPI 3.1 spec for a single skill ──────

skillsRouter.get('/:id/openapi', (c) => {
  const { id } = c.req.param();
  const skill = getSkill(id);
  if (!skill || !skill.public) return c.json({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' }, 404);

  const inputSchema = safeJsonParse<Record<string, unknown> | null>(skill.input_schema_json, null);
  const outputSchema = safeJsonParse<Record<string, unknown> | null>(skill.output_schema_json, null);
  const tags = safeJsonParse<string[]>(skill.tags_json, []);
  const isData = skill.skill_type === 'data';

  const path = isData ? `/v1/skills/${id}/query` : `/v1/skills/${id}/invoke`;
  const method = isData ? 'get' : 'post';

  const requestBody = !isData ? {
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: inputSchema ?? {
            type: 'object',
            properties: {
              variables: {
                type: 'object',
                properties: Object.fromEntries(
                  extractVariables(skill.prompt_template).map(v => [v, { type: 'string' }])
                ),
              },
            },
          },
        },
      },
    },
  } : {};

  const spec = {
    openapi: '3.1.0',
    info: {
      title: `ClawNet Skill: ${skill.display_name ?? skill.name}`,
      description: skill.description,
      version: skill.version ?? '1.0.0',
    },
    servers: [{ url: 'https://api.claw-net.org' }],
    paths: {
      [path]: {
        [method]: {
          operationId: `${isData ? 'query' : 'invoke'}_${skill.name.replace(/-/g, '_')}`,
          summary: skill.description,
          tags,
          security: [{ ApiKeyAuth: [] }],
          ...requestBody,
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: outputSchema ?? {
                    type: 'object',
                    ...(isData && skill.sample_output_json && {
                      example: safeJsonParse(skill.sample_output_json, null),
                    }),
                  },
                },
              },
            },
            '402': { description: 'Insufficient credits' },
            '404': { description: 'Skill not found' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
    },
  };

  return c.json(spec);
});

// ─── POST /v1/skills/batch-query — parallel multi-skill queries ─────────────

skillsRouter.post('/batch-query', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let body: { queries: { skillId: string; params?: Record<string, string> }[] };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON', code: 'INVALID_BODY' }, 400); }

  if (!Array.isArray(body.queries) || body.queries.length === 0) {
    return c.json({ error: 'queries array required', code: 'MISSING_QUERIES' }, 400);
  }
  if (body.queries.length > 10) {
    return c.json({ error: 'Maximum 10 queries per batch', code: 'BATCH_TOO_LARGE' }, 400);
  }

  // Validate all skills exist and are data skills before executing
  const skills = body.queries.map(q => {
    const skill = getSkill(q.skillId);
    if (!skill || !skill.public) return { error: `Skill ${q.skillId} not found`, skillId: q.skillId };
    if (skill.skill_type !== 'data') return { error: `Skill ${q.skillId} is not a data skill`, skillId: q.skillId };
    return { skill, params: q.params ?? {} };
  });

  const errors = skills.filter(s => 'error' in s);
  if (errors.length > 0) {
    return c.json({ error: 'Some skills invalid', code: 'INVALID_SKILLS', details: errors }, 400);
  }

  // Execute all queries in parallel — redirect to internal /v1/skills/:id/query logic
  const results = await Promise.allSettled(
    skills.map(async (entry) => {
      if ('error' in entry) return { error: entry.error };
      const { skill, params } = entry;
      const paramStr = new URLSearchParams(params).toString();
      const url = `${c.req.url.split('/v1/skills')[0]}/v1/skills/${skill.id}/query${paramStr ? '?' + paramStr : ''}`;
      try {
        const res = await fetch(url, {
          headers: { 'X-API-Key': keyInfo.key },
          signal: AbortSignal.timeout(15_000),
        });
        return { skillId: skill.id, skillName: skill.name, status: res.status, data: await res.json() };
      } catch (err) {
        return { skillId: skill.id, skillName: skill.name, status: 500, error: (err instanceof Error ? err.message : String(err)) };
      }
    })
  );

  return c.json({
    results: results.map((r, i) => {
      const q = body.queries[i];
      if (r.status === 'fulfilled') return { skillId: q.skillId, ...r.value };
      return { skillId: q.skillId, error: r.reason?.message ?? 'Query failed' };
    }),
    totalQueries: body.queries.length,
  });
});
