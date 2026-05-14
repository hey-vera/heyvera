#!/usr/bin/env node
/**
 * ship-captain.mjs — End-to-end executor for dual-brain v4.5.0.
 *
 * Orchestrates natural language goals into structured, sequentially executed
 * agent tasks with durable run records, quality gate integration, tests, and PR.
 *
 * CLI:  node hooks/ship-captain.mjs "fix the auth bug and write tests"
 *       node hooks/ship-captain.mjs --goal "..." [--yes] [--dry-run] [--plan-only]
 *                                   [--provider claude|gpt|auto] [--yolo] [--careful]
 *                                   [--no-pr] [--mode <profile>] [--force-execute]
 *
 * Exports: planExecution(goal), executeShipCaptain(goal, options), classifyGoalIntent(goal)
 */

import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { routeVibe } from './vibe-router.mjs';
import { getTemplate, buildAgentPrompt } from './agent-templates.mjs';
import { getChain } from './agent-chains.mjs';
import { chooseProvider } from './budget-balancer.mjs';
import { runTests, discoverTests } from './ship-gate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(__dirname, '..', '.claude', 'runs');
const TEMPLATES_SCRIPT = resolve(__dirname, 'agent-templates.mjs');
const CHAINS_SCRIPT = resolve(__dirname, 'agent-chains.mjs');

// ─── Risk/Tier Display Helpers ─────────────────────────────────────────────

const RISK_BADGE = { low: '[low]', medium: '[med]', high: '[HIGH]', critical: '[CRIT]' };
const TIER_BADGE = { search: 'search/haiku', execute: 'execute/sonnet', think: 'think/opus' };
const PROVIDER_BADGE = { claude: 'claude', openai: 'gpt', auto: 'auto' };

// ─── Goal Intent Classification ──────────────────────────────────────────

const INTENT_RULES = [
  {
    intent: 'think',
    patterns: [
      /\bshould we\b/i,
      /\bwhat'?s the best\b/i,
      /\bhow should\b/i,
      /\barchitecture\b/i,
      /\bdesign\b/i,
      /\bdecide\b/i,
      /\bcompare\b/i,
      /\btradeoff\b/i,
      /\bthink about\b/i,
      /\bevaluate\b/i,
      /\bapproach\b/i,
    ],
    subsystem: 'dual-brain-think.mjs --question',
  },
  {
    intent: 'review',
    patterns: [
      /\breview\b/i,
      /\baudit\b/i,
      /\bcheck for bugs\b/i,
      /\bsecurity review\b/i,
      /\bcode review\b/i,
      /\blook at the diff\b/i,
      /\breview this pr\b/i,
      /\breview my changes\b/i,
    ],
    subsystem: 'dual-brain-review.mjs',
  },
  {
    intent: 'explore',
    patterns: [
      /\bhow does\b/i,
      /\bwhere is\b/i,
      /\bfind\b/i,
      /\bexplain\b/i,
      /\bunderstand\b/i,
      /\bwhat is\b/i,
      /\bshow me\b/i,
    ],
    subsystem: 'agent-templates.mjs explorer',
  },
  {
    intent: 'ship',
    patterns: [
      /\bship it\b/i,
      /\bcreate pr\b/i,
      /\bopen pr\b/i,
      /\bpush this\b/i,
      /\bget this ready\b/i,
    ],
    subsystem: 'ship-gate.mjs --ship',
  },
];

const EXECUTE_PATTERNS = [
  /\bfix\b/i, /\bbuild\b/i, /\bwrite\b/i, /\bupdate\b/i, /\brefactor\b/i,
  /\badd\b/i, /\bremove\b/i, /\bchange\b/i, /\bimplement\b/i,
];

/**
 * classifyGoalIntent(goal) — detect the user's intent and route to the right subsystem.
 *
 * @param {string} goal
 * @returns {{ intent: 'think'|'review'|'explore'|'execute'|'ship', confidence: 'high'|'medium'|'low', reason: string }}
 */
function classifyGoalIntent(goal) {
  const matched = [];

  for (const rule of INTENT_RULES) {
    const hits = rule.patterns.filter(p => p.test(goal));
    if (hits.length > 0) {
      matched.push({ rule, hits });
    }
  }

  // Multiple intent signals → lower confidence
  if (matched.length > 1) {
    // Pick the first match but flag lower confidence
    const primary = matched[0];
    return {
      intent: primary.rule.intent,
      confidence: 'medium',
      reason: `Matched "${primary.hits[0].source}" (${matched.length} intent signals found — using primary)`,
    };
  }

  if (matched.length === 1) {
    const { rule, hits } = matched[0];
    return {
      intent: rule.intent,
      confidence: 'high',
      reason: `Matched "${hits[0].source}"`,
    };
  }

  // No non-execute signals — check for explicit execute keywords
  const executeHit = EXECUTE_PATTERNS.find(p => p.test(goal));
  if (executeHit) {
    return {
      intent: 'execute',
      confidence: 'high',
      reason: `Matched execute keyword "${executeHit.source}"`,
    };
  }

  // Fallback: execute with low confidence
  return {
    intent: 'execute',
    confidence: 'low',
    reason: 'No specific intent pattern matched — defaulting to execute pipeline',
  };
}

