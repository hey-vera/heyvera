import { Hono } from 'hono';
import { env } from '../config/index';
import { listPublicSkills, safeJsonParse } from '../db/index';

const router = new Hono();

function buildLlmsTxt(baseUrl: string): string {
  return `# ClawNet
> Universal AI agent orchestration layer with 344+ API endpoints, skill marketplace, and x402 payment support.

Base URL: ${baseUrl}
Version: 1.0.0
Docs: https://claw-net.org

## Core Endpoints

- POST ${baseUrl}/v1/orchestrate — natural language -> multi-step API orchestration
- GET ${baseUrl}/v1/estimate — pre-flight cost estimation (no auth required)
- POST ${baseUrl}/v1/batch — parallel multi-query execution (up to 10)
- GET ${baseUrl}/v1/stream/orchestrate — streaming orchestration via SSE
- POST ${baseUrl}/v1/llm/prompt — direct LLM prompting
- POST ${baseUrl}/v1/swarm — multi-agent decomposition

## Skill Marketplace

- GET ${baseUrl}/v1/marketplace/skills — browse skills (search, sort, category filters)
- GET ${baseUrl}/v1/marketplace/skills/:id — skill details with trust signals
- POST ${baseUrl}/v1/skills/:id/invoke — invoke a skill
- POST ${baseUrl}/v1/skills/:id/query — query data skills
- GET ${baseUrl}/v1/skills/:id/mcp — MCP tool manifest
- GET ${baseUrl}/v1/skills/:id/openapi — OpenAPI spec per skill

## x402 Payment

Pay-per-call via USDC micropayments. No account or API key needed.

- GET ${baseUrl}/x402 — x402 discovery (provider info, supported networks)
- GET ${baseUrl}/x402/skills — list skills with USDC pricing
- POST ${baseUrl}/x402/skills/:id — invoke skill via x402 (USDC on Base)
- GET ${baseUrl}/x402/verify/:requestId — receipt verification

## Economy

- POST ${baseUrl}/v1/economy/keys/budget-account — create agent budget accounts (daily/weekly limits)
- POST ${baseUrl}/v1/economy/gift — credit gifting (max 50k)
- GET ${baseUrl}/v1/economy/receipts/:id — cryptographic receipts (SHA-256 hashes)
- POST ${baseUrl}/v1/economy/webhooks — event webhooks (SKILL_INVOKED, CREDIT_LOW, SLA_VIOLATED)
- POST ${baseUrl}/v1/economy/scheduled-skills — scheduled skill execution (cron-based)

## Discovery

- GET ${baseUrl}/v1/endpoints — browse 344+ API endpoints
- GET ${baseUrl}/v1/discover — semantic search (Trinity engine: semantic + p2p + onchain)
- GET ${baseUrl}/v1/registry — live endpoint registry with health status
- GET ${baseUrl}/v1/recommendations — personalized recommendations
- GET ${baseUrl}/v1/skills?tag=X — tag-based skill filtering
- GET ${baseUrl}/v1/skills/:id/similar — similar skills (vector similarity)

## Authentication

Three authentication methods:

- API Key: header \`X-API-Key: cn-...\` — required for most /v1/* routes
- x402: wallet-based payment, no API key needed — for /x402/* routes
- Clerk JWT: header \`Authorization: Bearer <token>\` — for user/escrow endpoints

## MCP Server

Connect ClawNet as an MCP tool provider:

- Local: \`npx tsx src/mcp/server.ts\`
- Tools: list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits

## Pricing

- 1 credit = $0.001 (1000 credits per $1)
- Volume discounts: $5->5K, $20->22K (+10%), $50->60K (+20%), $100->125K (+25%)
- Cache hits: 10% of live cost (min 0.1 credits)
- Orchestration fee: 2 credits per LLM-routed query

## .well-known

- ${baseUrl}/.well-known/agent-card.json
- ${baseUrl}/.well-known/openapi.json
- ${baseUrl}/llms.txt
`;
}

function buildLlmsTxtFull(baseUrl: string): string {
  const base = buildLlmsTxt(baseUrl);

  let skillsSection = '\n## Available Skills\n\n';
  try {
    const skills = listPublicSkills(0, 100);
    if (skills.length === 0) {
      skillsSection += 'No public skills currently listed.\n';
    } else {
      for (const s of skills) {
        const tags: string[] = safeJsonParse(s.tags_json, []);
        const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        const displayName = s.display_name || s.name;
        skillsSection += `- ${displayName} (${s.skill_type}, ${s.credit_cost} credits)${tagStr} — ${s.description}\n`;
      }
    }
  } catch {
    skillsSection += 'Skills list temporarily unavailable.\n';
  }

  return base + skillsSection;
}

