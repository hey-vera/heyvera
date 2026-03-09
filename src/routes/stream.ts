/**
 * SSE Streaming Orchestration — GET /v1/stream/orchestrate?query=...
 * Streams real-time orchestration progress events to the client via Server-Sent Events.
 * Each step emits an event as it completes; final event contains the full answer.
 */
import { Hono } from 'hono';
import { checkApiKey } from '../middleware/auth';
import { parseIntent } from '../core/intent-parser';
import { executePlan } from '../core/executor';
import { formatResponse } from '../core/formatter';
import { env } from '../config/index';
import { deductCredit } from '../db/index';
import { creditsForApiCost } from '../core/credits';
import { logger } from '../utils/logger';
import { nanoid } from 'nanoid';

export const streamRouter = new Hono();

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

streamRouter.get('/orchestrate', checkApiKey, async (c) => {
  const query = c.req.query('query')?.trim();
  const requestId = nanoid(12);
  const keyInfo = c.get('apiKeyInfo');

  if (!query) {
    return c.json({ error: 'Missing query parameter', code: 'MISSING_QUERY' }, 400);
  }
  if (query.length > 2000) {
    return c.json({ error: 'Query too long (max 2000 chars)', code: 'QUERY_TOO_LONG' }, 400);
  }
  if (!keyInfo.isEnvKey && keyInfo.credits < 1) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402);
  }

  const start = Date.now();

  return c.body(
    new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (event: string, data: unknown) => {
          controller.enqueue(enc.encode(sseEvent(event, data)));
        };

        try {
          emit('start', { requestId, query: query.slice(0, 100) });

          const intent = await parseIntent(query);
          emit('plan', {
            summary: intent.summary,
            steps: intent.steps.length,
            parallelGroups: intent.parallelGroups.length,
          });

          const execution = await executePlan(intent);

          // Emit per-step summaries
          for (let idx = 0; idx < execution.steps.length; idx++) {
            const s = execution.steps[idx];
            emit('step', {
              index: idx,
              endpointId: s.endpointId,
              success: s.success,
              cached: s.cached,
              durationMs: s.durationMs,
              cost: s.cost,
            });
          }

          const formatted = await formatResponse(query, intent, execution);

          const creditsToDeduct = creditsForApiCost(execution.totalCost);
          if (!keyInfo.isEnvKey) {
            deductCredit(keyInfo.key, creditsToDeduct);
          }

          emit('done', {
            requestId,
            answer: formatted.answer,
            creditsUsed: creditsToDeduct,
            totalDurationMs: Date.now() - start,
            steps: execution.steps.length,
            cacheHits: execution.steps.filter((s) => s.cached).length,
          });
        } catch (err) {
          logger.error({ requestId, err }, 'SSE orchestration failed');
          emit('error', {
            requestId,
            error: env.NODE_ENV === 'production' ? 'Internal server error' : (err instanceof Error ? err.message : String(err)),
          });
        } finally {
          controller.close();
        }
      },
    }),
    200,
    {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  );
});
