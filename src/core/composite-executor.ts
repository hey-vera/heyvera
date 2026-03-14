/**
 * Composite Skill Executor — orchestrates sub-skill invocations for composite skills.
 *
 * Composite skills declare dependencies (max 5, flat only — no composite-of-composite).
 * Each dependency is invoked sequentially, billing the caller per sub-skill.
 * The composite author earns their credit_cost as an assembly fee (85/15 split).
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
import type { Skill, SkillDependency } from '../db/skills';

export interface CompositeContext {
  callerKey: string;
  callerKeyInfo: { key: string; isEnvKey: boolean; credits: number; amountPaid: number; delegatedFrom?: string };
  parentRequestId: string;
}

export interface CompositeResult {
  ok: boolean;
  results: Record<string, unknown>;
  costBreakdown: { skillId: string; creditsCharged: number }[];
  totalCreditsCharged: number;
  durationMs: number;
  error?: string;
}

/**
 * Execute a composite skill by invoking each dependency sequentially.
 * Pre-checks total cost before any execution to avoid partial billing.
 */
export async function executeCompositeSkill(
  skill: Skill,
  variables: Record<string, string>,
  context: CompositeContext,
): Promise<CompositeResult> {
  const start = Date.now();

  if (!skill.dependencies_json) {
    return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: 'No dependencies defined' };
  }

  let deps: SkillDependency[];
  try { deps = JSON.parse(skill.dependencies_json); } catch {
    return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: 'Invalid dependencies_json' };
  }

  // Pre-calculate total cost: sum of dependency costs + composite assembly fee
  const depSkills: (Skill & { depDef: SkillDependency })[] = [];
  let totalDepCost = 0;
  for (const dep of deps) {
    const depSkill = getSkill(dep.skillId);
    if (!depSkill) {
      return { ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: 0, error: `Dependency skill not found: ${dep.skillId}` };
    }
    totalDepCost += Math.max(0.001, depSkill.credit_cost);
    depSkills.push({ ...depSkill, depDef: dep });
  }

  const assemblyFee = Math.max(0.001, skill.credit_cost);
  const totalCost = round6(totalDepCost + assemblyFee);

  // Pre-flight budget check
  if (!context.callerKeyInfo.isEnvKey && context.callerKeyInfo.credits < totalCost) {
    return {
      ok: false, results: {}, costBreakdown: [], totalCreditsCharged: 0, durationMs: Date.now() - start,
      error: `Insufficient credits. Composite skill requires ${totalCost} credits (${totalDepCost} for dependencies + ${assemblyFee} assembly fee). Available: ${context.callerKeyInfo.credits}`,
    };
  }

  // Execute each dependency sequentially
  const results: Record<string, unknown> = {};
  const costBreakdown: { skillId: string; creditsCharged: number }[] = [];
  let totalCharged = 0;

  for (const depSkill of depSkills) {
    const dep = depSkill.depDef;
    const depStart = Date.now();
    const depCredits = Math.max(0.001, depSkill.credit_cost);

    // Resolve param mapping — {{varName}} references caller's variables or previous outputs
    const resolvedParams: Record<string, string> = {};
    for (const [paramKey, paramTemplate] of Object.entries(dep.paramMapping)) {
      let value = paramTemplate;
      // Replace {{variable}} with caller's input
      value = value.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
        // Check previous step outputs first, then caller variables
        if (varName in results) return JSON.stringify(results[varName]);
        return variables[varName] ?? '';
      });
      resolvedParams[paramKey] = value;
    }

    try {
      let depResult: unknown;

      if (depSkill.skill_type === 'data' && depSkill.proxy_url) {
        // Data skill: fetch from proxy URL with params
        const url = new URL(depSkill.proxy_url);
        for (const [k, v] of Object.entries(resolvedParams)) url.searchParams.set(k, v);
        const res = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Data source returned ${res.status}`);
        depResult = await res.json().catch(async () => ({ raw: await res.text() }));
      } else if (depSkill.skill_type === 'api_proxy' && depSkill.proxy_url) {
        // API proxy skill: POST to proxy URL
        const res = await fetch(depSkill.proxy_url, {
          method: depSkill.proxy_method ?? 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: depSkill.proxy_method !== 'GET' ? JSON.stringify(resolvedParams) : undefined,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
        depResult = await res.json().catch(async () => ({ raw: await res.text() }));
      } else {
        // prompt_template skills aren't supported as composite deps (require LLM pipeline)
        throw new Error(`Unsupported dependency type: ${depSkill.skill_type}`);
      }

      results[dep.outputKey] = depResult;

      // Bill for this dependency — 85/15 split to dependency author
      if (!context.callerKeyInfo.isEnvKey) {
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
                metadata: { compositeParent: skill.id, parentRequestId: context.parentRequestId },
              });
            }
          }
        })();
        trackDelegatedSpend(context.callerKeyInfo, depCredits);
      }

      incrementSkillUses(dep.skillId);
      recordSkillMetric({ skillId: dep.skillId, version: depSkill.version ?? '1.0.0', latencyMs: Date.now() - depStart, success: true, costCredits: depCredits });
      costBreakdown.push({ skillId: dep.skillId, creditsCharged: depCredits });
      totalCharged += depCredits;

    } catch (err) {
      logger.error({ err, skillId: dep.skillId, compositeId: skill.id, requestId: context.parentRequestId }, 'Composite dependency failed');
      recordSkillMetric({ skillId: dep.skillId, version: depSkill.version ?? '1.0.0', latencyMs: Date.now() - depStart, success: false, costCredits: 0 });

      return {
        ok: false,
        results,
        costBreakdown,
        totalCreditsCharged: totalCharged,
        durationMs: Date.now() - start,
        error: `Dependency ${dep.skillId} failed: ${(err as Error).message}`,
      };
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

  return {
    ok: true,
    results,
    costBreakdown,
    totalCreditsCharged: round6(totalCharged),
    durationMs: Date.now() - start,
  };
}
