#!/usr/bin/env node
/**
 * risk-classifier.mjs — File-path risk classification for adaptive routing.
 *
 * Export: classifyRisk(paths) → { level, reason }
 */

const PATTERNS = [
  { level: 'critical', regex: /\b(auth|credential|secret|\.env|key[s]?|token[s]?|password|encrypt|certificate|cert[s]?|\.pem|\.key)\b/i, label: 'security-sensitive' },
  { level: 'high', regex: /\b(billing|payment|migration|deploy|ci[-/]cd|\.github\/workflows|security|permission|policy|schema\.prisma|schema\.sql|api[-_]?contract|openapi|swagger)\b/i, label: 'high-impact infrastructure' },
  { level: 'medium', regex: /\b(test|spec|\.test\.|\.spec\.|shared|util[s]?|lib\/|public[-_]?api|integrat|config|\.config\.)\b/i, label: 'shared/tested code' },
  { level: 'low', regex: /\b(readme|\.md$|docs?\/|comment|format|lint|\.prettierrc|local[-_]?script|internal[-_]?only|changelog)\b/i, label: 'docs/formatting' },
];

const LEVEL_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };

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

function extractPaths(text) {
  if (!text) return [];
  const matches = text.match(/(?:^|\s|["'`])([./~]?(?:[\w@.-]+\/)+[\w@.*-]+(?:\.\w+)?)/g);
  if (!matches) return [];
  return matches.map(m => m.trim().replace(/^["'`]/, ''));
}

export { classifyRisk, extractPaths };
