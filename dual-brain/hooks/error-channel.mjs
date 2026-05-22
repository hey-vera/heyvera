/**
 * error-channel.mjs — Lightweight error logger for dual-brain hooks.
 *
 * Exports:
 *   logHookError(hookName, operation, error, context?)  → append to errors.jsonl
 *   getRecentErrors(hours?)                             → array of recent error entries
 */

import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ERROR_FILE = join(__dirname, 'errors.jsonl');

const PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const PRUNE_INTERVAL_MS = 60 * 1000; // 1 minute
let lastPruneCheck = 0;

function maybePrune() {
  const now = Date.now();
  if (now - lastPruneCheck < PRUNE_INTERVAL_MS) return;
  lastPruneCheck = now;

  try {
    const raw = readFileSync(ERROR_FILE, 'utf8');
    const cutoff = now - PRUNE_MAX_AGE_MS;
    const kept = raw.split('\n').filter(line => {
      if (!line) return false;
      try {
        const entry = JSON.parse(line);
        return Date.parse(entry.timestamp) >= cutoff;
      } catch { return true; } // keep unparseable lines
    });
    writeFileSync(ERROR_FILE, kept.length > 0 ? kept.join('\n') + '\n' : '');
  } catch {
    // File doesn't exist or can't be read — nothing to prune
  }
}

export function logHookError(hookName, operation, error, context = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    hook: hookName,
    operation,
    error: error?.message || String(error),
    stack: error?.stack || null,
    context,
  });
  try {
    appendFileSync(ERROR_FILE, entry + '\n');
  } catch {
    // Last resort — can't even log. Silently drop.
  }
  maybePrune();
}

export function getRecentErrors(hours = 24) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  try {
    const raw = readFileSync(ERROR_FILE, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(e => e && Date.parse(e.timestamp) >= cutoff);
  } catch {
    return [];
  }
}
