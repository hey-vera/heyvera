/**
 * x402-Gated MCP Transport for ClawNet
 *
 * Serves the same MCP tools as http-transport.ts but gates paid tool calls
 * (invoke-skill, orchestrate) behind x402 USDC payments on Base.
 * Free tools (list-skills, get-skill, search-registry, get-credits) pass
 * through without payment.
 *
 * Mount at: POST /mcp/x402  (JSON-RPC endpoint)
 *           GET  /mcp/x402  (SSE for server-initiated messages)
 *           GET  /mcp/x402/info (discovery + pricing)
 *
 * This only activates if X402_RECIPIENT_ADDRESS is set in env.
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { env } from '../config/index';
import { logger } from '../utils/logger';
import { getDb, getSkill } from '../db/index';

// ─── x402 imports (CJS interop — same pattern as x402-skills.ts) ──────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HTTPFacilitatorClient } = require('@x402/core/server') as {
  HTTPFacilitatorClient: new (url: string) => {
    verifyPayment: (paymentHeader: string, paymentRequirements: unknown) => Promise<{ valid: boolean; receipt?: unknown; error?: string }>;
  };
};

// ─── Types ────────────────────────────────────────────────────────────────────

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

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

// ─── Session store ────────────────────────────────────────────────────────────

const sessions = new Map<string, { lastActivity: number }>();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 100;

function touchSession(sessionId: string): void {
  if (sessions.size >= MAX_SESSIONS && !sessions.has(sessionId)) {
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

// ─── Fetch helpers (same as http-transport.ts) ────────────────────────────────

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

// ─── Tool pricing (credits) — matches http-transport.ts ───────────────────────

const TOOL_PRICING: Record<string, number> = {
  'invoke-skill': 0,    // dynamic — based on skill credit_cost
  'orchestrate': 2,     // ORCHESTRATION_FEE
  'list-skills': 0,
  'get-skill': 0,
  'search-registry': 0,
  'get-credits': 0,
};

/** Tools that require x402 payment */
const PAID_TOOLS = new Set(['invoke-skill', 'orchestrate']);

// ─── Tool definitions ─────────────────────────────────────────────────────────

