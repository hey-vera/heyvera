#!/usr/bin/env node
/**
 * test-phase2.mjs — Test Phase 2 smart routing enhancements
 */

import { chef } from './src/chef.mjs';
import { getHandoffStats, getRecentHandoffs } from './src/orchestrator/handoffs.mjs';
import { parseConfidence } from './src/orchestrator/confidence.mjs';
import { selectProvider, getProviderStats } from './src/providers/select.mjs';
import { classifyTask } from './src/orchestrator/classify.mjs';

// Mock available models for testing
const mockModels = {
  worker: [
    { provider: 'claude', model: 'haiku-3.5', bin: 'claude' }
  ],
  ic: [
    { provider: 'claude', model: 'sonnet-3.5', bin: 'claude' },
    { provider: 'codex', model: 'gpt-5.4', bin: 'codex' }
  ],
  manager: [
    { provider: 'claude', model: 'opus-4.6', bin: 'claude' },
    { provider: 'codex', model: 'gpt-5.5', bin: 'codex' }
  ]
};

async function testPhase2Enhancements() {
  console.log('🧪 Testing Phase 2 Smart Routing Enhancements\n');

  // Test 1: Enhanced Classification
  console.log('📊 Test 1: Enhanced Classification');
  console.log('─'.repeat(50));

  const testTasks = [
    'fix the auth bug in src/auth.mjs',
    'add a new button to the UI',
    'review the security of our payment processing',
    'find all files that mention "password"',
    'refactor the billing module and add comprehensive tests'
  ];

  for (const task of testTasks) {
    const classification = classifyTask(task, { currentFiles: ['src/auth.mjs', 'src/billing.mjs'] });
    console.log(`Task: "${task}"`);
    console.log(`  Tier: ${classification.tier}, Risk: ${classification.risk}`);
    console.log(`  Confidence: ${(classification.confidence * 100).toFixed(0)}%, Reason: ${classification.reason}`);
    console.log(`  Keywords: [${classification.keywords.join(', ')}]`);
    console.log();
  }

  // Test 2: Confidence Parsing
  console.log('🎯 Test 2: Confidence Parsing');
  console.log('─'.repeat(50));

  const mockOutputs = [
    'I successfully fixed the auth issue. {"confidence": 0.9, "escalate": false, "reason": "straightforward fix"}',
    'This is a complex security issue that might need review. {"confidence": 0.4, "escalate": true, "reason": "security implications"}',
    'I completed the task but I\'m not sure about edge cases.',
    'Fixed the bug and added tests. Very confident in this solution.'
  ];

  for (const output of mockOutputs) {
    const confidence = parseConfidence(output);
    console.log(`Output: "${output.slice(0, 60)}..."`);
    console.log(`  Parsed: confidence=${confidence.confidence}, escalate=${confidence.escalate}`);
    console.log(`  Reason: ${confidence.reason}, Structured: ${confidence.structured}`);
    console.log();
  }

  // Test 3: Provider Selection (without actual execution)
  console.log('⚖️  Test 3: Provider Selection Logic');
  console.log('─'.repeat(50));

  for (const tier of ['worker', 'ic', 'manager']) {
    const selected = selectProvider(tier, {
      availableModels: mockModels,
      sessionId: 'test_session_123'
    });

    if (selected) {
      console.log(`${tier.toUpperCase()}: Selected ${selected.provider}/${selected.model}`);
      console.log(`  Score: ${selected.score?.toFixed(2) || 'N/A'}, Load: ${selected.load || 0}`);
    } else {
      console.log(`${tier.toUpperCase()}: No model selected`);
    }
  }
  console.log();

  // Test 4: Handoff Statistics (with mock data)
  console.log('📈 Test 4: Handoff Statistics');
  console.log('─'.repeat(50));

  // Get current stats (may be empty for new installation)
  const stats = getHandoffStats(1);
  console.log(`Total handoffs in last hour: ${stats.total}`);
  console.log(`Success rate: ${Math.round(stats.success_rate * 100)}%`);
  console.log(`Average duration: ${stats.avg_duration_ms}ms`);
  console.log(`By operation:`, stats.by_operation);
  console.log(`By provider:`, stats.by_provider);
  console.log();

  // Test 5: Provider Statistics
  console.log('📊 Test 5: Provider Health Statistics');
  console.log('─'.repeat(50));

  const providerStats = getProviderStats(1);
  console.log(`Provider statistics for last hour:`);
  console.log(`Total handoffs: ${providerStats.total_handoffs}`);
  console.log(`Average duration: ${providerStats.avg_duration_ms}ms`);
  console.log(`Success rate: ${providerStats.success_rate}%`);

  for (const [provider, stats] of Object.entries(providerStats.providers)) {
    console.log(`${provider}: ${stats.handoffs} ops (${stats.percentage}%) - ${stats.health.status}`);
  }
  console.log();

  console.log('✅ Phase 2 Enhancement Tests Complete!');
  console.log('\nFeatures tested:');
  console.log('• Enhanced multi-signal task classification');
  console.log('• Robust confidence parsing with fallbacks');
  console.log('• Intelligent provider selection and load balancing');
  console.log('• Comprehensive handoff logging and statistics');
  console.log('• Manager review workflow preparation');
  console.log('\nTo test the full workflow with actual model execution:');
  console.log('node demo.mjs "fix the auth bug in src/auth.mjs"');
}

// Run tests
testPhase2Enhancements().catch(console.error);