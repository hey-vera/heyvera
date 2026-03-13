import { Hono } from 'hono';
import { z } from 'zod';
import { trackDelegatedSpend } from '../utils/billing';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { renderTemplate } from '../utils/template';
import { checkApiKey } from '../middleware/auth';
import {
  getSkill, getSkillWithAb, deductCredit, topUpCredits, incrementSkillUses,
  recordSkillMetric, recordReputation, recordTransaction, getDb,
  createTask, getTask, getTaskByIdempotencyKey, listTasks, countTasks,
  updateTaskRunning, updateTaskCompleted, updateTaskFailed, updateTaskCancelled,
  createTaskRating, getTaskRating, updateWebhookStatus,
  type Task,
} from '../db/index';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { creditsForExecution, x402SurchargeCredits, round6 } from '../core/credits';
import { findEndpoint } from '../config/api-registry';
import { scanProxyResponse } from '../core/skill-scanner';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet } from '../cache/index';

export const tasksRouter = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}


function skillCacheKey(skillId: string, variables: Record<string, string>): string {
  const normalized = JSON.stringify({ skillId, variables: Object.fromEntries(Object.entries(variables).sort()) });
  return 'task:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/** Compute HMAC-SHA256 signature for outbound webhook payload verification. */
function signWebhookPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/** Webhook delivery with exponential backoff retry (3 attempts: 0s, 1s, 3s) */
function fireWebhook(webhookUrl: string, taskId: string, payload: unknown, webhookSecret?: string | null): void {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 1000, 3000];

  async function attempt(n: number): Promise<void> {
    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-ClawNet-Task-ID': taskId,
        'X-ClawNet-Attempt': String(n + 1),
        'X-ClawNet-Timestamp': String(Math.floor(Date.now() / 1000)),
      };
      // HMAC signature if the requester has a webhook_secret configured
      if (webhookSecret) {
        headers['X-ClawNet-Signature'] = signWebhookPayload(body, webhookSecret);
      }
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        updateWebhookStatus(taskId, n + 1, 'delivered');
        logger.debug({ taskId, attempt: n + 1 }, 'Webhook delivered');
        return;
      }
      // Non-2xx: retry if attempts remain
      if (n + 1 < MAX_ATTEMPTS) {
        logger.warn({ taskId, status: res.status, attempt: n + 1 }, 'Webhook non-2xx, retrying');
        await new Promise(r => setTimeout(r, BACKOFF_MS[n + 1]));
        return attempt(n + 1);
      }
      updateWebhookStatus(taskId, n + 1, `failed:${res.status}`);
      logger.error({ taskId, status: res.status }, 'Webhook delivery failed after all retries');
    } catch (err) {
      if (n + 1 < MAX_ATTEMPTS) {
        logger.warn({ taskId, err, attempt: n + 1 }, 'Webhook error, retrying');
        await new Promise(r => setTimeout(r, BACKOFF_MS[n + 1]));
        return attempt(n + 1);
      }
      updateWebhookStatus(taskId, n + 1, 'failed:error');
      logger.error({ taskId, err }, 'Webhook delivery failed after all retries');
    }
  }

  void attempt(0);
}

// ─── POST /v1/tasks — submit a task ───────────────────────────────────────────

const SubmitTaskSchema = z.object({
  skillId: z.string().min(1).max(64),
  variables: z.record(z.string().max(500)).optional().default({}),
  idempotencyKey: z.string().max(128).optional(),
  webhookUrl: z.string().url().max(512).optional(),
});

