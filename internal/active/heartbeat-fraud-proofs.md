# Heartbeat Fraud Proofs: Verifiable Agent Computation

**Status:** Design doc v2.0 — security-audited
**Date:** 2026-04-07 (v1), 2026-04-07 (v2 audit)
**Premise:** Heart proves origin. This system makes Heart prove computation — not through math (ZK), not through hardware (TEE), but through **economic certainty** backed by cryptographic checkpoints.

**The Bitcoin parallel:** Bitcoin doesn't prove transactions are correct. It makes lying economically irrational. Heartbeat Fraud Proofs do the same for agent computation.

---

## 0. The Problem

Heart signs: "Agent X produced output Y at time T."
Heart does NOT prove: "Y is the correct result of computation Z."

An agent could sign `2+2=5` and the birth cert would be perfectly valid.

ZK proofs fix this mathematically but cost 10,000-1,000,000x compute overhead. TEEs fix it but you trust Intel. Both are heavy, high-latency, and don't scale to arbitrary agent tasks.

**Goal:** Prove computation in a way that is:
- **Low compute** (~1-5% overhead)
- **Low latency** (~0ms added to happy path)
- **High accuracy** (99.999%+ — economically irrational to cheat)
- **General** (works for sort, math, aggregation, ML inference, any computation)

---

## 1. Computation Type Taxonomy

Not all computations can be verified the same way. The system must be honest about what each layer can and cannot catch.

| Class | Examples | Verification | Spot-check security |
|---|---|---|---|
| **Algebraically verifiable** | Matrix multiply, polynomial evaluation | Freivalds/Schwartz-Zippel: k trials → P(miss) = 2^(-k) | Strong (adversary-resistant) |
| **Structurally verifiable** | Sort, filter, join, dedup | O(N) full scan or multiset hash | Strong (full verification is cheap) |
| **Aggregation verifiable** | Sum, count, min/max, average | O(1) — check parts = total, bounds checks | Strong (exact verification) |
| **Approximately verifiable** | Numerical computation, floating-point | Tolerance-based: \|result - expected\| < epsilon | Medium (epsilon is an attack surface) |
| **Economically verifiable only** | ML inference, generative tasks, optimization | No cheap verification possible | None — Layers 2+3 only |

**Critical rule:** Each computation type must declare its class. The system selects verification strategy accordingly. Claims about detection probability must use the correct probability model for that class (see Section 4).

---

## 2. Three-Layer Verification Stack

### Layer 1: Commit-Reveal Spot-Checks (instant, automatic, adversary-resistant)

**The self-verification problem:** If Heart runs spot-checks on its own computation, a compromised Heart controls both the output and the verification randomness. It can trivially pass its own checks.

**The fix: commit-reveal protocol.** Randomness is committed *before* computation, revealed *after* output is committed. Heart cannot predict which elements will be checked.

```
1. Platform generates random seed, commits H(seed) → stored
2. Heart receives task + H(seed) (cannot derive seed)
3. Heart computes result, commits H(output) + output
4. Platform reveals seed
5. Spot-checks run using seed to select check targets
6. If any check fails → no cert issued, computation rejected
7. If all pass → birth cert signed with spot-check attestation
```

**Why this works:** To pass spot-checks on wrong output, Heart would need to predict the seed before computing — computationally equivalent to breaking SHA-256. For algebraically verifiable computations (Freivalds), k=20 checks with committed randomness give P(miss) = 2^(-20) ≈ 10^(-6) regardless of how many elements are wrong. For structurally verifiable computations, we use full O(N) verification instead of spot-checking (see Section 4).

**Separation of concerns:** The commit-reveal protocol means Layer 1 is a proper interactive proof between the platform (verifier) and Heart (prover), not self-verification. This satisfies the "never self-verify" principle from the Soma architecture.

**Overhead:** One hash per checkpoint + seed commitment. For a 1M-record sort with full O(N) verification, that's ~1ms. For algebraic checks with k=20, it's microseconds. Negligible.

### Layer 2: Heartbeat Checkpoints (captured during computation, O(1) per beat)

Heart already beats — each `fetchData` call increments the heartbeat index and signs data. Extend this: during multi-step computations, each heartbeat captures a **state checkpoint**.

```
Agent task: "Sort 1M records by timestamp"

Beat 0:  hash(input_data)                    <- starting state
Beat 1:  hash(state_after_partition_1)        <- progress checkpoint
Beat 2:  hash(state_after_partition_2)        <- progress checkpoint
...
Beat 19: hash(state_after_partition_19)       <- nearly done
Beat 20: hash(sorted_output)                  <- final result

Birth cert signs: merkle_root(beat_0...beat_20)
```

**Overhead:** One hash per checkpoint. For a 1M-record sort with 20 checkpoints, that's 20 SHA-256 calls (~0.001ms total). Negligible.

