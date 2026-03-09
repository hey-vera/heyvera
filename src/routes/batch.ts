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
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

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

  const start = Date.now();

  const results = await Promise.allSettled(
    body.queries.map(async (query, idx) => {
      const qStart = Date.now();
      try {
        const intent = await parseIntent(query);
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
          error: err instanceof Error ? err.message : String(err),
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
