#!/usr/bin/env node

/**
 * test.mjs — Integration test for NPX Cortex
 */

import { chef } from './src/chef.mjs';
import { detectEnvironment, getAvailableModels } from './src/providers/detect.mjs';
import { classifyTask } from './src/orchestrator/classify.mjs';

async function runTests() {
  console.log('🧪 NPX Cortex Integration Tests\n');

  // Test 1: Environment Detection
  console.log('1. Testing environment detection...');
  const env = detectEnvironment();
  const models = getAvailableModels(env);

  console.log(`   Claude: ${env.claude.installed ? '✓' : '❌'} installed, ${env.claude.authed ? '✓' : '❌'} authed`);
  console.log(`   Codex: ${env.codex.installed ? '✓' : '❌'} installed, ${env.codex.authed ? '✓' : '❌'} authed`);
  console.log(`   Models: ${models.worker.length} worker, ${models.ic.length} ic, ${models.manager.length} manager\n`);

  // Test 2: Task Classification
  console.log('2. Testing task classification...');
  const testTasks = [
    'What is 2+2?',
    'grep for TODO comments',
    'review the security architecture',
    'update the .env file'
  ];

  testTasks.forEach(task => {
    const classification = classifyTask(task);
    console.log(`   "${task}" → ${classification.tier} tier, ${classification.risk} risk`);
  });
  console.log();

  // Test 3: Simple Chef Orchestration
  console.log('3. Testing orchestration with simple math...');
  try {
    const context = {
      environment: env,
      availableModels: models,
      options: { timeoutMs: 30000 }
    };

    const result = await chef('What is 2+2? Just give me the number.', context);

    console.log(`   Success: ${result.success}`);
    console.log(`   Tier: ${result.tier}`);
    if (result.model) {
      console.log(`   Model: ${result.model.provider}/${result.model.model}`);
    }
    console.log(`   Output: ${result.output.substring(0, 100)}${result.output.length > 100 ? '...' : ''}`);
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  console.log('\n✅ Integration tests complete!');
}

runTests().catch(console.error);