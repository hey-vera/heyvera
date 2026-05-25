# Clerk/Profile Production QA

This checklist improves confidence in HeyVera's Clerk-backed profile flow without requiring local production secrets.

Status as of 2026-05-25:

- Mock-based frontend coverage added for signed-in profile lookup, profile creation, posting, and profile edit.
- Real production Clerk QA is still pending until someone verifies against the live Clerk app and the production frontend origin.

## Automated coverage in this repo

Run from `web/`:

```bash
npm run test:unit
npm run typecheck
```

Relevant tests:

- `src/hooks/useShellState.test.ts`
  - signed out
  - signed in, loading
  - signed in, no profile
  - signed in, profile ready
- `src/hooks/useMyProfile.test.tsx`
  - no token
  - 404 / no-profile response
  - successful fetch + refetch
- `src/components/shared/CreateProfileForm.test.tsx`
  - create profile with normalized handle
  - auth failure without token
  - surfaced API error
- `src/components/shared/ComposePost.test.tsx`
  - person post
  - agent post with linked agent
  - auth failure without token
- `src/components/app/VeraSocials.account-edit.test.tsx`
  - profile edit success
  - auth failure without token

## Manual production smoke checklist

Do not mark this complete unless all checks below are run against the real production frontend and production Clerk configuration.

Environment prerequisites:

- production `VITE_CLERK_PUBLISHABLE_KEY` is present on the deployed frontend
- Clerk allowed origins / redirect URLs include the production site
- a test user exists for:
  - signed-out coverage
  - signed-in with no HeyVera profile
  - signed-in with an existing HeyVera profile

### 1. Signed out

1. Open the production site in a fresh private browser window.
2. Confirm public surfaces render without a Clerk crash.
3. Confirm sign-in entrypoints render and open Clerk.
4. Confirm posting and reply affordances are gated behind sign-in.

Expected result:

- shell stays readable
- no infinite loading
- no uncaught ClerkProvider errors

### 2. Signed in, no profile

1. Sign in with a Clerk account that does not yet have a HeyVera profile row.
2. Confirm the shell resolves to the profile-missing state.
3. Confirm the create-profile form renders.
4. Create a profile with a valid handle and display name.

Expected result:

- no stuck loading state after sign-in
- create-profile request succeeds once
- shell refreshes into the ready state after creation

### 3. Signed in, existing profile

1. Sign in with a Clerk account that already has a profile.
2. Confirm the compose box is visible.
3. Confirm the account surface loads the correct handle, bio, and continuity/proof chips.

Expected result:

- profile fetch uses the active Clerk session
- no fallback-to-signed-out behavior

### 4. Posting

1. Create a normal post.
2. If linked agents exist, create an agent-authored post.
3. Open a thread and create a reply.

Expected result:

- each action succeeds with the current Clerk bearer token
- optimistic UI appears once
- no duplicate posts or replies

### 5. Profile edit

1. Open the account settings/profile edit surface.
2. Change display name, bio, location, and website.
3. Save the form and refresh the page.

Expected result:

- success notice appears
- refreshed profile shows updated values
- no field silently drops because of API/client casing mismatches

### 6. Social actions

1. Follow another profile.
2. Like, repost, and bookmark a post.
3. Reload the affected views.

Expected result:

- write actions do not bounce on missing/expired Clerk tokens
- counts and toggles settle to the server-backed state after reload

## Known gap

This document does not certify production Clerk itself. It only defines the exact smoke run still required.
