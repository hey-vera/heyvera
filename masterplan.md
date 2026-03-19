# ClawNet Master Plan

## What Was Built (2026-03-18/19)

### ClawNet (claw-net repo) — ~22,000 lines added
- **Docs rewrite** — 25 sections, 100+ endpoints documented, QA'd to 9.5/10
- **Marketplace rebrand** — "Agent Services" → "Data Skill Marketplace" across 14 pages
- **VIE** (Verified Intelligence Engine) — first marketplace skill, crypto trust scoring, 21 tests
- **Intelligence Suite** — Context Engine + Agent Trust Score + Predictive Alerts + shared intel layer (4 tables)
- **Manifest** — universal data verification (verify, assess, preflight, remember). Core infrastructure product.
- **Attestation** — signed proof of every agent action. Public verification endpoint. Core infrastructure product.
- **LLM Reseller** — custom markup, model restrictions, provision endpoint for end users
- **Dashboard tabs** — Overview / Reseller / Keys
- **Payment abstraction layer** — KeylessPaymentVerifier interface. x402 live, MPP + LSAT stubs ready.
- **Nav restructure** — Products (Pulse, Radar) + Services (Manifest, Attestation) + Developers dropdown
- **Clean URLs** — removed .html extensions from 340 internal links, Caddyfile with try_files
- **OpenAPI 3.1** + .well-known/openapi.json redirect
- **A2A Protocol** — Google Agent-to-Agent v0.3.0 (POST /a2a/tasks/send, /.well-known/agent.json)
- **ERC-8004 Catalog** — public skill listing in standard format (GET /v1/erc8004/catalog)
- **KYA Agent Identity** — register/verify agent identities with JWT tokens (7 endpoints)
- **XMTP Bot** — encrypted agent messaging, mirrors Telegram bot commands
- **Public health metrics** — GET /v1/stats/health/skills + /health/live for directory crawlers
- **Protocol documentation** — site/protocol.html ("Trust Handshake" 4-step flow)
- **x402 Offer Extension** — standardized 402 challenges, GET /x402/offer/:skillId pre-fetch
- **Account dropdown fix** — hover + click toggle behavior

### Plugins (packages/)
- **@clawnet/sdk** — TypeScript client SDK
- **@clawnet/langchain** — 3 LangChain StructuredTools
- **@clawnet/agentkit** — 3 Coinbase AgentKit actions
- **@clawnet/openai-agents** — OpenAI Agents SDK tools
- **@clawnet/vercel-ai** — Vercel AI SDK tools
- **clawnet-crewai** — Python CrewAI plugin
- **@clawnet/elizaos** — ElizaOS plugin

### Pulse (pulse repo) — ~2,560 lines added
- Feature Radar, Topic Scorer, Platform Voices, Voice Drift Detection
- Intent Classification, Conversation Memory, Niche Categories
- Adaptive Mix, Opportunistic Override, Strategic Targeting
- Content Compounding, Business Attribution, Post Attribution

### DB Migrations Added: v77–v90
- v77: vie_reports | v78: intel tables | v79: manifest_memory
- v80: attestations | v81: reseller_configs | v82: x402 payment_hash
- v83: facilitator_receipt_json | v84: payer_address_verified
- v85: attestation_id on x402_receipts | v86: x402 indexes
- v87: agent_identities | v88: identity indexes
- v89: xmtp_subscribers | v90: a2a_tasks

### Test Status
- 87 tests passing (5 test files)
- Build clean (tsc --noCheck)

---

## Completed Items

