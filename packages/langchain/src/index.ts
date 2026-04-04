/**
 * @1xmint/clawnet-langchain — LangChain tools for ClawNet
 *
 * 4 tools for any LangChain agent:
 *   - ClawNetOrchestrateTool    — query 390+ APIs via AI orchestration
 *   - ClawNetSkillTool          — invoke a specific marketplace skill
 *   - ClawNetSearchTool         — search the endpoint registry
 *   - ClawNetVerifyReceiptTool  — verify a Soma cryptographic receipt
 *
 * Usage:
 *   import { ClawNetOrchestrateTool, ClawNetSkillTool, ClawNetSearchTool } from '@1xmint/clawnet-langchain';
 *
 *   const tools = [
 *     new ClawNetOrchestrateTool({ apiKey: 'cn-xxxx' }),
 *     new ClawNetSkillTool({ apiKey: 'cn-xxxx' }),
 *     new ClawNetSearchTool({ apiKey: 'cn-xxxx' }),
 *   ];
 */

import { StructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

// ─── Shared config ──────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://claw-net.org';

interface ClawNetToolConfig {
  apiKey: string;
  baseUrl?: string;
}

async function clawnetRequest<T>(
  config: ClawNetToolConfig,
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

// ─── ClawNetOrchestrateTool ─────────────────────────────────────────────────

export class ClawNetOrchestrateTool extends StructuredTool {
  name = 'clawnet_orchestrate';

  description =
    'Query ClawNet\'s AI orchestration engine. Automatically selects from 390+ APIs, ' +
    'executes multi-step workflows, and returns a formatted answer. Supports pricing ' +
    'strategies: cheapest, balanced, fastest, reliable. Costs credits per query.';

  schema = z.object({
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
  });

  private config: ClawNetToolConfig;

  constructor(config: ClawNetToolConfig) {
    super();
    this.config = config;
  }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const result = await clawnetRequest<{
      answer: string;
      steps: Array<{ endpoint: string; cached: boolean }>;
      metadata: { durationMs: number; totalCredits: number };
    }>(this.config, 'POST', '/v1/orchestrate', {
      query: input.query,
      pricing: {
        ...(input.maxCredits !== undefined && { maxCredits: input.maxCredits }),
        ...(input.strategy && { strategy: input.strategy }),
      },
    });

    return JSON.stringify({
      answer: result.answer,
      stepsExecuted: result.steps.length,
      creditsUsed: result.metadata?.totalCredits,
      durationMs: result.metadata?.durationMs,
    });
  }
}

// ─── ClawNetSkillTool ───────────────────────────────────────────────────────

export class ClawNetSkillTool extends StructuredTool {
  name = 'clawnet_invoke_skill';

  description =
    'Invoke a specific ClawNet marketplace skill by ID. Skills are pre-built AI capabilities ' +
    '(crypto analysis, data enrichment, security scanning, etc.). Pass template variables as ' +
    'key-value pairs. Use clawnet_search first to find the right skill ID.';

  schema = z.object({
    skillId: z
      .string()
      .describe('The skill ID to invoke (e.g., "vie-crypto-trust", "context-engine")'),
    variables: z
      .record(z.string())
      .optional()
      .describe('Template variables for the skill (e.g., {"token": "SOL", "depth": "standard"})'),
  });

  private config: ClawNetToolConfig;

  constructor(config: ClawNetToolConfig) {
    super();
    this.config = config;
  }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const result = await clawnetRequest<{
      answer?: string;
      result?: unknown;
      data?: unknown;
      creditCost?: number;
      metadata?: Record<string, unknown>;
    }>(this.config, 'POST', `/v1/skills/${encodeURIComponent(input.skillId)}/invoke`, {
      variables: input.variables ?? {},
    });

    return JSON.stringify({
      answer: result.answer ?? result.result ?? result.data,
      creditCost: result.creditCost,
      ...(result.metadata && { metadata: result.metadata }),
    });
  }
}

// ─── ClawNetSearchTool ──────────────────────────────────────────────────────

export class ClawNetSearchTool extends StructuredTool {
  name = 'clawnet_search';

  description =
    'Search ClawNet\'s API endpoint registry and skill marketplace. Find capabilities ' +
    'by keyword (e.g., "crypto price", "email finder", "web scraping"). Returns matching ' +
    'endpoints and skills with IDs, descriptions, and pricing. Free — no credits charged.';

  schema = z.object({
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
  });

  private config: ClawNetToolConfig;

  constructor(config: ClawNetToolConfig) {
    super();
    this.config = config;
  }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const params = new URLSearchParams({ q: input.query });
    if (input.category) params.set('category', input.category);

    // Search both endpoints and skills in parallel
    const [endpoints, skills] = await Promise.all([
      clawnetRequest<{ endpoints?: Array<{ id: string; name: string; provider: string; description: string; costPerCall: number }> }>(
        this.config, 'GET', `/v1/endpoints?${params.toString()}`
      ).catch(() => ({ endpoints: [] })),

      clawnetRequest<{ skills?: Array<{ id: string; name: string; description: string; credit_cost: number; tags: string[] }> }>(
        this.config, 'GET', `/v1/marketplace/skills?search=${encodeURIComponent(input.query)}&limit=10`
      ).catch(() => ({ skills: [] })),
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
}

// ─── ClawNetVerifyReceiptTool ─────────────────────────────────────────────

export class ClawNetVerifyReceiptTool extends StructuredTool {
  name = 'clawnet_verify_receipt';

  description =
    'Verify a Soma cryptographic receipt by ID. Returns Ed25519 + ML-DSA-65 signatures, ' +
    'request/response hashes, EAS attestation link, payment proof, and dual-sign provenance. ' +
    'Receipts are public — no auth required. Use this to verify any ClawNet interaction.';

  schema = z.object({
    receiptId: z
      .string()
      .describe('The Soma receipt ID (starts with "sr-")'),
  });

  private config: ClawNetToolConfig;

  constructor(config: ClawNetToolConfig) {
    super();
    this.config = config;
  }

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const base = (this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${base}/v1/soma/receipt/${encodeURIComponent(input.receiptId)}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      return JSON.stringify({ error: `Receipt not found (${res.status})` });
    }

    const r = await res.json() as any;
    return JSON.stringify({
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
    });
  }
}