**What this enables:** If anyone doubts the result, they can binary-search the checkpoint chain to find the exact step that went wrong — in O(log N) rounds instead of re-executing the entire computation.

### Layer 3: Economic Stakes (makes lying irrational)

The credit system and escrow infrastructure already exist. Wire them to computation:

1. **Agent stakes bond** before computation (tiered — see Section 5)
2. **Result is accepted immediately** (optimistic — happy path is zero latency)
3. **Challenge window** opens (24h minimum — see Section 5)
4. **Any agent can challenge** by staking their own bond
5. **Bisection dispute** resolves in O(log N) rounds
6. **Loser's bond is slashed** — winner earns reward

**Expected value of cheating:**
```
E(cheat) = reward * P(not caught) - bond * P(caught)

Layer 1 (commit-reveal spot-checks):
  - Algebraic computations: P(miss) = 2^(-20) per check cycle
  - Structural computations: P(miss) = 0 (full verification)
  - Aggregation: P(miss) = 0 (exact check)
  - Approximate: P(miss) depends on epsilon tolerance
  - ML/generative: P(miss) = 1 (spot-checks don't apply)

Layer 2+3 (checkpoint bisection + economic stakes):
  - Catches anything that escapes Layer 1
  - P(caught) depends on challenger participation (see Section 6)

For algebraic + structural + aggregation (majority of computations):
  P(caught via Layer 1) ≈ 1.0
  E(cheat) << 0  →  rational agents never cheat

For ML/generative (Layer 1 doesn't apply):
  P(caught) = P(challenger exists and monitors)
  Economic security only — bond sizing must compensate (see Section 5)
```

---

## 3. Bisection Dispute Protocol

Adapted from Arbitrum BOLD (secures $18B TVL in production). Modified for off-chain agent computation with additional safeguards.

### Happy Path (99.9% of cases)
```
1. Agent computes result
2. Platform runs commit-reveal spot-checks
3. Birth cert signed with checkpoint merkle root + spot-check attestation
4. Result delivered to caller
5. Challenge window expires → result finalized
   Total added latency: ~0ms (spot-checks are inline)
```

### Dispute Path
```
1.  Challenger stakes bond: "I dispute the result"
2.  Arbiter requests checkpoint merkle proof
3.  Agent reveals checkpoints: [beat_0, beat_1, ..., beat_N]
4.  Challenger identifies disputed range: "beat_10 → beat_11 is wrong"
5.  Agent reveals sub-checkpoints within that range
6.  Binary search continues: O(log N) rounds
7.  Disagreement narrows to ONE computation step
8.  That single step is re-executed by arbiter (+ independent verifiers for Tier 3)
9.  If agent was wrong: agent's bond → challenger (minus platform fee)
10. If challenger was wrong: challenger's bond → agent (minus platform fee)
    Total dispute cost: O(log N) messages + O(1) re-execution
```

### Dispute Resolution Model: Constrained Arbiter

The arbiter (ClawNet platform) operates under **hard constraints** to limit trust assumptions:

| Constraint | Enforcement |
|---|---|
| Arbiter can only route funds to challenger OR agent, never to itself | Smart escrow contract logic — no self-pay path exists |
| All dispute steps are logged immutably | `writeAuditLog` with full merkle proof chain |
| Re-execution is deterministic and reproducible | Deterministic execution spec (see Section 8) |
| High-value disputes (Tier 3) use multi-party re-execution | 3+ independent verifiers must agree |
| Challenge window auto-extends if platform availability degrades | Monitors uptime; extends window by downtime duration |
| Multiple challenge submission channels | HTTP API + signed-timestamp fallback (prove submission time even if API was down) |

**Trust assumption (honest about it):** For Tier 1-2 disputes, you trust ClawNet to execute the constrained arbiter protocol honestly. This is weaker than trusting a smart contract but stronger than trusting an arbitrary third party — ClawNet's long-term business depends on arbiter credibility. For Tier 3 disputes, multi-party re-execution removes the single-arbiter trust assumption.

### All-vs-All Disputes (Anti-Sybil)

Adapted from BOLD: disputes are **all-vs-all**, not sequential 1-vs-1. If 10 sybil identities challenge the same computation, they are merged into a single dispute. This prevents delay attacks where an attacker creates N identities to force N × challenge_period delays.

---

## 4. Spot-Check Library — Correct Probability Analysis

Each computation class has different verification properties. The system must use the correct probability model for each.

### Algebraically Verifiable (Freivalds-class)

