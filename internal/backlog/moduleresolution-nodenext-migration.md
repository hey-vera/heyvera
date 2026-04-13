# Migrate claw-net to `moduleResolution: NodeNext`

## Status
Backlog. Tracks a temporary tsconfig shim introduced in PR #31
(`feat(rotation): add inert ClawNetApiKeyBackend and soma-heart dep`).

## Context
claw-net's `tsconfig.json` uses classic `moduleResolution: node` with
`module: CommonJS`. That resolver was frozen before Node's `exports`
field existed, so it cannot see subpath exports from ESM-only packages.

PR #31 adds a dependency on `soma-heart@0.3.0`, which is `"type":
"module"` and only exposes `./credential-rotation` and `./crypto-provider`
through its `package.json` `exports` field. TypeScript could not resolve
those subpath imports under the classic resolver, so PR #31 added a
`paths` block in `tsconfig.json` that hardcodes the `.d.ts` files the
package's own `exports.types` points at. The shim is type-only —
runtime resolution still goes through Node's real `exports` handling
via `require(esm)` on Node >=22.12.0.

This is **temporary technical debt**, not an acceptable long-term
pattern. It duplicates upstream's declaration inside our repo and
will silently rot if soma-heart reorganizes its `dist/` layout
(typecheck passes against the old path while runtime breaks).

## Trigger for removal
Any one of:

1. A **second** ESM-only dependency lands in claw-net that needs its
   own `exports`-gated subpath — a second shim entry means it is time
   to fix the resolver, not keep duplicating.
2. soma-heart's published `dist/` layout changes, invalidating the
   hardcoded `.d.ts` paths. The `runtime-floor` CI smoke step (also
   added in PR #31) will fail first; at that point do the migration
   instead of re-pinning the shim.
3. claw-net otherwise needs to consume an `exports`-gated package
   and the shim pattern starts to feel load-bearing.

## Exit condition
`paths` block in `tsconfig.json` contains only `@/*` (or is removed
entirely), and `soma-heart/credential-rotation` / `soma-heart/crypto-provider`
resolve purely through Node's `exports` field. The
`runtime-floor` CI smoke step continues to pass unchanged.

## Scope of the migration
Non-trivial but bounded:

1. Flip `tsconfig.json` to `"moduleResolution": "NodeNext"` and
   `"module": "NodeNext"`. Keep `target: ES2022`.
2. Add explicit `.js` extensions to every relative import across
   `src/**` — NodeNext requires them even when emitting CJS. This is
   mechanical but touches many files and must be a standalone PR.
3. Re-run typecheck, build, unit tests, and the `runtime-floor`
   smoke step. Confirm the compiled artifact still loads soma-heart
   under Node 22.12.0 exactly.
4. Delete the `soma-heart/*` entries from `tsconfig.json`'s `paths`
   block. Delete this backlog entry.

## Non-goals
- Do not migrate the whole repo to ESM emit. CommonJS emit + `require(esm)`
  is the chosen interop path; see PR #31 description.
- Do not touch the `runtime-floor` CI job during the migration — it
  is the regression signal that the shim removal is safe.
- Do not fold the migration into an unrelated feature PR. It is
  mechanical churn across every `src/**` file and deserves its own
  review.