// ─── Intent Routing ───────────────────────────────────────────────────────

const THINK_SCRIPT = resolve(__dirname, 'dual-brain-think.mjs');
const REVIEW_SCRIPT = resolve(__dirname, 'dual-brain-review.mjs');
const SHIP_GATE_SCRIPT = resolve(__dirname, 'ship-gate.mjs');

/**
 * spawnIntentSubsystem — execute the subsystem that matches the detected intent.
 * Returns the spawnSync result.
 */
function spawnIntentSubsystem(intent, goal) {
  switch (intent) {
    case 'think': {
      return spawnSync(process.execPath, [THINK_SCRIPT, '--question', goal], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
      });
    }
    case 'review': {
      return spawnSync(process.execPath, [REVIEW_SCRIPT], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
      });
    }
    case 'explore': {
      return spawnSync(process.execPath, [TEMPLATES_SCRIPT, '--run', 'explorer', '--question', goal], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
      });
    }
    case 'ship': {
      return spawnSync(process.execPath, [SHIP_GATE_SCRIPT, '--ship', '--goal', goal], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: process.env,
      });
    }
    default:
      return null;
  }
}

// ─── Template Matching ────────────────────────────────────────────────────

const TEMPLATE_KEYWORDS = [
  { template: 'security-review', regex: /\b(security|audit|vulnerabilit|owasp|threat|pentest)\b/i },
  { template: 'test-writer',     regex: /\b(test|spec|coverage|assert|unit\s+test|write\s+tests?)\b/i },
  { template: 'bug-hunter',      regex: /\b(bug|fix|error|crash|broken|defect|regression|debug)\b/i },
  { template: 'explorer',        regex: /\b(explore|understand|find|search|locate|where|what|look)\b/i },
];

const CHAIN_KEYWORDS = [
  { chain: 'explore-then-fix',  regex: /\b(explore|understand).{0,40}(fix|repair|resolve)\b/i },
  { chain: 'review-and-test',   regex: /\b(review|audit).{0,40}(test|spec|coverage)\b/i },
  { chain: 'audit-and-plan',    regex: /\b(audit|analyze).{0,40}(plan|roadmap|design)\b/i },
];

function matchChain(taskTitle) {
  for (const { chain, regex } of CHAIN_KEYWORDS) {
    if (regex.test(taskTitle)) return chain;
  }
  return null;
}

function matchTemplate(taskTitle) {
  for (const { template, regex } of TEMPLATE_KEYWORDS) {
    if (regex.test(taskTitle)) return template;
  }
  return 'explorer';
}

// ─── Provider Resolution ──────────────────────────────────────────────────

function resolveProvider(task, forcedProvider) {
  if (forcedProvider && forcedProvider !== 'auto') return forcedProvider;
  try {
    const rec = chooseProvider({ tier: task.tier });
    return rec.provider === 'openai' ? 'gpt' : 'claude';
  } catch {
    return 'claude';
  }
}

// ─── Mode Resolution ──────────────────────────────────────────────────────

/**
 * Resolve the execution mode from argv flags and options.
 * Tries to import confirmation-policy.mjs's resolveMode; falls back to inline logic.
 * @param {object} opts - parsed CLI options
 * @returns {string} mode string: 'yolo' | 'careful' | 'auto' | profile name
 */
async function resolveMode(opts) {
  // Try to use confirmation-policy if available
  try {
    const cpPath = resolve(__dirname, 'confirmation-policy.mjs');
    if (existsSync(cpPath)) {
      const { resolveMode: cpResolveMode } = await import(cpPath);
      return cpResolveMode({
        yolo: opts.yolo,
        careful: opts.careful,
        mode: opts.mode,
        provider: opts.provider,
      });
    }
  } catch {
    // confirmation-policy not available yet, use inline fallback
  }

  if (opts.yolo) return 'yolo';
  if (opts.careful) return 'careful';
  if (opts.mode) return opts.mode;
  return 'auto';
}

// ─── Git State Snapshot ───────────────────────────────────────────────────

function gitDiffStat() {
  try {
    const result = spawnSync('git', ['diff', '--stat'], { encoding: 'utf8', cwd: process.cwd() });
    return (result.stdout || '').trim();
  } catch {
    return '';
  }
}

