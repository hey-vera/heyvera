/**
 * Batch Orchestration — POST /v1/batch
 * Run multiple independent queries in parallel, returning all results in one response.
 * Billed per-query; max 10 queries per batch.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { checkApiKey } from '../middleware/auth';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { deductCredit } from '../db/index';
import { creditsForApiCost } from '../core/credits';
import { cacheIncr } from '../cache/index';
import { apiRegistry } from '../config/api-registry';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

// Maximum total execution steps across all queries in a single batch request.
// Prevents 10 queries × 10 steps each = 100 external API calls from one HTTP request.
const MAX_BATCH_STEPS = 30;

export const batchRouter = new Hono();

const BatchSchema = z.object({
  queries: z.array(z.string().min(1).max(2000)).min(1).max(10),
});

batchRouter.post('/', checkApiKey, async (c) => {
  const batchId = nanoid(12);
  const keyInfo = c.get('apiKeyInfo');

  let body: z.infer<typeof BatchSchema>;
  try {
    body = BatchSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ batchId, error: 'Invalid body', details: (err as Error).message }, 400);
  }

  // Pre-flight: require at least 1 credit per query
  if (!keyInfo.isEnvKey && keyInfo.credits < body.queries.length) {
    return c.json({
      batchId,
      error: 'Insufficient credits',
      code: 'INSUFFICIENT_CREDITS',
      creditsAvailable: keyInfo.credits,
      queriesRequested: body.queries.length,
      hint: 'Top up your credits at claw-net.org',
    }, 402);
  }

  // RED-4: Enforce per-key tiered rate limit (counts each query in the batch separately)
  if (!keyInfo.isEnvKey) {
    const tierLimit = keyInfo.amountPaid >= 500 ? 300
      : keyInfo.amountPaid >= 100 ? 120
      : keyInfo.amountPaid >= 20  ? 60
      : 30;
    // Increment rate limit counter by queries.length (each query consumes one slot)
    const rlCounts = await Promise.all(
      Array.from({ length: body.queries.length }, () => cacheIncr(`rl:orch:${keyInfo.key}`, 60))
    );
    const maxRlCount = Math.max(...rlCounts);
    if (maxRlCount > tierLimit) {
      return c.json({
        batchId,
        error: 'Orchestration rate limit exceeded for your tier',
        code: 'RATE_LIMITED',
        limit: tierLimit,
        hint: 'Top up to $20+ for higher limits',
      }, 429);
    }
  }

  const start = Date.now();

  // YELLOW-3: Parse all intents first so we can check total step count and estimate
  // cost upfront — then deduct atomically before any expensive API execution.
  const intents = await Promise.allSettled(
    body.queries.map((query) => parseIntent(query))
  );

  const parsedIntents = intents.map((r, idx) =>
    r.status === 'fulfilled' ? { ok: true as const, intent: r.value, query: body.queries[idx] }
      : { ok: false as const, error: r.reason, query: body.queries[idx] }
  );

  // YELLOW-6: Cap total execution steps across all queries
  const totalSteps = parsedIntents.reduce((sum, p) => sum + (p.ok ? p.intent.steps.length : 0), 0);
  if (totalSteps > MAX_BATCH_STEPS) {
    return c.json({
      batchId,
      error: `Batch would require ${totalSteps} API steps, exceeding max of ${MAX_BATCH_STEPS}. Simplify your queries or reduce batch size.`,
      code: 'BATCH_STEP_LIMIT_EXCEEDED',
      totalSteps,
      limit: MAX_BATCH_STEPS,
    }, 400);
  }

  // YELLOW-3: Estimate total credits needed and deduct upfront atomically.
  // This prevents partial execution where some queries succeed and some fail due to credit depletion.
  if (!keyInfo.isEnvKey) {
    const estimatedCredits = parsedIntents.reduce((sum, p) => {
      if (!p.ok) return sum;
      const estimatedCost = p.intent.steps.reduce((s, step) => {
        const ep = apiRegistry.find((e) => e.id === step.endpointId);
        return s + (ep?.costPerCall ?? 0.001);
      }, 0);
      return sum + Math.max(1, Math.ceil(estimatedCost * 2000));
    }, 0);

    if (estimatedCredits > keyInfo.credits) {
      return c.json({
        batchId,
        error: 'Insufficient credits for estimated batch cost',
        code: 'INSUFFICIENT_CREDITS',
        creditsAvailable: keyInfo.credits,
        estimatedCredits,
        hint: 'Top up your credits at claw-net.org',
      }, 402);
    }
  }

  const results = await Promise.allSettled(
    parsedIntents.map(async (parsed, idx) => {
      const qStart = Date.now();
      if (!parsed.ok) {
        return { index: idx, query: parsed.query, ok: false, error: 'Intent parsing failed', durationMs: 0 };
      }
      const { intent, query } = parsed;
      try {
        const execution = await executePlan(intent);
        const formatted = await formatResponse(query, intent, execution);

        const creditsToDeduct = creditsForApiCost(execution.totalCost);
        if (!keyInfo.isEnvKey) {
          const deducted = deductCredit(keyInfo.key, creditsToDeduct);
          if (!deducted) {
            return {
              index: idx, query, ok: false,
              error: 'Insufficient credits',
              durationMs: Date.now() - qStart,
            };
          }
        }

        return {
          index: idx,
          query,
          ok: true,
          answer: formatted.answer,
          creditsUsed: creditsToDeduct,
          durationMs: Date.now() - qStart,
          steps: execution.steps.length,
        };
      } catch (err) {
        logger.warn({ batchId, idx, err }, 'Batch query failed');
        return {
          index: idx,
          query,
          ok: false,
          error: process.env.NODE_ENV === 'production' ? 'Query failed' : (err instanceof Error ? err.message : String(err)),
          durationMs: Date.now() - qStart,
        };
      }
    })
  );

  const items = results.map((r) =>
    r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }
  );

  const succeeded = items.filter((r) => r.ok).length;

  return c.json({
    batchId,
    totalQueries: body.queries.length,
    succeeded,
    failed: body.queries.length - succeeded,
    totalDurationMs: Date.now() - start,
    results: items,
  });
});
