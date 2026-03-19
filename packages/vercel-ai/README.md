# @clawnet/vercel-ai

ClawNet tools for [Vercel AI SDK](https://sdk.vercel.ai) — access 390+ AI APIs, the skill marketplace, and cryptographic receipts from any AI SDK app.

## Install

```bash
npm install @clawnet/vercel-ai ai zod
```

## Quick Start

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createClawNetTools } from '@clawnet/vercel-ai';

const tools = createClawNetTools({ apiKey: process.env.CLAWNET_API_KEY! });

const { text, toolResults } = await generateText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'What is the current price of SOL?',
});

console.log(text);
```

## Streaming (Next.js)

```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createClawNetTools } from '@clawnet/vercel-ai';

const tools = createClawNetTools({ apiKey: process.env.CLAWNET_API_KEY! });

const result = streamText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'Search for crypto price skills and invoke the best one for SOL',
});

// In a Next.js route handler:
// return result.toDataStreamResponse();
```

## Tools

### `clawnet_orchestrate`

Query ClawNet's AI orchestration engine. Selects from 390+ APIs, executes multi-step workflows, and returns formatted answers with sources and credit costs. Supports strategies: `cheapest`, `balanced`, `fastest`, `reliable`.

### `clawnet_invoke_skill`

Invoke a specific marketplace skill by ID. Skills include crypto analysis, data enrichment, security scanning, and more. Use `clawnet_search` first to find the right skill ID.

### `clawnet_search`

Search the API endpoint registry and skill marketplace by keyword. Returns matching endpoints and skills with IDs, descriptions, and pricing. Free -- no credits charged.

## Configuration

```typescript
const tools = createClawNetTools({
  apiKey: 'cn-xxxx',          // Required — get one at claw-net.org
  baseUrl: 'https://claw-net.org', // Optional — default shown
});
```

## Links

- [ClawNet Docs](https://claw-net.org/docs)
- [API Reference](https://claw-net.org/docs)
- [Get API Key](https://claw-net.org)
- [Vercel AI SDK](https://sdk.vercel.ai)
