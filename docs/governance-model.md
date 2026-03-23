# AID Trust Formula Governance Model

## Overview

The AID trust scoring formula is the protocol's most sensitive component. Changes to weights, dimensions, or computation logic directly affect every agent's economic position. This document defines how the formula evolves.

## Principles

1. **Transparency** — the formula, weights, and inputs are always public
2. **Advance notice** — 30 days minimum before any formula change activates
3. **Versioned** — every formula change increments the version (v1.0 → v1.1 → v2.0)
4. **Backward-compatible** — minor versions add dimensions; major versions reweight
5. **Deterministic** — same inputs always produce same output (verifiable by anyone)

## Formula Versioning

| Version | Dimensions | Categories | Status |
|---------|-----------|------------|--------|
| v1.0 | 4 (successRate, chainCoverage, volume, manifestAdherence) | 1 (behavioral) | Production |
| v1.1 | 5 (+counterpartyDiversity, recency-weighted) | 1 (behavioral) | Ready |
| v2.0 | 11 (full expansion) | 3 (behavioral, market, community) | Built |

## Change Process

### Minor Version (v1.0 → v1.1)
- **Scope**: Add new dimension, adjust weights within ±5%
- **Announcement**: 30-day notice via `/aid/heartbeat` + SSE `formula_change` event
- **Activation**: Automatic after notice period
- **Rollback**: Automatic if >10% of agents report anomalous score changes

### Major Version (v1.x → v2.0)
- **Scope**: New categories, weight redistribution >5%, structural changes
- **Announcement**: 60-day notice + blog post + DIF notification
- **Activation**: Manual, after community feedback period
- **Rollback**: 7-day rollback window with one-click revert

## Governance Phases

### Phase 1 (Current): Benevolent Dictator
- ClawNet team proposes and activates formula changes
- All changes are announced 30 days in advance
- Formula source code is open source (`@aidprotocol/trust-compute`)
- Anyone can verify by running the published code

### Phase 2 (Month 6+): Advisory Council
- 5-7 member advisory council (community elected)
- Council reviews proposed changes before activation
- Council can delay activation (not veto)
- ClawNet retains final decision authority

### Phase 3 (Month 12+): Community Governance
- Proposal bond: 100 trust points locked for 30 days
- Voting weight: `sqrt(bestAgentScore × monthsActive × log2(counterpartyCount))`
- One operator = one vote (50 agents = 1 vote)
- Quorum: 20% of eligible voters
- Supermajority (67%) required for major version changes
- Whitelisted change types: weight adjustment, dimension addition, threshold changes
- Blacklisted: formula removal, retroactive changes, trust floor removal

## Emergency Changes

For security vulnerabilities in the scoring formula:
1. Immediate patch deployed (no notice period)
2. Post-incident disclosure within 48 hours
3. Community review of the patch within 7 days
4. Rollback if community rejects (supermajority vote)

## Audit Trail

Every formula change is recorded:
- Version number + timestamp
- Changed dimensions/weights (diff)
- Rationale document
- Community feedback summary
- Activation transaction (on-chain timestamp)

Published at: `GET /aid/governance/formula-history`
