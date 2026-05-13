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
 *     --model gpt-5.4 \
 *     --files hooks/budget-balancer.mjs
 *
 * Usage as module:
 *   import { dispatchGptTask } from './gpt-work-dispatcher.mjs';
 *   const result = await dispatchGptTask({ task, model, files, constraints, timeoutMs });
 */

import { execSync, spawnSync } from 'child_process';
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(task) {
  let prompt = `You are a GPT execution agent inside the Dual-Brain Orchestrator.

Task: ${task.task}

Own this task completely. Edit files directly.

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

function executeCodex(codexBin, model, prompt, cwd, timeoutMs) {
  const startTime = Date.now();

  const proc = spawnSync(codexBin, [
    'exec', '--json', '--ephemeral',
    '-m', model,
    '-s', 'danger-full-access',
    prompt,
  ], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs || 120000,
    cwd: cwd || process.cwd(),
  });

  const durationMs = Date.now() - startTime;

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

  // Detect changed files from command_execution items
  const commands = messages
    .filter(m => m.type === 'item.completed' && m.item?.type === 'command_execution')
    .map(m => m.item);

  return {
    success: proc.status === 0 && errors.length === 0,
    summary: agentMessages.join('\n\n'),
    durationMs,
    model,
    usage: usage || null,
    errors: errors.map(e => e.message || e.error?.message || 'unknown'),
    commands: commands.length,
    exitCode: proc.status,
    signal: proc.signal,
  };
}

// ---------------------------------------------------------------------------
// Usage logger
// ---------------------------------------------------------------------------

function logUsageEvent(result, task) {
  const logFile = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const entry = JSON.stringify({
    schema_version: 2,
    timestamp: new Date().toISOString(),
    provider: 'openai',
    tier: task.tier || 'execute',
    tool: 'codex-exec',
    model: result.model,
    status: result.success ? 'ok' : 'error',
    durationMs: result.durationMs,
    input_tokens: result.usage?.input_tokens ?? null,
    output_tokens: result.usage?.output_tokens ?? null,
    session_id: process.env.CLAUDE_SESSION_ID || null,
    dispatcher: 'gpt-work-dispatcher',
  });
  try {
    appendFileSync(logFile, entry + '\n');
  } catch {}
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function dispatchGptTask(task) {
  const codexBin = findCodex();
  if (!codexBin) {
    return {
      success: false,
      error: 'Codex CLI not found. Install with: npm i -g @openai/codex && codex login',
    };
  }

  const model = task.model || 'gpt-5.4';
  const prompt = buildPrompt(task);
  const result = executeCodex(codexBin, model, prompt, task.cwd, task.timeoutMs);
  logUsageEvent(result, task);
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

  return args;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const rawArgs = parseArgs(process.argv.slice(2));

  if (!rawArgs.task) {
    console.error('Usage: node gpt-work-dispatcher.mjs --task "<description>" [--model gpt-5.4] [--files file1,file2] [--timeout 120]');
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
    console.error('Task failed:', result.errors?.join(', ') || result.error);
  }

  // Also output JSON for piping
  process.stdout.write('\n' + JSON.stringify(result) + '\n');
}