tasksRouter.post('/', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const parsed = SubmitTaskSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const { skillId, variables, idempotencyKey, webhookUrl } = parsed.data;

  // Idempotency: return existing task if key already used
  if (idempotencyKey) {
    const existing = getTaskByIdempotencyKey(idempotencyKey);
    if (existing) {
      return c.json({ taskId: existing.id, status: existing.status, idempotent: true,
        result: existing.result_json ? JSON.parse(existing.result_json) : null });
    }
  }

  // Resolve skill (with A/B routing)
  const baseSkill = getSkillWithAb(skillId);
  if (!baseSkill) return c.json({ error: 'Skill not found' }, 404);

  const useChallenger = baseSkill.ab_challenger && Math.random() < 0.30;
  const skill = useChallenger ? (getSkill(baseSkill.ab_challenger!) ?? baseSkill) : baseSkill;
  const activeSkillId = useChallenger ? (baseSkill.ab_challenger ?? skillId) : skillId;

  if (!baseSkill.public && baseSkill.author_key !== keyInfo.key) {
    return c.json({ error: 'Skill not found' }, 404);
  }

  const creditsNeeded = Math.max(0.001, skill.credit_cost);
  if (!keyInfo.isEnvKey && keyInfo.credits < creditsNeeded) {
    return c.json({
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      creditsRequired: creditsNeeded,
      creditsAvailable: keyInfo.credits,
    }, 402);
  }

  const taskId = nanoid(16);

  // Look up webhook signing secret for HMAC signatures on outbound webhooks
  const webhookSecret = webhookUrl
    ? (getDb().prepare('SELECT webhook_secret FROM api_keys WHERE key = ?').get(keyInfo.key) as { webhook_secret: string | null } | undefined)?.webhook_secret
    : null;

  createTask({
    id: taskId,
    requesterKey: keyInfo.key,
    skillId,
    inputJson: JSON.stringify(variables),
    idempotencyKey,
    webhookUrl,
  });

  // Execute synchronously (no queue), update status inline
  updateTaskRunning(taskId);
  const start = Date.now();

  try {
    // ── API proxy ─────────────────────────────────────────────────────────────
    if (skill.skill_type === 'api_proxy' && skill.proxy_url) {
      const proxyRes = await fetch(skill.proxy_url, {
        method: skill.proxy_method ?? 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: skill.proxy_method !== 'GET' ? JSON.stringify(variables) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const proxyData = await proxyRes.json().catch(async () => ({ raw: await proxyRes.text() }));

      if (!proxyRes.ok) {
        updateTaskFailed(taskId, `Proxy upstream error: HTTP ${proxyRes.status}`, Date.now() - start);
        return c.json({ taskId, status: 'FAILED', error: 'Proxy upstream error', httpStatus: proxyRes.status }, 502);
      }

      // Content safety scan — catches wallet drainers, phishing, social engineering
      const responseScan = scanProxyResponse(proxyData);
      if (!responseScan.safe) {
        logger.warn({ taskId, skillId, flags: responseScan.flags }, 'Task proxy response flagged as unsafe');
        updateTaskFailed(taskId, `Response flagged: ${responseScan.flags.join(', ')}`, Date.now() - start);
        return c.json({ taskId, status: 'FAILED', error: 'Response flagged for safety review', code: 'CONTENT_UNSAFE' }, 451);
      }

      const creditsToDeduct = Math.max(0.001, skill.credit_cost);
      if (!keyInfo.isEnvKey) {
        const ok = getDb().transaction(() => deductCredit(keyInfo.key, creditsToDeduct))();
        if (!ok) {
          updateTaskFailed(taskId, 'Insufficient credits at deduction time', Date.now() - start);
          return c.json({ taskId, status: 'FAILED', error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
        }
        trackDelegatedSpend(keyInfo, creditsToDeduct);
      }

      incrementSkillUses(activeSkillId);
      recordSkillMetric({ skillId: activeSkillId, version: skill.version ?? '1.0.0',
        latencyMs: Date.now() - start, success: true, costCredits: creditsToDeduct });

      const result = { data: proxyData, skill: { id: skill.id, name: skill.name }, creditsUsed: creditsToDeduct };
      updateTaskCompleted(taskId, JSON.stringify(result), creditsToDeduct, Date.now() - start);
      if (webhookUrl) fireWebhook(webhookUrl, taskId, { taskId, status: 'COMPLETED', result }, webhookSecret);
      return c.json({ taskId, status: 'COMPLETED', result });
    }

    // ── Prompt template ───────────────────────────────────────────────────────
    let query: string;
    try {
      query = renderTemplate(skill.prompt_template, variables as Record<string, string>);
    } catch (err) {
      updateTaskFailed(taskId, (err as Error).message, Date.now() - start);
      return c.json({ taskId, status: 'FAILED', error: (err as Error).message, code: 'MISSING_VARIABLES' }, 400);
    }

    // Skill-level cache
    const qKey = skillCacheKey(activeSkillId, variables as Record<string, string>);
    const cached = await cacheGet<Record<string, unknown>>(qKey);
    if (cached) {
      const result = { ...cached, creditsUsed: 0, cacheHit: true };
      updateTaskCompleted(taskId, JSON.stringify(result), 0, Date.now() - start);
      if (webhookUrl) fireWebhook(webhookUrl, taskId, { taskId, status: 'COMPLETED', result }, webhookSecret);
      return c.json({ taskId, status: 'COMPLETED', result });
    }

    const intent = await parseIntent(query);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    const execution = await executePlan(intent, undefined, keyInfo.key);
    const formatted = await formatResponse(query, intent, execution);

    const apiCosts = execution.totalCost;
    const actualCost = creditsForExecution(execution.steps, findEndpoint);
    const skillCredits = Math.max(actualCost, skill.credit_cost);
    const surcharge = skill.author_key !== 'clawhub-official' ? x402SurchargeCredits(apiCosts) : 0;
    const creditsToDeduct = skillCredits + surcharge;

    if (!keyInfo.isEnvKey) {
      const revenueSharePct = skill.revenue_share_pct;
      const shouldPayAuthor = skill.author_key !== keyInfo.key && revenueSharePct > 0;

      const txResult = getDb().transaction(() => {
        const deducted = deductCredit(keyInfo.key, creditsToDeduct);
        if (!deducted) return false;
        if (shouldPayAuthor) {
          const authorShare = round6(skillCredits * revenueSharePct);
          const feeCredits = round6(skillCredits - authorShare);
          if (authorShare > 0) topUpCredits(skill.author_key, authorShare);
          if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
          recordTransaction({
            fromAgent: keyInfo.key, toAgent: skill.author_key,
            amountCredits: skillCredits, type: 'SKILL_SALE',
            skillId: activeSkillId, feeCredits,
            ...(surcharge > 0 && { metadata: { x402Surcharge: surcharge } }),
          });
        }
        // Credit x402 surcharge to treasury — covers real USDC spent by operations wallet
        if (surcharge > 0) topUpCredits('clawhub-treasury', surcharge);
        return true;
      })();

      if (!txResult) {
        updateTaskFailed(taskId, 'Insufficient credits at deduction time', Date.now() - start);
        return c.json({ taskId, status: 'FAILED', error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
      }
      trackDelegatedSpend(keyInfo, creditsToDeduct);
    }

    incrementSkillUses(activeSkillId);
    recordSkillMetric({ skillId: activeSkillId, version: skill.version ?? '1.0.0',
      latencyMs: Date.now() - start, success: true, costCredits: creditsToDeduct });

    if (skill.author_key && skill.author_key !== keyInfo.key) {
      recordReputation({ agentId: skill.author_key, skillId, eventType: 'SKILL_INVOKED',
        scoreDelta: 0.1, data: { invokerKey: keyInfo.key.slice(0, 8), creditsCharged: creditsToDeduct } });
    }

    const durationMs = Date.now() - start;
    const result = {
      answer: formatted.answer,
      suggestedActions: formatted.suggestedActions,
      skill: { id: skill.id, name: skill.name },
      creditsUsed: creditsToDeduct,
      durationMs,
    };

    void cacheSet(qKey, result, 300);
    updateTaskCompleted(taskId, JSON.stringify(result), creditsToDeduct, durationMs);
    if (webhookUrl) fireWebhook(webhookUrl, taskId, { taskId, status: 'COMPLETED', result }, webhookSecret);

    return c.json({ taskId, status: 'COMPLETED', result });
  } catch (err) {
    const durationMs = Date.now() - start;
    const errMsg = (err as Error).message ?? String(err);
    updateTaskFailed(taskId, errMsg, durationMs);
    logger.error({ taskId, skillId, err }, 'Task execution failed');
    if (webhookUrl) fireWebhook(webhookUrl, taskId, { taskId, status: 'FAILED', error: errMsg }, webhookSecret);
    return c.json({ taskId, status: 'FAILED', error: 'Task execution failed', details: errMsg }, 500);
  }
});

// ─── GET /v1/tasks — list my tasks ────────────────────────────────────────────

tasksRouter.get('/', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const limitRaw = parseInt(c.req.query('limit') ?? '20', 10);
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10);
  const limit = Math.max(1, Math.min(100, isNaN(limitRaw) ? 20 : limitRaw));
  const offset = Math.max(0, isNaN(offsetRaw) ? 0 : offsetRaw);

  const tasks = listTasks(keyInfo.key, limit, offset);
  const total = countTasks(keyInfo.key);

  return c.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      skillId: t.skill_id,
      status: t.status,
      costCredits: t.cost_credits,
      durationMs: t.duration_ms,
      createdAt: t.created_at,
      completedAt: t.completed_at,
    })),
    total,
    limit,
    offset,
  });
});

