import { z } from 'zod';
import { llmComplete } from '../providers/llm';
import { registryToPromptContext } from '../config/api-registry';
import { logger } from '../utils/logger';

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
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: `Query: ${query.slice(0, 2000)}` },
  ];

  async function attempt(): Promise<ParsedIntent> {
    const response = await llmComplete(messages);
    const cleaned = response.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return ParsedIntentSchema.parse(parsed);
  }

  try {
    return await attempt();
  } catch (err) {
    logger.warn({ err }, 'Intent parse failed, retrying once');
    try {
      return await attempt();
    } catch (retryErr) {
      logger.error({ retryErr }, 'Intent parse failed after retry');
      throw Object.assign(new Error('INTENT_PARSE_FAILED'), { code: 'INTENT_PARSE_FAILED' });
    }
  }
}