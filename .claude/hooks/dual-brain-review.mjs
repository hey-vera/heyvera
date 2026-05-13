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

import { execSync, spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REVIEW_PROMPT = `Review the current uncommitted changes in this repo for:
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
    '/home/runner/workspace/.config/npm/node_global/bin/codex',
  ];
  for (const c of candidates) {
    if (c) {
      try { execSync(`${c} --version`, { stdio: 'pipe', timeout: 3000 }); return c; } catch {}
    }
  }
  try {
    return execSync('which codex', { encoding: 'utf8', stdio: 'pipe' }).trim() || null;
  } catch {}
  return null;
}

const CODEX_BIN = findCodex();

function runGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { return null; }
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
  const good = ['lgtm', 'looks good', 'no issues', 'no problems', 'no concerns', 'all good', 'clean'];
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
 * Returns review text or null if codex isn't available.
 */
function tryCodexReview(diff) {
  if (!CODEX_BIN) return null;
  try {
    execSync(`${CODEX_BIN} login status`, {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000,
    });
  } catch {
    return null;
  }

  try {
    const model = getThinkModel();
    const truncated = diff.length > MAX_DIFF_CHARS
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n[truncated]'
      : diff;

    const fullPrompt = REVIEW_PROMPT + loadReviewRules();
    const proc = spawnSync(CODEX_BIN, [
      'exec', '--json', '--ephemeral',
      '-c', `model="${model}"`,
      '-s', 'danger-full-access',
      fullPrompt,
    ], {
      input: truncated,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CODEX_TIMEOUT * 1000,
    });
    const result = proc.stdout || '';

    // Parse JSONL output, find agent_message items
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
      return {
        review: agentMessages.join('\n\n'),
        model,
        auth_type: 'codex_subscription',
        issues_found: hasIssues(agentMessages.join(' ')),
        tokens: usage || null,
      };
    }

    // Check for errors
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
async function tryApiReview(diff) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = getThinkModel();
  const truncated = diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + '\n[truncated]'
    : diff;

  const fullPrompt = REVIEW_PROMPT + loadReviewRules();
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

async function main() {
  // 1. Get diff
  let diff = runGit('git diff --staged') || '';
  if (countLines(diff) < MIN_DIFF_LINES) {
    const headDiff = runGit('git diff HEAD') || '';
    if (countLines(headDiff) > countLines(diff)) diff = headDiff;
  }

  // Also gather content of untracked source files
  try {
    const untracked = runGit('git ls-files --others --exclude-standard') || '';
    const sourceExts = /\.(ts|tsx|js|jsx|py|rs|go|java|rb|swift|kt|mjs|cjs)$/;
    const untrackedSrc = untracked.split('\n').filter(f => f && sourceExts.test(f));
    for (const f of untrackedSrc.slice(0, 10)) { // cap at 10 files
      const content = runGit(`git diff --no-index /dev/null "${f}"`);
      if (content) diff += '\n' + content;
    }
  } catch {}

  if (countLines(diff) < MIN_DIFF_LINES) {
    exit({ review: 'No significant changes to review' });
  }

  // 2. Try Codex CLI first (uses ChatGPT subscription)
  const codexResult = tryCodexReview(diff);
  if (codexResult) exit(codexResult);

  // 3. Try direct API
  const apiResult = await tryApiReview(diff);
  if (apiResult) exit(apiResult);

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
