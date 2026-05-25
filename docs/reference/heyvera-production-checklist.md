# HeyVera Production Checklist

Status: canonical

Verified against the current repo on 2026-05-25. This checklist is evidence-bound: a checked box means the repo currently contains that foundation. An unchecked box means it is still implementation, verification, or launch-gate work.

## Evidence Rules

- `[x]` means present in the current repo and verified.
- `[ ]` means not complete, not verified, or intentionally deferred.
- Do not mark future backend, media, payments, search, or messaging work complete from plans alone.
- Re-run this checklist against `main` before any production launch call.

## Current Production Routing Truth

Status: verified live on 2026-05-25

- [x] `https://heyvera.org` is served by Cloudflare Pages as the frontend origin.
- [x] `https://heyvera.org/v1/health` currently returns frontend HTML, not API health JSON.
- [x] `https://api.heyvera.org/api/health` currently returns Cortex JSON and is the live backend health path that exists today.
- [x] `https://api.heyvera.org/v1/health` currently returns `404 Not Found`.
- [x] `https://cortex.heyvera.org/api/health` currently returns frontend HTML and must not be treated as the API origin.
- [x] Draft PR `#231` is only a follow-on step for a Cloudflare Pages Function proxy on `/v1/*`; it is not a substitute for the backend `/v1/*` surface existing first.
- [ ] Do not point production frontend traffic at `heyvera.org/v1/*` until the upstream backend `/v1/*` routes exist and are verified.

## Phase 0 - Frontend Foundation

Status: mostly complete on `feat/cortex-billing-ui`

- [x] X-style React/Vite frontend shell exists under `web/`.
- [x] `web/FRONTEND-SPEC.md` is the frontend source of truth.
- [x] Core routes exist: home, explore, notifications, messages, bookmarks, communities, premium, profile, settings, AI placeholder, post thread.
- [x] Current frontend API client has mock-to-real switch via `VITE_API_URL`.
- [x] Clerk provider is conditionally wired through `VITE_CLERK_PUBLISHABLE_KEY`.
- [x] Clerk-aware sign-in/profile controls are wired in the X-style shell.
- [x] Signed-in profile bootstrap supports `GET /me/profile`.
- [x] Profile creation supports `POST /me/profile`.
- [x] Profile editing supports `PATCH /me/profile`.
- [x] Compose/posting is gated on sign-in plus HeyVera profile.
- [x] Like/repost/bookmark/reply/quote actions are frontend-gated on sign-in plus profile readiness.
- [x] `npm run build` passes for `web/`.
- [ ] Real Clerk production QA has been run with production callback URLs.
- [ ] Frontend E2E coverage exists for signed-out, signed-in-no-profile, signed-in-with-profile, posting, profile edit, and social actions.
- [ ] Mobile/tablet/desktop screenshots are captured in an automated regression path.
- [ ] Main JS bundle is code-split or explicitly accepted for first launch.
- [ ] Production frontend env is set only after backend `/v1/*` is live and the final API origin is verified.

## Phase 1 - Canonical Decisions And Contracts

Status: ready next / in progress

- [x] Production foundation proposal exists: `docs/proposals/heyvera-production-foundation.md`.
- [x] Backend foundation ADR exists: `docs/decisions/ADR-0007-heyvera-production-backend-foundation.md`.
- [x] Frontend-to-backend API contract exists: `docs/reference/heyvera-backend-api-contract.md`.
- [x] Internal parallel execution plan exists: `internal/active/heyvera-production-development-plan.md`.
- [ ] Proposal is reviewed and accepted by maintainers.
- [ ] ADR is reviewed and confirmed against current repo ownership.
- [ ] API contract is reconciled with `web/src/api/client.ts` before backend implementation starts.
- [ ] Open contract gaps are resolved or explicitly deferred: unbookmark, unrepost, reply create, quote create, notification writes, settings persistence.

## Phase 2 - Rust Backend Foundation

Status: not implemented

- [ ] Rust backend service scaffold exists.
- [ ] Axum router is initialized.
- [ ] `sqlx` is configured.
- [ ] Postgres connection pool is configured.
- [ ] Redis client is configured.
- [ ] Object storage client is configured for S3/R2-compatible signed upload flows.
- [ ] Config/env loading is typed and environment-aware.
- [ ] Typed API error envelope exists.
- [ ] Request body limits are enforced.
- [ ] CORS is explicit for production origins.
- [ ] `/health` liveness endpoint exists.
- [ ] `/ready` readiness endpoint checks required dependencies.
- [ ] Graceful shutdown drains in-flight requests.
- [ ] CI builds the Rust backend.
- [ ] CI runs backend tests against a throwaway Postgres.
- [ ] `cargo sqlx prepare` or equivalent sqlx offline metadata flow is enforced.

