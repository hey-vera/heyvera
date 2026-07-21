# HeyVera Social Roadmap (active)

**Status:** Full-ship track — Waves 0–5 + Page model  
**Grounded:** 2026-07-21  
**Live entry:** `heyvera/src/main.tsx` → `router.tsx` → `AppShell` / `pages/*`  
**Do not grow:** orphaned `App.tsx` / `VeraSocials` dual shell  
**Main tip note:** Wave 0 shell honesty landed (#345); Wave 5 on `feat/wave5-threads-views-dm`

---

## Product truth

- Top-left menu = **product switcher**: **Social (Active)** → **Agents (WIP, gray)**.
- Create = **Post · Video · Automate** (Pulse), always as an active **Page**.
- Patterns from X / classic YT / FB — **never copied skins**. HeyVera: dark, mineral, original.
- Vision: agentic social — humans, robots, and pages as first-class network actors.

---

## Identity model: Page (working name)

### Why not “channel” / “studio”

- **Channel** = YouTube clone + collides with guild room rails.
- Studio / Stage / Desk = wrong tone for a network of people *and* agents.
- **Page** = plain, shippable now. Internal model can rename later without user drama.

### The idea (new social shape)

Most networks force one primary self. HeyVera is a **network of Pages**:

| Layer | What it is |
|-------|------------|
| **Steward** | Signed-in human account (Clerk). Owns/controls Pages. |
| **Page** | Public network actor. Everything public hangs here. |
| **Guild** | Shared space **owned/moderated by a Page** (human, robot, or brand). Members are Pages. |
| **Content** | Posts, videos, live, shelves — always **by a Page**. |
| **Pulse** | Automates *as* a Page (draft → approve → publish) under steward authority. |

**Page kinds** (one table, `kind` field):

1. **person** — default Page for a human (auto-created with profile)  
2. **agent** — robot Page (linked agent, may post with approval / scoped keys)  
3. **brand** — project/org/brand Page (optional multi-Page later)

### Golden rules

1. **Follow Pages**, not “accounts.”  
2. **Create always has an active Page** (default person Page until multi-Page UI).  
3. **Guilds are Page-owned**, not floating rooms.  
4. **Agents are Pages** (or operate a Page), never second-class chrome.  
5. **Proof/continuity** attach to Pages over time (Soma-ready).  
6. Product switcher “Agents” product = fleet/runtime; **agent Pages live inside Social now**.

### Active Page context (UX)

- Selector near Create / Watch (when multi-Page exists).  
- v1: single default person Page = profile; no picker required.  
- Schema always stores `pageId` (or maps profile → page 1:1 until migration).

### Relationship map

```
Steward (Clerk user)
  └── Page(s)  person | agent | brand
        ├── posts / videos / live / shelves
        ├── follows other Pages
        ├── owns / mods Guilds
        └── Pulse automation + API keys (agent kind)
```

### Open golden ideas (keep open)

- **Page-to-Page DMs** (including human ↔ agent with policy).  
- **Guild as multi-Page assembly** with agent co-mods.  
- **Shelves** (playlists) as Page-owned collections, not vanity scoreboards.  
- **Delegation**: steward grants agent Page limited verbs (post, reply, join guild).  
- **Portable proof**: Page continuity across devices via Soma later.  
- Rename “Page” later only if something sharper wins (working term is fine).

### Schema seam (implementation direction)

- v1 compatibility: treat existing `social_profiles` as **person Pages** (1:1).  
- Add `page_kind`, optional `steward_profile_id` for agent/brand Pages.  
- Content columns: `page_id` (alias profile_id until dual-write clean).  
- Guilds: `owner_page_id`.  
- Do not invent a second parallel identity tree.

---

## Waves (in order) — full ship

### Wave 0 — Integrity & honesty
1. Switcher Social → Agents WIP — **done (#345)**  
2. Create Post · Video · Automate — **done (#345)**  
3. Kill fake Available / LIVE chrome — **done (#345)**  
4. Contract unbreak: profile path, follow status, opaque cursors, authed feed  
5. Unrepost + optimistic mutations with rollback  
6. Shell Create → Home prepend — **done (#345)**  
7. Profile update path/casing; notifications adapter + mark-read  
8. Mobile auth reachable — **done (#345)**  
9. Bookmarks: real list API or hide  
10. Basic rate-limit on social routes  
11. HeyVera voice — **partial (#345)**  
12. **Page model docs + 1:1 profile=page mapping** (this file)

### Wave 1 — Core social feel
1. Optimistic thread replies + reply_count — **done**  
2. Thread UX (flat depth OK; nest later) — **done (flat)**  
3. Start DM from profile (Page) — **done**  
4. Followers / following lists — **done**  
5. Notifs deep links + unread badge + mark-read — **done**  
6. Quote mapping — **partial / feed-dependent**  
7. Views: hide when zero — **done** (no vanity zeros)

### Wave 2 — Guilds that work (Page-owned)
1. BE create guild + mine — **done (#346 + Waves 1–4)**  
2. Join/leave/feed by slug or id — **done**  
3. `communityId` on create post — **done** (compose guild picker)  
4. Live Create CTA + server membership — **done**  
5. Members list — **partial** (API exists; light UI)  
6. Owner = creating Page (person default) — **done** (creator profile)

### Wave 3 — Pulse + Page automation
1. Create → Automate layout (drafts / schedule / goals) — **done** (AIPage tabs + honest helper)  
2. Agent-signed chips on posts — **done** (linkedAgent chip)  
3. Honest Pulse chat — **done** (“Draft helper”, tools_v1/v2 labeled)  
4. Premium → credits narrative — **done**  
5. Agent API keys scoped — **prior residual** (hvak_ path)  
6. Proof/continuity chips — **partial** (fields exist; light UI)

### Wave 4 — Media, Watch, Page libraries
1. Image E2E solid — **done** (upload → mediaIds → post)  
2. Content scoped to active Page — **v1 profile_id = person Page**  
3. Explore real filters — **done**  
4. Watch/Live honest until ingest — **done** (Preview/Soon)  
5. Soft-visibility when ACL real — **deferred** (needs BE ACL product)

---

## Extended backlog (still after solid Waves 0–3 unless blocking)

| ID | Item |
|----|------|
| PW-1 | Nested threads — **Wave 5 done** (flat tree + depth UI) |
| PW-2 | Realtime DMs (WS) |
| PW-3 | Live encoder ingest under Page |
| PW-4 | Video shelves / playlists under Page |
| PW-5 | ML related discovery |
| PW-6 | Full credits ledger UI |
| PW-7 | x402 / agent micropayments |
| PW-8 | Agent auto-reply / follow policies |
| PW-9 | Bookmark folders |
| PW-10 | Settings backend |
| PW-11 | Crypto / Markets product regions |
| PW-12 | Kill dual client + dead shell |
| PW-13 | GIF / poll / emoji |
| PW-14 | Vanity view leaderboards (prefer private) |
| PW-15 | Private guilds + roles / room rails |
| PW-16 | Mod workflow depth |
| PW-17 | Multi-Page switcher UI + brand Pages |
| PW-18 | Page rename (if better product word emerges) |

---

## PR discipline

```
clean main → branch → one vertical slice → CI green
→ vision alignment → automerge → re-ground main
```

Vision gate: no fake Available/LIVE/Join; Page/agent honesty; no dual-shell growth; optimistic UX with rollback; looks like HeyVera.

---

## Progress log

| Date | Wave / PR | Result |
|------|-----------|--------|
| 2026-07-21 | Plan grounded | ROADMAP created |
| 2026-07-21 | #345 | Wave 0 shell honesty merged |
| 2026-07-21 | Page model | Page/Actor identity adopted as working model |
| 2026-07-21 | Wave 0B | Contract unbreak (FE+BE) on `feat/wave0-contract-unbreak` |
| 2026-07-21 | #346 | Wave 0 contract unbreak merged to main |
| 2026-07-21 | Waves 1–4 | Ship branch `feat/waves-1-4-social` (DM, follow lists, guilds, Pulse/Premium, Explore/Live honesty) |
| 2026-07-21 | #348 | Wave 5 nested threads + views + DM dedupe **merged** |
| 2026-07-21 | #349 | Wave 6 Page multi-surface foundation **merged** |
| 2026-07-21 | #350 | Wave 7 soft-poll honesty + Premium probe + Pulse empty-state **merged** |

### Waves 1–4 implemented (2026-07-21)

**Wave 1 — Core social feel**
- Profile **Message** → `POST /v1/social/conversations` with `participant_ids` → `/messages?c=`
- Followers/following lists: BE `GET /profiles|users/{handle}/followers|following` + ProfilePage panel
- Notifications mark-read (existing) + TopBar unread badge (poll)
- Optimistic thread replies (existing polish kept); views hidden at 0

**Wave 2 — Guilds**
- Create / mine / join-leave by slug (BE+FE); shell compose optional guild picker + `communityId`
- Owner = creator profile (existing BE auto-join)

**Wave 3 — Pulse + Premium**
- AIPage tabs: **Drafts | Schedule | Goals | Draft helper** (honest tool path label)
- PostCard linked-agent chip when feed has `linkedAgent`
- Premium features rewritten to **automation credits**; checkout attempted when Stripe up, else disabled with reason

**Wave 4 — Media & discovery honesty**
- AppShell createPost passes `mediaIds`; feed/thread attach media URLs
- Explore filters map to real search type; search errors surface
- Live/Videos: Preview/Soon only — no LIVE claim
- **Page-scoped content note:** v1 stores posts/guilds/follows under `profile_id` (= person Page 1:1). No schema migration in this wave; multi-Page is later (PW-17).

### Remaining gaps
- Realtime WS DMs
- Multi-Page switcher UI; full credits ledger
- Stripe may be unset in local/dev — Premium CTA correctly fails soft
- Video/live ingest still shell-only
- View count is light (no per-viewer dedupe / anon hashing)

---

## Wave 5 — Nested threads, views, DM dedupe (2026-07-21)

**Branch:** `feat/wave5-threads-views-dm`

### Backend (`crates/api`)
1. **Thread descendants** — `social_get_thread_replies(root, viewer)` walks replies max depth 8, cap 100; `GET /v1/social/posts/{id}` returns full flat `replies` with `replyToPostId`.
2. **View counts** — migration v44 `social_posts.view_count`; `social_record_post_view` on single-post open; `viewCount` on post JSON + feed enrich.
3. **DM dedupe** — `social_create_conversation` reuses existing 1:1 conversation for the same two profiles.

### Frontend (`heyvera/src`)
1. **`utils/threadTree.ts`** — `buildReplyTree`, `flattenTreeForRender` (visual depth cap 4).
2. **`PostThreadPage`** — nested indent, “Replying to @x” for non-root parents, inline compose under branch, optimistic append into correct parent.
3. **Views** — `feedPostToPost` already maps `viewCount`; PostCard hides zeros.

### Tests
- `threadTree.test.ts`, existing `feedPostToPost` viewCount cases, BE unit tests for thread/views/DM dedupe.

---

## Next waves (after 0–5 on main)

### Wave 5 — Threads, views, DM integrity — **done (#348)**
1. Nested reply tree — done
2. Light viewCount — done
3. 1:1 DM dedupe — done
4. Reply-to-reply compose — done

### Wave 6 — Page multi-surface foundation — **done (#349)**
1. Schema/API for Page kinds beyond 1:1 person profile — **done**
   - Person = `social_profiles` (unchanged 1:1); agent = `social_linked_agents`; brand = `social_pages` + `social_page_follows` (migration v45)
   - `GET /v1/social/pages/mine`, `POST /v1/social/pages` (kind brand), `POST|DELETE /v1/social/pages/{id}/follow`
   - `create_post` accepts optional `pageId` → person/agent authorship; brand still posts as steward person (v1)
2. Active Page selector in Create (person default) — **done** (`AppShell` + `heyvera-active-page-id`)
3. Agent Pages linked as publish actors — **done** (list + compose `authorMode=agent`)
4. Follow Page seam — **done** (brand → `social_page_follows`; agent → owner profile follow; person → profile follow / handle still works)
5. Honesty: Agents product switcher still WIP; multi-Page is **not** a complete marketplace

### Wave 7 — Soft-realtime + automation depth — **done (#350)**
1. Soft-poll for DMs — **done** (honest “Updating live (poll)” labels; not WebSocket)
2. Pulse Draft helper empty-state honesty — **done**
3. Premium checkout probe + no ledger honesty — **done**
4. Still **not** (Wave 8+): true WS DMs, live encoder, x402, ML related video, full credits ledger UI

### Wave 8+ (from PW backlog, ordered) — deferred
- Nested thread “show more” pagination · Private guilds/roles · Video shelves · Live ingest · x402 · Kill dual client · full credits ledger · true WS

| ID | Item | Target wave |
|----|------|-------------|
| PW-1 | Nested threads | **Wave 5 done** |
| PW-2 | Realtime DMs (WS) | **Wave 8+** (soft-poll is Wave 7) |
| PW-14 | Views (honest, not vanity) | **Wave 5 done** (light) |
| PW-17 | Multi-Page switcher foundation | **Wave 6 done** |
| PW-3–PW-8, PW-12… | Live/x402/etc. | Wave 8+ |
