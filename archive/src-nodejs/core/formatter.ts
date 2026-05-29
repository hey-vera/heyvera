import { z } from 'zod';
import { llmComplete } from '../providers/llm';
import { ParsedIntent } from './intent-parser';
import { ExecutionResult } from './executor';
import { logger } from '../utils/logger';

const FormattedResponseSchema = z.object({
  answer: z.string(),
  opportunityScore: z.number().min(0).max(100).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  suggestedActions: z.array(z.string()).default([]),
});

export type FormattedResponse = z.infer<typeof FormattedResponseSchema>;

export async function formatResponse(
  query: string,
  intent: ParsedIntent,
  execution: ExecutionResult
): Promise<FormattedResponse> {
  const successfulData = execution.steps
    .filter((s) => s.success && s.data)
    .map((s) => ({ endpointId: s.endpointId, data: s.data }));

  const systemPrompt = `You are a crypto and blockchain analyst. Synthesize API data into a clear, actionable analysis.

Always respond with valid JSON only — no markdown, no explanation.

Schema:
{
  "answer": "detailed analysis paragraph(s)",
  "opportunityScore": 0-100 (only for token/investment queries, omit otherwise),
  "riskScore": 0-100 (only for token/risk queries, omit otherwise),
  "suggestedActions": ["action 1", "action 2", "action 3"]
}`;

  const userPrompt = `User query: ${query}

Plan: ${intent.summary}

Data collected:
${JSON.stringify(successfulData, null, 2)}

${execution.steps.some((s) => !s.success) ? `Failed steps: ${execution.steps.filter((s) => !s.success).map((s) => s.endpointId).join(', ')}` : ''}

Provide a clear analysis based on this data.`;

  try {
    const response = await llmComplete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const cleaned = response.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return FormattedResponseSchema.parse(parsed);
  } catch (err) {
    logger.warn({ err }, 'Synthesis failed, returning raw data');
    return {
      answer: `Analysis based on ${successfulData.length} data sources: ${JSON.stringify(successfulData)}`,
      suggestedActions: ['Review the raw data above', 'Try your query again'],
    };
  }
}