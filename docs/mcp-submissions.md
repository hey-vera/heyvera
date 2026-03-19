# MCP Directory Submission Playbook

Target: get ClawNet listed on all major MCP directories in ~30 minutes.

**Positioning statement (use everywhere):**
> AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts

**Key facts for submissions:**
- Name: `ClawNet`
- Version: `1.0.0`
- NPM package: `@clawnet/mcp`
- Install: `npx -y @clawnet/mcp`
- API base: `https://api.claw-net.org`
- Website: `https://claw-net.org`
- Twitter: `https://x.com/clawnet`
- License: (private — omit or say "proprietary")
- Transports: stdio, streamable-http, streamable-http (x402 payment-gated)
- GitHub: private repo — link to website instead

**6 MCP tools:**

| Tool | Description |
|------|-------------|
| `list-skills` | Browse the ClawNet skill marketplace. Returns public skills with IDs, descriptions, and credit costs. |
| `get-skill` | Get full details about a ClawNet skill including input variables, pricing, and usage examples. |
| `invoke-skill` | Execute a ClawNet skill with the provided variables. Returns AI-generated analysis. Requires API key. |
| `search-registry` | Search ClawNet's API endpoint registry (158+ endpoints across 60+ providers). Find the right API for any task. |
| `orchestrate` | Run a free-form query through ClawNet's AI orchestration engine. Automatically selects APIs, executes multi-step workflows, and returns formatted analysis. Requires API key. |
| `get-credits` | Check your ClawNet credit balance. Requires API key. |

---

## 1. Smithery.ai

**Submit at:** https://smithery.ai/submit (or via GitHub PR to their registry)

**Fields to fill:**

- **Name:** ClawNet
- **Description:** AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts. Query real-time data from Solana, DeFi, social, security, and 60+ other API providers through natural language.
- **Install command:**
  ```
  npx -y @clawnet/mcp
  ```
- **Claude Desktop config (paste as-is):**
  ```json
  {
    "mcpServers": {
      "clawnet": {
        "command": "npx",
        "args": ["-y", "@clawnet/mcp"],
        "env": {
          "CLAWNET_API_KEY": "your_api_key",
          "CLAWNET_BASE_URL": "https://api.claw-net.org"
        }
      }
    }
  }
  ```
- **Tools:**
  - `list-skills` — Browse the skill marketplace (no API key needed)
  - `get-skill` — Get skill details, input schema, and pricing
  - `invoke-skill` — Execute a skill with template variables
  - `search-registry` — Search 158+ API endpoints across 60+ providers
  - `orchestrate` — Natural language to multi-step API workflows
  - `get-credits` — Check credit balance
- **Category:** API Integration / AI & ML
- **Tags:** orchestration, api, ai, defi, solana, marketplace, x402, agents
- **Website:** https://claw-net.org

---

## 2. mcp.so

**Submit at:** https://mcp.so/submit (or https://github.com/punkpeye/awesome-mcp-servers PR)

**Fields to fill:**

- **Name:** ClawNet
- **Description:** AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts. Turns natural language queries into multi-step agent workflows across Solana, DeFi, social, security, and 60+ API providers.
- **Category:** API Integration
- **Subcategory:** Multi-provider orchestration
- **Tools (paste as list):**
  ```
  list-skills    — Browse the ClawNet skill marketplace
  get-skill      — Get skill details, pricing, and input schema
  invoke-skill   — Execute a marketplace skill with variables
  search-registry — Search 158+ API endpoints across 60+ providers
  orchestrate    — Natural language → multi-step API workflows
  get-credits    — Check credit balance
  ```
- **Transport:** stdio (via `npx -y @clawnet/mcp`) + streamable-http (`https://api.claw-net.org/mcp`)
- **Install:**
  ```
  npx -y @clawnet/mcp
  ```
