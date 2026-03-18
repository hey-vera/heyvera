/**
 * VIE Synthesis Layer — LLM-powered verdict explanation for the Deep tier.
 *
 * Takes scoring output + raw data from vie-engine.ts / vie-sources.ts and produces
 * a natural language explanation with evidence chain. Uses claude-haiku-4-5 by default,
 * upgrades to claude-sonnet-4-6 for ambiguous scores (35-65).
 *
 * Never crashes the VIE pipeline — on any LLM failure, returns an algorithmically
 * built fallback explanation from the raw scores.
 */

import { llmComplete, type LlmMessage } from '../providers/llm';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-category score + raw signals produced by vie-engine.ts */
export interface VieCategoryScore {
  score: number;
  signals: Record<string, unknown>;
}

/** Full scoring result from vie-engine.ts */
export interface VieResult {
  trust_score: number;
  risk_level: 'VERIFIED' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation: 'PROCEED' | 'CAUTION' | 'AVOID' | 'BLOCK';
  confidence: number;
  factors: {
    contract_safety: VieCategoryScore | null;
    holder_distribution: VieCategoryScore | null;
    historical_pattern: VieCategoryScore | null;
    social_signal: VieCategoryScore | null;
    onchain_activity: VieCategoryScore | null;
  };
}

/** Raw data returned by vie-sources.ts (maps source name to raw API response) */
export interface VieRawData {
  rugmunch_risk?: Record<string, unknown> | null;
  rugmunch_holders?: Record<string, unknown> | null;
  apollo_osint?: Record<string, unknown> | null;
  claw_x_mentions?: Record<string, unknown> | null;
  dexscreener?: Record<string, unknown> | null;
}

/** Single evidence entry in the verdict */
export interface VieEvidenceEntry {
  source: string;
  finding: string;
  direction: 'positive' | 'negative' | 'neutral';
}

