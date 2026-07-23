# Frontend Status

## Current track

- **Active:** Soft-Launch Seal (**Wave 13**) — production readiness of core social verbs before live cohort test
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–12 + multi-user Batches A–D + soft-launch integrity closeout (**#379**)
- **Not yet:** live deploy certification (Clerk QA + smoke + STORAGE on VPS) — do after Seal slices land

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
| **13 Soft-Launch Seal** | **In progress** (see below) |

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
| **13a** | Optimistic mutation integrity (like/repost/bookmark + block/mute hide rollback) | Next |
| **13b** | Client API base consistency (DMs use `resolveSocialApiBase`, not ad-hoc `VITE_API_URL`) | Next |
| **13c** | Quote fidelity E2E (BE enrich + `feedPostToPost` map nested quote) | Pending |
| **13d** | Own-post soft delete (FE wire to existing `DELETE /posts/{id}`) | Pending |
| **13e** | Notifications + bookmarks cursor load-more | Pending |
| **13f** | Report reason UX (spam/abuse/other → API) | Pending |
| **13g** | Home compose image parity with AppShell create | Pending |
| **13h** | Live cert gate (Clerk QA + smoke + STORAGE/CORS/Caddy) — **after** code slices; before user tour | Pending |

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
- **Known Seal gaps (Wave 13):** optimistic like/repost/bookmark lack rollback; block hide may not revert; DM send may mis-build API base; quotes create but may not render nested; no FE post delete; notif/bookmark lists may truncate without load-more.
- **Out of multi-user readiness / Seal:** full encoder, ML discovery, production x402 facilitator.
