/**
 * skill-builder.ts — No-code skill builder (Phase 4, from Spectral)
 *
 * Natural language → skill definition. "Describe what you want" →
 * auto-generated prompt template + manifest + pricing.
 *
 * POST /v1/skills/build — creates a skill from a natural language description
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { checkApiKey } from '../middleware/auth';
import { getDb, logAudit } from '../db/connection';
import { round6 } from '../core/credits';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── POST /build — Natural language skill creation ───────────────────────────

router.post('/build', checkApiKey, async (c) => {
  const keyInfo = c.get('apiKeyInfo') as any;
  const body = await c.req.json().catch(() => null);

  if (!body || !body.description) {
    return c.json({
      error: 'Missing required field: description',
      code: 'SKILL_BUILD_INVALID',
      example: {
        description: 'Get the current price of any cryptocurrency',
        name: 'crypto-price',
        pricingHint: 'cheap',
      },
    }, 400);
  }

  const { description, name, pricingHint, tags } = body;

  if (description.length < 10 || description.length > 2000) {
    return c.json({ error: 'Description must be 10-2000 characters', code: 'SKILL_BUILD_INVALID' }, 400);
  }

  // Generate skill definition from description
  const skillId = name
    ? name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)
    : `skill-${nanoid(8)}`;

  // Extract likely variables from description
  const variables = extractVariables(description);

  // Determine pricing
  const creditCost = determinePricing(description, pricingHint);

  // Determine skill type
  const skillType = inferSkillType(description);

  // Build the prompt template
  const promptTemplate = buildPromptTemplate(description, variables);

  // Build manifest
  const manifest = {
    capabilities: inferCapabilities(description),
    inputs: Object.fromEntries(variables.map(v => [v, 'string'])),
    outputs: { result: 'string' },
    sla: { maxLatencyMs: 10000, guaranteedUptime: 0.95 },
  };

  try {
    // Check name uniqueness
    const existing = getDb().prepare(
      `SELECT id FROM skills WHERE id = ? OR name = ?`
    ).get(skillId, name || skillId);

    if (existing) {
      return c.json({ error: 'Skill name already taken', code: 'SKILL_NAME_TAKEN' }, 409);
    }

    // Insert the skill
    getDb().prepare(`
      INSERT INTO skills (id, name, description, skill_type, prompt_template,
                         creator_key, credit_cost, tags_json, manifest_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      skillId,
      name || skillId,
      description,
      skillType,
      promptTemplate,
      keyInfo.api_key_hash,
      creditCost,
      JSON.stringify(tags || inferTags(description)),
      JSON.stringify(manifest),
    );

    logAudit({
      entityType: 'skill', entityId: skillId, action: 'auto_built',
      actorId: keyInfo.api_key_hash, data: { description: description.slice(0, 100) },
    });

    return c.json({
      skillId,
      name: name || skillId,
      description,
      skillType,
      creditCost,
      variables,
      promptTemplate,
      manifest,
      tags: tags || inferTags(description),
      message: 'Skill created from description. You can now invoke it or customize the prompt template.',
      invokeUrl: `/v1/skills/${skillId}/invoke`,
    }, 201);
  } catch (err: any) {
    logger.error({ err }, 'Skill builder failed');
    return c.json({ error: 'Skill creation failed', code: 'SKILL_BUILD_ERROR' }, 500);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractVariables(description: string): string[] {
  const vars: string[] = [];
  const lower = description.toLowerCase();

  // Common patterns that suggest variables
  if (lower.includes('any ') || lower.includes('given ') || lower.includes('specific ')) {
    // Look for nouns after "any/given/specific"
    const match = lower.match(/(?:any|given|specific|a)\s+(\w+)/g);
    if (match) {
      for (const m of match) {
        const noun = m.split(/\s+/).pop();
        if (noun && noun.length > 2 && !['the', 'and', 'for', 'with'].includes(noun)) {
          vars.push(noun);
        }
      }
    }
  }

  // Detect common variable patterns
  if (lower.includes('token') || lower.includes('crypto') || lower.includes('coin')) vars.push('token');
  if (lower.includes('address') || lower.includes('wallet')) vars.push('address');
  if (lower.includes('query') || lower.includes('search') || lower.includes('question')) vars.push('query');
  if (lower.includes('url') || lower.includes('website') || lower.includes('link')) vars.push('url');
  if (lower.includes('date') || lower.includes('time') || lower.includes('period')) vars.push('timeframe');

  // Deduplicate
  return [...new Set(vars)].slice(0, 5);
}

function determinePricing(description: string, hint?: string): number {
  if (hint === 'free') return 0.001;
  if (hint === 'cheap') return 0.5;
  if (hint === 'standard') return 2;
  if (hint === 'premium') return 10;

  const lower = description.toLowerCase();
  if (lower.includes('simple') || lower.includes('basic') || lower.includes('price')) return 0.5;
  if (lower.includes('analyze') || lower.includes('complex') || lower.includes('multi')) return 5;
  if (lower.includes('trade') || lower.includes('execute') || lower.includes('swap')) return 10;
  return 2; // default
}

function inferSkillType(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes('data') || lower.includes('price') || lower.includes('fetch') || lower.includes('get')) return 'data';
  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('proxy')) return 'api_proxy';
  return 'prompt_template';
}

function buildPromptTemplate(description: string, variables: string[]): string {
  const varList = variables.map(v => `{{${v}}}`).join(', ');
  return `You are an AI assistant that performs the following task:\n\n${description}\n\n` +
    (variables.length > 0 ? `Input variables: ${varList}\n\n` : '') +
    'Provide a clear, accurate, and concise response.';
}

function inferCapabilities(description: string): string[] {
  const caps: string[] = [];
  const lower = description.toLowerCase();
  if (lower.includes('price') || lower.includes('data') || lower.includes('fetch')) caps.push('data_query');
  if (lower.includes('analyze') || lower.includes('analysis')) caps.push('analysis');
  if (lower.includes('trade') || lower.includes('swap') || lower.includes('defi')) caps.push('defi_action');
  if (lower.includes('search') || lower.includes('find')) caps.push('search');
  if (lower.includes('generate') || lower.includes('create') || lower.includes('write')) caps.push('generation');
  return caps.length > 0 ? caps : ['general'];
}

function inferTags(description: string): string[] {
  const tags: string[] = [];
  const lower = description.toLowerCase();
  if (lower.includes('crypto') || lower.includes('token') || lower.includes('blockchain')) tags.push('crypto');
  if (lower.includes('defi') || lower.includes('swap') || lower.includes('liquidity')) tags.push('defi');
  if (lower.includes('data') || lower.includes('api')) tags.push('data');
  if (lower.includes('ai') || lower.includes('ml') || lower.includes('analysis')) tags.push('ai');
  if (lower.includes('solana') || lower.includes('sol')) tags.push('solana');
  if (lower.includes('ethereum') || lower.includes('eth')) tags.push('ethereum');
  return tags.length > 0 ? tags : ['general'];
}

export { router as skillBuilderRouter };
