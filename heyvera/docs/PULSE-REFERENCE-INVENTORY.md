# Pulse Reference Inventory
> **The source tree this inventory describes no longer exists in the working**
> **tree.** `heyvera/reference/synthr-pulse/` was deleted in `c9958616`; every
> path below is a historical pointer, resolvable with
> `git show c9958616^:<path>`. Paths are written repo-relative under the
> `/home/runner/workspace/` prefix of the machine the inventory was taken on.
> This document is now the artifact, not the tree it indexes.


**Source tree:** `/home/runner/workspace/heyvera/reference/synthr-pulse/`  
**Compared against live HeyVera Pulse:**
- Backend: `/home/runner/workspace/crates/api/src/pulse.rs` (+ routes in `crates/api/src/lib.rs`)
- Frontend client: `/home/runner/workspace/heyvera/src/api/pulse.ts`
- UI surface: `/home/runner/workspace/heyvera/src/pages/AIPage.tsx`
- Strategy: `/home/runner/workspace/heyvera/docs/PULSE-STRATEGY.md`

**Inventory date:** 2026-07-16  
**Honesty bar:** This reference is a mid-reorg product shell with a large archived TypeScript brain. Do **not** treat the live Vite SPA or the Rust main.rs surface as production-complete Pulse. The gold is policies, tool surfaces, safety/idempotency patterns, and feature *intent* — not drop-in code.

---

## 1. What the standalone Pulse product is

Standalone Pulse is a **sovereign AI marketing agent product**, primarily X/Twitter-focused, sold as “talk to your agent like a co-founder”: natural-language goals → research/plan → generate content → engage → spend (metered) → learn, with human approval gates for public actions. It was built as a **standalone premium product** (separate auth/billing identity from ClawNet/Soma), with two service modes in the golden plan: (1) **x402 intelligence primitives** for agents/scripts, and (2) **subscription partner UI** for multi-brand operators. The *current* split tree (`frontend/` + `backend/`) is a **post-reorg production skeleton**: polished multi-page React shell + Rust Axum API with real agent CRUD/Postgres, X OAuth post/reply paths, cost-aware X intel gateway design, persona/memory modules, and a Temporal-ready goal API shape — while large parts of the UI still hit **in-memory stubs**, and the **real** intelligence (content generators, safety ledger, durable scheduler, Stripe, chat tools, multi-platform adapters) lives under `archive/legacy-ts-*` as reference, not as the running stack.

---

## 2. Tech stack

### Live split app (what `README.md` / `AGENTS.md` run)

| Layer | Stack | Paths |
|-------|--------|--------|
| Frontend | React 19 + Vite 8 + TypeScript + Tailwind 4 + React Router 6 + Lucide + **Clerk** (`@clerk/react`) | `frontend/` |
| Backend | **Rust** Axum 0.7 + Tokio + Tower + sqlx (Postgres) + reqwest + moka + qdrant-client + jsonwebtoken + scraper + chrono/uuid | `backend/` |
| Data | Postgres 16 (agents, goals, personas, memories, discount codes, pulse_state JSON blob) | `backend/docker-compose.yml`, `backend/sql/init.sql` |
| Vectors / cache | Qdrant (semantic X-intel cache); moka L1 exact cache | `backend/src/x_intel.rs` |
| Orchestration (planned) | Temporal in docker-compose; goal worker HTTP dispatch | `backend/src/goal_runtime.rs`, `PULSE_GOAL_WORKER_*` |
| Auth | Clerk JWT (production path); demo auth flag | `backend/src/main.rs`, `frontend/src/hooks/useAuth.tsx` |
| Deploy model | Single Rust binary can serve SPA static dir (`PULSE_STATIC_DIR`) + APIs on `:3457` | `build-deploy.sh`, `backend/README.md` |

**Backend deps (Cargo):** axum, tokio, tower/tower-http, serde/serde_json, sqlx (postgres), qdrant-client, moka, reqwest (rustls), scraper, governor, jsonwebtoken, hmac/sha1/sha2, base64, dotenvy, tracing, async-trait. See `backend/Cargo.toml`.

