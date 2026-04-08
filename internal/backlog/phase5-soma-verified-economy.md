# Phase 5+ — Soma-Verified Agent Economy

**Status:** future consideration. Prerequisites: battle-tested trust scores, proven bond economics, agent lifecycle stability under real traffic.
**Written:** 2026-04-07. Based on brainstorm session after shipping agent lifecycle (Heart-derived wallets, burner agents, death certificates).

---

## Idea 1: Soma-Verified Trading Platform (Anti-Bundler DEX)

### The Problem
Every DEX and token launch platform is trivially Sybil-attackable. Wallet creation is free and anonymous by design. Bundlers spin up thousands of wallets to front-run, sandwich, and rug. Nobody has solved this because no protocol ties identity cost to wallet creation.

### Why Soma Can Solve It
After shipping agent lifecycle, we have primitives nobody else has:

1. **Identity costs something** — every agent needs a Heart with accumulated trust score (can't fake time-in-network)
2. **Bond-backed identity** — credits at stake per agent and per burner
3. **Wallet derivation tied to Heart** — can't spin up anon wallets without a parent identity paying bonds
4. **Death certificates** — reputation persists, clean shutdowns are provable, rug-pulls leave forensic evidence
5. **Trust decay on burners** — ephemeral wallets lose trust fast, preventing wash trading

### How a Bundler Attack Fails
A bundler wanting 1000 wallets would need to:
- Post bonds for every burner wallet it spawns (min 1 credit each = $1,000 at stake)
- Each burner has decaying trust (10 points/hour default), so fresh wallets are untrusted
- Every burner is cryptographically traceable to the parent Heart
- Max 20 active burners per parent — need 50 parent agents to get 1000 wallets
- Each parent needs its own accumulated trust score (can't be farmed overnight)
- Slashing: if any burner is caught misbehaving, parent's bond is slashed AND trust score hit
- Death certificates: if a parent shuts down to avoid slashing, the death cert records final state permanently

**Net effect:** Sybil cost scales linearly with wallet count, trust can't be farmed faster than organic, and every wallet traces back to a bonded identity. First platform where the economic cost of manipulation exceeds the profit.

### $CLAWNET Integration
- Trading fees generate burn pressure (BME model from token-architecture.md)
- Agents stake $CLAWNET for higher trust multipliers
- Trust score affects trading privileges (order size limits, launch participation caps)
- Creates flywheel: more verified agents trading -> more burns -> higher token value -> more agents want trust

### Prerequisites Before Building
- [ ] Trust scores validated under real API traffic (not just test seeds)
- [ ] Bond economics proven — slashing actually deters, bonds aren't just a cost of doing business
- [ ] Agent lifecycle stable for 3+ months in production
- [ ] $CLAWNET token launched (needs $50-100K/mo revenue trigger per token-architecture.md)
- [ ] Legal review of trading platform regulatory requirements
- [ ] Smart contract audit for on-chain bond/slash mechanics

---

## Idea 2: Continuous Computation Witness (Blacksmith Model)

### The Concept
Current state: Heart signs birth certificates (data origin) and computation certificates (endpoint-level). This proves "this endpoint was called and returned X."

The deeper vision: a **continuous computation witness** that observes every step an agent takes — every API call, every LLM inference, every tool use — and produces a verifiable proof of the entire execution trace.

Analogy: the blacksmith doesn't just stamp the finished sword. The blacksmith watches every hammer blow, every fold of the steel, every quench. The final proof attests to the entire process, not just the output.

### Architecture Options

**Option A: Separate AI observer (expensive)**
- A dedicated LLM watches all agent actions in real-time
- Produces natural language + structured attestations of what happened
- Problem: doubles compute cost, adds latency, observer itself needs trust

**Option B: Heart as native witness (preferred)**
- Heart already sits inside the agent — it sees everything
- Instead of a separate AI, Heart emits structured trace events automatically
- Events get hashed into a Merkle tree of computation
- Root hash proves entire execution trace without revealing it
- Lightweight: hash operations, not LLM inference

**Option C: Hybrid — trace + selective AI digest**
- Heart captures all trace events (cheap, deterministic)
- Periodically, an AI summarizes trace windows into "computation summaries"
- Summaries are human-readable but backed by cryptographic trace
- Best of both: full proof chain + interpretable output

### Tokenized Work Units
Each verified computation unit could map to:
- Trust score increments (more verified work = higher trust)
- $CLAWNET earning potential (proof-of-computation as mining analog)
- Trading privilege unlocks on the Soma-verified platform
- Reputation that persists through death certificates and succession

### Resource Considerations
- Trace-level hashing: ~270K hashes/sec (from our benchmarks) — negligible overhead
- Merkle tree construction: O(n log n) for n events — sub-millisecond for typical agent sessions
- Storage: Merkle roots only (32 bytes per computation batch), full traces optional
- AI digest (Option C): run periodically (every N events), not on every action

### Relationship to Existing Primitives
- Birth certificates: prove data origin (Phase 1 — DONE)
- Computation certificates: prove endpoint was called (DONE)
- **Computation traces: prove HOW the result was produced (this idea)**
- Receipts: bind payment to computation (DONE)
- **Trace receipts: bind payment to verified execution trace (extension of this idea)**

### Prerequisites
- [ ] Define trace event schema (what constitutes a "computation step")
- [ ] Implement Merkle tree accumulator in soma-heart
- [ ] Benchmark overhead under real agent workloads
- [ ] Design selective disclosure (prove specific steps without revealing full trace)
- [ ] ZK considerations: can we prove computation properties without revealing the computation itself?

---

## Sequencing

```
Current (shipped):
  Agent Lifecycle: identity -> wallets -> burners -> death certs
  Soma: birth certs -> computation certs -> receipts

Phase 3 (next):
  Deepen computation proofs (trace-level attestation)
  Merkle computation trees in Heart

Phase 4:
  $CLAWNET token launch (after revenue milestone)
  On-chain receipts via EAS on Base

Phase 5+:
  Soma-verified trading platform
  Anti-bundler mechanics via trust-gated trading
  Proof-of-computation as mining analog
```

---

## Why This Matters Strategically

No other protocol has:
1. Identity that costs something (Heart + bonds)
2. Wallet derivation tied to identity (can't create anon wallets cheaply)
3. Trust that decays on ephemeral identities (anti-Sybil)
4. Continuous computation witness (proof of how, not just what)
5. Death certificates with succession (reputation outlives agents)

Combining all five creates a **verified agent economy** — the first platform where AI agents can trade, transact, and collaborate with cryptographic guarantees against manipulation. This is what makes Soma category-defining rather than just "another verification layer."
