#!/usr/bin/env node
/**
 * model-registry.mjs — Comprehensive model capability registry with outcome tracking.
 * Knows every model's strengths, weaknesses, quirks, modes, and dispatch config.
 * Tracks outcomes to learn which models work best for which tasks.
 *
 * Exports: getModelInfo, getAllModels, recordOutcome, getSuccessRate, getBestModelFor,
 *          refreshRegistry, getDispatchConfig, getCapabilities, MODEL_CAPABILITIES
 * CLI:     node hooks/model-registry.mjs [--best-for <intent>] [--success-rates] [--refresh] [--caps <model>]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTCOMES_DIR  = path.join(__dirname, '..', '.dualbrain');
const OUTCOMES_FILE = path.join(OUTCOMES_DIR, 'model-outcomes.jsonl');

// ─── Model Capabilities & Modes ──────────────────────────────────────────────

export const MODEL_CAPABILITIES = {
  // ── Claude Models ──────────────────────────────────────────────────────────

  haiku: {
    provider: 'claude',
    fullName: 'Claude Haiku 4.5',
    tier: 'search',
    cost: 'minimal',
    contextWindow: 200_000,
    maxOutput: 64_000,

    strengths: ['search', 'format', 'lookup', 'classification', 'simple-qa', 'grep-analysis'],
    weaknesses: ['complex-edits', 'architecture', 'security', 'multi-file-refactor', 'ambiguous-requirements'],
    bestFor: ['file-search', 'grep', 'formatting', 'lint-fixes', 'simple-classification', 'read-only-exploration'],
    avoidFor: ['multi-file-edits', 'architecture', 'security-review', 'complex-debug', 'code-generation'],

    reasoning: {
      extendedThinking: false,
      adaptiveThinking: false,
      effortLevels: null,
      defaultEffort: null,
    },
    modes: {
      fastMode: false,
      extendedContext: false,
      webSearch: false,
      worktreeIsolation: true,
    },
    dispatch: {
      method: 'claude-agent',
      flag: "model: 'haiku'",
      example: "Agent({ model: 'haiku', prompt: '...' })",
    },
    latency: 'fastest',
    quirks: [
      'No extended thinking — pure fast inference',
      'Will confidently hallucinate on complex multi-file edits',
      'Excellent at pattern matching and classification tasks',
      'Cost is ~10x less than Sonnet per token',
      '200K context only — no 1M extended context available',
    ],
  },

  sonnet: {
    provider: 'claude',
    fullName: 'Claude Sonnet 4.6',
    tier: 'execute',
    cost: 'moderate',
    contextWindow: 200_000,
    extendedContextWindow: 1_000_000,
    maxOutput: 64_000,

    strengths: ['edit', 'refactor', 'test', 'debug', 'code-generation', 'tool-use', 'multi-file-edits'],
    weaknesses: ['deep-architecture', 'ambiguous-requirements', 'frontier-reasoning', 'novel-algorithm-design'],
    bestFor: ['file-edits', 'test-writing', 'bug-fixes', 'refactoring', 'code-generation', 'moderate-debug'],
    avoidFor: ['architecture-decisions', 'security-audit', 'complex-system-design', 'ambiguous-specs'],

    reasoning: {
      extendedThinking: true,
      adaptiveThinking: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'high',
      disableAdaptiveEnv: 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1',
      fixedBudgetEnv: 'MAX_THINKING_TOKENS',
    },
    modes: {
      fastMode: false,
      extendedContext: true,
      extendedContextSuffix: '[1m]',
      webSearch: false,
      worktreeIsolation: true,
    },
    dispatch: {
      method: 'claude-agent',
      flag: "model: 'sonnet'",
      example: "Agent({ model: 'sonnet', prompt: '...' })",
    },
    latency: 'medium',
    quirks: [
      'Extended thinking available but costs extra thinking tokens',
      '1M context requires "extra usage" on all plans',
      'Sweet spot for execution: good enough reasoning at moderate cost',
      'Adaptive thinking adjusts depth per-turn automatically',
      'Default effort "high" gives good quality without excessive token burn',
      'Can be spawned as subagent with Agent(model: "sonnet")',
    ],
  },

  opus: {
    provider: 'claude',
    fullName: 'Claude Opus 4.6 / 4.7',
    tier: 'think',
    cost: 'expensive',
    contextWindow: 200_000,
    extendedContextWindow: 1_000_000,
    maxOutput: 128_000,

    strengths: ['architecture', 'security', 'complex-debug', 'review', 'planning',
                'ambiguous-requirements', 'novel-algorithm-design', 'multi-system-reasoning',
                'threat-modeling', 'code-review', 'design-decisions'],
    weaknesses: ['cost', 'overkill-for-simple-tasks', 'latency-for-trivial-work'],
    bestFor: ['architecture-decisions', 'security-review', 'complex-debug', 'code-review',
              'planning', 'dual-brain-think', 'ambiguous-specs', 'system-design'],
    avoidFor: ['simple-edits', 'formatting', 'grep', 'file-search', 'lint-fixes'],

    reasoning: {
      extendedThinking: true,
      adaptiveThinking: true,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultEffort: 'xhigh',
      disableAdaptiveEnv: 'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1',
      fixedBudgetEnv: 'MAX_THINKING_TOKENS',
      ultrathinkKeyword: true,
    },
    modes: {
      fastMode: true,
      fastModeSpeedup: '2.5x',
      fastModeCostMultiplier: '~2x per token',
      extendedContext: true,
      extendedContextSuffix: '[1m]',
      webSearch: false,
      worktreeIsolation: true,
      agentTeams: true,
      agentTeamsEnv: 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
    },
    dispatch: {
      method: 'main-session',
      flag: "model: 'opus'",
      example: "Agent({ model: 'opus', prompt: '...' }) or main session",
      note: 'Prefer main session for think-tier; spawn as agent only for parallel think tasks',
    },
    latency: 'slow',
    quirks: [
      'Opus 4.7 always uses adaptive reasoning (cannot disable)',
      'Opus 4.6 can disable adaptive thinking for fixed budget control',
      'Fast mode (/fast): 2.5x speed but ~2x cost per token — use for iteration',
      '"ultrathink" keyword in prompt triggers deeper reasoning for one turn',
      '1M context auto-upgrades on Max/Team/Enterprise plans',
      'xhigh effort recommended for Opus 4.7 — default minimum for think-tier',
      '"max" effort removes token cap entirely — use for session-critical decisions only',
      'Thinking tokens are billable even when collapsed/hidden',
      'opusplan alias: Opus in plan mode, auto-switches to Sonnet for execution',
    ],
  },

  // ── OpenAI Models (via Codex CLI) ──────────────────────────────────────────

  'gpt-4.1-mini': {
    provider: 'openai',
    fullName: 'GPT-4.1 Mini',
    tier: 'search',
    cost: 'minimal',
    contextWindow: 1_047_576,
    maxOutput: 32_768,

    strengths: ['search', 'format', 'simple-edits', 'classification', 'fast-lookups'],
    weaknesses: ['complex-refactors', 'architecture', 'multi-file-edits', 'reasoning'],
    bestFor: ['grep-analysis', 'simple-formatting', 'classification', 'file-search', 'quick-lookups'],
    avoidFor: ['refactoring', 'architecture', 'security', 'complex-debug', 'code-generation'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-4.1-mini -s read-only "..."',
    },
    latency: 'fastest',
    quirks: [
      'Cheapest OpenAI model — great for high-volume search tasks',
      'Large 1M context window but weak reasoning',
      'Max output only 32K (vs 128K for newer models)',
      'Legacy model — may be deprecated; prefer gpt-5.3-codex-spark for speed',
    ],
  },

  'gpt-4.1': {
    provider: 'openai',
    fullName: 'GPT-4.1',
    tier: 'execute',
    cost: 'low',
    contextWindow: 1_047_576,
    maxOutput: 32_768,

    strengths: ['edits', 'test-fixes', 'straightforward-tasks', 'instruction-following'],
    weaknesses: ['complex-architecture', 'ambiguous-debug', 'frontier-reasoning'],
    bestFor: ['simple-edits', 'test-fixes', 'boilerplate', 'straightforward-refactors'],
    avoidFor: ['architecture', 'security-audit', 'complex-debug', 'novel-design'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-4.1 -s danger-full-access "..."',
    },
    latency: 'fast',
    quirks: [
      'Legacy model — solid but outclassed by gpt-5.x series',
      'Good instruction following for well-specified tasks',
      'Max output 32K limits usefulness for large code generation',
      'Best used when budget is tight and task is simple',
    ],
  },

  'gpt-5.2': {
    provider: 'openai',
    fullName: 'GPT-5.2',
    tier: 'execute',
    cost: 'low',
    contextWindow: 400_000,
    maxOutput: 128_000,

    strengths: ['edits', 'test-fixes', 'simple-refactors', 'explanations', 'budget-execution'],
    weaknesses: ['complex-architecture', 'frontier-reasoning', 'novel-design'],
    bestFor: ['budget-edits', 'test-fixes', 'explanations', 'simple-refactors', 'documentation'],
    avoidFor: ['architecture', 'security', 'complex-multi-file-refactor'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-5.2 -s danger-full-access "..."',
    },
    latency: 'fast',
    quirks: [
      'Good value: 128K output at low cost',
      '400K context — smaller than gpt-4.1 but sufficient for most tasks',
      'Previous generation — solid reasoning but not frontier',
      'Best budget option for execution tasks that need 128K output',
    ],
  },

  'gpt-5.3-codex': {
    provider: 'openai',
    fullName: 'GPT-5.3 Codex',
    tier: 'execute',
    cost: 'moderate',
    contextWindow: 400_000,
    maxOutput: 128_000,

    strengths: ['code-generation', 'edit', 'refactor', 'test', 'debug', 'bulk-edits',
                'agentic-coding', 'tool-use', 'multi-step-execution'],
    weaknesses: ['deep-architecture', 'non-code-reasoning'],
    bestFor: ['code-generation', 'bulk-file-edits', 'test-writing', 'refactoring',
              'agentic-coding-tasks', 'multi-step-execution'],
    avoidFor: ['architecture-decisions', 'security-audit', 'non-code-tasks'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-5.3-codex -s danger-full-access "..."',
    },
    latency: 'medium',
    quirks: [
      'Purpose-built for agentic coding — optimized for Codex CLI',
      'Excellent at multi-step tool use chains',
      '400K context (not 1M) — plan file batches accordingly',
      'API pricing: ~$1.75/$14 per 1M tokens (input/output)',
      'Sweet spot for execution-tier Codex dispatch',
    ],
  },

  'gpt-5.3-codex-spark': {
    provider: 'openai',
    fullName: 'GPT-5.3 Codex Spark',
    tier: 'execute',
    cost: 'moderate',
    contextWindow: 128_000,
    maxOutput: 128_000,

    strengths: ['code-generation', 'fast-edits', 'refactor', 'test', 'debug', 'speed'],
    weaknesses: ['deep-architecture', 'ambiguous-requirements', 'vision', 'small-context'],
    bestFor: ['fast-iteration', 'quick-edits', 'test-fixes', 'speed-critical-execution'],
    avoidFor: ['large-codebase-refactors', 'architecture', 'image-analysis', 'long-context-tasks'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'high',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: false,
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-5.3-codex-spark -s danger-full-access "..."',
    },
    latency: 'fastest',
    quirks: [
      '1000+ tokens/sec — fastest code model available',
      'TEXT ONLY — no vision/image support',
      'Only 128K context — smallest window of any current model',
      'Default effort "high" because speed compensates for token cost',
      'Research preview — may change behavior between versions',
      'Best for rapid iteration loops where latency matters more than depth',
    ],
  },

  'gpt-5.4-mini': {
    provider: 'openai',
    fullName: 'GPT-5.4 Mini',
    tier: 'execute',
    cost: 'moderate',
    contextWindow: 400_000,
    maxOutput: 128_000,

    strengths: ['edits', 'refactors', 'moderate-debug', 'balanced-cost-quality'],
    weaknesses: ['frontier-reasoning', 'complex-architecture'],
    bestFor: ['moderate-edits', 'balanced-budget-tasks', 'refactoring', 'test-writing'],
    avoidFor: ['architecture', 'security', 'frontier-reasoning-tasks'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-5.4-mini -s danger-full-access "..."',
    },
    latency: 'medium',
    quirks: [
      'Balanced cost/quality — smaller version of gpt-5.4',
      '400K context is sufficient for most single-module work',
      'Good fallback when gpt-5.4 is too expensive but task needs reasoning',
    ],
  },

  'gpt-5.4': {
    provider: 'openai',
    fullName: 'GPT-5.4',
    tier: 'execute',
    cost: 'moderate',
    contextWindow: 1_050_000,
    maxOutput: 128_000,

    strengths: ['edit', 'refactor', 'test', 'debug', 'code-generation', 'bulk-edits',
                'tool-use', 'computer-use', 'agentic-coding', 'multi-file-refactor'],
    weaknesses: ['deep-architecture', 'cost-for-simple-tasks'],
    bestFor: ['bulk-file-edits', 'complex-refactoring', 'test-suites', 'debug',
              'agentic-execution', 'multi-step-tool-chains'],
    avoidFor: ['simple-formatting', 'grep', 'architecture-decisions-alone'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      computerUse: true,
      toolSearch: true,
      sandbox: { search: 'read-only', execute: 'danger-full-access' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-5.4 -s danger-full-access -c reasoning.effort="high" "..."',
    },
    latency: 'medium',
    quirks: [
      'Incorporates gpt-5.3-codex capabilities — can replace it for most tasks',
      '1M+ context window — largest among OpenAI models',
      'Default context in Codex may be 272K; full 1M via API config',
      'Supports computer use and tool search modes',
      'Workhorse model: best general-purpose execute-tier choice',
      'API pricing: ~$2.50/premium per 1M tokens',
      'Priority service tier available for ~2x cost, ~40% faster',
    ],
  },

  'gpt-5.5': {
    provider: 'openai',
    fullName: 'GPT-5.5',
    tier: 'think',
    cost: 'expensive',
    contextWindow: 1_000_000,
    maxOutput: 128_000,

    strengths: ['architecture', 'security', 'complex-debug', 'review', 'planning',
                'frontier-reasoning', 'multi-system-reasoning', 'threat-modeling',
                'novel-algorithm-design', 'agentic-research'],
    weaknesses: ['cost', 'latency', 'overkill-for-simple-tasks'],
    bestFor: ['architecture-decisions', 'security-audit', 'complex-debug',
              'code-review', 'planning', 'dual-brain-think', 'frontier-reasoning'],
    avoidFor: ['simple-edits', 'formatting', 'grep', 'file-search', 'bulk-boilerplate'],

    reasoning: {
      effortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'medium',
      codexFlag: '-c reasoning.effort="<level>"',
    },
    modes: {
      webSearch: true,
      webSearchFlag: '--search',
      sandbox: { search: 'read-only', execute: 'danger-full-access', think: 'read-only' },
    },
    dispatch: {
      method: 'codex-exec',
      example: 'codex exec -m gpt-5.5 -s read-only -c reasoning.effort="high" "..."',
    },
    latency: 'slow',
    quirks: [
      'Strongest OpenAI model — reserve for think-tier and dual-brain',
      'API pricing: $5/$30 per 1M tokens — most expensive OpenAI model',
      'Codex context may be capped at 400K vs 1M via API',
      'Excellent for independent analysis in dual-brain think/review flows',
      'medium effort is usually sufficient — high/xhigh for truly complex reasoning',
      'Priority tier available: ~40% faster at ~2x cost',
    ],
  },
};

// ─── Derived Constants ───────────────────────────────────────────────────────

const MODELS = {};
for (const [name, cap] of Object.entries(MODEL_CAPABILITIES)) {
  MODELS[name] = {
    provider: cap.provider,
    tier: cap.tier,
    cost: cap.cost,
    strengths: cap.strengths,
    weaknesses: cap.weaknesses,
    contextWindow: cap.contextWindow,
    maxOutput: cap.maxOutput,
    ...(cap.reasoning?.effortLevels ? {
      efforts: cap.reasoning.effortLevels,
      defaultEffort: cap.reasoning.defaultEffort,
    } : {}),
  };
}

const COST_RANK = { minimal: 0, low: 1, moderate: 2, expensive: 3 };
const LATENCY_RANK = { fastest: 0, fast: 1, medium: 2, slow: 3 };

// ─── Capability Queries ──────────────────────────────────────────────────────

export function getCapabilities(modelName) {
  return MODEL_CAPABILITIES[modelName] ?? null;
}

export function getDispatchConfig(modelName) {
  const cap = MODEL_CAPABILITIES[modelName];
  if (!cap) return null;
  return {
    method: cap.dispatch.method,
    model: modelName,
    effort: cap.reasoning?.defaultEffort ?? null,
    effortLevels: cap.reasoning?.effortLevels ?? null,
    extendedThinking: cap.reasoning?.extendedThinking ?? false,
    fastMode: cap.modes?.fastMode ?? false,
    extendedContext: cap.modes?.extendedContext ?? false,
    webSearch: cap.modes?.webSearch ?? false,
    sandbox: cap.modes?.sandbox ?? null,
    example: cap.dispatch.example,
  };
}

export function recommendEffort(modelName, taskComplexity, risk) {
  const cap = MODEL_CAPABILITIES[modelName];
  if (!cap?.reasoning?.effortLevels) return null;

  const levels = cap.reasoning.effortLevels;
  const base = cap.reasoning.defaultEffort;

  if (risk === 'critical') {
    return levels.includes('xhigh') ? 'xhigh' : levels[levels.length - 1];
  }
  if (taskComplexity === 'complex' || risk === 'high') {
    const idx = levels.indexOf(base);
    return levels[Math.min(idx + 1, levels.length - 1)];
  }
  if (taskComplexity === 'trivial') {
    const idx = levels.indexOf(base);
    return levels[Math.max(idx - 1, 0)];
  }
  return base;
}

export function shouldUseExtendedContext(modelName, estimatedTokens) {
  const cap = MODEL_CAPABILITIES[modelName];
  if (!cap?.modes?.extendedContext) return false;
  return estimatedTokens > cap.contextWindow * 0.7;
}

export function shouldUseFastMode(modelName, isIterating) {
  const cap = MODEL_CAPABILITIES[modelName];
  if (!cap?.modes?.fastMode) return false;
  return isIterating;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir() {
  fs.mkdirSync(OUTCOMES_DIR, { recursive: true });
}

function readOutcomes() {
  if (!fs.existsSync(OUTCOMES_FILE)) return [];
  const lines = fs.readFileSync(OUTCOMES_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const results = [];
  for (const line of lines) {
    try { results.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return results;
}

function atomicAppend(entry) {
  ensureDir();
  const line = JSON.stringify(entry) + '\n';
  const tmp  = OUTCOMES_FILE + '.tmp.' + process.pid;
  let existing = '';
  if (fs.existsSync(OUTCOMES_FILE)) {
    existing = fs.readFileSync(OUTCOMES_FILE, 'utf8');
  }
  fs.writeFileSync(tmp, existing + line, 'utf8');
  fs.renameSync(tmp, OUTCOMES_FILE);
}

// ─── Core Exports ────────────────────────────────────────────────────────────

export function getModelInfo(modelName) {
  return MODELS[modelName] ?? null;
}

export function getAllModels(filter = {}) {
  return Object.entries(MODELS)
    .map(([name, info]) => ({ name, ...info }))
    .filter(m => {
      if (filter.provider && m.provider !== filter.provider) return false;
      if (filter.tier     && m.tier     !== filter.tier)     return false;
      if (filter.maxCost  !== undefined && COST_RANK[m.cost] > COST_RANK[filter.maxCost]) return false;
      return true;
    });
}

export function recordOutcome(entry) {
  const record = {
    timestamp:    new Date().toISOString(),
    model:        null,
    intent:       null,
    risk:         null,
    complexity:   null,
    effort:       null,
    success:      null,
    testsPassed:  null,
    durationMs:   null,
    filesChanged: null,
    escalated:    false,
    userCorrected: false,
    ...entry,
  };
  atomicAppend(record);
}

export function getSuccessRate(model, intent = null, options = {}) {
  const { since = null, minSamples = 3 } = options;
  const sinceMs = since ? new Date(since).getTime() : 0;

  const outcomes = readOutcomes().filter(o => {
    if (o.model !== model) return false;
    if (intent  && o.intent !== intent) return false;
    if (since   && new Date(o.timestamp).getTime() < sinceMs) return false;
    return true;
  });

  if (outcomes.length < minSamples) return null;

  const successes = outcomes.filter(o => o.success === true).length;
  const failures  = outcomes.filter(o => o.success === false).length;
  return {
    rate:      successes / outcomes.length,
    total:     outcomes.length,
    successes,
    failures,
  };
}

export function getBestModelFor(intent, provider = null, options = {}) {
  const { minSamples = 3, maxCost = null, maxLatency = null } = options;

  const candidates = getAllModels({
    ...(provider ? { provider } : {}),
    ...(maxCost  ? { maxCost  } : {}),
  }).filter(m => {
    if (maxLatency) {
      const cap = MODEL_CAPABILITIES[m.name];
      if (cap && LATENCY_RANK[cap.latency] > LATENCY_RANK[maxLatency]) return false;
    }
    return true;
  });

  if (candidates.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const m of candidates) {
    const cap = MODEL_CAPABILITIES[m.name];
    const hasStrength = m.strengths.includes(intent) ? 1 : 0;
    const hasBestFor = cap?.bestFor?.includes(intent) ? 0.2 : 0;
    const hasAvoid = cap?.avoidFor?.includes(intent) ? -0.5 : 0;
    const rateData = getSuccessRate(m.name, intent, { minSamples });

    let score;
    let reason;

    if (rateData) {
      score  = (hasStrength + hasBestFor + hasAvoid) * 0.4 + rateData.rate * 0.6;
      reason = `empirical rate ${(rateData.rate * 100).toFixed(0)}% over ${rateData.total} samples`;
    } else {
      const costPenalty = COST_RANK[m.cost] * 0.05;
      score  = hasStrength + hasBestFor + hasAvoid - costPenalty;
      reason = hasStrength ? `static strength match for "${intent}"` : 'no direct strength match, lowest-cost option';
    }

    if (score > bestScore) {
      bestScore = score;
      best = {
        model:       m.name,
        provider:    m.provider,
        successRate: rateData ? rateData.rate : null,
        sampleSize:  rateData ? rateData.total : 0,
        reason,
        dispatch:    cap?.dispatch ?? null,
      };
    }
  }

  return best;
}

export function refreshRegistry() {
  const discovered = [];
  const removed    = [];
  const unchanged  = [];

  const claudeModels = ['haiku', 'sonnet', 'opus'];
  for (const m of claudeModels) {
    if (MODELS[m]) unchanged.push(m);
    else { MODELS[m] = { provider: 'claude', uncalibrated: true }; discovered.push(m); }
  }

  try {
    const raw = execSync('codex debug models 2>/dev/null', { timeout: 8000 }).toString();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.models)
        ? parsed.models
        : [];

    for (const entry of list) {
      const name = typeof entry === 'string' ? entry : entry?.id ?? entry?.name;
      if (!name) continue;
      if (MODELS[name]) {
        unchanged.push(name);
      } else {
        MODELS[name] = {
          provider: 'openai',
          tier: 'execute',
          cost: 'moderate',
          strengths: [],
          weaknesses: [],
          uncalibrated: true,
        };
        discovered.push(name);
      }
    }
  } catch {
    // codex not available
  }

  return { discovered, removed, unchanged };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function fmtRate(r) {
  if (r === null) return 'no data';
  return `${(r.rate * 100).toFixed(0)}% (${r.total} samples)`;
}

function printTable(rows, cols) {
  const widths = cols.map(c => Math.max(c.label.length, ...rows.map(r => String(r[c.key] ?? '').length)));
  const header = cols.map((c, i) => c.label.padEnd(widths[i])).join('  ');
  const divider = widths.map(w => '-'.repeat(w)).join('  ');
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c.key] ?? '').padEnd(widths[i])).join('  '));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.includes('--caps')) {
    const modelName = args[args.indexOf('--caps') + 1];
    if (!modelName) {
      console.error('Usage: --caps <model>');
      process.exit(1);
    }
    const cap = getCapabilities(modelName);
    if (!cap) {
      console.error(`Unknown model: ${modelName}`);
      process.exit(1);
    }
    console.log(JSON.stringify(cap, null, 2));

  } else if (args.includes('--dispatch')) {
    const modelName = args[args.indexOf('--dispatch') + 1];
    if (!modelName) {
      console.error('Usage: --dispatch <model>');
      process.exit(1);
    }
    const dc = getDispatchConfig(modelName);
    if (!dc) {
      console.error(`Unknown model: ${modelName}`);
      process.exit(1);
    }
    console.log(JSON.stringify(dc, null, 2));

  } else if (args.includes('--refresh')) {
    const result = refreshRegistry();
    console.log('Registry refresh:');
    console.log(`  Discovered: ${result.discovered.join(', ') || 'none'}`);
    console.log(`  Unchanged:  ${result.unchanged.join(', ') || 'none'}`);
    console.log(`  Removed:    ${result.removed.join(', ') || 'none'}`);

  } else if (args.includes('--success-rates')) {
    const outcomes = readOutcomes();
    const modelNames = [...new Set(outcomes.map(o => o.model))];
    if (modelNames.length === 0) {
      console.log('No outcome data recorded yet.');
    } else {
      const rows = modelNames.map(m => {
        const r = getSuccessRate(m, null, { minSamples: 1 });
        return { model: m, rate: r ? fmtRate(r) : 'no data', total: r?.total ?? 0 };
      }).sort((a, b) => b.total - a.total);
      printTable(rows, [
        { key: 'model', label: 'Model' },
        { key: 'rate',  label: 'Success Rate' },
        { key: 'total', label: 'Samples' },
      ]);
    }

  } else if (args.includes('--best-for')) {
    const intent   = args[args.indexOf('--best-for') + 1];
    const pIdx     = args.indexOf('--provider');
    const provider = pIdx !== -1 ? args[pIdx + 1] : null;
    const cIdx     = args.indexOf('--max-cost');
    const maxCost  = cIdx !== -1 ? args[cIdx + 1] : null;

    if (!intent) {
      console.error('Usage: --best-for <intent> [--provider claude|openai] [--max-cost minimal|low|moderate|expensive]');
      process.exit(1);
    }

    const result = getBestModelFor(intent, provider, { ...(maxCost ? { maxCost } : {}) });
    if (!result) {
      console.log(`No matching model found for intent "${intent}"`);
    } else {
      console.log(`Best model for "${intent}"${provider ? ` (${provider})` : ''}:`);
      console.log(`  Model:       ${result.model}`);
      console.log(`  Provider:    ${result.provider}`);
      console.log(`  Success rate: ${result.successRate !== null ? (result.successRate * 100).toFixed(0) + '%' : 'n/a'}`);
      console.log(`  Samples:     ${result.sampleSize}`);
      console.log(`  Reason:      ${result.reason}`);
      console.log(`  Dispatch:    ${result.dispatch?.example || 'n/a'}`);
    }

  } else {
    const rows = Object.entries(MODEL_CAPABILITIES).map(([name, cap]) => ({
      name,
      provider:  cap.provider,
      tier:      cap.tier,
      cost:      cap.cost,
      context:   cap.contextWindow >= 1_000_000 ? `${(cap.contextWindow / 1_000_000).toFixed(1)}M` : `${(cap.contextWindow / 1000).toFixed(0)}K`,
      output:    `${(cap.maxOutput / 1000).toFixed(0)}K`,
      effort:    cap.reasoning?.defaultEffort ?? '-',
      latency:   cap.latency,
      strengths: cap.strengths.slice(0, 4).join(', '),
    }));
    printTable(rows, [
      { key: 'name',      label: 'Model' },
      { key: 'provider',  label: 'Provider' },
      { key: 'tier',      label: 'Tier' },
      { key: 'cost',      label: 'Cost' },
      { key: 'context',   label: 'Context' },
      { key: 'output',    label: 'Output' },
      { key: 'effort',    label: 'Effort' },
      { key: 'latency',   label: 'Latency' },
      { key: 'strengths', label: 'Top Strengths' },
    ]);
  }
}