function parseChangedFiles(diffStat) {
  if (!diffStat) return [];
  return diffStat
    .split('\n')
    .filter(line => line.includes('|') || line.match(/^\s+\S/))
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// ─── Plan Builder ─────────────────────────────────────────────────────────

/**
 * planExecution(goal) — decompose a goal into an ordered execution plan.
 * Returns { goal, tasks, complexity, wave_recommendation, quality_gates, steps }
 * where steps is an array of enriched step descriptors.
 */
function planExecution(goal) {
  const vibe = routeVibe(goal);
  const { tasks, complexity, wave_recommendation, quality_gates } = vibe;

  const steps = tasks.map((task, idx) => {
    const chainName = matchChain(task.title);
    const templateName = chainName ? null : matchTemplate(task.title);
    const isHighRisk = task.risk === 'high' || task.risk === 'critical';
    return {
      index: idx + 1,
      total: tasks.length,
      task,
      chainName,
      templateName,
      isHighRisk,
      stopBefore: isHighRisk && idx > 0,
    };
  });

  return { goal, tasks, complexity, wave_recommendation, quality_gates, steps };
}

// ─── Plan Display ─────────────────────────────────────────────────────────

function printPlan(plan, forcedProvider, intentResult, mode, forceExecute) {
  const { goal, steps, complexity, quality_gates } = plan;
  const width = 66;
  const hr = '━'.repeat(width);

  // Aggregate risk across steps for display
  const allRisks = steps.map(s => s.task.risk || 'low');
  const displayRisk = aggregateRiskFallback(allRisks);

  // Build a short human-readable description of the intent
  let intentDesc;
  if (forceExecute && intentResult && intentResult.intent !== 'execute') {
    intentDesc = `--force-execute (originally detected: ${intentResult.intent})`;
  } else if (intentResult) {
    intentDesc = intentResult.reason.replace(/^Matched execute keyword .+$/, 'fix code + build');
  } else {
    intentDesc = 'execute';
  }

  const modeLabel = mode || 'auto';
  const modeDesc = modeLabel === 'auto'
    ? 'auto (confirm high risk, skip low/medium)'
    : modeLabel === 'yolo'
    ? 'yolo (no confirmations)'
    : modeLabel === 'careful'
    ? 'careful (confirm every step)'
    : modeLabel;

  console.log(`\n${hr}`);
  console.log(`  Ship Captain — Execution Plan`);
  console.log(`${hr}`);
  console.log(`  Intent: execute (${intentDesc})`);
  console.log(`  Route:  Ship Captain pipeline (${steps.length} step${steps.length !== 1 ? 's' : ''})`);
  console.log(`  Risk:   ${displayRisk}`);
  console.log(`  Mode:   ${modeDesc}`);
  console.log(`${hr}`);
  console.log(`  Goal: ${goal}`);
  console.log(`  Steps: ${steps.length}  |  Complexity: ${complexity}`);
  console.log(`  Quality gates: ${quality_gates.join(', ')}`);
  console.log(`${hr}`);

  for (const step of steps) {
    const { task, chainName, templateName, stopBefore, index, total } = step;
    const provider = resolveProvider(task, forcedProvider);
    const riskBadge = RISK_BADGE[task.risk] || `[${task.risk}]`;
    const tierLabel = TIER_BADGE[task.tier] || task.tier;
    const via = chainName ? `chain:${chainName}` : `template:${templateName}`;
    const stopMark = stopBefore ? '  ⚑ STOP POINT before this step' : '';

    if (stopBefore) console.log(`\n  ${'-'.repeat(width - 2)}`);
    console.log(`  Step ${index}/${total}  ${riskBadge}  ${tierLabel}  [${provider}]`);
    console.log(`    Task: ${task.title}`);
    console.log(`    Via:  ${via}`);
    if (stopMark) console.log(`   ${stopMark}`);
  }

  console.log(`${hr}\n`);
}

// ─── Step Execution ───────────────────────────────────────────────────────

function spawnTemplate(templateName, task) {
  const flagArgs = ['--run', templateName];

  const desc = task.title.toLowerCase();
  if (templateName === 'explorer') {
    flagArgs.push('--question', task.title);
  } else if (templateName === 'bug-hunter') {
    flagArgs.push('--area', desc);
  } else if (templateName === 'test-writer') {
    flagArgs.push('--file', desc);
  } else if (templateName === 'security-review') {
    flagArgs.push('--scope', desc);
  } else {
    flagArgs.push('--question', task.title);
  }

  return spawnSync(process.execPath, [TEMPLATES_SCRIPT, ...flagArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
}

function spawnChain(chainName, task, yesFlag) {
  const flagArgs = ['--run', chainName, '--question', task.title];
  if (yesFlag) flagArgs.push('--yes');

  return spawnSync(process.execPath, [CHAINS_SCRIPT, ...flagArgs], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
}

// ─── Interactive Prompt ───────────────────────────────────────────────────

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => { rl.close(); res(answer.trim()); });
  });
}

