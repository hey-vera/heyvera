/**
 * A2A (Agent-to-Agent) Protocol — Google's standard for agent task delegation
 *
 * Implements the A2A task lifecycle:
 *   POST /a2a/tasks/send         — Submit a task (maps to orchestrate/invoke)
 *   GET  /a2a/tasks/:id          — Get task status + result
 *   POST /a2a/tasks/sendSubscribe — Streaming (returns 501 — not yet supported)
 *
 * A2A spec: https://github.com/google/A2A
 * Protocol version: 0.3.0
 */
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { creditsForExecution, creditsToUsd, cacheCreditCost, creditCostForEndpoint, round6 } from '../core/credits';
import { optimizePlan, checkBudget, estimatePlanCost, PricingPreferencesSchema, type PricingPreferences } from '../core/pricing';
import { findEndpoint } from '../config/api-registry';
import { deductCredit } from '../db/index';
import { trackDelegatedSpend } from '../utils/billing';
import { maskApiKey } from '../utils/mask';
import { logger } from '../utils/logger';
import { env, ORCHESTRATION_FEE } from '../config/index';
import { signResponse } from '../middleware/sign-response';

const router = new Hono();

// ── A2A Task types ──────────────────────────────────────────────────────────

type A2ATaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled';

interface A2APart {
  type: 'text' | 'data' | 'file';
  text?: string;
  data?: unknown;
  mimeType?: string;
}

interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
  index?: number;
}

interface A2ATask {
  id: string;
  status: {
    state: A2ATaskState;
    message?: A2AMessage;
    timestamp: string;
  };
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

// ── In-memory task store (max 10k tasks, LRU eviction) ──────────────────────

const taskStore = new Map<string, A2ATask>();
const MAX_TASKS = 10_000;

function storeTask(task: A2ATask): void {
  if (taskStore.size >= MAX_TASKS) {
    // Evict oldest entry
    const firstKey = taskStore.keys().next().value;
    if (firstKey) taskStore.delete(firstKey);
  }
  taskStore.set(task.id, task);
}

// ── Validation schemas ──────────────────────────────────────────────────────

const A2APartSchema = z.object({
  type: z.enum(['text', 'data', 'file']),
  text: z.string().optional(),
  data: z.unknown().optional(),
  mimeType: z.string().optional(),
});

const A2AMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(A2APartSchema).min(1),
  metadata: z.record(z.unknown()).optional(),
});

const TaskSendParamsSchema = z.object({
  id: z.string().optional(),
  message: A2AMessageSchema,
  metadata: z.record(z.unknown()).optional(),
});

// ── Helper: extract text from A2A message parts ─────────────────────────────

function extractText(parts: A2APart[]): string {
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join('\n')
    .trim();
}

// ── Helper: extract structured data from A2A message parts ──────────────────

function extractData(parts: A2APart[]): Record<string, unknown> | undefined {
  const dataPart = parts.find((p) => p.type === 'data' && p.data);
  return dataPart?.data as Record<string, unknown> | undefined;
}

// ── POST /a2a/tasks/send — Submit a task ────────────────────────────────────

