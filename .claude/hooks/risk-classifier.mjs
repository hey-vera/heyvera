#!/usr/bin/env node
/**
 * risk-classifier.mjs — File-path risk classification for adaptive routing.
 *
 * Exports:
 *   classifyRisk(paths)              → { level, reason }           (static, backward-compat)
 *   classifyRiskEnhanced(filePath)   → { risk, basis, details }    (empirical, v4.3.0+)
 *   getGitChurn(filePath, days?)     → { commits, isHot } | null
 *   getFileRiskHistory(filePath)     → { total, failures, success_rate, risk_adjustment }
 *   extractPaths(text)               → string[]
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = join(__dirname, 'decision-ledger.jsonl');

const PATTERNS = [
  { level: 'critical', regex: /\b(auth|credential|secret|\.env|key[s]?|token[s]?|password|encrypt|certificate|cert[s]?|\.pem|\.key)\b/i, label: 'security-sensitive' },
  { level: 'high', regex: /\b(billing|payment|migration|deploy|ci[-/]cd|\.github\/workflows|security|permission|policy|schema\.prisma|schema\.sql|api[-_]?contract|openapi|swagger)\b/i, label: 'high-impact infrastructure' },
  { level: 'medium', regex: /\b(test|spec|\.test\.|\.spec\.|shared|util[s]?|lib\/|public[-_]?api|integrat|config|\.config\.)\b/i, label: 'shared/tested code' },
  { level: 'low', regex: /\b(readme|\.md$|docs?\/|comment|format|lint|\.prettierrc|local[-_]?script|internal[-_]?only|changelog)\b/i, label: 'docs/formatting' },
];

const LEVEL_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };
const LEVEL_UP = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' };

function classifyRisk(paths) {
  if (!paths || paths.length === 0) return { level: 'low', reason: 'no file paths detected' };

  let highest = { level: 'low', reason: 'no matching risk patterns' };

  for (const p of paths) {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(p) && LEVEL_ORDER[pattern.level] > LEVEL_ORDER[highest.level]) {
        highest = { level: pattern.level, reason: `${pattern.label}: ${p}` };
        if (pattern.level === 'critical') return highest;
      }
    }
  }

  return highest;
}

/**
 * Count how many commits touched a file in the last N days using git log.
 * Returns { commits, isHot: commits > 10 }, or null if git is unavailable.
 */
function getGitChurn(filePath, days = 30) {
  try {
    const output = execSync(
      `git log --oneline --since="${days} days ago" -- "${filePath}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    );
    const commits = output.split('\n').filter(Boolean).length;
    return { commits, isHot: commits > 10 };
  } catch {
    return null;
  }
}

/**
 * Read decision-ledger.jsonl and compute success rate for entries that
 * touched this file path or its parent directory.
 *
 * Returns { total, failures, success_rate, risk_adjustment } where
 * risk_adjustment is 'escalate' if success_rate < 60% with 3+ entries,
 * 'normal' otherwise.
 */
function getFileRiskHistory(filePath) {
  const empty = { total: 0, failures: 0, success_rate: 100, risk_adjustment: 'normal' };
  if (!existsSync(LEDGER_FILE)) return empty;

  let raw;
  try { raw = readFileSync(LEDGER_FILE, 'utf8'); } catch { return empty; }

  // Normalize the file path and compute its parent directory prefix
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parentDir = normalizedPath.includes('/') ? normalizedPath.slice(0, normalizedPath.lastIndexOf('/')) : '';

  let total = 0;
  let failures = 0;

  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'outcome') continue;

      const files = entry.files_changed || entry.files_read || [];
      if (!Array.isArray(files)) continue;

      const matches = files.some(f => {
        const nf = String(f).replace(/\\/g, '/');
        return nf === normalizedPath ||
          nf.includes(normalizedPath) ||
          (parentDir && nf.includes(parentDir));
      });

      if (!matches) continue;

      total++;
      if (entry.success === false) failures++;
    } catch {}
  }

  if (total === 0) return empty;

  const success_rate = Math.round(((total - failures) / total) * 100);
  const risk_adjustment = (success_rate < 60 && total >= 3) ? 'escalate' : 'normal';

  return { total, failures, success_rate, risk_adjustment };
}

/**
 * Enhanced risk classifier that combines static patterns with empirical data.
 *
 * Returns { risk, basis, details } where:
 *   risk    — 'low' | 'medium' | 'high' | 'critical'
 *   basis   — 'static' | 'churn' | 'history' | 'churn+history'
 *   details — { static_risk, churn_commits, history_success_rate }
 */
function classifyRiskEnhanced(filePath) {
  // Step 1: static pattern classification
  const staticResult = classifyRisk([filePath]);
  let risk = staticResult.level;
  const details = {
    static_risk: risk,
    churn_commits: null,
    history_success_rate: null,
  };

  let bumpedByChurn = false;
  let bumpedByHistory = false;

  // Step 2: git churn check
  const churn = getGitChurn(filePath);
  if (churn !== null) {
    details.churn_commits = churn.commits;
    if (churn.isHot && risk !== 'critical') {
      risk = LEVEL_UP[risk];
      bumpedByChurn = true;
    }
  }

  // Step 3: file risk history check
  const history = getFileRiskHistory(filePath);
  details.history_success_rate = history.success_rate;
  if (history.risk_adjustment === 'escalate' && risk !== 'critical') {
    risk = LEVEL_UP[risk];
    bumpedByHistory = true;
  }

  // Cap at critical
  if (LEVEL_ORDER[risk] > LEVEL_ORDER['critical']) risk = 'critical';

  let basis = 'static';
  if (bumpedByChurn && bumpedByHistory) basis = 'churn+history';
  else if (bumpedByChurn) basis = 'churn';
  else if (bumpedByHistory) basis = 'history';

  return { risk, basis, details };
}

function extractPaths(text) {
  if (!text) return [];
  const matches = text.match(/(?:^|\s|["'`])([./~]?(?:[\w@.-]+\/)+[\w@.*-]+(?:\.\w+)?)/g);
  if (!matches) return [];
  return matches.map(m => m.trim().replace(/^["'`]/, ''));
}

export { classifyRisk, classifyRiskEnhanced, getGitChurn, getFileRiskHistory, extractPaths };
