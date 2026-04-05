# Soma Scale Test Plan

**Status:** active as of 2026-04-04. Supersedes vague "stress test" language elsewhere.

Principle: **scale findings drive the next build phase, not the other way around.** We don't build Receipt Layer / dual-sign / PQ crypto before knowing the single-heart throughput ceiling.

## Sequence

### Phase A — 100 hearts, single process (week 1)

One Node process, 100 concurrent `Heart` instances. Each runs a full lifecycle:
1. Mutual session handshake (pair with another heart)
2. 10 spend events with delegated budget
3. One selective disclosure proof
4. One revocation event

**Measure:**
- p50 / p95 / p99 for each op
- Memory per heart (RSS delta / 100)
- Peak signatures per second
- Spend-log append cost as log grows (O(n) risk)
- Canonical-JSON CPU share

**Artifact:** `bench/100-hearts.bench.ts` + perf report in `bench/reports/`.

### Phase B — fix surfaced bottlenecks (week 2)

Three likely bottlenecks, in probability order:
1. **tweetnacl is pure-JS** — if signature CPU dominates, swap to libsodium via `CryptoProvider`. Bench README estimates 10-20x speedup.
2. **Spend-log hash-chain verify is O(n)** — may need running HMAC or incremental state.
3. **canonicalJson is called on every sign/verify** — double-check it's not quadratic for nested objects.

Only fix what actually surfaces; don't speculate.

### Phase C — 100 hearts, distributed across 2 nodes (week 3)

Split 50/50 across guardian-vps and one additional node. Measures cross-node handshake latency, session drift, clock-skew tolerance on mutual-session transcripts.

**New measurements:**
- Cross-node handshake RTT p95
- Session transcript agreement rate under skew
- Nonce collisions (should be zero with 32-byte nonces — verify)

### Phase D — 1000 hearts distributed (week 4)

10 nodes × 100 hearts. Only attempted if phase C is clean. Publishable number.

### Phase E — pick one post-scale initiative (month 2+)

In priority order, informed by phases A-D:
- **x402 ETag adoption push** — if throughput is fine, drive external integrations
- **Receipt Layer phases 2-5** — EAS anchoring; on-chain cost dominates, needs per-heart throughput first
- **Dual-sign revival** — design informed by per-heart signature budget
- **PQ crypto migration** — sizing depends on whether Ed25519 is the bottleneck; hybrid signing adds 2-3x cost

## What NOT to build until after scale testing

- Additional primitives (we have enough to stress-test meaningfully)
- Gossip transport beyond current in-memory stub
- Any on-chain integration

## Parallel work (different context-switch cost)

- x402 ETag tests + discovery flag + client SDK in **claw-net** repo
- Public doc cleanup per `project_soma_docs_gaps` memory

## Rationale

Current state (2026-04-04): 935 tests pass, 15-attack harness detects all 8 known attack families. Known gaps (dual-sign dead, birth cert signing incomplete) are NOT on the scale path — they're functional gaps, not throughput gaps. We scale-test what exists; gaps get filled post-scale when we know which ones are 1x vs 3x problems.
