# HeyVera Production Development Plan

Status: active internal execution plan

Scope: turn the HeyVera production checklist into safe parallel delivery slices for the X-style frontend and the new Rust social backend.

Non-goal: this is not shipped truth and does not mark future implementation complete.

## Current Reality

- The X-style frontend lives under `web/`.
- `web/FRONTEND-SPEC.md` is the frontend source of truth.
- The frontend branch has Clerk-aware auth/profile creation and auth-gated social actions.
- The production Rust social backend is not implemented yet.
- Canonical planning docs now exist for the production foundation, backend ADR, API contract, and checklist.
- Existing `.replit` changes are unrelated and should not be swept into production commits.

## Delivery Principle

Build the durable social loop first:

1. Clerk-authenticated account
2. HeyVera profile
3. post creation
4. chronological feed
5. follow/like/repost/bookmark actions
6. observability, rate limits, and recovery gates

Defer media processing, DMs, ranking, search, communities depth, and payments until the core loop is reliable.

## Safe Parallel Slice Map

### Slice A - Backend Skeleton

- Goal: create the Rust/Axum service foundation.
- Owns later:
  - backend crate/service root
  - router bootstrap
  - config/env loading
  - typed error envelope
  - `/health` and `/ready`
  - graceful shutdown
- Can run with: Slice B, Slice D, Slice F.
- Must land before: broad endpoint work.
- Collision rule: only one owner edits router/bootstrap files.

### Slice B - Schema And Migrations

- Goal: define durable Postgres truth.
- Owns later:
  - migrations for `accounts`, `profiles`, `posts`, `follows`, `likes`, `reposts`, `bookmarks`, `post_media`
  - indexes and constraints
  - `sqlx` offline metadata/CI pattern
- Can run with: Slice A, Slice C.
- Must land before: handler implementation depends on schema.
- Collision rule: one migration owner at a time; no parallel migration numbering.

### Slice C - Auth And Account Boundary

- Goal: make Clerk identity safe and convert it into HeyVera-owned account/profile authorization.
- Owns later:
  - Clerk JWT middleware
  - JWKS cache and key rotation
  - account bootstrap
  - account status checks
  - profile-required extractor for write endpoints
  - Clerk webhook verification/idempotency
- Can run with: Slice B after account/profile schema draft exists.
- Must land before: protected write endpoints.
- Collision rule: frontend may consume auth states, but backend owns auth truth.

### Slice D - API Contract Adapter

- Goal: keep `web/src/api/client.ts` aligned with the backend contract.
- Owns later:
  - `web/src/api/client.ts`
  - `web/src/api/types.ts`
  - mock-to-real migration flags
  - frontend error/loading conventions
- Can run with: Slice A and Slice B using documented contract.
- Must not edit: backend internals.
- Collision rule: all response shape changes update `docs/reference/heyvera-backend-api-contract.md` first.

### Slice E - Profiles And Posts Vertical Slice

- Goal: first real end-to-end backend path.
- Owns later:
  - `GET /me/profile`
  - `POST /me/profile`
  - `PATCH /me/profile`
  - `GET /users/:handle`
  - `POST /posts`
  - `GET /posts/:id`
- Depends on: Slice A, Slice B, Slice C.
- Can run with: Slice F after shared repository/query helpers are stable.

### Slice F - Feeds And Social Actions

- Goal: make the X-style app feel alive against real backend data.
- Owns later:
  - `GET /feed`
  - `GET /feed/following`
  - `GET /users/:handle/posts`
  - follow/unfollow
  - like/unlike
  - repost/unrepost
  - bookmark/unbookmark
- Depends on: Slice B schema and Slice C auth/profile checks.
- Feed rule: v1 uses keyset pagination and fanout-on-read.
- Collision rule: do not add ranking or fanout tables in v1 unless explicitly approved.

### Slice G - Observability, Rate Limits, And Ops

- Goal: prevent a demo backend from masquerading as production.
- Owns later:
  - request IDs
  - structured logs
  - OpenTelemetry traces/metrics
  - per-IP and per-account rate limits
  - health/readiness monitoring
  - CI smoke tests
  - backup/restore runbook
