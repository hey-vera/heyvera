#!/usr/bin/env node
/**
 * setup-wizard.mjs — Interactive setup for the Dual-Brain Orchestrator.
 * Usage: node .claude/hooks/setup-wizard.mjs
 */
import { createInterface } from 'readline';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, '..', 'orchestrator.json');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const CLAUDE_PLANS = {
  '$20':  { models: { sonnet: { tier: 'think', input_per_mtok: 3.0, output_per_mtok: 15.0 }, haiku: { tier: 'search', input_per_mtok: 1.0, output_per_mtok: 5.0 } } },
  '$100': { models: { opus: { tier: 'think', input_per_mtok: 5.0, output_per_mtok: 25.0 }, sonnet: { tier: 'execute', input_per_mtok: 3.0, output_per_mtok: 15.0 }, haiku: { tier: 'search', input_per_mtok: 1.0, output_per_mtok: 5.0 } } },
  '$200': { models: { opus: { tier: 'think', input_per_mtok: 5.0, output_per_mtok: 25.0 }, sonnet: { tier: 'execute', input_per_mtok: 3.0, output_per_mtok: 15.0 }, haiku: { tier: 'search', input_per_mtok: 1.0, output_per_mtok: 5.0 } } },
  'api':  { models: { opus: { tier: 'think', input_per_mtok: 5.0, output_per_mtok: 25.0 }, sonnet: { tier: 'execute', input_per_mtok: 3.0, output_per_mtok: 15.0 }, haiku: { tier: 'search', input_per_mtok: 1.0, output_per_mtok: 5.0 } } },
};

const OPENAI_PLANS = {
  '$20':  { models: { 'gpt-5.4': { tier: 'think', input_per_mtok: 2.5, output_per_mtok: 15.0 }, 'gpt-4.1-mini': { tier: 'search', input_per_mtok: 0.40, output_per_mtok: 1.60 } } },
  '$100': { models: { 'gpt-5.5': { tier: 'think', input_per_mtok: 5.0, output_per_mtok: 30.0 }, 'gpt-5.4': { tier: 'execute', input_per_mtok: 2.5, output_per_mtok: 15.0 }, 'gpt-4.1-mini': { tier: 'search', input_per_mtok: 0.40, output_per_mtok: 1.60 } } },
  '$200': { models: { 'gpt-5.5': { tier: 'think', input_per_mtok: 5.0, output_per_mtok: 30.0 }, 'gpt-5.4': { tier: 'execute', input_per_mtok: 2.5, output_per_mtok: 15.0 }, 'gpt-4.1-mini': { tier: 'search', input_per_mtok: 0.40, output_per_mtok: 1.60 } } },
  'api':  { models: { 'gpt-5.5': { tier: 'think', input_per_mtok: 5.0, output_per_mtok: 30.0 }, 'gpt-5.4': { tier: 'execute', input_per_mtok: 2.5, output_per_mtok: 15.0 }, 'gpt-4.1-mini': { tier: 'search', input_per_mtok: 0.40, output_per_mtok: 1.60 } } },
};

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║      Dual-Brain Orchestrator Setup Wizard        ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  // Claude subscription
  console.log('  Claude subscription plans: $20, $100, $200, api');
  const claudePlan = (await ask('  Your Claude plan: ')).trim().toLowerCase();
  const cKey = claudePlan.startsWith('$') ? claudePlan : (claudePlan === 'api' ? 'api' : `$${claudePlan}`);
  const claudeConfig = CLAUDE_PLANS[cKey];
  if (!claudeConfig) {
    console.log(`  ⚠ Unknown plan "${cKey}", using $100 defaults`);
  }
  const finalClaudeConfig = claudeConfig || CLAUDE_PLANS['$100'];
  console.log(`  -> Using Claude ${cKey} model set\n`);

  // OpenAI subscription
  const hasOpenai = (await ask('  Do you have an OpenAI subscription? (y/n): ')).trim().toLowerCase();
  let openaiConfig = null;
  let oKey = null;
  if (hasOpenai === 'y' || hasOpenai === 'yes') {
    console.log('  OpenAI plans: $20, $100, $200, api');
    const openaiPlan = (await ask('  Your OpenAI plan: ')).trim().toLowerCase();
    oKey = openaiPlan.startsWith('$') ? openaiPlan : (openaiPlan === 'api' ? 'api' : `$${openaiPlan}`);
    openaiConfig = OPENAI_PLANS[oKey];
    if (!openaiConfig) {
      console.log(`  ⚠ Unknown plan "${oKey}", using $100 defaults`);
    }
    openaiConfig = openaiConfig || OPENAI_PLANS['$100'];
    console.log(`  -> Using OpenAI ${oKey} model set\n`);
  }

  // Quality gate
  const gateInput = (await ask('  Enable quality gate on code changes? (Y/n): ')).trim().toLowerCase();
  const gateEnabled = gateInput !== 'n' && gateInput !== 'no';

  // Build config
  let existing = {};
  if (existsSync(CONFIG_FILE)) {
    try { existing = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  }

  const config = {
    ...existing,
    subscriptions: {
      claude: { plan: cKey, models: finalClaudeConfig.models },
      ...(openaiConfig ? { openai: { plan: oKey, models: openaiConfig.models } } : {}),
    },
    tiers: existing.tiers || {
      search:  { description: 'Read-only lookups, exploration, grep, find, file reads', prefer: 'cheapest available model', tasks: ['explore', 'grep', 'find', 'ls', 'read_file', 'git_log', 'git_status'] },
      execute: { description: 'Implementation, edits, test runs, git operations, linting', prefer: 'mid-tier model', tasks: ['edit', 'write', 'test_run', 'lint', 'format', 'simple_fix', 'refactor_small'] },
      think:   { description: 'Architecture, review, planning, security, complex debugging', prefer: 'most capable model', tasks: ['architecture', 'review', 'planning', 'security', 'complex_debug', 'design'] },
    },
    quality_gate: {
      enabled: gateEnabled,
      trigger_extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.rb', '.swift', '.kt'],
      skip_patterns: ['test', '__tests__', 'spec', '.md', '.json', '.yaml', '.toml', '.txt'],
    },
    routing_rules: existing.routing_rules || {
      subagent_defaults: { Explore: 'search', 'general-purpose': 'execute', Plan: 'think', 'code-reviewer': 'think' },
      max_concurrent_think: 1,
      max_concurrent_execute: 3,
      max_concurrent_search: 4,
    },
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');

  // Summary
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                   Configured!                    ║');
  console.log('  ╠══════════════════════════════════════════════════╣');

  const claudeModels = Object.keys(finalClaudeConfig.models).join(', ');
  console.log(`  ║ Claude:     ${cKey.padEnd(6)} (${claudeModels})`.padEnd(53) + '║');

  if (openaiConfig) {
    const oModels = Object.keys(openaiConfig.models).join(', ');
    console.log(`  ║ OpenAI:     yes   (${oModels})`.padEnd(53) + '║');
    console.log('  ║ Dual-brain: enabled'.padEnd(53) + '║');
  } else {
    console.log('  ║ OpenAI:     none'.padEnd(53) + '║');
    console.log('  ║ Dual-brain: disabled (add OpenAI or Codex)'.padEnd(53) + '║');
  }

  console.log(`  ║ Quality gate: ${gateEnabled ? 'enabled' : 'disabled'}`.padEnd(53) + '║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║ Restart Claude Code to activate the orchestrator ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  rl.close();
}

process.on('SIGINT', () => { console.log('\n  Setup cancelled.'); process.exit(0); });
main().catch(e => { console.error('Setup error:', e.message); process.exit(1); });
