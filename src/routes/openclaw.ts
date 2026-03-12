/**
 * OpenClaw Gateway — POST /v1/openclaw/invoke
 *
 * Universal single-endpoint gateway for external AI agents. Route any action
 * through ClawNet's full registry — orchestration, skills, discovery, swarms —
 * using just an API key. All responses share a standardised envelope so agents
 * can integrate once and gain access to everything.
 *
 * Endpoints
 *   POST /v1/openclaw/invoke   — execute an action
 *   GET  /v1/openclaw/catalog  — full capability catalog (skills + registry)
 *   GET  /v1/openclaw/status   — caller's balance, usage, reputation, rate tier
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { renderTemplate } from '../utils/template';
import { checkApiKey } from '../middleware/auth';
import {
  getSkillWithAb, getSkill, listPublicSkills, countPublicSkills,
  incrementSkillUses, deductCredit, topUpCredits, getDb,
  insertOrchestration, recordSkillMetric, recordReputation,
  createSwarmTask, getAgentUsageStats, getReputationScore,
  writeAuditLog, safeJsonParse,
} from '../db/index';
import { creditsForExecution, creditsToUsd, x402SurchargeCredits, round6, cacheCreditCost } from '../core/credits';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { runDiscovery } from '../core/discovery-engine';
import { isEmbeddingModelReady } from '../core/embeddings';
import { cacheGet, cacheSet, cacheIncr } from '../cache/index';
import { logUsage } from '../utils/usage';
import { logger } from '../utils/logger';
import { env, isSimulationMode, SWARM_BASE_FEE, ORCHESTRATION_FEE, rateTier } from '../config/index';
import { apiRegistry, findEndpoint } from '../config/api-registry';
import { runSwarm } from './swarm';

export const openclawRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────


function queryCacheKey(query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  return 'qcache:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function skillCacheKey(skillId: string, variables: Record<string, string>): string {
  const normalized = JSON.stringify({ skillId, variables: Object.fromEntries(Object.entries(variables).sort()) });
  return 'skill:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}


/** Standard response envelope for all openclaw actions. */
function envelope(requestId: string, action: string, result: unknown, creditsUsed: number, creditsRemaining: number, meta: Record<string, unknown>) {
  return { ok: true, requestId, action, result, credits: { used: creditsUsed, remaining: creditsRemaining }, meta };
}

// ─── Request schema ────────────────────────────────────────────────────────────

const InvokeSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('query'),
    query: z.string().min(1).max(2000).trim(),
  }),
  z.object({
    action: z.literal('skill'),
    skillId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid skill ID'),
    variables: z.record(z.string().max(500)).optional(),
  }),
  z.object({
    action: z.literal('discover'),
    query: z.string().min(1).max(500).trim(),
    limit: z.number().int().min(1).max(50).optional(),
    filters: z.object({
      provider: z.string().optional(),
      source: z.array(z.string()).optional(),
    }).optional(),
    weights: z.object({
      semantic: z.number().min(0).max(1).optional(),
      p2p: z.number().min(0).max(1).optional(),
      onchain: z.number().min(0).max(1).optional(),
    }).optional(),
  }),
  z.object({
    action: z.literal('swarm'),
    task: z.string().min(1).max(1000).trim(),
    skills: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).max(10).optional(),
    maxSubTasks: z.number().int().min(1).max(5).default(4),
  }),
]);

// ─── POST /v1/openclaw/invoke — universal action gateway ──────────────────────