/** LLM synthesis output */
export interface VieExplanation {
  explanation: string;
  evidence: VieEvidenceEntry[];
  comparable_tokens?: Array<{
    symbol: string;
    trust_score: number;
    similarity: string;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a crypto security analyst. Given structured data from 5 independent verification sources, produce a concise trust assessment.

Rules:
- Lead with the verdict (safe/risky/avoid) in the first sentence
- Reference specific data points with numbers
- Flag any contradictions between sources
- Note the single biggest risk factor even if the overall score is high
- Keep it under 150 words
- Output valid JSON only: {"explanation": "...", "evidence": [...]}
- Each evidence entry: {"source": "<data-source-name>", "finding": "<specific finding>", "direction": "positive"|"negative"|"neutral"}
- Do NOT hallucinate data — only reference what is provided`;

const AMBIGUOUS_LOW = 35;
const AMBIGUOUS_HIGH = 65;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function formatSignals(signals: Record<string, unknown> | null | undefined): string {
  if (!signals || Object.keys(signals).length === 0) return '  (no data available)';
  return Object.entries(signals)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n');
}

function buildUserPrompt(target: string, targetType: string, scores: VieResult): string {
  const f = scores.factors;

  const sections: string[] = [
    `Produce a trust assessment for ${targetType} ${target} based on these verified data sources:`,
    '',
  ];

  if (f.contract_safety) {
    sections.push(`Contract Safety (score: ${f.contract_safety.score}/100):`);
    sections.push(formatSignals(f.contract_safety.signals));
    sections.push('');
  }

  if (f.holder_distribution) {
    sections.push(`Holder Distribution (score: ${f.holder_distribution.score}/100):`);
    sections.push(formatSignals(f.holder_distribution.signals));
    sections.push('');
  }

  if (f.historical_pattern) {
    sections.push(`Historical Pattern (score: ${f.historical_pattern.score}/100):`);
    sections.push(formatSignals(f.historical_pattern.signals));
    sections.push('');
  }

  if (f.social_signal) {
    sections.push(`Social Signal (score: ${f.social_signal.score}/100):`);
    sections.push(formatSignals(f.social_signal.signals));
    sections.push('');
  }

  if (f.onchain_activity) {
    sections.push(`On-Chain Activity (score: ${f.onchain_activity.score}/100):`);
    sections.push(formatSignals(f.onchain_activity.signals));
    sections.push('');
  }

  sections.push(`Composite trust score: ${scores.trust_score}/100`);
  sections.push(`Risk level: ${scores.risk_level}`);
  sections.push(`Confidence: ${scores.confidence}`);

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Evidence chain builder (algorithmic fallback)
// ---------------------------------------------------------------------------

function directionFromScore(score: number): 'positive' | 'negative' | 'neutral' {
  if (score >= 60) return 'positive';
  if (score <= 39) return 'negative';
  return 'neutral';
}

function summarizeSignals(signals: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(signals)) {
    if (val === null || val === undefined) continue;
    const label = key.replace(/_/g, ' ');
    if (typeof val === 'boolean') {
      parts.push(val ? label : `no ${label}`);
    } else {
      parts.push(`${label}: ${val}`);
    }
  }
  return parts.slice(0, 4).join(', ') || 'data available';
}

function buildAlgorithmicEvidence(scores: VieResult): VieEvidenceEntry[] {
  const evidence: VieEvidenceEntry[] = [];
  const sourceMap: Array<[keyof VieResult['factors'], string]> = [
    ['contract_safety', 'rugmunch-risk'],
    ['holder_distribution', 'rugmunch-holder-analysis'],
    ['historical_pattern', 'apollo-osint'],
    ['social_signal', 'claw-x-mentions'],
    ['onchain_activity', 'dexscreener-token'],
  ];

  for (const [category, source] of sourceMap) {
    const factor = scores.factors[category];
    if (!factor) continue;
    evidence.push({
      source,
      finding: `Score ${factor.score}/100 — ${summarizeSignals(factor.signals)}`,
      direction: directionFromScore(factor.score),
    });
  }

  return evidence;
}

function buildFallbackExplanation(scores: VieResult): string {
  const level = scores.risk_level;
  const verdict =
    level === 'VERIFIED' || level === 'LOW'
      ? 'appears safe'
      : level === 'MEDIUM'
        ? 'shows mixed signals'
        : 'presents significant risk';

  const available = Object.values(scores.factors).filter(Boolean).length;
  const lowest = Object.entries(scores.factors)
    .filter(([, v]) => v !== null)
    .sort((a, b) => (a[1]!.score - b[1]!.score))[0];

  let biggest_risk = '';
  if (lowest) {
    const label = lowest[0].replace(/_/g, ' ');
    biggest_risk = ` Biggest risk area: ${label} (${lowest[1]!.score}/100).`;
  }

  return (
    `This target ${verdict} with a composite trust score of ${scores.trust_score}/100 ` +
    `(confidence: ${(scores.confidence * 100).toFixed(0)}%) based on ${available} data sources.` +
    biggest_risk +
    ` Recommendation: ${scores.recommendation}.`
  );
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

function extractJson(text: string): unknown | null {
  // Try the whole string first
  try {
    return JSON.parse(text);
  } catch {
    // noop
  }

  // Try to find a JSON object in the text (LLM may wrap in markdown code blocks)
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // noop
    }
  }

  return null;
}

function isValidEvidence(arr: unknown): arr is VieEvidenceEntry[] {
  if (!Array.isArray(arr)) return false;
  return arr.every(
    (e: Record<string, unknown>) =>
      typeof e.source === 'string' &&
      typeof e.finding === 'string' &&
      ['positive', 'negative', 'neutral'].includes(e.direction as string),
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Synthesize a natural language verdict from VIE scoring output.
 *
 * Uses claude-haiku-4-5 by default (via llmComplete role='intent').
 * For ambiguous scores (35-65), upgrades to claude-sonnet-4-6 (role='synthesis')
 * for more nuanced analysis.
 *
 * On any failure, returns an algorithmically-built explanation — the LLM
 * synthesis is an enhancement, never a blocker.
 */
export async function synthesizeVerdict(
  target: string,
  targetType: string,
  scores: VieResult,
  rawData: VieRawData,
): Promise<VieExplanation | null> {
  // Always build the algorithmic evidence as a fallback/supplement
  const algorithmicEvidence = buildAlgorithmicEvidence(scores);

  // Build messages for the LLM
  const userPrompt = buildUserPrompt(target, targetType, scores);
  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  // Model selection: ambiguous scores (35-65) get the more capable model.
  // llmComplete role='intent' → ANTHROPIC_INTENT_MODEL (haiku)
  // llmComplete role='synthesis' → ANTHROPIC_MODEL (sonnet)
  const isAmbiguous =
    scores.trust_score >= AMBIGUOUS_LOW && scores.trust_score <= AMBIGUOUS_HIGH;
  const role = isAmbiguous ? 'synthesis' : 'intent';

  try {
    const response = await llmComplete(messages, role);

    const parsed = extractJson(response.content);
    if (!parsed || typeof parsed !== 'object') {
      logger.warn(
        { target, responseLength: response.content.length },
        'VIE synthesis: LLM returned unparseable response, using fallback',
      );
      return {
        explanation: buildFallbackExplanation(scores),
        evidence: algorithmicEvidence,
      };
    }

    const obj = parsed as Record<string, unknown>;
    const explanation =
      typeof obj.explanation === 'string' && obj.explanation.length > 0
        ? obj.explanation
        : buildFallbackExplanation(scores);

    // Use LLM evidence if valid, otherwise fall back to algorithmic
    const evidence = isValidEvidence(obj.evidence) ? obj.evidence : algorithmicEvidence;

    // Comparable tokens are optional — only include if LLM provided them
    let comparable_tokens: VieExplanation['comparable_tokens'] | undefined;
    if (Array.isArray(obj.comparable_tokens) && obj.comparable_tokens.length > 0) {
      comparable_tokens = (obj.comparable_tokens as Array<Record<string, unknown>>)
        .filter(
          (t) =>
            typeof t.symbol === 'string' &&
            typeof t.trust_score === 'number' &&
            typeof t.similarity === 'string',
        )
        .map((t) => ({
          symbol: t.symbol as string,
          trust_score: t.trust_score as number,
          similarity: t.similarity as string,
        }));
      if (comparable_tokens.length === 0) comparable_tokens = undefined;
    }

    logger.info(
      {
        target,
        model: role === 'synthesis' ? 'sonnet' : 'haiku',
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        evidenceCount: evidence.length,
      },
      'VIE synthesis complete',
    );

    return { explanation, evidence, comparable_tokens };
  } catch (err) {
    // LLM failure must never crash the VIE pipeline
    logger.error(
      { err, target },
      'VIE synthesis: LLM call failed, returning algorithmic fallback',
    );
    return {
      explanation: buildFallbackExplanation(scores),
      evidence: algorithmicEvidence,
    };
  }
}
