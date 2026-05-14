/**
 * config-validator.mjs — Validates orchestrator.json on load.
 *
 * Exports:
 *   validateConfig(config) → { valid: boolean, errors: string[], warnings: string[] }
 *   loadAndValidateConfig(configPath) → { config, validation }
 *
 * On invalid config: logs errors via error-channel.mjs, returns sensible defaults.
 * On unknown top-level keys: warns (potential typos).
 */

import { readFileSync } from 'fs';
import { logHookError } from './error-channel.mjs';

// ---------------------------------------------------------------------------
// Known top-level keys (anything else triggers a typo warning)
// ---------------------------------------------------------------------------
const KNOWN_TOP_LEVEL_KEYS = new Set([
  'subscriptions',
  'tiers',
  'routing',
  'routing_rules',
  'quality_gate',
  'pricing_verified',
  'budgets',
  'providers',
  'dual_thinking',
]);

// ---------------------------------------------------------------------------
// Sensible defaults for graceful degradation
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  subscriptions: {
    claude: {
      plan: '$100',
      models: {
        opus:   { tier: 'think',   name: 'opus',   provider: 'claude' },
        sonnet: { tier: 'execute', name: 'sonnet', provider: 'claude' },
        haiku:  { tier: 'search',  name: 'haiku',  provider: 'claude' },
      },
    },
  },
  tiers: {
    search:  { description: 'Read-only lookups' },
    execute: { description: 'Implementation and edits' },
    think:   { description: 'Architecture and review' },
  },
  routing: {
    strategy: 'hybrid-specialized-balanced',
  },
  quality_gate: {
    enabled: true,
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate an orchestrator config object.
 * Returns { valid, errors, warnings }.
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (!config || typeof config !== 'object') {
    errors.push('Config is not a valid object');
    return { valid: false, errors, warnings };
  }

  // Required top-level keys
  const requiredKeys = ['subscriptions', 'tiers', 'routing', 'quality_gate'];
  for (const key of requiredKeys) {
    if (!(key in config)) {
      errors.push(`Missing required top-level key: "${key}"`);
    }
  }

  // Unknown top-level keys (typo detection)
  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Unknown top-level key: "${key}" — possible typo?`);
    }
  }

  // Validate subscriptions structure
  if (config.subscriptions && typeof config.subscriptions === 'object') {
    for (const [providerName, provider] of Object.entries(config.subscriptions)) {
      if (!provider.models || typeof provider.models !== 'object') {
        errors.push(`subscriptions.${providerName} missing "models" object`);
        continue;
      }
      for (const [modelName, meta] of Object.entries(provider.models)) {
        if (!meta.tier) {
          errors.push(`subscriptions.${providerName}.models.${modelName} missing "tier"`);
        }
      }
    }
  }

  // Validate tiers has search, execute, think
  if (config.tiers && typeof config.tiers === 'object') {
    for (const required of ['search', 'execute', 'think']) {
      if (!(required in config.tiers)) {
        errors.push(`tiers missing required tier: "${required}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Load orchestrator.json from disk, validate it, log issues, and return
 * either the parsed config or sensible defaults on failure.
 */
export function loadAndValidateConfig(configPath) {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    logHookError('config-validator', 'load', err, { configPath });
    return { config: DEFAULT_CONFIG, validation: { valid: false, errors: [`Failed to parse config: ${err.message}`], warnings: [] } };
  }

  const validation = validateConfig(config);

  // Log errors
  for (const err of validation.errors) {
    logHookError('config-validator', 'validate', new Error(err), { configPath });
  }

  // Log warnings to stderr (non-fatal)
  for (const warn of validation.warnings) {
    process.stderr.write(`[config-validator] WARNING: ${warn}\n`);
  }

  // If invalid, merge defaults for missing keys
  if (!validation.valid) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    if (!config.subscriptions) merged.subscriptions = DEFAULT_CONFIG.subscriptions;
    if (!config.tiers) merged.tiers = DEFAULT_CONFIG.tiers;
    if (!config.routing) merged.routing = DEFAULT_CONFIG.routing;
    if (!config.quality_gate) merged.quality_gate = DEFAULT_CONFIG.quality_gate;
    return { config: merged, validation };
  }

  return { config, validation };
}
