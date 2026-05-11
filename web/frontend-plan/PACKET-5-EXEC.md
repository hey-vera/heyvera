# Packet 5 Exec

Use this file for the next signed-in shell execution run.

## Goal

Build `Identity Lite` on top of the signed-in shell baseline and make
account, profile, credential, and ceremony state legible without
pretending final Soma-native auth is already done.

## Preconditions

- start from the branch or commit state that already contains the
  signed-in shell baseline
- if `src/App.tsx` does not already contain the region rail, top context
  bar, `Home`, and `Network`, stop and sync first

## Small Read Set

Read this file plus only the references needed for the packet:
- `frontend-plan/APP-SURFACES.md`
- `frontend-plan/BACKEND-SEAMS.md`
- `dashboard/src/lib/api.ts`
- `src/routes/auth.ts`
- `src/routes/economy.ts`

## Preferred Edit Targets

Prefer editing only:
- `src/App.tsx`
- `src/index.css`
- `src/components/app/BottomRegionNav.tsx`
- `src/components/app/RegionRail.tsx`
- `src/components/app/TopContextBar.tsx`
- `src/components/app/IdentityRegion.tsx`
- `src/api/identity.ts`
- `src/hooks/useAuthContext.tsx`

Create only the small helper components or hooks this packet truly
needs, for example:
- `src/hooks/useCredentialRoster.ts`
- `src/hooks/usePendingCeremonies.ts`
- `src/components/shared/UpdateProfileForm.tsx`
- `src/components/shared/LinkAgentForm.tsx`

## Required Outcome

- add `Identity` as a real shell region in desktop and mobile nav
- keep `Home` and `Network` behavior intact
- show a truthful signed-in identity overview using the current auth and
  profile state
- let a signed-in user update profile fields through the existing social
  profile patch route
- let a signed-in user link an agent through the existing linked-agent
  route
- show authenticator roster state using the existing `/api/authn/roster`
  surface
- show pending ceremony state using the existing `/api/ceremony/pending`
  surface
- if delegated-key issuance or revoke cannot be reached safely from the
  browser, show an honest blocked-state card instead of fake controls

## Design Direction

- identity should feel like continuity and authority, not account-admin
  sludge
- roster and ceremony UI should feel operational and calm, not copied
  from a generic dashboard
- keep the shell premium and infrastructural
- mobile still needs to read clearly

## Hard No

- no new routes or pages
- no broad shell rewrite
- no generic settings dashboard
- no fake wallet, billing, or market UI
- no invented API response shapes
- no fake delegation issuance, revoke, or lineage actions unless they
  are truly wired end-to-end
- no placeholder commit hashes, branch names, or status values

## Done Looks Like

- `Identity` is a first-class region in the shell
- a signed-in user can understand account state, profile state, linked
  agents, credential state, and pending ceremonies
- profile update and link-agent flows work against real existing seams
- blocked authority surfaces are clearly labeled as blocked, not faked
- the shell still feels coherent on desktop and mobile

## Packet Prompt

Use a short prompt like:

`Build only Packet 5 from this file. Add the Identity Lite region on top of the shell baseline, use only real seams, and stop after the packet.`