const toolDefinitions = [
  {
    name: 'list-skills',
    description: 'Browse the ClawNet skill marketplace. Returns public skills with IDs, descriptions, and credit costs. (free — no payment required)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string', description: 'Filter by category (optional): defi | security | social | ai | search | media | enrichment | utility' },
        search: { type: 'string', description: 'Search query to filter skills by name or description (optional)' },
      },
    },
  },
  {
    name: 'get-skill',
    description: 'Get full details about a ClawNet skill including input variables, pricing, and usage examples. (free — no payment required)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        skillId: { type: 'string', description: 'The skill ID (from list-skills)' },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'invoke-skill',
    description: 'Execute a ClawNet skill with the provided variables. Returns AI-generated analysis. Payment: skill credit_cost * $0.001 USDC on Base.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        skillId: { type: 'string', description: 'The skill ID to invoke' },
        variables: { type: 'object', description: 'Key-value pairs for the skill\'s template variables', additionalProperties: { type: 'string' } },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'search-registry',
    description: 'Search ClawNet\'s API endpoint registry (158+ endpoints across 60+ providers). Find the right API for any task. (free — no payment required)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What capability you need (e.g. "web scraping", "crypto price", "email finder")' },
        category: { type: 'string', description: 'Filter by category: solana | social | defi | scraping | search | media | enrichment | security | ai-ml | infrastructure | weather | oracle | discovery' },
      },
      required: ['query'],
    },
  },
  {
    name: 'orchestrate',
    description: 'Run a free-form query through ClawNet\'s AI orchestration engine. Automatically selects APIs, executes multi-step workflows, and returns formatted analysis. Payment: $0.002 USDC on Base.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Your question or task (e.g. "Analyze the risk of holding SOL")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get-credits',
    description: 'Check your ClawNet credit balance. (free — no payment required, but requires CLAWNET_API_KEY on server)',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ─── Tool handlers (same logic as http-transport.ts) ──────────────────────────

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

      const priceUsdc = (Math.max(skill.creditCost, 1) * env.X402_USDC_PER_CREDIT).toFixed(6);

      return {
        content: [{
          type: 'text',
          text: [
            `**${skill.displayName ?? skill.name}** (${skill.id})`,
            `Description: ${skill.description}`,
            `Cost: ${skill.creditCost} credits (${priceUsdc} USDC via x402)`,
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
    try {
      const variables = (args.variables as Record<string, string>) ?? {};
      const result = await fetchApi(`/v1/skills/${args.skillId}/invoke`, {
        method: 'POST',
        body: JSON.stringify({ variables }),
      }) as Record<string, unknown>;
      const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
      const meta = result.metadata as Record<string, unknown> | undefined;
      const footer = meta
        ? `\n\n---\nCost: ${result.creditsCharged ?? '?'} credits | Duration: ${meta.durationMs ?? '?'}ms | Paid via: x402`
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
    try {
      const result = await fetchApi('/v1/orchestrate', {
        method: 'POST',
        body: JSON.stringify({ query: args.query }),
      }) as Record<string, unknown>;

      const answer = result.answer ?? result.result ?? JSON.stringify(result, null, 2);
      const meta = result.metadata as Record<string, unknown> | undefined;
      const footer = meta
        ? `\n\n---\nCredits used: ${result.creditsCharged ?? '?'} | Steps: ${(result.steps as unknown[])?.length ?? '?'} | Duration: ${meta.durationMs ?? '?'}ms | Paid via: x402`
        : '';

      return { content: [{ type: 'text', text: String(answer) + footer }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Orchestration failed: ${String(err)}` }], isError: true };
    }
  },

  'get-credits': async () => {
    if (!CLAWNET_API_KEY) {
      return {
        content: [{ type: 'text', text: 'CLAWNET_API_KEY not set on server. This endpoint shows credit balances for API-key-based accounts.' }],
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

// ─── Server capabilities ──────────────────────────────────────────────────────

const SERVER_INFO = {
  protocolVersion: '2025-03-26',
  capabilities: {
    tools: { listChanged: false },
  },
  serverInfo: {
    name: 'ClawNet-x402',
    version: '1.0.0',
  },
};

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

// ─── x402 facilitator setup ───────────────────────────────────────────────────

const facilitatorUrl = env.X402_FACILITATOR_URL;
const facilitator = new HTTPFacilitatorClient(facilitatorUrl);
const chainId = env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532';

/**
 * Compute USDC price for a paid tool call.
 * - invoke-skill: skill.credit_cost * X402_USDC_PER_CREDIT (min 1 credit)
 * - orchestrate: ORCHESTRATION_FEE * X402_USDC_PER_CREDIT
 */
function getToolPriceUsdc(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'invoke-skill') {
    const skillId = args.skillId as string | undefined;
    if (skillId) {
      const skill = getSkill(skillId);
      const credits = Math.max(skill?.credit_cost ?? 1, 1);
      return (credits * env.X402_USDC_PER_CREDIT).toFixed(6);
    }
    // Fallback: 1 credit minimum
    return env.X402_USDC_PER_CREDIT.toFixed(6);
  }
  if (toolName === 'orchestrate') {
    return (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6);
  }
  return '0.000000';
}

/** Build payment requirements object for x402 verification. */
function buildPaymentRequirements(priceUsdc: string) {
  return {
    scheme: 'exact',
    network: `eip155:${chainId}`,
    payTo: env.X402_RECIPIENT_ADDRESS,
    maxTimeoutSeconds: 60,
    price: priceUsdc,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base USDC
    description: 'ClawNet MCP tool call payment',
  };
}

// ─── x402 receipt recording ───────────────────────────────────────────────────

function insertX402McpReceipt(params: {
  requestId: string;
  toolName: string;
  priceUsdc: string;
  payerAddress: string | null;
  durationMs: number;
  success: boolean;
  error: string | null;
}): void {
  try {
    getDb().prepare(`
      INSERT INTO x402_receipts (request_id, skill_id, skill_name, price_usdc, network, payer_address, duration_ms, success, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.requestId,
      `mcp:${params.toolName}`,
      `MCP ${params.toolName}`,
      params.priceUsdc,
      env.X402_NETWORK,
      params.payerAddress,
      params.durationMs,
      params.success ? 1 : 0,
      params.error,
    );
  } catch (err) {
    logger.warn({ requestId: params.requestId, err }, 'Failed to insert x402 MCP receipt');
  }
}

// ─── Handle a single JSON-RPC request (no payment logic — pure dispatch) ─────

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize':
      return jsonRpcSuccess(id, SERVER_INFO);

    case 'notifications/initialized':
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

// ─── Router ───────────────────────────────────────────────────────────────────

const router = new Hono();

// ─── POST /mcp/x402 — JSON-RPC endpoint with x402 payment gating ─────────────

router.post('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id') ?? crypto.randomUUID();
  touchSession(sessionId);

  // Check if x402 provider mode is active
  if (!env.X402_RECIPIENT_ADDRESS) {
    return c.json(jsonRpcError(null, -32000, 'x402 MCP transport not enabled — set X402_RECIPIENT_ADDRESS'), 503);
  }

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

    // For batch requests, check if ANY contain paid tool calls
    // If so, require payment for the total price of all paid tools
    const paidCalls: Array<{ index: number; toolName: string; priceUsdc: string }> = [];
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      if (req.method === 'tools/call') {
        const toolName = (req.params?.name as string) ?? '';
        if (PAID_TOOLS.has(toolName)) {
          const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};
          paidCalls.push({ index: i, toolName, priceUsdc: getToolPriceUsdc(toolName, toolArgs) });
        }
      }
    }

    if (paidCalls.length > 0) {
      // Compute total price for all paid tools in the batch
      const totalPrice = paidCalls.reduce((sum, pc) => sum + parseFloat(pc.priceUsdc), 0);
      const totalPriceStr = totalPrice.toFixed(6);

      // Accept both x402 v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) headers
      const paymentHeader = c.req.header('x-payment') ?? c.req.header('PAYMENT-SIGNATURE');
      if (!paymentHeader) {
        // Return 402 with payment requirements (set both v1 and v2 headers)
        const paymentRequirements = buildPaymentRequirements(totalPriceStr);
        c.header('X-Payment-Requirements', JSON.stringify(paymentRequirements));
        c.header('PAYMENT-REQUIRED', JSON.stringify(paymentRequirements));
        return c.json({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: 402,
            message: 'Payment required',
            data: {
              code: 'X402_PAYMENT_REQUIRED',
              totalPriceUsdc: totalPriceStr,
              paidTools: paidCalls.map((pc) => ({ tool: pc.toolName, priceUsdc: pc.priceUsdc })),
              paymentRequirements,
              hint: 'Include X-PAYMENT (v1) or PAYMENT-SIGNATURE (v2) header with USDC payment on Base.',
            },
          },
        }, 402);
      }

      // Verify payment
      try {
        const verification = await facilitator.verifyPayment(paymentHeader, buildPaymentRequirements(totalPriceStr));
        if (!verification.valid) {
          return c.json(jsonRpcError(null, -32000, `Payment verification failed: ${verification.error ?? 'invalid payment'}`), 402);
        }
      } catch (verifyErr) {
        logger.error({ err: verifyErr }, 'x402 MCP batch payment verification error');
        return c.json(jsonRpcError(null, -32000, 'Payment verification error — try again'), 500);
      }
    }

    // Execute all requests
    const startTime = Date.now();
    const responses = await Promise.all(requests.map((req) => handleRequest(req)));

    // Record receipts for paid calls
    const durationMs = Date.now() - startTime;
    for (const pc of paidCalls) {
      insertX402McpReceipt({
        requestId: nanoid(12),
        toolName: pc.toolName,
        priceUsdc: pc.priceUsdc,
        payerAddress: null,
        durationMs,
        success: true,
        error: null,
      });
    }

    const filtered = responses.filter((_, i) => requests[i].id !== undefined);
    return filtered.length > 0 ? c.json(filtered) : c.body(null, 204);
  }

  // ── Single request ──────────────────────────────────────────────────────────

  const req = body as JsonRpcRequest;
  if (!req.jsonrpc || req.jsonrpc !== '2.0' || !req.method) {
    return c.json(jsonRpcError(req.id ?? null, -32600, 'Invalid JSON-RPC request'), 400);
  }

  // Notifications (no id) don't expect a response
  if (req.id === undefined) {
    await handleRequest(req);
    return c.body(null, 204);
  }

  // Check if this is a paid tool call
  if (req.method === 'tools/call') {
    const toolName = (req.params?.name as string) ?? '';

    if (PAID_TOOLS.has(toolName)) {
      const toolArgs = (req.params?.arguments as Record<string, unknown>) ?? {};
      const priceUsdc = getToolPriceUsdc(toolName, toolArgs);
      const requestId = nanoid(12);
      const startTime = Date.now();

      // Check for payment header
      // Accept both x402 v1 (X-PAYMENT) and v2 (PAYMENT-SIGNATURE) headers
      const paymentHeader = c.req.header('x-payment') ?? c.req.header('PAYMENT-SIGNATURE');
      if (!paymentHeader) {
        const paymentRequirements = buildPaymentRequirements(priceUsdc);
        // Set both v1 and v2 headers on 402 response
        c.header('X-Payment-Requirements', JSON.stringify(paymentRequirements));
        c.header('PAYMENT-REQUIRED', JSON.stringify(paymentRequirements));
        return c.json({
          jsonrpc: '2.0',
          id: req.id,
          error: {
            code: 402,
            message: 'Payment required',
            data: {
              code: 'X402_PAYMENT_REQUIRED',
              tool: toolName,
              priceUsdc,
              paymentRequirements,
              hint: 'Include X-PAYMENT (v1) or PAYMENT-SIGNATURE (v2) header with USDC payment on Base to call this tool.',
              docs: 'https://claw-net.org/docs/x402',
            },
          },
        }, 402);
      }

      // Verify payment via facilitator
      try {
        const verification = await facilitator.verifyPayment(paymentHeader, buildPaymentRequirements(priceUsdc));
        if (!verification.valid) {
          logger.warn({ requestId, toolName, err: verification.error }, 'x402 MCP payment rejected');
          return c.json(jsonRpcError(req.id, -32000, `Payment verification failed: ${verification.error ?? 'invalid payment'}`), 402);
        }
        logger.info({ requestId, toolName, priceUsdc, via: 'x402-mcp' }, 'x402 MCP payment verified');
      } catch (verifyErr) {
        logger.error({ requestId, toolName, err: verifyErr }, 'x402 MCP payment verification error');
        return c.json(jsonRpcError(req.id, -32000, 'Payment verification error — try again'), 500);
      }

      // Execute the tool
      try {
        const response = await handleRequest(req);
        const durationMs = Date.now() - startTime;

        // Record receipt
        insertX402McpReceipt({
          requestId,
          toolName,
          priceUsdc,
          payerAddress: null,
          durationMs,
          success: true,
          error: null,
        });

        // Inject receipt metadata into the response result
        if (response.result && typeof response.result === 'object') {
          const result = response.result as Record<string, unknown>;
          result._x402 = {
            receiptId: requestId,
            priceUsdc,
            network: env.X402_NETWORK,
            paidVia: 'x402-mcp',
          };
        }

        return c.json(response);
      } catch (execErr) {
        const durationMs = Date.now() - startTime;
        insertX402McpReceipt({
          requestId,
          toolName,
          priceUsdc,
          payerAddress: null,
          durationMs,
          success: false,
          error: String(execErr),
        });
        return c.json(jsonRpcSuccess(req.id, {
          content: [{ type: 'text', text: `Tool execution error: ${String(execErr)}` }],
          isError: true,
        }));
      }
    }
  }

  // Non-paid method — pass through directly
  const response = await handleRequest(req);
  return c.json(response);
});

// ─── GET /mcp/x402 — SSE endpoint for server-initiated messages ──────────────

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
        controller.enqueue(encoder.encode(`event: endpoint\ndata: /mcp/x402\n\n`));

        const interval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            clearInterval(interval);
          }
        }, 30_000);

        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(interval);
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    }),
  );
});

