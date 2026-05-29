# ADR-0006: Soma Credential Rotation — First-Consumer Gate 7 Scope

Status: accepted

## Context

Soma completed Gates 2–6 of its credential-rotation readiness work
(Soma `ADR-0004-credential-rotation-semantics.md`, cross-referenced in
Soma issue #24 and PRs #35/#36/#37/#38/#39). The accepted Soma artifacts
are the fixed inputs for any ClawNet first-consumer work:

- `SOMA-ROTATION-SPEC.md` — rotation semantics, §4.8 `effectiveAt`,
  §5.2 rollback invariant, §10.1/§10.2 snapshot versioning.
- `SOMA-DELEGATION-SPEC.md` Rotation Interaction — historical-credential
  lookup code contract.
- `soma-heart@0.4.0` package surface — `CredentialRotationController`,
  `CredentialBackend` interface, `lookupHistoricalCredential`,
  `RotationEvent.effectiveAt`, `SNAPSHOT_VERSION`, `ControllerSnapshot`,
  the four `HistoricalCredentialLookup*` types, and the existing error
  class surface.

ClawNet owns first-consumer integration truth per
[ADR-0003](./ADR-0003-cross-repo-source-of-truth.md). This ADR pins the
scope and constraints of that first-consumer work — referred to here
as **Gate 7** to match the readiness-gate language in Soma's ADR-0004.

The current ClawNet rotation foundation is two merged, inert PRs:

- **#30** — SQLite migration v1 for `api_key_rotation_credentials` and
  `api_key_rotation_identities` tables plus a `src/db/` barrel.
- **#31** — `ClawNetApiKeyBackend` (`src/core/api-key-rotation.ts`)
  implementing `CredentialBackend` against those tables, a
  `soma-heart ^0.3.0` dependency, a `tsconfig.json` `paths` shim for
  subpath type resolution under the classic resolver, and a
  `runtime-floor` CI job pinned to Node 22.12.0 that asserts the built
  CJS artifact can `require(esm)` soma-heart.

Nothing in the request path imports the backend. `src/middleware/auth.ts`
is untouched. No `CredentialRotationController` is instantiated. The
backend is a library exercised only by its own unit tests.

Several internal docs describe further work that is **not** in the tree
and must not be treated as source of truth:

- `internal/active/rotation-battle-test-and-roadmap.md` — audit findings
  (P0/P1/P2) and references to files (`src/core/rotation-adoption.ts`,
  middleware shadow-check wiring, `tests/unit/api-key-rotation-middleware.test.ts`)
  that do not exist on `main`.
- `internal/active/gameplan-post-1-1.md` — sequencing plan referencing
  wallet rotation in Phase D.
- `internal/backlog/credential-rotation-architecture.md` and
  `internal/backlog/wallet-rotation-architecture.md` — earlier design
  brainstorms, some partially superseded by Soma's accepted semantics.

These are **context only**. Any salvaged material that Gate 7 intends
to land must go through an evidence ledger per `AGENTS.md` before being
treated as build-ready.

## Decision

### 1. Soma semantics and `soma-heart@0.4.0` are fixed inputs

Gate 7 must not change Soma rotation semantics, `SOMA-ROTATION-SPEC.md`,
`SOMA-DELEGATION-SPEC.md`, or the `soma-heart@0.4.0` package surface.
If Gate 7 work surfaces a possible Soma semantics issue, it is recorded
as a separate follow-up (Soma issue or proposal) and Gate 7 halts until
the issue is classified as non-blocking. This ADR does **not**
pre-authorize any change to Soma artifacts.

This follows [ADR-0003](./ADR-0003-cross-repo-source-of-truth.md): Soma
owns protocol truth, ClawNet owns first-consumer integration truth.

### 2. Gate 7 is blocked on `soma-heart@0.4.0` publish

Publish is a hard blocker for every Gate 7 code slice from G7.1 onward.
The publish state at the time of this ADR:

- npm registry `latest` for `soma-heart` is `0.3.0`.
- No `soma-heart-v0.4.0` git tag exists on Soma `master` (Soma's
  `publish-packages.yml` is tag-triggered on `soma-heart-v*` with a
  version guard).
- ClawNet `package.json` declares `"soma-heart": "^0.3.0"`. npm caret
  semver on 0.x versions does **not** admit 0.4.0 automatically; an
  explicit `package.json` edit is required to consume the new surface.

No Gate 7 code slice may open until the publish blocker is cleared and
`soma-heart@0.4.0` is observable on the npm registry. The operator
publish checklist in §10 is the gating procedure.

### 3. Gate 7 scope

Gate 7 covers **only** first-consumer adoption and shadow-check
planning for `ClawNetApiKeyBackend`, all flag-gated with default-off
feature flags and a documented kill-switch:

- **Adoption path** — a transactional wrapper that takes an existing
  legacy `cn-…` bearer in `api_keys`, mints an inert rotation
  credential, and records the pairing in a new migration v2 table.
  Unit-tested only. Not wired into middleware.
- **Shadow-check middleware** — a read-only consult-and-compare of the
  rotation backend alongside the legacy `api_keys` lookup in
  `src/middleware/auth.ts`. Counter metrics only. **Never** accepts or
  rejects a request based on rotation's say-so. Flag-gated; must skip
  env keys and delegated child keys.
- **Dependency bump** — `package.json` `^0.3.0` → `^0.4.0` plus
  lockfile refresh. No functional change. Blocked on publish.

All three slices are default-off, kill-switchable without a redeploy,
and are the full extent of Gate 7.

### 4. Explicit exclusions

The following are **out of Gate 7** and must be tracked separately:

- **Authoritative cutover.** The legacy `api_keys` path remains the
  only path that accepts or rejects a request. Gate 7 never flips the
  cutover flag, even on canaries.
- **Admin mint endpoint.** Direct minting of rotation credentials via
  an authenticated admin route, rate-limiting thereof, and the
  associated `/v1/admin/rotation/*` surface.
- **Wallet rotation.** EOA / smart-contract / threshold-signing
  wallet-rotation work, including the Phase-D sequencing in
  `internal/active/gameplan-post-1-1.md`.
- **Historical-lookup grace-window enforcement.** Consumption of
  `controller.lookupHistoricalCredential(identityId, key)` and its
  `effectiveFrom` / `effectiveUntil` window in the verify path.
- **Production rollout.** Any non-canary enable of the shadow-check
  flag in production, and the operator go/no-go ceremony for that
  enable, is explicitly post-Gate-7.

### 5. Snapshot persistence — deferred, with a bright-line trigger

Snapshot persistence (`controller.snapshot()` to disk and boot-time
`restore()`) is **deferred** within Gate 7 because every Gate 7 slice
is non-authoritative and controller state is process-memory only. A
process crash during Gate 7 loses shadow-check counters, never a
request decision.

**Bright-line trigger for undeferring.** If any slice later becomes
authoritative, or if durable controller state outlives a single
process, snapshot v2 persistence and the associated operator runbook
become **required prerequisites**, not optional work. The runbook must
cover:

- `SNAPSHOT_VERSION` (`2`) and `ControllerSnapshot` type usage on the
  `soma-heart@0.4.0` surface.
- `§10.1` fail-closed behavior on version mismatch — versions are not
  silently migrated. Operator action on mismatch is clean-boot plus
  re-snapshot from a running process, not in-place migration.
- Encrypted-at-rest storage path, separate from the existing
  `CREDENTIAL_VAULT_KEK` path if appropriate.
- Verified kill-switch that returns claw-net to the legacy `api_keys`
  path without needing a successful restore.

Gate 7 does not land any of this. It lands the constraint that the
trigger exists.

### 6. Adoption constraints (candidate flow, not locked)

The adoption path is named here only by its constraints. Exact
`controller.incept` mechanics, bearer-override plumbing, and any
`stagedRotation` concurrency resolution are **not** locked in this
ADR and must be reviewed in the G7.2 implementation PR. The
constraints Gate 7 must satisfy:

- **Transactional.** The full `adoptExistingBearer → controller.incept
  → INSERT adoption` sequence must be a single DB transaction with
  rollback on any throw. No partial adoption rows.
- **Idempotent per bearer.** Re-running adoption on an already-adopted
  bearer must be a no-op, not a duplicate mint.
- **Bearer format preserved.** The minted rotation credential must
  produce a bearer that matches ClawNet's existing `cn-[a-f0-9]{48}`
  format so that no customer-visible bearer string changes at cutover
  time. The existing `mintBearerToken` helper in
  `src/core/api-key-rotation.ts` already enforces this.
- **No bypass of the legacy path.** Until cutover, the legacy
  `api_keys` row for the same bearer remains authoritative. Adoption
  rows are reference-only.
- **AAD contract preserved.** `src/core/vault-crypto.ts`'s
  `nextSecretAad()` format and the credential-row `AAD = credentialId`
  contract from PR #31 are non-negotiable without a matching
  data-migration. Gate 7 does not renegotiate them.
- **No concurrent-adoption split-brain.** The transaction must
  serialize concurrent adoptions for the same bearer.

The battle-test doc's P1.1 and P1.2 (shared `pendingAdoptBearer` slot,
long-term `bearerOverride` shim) are context for the design review,
not decisions made by this ADR.

