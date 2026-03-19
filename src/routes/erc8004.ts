/**
 * ERC-8004 compatibility routes — on-chain agent economy discovery
 *
 * Exposes ClawNet skills in ERC-8004 standard format so any ERC-8004-aware
 * agent can discover and interact with them. All endpoints are public (no auth).
 */
import { Hono } from 'hono';
import { env } from '../config/index';
import {
  listPublicSkills, countPublicSkills,
  safeJsonParse,
} from '../db/index';
import type { Skill } from '../db/index';

const router = new Hono();

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildSkillEntry(skill: Skill) {
  const inputSchema = safeJsonParse<Record<string, unknown> | null>(skill.input_schema_json, null);
  const outputSchema = safeJsonParse<Record<string, unknown> | null>(skill.output_schema_json, null);
  const tags = safeJsonParse<string[]>(skill.tags_json, []);

  return {
    id: skill.id,
    name: skill.display_name ?? skill.name,
    description: skill.description,
    tags,
    inputSchema: inputSchema ?? { type: 'object', properties: {} },
    outputSchema: outputSchema ?? { type: 'object', properties: {} },
    pricing: {
      model: 'per_call',
      creditCost: skill.credit_cost,
      currency: 'USDC',
      estimatedCostUsd: skill.credit_cost / env.CREDITS_PER_USD,
    },
  };
}

// ── GET /v1/erc8004/catalog — paginated ERC-8004 catalog of all public skills ─

router.get('/catalog', (c) => {
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const skillType = c.req.query('type') || undefined;
  const tag = c.req.query('tag') || undefined;

  const skills = listPublicSkills(offset, limit, skillType, tag);
  const total = countPublicSkills(skillType, tag);

  return c.json({
    schemaVersion: '1.0.0',
    provider: {
      name: 'ClawNet',
      url: 'https://claw-net.org',
      contact: 'team@claw-net.org',
    },
    agents: skills.map((skill) => ({
      agentId: `clawnet-${skill.id}`,
      name: `ClawNet: ${skill.display_name ?? skill.name}`,
      description: skill.description,
      url: env.CLAWNET_BASE_URL,
      skills: [buildSkillEntry(skill)],
      reputation: {
        totalInvocations: skill.uses,
        avgRating: skill.avg_rating,
        successRate: skill.success_rate,
        verified: skill.security_status === 'VERIFIED',
      },
    })),
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + limit < total,
    },
  });
});

export { router as erc8004Router };