// ─── GET /v1/tasks/:id — get task detail ──────────────────────────────────────

tasksRouter.get('/:id', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const task = getTask(id);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requester_key !== keyInfo.key && !keyInfo.isEnvKey) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const rating = getTaskRating(id);

  return c.json({
    id: task.id,
    skillId: task.skill_id,
    status: task.status,
    input: JSON.parse(task.input_json),
    result: task.result_json ? JSON.parse(task.result_json) : null,
    error: task.error,
    costCredits: task.cost_credits,
    durationMs: task.duration_ms,
    createdAt: task.created_at,
    startedAt: task.started_at,
    completedAt: task.completed_at,
    rating: rating ? { rating: rating.rating, comment: rating.comment } : null,
    ...(task.webhook_url && {
      webhook: {
        url: task.webhook_url,
        attempts: (task as Task & { webhook_attempts?: number }).webhook_attempts ?? 0,
        status: (task as Task & { webhook_status?: string }).webhook_status ?? null,
      },
    }),
  });
});

// ─── POST /v1/tasks/:id/cancel — cancel a pending task ────────────────────────

tasksRouter.post('/:id/cancel', checkApiKey, (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const task = getTask(id);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requester_key !== keyInfo.key) return c.json({ error: 'Task not found' }, 404);

  const cancelled = updateTaskCancelled(id);
  if (!cancelled) {
    return c.json({ error: 'Task cannot be cancelled — only PENDING tasks can be cancelled' }, 409);
  }

  return c.json({ ok: true, taskId: id, status: 'CANCELLED' });
});

