import { llmComplete } from '../providers/llm';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface GeneratedSkill {
  name: string;
  description: string;
  skill_type: 'api_proxy' | 'prompt_template' | 'data';
  credit_cost: number;
  tags: string[];
  prompt_template?: string;
  proxy_url?: string;
  sample_output_json?: string;
  input_schema?: Record<string, unknown>;
  output_fields?: string[];
  suggested_pricing?: { creditCost: number; reason: string };
}

// ─── Prompt ─────────────────────────────────────────────────────────────────────

function buildPrompt(description: string): string {
  return `You are a ClawNet skill architect. A creator described a skill they want to build:

"${description}"

Generate a complete skill configuration. Return ONLY valid JSON with no markdown fences or extra text:
{
  "name": "slug-name",
  "description": "Clear description of what this skill does",
  "skill_type": "prompt_template" | "api_proxy" | "data",
  "credit_cost": <number, typically 0.5-5>,
  "tags": ["tag1", "tag2"],
  "prompt_template": "<if prompt_template type: the actual prompt with {{variables}}>",
  "proxy_url": "<if api_proxy type: the URL to proxy>",
  "sample_output_json": "<if data type: example JSON output as a string>",
  "input_schema": { "type": "object", "properties": { ... } },
  "output_fields": ["field1", "field2"],
  "suggested_pricing": { "creditCost": <number>, "reason": "..." }
}

Rules:
- name must be a lowercase slug (letters, numbers, hyphens only)
- If the description mentions a URL, use skill_type "api_proxy" and set proxy_url
- If the description is about generating text or analysis, use "prompt_template" and set prompt_template
- If the description is about structured/tabular data, use "data" and set sample_output_json
- Only include fields relevant to the chosen skill_type
- credit_cost should reflect complexity: simple=0.5-1, moderate=1-3, complex=3-5
- tags should be 2-4 relevant lowercase keywords`;
}

// ─── Generator ──────────────────────────────────────────────────────────────────

/**
 * Generate a complete skill configuration from a plain English description
 * using the configured LLM provider.
 */
export async function generateSkillFromDescription(
  description: string,
  _creatorKey: string,
): Promise<GeneratedSkill | null> {
  if (!description || description.trim().length < 10) {
    logger.warn('Skill description too short for generation');
    return null;
  }

  try {
    const response = await llmComplete(
      [
        { role: 'system', content: 'You are a JSON-only skill configuration generator. Output raw JSON only.' },
        { role: 'user', content: buildPrompt(description.trim()) },
      ],
      'synthesis',
    );

    const raw = response.content.trim();

    // Strip markdown code fences if the LLM included them
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      logger.error({ raw: cleaned.slice(0, 200) }, 'LLM returned invalid JSON for skill generation');
      return null;
    }

    // Validate required fields
    const name = parsed.name as string | undefined;
    const desc = parsed.description as string | undefined;
    const skillType = parsed.skill_type as string | undefined;

    if (!name || !desc || !skillType) {
      logger.error({ parsed }, 'LLM response missing required fields');
      return null;
    }

    if (!['api_proxy', 'prompt_template', 'data'].includes(skillType)) {
      logger.error({ skillType }, 'LLM returned invalid skill_type');
      return null;
    }

    const result: GeneratedSkill = {
      name: String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''),
      description: String(desc),
      skill_type: skillType as GeneratedSkill['skill_type'],
      credit_cost: typeof parsed.credit_cost === 'number' ? parsed.credit_cost : 1,
      tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]).map(String) : [],
    };

    // Attach type-specific fields
    if (skillType === 'prompt_template' && parsed.prompt_template) {
      result.prompt_template = String(parsed.prompt_template);
    }
    if (skillType === 'api_proxy' && parsed.proxy_url) {
      result.proxy_url = String(parsed.proxy_url);
    }
    if (skillType === 'data' && parsed.sample_output_json) {
      result.sample_output_json = typeof parsed.sample_output_json === 'string'
        ? parsed.sample_output_json
        : JSON.stringify(parsed.sample_output_json);
    }
    if (parsed.input_schema && typeof parsed.input_schema === 'object') {
      result.input_schema = parsed.input_schema as Record<string, unknown>;
    }
    if (Array.isArray(parsed.output_fields)) {
      result.output_fields = (parsed.output_fields as string[]).map(String);
    }
    if (parsed.suggested_pricing && typeof parsed.suggested_pricing === 'object') {
      const sp = parsed.suggested_pricing as Record<string, unknown>;
      result.suggested_pricing = {
        creditCost: typeof sp.creditCost === 'number' ? sp.creditCost : result.credit_cost,
        reason: typeof sp.reason === 'string' ? sp.reason : 'Auto-generated pricing',
      };
    }

    logger.info({ name: result.name, type: result.skill_type }, 'Skill generated from description');
    return result;
  } catch (err) {
    logger.error({ err }, 'Failed to generate skill from description');
    return null;
  }
}