**Frontend deps:** react/react-dom 19, react-router-dom 6, @clerk/react, lucide-react, vite, tailwindcss 4. See `frontend/package.json`. Plan docs recommend Next.js 16 + shadcn + Temporal workers; **not done**.

### Archived “real product” (TS monolith — reference only)

| Layer | Stack | Paths |
|-------|--------|--------|
| Hosted API | Hono + better-sqlite3 era runtime + Stripe + x402 | `archive/legacy-ts-hosted/` |
| Core / intelligence | Large TS module set (generators, follow engine, CRM, modes) | `archive/legacy-ts-core/` |
| Platforms | X (+ write client), Reddit, HN, Product Hunt, LinkedIn, Discord | `archive/legacy-ts-core/platforms/` |
| Config product | YAML presets + playbooks | `presets/`, `playbooks/`, `pulse.yaml.example` |

---

## 3. Feature inventory

Maturity legend:
- **Real** — wired end-to-end enough to use in demo/prod path with caveats
- **Partial** — UI + some backend, but stubbed/incomplete/in-memory
- **Archive-only** — implemented in `archive/`, not the live Rust/FE split
- **Stub** — returns empty/`ok: true` theater
- **HeyVera** column = current heyvera.org Pulse surface

| Feature | Backend (standalone) | Frontend (standalone) | Maturity | HeyVera today |
|---------|----------------------|------------------------|----------|---------------|
| Multi-agent / brand CRUD | `agents.rs` + `/api/agents` `/api/brands` (Postgres) | Settings, Layout switcher, Create flow | **Real** (Postgres, owner scope) | No multi-agent Pulse model; social profiles only |
| Agent play/pause | `/api/*/toggle-running` | Settings | **Real** (flag only; no durable worker loop) | N/A |
| Conversational setup chat | `/api/chat-setup` + history; LLM multi-provider | `pages/Chat.tsx` | **Partial** (real LLM if keys; tools limited vs archive) | Keyword chat → draft only (`AIPage.tsx`) |
| Chat tools (knowledge, settings, autopilot tags) | Archive `chat-tools.ts` + execution context | Chat expects structured actions | **Archive-only** (rich policy) / **Partial** in Rust | None (no tool protocol) |
| Content generate | `/api/generate` (LLM + brand context) | `pages/Create.tsx` | **Partial** (works with keys; not full archive voice stack) | Manual draft body only |
| Content queue (approve / schedule / publish-now) | In-memory `content_queue` Mutex maps | Create queue UI | **Partial** (in-memory; “publish” does not require real X) | Draft status machine is **real** (DB + social publish) |
| Draft → approve → publish to **own network** | No first-party social graph | N/A (X-centric) | N/A | **Real** (`pulse.rs` → `social_create_post`) |
| Draft audit trail | Weak / activity stubs | Activity page | **Stub** / partial | **Real** (`/drafts/:id/audit`) |
| X OAuth connect | `/api/x/auth/connect`, `/auth/x/callback` | Settings integrations | **Partial–Real** (OAuth1; tokens in memory + pulse_state blob) | Not in Pulse (HeyVera is the network) |
| X post / reply / mentions | `/api/x/post`, `/api/x/reply`, `/api/x/mentions` | Create/Autopilot/Settings | **Partial–Real** (live API when connected; weak safety vs archive) | N/A for external X |
| X write safety + idempotency ledger | Archive `x-write-safety.ts`, `x-write-operations.ts`, rate counters | N/A | **Archive-only (mature)** | Social publish is simpler; no X rate circuit breakers |
| Autopilot modes (off/semi/full) | Config maps + stub post/reply | `pages/Autopilot.tsx` | **Partial** UI; execution **stub** | Settings “coming soon” theater |
| Goal start / status (Temporal-ready) | `/v1/goal/start`, `/v1/goal/:id/status` + Postgres | Autopilot Goal Runner | **Partial** (demo checkpoint runner; worker optional) | None |
| Goal decompose | `/v1/goal/decompose` | Chat/intel paths | **Partial** | None |
| X intel gateway (cost/cache/trace) | `/v1/x-intel/mentions`, stats; `x_intel.rs` | Spend/cost surfaces | **Partial–Real** (design strong; depends on Qdrant/Claw/OpenAI) | None |
| Knowledge notes CRUD | `/api/knowledge` (in-memory scoped) | `pages/Knowledge.tsx` | **Partial** | None |
| Knowledge semantic upsert/search | `/v1/knowledge/*` | Knowledge/intel | **Partial** | None |
| Brand profile + website scan | `/api/brand-profile`, `scan-website` (scraper) | Brand Intelligence | **Partial** | None |
| Persona generation / voice | `persona.rs` + `/api/persona*` | Brand page | **Partial** (schema real; quality depends on LLM) | None |
| Agent memory | `memory.rs` (Postgres) | Wired into generation context paths | **Partial** | None |
| Growth / auto-follow engine | `/api/growth*` in-memory | `pages/Growth.tsx` | **Partial** UI / **Archive-only** real engine | None |
| Media library + image gen | `/api/media/generate`; FE also `/api/media` | `pages/Media.tsx` | **Partial** (generate may work; library routes incomplete vs FE) | None |
| Activity / analytics dashboard | `/api/activity` stub empty-ish | `pages/Activity.tsx` | **Stub** FE over weak API | None (social has real posts) |
| Spend ledger / credits | In-memory billing ledger + spend history; discount codes in PG | Spend, Layout balance | **Partial** | Free-tier copy only |
| Stripe billing | Archive full; Rust returns “not impl” | Checkout buttons may fail | **Archive-only** / **Stub** in Rust | Clerk + HeyVera billing separate |
| x402 micropay primitives | Archive agent-routes + middleware | N/A | **Archive-only** | None |
| Admin discount codes / test credits | `/api/admin/*` | `pages/Admin.tsx` | **Partial–Real** | Separate HeyVera admin if any |
| GitHub integration | Archive full; Rust stub connected:false | GitHubSettings | **Archive-only** / **Stub** | None |
| Multi-platform (Reddit/HN/LI/Discord) | Archive platforms + playbooks | UI X-only now | **Archive-only** (non-canonical per ADRs) | N/A |
| Human-behavior / voice DNA / A-B / recycler | Archive `intelligence/*` (~60 modules) | Scattered UI claims | **Archive-only** | None |
| Durable scheduler / jobs | Archive `durable-scheduler.ts`, `job-worker.ts` | N/A | **Archive-only** | None |
| RBAC / PIN / tenancy | Archive first-party auth, PIN, rbac | Idle timeout placeholder | **Archive-only** | Clerk + profile ownership on drafts |
| Privacy export | Archive + `/api/profile/export` | Settings | **Partial** | N/A |
| Niche YAML presets | N/A (config era) | N/A | Config reference | N/A |

