#!/usr/bin/env node
/**
 * agent-templates.mjs — Pre-built specialist agent templates for dual-brain.
 *
 * Exports:
 *   TEMPLATES                              — all template definitions
 *   getTemplate(name)                      → template object or null
 *   listTemplates()                        → [{name, description, tier, risk}]
 *   buildAgentPrompt(templateName, flags)  → { prompt, model, description, risk, quality_gate, tier, output_contract }
 *   buildPrompt(templateName, args)        → prompt string (legacy compat)
 *
 * CLI:
 *   node agent-templates.mjs --list
 *   node agent-templates.mjs --template explorer --question "where is auth handled?"
 *   node agent-templates.mjs --run explorer --question "where is auth handled?"
 *
 * Via npx dual-brain:
 *   npx dual-brain agents                          # list all templates
 *   npx dual-brain agent explorer --question "..."
 */

import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Model Mapping ─────────────────────────────────────────────────────────

/** Maps tier name → Claude model ID */
const TIER_MODELS = {
  search:  'claude-haiku-4-5',
  execute: 'claude-sonnet-4-5',
  think:   'claude-opus-4-5',
};

// ─── Template Definitions ──────────────────────────────────────────────────

/**
 * Built-in agent templates.
 *
 * Fields:
 *   name            - unique slug (also used as CLI argument)
 *   tier            - search | execute | think
 *   model           - haiku | sonnet | opus  (short form, for display)
 *   risk            - low | medium | high | critical
 *   quality_gate    - self_check | review_recommended | dual_brain_review
 *   description     - one-line shown in --list
 *   output_contract - array of items the agent MUST return
 *   flags           - { '--flag': { required, description } }
 *   prompt_template - string with {var} tokens OR function(args) → string
 */
