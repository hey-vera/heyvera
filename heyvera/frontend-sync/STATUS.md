# Frontend Status

## Current track

- **Active:** Social customer-ready waves — see `ROADMAP-SOCIAL.md`
- **Master checklist (ops):** `heyvera/CHECKLIST.md` when present
- **Product truth:** `heyvera/CURRENT.md` when present
- **Contract:** `heyvera/docs/API-CONTRACT.md` when present
- **Live surface:** `router.tsx` + `AppShell` + `pages/*` only
- **Branch intent:** `feat/wave5-threads-views-dm` (Wave 5)

## Wave progress

| Wave | Status |
|------|--------|
| 0 Integrity & honesty | Shell #345 + contract #346 done |
| 1 Core social feel | Done on waves 1–4 ship |
| 2 Communities E2E | Done on waves 1–4 ship |
| 3 Pulse + credits wedge | Done on waves 1–4 ship |
| 4 Media & discovery | Done on waves 1–4 ship |
| 5 Threads / views / DM dedupe | **In progress** on `feat/wave5-threads-views-dm` |
| Post-wave backlog (PW-*) | Remaining: WS DMs, multi-Page, ledger, ingest |

## Active truth

- Dual shell (`App.tsx` / `VeraSocials`) is orphaned — do not grow it.
- Wave 5: nested thread tree FE + full descendant replies BE; light `view_count`
  on post open; 1:1 conversation reuse on create.
- Pulse rebuild references may live at `heyvera/reference/synthr-pulse/` when present.
