/**
 * skill-executor.ts
 *
 * Builds a ParsedIntent directly from a skill's stored execution plan,
 * bypassing LLM intent parsing entirely (~3-5s saved per skill invocation).
 *
 * Official skills ship with deterministic execution plans. Third-party skills
 * can optionally define one too. Falls back to parseIntent() if absent.
 */

import type { ParsedIntent } from './intent-parser';
import { findEndpoint } from '../config/api-registry';
import { logger } from '../utils/logger';

export interface SkillStep {
  /** Endpoint ID from the API registry */
  endpointId: string;
  /**
   * Param values to pass to the endpoint.
   * Values may contain {varName} placeholders that are interpolated
   * from the skill's user-supplied variables at execution time.
   * Example: { "symbol": "{token}", "query": "{token} crypto" }
   */
  params: Record<string, string>;
}

export type SkillExecutionPlan = SkillStep[];

/**
 * Interpolate {varName} placeholders in a string with values from variables.
 * Unknown placeholders are replaced with empty string.
 */
function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => variables[key] ?? '');
}

/**
 * Build a ParsedIntent from a skill's execution_plan_json and user-supplied variables.
 * All steps run in a single parallel group (no dependencies between them).
 *
 * Returns null if the plan is malformed or all steps reference unknown endpoints
 * (caller should fall back to parseIntent()).
 */
export function buildIntentFromPlan(
  planJson: string,
  variables: Record<string, string>,
  skillName: string,
): ParsedIntent | null {
  let plan: SkillExecutionPlan;
  try {
    plan = JSON.parse(planJson) as SkillExecutionPlan;
  } catch {
    logger.warn({ skillName }, 'Skill execution plan: invalid JSON — falling back to LLM');
    return null;
  }

  if (!Array.isArray(plan) || plan.length === 0) return null;

  const steps: ParsedIntent['steps'] = [];
  for (const step of plan) {
    if (!findEndpoint(step.endpointId)) {
      logger.warn({ endpointId: step.endpointId, skillName }, 'Skill plan: unknown endpoint — skipping');
      continue;
    }
    const resolvedParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.params ?? {})) {
      resolvedParams[key] = interpolate(value, variables);
    }
    steps.push({
      endpointId: step.endpointId,
      params: resolvedParams,
      dependsOn: [],
      reason: `Skill execution plan step`,
    });
  }

  if (steps.length === 0) {
    logger.warn({ skillName }, 'Skill plan: no valid steps after endpoint validation — falling back to LLM');
    return null;
  }

  logger.info({ skillName, steps: steps.length }, 'Skill plan: deterministic intent built — LLM skipped');

  return {
    summary: `${skillName} — deterministic plan`,
    reasoning: 'Skill execution plan — no LLM intent parsing needed',
    steps,
    parallelGroups: [steps.map((_, i) => String(i))],
  };
}
