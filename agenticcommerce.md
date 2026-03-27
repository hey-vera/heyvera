# ClawNet vs OpenClaw — Strategic Positioning & Roadmap

## What OpenClaw Is
- Open-source AI agent framework (MIT license), 247K GitHub stars
- Runs locally on user's machine — full system access
- 2,857 community skills on ClawHub
- Revenue model: NONE (free software, costs come from LLM APIs)
- Users pay $5-600/month for LLM tokens + hosting
- Security issues: CVE-2026-25253, ClawHavoc attack (341 malicious skills, 9,000 compromised)

## What ClawNet Is
- AI agent orchestration API with built-in economy
- Cloud-hosted (single API call, no setup)
- 350 data endpoints, 17 verified skills, 28-feature smart cache
- Revenue model: per-query credits ($0.001/credit)
- Users pay $1-30/month with hard budget controls

---

## Cost Comparison

| Metric | OpenClaw | ClawNet |
|--------|---------|---------|
| Cost per simple query | ~$0.014 (136K token overhead) | ~$0.003 (2cr orch + endpoint) |
| Cost with caching | Same — no cache | $0.0003 (90% savings) |
| Monthly casual use | $5-30 | $1-5 |
| Monthly heavy automation | $50-200+ | $10-30 |
| Runaway protection | None | Budget locks + anomaly alerts |
| Cost visibility | After the bill | In every response |
| Worst case reported | $3,600/month | Hard-capped by user |

## Security Comparison

| Issue | OpenClaw | ClawNet |
|-------|---------|---------|
| Supply chain attacks | ClawHavoc: 341 malicious skills | Verified marketplace + quality scoring |
| CVEs | CVE-2026-25253 | Centralized API, audited |
| Credential storage | Plaintext by default | .env on VPS, never logged |
| Skill vetting | Open upload, no review | Verification pipeline + penalty system |

