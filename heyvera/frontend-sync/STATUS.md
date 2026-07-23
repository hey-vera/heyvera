# Frontend Status

## Current track

- **Active:** **Wave 14 — Social Completeness** (Discovery · Media/Live · x402). Markets/crypto product regions are **out of scope**.
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–13g + multi-user A–D + integrity (**#379**–**#387**)
- **Why encoder/ML/x402 were “deferred” in Wave 13:** Wave 13 was a **trust seal** (mutation integrity, quotes, delete, API base) so core verbs do not lie. That was sequencing, **not** a product decision to drop them. They are now **first-class Wave 14 tracks**.
- **13h live cert** remains an ops gate before a full user tour; product work proceeds in parallel.

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
| **13 Soft-Launch Seal** | **Code Done** (#380–#386); **13h cert pending (ops)** |
| **14 Social Completeness** | **In progress** (Discovery · Video · Live · x402) |

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

**Wave 13 intentionally excluded** encoder/ML/x402 so trust work finished first. Those are **Wave 14**, not cancelled.

## Wave 14 — Social Completeness (Discovery · Media/Live · x402)

**In scope:** Social product only. **Out of scope:** Markets/crypto pages, dual-shell growth, Agents full product shell.

### Track D — Discovery (usable ranking without fake “AI” claims)

| Slice | Scope | Status |
|-------|--------|--------|
| **14a** | Related posts (heuristic: shared tags + same author + recency) + thread “Related” UI | **Done (#391)** |
| **14b** | Trending quality (tag extract, min count, stable explore) | **Done (#392)** |
| **14c** | Explore tag → posts click-through + cold-start polish | **Done (#392)** (with 14b) |
| **14d** | Engagement-aware feed sort option (honest “Top” not “ML”) | Pending |
| **14e** | Embeddings-related discovery (real NN) — after 14a–d prove value | Later |

### Track V — Video (Watch path)

| Slice | Scope | Status |
|-------|--------|--------|
| **14f** | Progressive video attach/play on posts (mp4/webm via existing media API; no fake transcode claims) | **Done (#389)** |
| **14g** | Watch library lists real Page videos; upload enabled for progressive path | **Done (#389)** |
| **14h** | Shelf membership (add video/post to shelf) | Pending |

### Track L — Live encoder / ingest

| Slice | Scope | Status |
|-------|--------|--------|
| **14i** | LiveSession model (BE): create/start/end, phase `preview\|live\|ended`, Page-owned | **Done (#390)** |
| **14j** | FE LivePage binds to real sessions; LIVE badge only when phase=live | **Done (#390)** |
| **14k** | Managed ingest (CF Stream / Mux / WHIP) + viewer playback URL | **Next** |
| **14l** | Live chat (session-scoped or post thread) + end→optional VOD | Pending |

### Track X — x402 production path

| Slice | Scope | Status |
|-------|--------|--------|
| **14m** | Facilitator design + env contract (`X402_*` keys, network, recipient) | **Done (#393)** |
| **14n** | Real verify (facilitator HTTP) + durable payment receipts | **Done (#393)** |
| **14o** | One Social product gate (e.g. paid agent action or unlock) fail-closed | **Next** |

**Honest MVPs:**  
- Discovery: heuristics first; embeddings = 14e later.  
- Video: native progressive play; not HLS adaptive.  
- Live: managed ingest provider, not self-built RTMP farm.  
- x402: real settlement receipt, not shape-only stub.

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
- Media: shelves foundation; image attach live; video MIME accepted on API — **Wave 14 enables progressive video + Live sessions**.
- Agents: policy flags foundation; switcher Agents = WIP.
- x402: scaffold only until Wave 14m–o (facilitator + receipts + one product gate).
- **Wave 13 code sealed (#381–#386).** **Wave 14 active** — Discovery / Video / Live / x402 for Social completeness.
- **Still before cohort live tour:** 13h ops cert (STORAGE_*, Clerk, CORS, Caddy → :3002, smoke) — parallel to Wave 14.
- **Out of Social Completeness:** Markets/crypto pages, bookmark folders (later), full guild mod suite, dual-shell growth.
