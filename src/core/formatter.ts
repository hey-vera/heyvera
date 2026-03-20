import crypto from 'crypto';
import { logger } from '../utils/logger';
import { llmComplete } from '../providers/llm';
import { cacheGet, cacheSet } from '../cache/index';
import type { ExecutionResult, StepResult } from './executor';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedIntent {
  summary: string;
  reasoning: string;
  steps: Array<{
    endpointId: string;
    params: Record<string, unknown>;
    dependsOn?: string[];
    reason: string;
  }>;
  parallelGroups: string[][];
}

export interface FormattedResponse {
  answer: string;
  opportunityScore?: number;
  riskScore?: number;
  suggestedActions: string[];
  synthesisCached: boolean;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const SYNTHESIS_TTL = 10 * 60; // 10 minutes — shorter than API data (300s)

/**
 * Build a deterministic cache key from the query + execution results.
 * If the underlying data is identical (all cache hits, same results), the
 * synthesis is also identical — no need to call the LLM again.
 */
function synthesisCacheKey(query: string, execution: ExecutionResult): string {
  const payload = {
    query: query.trim().toLowerCase(),
    steps: execution.steps
      .filter((s) => s.success)
      .map((s) => ({ id: s.endpointId, data: s.data }))
      .sort((a, b) => a.id.localeCompare(b.id)), // deterministic order
  };
  return 'synthesis:' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ─── Synthesis prompt ─────────────────────────────────────────────────────────

function buildSynthesisPrompt(
  query: string,
  intent: ParsedIntent,
  execution: ExecutionResult,
): string {
  const successfulSteps = execution.steps.filter((s) => s.success);
  const failedSteps = execution.steps.filter((s) => !s.success);

  // YELLOW-7: Truncate each API response before interpolating into the LLM prompt.
  // A malicious or compromised endpoint could return a payload crafted to hijack the
  // synthesis instruction. Truncation and structured delimiters limit the blast radius.
  const MAX_DATA_BYTES_PER_STEP = 10_000;
  const dataContext = successfulSteps
    .map((s) => {
      const raw = JSON.stringify(s.data, null, 2);
      const sliced = raw.length > MAX_DATA_BYTES_PER_STEP
        ? raw.slice(0, MAX_DATA_BYTES_PER_STEP) + '\n... [truncated]'
        : raw;
      // Escape both opening and closing api-data tags to prevent XML injection from adversarial API responses
      const sanitized = sliced.replace(/<\/?api-data[\s>]/gi, (m) => m.replace('<', '&lt;'));
      return `<api-data endpoint="${s.endpointId}">\n${sanitized}\n</api-data>`;
    })
    .join('\n\n');

  const failureNote =
    failedSteps.length > 0
      ? `\nNote: ${failedSteps.length} step(s) failed: ${failedSteps.map((s) => s.endpointId).join(', ')}. Work with what's available.`
      : '';

  return `You are a Solana market intelligence analyst. Synthesize the API data below into a clear, actionable analysis.

Original query: "${query}"
Plan summary: ${intent.summary}
${failureNote}

## Raw API Data
${dataContext}

## Instructions
- Write a direct, specific answer to the query using the actual data values
- Include concrete numbers (prices, holder counts, percentages) — no vague statements
- If risk/opportunity is relevant, provide scores 0–100 and explain the key factors
- Provide 2–4 specific suggested actions
- Keep the answer under 400 words
- Do NOT include filler phrases like "it's important to note" or "overall"

## Required JSON output (no markdown fences)
{
  "answer": "...",
  "opportunityScore": null,
  "riskScore": null,
  "suggestedActions": ["...", "..."]
}`;
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseSynthesisResponse(raw: string): Omit<FormattedResponse, 'synthesisCached'> {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      answer?: string;
      opportunityScore?: number | null;
      riskScore?: number | null;
      suggestedActions?: string[];
    };

    if (!parsed.answer || typeof parsed.answer !== 'string' || parsed.answer.trim().length === 0) {
      throw new Error('Missing or empty answer field');
    }

    return {
      answer: parsed.answer,
      opportunityScore:
        typeof parsed.opportunityScore === 'number' ? parsed.opportunityScore : undefined,
      riskScore: typeof parsed.riskScore === 'number' ? parsed.riskScore : undefined,
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? parsed.suggestedActions.filter((a) => typeof a === 'string')
        : [],
    };
  } catch {
    // Fallback: treat the whole response as a plain answer
    logger.warn('Synthesis: JSON parse failed, using raw text as answer');
    return {
      answer: raw.slice(0, 1500),
      suggestedActions: [],
    };
  }
}

// ─── Fallback: build a plain-text summary without LLM ────────────────────────

function buildFallbackResponse(
  query: string,
  execution: ExecutionResult,
): Omit<FormattedResponse, 'synthesisCached'> {
  const successCount = execution.steps.filter((s) => s.success).length;
  const failCount = execution.steps.filter((s) => !s.success).length;

  const answer =
    `Partial results for: "${query}"\n\n` +
    execution.steps
      .filter((s) => s.success)
      .map((s) => `- ${s.endpointId}: data retrieved successfully`)
      .join('\n') +
    (failCount > 0 ? `\n\n${failCount} step(s) failed.` : '') +
    `\n\nCompleted ${successCount}/${execution.steps.length} steps in ${execution.totalDurationMs}ms.`;

  return { answer, suggestedActions: [] };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function formatResponse(
  query: string,
  intent: ParsedIntent,
  execution: ExecutionResult,
): Promise<FormattedResponse> {
  // No steps succeeded — fall back to direct LLM answer instead of empty response
  if (execution.steps.filter((s) => s.success).length === 0) {
    logger.info('Synthesis: no API steps succeeded, falling back to direct LLM answer');
    try {
      const directAnswer = await llmComplete([
        { role: 'system', content: 'You are ClawNet, an AI agent orchestration platform. Answer the user\'s question directly and helpfully. Be concise.' },
        { role: 'user', content: query },
      ], 'synthesis');
      return {
        answer: directAnswer.content,
        suggestedActions: [],
        synthesisCached: false,
      };
    } catch (err) {
      logger.warn({ err }, 'Synthesis: direct LLM fallback failed');
      return { ...buildFallbackResponse(query, execution), synthesisCached: false };
    }
  }

  // ── Synthesis cache check ──────────────────────────────────────────────────
  const cacheKey = synthesisCacheKey(query, execution);

  try {
    const cached = await cacheGet<Omit<FormattedResponse, 'synthesisCached'>>(cacheKey);
    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 16) }, 'Synthesis: cache hit — skipping LLM call');
      return { ...cached, synthesisCached: true };
    }
  } catch (err) {
    logger.warn({ err }, 'Synthesis: cache read failed, continuing to LLM');
  }

  // ── LLM synthesis call ─────────────────────────────────────────────────────
  const prompt = buildSynthesisPrompt(query, intent, execution);

  try {
    const response = await llmComplete([{ role: 'user', content: prompt }], 'synthesis');
    const result = parseSynthesisResponse(response.content);

    // Store in cache (failures also cached briefly to avoid thundering herd)
    try {
      await cacheSet(cacheKey, result, SYNTHESIS_TTL);
      logger.info({ cacheKey: cacheKey.slice(0, 16) }, 'Synthesis: result cached');
    } catch (err) {
      logger.warn({ err }, 'Synthesis: cache write failed');
    }

    return { ...result, synthesisCached: false };
  } catch (err) {
    logger.error({ err }, 'Synthesis: LLM call failed, returning fallback');
    return { ...buildFallbackResponse(query, execution), synthesisCached: false };
  }
}