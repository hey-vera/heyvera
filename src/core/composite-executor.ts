/**
 * Composite Skill Executor v2 — orchestrates sub-skill invocations with:
 *   - Output piping (step N output → step N+1 input via {{steps.outputKey.field}})
 *   - Parallel execution groups (steps in same group run concurrently)
 *   - Conditional steps (skip based on variable/output conditions)
 *   - Retry/fallback (retry count + fallback skill on failure)
 *   - Composite-level caching (Redis, configurable TTL)
 *   - Pre-flight cost estimation
 *
 * Backward compatible: plain dependency arrays still work as sequential execution.
 */

import { logger } from '../utils/logger';
import { maskApiKey } from '../utils/mask';
import { round6 } from './credits';
import {
  getSkill, incrementSkillUses, recordSkillMetric, recordReputation,
  topUpCredits, deductCredit, recordTransaction, getDb,
} from '../db/index';
import { trackDelegatedSpend } from '../utils/billing';
import { computeRequestHash, computeResultHash } from '../utils/receipt-hash';
import { cacheGet, cacheSet } from '../cache/index';
import type { Skill, SkillDependency } from '../db/index';
import crypto from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface CompositeConfig {
  cacheTtl?: number;              // seconds — cache entire composite result
  executionMode?: 'sequential' | 'grouped'; // default: auto-detect from groups
  maxTotalCredits?: number;       // pre-flight budget cap (overrides sum-based estimate)
}

export interface CompositeContext {
  callerKey: string;
  callerKeyInfo: { key: string; isEnvKey: boolean; credits: number; amountPaid: number; delegatedFrom?: string };
  parentRequestId: string;
}

export interface CompositeResult {
  ok: boolean;
  results: Record<string, unknown>;
  costBreakdown: { skillId: string; creditsCharged: number; skipped?: boolean; fallbackUsed?: boolean }[];
  totalCreditsCharged: number;
  durationMs: number;
  cached?: boolean;
  error?: string;
}

export interface CostEstimate {
  totalCredits: number;
  assemblyFee: number;
  dependencies: { skillId: string; name: string; credits: number; conditional: boolean }[];
  maxCredits: number; // worst case (all conditionals execute)
}

// ─── Condition Evaluation ───────────────────────────────────────────────────────

function resolveValue(ref: string, variables: Record<string, string>, results: Record<string, unknown>): unknown {
  // {{steps.outputKey.field}} — reference a previous step's output
  const stepsMatch = ref.match(/^\{\{steps\.(\w+)(?:\.(.+))?\}\}$/);
  if (stepsMatch) {
    const [, outputKey, fieldPath] = stepsMatch;
    const stepResult = results[outputKey];
    if (fieldPath && stepResult && typeof stepResult === 'object') {
      return getNestedField(stepResult as Record<string, unknown>, fieldPath);
    }
    return stepResult;
  }
  // {{variable}} — caller's input
  const varMatch = ref.match(/^\{\{(\w+)\}\}$/);
  if (varMatch) return variables[varMatch[1]];
  // Literal string/number
  const num = Number(ref);
  if (!isNaN(num)) return num;
  return ref;
}

function getNestedField(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(
  condition: SkillDependency['condition'],
  variables: Record<string, string>,
  results: Record<string, unknown>,
): boolean {
  if (!condition) return true; // no condition = always execute

  const fieldValue = resolveValue(condition.field, variables, results);

  switch (condition.op) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null || fieldValue === '';
    case 'eq':
      return String(fieldValue) === String(condition.value);
    case 'neq':
      return String(fieldValue) !== String(condition.value);
    case 'gt':
      return Number(fieldValue) > Number(condition.value);
    case 'lt':
      return Number(fieldValue) < Number(condition.value);
    case 'gte':
      return Number(fieldValue) >= Number(condition.value);
    case 'lte':
      return Number(fieldValue) <= Number(condition.value);
    case 'contains':
      return String(fieldValue).includes(String(condition.value));
    default:
      return true;
  }
}

// ─── Param Resolution ───────────────────────────────────────────────────────────

