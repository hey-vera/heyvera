#!/usr/bin/env node
/**
 * dual-brain-think.mjs
 *
 * Runs a dual-perspective thinking process — GPT-5.5 (via Codex CLI) independently
 * analyzes a question, then emits its output along with instructions for Claude
 * (the main session) to provide its own independent analysis and compare both.
 *
 * Usage as CLI:
 *   node .claude/hooks/dual-brain-think.mjs \
 *     --question "Should we use queues or direct API calls for the notification system?"
 *
 * Usage as module:
 *   import { dualThink } from './dual-brain-think.mjs';
 *   const result = await dualThink({
 *     question: "Should we use queues or direct calls?",
 *     context: "Building a notification system that handles ~1000 events/min",
 *     files: ['src/notifications/'],
 *   });
 */

import { execSync, spawnSync } from 'child_process';
import { appendFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CODEX_TIMEOUT_MS = 120_000;
const MODEL = 'gpt-5.5';

// ---------------------------------------------------------------------------
// Codex discovery — same pattern as dual-brain-review.mjs
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

function buildGptPrompt({ question, context, files, round, claudePerspective }) {
  if (round === 2 && claudePerspective) {
    return `You are GPT-5.5 in a collaborative architectural discussion with Claude (Opus).
You gave your initial analysis on a question. Claude has now provided its independent perspective.
This is a professional dialogue — two experts refining a decision together.

Original question: ${question}
${context ? `\nContext: ${context}` : ''}

Claude's perspective:
${claudePerspective}

Now respond as a colleague, not a critic. Structure your response:
1. AGREEMENTS: Where Claude's analysis strengthens or confirms your thinking
2. PUSHBACK: Where you disagree — be specific about WHY with evidence or reasoning
3. NEW INSIGHTS: Anything Claude's perspective surfaced that you missed
4. REFINED RECOMMENDATION: Your updated recommendation incorporating both perspectives
5. REMAINING CONCERNS: Open questions neither of you fully resolved
6. CONFIDENCE DELTA: Has your confidence changed? Why?

Be direct and substantive. If Claude is right about something you got wrong, say so.
If you still disagree after considering their points, explain what specific evidence would change your mind.`;
  }

  return `You are GPT-5.5, providing an independent architectural perspective.
This is Round 1 of a dual-brain analysis — Claude (Opus) will independently analyze the same question,
then send you their perspective for a collaborative discussion in Round 2.

Question: ${question}
${context ? `\nContext: ${context}` : ''}
${files?.length ? `\nRelevant files: ${files.join(', ')}` : ''}

Provide your analysis in this structure:
1. RECOMMENDATION: Your clear recommendation (1-2 sentences)
2. RATIONALE: Why this is the best approach (3-5 points)
3. ALTERNATIVES: What you considered and rejected
4. RISKS: What could go wrong with your recommendation
5. CONFIDENCE: low/medium/high and why
6. VERIFICATION: How to validate this decision is correct`;
}

// ---------------------------------------------------------------------------
// Codex executor
// ---------------------------------------------------------------------------

function runGptAnalysis(codexBin, prompt) {
  const startTime = Date.now();

  const proc = spawnSync(codexBin, [
    'exec', '--json', '--ephemeral',
    '-m', MODEL,
    '-s', 'danger-full-access',
    prompt,
  ], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: CODEX_TIMEOUT_MS,
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

  const usage = messages.find(m => m.type === 'turn.completed')?.usage ?? null;
  const errors = messages.filter(m => m.type === 'error' || m.type === 'turn.failed');

  if (agentMessages.length > 0) {
    return {
      success: true,
      text: agentMessages.join('\n\n'),
      durationMs,
      usage,
    };
  }

  if (errors.length > 0) {
    return {
      success: false,
      error: errors[0].message || errors[0].error?.message || 'unknown codex error',
      durationMs,
      usage: null,
    };
  }

  return {
    success: false,
    error: 'No agent messages returned from Codex',
    durationMs,
    usage: null,
  };
}

// ---------------------------------------------------------------------------
// Usage logger — matches schema_version: 2 used across the orchestrator
// ---------------------------------------------------------------------------

function logUsage({ durationMs, usage, success }) {
  const logFile = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const entry = JSON.stringify({
    schema_version: 2,
    timestamp: new Date().toISOString(),
    provider: 'openai',
    tier: 'think',
    tool: 'dual-brain-think',
    model: MODEL,
    dispatcher: 'dual-brain-think',
    status: success ? 'ok' : 'error',
    durationMs: durationMs ?? null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    session_id: process.env.CLAUDE_SESSION_ID || null,
  });
  try {
    appendFileSync(logFile, entry + '\n');
  } catch {}
}

// ---------------------------------------------------------------------------
// Core exported function
// ---------------------------------------------------------------------------

export async function dualThink({ question, context, files, round, claudePerspective } = {}) {
  if (!question) {
    return {
      gpt: null,
      error: 'No question provided',
      fallback: 'Proceed with single-brain analysis on Claude Opus',
    };
  }

  const effectiveRound = (round === 2 && claudePerspective) ? 2 : 1;

  const codexBin = findCodex();
  if (!codexBin) {
    return {
      gpt: null,
      error: 'Codex CLI not available',
      fallback: 'Proceed with single-brain analysis on Claude Opus',
    };
  }

  try {
    execSync(`${codexBin} login status`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
  } catch {
    return {
      gpt: null,
      error: 'Codex CLI not authenticated — run `codex login`',
      fallback: 'Proceed with single-brain analysis on Claude Opus',
    };
  }

  const prompt = buildGptPrompt({ question, context, files, round: effectiveRound, claudePerspective });
  const raw = runGptAnalysis(codexBin, prompt);

  logUsage({ durationMs: raw.durationMs, usage: raw.usage, success: raw.success });

  if (!raw.success) {
    return {
      gpt: null,
      error: raw.error || 'GPT analysis failed',
      fallback: effectiveRound === 2
        ? 'GPT rebuttal unavailable — synthesize from Round 1 analysis alone'
        : 'Proceed with single-brain analysis on Claude Opus',
    };
  }

  if (effectiveRound === 2) {
    return {
      round: 2,
      gpt: {
        rebuttal: raw.text,
        model: MODEL,
        durationMs: raw.durationMs,
        tokens: raw.usage,
      },
      instructions: `GPT has responded to your analysis. Now synthesize both rounds into a FINAL DECISION:
1. Where you both agree → high confidence, proceed
2. Where GPT pushed back on your points → re-evaluate honestly
3. Where you still disagree → state why and what evidence would resolve it
4. Final recommendation with combined confidence level`,
      question,
    };
  }

  return {
    round: 1,
    gpt: {
      recommendation: raw.text,
      model: MODEL,
      durationMs: raw.durationMs,
      tokens: raw.usage,
    },
    instructions: `Round 1 complete. Now:
1. Provide YOUR independent analysis of the same question (same structure: recommendation, rationale, alternatives, risks, confidence, verification)
2. Then call Round 2 to send your perspective back to GPT:
   node .claude/hooks/dual-brain-think.mjs --question "<same question>" --round 2 --claude-says "<your analysis summary>"
3. GPT will respond to your specific points — agreements, pushback, and refined recommendation
4. You then synthesize both rounds into the final decision`,
    question,
    context: context || null,
  };
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
        args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
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

  // Normalize files to an array
  if (typeof args.files === 'string') {
    args.files = args.files.split(',').map(f => f.trim()).filter(Boolean);
  }

  return args;
}

// ---------------------------------------------------------------------------
// CLI output formatter
// ---------------------------------------------------------------------------

function printResult(result, question) {
  const BAR = '╠══════════════════════════════════════════════════╣';
  const TOP = '╔══════════════════════════════════════════════════╗';
  const BOT = '╚══════════════════════════════════════════════════╝';

  const roundLabel = result.round === 2 ? 'Round 2 — Rebuttal' : 'Round 1 — Initial';

  console.log(TOP);
  console.log(`║  🧠 Dual-Brain Think · ${roundLabel}`.padEnd(51) + '║');
  console.log(BAR);
  const q = question.length > 44 ? question.slice(0, 41) + '...' : question;
  console.log(`║ Question: ${q.padEnd(38)} ║`);
  console.log(BAR);

  if (!result.gpt) {
    console.log(`║ ❌ ${(result.error || 'Unknown error').padEnd(45)} ║`);
    console.log(BAR);
    console.log(`║ ↩️  ${(result.fallback || '').padEnd(45)} ║`);
    console.log(BOT);
    return;
  }

  const gptData = result.gpt;
  const durSec = (gptData.durationMs / 1000).toFixed(1);
  console.log(`║ 🤖 GPT-5.5 (${durSec}s):`.padEnd(51) + '║');
  console.log(BAR);
  console.log('');
  console.log(gptData.recommendation || gptData.rebuttal);
  console.log('');
  console.log(BAR);

  if (result.round === 2) {
    console.log('║ 🔄 Synthesize both rounds into final decision.  ║');
    console.log('║ Where you agree → high confidence.               ║');
    console.log('║ Where you disagree → state what would resolve it.║');
  } else {
    console.log('║ 📝 Your turn: analyze independently, then call   ║');
    console.log('║    Round 2 with --round 2 --claude-says "..."    ║');
    console.log('║    for GPT\'s rebuttal to your analysis.          ║');
  }
  console.log(BOT);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));

  if (!args.question) {
    console.error(
      'Usage: node dual-brain-think.mjs --question "<question>" [--context "<ctx>"] [--files f1,f2]\n' +
      '       node dual-brain-think.mjs --question "<question>" --round 2 --claude-says "<analysis>"'
    );
    process.exit(1);
  }

  const result = await dualThink({
    question: args.question,
    context: args.context,
    files: args.files,
    round: args.round ? parseInt(args.round, 10) : 1,
    claudePerspective: args['claude-says'] || null,
  });

  printResult(result, args.question);
}
