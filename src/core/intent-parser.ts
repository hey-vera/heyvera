import { z } from 'zod';
import crypto from 'crypto';
import { llmComplete } from '../providers/llm';
import { registryToPromptContext, findEndpoint } from '../config/api-registry';
import { cacheGet, cacheSet } from '../cache/index';
import { logger } from '../utils/logger';

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

export async function parseIntent(query: string): Promise<ParsedIntent> {
  // Check intent cache first — 30-min TTL (plan is stable, data freshness handled by executor cache)
  const cacheKey = intentCacheKey(query);
  const cached = await cacheGet<ParsedIntent>(cacheKey);
  if (cached) {
    logger.info({ query: query.slice(0, 80) }, 'Intent cache hit');
    return cached;
  }

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: JSON.stringify({ query: query.slice(0, 2000) }) },
  ];

  async function attempt(): Promise<ParsedIntent> {
    const response = await llmComplete(messages);
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
      // Rebuild parallelGroups to only reference surviving step indices
      const validIndices = new Set(validSteps.map(s => result.steps.indexOf(s)));
      const newGroups = result.parallelGroups
        .map(group => group.filter(idx => validIndices.has(parseInt(idx))))
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
    logger.warn({ err }, 'Intent parse failed, retrying once');
    try {
      const result = await attempt();
      await cacheSet(cacheKey, result, 30 * 60);
      return result;
    } catch (retryErr) {
      logger.error({ retryErr }, 'Intent parse failed after retry');
      throw Object.assign(new Error('INTENT_PARSE_FAILED'), { code: 'INTENT_PARSE_FAILED' });
    }
  }
}