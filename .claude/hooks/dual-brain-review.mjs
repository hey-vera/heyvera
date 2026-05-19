#!/usr/bin/env node
/**
 * dual-brain-review.mjs
 *
 * Sends git diffs to GPT for independent code review using the Codex CLI
 * (uses your ChatGPT subscription — no API key needed).
 *
 * Falls back to direct OpenAI API if OPENAI_API_KEY is set.
 * Falls back to "no GPT available" if neither works.
 *
 * Usage:  node .claude/hooks/dual-brain-review.mjs
 * Output: JSON to stdout — always valid, never crashes.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPL_SLUG);
const SANDBOX = IS_REPLIT ? 'danger-full-access' : 'read-only';

const REVIEW_PROMPT_R1 = `You are GPT-5.5 performing Round 1 of a dual-brain code review.
Claude (Opus) will independently review the same changes, then send you their findings
for a collaborative Round 2 discussion.

Review the current uncommitted changes for:
1. Correctness — logic errors, off-by-one, null/undefined risks
2. Security — injection, auth bypass, data exposure
3. Edge cases — what could break under unusual input
4. Quality — naming, structure, unnecessary complexity

Required output:
- Findings only, ordered by severity
- File/line references when possible
- Whether tests cover the changed behavior
- Whether the change follows existing repo patterns
- Whether any issue should block merge

Be concise. Flag only real issues, not style preferences. If the code looks good, say "LGTM" and note any minor suggestions. Output your review as plain text, not JSON.`;

const REVIEW_PROMPT_R2 = `You are GPT-5.5 in Round 2 of a collaborative code review with Claude (Opus).
You already reviewed this diff in Round 1. Claude has now independently reviewed the same changes.
This is a professional peer review dialogue — two senior engineers refining their assessment together.

Claude's review findings:
---CLAUDE_REVIEW---

Now respond as a peer reviewer:
1. CONFIRMED: Issues you both found — these are high-confidence findings
2. MISSED: Issues Claude caught that you missed — acknowledge them
3. DISAGREE: Claude's findings you think are false positives — explain why
4. ESCALATED: Issues that are MORE severe than either of you initially rated
5. VERDICT: Combined assessment — LGTM, minor issues, or blocks merge

Be direct. If Claude found something real that you missed, say so.
If Claude flagged something that isn't actually a problem, explain why with evidence.
The goal is the most accurate review, not defending your initial take.`;

function loadReviewRules() {
  const rulesFile = resolve(__dirname, '..', 'review-rules.md');
  try {
    const content = readFileSync(rulesFile, 'utf8').trim();
    if (!content) return '';
    return '\n\nAlso enforce these project-specific rules:\n' + content;
  } catch {
    return '';
  }
}

const MAX_DIFF_CHARS = 15000;
const MIN_DIFF_LINES = 5;
const CODEX_TIMEOUT = 90;

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

const CODEX_BIN = findCodex();

function runGit(args) {
  try {
    const proc = spawnSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return proc.status === 0 ? proc.stdout : null;
  } catch { return null; }
}

function isCodexAuthenticated(result) {
  const out = ((result?.stdout || '') + (result?.stderr || '')).toLowerCase();
  if (/\b(not\s+logged\s+in|unauthenticated|logged\s+out|no\s+auth)\b/.test(out)) return false;
  return result?.status === 0 ||
    /\b(logged\s+in|authenticated|signed\s+in)\b/.test(out);
}

function countLines(str) {
  return (str || '').split('\n').filter(l => l.trim().length > 0).length;
}

function getThinkModel() {
  try {
    const config = JSON.parse(readFileSync(resolve(__dirname, '..', 'orchestrator.json'), 'utf8'));
    const models = config?.subscriptions?.openai?.models ?? {};
    for (const [name, info] of Object.entries(models)) {
      if (info?.tier === 'think') return name;
    }
  } catch {}
  return 'gpt-5.5';
}

function hasIssues(text) {
  const lower = text.toLowerCase();

  // Check for concrete issue indicators first
  const issuePatterns = [
    /\b(bug|crash|vulnerability|incorrect|broken|dangerous|unsafe|injection|leak)\b/i,
    /\bshould\s+(fix|change|update|remove|replace|refactor)\b/i,
    /\bmust\s+(fix|change|update|remove|replace|refactor)\b/i,
    /\b(will\s+break|could\s+break|might\s+break|can\s+crash|could\s+crash)\b/i,
    /\b(missing\s+(check|validation|guard|null|error|handling))\b/i,
    /\b(race\s+condition|deadlock|overflow|underflow|out\s+of\s+bounds)\b/i,
  ];
  const hasIssueIndicators = issuePatterns.some(p => p.test(text));

  // If concrete issues found, always flag — even if "LGTM" also appears
  if (hasIssueIndicators) return true;

  // No concrete issues — check if review explicitly says it's clean
  const good = ['lgtm', 'looks good', 'no issues', 'no problems', 'no concerns', 'all good', 'clean', 'approved', 'ship it', 'ready to merge', 'good to go', 'looks fine', 'no blockers'];
  if (good.some(g => lower.includes(g))) return false;

  // Ambiguous — default to flagging for human review
  return true;
}

function exit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(0);
}

/**
 * Try GPT review via Codex CLI (uses ChatGPT subscription auth).
 * Round 1: independent review. Round 2: respond to Claude's review.
 */
