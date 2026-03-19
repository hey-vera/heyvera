/**
 * @clawnet/agentkit — Coinbase AgentKit actions for ClawNet
 *
 * 3 actions for any AgentKit-powered agent:
 *   - clawnet_orchestrate   — query 390+ APIs via AI orchestration
 *   - clawnet_invoke_skill  — invoke a marketplace skill
 *   - clawnet_pay_x402      — invoke a skill via x402 USDC payment (no API key needed)
 *
 * AgentKit agents already have Base wallets, making x402 (USDC on Base) native.
 *
 * Usage with AgentKit:
 *   import { getClawNetActions } from '@clawnet/agentkit';
 *
 *   // API key mode (credit-based)
 *   const actions = getClawNetActions({ apiKey: 'cn-xxxx' });
 *
 *   // x402 mode (USDC on Base, no account needed)
 *   const actions = getClawNetActions({ x402: true });
 *
 *   // Register with AgentKit
 *   agent.registerActions(actions);
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://claw-net.org';

export interface ClawNetActionConfig {
  /** ClawNet API key (cn-xxxx). Required for credit-based actions. */
  apiKey?: string;
  /** Enable x402 payment mode. AgentKit agents with Base wallets can pay per call. */
  x402?: boolean;
  /** Base URL override. Default: https://claw-net.org */
  baseUrl?: string;
}

/**
 * AgentKit action definition — compatible with Coinbase AgentKit's action registration.
 * Each action has a name, description, input schema, and invoke function.
 */
