# Frontend Status

## Current track

- **Active:** Post–Wave 12 (extended backlog only — no open product wave table)
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–12 on main

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

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- Credits: balance null when unmetered; Pulse create meters only when credit row exists (#367).
- Premium: paginated history + honest access_state (#368).
- Pulse: draft transitions CAS + Approve only vs Approve & publish (#369).
- Media: shelves foundation (empty items); Watch/Live honesty — no fake LIVE/player chrome (#371).
- Agents: policy flags foundation (not live runtime); product switcher Agents = WIP; x402 off unless `X402_ENABLED` (#372).
