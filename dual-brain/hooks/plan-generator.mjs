#!/usr/bin/env node
/**
 * plan-generator.mjs — Generates Steve-style markdown execution plans.
 *
 * For complex requests, produces a 3-part plan:
 *   Part 1: Numbered tasks ordered by dependency
 *   Part 2: User stories and edge cases
 *   Part 3: Questions with suggested answers
 *
 * Export: generatePlan(vibeResult, context?) → { markdown, planPath }
 * CLI: node plan-generator.mjs --utterance "..." [--write]
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getActiveProfile } from './profiles.mjs';
import { classifyRisk } from './risk-classifier.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLANS_DIR = join(__dirname, '..', 'plans');

// ─── Tier ordering for dependency sort ─────────────────────────────────────

const TIER_ORDER = { search: 0, execute: 1, think: 2, review: 3 };

// ─── Dependency resolution ─────────────────────────────────────────────────

/**
 * Sort tasks by dependency and tier order:
 *   - Search tasks before execute tasks on the same topic
 *   - Think/review tasks after execute tasks
 *   - Independent tasks remain in original order
 */
function resolveDependencies(tasks) {
  if (!tasks || tasks.length === 0) return [];

  const indexed = tasks.map((t, i) => ({
    ...t,
    _origIndex: i,
    tier: (t.tier || 'execute').toLowerCase(),
    topic: t.topic || t.title || '',
    dependencies: t.dependencies || [],
  }));

  // Group tasks by topic to infer intra-topic dependencies
  const byTopic = new Map();
  for (const t of indexed) {
    const key = t.topic.toLowerCase().replace(/\s+/g, '-') || `task-${t._origIndex}`;
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(t);
  }

  // Within each topic group, sort by tier order
  for (const [, group] of byTopic) {
    group.sort((a, b) => (TIER_ORDER[a.tier] ?? 1) - (TIER_ORDER[b.tier] ?? 1));
  }

  // Flatten back, preserving intra-topic order and original order for cross-topic
  const sorted = [];
  const placed = new Set();

  // Place topic groups in the order their first task appeared
  const topicOrder = [];
  for (const t of indexed) {
    const key = t.topic.toLowerCase().replace(/\s+/g, '-') || `task-${t._origIndex}`;
    if (!topicOrder.includes(key)) topicOrder.push(key);
  }

  for (const key of topicOrder) {
    const group = byTopic.get(key) || [];
    for (const t of group) {
      if (!placed.has(t._origIndex)) {
        placed.add(t._origIndex);
        sorted.push(t);
      }
    }
  }

  // Assign sequential IDs and compute dependency labels
  const numbered = sorted.map((t, i) => {
    const num = i + 1;
    const deps = [];

    // Explicit dependencies
    if (t.dependencies.length > 0) {
      for (const dep of t.dependencies) {
        if (typeof dep === 'number') {
          deps.push(`Task ${dep}`);
        } else {
          // Find by title match
          const match = sorted.findIndex(s => s.title === dep || s.topic === dep);
          if (match >= 0 && match < i) deps.push(`Task ${match + 1}`);
        }
      }
    }

    // Implicit: within same topic, each task depends on the previous
    const topicKey = t.topic.toLowerCase().replace(/\s+/g, '-') || `task-${t._origIndex}`;
    const topicGroup = byTopic.get(topicKey) || [];
    const posInGroup = topicGroup.indexOf(t);
    if (posInGroup > 0 && deps.length === 0) {
      const prevInGroup = topicGroup[posInGroup - 1];
      const prevNum = sorted.indexOf(prevInGroup) + 1;
      if (prevNum > 0 && prevNum < num) deps.push(`Task ${prevNum}`);
    }

    return {
      num,
      title: t.title || `Task ${num}`,
      tier: t.tier,
      risk: t.risk || classifyRisk(t.files || []).level,
      dependencies: deps.length > 0 ? deps.join(', ') : '—',
      files: t.files || [],
      description: t.description || '',
      canParallel: deps.length === 0 && posInGroup === 0,
    };
  });

  return numbered;
}

// ─── User stories derivation ───────────────────────────────────────────────

function deriveUserStories(tasks) {
  const stories = [];
  for (const t of tasks) {
    const verb = t.tier === 'search' ? 'find' :
                 t.tier === 'execute' ? 'use' :
                 t.tier === 'think' ? 'understand' : 'verify';
    const subject = t.title.toLowerCase()
      .replace(/^(add|create|update|fix|implement|refactor|write|build)\s+/i, '');
    stories.push(`As a user, I should be able to ${verb} ${subject}`);
  }
  return stories;
}

