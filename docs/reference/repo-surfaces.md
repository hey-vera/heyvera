# Repo Surfaces

Status: canonical

ClawNet is a broad runtime/platform repo. That breadth is intentional, but it should still be legible.

## First-Class Surfaces

- `src/`
  - canonical API, runtime, billing, DB, middleware, integrations, and platform logic
- `dashboard/`
  - operator/admin UI for the platform
- `site/`
  - public-facing site assets for the platform
- `scripts/`
  - local/deploy/ops helper scripts that support the runtime
- `docs/`
  - canonical architecture, reference, operations, proposals, and archived material
- `tests/`
  - unit and integration validation of current platform behavior

## Supporting But Non-Canonical Surfaces

- `examples/`
  - demos and usage examples
- `internal/`
  - retained internal or archived support material that should not outrank canonical docs
- `packages/`
  - repo-local package surfaces if needed by the platform
- `private-aid/` and `prover/`
  - specialized sub-surfaces that may support the system, but do not replace the root repo docs as the source of truth

## Rule

If a contributor is trying to understand what ClawNet is today, the canonical path is:

1. `README.md`
2. `docs/overview.md`
3. `docs/reference/repo-system.md`
4. `docs/reference/repo-surfaces.md`

Anything outside that path should not silently redefine the repo's core identity.