export interface AgentKitAction {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  invoke: (input: Record<string, unknown>) => Promise<string>;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

async function apiRequest<T>(
  config: ClawNetActionConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['X-API-Key'] = config.apiKey;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(`ClawNet error ${res.status}: ${err.error ?? res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ─── Actions ────────────────────────────────────────────────────────────────

function createOrchestrateAction(config: ClawNetActionConfig): AgentKitAction {
  return {
    name: 'clawnet_orchestrate',

    description:
      'Query ClawNet\'s AI orchestration engine with 390+ live APIs. ' +
      'Automatically selects endpoints, executes multi-step workflows, and returns a formatted answer. ' +
      'Supports strategies: cheapest, balanced, fastest, reliable. ' +
      'Use this for general-purpose queries that may require multiple API calls.',

    schema: z.object({
      query: z.string().describe('The question or task (e.g., "Analyze SOL price trends", "Find GitHub repos about AI agents")'),
      maxCredits: z.number().optional().describe('Maximum credit budget. Returns 402 if exceeded.'),
      strategy: z.enum(['cheapest', 'balanced', 'fastest', 'reliable']).optional().describe('Endpoint selection strategy'),
    }),

    async invoke(input) {
      const result = await apiRequest<{
        answer: string;
        requestId: string;
        steps: unknown[];
        metadata: Record<string, unknown>;
      }>(config, 'POST', '/v1/orchestrate', {
        query: input.query,
        pricing: {
          ...(input.maxCredits !== undefined && { maxCredits: input.maxCredits }),
          ...(input.strategy && { strategy: input.strategy }),
        },
      });

      return JSON.stringify({
        answer: result.answer,
        requestId: result.requestId,
        stepsExecuted: result.steps?.length ?? 0,
        metadata: result.metadata,
      });
    },
  };
}

function createInvokeSkillAction(config: ClawNetActionConfig): AgentKitAction {
  return {
    name: 'clawnet_invoke_skill',

    description:
      'Invoke a specific ClawNet marketplace skill by ID. Skills are pre-built AI capabilities: ' +
      'crypto trust scoring (vie-crypto-trust), context analysis (context-engine), ' +
      'data enrichment, security scanning, and more. ' +
      'Pass template variables as key-value pairs. Requires API key authentication.',

    schema: z.object({
      skillId: z.string().describe('Skill ID (e.g., "vie-crypto-trust", "context-engine")'),
      variables: z.record(z.string()).optional().describe('Template variables (e.g., {"token": "SOL", "depth": "deep"})'),
    }),

    async invoke(input) {
      const skillId = input.skillId as string;
      const variables = (input.variables ?? {}) as Record<string, string>;

      const result = await apiRequest<{
        answer?: string;
        result?: unknown;
        data?: unknown;
        creditCost?: number;
        metadata?: Record<string, unknown>;
      }>(config, 'POST', `/v1/skills/${encodeURIComponent(skillId)}/invoke`, { variables });

      return JSON.stringify({
        answer: result.answer ?? result.result ?? result.data,
        creditCost: result.creditCost,
        ...(result.metadata && { metadata: result.metadata }),
      });
    },
  };
}

function createX402SkillAction(config: ClawNetActionConfig): AgentKitAction {
  return {
    name: 'clawnet_pay_x402',

    description:
      'Invoke a ClawNet skill via x402 protocol — pay with USDC on Base directly from your wallet. ' +
      'No API key or ClawNet account needed. AgentKit agents with Base wallets can call this natively. ' +
      'The x402 payment header is automatically constructed. ' +
      'First call GET /x402/skills to see available skills and their USDC prices.',

    schema: z.object({
      skillId: z.string().describe('Skill ID to invoke (from GET /x402/skills listing)'),
      variables: z.record(z.string()).optional().describe('Template variables for the skill'),
      action: z.enum(['invoke', 'query', 'list']).optional().describe(
        'Action type: "invoke" for prompt skills, "query" for data skills, "list" to browse available skills. Default: invoke.',
      ),
    }),

    async invoke(input) {
      const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
      const action = (input.action as string) ?? 'invoke';
      const skillId = input.skillId as string;
      const variables = (input.variables ?? {}) as Record<string, string>;

      // List mode — no payment needed
      if (action === 'list') {
        const res = await fetch(`${base}/x402/skills`, {
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) throw new Error(`ClawNet x402 list error: ${res.status}`);
        const data = await res.json() as Record<string, unknown>;
        return JSON.stringify(data);
      }

      // For invoke/query, the agent's wallet handles the x402 payment flow.
      // The x402 middleware returns 402 with payment requirements.
      // AgentKit's wallet infrastructure handles the payment handshake automatically.
      const endpoint = action === 'query'
        ? `/x402/query/${encodeURIComponent(skillId)}`
        : `/x402/skills/${encodeURIComponent(skillId)}`;

      const body = action === 'query' ? { params: variables } : { variables };

      // Step 1: Make the request — will get 402 with payment requirements
      // (AgentKit wallet middleware intercepts 402 and handles payment)
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 402) {
        // Return payment requirements so AgentKit wallet can complete the handshake
        const requirements = res.headers.get('X-Payment-Requirements') ?? res.headers.get('x-payment');
        const payBody = await res.json().catch(() => ({})) as Record<string, unknown>;
        return JSON.stringify({
          status: 'payment_required',
          requirements: requirements ? JSON.parse(requirements) : payBody,
          hint: 'Pass the payment requirements to your AgentKit wallet to complete the x402 payment handshake.',
          endpoint: `${base}${endpoint}`,
          method: 'POST',
          body,
        });
      }

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(`ClawNet x402 error ${res.status}: ${err.error ?? res.statusText}`);
      }

      const result = await res.json() as Record<string, unknown>;
      return JSON.stringify(result);
    },
  };
}

// ─── Export ─────────────────────────────────────────────────────────────────

/**
 * Get all ClawNet actions for AgentKit registration.
 *
 * @example
 * ```ts
 * import { getClawNetActions } from '@clawnet/agentkit';
 *
 * // Credit-based (API key)
 * const actions = getClawNetActions({ apiKey: 'cn-xxxx' });
 *
 * // x402 USDC payment (no account needed)
 * const actions = getClawNetActions({ x402: true });
 *
 * // Both modes available
 * const actions = getClawNetActions({ apiKey: 'cn-xxxx', x402: true });
 *
 * // Register with your AgentKit agent
 * for (const action of actions) {
 *   agent.registerAction(action);
 * }
 * ```
 */
export function getClawNetActions(config: ClawNetActionConfig): AgentKitAction[] {
  const actions: AgentKitAction[] = [];

  // Always include orchestrate (uses API key if available)
  if (config.apiKey) {
    actions.push(createOrchestrateAction(config));
    actions.push(createInvokeSkillAction(config));
  }

  // x402 action available with or without API key (wallet-based payment)
  if (config.x402 !== false) {
    actions.push(createX402SkillAction(config));
  }

  return actions;
}

// Named exports for individual action constructors
export { createOrchestrateAction, createInvokeSkillAction, createX402SkillAction };