- **Env vars required:** `CLAWNET_API_KEY` (for invoke/orchestrate), `CLAWNET_BASE_URL` (defaults to https://api.claw-net.org)
- **Website:** https://claw-net.org
- **Author:** ClawNet

---

## 3. Glama.ai/mcp

**Submit at:** https://glama.ai/mcp/servers/submit

**Fields to fill:**

- **Repository URL:** https://claw-net.org (no public GitHub — use website)
- **Name:** ClawNet
- **Short description:** AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts
- **Long description:**
  ```
  ClawNet is an intelligent API orchestration layer that turns natural language
  queries into multi-step agent workflows. It connects to 390+ live API endpoints
  across 60+ providers covering Solana, DeFi, social media, security, search,
  media, and more.

  Features:
  - Natural language orchestration (POST /v1/orchestrate)
  - Skill marketplace with 17+ published skills
  - Cryptographic receipts (SHA-256) for every transaction
  - x402 payment support (USDC on Base — no account needed)
  - Budget controls with 4 strategies: cheapest, balanced, fastest, reliable
  - Composite skills with output piping, parallel execution, conditionals
  - SLA contracts and trust scoring

  6 MCP tools: list-skills, get-skill, invoke-skill, search-registry,
  orchestrate, get-credits.

  Install: npx -y @clawnet/mcp
  Docs: https://claw-net.org
  ```
- **Category:** API Tools
- **Tags:** orchestration, ai-agents, api, defi, solana, marketplace

---

## 4. MCP Hub

**Submit at:** https://mcphub.io/submit (or GitHub: https://github.com/nicobailon/mcp-hub)

**Fields to fill:**

- **Name:** ClawNet
- **Description:** AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts
- **Tools:**
  | Tool | Description |
  |------|-------------|
  | list-skills | Browse the ClawNet skill marketplace. Returns skills with IDs, descriptions, and credit costs. |
  | get-skill | Get full details about a skill including input variables, pricing, and usage examples. |
  | invoke-skill | Execute a ClawNet skill with provided variables. Returns AI-generated analysis. |
  | search-registry | Search 158+ API endpoints across 60+ providers. Find the right API for any task. |
  | orchestrate | Natural language → multi-step API workflows with budget controls. |
  | get-credits | Check your ClawNet credit balance. |
- **Transport types:**
  - `stdio` — local via `npx -y @clawnet/mcp`
  - `streamable-http` — remote at `https://api.claw-net.org/mcp`
  - `streamable-http` (x402) — payment-gated at `https://api.claw-net.org/mcp/x402`
- **Install command:** `npx -y @clawnet/mcp`
- **Config JSON:**
  ```json
  {
    "mcpServers": {
      "clawnet": {
        "command": "npx",
        "args": ["-y", "@clawnet/mcp"],
        "env": {
          "CLAWNET_API_KEY": "your_api_key",
          "CLAWNET_BASE_URL": "https://api.claw-net.org"
        }
      }
    }
  }
  ```
- **Env vars:** CLAWNET_API_KEY (optional for browsing, required for invocation), CLAWNET_BASE_URL
- **Website:** https://claw-net.org
- **Hosts supported:** Claude Desktop, Claude Code, Cursor, VS Code, Windsurf

---

## 5. Awesome MCP Servers (GitHub)

**Submit at:** https://github.com/punkpeye/awesome-mcp-servers (open a PR)

**PR-ready markdown line (paste into the appropriate section, e.g., "API Integration" or "Data & Analytics"):**

```markdown
- [ClawNet](https://claw-net.org) — AI agent orchestration with 390+ live APIs, skill marketplace, and cryptographic receipts. Natural language queries → multi-step workflows across Solana, DeFi, social, security, and 60+ providers. 6 tools: list-skills, get-skill, invoke-skill, search-registry, orchestrate, get-credits. `npx -y @clawnet/mcp`
```

**PR title:** `Add ClawNet — AI agent orchestration (390+ APIs, skill marketplace)`

**PR body:**
```
Adds ClawNet MCP server to the API Integration section.

- 6 MCP tools for skill marketplace browsing, invocation, API registry search, and natural language orchestration
- 390+ live API endpoints across 60+ providers (Solana, DeFi, social, security, search, media, etc.)
- Supports stdio and streamable-http transports
- x402 payment-gated transport (USDC on Base, no account needed)
- Cryptographic receipts (SHA-256) for every transaction
- Install: `npx -y @clawnet/mcp`
- Website: https://claw-net.org
```

---

## Execution Checklist

1. [ ] **Smithery.ai** — Go to https://smithery.ai/submit, paste config from section 1
2. [ ] **mcp.so** — Go to https://mcp.so/submit, fill fields from section 2
3. [ ] **Glama.ai** — Go to https://glama.ai/mcp/servers/submit, paste from section 3
4. [ ] **MCP Hub** — Go to https://mcphub.io/submit, fill from section 4
5. [ ] **Awesome MCP Servers** — Fork https://github.com/punkpeye/awesome-mcp-servers, add line from section 5, open PR

**Pre-flight:** Make sure `@clawnet/mcp` is published on npm before submitting. If not yet published, use the remote HTTP transport URL (`https://api.claw-net.org/mcp`) as the primary install method and note that the npm package is coming soon.

**Discovery endpoint (already live):** `https://api.claw-net.org/.well-known/mcp.json` — link to this in submissions as proof of MCP compliance.
