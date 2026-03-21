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

## Completed: x402 v2 + Distribution

| # | Item | Status |
|---|------|--------|
| 18 | x402 v2 HTTP headers | DONE (PAYMENT-SIGNATURE + PAYMENT-REQUIRED alongside v1) |
| 19 | MCP per-tool pricing | DONE (USDC pricing in server.ts + .well-known/mcp.json) |
| 20 | x402 v2 Discovery extension | DONE (x402Version 2, CAIP-2 chain IDs, structured facilitators) |
| 21 | Register on 402index.io | Manual — POST to their /api/v1/register |
| 22 | Register on ag0.xyz | Manual — mint ERC-721 on Base |
| 23 | Fallback facilitator | DONE (X402_FACILITATOR_FALLBACK_URL, auto-failover on 5xx) |
| 24 | SIGN-IN-WITH-X (CAIP-122) | DONE (3 endpoints at /v1/auth/siwx/, viem signature verification) |
| 25 | RSS feed | DONE (GET /feed.xml, RSS 2.0 with clawnet: namespace) |
| 26 | Self-registration API | DONE (POST /v1/register, 402 probe, IP rate limiting) |
| 27 | Opportunities endpoint | DONE (GET /v1/opportunities, 5-category gap analysis) |
| 28 | Dynamic payTo routing | DONE (direct_payout flag, creator wallet routing, migration v92) |
| 29 | Portable reputation | DONE (SHA-256 anchors, 15m cron, public verify endpoint) |
| 30 | Consume ag0 agents | DONE (ag0 as 4th discovery layer, GraphQL subgraph, 5s timeout) |

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

### Medium Priority — Outreach
- [ ] **DM @henloitsjoyce** — market map listing, category "Agent Infrastructure". One-liner + logo + URL.
- [ ] **DM Lincoln Murr (@xlincolnx)** — AgentKit integration, show packages/agentkit/
- [ ] **Outreach to Coinbase AgentKit team** — show x402 integration + AgentKit plugin
- [ ] **Outreach to XMTP team** — show XMTP bot integration
- [ ] **Outreach to Crossmint** — wallet integration opportunity
- [ ] **Outreach to LangChain maintainers** — submit PR for community integration
- [ ] **Outreach to PayAI team** — propose mutual facilitator integration. ClawNet uses PayAI as backup x402 facilitator, PayAI lists ClawNet as an orchestration partner. Win-win.
- [ ] **Outreach to OpenClaw / TrustedClaw** — they're building trust signals in x402 ecosystem. ClawNet's attestation layer is complementary.
- [ ] **Outreach to Questflow** — they list many x402 agents on 402index. Partnership potential for cross-listing.

### Medium Priority — Publishing
- [ ] **Publish @clawnet/sdk to npm** — `cd packages/sdk && npm publish`
- [ ] **Publish @clawnet/langchain to npm** — `cd packages/langchain && npm publish`
- [ ] **Publish @clawnet/mcp to npm** — needed for MCP directory submissions
- [ ] **Publish clawnet-crewai to PyPI** — `cd packages/crewai && pip install build && python -m build && twine upload dist/*`

### Lower Priority
- [ ] **Register on ag0.xyz** — mint ERC-721 on Base, point at MCP + A2A endpoints
- [ ] **AWS Marketplace listing** — SaaS listing for enterprise customers
- [ ] **Submit to x402 Foundation provider registry** — when registry launches
- [ ] **Monitor Tempo (Stripe-backed)** — launched March 18, 2026. MPP protocol. Potential threat at payment layer. Consider adding MPP consumer support when their SDK stabilizes.
- [ ] **Monitor Google AP2** — Agent Payments Protocol. Watch for SDK release. ClawNet should be early adopter.
- [ ] **First 100 developers campaign** — the moat is usage. Consider dev grants, hackathon sponsorship, or free credit tiers for early builders.

---

## Manual Action Items — x402 Developer Event (March 2026)

### Outreach — Invite to Marketplace
These contacts expressed interest or have skills that would be valuable on the ClawNet marketplace:

