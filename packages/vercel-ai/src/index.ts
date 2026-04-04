/**
 * @1xmint/clawnet-vercel-ai — Vercel AI SDK tools for ClawNet
 *
 * 4 tools for any Vercel AI SDK agent:
 *   - clawnet_orchestrate      — query 390+ APIs via AI orchestration
 *   - clawnet_invoke_skill     — invoke a specific marketplace skill
 *   - clawnet_search           — search the endpoint registry & skill marketplace
 *   - clawnet_verify_receipt   — verify a Soma cryptographic receipt
 *
 * Usage:
 *   import { createClawNetTools } from '@1xmint/clawnet-vercel-ai';
 *   import { generateText } from 'ai';
 *   import { openai } from '@ai-sdk/openai';
 *
 *   const tools = createClawNetTools({ apiKey: 'cn-xxxx' });
 *
 *   const { text } = await generateText({
 *     model: openai('gpt-4o'),
 *     tools,
 *     prompt: 'What is the current price of SOL?',
 *   });
 */

import { tool } from 'ai';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://claw-net.org';

export interface ClawNetToolsConfig {
  /** ClawNet API key (cn-xxxx). Required. */
  apiKey: string;
  /** Base URL override. Default: https://claw-net.org */
  baseUrl?: string;
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

async function clawnetFetch<T>(
  config: ClawNetToolsConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'X-API-Key': config.apiKey,
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

// ─── Tool factory ───────────────────────────────────────────────────────────

/**
 * Create ClawNet tools for the Vercel AI SDK.
 *
 * Returns an object with 3 tools that can be passed directly to `generateText()`
 * or `streamText()`:
 *
 * - `clawnet_orchestrate` — query 390+ APIs via AI orchestration
 * - `clawnet_invoke_skill` — invoke a marketplace skill by ID
 * - `clawnet_search` — search endpoints and skills with pricing
 *
 * @example
 * ```ts
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 * import { createClawNetTools } from '@1xmint/clawnet-vercel-ai';
 *
 * const tools = createClawNetTools({ apiKey: process.env.CLAWNET_API_KEY! });
 *
 * const { text, toolResults } = await generateText({
 *   model: openai('gpt-4o'),
 *   tools,
 *   prompt: 'What is the current price of SOL?',
 * });
 * ```
 */
export function createClawNetTools(config: ClawNetToolsConfig) {
  return {
    clawnet_orchestrate: tool({
      description:
        'Query ClawNet\'s AI orchestration engine. Automatically selects from 390+ APIs, ' +
        'executes multi-step workflows, and returns a formatted answer with sources and credit costs. ' +
        'Supports pricing strategies: cheapest, balanced, fastest, reliable.',
      parameters: z.object({
        query: z
          .string()
          .describe('The question or task to orchestrate (e.g., "What is the price of SOL?", "Find leads at fintech companies in NYC")'),
        maxCredits: z
          .number()
          .optional()
          .describe('Maximum credits to spend on this query. Returns 402 if plan exceeds budget.'),
        strategy: z
          .enum(['cheapest', 'balanced', 'fastest', 'reliable'])
          .optional()
          .describe('Optimization strategy for endpoint selection. Default: balanced.'),
      }),
      execute: async ({ query, maxCredits, strategy }) => {
        const result = await clawnetFetch<{
          answer: string;
          requestId: string;
          steps: Array<{ endpoint: string; cached: boolean; creditCost: number }>;
          metadata: { durationMs: number; totalCredits: number };
        }>(config, 'POST', '/v1/orchestrate', {
          query,
          pricing: {
            ...(maxCredits !== undefined && { maxCredits }),
            ...(strategy && { strategy }),
          },
        });

        return {
          answer: result.answer,
          requestId: result.requestId,
          stepsExecuted: result.steps?.length ?? 0,
          creditsUsed: result.metadata?.totalCredits,
          durationMs: result.metadata?.durationMs,
        };
      },
    }),

    clawnet_invoke_skill: tool({
      description:
        'Invoke a specific ClawNet marketplace skill by ID. Skills are pre-built AI capabilities: ' +
        'crypto trust scoring, context analysis, data enrichment, security scanning, and more. ' +
        'Pass template variables as key-value pairs. Use clawnet_search first to find the right skill ID.',
      parameters: z.object({
        skillId: z
          .string()
          .describe('The skill ID to invoke (e.g., "vie-crypto-trust", "context-engine")'),
        variables: z
          .record(z.string())
          .optional()
          .describe('Template variables for the skill (e.g., {"token": "SOL", "depth": "standard"})'),
      }),
      execute: async ({ skillId, variables }) => {
        const result = await clawnetFetch<{
          answer?: string;
          result?: unknown;
          data?: unknown;
          creditCost?: number;
          cached?: boolean;
          metadata?: Record<string, unknown>;
          provider?: { verified: boolean; successRate: number; avgRating: number; reputationScore: number };
        }>(config, 'POST', `/v1/skills/${encodeURIComponent(skillId)}/invoke`, {
          variables: variables ?? {},
        });

        return {
          answer: result.answer ?? result.result ?? result.data,
          creditCost: result.creditCost,
          cached: result.cached,
          ...(result.provider && { provider: result.provider }),
          ...(result.metadata && { metadata: result.metadata }),
        };
      },
    }),

    clawnet_search: tool({
      description:
        'Search ClawNet\'s API endpoint registry and skill marketplace. Find capabilities ' +
        'by keyword (e.g., "crypto price", "email finder", "web scraping"). Returns matching ' +
        'endpoints and skills with IDs, descriptions, and pricing. Free — no credits charged.',
      parameters: z.object({
        query: z
          .string()
          .describe('What capability you need (e.g., "token price data", "lead enrichment", "sentiment analysis")'),
        category: z
          .enum([
            'solana', 'social', 'defi', 'scraping', 'search', 'media',
            'enrichment', 'security', 'ai-ml', 'infrastructure', 'weather',
            'oracle', 'discovery',
          ])
          .optional()
          .describe('Optional category filter to narrow results'),
      }),
      execute: async ({ query, category }) => {
        const params = new URLSearchParams({ q: query });
        if (category) params.set('category', category);

        const [endpoints, skills] = await Promise.all([
          clawnetFetch<{ endpoints?: Array<{ id: string; name: string; provider: string; description: string; costPerCall: number }> }>(
            config, 'GET', `/v1/endpoints?${params.toString()}`
          ).catch(() => ({ endpoints: [] as Array<{ id: string; name: string; provider: string; description: string; costPerCall: number }> })),

          clawnetFetch<{ skills?: Array<{ id: string; name: string; description: string; credit_cost: number; tags: string[] }> }>(
            config, 'GET', `/v1/marketplace/skills?search=${encodeURIComponent(query)}&limit=10`
          ).catch(() => ({ skills: [] as Array<{ id: string; name: string; description: string; credit_cost: number; tags: string[] }> })),
        ]);

        return {
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
        };
      },
    }),

    clawnet_verify_receipt: tool({
      description:
        'Verify a Soma cryptographic receipt by ID. Returns Ed25519 + ML-DSA-65 signatures, ' +
        'request/response hashes, EAS attestation link, and dual-sign provenance. Public — no auth required.',
      parameters: z.object({
        receiptId: z
          .string()
          .describe('The Soma receipt ID (starts with "sr-")'),
      }),
      execute: async ({ receiptId }) => {
        const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        const res = await fetch(`${base}/v1/soma/receipt/${encodeURIComponent(receiptId)}`, {
          headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) {
          return { error: `Receipt not found (${res.status})` };
        }

        const r = await res.json() as any;
        return {
          id: r.id,
          verified: true,
          paymentMethod: r.paymentMethod,
          creditsCost: r.creditsCost,
          algorithm: r.algorithm,
          requestHash: r.requestHash,
          responseHash: r.responseHash,
          easScanUrl: r.easScanUrl,
          dualSigned: !!r.dualSign,
          createdAt: r.createdAt,
        };
      },
    }),
  };
}

// Default export for convenience
export { createClawNetTools as default };
