#!/usr/bin/env node
// head-guard.mjs — Blocks HEAD from using mutation tools.
// Reads Claude Code hook stdin JSON protocol (PreToolUse event).
//
// Protocol (Claude Code sends this on stdin):
//   { session_id, hook_event_name, tool_name, tool_input,
//     tool_use_id, agent_id?, agent_type? }
//
// Exit behaviour:
//   exit 0                     → allow
//   exit 2 + stdout JSON       → block (permissionDecision: "deny")
//
// Key insight: `agent_id` is present when the hook fires inside a spawned
// subagent (work agent). If absent we are in the HEAD session.

import { readFileSync } from 'fs';

const BLOCKED_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

// Patterns that indicate a Bash command is writing/mutating the filesystem.
// Anchored to avoid false positives on grep/find output containing these words.
const WRITE_BASH_RE = /\brm\b|\bmv\b|\bcp\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bdd\b|\binstall\b|\btruncate\b|\btee\b|\bsed\s+-i\b|\bawk\s+-i\b|>>|(?<![><])>(?![>=])/;

function isBashWriteIntent(command) {
  return WRITE_BASH_RE.test(command);
}

// Read stdin JSON payload
let input;
try {
  const raw = readFileSync('/dev/stdin', 'utf8');
  input = JSON.parse(raw);
} catch {
  // Can't parse input — fail open. This hook's purpose is to block HEAD from
  // implementing directly. If we can't parse stdin (e.g. subagent context where
  // Claude Code doesn't pipe parseable JSON), blocking would incorrectly deny
  // work agents. Allowing is safer: worst case HEAD slips through once, but
  // work agents aren't blocked.
  process.exit(0);
}

const toolName = input.tool_name || '';

// If this hook is firing inside a subagent, ALLOW — subagents are work agents
// and are permitted to edit/write/bash.
if (input.agent_id) {
  process.exit(0);
}

// HEAD session: block direct mutation tools
if (BLOCKED_TOOLS.has(toolName)) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `[dual-brain] HEAD cannot use ${toolName} directly. Dispatch via: dual-brain go "task description"`,
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(2);
}

// Bash: allow read-only commands; block write-intent ones.
// Always allow node .claude/hooks/ and node hooks/ — CLAUDE.md instructs HEAD to run these.
if (toolName === 'Bash') {
  const command = (input.tool_input && input.tool_input.command) || '';
  if (/^node\s+\.?(?:\.claude\/)?hooks\//.test(command.trimStart())) {
    process.exit(0);
  }
  if (isBashWriteIntent(command)) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '[dual-brain] HEAD cannot run write-intent Bash commands. Dispatch via: dual-brain go "task description"',
      },
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(2);
  }
  process.exit(0);
}

// Block MCP filesystem write tools by name.
if (toolName.startsWith('mcp__') && /write|create|delete|remove|move|rename|append|patch|truncate|copy|commit|push|stage|merge|update|overwrite/i.test(toolName)) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        '[dual-brain] HEAD cannot use MCP write tools. Dispatch via: dual-brain go "task description"',
    },
  };
  process.stdout.write(JSON.stringify(output));
  process.exit(2);
}

// Allow everything else (Read, Agent handled by enforce-tier, etc.)
process.exit(0);