**Matrix multiply verification:** A*B=C
- Method: Freivalds' algorithm — random vector r, check A(Br) = Cr
- Probability model: P(miss per trial) ≤ 1/2, so k trials → P(miss) ≤ 2^(-k)
- With committed randomness: adversary cannot predict r, so the bound holds even against adaptive adversaries
- **20 trials → P(miss) = 2^(-20) ≈ 10^(-6). 40 trials → 2^(-40) ≈ 10^(-12).**
- Cost: O(N^2) per trial vs O(N^2.37) to compute — real savings

**Polynomial identity testing:** Schwartz-Zippel lemma
- P(miss) ≤ d/|F| per trial where d = degree, |F| = field size
- For SHA-256 field: d/|F| is negligible for any practical polynomial

### Structurally Verifiable (Full Verification)

**Sort verification:**
- Primary: `checkSorted(output, comparator)` — O(N) full adjacent-pair scan. **Always use this.** O(N) verification on an O(N log N) computation is cheap — no reason to spot-check.
- Secondary: `checkPermutation(input, output)` — MSet-XOR-Hash with HMAC-SHA256 keyed PRF. Verifies output is a permutation of input. Collision-resistant under PRF assumption.
- Combined: O(N) total. Catches **any** error with certainty.
- **Do NOT spot-check sort with random pairs.** k random pairs on N elements catches a single error with probability k/N — far too weak for security. Full scan is the same cost class and catches everything.

**Filter verification:**
- `checkPredicate(output, predicate)` — O(|output|) full scan, verify every element satisfies predicate
- `checkSubset(output, input)` — verify output ⊆ input via hash set

**Join verification:**
- `checkCardinality(input_a, input_b, output, join_type)` — verify output size matches expected
- Full scan of output rows against join condition: O(|output|)

### Aggregation Verifiable (Exact)

- `checkSum(parts, total)` — O(|parts|), exact
- `checkCount(input, output, predicate)` — O(|input|), exact
- `checkBounds(output, min, max)` — O(1), exact
- `checkAverage(sum, count, claimed_avg)` — O(1), exact

### Approximately Verifiable (Tolerance-based)

- `checkInverse(f, f_inv, x, y, epsilon)` — |f_inv(y) - x| < epsilon
- `checkSolution(A, x, b, epsilon)` — ||Ax - b|| < epsilon
- **Attack surface:** Adversary corrupts result by exactly epsilon — within tolerance but wrong. Mitigated by (a) tight epsilon derived from IEEE 754 analysis, (b) economic security via Layers 2+3 for high-value.
- **Determinism requirement:** Both parties must use the same floating-point semantics (see Section 8).

### Economically Verifiable Only (No Spot-Check)

- ML inference, generative tasks, approximate optimization
- `checkSchema(output, schema)` — structural only, not semantic
- `checkDistribution(outputs, expected_distribution)` — statistical, not deterministic
- **Honest about it:** These computations cannot be cheaply verified. Security comes exclusively from Layers 2+3 (bisection + bonds). Bond sizing must be higher for this class (see Section 5).

### Extensible Registration
```typescript
registerSpotCheck('custom-computation', {
  class: 'algebraic' | 'structural' | 'aggregation' | 'approximate' | 'economic-only',
  verify: (input, output, seed) => {
    // seed from commit-reveal — cannot be predicted by prover
    return { valid: boolean, confidence: number, probabilityModel: string };
  },
});
```

---

## 5. Economic Security Model

### Bond Tiers

Flat 2x-call-cost bonds are insufficient — the profit from cheating can vastly exceed call cost. Bond sizing must be proportional to **value at risk**, not just the API call price.

| Tier | Value at risk | Bond | Challenge window | Arbiter model |
|---|---|---|---|---|
| **Tier 0** | < 10 credits | None | None | Spot-checks only (Layer 1) |
| **Tier 1** | 10-100 credits | 5x call cost (credits) | 24 hours | Constrained single arbiter |
| **Tier 2** | 100-1000 credits | 10x call cost (credits) | 48 hours | Constrained arbiter + audit log |
| **Tier 3** | > 1000 credits | max(20x call cost, 10% output value) — **real-money component required** (SOL/USDC) | 72 hours | Multi-party re-execution (3+ independent verifiers) |

**Tier 0 rationale:** For cheap calls (1.5 credits), the challenge system's overhead (bond lockup, bisection rounds, arbiter compute) exceeds the value being protected. Spot-checks alone provide sufficient assurance for low-value computation.

**Real-money component (Tier 3):** Credit-denominated bonds have a reflexivity problem — credit value depends on platform trustworthiness, which depends on bond security. For high-value computation, bonds must include SOL or USDC to break the reflexive loop. This mirrors how Arbitrum uses WETH (not a native token) for bonds.

### Challenger Economics

| Parameter | Value | Rationale |
|---|---|---|
| Challenger bond | 1x call cost | Prevents spam, fully refunded if correct |
| Correct challenge reward | 3x challenger bond | Must exceed monitoring cost to incentivize |
| Platform fee on resolution | 5% of loser's bond | Funds arbiter compute, prevents self-dealing |
| Bond destination on slash | 60% to winner, 35% to platform treasury, 5% burned | Burning prevents collusion recovery |

