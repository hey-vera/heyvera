# ClawNet v3 — Claude Code Briefing
> Paste this into Claude Code (VSCode) to continue the project from where we left off.

---

## What This Project Is
ClawNet is a sovereign AI agent orchestration layer and economy built on the ClawNet v3 roadmap. The roadmap has 14 chunks. **Chunks 1–7 are complete and live in production at claw-net.org.** We are continuing from Chunk 8 onwards.

The roadmap specified certain tools. **Some were intentionally swapped during development — do not revert these.** Always follow the "Actual Stack" column below, not the roadmap's original spec.

---

## ⚠️ Stack Deviations — CRITICAL, Read First

| Roadmap Said | What Was Actually Built | Notes |
|---|---|---|
| Fastify 5 | **Hono 4.6+** | Same concepts, different API. All routes use Hono. Do not add Fastify. |
| Turborepo + pnpm monorepo | **Single repo, npm** | No workspaces. Everything is flat in `claw-net/`. |
| Vite + React SPA dashboard | **Plain HTML files** in `/var/www/claw-net/` | `dashboard.html`, `index.html` etc. Static files, NOT in git. |
| Drizzle ORM | **Raw better-sqlite3** | No ORM. Direct SQL queries. |
| ERC-8004 agent identity | **Clerk** (production auth) | Centralized for now. ERC-8004 is future work. |
| x402 / XRP payments | **Stripe + USDC on Solana** | Stripe for card payments. USDC via Phantom wallet for crypto. |
| Reown AppKit (wallet auth) | **Clerk** for auth, **Phantom** for USDC only | Phantom only used for USDC payment flow, not general auth. |
| pnpm | **npm** | Use npm for all installs. |
| systemd secrets via sops | **.env file** on VPS | Standard dotenv. |
| @libp2p/node + kad-dht | **NOT YET BUILT** | This is the next major chunk to build. |
| sqlite-vec | **NOT YET BUILT** | Vector search not yet added. |
| Vitest | **tests/run.ts** integration tests | Basic tests exist but not Vitest. |
| GitHub Actions CI | **NOT SET UP** | No CI pipeline yet. |

---

## What's Live in Production

**VPS:** DigitalOcean, Ubuntu 24.04.4, IP 24.199.121.137, Node 22.22.1, Docker 29.3.0  
**SSH:** `guardian-vps` (alias for `guardian@24.199.121.137`)  
**Deploy:** SSH in, run `deploy` (git pull + docker compose up + chown)

**Backend:** `/home/guardian/claw-net/` — Hono API on port 3402, Docker + Redis  
**Frontend:** `/var/www/claw-net/` — static HTML (NOT in git, edit via nano on VPS)  
**Local repo:** `C:\Users\Josh\Desktop\GitHub\claw-net`

### Completed (Phases 0–4):
- ✅ VPS, Ubuntu 24.04, Node, Caddy (auto-TLS), UFW, fail2ban, Docker, swap
- ✅ Hono API server with Pino logging, Zod validation, rate limiting (60/min/IP)
- ✅ SQLite WAL mode database (better-sqlite3)
- ✅ In-memory LRU cache + Redis L2 cache
- ✅ Clerk auth (production) — login, dashboard, JWT middleware
- ✅ Intent parser (GPT-4o primary, Claude fallback) → parallel executor → LLM synthesizer
- ✅ x402/ClawAPIs integration — 183 endpoints (Solscan Pro 22, Helius 80, X/Twitter 81)
- ✅ Stripe payments (live mode) — 6 credit packages $5–$1,000
- ✅ USDC/Solana payments — Phantom wallet, on-chain verify, +10% bonus credits
- ✅ Credit system: 1 credit = $0.001, deduction = `Math.max(1, Math.ceil(apiCosts * 2000))`
- ✅ Resend email (API key delivery, claim tokens)
- ✅ Telegram bot (grammy)
- ✅ Circuit breaker
- ✅ Admin dashboard endpoint
- ✅ Log rotation + encrypted backup cron
- ✅ Contact form endpoint (`POST /v1/contact`)
- ✅ Frontend: landing page, pricing, USDC modal, dashboard, login, success pages

---

## Remaining Roadmap Chunks

Work through these **in order** — each builds on the previous.

---

### ✅ CHUNK 5: P2P Mesh Network Foundation
**Status: COMPLETE**
**Goal:** Add @libp2p/node peer-to-peer mesh so agents can discover and communicate directly.

