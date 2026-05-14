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

const PROFILES = {
  balanced: {
    description: 'Standard routing — best model for each tier, normal budgets',
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
    description: 'Minimize spend — prefer cheaper models, skip GPT for low risk',
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
    description: 'Maximum quality — dual-brain for medium+, stricter reviews',
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
  const name = saved?.active || 'balanced';
  const profile = PROFILES[name] || PROFILES.balanced;
  const customOverrides = saved?.custom_overrides || {};

  return {
    name: PROFILES[name] ? name : 'balanced',
    ...profile,
    budgets: { ...profile.budgets, ...customOverrides.budgets },
    routing: { ...profile.routing, ...customOverrides.routing },
    switched_at: saved?.switched_at || null,
  };
}

function setActiveProfile(name, customOverrides = null) {
  if (!PROFILES[name]) {
    return { ok: false, error: `Unknown profile: ${name}. Available: ${Object.keys(PROFILES).join(', ')}` };
  }

  const data = {
    active: name,
    switched_at: new Date().toISOString(),
  };
  if (customOverrides) data.custom_overrides = customOverrides;

  try {
    const tmp = PROFILE_FILE + '.tmp.' + process.pid;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, PROFILE_FILE);
    return { ok: true, profile: PROFILES[name] };
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
  getActiveProfile,
  setActiveProfile,
  setBudgetOverrides,
  getProfileOverrides,
};
