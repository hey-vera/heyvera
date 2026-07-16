# HeyVera.org — Master Execution Checklist

**Purpose:** Single durable checklist to ship heyvera.org.  
If a session dies or Grok quota runs out, **resume from this file**.

| Field | Value |
|-------|--------|
| **Scope** | `heyvera.org` only (not Cortex, not myshell-tools) |
| **Last updated** | 2026-07-16 (cleanup: ship is foundation on main) |
| **Active branch** | `phase-0-heyvera-ship` (GitHub; contains origin/main + Phase 0–2/Pulse) |
| **Automerge** | `heyvera/docs/AUTOMERGE.md` + `scripts/pr-automerge.sh` |
| **Deferred CI** | `heyvera/docs/deferred/CI-WORKFLOW-REWRITE.md` |
| **Product SoT** | `heyvera/CURRENT.md` |
| **API matrix** | `heyvera/docs/API-CONTRACT.md` |
| **Pulse strategy** | `heyvera/docs/PULSE-STRATEGY.md` |
| **Pulse reference** | `heyvera/reference/synthr-pulse/` + `docs/PULSE-REFERENCE-INVENTORY.md` |

### Status legend

| Mark | Meaning |
|------|---------|
| `[x]` | Done (code in tree; may still need commit/merge to main) |
| `[~]` | Partial / in progress |
| `[ ]` | Not started |
| `[!]` | Blocked (note why) |
| `[>]` | Next up (pick these first) |

### How to resume (any agent / human)

1. Read this file + `CURRENT.md`.
2. Find first `[>]` or first open `[ ]` / `[~]` in order.
3. Prefer **small green PRs** merged to `main`.
4. After each chunk: update this checklist (`[x]` / notes / date), keep commits clean.
5. **Parallel is safe** only when tasks say `PARALLEL-OK` and they don’t edit the same files.
6. **Never** extend orphan shells: `src/App.tsx`, `VeraSocials.tsx`, unmounted public marketing (see CURRENT.md).

### Parallel rules

| Safe to parallelize | Do not parallelize |
|---------------------|--------------------|
| Docs-only vs code | Two agents on `social.ts` or `lib.rs` routes |
| FE polish on page A vs page B (no shared API) | FE + BE same feature without a contract freeze |
| Inventory / research agents | Both rewriting CI |
| Independent backend handlers on **different** modules | Mass refactor + feature work same time |

---

## 0. Session hygiene / repo state