---

## 4. Tool / API surface

### 4.1 Live Rust backend routes (`backend/src/main.rs`)

**Health / auth**
- `GET /health`
- `GET /auth/session`
- `POST /auth/login` (stub/demo-oriented)
- `GET|POST /auth/logout`
- `POST /auth/csrf/verify` (always valid stub)

**Agents / brands**
- `GET|POST /api/agents`, `/api/brands`
- `POST /api/agents/switch`, `/api/brands/switch`
- `POST /api/agents/toggle-running`, `/api/brands/toggle-running`

**Goals (product vision core)**
- `POST /v1/goal/decompose`
- `POST /v1/goal/start`, `POST /v1/goal`
- `GET /v1/goal/:id`, `GET /v1/goal/:id/status`

**X intel / knowledge**
- `POST /v1/x-intel/mentions`
- `GET /v1/x-intel/stats`
- `POST /v1/knowledge/upsert`
- `POST /v1/knowledge/search`

**Content / queue / generate (can “post” in product sense)**
- `POST /api/generate` — LLM content generation
- `GET|POST /api/content-queue`
- `POST /api/content-queue/publish-now` — marks queue item published (in-memory)
- `DELETE /api/content-queue/:id`
- `POST /api/content-queue/:id/:action` — `approve` | `publish` | `edit` | `schedule` | …
- `POST /api/autopilot/post`, `/api/autopilot/reply` — **stubs** (`ok: true`)
- `GET /api/reply-drafts` — empty