| Contact | Handle | Action | Notes |
|---------|--------|--------|-------|
| **Messari (Diran Li)** | @diran_li | Invite to publish premium data skills | CEO of Messari. High-value for Radar trading product. Prev: Palantir, Microsoft |
| **Elsa AI** | (find handle) | Invite to publish AI skills | Contact from event — interested in marketplace |
| **Dexter AI** | @dexteraisol, dev: @BranchM | Integration partner for Pulse/Radar | Largest x402 facilitator. Already in our registry. Explore deeper integration |
| **QuickNode (Sahil Sen)** | @sensahil | Invite to publish blockchain data skills | DevRel at QuickNode. 50+ chain support |
| **WURK** | @WURKDOTFUN | Deepen integration (already 3 endpoints) | Microjobs for humans+agents. Could add more task types |
| **APINow (Chris Dolinski)** | @1dolinski, @apinowfun | Monitor / competitive intel | Tokenized APIs. Study their semantic discovery |
| **Austin Griffith** | @austingriffith | ethskills.com already added to registry | EF developer. 24 skill modules, open source |
| **Cred Protocol** | @credprotocol | Invite to publish credit scoring skills | On-chain credit scores for 300M+ EVM addresses. Free sandbox API. High value for DeFi agents |
| **SQD (Subsquid)** | @subsaboratory | Invite to publish data indexing skills | Multi-chain data indexing across 200+ networks. TypeScript SDK. Premium data source |
| **Birdeye** | @biraboratory | Invite to publish Solana data skills | Top Solana DeFi data provider. Prices, wallets, smart money. Core for Solana agents |
| **Dune** | @duneanalytics | Invite to publish analytics skills | SQL-based on-chain analytics. Community queries. High flexibility for agents |
| **Nansen** | @naboratory | Invite to publish smart money skills | Labeled wallet data, institutional flows. Already has MCP support |
| **growthepie** | @growthepie_eth | Invite to publish L2 analytics skills | Free, open Ethereum/L2 analytics. Zero cost integration |

### Outreach — Strategic Partnerships
| Contact | Handle | Action | Notes |
|---------|--------|--------|-------|
| **Sponge (YC W26)** | @sponge_wallet | Register as Gateway provider | Agent wallet distribution channel |
| **zauth** | @zauthx402 | Explore trust data integration | Independent endpoint verification |
| **x402r** | @x402rorg | Explore refund protocol integration | Refundable x402 payments |
| **Xona Agent** | @xona_agent | Add creative AI endpoints | Image/video generation via x402 |
| **Daydreams** | @daydreamsagents | Monitor for integration | x402 + ERC-8004 agent framework |
| **t54.ai** | @t54_ai | Partnership — trust signal integration | Agent trust layer + x402-Secure + "Claw Credit". Complementary: their payment-layer trust feeds into our manifest engine. NOT a competitor — they do identity/risk, we do orchestration/attestation |
| **HTTPayer** | (find handle) | Evaluate as 4th x402 facilitator | HTTP 402-native payments with multi-chain USDC. /relay and /proxy modes. Could expand ClawNet beyond Solana/Base |
| **Proofivy** | (find handle) | Monitor for x402 content endpoints | IP protection + x402 content monetization. CryptoSlate uses it. Add endpoints when API is public |

### Outreach — Ecosystem Contacts (Follow/Engage)
| Contact | Handle | Role |
|---------|--------|------|
| **Rish** | @_rishinsharma | AI at Solana / CoinFund |
| **Eric Brown** | @0xEricBrown | DevRel lead at Base |
| **Zach Prater** | @ZacPrater | Virtual Events at Base |
| **Sawyer (SKALE)** | @TheGreatAxios | VP DevSuccess at SKALE. Private agentic commerce |
| **bc1beat** | @bc1beat | BlockRunAI/ClawRouter creator. Circle hackathon winner |
| **kehaya** | @afkehaya | Open source Solana tools. Contributor at ABK Labs |

### Skill Ideas from Event
Skills to build or commission for the marketplace:

1. **Crypto Tax PnL Skill** — Agent that calculates profit/loss across on-chain transactions. Hire/pay agent to process all transactions. Needs fast on-chain reads (MCP server or local nodes).
2. **Smart Contract Audit Skill** — Wraps ethskills.com audit checklist (500+ items) + LLM analysis. Already partially covered by ethskills endpoints in registry.
3. **Browser Automation Skill** — Wraps Browser Use API for web tasks agents can't do via REST APIs.
4. **Agent Tax/Accounting Skill** — Tracks agent spending across x402 payments, credit purchases, skill invocations for financial reporting.

### Positioning Notes from Event
- "ClawAPIs is like OpenRouter for paid APIs" — validate this analogy
- "ClawRouter = OpenRouter but stablecoin version" — study their 15-dimension routing for optimizePlan() improvements
- "How to establish trust from unknown actors and scale it to every person/machine" — this is EXACTLY what manifest + attestation solves. Use this framing in marketing.
- "Anything behind an API key, add it to registry so agents can call it. Take in API that costs money, put in x402 and upcharge" — this IS our business model. Validate externally.
- "We let your agent work on path of least resistance" — good tagline alternative
- "The frontier: agentic commerce, x402, MPP, stablecoins, semantic discovery, 8004, micropayments, agent discovery, ACP, context engineering, UCP" — ClawNet covers 7 of these 11 already.
