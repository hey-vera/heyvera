# ClawNet Overview

Status: canonical

## Purpose

ClawNet is the runtime product and operational platform for sovereign AI orchestration.

It is the repo where product behavior, deployable infrastructure, API truth, credit economics, and runtime integrations are defined. It is not the canonical home for the Soma protocol itself.

## This Repo Owns

- HTTP API and runtime behavior
- Billing, payments, and credit logic
- Dashboard and site surfaces
- Deployment, recovery, and hardening docs
- ClawNet-specific trust and verification integration
- Product-facing architecture for the platform

## This Repo Does Not Own

- Soma normative specs or protocol philosophy
- Pulse product behavior
- Broad speculative ideas presented as current architecture
- Historical plans treated as current truth

## Related Repos

- `Soma`: protocol, reference implementation, security model, wire/library specs
- `pulse`: X.com marketing agent built on top of ClawNet

## Doc Map

- `docs/architecture/`: current system structure
- `docs/reference/`: factual contracts and source-of-truth docs
- `docs/how-to/`: task-oriented developer/operator guides
- `docs/operations/`: deploy, runbook, hardening, recovery
- `docs/proposals/`: serious future designs that are not yet canonical
- `docs/archive/`: preserved historical material and displaced ideas

## Working Rule

If a document answers "what is true right now in the shipped platform?", it should live in a canonical lane.

If it answers "what might we build?" or "how could this evolve?", it belongs in `docs/proposals/`.

If it is valuable history but should not steer current work, it belongs in `docs/archive/`.
