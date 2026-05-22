#!/usr/bin/env node
/**
 * agent-chains.mjs — Opinionated multi-step agent workflows.
 *
 * Three built-in chains that map to how developers actually work:
 *
 *   explore-then-fix   — Understand the problem, then fix it
 *   review-and-test    — Review the code, then write tests for weak spots
 *   audit-and-plan     — Audit the architecture, then create an execution plan
 *
 * Each chain:
 *   1. Prints a banner showing the steps
 *   2. Runs step 1 (capture output)
 *   3. Prints step 1 results
 *   4. Asks for confirmation (or auto-continues with --yes)
 *   5. Runs step 2 with step 1 output as context
 *   6. Prints final results
 *
 * Export: getChain(name), listChains()
 * CLI: node agent-chains.mjs --list
 *      node agent-chains.mjs --run <chain> [flags]
 */

import { spawnSync } from 'child_process';
import { createInterface } from 'readline';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_SCRIPT = resolve(__dirname, 'agent-templates.mjs');

// ─── Chain Definitions ─────────────────────────────────────────────────────

/**
 * Built-in chains.
 *
 * Each chain has:
 *   name        - unique identifier
 *   description - one-line description
 *   steps       - array of step descriptors
 *     step.label       - human-readable step label
 *     step.template    - agent-templates.mjs template name
 *     step.tier        - search | execute | think
 *     step.model       - haiku | sonnet | opus
 *     step.args        - function(flags, prevOutput) → args object for the template
 *     step.stop_after  - if true, pause here for confirmation before continuing
 *     step.stop_label  - label for the stop-point prompt
 */
export const CHAINS = {
  'explore-then-fix': {
    name: 'explore-then-fix',
    description: 'Understand the problem, then fix it',
    steps: [
      {
        label: 'Step 1: Explore',
        template: 'explorer',
        tier: 'search',
        model: 'haiku',
        args: (flags) => ({
          question: flags.question,
          scope: flags.scope,
        }),
        stop_after: true,
        stop_label: 'Exploration complete. Review findings above, then confirm the fix.',
      },
      {
        label: 'Step 2: Fix',
        template: 'bug-hunter',
        tier: 'execute',
        model: 'sonnet',
        args: (flags, prevOutput) => ({
          question: flags.question,
          scope: flags.scope,
          context: prevOutput,
        }),
      },
    ],
  },

  'review-and-test': {
    name: 'review-and-test',
    description: 'Review the code, then write tests for weak spots',
    steps: [
      {
        label: 'Step 1: Security Review',
        template: 'security-review',
        tier: 'think',
        model: 'opus',
        args: (flags) => ({
          scope: flags.scope,
          file: flags.file,
        }),
        stop_after: true,
        stop_label: 'Review complete. Review findings above, then confirm test writing.',
      },
      {
        label: 'Step 2: Write Tests',
        template: 'test-writer',
        tier: 'execute',
        model: 'sonnet',
        args: (flags, prevOutput) => ({
          scope: flags.scope,
          file: flags.file,
          context: prevOutput,
        }),
      },
    ],
  },

  'audit-and-plan': {
    name: 'audit-and-plan',
    description: 'Audit the architecture, then create an execution plan',
    steps: [
      {
        label: 'Step 1: Architecture Audit',
        template: 'explorer',
        tier: 'search',
        model: 'haiku',
        args: (flags) => ({
          question: flags.question,
          scope: flags.scope,
        }),
        stop_after: true,
        stop_label: 'Audit complete. Review findings above, then confirm planning.',
      },
      {
        label: 'Step 2: Create Plan',
        template: null, // Think tier — runs via plan-generator concept inline
        tier: 'think',
        model: 'opus',
        args: (flags, prevOutput) => ({
          question: flags.question,
          scope: flags.scope,
          context: prevOutput,
        }),
        // Uses a custom prompt builder instead of an agent template
        custom_prompt: (flags, prevOutput) => {
          const scopeLine = flags.scope ? `\nScope: ${flags.scope}` : '';
          return [
            `You are an architect. Based on the audit findings below, create a detailed execution plan.`,
            ``,
            `Question / Goal: ${flags.question || 'Improve the architecture based on audit findings'}`,
            scopeLine,
            ``,
            `Audit findings:`,
            prevOutput,
            ``,
            `Produce a structured plan with:`,
            `- Decision: the recommended approach`,
            `- Rationale: why this approach over alternatives`,
            `- Alternatives considered (and why rejected)`,
            `- Risks and mitigations`,
            `- Verification plan: how to confirm success`,
            `- Task table: dependency-ordered list of concrete tasks with tier/risk`,
          ].join('\n');
        },
      },
    ],
  },
};

// ─── Exports ───────────────────────────────────────────────────────────────

/**
 * Get a chain by name. Returns null if not found.
 */
export function getChain(name) {
  return CHAINS[name] || null;
}

/**
 * List all chains as { name, description, steps }.
 */
export function listChains() {
  return Object.values(CHAINS).map(({ name, description, steps }) => ({
    name,
    description,
    steps: steps.map(s => ({
      label: s.label,
      template: s.template,
      tier: s.tier,
      model: s.model,
    })),
  }));
}

// ─── Chain Execution ───────────────────────────────────────────────────────

