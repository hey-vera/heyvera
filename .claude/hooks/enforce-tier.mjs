#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, '..', 'orchestrator.json');
const DRIFT_STATE = resolve(__dirname, '.drift-warned');

function checkPricingDrift(config) {
  const verified = config.pricing_verified;
  if (!verified) return null;

  const age = Math.floor((Date.now() - Date.parse(verified)) / 86400000);
  if (age < 30) return null;

  // Rate limit: only warn once per day
  try {
    const lastWarn = readFileSync(DRIFT_STATE, 'utf8').trim();
    const today = new Date().toISOString().slice(0, 10);
    if (lastWarn === today) return null;
  } catch {}

  try {
    writeFileSync(DRIFT_STATE, new Date().toISOString().slice(0, 10));
  } catch {}

  return `**[Drift Warning]** Pricing was last verified ${age} days ago. Run \`node .claude/hooks/setup-wizard.mjs\` to update.`;
}

function logRecommendation(event) {
  const logFile = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'tier_recommendation',
    detected_tier: event.tier,
    recommended_model: event.recommended,
    actual_model: event.actual,
    prompt_hash: event.promptHash,
    followed: event.followed,
  });
  try {
    appendFileSync(logFile, entry + '\n');
  } catch {}
}

function checkDuplicate(promptHash) {
  const logFile = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  try {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'tier_recommendation' &&
            entry.prompt_hash === promptHash &&
            Date.parse(entry.timestamp) > tenMinAgo) {
          return entry;
        }
      } catch {}
    }
  } catch {}
  return null;
}

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

  // Compute prompt hash early for duplicate detection and logging
  const promptHash = createHash('sha256').update(text).digest('hex').slice(0, 12);

  // Check for duplicate agent dispatch before tier classification
  const duplicate = checkDuplicate(promptHash);
  let duplicateWarning = null;
  if (duplicate) {
    const minutesAgo = Math.round((Date.now() - Date.parse(duplicate.timestamp)) / 60000);
    duplicateWarning = `**[Duplicate Warning]** A similar agent task was dispatched ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago. Reuse the prior result unless the scope changed.`;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    process.stdout.write('{}');
    process.exit(0);
  }

  const driftWarning = checkPricingDrift(config);

  const intelligence = config.model_intelligence || {};
  const defaults = config.routing_rules?.subagent_defaults || {};
  let tier = null;

  for (const [key, val] of Object.entries(defaults)) {
    if (subType === key.toLowerCase()) { tier = val; break; }
  }

  // Helper to prepend optional warnings (duplicate + drift) before a message
  const prependWarnings = (msg) => {
    const parts = [duplicateWarning, driftWarning, msg].filter(Boolean);
    return parts.join('\n\n');
  };

  // Multi-tier detection — only when tier is not already resolved from subagent_defaults
  if (!tier) {
    const hasThink = THINK_WORDS.test(text);
    const hasExecute = /\b(edit|write|fix|implement|modify|refactor|delete|commit|test|build|run|add|update|create)\b/i.test(text);
    const hasSearch = SEARCH_WORDS.test(text);

    const detectedTiers = [
      hasSearch && 'search',
      hasExecute && 'execute',
      hasThink && 'think',
    ].filter(Boolean);

    if (detectedTiers.length > 1) {
      const splitMsg = `**[Tier Enforcer]** This spans **${detectedTiers.join(' + ')}** work. Consider splitting: ` +
        (hasSearch ? 'search first (haiku), ' : '') +
        (hasExecute ? 'then execute edits (sonnet), ' : '') +
        (hasThink ? 'keep planning/review on think tier (opus).' : '');
      const fullMsg = prependWarnings(splitMsg.replace(/, $/, '.'));
      logRecommendation({
        tier: detectedTiers.join('+'),
        recommended: null,
        actual: currentModel,
        promptHash,
        followed: false,
      });
      process.stdout.write(JSON.stringify({ systemMessage: fullMsg }));
      process.exit(0);
    }

    if (THINK_WORDS.test(text)) tier = 'think';
    else if (/\b(edit|write|fix|implement|modify|refactor|delete|commit|test|build|run|add|update|create)\b/i.test(text)) tier = 'execute';
    else if (SEARCH_WORDS.test(text)) tier = 'search';
    else tier = 'execute';
  }

  const expected = preferredModel(config, tier);

  if (tier === 'think') {
    const thinkModels = ['opus', 'gpt-5.5', 'o1', 'o3'];
    const isThink = !currentModel || thinkModels.some(m => currentModel.includes(m));
    if (isThink) {
      logRecommendation({
        tier,
        recommended: expected,
        actual: currentModel,
        promptHash,
        followed: true,
      });
      const onlyWarnings = [duplicateWarning, driftWarning].filter(Boolean).join('\n\n');
      if (onlyWarnings) {
        process.stdout.write(JSON.stringify({ systemMessage: onlyWarnings }));
      } else {
        process.stdout.write('{}');
      }
      process.exit(0);
    }
    // If we get here, a non-think model is being used for think work
    const thinkBestFor = intelligence[expected || 'opus']?.best_for;
    const thinkBestForSuffix = thinkBestFor ? ` (best for: ${thinkBestFor})` : '';
    const msg = `**[Tier Enforcer]** This looks like **think** work (architecture/review/planning). ` +
      `Don't send it to "${currentModel}" — keep it on the main session (${expected || 'opus'}${thinkBestForSuffix}) for best results.`;
    logRecommendation({
      tier,
      recommended: expected,
      actual: currentModel,
      promptHash,
      followed: false,
    });
    process.stdout.write(JSON.stringify({ systemMessage: prependWarnings(msg) }));
  } else {
    if (!expected || currentModel.includes(expected)) {
      logRecommendation({
        tier,
        recommended: expected,
        actual: currentModel,
        promptHash,
        followed: true,
      });
      const onlyWarnings = [duplicateWarning, driftWarning].filter(Boolean).join('\n\n');
      if (onlyWarnings) {
        process.stdout.write(JSON.stringify({ systemMessage: onlyWarnings }));
      } else {
        process.stdout.write('{}');
      }
      process.exit(0);
    }
    const savings = tier === 'search' ? 'Haiku is 19x cheaper than Opus for read-only lookups.' : 'Sonnet is 5x cheaper than Opus for implementation work.';
    const bestFor = intelligence[expected]?.best_for;
    const bestForSuffix = bestFor ? ` (best for: ${bestFor})` : '';
    const msg = `**[Tier Enforcer]** This looks like **${tier}** work. ` +
      `Use \`model: "${expected}"\`${bestForSuffix} instead of "${currentModel || 'opus (inherited)'}". ${savings}`;
    logRecommendation({
      tier,
      recommended: expected,
      actual: currentModel,
      promptHash,
      followed: false,
    });
    process.stdout.write(JSON.stringify({ systemMessage: prependWarnings(msg) }));
  }
} catch (err) {
  process.stdout.write(JSON.stringify({
    systemMessage: `[Tier Enforcer] Config error: ${err?.message?.slice(0, 100) || 'unknown'}. Falling back to main-session judgment.`
  }));
}
process.exit(0);
