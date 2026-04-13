# ADR-0002: Deploy Through GitHub Actions

Status: accepted

## Context

Low-friction production work still needs a repeatable, auditable deploy path. Ad hoc server pushes increase drift and reduce trust.

## Decision

Use GitHub Actions as the normal deploy path for ClawNet. Direct server changes are reserved for explicit emergency/manual recovery scenarios.

## Consequences

- PR -> merge -> deploy becomes the standard path
- deploy behavior is easier for humans and agents to follow
- operational truth belongs in repo docs and workflows, not in shell habit