- Can run with: all slices through shared middleware and CI files.
- Collision rule: middleware ordering must be reviewed with auth owner.

### Slice H - Frontend Production QA

- Goal: prove the current frontend works with real auth and real backend.
- Owns later:
  - signed-out flow QA
  - signed-in-no-profile QA
  - signed-in-with-profile QA
  - mobile/tablet/desktop screenshots
  - smoke/E2E checks
  - bundle/code-split follow-up
- Can run with: backend implementation against mock/staging URLs.
- Collision rule: do not change backend contract ad hoc from QA findings; update docs first.

### Slice I - Later Product Waves

- Goal: expand after the core loop is reliable.
- Includes:
  - media signed uploads and processing
  - DMs
  - notifications generation
  - communities depth
  - search/trending
  - payments/premium
- Depends on: core auth/profile/post/feed/social loop.
- Collision rule: do not start payments or DMs before account, profile, observability, and moderation foundations exist.

## Five-Agent Safe Start

If starting implementation with five parallel agents, use this split:

1. Backend skeleton owner: Slice A only.
2. Schema owner: Slice B only.
3. Auth owner: Slice C only.
4. API contract/frontend adapter owner: Slice D only.
5. Ops/testing owner: Slice G only.

Do not start Slice E/F handler work until A/B/C have agreed interfaces.

## First Two-Week Sequence

### Days 1-2

- Final review of proposal, ADR, API contract, and checklist.
- Decide backend crate/service location.
- Freeze endpoint names and JSON shapes for the core loop.
- Start Slice A skeleton.
- Start Slice B migrations.
- Start Slice G CI/observability plan.

### Days 3-5

- Add Axum router, config, typed errors, health/readiness.
- Add initial Postgres migrations and indexes.
- Add `sqlx` CI strategy.
- Draft Clerk JWT middleware and internal account mapping.
- Keep frontend on mocks but validate `VITE_API_URL` contract assumptions.

### Days 6-8

- Implement Clerk verification and account/profile bootstrap.
- Implement `GET/POST/PATCH /me/profile`.
- Implement `GET /users/:handle`.
- Add integration tests for auth/profile behavior.
- Begin frontend staging check against the profile endpoints.

### Days 9-10

- Implement text-only `POST /posts` and `GET /posts/:id`.
- Implement chronological `GET /feed` and profile feed with keyset pagination.
- Add smoke test for sign in -> profile -> post -> feed.
- Run checkpoint review before social actions.

### Week 2 Follow-On

- Add follow/like/repost/bookmark with idempotent constraints.
- Add following feed fanout-on-read.
- Add rate limits for write endpoints.
- Add structured logs, traces, and route latency metrics.
- Run first mobile/tablet/desktop frontend QA against staging.

## Blockers

- Backend service location is not yet created.
- Postgres target and migration policy must be explicit.
- Clerk production app settings and callback URLs need verification.
- Backend auth must define how missing profile differs from missing account.
- API contract currently has open gaps for unrepost, reply create, quote create, notification writes, and settings persistence.
- Production observability backend is not selected.
- Postgres backup/restore plan is not yet proven.

## Handoff Rules

- Backend owns auth, authorization, persistence, counters, and policy.
- Frontend owns rendering, optimistic UI, loading/error states, and local interaction polish.
- Contract changes must update `docs/reference/heyvera-backend-api-contract.md` before code changes on either side.
- Each implementation slice owns a narrow file/module set.
- Do not run multiple agents on the same migration series, router bootstrap, or API client file at the same time.
- A feature is not complete until it has implementation, tests, docs, and a smoke path.

## Exit Criteria For The First Production Backend Slice

- `GET /me/profile`, `POST /me/profile`, `PATCH /me/profile`, `POST /posts`, `GET /feed`, and `GET /users/:handle` work against Postgres.
- Clerk JWT verification is enforced.
- Accounts and profiles are HeyVera-owned records tied to Clerk identity.
- Keyset pagination is used for feeds.
- Rate limits protect profile and post writes.
- Structured logs and request IDs exist.
- Build and integration tests pass in CI.
- Frontend can run against `VITE_API_URL` without mock-only behavior for the core loop.
- Smoke test covers sign in -> create profile -> edit profile -> post -> feed.