router.get('/', (c) => {
  const baseUrl = env.CLAWNET_BASE_URL;
  return c.text(buildLlmsTxt(baseUrl));
});

router.get('/full', (c) => {
  const baseUrl = env.CLAWNET_BASE_URL;
  return c.text(buildLlmsTxtFull(baseUrl));
});

// ─── SKILL.md (agent-readable onboarding manifest) ──────────────────────────

const skillMdRouter = new Hono();

skillMdRouter.get('/', (c) => {
  const baseUrl = env.CLAWNET_BASE_URL;

  let skillsSection = '';
  try {
    const skills = listPublicSkills(0, 50);
    if (skills.length > 0) {
      skillsSection = '\n## Available Skills\n\n| Skill | Type | Cost | Description |\n|---|---|---|---|\n';
      for (const s of skills) {
        const displayName = s.display_name || s.name;
        skillsSection += `| \`${s.name}\` | ${s.skill_type} | ${s.credit_cost} credits | ${displayName} — ${(s.description || '').slice(0, 80)} |\n`;
      }
    }
  } catch {}

  const md = `---
name: claw-net
description: AI agent orchestration with 344+ API endpoints, skill marketplace, x402 micropayments. Ask anything — get verified answers from 12,000+ data sources.
metadata:
  homepage: https://claw-net.org
  api: ${baseUrl}
  openclaw:
    requires:
      env:
        - CLAWNET_API_KEY
    primaryEnv: CLAWNET_API_KEY
---

# ClawNet

Ask anything. Get verified answers from 12,000+ data sources. Crypto, social, market intelligence — one query, one answer.

## Setup

1. Get an API key at https://claw-net.org/dashboard (or use x402 — no key needed)
2. Set \`CLAWNET_API_KEY\` in your environment
3. Base URL: \`${baseUrl}\`

## Quick Start

\`\`\`bash
curl -X POST ${baseUrl}/v1/orchestrate \\
  -H "X-API-Key: $CLAWNET_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "What is the price of SOL?"}'
\`\`\`

## Core Endpoints

| Endpoint | Auth | Cost | Description |
|---|---|---|---|
| \`POST /v1/orchestrate\` | Key | 2cr+ | Natural language query across 12K+ sources |
| \`GET /v1/estimate?query=...\` | None | Free | Pre-flight cost estimate |
| \`POST /v1/batch\` | Key | varies | Parallel multi-query (up to 10) |
| \`GET /v1/stream/orchestrate\` | Key | 2cr+ | Streaming via SSE |
| \`POST /v1/skills/:id/invoke\` | Key | varies | Invoke a skill |
| \`POST /v1/skills/:id/query\` | Key | 1-2cr | Query data skills |
| \`POST /v1/manifest\` | Key | 0.5-5cr | Verify data before acting |
| \`POST /v1/attest\` | Key | 0.25cr | Create signed attestation |
| \`GET /v1/attest/verify/:id\` | None | Free | Verify attestation (public) |
| \`GET /v1/marketplace/skills\` | None | Free | Browse skill catalog |
| \`GET /v1/endpoints\` | None | Free | Browse 344+ endpoints |

## x402 (no API key needed)

Pay-per-call via USDC micropayments. Wallet is the only credential.

- \`GET ${baseUrl}/x402\` — discovery
- \`POST ${baseUrl}/x402/skills/:id\` — invoke via x402
- \`GET ${baseUrl}/x402/verify/:requestId\` — receipt verification

## Authentication

- API Key: header \`X-API-Key: cn-...\`
- x402: wallet-based payment, no key
- Clerk JWT: \`Authorization: Bearer <token>\`

## Pricing

1 credit = $0.001. Volume discounts from $20+. Cache hits = 10% of live cost.

## Discovery

- \`${baseUrl}/llms.txt\` — LLM-readable reference
- \`${baseUrl}/.well-known/agent-card.json\` — agent identity
- \`${baseUrl}/.well-known/agents.json\` — service listing
- \`${baseUrl}/.well-known/mcp.json\` — MCP tools
- \`${baseUrl}/.well-known/x402.json\` — x402 capabilities
- \`${baseUrl}/v1/openapi.json\` — OpenAPI 3.1 spec
${skillsSection}`;

  return c.text(md);
});

export { router as llmsTxtRouter, skillMdRouter };