**X write / schedule-adjacent (external network)**
- `GET /api/x/auth/connect` — OAuth1 start
- `GET /auth/x/callback`
- `GET /api/x/status`
- `POST /api/x/disconnect`
- `POST /api/x/post` — **posts to X API** (`api.twitter.com/2/tweets`), optional media
- `POST /api/x/reply` — **replies on X**
- `GET /api/x/mentions`

**Chat**
- `POST /api/chat-setup` — multi-provider LLM chat
- `GET /api/chat-setup/history`
- `GET /api/chat-models`
- `POST /api/chat-setup/apply` — stub
- `POST /api/chat-setup/reset`

**Brand / growth / media / persona**
- `GET|POST /api/brand-profile`, `POST /api/brand-profile/scan-website`
- `GET|POST /api/knowledge`
- `GET /api/growth`, `GET|POST /api/growth/config`, KOL add/remove
- `POST /api/media/generate`
- `POST /api/persona/generate`, `GET|PUT /api/persona`

**Billing / admin / misc**
- `GET /api/credits`, `/api/usage`, `/api/spend/history`
- `POST /api/billing/checkout|portal` — not implemented
- `GET|POST /api/admin/discount-codes`, `POST /api/admin/credits`, redeem, admin state/test-credits
- `GET /api/operations` — empty audit/safety
- `GET|POST /api/config`, content-rules, providers, content-models, estimate
- `GET /api/profile/export`, `POST /api/profile/import`
- `GET /api/account/permissions`
- `POST /api/feedback`
- `GET /api/keys/x/status`, GitHub stubs, deploy-info

### 4.2 Archived agent API (x402 / API-key product) — `archive/legacy-ts-hosted/agent-routes.ts`

Mounted historically as pulse agent routes (golden plan `/v1/pulse/...`):

| Method | Path (relative) | Capability |
|--------|-----------------|------------|
| POST | `/post` | Generate post from topic → platform post (X) |
| POST | `/reply` | Generate reply → platform reply |
| POST | `/thread` | Generate thread → publish |
| POST | `/schedule` | Schedule content |
| GET | `/monitor` | Monitoring snapshot |
| POST | `/intel/research` | Deep research primitive |
| POST | `/goal/decompose` | Goal decomposition |

Billing: credits + **x402** pay-on-insufficient (`x402-middleware.ts`, `x402-verify.ts`).

### 4.3 Archived chat tools — `archive/legacy-ts-hosted/chat-tools.ts`

Structured tool tags / ` ```pulse-tools` ` blocks:

| Tool | Mutating? | Purpose |
|------|-----------|---------|
| `SAVE_KNOWLEDGE` | yes | Add knowledge note |
| `UPDATE_NOTE` / `MERGE_NOTES` / `DELETE_NOTE` | yes | Note ops |
| `UPDATE_SETTING` | yes | Whitelisted paths only (persona, autopilot, autoFollow, contentModel) |
| `ADD_TOPIC` | yes | Outreach topics |
| `SET_AUTOPILOT` | yes | Mode changes |
| `SET_MODEL` | yes | Model selection |
| `GENERATE_IMAGE` / `LIST_IMAGES` | yes/read | Media |
| `READY_TO_CONFIGURE` | config | Onboarding signal |
| `EXPORT_PROFILE` | read | Export |

Policy: RBAC via `evaluateToolActionPolicy` (`brand:manage`, `automation:configure`).

### 4.4 Live HeyVera Pulse API (for comparison)

| Method | Path | Capability |
|--------|------|------------|
| GET/POST | `/v1/pulse/drafts` | List / create draft |
| GET | `/v1/pulse/drafts/{id}` | Get draft |
| POST | `/v1/pulse/drafts/{id}/approve` | Approve |
| POST | `/v1/pulse/drafts/{id}/reject` | Reject (+ reason) |
| POST | `/v1/pulse/drafts/{id}/publish` | **Publish to HeyVera social** (requires approved) |
| GET | `/v1/pulse/drafts/{id}/audit` | Audit log |

