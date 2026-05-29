#!/usr/bin/env node

/**
 * test-enhanced-ux.mjs — Test the enhanced terminal UX
 */

import { displayError, displayWarning, displaySuccess } from './src/ui/errors.mjs';
import { createSpinner, HierarchicalProgress } from './src/ui/progress.mjs';
import { fmt, box, separator } from './src/ui/formatter.mjs';

console.log(box('🧪 NPX Cortex UX Demo', {
  borderColor: fmt.brightBlue(''),
  textColor: fmt.bold(''),
  padding: 1,
  margin: 1
}));

console.log(fmt.bold('Testing enhanced terminal UX components...\n'));

// Test 1: Error Display
console.log(fmt.bold('1. Error Display:'));
displayError(new Error('not authenticated'), {
  operation: 'AI request',
  model: { provider: 'claude', model: 'opus' },
  tier: 'manager'
});

// Test 2: Warning Display
console.log(fmt.bold('2. Warning Display:'));
displayWarning('Claude CLI found but not authenticated', {
  suggestion: 'Authentication required for full functionality',
  command: 'claude auth login'
});

// Test 3: Success Display
console.log(fmt.bold('3. Success Display:'));
displaySuccess('Authentication successful', {
  details: 'Claude Opus and Sonnet models are now available',
  nextStep: 'Run cortex to start AI orchestration'
});

// Test 4: Spinner Animation
console.log(fmt.bold('4. Progress Spinners:'));
const spinner = createSpinner('Testing spinner animation...');
spinner.start();

setTimeout(() => {
  spinner.updateText('Checking providers...');
}, 1000);

setTimeout(() => {
  spinner.updateText('Validating credentials...');
}, 2000);

setTimeout(() => {
  spinner.success('All systems ready!');
  continueDemo();
}, 3000);

function continueDemo() {
  console.log('');

  // Test 5: Hierarchical Progress
  console.log(fmt.bold('5. AI Orchestration Display:'));
  const orchestration = new HierarchicalProgress();

  // Simulate a complex AI workflow
  const workerId = orchestration.addAgent('worker-123', {
    tier: 'worker',
    text: 'WORKER: Finding relevant files',
    status: 'working'
  });

  setTimeout(() => {
    const icId = orchestration.addAgent('ic-456', {
      tier: 'ic',
      text: 'IC: Analyzing code structure',
      status: 'thinking'
    });

    setTimeout(() => {
      orchestration.escalate('ic-456', 'manager-789', 'manager', 'Complex architecture decisions needed');

      setTimeout(() => {
        const managerId = orchestration.agents.get('manager-789');
        orchestration.updateAgent('manager-789', {
          status: 'working',
          text: 'MANAGER: Designing solution architecture'
        });

        setTimeout(() => {
          orchestration.complete('worker-123', 'Files analyzed');
          orchestration.complete('ic-456', 'Code structure mapped');
          orchestration.complete('manager-789', 'Architecture design complete');

          setTimeout(() => {
            orchestration.finish();
            finalDemo();
          }, 1000);
        }, 2000);
      }, 1500);
    }, 1000);
  }, 1000);
}

function finalDemo() {
  console.log(fmt.bold('6. Visual Separators & Formatting:'));
  console.log(separator(60, '═', fmt.green('')));
  console.log(fmt.success('✅ Demo completed successfully'));
  console.log(separator(60, '─', fmt.dim('')));

  console.log('\n' + fmt.bold('7. Professional Command Output:'));
  console.log('');

  // Show mock banner
  const mockEnv = {
    claude: { installed: true, authed: true },
    codex: { installed: true, authed: false },
    hasProviders: true
  };

  const mockModels = {
    manager: [
      { provider: 'claude', model: 'opus' },
      { provider: 'openai', model: 'gpt-5.5' }
    ],
    ic: [
      { provider: 'claude', model: 'sonnet' },
      { provider: 'openai', model: 'gpt-5.4' }
    ],
    worker: [
      { provider: 'claude', model: 'haiku' },
      { provider: 'openai', model: 'gpt-4.1-mini' }
    ]
  };

  // This would normally be imported but we'll simulate it
  console.log(box('🧠 Cortex v0.2.0\nAI Org Chart in Your Shell', {
    borderColor: fmt.brightBlue(''),
    textColor: fmt.bold(''),
    padding: 1,
    margin: 0
  }));

  console.log(`  🟠 Claude ✅  🟢 Codex ⚠️`);
  console.log(fmt.green('  Claude ready') + fmt.dim(' · Add Codex authentication for dual-brain features'));
  console.log('');
  console.log(fmt.bold('Org Chart:'));
  console.log(`  👔 ${fmt.redBold('MANAGER')} ${fmt.dim('2 models')}`);
  console.log(`    ${fmt.dim('├─ claude/opus, openai/gpt-5.5')}`);
  console.log(`  👨‍💻 ${fmt.yellowBold('IC     ')} ${fmt.dim('2 models')}`);
  console.log(`    ${fmt.dim('├─ claude/sonnet, openai/gpt-5.4')}`);
  console.log(`  🏗️ ${fmt.blueBold('WORKER ')} ${fmt.dim('2 models')}`);
  console.log(`    ${fmt.dim('├─ claude/haiku, openai/gpt-4.1-mini')}`);

  console.log(`\n${fmt.dim('💡 Type your request and press Enter — AI will route automatically')}`);

  console.log('\n' + fmt.bold('🎉 Enhanced UX Demo Complete!'));
  console.log(fmt.dim('NPX Cortex is now ready with professional-grade terminal UX.'));
}