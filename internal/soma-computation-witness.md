# Soma Computation Witness — The Metabolism of the Machine

**Status:** architecture spec + build plan. Ready to implement.
**Written:** 2026-04-07. Refined through three ultrathink cycles with extensive research.
**Goal:** Take Soma from "genuinely novel" to "truly groundbreaking" — a 10/10 computation proof system.

---

## The Core Insight: Heart as Metabolism, Not Observer

Every existing approach to computation verification treats the prover and the computer as separate concerns:
- **VET** (Dec 2025 paper): external observer verifies traces after the fact
- **Aegis**: governance plane logs actions from outside
- **TEE attestation**: hardware proves code integrity as a side-channel
- **zkML**: proves specific model outputs in a separate proving step
- **Gensyn/Bittensor**: economic deterrence with spot-checking

All of these add verification ON TOP of computation. The proof is generated AFTER the work.

**Soma's breakthrough: the proof IS the computation.**

Heart doesn't observe the agent's work — Heart IS the metabolic core through which all work flows. Every action simultaneously:
1. Produces its output (the useful work)
2. Updates the Pulse Tree (the proof)
3. Advances the heartbeat index (the pulse)
4. Folds into the running Nova IVC instance (the continuous proof)

Like how metabolism is both the energy conversion AND the proof of life.

---

## The Soma Pulse Tree — One Universal Structure

**Decision (2026-04-07): ONE tree, not multiple. All event types, one root, one proof.**