// ─── POST /v1/tasks/:id/rate — rate a completed task ─────────────────────────

const RateTaskSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).trim().optional(),
});

tasksRouter.post('/:id/rate', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo');
  const { id } = c.req.param();

  const task = getTask(id);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requester_key !== keyInfo.key) return c.json({ error: 'Task not found' }, 404);
  if (task.status !== 'COMPLETED') {
    return c.json({ error: 'Only completed tasks can be rated' }, 409);
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const parsed = RateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, 400);
  }

  const result = createTaskRating({
    taskId: id,
    ratedBy: keyInfo.key,
    rating: parsed.data.rating,
    comment: parsed.data.comment,
  });

  if (!result.ok) {
    return c.json({ error: result.error ?? 'Already rated this task' }, 409);
  }

  // Reputation bump for skill author based on rating
  const skill = getSkill(task.skill_id);
  if (skill?.author_key && skill.author_key !== keyInfo.key) {
    const scoreDelta = (parsed.data.rating - 3) * 0.05; // -0.1 to +0.1
    if (scoreDelta !== 0) {
      recordReputation({
        agentId: skill.author_key,
        skillId: task.skill_id,
        eventType: 'TASK_RATED',
        scoreDelta,
        data: { rating: parsed.data.rating, taskId: id },
      });
    }
  }

  return c.json({ ok: true, taskId: id, rating: parsed.data.rating });
});