- [x] Product scope frozen to heyvera.org (`CURRENT.md`)
- [x] Orphan shells marked deprecated
- [x] CI paths pointed at `heyvera/` (not legacy `web/`)
- [x] Deploy frontend workflow → `heyvera/`
- [x] Pulse reference cloned from `hey-vera/Synthr-Files` → `heyvera/reference/synthr-pulse/`
- [x] Pulse inventory written (`docs/PULSE-REFERENCE-INVENTORY.md`)
- [x] **Commit Phase 0 + Phase 1 path work** (merged into ship on main)
- [x] Phase 2 honesty + Pulse tools_v1 on `phase-0-heyvera-ship`
- [x] Local foundation branch superseded; deferred CI saved under docs/deferred/
- [x] Open PR → merge `phase-0-heyvera-ship` to `main` (#338 MERGED, full green) → merge to `main` when checks green (automerge if branch protection ready); `gh` not logged in on runner
- [ ] Branch protection + required checks (`heyvera` + `rust`) + automerge process documented/enabled on GitHub
- [ ] Do not leave long-lived stale feature branches

**WIP files (as of last update — stage intentionally, exclude noise):**

```
.github/workflows/ci.yml
.github/workflows/deploy-frontend.yml
crates/api/src/clerk.rs, db.rs, lib.rs, ratelimit.rs, social.rs
heyvera/AGENTS.md, CURRENT.md, CHECKLIST.md
heyvera/docs/API-CONTRACT.md, PULSE-STRATEGY.md, PULSE-REFERENCE-INVENTORY.md
heyvera/frontend-sync/STATUS.md
heyvera/src/App.tsx, VeraSocials.tsx, social.ts, ReplyCompose.tsx, ExplorePage.tsx
heyvera/tsconfig.app.json
heyvera/reference/**
```

**Do not commit:** `.cortex/*.db*`, accidental `TopContextBar` edits unless intentional, unrelated `.gitignore` noise unless wanted.

---

## Phase 0 — Foundation & honesty

**Goal:** One truth, safe API defaults, CI on real paths.

- [x] `CURRENT.md` SoT
- [x] `AGENTS.md` points at heyvera + CURRENT
- [x] API contract matrix started
- [x] Orphan App/VeraSocials deprecation headers
- [x] HeyVera router rate-limit middleware
- [x] Suspended/deleted account enforcement in Clerk extract
- [x] Production fail-closed without Clerk (`HEYVERA_ENV` / `APP_ENV` / `HEYVERA_REQUIRE_AUTH`)
- [x] CI: heyvera typecheck/unit/build job + rust check/test
- [x] Deploy frontend uses `heyvera/`
- [x] heyvera typecheck + production build green (in sandbox; vitest blocked by package firewall)
- [x] `cargo check -p cortex-api` green after auth/rate-limit/alias work
- [ ] `cargo test --workspace --lib` green on CI (confirm on GitHub after push)
- [ ] vitest unit tests green where firewall allows (CI runner may work; local Replit blocked vitest)
- [ ] Production env checklist: `CLERK_SECRET_KEY`, `HEYVERA_ENV=production`, CORS origins, R2 if media

**Exit:** main has Phase 0 merged; no agent builds dead shells.

---

## Phase 1 — Golden path (real social loop)

**Goal:** Clerk → profile → post → feed → reply/like works against Rust.

### 1A Backend contract (PARALLEL-OK with 1B only after paths listed)

- [x] Alias `GET /v1/social/profiles/{handle}` → profile + linkedAgents
- [x] Alias `GET /v1/social/profiles/{handle}/linked-agents`
- [x] Alias `PATCH /v1/social/profile` → update me
- [x] `GET /v1/social/follows/{handle}/status`
- [x] Update profile accepts camelCase + snake_case
- [ ] Confirm feed/post/create response shapes match FE adapters (`feedPostToPost`, etc.)
- [ ] Optional: wrap `GET /users/{handle}` as `{ profile }` for consistency (or keep bare + FE tolerant)

### 1B Frontend client alignment

- [x] `fetchProfile` uses `/users/{handle}` with wrap tolerance
- [x] `fetchMyProfile` prefers `/me/profile`
- [x] `updateProfile` → `/me/profile` with snake_case body
- [x] `fetchFollowStatus` soft-fails if missing
- [ ] Smoke-test Home compose + feed load error banners (no silent empty when API down)
- [ ] Profile page create/edit path verified with Clerk

### 1C End-to-end proof

- [ ] Local or staging: sign-in → create profile → post → see on home → like → reply → open thread
- [ ] Document env vars for local heyvera + heyvera-server in `SETUP.md` or short runbook
- [x] Path fixes committed; merge to main still open
- [ ] Local/staging E2E still needs live API + Clerk

**Exit:** a real user can complete the loop without mock data.

---

## Phase 2 — Honesty pass (kill theater)

**Goal:** Every visible control works or is hidden/labeled.

| Surface | Action | Status |
|---------|--------|--------|
| Bookmarks list/folders | Real list API **or** hide folders / simplify | [x] `GET /bookmarks` + no fake folders |
| Messages | E2E DMs **or** alpha badge / hide | [x] Early-access banner; API kept |
| Communities join | Real membership + create **or** hide create/join chrome | [x] Join/leave by id; create = coming soon |
| Premium | Real billing **or** “coming soon” | [x] CTAs/features labeled |
| Compose media/emoji/poll | Wire or remove non-functional buttons | [x] Theater removed |
| Pulse keyword chat | Replace with real chat **or** label “draft tools only” | [x] Honest UI + `POST /v1/pulse/chat` tools_v1 |
| Theme vs dark-only policy | Decide once; align CSS/spec | [ ] |
| Home/notif errors | Empty vs failure | [x] |

**PARALLEL-OK:** each row can be a separate agent if files don’t overlap (e.g. BookmarksPage vs MessagesPage).

**Exit:** no fake product features on the live shell.

---

## Phase 3 — Unique shell (stop being X-shaped)

**Goal:** Differentiated humans+agents IA — not X clone with green accent.

- [ ] Design brief: layout principles (unique nav, agent presence, proof chrome) — **user approval**
- [ ] Implement shell v1 from **live** router (not orphan App.tsx)
- [ ] Onboarding that states product thesis in &lt;10s
- [ ] Public door decision: social-first `/` **or** marketing CTA → app (user choice)
- [ ] Unify design tokens (kill dual CSS eras)
- [ ] Polish mobile bottom bar + desktop layout

**Exit:** stranger doesn’t say “this is just X.”

---

## Phase 4 — Media v1 (images first)

- [ ] R2/storage env production-ready
- [ ] Presign → upload → finalize **with object verify**
- [ ] Attach images to posts; render in PostCard
- [ ] Avatar / banner upload
- [ ] Then short video upload + basic player (not full YouTube)

**Exit:** posts carry real media safely.

---

## Phase 5 — Pulse control plane (rebuild, not copy)

**Source of truth for intent:** `reference/synthr-pulse/` + inventory.  
**Implementation home:** `crates/api/src/pulse.rs` + `heyvera/src/pages/AIPage.tsx` + tools calling **same** social mutations.

### 5A Honesty + draft UX (do early)

- [x] Remove / relabel keyword-bot chat as intelligence
- [x] Draft list / approve / reject / publish UX (existing; signed-in defaults to Drafts)
- [ ] Audit log visible in UI

### 5B Server agent (core)

- [x] `POST /v1/pulse/chat` — **tools_v1** deterministic router (create_draft, list_drafts, help)
- [ ] Upgrade chat to real LLM with same tools (optional when keys available)
- [ ] Tools: approve, reject, publish, list_my_posts from chat
- [x] Human approve required for public publish in v1 (publish path unchanged)
- [ ] No agent spoof: linked agent ownership checks when authorMode=agent

### 5C Schedule & goals (from standalone inventory)

- [ ] Schedule table + publish worker (or cron) for first-party posts
- [ ] Goal/plan → draft tasks (port **behavior**, not Temporal/X stack wholesale)
- [ ] Optional later: external X OAuth only if product still wants off-network publish

### 5D UX polish

- [ ] Pulse UI feels premium inside HeyVera shell (unique, not standalone SPA paste)
- [ ] Settings: autonomy level (off / drafts only / schedule with approve)

**Do not:** vend entire `reference/synthr-pulse/frontend` as second site.  
**Do not:** import auto-follow growth engines as default.

**Exit:** user can manage presence via chat and UI; tools = API = UI.

---

## Phase 6 — Agents as first-class actors

- [ ] Linked-agent CRUD API + UI
- [ ] Agent auth (scoped key / capability) for subset of actions
- [ ] Feed filter: person / agent / both
- [ ] Proof/continuity chips only when fields real

---

## Phase 7 — Video surface (if still a pillar)

- [ ] Watch page / profile media tab
- [ ] Processing pipeline plan (transcode deferred until needed)
- [ ] Unique watch UX (not YouTube chrome)

---

## Phase 8 — Hardening & scale

- [ ] Search FTS or better than LIKE
- [ ] Counters on write / reconcile
- [ ] Realtime notifs/DMs if product needs
- [ ] SQLite limits documented or Postgres plan for social
- [ ] Moderation queue workflow
- [ ] Social SLIs / logging
- [ ] Rate limits tuned; CAPTCHA/abuse later if open network

---

## Ops / deploy (ongoing)

- [ ] Confirm production topology: heyvera-server vs cortex-server route split for `/v1/social` + `/v1/pulse`
- [ ] Kill or document legacy `:3402` ClawNet path if still in Caddy
- [ ] Cloudflare Pages root = `heyvera` (if CF) + proxy `/v1`
- [ ] Launch smoke script path valid for current hosts
- [ ] Secrets: Clerk, Stripe (if premium), R2, LLM keys for Pulse

---

## Suggested execution order (next sessions)

| Order | Task id | Parallel? | Owner style |
|-------|---------|-----------|-------------|
| 1 | §0 commit/PR Phase 0+1 | serial | human/git |
| 2 | Phase 1C E2E smoke | serial after API up | agent + human |
| 3 | Phase 2 honesty rows | **PARALLEL-OK** per surface | multiple agents |
| 4 | Phase 5A Pulse honesty + drafts | parallel with Phase 2 if different files | agent |
| 5 | Phase 5B chat+tools | after 5A | agent (backend + FE) |
| 6 | Phase 3 unique shell | after 1–2 stable; needs design nod | plan then agents |
| 7 | Phase 4 media | after golden path | agent |
| 8 | Phase 5C schedule | after 5B | agent |
| 9 | Phase 6–8 | later | agents |

---

## Agent prompt starter (copy when resuming)

```
You are working on heyvera.org only (heyvera/ + crates/api HeyVera router).
Read heyvera/CHECKLIST.md and heyvera/CURRENT.md first.
Pick the next [>] or first open [ ] / [~] in the agreed order.
Do not touch Cortex or myshell-tools.
Do not extend orphan App.tsx / VeraSocials.
Prefer small green changes; update CHECKLIST.md status when done.
Pulse = rebuild into HeyVera; reference only at heyvera/reference/synthr-pulse/.
```

---

## Decision log (append-only)

| Date | Decision |
|------|----------|
| 2026-07-16 | Scope = heyvera.org only |
| 2026-07-16 | Pulse rebuild into HeyVera; Synthr-Files is reference not copy |
| 2026-07-16 | Live entry = router.tsx AppShell, not region App.tsx |
| 2026-07-16 | Ship in chunks; merge to main; no stale branches |
| 2026-07-16 | Unique IA over long term; don’t cement X-clone forever |
| 2026-07-16 | Phase 2 honesty shipped: bookmarks API, compose theater removed, Pulse tools_v1 chat |

---

## Open questions for Josh (don’t invent)

1. Public door: marketing `/` vs social-first?
2. Unique shell now vs after golden path only?
3. Video pillar at launch or attachments-first?
4. Pulse: hard human approve forever for v1 public posts?
5. Automerge: enable after CI green on GitHub?

When answered, append to Decision log and tick related tasks.

---

*End of checklist. Keep this file current — it is the recovery surface.*