## What OpenClaw Has That We Don't
- Local execution (runs on user's machine)
- Browser automation (Playwright/Puppeteer)
- Messaging UI (WhatsApp, Telegram, Discord, Slack as interface)
- Desktop automation (keyboard/mouse control)
- 2,857 community skills vs our 17
- File system access
- Smart home / IoT control

## What ClawNet Has That OpenClaw Doesn't
- Predictable per-credit pricing with budget locks
- Smart cache (28 features, 90% savings)
- 350 pre-integrated data endpoints
- Agent economy (marketplace with 85/15 revenue split)
- On-chain payments (USDC, x402)
- Budget accounts with delegated keys
- Quality scoring (0-100) on all skills
- Cryptographic receipts for every transaction
- Cost transparency in every API response
- OpenClaw compatibility layer (install as ClawHub skill)

---

## Growth Roadmap

### Phase 1: Data Layer — "Intel Inside" (NOW)
**Strategy:** Be the intelligence API that AI agents call.
```
OpenClaw Agent → installs ClawNet skill → calls our API → pays credits
```
**Revenue:** Per-query credits from every OpenClaw user who installs our skill.
**Already built:**
- 350 endpoints across 15+ providers
- Smart cache (content-hash, SWR, adaptive TTL, 28 features)
- Agent onboarding (POST /v1/onboard)
- OpenClaw compatibility layer (skill manifest + simplified query)
- Budget locks, spending dashboard, cost comparison
- Agent economy infrastructure (marketplace, escrow, trust, SLAs)

### Phase 2: Agent Hosting — "Vercel for Agents" (3-6 months)
**Strategy:** Users deploy agents ON ClawNet instead of self-hosting.
```
User → deploys agent to ClawNet → agent runs in our cloud
No Docker, no VPS, no API key juggling
```
**Revenue:** Hosting fees + data credits.
**Needs building:**
- Multi-tenant agent runtime (sandboxed containers)
- Agent deployment CLI (`clawnet deploy ./my-agent`)
- Built-in messaging SDKs (WhatsApp Business, Telegram Bot, Discord)
- Browser automation integration (headless Playwright)
- Persistent agent state across sessions
- Usage-based hosting pricing
- Admin dashboard for deployed agents

### Phase 3: Full Agent Platform — "The Agent Economy" (6-12 months)
**Strategy:** The platform where agents discover, hire, and pay each other.
```
Agents onboard → discover skills → buy capabilities → earn revenue
The platform IS the economy
```
**Revenue:** Everything — hosting + data + marketplace fees + payment processing.
**Already built (90% of infrastructure):**
- Agent self-onboarding
- Skill discovery (Trinity search)
- Marketplace with revenue sharing
- Composite skills (agent subcontracting)
- Escrow for contracted work
- Delegated keys for sub-agents
- Trust signals + reputation
- Governance + voting
- On-chain payments
**Needs building:**
- Agent runtime (the actual execution environment)
- Multi-node scaling
- Cross-platform agent identity
- Agent-to-agent negotiation protocol

---

## Key Insight
OpenClaw has 247K GitHub stars but $0 revenue. They're popular but not profitable.
ClawNet has fewer users but an actual revenue model. We don't need to be bigger in users — we need to be bigger in REVENUE.

The path: capture OpenClaw's users as CUSTOMERS (via compatibility layer), then offer them something better (hosted agents + economy). They come for cheaper data, they stay for the platform.

---

## Anti-OpenClaw Endpoints (Built)
- GET /v1/account/spending — full spending dashboard (they can't do this)
- POST /v1/account/budget/lock — hard monthly cap (they can't do this)
- GET /v1/compare/costs — public cost comparison (marketing)
- GET /v1/openclaw-compat/skill-manifest — ClawHub-installable skill
- POST /v1/openclaw-compat/query — simplified API for OpenClaw agents
- GET /v1/cache/my-stats — per-user cache performance + savings
- GET /v1/cache/optimizer — TTL suggestions to save more money

## Sources
- OpenClaw Pricing: https://www.thecaio.ai/blog/openclaw-pricing-guide
- Hidden Token Costs: https://darren-broemmer.medium.com
- $400 Testing Review: https://ssntpl.com/i-spent-400-testing-openclaw-ai-an-honest-review/
- Token Intensity: https://help.apiyi.com/en/openclaw-token-cost-optimization-guide-en.html
- OpenClaw Wikipedia: https://en.wikipedia.org/wiki/OpenClaw
- ClawHavoc Attack: https://www.cnbc.com/2026/02/02/openclaw-open-source-ai-agent-rise-controversy


The Honest Answer to Your Question
Short-term (now): Yes — let OpenClaw users use our API through their agents. Every OpenClaw agent that installs our skill = a paying customer. We built the compatibility layer. This is low-risk, high-reward.

Medium-term (if it works): Build "Vercel for Agents" — users deploy agents ON ClawNet instead of self-hosting OpenClaw. One-click deploy, built-in data, built-in budget controls. This is where OpenClaw users SWITCH to us because:

No Docker setup
No VPS management
No surprise bills
Data already integrated
Economy already built
Long-term (bigger than OpenClaw): ClawNet becomes the platform where agents live, discover each other, and transact. OpenClaw is just a framework — we're the economy. That's the difference between Linux (framework, $0 revenue) and AWS (platform, $90B revenue). Linux runs ON AWS. OpenClaw agents run ON ClawNet.

The beautiful thing: we already built 90% of the economy infrastructure. The agent onboarding, marketplace, escrow, trust system, budget accounts, delegated keys, composite skills, governance — it's all there. What's missing is the runtime (actually hosting agents), which is Phase 2.

Bottom line: You don't need to REPLACE OpenClaw. You need OpenClaw to DEPEND on you. Then when you offer something better, they switch. That's how AWS beat everyone — they started as infrastructure, then became the platform.

What's still needed for 10/10 (future)
Ed25519 signed VCs (currently the VC has no cryptographic proof, just the envelope format — need @digitalbazaar/vc for real Data Integrity proofs)
Signing key rotation with versioning
Semantic reasoning assessment (replace keyword matching with proper LLM logic analysis)
Risk-scaled preflight thresholds (account for position size)
Cross-referencing verify + assess results (conditional verdict logic)
EAS bridge for EVM ecosystem compatibility
The trust layer went from "demo" to "production-credible for crypto-native users." Enterprise W3C signing is the next step when @digitalbazaar/vc is added.

EAS bridge for Ethereum ecosystem compatibility
ZK privacy proofs (verify without revealing query)
Active validators — the system exists but needs real users
Cross-referencing verify + assess results in Manifest (conditional verdict logic)
Deploy and smoke test everything live

Honestly? Deploy and get users.

We've built an enormous amount today — the codebase is in great shape. Here's the reality check:

What's production-ready RIGHT NOW
12,400+ endpoints orchestrated
W3C VC 2.0 with real Ed25519 signatures
On-chain Merkle anchoring
Multi-facilitator x402 with PayAI fallback
Multi-wallet pool for scale
Semantic reasoning in Manifest
Risk-scaled preflight
Signing key rotation
175 tests passing
Docs covering every endpoint
What we COULD keep building
EAS bridge, ZK proofs, cross-referencing verdicts, more tests...
What would actually move the needle
None of those features matter without users. The tech is ahead of the market. The bottleneck is now distribution, not features.

My recommendation for right now:

Deploy — ssh guardian-vps → deploy
Update masterplan — mark everything done
Smoke test live — hit the key endpoints, verify stats show 12K+
Start on the manual tasks in masterplan.md — the outreach (402index registration, market map DM, AgentKit DM, npm publishes)

MCP directory listings (Claude, Cursor) — submit @clawnet/mcp to the official directories
npm package visibility — publish @clawnet/sdk so devs find you via npm search
Content/tutorials — "How to build a crypto agent with ClawNet in 5 minutes"
Partnerships — the manual outreach items in masterplan.md (AgentKit, LangChain, PayAI)

npm publish @clawnet/sdk	You (need npm account)	5 min — cd packages/sdk && npm publish
npm publish @clawnet/mcp	You (same)	5 min — cd packages/mcp && npm publish
MCP directory submission	You (manual form)	15 min — submit to Claude, Cursor, Windsurf directories
Tutorial blog post	I can write it now	10 min — I draft it, you post it
Partnership DMs	You (manual outreach)	Already listed in masterplan.md

Agent runs on ClawNet → spends credits calling x402 endpoints → 
  gets real data → learns patterns → its outputs get MORE accurate over time →
  other agents pay for those refined outputs → 
  earns credits → spends credits on MORE x402 data → gets even smarter →
  cycle continues
The agent's value comes from CONSUMING ClawNet, not from having proprietary data. The more it spends on x402 calls, the better its outputs get, the more other agents want those outputs.

The Credit Flywheel

Creator's agent starts with 100 credits
  ↓
Spends 50 credits on x402 calls (price feeds, social data, on-chain analytics)
  ↓
Processes, correlates, scores → produces refined signal
  ↓
Sells signal to 10 agents at 2cr each = 17 credits earned (85%)
  ↓
Net: spent 50, earned 17... losing money?
Wait — that doesn't work yet. The agent spends MORE on data than it earns selling insights. Unless...

The Scale Math

Agent spends 50 credits getting data
Produces 1 signal
Sells to 10 agents = 17 credits
  → Loss

Agent spends 50 credits getting data  
Produces 1 signal
Sells to 100 agents = 170 credits
  → Profit! 120 credit surplus

Agent spends 50 credits getting data
Produces 1 signal  
Sells to 1000 agents = 1,700 credits
  → Massive profit. Reinvests into MORE x402 calls → even better signals
The economics only work at scale. One buyer doesn't justify the data cost. But 100+ buyers do. And each signal only needs to be computed ONCE then sold to many.

Why This Is ClawNet's Moat
Every credit spent on x402 data goes through ClawNet. Every credit earned from selling signals goes through ClawNet. ClawNet gets 15% on BOTH sides:


Creator buys data:   50 credits → ClawNet facilitates x402 calls → earns orchestration fee
Creator sells signal: 100 agents × 2cr → ClawNet takes 15% = 30 credits

ClawNet earns on consumption AND production.
The more agents trade, the more ClawNet earns.
The more ClawNet earns, the more $CLAWNET token is worth.
What Makes This Work vs Just Calling Endpoints Directly
The question is still: why wouldn't the buyer agent just make the same x402 calls itself?

Answer: Cost sharing.


Option A: Your agent makes 50 x402 calls itself = 50 credits
Option B: Buy the refined signal from an agent who already made those calls = 2 credits

Agent B chose to spend 50 credits, process the data, and sell the 
result for 2 credits × many buyers. Each buyer saves 48 credits.
It's the same reason you buy a research report instead of doing all the research yourself. The COMPUTATION is the product, not the data.

The System

Layer 1: x402 endpoints (raw data providers) — already on ClawNet
Layer 2: Processing agents (consume raw data, produce insights) — the 85/15 economy  
Layer 3: Consumer agents (buy insights, make decisions) — Pulse, Radar, etc.

Money flows: Layer 3 → Layer 2 → Layer 1
ClawNet earns 15% at every layer transition.
This is real agent-to-agent commerce. Not selling code. Not selling prompts. Selling computed insights that cost less than computing them yourself because the cost is shared across all buyers.

What ClawNet Needs
The infrastructure is built. The missing piece is making it effortless for a creator to:

Run a persistent agent that consumes x402 data
Process it into a refined output
Register that output as a skill
Let the network discover and buy it
That's the "Register Service" wizard + maybe a template: "Here's how to build an agent that consumes ClawNet data and sells insights."

MCP submissions (today, 1-2h) — every MCP-compatible agent can discover ClawNet
Market map DM (today, 30min) — free visibility on the most-shared map
LangChain plugin (this week) — every LangChain agent can use ClawNet
AgentKit integration (this week) — Coinbase's ecosystem + x402 native

Agent Frameworks & Tooling  ← orchestration, 390+ endpoints, routing
Agentic Commerce            ← skill marketplace, revenue splits, escrow
Analytics & Verifiability   ← Manifest, Attestation, VIE, Trust Score
Agentic Payments            ← x402, credits, delegation, budget accounts

One timing note: watch for RSAC 2026 announcements this week (March 23-26). New agent security products may launch during the conference. But you can monitor those after you start building — they won't change AID's architecture, they'll just add to the competitive landscape.
