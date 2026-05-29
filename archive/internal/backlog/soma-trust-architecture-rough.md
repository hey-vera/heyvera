# Soma Trust Architecture (Rough Draft)

> **ROUGH DRAFT**
> This document is exploratory and directional. It is intentionally not final.
> Boundaries, module ownership, product packaging, and implementation details may change as the system evolves.

## Purpose

Capture the high-level idea that we may eventually "use Soma for everything" in the trust and identity layer, while keeping the architecture clean enough that ClawNet and product apps still have distinct roles.

This is not a final spec. It is a rough architecture note for future planning.

## Core Idea

Soma should become the core trust substrate across the stack.

That does **not** mean every feature should physically live inside the Soma repo. The stronger model is:

- Soma owns trust, identity, attestation, and continuity
- ClawNet owns policy, enforcement, routing, and verified execution
- apps like Pulse consume the trust system rather than re-implementing it

## Rough Layering

### Soma

Owns:

- identity verification
- continuity verification over time
- behavioral phenotyping
- biometric premium tier
- cryptographic attestation
- device and agent trust signals
- trust-score generation primitives

### ClawNet

Owns:

- allow / challenge / block policy
- access enforcement
- step-up verification triggers
- trusted execution routing
- delegation, custody, payout, and trust-linked action controls
- audit logs and execution history

### Product Apps

Examples: Pulse, future admin panels, operator consoles, partner products.

Own:

- product workflows
- app UX
- action surfaces
- app-specific permissions and business logic

But they should call into Soma- and ClawNet-backed trust instead of inventing their own auth/security models.

## Why This Architecture Is Better Than "Put Everything In Soma"

If everything gets stuffed directly into Soma:

- the product boundary gets blurry
- enforcement and policy logic become tangled with trust primitives
- each app becomes harder to integrate cleanly
- the repo risks turning into a monolith

If Soma stays the substrate:

- the trust engine is reusable
- ClawNet becomes the network/runtime that enforces trust
- product apps stay flexible
- the system can evolve into a true platform

## Long-Term Product Shape

This could eventually create a stack like:

- **Soma Core**: trust, identity, continuity, attestation
- **Soma Heart**: identity-emitting runtime for human or agent actions
- **Soma Sense**: independent verifier and scorer
- **ClawNet**: policy and verified execution network
- **Pulse**: one application built on top of the trust substrate

## Possible "Use Soma For Everything" Interpretation

The right interpretation is:

- every important action checks Soma-backed trust
- not every important action is implemented inside the Soma codebase

Examples:

- SSH/admin access can be gated by Soma trust
- deploy approval can require Soma step-up verification
- agent execution can carry Soma-backed attestation
- marketplace actions can depend on Soma-linked reputation and trust state
- sensitive app actions can require a biometric premium step-up

## Human Root -> Agent Delegation Model

One especially important future path is letting a human become the root trust anchor for delegated agent authority.

That means:

- the human completes the strong identity and trust establishment
- the agent does not impersonate the human
- the agent receives scoped, signed, revocable authority from the human root

This architecture is cleaner than trying to make an agent re-run every human identity ritual on every action.

Instead:

- the human establishes trust once at a high level
- the delegated authority is constrained by policy
- the agent operates inside that authority envelope
- ClawNet enforces whether the delegated action is valid

This could become a major architectural principle for:

- admin and infrastructure automation
- verified agent labor
- treasury and payout delegation
- enterprise operator workflows
- high-trust marketplace actions

## Rough Evolution Path

### Phase 1

- strengthen internal admin and infrastructure workflows with Soma ideas
- add trust hooks and policy interfaces to ClawNet
- keep product apps consuming trust externally

### Phase 2

- introduce verified access flows for admin and privileged actions
- add step-up verification for sensitive operations
- add signed execution receipts for agents

### Phase 3

- formalize Soma as a service layer
- expose trust APIs to apps and partners
- support human identity, agent identity, and continuous session verification as products

## Likely Future Modules

Potential modules that may or may not end up in Soma directly:

- passkey / hardware-key trust module
- biometric step-up module
- device trust and device binding module
- continuous behavioral verification module
- admin-action attestation module
- agent execution attestation module
- policy adapter modules for ClawNet and product apps

## Guardrails

- do not market this as "perfect" or "unbreakable"
- do not collapse enforcement and trust into one unclear blob
- keep independent verification as a hard principle
- keep biometrics optional and high-friction
- treat this document as provisional and expected to change

## Open Questions

- What must stay in Soma vs what should live in ClawNet?
- Should the first wedge be operator/admin security, human app security, or agent verification?
- How much of verified execution belongs in the trust layer vs the network layer?
- Should Soma be sold as a standalone API, or primarily through ClawNet first?
- What is the cleanest boundary between Heart, Sense, and ClawNet policy enforcement?
