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

## Delegation chain architecture (implementation spec)

This is the concrete design for the agent-lineage DAG gap. Fulfills: delegated children, ephemeral agents, proof-of-computation chains, revocation propagation.

### Design decision: children get their own hearts

When parent agent P spawns child C, each gets own keypair + own heart. **Not** shared heart, **not** session keys only. Reasons:
- Selective disclosure remains possible per-child
- Parent signs once (birth cert) instead of signing every child event
- Child can spawn grandchild without round-trip to parent
- Matches existing Soma primitives (DIDs, birth certs, revocation log)
- Preserves observer-sovereignty principle per-child

Session keys are a complement, not a replacement — used for ephemeral one-shot tasks that don't need full identity.

### Delegation cert format

```typescript
interface DelegationCert {
  parent_did: string;              // did:key:... or did:pkh:...
  child_did: string;               // did:key derived from child_pubkey
  child_pubkey: Uint8Array;        // Ed25519 or post-quantum
  scope: string[];                 // capability tokens, e.g. ["call:endpoint:*"]
  spend_limit?: number;            // USDC budget (optional)
  expiry: number;                  // unix timestamp
  nonce: string;                   // 32 bytes, prevents replay
  issued_at: number;
  parent_signature: Uint8Array;    // parent signs canonicalJson of above fields
  parent_chain_hash?: string;      // set if parent is itself delegated (chain link)
}
```

Scope strings are capability tokens parsed by verifier. Wildcards allowed (`call:endpoint:*`). Scope is INTERSECTED with parent's scope — child can never exceed parent's authority.

### Proof-of-computation chain

When child C produces data D:
1. C computes D (any work)
2. C signs receipt(D) with C's heart — includes C's DID
3. receipt embeds C's birth cert (which contains parent's delegation to C)
4. C's delegation is signed by B (C's parent)
5. B's delegation is signed by A (B's parent, or root)

**Verifier flow (given: D, receipt, chain, root_pubkey):**
```
verify(D, receipt(D, C), chain=[C_cert, B_cert, A_cert], root=A.pubkey):
  1. verify sig(D) against C.pubkey             — D came from C
  2. verify sig(C_cert) against B.pubkey         — B delegated to C
  3. verify sig(B_cert) against A.pubkey         — A delegated to B
  4. assert A.pubkey == root                     — trust anchor
  5. for each link in chain:
       check revocation log for link's DID
       check expiry not passed
       check scope intersection valid
  6. return verified if all pass
```

Verifier only needs to trust root A's public key. Everything else is cryptographically derivable.

### Chain constraints

- **No hard depth limit.** Reasoning: a hard cap ("max 10 levels") presumes we can imagine the agent topologies of 2030. We can't. Agents may recursively self-improve, spawn deep delegation trees, compose across generations. A hard cap would become a future-limiting bottleneck.
- **Soft limit:** warn at depth 100, never fail on depth alone.
- **Verification cost:** O(depth) naively, O(1) with SNARK compression (see below).
- **Practical depth today:** 3-5 covers 99% of real systems (Claude Code, LangGraph, Pulse). Plan for 10-100+.
- **Scope monotonicity:** each level's scope ⊆ parent's scope (enforced at verification)
- **Spend monotonicity:** each level's spend_limit ≤ parent's spend_limit

### SNARK-compressed chains (removes depth as a verification bottleneck)

Without compression, verifying a depth-N chain costs N signature verifications. At depth 100, that's ~10ms — unacceptable for high-frequency agents.

**Solution: recursive SNARKs.** Each delegation link includes a succinct proof that "this link is valid AND parent link was valid." Verifier checks one SNARK, gets proof of entire chain validity.

- **Constant-time verification:** O(1) regardless of depth
- **Verdict cost:** single SNARK verify ~1-5ms (Nova/SuperNova/Sangria range)
- **Proof size:** constant ~200-500 bytes regardless of chain depth
- **Enables:** infinite delegation depth, recursive self-improvement chains, multi-generation agents

**Fallback without SNARKs (staged rollout):**
1. **Cached chain verification:** verifier caches verified parent certs, reuses across siblings. Cuts N→M where M = unique ancestors.
2. **Batched verify via BLS:** verify N siblings' chains in one pairing op.
3. **Progressive verify:** verify latest 5 links strictly, Merkle-proof the rest against trusted intermediate.
4. **Revocation bloom filter:** O(1) revocation check with <1% false positive; fall back to full log only on hit.

