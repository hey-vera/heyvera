/**
 * Pricing Preferences — allows clients to set budget constraints and optimization strategy
 * for orchestration requests.
 *
 * Flow:
 * 1. Client sends optional `pricing` object with orchestrate request
 * 2. After intent parsing, we estimate plan cost → 402 if > maxCredits
 * 3. If strategy is "cheapest", swap endpoints to cheaper alternatives where possible
 * 4. During execution, track running cost → skip optional steps if approaching limit
 * 5. Response includes pricing breakdown showing savings vs default plan
 */

import { z } from 'zod';
import { findEndpoint, apiRegistry, dynamicAlternatives, type ApiEndpoint } from '../config/api-registry';
import { creditCostForEndpoint, round6 } from './credits';
import type { ParsedIntent } from './intent-parser';
import { logger } from '../utils/logger';
import { ORCHESTRATION_FEE } from '../config/index';
import { listPublicSkills, type Skill } from '../db/index';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const PricingStrategy = z.enum(['cheapest', 'balanced', 'fastest', 'reliable']);
export type PricingStrategy = z.infer<typeof PricingStrategy>;

export const PricingPreferencesSchema = z.object({
  /** Hard ceiling — abort if estimated cost exceeds this. */
  maxCredits: z.number().int().positive().max(1_000_000).optional(),
  /** Optimizer target — try to hit this cost. */
  targetCredits: z.number().int().positive().max(1_000_000).optional(),
  /** Quality floor — don't optimize below this (prevents degraded results). */
  minCredits: z.number().int().positive().max(1_000_000).optional(),
  /** Optimization strategy. Default: "balanced". */
  strategy: PricingStrategy.default('balanced'),
}).refine(
  (data) => {
    if (data.maxCredits && data.minCredits && data.minCredits > data.maxCredits) return false;
    if (data.maxCredits && data.targetCredits && data.targetCredits > data.maxCredits) return false;
    if (data.minCredits && data.targetCredits && data.targetCredits < data.minCredits) return false;
    return true;
  },
  { message: 'Invalid pricing range: ensure minCredits <= targetCredits <= maxCredits' }
);

export type PricingPreferences = z.infer<typeof PricingPreferencesSchema>;

// ─── Endpoint Alternatives Map ───────────────────────────────────────────────
// Groups endpoints that can satisfy the same data need, sorted cheapest first.
// Key = capability tag, Value = array of endpoint IDs (cheapest → most expensive).
// The optimizer checks if a planned endpoint belongs to a group and can be swapped
// for a cheaper one in the same group.

const ENDPOINT_ALTERNATIVES: Record<string, string[]> = {
  // Token price data
  'token-price': [
    'claw-token-price',       // $0.001
    'automaton-price',        // $0.001
    'crysha-price',           // $0.001
    'twelvedata-price',       // $0.001
    'apollo-prices',          // $0.001
    'coingecko-price',        // $0.001
    'cmc-quotes',             // $0.002
  ],
  // Web scraping
  'web-scrape': [
    'minifetch-summary',      // $0.001
    'claw-web-scrape',        // $0.002
    'olostep-scrape',         // $0.005
    'firecrawl-scrape',       // $0.01
    'browserbase-session',    // $0.01
  ],
  // News / search
  'news-search': [
    'claw-news-search',       // $0.002
    'gloria-news',            // $0.003
    'pylon-search',           // $0.002
    'tavily-search',          // $0.005
    'perplexity-search',      // $0.01
  ],
  // Social sentiment
  'social-sentiment': [
    'claw-x-mentions',        // $0.002
    'twitsh-search',          // $0.002
    'claw-reddit-sentiment',  // $0.002
    'neynar-search',          // $0.003
  ],
  // Token risk analysis
  'token-risk': [
    'claw-token-risk',        // $0.003
    'rugmunch-risk',          // $0.003
    'moltalyzer-token-intel', // $0.005
    'blackswan-risk',         // $0.008
  ],
  // Whale / holder analysis
  'holder-analysis': [
    'claw-token-holders',     // $0.002
    'rugmunch-holder-analysis', // $0.003
    'einstein-whales',        // $0.005
  ],
  // DeFi yields
  'defi-yields': [
    'apollo-defi-yields',     // $0.002
    'diamondclaws-yield',     // $0.003
    'elsa-portfolio',         // $0.005
  ],
  // Trading signals
  'trading-signals': [
    'automaton-signals',      // $0.001
    'slamai-signals',         // $0.005
    'automaton-pump-radar',   // $0.002
  ],
  // DEX / liquidity data
  'dex-data': [
    'einstein-dex',           // $0.003
    'elsa-swap-quote',        // $0.003
  ],
  // Wallet portfolio
  'wallet-portfolio': [
    'claw-wallet-portfolio',  // $0.002
    'elsa-portfolio',         // $0.005
  ],
  // Stock / tradfi prices
  'stock-price': [
    'alphavantage-stock',     // $0.001
    'alpaca-stock-bars',      // $0.001
    'polygon-ticker',         // $0.001
    'polygon-aggregates',     // $0.001
  ],
};

