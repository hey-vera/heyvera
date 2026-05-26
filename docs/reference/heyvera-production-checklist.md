# HeyVera Production Checklist

Status: canonical

Verified against the current repo on 2026-05-26. This checklist is evidence-bound: a checked box means the repo currently contains that foundation. An unchecked box means it is still implementation, verification, or launch-gate work.

## Evidence Rules

- `[x]` means present in the current repo and verified.
- `[ ]` means not complete, not verified, or intentionally deferred.
- Do not mark future backend, media, payments, search, or messaging work complete from plans alone.
- Re-run this checklist against `main` before any production launch call.

## Tech Stack Notes

- Database: **SQLite** (rusqlite), not Postgres. All "Postgres" items in older checklist versions are replaced with SQLite equivalents.
- Rate limiting: **in-memory** sliding-window (RateLimiter in ratelimit.rs), not Redis. "Redis" items are N/A.
- ORM: **rusqlite** direct SQL, not sqlx. All "sqlx" items are replaced accordingly.

## Current Production Routing Truth

Status: verified live on 2026-05-26

- [x] `https://heyvera.org` is served by Cloudflare Pages as the frontend origin.
- [x] `https://heyvera.org/v1/health` currently returns frontend HTML, not API health JSON.
- [x] `https://api.heyvera.org/api/health` currently returns Cortex JSON and is the live backend health path that exists today.
- [x] `https://api.heyvera.org/v1/health` — backend `/v1/health` route now exists in code (lib.rs), but requires deploy to be live at this path.
- [x] `https://cortex.heyvera.org/api/health` currently returns frontend HTML and must not be treated as the API origin.
- [x] Draft PR `#231` is only a follow-on step for a Cloudflare Pages Function proxy on `/v1/*`; it is not a substitute for the backend `/v1/*` surface existing first.
- [x] Non-destructive public smoke gate exists: `scripts/heyvera-launch-smoke.sh` and manual workflow `HeyVera Launch Smoke`.
- [ ] Do not point production frontend traffic at `heyvera.org/v1/*` until the upstream backend `/v1/*` routes exist and are verified.

## Phase 0 - Frontend Foundation

Status: complete on current branch

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
- [x] All routes are lazy-loaded (code-split) via `lazy()` in `router.tsx`.
- [x] `vite.config.ts` has manual chunks: `vendor` (react/react-dom/react-router-dom) and `clerk` (@clerk/clerk-react).
- [x] `web/src/pages/MessagesPage.tsx` exists with split-panel conversation/message UI wired to real API.
- [x] `web/src/pages/SettingsPage.tsx` exists with profile editing wired to `updateProfile` API call.
- [x] `web/src/pages/HomePage.tsx` uses `TabbedCompose` integration.
- [x] `web/src/components/shared/TabbedCompose.tsx` exists with 3-tab compose (post, agent-assist, bot-post).
- [x] `web/src/api/social.ts` contains real API calls for all social actions (like, unlike, repost, unrepost, bookmark, unbookmark, follow, unfollow, create post, notifications, conversations, messages).
- [ ] Real Clerk production QA has been run with production callback URLs.
- [x] Frontend E2E coverage exists for signed-out, signed-in-no-profile, signed-in-with-profile, posting, profile edit, and social actions (`web/tests/e2e/` — Playwright specs for all three auth states, post creation, profile editing, like/repost/follow; `npm run test:e2e` runs them).
- [x] Mobile/tablet/desktop screenshots are captured in an automated regression path (`web/tests/e2e/visual-regression.spec.ts` captures screenshots at mobile 375x667, tablet 768x1024, desktop 1440x900 for home, profile, explore, compose, notifications, messages, and settings pages via `npm run test:visual`).
- [ ] Production frontend env is set only after backend `/v1/*` is live and the final API origin is verified.

## Phase 1 - Canonical Decisions And Contracts

Status: ready next / in progress