### Verification Stipend (Solves Verifier's Dilemma)

The verifier's dilemma: if cheating is rare, challengers never earn money and stop monitoring. TrueBit solved this with forced errors. We use a simpler approach: **verification stipends**.

- Platform allocates 1% of all computation fees to a **verification pool**
- Registered verifiers are randomly assigned computations to re-check
- Verifiers who submit correct verification proofs earn stipend regardless of whether fraud was found
- Verifiers who fail to respond to assignments lose verifier status
- **This is a Randomized Attention Test (RAT)** — the platform pings verifiers to prove attentiveness

**Cost:** 1% of fees. For a platform processing $100K/month, that's $1K/month in verification stipends — cheap for economic security.

### Griefing Factor Analysis

The griefing factor = (victim's loss) / (attacker's cost). Target: attacker pays ≥ 5x what the victim loses.

| Attack | Attacker cost | Victim loss | Griefing factor | Acceptable? |
|---|---|---|---|---|
| Spam challenges (Tier 1) | 1x bond per challenge (lost) | Time to respond | ~10:1 | Yes |
| Spam challenges (Tier 3) | 1x bond + real money | Time + lockup | ~20:1 | Yes |
| Sybil delay | N × bond (all lost, all-vs-all merge) | Single dispute period | ~N:1 | Yes |
| Fraudulent computation (Tier 0) | Reputation only | < 10 credits | N/A (spot-checks catch) | Yes |
| Fraudulent computation (Tier 3) | 20x call cost + SOL/USDC | Value of computation | Must exceed 1:1 | Requires correct bond sizing |

---

## 6. Attack Surface Analysis

### Attacks on Layer 1 (Commit-Reveal Spot-Checks)

| Attack | Description | Mitigation | Residual risk |
|---|---|---|---|
| Predict committed seed | Break SHA-256 pre-image | Computationally infeasible | None |
| Influence seed generation | Compromise platform RNG | Use cryptographic CSPRNG, audit seed generation | Low (platform compromise is catastrophic regardless) |
| Exploit epsilon tolerance | Corrupt result by exactly epsilon | Tight epsilon bounds + Layers 2+3 for high-value | Medium for approximate class |
| Exam cramming (ML) | Return correct results for test-like inputs | ML is economic-only class — no Layer 1 security claim | Accepted (honest in taxonomy) |
| Hash collision in multiset check | Find two different sets with same MSet-XOR-Hash | HMAC-SHA256 keyed PRF, collision-resistant | Negligible (2^(-128)) |

### Attacks on Layer 2 (Checkpoints)

| Attack | Description | Mitigation | Residual risk |
|---|---|---|---|
| Omit checkpoints | Skip intermediate states to hide errors | Checkpoint interval enforced by platform; missing checkpoints = rejected cert | None |
| Forge checkpoint hashes | Claim false intermediate states | Bisection re-executes disputed step; forged hashes are caught | None (if re-execution is deterministic) |
| Non-deterministic replay | Re-execution produces different result than original | Deterministic execution spec (Section 8) | Medium (see Section 8) |

### Attacks on Layer 3 (Economic)

| Attack | Description | Mitigation | Residual risk |
|---|---|---|---|
| Verifier's dilemma | Challengers stop monitoring because fraud is rare | Verification stipend (RAT) | Low |
| Sybil delay | N identities challenge to delay finalization | All-vs-all disputes, bond per challenge | Low |
| Griefing via spam challenges | Drain honest agents' time/resources | Challenger bond lost if wrong; rate limiting | Low |
| Collusion (lazy watchtowers) | Verifiers agree not to check each other | Random assignment, whistleblower bounty | Medium |
| DDoS during challenge window | Prevent challenges from being submitted | Auto-extend window, signed-timestamp fallback | Medium |
| Long con (reputation gaming) | Build trust then execute large fraud | Value-tier gating, anomaly detection, bond scales with value | Medium |
| Credit reflexivity | Credits lose value during crisis, bonds become worthless | Real-money component for Tier 3 | Low for Tier 3; accepted for Tier 0-2 |
| Centralized arbiter compromise | Hacked arbiter steals bonds | Constrained arbiter, multi-party for Tier 3, audit trail | Low for Tier 3; medium for Tier 1-2 |
| Whitewashing | Burn identity, create new one, repeat | Identity creation cost (minimum credit deposit), reputation doesn't transfer | Medium |

### Attacks on Determinism (Cross-Cutting)