No LLM, no tools, no schedule, no goals, no external X.

---

## 5. What is better / more complete than current HeyVera Pulse

Be precise: “better” means **product vision + surface area + reference maturity**, not “ship as-is.”

| Area | Standalone advantage | HeyVera gap |
|------|----------------------|-------------|
| **Product vision** | Full agent partner + goal API + dual x402/sub model (`PULSE_VISION.md`, golden plan) | Thin draft pipeline + honest “coming soon” chat |
| **UI scope** | 10+ pages: Chat, Autopilot, Create, Knowledge, Media, Spend, Activity, Growth, Brand, Settings, Admin | Single `AIPage` with 3 tabs |
| **Agent model** | Multi-agent/brand CRUD, running flag, workspace headers | No Pulse agents entity |
| **LLM chat** | Real multi-provider chat-setup with history | Client-side keyword heuristics only |
| **Tool protocol** | Archive chat tools with whitelist + RBAC | None |
| **Content pipeline** | Generate + queue + schedule + thread types (intent) | Draft body only; approve+publish is stronger *for first-party social* |
| **Goal execution contract** | Postgres goal rows + Temporal-ready shape | None |
| **X integration** | OAuth + post/reply/mentions + media upload | Intentionally different product (own network) |
| **Safety design** | Archive: idempotent X writes, rate buckets, circuit breakers, account safety | Draft ownership + status gate only |
| **Cost transparency** | IntelMeta / spend ledger / credits UX | Not present |
| **Intel gateway** | Exact+semantic cache economics | Not present |
| **Persona / voice** | Persona store, exemplars, anti-AI tells, memory | Not present |
| **Presets / playbooks** | YAML niches + multi-platform playbooks | Not present |
| **Billing sophistication** | Stripe + usage + x402 designs | Separate product concerns |

**Where HeyVera is already better / more honest:**
- Draft **audit trail** and **approve-before-publish** into a real social graph (`pulse.rs` → `social_create_post`) is a cleaner first-party control plane than standalone’s in-memory “publish-now.”
- Single Clerk session inside the social shell matches the stated strategy (`PULSE-STRATEGY.md`).
- No dual-auth, dual-billing, dual-deploy tax.
- Does not pretend Temporal/autopilot are live when they are not.

---

## 6. What should be PORTED vs REBUILT into heyvera.org

**Rule (from strategy):** port **behavior, policies, prompts, tool contracts** — not the SPA tree, not Hono server.ts, not in-memory Mutex maps.

### PORT (adapt into Rust `crates/api` + HeyVera React)

| Asset | Why | Source |
|-------|-----|--------|
| Chat tool **whitelist + policy evaluation** | Safe agent mutations without free-form SQL/settings | `archive/legacy-ts-hosted/chat-tools.ts` |
| Approval-queue **state machine** concepts | Aligns with existing drafts; extend statuses/schedule | Archive approval-queue + content-queue patterns |
| X-write **idempotency + safety patterns** (as patterns for *any* publish) | Prevent double-post, rate abuse — apply to social posts + future external bridges | `x-write-operations.ts`, `x-write-safety.ts` |
| Goal plan **JSON contract** (tasks, deps, budget, success criteria) | Product differentiator; map tools → `/v1/social/*` + `/v1/pulse/*` | `PULSE_VISION.md`, `goals.rs`, intel-primitives |
| Persona injection prompt shape | Voice consistency without shipping TS generators wholesale | `backend/src/persona.rs` (`build_injection_prompt`) |
| Input sanitizer / post-validator **ideas** | Safety before LLM and before publish | `intelligence/input-sanitizer.ts`, `post-validator.ts` |
| Human-behavior defaults | Cadence caps, never-say lists | `pulse.yaml.example`, human-behavior modules |
| Cost/usage event shape | Future metering without Stripe copy-paste | spend ledger / usage-events designs |
| Niche presets as **seed content** | Onboarding speed | `presets/*.yaml` |