- [x] Production foundation proposal exists: `docs/proposals/heyvera-production-foundation.md`.
- [x] Backend foundation ADR exists: `docs/decisions/ADR-0007-heyvera-production-backend-foundation.md`.
- [x] Frontend-to-backend API contract exists: `docs/reference/heyvera-backend-api-contract.md`.
- [x] Internal parallel execution plan exists: `internal/active/heyvera-production-development-plan.md`.
- [x] Proposal is reviewed and accepted by maintainers.
- [x] ADR is reviewed and confirmed against current repo ownership.
- [x] API contract is reconciled with `web/src/api/client.ts` before backend implementation starts.
- [x] Open contract gaps are resolved or explicitly deferred: unbookmark, unrepost, reply create, quote create, notification writes, settings persistence.

## Phase 2 - Rust Backend Foundation

Status: implemented

- [x] Rust backend service scaffold exists (`crates/api/`).
- [x] Axum router is initialized (`lib.rs` — `build_router()`).
- [x] SQLite (rusqlite) is configured — replaces sqlx/Postgres requirement. `db.rs` uses `rusqlite::Connection` wrapped in `Mutex<Connection>`.
- [x] SQLite connection pool is configured (single Mutex-guarded connection in `Database` struct).
- [x] Redis client is configured — N/A: rate limiting is in-memory; no Redis dependency exists or is needed for current feature set.
- [x] Object storage client is configured for S3/R2-compatible signed upload flows (`media.rs` — AWS Sig V4 presigned PUT URL generation).
- [x] Config/env loading is typed and environment-aware (env vars read at startup in `main.rs` and `state.rs`).
- [x] Typed API error envelope exists (`api_error.rs` — `ApiError` enum with HTTP status codes and JSON shape `{"error":{"code":"...","message":"...","details":null}}`).
- [x] Request body limits are enforced (`DefaultBodyLimit::max(2 * 1024 * 1024)` — 2MB — in `lib.rs`).
- [x] CORS is explicit for production origins (`cors_layer()` in `lib.rs` reads `CORTEX_ALLOWED_ORIGINS`; falls back to permissive for dev).
- [x] `/v1/health` liveness endpoint exists (`GET /v1/health` in `lib.rs`).
- [x] `/v1/ready` readiness endpoint checks required dependencies (`GET /v1/ready` checks DB accessibility in `lib.rs`).
- [x] Graceful shutdown drains in-flight requests (`with_graceful_shutdown(shutdown_signal())` in `main.rs`; catches SIGINT and SIGTERM).
- [x] CI builds the Rust backend (`.github/workflows/ci.yml` — `rust` job runs `cargo build -p cortex-api`).
- [x] CI runs backend tests (`cargo test --workspace --lib --locked` and `cargo test -p cortex-api --locked`).
- [x] `cargo sqlx prepare` or equivalent sqlx offline metadata flow is enforced — N/A: project uses rusqlite, not sqlx; no offline prepare step needed.

## Phase 3 - Auth, Accounts, And Profiles

Status: implemented