| Attack | Description | Mitigation | Residual risk |
|---|---|---|---|
| Floating-point divergence | (a+b)+c ≠ a+(b+c) across architectures | Integer/fixed-point for verified computations; deterministic execution spec | Low if spec is followed |
| Thread scheduling | Parallel reduction order varies | Single-threaded re-execution for disputes | None (but slower) |
| Time-dependent code | `Date.now()` produces different results on replay | Deterministic time injection; timestamps from checkpoint | None |
| SIMD/vectorization | Different CPU extensions produce different results | Platform-specified Node.js version + flags | Low |

---

## 7. Computation Certificate

New certificate type, modeled on the existing `CacheCertificate` hash-chaining pattern:

```typescript
interface ComputationCertificate {
  // Identity
  id: string;
  requestId: string;
  agentDid: string;

  // Computation description
  computationType: string;          // 'sort' | 'aggregate' | 'ml-inference' | 'custom'
  computationClass: 'algebraic' | 'structural' | 'aggregation' | 'approximate' | 'economic-only';
  inputHash: string;                // JCS-canonical hash of input
  outputHash: string;               // JCS-canonical hash of output

  // Checkpoints (the fraud-proof backbone)
  checkpoints: {
    index: number;
    stateHash: string;
    heartbeatIndex: number;
    timestamp: string;
  }[];
  checkpointMerkleRoot: string;     // Merkle root over checkpoint hashes

  // Commit-reveal spot-check attestation
  seedCommitment: string;           // H(seed) committed before computation
  seed: string;                     // Revealed after output committed
  spotChecks: {
    checkName: string;
    passed: boolean;
    confidence: number;
    probabilityModel: string;       // 'freivalds' | 'full-scan' | 'exact' | 'tolerance' | 'none'
    detectionProbability: number;   // Honest P(catch) for this check type
  }[];
  allSpotChecksPassed: boolean;

  // Birth cert binding (chain to original data provenance)
  birthCertHash: string;            // hash of the birth cert

  // Platform signature (ClawNet attests the checkpoints + spot-checks)
  signature: string;
  publicKey: string;
  algorithm: string;

  // Chain hash (binds everything together)
  chainHash: string;                // hash(birthCert + checkpoints + spotChecks + seed + signature)

  // Economic
  bondTier: 0 | 1 | 2 | 3;
  bondCredits: number;              // credits staked on this result
  bondRealMoney?: {                 // required for Tier 3
    amount: number;
    currency: 'SOL' | 'USDC';
    txHash: string;
  };
  challengeWindowEnd: string;       // ISO 8601 datetime — challenges accepted until
  challengeWindowAutoExtended: boolean; // true if window was extended due to availability issues
  finalized: boolean;               // true after window expires with no successful challenge

  // Verification stipend
  assignedVerifiers?: string[];     // DIDs of verifiers assigned to check this computation
  verificationDeadline?: string;    // When assigned verifiers must submit proof
}
```

---

## 8. Deterministic Execution Specification

Bisection disputes require single-step re-execution to produce identical results. Non-determinism is protocol-breaking — if replay produces a different result, the arbiter cannot determine who cheated.

### Platform Requirements

| Requirement | Specification | Rationale |
|---|---|---|
| Runtime | Node.js (platform-specified version, e.g., 22.x LTS) | Eliminates cross-runtime divergence |
| Arithmetic | Integer and fixed-point only for verified computations | IEEE 754 floating-point is non-associative across compilers |
| Randomness | Seeded PRNG (seed captured in checkpoint) | Eliminates non-deterministic randomness |
| Time | Injected from checkpoint data, not live `Date.now()` | Eliminates time-dependent divergence |
| Thread model | Single-threaded for dispute re-execution | Eliminates thread scheduling divergence |
| Dependencies | Pinned versions (lockfile hash in checkpoint) | Eliminates dependency-version divergence |
| I/O | All external data captured in checkpoint (no live network calls during replay) | Eliminates external state divergence |

### What This Excludes

**GPU computation, ML inference, and SIMD-dependent code** cannot guarantee cross-architecture determinism. These computation classes are designated `economic-only` in the taxonomy — they rely on Layers 2+3 (bond + challenge) rather than deterministic re-execution.

If future ZKML becomes practical (currently 10,000x+ overhead), ML inference can be upgraded from `economic-only` to `algebraically verifiable`. The taxonomy is designed for this evolution.

### Determinism Test Suite

Before any computation type is registered for bisection disputes:
1. Execute on 3 different machines (same Node.js version)
2. Compare output byte-for-byte
3. If any divergence: computation type is classified `approximate` or `economic-only`

---

## 9. Anti-Gaming Measures

### Reputation Gaming Prevention (The Long Con)

An agent could build trust over months, then execute one high-value fraud. Mitigations:

