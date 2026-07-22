# Frontend Status

## Current track

- **Active:** Post–Wave 9 product depth (see ROADMAP extended backlog / Waves 10+)
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–9 (9a–9e) on main

## Wave progress

| Wave | Status |
|------|--------|
| 0–7 | **Done** |
| 8a Dual-shell kill | **Done** (#355) |
| 8b WS DMs | **Done** (#353) |
| 8c Credits ledger | **Done** (#354) |
| 8d Brand pages | **Done** (#357) |
| 8e Private guilds/roles | **Done** (#357) |
| 8f Media foundation | **Done** (#356) |
| 8g x402 scaffold | **Done** (#356) |
| 9a Thread truncation honesty | **Done** (#359) |
| 9b DM reliability | **Done** (#361) |
| 9c Brand Page + Create polish | **Done** (#363) |
| 9d Private guild UX | **Done** (#364) |
| 9e Visual/a11y core routes | **Done** (#365) |

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- DM: true WS (`/v1/social/ws`) with soft-poll fallback; reconnect/backoff, offline banner, honest Live vs poll labels; Inbox/Mail DM badge (Bell notifications-only).
- Credits: Premium usage surface; `creditsBalance` honest when unmetered (null).
- Brand Pages: public `/page/:slug` with honest empty posts region; Create clarifies brand → person authorship (9c #363).
- Private guilds: Owner/Member labels; unlisted Discover + no invite system honesty (9d #364); no fake mod tools.
- Core routes: skip link, mineral focus rings, tab/inbox a11y polish (9e #365).
- Video/Live: honesty labels + longform path — not full encoder.
- x402: status/verify stubs; gated unless `X402_ENABLED`.
- Threads: nested tree; truncation honest via `repliesTruncated` (9a #359).
