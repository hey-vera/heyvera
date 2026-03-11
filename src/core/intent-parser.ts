import { z } from 'zod';
import crypto from 'crypto';
import { llmComplete } from '../providers/llm';
import { registryToPromptContext, findEndpoint } from '../config/api-registry';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';
import { matchTemplate } from './plan-templates';

function intentCacheKey(query: string): string {
  const normalized = query.toLowerCase().trim().replace(/\s+/g, ' ');
  return 'intent:' + crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

const StepSchema = z.object({
  endpointId: z.string(),
  params: z.record(z.string()),
  dependsOn: z.array(z.string()).default([]),
  reason: z.string(),
});

const ParsedIntentSchema = z.object({
  summary: z.string(),
  reasoning: z.string(),
  steps: z.array(StepSchema),
  parallelGroups: z.array(z.array(z.string())),
});

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;

const SYSTEM_PROMPT = `You are an API orchestration planner. Given a user query, select the best API endpoints to answer it.

${registryToPromptContext()}

Respond ONLY with a valid JSON object — no markdown, no explanation, just JSON.

Schema:
{
  "summary": "one line description of the plan",
  "reasoning": "why you chose these endpoints",
  "steps": [
    {
      "endpointId": "exact endpoint id from registry",
      "params": { "paramName": "value" },
      "dependsOn": [],
      "reason": "why this step is needed"
    }
  ],
  "parallelGroups": [["step0", "step1"], ["step2"]]
}

Rules:
- Only use endpoint IDs that exist in the registry above
- parallelGroups is an array of arrays of step indexes (as strings: "0", "1", etc.)
- Steps in the same group run in parallel, groups run in sequence
- Max 10 steps total
- If a step depends on output from a previous step, put it in a later group`;

export async function parseIntent(query: string, pricingHint?: string): Promise<ParsedIntent> {
  // Check intent cache first — 30-min TTL (plan is stable, data freshness handled by executor cache)
  // When pricing hint is present, include it in the cache key so different budgets get different plans
  const cacheKey = intentCacheKey(query + (pricingHint ?? ''));
  const cached = await cacheGet<ParsedIntent>(cacheKey);
  if (cached) {
    logger.info({ query: query.slice(0, 80) }, 'Intent cache hit');
    return cached;
  }

  // Check plan templates — skip LLM entirely for common queries (~3-5s saved)
  // Templates are used even with pricing hints — the optimizer handles budget swaps post-parse
  const templateMatch = matchTemplate(query);
  if (templateMatch) {
    logger.info({ query: query.slice(0, 80), template: templateMatch.templateName }, 'Template match — skipping LLM');
    await cacheSet(cacheKey, templateMatch.intent, 30 * 60);
    return templateMatch.intent;
  }

  const systemContent = pricingHint ? SYSTEM_PROMPT + '\n\n' + pricingHint : SYSTEM_PROMPT;
  const messages = [
    { role: 'system' as const, content: systemContent },
    { role: 'user' as const, content: JSON.stringify({ query: query.slice(0, 2000) }) },
  ];

  async function attempt(): Promise<ParsedIntent> {
    const response = await llmComplete(messages, 'intent');
    const cleaned = response.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const result = ParsedIntentSchema.parse(parsed);
    // Validate that all endpoint IDs exist in the registry — drop hallucinated ones
    const validSteps = result.steps.filter(step => {
      const exists = !!findEndpoint(step.endpointId);
      if (!exists) logger.warn({ endpointId: step.endpointId }, 'Intent parser: unknown endpoint ID dropped');
      return exists;
    });
    if (validSteps.length < result.steps.length) {
      // Remap parallelGroups to new indices — old indices are stale after filtering
      const oldToNew = new Map<number, number>();
      validSteps.forEach((step, newIdx) => {
        oldToNew.set(result.steps.indexOf(step), newIdx);
      });
      const newGroups = result.parallelGroups
        .map(group => group
          .filter(idx => oldToNew.has(parseInt(idx)))
          .map(idx => String(oldToNew.get(parseInt(idx))!))
        )
        .filter(group => group.length > 0);
      return { ...result, steps: validSteps, parallelGroups: newGroups };
    }
    return result;
  }

  try {
    const result = await attempt();
    await cacheSet(cacheKey, result, 30 * 60);
    return result;
  } catch (err) {
    logger.warn({ err }, 'Intent parse failed, retrying with correction hint');
    try {
      // Add a correction hint so the LLM knows to fix its output — avoids identical retry
      const retryMessages = [
        ...messages,
        { role: 'assistant' as const, content: '(previous attempt returned invalid JSON)' },
        { role: 'user' as const, content: 'Your previous response was not valid JSON. Respond with ONLY a valid JSON object matching the schema. No markdown, no explanation.' },
      ];
      const response = await llmComplete(retryMessages, 'intent');
      const cleaned = response.content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const result = ParsedIntentSchema.parse(parsed);
      const validSteps = result.steps.filter(step => !!findEndpoint(step.endpointId));
      if (validSteps.length < result.steps.length) {
        const oldToNew = new Map<number, number>();
        validSteps.forEach((step, newIdx) => { oldToNew.set(result.steps.indexOf(step), newIdx); });
        const newGroups = result.parallelGroups
          .map(group => group.filter(idx => oldToNew.has(parseInt(idx))).map(idx => String(oldToNew.get(parseInt(idx))!)))
          .filter(group => group.length > 0);
        const fixed = { ...result, steps: validSteps, parallelGroups: newGroups };
        await cacheSet(cacheKey, fixed, 30 * 60);
        return fixed;
      }
      await cacheSet(cacheKey, result, 30 * 60);
      return result;
    } catch (retryErr) {
      logger.error({ retryErr }, 'Intent parse failed after retry');
      throw Object.assign(new Error('INTENT_PARSE_FAILED'), { code: 'INTENT_PARSE_FAILED' });
    }
  }
}