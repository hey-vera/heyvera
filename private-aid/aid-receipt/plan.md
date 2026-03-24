# AID-Receipt — Build Plan

> Protocol 2: Dual-Signed Interaction Receipts (DSIRs) + commitment logs.
> Ships AFTER AID-Trust has external adoption.
> The 10/10 plan from AIDplan lives here.
> Split from AIDplan on March 24, 2026.

## What AID-Receipt IS

Bilateral, portable, Merkle-anchored receipts. Both parties sign. Both classify outcome. Selective omission is detectable.

- DSIR format (DualSignedInteractionReceipt)
- OutcomeClassification enum (success, partial, failure, timeout, disputed)
- Dual-party commitment logs (append-only, cross-referenced)
- Bloom filter log summaries (O(1) cross-reference)
- Epoch compaction (30-day Merkle summarization)
- Liveness grace period (0-24h unconfirmed, 24-72h late, >72h omitted)
- Receipt-primary scoring (DSIRs dominate attestations when available)
- Feedback endpoint (POST /aid/feedback — takes receiptId)
- Schema evolution policy (additive minor, 6-month dual-support major)
- EigenTrust on interaction graph (nodes=DIDs, edges=DSIRs)

## What AID-Receipt IS NOT

- Trust scoring formula (that's AID-Trust — AID-Receipt FEEDS it)
- Settlement modes (that's AID-Settle)
- Identity / DID management (that's AID-Trust)

## What's Built (0% code, ~60% spec)

- DSIR CDDL definition written (Part 2 B.1, D.2)
- Trust input hierarchy defined (1.0 → 0.1 weights)
- Commitment log design complete (Part 2 B.4)
- Liveness grace period designed (Part 2 B.5)
- EigenTrust convergence hardening designed (10/10 Day 3)
- Negative test vectors specified (30+)

## What Needs to Be Built (the 10/10 Plan)

### Day 1: DSIR Implementation
- [ ] DualSignedInteractionReceipt interface
- [ ] OutcomeClassification enum
- [ ] Receipt generation in x402 middleware
- [ ] Dual-party commitment logs
- [ ] Receipt commitment log (per-agent, batch Merkle anchor)
- [ ] 5 positive + 10 negative test vectors
- [ ] Bloom filter commitment log summaries (Opus #3)
- [ ] Epoch compaction (Opus #6)
- [ ] hashAlgorithm field for PQC dual-hash (Opus #8)

### Day 2: Receipt-Primary Scoring
- [ ] computeTrustScore() accepts DSIRs as primary input
- [ ] Trust input hierarchy implementation
- [ ] Dispute rate as superlinear integrity signal
- [ ] Backwards compatible (attestations still work)
- [ ] Scoring integration test vectors

### Day 3: EigenTrust
- [ ] EigenTrust iteration (nodes=DIDs, edges=DSIRs)
- [ ] Smooth bootstrap transition
- [ ] Seed rotation every 500 new nodes (Opus #2)
- [ ] Convergence monitoring endpoint
- [ ] Sybil cluster test vectors

### Day 4: Verification APIs
- [ ] GET /v1/aid/:did/receipts — receipt subgraph + proofs
- [ ] Per-service maxTimestampSkew (Opus #7)
- [ ] End-to-end verification test

### Cross-cutting
- [ ] AvoidFlagDeclaration in CDDL (Opus #4)
- [ ] Receipt schema evolution policy (Opus #5)
- [ ] Simulation harness — Monte Carlo (Opus #1)

## Prerequisites

AID-Trust must have:
- At least 3-5 external MCP server operators running mcp-trust
- Real attestation data flowing (not just ClawNet self-transactions)
- Deterministic arithmetic spec finalized

## AIDplan Source Sections

Content to extract:
- Part 2 B (B.1-B.7): Receipts, commitment logs, Merkle snapshots, lifecycle
- 10/10 Plan (Days 1-4): DSIR implementation, receipt-primary scoring, EigenTrust, APIs
- Part 2 D.2: DSIR CDDL definitions
- Part 3 D: Game-theoretic analysis (receipt-dependent parts)
