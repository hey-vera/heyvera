#!/usr/bin/env node
/**
 * gpt-work-dispatcher.mjs
 *
 * Dispatches execution tasks to GPT via the Codex CLI.
 * Packages a work order, runs `codex exec`, captures the results,
 * and returns structured output.
 *
 * Usage as CLI:
 *   node .claude/hooks/gpt-work-dispatcher.mjs \
 *     --task "Add tests for budget-balancer.mjs" \
 *     --tier execute \
 *     --files hooks/budget-balancer.mjs
 *
 * Usage as module:
 *   import { dispatchGptTask } from './gpt-work-dispatcher.mjs';
 *   const result = await dispatchGptTask({ task, model, tier, forceModel, files, constraints, timeoutMs });
 */

import { spawnSync } from 'child_process';
import { appendFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, '..', 'orchestrator.json');
const EXECUTE_WORDS = /\b(edit|write|fix|implement|modify|refactor|delete|commit|test|build|run|add|update|create)\b/i;
const SEARCH_WORDS = /\b(explore|search|find|grep|locate|list\s+files|read[-\s]?only|lookup|scan)\b/i;
const THINK_WORDS = /\b(plan|design|architect|review|audit|security|code[-\s]?review|threat[-\s]?model|complex[-\s]?debug)\b/i;
const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPL_SLUG);
const GPT_TIER_SANDBOX = IS_REPLIT
  ? { search: 'danger-full-access', execute: 'danger-full-access', think: 'danger-full-access' }
  : { search: 'read-only', execute: 'danger-full-access', think: 'read-only' };
const GPT_TIER_PROMPTS = {
  search: 'You are a READ-ONLY search agent. Do NOT edit files.',
  execute: 'You are an execution agent. Edit files directly.',
  think: 'You are an architecture/review agent. Analyze and recommend, do not edit unless explicitly asked.',
};

// ---------------------------------------------------------------------------
// Codex discovery — mirrors dual-brain-review.mjs
// ---------------------------------------------------------------------------