async function askContinue(stepIndex, total) {
  const answer = await prompt(`\n  Continue to step ${stepIndex}/${total}? [Y/n] `);
  return answer === '' || /^y(es)?$/i.test(answer);
}

async function askOnFailure(stepIndex) {
  const answer = await prompt(`\n  Step ${stepIndex} failed. [R]etry / [S]kip / [A]bort? `);
  const a = answer.toLowerCase();
  if (a === 'r' || a === 'retry') return 'retry';
  if (a === 's' || a === 'skip') return 'skip';
  return 'abort';
}

// ─── Duration Formatting ──────────────────────────────────────────────────

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

// ─── Run Record ───────────────────────────────────────────────────────────

function makeRunId() {
  return `run-${new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')}`;
}

function writeRunRecord(record) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const fname = `${record.id}.json`;
  const fpath = resolve(RUNS_DIR, fname);
  writeFileSync(fpath, JSON.stringify(record, null, 2), 'utf8');
  return fpath;
}

// ─── Confirmation Policy Integration ─────────────────────────────────────

/**
 * Load confirmation-policy.mjs exports if available.
 * Returns null if file doesn't exist yet (other agent still building it).
 */
async function loadConfirmationPolicy() {
  const cpPath = resolve(__dirname, 'confirmation-policy.mjs');
  if (!existsSync(cpPath)) return null;
  try {
    const mod = await import(cpPath);
    return {
      getConfirmationPolicy: mod.getConfirmationPolicy,
      resolveMode: mod.resolveMode,
      aggregateRisk: mod.aggregateRisk,
      formatConfirmation: mod.formatConfirmation,
    };
  } catch {
    return null;
  }
}

/**
 * Check whether to confirm/block a step based on confirmation policy.
 * Falls back to the original stopBefore logic if policy module not available.
 */
async function checkStepConfirmation(cp, { risk, mode, stepName }) {
  if (!cp || !cp.getConfirmationPolicy) {
    // Fallback: block on high/critical in non-yolo mode
    const isHighRisk = risk === 'high' || risk === 'critical';
    return {
      shouldBlock: false,
      shouldConfirm: isHighRisk && mode !== 'yolo',
      reason: isHighRisk ? `${risk} risk step` : null,
    };
  }
  try {
    return cp.getConfirmationPolicy({ risk, mode, step: stepName });
  } catch {
    return { shouldBlock: false, shouldConfirm: false, reason: null };
  }
}

// ─── Risk Aggregation ─────────────────────────────────────────────────────

const RISK_ORDER = ['low', 'medium', 'high', 'critical'];

function aggregateRiskFallback(risks) {
  let max = 'low';
  for (const r of risks) {
    if (RISK_ORDER.indexOf(r) > RISK_ORDER.indexOf(max)) max = r;
  }
  return max;
}

// ─── Self-Healing Tests ───────────────────────────────────────────────────

/**
 * selfHealTests(testResult, options) — Attempt to auto-fix failing tests.
 *
 * Spawns a claude fix agent with the test output, then re-runs tests.
 * Retries up to maxRetries times.
 *
 * @param {object} testResult  The failing runTests() result
 * @param {{ maxRetries?: number, noHeal?: boolean }} options
 * @returns {{ healed: boolean, attempts: number, finalTestResult: object }}
 */
export async function selfHealTests(testResult, options = {}) {
  const { maxRetries = 2, noHeal = false } = options;

  if (noHeal) {
    return { healed: false, attempts: 0, finalTestResult: testResult };
  }

  let attempts = 0;
  let currentTestResult = testResult;

  while (attempts < maxRetries) {
    attempts++;
    console.log(`\n  Tests failed. Attempting auto-fix (attempt ${attempts}/${maxRetries})...`);

    // Build a concise summary of failures for the fix prompt
    const outputSnippet = (currentTestResult.output || '').slice(0, 4000); // cap to avoid huge prompts
    const fixPrompt = `These tests are failing:\n\n${outputSnippet}\n\nFix the code to make them pass. Do not modify the tests unless they have clear bugs. Do not introduce new features or refactor beyond what is needed to make the tests pass.`;

    // Spawn claude fix agent
    const fixRes = spawnSync('claude', ['-p', fixPrompt], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      timeout: 300_000, // 5 minutes per attempt
      shell: false,
    });

    if (fixRes.error) {
      console.log(`  [auto-fix] Fix agent error: ${fixRes.error.message}`);
    } else {
      const fixStatus = fixRes.status === 0 ? 'completed' : `exited with code ${fixRes.status}`;
      console.log(`  [auto-fix] Fix agent ${fixStatus}.`);
    }

    // Re-run tests
    console.log('  [auto-fix] Re-running tests...');
    const newTestResult = runTests();
    currentTestResult = newTestResult;

    const status = newTestResult.passed ? 'PASSED' : 'FAILED';
    console.log(`  [auto-fix] Tests: ${status}`);

    if (newTestResult.passed) {
      console.log('  Auto-fix successful! Tests now pass.');
      return { healed: true, attempts, finalTestResult: newTestResult };
    }
  }

  // All attempts exhausted
  console.log(`\n  Could not auto-fix tests after ${attempts} attempt(s).`);
  console.log('  Please fix the failing tests manually or abort.');
  return { healed: false, attempts, finalTestResult: currentTestResult };
}

