# Credential Rotation / Soma Rotation Controller / First ClawNet Consumer

Status: proposed

## Problem

ClawNet holds sensitive credentials and wallet-related authority that should be rotatable without losing identity continuity, operational safety, or auditability.

Today, broad brainstorming exists around secure rotation, but the work needs a shaped proposal that can drive protocol decisions in Soma and first-consumer implementation in ClawNet.

## Why Now

- credential and wallet authority are high-risk surfaces
- ClawNet is the first real production proving ground for Soma rotation semantics
- this work touches trust, custody, security, rollback, and production operations
- starting with a shaped proposal is safer than jumping from idea directly into implementation

## Broad Idea

Use Soma to define a credential rotation model that preserves identity continuity while allowing secure authority changes over time.

ClawNet will be the first consumer and testbed.

The system should make it possible to:
- rotate sensitive credentials safely
- preserve continuity of agent identity and authorization history
- produce an auditable record of who authorized rotation and when
- support future stronger proofs, including on-chain or attestation-backed evidence where appropriate

## What 10/10 Looks Like

A 10/10 solution would provide:

- secure credential rotation with minimal operational risk
- clear identity continuity semantics
- explicit authorization and audit trail
- rollback and recovery paths
- production-safe rollout slices
- clean division between Soma protocol truth and ClawNet consumer truth
- a design that can later support stronger attestations without redesigning the model

## Repo Ownership

- protocol truth: `Soma`
- first-consumer integration truth: `claw-net`
- product-specific downstream usage: future consumers
- internal strategy and rough thinking: `claw-net/internal/`

## First Consumer

`claw-net`

## Security / Reliability Requirements

- threat model for unauthorized rotation, partial rotation, replay, and state drift
- rollback path if rotation fails mid-flow
- recovery path if a credential becomes invalid or inaccessible
- auditability for authorization and rotation events
- explicit production-readiness gates before live rollout

## Delivery Shape

1. define Soma-side semantics and trust model
2. define ClawNet first-consumer integration plan
3. define threat model, rollback, and recovery design
4. write any needed ADRs
5. implement in small reviewable slices
6. validate in production-safe rollout stages

## ADR Needed?

- yes

Likely ADR areas:
- Soma owns rotation semantics
- ClawNet as first consumer
- audit/identity continuity model if it changes current boundaries

## Open Questions

- what exactly counts as continuity of identity through rotation
- what should be signed, attested, or anchored
- what minimum viable rotation flow is safe enough for first production rollout
- how wallet authority and non-wallet credentials should differ, if at all
- what is mandatory in v1 versus future-proofing for later phases

## Links

- parent issue: `claw-net/claw-net#32`
- Soma protocol issue: `1xmint/Soma#24`
- related project: `claw-net` org project `Soma + ClawNet + Pulse`
