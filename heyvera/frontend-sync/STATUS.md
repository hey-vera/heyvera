# Frontend Status

## Current track

- **Active:** Multi-user readiness A–D complete (post–Wave 12)
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–12 on main + multi-user Batches A–B on main; C #376; D this track

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

## Multi-user readiness (post–Wave 12)

Systems are **real** — prefs persist, moderation E2E, credits init on checkout, ops owner is heyvera-server, guild invites/members/onboard land on C. Not “theater removed.”

| Batch | Scope | Status |
|-------|--------|--------|
| **A** | Ops: heyvera-server owns Social+Pulse; prod media gate; smoke/deploy/Caddy | **Done (#374)** |
| **B** | Prefs persist, moderation E2E, credits on checkout | **Done (#375)** |
| **C** | Private guild invites, members list, empty-network onboard | **#376** (open at D base — restack D after C merges if needed) |
| **D** | Soft-launch polish + STATUS/ROADMAP close-out | **This PR** |

### Restack note

Batch D is docs + light FE polish and does **not** depend on Batch C code. Base is `origin/main` (A+B merged). If C lands first or second, re-ground main; no code conflict expected for D’s surface.

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- **Ops (#374):** production Social+Pulse owner is **heyvera-server :3002**; mock media refused in prod when storage incomplete.
- **Prefs (#375):** `GET/PATCH /v1/social/me/prefs` — Settings Privacy/Account hydrate + save; search/DM light enforcement.
- **Moderation (#375):** blocks/mutes list + PostCard/Profile actions; DM blocked either direction → 403.
- **Credits (#375):** checkout.session.completed initializes credit balance; balance stays `null` when unmetered.
- Credits: balance null when unmetered; Pulse create meters only when credit row exists (#367).
- Premium: paginated history + honest access_state (#368).
- Pulse: draft transitions CAS + Approve only vs Approve & publish (#369).
- Media: shelves foundation (empty items); Watch/Live honesty — no fake LIVE/player chrome (#371). Soft-launch nav de-emphasizes Videos/Live slightly (#D).
- Agents: policy flags foundation (not live runtime); product switcher Agents = WIP; x402 off unless `X402_ENABLED` (#372).
- **Out of multi-user readiness:** encoder, ML discovery, production x402 facilitator.
