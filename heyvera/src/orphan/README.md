# Orphan surfaces (do not grow)

These files are **not** mounted by the live product entry (`src/main.tsx` → `router.tsx` → `AppShell`).

| Path | Notes |
|------|--------|
| `src/App.tsx` | Old region shell; deprecated header in file |
| `src/components/app/VeraSocials.tsx` | Old social monolith |
| `src/api/mock.ts` | Unused mock feed |

**Rule:** New social features land only under `pages/*`, `components/layout/*`, `components/shared/*`, `api/social.ts`, `api/pulse.ts`.

Tests that still import `AccountEditProfile` from VeraSocials are temporary; prefer Settings/Profile live paths for new profile-edit coverage.
