#!/usr/bin/env node
/**
 * ship-captain.mjs — End-to-end executor for dual-brain.
 *
 * Orchestrates natural language goals into structured, sequentially executed
 * agent tasks with durable run records and quality gate integration.
 *
 * CLI:  node hooks/ship-captain.mjs "fix the auth bug and write tests"
 *       node hooks/ship-captain.mjs --goal "..." [--yes] [--dry-run] [--provider claude|gpt|auto]
 *
 * Exports: planExecution(goal), executeShipCaptain(goal, options)
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(__dirname, '..', '.claude', 'runs');
const TEMPLATES_SCRIPT = resolve(__dirname, 'agent-templates.mjs');
const CHAINS_SCRIPT = resolve(__dirname, 'agent-chains.mjs');

// ─── Risk/Tier Display Helpers ─────────────────────────────────────────────

const RISK_BADGE = { low: '[low]', medium: '[med]', high: '[HIGH]', critical: '[CRIT]' };
const TIER_BADGE = { search: 'search/haiku', execute: 'execute/sonnet', think: 'think/opus' };
const PROVIDER_BADGE = { claude: 'claude', openai: 'gpt', auto: 'auto' };

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

function printPlan(plan, forcedProvider) {
  const { goal, steps, complexity, quality_gates } = plan;
  const width = 66;
  const hr = '━'.repeat(width);

  console.log(`\n${hr}`);
  console.log(`  Ship Captain — Execution Plan`);
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

// ─── Main Executor ─────────────────────────────────────────────────────────

/**
 * executeShipCaptain(goal, options) — Full orchestration flow.
 *
 * @param {string} goal
 * @param {{ yes?: boolean, dryRun?: boolean, provider?: string }} options
 * @returns {object} run record
 */
async function executeShipCaptain(goal, options = {}) {
  const { yes = false, dryRun = false, provider: forcedProvider = 'auto' } = options;

  const plan = planExecution(goal);
  printPlan(plan, forcedProvider);

  if (dryRun) {
    console.log('  [--dry-run] Plan displayed. Nothing executed.\n');
    return { id: null, status: 'dry_run', goal, steps: [] };
  }

  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const runRecord = {
    id: runId,
    goal,
    status: 'running',
    steps: [],
    total_duration_ms: 0,
    files_changed: [],
    started_at: startedAt,
    completed_at: null,
  };

  const allChangedFiles = new Set();
  const totalSteps = plan.steps.length;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const { task, chainName, templateName, isHighRisk, stopBefore, index } = step;
    const tierLabel = TIER_BADGE[task.tier] || task.tier;
    const riskBadge = RISK_BADGE[task.risk] || `[${task.risk}]`;

    // Stop point before high/critical steps (except first step)
    if (stopBefore && !yes) {
      const go = await askContinue(index, totalSteps);
      if (!go) {
        console.log('\n  Aborted before step', index, '\n');
        runRecord.status = 'aborted';
        runRecord.completed_at = new Date().toISOString();
        runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
        runRecord.files_changed = [...allChangedFiles];
        const fpath = writeRunRecord(runRecord);
        printFinalSummary(runRecord, fpath);
        return runRecord;
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
        result = spawnChain(chainName, task, yes);
      } else {
        result = spawnTemplate(templateName, task);
      }

      exitStatus = result.status ?? 0;

      if (exitStatus !== 0) {
        console.log(`\n  Step ${index} exited with code ${exitStatus}.`);
        if (yes) {
          console.log('  [--yes] Aborting on failure.');
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
      printFinalSummary(runRecord, fpath);
      return runRecord;
    }
  }

  runRecord.status = 'completed';
  runRecord.completed_at = new Date().toISOString();
  runRecord.total_duration_ms = Date.now() - new Date(startedAt).getTime();
  runRecord.files_changed = [...allChangedFiles];

  const fpath = writeRunRecord(runRecord);
  printFinalSummary(runRecord, fpath);
  return runRecord;
}

// ─── Final Summary ────────────────────────────────────────────────────────

function printFinalSummary(record, fpath) {
  const hr = '━'.repeat(50);
  const completed = record.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const total = record.steps.length;
  const relPath = fpath
    ? fpath.replace(process.cwd() + '/', '')
    : '.claude/runs/[not written]';

  console.log(`\n${hr}`);
  console.log(`  Ship Captain ${record.status === 'completed' ? 'Complete' : record.status.charAt(0).toUpperCase() + record.status.slice(1)}`);
  console.log(`${hr}`);
  console.log(`  Goal: ${record.goal}`);
  console.log(`  Steps: ${completed}/${total} completed`);
  console.log(`  Files changed: ${record.files_changed.length}`);
  console.log(`  Duration: ${fmtDuration(record.total_duration_ms)}`);
  console.log(`  Run record: ${relPath}`);
  console.log('');
  console.log('  Next: npx dual-brain gate    (run quality gate)');
  console.log('        npx dual-brain ship    (create branch + PR)');
  console.log(`${hr}\n`);
}

// ─── CLI Arg Parser ───────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { goal: null, yes: false, dryRun: false, provider: 'auto' };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--goal') {
      opts.goal = argv[++i];
    } else if (a === '--yes' || a === '-y') {
      opts.yes = true;
    } else if (a === '--dry-run') {
      opts.dryRun = true;
    } else if (a === '--provider') {
      opts.provider = argv[++i];
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

export { planExecution, executeShipCaptain };

// ─── CLI Entry ────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.goal) {
    console.error(`
  Usage:
    node hooks/ship-captain.mjs "fix the auth bug and write tests"
    node hooks/ship-captain.mjs --goal "..." [--yes] [--dry-run] [--provider claude|gpt|auto]
    `);
    process.exit(1);
  }

  executeShipCaptain(opts.goal, {
    yes: opts.yes,
    dryRun: opts.dryRun,
    provider: opts.provider,
  }).then((record) => {
    process.exit(record.status === 'completed' || record.status === 'dry_run' ? 0 : 1);
  }).catch((err) => {
    console.error('\n  Fatal error:', err.message);
    process.exit(1);
  });
}
