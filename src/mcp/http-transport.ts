/**
 * HTTP MCP Transport for ClawNet
 *
 * Serves ClawNet's MCP tools over HTTP so AI agents can connect remotely
 * without installing anything. Supports the streamable-http MCP transport.
 *
 * Mount at: POST /mcp (main MCP endpoint)
 *           GET /mcp (SSE stream for server-initiated messages)
 *           DELETE /mcp (close session)
 */

import { Hono } from 'hono';
import { env } from '../config/index';
import { apiRegistry, getRegistryStats } from '../config/api-registry';
import { logger } from '../utils/logger';

const router = new Hono();

// ─── Types ───────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

// ─── Session store ───────────────────────────────────────────────────────────

const sessions = new Map<string, { lastActivity: number }>();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 100;

// ─── Fetch helpers (mirrors server.ts) ───────────────────────────────────────

const CLAWNET_BASE_URL = env.CLAWNET_BASE_URL;
const CLAWNET_API_KEY = env.CLAWNET_API_KEY ?? '';

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

// ─── Per-tool credit costs for paid MCP operations ──────────────────────────

const TOOL_PRICING: Record<string, number> = {
  'invoke-skill': 0, // dynamic — based on skill credit_cost
  'orchestrate': 2, // ORCHESTRATION_FEE
  'list-skills': 0,
  'get-skill': 0,
  'search-registry': 0,
  'get-credits': 0,
};

// ─── Tool definitions and handlers ──────────────────────────────────────────

