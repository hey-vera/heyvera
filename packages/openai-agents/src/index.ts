/**
 * @clawnet/openai-agents — OpenAI Agents SDK tools for ClawNet
 *
 * 3 function-calling tools for any OpenAI agent:
 *   - clawnet_orchestrate   — query 390+ APIs via AI orchestration
 *   - clawnet_invoke_skill  — invoke a marketplace skill by ID
 *   - clawnet_search        — search available APIs and skills
 *
 * Usage:
 *   import { clawnetTools, handleClawNetToolCall } from '@clawnet/openai-agents';
 *
 *   const response = await openai.chat.completions.create({
 *     model: 'gpt-4o',
 *     messages,
 *     tools: clawnetTools,
 *   });
 *
 *   for (const call of response.choices[0].message.tool_calls ?? []) {
 *     const result = await handleClawNetToolCall(
 *       call.function.name,
 *       JSON.parse(call.function.arguments),
 *       process.env.CLAWNET_API_KEY!
 *     );
 *   }
 */

// ─── Types ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://claw-net.org';

/** OpenAI function tool definition (JSON Schema format). */
export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const orchestrateTool: OpenAIFunctionTool = {
  type: 'function',
  function: {
    name: 'clawnet_orchestrate',
    description:
      'Query ClawNet\'s AI orchestration engine. Automatically selects from 390+ live APIs, ' +
      'executes multi-step workflows, and returns a formatted answer. Supports pricing ' +
      'strategies: cheapest, balanced, fastest, reliable. Costs credits per query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The question or task to orchestrate (e.g., "What is the price of SOL?", "Find leads at fintech companies in NYC")',
        },
        max_credits: {
          type: 'number',
          description: 'Maximum credits to spend on this query. Returns 402 if plan exceeds budget.',
        },
        strategy: {
          type: 'string',
          enum: ['cheapest', 'balanced', 'fastest', 'reliable'],
          description: 'Optimization strategy for endpoint selection. Default: balanced.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

const invokeSkillTool: OpenAIFunctionTool = {
  type: 'function',
  function: {
    name: 'clawnet_invoke_skill',
    description:
      'Invoke a specific ClawNet marketplace skill by ID. Skills are pre-built AI capabilities ' +
      '(crypto analysis, data enrichment, security scanning, etc.). Pass template variables as ' +
      'key-value pairs. Use clawnet_search first to find the right skill ID.',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: 'The skill ID to invoke (e.g., "vie-crypto-trust", "context-engine")',
        },
        variables: {
          type: 'object',
          description: 'Template variables for the skill (e.g., {"token": "SOL", "depth": "standard"})',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['skill_id'],
      additionalProperties: false,
    },
  },
};

const searchTool: OpenAIFunctionTool = {
  type: 'function',
  function: {
    name: 'clawnet_search',
    description:
      'Search ClawNet\'s API endpoint registry and skill marketplace. Find capabilities ' +
      'by keyword (e.g., "crypto price", "email finder", "web scraping"). Returns matching ' +
      'endpoints and skills with IDs, descriptions, and pricing. Free — no credits charged.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What capability you need (e.g., "token price data", "lead enrichment", "sentiment analysis")',
        },
        category: {
          type: 'string',
          description: 'Optional category filter to narrow results',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
};

/**
 * Array of all ClawNet tool definitions in OpenAI function-calling format.
 * Pass directly as `tools` to `openai.chat.completions.create()`.
 */
export const clawnetTools: OpenAIFunctionTool[] = [
  orchestrateTool,
  invokeSkillTool,
  searchTool,
];

// ─── HTTP helper ────────────────────────────────────────────────────────────

async function clawnetRequest<T>(
  apiKey: string,
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(`ClawNet API error ${res.status}: ${err.error ?? res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ─── Tool Call Handler ──────────────────────────────────────────────────────

/**
 * Execute a ClawNet tool call and return the result as a JSON string.
 * Feed the returned string back to OpenAI as the tool call output.
 *
 * @param name - The function name from `tool_calls[].function.name`
 * @param args - The parsed arguments from `tool_calls[].function.arguments`
 * @param apiKey - Your ClawNet API key (cn-xxxx)
 * @param baseUrl - Optional base URL override (default: https://claw-net.org)
 */
export async function handleClawNetToolCall(
  name: string,
  args: Record<string, unknown>,
  apiKey: string,
  baseUrl?: string,
): Promise<string> {
  const base = baseUrl ?? DEFAULT_BASE_URL;

  switch (name) {
    case 'clawnet_orchestrate': {
      const result = await clawnetRequest<{
        answer: string;
        requestId?: string;
        steps: Array<{ endpoint: string; cached: boolean }>;
        metadata: { durationMs: number; totalCredits: number };
      }>(apiKey, base, 'POST', '/v1/orchestrate', {
        query: args.query,
        pricing: {
          ...(args.max_credits !== undefined && { maxCredits: args.max_credits }),
          ...(args.strategy && { strategy: args.strategy }),
        },
      });

      return JSON.stringify({
        answer: result.answer,
        requestId: result.requestId,
        stepsExecuted: result.steps?.length ?? 0,
        creditsUsed: result.metadata?.totalCredits,
        durationMs: result.metadata?.durationMs,
      });
    }

    case 'clawnet_invoke_skill': {
      const skillId = args.skill_id as string;
      const variables = (args.variables ?? {}) as Record<string, string>;

      const result = await clawnetRequest<{
        answer?: string;
        result?: unknown;
        data?: unknown;
        creditCost?: number;
        metadata?: Record<string, unknown>;
      }>(apiKey, base, 'POST', `/v1/skills/${encodeURIComponent(skillId)}/invoke`, {
        variables,
      });

      return JSON.stringify({
        answer: result.answer ?? result.result ?? result.data,
        creditCost: result.creditCost,
        ...(result.metadata && { metadata: result.metadata }),
      });
    }

    case 'clawnet_search': {
      const params = new URLSearchParams({ q: args.query as string });
      if (args.category) params.set('category', args.category as string);

      const [endpoints, skills] = await Promise.all([
        clawnetRequest<{
          endpoints?: Array<{
            id: string; name: string; provider: string;
            description: string; costPerCall: number;
          }>;
        }>(apiKey, base, 'GET', `/v1/endpoints?${params.toString()}`)
          .catch(() => ({ endpoints: [] as Array<{ id: string; name: string; provider: string; description: string; costPerCall: number }> })),

        clawnetRequest<{
          skills?: Array<{
            id: string; name: string; description: string;
            credit_cost: number; tags: string[];
          }>;
        }>(apiKey, base, 'GET', `/v1/marketplace/skills?search=${encodeURIComponent(args.query as string)}&limit=10`)
          .catch(() => ({ skills: [] as Array<{ id: string; name: string; description: string; credit_cost: number; tags: string[] }> })),
      ]);

      return JSON.stringify({
        endpoints: (endpoints.endpoints ?? []).slice(0, 10).map(e => ({
          id: e.id,
          name: e.name,
          provider: e.provider,
          description: e.description,
          costPerCall: e.costPerCall,
        })),
        skills: (skills.skills ?? []).slice(0, 10).map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          creditCost: s.credit_cost,
          tags: s.tags,
        })),
      });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ─── Convenience Helper ─────────────────────────────────────────────────────

/**
 * Create a ClawNet agent integration bundle.
 * Returns the tool definitions and a bound handler for easy setup.
 *
 * @example
 * ```ts
 * const { tools, handleToolCall } = createClawNetAgent(process.env.CLAWNET_API_KEY!);
 *
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages,
 *   tools,
 * });
 *
 * for (const call of response.choices[0].message.tool_calls ?? []) {
 *   const result = await handleToolCall(call.function.name, JSON.parse(call.function.arguments));
 * }
 * ```
 */
export function createClawNetAgent(apiKey: string, baseUrl?: string) {
  return {
    tools: clawnetTools,
    handleToolCall: (name: string, args: Record<string, unknown>) =>
      handleClawNetToolCall(name, args, apiKey, baseUrl),
  };
}
