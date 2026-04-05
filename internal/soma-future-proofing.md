# Soma Future-Proofing — positioning across agent evolution

**Status:** internal strategy. Not public yet (will extract polished marketing narrative later).

**Last updated:** 2026-04-04.

---

## The core thesis (never changes)

> **Identity = cryptographic attestation of a computation, verified by a sovereign observer.**

This sentence is Soma's invariant. Everything below is implementation detail that evolves under it.

Soma's competitive position for the NEXT DECADE depends on this thesis staying coherent as agents change. The architecture today was designed knowing the primitives WILL change.

---

## Six dimensions of agent evolution

Each dimension has: what changes, how today's Soma handles it, the gap.

### 1. Unit of computation

**Spectrum:** LLM tokens → tool-call actions → video frames → continuous latent streams → sensor events → physical actuations

**Today:** Per-token HMAC on LLM tokens (soma-heart runtime wraps the model).

**Handled by current arch:**
- Birth certificates attest per-event, not fundamentally per-token
- CryptoProvider abstracts the HMAC itself

**Gap:** The NAME "per-token HMAC" bakes in the LLM assumption. Abstract conceptually to "per-computation-event HMAC." Event type is pluggable: token, action, frame, sensor-reading, decision.

**Action:** Rename internally when convenient (non-breaking). Publish positioning as "per-event attestation, where event is any unit of computation."

### 2. Identity model

**Spectrum:** Single agent (one DID, one keypair) → swarms (thousands of tiny agents) → collective (DAOs own the identity) → self-modifying (agent rewrites itself) → ephemeral (agent spawned+dies per-task)

**Today:** Single-DID model. Threshold signing (3-of-5 Ed25519) exists. DID method registry supports did:key/did:pkh/did:web.

**Handled by current arch:**
- Threshold signing = proto collective identity
- DidMethodRegistry = any identity scheme pluggable

**Gaps:**
- **No genome evolution chain.** Self-modifying agents need KERI-style versioning on genome, not just keys.
- **No aggregate signatures.** Swarm identity needs BLS or similar — "this message is from someone in the swarm, without revealing who."
- **No just-in-time identity.** Ephemeral agents need one-shot attestation (sign, use, discard).

**Actions:**
- Design genome evolution as a rotation chain (analogous to KERI key rotation but for genome)
- Add BLS or Schnorr-based aggregate signatures to CryptoProvider
- Document "ephemeral heart" pattern: spawn, attest, emit receipt, die

### 3. Cryptographic primitives

**Spectrum:** Ed25519/X25519 → ML-DSA/ML-KEM (PQ) → hybrid (dual-sign) → novel post-PQ → homomorphic / ZK-native

**Today:** CryptoProvider abstracts signing, hashing, KDF. ML-DSA-65 stub exists (hybrid scaffolding). SHA-256 throughout.

**Handled by current arch:**
- Algorithm swap is a config change, not a rewrite
- Genome includes algorithm identifiers (crypto-agile by design)

**Gaps:**
- PQ migration incomplete (stub only)
- Dual-sign is flagged "dead" per security audit
- No ZK-proof primitives yet (for privacy-preserving identity)

**Actions:**
- Complete PQ migration (Tier 4 post-scale)
- Revive dual-sign (post-scale, informed by throughput data)
- Add ZK-proof hooks to the attestation layer (research-level)

### 4. Observer model

**Spectrum:** Human dev → another AI agent → DAO contract → on-chain smart contract → TEE-attested oracle → threshold of observers

**Today:** Heart/sense split means ANY observer can run sensing. Sensorium is local to the observer's machine.

**Handled by current arch:**
- Observer sovereignty principle: verification stays on the verifier's side
- Heart never self-verifies; sense never runs in-process with heart
- Verdict signing already supports arbitrary observer keys

**Gaps:**
- TEE attestation hooks exist as stubs, not wired to real enclaves (Intel SGX, AMD SEV, Arm CCA, AWS Nitro)
- No on-chain verifier contract templates (verify verdicts in Solidity / Move / Rust-CW)
- No threshold-of-observers verification (k observers must agree)

**Actions:**
- Wire one real TEE (Nitro likely easiest) end-to-end
- Publish Solidity reference contract for on-chain verdict verification
- Add threshold-verdict aggregation primitive

### 5. Temporal scale

**Spectrum:** Single call → session → task-lifetime → days → months → years → multi-generation (agents spawning agents)

**Today:** KERI pre-rotation supports long-horizon identity. Spend log is hash-chained. Receipts include timestamps.

**Handled by current arch:**
- Key rotation scales to indefinite lifetimes
- Append-only revocation log
- Timestamps on all receipts

**Gaps:**
- No durable store for multi-year key histories (currently in-memory + persistable)
- No "agent lineage" concept (agent A spawns agent B; need parent-child identity chain)
- Clock-skew tolerance is per-session, not cross-generation

**Actions:**
- Design agent-lineage DAG primitive (who spawned whom)
- Add trusted-time oracle integration for multi-year timestamp anchoring
- Integrate Receipt Layer anchoring to Base/EAS for cross-generation durability

### 6. Modality

