#!/usr/bin/env node
/**
 * summary-checkpoint.mjs — Fast derived state for the hot path.
 *
 * Maintains a summary file (usage-summary-YYYY-MM-DD.json) that hooks
 * can read in O(1) instead of scanning the full JSONL log.
 *
 * The summary is rebuilt from JSONL truth if missing or corrupt.
 *
 * Exported API:
 *   readSummary(date?)           → current summary object
 *   updateSummary(newEntry)      → incrementally update summary with one entry
 *   rebuildSummary(date?)        → full rebuild from JSONL
 *   getRecentPromptHashes()      → last 10min of prompt hashes (for dupe detection)
 *   getPressureBuckets()         → provider/tier call counts for rolling window
 *   getTokenAverages()           → moving averages of actual tokens by tier
 */

import { execSync as _execSync } from 'child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function summaryPath(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-summary-${d}.json`);
}

function usagePath(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-${d}.jsonl`);
}

function emptySummary() {
  return {
    version: 1,
    date: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
    last_offset: 0,

    totals: {
      calls: 0,
      cost_estimate: 0,
      by_tier: {},
      by_provider: {},
      by_model: {},
    },

    pressure: {
      claude: { think: [], execute: [], search: [] },
      openai: { think: [], execute: [], search: [] },
    },

    recent_hashes: [],

    token_averages: {},

    codex_latencies: [],

    session_insights: {
      gpt_latency_status: 'normal',
      provider_override_count: 0,
      failure_domains: [],
      dual_brain_useful: false,
      balance_posture: 'no activity yet',
    },

    // Session handoff fields — enriched checkpoint for cross-session continuity
    session_handoff: {
      gate_passed: [],              // completed milestones/tasks this session
      evidence: [],                 // concrete evidence: commit hashes, file paths, PR URLs
      pickup_prompt: 'none recorded', // one-sentence continuation prompt
      friction: [],                 // problems encountered during the session
      cross_workstream_patterns: [], // generalizable lessons beyond this task
    },
  };
}

const COST_PER_CALL = { search: 0.003, execute: 0.012, think: 0.055 };

function atomicWrite(path, data) {
  const tmp = path + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

function readSummary(date) {
  const path = summaryPath(date);
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.version === 1) return data;
  } catch {}
  return rebuildSummary(date);
}

function rebuildSummary(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  const logPath = usagePath(d);
  const summary = emptySummary();
  summary.date = d;

  if (!existsSync(logPath)) {
    atomicWrite(summaryPath(d), summary);
    return summary;
  }

  let raw;
  try { raw = readFileSync(logPath, 'utf8'); } catch { return summary; }

  const lines = raw.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      applyEntry(summary, entry);
    } catch {}
  }

  summary.last_offset = Buffer.byteLength(raw, 'utf8');
  summary.updated_at = new Date().toISOString();
  atomicWrite(summaryPath(d), summary);
  return summary;
}

function applyEntry(summary, entry) {
  const tier = entry.tier || 'execute';
  const provider = entry.provider || 'claude';
  const model = entry.model || 'unknown';
  const cost = COST_PER_CALL[tier] || COST_PER_CALL.execute;

  summary.totals.calls++;
  summary.totals.cost_estimate += cost;

  summary.totals.by_tier[tier] = (summary.totals.by_tier[tier] || 0) + 1;
  summary.totals.by_provider[provider] = (summary.totals.by_provider[provider] || 0) + 1;
  summary.totals.by_model[model] = (summary.totals.by_model[model] || 0) + 1;

  // Pressure: store timestamps for rolling window lookups
  const ts = entry.timestamp || new Date().toISOString();
  if (summary.pressure[provider]?.[tier]) {
    summary.pressure[provider][tier].push(ts);
    // Keep only last 5 hours of timestamps to bound size
    const cutoff = Date.now() - 5 * 60 * 60 * 1000;
    summary.pressure[provider][tier] = summary.pressure[provider][tier].filter(
      t => Date.parse(t) >= cutoff
    );
  }

  // Recent prompt hashes (for duplicate detection)
  if (entry.type === 'tier_recommendation' && entry.prompt_hash) {
    summary.recent_hashes.push({ hash: entry.prompt_hash, ts });
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    summary.recent_hashes = summary.recent_hashes.filter(
      h => Date.parse(h.ts) >= tenMinAgo
    );
  }

  // Token moving averages
  if (entry.input_tokens != null && entry.output_tokens != null) {
    const key = `${provider}:${tier}`;
    if (!summary.token_averages[key]) {
      summary.token_averages[key] = { count: 0, avg_input: 0, avg_output: 0 };
    }
    const avg = summary.token_averages[key];
    avg.count++;
    avg.avg_input += (entry.input_tokens - avg.avg_input) / avg.count;
    avg.avg_output += (entry.output_tokens - avg.avg_output) / avg.count;
  }

  // Session handoff: auto-populate from entry metadata
  if (!summary.session_handoff) {
    summary.session_handoff = {
      gate_passed: [], evidence: [], pickup_prompt: 'none recorded',
      friction: [], cross_workstream_patterns: [],
    };
  }

  // Track completed gates/milestones from quality-gate or review results
  if (entry.type === 'gate_result' && entry.gate === 'pass') {
    summary.session_handoff.gate_passed.push({
      what: entry.reason || 'quality gate passed',
      ts,
    });
  }

  // Track evidence: file paths from execute-tier entries, commit hashes, PR URLs
  if (tier === 'execute' && entry.files_changed) {
    const files = Array.isArray(entry.files_changed) ? entry.files_changed : [entry.files_changed];
    for (const f of files) {
      if (!summary.session_handoff.evidence.includes(f)) {
        summary.session_handoff.evidence.push(f);
      }
    }
  }
  if (entry.commit_hash) {
    const ref = `commit:${entry.commit_hash}`;
    if (!summary.session_handoff.evidence.includes(ref)) {
      summary.session_handoff.evidence.push(ref);
    }
  }
  if (entry.pr_url) {
    if (!summary.session_handoff.evidence.includes(entry.pr_url)) {
      summary.session_handoff.evidence.push(entry.pr_url);
    }
  }

  // Track friction: failures, escalations, retries
  if (entry.type === 'failure' || entry.escalated || entry.retry) {
    summary.session_handoff.friction.push({
      what: entry.error || entry.reason || 'unknown failure',
      tier,
      provider,
      ts,
    });
    // Keep friction list bounded
    if (summary.session_handoff.friction.length > 50) {
      summary.session_handoff.friction = summary.session_handoff.friction.slice(-50);
    }
  }

  // Codex latencies
  if (entry.codex_startup_ms != null) {
    summary.codex_latencies.push({
      startup_ms: entry.codex_startup_ms,
      total_ms: entry.codex_total_ms || null,
      model: model,
      ts,
    });
    // Keep last 50
    if (summary.codex_latencies.length > 50) {
      summary.codex_latencies = summary.codex_latencies.slice(-50);
    }
  }
}

function updateSummary(newEntry, date) {
  const summary = readSummary(date);
  applyEntry(summary, newEntry);
  summary.updated_at = new Date().toISOString();
  atomicWrite(summaryPath(date), summary);
  return summary;
}

function getRecentPromptHashes(date) {
  const summary = readSummary(date);
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  return summary.recent_hashes.filter(h => Date.parse(h.ts) >= tenMinAgo);
}

function getPressureBuckets(date) {
  const summary = readSummary(date);
  const cutoff = Date.now() - 5 * 60 * 60 * 1000;
  const result = {};

  for (const provider of ['claude', 'openai']) {
    result[provider] = {};
    for (const tier of ['think', 'execute', 'search']) {
      const timestamps = summary.pressure[provider]?.[tier] || [];
      result[provider][tier] = timestamps.filter(t => Date.parse(t) >= cutoff).length;
    }
  }
  return result;
}

function getTokenAverages(date) {
  const summary = readSummary(date);
  return summary.token_averages;
}

function updateSessionInsight(key, value, date) {
  const validKeys = ['gpt_latency_status', 'provider_override_count', 'failure_domains', 'dual_brain_useful', 'balance_posture'];
  if (!validKeys.includes(key)) return;
  const summary = readSummary(date);
  if (!summary.session_insights) summary.session_insights = {};
  summary.session_insights[key] = value;
  summary.updated_at = new Date().toISOString();
  atomicWrite(summaryPath(date), summary);
}

function getAdaptiveCodexThreshold(date) {
  const summary = readSummary(date);
  const latencies = summary.codex_latencies || [];
  if (latencies.length < 5) return { threshold_ms: 180_000, confidence: 'low', samples: latencies.length };

  const startups = latencies.map(l => l.startup_ms).filter(Boolean).sort((a, b) => a - b);
  if (startups.length < 3) return { threshold_ms: 180_000, confidence: 'low', samples: startups.length };

  const p75idx = Math.floor(startups.length * 0.75);
  const p75 = startups[p75idx];
  const threshold = Math.max(90_000, p75 * 4);

  return {
    threshold_ms: Math.round(threshold),
    p75_startup_ms: Math.round(p75),
    confidence: startups.length >= 20 ? 'high' : 'medium',
    samples: startups.length,
  };
}

/**
 * Update a specific session handoff field.
 * Valid keys: gate_passed, evidence, pickup_prompt, friction, cross_workstream_patterns
 *
 * For array fields, `value` is appended (string or object).
 * For pickup_prompt, `value` replaces the current string.
 */
function updateHandoff(key, value, date) {
  const arrayFields = ['gate_passed', 'evidence', 'friction', 'cross_workstream_patterns'];
  const validKeys = [...arrayFields, 'pickup_prompt'];
  if (!validKeys.includes(key)) return;

  const summary = readSummary(date);
  if (!summary.session_handoff) {
    summary.session_handoff = {
      gate_passed: [], evidence: [], pickup_prompt: 'none recorded',
      friction: [], cross_workstream_patterns: [],
    };
  }

  if (key === 'pickup_prompt') {
    summary.session_handoff.pickup_prompt = String(value);
  } else if (arrayFields.includes(key)) {
    if (!Array.isArray(summary.session_handoff[key])) {
      summary.session_handoff[key] = [];
    }
    summary.session_handoff[key].push(value);
  }

  summary.updated_at = new Date().toISOString();
  atomicWrite(summaryPath(date), summary);
  return summary;
}

/**
 * Generate a full session checkpoint for handoff.
 *
 * Auto-enriches evidence from git state (changed files, HEAD commit)
 * and builds a pickup prompt if none was set manually.
 */
function generateCheckpoint(date) {
  const summary = readSummary(date);

  if (!summary.session_handoff) {
    summary.session_handoff = {
      gate_passed: [], evidence: [], pickup_prompt: 'none recorded',
      friction: [], cross_workstream_patterns: [],
    };
  }

  const handoff = summary.session_handoff;

  // Auto-enrich evidence from git if available
  try {
    // Current HEAD commit
    const head = _execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    if (head) {
      const ref = `commit:${head}`;
      if (!handoff.evidence.includes(ref)) {
        handoff.evidence.push(ref);
      }
    }

    // Changed files in working tree
    const diff = _execSync('git diff --name-only HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    if (diff) {
      for (const f of diff.split('\n').filter(Boolean)) {
        const ref = `changed:${f}`;
        if (!handoff.evidence.includes(ref)) {
          handoff.evidence.push(ref);
        }
      }
    }

    // Current branch
    const branch = _execSync('git branch --show-current 2>/dev/null', { encoding: 'utf8' }).trim();
    if (branch) {
      handoff.evidence.push(`branch:${branch}`);
    }
  } catch {
    // Git not available — skip enrichment
  }

  // Auto-generate pickup_prompt if not manually set
  if (handoff.pickup_prompt === 'none recorded' && summary.totals.calls > 0) {
    const topTier = Object.entries(summary.totals.by_tier)
      .sort(([, a], [, b]) => b - a)[0];
    const tierLabel = topTier ? topTier[0] : 'mixed';
    const fileCount = handoff.evidence.filter(e => e.startsWith('changed:')).length;
    const frictionCount = handoff.friction.length;

    let prompt = `Session had ${summary.totals.calls} calls (mostly ${tierLabel})`;
    if (fileCount > 0) prompt += `, ${fileCount} files modified`;
    if (frictionCount > 0) prompt += `, ${frictionCount} friction points to review`;
    prompt += '.';
    handoff.pickup_prompt = prompt;
  }

  // Build the checkpoint object
  const checkpoint = {
    version: 1,
    generated_at: new Date().toISOString(),
    date: summary.date,

    // Existing summary data
    totals: summary.totals,
    session_insights: summary.session_insights,

    // New handoff fields
    gate_passed: handoff.gate_passed,
    evidence: handoff.evidence,
    pickup_prompt: handoff.pickup_prompt,
    friction: handoff.friction,
    cross_workstream_patterns: handoff.cross_workstream_patterns,
  };

  return checkpoint;
}

export {
  readSummary,
  updateSummary,
  rebuildSummary,
  getRecentPromptHashes,
  getPressureBuckets,
  getTokenAverages,
  getAdaptiveCodexThreshold,
  updateSessionInsight,
  updateHandoff,
  generateCheckpoint,
  atomicWrite,
};
