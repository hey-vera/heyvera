#!/usr/bin/env node
/**
 * profiles.mjs — Profile system for the Dual-Brain Orchestrator.
 *
 * Profiles configure routing posture, budget limits, and quality gate behavior.
 * Active profile persists to .claude/dual-brain.profile.json.
 *
 * Exported API:
 *   PROFILES                    → built-in profile definitions
 *   getActiveProfile()          → current profile name + merged settings
 *   setActiveProfile(name)      → switch profile, returns success/error
 *   getProfileOverrides(key)    → profile-driven overrides for a specific system
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_FILE = join(__dirname, '..', 'dual-brain.profile.json');
const CONFIG_FILE = join(__dirname, '..', 'orchestrator.json');

const ALIASES = {
  // auto
  'auto': 'auto', 'adaptive': 'auto', 'smart': 'auto', 'default': 'auto', 'normal': 'auto',
  // balanced
  'balanced': 'balanced', 'even': 'balanced', 'equal': 'balanced',
  // cost-saver
  'cost-saver': 'cost-saver', 'cheap': 'cost-saver', 'save': 'cost-saver', 'conservative': 'cost-saver', 'frugal': 'cost-saver', 'budget': 'cost-saver', 'fast': 'cost-saver', 'quick': 'cost-saver',
  // quality-first
  'quality-first': 'quality-first', 'aggressive': 'quality-first', 'quality': 'quality-first', 'max': 'quality-first', 'full': 'quality-first', 'both': 'quality-first', 'careful': 'quality-first', 'thorough': 'quality-first', 'safe': 'quality-first',
};

function resolveProfileName(input) {
  if (!input) return null;
  const cleaned = input.toLowerCase().trim()
    .replace(/^(go|be|use|switch to|set|mode)\s+/i, '')
    .replace(/\s+mode$/i, '');
  return ALIASES[cleaned] || null;
}

const PROFILES = {
  auto: {
    description: 'Adapts routing based on task risk, provider health, and outcomes',
    routing: {
      prefer_provider: 'auto',
      think_threshold: 'adaptive',
      gpt_dispatch_bias: 0,
    },
    budgets: {
      session_warn_usd: 5.00,
      session_limit_usd: 10.00,
      daily_warn_usd: 20.00,
      daily_limit_usd: 50.00,
    },
    quality_gate: {
      sensitivity_floor: 'medium',
      dual_brain_minimum: 'high',
    },
    tier_overrides: null,
  },

  balanced: {
    description: 'Auto-routes by complexity, uses both providers evenly',
    routing: {
      prefer_provider: 'auto',
      think_threshold: 'normal',
      gpt_dispatch_bias: 0,
    },
    budgets: {
      session_warn_usd: 5.00,
      session_limit_usd: 10.00,
      daily_warn_usd: 20.00,
      daily_limit_usd: 50.00,
    },
    quality_gate: {
      sensitivity_floor: 'medium',
      dual_brain_minimum: 'high',
    },
    tier_overrides: null,
  },

  'cost-saver': {
    description: 'Conservative — fewer GPT dispatches, sticks to Claude',
    routing: {
      prefer_provider: 'cheapest',
      think_threshold: 'strict',
      gpt_dispatch_bias: -20,
    },
    budgets: {
      session_warn_usd: 2.00,
      session_limit_usd: 5.00,
      daily_warn_usd: 8.00,
      daily_limit_usd: 20.00,
    },
    quality_gate: {
      sensitivity_floor: 'high',
      dual_brain_minimum: 'critical',
    },
    tier_overrides: {
      promote_execute_to_think: false,
      demote_think_to_execute: true,
    },
  },

  'quality-first': {
    description: 'Aggressive — maximizes both subscriptions, dual-brain for medium+',
    routing: {
      prefer_provider: 'most-capable',
      think_threshold: 'relaxed',
      gpt_dispatch_bias: 10,
    },
    budgets: {
      session_warn_usd: 15.00,
      session_limit_usd: 30.00,
      daily_warn_usd: 50.00,
      daily_limit_usd: 100.00,
    },
    quality_gate: {
      sensitivity_floor: 'low',
      dual_brain_minimum: 'medium',
    },
    tier_overrides: {
      promote_execute_to_think: true,
      demote_think_to_execute: false,
    },
  },
};

function loadProfileFile() {
  try {
    return JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function getActiveProfile() {
  const saved = loadProfileFile();
  const name = saved?.active || 'auto';
  const profile = PROFILES[name] || PROFILES.auto;
  const customOverrides = saved?.custom_overrides || {};

  return {
    name: PROFILES[name] ? name : 'auto',
    ...profile,
    budgets: { ...profile.budgets, ...customOverrides.budgets },
    routing: { ...profile.routing, ...customOverrides.routing },
    switched_at: saved?.switched_at || null,
  };
}

function setActiveProfile(name, customOverrides = null) {
  let resolved = name;
  if (!PROFILES[resolved]) {
    const alias = resolveProfileName(name);
    if (alias) {
      resolved = alias;
    } else {
      const aliasHint = Object.entries(ALIASES)
        .filter(([k, v]) => k !== v)
        .map(([k, v]) => `${k} → ${v}`)
        .join(', ');
      return { ok: false, error: `Unknown profile: ${name}. Available: ${Object.keys(PROFILES).join(', ')}. Aliases: ${aliasHint}` };
    }
  }

  const data = {
    active: resolved,
    switched_at: new Date().toISOString(),
  };
  if (customOverrides) data.custom_overrides = customOverrides;

  try {
    const tmp = PROFILE_FILE + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, PROFILE_FILE);
    return { ok: true, profile: PROFILES[resolved], resolvedName: resolved };
  } catch (err) {
    return { ok: false, error: `Failed to write profile: ${err.message}` };
  }
}

function setBudgetOverrides(sessionLimit, dailyLimit) {
  const saved = loadProfileFile() || { active: 'balanced' };
  saved.custom_overrides = saved.custom_overrides || {};
  saved.custom_overrides.budgets = {};

  if (sessionLimit != null) {
    saved.custom_overrides.budgets.session_warn_usd = sessionLimit * 0.6;
    saved.custom_overrides.budgets.session_limit_usd = sessionLimit;
  }
  if (dailyLimit != null) {
    saved.custom_overrides.budgets.daily_warn_usd = dailyLimit * 0.6;
    saved.custom_overrides.budgets.daily_limit_usd = dailyLimit;
  }

  saved.switched_at = saved.switched_at || new Date().toISOString();

  try {
    const tmp = PROFILE_FILE + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(saved, null, 2) + '\n');
    renameSync(tmp, PROFILE_FILE);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getProfileOverrides(system) {
  const profile = getActiveProfile();

  switch (system) {
    case 'enforce-tier':
      return {
        think_threshold: profile.routing.think_threshold,
        tier_overrides: profile.tier_overrides,
        gpt_dispatch_bias: profile.routing.gpt_dispatch_bias,
      };

    case 'budget-balancer':
      return {
        budgets: profile.budgets,
        prefer_provider: profile.routing.prefer_provider,
      };

    case 'quality-gate':
      return {
        sensitivity_floor: profile.quality_gate.sensitivity_floor,
        dual_brain_minimum: profile.quality_gate.dual_brain_minimum,
      };

    default:
      return {};
  }
}

export {
  PROFILES,
  ALIASES,
  resolveProfileName,
  getActiveProfile,
  setActiveProfile,
  setBudgetOverrides,
  getProfileOverrides,
};