## Phase 3 - Auth, Accounts, And Profiles

Status: not implemented

- [ ] Clerk JWT verification middleware exists.
- [ ] JWKS cache exists with TTL, key rotation handling, and stampede protection.
- [ ] Token validation checks issuer, expiration, authorized party/audience as applicable.
- [ ] Auth failures use typed errors.
- [ ] Internal `accounts` table exists.
- [ ] Clerk `sub` maps to internal account ID.
- [ ] Account states exist: `active`, `suspended`, `deleted`.
- [ ] HeyVera profile table exists.
- [ ] Profile handles are normalized and unique case-insensitively.
- [ ] `GET /me/profile` returns `404` for signed-in users without profile.
- [ ] `POST /me/profile` creates a profile for the signed-in account.
- [ ] `PATCH /me/profile` updates the signed-in profile.
- [ ] Clerk webhook signature verification exists.
- [ ] Clerk webhook processing is idempotent.
- [ ] User delete/suspend lifecycle is represented in HeyVera-owned state.
- [ ] Non-onboarding write endpoints require both valid account and profile.

## Phase 4 - Social Data Model

Status: not implemented

- [ ] `posts` table exists.
- [ ] `follows` table exists with unique follower/followee edge.
- [ ] `likes` table exists with unique viewer/post edge.
- [ ] `reposts` table exists with unique viewer/post edge.
- [ ] `bookmarks` table exists with unique viewer/post edge.
- [ ] `post_media` table exists.
- [ ] Soft-delete fields exist for posts.
- [ ] Profile/account moderation state filters feed-visible content.
- [ ] Foreign keys protect core relationships.
- [ ] Indexes exist for feed, profile timeline, follows, and reaction lookups.
- [ ] Derived counters are updated safely or reconciled by a repair job.
- [ ] Idempotent write semantics exist for follow/like/repost/bookmark toggles.

## Phase 5 - Backend API Endpoints

Status: not implemented

- [ ] `GET /users/:handle`
- [ ] `GET /users/:handle/posts`
- [ ] `POST /posts`
- [ ] `GET /posts/:id`
- [ ] `GET /feed`
- [ ] `GET /feed/following`
- [ ] `POST /posts/:id/like`
- [ ] `DELETE /posts/:id/like`
- [ ] `POST /posts/:id/repost`
- [ ] `DELETE /posts/:id/repost`
- [ ] `POST /posts/:id/bookmark`
- [ ] `DELETE /posts/:id/bookmark`
- [ ] `POST /users/:id/follow`
- [ ] `DELETE /users/:id/follow`
- [ ] `GET /notifications`
- [ ] `GET /conversations`
- [ ] `GET /conversations/:id/messages`
- [ ] `GET /search`
- [ ] `GET /trending`
- [ ] `GET /communities`
- [ ] `GET /communities/:id/feed`

## Phase 6 - Feed Correctness

Status: not implemented

- [ ] Cursor pagination is keyset-based, not offset-based.
- [ ] Cursor is opaque and based on stable ordering such as `(created_at, id)`.
- [ ] Home feed v1 is chronological and simple.
- [ ] Following feed v1 uses fanout-on-read.
- [ ] Profile feed filters deleted/suspended content.
- [ ] Reposts have an explicit feed visibility rule.
- [ ] Deleted/suspended account content is filtered.
- [ ] Block/mute filtering is designed before public launch or explicitly deferred.
- [ ] Feed load test covers deep pagination and new inserts between pages.

## Phase 7 - Abuse, Safety, And Moderation

Status: not implemented

- [ ] Per-IP rate limiting exists.
- [ ] Per-account rate limiting exists.
- [ ] Write endpoints have stricter limits than read endpoints.
- [ ] Post creation limits exist.
- [ ] Profile edit limits exist.
- [ ] Follow/unfollow limits exist.
- [ ] Reaction limits exist.
- [ ] Report user/post endpoint exists or is explicitly deferred from launch.
- [ ] Block user exists or is explicitly deferred from launch.
- [ ] Mute user exists or is explicitly deferred from launch.
- [ ] Audit log exists for moderation and account-state changes.
- [ ] Admin suspension path exists before public traffic.

## Phase 8 - Observability And Operations

Status: not implemented for the new Rust backend