// ─── Edge cases derivation ─────────────────────────────────────────────────

function deriveEdgeCases(tasks) {
  const cases = [];
  const riskTasks = tasks.filter(t => t.risk === 'high' || t.risk === 'critical');

  for (const t of riskTasks) {
    cases.push(`${t.title} touches ${t.risk}-risk files — verify no regressions`);
  }

  const parallelTasks = tasks.filter(t => t.canParallel);
  if (parallelTasks.length > 1) {
    cases.push('Multiple tasks can run in parallel — ensure no file conflicts between agents');
  }

  const executeTasks = tasks.filter(t => t.tier === 'execute');
  if (executeTasks.length > 1) {
    cases.push('Multiple execute agents editing code — watch for merge conflicts');
  }

  if (cases.length === 0) {
    cases.push('No high-risk edge cases identified — standard testing applies');
  }

  return cases;
}

// ─── Questions derivation ──────────────────────────────────────────────────

function deriveQuestions(tasks, context) {
  const questions = [];

  // Check for ambiguous tiers
  const searchAndExecute = new Set();
  for (const t of tasks) {
    const topicKey = t.title.toLowerCase();
    if (searchAndExecute.has(topicKey)) continue;
    searchAndExecute.add(topicKey);
  }

  // Check if tests are mentioned
  const hasTestTask = tasks.some(t =>
    /test/i.test(t.title) || t.tier === 'search' && /test/i.test(t.description)
  );
  if (!hasTestTask && tasks.some(t => t.tier === 'execute')) {
    questions.push({
      q: 'Should a dedicated test task be added for the new code?',
      a: 'Yes — add test coverage for all execute-tier changes',
    });
  }

  // Check for critical-risk files
  const criticalTasks = tasks.filter(t => t.risk === 'critical');
  if (criticalTasks.length > 0) {
    questions.push({
      q: `Task "${criticalTasks[0].title}" touches critical files — should dual-brain review be required?`,
      a: 'Yes — dual-brain review recommended for critical-risk changes',
    });
  }

  // Check for missing context
  if (!context?.projectName) {
    questions.push({
      q: 'What is the target project/module for these changes?',
      a: 'Current working directory project',
    });
  }

  if (questions.length === 0) {
    questions.push({
      q: 'Are there any project-specific constraints or conventions to follow?',
      a: 'Follow existing code style and patterns in the codebase',
    });
  }

  return questions;
}

// ─── Wave strategy explanation ─────────────────────────────────────────────

function explainWaveStrategy(wave) {
  if (!wave) return 'Sequential — run tasks one at a time in dependency order';

  const explanations = {
    sequential: 'Run tasks one at a time in dependency order. Safest for interdependent work.',
    parallel: 'Run independent tasks simultaneously across providers. Fastest for isolated work.',
    'wave-2': 'Two waves: first wave handles search/setup, second wave handles execution. Good balance of speed and safety.',
    'wave-3': 'Three waves: search, then execute, then review. Full pipeline for complex changes.',
  };

  return explanations[wave] || `${wave} — follow the dependency chain in the task table`;
}

// ─── Plan generation ───────────────────────────────────────────────────────

/**
 * Generate a markdown execution plan from vibe-router output.
 *
 * @param {Object} vibeResult - Output from routeVibe():
 *   { complexity, tasks, quality_gates, wave_recommendation }
 * @param {Object} [context] - Optional context:
 *   { projectName, recentFiles, summary }
 * @returns {{ markdown: string, planPath: string|null }}
 */