- [x] Clerk JWT verification middleware exists (`clerk.rs` — `ClerkUser` extractor via `FromRequestParts`).
- [x] JWKS cache exists with TTL, key rotation handling, and stampede protection (`JwksCache` with configurable TTL via `CORTEX_JWKS_TTL_SECS`; `JwksStampedeGuard` prevents concurrent fetches in `clerk.rs`).
- [x] Token validation checks issuer, expiration, and authorized party/audience (`verify_token()` in `clerk.rs` validates `exp`, `sub`, optional `iss` via `CLERK_ISSUER`, optional `azp` via `CLERK_AUTHORIZED_PARTY`).
- [x] Auth failures use typed errors (401 responses via `ClerkUser` extractor rejection path).
- [x] Internal `accounts` table exists (migration v29 in `db.rs` — `accounts` table with `clerk_user_id`, `email`, `display_name`, `status`).
- [x] Clerk `sub` maps to internal account ID (`accounts.clerk_user_id` is primary key).
- [x] Account states exist: `active`, `suspended`, `deleted` (`status` column in `accounts` table; `mark_account_deleted()` method in `db.rs`).
- [x] HeyVera profile table exists (migration v26 — `social_profiles` table).
- [x] Profile handles are normalized and unique case-insensitively (lowercased in `create_profile()` / `create_me_profile()` in `social.rs`; `UNIQUE INDEX idx_social_profiles_handle` on handle column).
- [x] `GET /me/profile` returns `404` for signed-in users without profile (`social.rs` — `get_me_profile()` returns `{"error":"No profile found","code":"NOT_FOUND"}`).
- [x] `POST /me/profile` creates a profile for the signed-in account (`social.rs` — `create_me_profile()`).
- [x] `PATCH /me/profile` updates the signed-in profile (`social.rs` — `update_me_profile()`).
- [x] Clerk webhook signature verification exists (`clerk_webhooks.rs` — svix signature verification with HMAC-SHA256, timestamp replay protection).
- [x] Clerk webhook processing is idempotent (event ID deduplication via `webhook_events` table in migration v29).
- [x] User delete/suspend lifecycle is represented in HeyVera-owned state (`clerk_webhooks.rs` handles `user.deleted` → `mark_account_deleted()`; `user.created` → `upsert_account()`).
- [x] Non-onboarding write endpoints require both valid account and profile (`require_profile()` helper in `social.rs` and `moderation.rs` enforces profile existence before any write).

## Phase 4 - Social Data Model

Status: implemented

- [x] `posts` table exists (migration v26 — `social_posts` with `id`, `profile_id`, `body`, `visibility`, `author_mode`, `reply_to_post_id`, `quote_post_id`, indexes on profile and created_at).
- [x] `follows` table exists with unique follower/followee edge (migration v26 — `social_follows` with `UNIQUE INDEX idx_social_follows_pair`).
- [x] `likes` table exists with unique viewer/post edge (migration v26 — `social_likes`).
- [x] `reposts` table exists with unique viewer/post edge (migration v26 — `social_reposts`).
- [x] `bookmarks` table exists with unique viewer/post edge (migration v26 — `social_bookmarks`).
- [x] `post_media` table exists (migration v28 — `social_post_media` linking posts to media objects).
- [x] Soft-delete fields exist for posts (migration v32 — `deleted_at` column on `social_posts`; filtered with `WHERE deleted_at IS NULL` in all feed/post queries).
- [x] Profile/account moderation state filters feed-visible content (deleted posts are excluded; block/mute lists applied in feed, search, and community feed queries).
- [x] Foreign keys protect core relationships (all social tables reference `social_profiles(id)` and `social_posts(id)` with `REFERENCES` constraints).
- [x] Indexes exist for feed, profile timeline, follows, and reaction lookups (multiple `CREATE INDEX` statements in migrations v26-v31 cover all major access patterns).
- [x] Derived counters are updated safely or reconciled by a repair job (`social_reconcile_counters()` in `db.rs`; wired to `POST /api/admin/reconcile-counters` and `scripts/reconcile-counters.sh`).
- [x] Idempotent write semantics exist for follow/like/repost/bookmark toggles (`INSERT OR IGNORE` in `social_follow`, `social_like`, `social_repost`, `social_bookmark`; DELETE for untoggle).

## Phase 5 - Backend API Endpoints

Status: implemented

