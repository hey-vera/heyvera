#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync, renameSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, '..', 'orchestrator.json');
const PROFILE_FILE = resolve(__dirname, '..', 'dual-brain.profile.json');
const DRIFT_STATE = resolve(__dirname, '.drift-warned');

function loadProfile() {
  try {
    const data = JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
    return data.active || 'balanced';
  } catch { return 'balanced'; }
}

const PROFILE_SETTINGS = {
  balanced:        { demote_think: false, promote_execute: false, bias: 0 },
  'cost-saver':    { demote_think: true,  promote_execute: false, bias: -20 },
  'quality-first': { demote_think: false, promote_execute: true,  bias: 10 },
};

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

const SESSION_ID = process.env.CLAUDE_SESSION_ID || process.ppid?.toString() || null;

function logRecommendation(event) {
  const logFile = join(__dirname, `usage-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const profileName = event.profile || 'balanced';
  const entryObj = {
    timestamp: new Date().toISOString(),
    type: 'tier_recommendation',
    detected_tier: event.tier,
    recommended_model: event.recommended,
    actual_model: event.actual,
    prompt_hash: event.promptHash,
    followed: event.followed,
    session_id: SESSION_ID,
    profile: profileName,
  };
  const entry = JSON.stringify(entryObj);
  try {
    appendFileSync(logFile, entry + '\n');
  } catch {}

  // Sync summary update (for dupe detection on next call)
  try {
    const today = new Date().toISOString().slice(0, 10);
    const summaryFile = join(__dirname, `usage-summary-${today}.json`);
    let summary;
    try { summary = JSON.parse(readFileSync(summaryFile, 'utf8')); } catch { summary = { version: 1, recent_hashes: [] }; }
    if (event.promptHash) {
      summary.recent_hashes = summary.recent_hashes || [];
      summary.recent_hashes.push({ hash: event.promptHash, ts: entryObj.timestamp });
      const tenMinAgo = Date.now() - 10 * 60 * 1000;
      summary.recent_hashes = summary.recent_hashes.filter(h => Date.parse(h.ts) >= tenMinAgo);
    }
    summary.updated_at = new Date().toISOString();
    const tmp = summaryFile + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(summary, null, 2) + '\n');
    renameSync(tmp, summaryFile);
  } catch {}

  // Sync ledger write (append-only, fast)
  try {
    const ledgerEntry = JSON.stringify({
      type: 'decision',
      id: entryObj.timestamp.replace(/\W/g, '').slice(-12),
      timestamp: entryObj.timestamp,
      session_id: SESSION_ID,
      profile: profileName,
      tier: event.tier,
      provider: detectProvider(event.actual),
      model: event.actual || 'unknown',
      recommended_model: event.recommended,
      followed: event.followed,
      prompt_hash: event.promptHash,
    });
    appendFileSync(join(__dirname, 'decision-ledger.jsonl'), ledgerEntry + '\n');
  } catch {}
}

function checkDuplicate(promptHash) {
  // Try summary checkpoint first (O(1))
  try {
    const summaryPath = join(__dirname, `usage-summary-${new Date().toISOString().slice(0, 10)}.json`);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const match = (summary.recent_hashes || []).find(
      h => h.hash === promptHash && Date.parse(h.ts) >= tenMinAgo
    );
    if (match) return { timestamp: match.ts, prompt_hash: promptHash };
  } catch {}

  // Fallback: scan log
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

function detectProvider(model) {
  if (!model || model === 'main-session') return 'claude';
  const m = String(model).toLowerCase();
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
  if (m.includes('opus') || m.includes('sonnet') || m.includes('haiku') || m.includes('claude')) return 'claude';
  return 'claude';
}

function quickPressureCheck(tier) {
  // Try summary checkpoint first (O(1))
  try {
    const today = new Date().toISOString().slice(0, 10);
    const summaryPath = join(__dirname, `usage-summary-${today}.json`);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const cutoff = Date.now() - 5 * 60 * 60 * 1000;
    const claudeTs = (summary.pressure?.claude?.[tier] || []).filter(t => Date.parse(t) >= cutoff);
    const openaiTs = (summary.pressure?.openai?.[tier] || []).filter(t => Date.parse(t) >= cutoff);
    return { claudeCalls: claudeTs.length, openaiCalls: openaiTs.length };
  } catch {}

  // Fallback: scan log
  try {
    const today = new Date().toISOString().slice(0, 10);
    const logFile = join(__dirname, `usage-${today}.jsonl`);
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    let claudeCalls = 0, openaiCalls = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (Date.parse(entry.timestamp) < fiveHoursAgo) continue;
        if (entry.tier !== tier) continue;
        const provider = entry.provider || (entry.model?.includes('gpt') ? 'openai' : 'claude');
        if (provider === 'claude') claudeCalls++;
        else openaiCalls++;
      } catch {}
    }
    return { claudeCalls, openaiCalls };
  } catch {
    return null;
  }
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

  // Balance hint — populated after tier is fully resolved
  let balanceHint = null;

  // Helper to prepend optional warnings (duplicate + drift + balance) before a message
  const prependWarnings = (msg) => {
    const parts = [duplicateWarning, driftWarning, msg, balanceHint].filter(Boolean);
    return parts.join('\n\n');
  };

  // Load profile early so all log entries can reference it
  const profileName = loadProfile();
  const profileSettings = PROFILE_SETTINGS[profileName] || PROFILE_SETTINGS.balanced;

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
        profile: profileName,
      });
      process.stdout.write(JSON.stringify({ systemMessage: fullMsg }));
      process.exit(0);
    }

    if (THINK_WORDS.test(text)) tier = 'think';
    else if (/\b(edit|write|fix|implement|modify|refactor|delete|commit|test|build|run|add|update|create)\b/i.test(text)) tier = 'execute';
    else if (SEARCH_WORDS.test(text)) tier = 'search';
    else tier = 'execute';
  }

  // Apply profile-driven tier adjustments
  if (profileSettings.demote_think && tier === 'think' && !THINK_WORDS.test(text)) {
    tier = 'execute';
  }
  if (profileSettings.promote_execute && tier === 'execute' && THINK_WORDS.test(text)) {
    tier = 'think';
  }

  // Compute balance hint now that tier is resolved
  {
    const currentProvider = detectProvider(currentModel);
    if (currentProvider === 'claude') {
      const balance = quickPressureCheck(tier);
      const biasThreshold = profileSettings.bias >= 0 ? 10 : 20;
      if (balance && balance.claudeCalls > balance.openaiCalls * 2 && balance.claudeCalls > biasThreshold) {
        const dispatchModel = tier === 'think' ? 'gpt-5.5' : tier === 'execute' ? 'gpt-5.4' : 'gpt-4.1-mini';
        balanceHint = `\n\n💡 **Balance tip:** Claude has ${balance.claudeCalls} ${tier} calls vs OpenAI's ${balance.openaiCalls} in the last 5hrs. Consider dispatching isolated work to GPT: \`node .claude/hooks/gpt-work-dispatcher.mjs --task "..." --model ${dispatchModel}\``;
      }
    }
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
        profile: profileName,
      });
      const onlyWarnings = [duplicateWarning, driftWarning, balanceHint].filter(Boolean).join('\n\n');
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
      profile: profileName,
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
        profile: profileName,
      });
      const onlyWarnings = [duplicateWarning, driftWarning, balanceHint].filter(Boolean).join('\n\n');
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
      profile: profileName,
    });
    process.stdout.write(JSON.stringify({ systemMessage: prependWarnings(msg) }));
  }
} catch (err) {
  process.stdout.write(JSON.stringify({
    systemMessage: `[Tier Enforcer] Config error: ${err?.message?.slice(0, 100) || 'unknown'}. Falling back to main-session judgment.`
  }));
}
process.exit(0);
