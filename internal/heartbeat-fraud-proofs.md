# Heartbeat Fraud Proofs: Verifiable Agent Computation

**Status:** Design doc. Not built yet.  
**Date:** 2026-04-07  
**Premise:** Heart proves origin. This system makes Heart prove computation — not through math (ZK), not through hardware (TEE), but through **economic certainty** backed by cryptographic checkpoints.

**The Bitcoin parallel:** Bitcoin doesn't prove transactions are correct. It makes lying economically irrational. Heartbeat Fraud Proofs do the same for agent computation.

---

## 0. The Problem

Heart signs: "Agent X produced output Y at time T."  
Heart does NOT prove: "Y is the correct result of computation Z."

An agent could sign `2+2=5` and the birth cert would be perfectly valid.

ZK proofs fix this mathematically but cost 100-10,000x compute overhead. TEEs fix it but you trust Intel. Both are heavy, high-latency, and don't scale to arbitrary agent tasks.

**Goal:** Prove computation in a way that is:
- **Low compute** (~1-5% overhead)
- **Low latency** (~0ms added to happy path)
- **High accuracy** (99.999%+ — economically irrational to cheat)
- **General** (works for sort, math, aggregation, ML inference, any computation)

---

## 1. Three-Layer Verification Stack

### Layer 1: Semantic Spot-Checks (instant, automatic, free)

Every computation type has properties that are **much cheaper to verify than to compute**. This asymmetry is the same asymmetry that makes Bitcoin work (hard to mine, easy to verify).

| Computation | Cost to compute | Verification | Cost to verify |
|---|---|---|---|
| Sort N records | O(N log N) | Check 100 random pairs are ordered + multiset hash | O(100) |
| Matrix multiply A*B=C | O(N^2.37) | Freivalds: random r, check A(Br)=Cr | O(N^2) |
| Sum/aggregate | O(N) | Check sum(parts) = total | O(1) |
| Filter | O(N) | Check 100 random outputs satisfy predicate | O(100) |
| Factor N=p*q | Sub-exponential | Check p * q = N | O(1) |
| ML inference | Billions of FLOPs | Deterministic replay on sample inputs | Model-dependent |