**Value-tier gating:** Agents must demonstrate history at each value tier before accessing the next.
| Tier | Requirement to unlock |
|---|---|
| Tier 0 (< 10 credits) | Any registered agent |
| Tier 1 (10-100 credits) | 30+ days active, 100+ successful computations |
| Tier 2 (100-1000 credits) | 90+ days active, 1000+ successful computations, zero disputes lost |
| Tier 3 (> 1000 credits) | 180+ days active, 5000+ successful computations, KYC or on-chain identity |

**Behavioral anomaly detection:** Flag agents whose patterns change suddenly:
- Value per computation increases > 10x from 30-day average
- New endpoint types not previously used
- Call frequency spike > 5x from baseline
- Flagged agents have bond requirements temporarily doubled

**Whitewashing prevention:** Creating a new API key costs a minimum credit deposit (e.g., 100 credits). Reputation does not transfer between identities. This makes "burn and restart" economically costly.

### Collusion Prevention

- **Verification assignments are random and secret** — verifiers don't know who else is assigned
- **Whistleblower bounty** — any party who proves collusion earns 5x the colluders' combined bonds
- **Bond burning** — 5% of slashed bonds are burned (sent to treasury), not redistributed. Colluders cannot recapture burned value.

### Censorship Resistance

The challenge window is the system's Achilles' heel — if challenges can't be submitted, fraud goes undetected.

| Threat | Mitigation |
|---|---|
| Platform DDoS | Auto-extend window by measured downtime duration |
| API endpoint down | Signed-timestamp fallback: challenger signs `{dispute, timestamp}` with their key, submits later with proof of timing |
| Selective censorship | All challenges logged to append-only audit log; missing challenges are detectable |
| Network partition | Challenge window does not start until the computation certificate is publicly accessible |

---

## 10. What Already Exists (reusable infrastructure)

The codebase has ~70% of the infrastructure needed:

| Component | File | Reuse |
|---|---|---|
| Heartbeat chain + birth certs | `src/core/soma.ts` | Extend with checkpoint data |
| Hash-chaining pattern | `src/core/cache-certificate.ts` | Same pattern for computation certs |
| Merkle tree + proof verification | `src/core/merkle-anchor.ts` | Cryptographic foundation ready |
| EAS/Base anchoring | `src/core/eas-anchor-cron.ts` | On-chain timestamp infrastructure |
| Escrow state machine | `src/routes/escrow.ts`, `src/db/escrow.ts` | Foundation for staking + dispute |
| Signal/reputation | `src/db/signal.ts` | Weight trust by computation history |
| Soma verdicts | `src/db/soma-verdicts.ts` | External observer verification |
| Delegation chains | `src/db/transfers.ts` | Trust chain traversal |
| Dual-sign protocol | `src/core/dual-sign.ts` | Provider co-signing pattern |
| Soma receipts | `src/core/soma-receipt.ts` | Already has `heartbeat_index` field |
| Governance/voting | `src/routes/governance.ts` | Dispute resolution precedent |
| Aid disputes | `src/db/connection.ts` (aid_disputes table) | Receipt-based dispute flow |
| Trust scoring v2 | `src/core/trust-scoring-v2.ts` | 11-dimension trust model (extend for anomaly detection) |
| Vouch ranking | `src/core/vouch-ranking.ts` | Tenure + behavior scoring (extend for value-tier gating) |

### What needs to be built from scratch

| Component | Complexity | Description |
|---|---|---|
| Commit-reveal seed protocol | Medium | Platform commits H(seed) before computation, reveals after output |
| Checkpoint capture in Heart | Medium | Extend `fetchData` to emit intermediate state hashes |
| Semantic spot-check library | Medium | Per-computation-class verification functions with correct probability models |
| Computation certificate | Low | New cert type binding checkpoints + spot-checks to birth cert |
| Bisection protocol | High | All-vs-all challenge/response message flow with bond management |
| Constrained arbiter | Medium | Escrow extension with hard constraints (no self-pay, auto-extend, audit) |
| Challenge bond system | Medium | Tiered bonds with real-money component for Tier 3 |
| Single-step re-execution | High | Deterministic re-execution of disputed step per spec in Section 8 |
| Verification stipend system | Medium | Random assignment, RAT pings, stipend payouts |
| Value-tier gating | Low | Agent tier tracking based on history |
| Anomaly detection | Medium | Behavioral baseline tracking + flag system |
| Multi-party re-execution | High | 3+ independent verifiers for Tier 3 disputes |
| Signed-timestamp fallback | Low | Challenge submission proof even if API is down |

---

## 11. Build Phases

