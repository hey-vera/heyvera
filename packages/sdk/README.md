# @clawnet/sdk

TypeScript SDK for the [ClawNet](https://claw-net.org) AI agent orchestration API.

Zero dependencies. Works in Node.js 18+ and any runtime with a global `fetch`.

## Install

```bash
npm install @clawnet/sdk
```

## Quick Start

```typescript
import { ClawNet } from '@clawnet/sdk';

const claw = new ClawNet({ apiKey: 'cn-xxxx' });

// Orchestrate a query (AI selects the best API endpoints)
const result = await claw.orchestrate('What is the price of SOL?');
console.log(result.answer);
console.log(`Cost: ${result.totalCredits} credits`);
```

## Configuration

```typescript
const claw = new ClawNet({
  apiKey: 'cn-xxxx',           // Required - your ClawNet API key
  baseUrl: 'https://claw-net.org', // Optional - defaults to production
  cache: 'smart',             // Optional - 'prefer' | 'fresh' | 'smart'
  diff: false,                // Optional - return diffs for changed data
});
```

## Methods

### Core

```typescript
// Orchestrate with budget control
const result = await claw.orchestrate('SOL price', {
  maxCredits: 5,
  strategy: 'cheapest', // 'cheapest' | 'balanced' | 'fastest' | 'reliable'
});

// Estimate cost before running
const estimate = await claw.estimate('SOL price history');

// Check your balance
const balance = await claw.getBalance();
```

### Skills

```typescript
// List available skills (with optional filters)
const skills = await claw.listSkills({ tag: 'defi', type: 'data' });

// Invoke a prompt skill
const invoke = await claw.invokeSkill('skill-id', { token: 'SOL' });

// Query a data skill
const data = await claw.queryDataSkill('skill-id', { chain: 'solana' });
```

### Discovery

```typescript
// Search for skills by natural language
const found = await claw.discover('DeFi yield farming');

// Get personalized recommendations
const recs = await claw.getRecommendations();

// Browse trending skills
const trending = await claw.getTrending();
```

### Economy

```typescript
// Transfer credits to another key
await claw.transferCredits('cn-recipient-key', 100);

// Get transaction receipts (with cryptographic hashes)
const receipts = await claw.getReceipts(10);
```

### Cache

```typescript
// View cache performance
const stats = await claw.getCacheStats();

// Get TTL optimization suggestions
const suggestions = await claw.getCacheOptimizer();
```

### Static Methods (No Auth Required)

```typescript
// Self-service onboarding - get an API key
const { apiKey, credits } = await ClawNet.onboard({
  name: 'My Agent',
  email: 'agent@example.com',
});

// Fetch the API manifest
const manifest = await ClawNet.getManifest();
```

## Error Handling

```typescript
import { ClawNet, ClawNetError } from '@clawnet/sdk';

try {
  await claw.orchestrate('query');
} catch (err) {
  if (err instanceof ClawNetError) {
    console.error(`${err.code}: ${err.message} (HTTP ${err.status})`);
  }
}
```

## x402 Mode

ClawNet supports the x402 payment protocol for pay-per-call API access using USDC on Solana. Surcharges are automatically handled server-side -- no SDK changes needed.

## Documentation

Full API reference: [https://claw-net.org/docs](https://claw-net.org/docs)
