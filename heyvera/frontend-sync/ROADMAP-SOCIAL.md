# HeyVera Social Roadmap (active)

**Status:** Full-ship track — Waves 0–4 + Page model  
**Grounded:** 2026-07-21  
**Live entry:** `heyvera/src/main.tsx` → `router.tsx` → `AppShell` / `pages/*`  
**Do not grow:** orphaned `App.tsx` / `VeraSocials` dual shell  
**Main tip note:** Wave 0 shell honesty landed (#345)

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
1. Optimistic thread replies + reply_count  
2. Thread UX (flat depth OK; nest later)  
3. Start DM from profile (Page)  
4. Followers / following lists  
5. Notifs deep links + unread badge + mark-read  
6. Quote mapping  
7. Views: hide until real **or** light record on Page content  

### Wave 2 — Guilds that work (Page-owned)
1. BE create guild + mine  
2. Join/leave/feed by slug or id  
3. `communityId` / guild id on create post  
4. Live Create CTA + server membership  
5. Members list  
6. Owner = creating Page (person default)

### Wave 3 — Pulse + Page automation
1. Create → Automate layout (drafts / schedule / goals)  
2. Agent-signed / Page-kind chips on posts  
3. Honest Pulse chat or real model path  
4. Premium → credits for automation/API  
5. Agent API keys scoped to Page verbs  
6. Proof/continuity chips (light)

### Wave 4 — Media, Watch, Page libraries
1. Image E2E solid; video path starts  
2. Content scoped to active Page  
3. Explore real filters  
4. Watch/Live honest until ingest; then Page-owned  
5. Soft-visibility when ACL real  

---

## Extended backlog (still after solid Waves 0–3 unless blocking)

| ID | Item |
|----|------|
| PW-1 | Nested threads |
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
