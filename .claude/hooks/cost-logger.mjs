#!/usr/bin/env node
/**
 * cost-logger.mjs — PostToolUse hook for the Dual-Brain orchestrator.
 *
 * Reads a Claude Code PostToolUse JSON payload from stdin, classifies the
 * call by tier, then appends one line to usage.jsonl.
 *
 * Output contract: must print "{}" to stdout and exit 0 within ~100 ms.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_FILE = join(__dirname, '..', 'dual-brain.profile.json');

function usageFile(date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return join(__dirname, `usage-${d}.jsonl`);
}

mkdirSync(__dirname, { recursive: true });

function loadActiveProfile() {
  try {
    const data = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
    return data.active || 'auto';
  } catch { return 'auto'; }
}

const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.ppid?.toString() || null;

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

/**
 * Tools that are pure read-only lookups → "search" tier.
 * Everything else defaults to "execute"; "think" is only detected when an
 * Agent sub-agent call carries a model hint in its parameters.
 */
const SEARCH_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "WebSearch",
  "WebFetch",
  "mcp__github__search_repositories",
  "mcp__github__get_file_contents",
  "mcp__github__list_commits",
  "mcp__github__list_issues",
  "mcp__github__list_pull_requests",
  "mcp__github__search_code",
]);

const THINK_TOOLS = new Set([
  "TodoWrite",   // planning artefact
  "WebFetch",    // sometimes used for deep research; included in both sets so
                 // the model param check below can upgrade it
]);

/** Map a Claude model string → canonical tier name */
function modelToTier(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  if (m.includes("opus")) return "think";
  if (m.includes("sonnet")) return "execute";
  if (m.includes("haiku")) return "search";
  if (m.includes("gpt-5.5") || m.includes("gpt4.5")) return "think";
  if (m.includes("mini")) return "search";
  if (m.includes("gpt-5.4") || m.includes("gpt-4.1")) return "execute";
  return null;
}

/** Detect the provider from a model name */
function detectProvider(model) {
  if (!model || model === 'main-session') return 'claude';
  const m = String(model).toLowerCase();
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('opus') || m.includes('sonnet') || m.includes('haiku') || m.includes('claude')) return 'claude';
  return 'claude'; // default to claude since we're in Claude Code
}

/** Extract canonical model name from an arbitrary model string */
function canonicalModel(model) {
  if (!model) return "main-session";
  const m = String(model).toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  if (m.includes("gpt-5.5")) return "gpt-5.5";
  if (m.includes("gpt-5.4")) return "gpt-5.4";
  if (m.includes("gpt-4.1-mini") || m.includes("mini")) return "gpt-4.1-mini";
  return model;
}

/**
 * Classify a tool call into { tier, model }.
 *
 * @param {string} toolName
 * @param {object} toolInput  — raw input parameters from the hook payload
 * @param {string|null} agentModel — model hint from the outer agent context
 */
function classify(toolName, toolInput = {}, agentModel = null) {
  // 1. If there's an explicit model hint in the input params (sub-agent call),
  //    let it drive the tier.
  const inputModel =
    toolInput?.model ||
    toolInput?.Model ||
    toolInput?.modelId ||
    null;

  const effectiveModel = inputModel || agentModel;
  const tierFromModel = modelToTier(effectiveModel);

  if (toolName === "Agent" || toolName === "Task") {
    return {
      tier: tierFromModel || "think",  // sub-agents default to "think"
      model: canonicalModel(effectiveModel),
    };
  }

  if (THINK_TOOLS.has(toolName) && tierFromModel) {
    return { tier: tierFromModel, model: canonicalModel(effectiveModel) };
  }

  if (SEARCH_TOOLS.has(toolName)) {
    return { tier: "search", model: canonicalModel(effectiveModel) };
  }

  // Everything else: edit / bash / write / test → execute
  return {
    tier: tierFromModel || "execute",
    model: canonicalModel(effectiveModel),
  };
}

// ---------------------------------------------------------------------------
// Budget alerts
// ---------------------------------------------------------------------------

