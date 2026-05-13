#!/usr/bin/env node
/**
 * cost-logger.mjs — PostToolUse hook for the Dual-Brain orchestrator.
 *
 * Reads a Claude Code PostToolUse JSON payload from stdin, classifies the
 * call by tier, then appends one line to usage.jsonl.
 *
 * Output contract: must print "{}" to stdout and exit 0 within ~100 ms.
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = join(__dirname, "usage.jsonl");

// Ensure the hooks dir exists (idempotent, defensive)
mkdirSync(__dirname, { recursive: true });

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

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    tier,
    tool: toolName,
    model,
    session_id: process.env.CLAUDE_SESSION_ID || null,
    input_tokens: toolInput?.usage?.input_tokens ?? null,
    output_tokens: toolInput?.usage?.output_tokens ?? null,
  });

  try {
    appendFileSync(USAGE_FILE, entry + "\n", { encoding: "utf8", flag: "a" });
  } catch {
    // Disk write failed — silently ignore so the hook never blocks the IDE
  }

  // PostToolUse hooks must emit a JSON object to stdout
  process.stdout.write("{}\n");
  process.exit(0);
}

main();
