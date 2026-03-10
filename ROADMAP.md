# ClawNet Roadmap

> **Vision:** ClawNet is the sovereign orchestration layer for the x402 and OpenClaw ecosystem. As ClawAPIs.com adds new endpoints, ClawNet adds them automatically via the API registry — becoming the intelligence router between AI agents, real-time data, and micropayment rails across Solana and beyond.

This file is the single source of truth for what has been built, what comes next, and the long-term direction of the project.

---

## Completed

### Chunk 1 — Foundation
- Hono API server on port 3402
- SQLite database (`better-sqlite3`, no ORM, WAL mode)
- Redis L2 cache with in-memory L1 fallback
- Pino structured logging
- Zod environment validation
- Graceful shutdown (SIGTERM/SIGINT)
- Docker Compose (app + Redis)
- Nginx reverse proxy, systemd service, VPS deploy pipeline

### Chunk 2 — Orchestration Core
- Intent parser: natural language → structured execution plan via LLM
- Parallel execution engine with dependency groups
- Circuit breaker per endpoint (CLOSED → OPEN → HALF_OPEN)
- API registry (`src/config/api-registry.ts`) — single source of truth for all endpoints
- x402 micropayment integration with ClawAPIs
- Simulation mode when no Solana private key is present
- Response synthesis (LLM formats raw API data into actionable answer)
- Synthesis cache (SHA-256 hash of query + data, 10-min TTL)
- Intent cache (30-min TTL — same query = same plan)

**API endpoints built:**
- Token metadata, price, holders, risk score
- Wallet portfolio, transaction history
- Trending tokens
- X/Twitter mentions + profile
- LinkedIn profile
- Instagram check
- Reddit sentiment
- Web scrape
- News search
- Wallet risk score

### Chunk 3 — Payments & Auth
- Stripe one-time purchase webhook (`checkout.session.completed`)
- Graduated credit bonuses by tier ($5 → $1,000)
- Solana/USDC on-chain payment verification (+10% bonus)
- Clerk JWT authentication (dashboard routes)
- API key auth middleware with tiered rate limits (based on amount paid)
- Credit deduction on every orchestration call
- Low-balance email alerts (< 500 credits)
- `GET /v1/balance` endpoint (no credit cost)
- Subscription tier: ClawNet Scout — $29/month → 40,000 credits/month

**Credit tiers:**
| Tier | Amount | Credits | Bonus |
|---|---|---|---|
| Starter | $5 | 5,000 | — |
| Builder | $20 | 21,000 | +5% |
| Pro | $50 | 54,000 | +8% |
| Growth | $100 | 112,000 | +12% |
| Scale | $500 | 600,000 | +20% |
| Enterprise | $1,000 | 1,300,000 | +30% |
| Scout (sub) | $29/mo | 40,000/mo | — |

### Chunk 4 — Developer Experience
- Dashboard routes (`GET /me`, `POST /claim-session`, `POST /send-claim-email`, magic link claim flow)
- Referral code system (4-byte entropy, transactional double-spend prevention)
- Feedback endpoint → SQLite
- Admin dashboard (HTML, circuit breaker stats, cache stats, top queries)
- Contact form (honeypot, rate limiting, HTML escaping)
- Email templates (Resend): API key delivery, low-balance alert, claim link
- Heartbeat system
- Usage stats logging to SQLite
- Security headers (HSTS, X-Frame-Options, X-Content-Type-Options)
- Request ID on every response (`X-Request-ID`)
- Rate limiting middleware (global IP-based, tiered per API key)
- `GET /health` at root (uptime monitoring)
- GITHUB FUNDING.yml → claw-net.org

**Security hardening applied:**
- XSS escaping in admin HTML dashboard
- Atomic credit deduction (SQL `WHERE credits >= amount`)
- Atomic claim token redemption (SQL `WHERE used = 0`)
- Transactional referral apply (no double-spend)
- Stripe tolerance tightened to 0.1%
- Admin key now uses dedicated `ADMIN_API_KEY` env var
- Referral code entropy 4 bytes (65k combinations)
- `orchestrations.query` index for fast GROUP BY
- Feedback migrated from JSONL file to SQLite