// Reverse lookup: endpoint ID → capability tag
const endpointToCapability = new Map<string, string>();
for (const [capability, endpoints] of Object.entries(ENDPOINT_ALTERNATIVES)) {
  for (const epId of endpoints) {
    endpointToCapability.set(epId, capability);
  }
}

/**
 * Get all alternatives for an endpoint, merging static + discovered.
 * Called by the optimizer to find swap candidates.
 */
function getAllAlternatives(capability: string): string[] {
  const staticAlts = ENDPOINT_ALTERNATIVES[capability] ?? [];
  const discoveredAlts = dynamicAlternatives.get(capability) ?? [];
  // Merge without duplicates
  const merged = [...staticAlts];
  for (const id of discoveredAlts) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

/** Build full capability lookup including discovered endpoints */
function getCapabilityForEndpoint(endpointId: string): string | undefined {
  // Check static first
  const staticCap = endpointToCapability.get(endpointId);
  if (staticCap) return staticCap;
  // Check dynamic alternatives
  for (const [group, ids] of dynamicAlternatives) {
    if (ids.includes(endpointId)) return group;
  }
  return undefined;
}

// ─── Agent Service Discovery Fallback ────────────────────────────────────────
// When no built-in endpoint exists for a capability, search the agent service
// marketplace for skills that can fill the gap. Built-in endpoints are always
// preferred (cheaper, faster, more trusted) — this is the fallback layer.

export interface AgentServiceMatch {
  id: string;
  name: string;
  credit_cost: number;
  skill_type: string;
  success_rate: number;
  avg_rating: number;
  proxy_url: string | null;
}

function findAgentServicesForCapability(capability: string): AgentServiceMatch[] {
  try {
    // Search public skills that could satisfy this capability
    // Prefer api_proxy and data skills (real services, not prompt templates)
    const skills = listPublicSkills(0, 20);

    // Score each skill by keyword match against the capability string
    const capWords = capability.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (capWords.length === 0) return [];

    const scored = skills
      .filter(s =>
        (s.skill_type === 'api_proxy' || s.skill_type === 'data') &&
        s.status !== 'delisted' &&
        s.health_status !== 'DOWN' &&
        s.success_rate > 0.8 &&
        s.avg_rating >= 3.5 &&
        s.proxy_url // Must have an actual service URL
      )
      .map(s => {
        const text = [s.name, s.description, s.category, s.tags_json ?? ''].join(' ').toLowerCase();
        const matchCount = capWords.filter(w => text.includes(w)).length;
        return { skill: s, relevance: matchCount / capWords.length };
      })
      .filter(s => s.relevance > 0.3) // At least 30% keyword overlap
      .sort((a, b) => {
        // Sort by relevance first, then by success_rate * avg_rating (trust score)
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        const trustA = a.skill.success_rate * a.skill.avg_rating;
        const trustB = b.skill.success_rate * b.skill.avg_rating;
        return trustB - trustA;
      })
      .slice(0, 5);

    return scored.map(s => ({
      id: s.skill.id,
      name: s.skill.name,
      credit_cost: s.skill.credit_cost,
      skill_type: s.skill.skill_type,
      success_rate: s.skill.success_rate,
      avg_rating: s.skill.avg_rating,
      proxy_url: s.skill.proxy_url,
    }));
  } catch (err) {
    logger.warn({ err, capability }, 'Agent service discovery fallback failed');
    return [];
  }
}

// ─── Plan Cost Estimation ────────────────────────────────────────────────────

export interface PlanEstimate {
  totalCredits: number;
  perStep: { endpointId: string; credits: number; costUsd: number }[];
}

export function estimatePlanCost(intent: ParsedIntent): PlanEstimate {
  const perStep = intent.steps.map((step) => {
    // Agent service steps carry their own credit cost
    if (step.endpointId.startsWith('skill:')) {
      const creditCost = (step as any).creditCost ?? 1;
      return { endpointId: step.endpointId, credits: creditCost, costUsd: round6(creditCost / 1000) };
    }
    const ep = findEndpoint(step.endpointId);
    const costUsd = ep?.costPerCall ?? 0.001;
    return { endpointId: step.endpointId, credits: ep ? creditCostForEndpoint(ep) : 1, costUsd };
  });
  const totalCredits = round6(perStep.reduce((sum, s) => sum + s.credits, 0) + ORCHESTRATION_FEE);
  return { totalCredits, perStep };
}

// ─── Budget Pre-flight ───────────────────────────────────────────────────────

export interface BudgetCheckResult {
  ok: boolean;
  estimatedCredits: number;
  maxCredits?: number;
  error?: string;
}

export function checkBudget(intent: ParsedIntent, pricing: PricingPreferences): BudgetCheckResult {
  const estimate = estimatePlanCost(intent);
  if (pricing.maxCredits && estimate.totalCredits > pricing.maxCredits) {
    return {
      ok: false,
      estimatedCredits: estimate.totalCredits,
      maxCredits: pricing.maxCredits,
      error: `Estimated cost (${estimate.totalCredits} credits) exceeds your maxCredits (${pricing.maxCredits})`,
    };
  }
  return { ok: true, estimatedCredits: estimate.totalCredits };
}

// ─── Plan Optimizer ──────────────────────────────────────────────────────────

export interface OptimizationResult {
  intent: ParsedIntent;
  swaps: { stepIndex: number; from: string; to: string; savedCredits: number }[];
  originalCredits: number;
  optimizedCredits: number;
}

/**
 * Optimize a plan based on pricing preferences.
 * - "cheapest": swap every endpoint to the cheapest alternative in its group
 * - "balanced": swap only if over targetCredits, preferring moderate-cost alternatives
 * - "fastest": swap to the lowest-latency alternative in the group
 * - "reliable": no swaps — use the LLM's original selection (most tailored)
 */
export function optimizePlan(intent: ParsedIntent, pricing: PricingPreferences): OptimizationResult {
  const original = estimatePlanCost(intent);
  const swaps: OptimizationResult['swaps'] = [];

  const optimizedSteps = [...intent.steps];

  // "reliable" strategy skips endpoint swaps but still fills capability gaps
  if (pricing.strategy === 'reliable') {
    // Still run agent service fallback for missing endpoints
    const agentServiceSwaps: OptimizationResult['swaps'] = [];
    for (let i = 0; i < optimizedSteps.length; i++) {
      const step = optimizedSteps[i];
      if (step.endpointId.startsWith('skill:')) continue;
      const ep = findEndpoint(step.endpointId);
      if (ep) continue;
      const capability = step.reason || step.endpointId;
      const agentServices = findAgentServicesForCapability(capability);
      if (agentServices.length > 0) {
        const best = agentServices[0];
        const oldId = step.endpointId;
        optimizedSteps[i] = {
          ...step,
          endpointId: `skill:${best.id}`,
          ...(({ creditCost: best.credit_cost, source: 'agent_service' }) as any),
        };
        agentServiceSwaps.push({ stepIndex: i, from: oldId, to: `skill:${best.id}`, savedCredits: 0 });
        logger.info({ stepIndex: i, from: oldId, to: `skill:${best.id}`, skillName: best.name }, 'Agent service fallback (reliable): filled capability gap');
      }
    }
    if (agentServiceSwaps.length > 0) {
      const filledIntent = { ...intent, steps: optimizedSteps };
      return { intent: filledIntent, swaps: agentServiceSwaps, originalCredits: original.totalCredits, optimizedCredits: estimatePlanCost(filledIntent).totalCredits };
    }
    return { intent, swaps, originalCredits: original.totalCredits, optimizedCredits: original.totalCredits };
  }
  let currentCredits = original.totalCredits;

  for (let i = 0; i < optimizedSteps.length; i++) {
    const step = optimizedSteps[i];
    const capability = getCapabilityForEndpoint(step.endpointId);
    if (!capability) continue;

    const alternatives = getAllAlternatives(capability);
    if (!alternatives || alternatives.length <= 1) continue;

    const currentEp = findEndpoint(step.endpointId);
    if (!currentEp) continue;
    const currentCost = currentEp.costPerCall;

    let bestId: string | null = null;
    let bestCost = currentCost;
    let bestLatency = currentEp.latencyMs;

    for (const altId of alternatives) {
      if (altId === step.endpointId) continue;
      const altEp = findEndpoint(altId);
      if (!altEp) continue;

      switch (pricing.strategy) {
        case 'cheapest':
          if (altEp.costPerCall < bestCost) {
            bestId = altId;
            bestCost = altEp.costPerCall;
            bestLatency = altEp.latencyMs;
          }
          break;

        case 'fastest':
          if (altEp.latencyMs < bestLatency) {
            bestId = altId;
            bestCost = altEp.costPerCall;
            bestLatency = altEp.latencyMs;
          }
          break;

        case 'balanced': {
          // Only swap if we're over target and this alternative is cheaper
          const target = pricing.targetCredits ?? pricing.maxCredits;
          if (target && currentCredits > target && altEp.costPerCall < bestCost) {
            bestId = altId;
            bestCost = altEp.costPerCall;
            bestLatency = altEp.latencyMs;
          }
          break;
        }
      }
    }

    if (bestId && bestId !== step.endpointId) {
      const savedUsd = currentCost - bestCost;
      const savedCredits = creditCostForEndpoint(currentEp) - (findEndpoint(bestId) ? creditCostForEndpoint(findEndpoint(bestId)!) : 1);

      // Don't swap below minCredits floor
      if (pricing.minCredits && (currentCredits - savedCredits) < pricing.minCredits) {
        continue;
      }

      swaps.push({ stepIndex: i, from: step.endpointId, to: bestId, savedCredits });
      optimizedSteps[i] = { ...step, endpointId: bestId };
      currentCredits -= savedCredits;
    }
  }

  // ── Agent Service Fallback ─────────────────────────────────────────────────
  // For any step whose endpoint doesn't exist in the registry (ENDPOINT_NOT_FOUND
  // at execution time), try to find an agent service that can handle it.
  // This is the last resort — built-in endpoints are always preferred.
  const agentServiceSwaps: OptimizationResult['swaps'] = [];
  for (let i = 0; i < optimizedSteps.length; i++) {
    const step = optimizedSteps[i];
    // Skip steps that already resolved to an agent service
    if (step.endpointId.startsWith('skill:')) continue;

    const ep = findEndpoint(step.endpointId);
    if (ep) continue; // Built-in endpoint exists — no fallback needed

    // No built-in endpoint found — search agent services
    const capability = step.reason || step.endpointId;
    const agentServices = findAgentServicesForCapability(capability);
    if (agentServices.length > 0) {
      const best = agentServices[0];
      const oldId = step.endpointId;
      optimizedSteps[i] = {
        ...step,
        endpointId: `skill:${best.id}`,
        // Attach credit cost for billing downstream
        ...(({ creditCost: best.credit_cost, source: 'agent_service' }) as any),
      };
      agentServiceSwaps.push({
        stepIndex: i,
        from: oldId,
        to: `skill:${best.id}`,
        savedCredits: 0, // Not a cost optimization — this is a capability gap fill
      });
      logger.info({ stepIndex: i, from: oldId, to: `skill:${best.id}`, skillName: best.name }, 'Agent service fallback: filled capability gap');
    }
  }

  const allSwaps = [...swaps, ...agentServiceSwaps];
  const optimizedIntent = allSwaps.length > 0
    ? { ...intent, steps: optimizedSteps }
    : intent;

  // Recalculate credits if agent services were added
  const finalCredits = agentServiceSwaps.length > 0
    ? estimatePlanCost(optimizedIntent).totalCredits
    : currentCredits;

  return {
    intent: optimizedIntent,
    swaps: allSwaps,
    originalCredits: original.totalCredits,
    optimizedCredits: finalCredits,
  };
}

// ─── Strategy Prompt Hint ────────────────────────────────────────────────────

/**
 * Returns an additional instruction to inject into the LLM system prompt
 * when the client specifies pricing preferences.
 */
export function pricingPromptHint(pricing: PricingPreferences): string {
  const parts: string[] = [];

  if (pricing.maxCredits) {
    parts.push(`The user has a budget limit of ${pricing.maxCredits} credits. Each credit ≈ $0.0005 API cost.`);
  }

  switch (pricing.strategy) {
    case 'cheapest':
      parts.push('IMPORTANT: Prefer the cheapest endpoints. Minimize step count. Skip optional enrichment steps.');
      break;
    case 'fastest':
      parts.push('IMPORTANT: Prefer endpoints with the lowest latency. Minimize total execution time.');
      break;
    case 'balanced':
      if (pricing.targetCredits) {
        parts.push(`Try to keep the total plan cost near ${pricing.targetCredits} credits. Balance cost and quality.`);
      }
      break;
    case 'reliable':
      parts.push('Choose the most reliable and comprehensive endpoints regardless of cost.');
      break;
  }

  return parts.join(' ');
}

// ─── Exports for endpoint alternatives (used by /v1/estimate) ────────────────

export function getAlternativesForEndpoint(endpointId: string): { id: string; costPerCall: number; latencyMs: number }[] {
  const capability = getCapabilityForEndpoint(endpointId);
  if (!capability) return [];

  return getAllAlternatives(capability)
    .filter((id) => id !== endpointId)
    .map((id) => {
      const ep = findEndpoint(id);
      return ep ? { id, costPerCall: ep.costPerCall, latencyMs: ep.latencyMs } : null;
    })
    .filter(Boolean) as { id: string; costPerCall: number; latencyMs: number }[];
}
