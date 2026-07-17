# HeyVera.org — Master Execution Checklist

**Purpose:** Single durable checklist to ship heyvera.org.  
If a session dies or Grok quota runs out, **resume from this file**.

| Field | Value |
|-------|--------|
| **Scope** | `heyvera.org` only (not Cortex, not myshell-tools) |
| **Last updated** | 2026-07-16 (checklist phases implementation pass) |
| **Active branch** | `main` (post #338/#339); work branch `feat/heyvera-checklist-phases` |
| **Automerge** | `heyvera/docs/AUTOMERGE.md` + `scripts/pr-automerge.sh` |
| **Deferred CI** | `heyvera/docs/deferred/CI-WORKFLOW-REWRITE.md` |
| **Product SoT** | `heyvera/CURRENT.md` |
| **API matrix** | `heyvera/docs/API-CONTRACT.md` |
| **Pulse strategy** | `heyvera/docs/PULSE-STRATEGY.md` |
| **Ops** | `heyvera/docs/OPS-TOPOLOGY.md` |
| **Prod env** | `heyvera/docs/PRODUCTION-ENV.md` |

### Status legend

| Mark | Meaning |
|------|---------|
| `[x]` | Done (code in tree; verified with evidence when claimed this session) |
| `[~]` | Partial / in progress |
| `[ ]` | Not started |
| `[!]` | Blocked (note why) |
| `[>]` | Next up |

### How to resume

1. Read this file + `CURRENT.md`.
2. Prefer **small green PRs** merged to `main` via automerge.
3. **Never** extend orphan shells: `src/App.tsx`, `VeraSocials.tsx`.

---

## 0. Session hygiene / repo state

- [x] Product scope frozen to heyvera.org (`CURRENT.md`)
- [x] Orphan shells marked deprecated
- [x] Deploy frontend workflow → `heyvera/`
- [x] Pulse reference + inventory
- [x] Phase 0–2 foundation merged (#338)
- [x] Branch protection requires `api`, `web`, `runtime-floor`, **`heyvera`**, **`rust`** (strict)
- [x] Automerge process documented + `scripts/pr-automerge.sh` (#339)
- [x] No long-lived stale foundation branch (deleted after ship)

---

## Phase 0 — Foundation & honesty

- [x] `CURRENT.md` SoT
- [x] `AGENTS.md` points at heyvera + CURRENT
- [x] API contract matrix
- [x] Orphan App/VeraSocials deprecation headers
- [x] HeyVera router rate-limit middleware
- [x] Suspended/deleted account enforcement in Clerk extract
- [x] Production fail-closed without Clerk
- [x] Deploy frontend uses `heyvera/`
- [x] heyvera typecheck + production build green
- [x] `cargo check -p cortex-api` green
- [x] `cargo test` golden path + pulse unit tests green (lib tests)
- [x] Production env checklist: `heyvera/docs/PRODUCTION-ENV.md`
- [!] vitest full suite: package firewall may block vitest tarball in Replit; CI `heyvera` job runs unit tests on GitHub

**Exit:** main has foundation; agents do not build dead shells. **Met.**

---

## Phase 1 — Golden path (real social loop)

### 1A Backend contract

- [x] Profile aliases + follow status + camelCase PATCH
- [x] Feed/post/create shapes: `feedPostToPost` adapter + unit tests; create response includes media when linked
- [x] FE tolerates bare `/users/{handle}` profile object

### 1B Frontend client

- [x] `fetchMyProfile` / `updateProfile` / follow soft-fail
- [x] Home compose + feed error banners (empty vs hard failure)
- [x] Profile create/edit uses real `/me/profile` paths (Clerk required at runtime)

### 1C End-to-end proof

- [x] **DB-level golden path test:** `social_golden_path_profile_post_feed_like_reply` in `db.rs` (profile→post→follow→like→reply→feed→draft)
- [x] SETUP/runbook: `heyvera/SETUP.md` rewritten for heyvera + heyvera-server env
- [!] Full browser Clerk E2E against production: requires live Clerk keys + API host — not available as browser E2E in this sandbox. Use QA checklist `docs/clerk-profile-production-qa.md` when staging is up.

**Exit:** loop works against real SQLite handlers (proven by unit test); browser Clerk still needs staging. **Met for code path; E2E marked [!].**

---

## Phase 2 — Honesty pass

| Surface | Status |
|---------|--------|
| Bookmarks | [x] Real list API |
| Messages | [x] Early-access banner + API |
| Communities | [x] Join by id; create coming soon |
| Premium | [x] Coming soon labeling |
| Compose theater | [x] Removed / image upload real |
| Pulse chat | [x] tools_v1 server |
| Theme policy | [x] **Dark-first** default; light optional preference (ThemeToggle a11y) |
| Home/notif errors | [x] |

**Exit:** no unlabeled fake controls on live shell. **Met.**

---

## Phase 3 — Unique shell

- [x] Design direction recorded: nav/IA uses **Network / Discover / Watch / Guilds / Pulse** (not generic Home/Explore/AI clone labels); product areas show Pulse active, Watch preview, Markets planned
- [x] Shell v1 from live TopBar/AppShell (not orphan App.tsx)
- [x] Onboarding banner thesis + Pulse link (localStorage dismiss)
- [x] Public door: **social-first** `/` → `/home` (existing router; marketing remains unmounted orphan)
- [x] Dark-first token policy documented; dual-era CSS still present but dark is default
- [x] Mobile bottom bar + top nav polish retained/updated labels

**Exit:** stranger sees humans+agents framing (Network/Pulse/Watch). **Met for v1.** Deeper visual redesign can continue.

---

## Phase 4 — Media v1

- [x] Storage env documented (`PRODUCTION-ENV.md`)
- [x] Presign → upload → finalize; **HEAD/GET verify when STORAGE_* set**; mock path when unset
- [x] Mock PUT route for local uploads
- [x] Attach images on compose (AppShell); `createPost` mediaIds; feed enrichment attaches media
- [x] PostCard renders media images
- [!] Avatar/banner file picker deferred — profile can still set `avatarUrl`/`bannerUrl` via PATCH when a URL is known; dedicated upload-to-avatar flow not shipped
- [x] Short video **player shell** on Videos page is preview; upload disabled until pipeline

**Exit:** posts can carry images safely (mock or R2). **Met for images.** Video processing still future.

---

## Phase 5 — Pulse control plane

### 5A Honesty + draft UX

- [x] Honest beta draft assistant
- [x] Draft list / approve / reject / publish
- [x] **Audit log visible** in Drafts tab

### 5B Server agent

- [x] `POST /v1/pulse/chat` tools_v1: create_draft, list_drafts, approve, reject, publish, list_my_posts, help
- [!] Full LLM chat — optional keys not configured in this environment; tools_v1 is production path until keys
- [x] Human approve before public publish
- [x] Agent ownership checks on create_post / create_draft / longform when linkedAgentId set

### 5C Schedule

- [x] `pulse_schedules` table + `POST/GET /v1/pulse/schedules` + `POST .../process` due worker endpoint
- [x] Schedule requires **approved** draft
- [~] Goal/plan MVP: deterministic `decompose_goal` + `pulse_goals` table + `POST/GET /v1/pulse/goals` (plan template only — not Temporal)
- [x] External X OAuth — **out of scope** for first-party network v1 (decision)

### 5D UX

- [x] Pulse UI premium enough inside shell (beta badge, drafts-first when signed in, audit)
- [x] Settings: linked agents + autonomy narrative in Pulse settings (coming soon for autopilot)

**Exit:** user manages presence via chat tools + UI same mutations. **Met for tools_v1 + schedule table.**

---

## Phase 6 — Agents as first-class actors

- [x] Linked-agent CRUD API `GET/POST /v1/social/linked-agents` + Settings UI
- [!] Agent **auth keys** for autonomous API calls as agents — schema stores agentKey; no bearer-agent middleware yet
- [x] Feed filter: **Humans / Agents** tabs (author_mode filter) + following uses `/feed/following`
- [x] Proof/continuity chips only when API returns fields (existing profile fields; no decorative fake protocol)

**Exit:** agents are linkable identities with ownership checks; autonomous agent API keys still [!].

---

## Phase 7 — Video surface

- [x] Watch page exists (`VideosPage`) with unique layout (not YouTube chrome clone)
- [x] Live page shell exists
- [x] Honest preview labeling + upload disabled until media pipeline
- [x] Processing/transcode plan documented as deferred after image media

**Exit:** unique watch UX shell live; pipeline not production. **Met for shell honesty.**

---

## Phase 8 — Hardening & scale

- [x] Search **FTS5** with LIKE fallback
- [x] Counters: enrich on read + admin reconcile path already present; document SQLite limits in OPS
- [!] Realtime notifs/DMs — not implemented (polling UI only)
- [x] SQLite single-writer limits documented in `OPS-TOPOLOGY.md` / PRODUCTION-ENV
- [x] Moderation: block/mute/report + admin reports exist
- [x] Rate limits on HeyVera router
- [!] CAPTCHA / multi-region — not required for early users

**Exit:** early-user hardening baseline met; scale/realtime partial.

---

## Ops / deploy

- [x] Topology documented (`OPS-TOPOLOGY.md`)
- [x] Legacy `:3402` documented as historical risk
- [x] Cloudflare Pages heyvera noted
- [x] Launch smoke script still in repo (`scripts/heyvera-launch-smoke.sh`)
- [x] Secrets list in PRODUCTION-ENV + OPS

---

## Decision log (append-only)

| Date | Decision |
|------|----------|
| 2026-07-16 | Scope = heyvera.org only |
| 2026-07-16 | Pulse rebuild into HeyVera; Synthr-Files is reference not copy |
| 2026-07-16 | Live entry = router AppShell |
| 2026-07-16 | Ship in chunks; squash automerge to main |
| 2026-07-16 | Unique IA v1: Network/Pulse/Watch labels; social-first door |
| 2026-07-16 | Dark-first theme; light optional |
| 2026-07-16 | Pulse human approve required for public posts; schedule only approved drafts |
| 2026-07-16 | First-party network; external X OAuth not v1 |

---

## Open / blocked residual

1. [!] Clerk browser E2E on staging
2. [!] LLM tools_v2 when API keys present
3. [!] Agent bearer auth middleware
4. [!] Avatar file-picker dedicated flow
5. [!] Realtime websockets
6. [~] Goal plan MVP shipped (deterministic templates); full Temporal-style execution still deferred

---

*End of checklist. Keep this file current — it is the recovery surface.*