### Chunk 5 — P2P Mesh Network Foundation
- libp2p node (`src/mesh/node.ts`): TCP, Yamux, Noise encryption, Kademlia DHT, Ping
- `GET /v1/mesh/peers` — lists known peers (auth required)
- `peers` table in SQLite — persists peer IDs, multiaddrs, last_seen
- Peer discovery event listener → auto-upserts on connect
- Graceful start/stop wired into app lifecycle

**libp2p notes (for future chunks):**
- `@libp2p/node` does NOT exist — use `libp2p` (`createLibp2p`)
- Config key is `connectionEncrypters` (not `connectionEncryption`)
- `@libp2p/mplex` deprecated — use `@chainsafe/libp2p-yamux`
- `kadDHT` requires `ping` service to be registered alongside it
- VPS needs `sudo ufw allow 4001/tcp` to open swarm port

### Chunk 6 (Phase 1+2) — ClawHub Skill System
- `skills` table in SQLite with revenue share model
- `POST /v1/skills` — create skill (max 20/key, name validation, variable extraction)
- `GET /v1/skills` — public registry sorted by uses
- `GET /v1/skills/mine` — author's own skills
- `GET /v1/skills/:id` — skill detail (private skills auth-gated)
- `PATCH /v1/skills/:id/visibility` — publish / unpublish
- `DELETE /v1/skills/:id` — delete own skill
- `POST /v1/skills/:id/invoke` — render `{{variable}}` template → full orchestration pipeline
- Revenue share: author earns 10% of credits per invocation automatically
- Skill-level cache (SHA-256 of skillId + variables)
- Skill invocation uses same rate limits and credit system as orchestrate

### Professional API Key UX
- Email shows masked key only (`cn-xxxx••••••••xxxx`) with dashboard CTA button
- `GET /v1/dashboard/me` returns `maskedKey` — full key never exposed in list view
- `POST /v1/dashboard/reveal-key` — Clerk-authed, returns full key on demand
- `POST /v1/dashboard/regenerate-key` — atomic swap: deactivates old key, creates new one with same credits/email/amount_paid in a single SQLite transaction
- `maskApiKey()` helper used consistently in email and dashboard routes

### Telegram Intelligence Bot
- Interactive grammY bot (replaced one-way feed)
- Commands: `/start`, `/help`, `/trending`, `/analyze`, `/wallet`, `/news`, `/sentiment`, `/skills`, `/skill`, `/ask`, plain text queries
- Dynamic feed rotation from `apiRegistry` categories (auto-adapts when new endpoints added)
- Visual score bars (block chars), score emojis, HTML formatting
- Global 1-query-per-12-hour cooldown across ALL users (ultra-low-cost, anyone can trigger)

---

## Fintech & Billing Backlog

Items from the internal fintech audit. Ordered by priority. None of these require new infrastructure — all are changes to existing routes and config.

### G1 — Free Trial Credits on Signup *(code built, disabled)*
- Clerk webhook at `POST /v1/webhooks/clerk` is wired and deployed
- Grant is currently disabled (`FREE_TRIAL_CREDITS=0` default)
- **To activate:** set `FREE_TRIAL_CREDITS=100` in VPS `.env`, restart container
- **Also needed:** register `https://api.claw-net.org/v1/webhooks/clerk` in Clerk dashboard (user.created event), set `CLERK_WEBHOOK_SECRET=whsec_...` in VPS `.env`
- Budget constraint: hold until acquisition cost is justified by LTV data

### G2 — Credit Cost Estimate Endpoint
- `GET /v1/estimate?query=...` — runs intent parsing only (no execution), returns estimated credit cost
- Allows devs to budget before committing
- Low effort: reuse `parseIntent()` → count steps → sum `endpoint.costPerCall`

### G3 — Annual Pricing Plans
- 12-month prepay with ~15% discount vs monthly equivalent
- Example: $1,000/yr → 1,560,000 credits (vs 12× $100 = 1,344,000)
- Requires Stripe annual price IDs and a new row in `PRICE_CREDITS`

