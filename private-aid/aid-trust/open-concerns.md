# AID-Trust — Open Concerns

> Concerns specific to Protocol 1 (trust scoring + identity + verification).
> Extracted from the monolithic open-concerns.md on March 24, 2026.

## RED

### R1: Security Model Is Conjectured, Not Proven [DIF-BLOCKING]
Detection probabilities (p=0.15 Sybil, p=0.95 bust-out) are estimated, not measured. Simulation harness would help but validates the model, not reality. Formal proof may not be achievable. See master open-concerns.md R1 for full detail.

### R2: Deterministic Arithmetic Across Implementations [DIF-BLOCKING]
JS float64 vs Rust f64 vs Python Decimal produce different intermediates. Breaks fraud proofs. Current npm package may already use JS floats that contradict the proposed spec. See master R2.

### R4: DIF Credibility Gap [DIF-BLOCKING]
DIF slides promise simulation results and EigenTrust that aren't built. Must rewrite slides to match what's actually built for AID-Trust. See master R4.

## ORANGE

### O1: All Scoring Parameters Are Empirically Motivated
Every weight (15%, 35%, etc.) and every threshold (0.01, 500 nodes) is a judgment call. No principled derivation. See master O1.

### O2: EigenTrust Convergence Under Adversarial Graphs
EigenTrust is designed but 0% built. Convergence behavior under adversarial structure is unknown. Depends on AID-Receipt for receipt-primary input. See master O2.

### O6: Standard vs Product Race [DIF-BLOCKING]
DIF submission still unchecked. Mnemom ships weekly with ZK proofs. See master O6.

### O7: No External Implementation [DIF-BLOCKING]
Zero external parties running mcp-trust. "One company proposing its own protocol." See master O7.

## YELLOW

### Y2: Base L2 SPOF
Merkle anchoring targets Base only. Dual-chain proposed, not built. See master Y2.
