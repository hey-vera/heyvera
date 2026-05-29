# Cortex 100% Production Checklist

> Canonical product checklist. Every item tested on cortex.heyvera.org before checked off.
> Vision doc: `docs/CORTEX-PRODUCT-VISION.md`
> Technical spec: `docs/ARCHITECTURE.md`, `docs/reference/cortex-operations-room.md`

---

## Phase 0: Foundation Fix (NOW — ship-blocking)

- [ ] **0.1** BYOS Claude auth: click Link → container → `claude auth login` → OAuth URL → user logs in → copies code → pastes → credential stored encrypted
- [ ] **0.2** BYOS OpenAI auth: click Link → container → `codex login --device-auth` → device code + URL → user enters code → poll until OAuth completes → credential stored
- [ ] **0.3** Container lifecycle: 409 conflict reuse, startup < 10s, cleanup on credential delete, stale container reaping
- [ ] **0.4** BYOK API key flow (admin-only): paste key → encrypted → stored → used for chat routing
- [ ] **0.5** Auth status: `/api/auth/status` reflects reality, frontend shows connected/disconnected per provider
- [ ] **0.6** Multi-credential: Claude + OpenAI simultaneously, default selection, independent delete
- [ ] **0.7** Basic chat works: send message → get streaming response → message persists → conversation history loads
- [ ] **0.8** Deploy pipeline: commit → push → `deploy-cortex` on VPS, Cloudflare auto-deploys frontend

---

## Phase 1: Project Chat (one user, one project — the core product)

### Infrastructure
- [ ] **1.1** Chat routes to BYOS container CLI correctly
- [ ] **1.2** Chat routes to BYOK API with user's key correctly
- [ ] **1.3** SSE streaming: tokens appear smoothly, no buffering artifacts
- [ ] **1.4** Intent classification: `/fix`, `/explore`, `/review`, `/think` commands + automatic detection
- [ ] **1.5** Tier routing: vibing → fast model (Haiku/mini), thinking → balanced (Sonnet/4.1), coding → powerful (Opus/5.5)
- [ ] **1.6** Model switch is seamless — user doesn't notice, just Cortex thinks harder when needed
- [ ] **1.7** Conversation CRUD: create, list, load, delete, auto-title from first message

### Personality
- [ ] **1.8** System prompts carry Cortex personality across all intents — not generic "AI assistant"
- [ ] **1.9** Cortex vibes, challenges ideas, is opinionated, cares — consistent across model tiers
- [ ] **1.10** Personality is per-user (same Cortex across projects), not per-project

### UX
- [ ] **1.11** Glass morphism, animations, premium dark theme
- [ ] **1.12** Markdown rendering + syntax-highlighted code blocks + copy button
- [ ] **1.13** Slash commands with autocomplete
- [ ] **1.14** Skeleton loaders, spinner on async, no blank screens
- [ ] **1.15** Error states are human-readable with retry buttons
- [ ] **1.16** Empty states are inviting ("Start a conversation with Cortex")
- [ ] **1.17** Auto-scroll on new messages, respect manual scroll position
- [ ] **1.18** Mobile responsive: chat works on phone, sidebar collapses

---

## Phase 2: Personal Task Manager (your command center)

### Data Model
- [ ] **2.1** `projects` table: id, team_id (nullable), name, repo_url, created_at
- [ ] **2.2** `conversations.project_id` column: link private chats to projects
- [ ] **2.3** `runs.project_id` + `runs.source_conversation_id`: link tasks to projects and chats

### Features
- [ ] **2.4** Create project from chat: "Start a new project" → project created, repo linked
- [ ] **2.5** GitHub repo import: OAuth → list repos → select → project created
- [ ] **2.6** Project list in sidebar with status indicators
- [ ] **2.7** Personal Task Manager chat surface: talk to Cortex about all your work
- [ ] **2.8** "How are my projects doing?" → DB query formatted as response (free, no LLM)
- [ ] **2.9** "What did I ship this week?" → activity summary across all projects
- [ ] **2.10** Task creation: user says "fix the auth bug" in Project Chat → Task appears in Personal Task Manager
- [ ] **2.11** Task status: inbox → ready → active → blocked → review → done
- [ ] **2.12** Personal Live Map: text-based status of all your work (visual graph is Phase 7)

---

## Phase 3: Billing & Onboarding (first impression)

### Billing
- [ ] **3.1** Stripe checkout: $6.99/mo or $69/yr
- [ ] **3.2** Subscription status gates product access
- [ ] **3.3** Promo codes: entry during checkout, discount applied
- [ ] **3.4** Referral links: friends get better deals, referrer gets free weeks
- [ ] **3.5** Usage tracking visible but not anxiety-inducing

### Onboarding
- [ ] **3.6** No separate wizard — users land in the product
- [ ] **3.7** Mock data demo for prospects: fake project, fake chat, fake task execution — spectacular
- [ ] **3.8** Tutorial for paying users: link subscription → import repo → first message → coding in 60 seconds
- [ ] **3.9** Tutorial button always accessible to replay
- [ ] **3.10** Free tier: mock demo available, real product requires subscription

---

## Phase 4: Teams (multi-user coordination)

### Data Model
- [ ] **4.1** `teams` table: id, name, owner_id, created_at
- [ ] **4.2** `team_members` table: team_id, user_id, role (lead/member/viewer), joined_at
- [ ] **4.3** Projects belong to teams (team_id on projects table)
- [ ] **4.4** `resource_leases` table: type, key, holder_step_id, holder_user_id, acquired_at, expires_at