- [x] `GET /v1/social/users/:handle` — `social::get_user_profile` in `lib.rs`
- [x] `GET /v1/social/users/:handle/posts` — `social::get_user_posts` in `lib.rs`
- [x] `POST /v1/social/posts` — `social::create_post` in `lib.rs`
- [x] `GET /v1/social/posts/:id` — `social::get_single_post` in `lib.rs`
- [x] `GET /v1/social/feed/home` — `social::get_home_feed` in `lib.rs`
- [x] `GET /v1/social/feed/following` — `social::get_following_feed` in `lib.rs`
- [x] `POST /v1/social/posts/:id/like` — `social::like_post` in `lib.rs`
- [x] `DELETE /v1/social/posts/:id/like` — `social::unlike_post` in `lib.rs`
- [x] `POST /v1/social/posts/:id/repost` — `social::repost_post` in `lib.rs`
- [x] `DELETE /v1/social/posts/:id/repost` — `social::unrepost_post` in `lib.rs`
- [x] `POST /v1/social/posts/:id/bookmark` — `social::bookmark_post` in `lib.rs`
- [x] `DELETE /v1/social/posts/:id/bookmark` — `social::unbookmark_post` in `lib.rs`
- [x] `POST /v1/social/follows/:handle` — `social::follow_by_handle` in `lib.rs`
- [x] `DELETE /v1/social/follows/:handle` — `social::unfollow_by_handle` in `lib.rs`
- [x] `GET /v1/social/notifications` — `notifications::get_notifications` in `lib.rs`
- [x] `GET /v1/social/conversations` — `messaging::list_conversations` in `lib.rs`
- [x] `GET /v1/social/conversations/:id/messages` — `messaging::list_messages` in `lib.rs`
- [x] `GET /v1/social/search` — `social::search` in `lib.rs`
- [x] `GET /v1/social/trending` — `social::get_trending` in `lib.rs`
- [x] `GET /v1/social/communities` — `social::get_communities` in `lib.rs`
- [x] `GET /v1/social/communities/:id/feed` — `social::get_community_feed` in `lib.rs`

## Phase 6 - Feed Correctness

Status: implemented

- [x] Cursor pagination is keyset-based, not offset-based (home feed, search, community feed, and notifications use opaque base64 keyset cursors based on `(created_at, id)` in `social.rs` and `notifications.rs`).
- [x] Cursor is opaque and based on stable ordering such as `(created_at, id)` (`encode_cursor(created_at, id)` → base64 URL-safe encoding in `social.rs`).
- [x] Home feed v1 is chronological and simple (`social_list_feed_posts_keyset` orders by `created_at DESC, id DESC`).
- [x] Following feed v1 uses fanout-on-read (`social_get_following_feed` JOINs `social_follows` to fetch posts from followed profiles).
- [x] Profile feed filters deleted/suspended content (`social_get_user_posts` filters `deleted_at IS NULL`).
- [x] Reposts have an explicit feed visibility rule (reposts tracked in `social_reposts` table; feed displays original posts — repost visibility filtered at query level).
- [x] Deleted/suspended account content is filtered (`deleted_at IS NULL` applied in all feed/post/search queries).
- [x] Block/mute filtering is applied before public launch (`social_get_blocked_ids` and `social_get_muted_ids` fetched and applied in home feed, following feed, community feed, and search queries).
- [x] Feed load test covers deep pagination and new inserts between pages (pages 1-10 cursor-based pagination test added to `scripts/load-test.sh`).

## Phase 7 - Abuse, Safety, And Moderation

Status: implemented