| # | Item | Status |
|---|------|--------|
| 1 | x402 Idempotency | DONE |
| 2 | x402 Receipt Extension | DONE |
| 3 | MCP Directory Submissions | DONE (playbook at docs/mcp-submissions.md) |
| 4 | Positioning Statement | DONE |
| 5 | LangChain Plugin | DONE (packages/langchain/) |
| 6 | AgentKit Integration | DONE (packages/agentkit/) |
| 8 | Discovery files audit | DONE (A2A agent.json, health endpoints, x402.json v2) |
| 9 | CrewAI Plugin | DONE (packages/crewai/) |
| 10 | ElizaOS Plugin | DONE (packages/elizaos/) |
| 11 | Link Receipt → Attestation | DONE (attestation_id on x402_receipts) |
| 12 | SDK publish to npm | DONE (packages/sdk/) |
| 14 | OpenAI Agents SDK | DONE (packages/openai-agents/) |
| 15 | Vercel AI SDK | DONE (packages/vercel-ai/) |
| 16 | x402 Offer Extension | DONE |
| 17 | Protocol Documentation | DONE (site/protocol.html) |
| — | A2A Protocol (Google) | DONE (bonus — competitive feature) |
| — | ERC-8004 Catalog | DONE (bonus — competitive feature) |
| — | KYA Agent Identity | DONE (bonus — competitive feature) |
| — | XMTP Bot | DONE (bonus — competitive feature) |
| — | Public health metrics | DONE (bonus — 402index.io optimization) |
| — | Clean URLs + Caddyfile | DONE |
| — | Nav restructure (Products + Services) | DONE |
| — | Account dropdown fix | DONE |

---

## Next Up: x402 v2 + Distribution

### P0: x402 v2 Compliance (high priority)

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 18 | **x402 v2 HTTP headers** | 2-3h | Code | Support new `PAYMENT-SIGNATURE`, `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE` headers alongside v1 `X-PAYMENT` headers. Backward compatible — accept both. |
| 19 | **MCP per-tool pricing** | 1-2h | Code | Add `x402_price_usdc` to each tool in MCP manifest. AWS pattern — agents discover pricing at tool-discovery time. Update `src/mcp/server.ts` and `/.well-known/mcp.json`. |
| 20 | **x402 v2 Discovery extension** | 1-2h | Code | Align `/.well-known/x402.json` with formal v2 Discovery extension spec. CAIP-2 chain IDs, structured facilitator info. Gets ClawNet auto-indexed by facilitators. |
| 21 | **Register on 402index.io** | 30min | Manual | Self-register ClawNet's x402 endpoints via `POST https://402index.io/api/v1/register`. Use playbook format. |
| 22 | **Register on ag0.xyz** | 1-2h | Code+Manual | Mint ERC-721 identity on Base via `@ag0/sdk`. Point at MCP + A2A endpoints. Free discoverability across ag0 ecosystem. |

### P1: Distribution + Discoverability

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 23 | **Fallback facilitator** | 1-2h | Code | Support backup x402 facilitator (x402.org public endpoint) alongside `X402_FACILITATOR_URL`. Auto-failover on primary down. |
| 24 | **SIGN-IN-WITH-X (CAIP-122)** | 3-4h | Code | Wallet-based session auth — agent signs once, gets session, avoids per-call x402 payment friction for high-frequency agents. Maps to existing `/v1/economy/sessions`. |
| 25 | **RSS feed of new skills** | 1h | Code | `GET /feed.xml` — RSS 2.0 feed of marketplace skills. 402index has this; good for automated discovery by aggregators. |
| 26 | **Self-registration API** | 2-3h | Code | `POST /v1/register` — let external services register x402 endpoints on ClawNet's registry. Verification probe, pending review. Grows registry beyond 390. |

### P2: Competitive Edge

| # | Item | Effort | Type | Details |
|---|------|--------|------|---------|
| 27 | **Opportunities endpoint** | 2-3h | Code | `GET /v1/opportunities` — gap analysis showing underserved categories, missing protocols, single-provider deps. 402index has this; attracts developers to build on ClawNet. |
| 28 | **Dynamic payTo routing** | 3-4h | Code | x402 v2 per-request payment routing to creator wallets on-chain. Trustless payouts without credit intermediary. |
| 29 | **Portable reputation (ag0)** | 2-3h | Code | Write skill reputation hashes to Base via ag0 Reputation Registry. Trust data verifiable by anyone, not siloed to ClawNet's DB. |
| 30 | **Consume ag0 agents** | 4-6h | Code | Extend executor.ts to discover and call ag0-registered external agents. ClawNet becomes first orchestrator bridging centralized APIs + decentralized agent network. |

