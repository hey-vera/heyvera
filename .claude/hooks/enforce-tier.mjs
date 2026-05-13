#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, '..', 'orchestrator.json');

const SEARCH_WORDS = /\b(explore|search|find|grep|locate|where\s+is|list\s+files|read[-\s]?only|lookup|scan)\b/i;
const THINK_WORDS = /\b(plan|design|architect|review|audit|security|code[-\s]?review|threat[-\s]?model|complex[-\s]?debug)\b/i;

function preferredModel(config, tier) {
  const models = config?.subscriptions?.claude?.models ?? {};
  for (const [name, meta] of Object.entries(models)) {
    if (meta?.tier === tier) return name;
  }
  return null;
}

try {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));

  if (input.tool_name !== 'Agent') {
    process.stdout.write('{}');
    process.exit(0);
  }

  const ti = input.tool_input || {};
  const text = `${ti.description || ''} ${ti.prompt || ''}`.toLowerCase();
  const subType = (ti.subagent_type || '').toLowerCase();
  const currentModel = (ti.model || '').toLowerCase();

  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    process.stdout.write('{}');
    process.exit(0);
  }

  const defaults = config.routing_rules?.subagent_defaults || {};
  let tier = null;

  for (const [key, val] of Object.entries(defaults)) {
    if (subType === key.toLowerCase()) { tier = val; break; }
  }

  if (!tier) {
    if (THINK_WORDS.test(text)) tier = 'think';
    else if (/\b(edit|write|fix|implement|modify|refactor|delete|commit|test|build|run)\b/i.test(text)) tier = 'execute';
    else if (SEARCH_WORDS.test(text)) tier = 'search';
    else tier = 'execute';
  }

  const expected = preferredModel(config, tier);

  if (tier === 'think') {
    const thinkModels = ['opus', 'gpt-5.5', 'o1', 'o3'];
    const isThink = !currentModel || thinkModels.some(m => currentModel.includes(m));
    if (isThink) {
      process.stdout.write('{}');
      process.exit(0);
    }
    // If we get here, a non-think model is being used for think work
    const msg = `**[Tier Enforcer]** This looks like **think** work (architecture/review/planning). ` +
      `Don't send it to "${currentModel}" — keep it on the main session (${expected || 'opus'}) for best results.`;
    process.stdout.write(JSON.stringify({ systemMessage: msg }));
  } else {
    if (!expected || currentModel.includes(expected)) {
      process.stdout.write('{}');
      process.exit(0);
    }
    const savings = tier === 'search' ? 'Haiku is 19x cheaper than Opus for read-only lookups.' : 'Sonnet is 5x cheaper than Opus for implementation work.';
    const msg = `**[Tier Enforcer]** This looks like **${tier}** work. ` +
      `Use \`model: "${expected}"\` instead of "${currentModel || 'opus (inherited)'}". ${savings}`;
    process.stdout.write(JSON.stringify({ systemMessage: msg }));
  }
} catch (err) {
  process.stdout.write(JSON.stringify({
    systemMessage: `[Tier Enforcer] Config error: ${err?.message?.slice(0, 100) || 'unknown'}. Falling back to main-session judgment.`
  }));
}
process.exit(0);