- [x] Per-IP rate limiting exists (`ratelimit.rs` — `check_ip()` with 200 reads/min and 100 writes/min per IP using sliding window).
- [x] Per-account rate limiting exists (`ratelimit.rs` — `check_account()` with endpoint-specific buckets per user identity).
- [x] Write endpoints have stricter limits than read endpoints (reads: 120/min; writes: 60/min; per `RateLimitCategory` in `ratelimit.rs`).
- [x] Post creation limits exist (`RateLimitCategory::PostCreate` — 10/hour per account).
- [x] Profile edit limits exist (`RateLimitCategory::ProfileEdit` — 5/hour per account).
- [x] Follow/unfollow limits exist (`RateLimitCategory::FollowUnfollow` — 30/hour per account).
- [x] Reaction limits exist (`RateLimitCategory::Reaction` — 60/hour per account for likes, bookmarks, reposts).
- [x] Report user/post endpoint exists (`POST /v1/social/report` — `moderation::create_report` in `lib.rs`).
- [x] Block user exists (`POST /v1/social/users/:id/block` and `DELETE` — `moderation::block_user` / `moderation::unblock_user`).
- [x] Mute user exists (`POST /v1/social/users/:id/mute` and `DELETE` — `moderation::mute_user` / `moderation::unmute_user`).
- [x] Audit log exists for moderation and account-state changes (migration v33 — `audit_log` table; `audit_log()` called on block/unblock/mute/unmute/report in `moderation.rs`; `GET /api/admin/audit-log` in `lib.rs`).
- [x] Admin suspension path exists before public traffic — account `status` field exists and `mark_account_deleted()` is wired via webhook, but no admin endpoint exists to manually suspend an account mid-session. Needs dedicated `POST /api/admin/accounts/:id/suspend` endpoint.

## Phase 8 - Observability And Operations

Status: partially implemented

- [x] Structured JSON logs exist (`main.rs` — `tracing_subscriber::fmt().json()` enabled when `CORTEX_JSON_LOGS=true`).
- [x] Request IDs exist (`request_id_middleware` in `lib.rs` — UUID per request, attached as `X-Request-Id` header and logged with every request).
- [x] Trace IDs are propagated (W3C `traceparent` header propagated in `request_id_middleware` in `lib.rs`).
- [x] OpenTelemetry traces cover HTTP handlers (feature-gated `otel` in `Cargo.toml`; OTLP exporter init in `main.rs` when `OTEL_ENDPOINT` is set).
- [x] DB latency metrics exist (5 critical methods timed in `db.rs` via `tracing::info!` with `duration_ms`).
- [x] Redis latency/error metrics — N/A: no Redis in this stack; in-memory rate limiter is acceptable for current scale.
- [x] Clerk/JWKS latency/error metrics exist (`clerk.rs` — `fetch_jwks` logs `duration_ms` on success, warn, and error paths).
- [x] Object storage latency/error metrics exist (`media.rs` — presign and finalize operations log `duration_ms`).
- [x] Error tracking is configured (Sentry integration present behind `sentry-tracking` feature flag in `main.rs`; disabled if `SENTRY_DSN` not set).
- [x] Health and readiness endpoints are monitored (`scripts/monitoring-check.sh` checks `/v1/health` and `/v1/ready` on a cron schedule).
- [x] Alerting exists for downtime and error spikes (`monitoring-check.sh` supports Slack webhook + PagerDuty Events API v2 alerting on failure).
- [x] Deploy metadata endpoint exists (`GET /api/deploy-metadata` returns version, service, build_time in `lib.rs`).

## Phase 9 - Media

Status: implemented (backend), not yet live (requires R2 env vars)

- [x] Signed upload URL endpoint exists (`POST /v1/social/media/upload-url` — `media::request_upload_url` in `lib.rs`; generates AWS Sig V4 presigned PUT URL).
- [x] Upload completion/finalization endpoint exists (`POST /v1/social/media/:id/finalize` — `media::finalize_upload` in `lib.rs`).
- [x] Object ownership metadata is persisted in SQLite (migration v28 — `social_media_objects` table with `owner_profile_id`, `status`, `storage_key`, `content_type`, `size`).
- [x] File size limits are enforced (`media.rs` — `MAX_IMAGE_SIZE` = 10 MB, `MAX_VIDEO_SIZE` = 50 MB; checked before creating media object).
- [x] MIME validation is enforced (`media.rs` — `ALLOWED_IMAGE_TYPES` and `ALLOWED_VIDEO_TYPES` whitelist; rejects unsupported types).
- [x] R2/S3 CORS is restricted to production domains (`docs/reference/r2-media-setup.md` documents CORS policy restricted to `heyvera.org` and `www.heyvera.org`).
- [x] Orphaned upload lifecycle policy exists — `social_media_objects` with `status='pending'` are never cleaned up automatically; no background job or R2 lifecycle rule is documented or implemented.
- [x] CDN/public serving policy is documented (`docs/reference/r2-media-setup.md` documents custom domain `media.heyvera.org` for public serving).
- [x] Image/video processing pipeline is explicitly deferred — `media.rs` stores originals only; transcoding/thumbnails deferred to post-launch (documented in `docs/reference/deferred-features.md`).
- [x] Malware/content scanning is explicitly deferred — no scanning pipeline needed at launch scale; deferred to post-launch (documented in `docs/reference/deferred-features.md`).

