#!/usr/bin/env node
/**
 * @clawnet/mcp — ClawNet MCP Server
 *
 * Exposes ClawNet's skill marketplace and AI orchestration engine as MCP tools,
 * enabling Claude Code, Cursor, Windsurf, and any MCP-compatible host to
 * discover and invoke 160+ AI skills natively.
 *
 * Setup (Claude Code):
 *   Add to ~/.claude/claude_code_config.json:
 *   {
 *     "mcpServers": {
 *       "clawnet": {
 *         "command": "npx",
 *         "args": ["-y", "@clawnet/mcp"],
 *         "env": {
 *           "CLAWNET_API_KEY": "your_api_key_here"
 *         }
 *       }
 *     }
 *   }
 *
 *   Get a free API key at https://claw-net.org
 *
 * Setup (Claude Desktop):
 *   Same config goes in claude_desktop_config.json.
 *
 * Setup (Cursor):
 *   Add to cursor MCP settings with the same JSON block above.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const CLAWNET_BASE_URL = process.env.CLAWNET_BASE_URL ?? 'https://api.claw-net.org';
const CLAWNET_API_KEY = process.env.CLAWNET_API_KEY ?? '';

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

async function invokeSkill(id: string, variables: Record<string, string>): Promise<unknown> {
  return fetchApi(`/v1/skills/${id}/invoke`, {
    method: 'POST',
    body: JSON.stringify({ variables }),
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const server = new McpServer({
    name: 'ClawNet',
    version: '1.0.0',
  });

  // ── Tool: list-skills ──────────────────────────────────────────────────────
  // @ts-expect-error MCP SDK deep generic inference exceeds TS depth limit
  server.tool(
    'list-skills',
    'Browse the ClawNet skill marketplace. Returns skills with IDs, descriptions, and credit costs. Browse before invoking to find the right skill.',
    {
      category: z.string().describe('Filter by category: defi | security | social | ai | search | media | enrichment | utility | solana | oracle | weather').optional(),
      search: z.string().describe('Search query to filter skills by name or description').optional(),
    },
    async ({ category, search }: { category?: string; search?: string }) => {
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
            type: 'text' as const,
            text: skills.length > 0
              ? `Found ${skills.length} skills:\n\n${text}`
              : 'No skills found matching your criteria.',
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: get-skill ────────────────────────────────────────────────────────
  server.tool(
    'get-skill',
    'Get full details about a ClawNet skill: input variables, pricing, and usage guidance.',
    {
      skillId: z.string().describe('The skill ID (from list-skills)'),
    },
    async ({ skillId }: { skillId: string }) => {
      try {
        const skill = await fetchApi(`/v1/marketplace/skills/${skillId}`) as SkillDetail;
        const vars = skill.inputSchema
          ? Object.entries(skill.inputSchema).map(([k, v]) => {
            const desc = typeof v === 'object' && v !== null ? (v as { description?: string }).description ?? k : String(v);
            return `  - {{${k}}}: ${desc}`;
          }).join('\n')
          : '  (no variables required)';

        return {
          content: [{
            type: 'text' as const,
            text: [
              `**${skill.displayName ?? skill.name}** (${skill.id})`,
              `Description: ${skill.description}`,
              `Cost: ${skill.creditCost} credits per invocation`,
              `Tags: ${(skill.tags ?? []).join(', ')}`,
              `\nInput Variables:\n${vars}`,
              `\nTo invoke: use invoke-skill with skillId="${skill.id}"`,
            ].join('\n'),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: invoke-skill ─────────────────────────────────────────────────────
  // @ts-expect-error MCP SDK deep generic inference exceeds TS depth limit
  server.tool(
    'invoke-skill',
    'Execute a ClawNet skill. Returns AI-generated analysis. Requires CLAWNET_API_KEY. Use list-skills first to find the right skill ID and required variables.',
    {
      skillId: z.string().describe('Skill ID to invoke (from list-skills)'),
      variables: z.record(z.string()).describe('Template variables as key-value pairs, e.g. {"token": "SOL", "depth": "standard"}').optional(),
    },
    async ({ skillId, variables }: { skillId: string; variables?: Record<string, string> }) => {
      if (!CLAWNET_API_KEY) {
        return {
          content: [{
            type: 'text' as const,
            text: 'CLAWNET_API_KEY not set.\n\nGet a free API key at https://claw-net.org, then add it to your MCP config:\n  "env": { "CLAWNET_API_KEY": "your_key" }',
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
        return { content: [{ type: 'text' as const, text: String(answer) + footer }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Skill invocation failed: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: orchestrate ──────────────────────────────────────────────────────
  server.tool(
    'orchestrate',
    'Run a natural-language query through ClawNet\'s AI orchestration engine. Automatically selects APIs, executes multi-step workflows, and returns a structured answer. Best for complex questions that need multiple data sources. Requires CLAWNET_API_KEY.',
    {
      query: z.string().describe('Your question or task (e.g. "Analyze the risk of holding SOL", "What are the trending DeFi protocols this week?")'),
      maxCredits: z.number().int().describe('Maximum credits to spend on this query (default: no cap)').optional(),
    },
    async ({ query, maxCredits }: { query: string; maxCredits?: number }) => {
      if (!CLAWNET_API_KEY) {
        return {
          content: [{
            type: 'text' as const,
            text: 'CLAWNET_API_KEY not set. Get one at https://claw-net.org',
          }],
          isError: true,
        };
      }
      try {
        const body: Record<string, unknown> = { query };
        if (maxCredits) body.pricing = { maxCredits };

        const result = await fetchApi('/v1/orchestrate', {
          method: 'POST',
          body: JSON.stringify(body),
        }) as Record<string, unknown>;

        const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
        const meta = result.metadata as Record<string, unknown> | undefined;
        const footer = meta
          ? `\n\n---\nCredits used: ${result.creditsCharged ?? '?'} | Steps: ${(result.steps as unknown[])?.length ?? '?'} | Duration: ${meta.durationMs ?? '?'}ms`
          : '';

        return { content: [{ type: 'text' as const, text: String(answer) + footer }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Orchestration failed: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: search-registry ──────────────────────────────────────────────────
  server.tool(
    'search-registry',
    'Search ClawNet\'s raw API endpoint registry (160+ endpoints across 60+ providers). Use this to discover what data is available before building a workflow.',
    {
      query: z.string().describe('What capability you need (e.g. "crypto price", "email finder", "web scraping", "whale tracking")'),
      category: z.string().describe('Filter by category: solana | social | defi | scraping | search | media | enrichment | security | ai-ml | infrastructure | weather | oracle | discovery').optional(),
    },
    async ({ query, category }: { query: string; category?: string }) => {
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
            type: 'text' as const,
            text: endpoints.length > 0
              ? `Found ${endpoints.length} endpoints for "${query}":\n\n${text}`
              : `No endpoints found for "${query}". Try a broader search.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  // ── Tool: get-credits ──────────────────────────────────────────────────────
  server.tool(
    'get-credits',
    'Check your ClawNet credit balance and usage. Requires CLAWNET_API_KEY.',
    {},
    async () => {
      if (!CLAWNET_API_KEY) {
        return {
          content: [{ type: 'text' as const, text: 'CLAWNET_API_KEY not set. Get a key at https://claw-net.org' }],
          isError: true,
        };
      }
      try {
        const data = await fetchApi('/v1/balance') as { credits?: number; creditsUsed?: number; amountPaid?: number };
        return {
          content: [{
            type: 'text' as const,
            text: [
              `ClawNet Balance:`,
              `  Credits remaining: ${(data.credits ?? 0).toLocaleString()}`,
              `  Credits used: ${(data.creditsUsed ?? 0).toLocaleString()}`,
              `  Total paid: $${((data.amountPaid ?? 0) / 100).toFixed(2)}`,
              ``,
              `Top up at https://claw-net.org`,
            ].join('\n'),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error: ${String(err)}` }], isError: true };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('ClawNet MCP server error:', err);
  process.exit(1);
});
