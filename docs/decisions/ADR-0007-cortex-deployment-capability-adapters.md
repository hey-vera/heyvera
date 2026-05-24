# ADR-0007: Model Deployments As Cortex Capability Adapters

Status: proposed

## Context

Cortex is intended to be an operations room for agent-controlled software development, not only a chat UI. Production deployments are a central part of that job.

The current Cortex production shape already spans multiple deployment systems:

- GitHub Actions deploys the backend to the VPS
- Cloudflare Pages serves the Cortex frontend
- `api.heyvera.org` is the backend API hostname
- `cortex.heyvera.org` is the frontend app hostname

This split is valid, but it creates drift unless Cortex can inspect and explain the deployment state across systems. Ad hoc CLI use, including Wrangler, would be too powerful and too poorly audited for production agent control.

## Decision

Cortex deployment control will be modeled as capability adapters.

Each adapter exposes named operations with explicit risk class, input schema, approval requirement, audit events, and verification contract. Tools such as Wrangler, Cloudflare API, GitHub Actions API, SSH, systemd, and Caddy are implementation mechanisms behind adapters, not raw user-facing powers.

The first provider family should cover the current Cortex deployment reality:

- GitHub Actions deployment inspection and dispatch
- Cloudflare Pages deployment inspection and verification
- VPS service verification through health/deploy-info endpoints

The first implementation slice should be read-only inspection and verification. Mutating operations should come later behind approval and environment leases.

## Consequences

- Cortex can grow toward agent-controlled deploys without granting broad shell authority by default.
- Wrangler is a valid Cloudflare adapter mechanism, but not a free-form automation surface.
- Deployment actions can be recorded in the operations event log.
- Production deploys, cache purges, DNS edits, env-var changes, and rollbacks must carry explicit risk and approval policy.
- The operations room can show deploy truth across backend, frontend, hostnames, commits, assets, and provider status.
- This extends ADR-0002 instead of replacing it: GitHub Actions remains the normal HeyVera backend deploy path until a safer adapter supersedes it.