function generatePlan(vibeResult, context = {}) {
  const {
    complexity = 'structured',
    tasks: rawTasks = [],
    quality_gates: qualityGates = [],
    wave_recommendation: waveRec = 'sequential',
  } = vibeResult;

  const profile = getActiveProfile();
  const timestamp = new Date().toISOString();
  const summary = context.summary || deriveSummary(rawTasks);

  // For simple/structured complexity, generate a lighter plan
  if (complexity === 'simple' || (complexity === 'structured' && rawTasks.length <= 2)) {
    return generateLightPlan(rawTasks, { complexity, profile, timestamp, summary });
  }

  // Full 3-part plan for complex requests
  const tasks = resolveDependencies(rawTasks);
  const userStories = deriveUserStories(tasks);
  const edgeCases = deriveEdgeCases(tasks);
  const questions = deriveQuestions(tasks, context);

  const lines = [];

  // Header
  lines.push(`# Execution Plan — ${summary}`);
  lines.push(`Generated: ${timestamp} | Profile: ${profile.name} | Complexity: ${complexity}`);
  lines.push('');

  // Part 1: Tasks
  lines.push('## Part 1: Tasks (ordered by dependency)');
  lines.push('');
  lines.push('| # | Task | Tier | Risk | Dependencies |');
  lines.push('|---|------|------|------|-------------|');
  for (const t of tasks) {
    lines.push(`| ${t.num} | ${t.title} | ${t.tier} | ${t.risk} | ${t.dependencies} |`);
  }
  lines.push('');

  // Agent instructions
  lines.push('### Agent Instructions');
  lines.push('- Each agent: read this plan before starting');
  lines.push('- Write tests for your changes before finishing');
  lines.push('- Run tests and fix until green');
  lines.push('- Do not revert other agents’ work');
  lines.push('- Other agents may be working in this repo simultaneously');
  lines.push('');

  // Part 2: User Stories & Edge Cases
  lines.push('## Part 2: User Stories & Edge Cases');
  lines.push('');
  lines.push('### User Stories');
  for (const s of userStories) {
    lines.push(`- ${s}`);
  }
  lines.push('');
  lines.push('### Edge Cases');
  for (const c of edgeCases) {
    lines.push(`- ${c}`);
  }
  lines.push('');

  // Part 3: Questions
  lines.push('## Part 3: Questions');
  lines.push('');
  lines.push('> These are questions the orchestrator couldn\'t resolve from the codebase.');
  lines.push('> Suggested answers are provided — correct any that are wrong before launching agents.');
  lines.push('');
  for (let i = 0; i < questions.length; i++) {
    lines.push(`${i + 1}. ${questions[i].q} — **Suggested:** ${questions[i].a}`);
  }
  lines.push('');

  // Quality Gates
  lines.push('## Quality Gates');
  if (qualityGates.length > 0) {
    for (const g of qualityGates) {
      lines.push(`- ${typeof g === 'string' ? g : g.description || JSON.stringify(g)}`);
    }
  } else {
    lines.push(`- Sensitivity floor: ${profile.quality_gate.sensitivity_floor}`);
    lines.push(`- Dual-brain minimum: ${profile.quality_gate.dual_brain_minimum}`);
    lines.push('- Run tests before marking complete');
  }
  lines.push('');

  // Wave Strategy
  lines.push('## Wave Strategy');
  lines.push(`${waveRec} — ${explainWaveStrategy(waveRec)}`);
  lines.push('');

  const markdown = lines.join('\n');
  return { markdown, planPath: null };
}

// ─── Light plan for simple/structured requests ─────────────────────────────

function generateLightPlan(rawTasks, { complexity, profile, timestamp, summary }) {
  const tasks = resolveDependencies(rawTasks);
  const lines = [];

  lines.push(`# Execution Plan — ${summary}`);
  lines.push(`Generated: ${timestamp} | Profile: ${profile.name} | Complexity: ${complexity}`);
  lines.push('');

  if (tasks.length > 0) {
    lines.push('## Tasks');
    lines.push('');
    for (const t of tasks) {
      const depNote = t.dependencies !== '—' ? ` (after ${t.dependencies})` : '';
      lines.push(`${t.num}. **[${t.tier}]** ${t.title}${depNote}`);
    }
  } else {
    lines.push('## Tasks');
    lines.push('');
    lines.push('1. Execute the request directly');
  }

  lines.push('');
  lines.push('---');
  lines.push('*Light plan — full 3-part plan generated for complex requests.*');
  lines.push('');

  const markdown = lines.join('\n');
  return { markdown, planPath: null };
}

// ─── Summary derivation ────────────────────────────────────────────────────