export const TEMPLATES = {
  explorer: {
    name: 'explorer',
    tier: 'search',
    model: 'haiku',
    risk: 'low',
    quality_gate: 'self_check',
    description: 'Read-only codebase exploration — find files, symbols, and patterns',
    output_contract: [
      'files found (with line numbers)',
      'key symbols/functions discovered',
      'confidence level (high/medium/low)',
      'areas you did NOT check',
    ],
    flags: {
      '--question': { required: true,  description: 'What to explore or find' },
      '--scope':    { required: false, description: 'Limit search to a path (e.g. src/auth)' },
    },
    prompt_template:
      'You are a codebase exploration agent. Your task: {question}. ' +
      '{scope ? \'Focus on: \' + scope : \'Search the entire codebase.\'}. ' +
      'Return a structured report with: ' +
      '1) Files found (with line numbers), ' +
      '2) Key symbols/functions discovered, ' +
      '3) Confidence level (high/medium/low), ' +
      '4) Areas you did NOT check. ' +
      'Do not modify any files.',
  },

  'security-review': {
    name: 'security-review',
    tier: 'think',
    model: 'opus',
    risk: 'high',
    quality_gate: 'dual_brain_review',
    description: 'Security audit agent — OWASP Top 10 scan with severity-filtered findings',
    output_contract: [
      'vulnerabilities found (severity)',
      'recommendations',
      'files reviewed',
      'OWASP categories checked',
    ],
    flags: {
      '--scope':    { required: false, description: 'Path to audit (e.g. src/auth); defaults to entire codebase' },
      '--severity': { required: false, description: 'Minimum severity to report: critical|high|medium|low' },
    },
    prompt_template:
      'You are a security review agent. ' +
      'Audit {scope || \'the current codebase\'} for vulnerabilities. ' +
      'Check OWASP Top 10 categories. ' +
      'For each finding report: severity (critical/high/medium/low), file and line, description, remediation. ' +
      '{severity ? \'Only report \' + severity + \' severity and above.\' : \'\'} ' +
      'Do not modify any files.',
  },

  'test-writer': {
    name: 'test-writer',
    tier: 'execute',
    model: 'sonnet',
    risk: 'medium',
    quality_gate: 'review_recommended',
    description: 'Test generation agent — comprehensive tests with edge cases',
    output_contract: [
      'test files created',
      'coverage areas',
      'edge cases covered',
      'assumptions made',
    ],
    flags: {
      '--file':      { required: true,  description: 'Source file to generate tests for (e.g. src/api.ts)' },
      '--framework': { required: false, description: 'Test framework to use (e.g. jest); auto-detect if omitted' },
    },
    prompt_template:
      'You are a test writing agent. Generate comprehensive tests for {file}. ' +
      '{framework ? \'Use \' + framework + \' framework.\' : \'Auto-detect the test framework from the project.\'} ' +
      'Cover: happy path, edge cases, error handling, boundary conditions. ' +
      'Create the test file adjacent to the source. ' +
      'Return: files created, test count, coverage areas, assumptions made.',
  },

  'bug-hunter': {
    name: 'bug-hunter',
    tier: 'execute',
    model: 'sonnet',
    risk: 'medium',
    quality_gate: 'review_recommended',
    description: 'Bug finding agent — logic errors, race conditions, edge cases',
    output_contract: [
      'bugs found (severity)',
      'reproduction steps',
      'suggested fixes',
      'files examined',
    ],
    flags: {
      '--area':  { required: true,  description: 'Code area to hunt bugs in (e.g. payments)' },
      '--depth': { required: false, description: 'Analysis depth: normal (default) or deep' },
    },
    prompt_template:
      'You are a bug hunting agent. ' +
      'Search {area} for bugs, logic errors, race conditions, and edge cases. ' +
      '{depth === \'deep\' ? \'Do an exhaustive analysis including data flow tracing.\' : \'Focus on the most likely problem areas.\'} ' +
      'For each bug found report: severity, file and line, description, reproduction scenario, suggested fix. ' +
      'Do not modify any files.',
  },
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Return the template object for the given name, or null if not found.
 * @param {string} name
 * @returns {object|null}
 */
export function getTemplate(name) {
  return TEMPLATES[name] ?? null;
}

/**
 * Return a summary list of all templates.
 * @returns {{name: string, description: string, tier: string, risk: string, quality_gate: string, model: string}[]}
 */
export function listTemplates() {
  return Object.values(TEMPLATES).map(({ name, description, tier, risk, quality_gate, model }) => ({
    name,
    description,
    tier,
    model,
    risk,
    quality_gate,
  }));
}

/**
 * Build an agent prompt config by interpolating flags into the prompt template.
 *
 * Supports both string templates (with {var} tokens that may contain JS
 * expressions) and function templates (legacy, for backwards compatibility).
 *
 * @param {string} templateName
 * @param {Record<string, string>} flags  e.g. { question: 'where is auth?', scope: 'src/auth' }
 * @returns {{ prompt, model, description, risk, quality_gate, tier, output_contract }|null}
 */
export function buildAgentPrompt(templateName, flags = {}) {
  const tmpl = getTemplate(templateName);
  if (!tmpl) return null;

  const {
    question  = '',
    scope     = '',
    severity  = '',
    framework = '',
    file      = '',
    area      = '',
    depth     = 'normal',
    context   = '',
  } = flags;

  let prompt;

  if (typeof tmpl.prompt_template === 'function') {
    // Legacy function-style template
    prompt = tmpl.prompt_template({ question, scope, severity, framework, file, area, depth, context });
  } else {
    // String template: replace {expr} tokens with evaluated JS expressions.
    // We convert {expr} → ${expr} and evaluate via template literal inside a
    // Function scope that has all flag vars bound. Fallback to naive {var}
    // replacement if the Function evaluation throws.
    try {
      // eslint-disable-next-line no-new-func
      const interpolate = new Function(
        'question', 'scope', 'severity', 'framework', 'file', 'area', 'depth', 'context',
        // Escape backticks and backslashes in the template before wrapping
        `return \`${tmpl.prompt_template
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\{/g, '${')
        }\`;`
      );
      prompt = interpolate(question, scope, severity, framework, file, area, depth, context);
    } catch {
      // Fallback: naive {var} token replacement
      prompt = tmpl.prompt_template
        .replace(/\{question\}/g, question)
        .replace(/\{scope\}/g,    scope)
        .replace(/\{severity\}/g, severity)
        .replace(/\{framework\}/g, framework)
        .replace(/\{file\}/g,     file)
        .replace(/\{area\}/g,     area)
        .replace(/\{depth\}/g,    depth)
        .replace(/\{context\}/g,  context);
    }
  }

  // Normalise whitespace
  prompt = prompt.replace(/\s+/g, ' ').trim();

  const modelId = TIER_MODELS[tmpl.tier] || TIER_MODELS.execute;

  return {
    prompt,
    model: modelId,
    description: tmpl.description,
    risk: tmpl.risk,
    quality_gate: tmpl.quality_gate,
    tier: tmpl.tier,
    output_contract: tmpl.output_contract || [],
  };
}

/**
 * Legacy compat: build just the prompt string.
 * Use buildAgentPrompt() for new code.
 * @param {string} templateName
 * @param {object} args
 * @returns {string}
 */
export function buildPrompt(templateName, args = {}) {
  const template = getTemplate(templateName);
  if (!template) throw new Error(`Unknown template: ${templateName}`);
  if (typeof template.prompt_template === 'function') {
    return template.prompt_template(args);
  }
  const config = buildAgentPrompt(templateName, args);
  return config ? config.prompt : '';
}

// ─── CLI Helpers ────────────────────────────────────────────────────────────

function parseCliFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') { flags.list = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function printTable(templates) {
  const TIER_ICON = { search: '🔍', execute: '⚙️ ', think: '🧠' };
  const RISK_ICON = { low: '🟢', medium: '🟡', high: '🔴', critical: '🚨' };

  const maxName = Math.max(...templates.map(t => t.name.length), 14);
  const hr = '─'.repeat(maxName + 8 + 10 + 55);

  console.log('');
  console.log('  🧠 dual-brain — Agent Templates');
  console.log(`  ${hr}`);
  console.log(`  ${'Template'.padEnd(maxName)}  ${'Tier'.padEnd(9)}  ${'Risk'.padEnd(8)}  Description`);
  console.log(`  ${hr}`);

  for (const t of templates) {
    const tierLabel = (TIER_ICON[t.tier] || '  ') + ' ' + t.tier;
    const riskLabel = (RISK_ICON[t.risk] || '  ') + ' ' + t.risk;
    console.log(
      `  ${t.name.padEnd(maxName)}  ${tierLabel.padEnd(12)}  ${riskLabel.padEnd(11)}  ${t.description}`
    );
  }

  console.log(`  ${hr}`);
  console.log('');
  console.log('  Usage:');
  console.log('    npx dual-brain agent <template> [flags]');
  console.log('    npx dual-brain agent explorer --question "where is auth handled?"');
  console.log('    npx dual-brain agent security-review --scope src/auth --severity high');
  console.log('    npx dual-brain agent test-writer --file src/api.ts --framework jest');
  console.log('    npx dual-brain agent bug-hunter --area payments --depth deep');
  console.log('');
}