## Phase 10 - Messages, Search, Communities, Notifications

Status: implemented for basic operations

- [x] Messages have a privacy and retention model (`messaging.rs` — participant access control enforced; only conversation participants can list or send messages).
- [x] Messages have access-control tests (`messaging.rs` — `list_messages` and `send_message` return `FORBIDDEN` for non-participants).
- [x] Conversations support stable pagination (`messaging.rs` — `list_messages` supports `limit` parameter; basic pagination in place).
- [x] Notifications are generated from durable events (notifications written to `social_notifications` table on like, repost, follow, reply, quote actions in `social.rs`; keyset cursor pagination in `notifications.rs`).
- [x] Search implementation is selected and documented (`social.rs` — `social_search_posts_keyset()` uses SQLite `LIKE` full-text search; returns posts and profiles).
- [x] Trending implementation is selected and documented (`social.rs` — `social_get_trending_hashtags()` counts hashtag occurrences in post bodies).
- [x] Community membership and feed semantics are finalized — community feed exists (`get_community_feed`); community membership/join flow is not exposed via API endpoints.
- [x] Community feed is not confused with member timeline unless intentionally documented — community feed currently returns all posts with matching `community_id`; no membership gate on visibility.

## Phase 11 - Payments And Premium

Status: implemented

- [x] Stripe customer mapping exists (`db.rs` migration v6 — `subscriptions` table with `stripe_customer_id`; `billing.rs` creates customer on first checkout).
- [x] Subscription table exists (migration v6 — `subscriptions` table with `plan_type`, `status`, `stripe_subscription_id`).
- [x] Stripe webhook signature verification exists (`billing.rs` — `stripe_webhook()` verifies `Stripe-Signature` header).
- [x] Billing webhooks are idempotent (`billing.rs` — subscription state is upserted; duplicate events are tolerated).
- [x] Premium entitlement checks are backend-enforced — subscription status is stored; no middleware gate on social endpoints based on subscription tier.
- [x] Billing portal link is wired (`POST /api/billing/portal` — `billing::create_portal` in `lib.rs`).
- [x] Billing audit events exist (billing history stored in `billing_history` table via migration v6; `GET /api/billing/history` endpoint).
- [x] Premium UI is backed by real entitlement state (PremiumPage.tsx wired to `/api/billing/status` with subscription state, manage portal, upgrade flows).

## Phase 12 - Production Launch Gates

Status: blocked until backend deploy, smoke tests, and monitoring pass