function deriveSummary(tasks) {
  if (!tasks || tasks.length === 0) return 'Unnamed Plan';
  if (tasks.length === 1) return tasks[0].title || 'Single Task';

  const titles = tasks.map(t => t.title || '').filter(Boolean);
  if (titles.length <= 2) return titles.join(' + ');

  // Find common theme
  const words = titles.flatMap(t => t.toLowerCase().split(/\s+/));
  const freq = new Map();
  for (const w of words) {
    if (w.length > 3) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const common = [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  if (common.length > 0) {
    return `${common.slice(0, 2).join(' ')} (${tasks.length} tasks)`;
  }
  return `${tasks.length}-task plan`;
}

// ─── Write plan to disk ────────────────────────────────────────────────────

function writePlan(markdown) {
  mkdirSync(PLANS_DIR, { recursive: true });

  const ts = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const filename = `${ts}-plan.md`;
  const planPath = join(PLANS_DIR, filename);

  writeFileSync(planPath, markdown);
  return planPath;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function cli() {
  const args = process.argv.slice(2);
  const flagIndex = (f) => args.indexOf(f);
  const flagVal = (f) => {
    const i = flagIndex(f);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const hasFlag = (f) => args.includes(f);

  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
  plan-generator.mjs — Generate Steve-style execution plans

  Usage:
    node plan-generator.mjs --utterance "..."  [--write]
    node plan-generator.mjs --help

  Options:
    --utterance "..."   The request to plan for
    --write             Write plan to .claude/plans/
    --json              Output as JSON instead of markdown
    --help              Show this help

  The plan is generated from vibe-router output. If vibe-router
  is not available, a basic plan is created from the utterance.
`);
    process.exit(0);
  }

  const utterance = flagVal('--utterance');
  const shouldWrite = hasFlag('--write');
  const jsonOutput = hasFlag('--json');

  if (!utterance) {
    console.error('  Error: --utterance is required');
    console.error('  Usage: node plan-generator.mjs --utterance "build a login page"');
    process.exit(1);
  }

  // Try to load vibe-router; fall back to a basic vibeResult
  let vibeResult;
  try {
    const { routeVibe } = await import('./vibe-router.mjs');
    vibeResult = routeVibe(utterance);
  } catch {
    // vibe-router not available — construct a basic vibeResult from utterance
    vibeResult = fallbackVibeResult(utterance);
  }

  const result = generatePlan(vibeResult, { summary: utterance.slice(0, 60) });

  if (shouldWrite) {
    result.planPath = writePlan(result.markdown);
  }

  if (jsonOutput) {
    console.log(JSON.stringify({
      planPath: result.planPath,
      markdown: result.markdown,
    }, null, 2));
  } else {
    console.log(result.markdown);
    if (result.planPath) {
      console.log(`\nPlan written to: ${result.planPath}`);
    }
  }
}

// ─── Fallback when vibe-router is unavailable ──────────────────────────────

function fallbackVibeResult(utterance) {
  const lower = utterance.toLowerCase();

  // Estimate complexity from utterance length and keywords
  const complexWords = ['and', 'then', 'also', 'plus', 'with', 'including', 'across', 'multiple', 'refactor', 'migrate'];
  const matchCount = complexWords.filter(w => lower.includes(w)).length;
  const complexity = matchCount >= 3 ? 'complex' :
                     matchCount >= 1 ? 'structured' : 'simple';

  // Extract rough tasks from utterance
  const tasks = [];
  const segments = utterance.split(/(?:\band\b|\bthen\b|\bplus\b|,|;)/i).map(s => s.trim()).filter(Boolean);

  for (const seg of segments) {
    const isSearch = /\b(find|search|look|check|explore|list|grep)\b/i.test(seg);
    const isThink = /\b(decide|evaluate|compare|review|plan|architect|design)\b/i.test(seg);
    const tier = isSearch ? 'search' : isThink ? 'think' : 'execute';

    tasks.push({
      title: seg.charAt(0).toUpperCase() + seg.slice(1),
      tier,
      topic: seg.split(/\s+/).slice(0, 3).join(' '),
      files: [],
      dependencies: [],
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      title: utterance.slice(0, 80),
      tier: 'execute',
      topic: utterance.slice(0, 20),
      files: [],
      dependencies: [],
    });
  }

  return {
    complexity,
    tasks,
    quality_gates: [],
    wave_recommendation: tasks.length > 2 ? 'wave-2' : 'sequential',
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────

export { generatePlan, writePlan, resolveDependencies };

// ─── Run CLI if invoked directly ───────────────────────────────────────────

const isMain = process.argv[1] &&
  (process.argv[1].endsWith('plan-generator.mjs') ||
   process.argv[1] === fileURLToPath(import.meta.url));

if (isMain) {
  cli().catch(err => {
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  });
}