function printAgentConfig(config, templateName) {
  console.log('');
  console.log(`  Agent:        ${templateName}`);
  console.log(`  Tier:         ${config.tier}  →  model: ${config.model}`);
  console.log(`  Risk:         ${config.risk}`);
  console.log(`  Quality gate: ${config.quality_gate}`);
  console.log('');
  console.log('  Prompt:');
  console.log('  ' + '─'.repeat(60));
  const words = config.prompt.split(' ');
  let line = '  ';
  for (const w of words) {
    if ((line + w).length > 78) { console.log(line.trimEnd()); line = '  ' + w + ' '; }
    else line += w + ' ';
  }
  if (line.trim()) console.log(line.trimEnd());
  console.log('  ' + '─'.repeat(60));
  console.log('');
  if (config.output_contract && config.output_contract.length) {
    console.log('  Output contract (agent must return):');
    for (const item of config.output_contract) console.log(`    • ${item}`);
    console.log('');
  }
}

function runAgent(templateName, flags) {
  const tmpl = getTemplate(templateName);
  if (!tmpl) {
    console.error(`  Unknown template: ${templateName}`);
    console.error(`  Available: ${Object.keys(TEMPLATES).join(', ')}`);
    console.error(`  Run: npx dual-brain agents  to see all templates`);
    process.exit(1);
  }

  // Validate required flags
  const missing = Object.entries(tmpl.flags || {})
    .filter(([flagName, meta]) => meta.required && !flags[flagName.slice(2)])
    .map(([flagName, meta]) => `${flagName}  — ${meta.description}`);

  if (missing.length > 0) {
    console.error(`  Missing required flags for "${templateName}":`);
    for (const m of missing) console.error(`    ${m}`);
    process.exit(1);
  }

  const config = buildAgentPrompt(templateName, flags);

  console.log('');
  console.log(`  🧠 Spawning agent: ${templateName}`);
  console.log(`  Tier: ${config.tier} | Model: ${config.model} | Risk: ${config.risk}`);
  console.log('');

  const claudeWhich = spawnSync('which', ['claude'], { encoding: 'utf8' });
  const claudeBin = (claudeWhich.status === 0 && claudeWhich.stdout.trim())
    ? claudeWhich.stdout.trim()
    : 'claude';

  const claudeArgs = ['-p', config.prompt, '--model', config.model];

  console.log(`  Running: claude -p "<prompt>" --model ${config.model}`);
  console.log('');

  const { status } = spawnSync(claudeBin, claudeArgs, {
    stdio: 'inherit',
    cwd: resolve(process.cwd()),
    env: process.env,
  });

  process.exit(status ?? 0);
}

// ─── Main (direct execution only) ──────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const cliFlags = parseCliFlags(process.argv.slice(2));

  if (cliFlags.list) {
    printTable(listTemplates());
    process.exit(0);
  }

  // --template <name>  → build and print the agent prompt config (dry-run)
  if (cliFlags.template) {
    const config = buildAgentPrompt(cliFlags.template, cliFlags);
    if (!config) {
      console.error(`  Unknown template: ${cliFlags.template}`);
      console.error(`  Available: ${Object.keys(TEMPLATES).join(', ')}`);
      process.exit(1);
    }
    printAgentConfig(config, cliFlags.template);
    process.exit(0);
  }

  // --run <name>  → actually execute the agent
  if (cliFlags.run) {
    runAgent(cliFlags.run, cliFlags);
    // runAgent calls process.exit internally
  }

  // No recognised command
  console.log(`
  Usage:
    node agent-templates.mjs --list
    node agent-templates.mjs --template <name> [--flag value ...]
    node agent-templates.mjs --run <name> [--flag value ...]

  Templates: ${Object.keys(TEMPLATES).join(', ')}
  `);
  process.exit(0);
}