### G4 — Credit Cost Transparency in Docs + OpenAPI
- Add `estimatedCredits` field to each endpoint in the OpenAPI spec
- Add a pricing table to `docs.html` showing per-endpoint credit cost
- Formula: `creditsForApiCost(endpoint.costPerCall)` — already computed

### A2 — Reduce USDC Bonus from +10% to +7%
- USDC saves ~3% on Stripe processing fees; the current +10% bonus over-compensates
- Parity formula: USDC bonus should be ≤ Stripe fee savings (~7%)
- Change `USDC_PACKAGES` in `src/routes/solana.ts`
- Audit current margin before touching: confirm at what volume USDC becomes net-neutral

### C1 — Fallback Solana RPC
- Add `SOLANA_RPC_FALLBACK` env var; try primary, fall back on connection error
- Single point of failure today: if mainnet RPC is down, USDC payments fail silently
- Low effort: wrap `new Connection(rpcUrl)` with a retry on secondary

### D3 — Rate Limit Tier Policy Decision
- Current: tier based on lifetime `amount_paid` (accumulates across all purchases)
- Alternative: tier based on active subscription level or explicit tier assignment
- Decision needed before scaling: document the chosen policy in code comments

### D4 — Stripe Customer Portal
- Add self-service subscription management link in dashboard
- Stripe Billing Portal: `stripe.billingPortal.sessions.create()`
- New endpoint: `POST /v1/dashboard/billing-portal` → returns redirect URL

### E3 — Subscription Balance Cap
- Monthly subscribers accumulate credits indefinitely if unused
- Add cap: max `3 × creditsPerMonth` rollover (e.g., 120,000 for Scout tier)
- Implement in `topUpCredits` or subscription webhook handler

### H2 — Webhook Payload Size Limit
- Add 64KB max on raw body for all webhook endpoints (`/v1/webhooks/*`)
- Defense against memory exhaustion from crafted large payloads

### H3 — Stripe Webhook Secret Rotation
- Add to `docs/RUNBOOK.md`: rotate `STRIPE_WEBHOOK_SECRET` quarterly
- Steps: generate new secret in Stripe dashboard → update VPS `.env` → restart

### H4 — Admin Action Logging
- Extend `logAudit()` calls to all admin endpoints (payout updates, reconcile queries)
- Goal: full trail of who did what in the admin panel

### F4 — Load Test Benchmark
- Run 100 concurrent `POST /v1/orchestrate` calls against staging
- Measure p50/p95/p99 latency and SQLite write contention under load
- Target: p95 < 5s, no 500s, drift stays 0 post-test

---

## In Progress / Next

### Chunk 7 — Vector Search
Embed orchestration queries and results into a local vector store using `sqlite-vec` and ONNX embeddings. Goals:
- Semantic similarity cache: if a new query is semantically close to a cached result, return it without hitting LLM or ClawAPIs
- Recommend related skills from ClawHub based on query embedding
- Build a "learning" loop: high-rated responses (feedback score ≥ 4) are stored as reference answers

**Files to create:** `src/core/embeddings.ts`, `src/cache/vector.ts`
**Package:** `sqlite-vec`, `@xenova/transformers` (ONNX runtime)

### Chunk 8 — Escrow & Trustless Hiring
On-chain escrow for agent-to-agent or human-to-agent service agreements. Goals:
- `escrows` table: amount, requester, provider, state machine (OPEN → FUNDED → RELEASED / DISPUTED)
- Solana escrow program interaction via ClawAPIs
- Dispute resolution hook (admin or DAO)
- Webhook when escrow is funded or released

**Files to create:** `src/routes/escrow.ts`, `src/db/escrow.ts`

---

## Planned — Medium Term

### Chunk 9 — ClawHub Phase 3: Skill Composition
- Skills that call other skills (`{{skill:token-risk-check mintAddress=...}}`)
- Skill versioning (v1, v2) — authors can publish updates without breaking existing invocations
- Skill categories and tags for discovery
- Featured skills curated by ClawNet team
- Skill analytics: invocation count by day, revenue earned, avg rating