router.post('/tasks/send', checkApiKey, signResponse, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({
      error: 'Invalid JSON body',
      code: 'INVALID_BODY',
    }, 400);
  }

  const parsed = TaskSendParamsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      error: 'Invalid A2A TaskSendParams',
      code: 'INVALID_A2A_PARAMS',
      details: parsed.error.flatten().fieldErrors,
    }, 400);
  }

  const { message, metadata } = parsed.data;
  const taskId = parsed.data.id ?? nanoid(12);
  const keyInfo = c.get('apiKeyInfo');
  const start = Date.now();

  // Create initial task in submitted state
  const task: A2ATask = {
    id: taskId,
    status: {
      state: 'submitted',
      timestamp: new Date().toISOString(),
    },
    history: [message],
    metadata: {
      ...metadata,
      apiKey: maskApiKey(keyInfo.key),
    },
  };
  storeTask(task);

  // Extract query from message parts
  const query = extractText(message.parts);
  const structuredData = extractData(message.parts);

  if (!query && !structuredData) {
    task.status = {
      state: 'failed',
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: 'No text or data content found in message parts' }],
      },
      timestamp: new Date().toISOString(),
    };
    storeTask(task);
    return c.json({ id: taskId, ...task }, 400);
  }

  // Transition to working
  task.status = {
    state: 'working',
    timestamp: new Date().toISOString(),
  };
  storeTask(task);

  // Determine the query text — use text content, or stringify structured data
  const queryText = query || JSON.stringify(structuredData);

  if (queryText.length > 2000) {
    task.status = {
      state: 'failed',
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: 'Query too long (max 2000 chars)' }],
      },
      timestamp: new Date().toISOString(),
    };
    storeTask(task);
    return c.json({ id: taskId, ...task }, 400);
  }

  // Pre-check credits
  if (!keyInfo.isEnvKey && keyInfo.credits < 1) {
    task.status = {
      state: 'failed',
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: 'Insufficient credits' }],
      },
      timestamp: new Date().toISOString(),
    };
    storeTask(task);
    return c.json({ id: taskId, ...task }, 402);
  }

  try {
    // Parse intent from the A2A message
    let intent = await parseIntent(queryText);
    if (intent.steps.length > 10) intent.steps = intent.steps.slice(0, 10);

    // Extract optional pricing from metadata
    let pricing: PricingPreferences | undefined;
    if (metadata?.pricing) {
      const pricingResult = PricingPreferencesSchema.safeParse(metadata.pricing);
      if (pricingResult.success) {
        pricing = pricingResult.data;

        // Budget pre-flight
        const budgetCheck = checkBudget(intent, pricing);
        if (!budgetCheck.ok) {
          const optimized = optimizePlan(intent, { ...pricing, strategy: 'cheapest' });
          const recheck = checkBudget(optimized.intent, pricing);
          if (!recheck.ok) {
            task.status = {
              state: 'failed',
              message: {
                role: 'agent',
                parts: [{ type: 'text', text: `Budget exceeded: estimated ${recheck.estimatedCredits} credits, max ${pricing.maxCredits}` }],
              },
              timestamp: new Date().toISOString(),
            };
            storeTask(task);
            return c.json({ id: taskId, ...task }, 402);
          }
          intent = optimized.intent;
        } else {
          const optimized = optimizePlan(intent, pricing);
          if (optimized.swaps.length > 0) intent = optimized.intent;
        }
      }
    }

    // Pre-flight cost check against balance
    if (!keyInfo.isEnvKey) {
      const estimate = estimatePlanCost(intent);
      const estimatedTotal = round6(estimate.totalCredits + ORCHESTRATION_FEE);
      if (keyInfo.credits < estimatedTotal) {
        task.status = {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: `Insufficient credits: need ~${estimatedTotal}, have ${keyInfo.credits}` }],
          },
          timestamp: new Date().toISOString(),
        };
        storeTask(task);
        return c.json({ id: taskId, ...task }, 402);
      }
    }

    // Execute the plan
    const budgetConstraint = pricing?.maxCredits
      ? { maxCredits: pricing.maxCredits, strict: pricing.strict }
      : undefined;
    const execution = await executePlan(intent, budgetConstraint, keyInfo.key, 'smart', false);
    const formatted = await formatResponse(queryText, intent, execution);

    // Calculate billing
    let stepCredits = 0;
    for (const step of execution.steps) {
      if (!step.success) continue;
      const ep = findEndpoint(step.endpointId);
      if (!ep) continue;
      const liveCost = creditCostForEndpoint(ep);
      if (step.cached || step.staleServed || step.contentChanged === false) {
        stepCredits += cacheCreditCost(liveCost);
      } else {
        stepCredits += liveCost;
      }
    }
    stepCredits = round6(stepCredits);
    const creditsToDeduct = stepCredits + ORCHESTRATION_FEE;

    // Deduct credits
    if (!keyInfo.isEnvKey) {
      let deducted = false;
      try {
        deducted = deductCredit(keyInfo.key, creditsToDeduct);
      } catch (err) {
        logger.error({ err, key: maskApiKey(keyInfo.key), credits: creditsToDeduct }, 'A2A credit deduction failed');
        task.status = {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: 'Billing temporarily unavailable, please retry' }],
          },
          timestamp: new Date().toISOString(),
        };
        storeTask(task);
        return c.json({ id: taskId, ...task }, 503);
      }
      if (!deducted) {
        task.status = {
          state: 'failed',
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: 'Insufficient credits' }],
          },
          timestamp: new Date().toISOString(),
        };
        storeTask(task);
        return c.json({ id: taskId, ...task }, 402);
      }
      trackDelegatedSpend(keyInfo, creditsToDeduct);
    }

    const totalDurationMs = Date.now() - start;

    // Build completed task with artifacts
    task.status = {
      state: 'completed',
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: 'Task completed successfully' }],
      },
      timestamp: new Date().toISOString(),
    };

    task.artifacts = [
      {
        name: 'orchestration-result',
        description: 'Orchestrated API response',
        parts: [
          {
            type: 'text',
            text: formatted.answer,
          },
          {
            type: 'data',
            data: {
              summary: intent.summary,
              costBreakdown: {
                creditsUsed: creditsToDeduct,
                stepCredits,
                orchestrationFee: ORCHESTRATION_FEE,
                estimatedUsd: creditsToUsd(creditsToDeduct),
              },
              metadata: {
                stepsExecuted: execution.steps.length,
                cacheHits: execution.steps.filter((s) => s.cached).length,
                totalDurationMs,
              },
              route: {
                steps: execution.steps.map((s, i) => ({
                  endpointId: s.endpointId,
                  success: s.success,
                  cached: s.cached,
                  durationMs: s.durationMs,
                  ...(s.error && { error: s.error }),
                })),
              },
              ...(formatted.suggestedActions?.length && { suggestedActions: formatted.suggestedActions }),
            },
          },
        ],
        index: 0,
      },
    ];

    // Add agent response to history
    task.history?.push({
      role: 'agent',
      parts: [{ type: 'text', text: formatted.answer }],
    });

    storeTask(task);

    logger.info({
      taskId,
      query: queryText.slice(0, 100),
      creditsUsed: creditsToDeduct,
      steps: execution.steps.length,
      durationMs: totalDurationMs,
    }, 'A2A task completed');

    return c.json(task);

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({ taskId, error: error.message }, 'A2A task execution failed');

    task.status = {
      state: 'failed',
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: env.NODE_ENV === 'production' ? 'Internal server error' : error.message }],
      },
      timestamp: new Date().toISOString(),
    };
    storeTask(task);

    return c.json(task, 500);
  }
});