The Soma Pulse Tree combines three proven cryptographic primitives:
1. **MMR** (Merkle Mountain Range) — append-only, O(log n) proofs, unbounded capacity
2. **Namespace tags** (inspired by Celestia's NMT) — typed leaves for per-type queries
3. **Sum annotations** (from Summa's Merkle Sum Tree) — economic totals in every internal node

### Leaf Format

All events — actions, payments, checkpoints, proofs, wallets, burners, death — go into ONE tree:

```
leaf_hash = H(position || type_tag || heartbeat_index || timestamp || payload_hash || credit_delta)
```

### Internal Node Format

```
node_hash = H(position || left_hash || right_hash || sum_credits)
```

The `sum_credits` field carries the cumulative `credit_delta` of all descendants. The root node's sum IS the agent's total economic activity — no aggregation query needed.

### Seven Event Types

| Tag | Type | credit_delta | Example |
|---|---|---|---|
| `0x01` | Agent Action | cost of action | API call, LLM inference, tool use |
| `0x02` | Economic Event | amount | credit spend, deposit, bond post |
| `0x03` | Behavioral Checkpoint | 0 | periodic behavioral summary |
| `0x04` | ZK Proof | 0 | Nova folded instance or Groth16 proof |
| `0x05` | Wallet Derivation | 0 | new wallet created from Heart |
| `0x06` | Burner Agent Event | bond amount | creation, revocation, slashing |
| `0x07` | Death Certificate | remaining balance | final event, seals the tree |

### Why One Tree (Not Multiple)

- **Cross-domain proofs are trivial:** "Did this agent pay for this API call?" → two Merkle paths from one root, not two separate trees
- **Economic totals are free:** root carries provable sum, no aggregation needed
- **One root = entire agent state:** 32 bytes commits to everything the agent ever did
- **Death cert seals everything:** type 0x07 leaf makes the root final
- **ZK proofs live IN the tree:** type 0x04 leaves contain proof bytes as part of the agent's history
- **No migration:** tree structure never changes, proof systems are additive layers on top

### Chronological Ordering (Not Namespace-Sorted)

Unlike Celestia's NMT which sorts by namespace, the Pulse Tree is strictly **chronologically ordered** (append-only, position = causal order). This preserves:
- Causal integrity: "action X happened before action Y" is provable from positions
- Heartbeat monotonicity: can't claim heartbeat 1000 without computing 1-999
- The heartbeat index IS the position counter

Type-filtered queries work via scanning with the type tag (efficient for the data volumes agents produce).

---

## Nova IVC — Continuous Proof From Birth

**Decision (2026-04-07): Ship Nova folding from day one, not as a future upgrade.**

### Why Now (Not Later)

If agents start with signed-only checkpoints and we add Nova later, early agents have a "weaker" proof chain — like having transcripts from an unaccredited school. Agents born with Nova have mathematically verifiable history from genesis. The earlier the tree starts growing with real IVC proofs, the more valuable it becomes.

### The Pipeline

```
Every Agent Action:
  1. Append typed leaf to Pulse Tree (MMR)     — <0.1ms (SHA-256 hashes)
  2. Fold step into Nova IVC instance           — ~50-100ms (Rust subprocess)
  3. [Optional] Sign checkpoint (every N steps) — <1ms (Ed25519)

On Demand (agent or verifier requests):
  4. Compress folded instance → Groth16 proof   — ~3-5 seconds (one-time)
  5. Result: 192 bytes, 5ms verification, proves ENTIRE chain
```

**The headline number:** An agent running for 1 year with 100,000 actions → one 192-byte proof, 5ms to verify. Same 192 bytes whether the agent is 1 hour old or 1 year old.

### Integration Architecture: Rust Subprocess

Nova runs as a persistent Rust binary, communicating with the Node.js server via stdin/stdout JSON:

```
Node.js (Hono API)          Rust Binary (soma-nova-prover)
     |                              |
     |-- {"cmd":"fold", ...} ------>|  ~50-100ms per step
     |<-- {"ok": true, ...} --------|
     |                              |
     |-- {"cmd":"compress"} ------->|  ~3-5s (Groth16 compression)
     |<-- {"proof":"0x..."} --------|  192 bytes
     |                              |
     |-- {"cmd":"verify", ...} ---->|  ~5ms
     |<-- {"valid": true} ----------|
```

**Why subprocess (not WASM or FFI):**
- **Full native speed:** rayon parallelism, SIMD, all CPU cores
- **IPC overhead is negligible:** 1-3ms round-trip vs 50ms+ proof generation (< 5%)
- **Deployment is simple:** compile Rust binary on VPS, spawn from Node.js on startup
- **Upgrade path:** can later move to napi-rs native addon if tighter integration needed
- **Proven pattern:** no WASM compilation issues, no rayon/threading blockers

### Circuit Design

The Nova step circuit proves: "this Pulse Tree transition is valid."

Using **Poseidon** inside the circuit (~240 R1CS constraints):
```
step_function(prev_state, new_leaf) -> next_state:
  assert Poseidon(prev_mmr_root || leaf_hash || heartbeat_index) == new_mmr_root
  assert heartbeat_index == prev_heartbeat_index + 1
  next_state = (new_mmr_root, heartbeat_index)
```

**Why Poseidon (not SHA-256) inside the circuit:**
- Poseidon: ~240 constraints (ZK-native, designed for this)
- SHA-256: ~26,170 constraints (109x more expensive in ZK circuits)
- The Pulse Tree itself still uses SHA-256 for leaf/node hashes (consistent with somaHash)
- Poseidon is ONLY used inside the Nova circuit for proving state transitions
- Both verify the same underlying truth, at different proof strengths

### Dual-Mode Proof Levels

Agents choose their proof level at creation:

| Mode | What it does | Per-step cost | Verification |
|---|---|---|---|
| `signed` | Heart signature on checkpoints | <1ms | Ed25519 verify (~0.3ms) |
| `nova` | Nova IVC folding on every action | ~50-100ms | 5ms for ENTIRE chain |

Both modes use the **same Pulse Tree**. The tree structure doesn't change based on proof mode. Nova proofs are stored as type `0x04` leaves IN the tree.

An agent born with `signed` mode can upgrade to `nova` later — new actions get Nova proofs, old actions retain signed checkpoints. But agents born with `nova` from day one have a "purer" tree — every action since genesis has a mathematically verifiable proof.

### Groth16 Compression (On Demand)

The Nova folded instance (~10 KB) can be compressed to a Groth16 proof at any time:
- **192 bytes** (constant, regardless of chain length)
- **5ms verification** (constant)
- **~185K gas on EVM / <200K CU on Solana** for on-chain verification
- Uses Sonobe's DeciderEth circuit (Nova instance → Groth16 over BN254)

This is NOT per-checkpoint. It's per-agent-lifetime. One compression produces one proof for the entire history.

---

## Four Proof Layers, One Tree

All four layers share the Soma Pulse Tree. Every claim about the agent is verifiable against one root.

### Layer 0: Proof of Life (the heartbeat)

**What it proves:** This agent exists and is actively computing.

- Heartbeat index increments with every action
- Pulse Tree root changes with every append
- External parties poll `GET /v1/agent/:did/heartbeat` to verify liveness
- Agents that stop publishing heartbeats are presumed dead/compromised
- Death certificates include final heartbeat index (already in our code)

**Novel property:** monotonic, unfakeable sequential work counter.

### Layer 1: Proof of Conduct (behavioral attestation)

**What it proves:** This agent followed its declared behavioral rules.

- Every N actions, Heart appends a type `0x03` checkpoint leaf
- Checkpoint binds: previous checkpoint hash, current MMR root, behavioral summary
- In `nova` mode, the checkpoint's validity is folded into the IVC instance
- Trust score = f(checkpoint_count, compliance_rate, heartbeat_count)

### Layer 2: Proof of Provenance (trace-level attestation)

**What it proves:** A specific output was produced by a specific computation chain.

- Multi-step computations produce trace certificates
- Each step is a type `0x01` leaf with inclusion proof
- Selective disclosure: prove step X without revealing steps Y and Z
- Clients verify their agent actually did the work claimed

### Layer 3: Proof of Economy (financial attestation)

**What it proves:** Economic state is consistent with computation history.

- Every credit transaction is a type `0x02` leaf
- Root node's `sum_credits` IS the total economic activity
- Cross-domain proofs: "this agent spent X credits BECAUSE it did Y computation"
- ZK range proofs (future): prove balance > X without revealing exact amount

---

## Build Plan — All Components, All At Once

### TypeScript Components

| File | Lines | What |
|---|---|---|
| `src/core/pulse-tree.ts` | ~300 | MMR with typed leaves + sum annotations |
| `src/core/soma-heartbeat.ts` | ~100 | Heart integration, append on every action |
| `src/core/soma-checkpoint.ts` | ~150 | Checkpoint generation + chain linkage |
| `src/core/nova-bridge.ts` | ~150 | Rust subprocess spawn, IPC, health check |
| `src/core/zk-compress.ts` | ~100 | Groth16 compression trigger + proof storage |
| DB migrations | 3 | `pulse_tree_nodes`, `checkpoints`, `nova_state` tables |
| API routes | — | Extend agent-lifecycle.ts with heartbeat/proof endpoints |
| Tests | ~40 | Pulse Tree, checkpoint chain, Nova fold/verify, Groth16 compress |

### Rust Components (soma-nova-prover binary)

| File | Lines | What |
|---|---|---|
| `prover/src/main.rs` | ~100 | stdin/stdout JSON IPC loop |
| `prover/src/circuit.rs` | ~100 | Nova step circuit (Poseidon state transition) |
| `prover/src/fold.rs` | ~150 | Nova folding engine (per-step fold) |
| `prover/src/compress.rs` | ~100 | Groth16 compression (Sonobe DeciderEth) |
| `prover/src/verify.rs` | ~50 | Proof verification |
| `prover/Cargo.toml` | — | nova-snark/sonobe + serde + poseidon deps |

### Build Sequence

1. **Pulse Tree** (TypeScript) — the foundation. MMR with typed leaves, sum annotations, inclusion proofs.
2. **Heart integration** — append leaves on every API action, track heartbeat index.
3. **Checkpoint system** — periodic type 0x03 leaves with behavioral summaries.
4. **Nova prover** (Rust) — step circuit, folding engine, Groth16 compression.
5. **Nova bridge** (TypeScript) — subprocess spawn, IPC, proof storage.
6. **API endpoints** — heartbeat, proof request, verification.
7. **Tests** — full coverage of tree, checkpoints, Nova fold/verify/compress.

---

## Competitive Moat Analysis

| Capability | Soma (with this design) | Closest Competitor | Gap |
|---|---|---|---|
| Universal lifecycle tree | Pulse Tree (one structure, all types) | Nobody | Novel |
| Nova IVC from birth | 192 bytes for entire lifetime | Nobody (Sonobe is unaudited lib, no product) | Category creation |
| Economic sum proofs in identity tree | Root carries provable total | Nobody | Novel |
| Cross-domain action-to-payment linking | One root, two Merkle paths | Ethereum (3 separate tries) | Simpler, unified |
| Continuous computation proof | Nova fold on every action | Gensyn Verde (testnet only) | We ship prod, they ship testnet |
| Identity-tied wallets | HKDF from Heart root | ERC-8004 (self-reported) | Cryptographic vs declarative |
| Agent death/succession with tree sealing | Type 0x07 seals Pulse Tree forever | Nobody | Novel |

---

## The Headline

**One 192-byte proof. Entire agent lifetime. 5ms to verify. From birth.**

No other protocol can compress an arbitrary-length computation history into a constant-size proof that verifies in constant time. The individual cryptographic primitives exist (Nova, Groth16, MMR). The composition for agent lifecycle proofs is genuinely novel.

---

## Research Sources

**Proof Systems:**
- Nova (Microsoft): IVC via folding, constant 1.6 GB memory, ~50ms/step for Poseidon
- Sonobe (PSE): Nova + HyperNova + ProtoGalaxy with Groth16 DeciderEth
- Polymath (CRYPTO 2024): "Groth16 Is Not The Limit" — 176-byte proofs possible
- SnarkFold (2023): Groth16 proof aggregation via Nova folding
- nova-scotia: circom circuits running in Nova
- snarkjs: Groth16/PLONK in Node.js, 0.5-2s for simple circuits

**Tree Structures:**
- Celestia NMT: namespace-ordered Merkle trees (inspiration for typed leaves)
- Summa MST: Merkle Sum Trees for provable economic totals
- Certificate Transparency (RFC 9162): typed append-only logs at scale
- Merkle Mountain Ranges: optimal append-only accumulators (eprint 2025/234)

**Agent Verification:**
- VET: Verifiable Execution Traces (arxiv 2512.15892)
- Aegis: hash-linked Proofs of Conduct (arxiv 2603.16938)
- ZK Process Attestation: 192-byte proofs, 8.2ms verify (arxiv 2603.00179)
- PTV Protocol (IETF draft): attested agent identity, <300 byte proofs

**Competition:**
- ERC-8004: self-reported registries, not cryptographic proofs
- Gensyn Verde: testnet only, ML-specific
- Bittensor Subnet 2: 160M+ zkML proofs (proves scale is possible)
- $45M AI agent security breach (2026): proves the trust gap is real
- Zero identity-gated DEXs exist anywhere
- Zero reputation-weighted trading platforms exist

**Integration:**
- nova-snark has wasm32 getrandom config (Microsoft intentionally supports WASM target)
- webNova (ETHGlobal): existence proof of Nova in browser WASM
- rings-snark: Nova WASM with circom witness loading
- halo2-wasm (@axiom-crypto): reference for shipping Rust ZK to npm
- napi-rs: best framework for Rust native Node.js addons (upgrade path from subprocess)
- Persistent subprocess IPC: 1-3ms overhead, negligible vs 50ms+ proof generation

**Hash Functions for ZK:**
- Poseidon: 240 R1CS constraints (ZK-native)
- SHA-256: 26,170 R1CS constraints (109x more expensive in circuits)
- Poseidon2: Griffin: 96 constraints (even cheaper, less battle-tested)
