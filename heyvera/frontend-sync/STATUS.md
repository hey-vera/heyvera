# Frontend Status

## Current track

- **Active:** Soft-Launch Seal **code slices Done** (#380–#386); **13h live cert** still required before user tour
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–13g + multi-user A–D + integrity (**#379**–**#386**)
- **Gate before live tour:** 13h — Clerk QA + smoke + STORAGE/CORS/Caddy on real deploy (ops, not more product waves)

## Wave progress

| Wave | Status |
|------|--------|
| 0–7 | **Done** |
| 8a–8g | **Done** (#353–#357) |
| 9a–9e | **Done** (#359–#365) |
| 10a Pulse draft metering | **Done** (#367) |
| 10b Premium history + access_state | **Done** (#368) |
| 10c Pulse transition CAS | **Done** (#369) |
| 11 Media depth honesty + shelves | **Done** (#371) |
| 12 Agent policy + switcher + x402 hold | **Done** (#372) |
| **13 Soft-Launch Seal** | **Code Done** (#380–#386); **13h cert pending** |

## Multi-user readiness (post–Wave 12)

Systems are **real** — prefs persist, moderation E2E, credits on checkout, heyvera-server owns Social+Pulse, private guild invites, members list, empty-network onboard, soft-launch polish.

| Batch | Scope | Status |
|-------|--------|--------|
| **A** | Ops: heyvera-server owns Social+Pulse; prod media gate; smoke/deploy/Caddy | **Done (#374)** |
| **B** | Prefs persist, moderation E2E, credits on checkout | **Done (#375)** |
| **C** | Private guild invites, members list, empty-network onboard | **Done (#376)** |
| **D** | Soft-launch polish + STATUS/ROADMAP close-out | **Done (#377)** |
| **Integrity** | Soft-launch integrity closeout: apex/Vite API path → :3002, deploy-vera SPA+API, Settings honesty, schedule cron label | **Done (#379)** |

## Wave 13 — Soft-Launch Seal (production readiness)

**Goal:** Strangers can use the golden social loop without silent lies. Not encoder/ML/x402/markets.

| Slice | Scope | Status |
|-------|--------|--------|
| **13a** | Optimistic mutation integrity (like/repost/bookmark + block/mute hide after success) | **Done (#382)** |
| **13b** | Client API base consistency (DM send via `social.ts` / `resolveSocialApiBase`) | **Done (#381)** |
| **13c** | Quote fidelity E2E (BE batch enrich + `feedPostToPost` → `quote_post`) | **Done (#384)** |
| **13d** | Own-post soft delete (FE `deletePost` + author Delete on PostCard) | **Done (#386)** |
| **13e** | Notifications + bookmarks cursor load-more | **Done (#383)** |
| **13f** | Report reason UX (spam/abuse/other) | **Done (#386)** |
| **13g** | Home compose image parity with AppShell create | **Done (#385)** |
| **13h** | Live cert gate (Clerk QA + smoke + STORAGE/CORS/Caddy) — before user tour | **Pending (ops)** |

**Defer hard:** live encoder, ML discovery, production x402, bookmark folders, full guild mod suite, Agents product, dual-shell growth.

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- **Ops (#374):** production Social+Pulse owner is **heyvera-server :3002**; mock media refused in prod when storage incomplete.
- **Prefs (#375):** `GET/PATCH /v1/social/me/prefs` — Settings Privacy/Account hydrate + save; search/DM light enforcement.
- **Moderation (#375):** blocks/mutes list + PostCard/Profile actions; DM blocked either direction → 403.
- **Credits (#375):** checkout.session.completed initializes credit balance; balance stays `null` when unmetered.
- **Guilds (#376):** private invites (token once), members list, private open-join closed.
- **Onboard (#376):** Following empty shows real profile/community/trending suggestions.
- Soft-launch nav de-emphasizes Videos/Live slightly (#377); early-access banner on Home.
- **Integrity closeout:** Caddy apex + Vite proxy route social/pulse/health → heyvera-server :3002; `deploy-vera.sh` builds SPA + both APIs; Settings non-account controls labeled device/none; Pulse schedule UI requires cron honesty (no magic auto-publish).
- Media: shelves foundation; Watch/Live honesty — no fake LIVE encoder.
- Agents: policy flags foundation; switcher Agents = WIP; x402 off unless `X402_ENABLED`.
- **Wave 13 code sealed on main (#381–#386):** mutation rollback, DM API base, quote nest, post delete, notif/bookmark pagination, report reasons, Home image compose.
- **Still before cohort live tour:** 13h ops cert (STORAGE_*, Clerk, CORS, Caddy → :3002, smoke).
- **Out of multi-user readiness / Seal:** full encoder, ML discovery, production x402 facilitator.