// ─── Ship Gate Integration ────────────────────────────────────────────────

/**
 * Attempt to import and run the ship gate pipeline.
 * Returns null if ship-gate.mjs doesn't export runShipGate yet.
 */
async function runShipGatePipeline(goal, runRecord, options) {
  const sgPath = resolve(__dirname, 'ship-gate.mjs');
  if (!existsSync(sgPath)) {
    return { status: 'skipped', reason: 'ship-gate.mjs not found' };
  }

  let runShipGate;
  try {
    const mod = await import(sgPath);
    runShipGate = mod.runShipGate;
  } catch (err) {
    return { status: 'skipped', reason: `failed to import ship-gate.mjs: ${err.message}` };
  }

  if (typeof runShipGate !== 'function') {
    // ship-gate.mjs exists but runShipGate export not added yet (other agent still building)
    return { status: 'skipped', reason: 'runShipGate export not yet available in ship-gate.mjs' };
  }

  try {
    const result = await runShipGate({
      goal,
      runId: runRecord.id,
      yes: options.yes || options.yolo,
      no_pr: options.noPr,
      runRecord,
    });
    return result;
  } catch (err) {
    return { status: 'error', reason: err.message };
  }
}

// ─── Main Executor ─────────────────────────────────────────────────────────

/**
 * executeShipCaptain(goal, options) — Full orchestration flow.
 *
 * @param {string} goal
 * @param {{
 *   yes?: boolean,
 *   dryRun?: boolean,
 *   planOnly?: boolean,
 *   provider?: string,
 *   yolo?: boolean,
 *   careful?: boolean,
 *   noPr?: boolean,
 *   mode?: string,
 *   forceExecute?: boolean,
 *   resumeFrom?: number,
 *   resumedFromId?: string,
 * }} options
 * @returns {object} run record
 */