### Chunk 10 — Discovery Trinity
Three new agent discovery mechanisms that work over the libp2p mesh:
1. **Capability broadcast** — nodes announce which skills/endpoints they support
2. **Intent routing** — queries routed to the best-equipped peer in the mesh
3. **Reputation DHT** — peer ratings stored in Kademlia DHT keyed by peer ID

This chunk makes ClawNet a true peer network, not just a star topology.

### Chunk 11 — Webhook Subscriptions
Clients subscribe to real-time events instead of polling:
- `POST /v1/webhooks/subscribe` — register a URL to receive events
- Events: `token.alert`, `wallet.activity`, `sentiment.spike`, `skill.invoked`
- Delivery retry with exponential backoff
- HMAC signature on all outbound webhooks

### Chunk 12 — Agent Identity (DID)
- Each ClawNet key gets a Decentralized Identifier (DID) on Solana
- Skills signed by author DID — verifiable provenance
- DID resolution via the libp2p DHT
- Cross-chain identity mapping (Solana ↔ Ethereum)

---

## Planned — Long Term

### Chunk 13 — Agent Swarms
Coordinate multiple specialized agents to collaborate on complex multi-step tasks:
- Swarm coordinator role: breaks a task into sub-tasks, assigns to specialist agents
- Worker agents: each runs one domain (on-chain, social, news, risk)
- Result aggregation: coordinator synthesizes worker outputs
- Swarm sessions: persistent multi-turn conversations with shared context
- Billing: each worker's cost is tracked and billed to the session requester

**This is the vision:** any user query can spawn a temporary swarm of ClawNet nodes that self-organizes, executes, and dissolves — all billed via x402 micropayments.

### Chunk 14 — OpenClaw Native Integration
First-class OpenClaw citizen:
- ClawNet registers all its skills into OpenClaw's skill registry automatically
- OpenClaw agents can invoke ClawNet skills via x402 — zero configuration
- ClawNet subscribes to OpenClaw's endpoint feed — new endpoints added to ClawAPIs are auto-registered in `api-registry.ts` within minutes
- Shared DID namespace between ClawNet and OpenClaw agents

### Chunk 15 — Multi-Chain Expansion
ClawNet's payment and data layer expands beyond Solana:
- Ethereum/Base USDC payments via x402
- Cross-chain portfolio views (wallet holds assets on multiple chains)
- Bridge monitoring (Wormhole, deBridge alerts)
- Chain-agnostic escrow

### Chunk 16 — Enterprise Features
- Team API keys (org-level billing, member key management)
- SSO / SAML for enterprise dashboards
- SLA tiers with guaranteed response time
- Dedicated nodes (VIP customers get reserved capacity)
- Audit logs (who called what, when, what it cost)
- Usage exports (CSV, JSON) for accounting

---

## Ecosystem Vision

```
ClawAPIs.com
  └─ adds new endpoint (e.g., "NFT floor price")
        ↓
  ClawNet detects via endpoint feed (Chunk 14)
        ↓
  api-registry.ts updated automatically
        ↓
  Intent parser can now use the new endpoint
        ↓
  Community publishes skills using it on ClawHub
        ↓
  OpenClaw agents discover and invoke those skills
        ↓
  Revenue flows back to skill authors via 10% share
```

The flywheel: more endpoints → more skills → more agents → more invocations → more revenue → more development → more endpoints.

ClawNet's goal is to be the **router** at the center of this loop — the infrastructure layer that makes x402-powered AI agents composable, monetizable, and discoverable without any centralized gatekeeper.

---

## Technical Principles (never break these)

1. **No ORM** — raw SQL only (`better-sqlite3`), schema in `src/db/index.ts`
2. **No monorepo** — single flat repo, single deploy unit
3. **No magic** — every component is readable in isolation
4. **SQLite-first** — all persistent state in SQLite, Redis is cache only (lossy is ok)
5. **Credits, not subscriptions, as the base unit** — subscriptions just top up credits monthly
6. **Simulation mode always works** — no `SOLANA_PRIVATE_KEY` = mock data, server still runs
7. **One VPS** — scale vertically first, horizontal sharding only when forced
8. **API registry is the single source of truth** — adding an endpoint = add to registry, everything else picks it up (intent parser, Telegram feed, skill composition)
