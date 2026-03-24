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
- [ ] ScoreResult returns trustVector (5 dimensions) + compositeScore + disputeRate + eigenvectorWeight + computationVersion
- [ ] GET /v1/aid/:did/receipts — receipt subgraph + Merkle proofs + commitment log proof
- [ ] GET /v1/aid/:did/trust — trust vector + composite score + metadata
- [ ] GET /v1/aid/scoring-params — public scoring config (versioned)
- [ ] Per-service maxTimestampSkew in ServiceListing CDDL + heartbeat (Opus #7)
- [ ] End-to-end verification test: pull receipts → run locally → compare to server → match exactly
- [ ] Negative test vectors: non-existent DID (404), revoked DID, malformed DID, NaN dimension, wrong Merkle path, version mismatch (406), >10K results (pagination)

### Day 5: Reputational Staking + Temporal + Security Docs
- [ ] Reputational staking: endorsed agent flagged → endorser's integrity hit, synthetic negative, cascades through EigenTrust
- [ ] Superlinear temporal weight: log2(1 + account_age_days / 30)
- [ ] Second-order independence: overlap between issuer's issuers and subject's issuers → multiplier
- [ ] Guardian precision tracking — correct_freezes / total_freezes, demotion at <0.8, removal at <0.5 (Opus #9)
- [ ] Security docs: verifiable computation property, intuitive security argument (conjectured, not proven), known limitations, "trust-minimized, not trustless"
- [ ] Game-theoretic cost-to-manipulate analysis (Part 3 D)
- [ ] Simulation harness — Monte Carlo 10K agents x 100K rounds, parameterized attacks (Opus #1 — CRITICAL)
- [ ] Negative test vectors: endorser of flagged agent (still takes hit), account_age=0 (weight=0, not negative), account_age=100yrs (capped), circular endorsement A→B→C→A (no infinite cascade), second-order independence=1.0 (near zero multiplier)

### Cross-cutting (applies across all days)
- [ ] Deterministic arithmetic — fixed-point 6 decimal places, integer weights (Opus #16 — CRITICAL)
- [ ] AvoidFlagDeclaration in CDDL — quorum 3 validators, reason enum, evidence, 72h appeal (Opus #4)
- [ ] Receipt schema evolution policy (Opus #5)
- [ ] E2E scenario conformance tests — register → transact → feedback → score → passport → verify (Opus #18)
- [ ] Standalone threat model document — extract vectors into single doc for aid-spec repo (Opus #15)
- [ ] External harness validation — msaleme v3.6.0, rsbasic mesh, Agent Identity WG vectors

### Attestation & Manifest Spec (Full — not yet implemented)
- [ ] Full AttestationRecord interface with EvidenceRecord, IssuerRole, AttestationCategory
- [ ] Canonical serialization (RFC 8785) with null handling + number edge cases
- [ ] Timestamp rules (eventTime ≤ issuanceTime, 30-day max gap, 90-730 day expiry)
- [ ] Evidence types: RECEIPT, ONCHAIN_TX, MERKLE_ROOT, ORACLE_REPORT, SELF_DECLARED, GUARDIAN_AUDIT
- [ ] Issuer diversity requirements + independence scoring
- [ ] Anti-collusion: CliqueDetection, BurstDetection, ReciprocityDetection
- [ ] Full ManifestDeclaration + tiered bonus (5/5/5 = 15% max)
- [ ] Manifest-attestation divergence engine (DIV-001 through DIV-009)

## Prerequisites

AID-Trust must have:
- At least 3-5 external MCP server operators running mcp-trust
- Real attestation data flowing (not just ClawNet self-transactions)
- Deterministic arithmetic spec finalized

## AIDplan Source Sections

Content to extract:
- Part 2 B (B.1-B.7): Receipts, commitment logs, Merkle snapshots, lifecycle
- Part 2 C.5: Feedback loop (takes receiptId — belongs here, not AID-Settle)
- 10/10 Plan (Days 1-5): DSIRs, receipt-primary scoring, EigenTrust, verification APIs, reputational staking
- Part 2 D.2: DSIR CDDL definitions
- Part 3 D: Game-theoretic analysis (receipt-dependent parts)
- Attestation & Manifest spec (comprehensive — from AIDplan post-10/10 section)
