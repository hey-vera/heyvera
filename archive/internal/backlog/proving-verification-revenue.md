# Proving & Verification as Revenue — the Second Moat

**Status:** Rough thesis, needs tweaking with real data after prover is running on VPS.
**Date:** 2026-04-08
**Depends on:** Nova prover running in production, $CLAWNET token, heartbeat-fraud-proofs.md (active/)

---

## The Thesis

Trust queries are the primary moat (unique data + oracle intelligence). Proving/verification infrastructure is the **second moat** (compute + hardware + optimization).

Three compute workloads create three revenue streams:

### 1. Proving (expensive, ongoing)

Nova IVC folding + Groth16 compression for every agent in the network.

| Network Size | Folds/Day | Cores Needed | RAM |
|---|---|---|---|
| 1K agents | 100K | <1 | ~4GB |
| 100K agents | 10M | ~10 | ~60GB |
| 1M agents | 100M | ~100 | ~400GB |

Every fold produces real value (provable agent history). Zero wasted work. Scales linearly — add servers, handle more agents.

**Revenue:** Per-fold and per-compression fees for external networks. Free for ClawNet providers (the lock-in).

### 2. Verifying (cheap per-unit, massive at volume)

Checking Groth16 proofs are valid. ~5ms per verification. On-chain: ~250K gas on Base.

**Revenue:** Per-verification fees, or bundled into trust query pricing.

### 3. Monitoring/Challenging (the "mining" mechanic)

Already designed in `active/heartbeat-fraud-proofs.md` (Section 5: Verification Stipends).

- 1% of computation fees fund a verification pool
- Verifiers randomly assigned computations to re-check
- Paid regardless of whether fraud found (solves verifier's dilemma)
- Catch fraud = earn bounty (60% of slashed bond)

This is "Bitcoin mining but useful" — spend compute to verify agent proofs, earn rewards.

---

## Revenue Architecture (extended)

```
For ClawNet providers:
  Routing:                    FREE
  Proving (Nova/Groth16):     FREE (included — this is the lock-in)
  Trust queries from callers: PAID (0.01-0.10 credits)

For external networks:
  Proving-as-a-service:       PAID per fold/compression
  Verification-as-a-service:  PAID per proof check
  Trust oracle queries:        PAID (same pricing)
```

$CLAWNET token demand = trust queries + proving fees + verification staking + bond staking

---

## Evolution Path

**Phase 1 (now):** ClawNet runs proving centrally. Prover binary on VPS. Agents get proofs automatically.

**Phase 2 (post-PMF):** Open verification stipend network. Anyone stakes $CLAWNET to become verifier. ClawNet runs best nodes but others participate.

**Phase 3 (scale):** Proving becomes infrastructure business. Optimized hardware. External networks pay ClawNet to prove their agents.

**Phase 4 (ecosystem):** Self-sustaining. Stipends fund verifiers, bounties fund fraud detection, bonds fund disputes.

---

## Comparison to Bitcoin Mining

| | Bitcoin Mining | Soma Proving/Verifying |
|---|---|---|
| Work | Find nonces (useless) | Generate/verify proofs (useful) |
| Scaling | Difficulty arms race | Linear with agents |
| Revenue | Block rewards (deflationary) | Fees (grows with network) |
| Entry | ASICs ($10K+) | Server + stake ($100s) |

---

## Why ClawNet Wins This

1. Already has the prover binary (Rust, arkworks, folding-schemes)
2. First-mover in optimization
3. Proving requires deep crypto engineering — hard to replicate
4. Economies of scale (one optimized stack serving many agents)
5. "Join ClawNet = free proofs" is a powerful lock-in

---

## Open Questions

- Pricing per fold / per compression — need real cost data from VPS
- Should external proving be priced in credits or $CLAWNET directly?
- At what scale does dedicated proving hardware (GPU acceleration) make sense?
- How to prevent verification network centralization (ClawNet running all verifiers)?
- Integration with heartbeat fraud proofs challenge system — same token or separate?

---

## Cross-references

- `active/heartbeat-fraud-proofs.md` — the verification stipend + challenge system design
- `active/revenue-architecture.md` — current golden plan (extend, don't replace)
- `backlog/token-architecture.md` — $CLAWNET token design (staking for verification eligibility)
- `backlog/composite-agent-trust.md` — delegation dimension that generates more proving demand