### 7. Shadow-check constraints

- Read-only. Never mutates rotation state on the hot path.
- Runs only after the legacy `api_keys` path has already accepted or
  rejected the request.
- Produces counter metrics only. Never logs bearer bytes.
- Skips env keys and delegated child keys per the battle-test doc's
  P1.6, but only as a design constraint — the final skip list is
  reviewed in G7.3.
- Must degrade to a pure no-op when the feature flag is off, with
  **zero** rotation-backend calls issued on that path.
- Must be kill-switchable by flipping an env var at the next request
  boundary without a redeploy.

### 8. Import discipline and the NodeNext migration trigger

All Gate 7 imports of Soma rotation types and runtime must use the
`soma-heart/credential-rotation` and `soma-heart/crypto-provider`
subpaths. **Gate 7 must not import from `'soma-heart'` top-level.**

Reason: `internal/backlog/moduleresolution-nodenext-migration.md`
documents the `tsconfig.json` `paths` shim introduced in PR #31 as
temporary technical debt. Its removal trigger is "a second
`exports`-gated subpath needs a shim entry". Adding a top-level
`soma-heart` entry to the shim would trip that trigger inside Gate 7
and force a repo-wide resolver migration (NodeNext flip + explicit
`.js` extensions across every relative import under `src/**`) as
collateral scope. That migration is its own standalone PR and is not
part of Gate 7.

