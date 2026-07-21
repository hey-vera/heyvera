# HeyVera Social Roadmap (active)

**Status:** Active execution track for customer-ready Social on `heyvera.org`  
**Grounded:** 2026-07-21 (main + dual FE/BE audit)  
**Live entry:** `heyvera/src/main.tsx` → `router.tsx` → `AppShell` / `pages/*`  
**Do not grow:** orphaned `App.tsx` / `VeraSocials` dual shell

This file is project memory for agents and humans. Update when a wave finishes.

---

## Product truth

- Top-left menu = **product page switcher**, not social-only chrome.
- Order: **Social (Active)** → **Agents (WIP, gray, not navigable)** until Agents is real.
- Create = **Post · Video · Automate** (Pulse).
- Patterns from X / classic YT / FB communities — **never copied skins**. HeyVera look: dark, mineral, original.
- Vision: agentic social + Pulse automation + API access; credits fuel automation.

---

## Waves (in order)

### Wave 0 — Integrity & honesty
1. Switcher: Social → Agents (WIP disabled)
2. Create menu: Post · Video · Automate
3. Kill fake Available / LIVE / inert chrome that overclaims
4. Contract unbreak: profile path, follow status, opaque cursors, authed feed
5. Unrepost + optimistic mutations with rollback
6. Shell Create → Home prepend
7. Profile update path/casing; notifications adapter + mark-read
8. Mobile auth/profile/notifs reachable
9. Bookmarks: hide or real list API
10. Basic rate-limit on social routes
11. HeyVera voice (no “What’s happening?” X paste)

### Wave 1 — Core social feel
1. Optimistic thread replies + reply_count
2. Thread UX (flat depth OK)
3. Start DM from profile
4. Followers/following lists
5. Notifs deep links + unread badge
6. Quote mapping if API provides it
7. Views: **hide until real** (preferred over permanent zeros)

### Wave 2 — Communities that work
1. BE create + mine
2. Join/leave/feed by slug or id
3. communityId on create post
4. Live page Create + server membership
5. Members list (light)

### Wave 3 — Pulse + identity wedge
1. Create → Automate layout (drafts / schedule / goals honest)
2. Agent-signed post chips
3. Honest Pulse chat (real or clearly helper)
4. Premium → credits for automation/API
5. Agent API harden **after** human social green
6. Proof/continuity chips (light)

### Wave 4 — Media & discovery honesty
1. Image upload E2E; kill inert compose icons
2. Explore real filters or remove fake tabs
3. Videos/Live remain preview until ingest
4. Soft-visibility when BE ACL real

---

## Post-wave backlog (former “do not build yet”)

> **Remember:** These were deferred to avoid debt **during Waves 0–3**.  
> **After Waves 0–3 (and Wave 4 media/discovery) are green**, these become the **finish-HeyVera track** — not abandoned forever.

Tackle in roughly this order once waves complete:

| ID | Item | Why after waves |
|----|------|-----------------|
| PW-1 | Nested threads / show-more replies | Needs solid flat reply + contract first |
| PW-2 | Realtime DMs (WS/SSE) | Soft-poll first; WS after REST correctness |
| PW-3 | Full Live streaming / encoder ingest | No LIVE chrome until identity + VOD path |
| PW-4 | Video ingest, playlists, archives, related | After image media E2E |
| PW-5 | YouTube-scale related/ML discovery | Tag shelves first |
| PW-6 | Complex credits ledger + metering UI | After Premium + Pulse narrative is one story |
| PW-7 | x402 / agent micropayments | No live rails until REST + credits story |
| PW-8 | Full agent auto-reply / auto-follow / schedule spam controls | After approve/publish trust excellent |
| PW-9 | Bookmark folders as product | After server bookmarks list works |
| PW-10 | Settings privacy/DM/export backend | No more dishonest toggles |
| PW-11 | Crypto / Marketplace product regions | Not Social MVP |
| PW-12 | Delete dual API client + quarantine dead shell | After live path owns all features |
| PW-13 | GIF / poll / emoji pickers | After media upload |
| PW-14 | Public view vanity / leaderboards | Prefer private stats; avoid theater |
| PW-15 | Private communities + roles/channels | After basic community lifecycle |
| PW-16 | Social rate-limit sophistication + mod workflow | Basic limits in Wave 0; depth later |

**Rule:** Do not pull PW-* into early PRs unless a wave is blocked without it.

---

## PR discipline

```
clean main → branch → one slice → CI green
→ vision alignment → automerge → re-ground main
```

Vision gate: no fake Available/LIVE/Join; Social customer path or honest WIP; no dual-shell growth; optimistic UX with rollback; looks like HeyVera.

---

## Progress log

| Date | Wave / PR | Result |
|------|-----------|--------|
| 2026-07-21 | Plan grounded + persisted | This file created; Wave 0 shell PR next |