const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list-skills',
    description: 'Browse the ClawNet skill marketplace. Returns public skills with IDs, descriptions, and credit costs.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (optional): defi | security | social | ai | search | media | enrichment | utility' },
        search: { type: 'string', description: 'Search query to filter skills by name or description (optional)' },
      },
    },
  },
  {
    name: 'get-skill',
    description: 'Get full details about a ClawNet skill including input variables, pricing, and usage examples.',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'The skill ID (from list-skills)' },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'invoke-skill',
    description: 'Execute a ClawNet skill with the provided variables. Returns AI-generated analysis. Requires CLAWNET_API_KEY env var. (costs skill\'s credit_cost per call)',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'The skill ID to invoke' },
        variables: { type: 'object', description: 'Key-value pairs for the skill\'s template variables', additionalProperties: { type: 'string' } },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'search-registry',
    description: `Search ClawNet's API endpoint registry (${apiRegistry.length}+ endpoints across ${Object.keys(getRegistryStats().byProvider).length}+ providers). Find the right API for any task.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What capability you need (e.g. "web scraping", "crypto price", "email finder")' },
        category: { type: 'string', description: 'Filter by category: solana | social | defi | scraping | search | media | enrichment | security | ai-ml | infrastructure | weather | oracle | discovery' },
      },
      required: ['query'],
    },
  },
  {
    name: 'orchestrate',
    description: 'Run a free-form query through ClawNet\'s AI orchestration engine. Automatically selects APIs, executes multi-step workflows, and returns formatted analysis. Requires CLAWNET_API_KEY. (costs 2 credits per query)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Your question or task (e.g. "Analyze the risk of holding SOL")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get-credits',
    description: 'Check your ClawNet credit balance. Requires CLAWNET_API_KEY.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

const toolHandlers: Record<string, ToolHandler> = {
  'list-skills': async (args) => {
    try {
      let path = '/v1/marketplace/skills?sort=popular&limit=50';
      if (args.search) path += `&q=${encodeURIComponent(String(args.search))}`;
      if (args.category) path += `&category=${encodeURIComponent(String(args.category))}`;
      const data = await fetchApi(path) as { skills?: Array<{ id: string; displayName?: string; name: string; description: string; creditCost: number; tags?: string[] }> };
      const skills = data.skills ?? [];

      const text = skills.map((s) =>
        `- ${s.displayName ?? s.name} (id: ${s.id})\n  ${s.description}\n  Cost: ${s.creditCost} credits | Tags: ${(s.tags ?? []).join(', ')}`
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

  'get-skill': async (args) => {
    try {
      const skill = await fetchApi(`/v1/marketplace/skills/${args.skillId}`) as {
        id: string; displayName?: string; name: string; description: string; creditCost: number; tags?: string[];
        inputSchema?: Record<string, { description?: string }>;
      };
      const vars = skill.inputSchema
        ? Object.entries(skill.inputSchema).map(([k, v]) => {
          const desc = typeof v === 'object' && v !== null ? v.description ?? k : String(v);
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

  'invoke-skill': async (args) => {
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
      const variables = (args.variables as Record<string, string>) ?? {};
      const result = await fetchApi(`/v1/skills/${args.skillId}/invoke`, {
        method: 'POST',
        body: JSON.stringify({ variables }),
      }) as Record<string, unknown>;
      const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
      const meta = result.metadata as Record<string, unknown> | undefined;
      const footer = meta
        ? `\n\n---\nCost: ${result.creditsCharged ?? '?'} credits | Duration: ${meta.durationMs ?? '?'}ms`
        : '';
      return { content: [{ type: 'text', text: String(answer) + footer }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Skill invocation failed: ${String(err)}` }], isError: true };
    }
  },

  'search-registry': async (args) => {
    try {
      let path = `/v1/endpoints?q=${encodeURIComponent(String(args.query))}`;
      if (args.category) path += `&category=${encodeURIComponent(String(args.category))}`;
      const data = await fetchApi(path) as { endpoints?: Array<{ id: string; name: string; description: string; provider: string; category: string; costPerCall: number }> };
      const endpoints = data.endpoints ?? [];

      const text = endpoints.slice(0, 20).map((e) =>
        `- ${e.name} (${e.id})\n  Provider: ${e.provider} | Category: ${e.category} | Cost: $${e.costPerCall}/call\n  ${e.description}`
      ).join('\n\n');

      return {
        content: [{
          type: 'text',
          text: endpoints.length > 0
            ? `Found ${endpoints.length} endpoints for "${args.query}":\n\n${text}`
            : `No endpoints found for "${args.query}". Try a broader search term.`,
        }],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true };
    }
  },

  'orchestrate': async (args) => {
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
        body: JSON.stringify({ query: args.query }),
      }) as Record<string, unknown>;

      const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
      const meta = result.metadata as Record<string, unknown> | undefined;
      const footer = meta
        ? `\n\n---\nCredits used: ${result.creditsCharged ?? '?'} | Steps: ${(result.steps as unknown[])?.length ?? '?'} | Duration: ${meta.durationMs ?? '?'}ms`
        : '';

      return { content: [{ type: 'text', text: String(answer) + footer }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Orchestration failed: ${String(err)}` }], isError: true };
    }
  },

  'get-credits': async () => {
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
};

// ─── Server capabilities ─────────────────────────────────────────────────────

const SERVER_INFO = {
  protocolVersion: '2025-03-26',
  capabilities: {
    tools: { listChanged: false },
  },
  serverInfo: {
    name: 'ClawNet',
    version: '1.0.0',
  },
};

// ─── JSON-RPC helpers ────────────────────────────────────────────────────────

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function touchSession(sessionId: string): void {
  if (sessions.size >= MAX_SESSIONS && !sessions.has(sessionId)) {
    // Evict oldest session
    let oldestId: string | undefined;
    let oldestTime = Infinity;
    for (const [id, s] of sessions) {
      if (s.lastActivity < oldestTime) {
        oldestTime = s.lastActivity;
        oldestId = id;
      }
    }
    if (oldestId) sessions.delete(oldestId);
  }
  sessions.set(sessionId, { lastActivity: Date.now() });
}

// ─── Handle a single JSON-RPC request ───────────────────────────────────────

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize':
      return jsonRpcSuccess(id, SERVER_INFO);

    case 'notifications/initialized':
      // Client acknowledgement — no response needed, but return success if id present
      return jsonRpcSuccess(id, {});

    case 'ping':
      return jsonRpcSuccess(id, {});

    case 'tools/list':
      return jsonRpcSuccess(id, {
        tools: toolDefinitions,
      });

    case 'tools/call': {
      const params = req.params ?? {};
      const toolName = params.name as string | undefined;
      const toolArgs = (params.arguments as Record<string, unknown>) ?? {};

      if (!toolName || !toolHandlers[toolName]) {
        return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
      }

      if (TOOL_PRICING[toolName] > 0 && !CLAWNET_API_KEY) {
        return jsonRpcSuccess(id, {
          content: [{ type: 'text', text: `Tool "${toolName}" requires credits. Set CLAWNET_API_KEY in environment.` }],
          isError: true,
        });
      }

      try {
        const result = await toolHandlers[toolName](toolArgs);
        return jsonRpcSuccess(id, result);
      } catch (err) {
        return jsonRpcSuccess(id, {
          content: [{ type: 'text', text: `Tool execution error: ${String(err)}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

// ─── POST /mcp — handle MCP JSON-RPC messages ──────────────────────────────

router.post('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id') ?? crypto.randomUUID();
  touchSession(sessionId);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(jsonRpcError(null, -32700, 'Parse error'), 400);
  }

  c.header('Mcp-Session-Id', sessionId);

  // Handle batch requests
  if (Array.isArray(body)) {
    const requests = body as JsonRpcRequest[];
    if (requests.length === 0) {
      return c.json(jsonRpcError(null, -32600, 'Empty batch'), 400);
    }
    if (requests.length > 20) {
      return c.json(jsonRpcError(null, -32600, 'Batch too large — max 20 requests'), 400);
    }

    const responses = await Promise.all(
      requests.map((req) => handleRequest(req))
    );

    // Filter out notifications (requests without id)
    const filtered = responses.filter((_, i) => requests[i].id !== undefined);
    return filtered.length > 0
      ? c.json(filtered)
      : c.body(null, 204);
  }

  // Single request
  const req = body as JsonRpcRequest;
  if (!req.jsonrpc || req.jsonrpc !== '2.0' || !req.method) {
    return c.json(jsonRpcError(req.id ?? null, -32600, 'Invalid JSON-RPC request'), 400);
  }

  // Notifications (no id) don't expect a response
  if (req.id === undefined) {
    await handleRequest(req);
    return c.body(null, 204);
  }

  const response = await handleRequest(req);
  return c.json(response);
});

