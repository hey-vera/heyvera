# ClawNet Architecture Context

Status: canonical

## Role In The System

ClawNet is the production orchestration platform.

It exposes the API, executes workflows, manages credits and payments, and integrates Soma-based provenance and verification into customer-facing runtime behavior.

## Context

```text
Soma (protocol/spec/reference implementation)
  -> defines trust primitives, verification model, and wire-level standards

ClawNet (this repo)
  -> applies those primitives in a production orchestration platform
  -> owns API, runtime, billing, deploy, dashboard, and site

Pulse
  -> product on top of ClawNet
  -> consumes ClawNet capabilities for an X.com marketing agent
```

## Major Internal Surfaces

- API runtime in `src/`
- Dashboard in `dashboard/`
- Marketing/site assets in `site/`
- Operations/deploy scripts in `scripts/`
- Reference and operational docs in `docs/`

## Canonical References

- Repo boundaries: [../reference/repo-system.md](../reference/repo-system.md)
- Runtime details: [runtime.md](runtime.md)
- Soma application in ClawNet: [../reference/soma-integration.md](../reference/soma-integration.md)