function resolveParams(
  paramMapping: Record<string, string>,
  variables: Record<string, string>,
  results: Record<string, unknown>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [paramKey, paramTemplate] of Object.entries(paramMapping)) {
    let value = paramTemplate;
    // Replace {{steps.outputKey.field}} with previous step output
    value = value.replace(/\{\{steps\.(\w+)(?:\.([^}]+))?\}\}/g, (_match, outputKey, fieldPath) => {
      const stepResult = results[outputKey];
      if (fieldPath && stepResult && typeof stepResult === 'object') {
        const fieldVal = getNestedField(stepResult as Record<string, unknown>, fieldPath);
        return fieldVal !== undefined ? String(fieldVal) : '';
      }
      return stepResult !== undefined ? (typeof stepResult === 'object' ? JSON.stringify(stepResult) : String(stepResult)) : '';
    });
    // Replace {{variable}} with caller's input or previous step outputKey (backward compat)
    value = value.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
      if (varName in results) return typeof results[varName] === 'object' ? JSON.stringify(results[varName]) : String(results[varName]);
      return variables[varName] ?? '';
    });
    resolved[paramKey] = value;
  }
  return resolved;
}

// ─── Single Step Execution ──────────────────────────────────────────────────────

async function executeStep(
  depSkill: Skill,
  resolvedParams: Record<string, string>,
): Promise<unknown> {
  if (depSkill.skill_type === 'data' && depSkill.proxy_url) {
    const url = new URL(depSkill.proxy_url);
    for (const [k, v] of Object.entries(resolvedParams)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Data source returned ${res.status}`);
    return await res.json().catch(async () => ({ raw: await res.text() }));
  } else if (depSkill.skill_type === 'api_proxy' && depSkill.proxy_url) {
    const res = await fetch(depSkill.proxy_url, {
      method: depSkill.proxy_method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: depSkill.proxy_method !== 'GET' ? JSON.stringify(resolvedParams) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
    return await res.json().catch(async () => ({ raw: await res.text() }));
  } else {
    throw new Error(`Unsupported dependency type: ${depSkill.skill_type}`);
  }
}

async function executeStepWithRetry(
  depSkill: Skill,
  dep: SkillDependency,
  resolvedParams: Record<string, string>,
  variables: Record<string, string>,
  results: Record<string, unknown>,
): Promise<{ result: unknown; fallbackUsed: boolean; skillUsed: Skill }> {
  const maxRetries = Math.min(dep.retries ?? 1, 3);
  let lastError: Error | undefined;

  // Try primary skill
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await executeStep(depSkill, resolvedParams);
      return { result, fallbackUsed: false, skillUsed: depSkill };
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }

  // Try fallback skill if configured
  if (dep.fallbackSkillId) {
    const fallbackSkill = getSkill(dep.fallbackSkillId);
    if (fallbackSkill && fallbackSkill.active) {
      const fallbackParams = resolveParams(dep.paramMapping, variables, results);
      try {
        const result = await executeStep(fallbackSkill, fallbackParams);
        return { result, fallbackUsed: true, skillUsed: fallbackSkill };
      } catch (err) {
        lastError = err as Error;
      }
    }
  }

  throw lastError ?? new Error('Step execution failed');
}

// ─── Billing Helper ─────────────────────────────────────────────────────────────

function billForStep(
  depSkill: Skill,
  depCredits: number,
  context: CompositeContext,
  compositeSkill: Skill,
  resolvedParams: Record<string, string>,
  depResult: unknown,
  dep: SkillDependency,
): void {
  if (context.callerKeyInfo.isEnvKey) return;

  const revenueSharePct = depSkill.revenue_share_pct;
  const shouldPayAuthor = depSkill.author_key !== context.callerKey && revenueSharePct > 0;

  getDb().transaction(() => {
    deductCredit(context.callerKey, depCredits);
    if (shouldPayAuthor) {
      const authorShare = round6(depCredits * revenueSharePct);
      const feeCredits = round6(depCredits - authorShare);
      if (authorShare > 0) {
        topUpCredits(depSkill.author_key, authorShare);
        if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
        const timestamp = new Date().toISOString();
        recordTransaction({
          fromAgent: context.callerKey, toAgent: depSkill.author_key,
          amountCredits: depCredits, type: 'SKILL_SALE',
          skillId: dep.skillId, feeCredits,
          requestHash: computeRequestHash({ skillId: dep.skillId, variables: resolvedParams, timestamp }),
          resultHash: computeResultHash({ data: depResult, costCredits: depCredits }),
          metadata: { compositeParent: compositeSkill.id, parentRequestId: context.parentRequestId },
        });
      }
    }
  })();
  trackDelegatedSpend(context.callerKeyInfo, depCredits);
}

// ─── Cost Estimation ────────────────────────────────────────────────────────────

export function estimateCompositeCost(skill: Skill): CostEstimate | { error: string } {
  if (!skill.dependencies_json) return { error: 'No dependencies defined' };

  let deps: SkillDependency[];
  try { deps = JSON.parse(skill.dependencies_json); } catch { return { error: 'Invalid dependencies_json' }; }

  const assemblyFee = Math.max(0.001, skill.credit_cost);
  const dependencies: CostEstimate['dependencies'] = [];
  let totalRequired = 0;
  let maxTotal = 0;

  for (const dep of deps) {
    const depSkill = getSkill(dep.skillId);
    if (!depSkill) return { error: `Dependency not found: ${dep.skillId}` };
    const cost = Math.max(0.001, depSkill.credit_cost);
    const isConditional = !!dep.condition;
    dependencies.push({ skillId: dep.skillId, name: depSkill.display_name ?? depSkill.name, credits: cost, conditional: isConditional });
    if (!isConditional) totalRequired += cost;
    maxTotal += cost;
  }

  return {
    totalCredits: round6(totalRequired + assemblyFee),
    assemblyFee,
    dependencies,
    maxCredits: round6(maxTotal + assemblyFee),
  };
}

// ─── Cache Key ──────────────────────────────────────────────────────────────────

function compositesCacheKey(skillId: string, variables: Record<string, string>): string {
  const sorted = JSON.stringify(variables, Object.keys(variables).sort());
  const hash = crypto.createHash('sha256').update(`${skillId}:${sorted}`).digest('hex').slice(0, 16);
  return `composite:${skillId}:${hash}`;
}

// ─── Main Executor ──────────────────────────────────────────────────────────────

/**
 * Execute a composite skill with full v2 features:
 * output piping, parallel groups, conditionals, retry/fallback, caching.
 */
const MAX_COMPOSITE_DEPTH = 3;
const MAX_TOTAL_INVOCATIONS = 10;

export async function executeCompositeSkill(
  skill: Skill,
  variables: Record<string, string>,
  context: CompositeContext,
  _depth = 0,
  _invocationCounter?: { count: number },
): Promise<CompositeResult> {
  // Defense-in-depth: runtime depth check
  if (_depth > MAX_COMPOSITE_DEPTH) {
    return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: `Composite nesting too deep (max ${MAX_COMPOSITE_DEPTH})` };
  }
  const invocations = _invocationCounter ?? { count: 0 };
  const start = Date.now();

  if (!skill.dependencies_json) {
    return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: 'No dependencies defined' };
  }

  let deps: SkillDependency[];
  try { deps = JSON.parse(skill.dependencies_json); } catch {
    return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: 'Invalid dependencies_json' };
  }

  // Parse composite config (v66+)
  let config: CompositeConfig = {};
  if (skill.composite_config_json) {
    try { config = JSON.parse(skill.composite_config_json); } catch { /* use defaults */ }
  }

  // Check composite-level cache
  if (config.cacheTtl && config.cacheTtl > 0) {
    const cacheKey = compositesCacheKey(skill.id, variables);
    const cached = await cacheGet<CompositeResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true, durationMs: Date.now() - start };
    }
  }

  // Resolve all dependency skills
  const depSkills: (Skill & { depDef: SkillDependency })[] = [];
  let totalDepCost = 0;
  for (const dep of deps) {
    const depSkill = getSkill(dep.skillId);
    if (!depSkill) {
      return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: `Dependency skill not found: ${dep.skillId}` };
    }
    // Only count non-conditional deps for required cost; conditionals might not execute
    if (!dep.condition) {
      totalDepCost += Math.max(0.001, depSkill.credit_cost);
    } else {
      // For pre-flight, include conditional deps in worst-case
      totalDepCost += Math.max(0.001, depSkill.credit_cost);
    }
    depSkills.push({ ...depSkill, depDef: dep });
  }

  const assemblyFee = Math.max(0.001, skill.credit_cost);
  const totalCost = round6(totalDepCost + assemblyFee);
  const budgetCap = config.maxTotalCredits ? Math.min(config.maxTotalCredits, totalCost) : totalCost;

  // Pre-flight budget check
  if (!context.callerKeyInfo.isEnvKey && context.callerKeyInfo.credits < budgetCap) {
    return {
      ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: Date.now() - start,
      error: `Insufficient credits. Composite skill requires up to ${totalCost} credits (${totalDepCost} for dependencies + ${assemblyFee} assembly fee). Available: ${context.callerKeyInfo.credits}`,
    };
  }

  // Group steps by parallel group (undefined group = sequential, run alone)
  const hasGroups = depSkills.some(d => d.depDef.group !== undefined);
  const results: Record<string, unknown> = {};
  const costBreakdown: CompositeResult['costBreakdown'] = [];
  let totalCharged = 0;

  if (hasGroups) {
    // Grouped execution: steps with same group number run in parallel
    const groupMap = new Map<number, (Skill & { depDef: SkillDependency })[]>();
    const ungrouped: (Skill & { depDef: SkillDependency })[] = [];

    for (const ds of depSkills) {
      if (ds.depDef.group !== undefined) {
        if (!groupMap.has(ds.depDef.group)) groupMap.set(ds.depDef.group, []);
        groupMap.get(ds.depDef.group)!.push(ds);
      } else {
        ungrouped.push(ds);
      }
    }

    // Execute groups in order (group 0, 1, 2...), ungrouped steps run in their original order between groups
    const sortedGroups = Array.from(groupMap.keys()).sort((a, b) => a - b);
    let ungroupedIdx = 0;

    // Interleave: run ungrouped steps that appear before each group, then the group
    for (const groupNum of sortedGroups) {
      // Run any ungrouped steps that should execute before this group
      while (ungroupedIdx < ungrouped.length) {
        const depIdx = depSkills.indexOf(ungrouped[ungroupedIdx]);
        const groupFirstIdx = depSkills.indexOf(groupMap.get(groupNum)![0]);
        if (depIdx < groupFirstIdx) {
          const stepResult = await executeSingleStep(ungrouped[ungroupedIdx], variables, results, context, skill, costBreakdown);
          if (stepResult.error) return { ok: false, results, costBreakdown, totalCreditsCharged: totalCharged, durationMs: Date.now() - start, error: stepResult.error };
          if (!stepResult.skipped) totalCharged += stepResult.charged;
          ungroupedIdx++;
        } else break;
      }

      // Execute group in parallel
      const groupSteps = groupMap.get(groupNum)!;
      const parallelResults = await Promise.allSettled(
        groupSteps.map(ds => executeSingleStep(ds, variables, results, context, skill, costBreakdown))
      );

      for (let i = 0; i < parallelResults.length; i++) {
        const pr = parallelResults[i];
        if (pr.status === 'rejected') {
          return { ok: false, results, costBreakdown, totalCreditsCharged: totalCharged, durationMs: Date.now() - start, error: `Group ${groupNum} step ${groupSteps[i].depDef.skillId} failed: ${pr.reason}` };
        }
        if (pr.value.error) {
          return { ok: false, results, costBreakdown, totalCreditsCharged: totalCharged, durationMs: Date.now() - start, error: pr.value.error };
        }
        if (!pr.value.skipped) totalCharged += pr.value.charged;
      }
    }

    // Run remaining ungrouped steps
    while (ungroupedIdx < ungrouped.length) {
      const stepResult = await executeSingleStep(ungrouped[ungroupedIdx], variables, results, context, skill, costBreakdown);
      if (stepResult.error) return { ok: false, results, costBreakdown, totalCreditsCharged: totalCharged, durationMs: Date.now() - start, error: stepResult.error };
      if (!stepResult.skipped) totalCharged += stepResult.charged;
      ungroupedIdx++;
    }
  } else {
    // Sequential execution (original behavior, backward compatible)
    for (const depSkill of depSkills) {
      const stepResult = await executeSingleStep(depSkill, variables, results, context, skill, costBreakdown);
      if (stepResult.error) {
        return { ok: false, results, costBreakdown, totalCreditsCharged: totalCharged, durationMs: Date.now() - start, error: stepResult.error };
      }
      if (!stepResult.skipped) totalCharged += stepResult.charged;
    }
  }

  // Charge assembly fee to composite author
  if (!context.callerKeyInfo.isEnvKey) {
    const revenueSharePct = skill.revenue_share_pct;
    const shouldPayAuthor = skill.author_key !== context.callerKey && revenueSharePct > 0;

    getDb().transaction(() => {
      deductCredit(context.callerKey, assemblyFee);
      if (shouldPayAuthor) {
        const authorShare = round6(assemblyFee * revenueSharePct);
        const feeCredits = round6(assemblyFee - authorShare);
        if (authorShare > 0) {
          topUpCredits(skill.author_key, authorShare);
          if (feeCredits > 0) topUpCredits('clawhub-treasury', feeCredits);
          const timestamp = new Date().toISOString();
          recordTransaction({
            fromAgent: context.callerKey, toAgent: skill.author_key,
            amountCredits: assemblyFee, type: 'SKILL_SALE',
            skillId: skill.id, feeCredits,
            requestHash: computeRequestHash({ skillId: skill.id, variables, timestamp }),
            resultHash: computeResultHash({ data: results, costCredits: assemblyFee }),
            metadata: { compositeAssemblyFee: true, parentRequestId: context.parentRequestId },
          });
        }
      }
    })();
    trackDelegatedSpend(context.callerKeyInfo, assemblyFee);
  }

  totalCharged += assemblyFee;
  costBreakdown.push({ skillId: skill.id, creditsCharged: assemblyFee });
  incrementSkillUses(skill.id);
  recordSkillMetric({ skillId: skill.id, version: skill.version ?? '1.0.0', latencyMs: Date.now() - start, success: true, costCredits: totalCharged });

  if (skill.author_key && skill.author_key !== context.callerKey) {
    recordReputation({ agentId: skill.author_key, skillId: skill.id, eventType: 'COMPOSITE_INVOKED', scoreDelta: 0.2, data: { invokerKey: maskApiKey(context.callerKey), deps: deps.length } });
  }

  const finalResult: CompositeResult = {
    ok: true,
    results,
    costBreakdown,
    totalCreditsCharged: round6(totalCharged),
    durationMs: Date.now() - start,
  };

  // Cache composite result
  if (config.cacheTtl && config.cacheTtl > 0) {
    const cacheKey = compositesCacheKey(skill.id, variables);
    cacheSet(cacheKey, finalResult, config.cacheTtl).catch(() => {});
  }

  return finalResult;

  // ─── Inner: execute a single step ─────────────────────────────────────────
  async function executeSingleStep(
    depSkillEntry: Skill & { depDef: SkillDependency },
    vars: Record<string, string>,
    stepResults: Record<string, unknown>,
    ctx: CompositeContext,
    compositeSkill: Skill,
    breakdown: CompositeResult['costBreakdown'],
  ): Promise<{ charged: number; skipped: boolean; error?: string }> {
    const dep = depSkillEntry.depDef;
    const depStart = Date.now();

    // Evaluate condition
    if (!evaluateCondition(dep.condition, vars, stepResults)) {
      breakdown.push({ skillId: dep.skillId, creditsCharged: 0, skipped: true });
      logger.debug({ skillId: dep.skillId, outputKey: dep.outputKey }, 'Composite step skipped (condition not met)');
      return { charged: 0, skipped: true };
    }

    const resolvedParams = resolveParams(dep.paramMapping, vars, stepResults);
    const depCredits = Math.max(0.001, depSkillEntry.credit_cost);

    try {
      // v67: Recursive composite-of-composite support
      if (depSkillEntry.skill_type === 'composite') {
        if (invocations.count >= MAX_TOTAL_INVOCATIONS) {
          return { charged: 0, skipped: false, error: `Max total invocations (${MAX_TOTAL_INVOCATIONS}) exceeded` };
        }
        const nestedResult = await executeCompositeSkill(
          depSkillEntry, resolvedParams as Record<string, string>, ctx, _depth + 1, invocations,
        );
        if (!nestedResult.ok) {
          return { charged: 0, skipped: false, error: `Nested composite ${dep.skillId} failed: ${nestedResult.error}` };
        }
        stepResults[dep.outputKey] = nestedResult.results;
        breakdown.push({ skillId: dep.skillId, creditsCharged: nestedResult.totalCreditsCharged });
        return { charged: nestedResult.totalCreditsCharged, skipped: false };
      }

      // Track invocation count
      invocations.count++;
      if (invocations.count > MAX_TOTAL_INVOCATIONS) {
        return { charged: 0, skipped: false, error: `Max total invocations (${MAX_TOTAL_INVOCATIONS}) exceeded` };
      }

      const { result: depResult, fallbackUsed, skillUsed } = await executeStepWithRetry(
        depSkillEntry, dep, resolvedParams, vars, stepResults,
      );

      stepResults[dep.outputKey] = depResult;

      // Bill using the actual skill that executed (might be fallback)
      const billSkill = fallbackUsed ? skillUsed : depSkillEntry;
      const billCredits = Math.max(0.001, billSkill.credit_cost);
      billForStep(billSkill, billCredits, ctx, compositeSkill, resolvedParams, depResult, dep);

      incrementSkillUses(billSkill.id);
      recordSkillMetric({ skillId: billSkill.id, version: billSkill.version ?? '1.0.0', latencyMs: Date.now() - depStart, success: true, costCredits: billCredits });
      breakdown.push({ skillId: dep.skillId, creditsCharged: billCredits, fallbackUsed });

      return { charged: billCredits, skipped: false };
    } catch (err) {
      logger.error({ err, skillId: dep.skillId, compositeId: compositeSkill.id, requestId: ctx.parentRequestId }, 'Composite dependency failed');
      recordSkillMetric({ skillId: dep.skillId, version: depSkillEntry.version ?? '1.0.0', latencyMs: Date.now() - depStart, success: false, costCredits: 0 });

      return { charged: 0, skipped: false, error: `Dependency ${dep.skillId} failed: ${(err as Error).message}` };
    }
  }
}
