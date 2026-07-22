# Frontend Status

## Current track

- **Active:** Post–Wave 8 polish + depth depth (see ROADMAP extended backlog)
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–8 on main

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

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- DM: true WS (`/v1/social/ws`) with soft-poll fallback.
- Credits: Premium usage surface; `creditsBalance` honest when unmetered (null).
- Brand Pages: public `/page/:slug`; private guilds + owner/member roles foundation.
- Video/Live: honesty labels + longform path — not full encoder.
- x402: status/verify stubs; gated unless `X402_ENABLED`.