async function checkBudget() {
  let config;
  try {
    config = JSON.parse(readFileSync(join(__dirname, '..', 'orchestrator.json'), 'utf8'));
  } catch { return null; }

  // Merge profile budget overrides on top of config defaults
  let budgets = config.budgets;
  if (!budgets) return null;
  try {
    const profileData = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
    if (profileData.custom_overrides?.budgets) {
      budgets = { ...budgets, ...profileData.custom_overrides.budgets };
    }
  } catch {}

  // Rate limit alerts
  const cooldownFile = join(__dirname, '.budget-alerted');
  const cooldownMin = budgets.alert_cooldown_minutes || 15;
  try {
    const lastAlert = readFileSync(cooldownFile, 'utf8').trim();
    if (Date.now() - Date.parse(lastAlert) < cooldownMin * 60 * 1000) return null;
  } catch {}

  // Use summary checkpoint for fast budget check (O(1) instead of full scan)
  let totalCost = 0;
  try {
    const { readSummary } = await import('./summary-checkpoint.mjs');
    const summary = readSummary();
    totalCost = summary.totals.cost_estimate;
  } catch {
    // Fallback: scan the log (only if summary unavailable)
    const todayFile = usageFile();
    let records = [];
    try {
      records = readFileSync(todayFile, 'utf8').split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { return null; }
    const RATES = { search: 0.003, execute: 0.012, think: 0.055 };
    totalCost = records.reduce((sum, r) => sum + (RATES[r.tier] || RATES.execute), 0);
  }

  let msg = null;
  if (budgets.daily_limit_usd && totalCost >= budgets.daily_limit_usd) {
    msg = `**[Budget Alert]** Daily cost estimate (~$${totalCost.toFixed(2)}) has reached the $${budgets.daily_limit_usd} limit. Consider pausing non-essential work.`;
  } else if (budgets.daily_warn_usd && totalCost >= budgets.daily_warn_usd) {
    msg = `**[Budget Alert]** Daily cost estimate (~$${totalCost.toFixed(2)}) has passed the $${budgets.daily_warn_usd} warning threshold.`;
  }

  if (msg) {
    try { writeFileSync(cooldownFile, new Date().toISOString()); } catch {}
    return msg;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main — read stdin, classify, append, respond
// ---------------------------------------------------------------------------

async function main() {
  // Read all stdin (non-blocking-safe with a short timeout)
  let raw = "";
  try {
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (raw.length > 64 * 1024) break; // safety cap
    }
  } catch {
    // stdin closed or empty — not fatal
  }

  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed JSON — proceed with empty payload
  }

  const toolName = payload?.tool_name || payload?.toolName || "unknown";
  const toolInput = payload?.tool_input || payload?.toolInput || {};
  const agentModel = payload?.model || payload?.agent_model || null;

  const { tier, model } = classify(toolName, toolInput, agentModel);

  // Extract actual token counts from payload (location varies by hook version)
  const usage = payload?.usage || toolInput?.usage || {};
  const inputTokens = usage.input_tokens ?? payload?.input_tokens ?? null;
  const outputTokens = usage.output_tokens ?? payload?.output_tokens ?? null;

  const status = (payload?.error || payload?.tool_response?.error || payload?.is_error) ? 'error' : 'ok';

  const entryObj = {
    schema_version: 3,
    timestamp: new Date().toISOString(),
    tier,
    tool: toolName,
    model,
    provider: detectProvider(model),
    dispatcher: 'claude-code',
    status,
    session_id: SESSION_ID,
    profile: loadActiveProfile(),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };

  const entry = JSON.stringify(entryObj);

  try {
    appendFileSync(usageFile(), entry + "\n", { encoding: "utf8", flag: "a" });
  } catch {}

  // Update summary checkpoint (non-blocking, best-effort)
  try {
    const { updateSummary } = await import('./summary-checkpoint.mjs');
    updateSummary(entryObj);
  } catch {}

  // Record failures for adaptive routing (failure-loop detection)
  if (status === 'error' && toolName === 'Agent') {
    try {
      const { computePromptHash, recordFailure, pruneOldFailures } = await import('./failure-detector.mjs');
      const promptHash = computePromptHash(toolInput);
      recordFailure(promptHash, tier, payload?.error || 'agent_error');
      // Best-effort cleanup of stale failure entries (>24h old)
      try { pruneOldFailures(); } catch {}
    } catch {}
  }

  const budgetMsg = await checkBudget();

  // PostToolUse hooks must emit a JSON object to stdout
  if (budgetMsg) {
    process.stdout.write(JSON.stringify({ systemMessage: budgetMsg }) + "\n");
  } else {
    process.stdout.write("{}\n");
  }
  process.exit(0);
}

main();
