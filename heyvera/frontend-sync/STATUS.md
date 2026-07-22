# Frontend Status

## Current track

- **Active:** Wave 9 — customer-ready Social polish (9c–9e remaining)
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–8 + **9a–9b** on main

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
| 9c Brand Page + Create polish | Next |
| 9d Private guild UX | Pending |
| 9e Visual/a11y core routes | Pending |

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- DM: true WS (`/v1/social/ws`) with soft-poll fallback; **9b** reconnect/backoff, offline banner, honest Live vs poll labels, list unread lag fixed, Inbox/Mail DM badge (Bell stays notifications-only).
- Credits: Premium usage surface; `creditsBalance` honest when unmetered (null).
- Brand Pages: public `/page/:slug`; private guilds + owner/member roles foundation.
- Video/Live: honesty labels + longform path — not full encoder.
- x402: status/verify stubs; gated unless `X402_ENABLED`.
- Threads: nested tree (Wave 5); **truncation honest** via `repliesTruncated` + cap notice (Wave 9a #359) — no fake Show more.