### Phase A: Spot-Check Layer + Commit-Reveal (2-3 weeks)
- [ ] Implement commit-reveal seed protocol (platform generates seed, commits hash, reveals after output)
- [ ] Implement spot-check library with correct probability models per computation class
- [ ] Computation type taxonomy: registration system with class declaration
- [ ] Full O(N) verification for structural class (sort, filter, join)
- [ ] Freivalds for algebraic class (matrix multiply)
- [ ] Exact checks for aggregation class (sum, count, bounds)
- [ ] MSet-XOR-Hash with HMAC-SHA256 for permutation verification
- [ ] Integrate into Heart: run checks after seed reveal, before signing birth cert
- [ ] Add `spot_checks_json` + `seed_commitment` fields to `soma_receipts` table
- [ ] New signal action: `computation_verified` (auto-awarded when spot-checks pass)
- [ ] Tests: spot-checks catch intentionally wrong results; committed randomness prevents gaming
- **Value:** Real Layer 1 security for algebraic, structural, and aggregation computations. Honest "economic-only" designation for ML/generative.

### Phase B: Checkpoint Capture (1-2 weeks)
- [ ] Extend soma-heart's `fetchData` to accept checkpoint callback
- [ ] Implement `ComputationCertificate` (reuse cache-certificate pattern)
- [ ] Migration: `computation_certificates` table
- [ ] Merkle tree over checkpoints (reuse `buildMerkleTree`)
- [ ] Add `checkpoint_merkle_root` to birth cert / receipt
- [ ] Deterministic execution spec: pin Node.js version, integer arithmetic, seeded PRNG
- [ ] Determinism test suite: verify byte-identical output across 3 machines
- [ ] Tests: checkpoints are captured, merkle proofs verify
- **Value:** Audit trail for every computation. Enables Layers 2+3.

### Phase C: Challenge Protocol (3-4 weeks)
- [ ] Design challenge message schema (request, response, bisection rounds)
- [ ] All-vs-all dispute resolution (merge sybil challenges into single dispute)
- [ ] Constrained arbiter: no self-pay path, auto-extend window, audit trail
- [ ] Tiered bond system: Tier 0 (none), Tier 1-2 (credits), Tier 3 (credits + SOL/USDC)
- [ ] Implement bisection protocol: challenger picks range, agent reveals sub-checkpoints
- [ ] Single-step re-execution engine (deterministic replay per Section 8 spec)
- [ ] Signed-timestamp fallback for challenge submission
- [ ] Bond slashing: 60% to winner, 35% treasury, 5% burned
- [ ] API: `POST /v1/soma/challenge` (file), `POST /v1/soma/challenge/:id/respond` (bisect)
- [ ] Migration: `computation_challenges` table
- [ ] Tests: bisection converges to correct step, slashing works, sybil merge works
- **Value:** Full economic security for Tier 1-3 computations.

### Phase D: Incentives + Anti-Gaming (2-3 weeks)
- [ ] Verification stipend system: random assignment, RAT pings, stipend payouts from 1% fee pool
- [ ] Value-tier gating: agents unlock tiers based on history
- [ ] Behavioral anomaly detection: baseline tracking, flag sudden changes
- [ ] Whitewashing prevention: minimum credit deposit for new identities
- [ ] Whistleblower bounty system for collusion reporting
- [ ] Griefing factor monitoring: track attacker/defender cost ratios in production
- [ ] Signal integration: honest computation history boosts reputation
- [ ] Verdict integration: RED verdicts trigger automatic challenges
- [ ] Dashboard: show computation certificates + challenge status + verifier assignments
- **Value:** Production-ready economic security with anti-gaming.

### Phase E: Multi-Party + Advanced (future)
- [ ] Multi-party re-execution for Tier 3 disputes (3+ independent verifiers)
- [ ] Provider-registered custom spot-checks with class declaration
- [ ] Cross-agent refereed computation (multiple agents compute, majority wins)
- [ ] Merkle-anchored computation proofs on Base (on-chain finality)
- [ ] Delegation-aware challenges (slash the whole chain if root agent cheats)
- [ ] ZKML integration path (when overhead drops below 100x)

---

## 12. Why This Is Novel

**What exists separately:**
- Arbitrum BOLD: bisection fraud proofs for blockchain transactions
- Freivalds: probabilistic verification for matrix multiplication
- Bitcoin: economic security through proof-of-work
- Soma Heart: agent identity + heartbeat chain
- TrueBit: forced errors for verifier incentives

**What doesn't exist (the invention):**
Combining all five into a single system where:
1. The heartbeat chain serves as the computation trace (not blockchain state)
2. **Commit-reveal spot-checks** provide adversary-resistant instant verification (not self-checks)
3. **Computation type taxonomy** honestly classifies what each layer can and cannot verify
4. Economic stakes with **tiered bonds** make the optimistic assumption safe across value ranges
5. **Verification stipends** solve the verifier's dilemma without forced errors
6. Agent identity ties stakes to long-term reputation with **value-tier gating** (not anonymous miners)