- [ ] Structured JSON logs exist.
- [ ] Request IDs exist.
- [ ] Trace IDs are propagated.
- [ ] OpenTelemetry traces cover HTTP handlers.
- [ ] DB latency metrics exist.
- [ ] Redis latency/error metrics exist.
- [ ] Clerk/JWKS latency/error metrics exist.
- [ ] Object storage latency/error metrics exist.
- [ ] Error tracking is configured.
- [ ] Health and readiness endpoints are monitored.
- [ ] Alerting exists for downtime, error spikes, DB saturation, Redis failures, and webhook failures.
- [ ] Deploy metadata endpoint or equivalent is available.

## Phase 9 - Media

Status: later wave

- [ ] Signed upload URL endpoint exists.
- [ ] Upload completion/finalization endpoint exists.
- [ ] Object ownership metadata is persisted in Postgres.
- [ ] File size limits are enforced.
- [ ] MIME validation is enforced.
- [ ] R2/S3 CORS is restricted to production domains.
- [ ] Orphaned upload lifecycle policy exists.
- [ ] CDN/public serving policy is documented.
- [ ] Image/video processing pipeline is explicitly deferred or implemented.
- [ ] Malware/content scanning is explicitly deferred or implemented.

## Phase 10 - Messages, Search, Communities, Notifications

Status: later wave after core social loop

- [ ] Messages have a privacy and retention model.
- [ ] Messages have access-control tests.
- [ ] Conversations support stable pagination.
- [ ] Notifications are generated from durable events.
- [ ] Search implementation is selected and documented.
- [ ] Trending implementation is selected and documented.
- [ ] Community membership and feed semantics are finalized.
- [ ] Community feed is not confused with member timeline unless intentionally documented.

## Phase 11 - Payments And Premium

Status: later wave

- [ ] Stripe customer mapping exists.
- [ ] Subscription table exists.
- [ ] Stripe webhook signature verification exists.
- [ ] Billing webhooks are idempotent.
- [ ] Premium entitlement checks are backend-enforced.
- [ ] Billing portal link is wired.
- [ ] Billing audit events exist.
- [ ] Premium UI is backed by real entitlement state.

## Phase 12 - Production Launch Gates

Status: blocked until backend and ops gates pass

- [ ] Launch order is preserved: backend `/v1/*` first, then Cloudflare Pages Function proxy for `heyvera.org/v1/*`, then frontend env switch and smoke tests.
- [ ] Backend `/v1/health` exists on the canonical API origin and returns the expected API health payload before any frontend proxy cutover.
- [ ] Cloudflare Pages Function proxy is enabled only after upstream `api.heyvera.org/v1/*` works end-to-end.
- [ ] `heyvera.org/v1/health` returns API health output after proxy enablement, not frontend HTML.
- [ ] Frontend production `VITE_API_URL` target is verified against the chosen launch path (`https://api.heyvera.org/v1` direct or `https://heyvera.org/v1` via proxy).
- [ ] Frontend post-cutover smokes cover home feed, profile bootstrap, profile create/edit, post create, and core social actions against the production API path.
- [ ] Latest work is pushed.
- [ ] PR is opened and reviewed.
- [ ] Work is merged to `main`.
- [ ] Frontend build passes in CI.
- [ ] Backend build passes in CI.
- [ ] Backend migrations pass against a throwaway database.
- [ ] Integration tests cover auth/profile/post/feed/social actions.
- [ ] Production Clerk callback URLs are verified.
- [ ] Production env vars are verified against code paths actually used at runtime.
- [ ] Postgres backups are scheduled.
- [ ] Restore drill has been run.
- [ ] Offsite backup exists.
- [ ] Redis loss behavior is documented.
- [ ] Object storage lifecycle policy is set.
- [ ] Rollback runbook exists.
- [ ] Smoke suite passes after deploy.
- [ ] Basic load test passes for feed reads, post writes, and reaction bursts.
- [ ] Monitoring dashboard is live.
- [ ] Incident/runbook docs are updated.

## Current Readout

- Frontend foundation: mostly complete on feature branch, pending real Clerk/E2E production QA.
- Backend foundation: documented, not implemented.
- Core production blocker: Rust backend vertical slice plus auth/profile/post/feed/social action integration, including a real backend `/v1/*` surface on the canonical API origin.
- Routing blocker: `heyvera.org/v1/*` is not live API traffic yet; `api.heyvera.org/api/*` is the currently working Cortex path, while `api.heyvera.org/v1/*` still needs to exist before any Pages proxy cutover.
- Later waves: media, messages, search, communities, notifications, payments.
- Launch: blocked until backend `/v1/*`, proxy sequencing, frontend env cutover, observability, CI, backups, smoke/load tests, and deploy gates pass on `main`.
