# Clerk / Profile Production & Staging QA

Resume-friendly smoke for HeyVera’s Clerk-backed social loop. Use this when staging (or production) has real Clerk keys and a reachable API — **browser E2E with secrets cannot run in CI/sandbox without those credentials**.

| Field | Value |
|-------|--------|
| **Last updated** | 2026-07-17 |
| **Product** | heyvera.org only |
| **Related checklist** | `heyvera/CHECKLIST.md` residual #1 (Clerk browser E2E) |
| **Env reference** | `heyvera/docs/PRODUCTION-ENV.md` |
| **API matrix** | `heyvera/docs/API-CONTRACT.md` |

---

## Prerequisites

### Required for staging smoke

| Item | Example / notes |
|------|-----------------|
| **Frontend origin** | Staging or prod HeyVera URL (e.g. Cloudflare Pages project for `heyvera/`) |
| **`VITE_CLERK_PUBLISHABLE_KEY`** | Deployed on the frontend build for that origin |
| **Clerk allowed origins / redirect URLs** | Must include the staging/prod frontend origin |
| **API host** | Live HeyVera API (`heyvera-server` / cortex-api HeyVera router) with Clerk JWT verification |
| **API CORS / proxy** | Browser can call `/v1/*` (same-origin proxy or `VITE_API_URL` pointing at API) |
| **Test Clerk users** | (A) never created a HeyVera profile (B) existing profile |

### Optional

| Item | Notes |
|------|--------|
| `STORAGE_*` / R2 | Image attach on compose; skip media steps if unset |
| Linked-agent agent keys (`hvak_`) | Settings → linked agents; rotate only if you have a test agent |
| Second test profile | Follow + reply as another user |

### What CI can vs cannot automate

| Automated in CI / unit tests | Manual only (needs secrets + browser) |
|------------------------------|----------------------------------------|
| Mock Clerk / unit hooks (`useShellState`, `useMyProfile`, forms) | Real Clerk sign-in / session cookies |
| DB golden path: profile → post → follow → like → reply → feed → draft (`crates/api` `db.rs`) | Live `VITE_CLERK_PUBLISHABLE_KEY` + JWT against staging API |
| Pulse tools_v1 / draft / schedule unit paths | Full UI loop: compose → feed → like → reply with real session |
| heyvera `npm run typecheck` + unit tests (when registry allows) | Media upload end-to-end with R2 |
| — | Linked-agent key create/rotate UX |
| — | Production fail-closed behavior without Clerk (ops check) |

**Do not mark residual #1 complete** until the ordered staging smoke below has been run against a real Clerk app and the target frontend origin.

---

## Staging smoke (ordered)

Run in a **private/incognito** window. Prefer staging; production only when intentionally certifying prod.

### 0. Health / surface load

1. Open the HeyVera frontend URL.
2. Confirm shell loads (nav: Network / Discover / Watch / Guilds / Pulse) without a ClerkProvider crash.
3. Confirm no infinite spinner on first paint.

**Pass:** public shell readable; sign-in entrypoints visible when signed out.

### 1. Sign in (Clerk)

1. Open Sign in.
2. Complete Clerk flow with test user **(A)** (no HeyVera profile yet) or **(B)** as needed per section.
3. Confirm session sticks after redirect (refresh once).

**Pass:** signed-in chrome appears; no bounce to signed-out; no uncaught Clerk errors.

### 2. Create profile

1. With user **(A)** (no profile), confirm profile-missing / create-profile UI.
2. Create profile: valid handle + display name.
3. Confirm shell enters ready state (compose / Network feed available).

**Pass:** single successful create; handle normalized; no stuck loading.

### 3. Post (compose)

1. On Network / Home, compose a short text post.
2. Submit and confirm the post appears (optimistic once, then server-backed).

**Pass:** post created with Clerk bearer; no duplicate posts; body persists after refresh.

### 4. Feed