The `soma-heart@0.4.0` top-level re-exports of `SNAPSHOT_VERSION`,
`ControllerSnapshot`, and the four `HistoricalCredentialLookup*` types
are also available from the `soma-heart/credential-rotation` subpath
unchanged. Gate 7 uses the subpath path for every one of them.

### 9. Gate 7 PR slicing

Gate 7 ships as four sequential PRs. **G7.0 is this ADR.** G7.1
through G7.3 are blocked on the publish checklist in §10.

| # | Title | Scope | Gate |
|---|---|---|---|
| G7.0 | `docs: ADR-0006 — soma rotation first-consumer gate 7 scope` | This ADR. Docs-only. | can land before publish |
| G7.1 | `chore(deps): bump soma-heart 0.3.0 → 0.4.0` | `package.json` + `package-lock.json` only. Verifies typecheck, unit tests, `runtime-floor` CI on the new lockfile. No functional change. | blocked on §10 |
| G7.2 | `feat(rotation): migration v2 + transactional adoption path` | New `api_key_rotation_adoption` table with forward + rollback SQL, `src/core/rotation-adoption.ts` satisfying §6, unit tests only. Feature flag default-off. | blocked on G7.1 |
| G7.3 | `feat(auth): rotation shadow-check in middleware` | `src/middleware/auth.ts` consult-and-compare path satisfying §7, counter endpoint, HTTP integration test. Feature flag default-off. Concludes Gate 7. | blocked on G7.2 |

Snapshot persistence, admin mint, historical-lookup grace-window, and
authoritative cutover are all post-Gate-7 and do not appear in this
table.

### 10. Operator publish checklist — prerequisite for G7.1

Before G7.1 opens, a ClawNet operator verifies on the Soma side:

1. **Tag push.** An operator has pushed the tag `soma-heart-v0.4.0`
   to Soma `master` at the squash commit for Soma PR #39
   (`3ff6e17942aa956f924ca5ece8b928c278160832`).
2. **Workflow completion.** Soma's `publish-packages.yml` ran to
   completion on the tag push with:
   - version guard passed (tag matches `packages/soma-heart/package.json`),
   - `lint`, `typecheck`, `test`, and `build:packages` steps green,
   - `npm publish` of `soma-heart` succeeded under the `npm-release`
     environment with provenance attestation emitted.
3. **Registry observability.** `npm view soma-heart versions` shows
   `0.4.0` and `npm view soma-heart dist-tags.latest` resolves to
   `0.4.0`.
4. **Cross-repo confirmation.** The claw-net runtime-floor CI job on a
   scratch branch with the bumped dep passes at Node 22.12.0 —
   i.e. `require(esm)` of 0.4.0 from the built CJS artifact loads
   cleanly.

Only after all four steps are satisfied may G7.1 open.

If step (4) fails, Gate 7 halts and the failure is investigated before
any further slice. A runtime-floor failure most likely indicates either
a soma-heart 0.4.0 `dist/` layout shift that invalidated the tsconfig
`paths` shim, or a Node 22.12.0 `require(esm)` regression — both of
which are Gate 7 blockers, not Gate 7 edits.

## Consequences

- Gate 7 is tightly scoped and cannot drift into authoritative cutover,
  admin surfaces, wallet rotation, or production rollout without a
  follow-up ADR.
- No Soma artifact changes inside Gate 7. If a Soma semantics issue is
  surfaced, it is recorded as a separate follow-up and Gate 7 halts
  until the issue is classified non-blocking.
- The `tsconfig.json` `paths` shim from PR #31 survives the Gate 6
  surface bump because Gate 6 is additive + re-export-only; the shim's
  hardcoded paths (`./node_modules/soma-heart/dist/heart/credential-rotation/index.d.ts`
  and `./node_modules/soma-heart/dist/core/crypto-provider.d.ts`) still
  resolve under `soma-heart@0.4.0`. The NodeNext migration backlog
  entry is not actioned by Gate 7.
- The G7.0 ADR can land before publish; every code slice is explicitly
  gated behind the §10 checklist.
- Gate 7 concludes with a flag-gated default-off shadow-check. It is
  **not** a production rotation cutover. That milestone is tracked
  separately.
- The Gate 7 evidence ledger for any salvaged material (e.g. the
  `rotation-adoption.ts` draft referenced in
  `internal/active/rotation-battle-test-and-roadmap.md`) is written at
  the time the material is lifted into a Gate 7 PR, not pre-emptively
  in this ADR.