Key deliverables:
- Install `@libp2p/node`, `@libp2p/kad-dht`, `@libp2p/noise` in the project
- Configure a libp2p node with Kademlia DHT for peer discovery
- Persist peer data to SQLite (add `peers` table to existing schema)
- Expose mesh diagnostics via Hono route `GET /v1/mesh/peers`
- Run as a background service (can use a simple `setInterval` keep-alive or worker thread — NOT a separate systemd unit yet since we're on Docker)
- UFW: open port 4001 for libp2p swarm connections
- Test: two instances discover each other via DHT and exchange a typed message

**Schema to add:**
```sql
CREATE TABLE IF NOT EXISTS peers (
  id TEXT PRIMARY KEY,
  multiaddr TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  metadata_json TEXT
);
```

**Constraint:** Do NOT use the old `libp2p` monolith package. Use `@libp2p/node` (modular).

---

### ✅ CHUNK 6: Vector Search & Embeddings (ClawAPIs Social Layer)
**Status: COMPLETE**
**Goal:** Add semantic skill/agent search using sqlite-vec and local ONNX embeddings.

Key deliverables:
- Install `sqlite-vec` extension (pure C, no Faiss dependency)
- Install `@huggingface/transformers` (ONNX runtime, CPU, no Python needed) — use `all-MiniLM-L6-v2` model
- Add vector columns to a new `discovery_cache` table
- Build embedding pipeline: text → ONNX model → float32 vector → sqlite-vec storage
- Expose `POST /v1/discover` endpoint: takes a natural language skill query, returns ranked results by cosine similarity
- Seed with embeddings for the 183 existing ClawAPIs endpoints

**Schema to add:**
```sql
-- After loading sqlite-vec extension:
CREATE VIRTUAL TABLE IF NOT EXISTS skill_embeddings USING vec0(
  embedding float[384]  -- all-MiniLM-L6-v2 output dimension
);
CREATE TABLE IF NOT EXISTS discovery_cache (
  id TEXT PRIMARY KEY,
  skill_name TEXT,
  skill_desc TEXT,
  provider TEXT,
  rowid_vec INTEGER,  -- FK to skill_embeddings rowid
  ttl_expires TEXT
);
```

**Constraint:** sqlite-vss is deprecated, do not install it. Use sqlite-vec only.

---

### ✅ CHUNK 7: Escrow & Trustless Hiring (ClawEarn)
**Status: COMPLETE**
**Goal:** Implement a trustless escrow layer so agents can hire other agents and release payment on completion.

Note: The roadmap specified `clawearn` but that may not be a real npm package. Implement the escrow logic directly using the existing payment infrastructure (Stripe + USDC) with a state machine in SQLite.

Key deliverables:
- Add `escrows` and `audit_log` tables to SQLite
- Escrow state machine: `CREATED → FUNDED → WORK_IN_PROGRESS → COMPLETED | DISPUTED → RESOLVED`
- Hono routes:
  - `POST /v1/escrow/create` — create escrow (hirer, worker, amount, deadline)
  - `POST /v1/escrow/:id/fund` — fund from credits
  - `POST /v1/escrow/:id/release` — mutual approval releases to worker
  - `POST /v1/escrow/:id/dispute` — flags for arbitration
  - `GET /v1/escrow/:id` — get status
- Automatic release: cron job checks deadlines, auto-releases after timeout
- All events written to `audit_log`
- Write a sub-design doc (`docs/escrow-design.md`) covering: arbitration model, evidence format, timeout behavior, appeal process — BEFORE coding

**Schema to add:**
```sql
CREATE TABLE IF NOT EXISTS escrows (
  id TEXT PRIMARY KEY,
  hirer_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  amount_credits INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'CREATED',
  created_at TEXT NOT NULL,
  deadline TEXT,
  completed_at TEXT,
  metadata_json TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  data_json TEXT,
  timestamp TEXT NOT NULL
);
```

---

### ✅ CHUNK 8: Core Mesh Skill v3 — Part 1
**Status: COMPLETE**
**Goal:** Build the first self-contained "skill" — a packaged capability that agents can discover, hire for, and execute. This is the core unit of the agent economy.

Key deliverables:
- Define `SKILL.md` format spec (system prompt, input schema, output schema, pricing, metadata)
- Build a `skills/` directory in the repo for ClawHub skill packages
- Create first skill: **"Token Analysis"** — wraps existing orchestrator logic into a publishable skill
- Skill metadata: name, description, version (semver), author, price_credits, input_schema (Zod), output_schema
- Discovery integration: skill gets embedded via Chunk 6 pipeline on publish
- Hiring integration: creates an escrow via Chunk 7 on invocation
- Reputation tracking: record skill invocation results to `reputation_events` table
- Vitest test suite covering skill invocation end-to-end

**Schema to add:**
```sql
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  author_id TEXT NOT NULL,
  description TEXT,
  price_credits INTEGER NOT NULL DEFAULT 1,
  input_schema_json TEXT,
  output_schema_json TEXT,
  published_at TEXT,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS reputation_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  skill_id TEXT,
  event_type TEXT NOT NULL,
  score_delta REAL,
  data_json TEXT,
  timestamp TEXT NOT NULL
);
```

---

### ✅ CHUNK 9: Core Mesh Skill v3 — Part 2
**Status: COMPLETE**
**Goal:** Add self-evolution — skills can fork themselves, A/B test variants, and auto-publish improvements.

Key deliverables:
- Skill forking: `POST /v1/skills/:id/fork` — creates a new version with provenance chain
- A/B testing framework: run original vs fork on identical inputs, compare metrics (latency, success rate, cost, satisfaction)
- Performance metrics collection — store in `skill_metrics` table
- Auto-publish: if fork beats original by configurable threshold, promote it
- Rollback: atomic version switch if new version underperforms
- Royalty split: if a fork earns revenue, original author gets configurable % — track in `transactions` table

**Schema to add:**
```sql
CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  forked_from_version TEXT,
  forked_by_agent TEXT,
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS skill_metrics (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version TEXT NOT NULL,
  latency_ms INTEGER,
  success INTEGER,
  cost_credits INTEGER,
  timestamp TEXT NOT NULL
);
```

---

### 🔴 CHUNK 10: Discovery Trinity
**Status: NOT STARTED**  
**Goal:** Combine all three discovery methods into one ranked, fault-tolerant system.

Three discovery layers:
1. **On-chain** — query ERC-8004 registry (or mock if not yet deployed) for agent identities
2. **ClawAPIs semantic** — vector similarity search via sqlite-vec (Chunk 6)
3. **P2P gossip** — real-time peer announcements via libp2p (Chunk 5)

Key deliverables:
- Aggregation engine with **configurable weights** in `config/discovery.json` (not hardcoded)
- Graceful degradation: if one layer is down, re-weight the others automatically
- Cache invalidation: TTL-based for on-chain, event-driven for P2P, embedding refresh for semantic
- Hono route: `POST /v1/discover` accepts `{ query, filters, weights? }`, returns ranked agent/skill list
- Discovery analytics written to `audit_log`
- Test: disable each layer individually, verify results still return

---

### 🟡 CHUNK 11: Dashboard Upgrade (Vite + React) — OPTIONAL
**Status: Partially done as plain HTML. Decision needed.**

The roadmap says Vite + React SPA. Currently you have plain HTML that works. **Do not do this chunk unless you decide to migrate** — it's a large refactor for the dashboard and doesn't affect the API.

If you do it:
- Init Vite + React in `dashboard/` directory
- Reown AppKit for wallet auth (`@reown/appkit`)
- TanStack Query for API data
- TanStack Router for routing
- Build outputs to `/var/www/claw-net/` (Caddy serves it as static files)

If you skip it: keep the plain HTML dashboard and move on.

---

### 🔴 CHUNK 12: Marketplace & Economics
**Status: NOT STARTED**  
**Goal:** Full skill marketplace — browse, purchase, earn royalties.

Key deliverables:
- Marketplace API: `GET /v1/marketplace/skills` — paginated, filterable, sorted by popularity/price
- Purchase flow: buyer spends credits → escrow created → skill executed → credits released to seller
- Royalty tracking: fork revenue splits tracked in `transactions` table
- Staking: agents can stake credits to boost reputation/visibility
- Referral system: referral codes, bounty tracking
- Discovery fee: 2–4% optional platform fee on marketplace transactions
- Agent spawner: local Docker container spawn for agent instances (docker-compose, NOT remote VPS)

---

### 🔴 CHUNK 13: Swarms, Governance & Security
**Status: NOT STARTED**  
**Goal:** Multi-agent coordination, governance, and security hardening.

Key deliverables:
- Encrypted swarm comms: libp2p noise + group key exchange (requires Chunk 5)
- Swarm primitives: task decomposition, work assignment, result aggregation
- ClawGuard module: ECDSA message signing (standard, NOT ZK-SNARKs), sandbox skill testing, reputation gating
- Governance: weighted voting (ERC-8004 identity weight) — proposal, vote, execute
- Discord bot integration for community coordination
- Telegram bot already exists — extend for agent notifications
- Security review: audit all routes against OWASP Top 10

---

### 🔴 CHUNK 14: Testing, Docs & Launch Hardening
**Status: PARTIAL**  
**Goal:** Production hardening, comprehensive tests, documentation.

Key deliverables:
- Vitest suite for all API routes and core logic
- Playwright E2E tests for dashboard flows (`npx playwright install chromium`)
- Load test: 100+ concurrent agents (use Docker Compose on separate machine, NOT prod VPS)
- Security audit checklist document
- Full API reference (auto-generated from Hono route schemas)
- Installation guide, architecture diagrams (Mermaid)
- 3–4 bootstrap skills published to ClawHub
- Production monitoring: healthcheck endpoints, uptime alerts (UptimeRobot or Healthchecks.io)
- Runbook: what to do when SQLite locks, mesh node crashes, escrow times out

---

## Current File Structure (what exists)
```
claw-net/
├── src/
│   ├── config/index.ts          # Zod env config
│   ├── config/api-registry.ts   # 183 endpoint definitions
│   ├── core/
│   │   ├── intent-parser.ts
│   │   ├── executor.ts
│   │   ├── formatter.ts
│   │   ├── heartbeat.ts
│   │   └── circuit-breaker.ts
│   ├── providers/llm.ts
│   ├── providers/clawapis.ts
│   ├── db/index.ts              # SQLite WAL setup (better-sqlite3, no ORM)
│   ├── cache/index.ts           # LRU + Redis wrapper
│   ├── middleware/auth.ts        # X-API-Key check
│   ├── middleware/rate-limit.ts
│   ├── middleware/clerk-auth.ts  # Clerk JWT
│   ├── routes/api.ts            # POST /v1/orchestrate
│   ├── routes/feedback.ts
│   ├── routes/admin.ts
│   ├── routes/stripe.ts
│   ├── routes/dashboard.ts
│   ├── routes/solana.ts         # USDC payment routes
│   ├── routes/contact.ts
│   ├── integrations/telegram.ts
│   └── utils/
│       ├── logger.ts
│       ├── usage.ts             # getUsageStats()
│       ├── shutdown.ts
│       ├── solana.ts
│       └── email.ts
├── tests/run.ts
├── scripts/backup.sh
├── scripts/rotate-logs.sh
├── Dockerfile
├── docker-compose.yml
└── docs/README.md
```

---

## Key Technical Patterns to Follow

**Hono route pattern:**
```typescript
import { Hono } from 'hono'
const route = new Hono()
route.post('/endpoint', clerkAuth, async (c) => {
  const body = await c.req.json()
  // ...
  return c.json({ ok: true })
})
export default route
```

**SQLite pattern (no ORM):**
```typescript
import Database from 'better-sqlite3'
const db = new Database('./data/clawnet.db')
db.pragma('journal_mode = WAL')
const row = db.prepare('SELECT * FROM table WHERE id = ?').get(id)
```

**Clerk auth middleware already exists** at `src/middleware/clerk-auth.ts` — import and use it.

**Stripe + dashboard routes must be registered BEFORE Clerk middleware** in `src/index.ts`.

**Redis:** `REDIS_URL=redis://redis:6379` (Docker service name, not localhost).

**pino redacts** any field matching `/key|token|secret|password/i`.

---

## Environment (VPS .env)
```
PORT=3402
NODE_ENV=production
LLM_PROVIDER=openai
OPENAI_API_KEY=<set>
ANTHROPIC_API_KEY=<set>
ANTHROPIC_MODEL=claude-sonnet-4-20250514
CLAWAPIS_BASE_URL=https://api.clawapis.com
CLAWAPIS_API_KEY=<set>
REDIS_URL=redis://redis:6379
MARKUP_PERCENT=15
RATE_LIMIT_PER_MIN=60
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=<set>
RESEND_FROM=noreply@claw-net.org
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuY2xhdy1uZXQub3JnJA
SOLANA_RECEIVING_WALLET=H6xbRyGEyoTdfBEShSt2H3oHJxL3gaJjVGdL5MLKwHN7
TELEGRAM_BOT_TOKEN=<set>
TELEGRAM_CHANNEL_ID=<set>
```

---

## Where to Start
**Next chunk = Chunk 8 (Core Mesh Skill v3 — Part 1).** Chunks 1–7 are complete and live.
