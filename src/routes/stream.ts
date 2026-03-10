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

// Track concurrent SSE streams per API key (module-level, single-process safe)
const activeStreams = new Map<string, number>();
const MAX_CONCURRENT_STREAMS = 5;

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

  // YELLOW-5: Reject if this key already has too many concurrent streams
  if (!keyInfo.isEnvKey) {
    const current = activeStreams.get(keyInfo.key) ?? 0;
    if (current >= MAX_CONCURRENT_STREAMS) {
      return c.json({ error: 'Too many concurrent streams for this key', code: 'STREAM_LIMIT_EXCEEDED', limit: MAX_CONCURRENT_STREAMS }, 429);
    }
    activeStreams.set(keyInfo.key, current + 1);
  }

  const start = Date.now();
  const abortController = new AbortController();
  const { signal } = abortController;

  return c.body(
    new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const emit = (event: string, data: unknown) => {
          try { controller.enqueue(enc.encode(sseEvent(event, data))); } catch { /* client gone */ }
        };

        try {
          emit('start', { requestId, query: query.slice(0, 100) });

          const intent = await parseIntent(query);
          if (signal.aborted) return;
          emit('plan', {
            summary: intent.summary,
            steps: intent.steps.length,
            parallelGroups: intent.parallelGroups.length,
          });

          const execution = await executePlan(intent);

          // RED-2: Deduct credits immediately after execution — API calls have already been
          // made at this point. Do this BEFORE checking signal.aborted so that clients
          // cannot get free execution by disconnecting after executePlan() completes.
          const creditsToDeduct = creditsForApiCost(execution.totalCost);
          if (!keyInfo.isEnvKey) {
            const deducted = deductCredit(keyInfo.key, creditsToDeduct);
            if (!deducted) {
              emit('error', { requestId, error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
              return;
            }
          }

          if (signal.aborted) return;

          // Emit per-step summaries (omit cost to avoid leaking pricing internals)
          for (let idx = 0; idx < execution.steps.length; idx++) {
            const s = execution.steps[idx];
            emit('step', {
              index: idx,
              endpointId: s.endpointId,
              success: s.success,
              cached: s.cached,
              durationMs: s.durationMs,
            });
          }

          const formatted = await formatResponse(query, intent, execution);
          if (signal.aborted) return;

          emit('done', {
            requestId,
            answer: formatted.answer,
            creditsUsed: creditsToDeduct,
            totalDurationMs: Date.now() - start,
            steps: execution.steps.length,
            cacheHits: execution.steps.filter((s) => s.cached).length,
          });
        } catch (err) {
          if (signal.aborted) return;
          logger.error({ requestId, err }, 'SSE orchestration failed');
          emit('error', {
            requestId,
            error: env.NODE_ENV === 'production' ? 'Internal server error' : (err instanceof Error ? err.message : String(err)),
          });
        } finally {
          controller.close();
          if (!keyInfo.isEnvKey) {
            const n = (activeStreams.get(keyInfo.key) ?? 1) - 1;
            if (n <= 0) activeStreams.delete(keyInfo.key);
            else activeStreams.set(keyInfo.key, n);
          }
        }
      },
      cancel() {
        abortController.abort();
        logger.info({ requestId }, 'SSE client disconnected — orchestration cancelled');
        if (!keyInfo.isEnvKey) {
          const n = (activeStreams.get(keyInfo.key) ?? 1) - 1;
          if (n <= 0) activeStreams.delete(keyInfo.key);
          else activeStreams.set(keyInfo.key, n);
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