1. Open Network feed (For You / relevant tab).
2. Confirm the new post is visible (or following feed if you only follow yourself — use For You / global as implemented).
3. Open post thread from the card.

**Pass:** feed loads without hard error banner; empty vs error states are distinguishable.

### 5. Like

1. Like the post.
2. Reload the card/thread.

**Pass:** like toggles and count settle to server state after reload.

### 6. Reply

1. On the thread, post a reply.
2. Confirm reply appears under the parent.

**Pass:** reply succeeds with current session; visible after refresh.

### 7. Media (if available)

**Skip if** storage/presign is not configured on the API (`STORAGE_*` unset → mock path may still work locally).

1. Attach an image on compose (or mock upload path).
2. Publish and confirm image renders on the post card.

**Pass:** media attached and visible; failure surfaces an error (no silent drop).

### 8. Profile edit (quick)

1. Open profile / settings edit for display name or bio.
2. Save; hard-refresh.

**Pass:** fields persist (camelCase PATCH); no silent casing drop.

### 9. Linked agents / agent key rotate (note only)

If Settings → linked agents is present:

1. Confirm list/create linked agent works for the profile.
2. **Agent key rotate:** if UI exposes rotate/reveal of `hvak_` keys, create or rotate once and confirm the secret is shown only at create/rotate time.
3. Do **not** commit keys; treat as secrets.

If agent keys are API-only or another PR owns Settings LinkedAgents, record: *“linked agent CRUD checked; key rotate deferred / not in this UI.”*

**Pass:** ownership-safe; no key leaked into logs or git.

### 10. Sign out

1. Sign out via Clerk.
2. Confirm gated actions require sign-in again.

**Pass:** clean signed-out shell; no stale write affordances.

---

## Optional second-user checks

| Step | Action |
|------|--------|
| Follow | User B follows A; following feed shows A’s posts |
| Like/reply as B | Counts update for A |
| Block/mute | Optional moderation smoke |

---

## Automated coverage in this repo (no live Clerk)

From `heyvera/`:

```bash
npm run test:unit
npm run typecheck
```

Relevant unit/mock coverage (paths may evolve):

- Shell / auth state hooks (signed out, loading, no profile, ready)
- Create profile form (handle normalize, auth failure)
- Compose post (person / agent modes when mocked)
- Profile edit / account surfaces

Backend golden path (no browser):

```bash
cargo test -p cortex-api social_golden_path -- --nocapture
```

Pulse goal plan unit tests (deterministic decompose, not Clerk):

```bash
cargo test -p cortex-api --lib decompose_goal -- --nocapture
```

---

## Playwright / E2E

Existing Playwright suite under `heyvera/tests/` is largely **layout / mock-auth** oriented (`playwright.config.ts` → local Vite). It does **not** replace this Clerk staging smoke.

**Do not** add forced live-Clerk Playwright in CI without secrets plumbing. If a future skeleton is added, gate it with env skip, e.g. only run when `CLERK_E2E_ENABLED=1` and keys are present; default skip.

---

## Known gaps

- This document does **not** certify production Clerk by itself — it defines the smoke still required.
- Residual CHECKLIST #1 stays **blocked** until someone runs the ordered staging smoke with real keys.
- Avatar/banner file-picker and realtime websockets are separate residuals; not required to pass this smoke.
- Goal plans in Pulse are **plan templates** (deterministic steps), not Temporal execution — not part of this Clerk smoke.

---

## Sign-off template

```
Date:
Environment: staging | production
Frontend URL:
API host / proxy:
Clerk publishable key present: yes/no
Tester:

[ ] 0 Health
[ ] 1 Sign in
[ ] 2 Create profile
[ ] 3 Post
[ ] 4 Feed
[ ] 5 Like
[ ] 6 Reply
[ ] 7 Media (or N/A)
[ ] 8 Profile edit
[ ] 9 Linked agents / key note
[ ] 10 Sign out

Notes / failures:
```
