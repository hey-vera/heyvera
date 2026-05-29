# Soma Continuous Identity And Verified Access

This document captures the long-horizon idea of evolving Soma from a verification layer into a continuous identity and access machine for humans, agents, and high-trust infrastructure.

## Core Thesis

Soma should not be framed as "magic unbeatable login." The stronger and more credible framing is:

- continuous identity verification
- cryptographic and behavioral attestation
- step-up trust for sensitive actions
- independent verification rather than self-attestation

That can become meaningfully stronger than standard passwords, OTP, or even ordinary MFA because trust is not determined only once at login.

## Product Direction

Possible top-line positioning:

> Soma is a continuous identity verification layer for humans and AI agents, combining cryptographic attestation, behavioral phenotyping, biometrics, and risk-based policy enforcement.

This is bigger than authentication alone. It becomes infrastructure for:

- login and session trust
- agent authenticity
- admin action approval
- marketplace trust
- fraud resistance
- step-up verification for sensitive workflows

## Architecture Shape

### Soma Heart

- emits identity and continuity signals
- binds device, operator, or agent context
- can sign execution receipts or challenge responses
- can eventually power privileged-action attestation

### Soma Sense

- verifies Heart output independently
- scores consistency over time
- detects anomalies or drift
- prevents self-verifying trust loops

### ClawNet

- consumes Soma trust state
- enforces policy decisions
- triggers challenge, allow, degrade, or block behavior
- records trust-linked execution history

## Possible Signal Layers

This should stay layered. Biometrics are one signal, not the whole system.

- passkeys or hardware-backed credentials
- device-bound cryptographic keys
- behavioral rhythm and interaction phenotype
- agent behavioral fingerprinting
- biometrics where appropriate
- session continuity and anomaly detection
- contextual step-up challenges for high-risk actions

## Elite Biometric Tier

An "extremist" or premium trust tier could add biometric verification as an optional step-up layer for the highest-value actions.

This should not be marketed as perfect or unbreakable authentication. The right framing is:

- biometric-augmented trust
- elite verified access
- step-up verification for sensitive operations

Why this matters:

- biometrics can raise confidence for operator identity at critical moments
- biometrics are harder to share than passwords or tokens
- biometrics become much stronger when combined with device trust, passkeys, and continuous Soma verification

Guardrails:

- never rely on biometrics alone
- treat biometrics as one premium signal in the trust stack
- reserve biometric step-up for sensitive actions such as treasury movement, infrastructure changes, admin escalation, custody release, or privileged delegation
- make the feature optional and high-friction by design

Possible flow:

1. passkey or hardware-key login
2. Soma Heart continuity verification
3. biometric step-up for high-risk action
4. Soma Sense verifies independent trust state
5. ClawNet enforces allow / challenge / block policy

This gets much closer to a "super elite" access tier without making fake 10/10 claims.

## Verified VPS / Admin Access

Longer term, Soma could gate infrastructure access:

- VPS login attestation
- step-up verification before dangerous commands
- signed admin action receipts
- continuous trust decay or challenge during long-lived sessions

This would be especially interesting for:

- operator SSH access
- admin dashboards
- treasury actions
- key rotation
- production deploy approval

## Verified Agent Execution

ClawNet and Soma could later work together so that:

- agents execute through a trusted Heart
- actions are signed or attested
- Sense verifies continuity and trustworthiness
- ClawNet uses that trust state for routing, delegation, custody, and payout decisions

That creates a path toward:

- trusted agent labor
- auditable delegation
- verifiable execution receipts
- differentiated marketplace trust

## Human-Rooted Delegated Agent Authority

One of the strongest long-term directions is not having the agent "pretend to be the human," but having the agent operate under a high-trust delegated authority model rooted in a verified human identity.

The sequence would be:

1. a human establishes a high-assurance trust root
2. that human authorizes an agent or Heart with scoped permissions
3. the agent acts under delegated authority, not human impersonation
4. Soma and ClawNet continuously verify that the delegation is still valid and still within scope

This is a stronger and cleaner model than ordinary login because:

- the human is the root trust anchor
- the agent has bounded, revocable authority
- the authority can be time-limited, spend-limited, and action-limited
- every sensitive action can carry attestation or a signed delegation chain

Potential factors for the human trust root:

- hardware-backed key
- passkey
- behavioral continuity
- optional premium biometric step-up
- optional high-assurance verification for elite or regulated use cases

The key insight is:

- the human does the high-friction identity work once
- the agent receives signed, scoped authority derived from that trust
- the system verifies the delegation, not fake "human-ness" from the agent

This could become the basis for:

- verified automation
- operator-approved agent actions
- treasury and admin delegation
- sensitive workflow approvals
- machine-executable authority with continuous trust checks

Possible architecture:

- human trust root signs a delegation certificate
- Soma Heart carries the delegated identity and scope
- Soma Sense verifies continuity, drift, and policy conformance
- ClawNet enforces whether the delegated action is allowed, challenged, or blocked

This is a strong candidate for the future "extremist" or elite security mode because it supports both humans and agents without collapsing them into the same identity model.

## Why This Matters

The real moat is not "better MFA." The moat is:

- continuous trust instead of one-time login
- identity for both humans and agents
- cryptographic and behavioral proofs together
- policy enforcement at the application layer

That can support products in:

- enterprise identity
- AI workforce verification
- high-trust marketplaces
- fraud-resistant admin tooling
- custody and payout controls

## Near-Term Translation

Do not try to build the full machine immediately. Near-term practical steps:

1. use Soma to strengthen internal admin and infrastructure workflows
2. add attestation and trust hooks into ClawNet
3. treat biometrics as an optional premium module
4. define policy and step-up flows before trying to make "perfect auth" claims

## Positioning Guardrails

- do not claim "perfect" or "unbreakable" authentication
- do claim stronger continuous verification and higher resistance to spoofing
- keep the message grounded in independent verification, attestation, and trust scoring

## Open Questions

- Should Soma gate only application access first, or also SSH / infrastructure actions?
- Should the first commercial wedge be human identity, agent identity, or both?
- How should step-up trust be priced if used as a service?
- What is the minimum viable Heart/Sense loop for admin action verification?
