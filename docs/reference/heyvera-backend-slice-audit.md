# HeyVera Backend Slice Audit

Date: 2026-05-25
Branch reviewed: `feat/cortex-billing-ui`
Baseline compared: `origin/main`

## Snapshot

- Branch divergence is high: `HEAD` is `78` commits ahead and `27` commits behind `origin/main`.
- The diff versus `origin/main` is broad: `123` files changed, including large Cortex UI work, Rust API changes, docs, and generated/tooling state.
- The Rust workspace already contains usable foundation pieces, but the current API crate is a `cortex-*` service, not a clean HeyVera production backend slice.

## Branch Divergence Risk

- This branch is not backend-foundation-only. It mixes frontend, docs, agent/tooling files, and Rust API work.
- `origin/main` has continued moving on Cortex task-manager/backend surfaces, so starting backend foundation on top of this branch increases merge friction immediately.
- The current merge base is `bb5517f`, which means the branch is missing recent `main` behavior that may matter if any backend work touches shared Rust API files.

Assessment: do not treat this branch as the safe place to open the first backend foundation PR. Start from fresh `main` or re-slice the work onto a new branch from `main`.

## PR Readiness

Current branch status from a backend-start perspective:

- Not PR-ready for a backend foundation slice.
- Acceptable only as reference material for contracts/docs and for inspecting existing Rust code patterns.
- Unsafe as an automatic merge candidate because the change set is too mixed and is already behind `main`.

Recommended PR shape:

- PR 1: backend foundation only, cut from current `main`
- keep it narrow: runtime bootstrap, config, DB wiring, migrations, auth boundary, health, and one small HeyVera-owned profile slice
- no frontend polish, no Cortex UI work, no unrelated tooling churn

## Existing Crates And API Constraints

## Workspace facts

- Root workspace members: `crates/core`, `crates/engine`, `crates/api`, `crates/worker`, `crates/soma`, `crates/soma-crypto`, `crates/soma-core`
- Existing HTTP service crate: [`crates/api/Cargo.toml`](/home/runner/workspace/crates/api/Cargo.toml)
- Existing router: [`crates/api/src/lib.rs`](/home/runner/workspace/crates/api/src/lib.rs)
- Existing DB layer: [`crates/api/src/db.rs`](/home/runner/workspace/crates/api/src/db.rs)
- Existing runtime state: [`crates/api/src/state.rs`](/home/runner/workspace/crates/api/src/state.rs)

## Constraints that matter

- The API crate already uses `axum`, which matches the ADR.
- The persistence layer does not match the ADR. It currently uses `rusqlite` and a local `.cortex/cortex.db`, with handwritten SQLite migrations inside application code.
- The runtime defaults are local/single-user biased in places:
  - local DB path under workspace state
  - local ledger files
  - auth fallback to `"local"` when `CLERK_SECRET_KEY` is absent
- The route surface is broad and Cortex-specific (`/api/runs`, `/api/route`, `/api/ws`, billing, integrations, admin, mission control). It is not aligned to the HeyVera frontend contract documented in [`docs/reference/heyvera-backend-api-contract.md`](/home/runner/workspace/docs/reference/heyvera-backend-api-contract.md).
- The existing tests validate Cortex orchestration behavior and local app wiring, not a HeyVera production backend contract.
- The accepted backend ADR requires `sqlx`, Postgres, Clerk-backed identity mapping, Redis only as support infra, and OpenTelemetry. Those are not the current storage/observability defaults in the Rust API crate.

## Practical reading of the current crates

- `crates/soma`, `crates/soma-core`, and `crates/soma-crypto` look reusable as supporting protocol/identity libraries.
- `crates/core`, `crates/engine`, and `crates/worker` are Cortex-domain crates. They should not define the first HeyVera product backend boundary unless the goal is explicitly to ship Cortex behavior.
- `crates/api` is useful as an Axum reference and as a source of Clerk/Soma integration patterns, but it is not a clean production foundation to extend in-place without re-scoping.

## Recommended Next Implementation Order

1. Cut a fresh backend-foundation branch from `origin/main`.
2. Keep the first PR backend-only and separate from `feat/cortex-billing-ui`.
3. Decide the runtime boundary explicitly:
   - either a new HeyVera-focused API crate
   - or a very tightly scoped refactor plan for `crates/api` that does not drag Cortex routes into the first foundation slice
4. Add production foundation primitives first:
   - `sqlx`
   - Postgres connection/config
   - migrations
   - environment loading and startup validation
   - OpenTelemetry baseline
5. Add HeyVera identity ownership:
   - Clerk token verification
   - HeyVera-owned user/profile mapping tables
   - no local-auth fallback in production code paths
6. Implement the thinnest contract slice from the existing backend API doc:
   - `GET /me/profile`
   - `POST /me/profile`
   - `PATCH /me/profile`
   - health/readiness endpoints
7. Only after that, add feed/social surfaces and any background/support infrastructure.

## Must Not Be Merged Automatically

- Do not auto-merge this branch as the backend foundation PR.
- Do not auto-merge any PR built on top of this branch without first reconciling with current `main`.
- Do not auto-merge a foundation PR that keeps `rusqlite` / `.cortex` local files as HeyVera production truth.
- Do not auto-merge a PR that claims ADR alignment while still missing `sqlx`, Postgres, and telemetry baseline.
- Do not auto-merge broad mixed slices that combine backend foundation with frontend polish, generated state, or unrelated Cortex work.

## Verification Notes

- Verified by reading current branch code and docs plus comparing Git history against `origin/main`.
- I could not run `cargo check` in this environment because `cargo` is not installed here, so compile status is unverified from this session.
