# ADR-0001: ClawNet Is The Runtime And Platform Home

Status: accepted

## Context

The system spans protocol, platform, and product repos. ClawNet needs a durable statement of what it owns so runtime truth does not drift into the wrong places.

## Decision

`claw-net` is the canonical home for:

- runtime and deploy truth
- platform/orchestration behavior
- billing and operational platform concerns
- production application of Soma in the platform

## Consequences

- downstream product repos should link here for runtime truth
- protocol truth should stay in `Soma`
- ClawNet docs must stay closer to shipped operational reality than to broad vision prose
