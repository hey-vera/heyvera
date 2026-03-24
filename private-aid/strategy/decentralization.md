# Strategy — Decentralization Roadmap

> Progressive decentralization plan + accountability.
> Extract from AIDplan Part 5 D.
> Split from AIDplan on March 24, 2026.

## To Extract From AIDplan

- Part 5 D: Why AID's problem is easier than Bitcoin's
- Phase 1: Transparent centralization (publish data, Merkle root on-chain)
- Phase 2: Optimistic trust (OptimisticTrustOracle.sol, fraud proofs, $10 bond)
- Phase 3: Federated trust oracles (3-5 independent operators, Chainlink model)
- Phase 4: Trustless verification (ZK proofs, Noir/SP1/RISC Zero)
- Concrete build plan with costs
- Accountability: decentralizationPhase in heartbeat, auto-publish at Month 9

## Open Concern: R3 — ClawNet Is Still the Only Trust Oracle (RED)

**The problem:** Despite the decentralization roadmap, AID trust scores are currently computed exclusively by ClawNet. All four decentralization phases are deferred. If ClawNet goes down, gets compromised, or acts maliciously, there's no alternative oracle.

**What we've proposed:** Progressive decentralization: Phase 1 (publish data + Merkle root on-chain), Phase 2 (optimistic oracle with fraud proofs), Phase 3 (federated oracles), Phase 4 (ZK proofs).

**Why it's still hard:** Phase 2 only works if someone actually runs a challenger. Phase 3 requires 3-5 independent operators economically motivated — but without a token, what's their incentive? Phase 4 requires circuit development expertise we don't have. Decentralizing trust computation is fundamentally harder than decentralizing transactions because validators must run a complex formula over a large dataset.

**The bootstrap paradox within the paradox:** Even after publishing `@aidprotocol/trust-compute` as open-source, someone must actually RUN it independently against published attestation data. "Anyone CAN verify" doesn't mean "anyone DOES verify." If nobody runs trust-compute independently for 6 months, "trust-minimized" is marketing, not a technical property.

**Verification threshold:** If fewer than 3 independent parties have run trust-compute against published data within 6 months of Phase 1 launch, escalate to RED-CRITICAL.

**What would close it:** Phase 1 (data publication) makes ClawNet auditable. Full decentralization may require a token for oracle incentives, which creates securities risk. Catch-22.

**Blocks:** R2 depends on this (fraud proofs require deterministic scores). O5 depends on this (guardians scored by the system they protect).
