#!/usr/bin/env node
/**
 * vibe-memory.mjs — Durable preference and context memory for vibe coding.
 *
 * Persists user workflow preferences, risk tolerance, and active work context
 * across sessions. Loaded by control-panel and routing hooks.
 *
 * Exports:
 *   loadMemory() → memory object
 *   updateMemory(key, value) → void
 *   recordSessionEnd(summary) → void
 *   getActiveThreads() → array of recent work threads
 *   inferPreferences() → { suggestions, confidence }
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_FILE = join(__dirname, '..', 'dual-brain.memory.json');

const EMPTY_MEMORY = {
  schema_version: 1,
  preferences: {
    default_profile: null,
    risk_tolerance: 'normal',
    verbosity: 'normal',
    auto_dual_brain: true,
    preferred_provider: null,
  },
  threads: [],
  insights: {
    total_sessions: 0,
    profile_switches: {},
    common_risk_domains: [],
    dual_brain_useful_rate: null,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function atomicWrite(path, data) {
  const tmp = path + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

function deepMerge(defaults, override) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (override[key] === undefined) continue;
    if (
      defaults[key] !== null &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key]) &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      override[key] !== null
    ) {
      result[key] = deepMerge(defaults[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  // Preserve any extra keys from override not in defaults
  for (const key of Object.keys(override)) {
    if (!(key in defaults)) {
      result[key] = override[key];
    }
  }
  return result;
}

function setNestedKey(obj, dotPath, value) {
  const parts = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function threadId(summary) {
  return createHash('sha256').update(summary).digest('hex').slice(0, 16);
}

// ─── Core API ─────────────────────────────────────────────────────────────

function loadMemory() {
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    // File missing or corrupt — start fresh
  }
  return deepMerge(EMPTY_MEMORY, stored);
}

function updateMemory(key, value) {
  const memory = loadMemory();
  setNestedKey(memory, key, value);
  atomicWrite(MEMORY_FILE, memory);
}

function recordSessionEnd(summary) {
  const memory = loadMemory();

  // Increment total sessions
  memory.insights.total_sessions++;

  // Track profile used
  let profileUsed = 'auto';
  try {
    const profileFile = join(__dirname, '..', 'dual-brain.profile.json');
    const profileData = JSON.parse(readFileSync(profileFile, 'utf8'));
    profileUsed = profileData.active || 'auto';
  } catch {}

  if (!memory.insights.profile_switches) memory.insights.profile_switches = {};
  memory.insights.profile_switches[profileUsed] =
    (memory.insights.profile_switches[profileUsed] || 0) + 1;

  // Add/update thread if summary has content
  if (summary && typeof summary === 'object' && summary.description) {
    const desc = summary.description;
    const id = threadId(desc);
    const now = new Date().toISOString();

    const existingIdx = memory.threads.findIndex(t => t.id === id);
    if (existingIdx >= 0) {
      // Update existing thread
      memory.threads[existingIdx].last_active = now;
      memory.threads[existingIdx].profile_used = profileUsed;
      if (summary.files_touched) {
        const merged = new Set([
          ...(memory.threads[existingIdx].files_touched || []),
          ...summary.files_touched,
        ]);
        memory.threads[existingIdx].files_touched = [...merged];
      }
      if (summary.status) memory.threads[existingIdx].status = summary.status;
    } else {
      // New thread
      memory.threads.push({
        id,
        summary: desc,
        started_at: now,
        last_active: now,
        profile_used: profileUsed,
        files_touched: summary.files_touched || [],
        risk_domains: summary.risk_domains || [],
        status: summary.status || 'active',
      });
    }

    // Track common risk domains
    if (summary.risk_domains && summary.risk_domains.length > 0) {
      const domainCounts = {};
      for (const d of memory.insights.common_risk_domains || []) {
        domainCounts[d] = (domainCounts[d] || 0) + 1;
      }
      for (const d of summary.risk_domains) {
        domainCounts[d] = (domainCounts[d] || 0) + 1;
      }
      // Keep top domains sorted by frequency
      memory.insights.common_risk_domains = Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([d]) => d);
    }
  } else if (summary && typeof summary === 'string' && summary.trim()) {
    // Simple string summary — create a basic thread
    const id = threadId(summary);
    const now = new Date().toISOString();
    const existingIdx = memory.threads.findIndex(t => t.id === id);
    if (existingIdx >= 0) {
      memory.threads[existingIdx].last_active = now;
      memory.threads[existingIdx].profile_used = profileUsed;
    } else {
      memory.threads.push({
        id,
        summary,
        started_at: now,
        last_active: now,
        profile_used: profileUsed,
        files_touched: [],
        risk_domains: [],
        status: 'active',
      });
    }
  }

  // Prune threads older than 7 days, keep max 10
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  memory.threads = memory.threads
    .filter(t => Date.parse(t.last_active) >= sevenDaysAgo)
    .sort((a, b) => Date.parse(b.last_active) - Date.parse(a.last_active))
    .slice(0, 10);

  atomicWrite(MEMORY_FILE, memory);
}

function getActiveThreads() {
  const memory = loadMemory();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return memory.threads
    .filter(t => Date.parse(t.last_active) >= sevenDaysAgo)
    .sort((a, b) => Date.parse(b.last_active) - Date.parse(a.last_active));
}

function inferPreferences() {
  const memory = loadMemory();
  const suggestions = [];
  const switches = memory.insights.profile_switches || {};
  const totalSessions = memory.insights.total_sessions || 0;

  // Need at least 5 sessions to make suggestions
  if (totalSessions < 5) {
    return { suggestions: [], confidence: 'low' };
  }

  // Check profile usage pattern
  const totalSwitches = Object.values(switches).reduce((a, b) => a + b, 0);
  if (totalSwitches > 0) {
    for (const [profile, count] of Object.entries(switches)) {
      const pct = (count / totalSwitches) * 100;
      if (pct > 60 && profile !== 'auto') {
        suggestions.push({
          key: 'preferences.default_profile',
          value: profile,
          reason: `You use "${profile}" ${Math.round(pct)}% of the time — consider making it your default.`,
        });
      }
    }
  }

  // Check risk domain patterns
  const highRiskDomains = ['auth', 'billing', 'secrets', 'migrations', 'security', 'payments'];
  const domains = memory.insights.common_risk_domains || [];
  const highRiskCount = domains.filter(d => highRiskDomains.includes(d)).length;
  if (highRiskCount >= 2 && memory.preferences.risk_tolerance !== 'careful') {
    suggestions.push({
      key: 'preferences.risk_tolerance',
      value: 'careful',
      reason: `You frequently work in high-risk domains (${domains.filter(d => highRiskDomains.includes(d)).join(', ')}) — "careful" mode adds extra review.`,
    });
  }

  // Check if user works mostly in low-risk areas
  const lowRiskDomains = ['docs', 'tests', 'config', 'styles'];
  const lowRiskCount = domains.filter(d => lowRiskDomains.includes(d)).length;
  if (lowRiskCount >= 2 && highRiskCount === 0 && memory.preferences.risk_tolerance !== 'aggressive') {
    suggestions.push({
      key: 'preferences.risk_tolerance',
      value: 'aggressive',
      reason: `Your work is mostly in low-risk domains (${domains.filter(d => lowRiskDomains.includes(d)).join(', ')}) — "aggressive" skips unnecessary reviews.`,
    });
  }

  // Determine confidence
  let confidence = 'low';
  if (totalSessions >= 20 && suggestions.length > 0) confidence = 'high';
  else if (totalSessions >= 10 && suggestions.length > 0) confidence = 'medium';
  else if (suggestions.length > 0) confidence = 'low';

  return { suggestions, confidence };
}

export {
  loadMemory,
  updateMemory,
  recordSessionEnd,
  getActiveThreads,
  inferPreferences,
};

// ─── CLI ──────────────────────────────────────────────────────────────────

const noColor = !!process.env.NO_COLOR;
const e = (code, s) => noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
const bold = s => e('1', s);
const dim = s => e('2', s);
const cyan = s => e('36', s);
const green = s => e('32', s);
const yellow = s => e('33', s);

function printMemory() {
  const memory = loadMemory();
  console.log('');
  console.log(`  ${bold('Vibe Memory')}  ${dim(MEMORY_FILE)}`);
  console.log('');

  console.log(`  ${bold('Preferences:')}`);
  for (const [k, v] of Object.entries(memory.preferences)) {
    console.log(`    ${k.padEnd(22)} ${v === null ? dim('(auto)') : cyan(String(v))}`);
  }
  console.log('');

  console.log(`  ${bold('Insights:')}`);
  console.log(`    total_sessions       ${memory.insights.total_sessions}`);

  const switches = memory.insights.profile_switches || {};
  if (Object.keys(switches).length > 0) {
    const parts = Object.entries(switches).map(([k, v]) => `${k}: ${v}`).join(', ');
    console.log(`    profile_switches     ${parts}`);
  } else {
    console.log(`    profile_switches     ${dim('(none)')}`);
  }

  const domains = memory.insights.common_risk_domains || [];
  console.log(`    common_risk_domains  ${domains.length > 0 ? domains.join(', ') : dim('(none)')}`);

  const rate = memory.insights.dual_brain_useful_rate;
  console.log(`    dual_brain_useful    ${rate !== null ? rate + '%' : dim('(not enough data)')}`);
  console.log('');

  const threads = getActiveThreads();
  if (threads.length > 0) {
    console.log(`  ${bold('Active Threads')} (${threads.length}):`);
    for (const t of threads) {
      const ago = timeAgo(Date.parse(t.last_active));
      const status = t.status === 'completed' ? green('done') : yellow('active');
      console.log(`    ${status}  ${dim(ago.padEnd(10))} ${t.summary.slice(0, 50)}`);
      if (t.files_touched.length > 0) {
        console.log(`          ${dim('files: ' + t.files_touched.slice(0, 3).join(', ') + (t.files_touched.length > 3 ? ` +${t.files_touched.length - 3}` : ''))}`);
      }
    }
  } else {
    console.log(`  ${bold('Active Threads:')} ${dim('(none)')}`);
  }
  console.log('');
}

function printThreads() {
  const threads = getActiveThreads();
  console.log('');
  if (threads.length === 0) {
    console.log(`  ${dim('No active threads in the last 7 days.')}`);
    console.log('');
    return;
  }

  console.log(`  ${bold('Active Threads')} (last 7 days):`);
  console.log('');
  for (const t of threads) {
    const ago = timeAgo(Date.parse(t.last_active));
    const status = t.status === 'completed' ? green('done') : yellow('active');
    console.log(`  ${status}  ${bold(t.summary)}`);
    console.log(`    ${dim('id:')} ${t.id}  ${dim('profile:')} ${t.profile_used}  ${dim('last:')} ${ago}`);
    if (t.files_touched.length > 0) {
      console.log(`    ${dim('files:')} ${t.files_touched.join(', ')}`);
    }
    if (t.risk_domains.length > 0) {
      console.log(`    ${dim('risk:')} ${t.risk_domains.join(', ')}`);
    }
    console.log('');
  }
}

function printInfer() {
  const { suggestions, confidence } = inferPreferences();
  console.log('');
  console.log(`  ${bold('Preference Suggestions')}  ${dim('confidence: ' + confidence)}`);
  console.log('');

  if (suggestions.length === 0) {
    const memory = loadMemory();
    if (memory.insights.total_sessions < 5) {
      console.log(`  ${dim('Not enough data yet — need at least 5 sessions.')}`);
      console.log(`  ${dim(`Current: ${memory.insights.total_sessions} sessions recorded.`)}`);
    } else {
      console.log(`  ${dim('No suggestions — your current preferences look good.')}`);
    }
  } else {
    for (const s of suggestions) {
      console.log(`  ${yellow('suggestion:')} ${bold(s.key)} = ${cyan(String(s.value))}`);
      console.log(`    ${s.reason}`);
      console.log(`    ${dim(`Apply: node vibe-memory.mjs --set ${s.key}=${s.value}`)}`);
      console.log('');
    }
  }
  console.log('');
}

function handleSet(arg) {
  const eqIdx = arg.indexOf('=');
  if (eqIdx < 0) {
    console.error(`  Invalid --set format. Use: --set key=value`);
    console.error(`  Example: --set preferences.risk_tolerance=careful`);
    process.exit(1);
  }

  const key = arg.slice(0, eqIdx);
  let value = arg.slice(eqIdx + 1);

  // Parse value types
  if (value === 'null') value = null;
  else if (value === 'true') value = true;
  else if (value === 'false') value = false;
  else if (/^\d+$/.test(value)) value = parseInt(value, 10);
  else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);

  updateMemory(key, value);
  console.log(`  ${green('updated:')} ${key} = ${value === null ? 'null' : String(value)}`);
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const h = Math.round(mins / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  return d + 'd ago';
}

// ─── CLI Entry ────────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  (process.argv[1].endsWith('vibe-memory.mjs') ||
   process.argv[1].endsWith('vibe-memory'));

if (isMain) {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  vibe-memory.mjs — Durable preference and context memory

  Usage:
    node vibe-memory.mjs                                  Show current memory
    node vibe-memory.mjs --set preferences.verbosity=quiet  Set a preference
    node vibe-memory.mjs --threads                         Show active threads
    node vibe-memory.mjs --infer                           Suggest preferences
    `);
    process.exit(0);
  }

  const setIdx = args.findIndex(a => a.startsWith('--set'));
  if (setIdx >= 0) {
    let setArg = args[setIdx];
    if (setArg === '--set' && args[setIdx + 1]) {
      setArg = args[setIdx + 1];
    } else if (setArg.startsWith('--set=')) {
      setArg = setArg.slice(6);
    } else {
      setArg = setArg.slice(5); // --setkey=value (shouldn't happen, but handle)
    }
    handleSet(setArg);
  } else if (args.includes('--threads')) {
    printThreads();
  } else if (args.includes('--infer')) {
    printInfer();
  } else {
    printMemory();
  }
}