### Features
- [ ] **4.5** Create team, set name, invite members via email/link
- [ ] **4.6** Team roles: lead (full control), member (work + suggest), viewer (read-only)
- [ ] **4.7** Team Task Manager surface: shared, shows all members' tasks
- [ ] **4.8** Private chat → task emission: when you create work in your chat, it appears in team Task Manager
- [ ] **4.9** Conflict prevention: Task Manager acquires leases on file areas, blocks overlapping work
- [ ] **4.10** "Hey Personal Task Manager, how's my team doing?" → queries Team Task Manager → returns rollup
- [ ] **4.11** "Did Alice finish the auth fix?" → team task status (not Alice's private chat)
- [ ] **4.12** "Add this security bug as a task to all my teams" → cross-team task creation
- [ ] **4.13** Team Live Map: text-based view of all team members' work being orchestrated

---

## Phase 5: Credential Delegation (Soma)

- [ ] **5.1** `credential_delegations` table: id, credential_id, delegated_to, scope_type, max_tokens, tokens_used, expires_at, status
- [ ] **5.2** "Delegate my Claude sub to Team B for 1 week or 1M tokens" via Personal Task Manager
- [ ] **5.3** Scope narrowing: delegation can't exceed parent scope
- [ ] **5.4** Token counting per delegation, visible in Personal Task Manager
- [ ] **5.5** Automatic expiry: time-based or token-based, whichever hits first
- [ ] **5.6** Manual revoke: cancel delegation early, in-flight work saved gracefully
- [ ] **5.7** Cascade: revoking parent delegation kills all child delegations
- [ ] **5.8** Team members use delegated credentials in their containers
- [ ] **5.9** Delegation status visible in Team Task Manager

---

## Phase 6: Agent Memory & Personality (the moat)

- [ ] **6.1** `user_preferences` table: coding_style, domain_hints, personality traits
- [ ] **6.2** Cortex learns user's style over time (implicit, from chat patterns)
- [ ] **6.3** User can tell Cortex things: "I prefer functional style", "I work in fintech"
- [ ] **6.4** Memory view: user sees what Cortex knows about them
- [ ] **6.5** Memory management: user can edit/delete specific memories
- [ ] **6.6** Memory injected as context in every chat message
- [ ] **6.7** Personality consistent across model tiers (system prompt carries it)
- [ ] **6.8** Personality consistent across projects (it's YOUR Cortex everywhere)

---

## Phase 7: Visual Live Maps

- [ ] **7.1** Network graph layout: spatial topology of projects, tasks, agents
- [ ] **7.2** Timeline layout: left-to-right flow of work
- [ ] **7.3** Board layout: status columns (kanban-style)
- [ ] **7.4** Real-time updates via SSE/WebSocket
- [ ] **7.5** Personal scope: see your work being orchestrated
- [ ] **7.6** Team scope: see all members' work being orchestrated
- [ ] **7.7** Click-to-inspect: click node → see task detail, logs, artifacts
- [ ] **7.8** Evidence visibility: see what Cortex has proven (diffs, tests, builds)

---

## Phase 8: Advanced Orchestration

- [ ] **8.1** DAG decomposition: "build auth system" → search → design → implement → test → review
- [ ] **8.2** Git worktree-per-attempt: isolated execution, Brain-approved merge
- [ ] **8.3** Dynamic heal insertion: test fails → auto-generate fix → re-test
- [ ] **8.4** Evidence-backed completion: task done = diff + tests + verifier verdict
- [ ] **8.5** Multi-worker scheduling: fair round-robin, per-user concurrency limits
- [ ] **8.6** Lease enforcement: no two workers touch same files
- [ ] **8.7** Stale lease recovery: orphaned work detected and cleaned up

---

## Security & Infrastructure (ongoing)

- [ ] **S.1** Credentials encrypted at rest (AES)
- [ ] **S.2** JWT verification on all protected routes (Clerk)
- [ ] **S.3** Per-user rate limits on expensive endpoints
- [ ] **S.4** Input validation: message length, file paths, SQL parameterized
- [ ] **S.5** Container isolation: user containers can't access each other
- [ ] **S.6** HTTPS via Caddy on cortex.heyvera.org
- [ ] **S.7** Database backups (SQLite)
- [ ] **S.8** Health checks + Prometheus metrics
- [ ] **S.9** Error logging with tracing (structured, searchable)

---

## Settings & Admin (supporting)

- [ ] **A.1** Settings: providers, account, billing, integrations tabs
- [ ] **A.2** Session controls: speed/intelligence/autonomy sliders
- [ ] **A.3** Profile selection: auto/balanced/cost-saver/quality-first
- [ ] **A.4** Admin panel: workers, containers, usage, promo codes, audit log
- [ ] **A.5** Admin: view/manage all user containers and credentials

---

## Priority Summary

| Priority | Phase | What | Why |
|----------|-------|------|-----|
| **NOW** | 0 | Auth + basic chat | Can't use the product without this |
| **Week 1-2** | 1 | Project Chat perfected | The core interaction |
| **Week 2-3** | 2 | Personal Task Manager | Command center |
| **Week 3-4** | 3 | Billing + onboarding | First impression + revenue |
| **Week 4-6** | 4 | Teams | Secondary audience |
| **Week 6-7** | 5 | Credential delegation | Team resource sharing |
| **Week 7-8** | 6 | Agent memory | The moat |
| **Week 8+** | 7 | Visual live maps | Premium visualization |
| **Week 10+** | 8 | Advanced orchestration | Full engine |
