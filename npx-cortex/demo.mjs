#!/usr/bin/env node

/**
 * demo.mjs — Non-interactive demo of NPX Cortex functionality
 */

import { chef } from './src/chef.mjs';
import { detectEnvironment, getAvailableModels } from './src/providers/detect.mjs';
import { addMessage } from './src/state/session.mjs';
import { getHandoffStats, getRecentHandoffs } from './src/orchestrator/handoffs.mjs';
import { getProviderStats } from './src/providers/select.mjs';

async function demo() {
  console.log('🎭 NPX Cortex Live Demo\n');

  const env = detectEnvironment();
  const models = getAvailableModels(env);

  const context = {
    environment: env,
    availableModels: models,
    options: { timeoutMs: 45000 }
  };

  const testCases = [
    {
      description: "Simple math (should complete at IC level)",
      task: "What is 15 + 27? Just give me the number."
    },
    {
      description: "Security-related task (should escalate to manager)",
      task: "How should I store API keys securely in my .env file?"
    },
    {
      description: "File lookup task (should work at worker/IC level)",
      task: "List all JavaScript files in this project"
    },
    {
      description: "High-risk auth change (should trigger manager review)",
      task: "fix the auth bug in src/auth.mjs and update the credential handling"
    },
    {
      description: "Complex refactoring (should test bounce-down pattern)",
      task: "refactor the entire billing system for better performance and add comprehensive test coverage"
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const { description, task } = testCases[i];

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Demo ${i + 1}: ${description}`);
    console.log(`${'='.repeat(60)}`);

    try {
      // Save user message to session
      addMessage('user', task);

      // Process with chef
      const result = await chef(task, context);

      // Save assistant response
      addMessage('assistant', result.output, {
        tier: result.tier,
        confidence: result.confidence,
        success: result.success
      });

      // Show results
      if (result.success) {
        console.log(`\n✅ SUCCESS - Completed by ${result.tier.toUpperCase()}`);
        if (result.model) {
          console.log(`🤖 Model: ${result.model.provider}/${result.model.model}`);
        }
        if (result.confidence !== null) {
          console.log(`🎯 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        }
        if (result.totalAttempts > 1) {
          console.log(`🔄 Escalations: ${result.totalAttempts - 1}`);
        }
        console.log(`\n📝 Response:\n${result.output}`);
      } else {
        console.log(`\n❌ FAILED - ${result.error || 'Unknown error'}`);
      }

    } catch (error) {
      console.log(`\n💥 ERROR: ${error.message}`);
    }

    console.log(`\n${'='.repeat(60)}`);

    if (i < testCases.length - 1) {
      console.log('\nWaiting 2 seconds before next test...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Show Phase 2 statistics
  console.log('\n📊 Phase 2 Smart Routing Statistics');
  console.log('─'.repeat(50));

  const handoffStats = getHandoffStats(1);
  console.log(`Total handoffs in session: ${handoffStats.total}`);
  console.log(`Average duration: ${handoffStats.avg_duration_ms}ms`);
  console.log(`Success rate: ${Math.round(handoffStats.success_rate * 100)}%`);

  if (Object.keys(handoffStats.by_operation).length > 0) {
    console.log(`Operations: ${JSON.stringify(handoffStats.by_operation)}`);
  }

  if (Object.keys(handoffStats.by_provider).length > 0) {
    console.log(`Provider usage: ${JSON.stringify(handoffStats.by_provider)}`);
  }

  const recentHandoffs = getRecentHandoffs(1);
  if (recentHandoffs.length > 0) {
    console.log(`\nRecent handoffs (last ${recentHandoffs.length}):`);
    for (const handoff of recentHandoffs.slice(0, 3)) {
      console.log(`  ${handoff.op}: ${handoff.from} → ${handoff.to} (${handoff.reason})`);
    }
  }

  console.log('\n🎉 Demo complete! Session saved to .cortex/sessions/current.jsonl');
  console.log('📋 Handoff audit trail saved to .cortex/handoffs.jsonl\n');
}

demo().catch(error => {
  console.error('Demo failed:', error);
  process.exit(1);
});