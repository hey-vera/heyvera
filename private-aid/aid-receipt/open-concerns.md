# AID-Receipt — Open Concerns

> Concerns specific to Protocol 2 (DSIRs + commitment logs).
> Full text lives here. Master file (docs/open-concerns.md) is the index + dependency map.
> These concerns are DEFERRED until AID-Trust has adoption. Documented but not actively monitored.
> Updated: March 24, 2026.

---

## ORANGE

### O2: EigenTrust Convergence Under Adversarial Graphs

**The problem:** EigenTrust assumes the interaction graph has a large spectral gap. Real agent networks may not — especially early on with <500 nodes, or under Sybil attack where adversarial structure is designed to degrade convergence.

**What we've proposed:** Smooth bootstrap transition, convergence fallback to direct scoring (v1.0) if delta > 1e-6 after 50 iterations, spectral gap monitoring.

**Why it's still hard:** The fallback to v1.0 silently loses Sybil suppression — exactly when needed most. The spectral gap threshold (0.01) and seed rotation interval (500 nodes) are empirically chosen (same problem as O1).

**Current status:** Entire EigenTrust implementation is unchecked in the plan. Designed but **not built or tested**.

**The deeper issue:** EigenTrust was designed for P2P file sharing (Kamvar 2003), not financial commerce. Commerce attackers perform well for months then defect. EigenTrust has no temporal dimension. The interaction between graph weights and exponential decay is unexplored territory.

**What would help:** Run EigenTrust on synthetic adversarial graphs (part of the simulation harness). If convergence fails on plausible attack topologies, need a different graph algorithm.

---

### O3: Commitment Log Completeness Depends on Cooperation

**The problem:** Dual-party commitment logs make selective receipt omission detectable. But detection requires cross-referencing BOTH parties' logs. If one party goes offline permanently, their log is lost. If both collude, they can jointly omit a receipt.

**What we've proposed:** Bloom filter summaries (O(1) cross-reference), epoch compaction (storage bounds), liveness grace period (0-24h unconfirmed, 24-72h late, >72h omitted).

**Why it's still hard:** Liveness penalties (0.9x for late, 0.5x for omitted) are empirically chosen. A server with 99.9% uptime still has ~8.7h downtime/year — enough for multiple "late" entries. The system punishes reliability failures and malicious omission with the same mechanism.

**The deeper tension:** Strong completeness requires on-chain anchoring of EVERY receipt (~$0.001 each at scale). Weak guarantees leave omission windows. Current design is a compromise, not a solution.

---

### O7 (Receipt-specific): DSIR Chicken-and-Egg

**The problem:** DSIRs require TWO implementations. Currently only ClawNet exists. Until a second party counter-signs, every "dual-signed" receipt is really "ClawNet signed both sides."

**Why it's hard:** This isn't a build problem — the code works. It's an adoption problem that undermines the core technical claim. The completeness guarantee (O3) depends on independent commitment logs. If ClawNet runs both logs, the guarantee is meaningless.

**What would help:** Protocol 1 adoption first. When 3-5 MCP servers run `mcp-trust`, any of them could be upgraded to generate counter-signatures. DSIR becomes viable only when AID-Trust has ecosystem traction.

---

## YELLOW

### Receipt Format Lock-In Risk

**The problem:** Once DSIRs are adopted by external parties, the format becomes very hard to change. Schema evolution policy (additive minor, 6-month dual-support major) mitigates but doesn't eliminate. Early format decisions are high-stakes.

**Why it matters:** The CDDL for DualSignedInteractionReceipt is written but Protocol 2 hasn't shipped. Any format change before adoption is free. After adoption, it's a breaking change with a 6-month migration.

---

## NOT YET ACTIVE

These concerns activate when Protocol 2 development begins. Until then, documented but not monitored.

## CLOSED

*Nothing yet.*