async function executeShipCaptain(goal, options = {}) {
  const {
    yes = false,
    dryRun = false,
    planOnly = false,
    provider: forcedProvider = 'auto',
    yolo = false,
    careful = false,
    noPr = false,
    forceExecute = false,
    resumeFrom = null,
    resumedFromId = null,
  } = options;

  // ── Intent Classification ────────────────────────────────────────────────
  const intentResult = classifyGoalIntent(goal);

  // Route to a dedicated subsystem for non-execute intents (unless forced)
  if (!forceExecute && intentResult.intent !== 'execute' && intentResult.confidence !== 'low') {
    const subsystemLabel = {
      think: 'dual-brain-think (architecture thinking)',
      review: 'dual-brain-review (code review)',
      explore: 'agent-templates explorer',
      ship: 'ship-gate --ship (PR creation)',
    }[intentResult.intent] || intentResult.intent;

    console.log(`\n  Detected intent: ${intentResult.intent} — routing to ${subsystemLabel}`);
    console.log(`  Reason: ${intentResult.reason}`);
    console.log(`  Override with: npx dual-brain do '${goal}' --force-execute\n`);

    if (dryRun || planOnly) {
      console.log(`  [dry-run] Would route to: ${subsystemLabel}`);
      return { id: null, status: 'dry_run', goal, intent: intentResult, steps: [] };
    }

    const result = spawnIntentSubsystem(intentResult.intent, goal);
    const exitCode = result ? (result.status ?? 0) : 0;
    return {
      id: null,
      status: exitCode === 0 ? 'completed' : 'failed',
      goal,
      intent: intentResult,
      steps: [],
    };
  }

  // Resolve mode (uses confirmation-policy if available)
  const mode = await resolveMode({ yolo, careful, mode: options.mode, provider: forcedProvider });

  // Load confirmation policy module (graceful degradation if not ready)
  const cp = await loadConfirmationPolicy();

  const plan = planExecution(goal);
  printPlan(plan, forcedProvider, intentResult, mode, forceExecute);

  if (dryRun || planOnly) {
    const label = planOnly ? '--plan-only' : '--dry-run';
    console.log(`  [${label}] Plan displayed. Nothing executed.\n`);
    return { id: null, status: 'dry_run', goal, steps: [] };
  }

  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const runRecord = {
    id: runId,
    goal,
    status: 'running',
    mode,
    options: { yes, yolo, careful, noPr, mode: options.mode || null },
    steps: [],
    total_duration_ms: 0,
    files_changed: [],
    started_at: startedAt,
    completed_at: null,
    ship_gate: null,
    ...(resumedFromId ? { resumed_from: resumedFromId } : {}),
  };

  const allChangedFiles = new Set();
  const totalSteps = plan.steps.length;
  const stepRisks = [];

  // If resuming, print a header showing which step we start from
  if (resumeFrom !== null && resumeFrom > 0) {
    const resumeStep = plan.steps[resumeFrom];
    const resumeDesc = resumeStep ? (resumeStep.task?.title || `step ${resumeFrom + 1}`) : `step ${resumeFrom + 1}`;
    console.log(`\n  Resuming from step ${resumeFrom + 1}/${plan.steps.length}: ${resumeDesc}\n`);
  }

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const { task, chainName, templateName, isHighRisk, stopBefore, index } = step;
    const tierLabel = TIER_BADGE[task.tier] || task.tier;
    const riskBadge = RISK_BADGE[task.risk] || `[${task.risk}]`;

    // Skip steps before resumeFrom — mark them as skipped-resume in the run record
    if (resumeFrom !== null && i < resumeFrom) {
      stepRisks.push(task.risk || 'low');
      runRecord.steps.push({
        task: task.title,
        template: chainName || templateName,
        risk: task.risk,
        status: 'skipped-resume',
        files_changed: [],
        duration_ms: 0,
      });
      continue;
    }

    stepRisks.push(task.risk || 'low');

    // ── Confirmation policy check ──────────────────────────────────────────
    if (mode !== 'yolo' && (stopBefore || mode === 'careful')) {
      const conf = await checkStepConfirmation(cp, {
        risk: task.risk,
        mode,
        stepName: 'edit',
      });

      if (conf.shouldBlock) {
        console.log(`\n  [BLOCKED] Step ${index}/${totalSteps}: ${task.title}`);
        console.log(`  Reason: ${conf.reason || 'blocked by confirmation policy'}`);
        console.log('  Use --yolo to bypass, or adjust your profile.\n');
        runRecord.status = 'aborted';
        runRecord.completed_at = new Date().toISOString();
        runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
        runRecord.files_changed = [...allChangedFiles];
        const fpath = writeRunRecord(runRecord);
        printFinalSummary(runRecord, fpath, null);
        return runRecord;
      }

      if (conf.shouldConfirm) {
        const confirmMsg = cp && cp.formatConfirmation
          ? cp.formatConfirmation('edit', task.risk, conf.reason)
          : `\n  Continue to step ${index}/${totalSteps}? [Y/n] `;
        const go = await (async () => {
          if (!yes) {
            const answer = await prompt(confirmMsg);
            return answer === '' || /^y(es)?$/i.test(answer);
          }
          return true;
        })();
        if (!go) {
          console.log('\n  Aborted before step', index, '\n');
          runRecord.status = 'aborted';
          runRecord.completed_at = new Date().toISOString();
          runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
          runRecord.files_changed = [...allChangedFiles];
          const fpath = writeRunRecord(runRecord);
          printFinalSummary(runRecord, fpath, null);
          return runRecord;
        }
      }
    }

    const via = chainName ? `chain:${chainName}` : `template:${templateName}`;
    console.log(`\n  [Step ${index}/${totalSteps}] ${task.title}... (${tierLabel}) ${riskBadge}`);
    console.log(`  Via: ${via}`);
    console.log('  ' + '─'.repeat(62));

    const statBefore = gitDiffStat();
    const stepStart = Date.now();

    let exitStatus = 0;
    let retrying = true;
    let stepStatus = 'done';

    while (retrying) {
      retrying = false;

      let result;
      if (chainName) {
        result = spawnChain(chainName, task, yes || yolo);
      } else {
        result = spawnTemplate(templateName, task);
      }

      exitStatus = result.status ?? 0;

      if (exitStatus !== 0) {
        console.log(`\n  Step ${index} exited with code ${exitStatus}.`);
        if (yes || yolo) {
          console.log('  [auto] Aborting on failure.');
          stepStatus = 'failed';
        } else {
          const choice = await askOnFailure(index);
          if (choice === 'retry') {
            console.log('  Retrying...\n');
            retrying = true;
          } else if (choice === 'skip') {
            console.log('  Skipping step.\n');
            stepStatus = 'skipped';
          } else {
            stepStatus = 'failed';
            console.log('  Aborting.\n');
          }
        }
      }
    }

    const stepDuration = Date.now() - stepStart;
    const statAfter = gitDiffStat();
    const filesChanged = statAfter !== statBefore ? parseChangedFiles(statAfter) : [];
    for (const f of filesChanged) allChangedFiles.add(f);

    runRecord.steps.push({
      task: task.title,
      template: chainName || templateName,
      risk: task.risk,
      status: stepStatus,
      files_changed: filesChanged,
      duration_ms: stepDuration,
    });

    if (filesChanged.length > 0) {
      console.log(`\n  Files changed: ${filesChanged.join(', ')}`);
    }
    console.log(`  Step ${index} ${stepStatus} in ${fmtDuration(stepDuration)}`);

    if (stepStatus === 'failed') {
      runRecord.status = 'failed';
      runRecord.completed_at = new Date().toISOString();
      runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
      runRecord.files_changed = [...allChangedFiles];
      const fpath = writeRunRecord(runRecord);
      printFinalSummary(runRecord, fpath, null);
      return runRecord;
    }
  }

  runRecord.status = 'completed';
  runRecord.completed_at = new Date().toISOString();
  runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
  runRecord.files_changed = [...allChangedFiles];

  // ── Ship Gate Pipeline ─────────────────────────────────────────────────
  // Check aggregate risk vs confirmation policy before running gate/tests/PR
  const aggRisk = cp && cp.aggregateRisk
    ? cp.aggregateRisk(stepRisks)
    : aggregateRiskFallback(stepRisks);

  runRecord.aggregate_risk = aggRisk;

  // Check if gate/test/pr steps are blocked
  const gateConf = await checkStepConfirmation(cp, { risk: aggRisk, mode, stepName: 'gate' });
  const prConf = await checkStepConfirmation(cp, { risk: aggRisk, mode, stepName: 'pr' });

  const isBlocked = (gateConf.shouldBlock || prConf.shouldBlock) && mode !== 'yolo';

  let shipGateResult = null;

  if (isBlocked) {
    console.log('\n  [WARNING] Ship gate blocked by confirmation policy.');
    const reason = gateConf.shouldBlock
      ? (gateConf.reason || 'critical risk requires manual review')
      : (prConf.reason || 'PR creation requires manual approval');
    console.log(`  Reason: ${reason}`);
    console.log('  Use --yolo to bypass, or run manually:');
    console.log('    npx dual-brain gate');
    console.log('    npx dual-brain ship\n');
    runRecord.ship_gate = { status: 'blocked', reason };
  } else {
    // Run the full ship gate pipeline
    console.log('\n  Running ship gate (tests → quality gate → PR)...');
    shipGateResult = await runShipGatePipeline(goal, runRecord, {
      yes: yes || yolo,
      noPr,
    });

    // Self-heal failing tests (if ship gate ran but tests failed)
    if (shipGateResult && shipGateResult.status === 'tests_failed' && shipGateResult.tests) {
      const fakeTestResult = {
        passed: shipGateResult.tests.passed ?? false,
        output: shipGateResult.tests.output ?? '',
        command_used: shipGateResult.tests.command ?? null,
        exit_code: null,
        duration_ms: 0,
      };
      const healResult = await selfHealTests(fakeTestResult, { maxRetries: 2 });
      runRecord.test_heal = { healed: healResult.healed, attempts: healResult.attempts };

      if (healResult.healed) {
        // Tests now pass — re-run the full ship gate pipeline
        console.log('\n  Tests fixed — re-running ship gate...');
        shipGateResult = await runShipGatePipeline(goal, runRecord, {
          yes: yes || yolo,
          noPr,
        });
      } else {
        // Could not fix — prompt user to intervene or abort
        if (!yes && !yolo) {
          const answer = await prompt('\n  Could not auto-fix tests. [C]ontinue anyway / [A]bort? ');
          if (/^a(bort)?$/i.test(answer.trim())) {
            console.log('  Aborted.');
            runRecord.status = 'failed';
            runRecord.completed_at = new Date().toISOString();
            runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
            runRecord.ship_gate = shipGateResult;
            const fpath = writeRunRecord(runRecord);
            printFinalSummary(runRecord, fpath, shipGateResult);
            return runRecord;
          }
          console.log('  Continuing with failing tests...');
        } else {
          console.log('  [auto] Could not fix tests — continuing with failing tests (--yes/--yolo).');
        }
      }
    }

    runRecord.ship_gate = shipGateResult;

    if (shipGateResult && shipGateResult.status === 'skipped') {
      console.log(`\n  [INFO] Ship gate skipped: ${shipGateResult.reason}`);
      console.log('  Next: npx dual-brain gate    (run quality gate)');
      console.log('        npx dual-brain ship    (create branch + PR)\n');
    }
  }

  const fpath = writeRunRecord(runRecord);
  printFinalSummary(runRecord, fpath, shipGateResult);
  return runRecord;
}