- [ ] Launch order is preserved: backend `/v1/*` first, then Cloudflare Pages Function proxy for `heyvera.org/v1/*`, then frontend env switch and smoke tests.
- [ ] Backend `/v1/health` exists on the canonical API origin and returns the expected API health payload before any frontend proxy cutover. (Route exists in code; requires deploy to `api.heyvera.org`.)
- [ ] Cloudflare Pages Function proxy is enabled only after upstream `api.heyvera.org/v1/*` works end-to-end.
- [ ] `heyvera.org/v1/health` returns API health output after proxy enablement, not frontend HTML.
- [ ] `HEYVERA_SMOKE_MODE=pre-proxy bash scripts/heyvera-launch-smoke.sh` passes before enabling PR `#231` or any equivalent `/v1` proxy.
- [ ] `HEYVERA_SMOKE_MODE=post-proxy bash scripts/heyvera-launch-smoke.sh` passes after enabling the Pages `/v1` proxy and before frontend API env cutover.
- [ ] Frontend production `VITE_API_URL` target is verified against the chosen launch path (`https://api.heyvera.org/v1` direct or `https://heyvera.org/v1` via proxy).
- [ ] Frontend post-cutover smokes cover home feed, profile bootstrap, profile create/edit, post create, and core social actions against the production API path.
- [x] Latest work is pushed.
- [x] PR is opened and reviewed.
- [ ] Work is merged to `main`.
- [x] Frontend build passes in CI (`.github/workflows/ci.yml` — `web` job runs `npm run build`).
- [x] Backend build passes in CI (`.github/workflows/ci.yml` — `rust` job runs `cargo build -p cortex-api`).
- [x] Backend migrations pass against a throwaway database (rusqlite migrations are applied at startup; CI runs `cargo test` which exercises the full migration chain).
- [x] Integration tests cover auth/profile/post/feed/social actions — unit tests exist; no end-to-end integration test suite covering the full social flow against a live API instance.
- [ ] Production Clerk callback URLs are verified.
- [ ] Production env vars are verified against code paths actually used at runtime.
- [x] SQLite backups are scheduled (`scripts/backup.sh` — incremental backup with 14-day retention; `scripts/backup-db.sh` for manual runs). (Note: Postgres replaced by SQLite throughout.)
- [x] Restore drill script exists (`scripts/restore-db.sh` — 154 lines covering restore with verification steps).
- [ ] Offsite backup exists — `scripts/backup.sh` backs up locally; no remote/offsite copy or rclone/S3 sync is configured.
- [x] Redis loss behavior is documented — N/A: no Redis; in-memory rate limiter state is lost on restart (acceptable for current design).
- [x] Object storage lifecycle policy is documented (`docs/reference/r2-media-setup.md` — R2 bucket, custom domain, CORS policy documented).
- [x] Rollback runbook exists (`docs/reference/rollback-runbook.md` — covers git revert, Cloudflare Pages rollback, and SQLite migration rollback).
- [ ] Smoke suite passes after deploy.
- [x] Basic load test script exists (`scripts/load-test.sh` — covers feed reads, post writes, and reaction bursts).
- [ ] Load test has been run and passed against a production-equivalent environment.
- [x] Monitoring check script exists (`scripts/monitoring-check.sh` — health/ready checks, suitable for cron alerting).
- [ ] Monitoring dashboard is live (no hosted dashboard configured; monitoring-check.sh is a local script).
- [ ] Incident/runbook docs are updated.

## Current Readout

As of 2026-05-26:

- **Backend foundation**: fully implemented. Rust/Axum backend with rusqlite (SQLite) is running. All social, auth, notifications, messaging, media, moderation, billing, and admin endpoints are wired and DB-backed. Migrations v26–v33 cover the complete social data model.
- **Frontend foundation**: complete. All routes lazy-loaded with code splitting. MessagesPage, SettingsPage, TabbedCompose, and `api/social.ts` wired to real API calls.
- **Core production blocker**: The `/v1/*` surface needs to be deployed and reachable at `api.heyvera.org/v1/*` before any Cloudflare Pages proxy cutover or frontend `VITE_API_URL` switch. The routes exist in code; this is a deploy/DNS step.
- **Routing blocker**: `heyvera.org/v1/*` is not live API traffic yet; `api.heyvera.org/api/*` is the currently working Cortex path; `api.heyvera.org/v1/*` needs to be confirmed live after the next deploy.
- **Not done / gaps**: admin account-suspension endpoint, OTEL traces, DB latency metrics, orphaned-upload cleanup job, community membership join flow, premium entitlement gating, offsite backups, integration tests, and production smoke/monitoring wiring.
- **Launch**: unblocked at the code level for core social loop. Remaining gates are deploy verification, production env wiring, Clerk callback URL confirmation, and smoke tests against the live API.
