# ADR-0003: Cross-Repo Source-Of-Truth Boundaries

Status: accepted

## Context

ClawNet sits between `Soma` and `pulse`. Contributors need a durable rule for what truth lives here versus upstream or downstream.

## Decision

Use the following split:

- `Soma`: protocol and reference package truth
- `claw-net`: runtime/platform/deploy truth
- `pulse`: product-specific truth

## Consequences

- ClawNet docs should not redefine Soma semantics
- Pulse should not redefine ClawNet runtime truth
- cross-repo references become clearer and less duplicative