// ─── Final Summary ────────────────────────────────────────────────────────

function printFinalSummary(record, fpath, shipGateResult) {
  const hr = '━'.repeat(50);
  const completedSteps = record.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const totalSteps = record.steps.length;
  const relPath = fpath
    ? fpath.replace(process.cwd() + '/', '')
    : '.claude/runs/[not written]';

  const statusLabel = record.status === 'completed'
    ? 'Complete'
    : record.status.charAt(0).toUpperCase() + record.status.slice(1);

  console.log(`\n${hr}`);
  console.log(`  Ship Captain ${statusLabel}`);
  console.log(`${hr}`);
  console.log(`  Goal: ${record.goal}`);
  console.log(`  Steps: ${completedSteps}/${totalSteps} completed`);
  console.log(`  Files changed: ${record.files_changed.length}`);

  // Ship gate details (tests, gate, PR)
  if (shipGateResult && shipGateResult.status !== 'skipped') {
    // Tests
    const tests = shipGateResult.tests;
    if (tests) {
      if (tests.passed === null) {
        console.log('  Tests: not found');
      } else if (tests.passed) {
        console.log(`  Tests: passed (${tests.command_used || 'npm test'})`);
      } else {
        console.log(`  Tests: FAILED (exit ${tests.exit_code})`);
      }
    }

    // Quality gate
    const gate = shipGateResult.gate;
    if (gate) {
      const gateStatus = gate.gate || gate.status || 'unknown';
      const gateRisk = gate.risk ? ` (${gate.risk} risk)` : '';
      console.log(`  Quality gate: ${gateStatus}${gateRisk}`);
    }

    // PR
    const pr = shipGateResult.pr;
    if (record.ship_gate && record.ship_gate.status === 'blocked') {
      console.log('  PR: skipped (use npx dual-brain ship)');
    } else if (noPrFlagFromRecord(record)) {
      console.log('  PR: skipped (--no-pr)');
    } else if (pr && pr.pr_url) {
      console.log(`  PR: ${pr.pr_url}`);
    } else if (pr && pr.error) {
      console.log(`  PR: failed — ${pr.error}`);
    } else if (pr && pr.branch) {
      console.log(`  PR: skipped (use npx dual-brain ship)`);
    } else {
      console.log('  PR: skipped (use npx dual-brain ship)');
    }
  } else if (record.ship_gate && record.ship_gate.status === 'blocked') {
    console.log('  Tests: not run (blocked)');
    console.log('  Quality gate: not run (blocked)');
    console.log('  PR: skipped (use npx dual-brain ship)');
  } else {
    // Gate not run (skipped or not available)
    console.log('  Next: npx dual-brain gate    (run quality gate)');
    console.log('        npx dual-brain ship    (create branch + PR)');
  }

  console.log(`  Duration: ${fmtDuration(record.total_duration_ms)}`);
  console.log(`  Run record: ${relPath}`);
  console.log(`${hr}\n`);
}