// ─── DELETE /mcp/x402 — close session ────────────────────────────────────────

router.delete('/', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  if (sessionId) {
    sessions.delete(sessionId);
    logger.debug({ sessionId }, 'x402 MCP session closed');
  }
  return c.json({ ok: true });
});

// ─── GET /mcp/x402/info — discovery + pricing info ──────────────────────────

router.get('/info', (c) => {
  const enabled = !!env.X402_RECIPIENT_ADDRESS;
  const orchestratePrice = (env.ORCHESTRATION_FEE * env.X402_USDC_PER_CREDIT).toFixed(6);

  return c.json({
    name: 'ClawNet x402 MCP Server',
    version: '1.0.0',
    transport: 'streamable-http',
    protocol: 'x402 + MCP',
    description: 'Remote MCP server for ClawNet with x402 USDC payment gating on paid tool calls.',
    enabled,
    network: env.X402_NETWORK,
    chainId: env.X402_NETWORK === 'base-mainnet' ? '8453' : '84532',
    recipientAddress: env.X402_RECIPIENT_ADDRESS ?? null,
    facilitator: env.X402_FACILITATOR_URL,
    facilitatorFallback: env.X402_FACILITATOR_FALLBACK_URL ?? null,
    tools: toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      paid: PAID_TOOLS.has(t.name),
      priceUsdc: PAID_TOOLS.has(t.name)
        ? t.name === 'orchestrate'
          ? orchestratePrice
          : 'dynamic (skill credit_cost * ' + env.X402_USDC_PER_CREDIT.toFixed(6) + ')'
        : '0.000000',
      priceNote: PAID_TOOLS.has(t.name)
        ? t.name === 'invoke-skill'
          ? `Price = skill.credit_cost * ${env.X402_USDC_PER_CREDIT} USDC (min 1 credit = ${env.X402_USDC_PER_CREDIT.toFixed(6)} USDC)`
          : `Fixed ${orchestratePrice} USDC per query`
        : 'Free — no payment required',
    })),
    pricing: {
      usdcPerCredit: env.X402_USDC_PER_CREDIT,
      orchestrationFee: `${env.ORCHESTRATION_FEE} credits = ${orchestratePrice} USDC`,
      freeTools: ['list-skills', 'get-skill', 'search-registry', 'get-credits'],
      paidTools: {
        'invoke-skill': `skill credit_cost * ${env.X402_USDC_PER_CREDIT} USDC`,
        'orchestrate': `${orchestratePrice} USDC`,
      },
      paymentHeader: 'X-PAYMENT',
      paymentHeaderV2: 'PAYMENT-SIGNATURE',
      paymentCurrency: 'USDC on Base',
      note: 'Both X-PAYMENT (v1) and PAYMENT-SIGNATURE (v2) headers are accepted.',
    },
    usage: {
      claude: `claude mcp add-json clawnet-x402 '{"type":"url","url":"${CLAWNET_BASE_URL}/mcp/x402"}'`,
      curl: `curl -X POST ${CLAWNET_BASE_URL}/mcp/x402 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`,
    },
    docs: 'https://claw-net.org/docs/x402-mcp',
  });
});

// ─── Periodic session cleanup ─────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}, 60_000);

export { router as x402McpRouter };
