# HeyVera Social Roadmap (active)

**Status:** Waves 0â€“9 shipped on main (9aâ€“9e complete)  
**Grounded:** 2026-07-22  
**Live entry:** `heyvera/src/main.tsx` â†’ `router.tsx` â†’ `AppShell` / `pages/*`  
**Do not grow:** orphaned `App.tsx` / `VeraSocials` dual shell (quarantined under `src/orphan/`)  
**Main tip note:** Wave 9 complete (#359â€“#365); next = Wave 10+ product depth (metering, media, agents)

---

## Product truth

- Top-left menu = **product switcher**: **Social (Active)** â†’ **Agents (WIP, gray)**.
- Create = **Post Â· Video Â· Automate** (Pulse), always as an active **Page**.
- Patterns from X / classic YT / FB â€” **never copied skins**. HeyVera: dark, mineral, original.
- Vision: agentic social â€” humans, robots, and pages as first-class network actors.

---

## Identity model: Page (working name)

### Why not â€œchannelâ€ / â€œstudioâ€

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
| **Content** | Posts, videos, live, shelves â€” always **by a Page**. |
| **Pulse** | Automates *as* a Page (draft â†’ approve â†’ publish) under steward authority. |

**Page kinds** (one table, `kind` field):

1. **person** â€” default Page for a human (auto-created with profile)  
2. **agent** â€” robot Page (linked agent, may post with approval / scoped keys)  
3. **brand** â€” project/org/brand Page (optional multi-Page later)

### Golden rules

1. **Follow Pages**, not â€œaccounts.â€  
2. **Create always has an active Page** (default person Page until multi-Page UI).  
3. **Guilds are Page-owned**, not floating rooms.  
4. **Agents are Pages** (or operate a Page), never second-class chrome.  
5. **Proof/continuity** attach to Pages over time (Soma-ready).  
6. Product switcher â€œAgentsâ€ product = fleet/runtime; **agent Pages live inside Social now**.

### Active Page context (UX)

- Selector near Create / Watch (when multi-Page exists).  
- v1: single default person Page = profile; no picker required.  
- Schema always stores `pageId` (or maps profile â†’ page 1:1 until migration).

### Relationship map

```
Steward (Clerk user)
  â””â”€â”€ Page(s)  person | agent | brand
        â”œâ”€â”€ posts / videos / live / shelves
        â”œâ”€â”€ follows other Pages
        â”œâ”€â”€ owns / mods Guilds
        â””â”€â”€ Pulse automation + API keys (agent kind)
```

### Open golden ideas (keep open)

- **Page-to-Page DMs** (including human â†” agent with policy).  
- **Guild as multi-Page assembly** with agent co-mods.  
- **Shelves** (playlists) as Page-owned collections, not vanity scoreboards.  
- **Delegation**: steward grants agent Page limited verbs (post, reply, join guild).  
- **Portable proof**: Page continuity across devices via Soma later.  
- Rename â€œPageâ€ later only if something sharper wins (working term is fine).

### Schema seam (implementation direction)

- v1 compatibility: treat existing `social_profiles` as **person Pages** (1:1).  
- Add `page_kind`, optional `steward_profile_id` for agent/brand Pages.  
- Content columns: `page_id` (alias profile_id until dual-write clean).  
- Guilds: `owner_page_id`.  
- Do not invent a second parallel identity tree.

---

## Waves (in order) â€” full ship

### Wave 0 â€” Integrity & honesty
1. Switcher Social â†’ Agents WIP â€” **done (#345)**  
2. Create Post Â· Video Â· Automate â€” **done (#345)**  
3. Kill fake Available / LIVE chrome â€” **done (#345)**  
4. Contract unbreak: profile path, follow status, opaque cursors, authed feed  
5. Unrepost + optimistic mutations with rollback  
6. Shell Create â†’ Home prepend â€” **done (#345)**  
7. Profile update path/casing; notifications adapter + mark-read  
8. Mobile auth reachable â€” **done (#345)**  
9. Bookmarks: real list API or hide  
10. Basic rate-limit on social routes  
11. HeyVera voice â€” **partial (#345)**  
12. **Page model docs + 1:1 profile=page mapping** (this file)

### Wave 1 â€” Core social feel
1. Optimistic thread replies + reply_count â€” **done**  
2. Thread UX (flat depth OK; nest later) â€” **done (flat)**  
3. Start DM from profile (Page) â€” **done**  
4. Followers / following lists â€” **done**  
5. Notifs deep links + unread badge + mark-read â€” **done**  
6. Quote mapping â€” **partial / feed-dependent**  
7. Views: hide when zero â€” **done** (no vanity zeros)

### Wave 2 â€” Guilds that work (Page-owned)
1. BE create guild + mine â€” **done (#346 + Waves 1â€“4)**  
2. Join/leave/feed by slug or id â€” **done**  
3. `communityId` on create post â€” **done** (compose guild picker)  
4. Live Create CTA + server membership â€” **done**  
5. Members list â€” **partial** (API exists; light UI)  
6. Owner = creating Page (person default) â€” **done** (creator profile)

### Wave 3 â€” Pulse + Page automation
1. Create â†’ Automate layout (drafts / schedule / goals) â€” **done** (AIPage tabs + honest helper)  
2. Agent-signed chips on posts â€” **done** (linkedAgent chip)  
3. Honest Pulse chat â€” **done** (â€œDraft helperâ€, tools_v1/v2 labeled)  
4. Premium â†’ credits narrative â€” **done**  
5. Agent API keys scoped â€” **prior residual** (hvak_ path)  
6. Proof/continuity chips â€” **partial** (fields exist; light UI)

### Wave 4 â€” Media, Watch, Page libraries
1. Image E2E solid â€” **done** (upload â†’ mediaIds â†’ post)  
2. Content scoped to active Page â€” **v1 profile_id = person Page**  
3. Explore real filters â€” **done**  
4. Watch/Live honest until ingest â€” **done** (Preview/Soon)  
5. Soft-visibility when ACL real â€” **deferred** (needs BE ACL product)

---

## Extended backlog (still after solid Waves 0â€“3 unless blocking)

| ID | Item |
|----|------|
| PW-1 | Nested threads â€” **Wave 5 done** (flat tree + depth UI) |
| PW-2 | Realtime DMs (WS) â€” **Wave 8b done** (#353; poll fallback remains) |
| PW-3 | Live encoder ingest under Page â€” **foundation only** (8f honesty; not encoder) |
| PW-4 | Video shelves / playlists under Page â€” **foundation only** (8f) |
| PW-5 | ML related discovery |
| PW-6 | Full credits ledger UI â€” **MVP done** (8c #354; full metering still open) |
| PW-7 | x402 / agent micropayments â€” **scaffold done** (8g #356; off unless `X402_ENABLED`) |
| PW-8 | Agent auto-reply / follow policies |
| PW-9 | Bookmark folders |
| PW-10 | Settings backend |
| PW-11 | Crypto / Markets product regions |
| PW-12 | Kill dual client + dead shell â€” **Wave 8a done** (#355) |
| PW-13 | GIF / poll / emoji |
| PW-14 | Vanity view leaderboards (prefer private) |
| PW-15 | Private guilds + roles / room rails â€” **foundation done** (8e #357) |
| PW-16 | Mod workflow depth |
| PW-17 | Multi-Page switcher UI + brand Pages â€” **Wave 6 + 8d done** (#349, #357) |
| PW-18 | Page rename (if better product word emerges) |

---

## PR discipline

```
clean main â†’ branch â†’ one vertical slice â†’ CI green
â†’ vision alignment â†’ automerge â†’ re-ground main
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
| 2026-07-21 | Waves 1â€“4 | Ship branch `feat/waves-1-4-social` (DM, follow lists, guilds, Pulse/Premium, Explore/Live honesty) |
| 2026-07-21 | #348 | Wave 5 nested threads + views + DM dedupe **merged** |
| 2026-07-21 | #349 | Wave 6 Page multi-surface foundation **merged** |
| 2026-07-21 | #350 | Wave 7 soft-poll honesty + Premium probe + Pulse empty-state **merged** |
| 2026-07-22 | #359 | Wave 9a thread truncation honesty (`repliesTruncated`) **merged** |
| 2026-07-22 | #361 | Wave 9b DM reconnect / offline banner / unread honesty **merged** |
| 2026-07-22 | #363 | Wave 9c brand empty feed + active Page create clarity **merged** |
| 2026-07-22 | #364 | Wave 9d private guild role labels + join honesty **merged** |
| 2026-07-22 | #365 | Wave 9e core route a11y + mineral focus rings **merged** |
| 2026-07-22 | docs | Wave 9 complete on STATUS/ROADMAP |

### Waves 1â€“4 implemented (2026-07-21)

**Wave 1 â€” Core social feel**
- Profile **Message** â†’ `POST /v1/social/conversations` with `participant_ids` â†’ `/messages?c=`
- Followers/following lists: BE `GET /profiles|users/{handle}/followers|following` + ProfilePage panel
- Notifications mark-read (existing) + TopBar unread badge (poll)
- Optimistic thread replies (existing polish kept); views hidden at 0

**Wave 2 â€” Guilds**
- Create / mine / join-leave by slug (BE+FE); shell compose optional guild picker + `communityId`
- Owner = creator profile (existing BE auto-join)

**Wave 3 â€” Pulse + Premium**
- AIPage tabs: **Drafts | Schedule | Goals | Draft helper** (honest tool path label)
- PostCard linked-agent chip when feed has `linkedAgent`
- Premium features rewritten to **automation credits**; checkout attempted when Stripe up, else disabled with reason

**Wave 4 â€” Media & discovery honesty**
- AppShell createPost passes `mediaIds`; feed/thread attach media URLs
- Explore filters map to real search type; search errors surface
- Live/Videos: Preview/Soon only â€” no LIVE claim
- **Page-scoped content note:** v1 stores posts/guilds/follows under `profile_id` (= person Page 1:1). No schema migration in this wave; multi-Page is later (PW-17).

### Remaining gaps
- Realtime WS DMs
- Multi-Page switcher UI; full credits ledger
- Stripe may be unset in local/dev â€” Premium CTA correctly fails soft
- Video/live ingest still shell-only
- View count is light (no per-viewer dedupe / anon hashing)

---

## Wave 5 â€” Nested threads, views, DM dedupe (2026-07-21)

**Branch:** `feat/wave5-threads-views-dm`

### Backend (`crates/api`)
1. **Thread descendants** â€” `social_get_thread_replies(root, viewer)` walks replies max depth 8, cap 100; `GET /v1/social/posts/{id}` returns full flat `replies` with `replyToPostId`.
2. **View counts** â€” migration v44 `social_posts.view_count`; `social_record_post_view` on single-post open; `viewCount` on post JSON + feed enrich.
3. **DM dedupe** â€” `social_create_conversation` reuses existing 1:1 conversation for the same two profiles.

### Frontend (`heyvera/src`)
1. **`utils/threadTree.ts`** â€” `buildReplyTree`, `flattenTreeForRender` (visual depth cap 4).
2. **`PostThreadPage`** â€” nested indent, â€œReplying to @xâ€ for non-root parents, inline compose under branch, optimistic append into correct parent.
3. **Views** â€” `feedPostToPost` already maps `viewCount`; PostCard hides zeros.

### Tests
- `threadTree.test.ts`, existing `feedPostToPost` viewCount cases, BE unit tests for thread/views/DM dedupe.

---

## Next waves (after 0â€“5 on main)

### Wave 5 â€” Threads, views, DM integrity â€” **done (#348)**
1. Nested reply tree â€” done
2. Light viewCount â€” done
3. 1:1 DM dedupe â€” done
4. Reply-to-reply compose â€” done

### Wave 6 â€” Page multi-surface foundation â€” **done (#349)**
1. Schema/API for Page kinds beyond 1:1 person profile â€” **done**
   - Person = `social_profiles` (unchanged 1:1); agent = `social_linked_agents`; brand = `social_pages` + `social_page_follows` (migration v45)
   - `GET /v1/social/pages/mine`, `POST /v1/social/pages` (kind brand), `POST|DELETE /v1/social/pages/{id}/follow`
   - `create_post` accepts optional `pageId` â†’ person/agent authorship; brand still posts as steward person (v1)
2. Active Page selector in Create (person default) â€” **done** (`AppShell` + `heyvera-active-page-id`)
3. Agent Pages linked as publish actors â€” **done** (list + compose `authorMode=agent`)
4. Follow Page seam â€” **done** (brand â†’ `social_page_follows`; agent â†’ owner profile follow; person â†’ profile follow / handle still works)
5. Honesty: Agents product switcher still WIP; multi-Page is **not** a complete marketplace

### Wave 7 â€” Soft-realtime + automation depth â€” **done (#350)**
1. Soft-poll for DMs â€” **done** (honest â€œUpdating live (poll)â€ labels; not WebSocket)
2. Pulse Draft helper empty-state honesty â€” **done**
3. Premium checkout probe + no ledger honesty â€” **done**
4. Wave 8 closed true WS DMs, credits MVP, dual-shell kill, brand pages, private guilds foundation, media honesty, x402 scaffold. Still **not**: live encoder, ML related video, full metered credits, production x402 facilitator

### Wave 8 â€” Remaining PW backlog â€” **done (#353â€“#357)**

Shipped as sequential green PRs. Honesty: incomplete capability stays labeled, never fake LIVE/Available.

| Slice | Scope | PR |
|-------|--------|-----|
| **8a** | Dual-shell/dual-client kill: orphan quarantine, single social API client path, router-only entry test | #355 |
| **8b** | True WS for DMs (`GET /v1/social/ws?token=`; subscribe + broadcast on send); soft-poll remains fallback | #353 |
| **8c** | Credits / usage ledger MVP on Premium (Stripe/billing when present) | #354 |
| **8d** | Multi-Page marketplace polish: public brand Page profile route, follow UI | #357 |
| **8e** | Private guilds + roles foundation (visibility + owner/mod role) | #357 |
| **8f** | Video/Live foundation: upload path honesty + Page-scoped media metadata (not full encoder) | #356 |
| **8g** | x402 agent payment scaffold (docs + gated endpoint stub) | #356 |

| ID | Item | Target |
|----|------|--------|
| PW-1 | Nested threads | **Wave 5 done** |
| PW-2 | Realtime DMs (WS) | **8b done** |
| PW-12 | Kill dual client | **8a done** |
| PW-6 | Credits ledger | **8c MVP done** |
| PW-17 | Multi-Page polish | **8d done** |
| PW-15 | Private guilds/roles | **8e foundation done** |
| PW-3/4 | Live/video | **8f foundation done** |
| PW-7 | x402 | **8g scaffold done** |

### Wave 9 â€” Customer-ready Social polish â€” **done (#359â€“#365)**

Goal: make shipped Social feel solid for real users â€” no new half-features.

| Slice | Scope | Status |
|-------|--------|--------|
| **9a** | Thread UX: honest truncation when BE cap 100 / depth 8 stops walk; empty/error already pass; **no fake Show more** | **Done (#359)** â€” `repliesTruncated` + `repliesCap` on `GET /posts/{id}`; live `PostThreadPage` banner |
| **9b** | DM reliability: reconnect, offline banner, WS vs poll label accuracy, unread badge | **Done (#361)** â€” modes offline/reconnecting/poll/live; backoff reconnect; list unread + Inbox/Mail DM badge; Bell notifications-only |
| **9c** | Brand Page + Create polish: follow CTA, empty brand feed, active Page clarity | **Done (#363)** â€” Posts empty region; brandâ†’person authorship clarity; listMyPages fail fallback |
| **9d** | Private guild UX: invite/join honesty, role labels owner/member, no fake mod tools | **Done (#364)** â€” Owner/Member chips; private unlisted + no-invite copy; no Kick/Ban/Invite theater |
| **9e** | Visual/a11y pass on core routes (Home, Profile, Messages, Guilds, Premium) | **Done (#365)** â€” skip link, mineral focus rings, tab/inbox a11y |

Still later (Waves 10â€“12): metered credits, media depth, agent network â€” see passoff / extended backlog.

### Wave 10 — Credits & automation depth — **done (#367–#369)**

| Slice | Status |
|-------|--------|
| **10a** Pulse draft metering + honest credit balance API | **Done (#367)** |
| **10b** Premium history pagination + access_state clarity | **Done (#368)** |
| **10c** Pulse draft transition CAS + honest UI | **Done (#369)** |

Still later: Wave 11 media depth, Wave 12 agent network.
