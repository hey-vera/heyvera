# HeyVera Production Checklist

Status: canonical

Verified against the current repo on 2026-05-25. This checklist is phase-gated and evidence-bound: a box is checked only when the current repo already contains the corresponding source surface.

## How to Use This Checklist

- `[x]` = present in the current repo and verified.
- `[ ]` = not yet complete or not yet verified as shipped.
- `Status:` on each phase tells you whether the phase is done, ready next, later, or launch-gated.
- Do not treat older docs or chat plans as implementation evidence. Re-check current `main` before using this as a launch call.

## Phase 0 - Frontend Foundation

Status: done

These items are already present in `dashboard/` and are the current UI foundation for the HeyVera signing-authority flow.

- [x] Dashboard shell exists with dedicated `Enroll`, `Ceremonies`, and `Roster` views.
- [x] Enrollment UI calls `/api/authn/register/options` and `/api/authn/register/verify`.
- [x] Ceremony UI lists pending ceremonies, starts approval, and verifies approval through `/api/ceremony/:id/approve/*`.
- [x] Ceremony UI can create a test ceremony request through `/api/ceremony/request`.
- [x] Roster UI lists enrolled authenticators and exposes promote/revoke actions.
- [x] Frontend API helper layer exists for the current authn and ceremony flows.

## Phase 1 - Backend Foundation

Status: ready next

These are the next backend slices to finish before calling the HeyVera production path complete.

### Verified foundation already present

- [x] Health and deploy-info endpoints exist at `/health`, `/v1/health`, and `/api/deploy-info`.
- [x] WebAuthn registry routes exist for register, authenticate, roster, promote, and revoke.
- [x] Ceremony routes exist for request, pending list, detail, approval options, and approval verification.
- [x] SQLite-backed helper functions exist for WebAuthn credentials and pending ceremonies.
- [x] Economy foundation exists for delegated API-key issuance, listing, validation, and revocation.

### Required next work

- [ ] Require strong re-auth for promote/revoke; the route file still carries a Phase 2 TODO for this.
- [ ] Put an explicit auth/admin boundary in front of ceremony creation and approval operations before production use.
- [ ] Replace the ceremony placeholder certificate stub with the real `soma-heart` supply-chain certificate flow.
- [ ] Define and enforce the real threshold/sign-off policy for production ceremonies; current completion records only one approving authenticator per request.
- [ ] Add production smoke tests that cover enroll -> create ceremony -> approve -> roster updates.
- [ ] Re-verify the backend slice on `main` before scheduling launch work from this branch.

## Phase 2 - Later Waves

Status: later

These waves should stay separate from the backend-foundation closeout. They are product expansion work, not evidence that the current HeyVera production path is complete.

### Media

- [ ] Define the HeyVera media surface and owner; no dedicated media UI or media API path was verified in the current repo.
- [ ] Decide whether media belongs in this repo runtime, another repo, or a proposal first.

### Messages

- [ ] Define the HeyVera messages surface and owner; no dedicated messaging UI or messaging route was verified in the current repo.
- [ ] Write the canonical contract before implementation if messages affect trust, storage, or moderation behavior.

### Search

- [ ] Decide whether HeyVera search is a product surface or just a consumer of the existing orchestration runtime.
- [ ] If HeyVera needs first-class search, specify the UX and API contract instead of relying on generic `POST /v1/orchestrate`.
- [ ] Reconcile any search plan with `docs/reference/current-trust-surfaces.md`, which only verifies a minimal orchestration/search runtime on current main.

### Payments

- [x] Credit/account-key foundation exists in the current repo.
- [ ] Do not mark Stripe, Solana USDC, receipts, or checkout UX as shipped for HeyVera without fresh source verification on current `main`.
- [ ] Reconcile payment-related docs with current code before planning a production launch wave; older runtime references name payment files and routes that are not present in the current verified surface inventory.
- [ ] Decide whether HeyVera launch needs full payments on day one or only internal/admin credit flows.

## Phase 3 - Production Launch Gates

Status: gated

Do not treat the product as production-ready until every gate below is checked on the actual deploy branch.

- [ ] Re-run this checklist against `main`, not a feature branch.
- [ ] Open a PR, get required review, and merge to `main`.
- [ ] Confirm required GitHub checks pass: `api`, `dashboard`, `dependency-review`, and `analyze`.
- [ ] Confirm branch protection and the `production` environment gates match `docs/operations/release.md`.
- [ ] Deploy through GitHub Actions `Deploy Production`, not by ad hoc shell deploy.
- [ ] Verify `/health` and `/api/deploy-info` after deploy.
- [ ] Confirm production env/secrets are present and match the current code paths actually used at runtime.
- [ ] Confirm the VPS/deploy layout still matches the release and hardening docs closely enough to support rollback and recovery.
- [ ] Run a real production smoke test for the shipped foundation flow with actual authenticators.
- [ ] Explicitly decide which later-wave items are launch-blocking and which are post-launch backlog.

## Current Readout

- Frontend foundation: done
- Backend foundation: ready next
- Media/messages/search/payments: later waves
- Launch: blocked on backend closeout plus release/deploy verification on `main`
