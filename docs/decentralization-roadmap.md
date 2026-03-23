# AID Decentralization Accountability Roadmap

Public commitment with dates for progressive decentralization of AID trust infrastructure.

## Current State: Transparent Centralization (Phase 1)

ClawNet computes all trust scores. The formula and attestation data are public. Anyone can verify.

**What's decentralized today:**
- Trust formula: open source (`@aidprotocol/trust-compute` on npm)
- Attestation data: queryable via public API
- Verification: offline-verifiable via Ed25519 + Merkle proofs
- Canary: signed liveness proof every 6h (detects outages)

**What's centralized today:**
- Trust score computation (ClawNet is the sole oracle)
- Attestation storage (SQLite on ClawNet's VPS)
- Merkle root generation (ClawNet's snapshot cron)

## Phase 1: Open Verification (Now — Month 6)
**Target: September 2026**

- [x] Open-source `@aidprotocol/trust-compute` (npm, MIT)
- [x] Public trust API (`GET /v1/aid/:did/trust`)
- [x] Protocol canary (6h signed liveness proof)
- [x] Merkle-anchored trust snapshots (4h cron)
- [ ] Publish full attestation dataset to IPFS monthly
- [ ] On-chain Merkle root commitment (Base, ~$0.001/tx, monthly)

**Accountability:** If ClawNet manipulates a trust score, anyone running `@aidprotocol/trust-compute` on the published data can detect the discrepancy. The Merkle root on-chain proves which data set was used.

## Phase 2: Optimistic Fraud Proofs (Month 6 — Month 12)
**Target: March 2027**

- [ ] Deploy `OptimisticTrustOracle.sol` on Base
  - Anyone can challenge a trust score with a $10 bond
  - 24-hour challenge window
  - If challenge succeeds (recomputation shows different score): challenger gets bond back + reward, ClawNet's score is overridden
  - If challenge fails: bond is burned
- [ ] Publish attestation data to Arweave (permanent, immutable)
- [ ] Independent verifier dashboard at verify.aidprotocol.org

**Accountability:** ClawNet can't lie about scores because anyone can prove the lie on-chain and force a correction.

## Phase 3: Federated Trust Oracles (Month 12 — Month 18)
**Target: September 2027**

- [ ] 3-5 independent trust oracle operators
- [ ] Each operator runs `@aidprotocol/trust-compute` on published data
- [ ] Middleware uses median-of-oracles (Chainlink pattern)
- [ ] ClawNet is one oracle among many (not privileged)
- [ ] Operator registration: stake requirement + SLA commitment

**Accountability:** No single operator controls trust scores. The median resists manipulation by any minority of operators.

## Phase 4: Trustless Verification (Month 18+)
**Target: March 2028**

- [ ] ZK proofs of trust score computation (RISC Zero / Noir)
- [ ] Agent carries self-verifying trust proof
- [ ] No oracle needed — pure math verification
- [ ] Cost: <$0.01 per proof

**Accountability:** Trust scores are mathematically provable. No trust in any third party required.

## Commitments

1. **We will not delay these milestones without public explanation.** If a phase is delayed, we publish the reason and revised timeline.

2. **We will not add centralization.** New features default to decentralizable design. If a feature requires centralization, we document why and the plan to decentralize it.

3. **We will publish quarterly progress reports** against this roadmap at `GET /aid/governance/decentralization-status`.

4. **The formula will never be closed-source.** `@aidprotocol/trust-compute` remains MIT-licensed regardless of AID Protocol's governance structure.

## Verification

This document is signed by the AID Protocol platform key and anchored at:
- `GET /aid/governance/decentralization-roadmap`
- `https://github.com/aidprotocol/aid-spec/blob/main/docs/decentralization-roadmap.md`

Last updated: March 22, 2026