openclawRouter.post('/invoke', checkApiKey, async (c) => {
  const requestId = nanoid(12);
  const start = Date.now();
  const keyInfo = c.get('apiKeyInfo');

  let raw: unknown;
  try { raw = await c.req.json(); } catch {
    return c.json({ ok: false, requestId, error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const parsed = InvokeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ ok: false, requestId, error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }

  const body = parsed.data;

  // Per-key rate limit — same tiered system as orchestrate/skills
  if (!keyInfo.isEnvKey) {
    const tier = rateTier(keyInfo.amountPaid);
    const rlCount = await cacheIncr(`rl:orch:${keyInfo.key}`, 60);
    if (rlCount > tier.perMinute) {
      return c.json({
        ok: false, requestId,
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        limit: tier.perMinute,
        tier: tier.label,
        hint: 'Top up to unlock higher rate limits at claw-net.org',
      }, 429);
    }
  }

  // ── action: query ────────────────────────────────────────────────────────────

  if (body.action === 'query') {
    const { query } = body;

    if (!keyInfo.isEnvKey && keyInfo.credits < 1) {
      return c.json({ ok: false, requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsAvailable: keyInfo.credits }, 402);
    }

    const qKey = queryCacheKey(query);
    const cached = await cacheGet<Record<string, unknown>>(qKey);
    if (cached) {
      // Proportional cache pricing — 10% of original live cost, min 0.1 credits
      const originalCredits = (cached as Record<string, unknown>).creditsUsed as number | undefined;
      const cacheCredits = cacheCreditCost(originalCredits ?? 2);
      if (!keyInfo.isEnvKey) {
        if (keyInfo.credits < cacheCredits) {
          return c.json({ ok: false, requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsAvailable: keyInfo.credits }, 402);
        }
        deductCredit(keyInfo.key, cacheCredits);
      }
      return c.json(envelope(requestId, 'query', cached, cacheCredits, keyInfo.credits - cacheCredits, {
        durationMs: Date.now() - start, cacheHit: true, route: 'orchestrate',
      }));
    }

    logger.info({ requestId, query: query.slice(0, 100), source: 'openclaw' }, 'OpenClaw query');

    try {
      const intent = await parseIntent(query);
      if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);
      const execution = await executePlan(intent, undefined, keyInfo.key);
      const formatted = await formatResponse(query, intent, execution);

      const apiCosts = execution.totalCost;
      const cacheHits = execution.steps.filter((s) => s.cached).length;
      const stepCredits = creditsForExecution(execution.steps, findEndpoint);
      const creditsUsed = stepCredits + ORCHESTRATION_FEE;
      const totalDurationMs = Date.now() - start;

      if (!keyInfo.isEnvKey) {
        const deducted = deductCredit(keyInfo.key, creditsUsed);
        if (!deducted) {
          return c.json({ ok: false, requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: creditsUsed, creditsAvailable: keyInfo.credits }, 402);
        }
      }

      const usageEntry = {
        requestId, timestamp: new Date().toISOString(), query,
        plannedSteps: intent.steps.length, executedSteps: execution.steps.length,
        successfulSteps: execution.steps.filter((s) => s.success).length,
        cacheHits, totalDurationMs, apiCost: apiCosts, markup: 0, total: apiCosts,
        success: true, llmProvider: env.LLM_PROVIDER,
      };
      logUsage(usageEntry);
      insertOrchestration({ id: requestId, ...usageEntry, apiKey: keyInfo.key });

      const result = {
        answer: formatted.answer,
        ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
        ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
        suggestedActions: formatted.suggestedActions,
        costBreakdown: { costUsd: Math.round(apiCosts * 10000) / 10000, creditsUsed },
        route: {
          summary: intent.summary,
          steps: execution.steps.map((s, i) => ({
            endpoint: intent.steps[i]?.endpointId ?? s.endpointId,
            success: s.success, cached: s.cached, durationMs: s.durationMs,
          })),
        },
      };

      await cacheSet(qKey, result);

      writeAuditLog({ entityType: 'openclaw', entityId: requestId, action: 'QUERY', actorId: keyInfo.key,
        data: { creditsUsed, cacheHits, steps: execution.steps.length } });

      return c.json(envelope(requestId, 'query', result, creditsUsed, keyInfo.credits - creditsUsed, {
        durationMs: totalDurationMs, cacheHits, simulationMode: isSimulationMode, route: 'orchestrate',
      }));

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ requestId, error: error.message, source: 'openclaw' }, 'OpenClaw query failed');
      return c.json({
        ok: false, requestId,
        error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
        code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
      }, 500);
    }
  }

  // ── action: skill ────────────────────────────────────────────────────────────

  if (body.action === 'skill') {
    const { skillId, variables = {} } = body;

    const baseSkill = getSkillWithAb(skillId);
    if (!baseSkill) return c.json({ ok: false, requestId, error: 'Skill not found', code: 'NOT_FOUND' }, 404);

    if (!baseSkill.public && baseSkill.author_key !== keyInfo.key) {
      return c.json({ ok: false, requestId, error: 'Skill not found', code: 'NOT_FOUND' }, 404);
    }

    const useChallenger = baseSkill.ab_challenger && Math.random() < 0.30;
    const skill = useChallenger ? (getSkill(baseSkill.ab_challenger!) ?? baseSkill) : baseSkill;
    const activeSkillId = useChallenger ? (baseSkill.ab_challenger ?? skillId) : skillId;

    if (!keyInfo.isEnvKey && keyInfo.credits < Math.max(0.001, skill.credit_cost)) {
      return c.json({
        ok: false, requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS',
        creditsRequired: Math.max(0.001, skill.credit_cost), creditsAvailable: keyInfo.credits,
      }, 402);
    }

    const qKey = skillCacheKey(activeSkillId, variables);
    const cached = await cacheGet<Record<string, unknown>>(qKey);
    if (cached) {
      const creditsUsed = (cached.costBreakdown as Record<string, unknown> | undefined)?.creditsUsed as number ?? 0;
      // Deduct credits even on cache hit — real API calls were made when result was cached
      if (!keyInfo.isEnvKey && creditsUsed > 0) {
        const deducted = deductCredit(keyInfo.key, creditsUsed);
        if (!deducted) {
          return c.json({ ok: false, requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS',
            creditsRequired: creditsUsed, creditsAvailable: keyInfo.credits }, 402);
        }
      }
      const remaining = keyInfo.isEnvKey ? keyInfo.credits : keyInfo.credits - creditsUsed;
      return c.json(envelope(requestId, 'skill', { ...cached, cacheHit: true }, creditsUsed, remaining, {
        durationMs: Date.now() - start, cacheHit: true, route: `skill:${skillId}`,
      }));
    }

    let query: string;
    try {
      query = renderTemplate(skill.prompt_template, variables);
    } catch (err) {
      return c.json({ ok: false, requestId, error: (err as Error).message, code: 'MISSING_VARIABLES' }, 400);
    }

    logger.info({ requestId, skillId, source: 'openclaw' }, 'OpenClaw skill invoke');

    try {
      const intent = await parseIntent(query);
      if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);
      const execution = await executePlan(intent, undefined, keyInfo.key);
      const formatted = await formatResponse(query, intent, execution);

      const apiCosts = execution.totalCost;
      const cacheHits = execution.steps.filter((s) => s.cached).length;
      const totalDurationMs = Date.now() - start;

      const actualCost = creditsForExecution(execution.steps, findEndpoint);
      const skillCredits = Math.max(actualCost, skill.credit_cost);
      const surcharge = skill.author_key !== 'clawhub-official' ? x402SurchargeCredits(apiCosts) : 0;
      const creditsUsed = skillCredits + surcharge;

      if (!keyInfo.isEnvKey) {
        const revenueSharePct = skill.revenue_share_pct;
        const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;

        const txOk = getDb().transaction(() => {
          const deducted = deductCredit(keyInfo.key, creditsUsed);
          if (!deducted) return false;
          if (shouldPayAuthor) {
            // Revenue split applies to skillCredits only — surcharge goes 100% to platform
            const authorShare = round6(skillCredits * revenueSharePct);
            const feeCredits = round6(skillCredits - authorShare);
            if (authorShare > 0) topUpCredits(skill.author_key, authorShare);
            if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
          }
          // Credit x402 surcharge to treasury — covers real USDC spent by operations wallet
          if (surcharge > 0) topUpCredits('clawhub-treasury', surcharge);
          return true;
        })();

        if (!txOk) {
          return c.json({ ok: false, requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', creditsRequired: creditsUsed, creditsAvailable: keyInfo.credits }, 402);
        }
      }

      incrementSkillUses(activeSkillId);

      recordSkillMetric({
        skillId: activeSkillId,
        version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
        latencyMs: totalDurationMs, success: true, costCredits: creditsUsed,
      });

      if (skill.author_key && skill.author_key !== keyInfo.key) {
        recordReputation({
          agentId: skill.author_key, skillId,
          eventType: 'SKILL_INVOKED', scoreDelta: 0.1,
          data: { via: 'openclaw', invokerKey: keyInfo.key.slice(0, 8), creditsCharged: creditsUsed },
        });
      }

      const usageEntry = {
        requestId, timestamp: new Date().toISOString(), query,
        plannedSteps: intent.steps.length, executedSteps: execution.steps.length,
        successfulSteps: execution.steps.filter((s) => s.success).length,
        cacheHits, totalDurationMs, apiCost: apiCosts, markup: 0, total: apiCosts,
        success: true, llmProvider: env.LLM_PROVIDER,
      };
      logUsage(usageEntry);
      insertOrchestration({ id: requestId, ...usageEntry, apiKey: keyInfo.key, skillId: skill.id });

      const result = {
        answer: formatted.answer,
        ...(formatted.opportunityScore !== undefined && { opportunityScore: formatted.opportunityScore }),
        ...(formatted.riskScore !== undefined && { riskScore: formatted.riskScore }),
        suggestedActions: formatted.suggestedActions,
        skill: { id: skill.id, name: skill.name },
        costBreakdown: { costUsd: Math.round(apiCosts * 10000) / 10000, creditsUsed, ...(surcharge > 0 && { skillCost: skillCredits, x402Surcharge: surcharge }) },
      };

      await cacheSet(qKey, result);

      writeAuditLog({ entityType: 'openclaw', entityId: requestId, action: 'SKILL_INVOKE', actorId: keyInfo.key,
        data: { skillId, creditsUsed, cacheHits } });

      return c.json(envelope(requestId, 'skill', result, creditsUsed, keyInfo.credits - creditsUsed, {
        durationMs: totalDurationMs, cacheHits, simulationMode: isSimulationMode, route: `skill:${skillId}`,
      }));

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ requestId, skillId, error: error.message, source: 'openclaw' }, 'OpenClaw skill failed');

      recordSkillMetric({
        skillId: activeSkillId,
        version: (skill as typeof skill & { version?: string }).version ?? '1.0.0',
        latencyMs: Date.now() - start, success: false, costCredits: 0,
      });

      if (skill.author_key && skill.author_key !== keyInfo.key) {
        recordReputation({ agentId: skill.author_key, skillId, eventType: 'SKILL_FAILED', scoreDelta: -0.05 });
      }

      return c.json({
        ok: false, requestId,
        error: env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
        code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
      }, 500);
    }
  }

  // ── action: discover ─────────────────────────────────────────────────────────

  if (body.action === 'discover') {
    if (!isEmbeddingModelReady() && !body.filters?.source?.includes('p2p') && !body.filters?.source?.includes('onchain')) {
      // Graceful: still run p2p+onchain layers but warn if semantic not ready
    }

    logger.info({ requestId, query: body.query.slice(0, 80), source: 'openclaw' }, 'OpenClaw discover');

    try {
      const { results, layerStats } = await runDiscovery({
        query: body.query,
        limit: body.limit,
        filters: body.filters,
        weights: body.weights,
      });

      writeAuditLog({ entityType: 'openclaw', entityId: requestId, action: 'DISCOVER', actorId: keyInfo.key,
        data: { query: body.query, resultsReturned: results.length } });

      return c.json(envelope(requestId, 'discover', {
        query: body.query, results, total: results.length, layers: layerStats,
      }, 0, keyInfo.credits, {
        durationMs: Date.now() - start, route: 'discovery-engine',
        embeddingReady: isEmbeddingModelReady(),
      }));

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ requestId, error: error.message, source: 'openclaw' }, 'OpenClaw discover failed');
      return c.json({ ok: false, requestId, error: 'Discovery failed', code: 'INTERNAL_ERROR' }, 500);
    }
  }

  // ── action: swarm ────────────────────────────────────────────────────────────

  if (body.action === 'swarm') {
    if (!keyInfo.isEnvKey) {
      if (keyInfo.credits < SWARM_BASE_FEE) {
        return c.json({
          ok: false, requestId,
          error: `Insufficient credits for swarm (requires ${SWARM_BASE_FEE})`,
          code: 'INSUFFICIENT_CREDITS',
          creditsRequired: SWARM_BASE_FEE, creditsAvailable: keyInfo.credits,
        }, 402);
      }
      const deducted = deductCredit(keyInfo.key, SWARM_BASE_FEE);
      if (!deducted) {
        return c.json({ ok: false, requestId, error: 'Credit deduction failed', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
    }

    const swarmId = createSwarmTask(keyInfo.key, body.task);

    runSwarm(swarmId, keyInfo.key, { task: body.task, skills: body.skills, maxSubTasks: body.maxSubTasks }, keyInfo.isEnvKey)
      .catch((err) => logger.error({ err, swarmId, source: 'openclaw' }, 'OpenClaw swarm failed'));

    writeAuditLog({ entityType: 'openclaw', entityId: swarmId, action: 'SWARM_CREATED', actorId: keyInfo.key,
      data: { task: body.task.slice(0, 100), maxSubTasks: body.maxSubTasks } });

    return c.json(envelope(requestId, 'swarm', {
      swarmId, status: 'PENDING',
      message: 'Swarm task started. Poll the status endpoint for results.',
      pollUrl: `/v1/swarm/${swarmId}`,
      baseFeeCharged: SWARM_BASE_FEE,
    }, SWARM_BASE_FEE, keyInfo.credits - SWARM_BASE_FEE, {
      durationMs: Date.now() - start, route: 'swarm',
    }));
  }

  // Unreachable — discriminated union guarantees exhaustion
  return c.json({ ok: false, requestId, error: 'Unknown action', code: 'UNKNOWN_ACTION' }, 400);
});

// ─── GET /v1/openclaw/catalog — full capability listing ───────────────────────

openclawRouter.get('/catalog', checkApiKey, (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const skills = listPublicSkills(offset, limit).map((s) => {
    const vars = [...new Set((s.prompt_template.match(/\{\{(\w+)\}\}/g) ?? []).map((m: string) => m.slice(2, -2)))];
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      creditCost: s.credit_cost,
      variables: vars,
      uses: s.uses,
      tags: safeJsonParse<string[]>(s.tags_json, []),
      inputSchema: safeJsonParse<Record<string, unknown>>(s.input_schema_json, {}),
    };
  });

  const endpointsByCategory = apiRegistry.reduce((acc, ep) => {
    if (!acc[ep.category]) acc[ep.category] = [];
    acc[ep.category].push({ id: ep.id, name: ep.name, description: ep.description, costPerCall: ep.costPerCall });
    return acc;
  }, {} as Record<string, { id: string; name: string; description: string; costPerCall: number }[]>);

  return c.json({
    version: '1.0',
    actions: [
      {
        action: 'query',
        description: 'Natural-language orchestration across 75+ data endpoints. ClawNet plans and executes automatically.',
        params: { query: 'string (max 2000 chars)' },
        creditEstimate: '5–100 credits depending on query complexity',
      },
      {
        action: 'skill',
        description: 'Invoke a specific registered skill by ID with variable substitution.',
        params: { skillId: 'string', variables: 'Record<string, string> (optional)' },
        creditEstimate: 'Skill credit_cost or actual API cost, whichever is higher',
      },
      {
        action: 'discover',
        description: 'Trinity-layer discovery: semantic embedding + P2P mesh + on-chain registry.',
        params: {
          query: 'string (max 500 chars)',
          limit: 'number 1–50 (optional)',
          filters: '{ provider?, source? } (optional)',
          weights: '{ semantic?, p2p?, onchain? } (optional)',
        },
        creditEstimate: '0 credits (free search)',
      },
      {
        action: 'swarm',
        description: 'Decompose a complex task into parallel sub-tasks, execute via skills + LLM, synthesise results.',
        params: {
          task: 'string (max 1000 chars)',
          skills: 'string[] — skill IDs to prefer (optional)',
          maxSubTasks: 'number 1–5 (optional, default 4)',
        },
        creditEstimate: '20 credits base fee + per-skill charges',
      },
    ],
    skills: { page, total: countPublicSkills(), data: skills },
    endpoints: { total: apiRegistry.length, byCategory: endpointsByCategory },
    pricing: {
      creditFormula: 'value-based per-endpoint tiers + orchestration fee (2 credits)',
      creditsPerDollar: 1000,
      packages: [
        { usd: 20,   credits: 21000  },
        { usd: 50,   credits: 59000  },
        { usd: 100,  credits: 123000 },
        { usd: 500,  credits: 660000 },
        { usd: 1000, credits: 1430000 },
      ],
    },
    authentication: {
      header: 'X-API-Key',
      format: 'cn-{48 hex chars}',
      obtain: 'https://claw-net.org',
    },
  });
});

