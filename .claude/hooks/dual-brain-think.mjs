#!/usr/bin/env node
/**
 * dual-brain-think.mjs
 *
 * Runs a dual-perspective thinking process — GPT-5.5 (via Codex CLI) independently
 * analyzes a question, then Claude provides its own independent analysis, and both
 * perspectives are synthesized into a final recommendation.
 *
 * Auto mode (default — no --round flag):
 *   Runs the full 2-round collaboration automatically in one command.
 *   node .claude/hooks/dual-brain-think.mjs --question "Should we use Redis?"
 *
 * Manual Round 1:
 *   node .claude/hooks/dual-brain-think.mjs --question "..." --round 1
 *
 * Manual Round 2:
 *   node .claude/hooks/dual-brain-think.mjs --question "..." --round 2 --claude-says "<analysis>"
 *
 * Force manual mode (skip auto):
 *   node .claude/hooks/dual-brain-think.mjs --question "..." --manual
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
const CLAUDE_TIMEOUT_MS = 60_000;
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
// Claude CLI discovery
// ---------------------------------------------------------------------------

function findClaude() {
  try {
    const which = spawnSync('which', ['claude'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  } catch {}
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const fallbacks = [
    join(home, '.local', 'bin', 'claude'),
    join(home, 'bin', 'claude'),
    '/usr/local/bin/claude',
  ];
  for (const p of fallbacks) {
    try {
      const res = spawnSync(p, ['--version'], { stdio: 'pipe', timeout: 3000 });
      if (res.status === 0) return p;
    } catch {}
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
// Claude CLI executor
// ---------------------------------------------------------------------------

function runClaudeAnalysis(claudeBin, question, context) {
  const prompt = `You are providing an independent analysis for a dual-brain architecture discussion. Question: ${question}${context ? `\n\nContext: ${context}` : ''}

Provide:
1) Your recommendation (clear, 1-2 sentences)
2) Key alternatives considered
3) Risks with your recommendation
4) Verification approach

Be concise — under 300 words.`;

  const startTime = Date.now();

  const proc = spawnSync(claudeBin, ['-p', prompt], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: CLAUDE_TIMEOUT_MS,
  });

  const durationMs = Date.now() - startTime;

  if (proc.status === 0 && proc.stdout && proc.stdout.trim()) {
    return {
      success: true,
      text: proc.stdout.trim(),
      durationMs,
    };
  }

  return {
    success: false,
    error: proc.stderr?.slice(0, 200) || 'Claude CLI returned no output',
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Synthesis builder — pattern-based, no AI call
// ---------------------------------------------------------------------------

function buildSynthesis(gptR1Text, claudeText, gptR2Text) {
  const lines = [];

  lines.push('SYNTHESIS');
  lines.push('─'.repeat(50));

  // Extract agreements from GPT Round 2 AGREEMENTS section
  const agreementsMatch = gptR2Text.match(/AGREEMENTS?[:\s\n]+([\s\S]*?)(?=\n\s*(?:PUSHBACK|NEW INSIGHTS|REFINED|REMAINING|CONFIDENCE|[0-9]+\.)|$)/i);
  if (agreementsMatch) {
    lines.push('');
    lines.push('AGREEMENTS (both aligned):');
    lines.push(agreementsMatch[1].trim().split('\n').slice(0, 4).join('\n'));
  }

  // Extract pushback / disagreements from GPT Round 2
  const pushbackMatch = gptR2Text.match(/PUSHBACK[:\s\n]+([\s\S]*?)(?=\n\s*(?:NEW INSIGHTS|REFINED|REMAINING|CONFIDENCE|[0-9]+\.)|$)/i);
  if (pushbackMatch && pushbackMatch[1].trim().length > 10) {
    lines.push('');
    lines.push('DISAGREEMENTS (review carefully):');
    lines.push(pushbackMatch[1].trim().split('\n').slice(0, 4).join('\n'));
  }

  // Extract refined recommendation from GPT Round 2
  const refinedMatch = gptR2Text.match(/REFINED RECOMMENDATION[:\s\n]+([\s\S]*?)(?=\n\s*(?:REMAINING|CONFIDENCE|[0-9]+\.)|$)/i);
  if (refinedMatch) {
    lines.push('');
    lines.push('RECOMMENDED ACTION:');
    lines.push(refinedMatch[1].trim().split('\n').slice(0, 3).join('\n'));
  } else {
    // Fall back to R1 recommendation
    const r1RecMatch = gptR1Text.match(/RECOMMENDATION[:\s\n]+([\s\S]*?)(?=\n\s*(?:RATIONALE|ALTERNATIVES|RISKS|CONFIDENCE|[0-9]+\.)|$)/i);
    if (r1RecMatch) {
      lines.push('');
      lines.push('RECOMMENDED ACTION (from Round 1):');
      lines.push(r1RecMatch[1].trim().split('\n').slice(0, 2).join('\n'));
    }
  }

  // Confidence note
  const confDeltaMatch = gptR2Text.match(/CONFIDENCE DELTA[:\s\n]+([\s\S]*?)(?=\n\s*[0-9]+\.|$)/i);
  if (confDeltaMatch) {
    lines.push('');
    lines.push('CONFIDENCE NOTE:');
    lines.push(confDeltaMatch[1].trim().split('\n').slice(0, 2).join('\n'));
  }

  lines.push('');
  lines.push('─'.repeat(50));

  return lines.join('\n');
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
// Auto mode — full 2-round collaboration in one command
// ---------------------------------------------------------------------------

async function runAutoMode({ question, context, files }) {
  const BAR  = '╠══════════════════════════════════════════════════╣';
  const TOP  = '╔══════════════════════════════════════════════════╗';
  const BOT  = '╚══════════════════════════════════════════════════╝';
  const WIDE = '║';

  const qShort = question.length > 44 ? question.slice(0, 41) + '...' : question;

  console.log(TOP);
  console.log(`${WIDE}  Dual-Brain Think — Auto Mode`.padEnd(51) + WIDE);
  console.log(BAR);
  console.log(`${WIDE} Question: ${qShort.padEnd(38)} ${WIDE}`);
  console.log(BOT);
  console.log('');

  // Step 1: Check Codex
  const codexBin = findCodex();
  if (!codexBin) {
    console.log('[Auto mode] Codex CLI not found — falling back to manual mode.');
    console.log('');
    console.log('Manual steps:');
    console.log(`  1. Run: node hooks/dual-brain-think.mjs --question "${question}" --round 1`);
    console.log(`  2. Analyze independently`);
    console.log(`  3. Run: node hooks/dual-brain-think.mjs --question "${question}" --round 2 --claude-says "<your analysis>"`);
    return;
  }

  try {
    execSync(`${codexBin} login status`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
  } catch {
    console.log('[Auto mode] Codex not authenticated (run `codex login`) — falling back to manual mode.');
    console.log('');
    console.log('Manual steps:');
    console.log(`  1. Run: node hooks/dual-brain-think.mjs --question "${question}" --round 1`);
    console.log(`  2. Analyze independently`);
    console.log(`  3. Run: node hooks/dual-brain-think.mjs --question "${question}" --round 2 --claude-says "<your analysis>"`);
    return;
  }

  // Step 2: Round 1 — GPT analysis
  console.log('[ 1/4 ] Sending to GPT for Round 1 analysis...');
  const r1Prompt = buildGptPrompt({ question, context, files, round: 1 });
  const r1Raw = runGptAnalysis(codexBin, r1Prompt);
  logUsage({ durationMs: r1Raw.durationMs, usage: r1Raw.usage, success: r1Raw.success });

  if (!r1Raw.success) {
    console.log(`[Auto mode] GPT Round 1 failed: ${r1Raw.error}`);
    console.log('Falling back to manual mode — see instructions above.');
    return;
  }

  console.log('');
  console.log(TOP);
  console.log(`${WIDE}  Round 1 — GPT Analysis (${(r1Raw.durationMs / 1000).toFixed(1)}s)`.padEnd(51) + WIDE);
  console.log(BOT);
  console.log('');
  console.log(r1Raw.text);
  console.log('');

  // Step 3: Claude's independent analysis
  const claudeBin = findClaude();
  let claudeText = null;

  if (!claudeBin) {
    console.log('[Auto mode] Claude CLI not found — skipping Claude analysis step.');
    console.log('Set your PATH to include the `claude` binary to enable full auto mode.');
    console.log('');
  } else {
    console.log('[ 2/4 ] Generating Claude independent analysis...');
    const claudeRaw = runClaudeAnalysis(claudeBin, question, context);

    if (!claudeRaw.success) {
      console.log(`[Auto mode] Claude analysis failed: ${claudeRaw.error}`);
      console.log('Continuing with GPT Round 2 without Claude perspective.');
      console.log('');
    } else {
      claudeText = claudeRaw.text;
      console.log('');
      console.log(TOP);
      console.log(`${WIDE}  Claude Independent Analysis (${(claudeRaw.durationMs / 1000).toFixed(1)}s)`.padEnd(51) + WIDE);
      console.log(BOT);
      console.log('');
      console.log(claudeText);
      console.log('');
    }
  }

  // Step 4: Round 2 — GPT rebuttal
  const claudePerspective = claudeText || '(Claude analysis unavailable — review independently)';
  console.log('[ 3/4 ] Sending Round 2 to GPT with Claude perspective...');
  const r2Prompt = buildGptPrompt({ question, context, files, round: 2, claudePerspective });
  const r2Raw = runGptAnalysis(codexBin, r2Prompt);
  logUsage({ durationMs: r2Raw.durationMs, usage: r2Raw.usage, success: r2Raw.success });

  if (!r2Raw.success) {
    console.log(`[Auto mode] GPT Round 2 failed: ${r2Raw.error}`);
    console.log('Synthesis skipped — review Round 1 and Claude analysis above.');
    return;
  }

  console.log('');
  console.log(TOP);
  console.log(`${WIDE}  Round 2 — GPT Rebuttal (${(r2Raw.durationMs / 1000).toFixed(1)}s)`.padEnd(51) + WIDE);
  console.log(BOT);
  console.log('');
  console.log(r2Raw.text);
  console.log('');

  // Step 5: Synthesis
  console.log('[ 4/4 ] Building synthesis...');
  console.log('');
  console.log(TOP);
  console.log(`${WIDE}  Final Synthesis`.padEnd(51) + WIDE);
  console.log(BOT);
  console.log('');
  console.log(buildSynthesis(r1Raw.text, claudeText || '', r2Raw.text));
  console.log('');
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
// CLI output formatter (manual mode)
// ---------------------------------------------------------------------------

function printResult(result, question) {
  const BAR = '╠══════════════════════════════════════════════════╣';
  const TOP = '╔══════════════════════════════════════════════════╗';
  const BOT = '╚══════════════════════════════════════════════════╝';

  const roundLabel = result.round === 2 ? 'Round 2 — Rebuttal' : 'Round 1 — Initial';

  console.log(TOP);
  console.log(`║  Dual-Brain Think · ${roundLabel}`.padEnd(51) + '║');
  console.log(BAR);
  const q = question.length > 44 ? question.slice(0, 41) + '...' : question;
  console.log(`║ Question: ${q.padEnd(38)} ║`);
  console.log(BAR);

  if (!result.gpt) {
    console.log(`║   ${(result.error || 'Unknown error').padEnd(46)} ║`);
    console.log(BAR);
    console.log(`║   ${(result.fallback || '').padEnd(46)} ║`);
    console.log(BOT);
    return;
  }

  const gptData = result.gpt;
  const durSec = (gptData.durationMs / 1000).toFixed(1);
  console.log(`║ GPT-5.5 (${durSec}s):`.padEnd(51) + '║');
  console.log(BAR);
  console.log('');
  console.log(gptData.recommendation || gptData.rebuttal);
  console.log('');
  console.log(BAR);

  if (result.round === 2) {
    console.log('║ Synthesize both rounds into final decision.     ║');
    console.log('║ Where you agree → high confidence.              ║');
    console.log('║ Where you disagree → state what would resolve.  ║');
  } else {
    console.log('║ Your turn: analyze independently, then call     ║');
    console.log('║ Round 2 with --round 2 --claude-says "..."      ║');
    console.log('║ for GPT\'s rebuttal to your analysis.            ║');
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
      '       node dual-brain-think.mjs --question "<question>" --round 2 --claude-says "<analysis>"\n' +
      '       node dual-brain-think.mjs --question "<question>" --manual   (force old 1-step flow)'
    );
    process.exit(1);
  }

  const hasExplicitRound = args.round !== undefined;
  const isManual = args.manual === true || hasExplicitRound;

  if (!isManual) {
    // Auto mode: full 2-round collaboration in one shot
    await runAutoMode({
      question: args.question,
      context: args.context,
      files: args.files,
    });
  } else {
    // Manual mode: original single-round behavior
    const result = await dualThink({
      question: args.question,
      context: args.context,
      files: args.files,
      round: args.round ? parseInt(args.round, 10) : 1,
      claudePerspective: args['claude-says'] || null,
    });

    printResult(result, args.question);
  }
}