**Spectrum:** Language-only → code/tools → images → audio → video → 3D/world models → physical actuation

**Today:** Temporal fingerprinting and behavioral landscape assume LLM-like latency/choice patterns.

**Handled by current arch:**
- Statistical framework (distributions, landscapes) is modality-independent
- Birth certificates don't care what the content is

**Gaps:**
- Feature extractors hard-coded for LLM patterns
- No modality registry ("this agent operates in vision+action")
- No cross-modal behavioral fingerprint

**Actions:**
- Make feature extractors pluggable (FeatureExtractor interface)
- Ship reference extractors for: LLM tokens, tool-call graphs, action sequences, video frames
- Add modality declaration to genome

---

## Scenarios we must handle (concrete futures)

### Scenario: Tokenless agents (continuous/diffusion-based)

Agents emit continuous latent streams, not discrete tokens. Per-token HMAC meaningless.

**Soma response:** Event-unit abstraction + modality-pluggable feature extractors. Emit HMAC per "reasoning step" or "latent batch" defined by the model's own update cadence.

### Scenario: Agent swarms (1000s of coordinated micro-agents)

Thousands of tiny specialists coordinating. Per-agent identity impractical.

**Soma response:** Aggregate signatures (BLS), swarm DIDs, threshold attestation. Swarm presents collective identity; individuals prove membership without revealing which member.

### Scenario: Self-modifying agents

Agent rewrites its own weights/code between sessions. Genome evolves.

**Soma response:** Genome evolution chain (KERI-style). Each genome version commits to the next. Observer verifies lineage. Old receipts remain valid under old genome versions.

### Scenario: Ephemeral task agents

Agent spawned per-task, lives 30 seconds, dies. No long-term identity.

**Soma response:** Just-in-time identity: spawn generates DID, signs attestations, emits receipts, dies. Parent agent's identity chains to child via lineage DAG. Child's DID is self-contained.

### Scenario: Hardware-embodied agents (robots/drones)

Actions are physical, not digital. Sensor/actuator events.

**Soma response:** Sensor-event HMAC (same primitive, different event type). Feature extractor for action sequences. TEE attestation from sensor hardware.

### Scenario: On-chain agents (autonomous smart contracts)

Agent logic runs on-chain; identity is a contract address.

**Soma response:** did:pkh already covers this. On-chain verdict contracts verify Soma attestations. Smart contract IS both agent and observer.

### Scenario: Post-transformer architectures (Mamba, SSMs, novel)

Fingerprinting techniques tuned to transformers don't generalize.

**Soma response:** Architecture-agnostic statistical framework (already present). Swap feature extractors. Behavioral landscape measures distributions, doesn't care about underlying architecture.

### Scenario: Quantum computing breaks Ed25519

Shor's algorithm compromises current signatures.

**Soma response:** Crypto-agility already in place. Migrate to ML-DSA (PQ), dual-sign during transition, retire Ed25519. Existing signed artifacts remain verifiable via archived public keys.

---

## Positioning narrative (external)

**One-liner:** "Soma is the identity layer for agentic computation — architecture-independent by design."

**Full pitch:**
> Soma doesn't care what kind of agent you build. If it computes, it has an identity we can attest to.
> 
> Current LLM agents today. Tool-orchestrating agents (Claude Code, Devin) now. Swarms, collectives, self-modifying agents next. Robotic and embodied agents after that. The form changes; Soma's primitives compose to cover every case.
> 
> We designed Soma knowing the primitives WILL change. Crypto-agility means signature algorithms are config, not code. DID-agility means identity schemes plug in without rewrites. Observer sovereignty means the verifier controls verification, forever. Heart/sense separation means the subject never verifies itself.
> 
> Soma stays 10/10 as agents evolve because its thesis is architecture-independent. Everything else is swappable.

---

## Gaps prioritized (add to build order post-scale)

**Post-scale Tier A (must-have for 10/10 future-readiness):**
1. Complete PQ migration (ML-DSA-65 full, not stub)
2. Event-unit abstraction (rename per-token HMAC conceptually)
3. Genome evolution chain (self-modifying agents)
4. Real TEE integration (Nitro end-to-end)

**Post-scale Tier B (strategic positioning):**
5. Aggregate signatures (swarm identity)
6. Agent-lineage DAG (parent-child spawning)
7. Feature-extractor plugin interface (modality-agnostic fingerprinting)
8. Ephemeral heart pattern (just-in-time identity)

**Post-scale Tier C (research-level):**
9. ZK-proof primitives (privacy-preserving attestation)
10. On-chain verdict contracts (Solidity/Move reference)
11. Threshold-of-observers verification
12. Trusted-time oracle integration

---

## Decisions locked in

- **Positioning:** "Identity layer for agentic computation" — never tie the pitch to LLMs specifically
- **Design principle:** Assume everything changes EXCEPT the thesis. Build primitives, not products.
- **Crypto-agility:** Non-negotiable. Every signature/hash algorithm must be swappable.
- **DID-agility:** Non-negotiable. Any DID scheme must be pluggable.
- **Observer sovereignty:** Non-negotiable. Verifier controls verification, forever.