function noPrFlagFromRecord(record) {
  // We can't easily recover noPr flag from the record alone; best effort
  return false;
}

// ─── CLI Arg Parser ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    goal: null,
    yes: false,
    dryRun: false,
    planOnly: false,
    provider: 'auto',
    yolo: false,
    careful: false,
    noPr: false,
    mode: null,
    forceExecute: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--goal') {
      opts.goal = argv[++i];
    } else if (a === '--yes' || a === '-y') {
      opts.yes = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--plan-only') {
      opts.planOnly = true;
    } else if (a === '--provider') {
      opts.provider = argv[++i];
    } else if (a === '--yolo') {
      opts.yolo = true;
    } else if (a === '--careful') {
      opts.careful = true;
    } else if (a === '--no-pr') {
      opts.noPr = true;
    } else if (a === '--mode') {
      opts.mode = argv[++i];
    } else if (a === '--force-execute') {
      opts.forceExecute = true;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }

  if (!opts.goal && positional.length > 0) {
    opts.goal = positional.join(' ');
  }

  return opts;
}

// ─── Exports ──────────────────────────────────────────────────────────────

export { planExecution, executeShipCaptain, classifyGoalIntent };

// ─── CLI Entry ────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.goal) {
    console.error(`
  Usage:
    node hooks/ship-captain.mjs "fix the auth bug and write tests"
    node hooks/ship-captain.mjs --goal "..." [--yes] [--dry-run] [--plan-only]
                                             [--provider claude|gpt|auto]
                                             [--yolo] [--careful] [--no-pr]
                                             [--mode <profile>] [--force-execute]

  Intent routing (auto-detected, override with --force-execute):
    think   → dual-brain-think (architecture questions)
    review  → dual-brain-review (code review / audit)
    explore → agent-templates explorer (find / explain)
    ship    → ship-gate --ship (create PR)
    execute → ship captain pipeline (fix / build / write / update)
    `);
    process.exit(1);
  }

  executeShipCaptain(opts.goal, {
    yes: opts.yes,
    dryRun: opts.dryRun,
    planOnly: opts.planOnly,
    provider: opts.provider,
    yolo: opts.yolo,
    careful: opts.careful,
    noPr: opts.noPr,
    mode: opts.mode,
    forceExecute: opts.forceExecute,
  }).then((record) => {
    process.exit(record.status === 'completed' || record.status === 'dry_run' ? 0 : 1);
  }).catch((err) => {
    console.error('\n  Fatal error:', err.message);
    process.exit(1);
  });
}
