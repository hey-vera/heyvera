# AID-TAP Interoperability Reference

## Visa Trusted Agent Protocol (TAP)

TAP provides cryptographic proof that an agent is Visa-approved. It is **centralized** — Visa onboards and approves agents. AID is **permissionless** — any agent earns trust through behavior.

## Complementary Positioning

| Dimension | TAP | AID |
|-----------|-----|-----|
| Trust source | Visa approval (centralized) | Behavioral scoring (permissionless) |
| What it proves | "Visa vouches for this agent" | "This agent has trust score 87 from 1,247 transactions" |
| Identity | Visa-issued credentials | Self-certifying did:key (Ed25519) |
| Scope | Merchant verification | Agent-to-agent commerce |
| Onboarding | Visa application process | One HTTP call (X-AID-NEW) |

## Interop Model

TAP and AID are complementary, not competitive:
- TAP = "this agent is approved by Visa" (authorization)
- AID = "this agent performs reliably" (reputation)

An agent can carry BOTH a TAP credential AND an AID trust score. Combined = maximum trust signal for merchants.

## No Code Integration Planned

TAP is a closed ecosystem with Visa-controlled onboarding. AID references TAP in the spec for context but does not build a direct integration. If TAP opens APIs for trust data consumption, AID could map TAP approval status as a supplementary verification signal.

## Spec Reference

See AIDplan Section 15.4 for full competitive analysis of TAP vs AID.
