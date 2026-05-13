#!/usr/bin/env node
/**
 * quality-gate.mjs — Config-driven quality gate for the dual-brain orchestrator.
 *
 * Usage:  node .claude/hooks/quality-gate.mjs
 * Output: Always valid JSON to stdout, always exits 0.
 *
 * Logic:
 *  1. Read orchestrator.json → quality_gate config
 *  2. If disabled, output { "gate": "disabled" } and exit
 *  3. Get changed files via `git diff --name-only HEAD` + `git ls-files --others --exclude-standard`
 *  4. Filter by trigger_extensions, exclude skip_patterns
 *  5. If no qualifying files → { "gate": "pass", "reason": "no qualifying code changes" }
 *  6. Otherwise run dual-brain-review.mjs, save result to .claude/reviews/<timestamp>.json
 *  7. Output { "gate": "reviewed", "files": [...], "issues_found": bool, "review_path": "..." }
 */

import { createHash } from 'crypto';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_CONFIG = resolve(__dirname, '..', 'orchestrator.json');
const REVIEWS_DIR = resolve(__dirname, '..', 'reviews');
const DUAL_BRAIN = resolve(__dirname, 'dual-brain-review.mjs');

function exit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(0);
}

function runGit(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

function scoreSensitivity(files, config) {
  const sensitivePaths = config?.dual_thinking?.sensitive_paths || [
    'auth', 'security', 'middleware/auth', 'payment', 'billing',
    'migration', 'schema', 'permissions', 'secrets', 'crypto',
    'api/public', '.env'
  ];

  let score = 0;
  const reasons = [];

  for (const file of files) {
    const lower = file.toLowerCase();

    // Check sensitive paths
    for (const sp of sensitivePaths) {
      if (lower.includes(sp)) {
        score += 30;
        reasons.push(`sensitive path: ${sp} in ${file}`);
        break;
      }
    }

    // Database/migration files
    if (/migrat|schema|\.sql/i.test(lower)) {
      score += 25;
      reasons.push(`database change: ${file}`);
    }

    // Config/env files
    if (/\.env|config.*\.(ts|js|json)|docker|ci|\.yml|\.yaml/i.test(lower)) {
      score += 15;
      reasons.push(`config/infra change: ${file}`);
    }

    // Dependency changes
    if (/package\.json|requirements\.txt|go\.mod|Cargo\.toml/i.test(lower)) {
      score += 20;
      reasons.push(`dependency change: ${file}`);
    }
  }

  // Scale by number of files
  if (files.length > 10) {
    score += 15;
    reasons.push(`large changeset: ${files.length} files`);
  }

  // Determine risk level
  let risk, gate;
  if (score >= 50) {
    risk = 'critical';
    gate = 'dual-brain-required';
  } else if (score >= 30) {
    risk = 'high';
    gate = 'dual-brain-recommended';
  } else if (score >= 10) {
    risk = 'medium';
    gate = 'single-review';
  } else {
    risk = 'low';
    gate = 'self-check';
  }

  return { score, risk, gate, reasons };
}

function matchesSkipPattern(filePath, patterns) {
  const segments = filePath.split('/');
  const basename = segments[segments.length - 1];
  return patterns.some(p => {
    if (p.startsWith('.')) return basename.endsWith(p);  // extension match
    return segments.some(seg => seg === p || seg.startsWith(p + '.'));  // exact segment match
  });
}

function getChangedFiles() {
  const tracked = runGit('git diff --name-only HEAD') || '';
  const untracked = runGit('git ls-files --others --exclude-standard') || '';
  const all = [...new Set([
    ...tracked.split('\n').filter(Boolean),
    ...untracked.split('\n').filter(Boolean),
  ])];
  return all;
}

function main() {
  // 1. Load config
  let config;
  try {
    config = JSON.parse(readFileSync(ORCHESTRATOR_CONFIG, 'utf8'));
  } catch {
    exit({ gate: 'pass', reason: 'orchestrator.json not found or invalid' });
  }

  const gate = config?.quality_gate ?? {};

  // 2. Check enabled flag
  if (gate.enabled === false) {
    exit({ gate: 'disabled' });
  }

  const triggerExtensions = gate.trigger_extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.py'];
  const skipPatterns = gate.skip_patterns ?? ['test', '__tests__', 'spec', '.md'];

  // 3. Get changed files (tracked diffs + untracked new files)
  const allFiles = getChangedFiles();

  // 4. Filter files
  const qualifyingFiles = allFiles.filter(f => {
    const ext = extname(f);
    if (!triggerExtensions.includes(ext)) return false;
    if (matchesSkipPattern(f, skipPatterns)) return false;
    return true;
  });

  // 5. No qualifying files
  if (qualifyingFiles.length === 0) {
    exit({ gate: 'pass', reason: 'no qualifying code changes' });
  }

  // 5a. Score sensitivity BEFORE running any external review
  const sensitivity = scoreSensitivity(qualifyingFiles, config);

  // 5b. Low risk — skip GPT review entirely
  if (sensitivity.gate === 'self-check') {
    exit({
      gate: 'pass',
      risk: 'low',
      sensitivity_score: sensitivity.score,
      sensitivity_reasons: sensitivity.reasons,
      reason: 'low sensitivity — self-check only',
      files: qualifyingFiles,
    });
  }

  // 6. Run dual-brain review (medium / high / critical)
  let reviewResult = {};
  try {
    const proc = spawnSync(process.execPath, [DUAL_BRAIN], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const stdout = (proc.stdout || '').trim();
    if (stdout) {
      reviewResult = JSON.parse(stdout);
    } else {
      reviewResult = {
        review: 'dual-brain-review produced no output',
        error: true,
      };
    }
  } catch (err) {
    reviewResult = {
      review: `Failed to run dual-brain-review: ${err?.message ?? String(err)}`,
      error: true,
    };
  }

  // Compute diff hash
  const diff = runGit('git diff HEAD');
  const diffHash = createHash('sha256').update(diff).digest('hex').slice(0, 8);

  // Build review record (includes sensitivity info)
  const timestamp = new Date().toISOString();
  const record = {
    timestamp,
    files_changed: qualifyingFiles,
    diff_hash: diffHash,
    risk: sensitivity.risk,
    sensitivity_score: sensitivity.score,
    sensitivity_reasons: sensitivity.reasons,
    model: reviewResult.model ?? 'unknown',
    review: reviewResult.review ?? '',
    issues_found: reviewResult.issues_found ?? false,
  };

  // 7. Save to .claude/reviews/<timestamp>.json
  mkdirSync(REVIEWS_DIR, { recursive: true });
  const safeTs = timestamp.replace(/[:.]/g, '-');
  const reviewFile = join(REVIEWS_DIR, `${safeTs}.json`);
  try {
    writeFileSync(reviewFile, JSON.stringify(record, null, 2) + '\n', 'utf8');
  } catch {
    // Non-fatal: still output summary
  }

  // 8. Determine gate status from review result + sensitivity tier
  const reviewUnavailable =
    reviewResult.skip_reason === 'no_gpt_auth' ||
    reviewResult.error === true ||
    !reviewResult.review;

  let gateStatus;
  if (sensitivity.gate === 'dual-brain-required') {
    // Critical: always flag for dual-brain + user attention regardless of review outcome
    gateStatus = 'needs_dual_think';
  } else if (reviewUnavailable) {
    gateStatus = 'needs_human_review';
  } else if (reviewResult.issues_found) {
    gateStatus = 'issues_found';
  } else {
    gateStatus = sensitivity.gate === 'dual-brain-recommended' ? 'reviewed' : 'pass';
  }

  // 9. Build output object — common fields first
  const output = {
    gate: gateStatus,
    risk: sensitivity.risk,
    sensitivity_score: sensitivity.score,
    sensitivity_reasons: sensitivity.reasons,
    files: qualifyingFiles,
    issues_found: Boolean(reviewResult.issues_found),
    review_unavailable: reviewUnavailable,
    review_path: reviewFile,
    model: reviewResult.model || null,
    auth_type: reviewResult.auth_type || null,
  };

  // High risk: recommend dual-brain-think in addition
  if (sensitivity.gate === 'dual-brain-recommended') {
    output.dual_thinking_recommended = true;
  }

  // Critical risk: add strong warning
  if (sensitivity.gate === 'dual-brain-required') {
    output.warning =
      'Critical sensitivity detected. Dual-brain review + explicit user approval strongly recommended before merging.';
    output.reasons = sensitivity.reasons;
  }

  exit(output);
}

try {
  main();
} catch (err) {
  process.stdout.write(
    JSON.stringify({ gate: 'error', error: err?.message ?? String(err) }) + '\n'
  );
  process.exit(0);
}