// ─── GET /v1/openclaw/status — agent status ───────────────────────────────────

openclawRouter.get('/status', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  const tier = rateTier(keyInfo.amountPaid);
  // Use cacheGet (not cacheIncr) to read the rate limit counter without side effects
  const rlCount = (await cacheGet<number>(`rl:orch:${keyInfo.key}`)) ?? 0;
  const usage = getAgentUsageStats(keyInfo.key);
  const reputation = getReputationScore(keyInfo.key);

  return c.json({
    agentKey: keyInfo.key.slice(0, 6) + '...' + keyInfo.key.slice(-4),
    credits: {
      balance: keyInfo.credits,
      used: keyInfo.creditsUsed ?? 0,
      tier: tier.label,
      amountPaid: keyInfo.amountPaid,
    },
    reputation: Math.round(reputation * 100) / 100,
    usage: {
      totalOrchestrations: usage.totalOrchestrations,
      totalSkillInvocations: usage.totalSkillInvocations,
      lastActive: usage.lastActive,
    },
    rateLimits: {
      perMinute: tier.perMinute,
      remaining: Math.max(0, tier.perMinute - rlCount),
      tier: tier.label,
    },
    capabilities: ['query', 'skill', 'discover', 'swarm'],
    docs: '/v1/openclaw/catalog',
  });
});
