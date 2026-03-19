# @clawnet/elizaos

ClawNet plugin for [ElizaOS](https://elizaos.ai) — access 390+ AI APIs, the skill marketplace, and cryptographic receipts from any Eliza agent.

## Install

```bash
npm install @clawnet/elizaos
```

## Setup

1. Get an API key at [claw-net.org](https://claw-net.org)

2. Add to your `.env`:
```
CLAWNET_API_KEY=cn-xxxx
```

3. Add the plugin to your character config:
```json
{
  "name": "MyAgent",
  "plugins": ["@clawnet/elizaos"],
  "settings": {
    "secrets": {
      "CLAWNET_API_KEY": "cn-xxxx"
    }
  }
}
```

Or register programmatically:
```typescript
import { clawnetPlugin } from '@clawnet/elizaos';

const character = {
  plugins: [clawnetPlugin],
};
```

## Actions

### CLAWNET_ORCHESTRATE
Query ClawNet's AI orchestration engine. Automatically selects from 390+ APIs, executes multi-step workflows, and returns formatted answers.

```
User: What is the current price of SOL?
Agent: SOL is currently trading at $142.50... (1 API called | 3.2 credits used | 820ms)
```

### CLAWNET_INVOKE_SKILL
Invoke a specific marketplace skill by ID. Pass variables with `key=value` pairs.

```
User: Invoke skill vie-crypto-trust with token=SOL
Agent: Trust Score for SOL: 87/100... (Skill: vie-crypto-trust | Cost: 2.5 credits)
```

### CLAWNET_SEARCH
Search the skill marketplace to discover available capabilities.

```
User: Search for crypto price skills on ClawNet
Agent: Found 3 skills for "crypto price":
  1. sol-price-feed (ID: sol-price-feed) — 1.5 credits [solana, defi]
  2. vie-crypto-trust (ID: vie-crypto-trust) — 2.5 credits [crypto, trust]
  ...
```

## Example Conversation

```
User: Find me skills for sentiment analysis
Agent: Found 2 skills for "sentiment analysis":
  1. social-sentiment (ID: social-sentiment) — 2 credits [social, ai-ml]
  2. news-sentiment (ID: news-sentiment) — 1.5 credits [news, ai-ml]

User: Invoke skill social-sentiment with query=bitcoin,platform=twitter
Agent: Bitcoin Twitter Sentiment: 72% positive, 18% neutral, 10% negative...

User: What are the top trending tokens right now?
Agent: Based on current data, the top trending tokens are...
```

## Links

- [ClawNet Docs](https://claw-net.org/docs)
- [API Reference](https://claw-net.org/docs)
- [Get API Key](https://claw-net.org)
- [ElizaOS](https://elizaos.ai)
