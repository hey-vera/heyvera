/**
 * Coinbase AgentKit Integration — ClawNet Tool Definitions
 *
 * Import these tools into any AgentKit agent to access ClawNet's
 * skill marketplace, orchestration, and attestation capabilities.
 *
 * Usage:
 *   import { clawnetTools } from '@clawnet/agentkit';
 *   const agent = new CdpAgent({ tools: [...clawnetTools] });
 */

import { apiRegistry } from '../config/api-registry';

export interface AgentKitTool {
  name: string;
  description: string;
  parameters: Record<
    string,
    { type: string; description: string; required?: boolean }
  >;
  handler: string;
  method: 'GET' | 'POST';
  auth?: 'api-key' | 'x402' | 'none';
  creditCost?: number | string;
}

export const clawnetTools: AgentKitTool[] = [
  {
    name: 'clawnet_orchestrate',
    description:
      `Ask any question in natural language and get verified answers from ${apiRegistry.length}+ data sources. Crypto, social, market intelligence.`,
    parameters: {
      query: {
        type: 'string',
        description: 'Natural language question',
        required: true,
      },
      strategy: {
        type: 'string',
        description:
          'Routing strategy: cheapest | balanced | fastest | reliable',
      },
      maxCredits: {
        type: 'number',
        description: 'Maximum credits to spend',
      },
    },
    handler: 'https://api.claw-net.org/v1/orchestrate',
    method: 'POST',
    auth: 'api-key',
    creditCost: '2+ credits',
  },
  {
    name: 'clawnet_invoke_skill',
    description:
      'Invoke a specific skill from the ClawNet marketplace. Each skill has defined inputs and returns structured data.',
    parameters: {
      skillId: {
        type: 'string',
        description: 'Skill ID from the marketplace',
        required: true,
      },
      variables: {
        type: 'object',
        description: 'Input variables for the skill',
      },
    },
    handler: 'https://api.claw-net.org/v1/skills/{skillId}/invoke',
    method: 'POST',
    auth: 'api-key',
    creditCost: 'varies by skill',
  },
  {
    name: 'clawnet_query_data',
    description:
      'Query a data skill for structured JSON output. Fast, cheap, no LLM involved.',
    parameters: {
      skillId: {
        type: 'string',
        description: 'Data skill ID',
        required: true,
      },
      token: {
        type: 'string',
        description: 'Token symbol (for price/market skills)',
      },
    },
    handler: 'https://api.claw-net.org/v1/skills/{skillId}/query',
    method: 'GET',
    auth: 'api-key',
    creditCost: '1-2 credits',
  },
  {
    name: 'clawnet_manifest_verify',
    description:
      'Verify data, assess reasoning, or pre-flight an action before executing. Cross-references multiple independent trust sources.',
    parameters: {
      check: {
        type: 'string',
        description: 'Natural language verification request',
      },
      verify: {
        type: 'object',
        description:
          'Claims to verify: { claims: [{ type, subject, value }] }',
      },
      assess: {
        type: 'object',
        description: 'Reasoning to assess: { decision, reasoning }',
      },
      preflight: {
        type: 'object',
        description: 'Action to pre-flight: { action, params }',
      },
      tier: {
        type: 'string',
        description:
          'Verification depth: quick (0.5cr) | standard (2cr) | deep (5cr)',
      },
    },
    handler: 'https://api.claw-net.org/v1/manifest',
    method: 'POST',
    auth: 'api-key',
    creditCost: '0.5-5 credits',
  },
  {
    name: 'clawnet_attest',
    description:
      'Create a signed, tamper-proof attestation of an agent action. Hash-chained for integrity.',
    parameters: {
      action_type: {
        type: 'string',
        description: 'Type of action (e.g., swap, transfer, analysis)',
        required: true,
      },
      input_data: {
        type: 'string',
        description: 'Input data for the action',
      },
      outcome: {
        type: 'string',
        description: 'Action outcome',
      },
    },
    handler: 'https://api.claw-net.org/v1/attest',
    method: 'POST',
    auth: 'api-key',
    creditCost: '0.25 credits',
  },
  {
    name: 'clawnet_verify_attestation',
    description:
      'Verify an attestation by ID. Public, no auth needed. Returns signature validity and chain integrity.',
    parameters: {
      attestationId: {
        type: 'string',
        description: 'Attestation ID (att-...)',
        required: true,
      },
    },
    handler: 'https://api.claw-net.org/v1/attest/verify/{attestationId}',
    method: 'GET',
    auth: 'none',
  },
  {
    name: 'clawnet_search_endpoints',
    description:
      `Search ${apiRegistry.length}+ API endpoints across all providers. Find the right data source for any query.`,
    parameters: {
      q: {
        type: 'string',
        description: 'Search query',
      },
      category: {
        type: 'string',
        description:
          'Filter by category (solana, defi, social, ai-ml, etc.)',
      },
      limit: {
        type: 'number',
        description: 'Results limit (max 100)',
      },
    },
    handler: 'https://api.claw-net.org/v1/registry',
    method: 'GET',
    auth: 'none',
  },
  {
    name: 'clawnet_browse_skills',
    description:
      'Browse the skill marketplace. Find skills by search, category, or popularity.',
    parameters: {
      search: {
        type: 'string',
        description: 'Search query',
      },
      category: {
        type: 'string',
        description: 'Skill category filter',
      },
      sort: {
        type: 'string',
        description: 'Sort by: popular | newest | cheapest | rating',
      },
    },
    handler: 'https://api.claw-net.org/v1/marketplace/skills',
    method: 'GET',
    auth: 'none',
  },
  {
    name: 'clawnet_estimate_cost',
    description:
      'Estimate the cost of a query before running it. Free, no auth needed.',
    parameters: {
      query: {
        type: 'string',
        description: 'Query to estimate',
        required: true,
      },
    },
    handler: 'https://api.claw-net.org/v1/estimate',
    method: 'GET',
    auth: 'none',
  },
  {
    name: 'clawnet_x402_invoke',
    description:
      'Invoke a skill via x402 micropayment. No API key needed — pay with USDC on Base.',
    parameters: {
      skillId: {
        type: 'string',
        description: 'Skill ID',
        required: true,
      },
      variables: {
        type: 'object',
        description: 'Input variables',
      },
    },
    handler: 'https://api.claw-net.org/x402/skills/{skillId}',
    method: 'POST',
    auth: 'x402',
    creditCost: 'USDC per call',
  },
];

/**
 * Get ClawNet tools filtered by auth type.
 * Useful for agents that only have API keys or only have wallets.
 */
export function getToolsByAuth(
  auth: 'api-key' | 'x402' | 'none',
): AgentKitTool[] {
  return clawnetTools.filter((t) => t.auth === auth || t.auth === 'none');
}

/**
 * Get free tools only (no auth, no cost).
 */
export function getFreeTools(): AgentKitTool[] {
  return clawnetTools.filter((t) => t.auth === 'none');
}