function findCodex() {
  const candidates = [
    process.env.CODEX_BIN,
  ].filter(Boolean);
  for (const c of candidates) {
    try { spawnSync(c, ['--version'], { stdio: 'pipe', timeout: 3000 }); return c; } catch {}
  }
  try {
    const which = spawnSync('which', ['codex'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  } catch {}
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const fallbacks = [
    join(home, '.local', 'bin', 'codex'),
    join(home, 'bin', 'codex'),
    '/usr/local/bin/codex',
  ];
  for (const p of fallbacks) {
    try { spawnSync(p, ['--version'], { stdio: 'pipe', timeout: 3000 }); return p; } catch {}
  }
  return null;
}

function isCodexAuthenticated(result) {
  const out = ((result?.stdout || '') + (result?.stderr || '')).toLowerCase();
  if (/\b(not\s+logged\s+in|unauthenticated|logged\s+out|no\s+auth)\b/.test(out)) return false;
  return result?.status === 0 ||
    /\b(logged\s+in|authenticated|signed\s+in)\b/.test(out);
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function normalizeTier(tier) {
  return ['search', 'execute', 'think'].includes(tier) ? tier : null;
}

function loadOrchestratorConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function classifyGptTier(task) {
  const text = [
    task?.task,
    ...(Array.isArray(task?.constraints) ? task.constraints : []),
  ]
    .filter(Boolean)
    .join(' ');

  if (THINK_WORDS.test(text)) return 'think';
  if (EXECUTE_WORDS.test(text)) return 'execute';
  if (SEARCH_WORDS.test(text)) return 'search';
  return 'execute';
}

export function resolveGptModel(tier, config = loadOrchestratorConfig()) {
  const normalizedTier = normalizeTier(tier);
  if (!normalizedTier) return null;

  const models = config?.subscriptions?.openai?.models ?? {};
  for (const [model, meta] of Object.entries(models)) {
    if (meta?.tier === normalizedTier) return model;
  }

  if (normalizedTier === 'think') return 'gpt-5.5';
  if (normalizedTier === 'search') return 'gpt-4.1-mini';
  return 'gpt-5.4';
}

function buildPrompt(task) {
  const tierInstruction = GPT_TIER_PROMPTS[task.tier] || GPT_TIER_PROMPTS.execute;
  let prompt = `You are a GPT execution agent inside the Dual-Brain Orchestrator.

Task: ${task.task}

${tierInstruction}

Own this task completely.

`;
  if (task.files?.length) {
    prompt += `Relevant files:\n${task.files.map(f => `- ${f}`).join('\n')}\n\n`;
  }
  if (task.constraints?.length) {
    prompt += `Constraints:\n${task.constraints.map(c => `- ${c}`).join('\n')}\n\n`;
  }
  prompt += `When done, output a summary of:
1. What you changed (files and behavior)
2. Tests run and results (if applicable)
3. Remaining risks or edge cases
4. Any assumptions you made`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Codex executor
// ---------------------------------------------------------------------------

function classifyCodexFailure(proc) {
  let failureType = null;

  if (proc.error?.code === 'ETIMEDOUT') {
    failureType = 'timeout';
  } else if (proc.error?.code === 'ENOENT') {
    failureType = 'not_found';
  } else if (proc.error) {
    failureType = 'spawn_error';
  }

  const stderr = (proc.stderr || '').toLowerCase();
  if (stderr.includes('unauthorized') || stderr.includes('401') || stderr.includes('not logged in')) {
    failureType = 'auth';
  } else if (stderr.includes('rate limit') || stderr.includes('429') || stderr.includes('too many')) {
    failureType = 'rate_limit';
  } else if (stderr.includes('timeout') || stderr.includes('timed out')) {
    failureType = 'timeout';
  }

  return failureType;
}

function runCodexExec(codexBin, model, prompt, cwd, timeoutMs, sandbox, effort) {
  const args = [
    'exec', '--json', '--ephemeral',
    '-m', model,
    '-s', sandbox,
  ];
  if (effort && ['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    args.push('-c', `reasoning.effort="${effort}"`);
  }
  args.push(prompt);
  return spawnSync(codexBin, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs || 120000,
    cwd: cwd || process.cwd(),
  });
}

function executeCodex(codexBin, model, prompt, cwd, timeoutMs, sandbox = 'danger-full-access', effort = null) {
  const startTime = Date.now();

  function finalizeAttempt(proc, attemptStartTime, attemptCount) {
    const durationMs = Date.now() - attemptStartTime;
    const failureType = classifyCodexFailure(proc);

    // Parse JSONL output
    const messages = (proc.stdout || '')
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const agentMessages = messages
      .filter(m => m.type === 'item.completed' && m.item?.type === 'agent_message')
      .map(m => m.item.text);

    const usage = messages.find(m => m.type === 'turn.completed')?.usage;
    const errors = messages.filter(m => m.type === 'error' || m.type === 'turn.failed');
    const errorMessages = errors.map(e => e.message || e.error?.message || 'unknown');

    if (proc.error?.message) {
      errorMessages.unshift(proc.error.message);
    }
    if (proc.stderr?.trim() && errorMessages.length === 0 && proc.status !== 0) {
      errorMessages.push(proc.stderr.trim().slice(0, 200));
    }

    // Detect changed files from command_execution items
    const commands = messages
      .filter(m => m.type === 'item.completed' && m.item?.type === 'command_execution')
      .map(m => m.item);

    // Estimate startup time: time to first agent message or completed item
    const firstItemTs = messages.find(m => m.type === 'item.completed')?.timestamp;
    let startupMs = null;
    if (firstItemTs) {
      startupMs = Date.parse(firstItemTs) - attemptStartTime;
      if (startupMs < 0 || startupMs > durationMs) startupMs = null;
    }

    return {
      success: proc.status === 0 && errors.length === 0 && !failureType,
      summary: agentMessages.join('\n\n'),
      durationMs,
      startupMs,
      model,
      usage: usage || null,
      errors: errorMessages,
      commands: commands.length,
      exitCode: proc.status,
      signal: proc.signal,
      failureType: failureType || null,
      stderrSummary: proc.stderr?.trim().slice(0, 200) || null,
      spawnErrorMessage: proc.error?.message || null,
      retryCount: attemptCount - 1,
    };
  }

  let attemptCount = 1;
  let attemptStartTime = startTime;
  let proc = runCodexExec(codexBin, model, prompt, cwd, timeoutMs, sandbox, effort);
  let result = finalizeAttempt(proc, attemptStartTime, attemptCount);

  if (!result.success && (result.failureType === 'rate_limit' || result.failureType === 'timeout')) {
    spawnSync('sleep', ['3'], { stdio: 'ignore' });
    attemptCount += 1;
    attemptStartTime = Date.now();
    proc = runCodexExec(codexBin, model, prompt, cwd, timeoutMs, sandbox, effort);
    result = finalizeAttempt(proc, attemptStartTime, attemptCount);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Usage logger
// ---------------------------------------------------------------------------

function loadActiveProfile() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'dual-brain.profile.json'), 'utf8')).active || 'balanced';
  } catch { return 'balanced'; }
}

const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.ppid?.toString() || null;

function logUsageEvent(result, task) {
  const logFile = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const entryObj = {
    schema_version: 4,
    timestamp: new Date().toISOString(),
    provider: 'openai',
    tier: task.tier || 'execute',
    classified_tier: task.classifiedTier || task.tier || 'execute',
    tool: 'codex-exec',
    model: result.model,
    model_override: task.modelOverride || null,
    status: result.success ? 'ok' : 'error',
    durationMs: result.durationMs,
    codex_startup_ms: result.startupMs || null,
    codex_total_ms: result.durationMs,
    input_tokens: result.usage?.input_tokens ?? null,
    output_tokens: result.usage?.output_tokens ?? null,
    session_id: SESSION_ID,
    profile: result.profile || 'balanced',
    dispatcher: 'gpt-work-dispatcher',
  };
  try {
    appendFileSync(logFile, JSON.stringify(entryObj) + '\n');
  } catch {}

  // Update summary checkpoint with codex latency
  import('./summary-checkpoint.mjs').then(({ updateSummary }) => {
    updateSummary(entryObj);
  }).catch(() => {});

  // Record to decision ledger
  import('./decision-ledger.mjs').then(({ recordDecision, recordOutcome }) => {
    const id = recordDecision({
      session_id: SESSION_ID,
      profile: entryObj.profile,
      tier: task.tier || 'execute',
      provider: 'openai',
      model: result.model,
    });
    recordOutcome(id, {
      actual_duration_ms: result.durationMs,
      codex_startup_ms: result.startupMs || null,
      success: result.success,
      actual_input_tokens: result.usage?.input_tokens || null,
      actual_output_tokens: result.usage?.output_tokens || null,
    });
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

function tryHealCodexAuth(codexBin) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return false;
  const pipe = spawnSync(codexBin, ['login', '--with-api-key'], {
    input: apiKey,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  });
  return pipe.status === 0;
}

export async function dispatchGptTask(task) {
  const codexBin = findCodex();
  if (!codexBin) {
    return {
      success: false,
      error: 'Codex CLI not found. Install with: npm i -g @openai/codex && codex login',
    };
  }

  // Pre-flight: check auth and heal if possible
  const loginCheck = spawnSync(codexBin, ['login', 'status'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
  });
  const isAuthed = isCodexAuthenticated(loginCheck);
  if (!isAuthed) {
    const healed = tryHealCodexAuth(codexBin);
    if (!healed) {
      return {
        success: false,
        error: 'Codex not authenticated. Run: npx dual-brain (sign in with your ChatGPT subscription) or codex login --device-auth',
      };
    }
  }

  const config = loadOrchestratorConfig();
  const classifiedTier = classifyGptTier(task);
  const explicitTier = normalizeTier(task.tier);
  const tier = explicitTier || classifiedTier;
  const expectedModel = resolveGptModel(tier, config) || 'gpt-5.4';

  let model = task.model || expectedModel;
  let modelOverride = null;

  if (task.model && !task.forceModel && task.model !== expectedModel) {
    console.warn(`[gpt-work-dispatcher] Warning: task classified as "${tier}", overriding requested model "${task.model}" with "${expectedModel}". Use --force-model to bypass.`);
    model = expectedModel;
    modelOverride = {
      requested: task.model,
      effective: expectedModel,
      forced: false,
      reason: `tier:${tier}`,
    };
  } else if (!task.model) {
    modelOverride = {
      requested: null,
      effective: expectedModel,
      forced: false,
      reason: `auto-select:${tier}`,
    };
  } else if (task.forceModel) {
    modelOverride = {
      requested: task.model,
      effective: task.model,
      forced: true,
      reason: `force-model:${tier}`,
    };
  }

  const preparedTask = {
    ...task,
    tier,
    classifiedTier,
    modelOverride,
  };
  const prompt = buildPrompt(preparedTask);
  const sandbox = GPT_TIER_SANDBOX[tier] || GPT_TIER_SANDBOX.execute;
  const effort = task.effort || null;
  const result = executeCodex(codexBin, model, prompt, task.cwd, task.timeoutMs, sandbox, effort);
  result.tier = tier;
  result.classifiedTier = classifiedTier;
  result.modelOverride = modelOverride;
  result.effort = effort;
  result.sandbox = sandbox;
  result.profile = loadActiveProfile();
  logUsageEvent(result, preparedTask);
  return result;
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        // --key=value form
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        args[key] = value;
      } else {
        // --key value form
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    }
    i++;
  }

  // Normalize known fields
  if (typeof args.files === 'string') {
    args.files = args.files.split(',').map(f => f.trim()).filter(Boolean);
  }
  if (typeof args.constraints === 'string') {
    args.constraints = args.constraints.split(',').map(c => c.trim()).filter(Boolean);
  }
  if (args.timeout !== undefined) {
    args.timeoutMs = Number(args.timeout) * 1000;
    delete args.timeout;
  }
  if (typeof args['force-model'] === 'boolean') {
    args.forceModel = args['force-model'];
    delete args['force-model'];
  }

  return args;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const rawArgs = parseArgs(process.argv.slice(2));

  if (!rawArgs.task) {
    console.error('Usage: node gpt-work-dispatcher.mjs --task "<description>" [--tier think|execute|search] [--model MODEL] [--force-model] [--files file1,file2] [--timeout 120] [--effort low|medium|high|xhigh]');
    process.exit(1);
  }

  const result = await dispatchGptTask(rawArgs);

  if (result.success) {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║         GPT Task Completed                       ║');
    console.log('╠══════════════════════════════════════════════════╣');
    if (result.summary) {
      console.log(result.summary);
    }
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║ Model: ${result.model}  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log('╚══════════════════════════════════════════════════╝');
  } else {
    if (result.failureType) {
      const friendlyMessage = {
        auth: 'Codex not authenticated. Run: codex login --device-auth',
        rate_limit: 'Rate limited by OpenAI. Try again in a few minutes.',
        timeout: 'Codex timed out. Try a simpler task or increase timeout.',
        not_found: 'Codex CLI not found. Run: npm i -g @openai/codex',
        spawn_error: `Failed to start Codex: ${result.spawnErrorMessage || 'unknown spawn error'}`,
      }[result.failureType];

      if (friendlyMessage) {
        console.error(friendlyMessage);
      }
    }
    console.error('Task failed:', result.errors?.join(', ') || result.error);
  }

  // Also output JSON for piping
  process.stdout.write('\n' + JSON.stringify(result) + '\n');
}