function banner(chain) {
  const width = 60;
  const line = '─'.repeat(width);
  console.log(`\n  ${line}`);
  console.log(`  Chain: ${chain.name} — ${chain.description}`);
  console.log(`  ${line}`);
  for (let i = 0; i < chain.steps.length; i++) {
    const s = chain.steps[i];
    const model = s.model || (s.tier === 'think' ? 'opus' : s.tier === 'search' ? 'haiku' : 'sonnet');
    const tmpl = s.template || 'custom';
    console.log(`    ${i + 1}. ${s.label}  [${s.tier} / ${model} / ${tmpl}]`);
  }
  console.log(`  ${line}\n`);
}

function separator(label) {
  const width = 60;
  const line = '─'.repeat(width);
  console.log(`\n  ${line}`);
  if (label) console.log(`  ${label}`);
  console.log(`  ${line}\n`);
}

function runTemplate(templateName, templateArgs) {
  const argsList = ['--run', templateName];
  if (templateArgs.question) argsList.push('--question', templateArgs.question);
  if (templateArgs.scope)    argsList.push('--scope', templateArgs.scope);
  if (templateArgs.file)     argsList.push('--file', templateArgs.file);
  if (templateArgs.context)  argsList.push('--context', templateArgs.context);

  const result = spawnSync(process.execPath, [TEMPLATES_SCRIPT, ...argsList], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    timeout: 30_000,
  });

  return {
    output: result.stdout || '',
    status: result.status,
    stderr: result.stderr || '',
  };
}

function runCustomStep(step, flags, prevOutput) {
  const prompt = step.custom_prompt(flags, prevOutput);
  const model = step.model || 'opus';
  const tier = step.tier || 'think';

  console.log(`\n  [${step.label}] tier=${tier} model=${model} custom\n`);
  console.log('─'.repeat(60));
  console.log(prompt);
  console.log('─'.repeat(60));

  return {
    output: prompt,
    status: 0,
  };
}

async function askConfirmation(stopLabel) {
  console.log(`\n  ${stopLabel}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('\n  Continue to step 2? [Y/n] ', (answer) => {
      rl.close();
      const ans = answer.trim().toLowerCase();
      resolve(ans === '' || ans === 'y' || ans === 'yes');
    });
  });
}

async function executeChain(chain, flags) {
  banner(chain);

  let prevOutput = '';

  for (let i = 0; i < chain.steps.length; i++) {
    const step = chain.steps[i];
    const isLast = i === chain.steps.length - 1;

    console.log(`\n  Running ${step.label}...`);

    let result;
    if (step.template) {
      const templateArgs = step.args(flags, prevOutput);
      result = runTemplate(step.template, templateArgs);
    } else if (step.custom_prompt) {
      result = runCustomStep(step, flags, prevOutput);
    } else {
      console.error(`  Step "${step.label}" has no template or custom_prompt.`);
      process.exit(1);
    }

    if (result.status !== 0) {
      console.error(`\n  Step failed (exit ${result.status}). Chain aborted.`);
      process.exit(result.status || 1);
    }

    // Print step output
    separator(`Results: ${step.label}`);
    if (result.output.trim()) {
      console.log(result.output);
    } else {
      console.log('  (no output)');
    }

    prevOutput = result.output;

    // Stop point: ask for confirmation before next step
    if (step.stop_after && !isLast) {
      if (flags.yes) {
        console.log(`\n  [--yes] Auto-continuing to next step...`);
      } else {
        const confirmed = await askConfirmation(step.stop_label || `Step ${i + 1} complete.`);
        if (!confirmed) {
          console.log('\n  Aborted by user. Findings saved above.\n');
          process.exit(0);
        }
      }
    }
  }

  separator('Chain Complete');
  console.log('  All steps finished. Review results above.\n');
}

// ─── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = { yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list')          flags.list = true;
    else if (a === '--run')      flags.run = argv[++i];
    else if (a === '--question') flags.question = argv[++i];
    else if (a === '--scope')    flags.scope = argv[++i];
    else if (a === '--file')     flags.file = argv[++i];
    else if (a === '--yes' || a === '-y') flags.yes = true;
  }
  return flags;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.list) {
    console.log('\n  Agent Chains:\n');
    for (const c of listChains()) {
      console.log(`    ${c.name.padEnd(22)} ${c.description}`);
      for (const s of c.steps) {
        const tmpl = s.template || 'custom';
        console.log(`      ${s.label.padEnd(30)} [${s.tier}/${s.model}/${tmpl}]`);
      }
      console.log('');
    }
    process.exit(0);
  }

  if (flags.run) {
    const chain = getChain(flags.run);
    if (!chain) {
      console.error(`  Unknown chain: ${flags.run}`);
      console.error(`  Available: ${Object.keys(CHAINS).join(', ')}`);
      process.exit(1);
    }

    executeChain(chain, flags).catch((err) => {
      console.error(`  Chain error: ${err.message}`);
      process.exit(1);
    });
  } else {
    console.log(`
  Usage:
    node agent-chains.mjs --list
    node agent-chains.mjs --run explore-then-fix --question "what's wrong with auth" [--scope "src/auth"] [--yes]
    node agent-chains.mjs --run review-and-test [--scope "src/api"] [--file "src/api.ts"] [--yes]
    node agent-chains.mjs --run audit-and-plan --question "how should we restructure auth" [--scope "src/"] [--yes]
    `);
    process.exit(0);
  }
}
