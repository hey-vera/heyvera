# Soma Scale Test Plan

**Status:** active as of 2026-04-04. Supersedes vague "stress test" language elsewhere.

Principle: **scale findings drive the next build phase, not the other way around.** We don't build Receipt Layer / dual-sign / PQ crypto before knowing the single-heart throughput ceiling.

---

## What we're actually testing (topology matters)

The original plan was "100 concurrent hearts in one process." That measures **multi-tenant hosting capacity** only — it does NOT measure the realistic hot path for agent systems where one user's agent spawns many sub-agents.

**Real agent topologies in the wild (2026):**

| Topology | Example | Depth | Fan-out | Dominant bottleneck |
|---|---|---|---|---|
| Flat | Multi-tenant (ClawNet users) | 1 | 0 | per-heart RAM + signing CPU |
| Delegated | Claude Code Task, LangGraph, AutoGen | 2-3 | 3-20 | delegation cert creation, chain verify |
| Multi-tenant hierarchical | Pulse orgs, ClawNet with sub-agents | 2-4 | 5-50 | cross-tenant isolation, chain depth |
| Ephemeral | Per-task Lambda-style agents | 1-2 | churn | keygen throughput, memory churn |
| Swarm | Research swarms, BLS aggregate | 1 | 100-1000 | pairing ops, coordination |

**The realistic hot path is Delegated** (Claude Code, LangGraph, Pulse, ClawNet orchestration all fit this). Flat is only realistic for multi-tenant hosting. We test delegated first, flat second.

---

## Test matrix (run in this order)

### Test B — 1 parent × 100 delegated children (realistic hot path) — START HERE

One parent heart spawns 100 child hearts via delegation. Each child runs full lifecycle: mutual session, 10 spend events within delegated budget, 1 selective disclosure, 1 revocation.

**Measure:**
- p50/p95/p99 of delegation cert creation (parent signing)
- Per-child birth + keygen cost
- Chain verification cost (depth 2): verify child → parent
- Spend-log contention under concurrent child writes
- Cross-child event isolation (no leak of child A's events to child B)

**Why first:** this is what Claude Code, LangGraph, and Pulse-style systems actually do. If Soma can't handle 1×100 delegation efficiently, the flat number is academic.

**Artifact:** `bench/delegated-100.bench.ts` + perf report.

### Test A — 100 flat hearts (multi-tenant floor) — SECOND

Original plan unchanged. One Node process, 100 concurrent independent `Heart` instances. Each runs full lifecycle:
1. Mutual session handshake (pair with another heart)
2. 10 spend events with delegated budget
3. One selective disclosure proof
4. One revocation event

**Measure:**
- p50/p95/p99 for each op
- Memory per heart (RSS delta / 100)
- Peak signatures per second
- Spend-log append cost as log grows (O(n) risk)
- Canonical-JSON CPU share

**Why second:** establishes per-heart floor cost. Useful as baseline for comparing against delegated hot path.

**Artifact:** `bench/100-hearts.bench.ts` (task #77) + perf report.

### Test C — 10 × 10 hierarchical (multi-tenant hierarchical) — THIRD

10 root hearts, each with 10 children. Tests isolation across tenants + hierarchical chain verification.

**Measure:**
- Cross-tenant leak prevention (tenant A's children can't impersonate tenant B's)
- Chain verification cost at depth 2 across 100 children
- Memory overhead vs 100 flat hearts
- Cert-chain cache effectiveness (verifying same parent cert 10x)

**Why:** simulates ClawNet hosting multiple users who each run delegation systems. Validates isolation + cache behavior.

### Test D — ephemeral spawn/die at 1000/sec — FOURTH

Spawn 1000 short-lived hearts per second, each lives ~100ms, signs one receipt, dies. Parent delegates on spawn.

**Measure:**
- Keygen throughput ceiling (Ed25519 generation cost)
- Memory allocation/deallocation churn
- Receipt durability (do emitted receipts survive heart death?)
- GC pressure

**Why:** per-task agents (Lambda-style, or Claude Code's Task tool at high fan-out) need this pattern. Future scenario from `soma-future-proofing.md` — need to know if we're ready.

### Test E — 10-deep delegation chain (depth stress)

One root, 10 levels deep, single leaf per level. Leaf produces receipt. Verifier walks full chain.

**Measure:**
- Chain verification time vs depth (should be linear)
- Revocation log lookup cost per level
- Memory footprint of deep cert chain

**Why:** establishes hard depth limits. If chain verify at depth 10 exceeds 10ms, cap depth lower.

---

## Phased execution

### Phase A (week 1): Tests B + A
Build both benchmarks. Tests B and A share most infrastructure.

### Phase B (week 2): Fix surfaced bottlenecks

Three likely bottlenecks, in probability order:
1. **tweetnacl is pure-JS** — if signature CPU dominates, swap to libsodium via `CryptoProvider`. Bench README estimates 10-20x speedup.
2. **Spend-log hash-chain verify is O(n)** — may need running HMAC or incremental state.
3. **canonicalJson is called on every sign/verify** — double-check it's not quadratic for nested objects.
4. **Chain verification not cached** — repeatedly verifying same parent cert across 100 children is wasteful.

Only fix what actually surfaces; don't speculate.

### Phase C (week 3): Tests C + E, distributed

Run hierarchical + depth tests across 2 nodes (guardian-vps + one additional). Measures cross-node delegation handshake, clock-skew tolerance on chain timestamps.

**New measurements:**
- Cross-node delegation RTT p95
- Cross-node chain verification (does verifier trust another node's cert chain snapshot?)
- Nonce collisions under concurrent spawn (should be zero with 32-byte nonces)

### Phase D (week 4): Test D + scale-out

Ephemeral churn test at realistic load. If phases A-C are clean, attempt 1000 flat hearts distributed across 10 nodes. Publishable number.

### Phase E (month 2+): Pick one post-scale initiative

In priority order, informed by phases A-D:
- **x402 ETag adoption push** — if throughput is fine, drive external integrations
- **Agent-lineage DAG primitives** — if delegation is the dominant real workload (likely), harden the chain architecture
- **Receipt Layer phases 2-5** — EAS anchoring; on-chain cost dominates, needs per-heart throughput first
- **Dual-sign revival** — design informed by per-heart signature budget
- **PQ crypto migration** — sizing depends on whether Ed25519 is the bottleneck; hybrid signing adds 2-3x cost

---

## What NOT to build until after scale testing

- Additional cryptographic primitives (we have enough to stress-test meaningfully)
- Gossip transport beyond current in-memory stub
- Any on-chain integration
- EigenLayer AVS / TEE attestation wiring (post-scale, see `proof-of-delivery-roadmap.md`)
- BLS aggregate signatures (only needed for swarm topology, Test F+)

---

## Parallel work (different context-switch cost)

- x402 ETag tests + discovery flag + client SDK in **claw-net** repo
- Public doc cleanup per `project_soma_docs_gaps` memory
- Delegation cert spec (design only, no code) — informs Test B implementation

---

## Rationale

Current state (2026-04-04): 935 tests pass, 15-attack harness detects all 8 known attack families. Known gaps (dual-sign dead, birth cert signing incomplete) are NOT on the scale path — they're functional gaps, not throughput gaps.

The topology matrix exists because we realized the flat 100-heart test measures multi-tenant hosting capacity (one dimension), but Claude Code / LangGraph / Pulse-style delegation is the realistic hot path. Running B first tells us if Soma is ready for agent-hierarchy workloads — which is where the actual demand lives.

We scale-test what exists; gaps get filled post-scale when we know which ones are 1x vs 3x problems.