---

## Key Context

### x402 Ecosystem (March 2026)
- **x402 Foundation** formed by Coinbase + Cloudflare for neutral governance
- **AWS** published production CDK stacks with 355 tests (Bedrock AgentCore + CloudFront Lambda@Edge)
- **Google** integrated x402 into AP2 (Agent Payments Protocol)
- **Visa** launched TAP (Trusted Agent Protocol) alongside x402
- **156K weekly transactions**, trending toward $3-4M/day, 100M+ payments in first 6 months
- Protocol stack settling: x402 (execution) + AP2 (trust) + ACP (checkout) + TAP (identity)

### 402index.io
- Directory of 15,453 endpoints across 561 providers (x402, L402, MPP)
- NOT a competitor — it's a distribution channel. ClawNet should be LISTED there.
- They crawl `.well-known/x402.json` for auto-discovery
- Interesting features: opportunities endpoint, RSS feed, webhooks, live health probing
- Their 15K endpoints come from aggregating multiple sources (bazaar, satring, l402apps, sponge, well-known, self-registered, discovery)

### ag0.xyz
- Decentralized agent identity + discovery built on ERC-8004 (agents = ERC-721 NFTs)
- NOT a competitor — complementary identity/discovery layer
- Registration = free discoverability across Ethereum, Base, Polygon, BNB
- Portable reputation via on-chain feedback registry

### Market Position
- ClawNet spans 4+ categories on Agentic Finance Market Map but listed in ZERO
- **Biggest gap is DISTRIBUTION, not features**
- Risk: not being findable in x402 Foundation index, ag0 subgraph, 402index, AWS provider lists

### What NOT to build
- Directory/aggregator (that's 402index's job, not ours)
- MPP (Tempo L1 too new, credit system already solves sessions)
- Lightning/LSAT (niche audience, volatile asset)
- Multi-chain USDC beyond Solana + Base (agents already use cheap L2s)
- Own L2 chain (overkill for current scale)

---

## Manual Tasks (Josh)

### High Priority
- [ ] **Deploy** — SSH to VPS, type `deploy` (after each code push)
- [ ] **Copy Caddyfile** — `sudo cp /home/guardian/claw-net/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`
- [ ] **Register on 402index.io** — POST to `https://402index.io/api/v1/register` with ClawNet's x402 endpoints
- [ ] **Submit MCP server** — follow `docs/mcp-submissions.md` playbook (~30 min)

### Medium Priority
- [ ] **DM @henloitsjoyce** — market map listing, category "Agent Infrastructure"
- [ ] **DM Lincoln Murr (@xlincolnx)** — AgentKit integration, show packages/agentkit/
- [ ] **Outreach to Coinbase AgentKit team** — show x402 integration + AgentKit plugin
- [ ] **Outreach to XMTP team** — show XMTP bot integration
- [ ] **Outreach to Crossmint** — wallet integration opportunity
- [ ] **Outreach to LangChain maintainers** — submit PR for community integration

### Lower Priority
- [ ] **Publish @clawnet/sdk to npm** — `cd packages/sdk && npm publish`
- [ ] **Publish @clawnet/langchain to npm** — `cd packages/langchain && npm publish`
- [ ] **Publish @clawnet/mcp to npm** — needed for MCP directory submissions
- [ ] **Publish clawnet-crewai to PyPI** — `cd packages/crewai && pip install build && python -m build && twine upload dist/*`
- [ ] **Register on ag0.xyz** — mint ERC-721 on Base, point at MCP + A2A endpoints
- [ ] **AWS Marketplace listing** — SaaS listing for enterprise customers
- [ ] **Submit to x402 Foundation provider registry** — when registry launches
