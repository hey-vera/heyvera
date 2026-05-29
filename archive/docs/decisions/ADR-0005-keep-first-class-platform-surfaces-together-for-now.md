# ADR-0005: Keep First-Class Platform Surfaces Together For Now

Status: accepted

## Context

ClawNet is a broad platform/runtime repo with multiple meaningful first-class surfaces, including:

- API/runtime code
- dashboard
- site
- docs
- scripts
- tests
- supporting internal or package surfaces

This breadth can look like sprawl, but splitting a platform repo too early also creates overhead, more cross-repo coordination, and artificial boundaries that may not map to the actual product lifecycle.

## Decision

Keep the current first-class ClawNet platform surfaces together in this repo for now.

Do not split surfaces purely for aesthetics. A surface should be split into its own repo only if it clearly has one or more of the following:

- distinct ownership
- distinct deploy lifecycle
- distinct product identity
- a separate contributor workflow that materially improves when isolated
- enough complexity that staying together actively harms clarity and speed

Until then, the right answer is to keep the surfaces together but document them clearly and keep canonical repo truth easy to navigate.

## Consequences

- ClawNet remains a broad but intentionally documented platform repo
- repo clarity must be maintained through docs, boundaries, and conventions rather than premature repo splitting
- future splitting is still allowed, but only when justified by operational reality rather than discomfort with breadth