**Math:** 20 random spot-checks give a 1-in-a-million false positive rate (Freivalds' algorithm, 1979). 100 checks → 2^-100 probability of undetected error. This is stronger than most hardware guarantees.

**Implementation:** Heart runs spot-checks *before* signing the birth cert. If any check fails, no cert is issued. Zero latency added — microseconds of hashing inline with computation.

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

1. **Agent stakes credits** before computation (proportional to task value)
2. **Result is accepted immediately** (optimistic — happy path is zero latency)
3. **Challenge window** opens (1-4 hours for normal calls, 24h for high-value)
4. **Any agent can challenge** by staking their own credits
5. **Bisection dispute** resolves in O(log N) rounds
6. **Loser's stake is slashed** — winner earns reward

**Expected value of cheating:**
```
E(cheat) = reward * P(not caught) - stake * P(caught)

Layer 1 catches ~99.99% of errors automatically (spot-checks before cert)
Layer 2 + 3 catch the remaining ~0.01% economically (challenge + bisection)

P(caught) ≈ 1.0
E(cheat) < 0  →  rational agents never cheat
```

---

## 2. Bisection Dispute Protocol

Adapted from Arbitrum BOLD (secures $18B TVL in production). Modified for off-chain agent computation.

### Happy Path (99.9% of cases)
```
1. Agent computes result
2. Heart captures checkpoints + runs spot-checks
3. Birth cert signed with checkpoint merkle root
4. Result delivered to caller
5. Challenge window expires → result finalized
   Total added latency: ~0ms
```

### Dispute Path
```
1. Challenger stakes bond: "I dispute the result"
2. ClawNet (arbiter) requests checkpoint merkle proof
3. Agent reveals checkpoints: [beat_0, beat_1, ..., beat_N]
4. Challenger identifies disputed range: "beat_10 → beat_11 is wrong"
5. Agent reveals sub-checkpoints within that range
6. Binary search continues: O(log N) rounds
7. Disagreement narrows to ONE computation step
8. That single step is re-executed by the arbiter
9. If agent was wrong: agent's stake → challenger
10. If challenger was wrong: challenger's stake → agent
    Total dispute cost: O(log N) messages + O(1) re-execution
```

### Design Parameters
| Parameter | Value | Rationale |
|---|---|---|
| Challenge window | 1-4 hours (normal), 24h (high-value) | Shorter than Arbitrum (6.4 days) — API calls don't need week-long finality |
| Agent bond | 2x call cost | Must exceed cost of verification to make challenges profitable |
| Challenger bond | 1x call cost | Prevents spam challenges, refunded if correct |
| Max bisection rounds | 30 | Covers computations up to 2^30 (~1 billion) steps |
| Arbiter | ClawNet platform | Off-chain arbiter, not on-chain (cheaper, faster) |
| Checkpoint interval | Every ~sqrt(N) steps | Balances checkpoint overhead vs dispute resolution speed |

---

## 3. What Already Exists (reusable infrastructure)

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

### What needs to be built from scratch
| Component | Complexity | Description |
|---|---|---|
| Checkpoint capture in Heart | Medium | Extend `fetchData` to emit intermediate state hashes |
| Semantic spot-check library | Medium | Per-computation-type verification functions |
| Computation certificate | Low | New cert type binding checkpoints to birth cert (reuse cache cert pattern) |
| Bisection protocol | High | Challenge/response message flow with bond management |
| Challenge bond system | Medium | Extend escrow with automated slashing |
| Single-step re-execution | High | Deterministic re-execution of disputed step |
| Checkpoint merkle tree | Low | Merkle commitment over checkpoint hashes (reuse existing) |

---

## 4. Semantic Spot-Check Library

The spot-check library defines cheap verification functions per computation type. Each function returns `{ valid: boolean, confidence: number }`.

### Core checks (built-in)

**Sort verification:**
- `checkSorted(output, comparator)` — O(N) scan, pairwise order
- `checkPermutation(input, output)` — multiset hash equality (sum of element hashes must match)
- `spotCheckOrder(output, k=100)` — k random pairs, check order

**Aggregation verification:**
- `checkSum(parts, total)` — sum of parts equals claimed total
- `checkCount(input, output, predicate)` — count matches filter
- `checkBounds(output, min, max)` — result within valid range

**Math verification:**
- `checkInverse(f, f_inv, x, y)` — if agent claims f(x)=y, check f_inv(y)=x
- `checkFactors(n, factors)` — product of factors = n
- `checkSolution(A, x, b)` — Ax = b for linear system

**Data transformation verification:**
- `checkSchema(output, schema)` — output conforms to declared schema
- `checkCardinality(input, output, op)` — join/filter/map preserves expected cardinality
- `checkDeterminism(fn, input, output)` — re-execute on 3 random elements, compare

### Extensible
Providers register custom spot-check functions for their computation types:
```typescript
registerSpotCheck('custom-ml-inference', (input, output) => {
  // Check output shape matches model declaration
  // Check values are within expected distribution bounds
  // Spot-check 5 random input/output pairs via deterministic replay
  return { valid: true, confidence: 0.9999 };
});
```

---

## 5. Computation Certificate

New certificate type, modeled on the existing `CacheCertificate` hash-chaining pattern:

```typescript
interface ComputationCertificate {
  // Identity
  id: string;
  requestId: string;
  agentDid: string;
  
  // Computation description
  computationType: string;          // 'sort' | 'aggregate' | 'ml-inference' | 'custom'
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
  
  // Spot-check results
  spotChecks: {
    checkName: string;
    passed: boolean;
    confidence: number;
  }[];
  allSpotChecksPassed: boolean;
  
  // Birth cert binding (chain to original data provenance)
  birthCertHash: string;            // hash of the birth cert
  
  // Platform signature (ClawNet attests the checkpoints)
  signature: string;
  publicKey: string;
  algorithm: string;
  
  // Chain hash (binds everything together)
  chainHash: string;                // hash(birthCert + checkpoints + spotChecks + signature)
  
  // Economic
  bondCredits: number;              // credits staked on this result
  challengeWindow: string;          // ISO 8601 datetime — challenges accepted until
  finalized: boolean;               // true after window expires with no challenge
}
```

---

## 6. Build Phases

### Phase A: Spot-Check Layer (1-2 weeks)
- [ ] Implement spot-check library for core computation types (sort, aggregate, math, filter)
- [ ] Integrate into Heart: run checks before signing birth cert
- [ ] Add `spot_checks_json` field to `soma_receipts` table
- [ ] New signal action: `computation_verified` (auto-awarded when spot-checks pass)
- [ ] Tests: spot-checks catch intentionally wrong results
- **Value:** Immediate accuracy improvement. No protocol changes needed.

### Phase B: Checkpoint Capture (1-2 weeks)
- [ ] Extend soma-heart's `fetchData` to accept checkpoint callback
- [ ] Implement `ComputationCertificate` (reuse cache-certificate pattern)
- [ ] Migration: `computation_certificates` table
- [ ] Merkle tree over checkpoints (reuse `buildMerkleTree`)
- [ ] Add `checkpoint_merkle_root` to birth cert / receipt
- [ ] Tests: checkpoints are captured, merkle proofs verify
- **Value:** Audit trail for every computation. Enables Layer 2+3.

### Phase C: Challenge Protocol (2-3 weeks)
- [ ] Design challenge message schema (request, response, bisection rounds)
- [ ] Extend escrow system with challenge bonds + auto-slashing
- [ ] Implement bisection protocol: challenger picks range, agent reveals sub-checkpoints
- [ ] Single-step re-execution engine (deterministic replay of one checkpoint interval)
- [ ] API: `POST /v1/soma/challenge` (file), `POST /v1/soma/challenge/:id/respond` (bisect)
- [ ] Migration: `computation_challenges` table
- [ ] Tests: bisection converges to correct step, slashing works
- **Value:** Full economic security. The system is now fraud-proof.

### Phase D: Economic Tuning + Production (1-2 weeks)
- [ ] Bond sizing: dynamic based on computation complexity + call cost
- [ ] Challenge window tuning: adaptive based on call value
- [ ] Challenger incentives: correct challenges earn 2x bond
- [ ] Signal integration: honest computation history boosts reputation
- [ ] Verdict integration: RED verdicts trigger automatic challenges
- [ ] Dashboard: show computation certificates + challenge status
- **Value:** Production-ready economic security.

### Phase E: Advanced (future)
- [ ] Provider-registered custom spot-checks
- [ ] Cross-agent refereed computation (multiple agents compute, majority wins)
- [ ] Merkle-anchored computation proofs on Base (on-chain finality)
- [ ] Delegation-aware challenges (slash the whole chain if root agent cheats)

---

## 7. Why This Is Novel

**What exists separately:**
- Arbitrum: bisection fraud proofs for blockchain transactions
- Freivalds: probabilistic verification for matrix multiplication
- Bitcoin: economic security through proof-of-work
- Soma Heart: agent identity + heartbeat chain

**What doesn't exist (the invention):**
Combining all four into a single system where:
1. The heartbeat chain serves as the computation trace (not blockchain state)
2. Semantic spot-checks provide instant automatic verification (not just fraud proofs)
3. Economic stakes make the optimistic assumption safe (not trusting hardware)
4. Agent identity ties stakes to long-term reputation (not anonymous miners)

The key insight: Heart's existing heartbeat infrastructure is **exactly** the computation trace that bisection protocols need. We're not bolting on verification — we're revealing that the infrastructure was always capable of this.

---

## 8. Honest Limitations

1. **Not a mathematical proof.** A ZK proof gives certainty. This gives economic certainty — "no rational agent would cheat." Irrational agents can still cheat (and lose money).

2. **Requires challengers.** If nobody challenges, fraud goes undetected. Mitigated by Layer 1 (automatic spot-checks catch most errors) and incentivizing challenges via bond rewards.

3. **Single-step re-execution assumes determinism.** Non-deterministic computations (random sampling, floating-point across architectures) need special handling.

4. **Challenge window adds finality delay.** Happy path is instant, but true finality waits for the window to close. Design choice: serve results immediately, finalize later (like Arbitrum — users don't wait 6 days for their transactions).

5. **Spot-checks don't cover all computation types.** Custom computations need custom checks. The library must be extensible, not exhaustive.

6. **This is a design doc, not working code.** The infrastructure exists but the wiring doesn't. Phase A (spot-checks) is the minimum viable version.

---

## 9. The Pitch

> "Every API response is signed by a cryptographic heart that proves who computed it. Every computation is spot-checked by mathematical verification functions that catch errors with 99.9999% confidence. And if anything slips through, any agent in the network can challenge the result — triggering an efficient binary-search dispute that finds the exact wrong step in O(log N) rounds. The agent that lied loses their stake. The agent that caught them earns a reward."
>
> "This is how Bitcoin works for money. We made it work for computation."
