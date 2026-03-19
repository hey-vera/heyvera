/**
 * ClawNet MCP Server
 *
 * Exposes ClawNet public skills as MCP tools so AI agents in Claude Code,
 * Cursor, VSCode, Windsurf, and other MCP-compatible hosts can discover and
 * invoke them natively — no account or API key required for browsing.
 *
 * Usage:
 *   npx tsx src/mcp/server.ts
 *
 * Claude Desktop config (~/.claude/config.json or claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "clawnet": {
 *         "command": "npx",
 *         "args": ["tsx", "src/mcp/server.ts"],
 *         "cwd": "/path/to/claw-net",
 *         "env": { "CLAWNET_API_KEY": "your_api_key", "CLAWNET_BASE_URL": "https://api.claw-net.org" }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { env } from '../config/index';
const CLAWNET_BASE_URL = env.CLAWNET_BASE_URL;
const CLAWNET_API_KEY = env.CLAWNET_API_KEY ?? '';

type Skill = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  creditCost: number;
  tags: string[];
  inputSchema?: Record<string, unknown>;
};

type SkillDetail = Skill & {
  promptTemplate?: string;
  inputSchema?: Record<string, { type?: string; description?: string }>;
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchApi(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${CLAWNET_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(CLAWNET_API_KEY ? { 'X-API-Key': CLAWNET_API_KEY } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`ClawNet API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function listSkills(): Promise<Skill[]> {
  const data = await fetchApi('/v1/marketplace/skills?sort=popular&limit=50') as { skills?: Skill[] };
  return data.skills ?? [];
}

async function getSkillDetail(id: string): Promise<SkillDetail> {
  return fetchApi(`/v1/marketplace/skills/${id}`) as Promise<SkillDetail>;
}

async function invokeSkill(id: string, variables: Record<string, string>): Promise<unknown> {
  return fetchApi(`/v1/skills/${id}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ variables }),
  });
}

// ─── Build MCP tool schema from skill inputSchema ─────────────────────────────

function buildToolSchema(skill: SkillDetail): Record<string, z.ZodTypeAny> {
  const schema: Record<string, z.ZodTypeAny> = {};

  if (skill.inputSchema && typeof skill.inputSchema === 'object') {
    for (const [key, def] of Object.entries(skill.inputSchema)) {
      const desc = typeof def === 'object' && def !== null
        ? (def as { description?: string }).description ?? key
        : String(def);
      schema[key] = z.string().describe(desc).optional();
    }
  }

  return schema;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const server = new McpServer({
    name: 'ClawNet',
    version: '1.0.0',
  });

  // ── Tool: list-skills ──────────────────────────────────────────────────────
  // @ts-expect-error TS2589: MCP SDK deep generic inference exceeds TS depth limit
  server.tool(
    'list-skills',
    'Browse the ClawNet skill marketplace. Returns public skills with IDs, descriptions, and credit costs. Pricing: Free (read-only, no credits charged).',
    {
      category: z.string().describe('Filter by category (optional): defi | security | social | ai | search | media | enrichment | utility').optional(),
      search: z.string().describe('Search query to filter skills by name or description (optional)').optional(),
    },
    async ({ category, search }) => {
      try {
        let path = '/v1/marketplace/skills?sort=popular&limit=50';
        if (search) path += `&q=${encodeURIComponent(search)}`;
        if (category) path += `&category=${encodeURIComponent(category)}`;
        const data = await fetchApi(path) as { skills?: Skill[] };
        const skills = data.skills ?? [];

        const text = skills.map((s) =>
          `• ${s.displayName ?? s.name} (id: ${s.id})\n  ${s.description}\n  Cost: ${s.creditCost} credits | Tags: ${(s.tags ?? []).join(', ')}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: skills.length > 0
              ? `Found ${skills.length} skills:\n\n${text}`
              : 'No skills found matching your criteria.',
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: get-skill ────────────────────────────────────────────────────────
  server.tool(
    'get-skill',
    'Get full details about a ClawNet skill including input variables, pricing, and usage examples. Pricing: Free (read-only, no credits charged).',
    {
      skillId: z.string().describe('The skill ID (from list-skills)'),
    },
    async ({ skillId }) => {
      try {
        const skill = await getSkillDetail(skillId);
        const vars = skill.inputSchema
          ? Object.entries(skill.inputSchema).map(([k, v]) => {
            const desc = typeof v === 'object' && v !== null ? (v as { description?: string }).description ?? k : String(v);
            return `  - {{${k}}}: ${desc}`;
          }).join('\n')
          : '  (no variables required)';

        return {
          content: [{
            type: 'text',
            text: [
              `**${skill.displayName ?? skill.name}** (${skill.id})`,
              `Description: ${skill.description}`,
              `Cost: ${skill.creditCost} credits per invocation`,
              `Tags: ${(skill.tags ?? []).join(', ')}`,
              `\nInput Variables:\n${vars}`,
              `\nTo invoke: use the invoke-skill tool with skillId="${skill.id}"`,
            ].join('\n'),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: invoke-skill ─────────────────────────────────────────────────────
  // @ts-expect-error TS2589: MCP SDK deep generic inference exceeds TS depth limit
  server.tool(
    'invoke-skill',
    'Execute a ClawNet skill with the provided variables. Returns AI-generated analysis. Requires CLAWNET_API_KEY env var. Pricing: Varies by skill (0.1-50 credits, $0.0001-$0.05 USDC per call).',
    {
      skillId: z.string().describe('The skill ID to invoke'),
      variables: z.record(z.string()).describe('Key-value pairs for the skill\'s template variables (e.g. {"token": "SOL", "depth": "standard"})').optional(),
    },
    async ({ skillId, variables }) => {
      if (!CLAWNET_API_KEY) {
        return {
          content: [{
            type: 'text',
            text: 'ClawNet API key required. Set CLAWNET_API_KEY in the MCP server environment.\nGet a key at https://claw-net.org',
          }],
          isError: true,
        };
      }
      try {
        const result = await invokeSkill(skillId, variables ?? {}) as Record<string, unknown>;
        const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
        const meta = result.metadata as Record<string, unknown> | undefined;
        const footer = meta
          ? `\n\n---\nCost: ${result.creditsCharged ?? '?'} credits | Duration: ${meta.durationMs ?? '?'}ms`
          : '';
        return {
          content: [{ type: 'text', text: String(answer) + footer }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Skill invocation failed: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: search-registry ──────────────────────────────────────────────────
  server.tool(
    'search-registry',
    'Search ClawNet\'s API endpoint registry (158+ endpoints across 60+ providers). Find the right API for any task. Pricing: Free (read-only, no credits charged).',
    {
      query: z.string().describe('What capability you need (e.g. "web scraping", "crypto price", "email finder", "speech to text")'),
      category: z.string().describe('Filter by category: solana | social | defi | scraping | search | media | enrichment | security | ai-ml | infrastructure | weather | oracle | discovery').optional(),
    },
    async ({ query, category }) => {
      try {
        let path = `/v1/endpoints?q=${encodeURIComponent(query)}`;
        if (category) path += `&category=${encodeURIComponent(category)}`;
        const data = await fetchApi(path) as { endpoints?: Array<{ id: string; name: string; description: string; provider: string; category: string; costPerCall: number }> };
        const endpoints = data.endpoints ?? [];

        const text = endpoints.slice(0, 20).map((e) =>
          `• ${e.name} (${e.id})\n  Provider: ${e.provider} | Category: ${e.category} | Cost: $${e.costPerCall}/call\n  ${e.description}`
        ).join('\n\n');

        return {
          content: [{
            type: 'text',
            text: endpoints.length > 0
              ? `Found ${endpoints.length} endpoints for "${query}":\n\n${text}`
              : `No endpoints found for "${query}". Try a broader search term.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: orchestrate ──────────────────────────────────────────────────────
  server.tool(
    'orchestrate',
    'Run a free-form query through ClawNet\'s AI orchestration engine. Automatically selects APIs, executes multi-step workflows, and returns formatted analysis. Requires CLAWNET_API_KEY. Pricing: Starting at 2 credits ($0.002 USDC) base fee + variable API costs.',
    {
      query: z.string().describe('Your question or task (e.g. "Analyze the risk of holding SOL", "Find me leads at fintech companies in NYC")'),
    },
    async ({ query }) => {
      if (!CLAWNET_API_KEY) {
        return {
          content: [{
            type: 'text',
            text: 'ClawNet API key required. Set CLAWNET_API_KEY. Get one at https://claw-net.org',
          }],
          isError: true,
        };
      }
      try {
        const result = await fetchApi('/v1/orchestrate', {
          method: 'POST',
          body: JSON.stringify({ query }),
        }) as Record<string, unknown>;

        const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
        const meta = result.metadata as Record<string, unknown> | undefined;
        const footer = meta
          ? `\n\n---\nCredits used: ${result.creditsCharged ?? '?'} | Steps: ${(result.steps as unknown[])?.length ?? '?'} | Duration: ${meta.durationMs ?? '?'}ms`
          : '';

        return {
          content: [{ type: 'text', text: String(answer) + footer }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Orchestration failed: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: get-credits ──────────────────────────────────────────────────────
  server.tool(
    'get-credits',
    'Check your ClawNet credit balance. Requires CLAWNET_API_KEY. Pricing: Free (read-only, no credits charged).',
    {},
    async () => {
      if (!CLAWNET_API_KEY) {
        return {
          content: [{ type: 'text', text: 'CLAWNET_API_KEY not set. Get a key at https://claw-net.org' }],
          isError: true,
        };
      }
      try {
        const data = await fetchApi('/v1/dashboard/credits') as { credits?: number; amountPaid?: number };
        return {
          content: [{
            type: 'text',
            text: `ClawNet Balance:\n  Credits: ${data.credits ?? 0}\n  Total paid: $${data.amountPaid ?? 0}\n\nTop up at https://claw-net.org`,
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Connect via stdio transport ────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ClawNet MCP server error:', err);
  process.exit(1);
});
