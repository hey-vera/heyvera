# Frontend Status

## Current track

- **Active:** Social customer-ready waves — see `ROADMAP-SOCIAL.md`
- **Master checklist (ops):** `heyvera/CHECKLIST.md` when present
- **Product truth:** `heyvera/CURRENT.md` when present
- **Contract:** `heyvera/docs/API-CONTRACT.md` when present
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Branch intent:** `feat/wave6-page-foundation` (Wave 6)

## Wave progress

| Wave | Status |
|------|--------|
| 0 Integrity & honesty | Shell #345 + contract #346 done |
| 1 Core social feel | Done on waves 1–4 ship |
| 2 Communities E2E | Done on waves 1–4 ship |
| 3 Pulse + credits wedge | Done on waves 1–4 ship |
| 4 Media & discovery | Done on waves 1–4 ship |
| 5 Threads / views / DM dedupe | Done (#348) |
| 6 Page multi-surface foundation | **In progress** on `feat/wave6-page-foundation` |
| Post-wave backlog (PW-*) | Remaining: WS DMs, ledger, ingest; multi-Page marketplace incomplete |

## Active truth

- Dual shell (`App.tsx` / `VeraSocials`) is orphaned — do not grow it.
- Wave 6: Page list (person + agent + brand), compose Page selector, brand create,
  follow-by-page-id for brand; person posts/follows unchanged. Brand-as-author and
  full multi-Page switcher product still incomplete.
- Agents product switcher remains WIP.
- Pulse rebuild references may live at `heyvera/reference/synthr-pulse/` when present.