// ─── GET /mcp — SSE endpoint for server-initiated messages ──────────────────

router.get('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id') ?? crypto.randomUUID();
  touchSession(sessionId);

  c.header('Mcp-Session-Id', sessionId);
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return c.body(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        // Send initial endpoint event per streamable-http spec
        controller.enqueue(encoder.encode(`event: endpoint\ndata: /mcp\n\n`));

        // Keep-alive ping every 30s
        const interval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            clearInterval(interval);
          }
        }, 30_000);

        // Clean up when client disconnects
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(interval);
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    }),
  );
});

// ─── DELETE /mcp — close session ────────────────────────────────────────────

router.delete('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  if (sessionId) {
    sessions.delete(sessionId);
    logger.debug({ sessionId }, 'MCP HTTP session closed');
  }
  return c.json({ ok: true });
});

// ─── GET /mcp/info — human-readable info page ──────────────────────────────

router.get('/info', (c) => {
  return c.json({
    name: 'ClawNet MCP Server',
    version: '1.0.0',
    transport: 'streamable-http',
    description: 'Remote MCP server for ClawNet skill marketplace and orchestration',
    tools: toolDefinitions.map((t) => t.name),
    pricing: {
      model: 'per-tool',
      freeTier: ['list-skills', 'get-skill', 'search-registry', 'get-credits'],
      paidTools: {
        'invoke-skill': 'skill credit_cost per call',
        'orchestrate': '2 credits per query',
      },
      note: 'Paid tools require CLAWNET_API_KEY. Free tools work without authentication.',
    },
    usage: {
      claude: `claude mcp add-json clawnet '{"type":"url","url":"${CLAWNET_BASE_URL}/mcp"}'`,
      curl: `curl -X POST ${CLAWNET_BASE_URL}/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`,
    },
    docs: 'https://claw-net.org/docs/mcp',
  });
});

// ─── Periodic session cleanup ───────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 60_000);

export { router as mcpHttpRouter };