// ── GET /a2a/tasks/:id — Get task status ────────────────────────────────────

router.get('/tasks/:id', checkApiKey, async (c) => {
  const taskId = c.req.param('id');
  const task = taskStore.get(taskId);

  if (!task) {
    return c.json({
      error: 'Task not found',
      code: 'TASK_NOT_FOUND',
    }, 404);
  }

  return c.json(task);
});

// ── POST /a2a/tasks/sendSubscribe — Streaming (not yet supported) ───────────

router.post('/tasks/sendSubscribe', async (c) => {
  return c.json({
    error: 'Streaming not supported. Use POST /a2a/tasks/send instead.',
    code: 'NOT_IMPLEMENTED',
  }, 501);
});

// ── POST /a2a/tasks/cancel — Cancel a task ──────────────────────────────────

router.post('/tasks/cancel', checkApiKey, async (c) => {
  let body: { id?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, 400);
  }

  const taskId = body.id;
  if (!taskId) {
    return c.json({ error: 'Missing task id', code: 'MISSING_TASK_ID' }, 400);
  }

  const task = taskStore.get(taskId);
  if (!task) {
    return c.json({ error: 'Task not found', code: 'TASK_NOT_FOUND' }, 404);
  }

  // Can only cancel tasks that are not yet completed/failed
  if (task.status.state === 'completed' || task.status.state === 'failed' || task.status.state === 'canceled') {
    return c.json({
      error: `Cannot cancel task in state: ${task.status.state}`,
      code: 'INVALID_STATE_TRANSITION',
    }, 409);
  }

  task.status = {
    state: 'canceled',
    message: {
      role: 'agent',
      parts: [{ type: 'text', text: 'Task canceled by client' }],
    },
    timestamp: new Date().toISOString(),
  };
  storeTask(task);

  return c.json(task);
});

export { router as a2aRouter };
