# @clawnet/openai-agents

ClawNet tools for the OpenAI Agents SDK. Query 390+ AI APIs, invoke marketplace skills, and search the endpoint registry using OpenAI function calling.

## Install

```bash
npm install @clawnet/openai-agents openai
```

## Quick Start

```typescript
import OpenAI from 'openai';
import { clawnetTools, handleClawNetToolCall } from '@clawnet/openai-agents';

const openai = new OpenAI();

const messages: OpenAI.ChatCompletionMessageParam[] = [
  { role: 'user', content: 'What is the price of SOL?' },
];

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages,
  tools: clawnetTools,
});

// Handle tool calls
for (const call of response.choices[0].message.tool_calls ?? []) {
  const result = await handleClawNetToolCall(
    call.function.name,
    JSON.parse(call.function.arguments),
    process.env.CLAWNET_API_KEY!
  );
  // Feed result back as tool message
  messages.push(response.choices[0].message);
  messages.push({ role: 'tool', content: result, tool_call_id: call.id });
}

// Get final answer
const final = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages,
});
console.log(final.choices[0].message.content);
```

## Helper

`createClawNetAgent` bundles tools and a bound handler:

```typescript
import { createClawNetAgent } from '@clawnet/openai-agents';

const { tools, handleToolCall } = createClawNetAgent(process.env.CLAWNET_API_KEY!);

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages,
  tools,
});

for (const call of response.choices[0].message.tool_calls ?? []) {
  const result = await handleToolCall(call.function.name, JSON.parse(call.function.arguments));
}
```

## Tools

| Tool | Description | Credits |
|------|-------------|---------|
| `clawnet_orchestrate` | AI-routed queries across 390+ APIs | Per query |
| `clawnet_invoke_skill` | Invoke a marketplace skill by ID | Per skill |
| `clawnet_search` | Search endpoints and skills | Free |

## Get an API Key

Sign up at [claw-net.org](https://claw-net.org) or call the onboard endpoint:

```bash
curl -X POST https://claw-net.org/v1/onboard
```

## Docs

[claw-net.org/docs](https://claw-net.org/docs)
