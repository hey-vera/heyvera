# ADR-0004: Foundation-First Mainline Migration

Status: accepted

## Context

ClawNet previously had a long-lived fork reality that diverged from `main`. Continuing that pattern would make deploy truth and implementation truth harder to trust.

## Decision

Move forward on `main` through small, foundation-first PRs that are reviewable, deploy-safe, and aligned with current production reality.

## Consequences

- large fork-era rewrites should not be landed wholesale
- schema, runtime, and integration work should arrive in staged slices
- production truth stays closer to repository truth