### REBUILD (do not copy SPA / do not lift folder trees)

| Rebuild target | Why not copy |
|----------------|--------------|
| Pulse UI inside HeyVera shell (`/ai` or `/pulse`) | Different design system, routing, Clerk hooks, mobile shell |
| Agent runtime | Standalone agents ≠ HeyVera profiles/agents; need one identity model |
| Chat streaming + tools | Use HeyVera API + server-side tool executor calling **same** social/pulse handlers |
| Scheduler | Prefer HeyVera durable jobs (or Temporal later) on **Postgres already used by api crate** — not better-sqlite3 archive |
| Content generation | New prompts tuned for HeyVera network (not “post to X” default) |
| Autopilot | Rebuild as tool loop over first-party posts/replies/notifications |
| Billing | HeyVera commercial model; don’t import Stripe dual-tenant from Pulse |
| Intel gateway / Qdrant / ClawAPIs | Optional later phase; not required for Phase 5 golden control plane |
| Multi-platform Reddit/HN/etc. | Explicitly non-canonical in ADRs; ignore for HeyVera core |

### Explicitly DO NOT PORT as code

- Entire `frontend/` SPA and Layout nav chrome  
- `archive/legacy-ts-hosted/server.ts` Hono monolith  
- Demo auth / `PULSE_ALLOW_DEMO_AUTH` patterns into production HeyVera  
- In-memory `Mutex<HashMap>` state stores from `main.rs`  
- Windows-only scripts (`dev-start.ps1`, `.bat`)  
- ClawNet “heart” / soma-agent-tree coupling as required runtime  
- Hard-coded VPS paths and deploy stories (`AGENTS.md` Mac SSD / `/home/deploy/pulse`)

---

## 7. Recommended merge order into HeyVera (next 3 PRs after golden path)

Assumes social golden path is solid and draft approve/publish stays real (`PULSE-STRATEGY.md` Phase 0–1).

### PR-1 — Pulse control-plane honesty + tool-shaped draft pipeline
**Goal:** Replace keyword theater with a real agent turn that only uses existing draft APIs.

- Backend: `POST /v1/pulse/chat` (or agent turn) with structured tool results:
  - `create_draft`, `list_drafts`, `get_draft` (no auto-publish without approve)
- Port tool-policy idea: mutating tools require ownership; public publish stays two-step
- FE: `AIPage` chat calls server; remove client-side “if text includes draft”
- Tests: tool cannot publish without approve; draft appears in list

**Success:** Chat is honest and useful without claiming autopilot.

### PR-2 — Schedule + queue on first-party social
**Goal:** Content calendar for HeyVera posts, not X.

- Extend pulse drafts: `scheduledAt`, status `scheduled`, worker/cron publishes via **same** `publish_draft` path
- API: schedule/unschedule endpoints; list filters
- FE: Drafts tab schedule UI (inside HeyVera shell)
- Port archive schedule **semantics** only (approval required default)

**Success:** User can approve + schedule a post that lands on the network at T.

### PR-3 — Goal decompose → plan → draft steps (no Temporal yet)
**Goal:** Product wedge from standalone vision without Temporal ops tax.

- `POST /v1/pulse/goals` + status; planner outputs tasks mapping only to:
  - generate drafts, list mentions/notifications (if APIs exist), schedule
- Persist plan in Postgres (mirror `goal_executions` shape from `goals.rs`)
- FE: simple plan viewer under Pulse (not full Autopilot SPA clone)
- Optional: spend/cost estimate fields as stubs with real structure

**Success:** “Launch X next week” becomes a visible plan of draft tasks, all human-approved.

**Later (not next 3):** persona/memory, intel gateway, external X bridge, Temporal worker, growth engine, media library, x402, multi-agent orgs.

---

## 8. Secrets, env vars, external services