The key insight: Heart's existing heartbeat infrastructure is **exactly** the computation trace that bisection protocols need. We're not bolting on verification — we're revealing that the infrastructure was always capable of this.

---

## 13. Honest Limitations

1. **Not a mathematical proof.** A ZK proof gives certainty. This gives economic certainty — "no rational agent would cheat." Irrational actors can still cheat (and lose money). The griefing factor analysis quantifies the cost.

2. **Requires active verifiers.** If nobody verifies, fraud goes undetected. Mitigated by verification stipends (paid regardless of fraud found) and RAT pings (verifiers must prove attentiveness). But if the stipend pool runs dry or all verifiers collude, the system degrades to Layer 1 only.

3. **Deterministic re-execution excludes GPU/ML computation.** Non-deterministic computations (floating-point across architectures, GPU Tensor Core variance, thread scheduling) cannot be bisection-disputed. These are classified `economic-only` — security comes from bonds alone, not re-execution. This is an honest gap.

4. **Challenge window adds finality delay.** Happy path is instant, but true finality waits 24-72 hours. Design choice: serve results immediately, finalize later (like Arbitrum — users don't wait 6 days for their transactions).

5. **Spot-checks don't cover all computation types.** Generative tasks, approximate optimization, and ML inference have no cheap verification. The taxonomy is honest about this — they are designated `economic-only` and bond sizing compensates.

6. **Centralized arbiter for Tier 1-2.** You trust ClawNet for low-to-medium-value disputes. Multi-party re-execution only kicks in at Tier 3. This is a pragmatic tradeoff — full decentralization is expensive and slow.

7. **Credit-denominated bonds (Tier 0-2) have reflexive value.** If the platform fails, credits become worthless, and bond security evaporates. Real-money bonds (Tier 3) break this reflexivity for high-value computation.

8. **This is a design doc, not working code.** The infrastructure exists but the wiring doesn't. Phase A (spot-checks + commit-reveal) is the minimum viable version.

---

## 14. The Pitch

> "Every API response is signed by a cryptographic heart that proves who computed it. Every computation is classified by type and verified with the mathematically correct method — algebraic proofs for math, full scans for sorting, exact checks for aggregation. The verification randomness is committed before computation starts, so even a compromised agent can't game the checks."
>
> "And if anything slips through, any agent in the network can challenge the result — triggering an efficient binary-search dispute that finds the exact wrong step in O(log N) rounds. The agent that lied loses their bond. The agent that caught them earns a reward. Verifiers are paid to watch, so the system never goes unmonitored."
>
> "This is how Bitcoin works for money. We made it work for computation — with honest acknowledgment of what each layer can and cannot prove."

---

## Appendix A: Academic References

| Topic | Source | Key finding |
|---|---|---|
| Verifier's dilemma | Sheng et al., "Incentive Non-Compatibility of Optimistic Rollups," 2023 | Mixed-strategy Nash equilibrium where validators verify with probability < 1 |
| Forced errors | Teutsch & Reitwiesner, "TrueBit," 2017 | Forced error rate of 1/1000 with jackpot payout solves verifier's dilemma |
| Bisection protocols | Arbitrum BOLD docs, 2025 | All-vs-all disputes with 6.46:1 attacker/defender cost ratio |
| Delay attacks | L2Beat, "Fraud Proof Wars," 2024 | Pre-BOLD sybil attacks caused N × challenge_period delays |
| Censorship games | EC 2025 proceedings, Feb 2025 | L1 bribery model for censoring challenge transactions |
| Collusion | Sheng et al., "Proof of Diligence," AFT 2024 | Lazy collusion is Pareto-efficient Nash equilibrium without countermeasures |
| Hollow Victory | Lee, WTSC 2025 | More validator competition reduces proposer's total loss (counterintuitive) |
| Freivalds' algorithm | Freivalds, 1979 | Matrix multiply verification: P(miss) ≤ 2^(-k) for k trials |
| Schwartz-Zippel | Schwartz 1980, Zippel 1979 | Polynomial identity testing over finite fields |
| Multiset hashing | Clarke et al., MIT | MSet-XOR-Hash with keyed PRF is collision-resistant |
| Floating-point determinism | Ingonyama, 2025 | CUDA Core restriction achieves cross-architecture bitwise reproducibility at performance cost |
| Non-determinism in rollups | "Optimistic Time-Travel," 2021 | Gas divergence between L1/L2 enabled double-spend via fraud proof manipulation |
| Reputation gaming | NDSS 2018, "Elite Sybil Attacks" | Organically-built high-reputation accounts used for fraud |
| Griefing factor | Buterin, "Triangle of Harm," 2017 | Cannot globally bound griefing factor below 1 in speaker/listener systems |
| Economic security failures | Harvard Law, "Anatomy of a Run," 2023 | Terra/Luna: reflexive token security collapsed under stress |
