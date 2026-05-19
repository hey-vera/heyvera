#!/usr/bin/env node
/**
 * failure-detector.mjs — Detects repeated failure loops for adaptive routing.
 *
 * Exports:
 *   checkFailureLoop(promptHash, tier?) → { isLoop, count, weightedScore, suggestion }
 *   recordFailure(promptHash, tier, reason) → void
 *   pruneOldFailures() → { pruned, remaining }
 */

import { createHash } from 'crypto';
import { readFileSync, appendFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';


const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = join(__dirname, 'decision-ledger.jsonl');

/**
 * Canonical prompt hash used by all hooks for failure-loop correlation.
 * Both enforce-tier (PreToolUse) and cost-logger (PostToolUse) must use this
 * same function so that recorded failures can be matched during escalation.
 *
 * @param {object} toolInput — the raw tool_input from the hook payload
 * @returns {string} 12-char hex hash
 */
function computePromptHash(toolInput) {
  const text = (toolInput?.description || '') + (toolInput?.prompt || '');
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * Compute a decay weight based on failure age.
 * 0-30 min → 1.0, 30-60 min → 0.5, 60-120 min → 0.25, >120 min → 0 (excluded by window)
 */
function decayWeight(timestampMs, now) {
  const ageMs = now - timestampMs;
  const ageMin = ageMs / (60 * 1000);
  if (ageMin <= 30) return 1.0;
  if (ageMin <= 60) return 0.5;
  return 0.25; // 60-120 min
}

function checkFailureLoop(promptHash, tier) {
  if (!promptHash) return { isLoop: false, count: 0, weightedScore: 0, suggestion: null };

  const now = Date.now();
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  let count = 0;
  let weightedScore = 0;
  let lastTier = null;

  try {
    const lines = readFileSync(LEDGER_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.prompt_hash !== promptHash) continue;
        const entryTime = Date.parse(entry.timestamp);
        if (entryTime < twoHoursAgo) continue;
        if (entry.success !== false) continue;
        // If tier is provided, only count matching tiers
        if (tier && entry.tier && entry.tier !== tier) continue;

        count++;
        weightedScore += decayWeight(entryTime, now);
        lastTier = entry.tier;
      } catch {}
    }
  } catch {}

  if (weightedScore < 2.0) return { isLoop: false, count, weightedScore, suggestion: null };

  const suggestion = lastTier === 'execute'
    ? 'promote_tier'
    : 'escalate_to_dual_brain';

  return { isLoop: true, count, weightedScore, suggestion };
}

function recordFailure(promptHash, tier, reason) {
  const entry = JSON.stringify({
    type: 'failure',
    timestamp: new Date().toISOString(),
    prompt_hash: promptHash,
    tier,
    reason: reason || 'unknown',
    success: false,
  });
  try {
    appendFileSync(LEDGER_FILE, entry + '\n');
  } catch {}
}

/**
 * Remove failure entries older than 24 hours from the ledger.
 * Uses atomic write (tmp file + rename) to avoid corruption.
 */
function pruneOldFailures() {
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  let pruned = 0;
  let remaining = 0;
  const kept = [];

  try {
    const lines = readFileSync(LEDGER_FILE, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryTime = Date.parse(entry.timestamp);
        if (entry.type === 'failure' && entryTime < twentyFourHoursAgo) {
          pruned++;
        } else {
          kept.push(line);
          remaining++;
        }
      } catch {
        // Keep unparseable lines to avoid data loss
        kept.push(line);
        remaining++;
      }
    }

    const tmpFile = LEDGER_FILE + `.tmp.${process.pid}`;
    writeFileSync(tmpFile, kept.length > 0 ? kept.join('\n') + '\n' : '');
    renameSync(tmpFile, LEDGER_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try { unlinkSync(LEDGER_FILE + `.tmp.${process.pid}`); } catch {}
    }
    return { pruned: 0, remaining: 0 };
  }

  return { pruned, remaining };
}

export { computePromptHash, checkFailureLoop, recordFailure, pruneOldFailures };