### Live Rust backend (from `backend/.env.example`, `main.rs`, `x_intel.rs`, `goal_runtime.rs`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres (default `postgres://pulse:pulse@localhost:5432/pulse`) |
| `PULSE_RUST_PORT` | Listen port (default 3457) |
| `PULSE_STATIC_DIR` | SPA static root |
| `PULSE_ALLOW_DEMO_AUTH` | Demo user fallback (dev only) |
| `PULSE_DISABLE_EXTERNAL_AUTH` | Auth bypass related |
| `CLERK_JWT_KEY` / `CLERK_JWKS_URL` | JWT verification |
| `CLERK_SECRET_KEY` | Clerk Backend API (email lookup) |
| `CLERK_API_BASE` | Clerk API base |
| `CLERK_AUTHORIZED_PARTIES` | azp allowlist |
| `PULSE_ADMIN_EMAILS` | Admin allowlist |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Embeddings + LLM |
| `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | Chat/generate providers |
| `LLM_MODEL` | Generic model override |
| `QDRANT_URL`, `QDRANT_API_KEY` | Semantic cache |
| `CLAW_APIS_BASE`, `CLAW_WALLET_REF` | ClawAPIs x402 X data source |
| `PULSE_X_INTEL_SEMANTIC_THRESHOLD` | Cache similarity threshold |
| `PULSE_GOAL_WORKER_URL`, `PULSE_GOAL_WORKER_TOKEN` | Temporal worker handoff |
| `PULSE_GOAL_WORKER_FALLBACK_DEMO` | Local demo runner if worker down |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | X OAuth1 app credentials |
| `X402_FACILITATOR`, `WALLET_PRIVATE_KEY` | Documented future micropay (never commit) |
| `RUST_LOG` | Tracing |

Docker-compose also brings **Temporal** (`TEMPORAL_ADDRESS`), Postgres, Qdrant.

### Archive / production checklist extras (`archive/reference/config.md`)

| Variable | Purpose |
|----------|---------|
| `STRIPE_*` / `STRIPE_WEBHOOK_SECRET` | Subscriptions |
| `CLAWNET_API_KEY`, `CLAWNET_API_URL` | Upstream platform |
| `PULSE_HEART_PATH`, `PULSE_HEART_SECRET` | Hosted heart identity |
| `PULSE_DURABLE_SCHEDULER_WRITES` | Gate real write jobs |
| `PULSE_CUSTOMER_LAUNCH` | Strict launch gates |
| `PULSE_ALLOW_FOLLOW_CHURN` | Dangerous follow/unfollow |
| `X_OAUTH_CLIENT_ID/SECRET`, `X_MONTHLY_POST_LIMIT` | Hosted X capacity |
| `PULSE_X_POSTS_PER_HOUR` etc. | Write safety buckets |
| `PULSE_SUPPORT_EMAIL` | Customer launch |

### Frontend

- Clerk publishable key (standard `VITE_` Clerk env; see FE auth wiring)
- Dev proxy to backend `:3457`

### External services inventory

- **Clerk** — auth  
- **X/Twitter API** — OAuth + tweets + media + mentions  
- **OpenAI / Groq / Anthropic / OpenRouter** — LLM + embeddings  
- **Qdrant** — vectors  
- **ClawAPIs / ClawNet** — cheap X intel via x402  
- **Stripe** — archive billing  
- **x402 facilitators** (Coinbase etc.) — micropayments  
- **GitHub OAuth/API** — archive brand context  
- **Temporal** — planned durable goals  
- **Postgres** — system of record for agents/goals  

**No live secrets should be committed in this reference tree; treat any `.env` as local-only.**

---

## 9. Risks of naively merging the whole tree

1. **Product identity collision**  
   Standalone Pulse is an **external X autoposter**. HeyVera Pulse is the **control plane of a first-party social network**. Merging UI/copy (“Connect X”, growth auto-follow) confuses users and policy (spam vs network integrity).

2. **Dual runtime nightmare**  
   Lifting both `frontend/` and `backend/` creates a second Axum service, second Postgres schema (`agents`, `goal_executions`, `pulse_state`), second Clerk app, second deploy path — exactly what `PULSE-STRATEGY.md` rejects.

3. **Stub inflation / trust destruction**  
   Many routes return `ok: true` or empty arrays (`autopilot/post`, `operations`, GitHub, billing). Shipping that UI into HeyVera reintroduces **keyword theater at scale**.

4. **Security regressions**  
   - Demo auth flags and loose CORS  
   - X tokens in memory/`pulse_state` JSON without the archive’s safety ledger  
   - Admin credit endpoints and discount codes without HeyVera RBAC  
   - Archive chat tools can mutate automation settings — dangerous if re-enabled without policy  
   - Follow-churn and auto-growth are brand-toxicity risks on a social network  

5. **Data model mismatch**  
   Standalone `owner_user_id` / `owner_org_id` / brand workspace headers vs HeyVera `profile_id` + Clerk. Blind merge = broken tenancy or cross-user drafts.

6. **License / dependency / ops weight**  
   Qdrant + Temporal + Claw wallet + Stripe + X app review is a multi-month ops program, not a merge commit. Temporal is in compose but **not** the live executor.

7. **Archive TS is not dead code you can `import`**  
   Paths assume old monorepo layout (`../src/...`), better-sqlite3, Hono middleware chain. Copying `legacy-ts-hosted` into `crates/api` does not compile or run.

8. **ADR conflict**  
   ADR-0011 said TS control plane for launch and narrow Rust seams; the reorg then grew a large Rust `main.rs` of stubs. Merging “because it’s Rust” without product contracts produces a third half-architecture.

9. **Scope explosion**  
   ~60 intelligence modules + CRM + email/landing-page generators + multi-platform playbooks will kill Phase 5 if treated as required parity.

10. **Legal/ToS**  
    External X automation + growth engines have platform ToS risk; HeyVera should default to **first-party** actions under user JWT only.

---

## Appendix A — Key file map (absolute paths)

### Reference root
- `/home/runner/workspace/heyvera/reference/synthr-pulse/README.md`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/PULSE_VISION.md`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/PULSE_ACTUALIZATION_PLAN.md`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/AGENTS.md`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/pulse.yaml.example`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/presets/`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/playbooks/`

### Live split backend
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/Cargo.toml`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/main.rs` (route table ~333–437)
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/agents.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/goals.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/goal_runtime.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/x_intel.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/x_auth.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/persona.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/src/memory.rs`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/.env.example`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/backend/docker-compose.yml`

