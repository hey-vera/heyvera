# ClawNet

ClawNet is the sovereign orchestration platform in this system.

It turns natural-language requests into paid, verified execution flows. In practice, ClawNet is the product/runtime layer that sits between the Soma protocol and downstream products like Pulse.

## Repo Role

- Owns the ClawNet API, billing, orchestration runtime, dashboard, site, deploy workflow, and operational truth.
- Integrates Soma in production, but does not own the canonical Soma protocol or spec docs.
- Acts as the system center of gravity for the private `claw-net` product stack.

## System Position

- `Soma` defines identity, verification, delegation, and related protocol primitives.
- `claw-net` applies those primitives in a production orchestration platform.
- `pulse` consumes ClawNet as a product built on top of it.

The canonical cross-repo boundary map for this stack lives in [docs/reference/repo-system.md](docs/reference/repo-system.md).

## Quick Start

```bash
npm install
npm run dev
```

Useful commands:

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run test:unit`
- `npm run mcp`

## Docs

- Repo overview: [docs/overview.md](docs/overview.md)
- Architecture: [docs/architecture/context.md](docs/architecture/context.md)
- Runtime details: [docs/architecture/runtime.md](docs/architecture/runtime.md)
- Billing reference: [docs/reference/billing.md](docs/reference/billing.md)
- Repo surfaces: [docs/reference/repo-surfaces.md](docs/reference/repo-surfaces.md)
- Soma integration: [docs/reference/soma-integration.md](docs/reference/soma-integration.md)
- Local development: [docs/how-to/local-dev.md](docs/how-to/local-dev.md)
- Release workflow: [docs/operations/release.md](docs/operations/release.md)
- Runbook: [docs/operations/runbook.md](docs/operations/runbook.md)
- Proposals: [docs/proposals/README.md](docs/proposals/README.md)
- Archive: [docs/archive/README.md](docs/archive/README.md)

## Boundaries

What belongs here:

- Orchestration behavior
- ClawNet API contracts
- Credits, billing, and product economics
- Production deployment and recovery docs
- ClawNet-specific application of Soma

What does not belong here:

- Canonical Soma protocol specs
- Pulse product docs
- Generic ecosystem strategy presented as current product truth
