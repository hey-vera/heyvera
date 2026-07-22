# Frontend Status

## Current track

- **Active:** Wave 11–12 product depth (media, agent network) — Wave 10 done
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Shipped through:** Waves 0–10 on main

## Wave progress

| Wave | Status |
|------|--------|
| 0–7 | **Done** |
| 8a–8g | **Done** (#353–#357) |
| 9a–9e | **Done** (#359–#365) |
| 10a Pulse draft metering | **Done** (#367) |
| 10b Premium history + access_state | **Done** (#368) |
| 10c Pulse transition CAS | **Done** (#369) |
| 11 Media depth | Next |
| 12 Agent network | Pending |

## Active truth

- Orphan shell documented in `src/orphan/README.md` — do not grow.
- Live entry: `main.tsx` → `router.tsx` → `AppShell` / `pages/*` only.
- Credits: balance null when unmetered; Pulse create meters only when credit row exists (#367).
- Premium: paginated history + honest access_state (#368).
- Pulse: draft transitions CAS + Approve only vs Approve & publish (#369).
- Video/Live: honesty labels — not full encoder.
- x402: stubs; gated unless `X402_ENABLED`.
