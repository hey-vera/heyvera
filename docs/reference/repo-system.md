# Repo System Map

Status: canonical

This file is the source of truth for cross-repo role boundaries across `Soma`, `claw-net`, and `pulse`.

## Source Of Truth Matrix

| Topic | Canonical Repo | Notes |
|---|---|---|
| Identity / verification protocol | `Soma` | Normative specs, security model, protocol rationale |
| Protocol primitives and package surfaces | `Soma` | `soma-heart`, `soma-sense`, wire/library specs |
| Orchestration platform runtime | `claw-net` | API, runtime behavior, deployable platform |
| Billing / credits / payments | `claw-net` | Product economics and payment flows |
| ClawNet production deployment | `claw-net` | GitHub Actions deploy path, runbook, recovery |
| X.com marketing product behavior | `pulse` | Product model, operator flow, hosted behavior |
| Pulse dependency on ClawNet | `pulse` | Product-specific integration expectations |

## Repo Roles

### Soma

- Protocol and reference implementation
- Public-facing specs and security model
- Canonical home for identity and delegation standards

### ClawNet

- Platform and runtime product
- Private operational center of gravity
- Canonical home for deploy, billing, orchestration, and product API truth

### Pulse

- X.com marketing agent product
- Built on top of ClawNet
- Does not define protocol truth or platform deploy doctrine

## Boundary Rules

- Protocol truth stays in `Soma`.
- Product/runtime truth for the orchestration platform stays in `claw-net`.
- Product truth for Pulse stays in `pulse`.
- Cross-repo ideas should be documented as proposals until they become clearly owned by one repo.