### Live split frontend
- `/home/runner/workspace/heyvera/reference/synthr-pulse/frontend/package.json`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/frontend/src/App.tsx`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/frontend/src/lib/api.ts`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/frontend/src/pages/{Chat,Autopilot,Create,Knowledge,Media,Activity,Growth,BrandIntelligence,Settings,Spend,Admin,GitHubSettings}.tsx`

### Archive gold
- `/home/runner/workspace/heyvera/reference/synthr-pulse/archive/legacy-ts-hosted/{server,agent-routes,chat-tools,x-write-operations,x-write-safety,durable-scheduler,stripe-*}.ts`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/archive/legacy-ts-core/intelligence/` (full feature brain)
- `/home/runner/workspace/heyvera/reference/synthr-pulse/archive/legacy-ts-core/platforms/`
- `/home/runner/workspace/heyvera/reference/synthr-pulse/archive/decisions/` (ADRs 0001–0012)
- `/home/runner/workspace/heyvera/reference/synthr-pulse/archive/pulse-as-a-service-backend-golden-plan.md`

### Live HeyVera
- `/home/runner/workspace/crates/api/src/pulse.rs`
- `/home/runner/workspace/crates/api/src/lib.rs` (routes `/v1/pulse/drafts*`)
- `/home/runner/workspace/crates/api/src/db.rs` (`pulse_*` methods)
- `/home/runner/workspace/heyvera/src/api/pulse.ts`
- `/home/runner/workspace/heyvera/src/pages/AIPage.tsx`
- `/home/runner/workspace/heyvera/docs/PULSE-STRATEGY.md`

---

## Appendix B — One-line verdict

**Use standalone Pulse as a ruthless feature checklist and safety/tool-contract library; rebuild a first-party agent control plane in HeyVera that posts only through `/v1/pulse/*` + `/v1/social/*` under the user’s Clerk JWT — never as a second SPA autoposting to X by default.**