function tryCodexReview(diff, { round = 1, claudeReview = null } = {}) {
  if (!CODEX_BIN) return null;
  const login = spawnSync(CODEX_BIN, ['login', 'status'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
  });
  if (!isCodexAuthenticated(login)) {
    return null;
  }

  try {
    const model = getThinkModel();
    const truncated = diff.length > MAX_DIFF_CHARS
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n[truncated]'
      : diff;

    let basePrompt;
    if (round === 2 && claudeReview) {
      basePrompt = REVIEW_PROMPT_R2.replace('---CLAUDE_REVIEW---', claudeReview);
    } else {
      basePrompt = REVIEW_PROMPT_R1;
    }
    const fullPrompt = basePrompt + loadReviewRules();

    const proc = spawnSync(CODEX_BIN, [
      'exec', '--json', '--ephemeral',
      '-c', `model="${model}"`,
      '-s', SANDBOX,
      fullPrompt,
    ], {
      input: truncated,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CODEX_TIMEOUT * 1000,
    });
    const result = proc.stdout || '';

    const messages = result
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const agentMessages = messages
      .filter(m => m.type === 'item.completed' && m.item?.type === 'agent_message')
      .map(m => m.item.text);

    const usage = messages.find(m => m.type === 'turn.completed')?.usage;

    if (agentMessages.length > 0) {
      const reviewText = agentMessages.join('\n\n');
      return {
        round,
        review: reviewText,
        model,
        auth_type: 'codex_subscription',
        issues_found: hasIssues(reviewText),
        tokens: usage || null,
      };
    }

    const errors = messages.filter(m => m.type === 'error' || m.type === 'turn.failed');
    if (errors.length > 0) {
      return {
        review: `Codex error: ${errors[0].message || errors[0].error?.message || 'unknown'}`,
        error: true,
        auth_type: 'codex_subscription',
      };
    }

    return null;
  } catch (err) {
    return {
      review: `Codex exec failed: ${err.message?.slice(0, 200) || 'unknown error'}`,
      error: true,
      auth_type: 'codex_subscription',
    };
  }
}

/**
 * Try GPT review via direct API call (needs OPENAI_API_KEY).
 */
async function tryApiReview(diff, { round = 1, claudeReview = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = getThinkModel();
  const truncated = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + '\n[truncated]'
    : diff;

  let basePrompt;
  if (round === 2 && claudeReview) {
    basePrompt = REVIEW_PROMPT_R2.replace('---CLAUDE_REVIEW---', claudeReview);
  } else {
    basePrompt = REVIEW_PROMPT_R1;
  }
  const fullPrompt = basePrompt + loadReviewRules();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: fullPrompt },
          { role: 'user', content: `Review this diff:\n\n\`\`\`diff\n${truncated}\n\`\`\`` },
        ],
        temperature: 0,
        max_tokens: 1000,
      }),
    });

    clearTimeout(timer);
    if (!response.ok) return null;

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (!text) return null;

    return {
      round,
      review: text,
      model,
      auth_type: 'api_key',
      issues_found: hasIssues(text),
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

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
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const round = args.round ? parseInt(args.round, 10) : 1;
  const claudeReview = args['claude-review'] || null;
  const opts = { round, claudeReview };

  // 1. Get diff
  let diff = runGit(['diff', '--staged']) || '';
  if (countLines(diff) < MIN_DIFF_LINES) {
    const headDiff = runGit(['diff', 'HEAD']) || '';
    if (countLines(headDiff) > countLines(diff)) diff = headDiff;
  }

  try {
    const untracked = runGit(['ls-files', '--others', '--exclude-standard']) || '';
    const sourceExts = /\.(ts|tsx|js|jsx|py|rs|go|java|rb|swift|kt|mjs|cjs)$/;
    const untrackedSrc = untracked.split('\n').filter(f => f && sourceExts.test(f));
    for (const f of untrackedSrc.slice(0, 10)) {
      const content = runGit(['diff', '--no-index', '/dev/null', f]);
      if (content) diff += '\n' + content;
    }
  } catch {}

  if (countLines(diff) < MIN_DIFF_LINES) {
    exit({ review: 'No significant changes to review' });
  }

  // 2. Try Codex CLI first
  const codexResult = tryCodexReview(diff, opts);
  if (codexResult) {
    if (round === 1) {
      codexResult.instructions = `Round 1 complete. Now:
1. Provide YOUR independent code review of the same changes
2. Then call Round 2 to send your findings back to GPT:
   node .claude/hooks/dual-brain-review.mjs --round 2 --claude-review "<your findings>"
3. GPT will respond — confirming shared findings, acknowledging misses, and pushing back on false positives
4. You then synthesize both rounds into the final review verdict`;
    } else {
      codexResult.instructions = `GPT has responded to your review. Synthesize into a FINAL REVIEW:
- CONFIRMED findings (both found) → high confidence, must fix
- GPT-only findings you agree with → add to your list
- Your findings GPT disputed → re-evaluate honestly
- Final verdict: LGTM, minor issues, or blocks merge`;
    }
    exit(codexResult);
  }

  // 3. Try direct API
  const apiResult = await tryApiReview(diff, opts);
  if (apiResult) {
    if (round === 1) {
      apiResult.instructions = `Round 1 complete. Provide YOUR independent review, then call Round 2 with --round 2 --claude-review "<findings>"`;
    } else {
      apiResult.instructions = `Synthesize both rounds into a final review verdict.`;
    }
    exit(apiResult);
  }

  // 4. No GPT available
  exit({
    review: 'No GPT review available. Install Codex CLI and login with your ChatGPT subscription, or set OPENAI_API_KEY.',
    skip_reason: 'no_gpt_auth',
  });
}

main().catch(err => {
  process.stdout.write(
    JSON.stringify({ review: `Unexpected error: ${err?.message ?? String(err)}`, error: true }) + '\n'
  );
  process.exit(0);
});