**Implementation sequence:**
- Phase 1: Native chain verify with caching (MVP, no SNARKs)
- Phase 2: BLS batch verify for siblings
- Phase 3: SNARK wrapper (Nova/Sangria), opt-in
- Phase 4: SNARK-by-default, native as fallback for non-SNARK verifiers

### Low-compute / edge verification target

**Target:** verify any receipt in <10ms on Raspberry Pi Zero (1GHz ARM, 512MB RAM).

Enables:
- Browser extension verifying every API response (zero user perception)
- Mobile agents verifying inbound data
- IoT-scale agent networks
- Offline verification (bundle revocation snapshot + SNARK chain)

Techniques:
- Precompiled verifier in WASM (ships in browser, mobile runtime)
- Bloom filter for revocation (O(1) with <1% false positive)
- Verdict caching per-agent per-TTL window
- SNARK compression for constant-time verify at any depth

### Revocation propagation

Revoke parent → all descendants implicitly revoked.

Verifier MUST check revocation log for every ancestor in the chain, not just direct signer. This is non-negotiable for security.

**Revocation log entry:**
```typescript
{ did: "did:key:parent", revoked_at: unix_ts, reason?: string, signed_by: parent_key }
```

When P is revoked at time T:
- receipts produced by P's descendants AFTER time T are invalid
- receipts produced BEFORE time T remain valid (time-bounded revocation)
- grace period: configurable clock-skew tolerance (default 60s)

### Storage model

Delegation cert stored in CHILD's birth cert. Verifier only needs:
- receipt bytes
- chain of delegation certs (bundled with receipt)
- root pubkey (out-of-band trust)
- access to revocation log (Soma sensorium has it)

No database lookup required for chain verification itself. Only revocation log requires live state.

### Primitives needed to implement

1. `Heart.delegate(child_did, child_pubkey, scope, spend_limit, expiry) → DelegationCert`
2. `Heart.spawn(scope, spend_limit, expiry) → { childHeart, delegationCert }` — convenience
3. `Sense.verifyChain(receipt, chain, rootPubkey) → VerdictWithChain`
4. `Sense.walkRevocation(chain) → { allLive: boolean, revokedDids: string[] }`
5. Scope parser + intersection algorithm
6. `RevocationLog.checkMany(dids) → Map<did, revokedAt?>`

### Ties to future scenarios

| Scenario | How chain primitives handle it |
|---|---|
| Claude Code spawns 50 Tasks | Root = user's agent, tasks = delegated children, receipts chain back |
| LangGraph orchestrator + workers | Orchestrator = root, workers = peers with common root |
| Self-modifying agent (v1 → v2) | v1 signs birth cert for v2 (genome evolution = special delegation) |
| Ephemeral task agent (30s TTL) | Short-lived delegation with 30s expiry, keypair discarded after |
| On-chain autonomous agent | did:pkh as root, contract signs via contract key |
| Swarm with BLS | Individual signs own delegation, BLS aggregate for collective decisions |

### What we haven't decided (needs thought during Phase A)

- **Cert size budget:** target <4KB per chain at depth 5 (affects receipt payload size)
- **Caching strategy:** verifier should cache verified chains (parent cert verified once, reused for 100 siblings)
- **Cross-tenant chain sharing:** if tenant A's child is also tenant B's grandchild (unusual), how?
- **Revocation timing proofs:** verifier needs to know "was X revoked AT the time of the receipt" — requires trusted timestamp

---

## Decisions locked in

- **Positioning:** "Identity layer for agentic computation" — never tie the pitch to LLMs specifically
- **Design principle:** Assume everything changes EXCEPT the thesis. Build primitives, not products.
- **Crypto-agility:** Non-negotiable. Every signature/hash algorithm must be swappable.
- **DID-agility:** Non-negotiable. Any DID scheme must be pluggable.
- **Observer sovereignty:** Non-negotiable. Verifier controls verification, forever.
- **Delegation topology:** children get own hearts, not shared. Chain is append-only.
- **Verification trust model:** only trust root pubkey out-of-band; chain self-verifies.
