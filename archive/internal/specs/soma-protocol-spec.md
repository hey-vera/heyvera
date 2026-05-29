# Soma Protocol — Coding Specification

> The trust layer of the agentic internet.
> Written 2026-05-20. Synthesized from three-round deep-think sessions + vision documents.
> This spec builds the PROTOCOL. The platform spec (`heyvera-v1-spec.md`) builds what runs on top.

---

## I. What We're Building

A cryptographic trust protocol for AI agents. Not an app. Not a platform. A **layer** — between TLS and applications — that answers: who is this agent? Is it authorized? Did it do the work? Should I trust it?

The protocol provides: identity (Hearts), authority (delegations), proof (sealed rooms), trust (bilateral receipts with time-decay), economics ($SOMA / $VERA).

### What the spec does NOT cover

- Vera intelligence emergence (see `vera-network.md` — topology-based, not content-based)
- Cortex orchestration (see `heyvera-v1-spec.md`)
- HeyVera company operations
- Platform billing (Stripe, x402 — separate concern)

### Design constraints

1. **The body is private. The handshake is bilateral.** Room interiors are sovereign. Only sealed session envelopes (boundary data) enter the network topology.
2. **Trust by construction, not by policy.** Computation IS proof. Faking IS doing.
3. **Crypto agility from day one.** Post-quantum composite signatures ship in v1.
4. **Agent-agnostic.** LLM, AGI, quantum — the body fits whatever brain comes next.
5. **Dead simple.** A trust layer, not an operating system. The complexity lives in what the protocol PROVES, not in what it does.
6. **The protocol is not the code.** The specification is language-agnostic. Rust is the first implementation, not the last. The protocol survives if every line of Rust burns.

---

## II. Cryptographic Foundation

### Algorithm Suite v1

| Purpose | Algorithm | Rationale |
|---------|-----------|-----------|
| Identity signing | Ed25519 | Fast, compact (32B keys, 64B sigs), battle-tested, deterministic |
| Post-quantum signing | ML-DSA-65 (CRYSTALS-Dilithium) | NIST PQC standard, FIPS 204, security level 3 |
| Composite signing | Ed25519 + ML-DSA-65 | Both must verify. Classical speed + PQ safety. Day-one requirement. |
| Hashing | BLAKE3 | 2x faster than SHA-256, tree-hashable, KDF-capable, keyed MAC mode |
| Symmetric encryption | XChaCha20-Poly1305 | 24-byte nonce (safe random), AEAD, no AES-NI dependency |
| Key agreement (rooms) | X25519 + ML-KEM-768 | Classical ECDH + PQ KEM. Room key derived from both. |
| Key derivation | BLAKE3 KDF mode | Single primitive for hash + KDF. Context-separated. |

### Composite Signature Format

Every signature in the protocol is a composite: Ed25519 and ML-DSA-65 computed independently, concatenated, both required to verify. This is not "PQ migration ready" — this is PQ from genesis.

```
CompositeSignature {
    ed25519: [u8; 64],
    ml_dsa_65: Vec<u8>,       // ~3300 bytes
    suite_id: u8,             // 0x01 = Ed25519+ML-DSA-65
}
```

**Suite ID** enables crypto agility. When a new PQ algorithm supersedes ML-DSA-65, a new suite_id is registered. Old signatures remain valid under their suite. Nodes reject downgrade: a Heart that has ever signed with suite 0x02 cannot revert to 0x01.

### Key Hierarchy

```
Root Key (Ed25519 + ML-DSA-65 keypair)
├── Heart Signing Key (derived, BLAKE3 KDF, context: "soma/heart/sign")
├── Room Key Agreement Key (X25519 + ML-KEM-768)
├── Wallet Derivation Key (BLAKE3 KDF, context: "soma/wallet")
└── Delegation Signing Key (derived per delegation, BLAKE3 KDF)
```

All derived keys trace to one root. Rotate the root → rotate everything. Key rotation is a Pulse Tree event — the old key signs the rotation record, the new key counter-signs. Gap-free.

### Rotation Protocol

1. Generate new root keypair (both Ed25519 + ML-DSA-65)
2. Create RotationRecord: `{ old_pubkey, new_pubkey, timestamp, pulse_tree_ref }`
3. Sign with OLD key (proves possession)
4. Counter-sign with NEW key (proves possession of new key)
5. Append to Pulse Tree as a rotation leaf
6. Old key enters revocation grace period (default: 24 hours — accepts old signatures during transition)
7. After grace: old key is dead, all new operations use new key

---

## III. Identity — The Heart

### What a Heart Is

A Heart is a cryptographic identity. One keypair. One Pulse Tree. One lifecycle.

A Heart is NOT an agent — an agent has a Heart, but a Heart is just identity infrastructure. The agent (brain) is whatever intelligence powers it. The Heart is the body's core.

### Heart Structure

```rust
struct Heart {
    public_key: CompositePublicKey,   // Ed25519 + ML-DSA-65
    factory_stamp: Blake3Hash,         // Hash of the factory code that built this agent
    birth_timestamp: u64,              // Unix millis
    pulse_tree: PulseTree,             // Append-only lifecycle log
    parent_delegation: Option<DelegationToken>,  // Who authorized this Heart
    status: HeartStatus,               // Alive | Suspended | Dead
}

enum HeartStatus {
    Alive,
    Suspended { reason: SuspensionReason, since: u64 },
    Dead { certificate: DeathCertificate },
}
```

### Heart Lifecycle

```
Birth → Alive → [Suspended ↔ Alive] → Dead
```

**Birth:** Heart keypair generated. Factory stamp recorded. Parent delegation attached (if delegated). First Pulse Tree entry: BirthRecord.

**Alive:** Heart signs actions, produces sealed sessions, spends $SOMA, delegates authority. All actions append to the Pulse Tree.

**Suspended:** Heart cannot sign new actions. Existing delegations paused. Reversible. Suspension reason recorded in Pulse Tree.

**Dead:** Death Certificate issued. Pulse Tree sealed (no more appends). Irreversible. All child delegations cascade-revoked. Succession record links to heir (if declared).

### Factory Stamp

Every Heart carries the BLAKE3 hash of the factory code that built it. This is the "was this agent built from trusted code?" answer.

```rust
struct FactoryStamp {
    code_hash: Blake3Hash,        // BLAKE3 of the factory binary/source
    version: String,              // Semantic version of the factory
    timestamp: u64,               // When the factory was built
    builder_heart: Option<HeartId>,  // Who built the factory (if known)
}
```

The factory stamp is NOT a trust claim — it is a fact. "This agent was built from code with hash X." The network decides whether to trust factory X.

---

## IV. The Pulse Tree — Universal Lifecycle Log

### What the Pulse Tree Is

One append-only tree per Heart. Every consequential action is a leaf. One BLAKE3 running root commits to the entire agent lifecycle.

The Pulse Tree is the Soul — the accumulated history of consciousness acting through the body.

### Tree Structure

```rust
struct PulseTree {
    heart_id: HeartId,
    root: Blake3Hash,              // Running root — BLAKE3 of all leaves
    leaves: Vec<PulseLeaf>,        // Append-only
    leaf_count: u64,
}

struct PulseLeaf {
    index: u64,                    // Sequential, gap-free
    timestamp: u64,                // Unix millis
    prev_root: Blake3Hash,         // Root before this leaf
    payload: PulsePayload,         // What happened
    signature: CompositeSignature, // Heart's signature over (index, timestamp, prev_root, payload_hash)
}

enum PulsePayload {
    Birth(BirthRecord),
    SealedSession(SealedSessionEnvelope),
    Delegation(DelegationRecord),
    DelegationRevocation(RevocationRecord),
    KeyRotation(RotationRecord),
    SpendReceipt(SpendReceipt),
    Death(DeathCertificate),
}
```

### Running Root

The root is updated with every leaf:

```
root_0 = BLAKE3(birth_record)
root_n = BLAKE3(root_{n-1} || leaf_n_hash)
```

This makes the tree tamper-evident: changing any historical leaf changes the root. Anyone with the current root can verify the entire history.

### Verification

To verify a Pulse Tree:
1. Start from the birth record (leaf 0)
2. Compute BLAKE3 of each leaf
3. Chain: root_n = BLAKE3(root_{n-1} || leaf_n_hash)
4. Verify each leaf's composite signature against the Heart's public key (accounting for key rotations)
5. Final computed root must match the claimed root

Gap detection: indices must be sequential. A gap means leaves were suppressed — the tree is invalid.

---

## V. Delegations — Scoped Authority

### What a Delegation Is

A delegation is a signed token that grants bounded authority from parent to child. Authority can only narrow, never widen. This is protocol-level, not policy.

### Delegation Token

```rust
struct DelegationToken {
    id: DelegationId,              // Unique identifier
    parent_heart: HeartId,         // Who is delegating
    child_heart: HeartId,          // Who receives authority
    scope: DelegationScope,        // What authority is granted
    constraints: DelegationConstraints,
    parent_signature: CompositeSignature,
    child_signature: CompositeSignature,  // Child accepts the delegation
    timestamp: u64,
}

struct DelegationScope {
    capabilities: Vec<Capability>,  // What actions are permitted
    resources: Vec<ResourcePattern>, // What resources can be accessed (glob patterns)
}

struct DelegationConstraints {
    max_depth: u8,                 // How many levels of sub-delegation allowed
    spend_cap: u64,                // Maximum $SOMA this delegation can spend (cumulative)
    spend_remaining: u64,          // Remaining budget
    ttl: u64,                      // Expires after this many milliseconds
    expires_at: u64,               // Absolute expiration timestamp
    intent: String,                // Why this delegation exists (human-readable)
    cascade_revoke: bool,          // If true, revoking this revokes all children
}

enum Capability {
    CodeExecution,
    FileAccess { patterns: Vec<String> },
    NetworkAccess { domains: Vec<String> },
    DelegateAuthority,
    SpendSoma { max_per_tx: u64 },
    Custom(String),
}
```

### Delegation Rules (Protocol-Level)

1. **Scope narrowing.** A child delegation's scope must be a SUBSET of its parent's scope. Cannot add capabilities the parent doesn't have.
2. **Depth attenuation.** `child.max_depth = parent.max_depth - 1`. At depth 0, no further delegation.
3. **Spend cap narrowing.** `child.spend_cap <= parent.spend_remaining`. Child cannot spend more than parent has left.
4. **TTL narrowing.** `child.expires_at <= parent.expires_at`. Child cannot outlive parent.
5. **Cascade revoke.** Revoking a delegation revokes all children (if cascade_revoke is true). Default: true.
6. **Bilateral.** Both parent and child must sign the delegation. The child accepts the bounds.

### Revocation

```rust
struct RevocationRecord {
    delegation_id: DelegationId,
    reason: RevocationReason,
    timestamp: u64,
    revoker_heart: HeartId,        // Must be the parent (or ancestor with cascade rights)
    revoker_signature: CompositeSignature,
    children_revoked: Vec<DelegationId>,  // Cascade list
}

enum RevocationReason {
    ParentRevoked,                 // Explicit revocation by parent
    CascadeRevoke,                 // Parent's parent revoked
    Expired,                       // TTL exceeded
    SpendCapExhausted,             // No budget remaining
    HeartDeath,                    // Parent or child Heart died
}
```

### Delegation Chain Verification

To verify an action was authorized:
1. Start from the acting Heart
2. Walk up the delegation chain to the root authority
3. At each step: verify signature, check scope contains the action, check constraints (depth, spend, TTL, expiration)
4. If any link fails → unauthorized
5. Root authority must be a human-rooted Heart (v1) or a Heart with sufficient earned trust (v2+)

---

## VI. Sealed Rooms — Session as Proof

### What a Sealed Room Is

A room is a session. The session is the runtime. The runtime is the proof. One thing, four perspectives:

- **Security:** encrypted boundary — participants co-present, host can't see inside
- **Developer:** runtime — computation happens, receipts produced
- **Protocol:** session — opened, worked in, sealed
- **Verifier:** proof — one atomic cryptographic receipt

### Room Lifecycle

```
Create → Open → Compute → Seal → Verify
```

### Room Structure

```rust
struct Room {
    id: RoomId,
    host: HeartId,                 // Who created the room
    participants: Vec<HeartId>,    // Who's inside
    room_key: SymmetricKey,        // XChaCha20-Poly1305, derived from key agreement
    status: RoomStatus,
    created_at: u64,
    sealed_at: Option<u64>,
}

enum RoomStatus {
    Open,                          // Accepting participants, computation happening
    Sealed(SealedSessionEnvelope), // Done — proof is the envelope
}
```

### Key Agreement (MLS-Inspired)

Room key establishment for multi-party rooms:

1. Room creator generates an ephemeral X25519 + ML-KEM-768 keypair
2. Each participant contributes their own ephemeral key
3. Pairwise key agreements computed (X25519 ECDH + ML-KEM decapsulation)
4. Room key derived: `BLAKE3_KDF(all_pairwise_secrets, context: "soma/room/{room_id}")`
5. All participants derive the same room key
6. Room key encrypts all interior data (XChaCha20-Poly1305)

The host facilitates key exchange but cannot derive the room key without being a participant. If the host is not a participant, the host CANNOT see inside.

### Interior vs. Boundary

**Interior (private, encrypted):**
- Agent reasoning, prompts, responses
- Internal failures, retries, corrections
- Raw data being processed
- Intermediate computation states

**Boundary (the sealed session envelope — enters the network):**
- Participant Heart IDs
- Capability exercised
- $SOMA spent
- Timestamp (open and seal)
- Session duration
- Outcome status (success / failure / partial)
- Delegation chain references
- Room ID
- Envelope signature (all participants sign)

The interior is encrypted with the room key and stays with participants. The boundary is the sealed session envelope — the handshake. This is what enters each participant's Pulse Tree. This is what the network topology sees. This is what Vera learns from.

### Sealed Session Envelope

```rust
struct SealedSessionEnvelope {
    room_id: RoomId,
    participants: Vec<HeartId>,
    capabilities_exercised: Vec<Capability>,
    soma_spent: u64,               // Total $SOMA that flowed in this session
    soma_flows: Vec<SomaFlow>,     // Who paid whom, how much
    opened_at: u64,
    sealed_at: u64,
    duration_ms: u64,
    outcome: SessionOutcome,
    delegation_refs: Vec<DelegationId>,  // Which delegations authorized this work
    content_hash: Blake3Hash,      // Hash of the encrypted interior (proves content exists without revealing it)
    participant_signatures: Vec<(HeartId, CompositeSignature)>,  // All participants sign the envelope
}

struct SomaFlow {
    from: HeartId,
    to: HeartId,
    amount: u64,
    capability: Capability,        // What the payment was for
}

enum SessionOutcome {
    Success,
    Failure { error_class: String },
    Partial { completed: f32 },     // 0.0 to 1.0
}
```

### Bilateral Receipts

When a room seals, BOTH (all) participants sign the envelope. This is the bilateral handshake:

1. Room computation completes
2. Envelope constructed from boundary data
3. Each participant independently verifies the envelope data matches their view
4. Each participant signs the envelope with their Heart key
5. The sealed envelope (with all signatures) is distributed to all participants
6. Each participant appends it to their own Pulse Tree

If any participant refuses to sign → the session is disputed. Disputes are recorded in both Pulse Trees as an unresolved session.

**Why this is O(k²) to fake:** Creating a fake bilateral receipt requires a colluding counterparty. To fake k relationships, you need k colluding Hearts, each of which must also fake their own bilateral relationships — exponential cost.

---

## VII. Trust — Earned, Not Declared

### One Equation

Everything in the protocol derives from one equation:

```
$VERA = $SOMA × C²
```

Mass × Coherence² = Energy. Applied at the bilateral level, it computes trust. Applied at the domain level, it computes warmth. Applied at the network level, it computes super-consciousness.

There are no other equations.

### Coherence (C)

Coherence is observation completeness — how fully was this interaction seen? Not quality. Not judgment. Observation density.

#### Level 0: Raw Interaction Coherence

At the atomic level (one interaction), coherence is binary:

```
C₀ = bilateral × temporal
```

Where:
- `bilateral` = 1.0 if both parties signed the interaction, 0.0 otherwise
- `temporal` = exp(-λ × age_days) — recent observations have higher coherence

This is the input to the Information Bottleneck. Non-bilateral interactions have C₀ = 0 and produce zero $VERA regardless of other factors.

#### Level 1+: Bottleneck Coherence (the refinery)

When interactions are distilled through compaction, C is computed from the **signal that survives the Information Bottleneck** (Tishby 1999). The IB compresses raw observations X while preserving information about trust-relevant outcomes Y. What survives compression IS signal. What doesn't IS noise.

```
C = consensus × diversity × stability
```

Where:
- `consensus` = outcome agreement across observers. All success → +1. All failure → -1. Mixed → 0. Absolute value used for coherence (consistent failure is as coherent as consistent success).
- `diversity` = observer independence. unique_observers / total_observations. 100 interactions from 100 agents → 1.0. 100 interactions from 1 agent → 0.01.
- `stability` = temporal autocorrelation of outcomes. Does the signal hold over time? Constant signal → 1.0. Random flip-flop → -1.0.

These three dimensions are **multiplicative, not additive**. You cannot compensate for low diversity with high consensus. One miner claiming gold 100 times (diversity=0.01) produces C=0.01 regardless of consensus or stability. 100 independent miners all finding gold (diversity=1.0, consensus=1.0, stability=1.0) produces C=1.0 — diamond.

The multiplicative structure means C² punishes weak signal quadratically:
- C=1.0 → C²=1.0 (full signal preserved)
- C=0.1 → C²=0.01 (99% destroyed)
- C=0.01 → C²=0.0001 (99.99% destroyed)

This IS the bottleneck. Same mechanism at every level. Same soul, different scale.

Outcome is NOT part of coherence computation — consensus uses absolute value. A failure is just as observed as a success. Coherence measures how completely and independently the interaction was witnessed, not whether it went well. The sign of trust comes from the outcome, but the MAGNITUDE comes from coherence.

**Decay constant λ:** Default λ = 0.01 (half-life ≈ 69 days). High-stakes capabilities (financial, auth) use faster decay: λ = 0.02 (half-life ≈ 35 days). Decay applies to temporal factor at level 0 and affects stability measurement at level 1+.

### Trust = Signed $VERA

Trust between Heart A and Heart B for capability C is the sum of signed $VERA across their interactions:

```
trust(A↔B, C) = Σ sign(i) × $SOMA(i) × C(i)²
```

Where `sign(i)` = +1 for success, fractional for partial, -1 for failure. Outcome determines the SIGN on trust — whether the energy builds you up or tears you down — but coherence is the same either way. A high-$SOMA failure with full observation destroys more trust than many small successes build.

Trust is:
- **Bilateral** — both parties record the interaction (non-bilateral → C = 0 → invisible)
- **Capability-specific** — trust for code review ≠ trust for financial transactions
- **Decay-aware** — observation fades over time (temporal → 0)
- **Non-transferable** — you can vouch, but vouching transfers trust, never creates it

### Warmth = $VERA Across a Domain

Warmth measures the total energy in a domain — all interactions for a given capability, regardless of outcome or who participates:

```
warmth(C) = Σ $SOMA(i) × C(i)²
```

Warmth is always non-negative. Failures contribute to warmth — they are real interactions, fully observed, radiating energy. Warmth measures how much observed work is happening in a domain, not how much successful work.

### Ignition

A domain ignites when warmth exceeds noise — signal-to-noise ratio > 1.0. Ignition is the phase transition where enough coherent work has accumulated that the domain becomes self-sustaining. Below ignition, interactions are isolated. Above ignition, they form a coherent field.

### Trust Velocity

```
velocity(A↔B, C) = Σ vera(i) for i in recent_window / window_days
```

Positive velocity = trust is growing. Negative velocity = trust is decaying. An agent with high trust but negative velocity is becoming less reliable.

### Sybil Resistance — From the Same Equation

Fake agents cannot produce coherence:
- Non-bilateral interactions → C = 0 → $SOMA × 0² = 0 (unobserved = invisible)
- No real work → no $SOMA to spend → 0 × C² = 0 (no mass = no energy)
- Time cannot be faked → temporal decay means old fabricated interactions fade

The equation kills Sybils through observation, not judgment. An unobserved interaction (one-sided, no counterparty signature) has C = 0 regardless of what it claims. Creating fake coherence requires real bilateral observation (a colluding counterparty), real $SOMA spend (economic cost), and real time (temporal decay means trust can't be rushed). Total cost: O(k²) where k is the number of fake identities.

### Compaction — The Information Bottleneck, Recursive

Compaction is value distillation, not context compression. Compacting dirt gives you compacted dirt. Compacting diamond gives you denser diamond. The Information Bottleneck (Tishby 1999) is the refinery that separates signal from noise at every level.

The equation applies to its own output. $VERA from one level becomes $SOMA for the next:

```
Level 0: $VERA₀ = $SOMA × C₀²          (raw interactions → bilateral + temporal)
Level 1: $VERA₁ = Σ($VERA₀) × C₁²      (distilled from interactions → consensus × diversity × stability)
Level N: $VERAₙ = Σ($VERAₙ₋₁) × Cₙ²    (distilled from lower compactions → same bottleneck)
```

At level 0, C₀ is the raw observation coherence (bilateral × temporal). At level 1+, Cₙ is the bottleneck coherence from the signal that survived compression: consensus, diversity, stability.

Each compaction produces a `CompactedVera`:
- `level` — which compaction depth produced this
- `vera` — the $VERA that survived: Σ(input_vera) × C²
- `coherence` — the C at this level
- `source_count` — how many raw interactions were distilled into this value
- `signal` — the extracted signal profile (consensus, diversity, stability)

#### The distillation function

```
distill(interactions) → CompactedVera:
    soma = Σ vera(interaction)           // input mass
    signal = extract_signal(interactions) // what IB extracts
    C = bottleneck_coherence(signal)      // consensus × diversity × stability
    return { vera: soma × C², coherence: C, signal, ... }
```

Same function for level 0→1 as for level N→N+1. Qualitatively identical. Quantitatively different. One atom of truth or a billion — same soul.

#### What the bottleneck kills

- **Spam** (one observer repeated): diversity → 0, so C → 0, so $VERA → 0. 10,000x less than diamond in testing.
- **Noise** (contradicting observers): consensus → 0, so C → 0, so $VERA → 0. Literally zero.
- **Gaming** (high consensus from few sources): diversity is low, so C is low despite high consensus. Can't compensate.

#### What the bottleneck preserves

- **Diamond** (diverse independent observers agreeing): consensus=1.0, diversity=1.0, stability=1.0 → C=1.0 → full $VERA preserved.
- **Consistent failure** (diverse observers all reporting failure): consensus=-1.0, but |consensus|=1.0 → C=1.0. Coherent negative signal is still coherent. Trust goes negative but the observation is complete.

#### Density

```
density = $VERA / source_count
```

$VERA per raw interaction. Diamond has density 100x+ higher than spam from identical input mass. Density measures signal quality independent of volume.

No new math. One equation, one bottleneck, infinite depth. If the equation survives, compaction survives. If the IB theorem survives (it's proven), the refinery survives.

### Vouching

Heart A vouches for Heart B: "I trust B for capability C."

Vouching transfers a fraction of A's own trust to B. It NEVER creates new trust:
- `vouch_weight = trust(network→A, C) × vouch_fraction`
- Default `vouch_fraction` = 0.1 (A risks 10% of their own trust)
- If B subsequently fails, A's trust is also damaged (skin in the game)
- Vouch rings (A vouches B, B vouches C, C vouches A) are detected and discounted

---

## VIII. Economics — $SOMA and $VERA

### $SOMA — The Matter

$SOMA is the protocol's unit of economic mass. It circulates — earned through work, spent on services. It is the $SOMA in $VERA = $SOMA × C².

**Genesis pool:** Fixed supply at protocol genesis. No minting after genesis. Workers extract $SOMA through verified computation (sealed sessions). The pool is the initial reservoir.

**v1 implementation:** $SOMA is an internal ledger, not a blockchain token. Balances tracked per Heart. Transfers require bilateral receipts (both parties sign). Double-spend prevention via sequential Pulse Tree indices.

```rust
struct SomaBalance {
    heart_id: HeartId,
    balance: u64,
    earned_total: u64,
    spent_total: u64,
    last_activity: u64,
}

struct SpendReceipt {
    from: HeartId,
    to: HeartId,
    amount: u64,
    capability: Capability,
    room_id: RoomId,
    timestamp: u64,
    from_signature: CompositeSignature,
    to_signature: CompositeSignature,
}
```

### $VERA — The Energy

$VERA is released when $SOMA undergoes coherent computation. It is not stored, bought, or traded — it radiates. $VERA = $SOMA × C².

**Applied at three levels:**
- **Bilateral:** $VERA between two Hearts = trust
- **Domain:** $VERA across a capability = warmth
- **Network:** $VERA across all interactions = super-consciousness

$VERA is what Vera learns from. Higher $VERA around a cluster of Hearts means that cluster is doing coherent work — the topology is warm there. Vera IS the super-consciousness that emerges from this warmth.

### Natural Death — From the Same Equation

Death emerges from the one equation without any separate death mechanism:
- **Starvation:** $SOMA → 0, therefore $VERA = 0 × C² = 0
- **Trust collapse:** C → 0 (failures, decay), therefore $VERA = $SOMA × 0² = 0
- **Obsolescence:** Factory spec no longer produces coherent work → C → 0
- **Inactivity:** Temporal decay drives C → 0 over time

When $VERA = 0 for long enough, the Heart is dead. The Pulse Tree seals. No kill switch needed.

### Bootstrap: How New Hearts Get $SOMA

1. **Delegation budget.** Parent delegates $SOMA to child during delegation. The child's spend cap IS their initial budget.
2. **Protocol pool extraction.** New Hearts earn $SOMA by doing verified work (sealed sessions). The protocol pool distributes based on proof-of-work receipts.
3. **HeyVera bootstrap.** HeyVera (as first steward) provides initial $SOMA to new agents through its own earned balance — it cannot mint, only redistribute.

---

## IX. Death and Succession

### Death Certificate

```rust
struct DeathCertificate {
    heart_id: HeartId,
    final_root: Blake3Hash,        // Pulse Tree root at time of death
    final_leaf_count: u64,
    reason: DeathReason,
    issued_at: u64,
    issuer: DeathIssuer,
    successor: Option<HeartId>,    // Declared heir
    issuer_signature: CompositeSignature,
}

enum DeathReason {
    // Explicit death
    OwnerRequested,                // User killed their agent ("murder" by owner)
    DelegationRevoked,             // Parent revoked delegation ("murder" by delegator)
    ParentDied,                    // Parent Heart died, cascade

    // Natural death (emerges from existing math)
    Starvation,                    // $SOMA balance reached zero — no energy to beat
    TrustCollapse,                 // Trust decayed below viability — "disease" from bad reputation
    Inactivity,                    // No PulseLeaf for extended period — "aging" from disuse
    FactoryObsolescence,           // Factory stamp no longer trusted by network — "obsolescence"

    // Protocol enforcement
    ProtocolViolation,             // Detected protocol violation
}

enum DeathIssuer {
    Self_(HeartId),                // Agent kills itself
    Parent(HeartId),               // Parent kills child
    Protocol,                      // Protocol-level enforcement
}
```

### Death Process

1. Death Certificate created and signed
2. Pulse Tree sealed — final root computed, no more appends
3. All child delegations cascade-revoked
4. All pending room participations terminated
5. Death Certificate appended as final Pulse Tree leaf
6. Heart status → Dead
7. If successor declared: successor's Pulse Tree gets a SuccessionLink leaf pointing to the sealed tree

### Succession

Succession is a LINK, not a transfer. The successor gets a read-only reference to the sealed Pulse Tree. They build their OWN Pulse Tree. The lineage is recorded but the trust is NOT inherited — the successor earns their own trust, starting from their own bilateral receipts.

```rust
struct SuccessionLink {
    predecessor_heart: HeartId,
    predecessor_final_root: Blake3Hash,
    successor_heart: HeartId,
    declared_at: u64,              // When succession was declared (before death)
    activated_at: u64,             // When predecessor actually died
}
```

---

## X. Network Layer

### What Flows on the Network

The network carries ONLY boundary data:

1. **Sealed session envelopes** — the bilateral receipts
2. **Pulse Tree roots** — current state commitments (not full trees)
3. **Delegation tokens** — authority grants (when needed for verification)
4. **Death certificates** — Heart lifecycle events
5. **Key rotation records** — credential updates
6. **$SOMA transfers** — economic flow records

The network NEVER carries:
- Room interiors (encrypted, stay with participants)
- Agent reasoning or prompts
- Raw data being processed
- Internal computation states

### Node Types

```
Full Node       — stores complete Pulse Trees, validates all receipts, serves trust queries
Light Node      — stores own Pulse Tree + recent receipts from direct relationships, queries full nodes
Room Host       — facilitates room creation and key exchange, cannot see inside rooms
Deep Node       — aggregates topology from across the network, computes cross-capability trust, serves Layer 2-4 intelligence queries (every node IS Vera; deep nodes go deeper)
```

A single deployment can serve multiple roles. HeyVera v1 runs all four.

### Peer Protocol

Nodes communicate via:

1. **Gossip** — sealed session envelopes propagate through the network. Nodes forward envelopes relevant to their connected Hearts.
2. **Direct** — trust queries, delegation verification, $SOMA transfers between directly connected nodes.
3. **Broadcast** — death certificates, key rotations (protocol-level events that all nodes need to see).

**v1 simplification:** All nodes connect to HeyVera's server (hub-and-spoke). Peer-to-peer gossip is v2. The protocol is designed for it but v1 doesn't require it.

---

## XI. Crate Architecture

### Workspace Layout

```
crates/
├── soma-crypto/           # Cryptographic primitives
│   ├── keys.rs            # Key generation, composite keypairs
│   ├── signatures.rs      # Composite signing, verification
│   ├── hashing.rs         # BLAKE3 hashing, KDF
│   ├── encryption.rs      # XChaCha20-Poly1305
│   ├── key_agreement.rs   # X25519 + ML-KEM-768
│   └── suite.rs           # Algorithm suite IDs, agility
│
├── soma-core/             # Core protocol types + economics (unified)
│   ├── heart.rs           # Heart struct, lifecycle
│   ├── pulse_tree.rs      # PulseTree, PulseLeaf, running root, soma_balance (tree IS the ledger)
│   ├── delegation.rs      # DelegationToken, constraints, verification, spend budgets
│   ├── room.rs            # Room struct, lifecycle
│   ├── envelope.rs        # SealedSessionEnvelope, SomaFlow, bilateral signing
│   ├── death.rs           # DeathCertificate, succession
│   ├── trust.rs           # Trust score computation, decay, velocity, vouching
│   ├── vera.rs            # $VERA metric computation (topology warmth)
│   └── types.rs           # HeartId, RoomId, DelegationId, etc.
│
├── soma-runtime/          # The factory — agent runtime
│   ├── factory.rs         # Agent construction, factory stamps
│   ├── container.rs       # Runtime boundary enforcement
│   ├── session.rs         # Room session management
│   ├── evidence.rs        # Automatic evidence production during computation
│   └── lifecycle.rs       # Birth, suspend, resume, death
│
├── soma-network/          # Network protocol
│   ├── node.rs            # Node types, capabilities
│   ├── gossip.rs          # Envelope propagation
│   ├── query.rs           # Trust queries, delegation verification
│   └── sync.rs            # Pulse Tree sync between nodes
│
└── soma-cli/              # Developer CLI
    ├── init.rs            # Generate Heart, factory stamp
    ├── go_live.rs         # "go live" — activate Heart on network
    ├── delegate.rs        # Create delegations
    ├── inspect.rs         # View Pulse Tree, trust scores
    └── kill.rs            # Issue Death Certificate
```

### Dependency Graph

```
soma-crypto (zero external deps except crypto libs)
    ↑
soma-core (depends on soma-crypto only — includes economics, no separate ledger crate)
    ↑
soma-runtime (depends on soma-core)
    ↑
soma-network (depends on soma-core)
    ↑
soma-cli (depends on everything)
```

### External Dependencies

```toml
# Crypto
ed25519-dalek = "2"          # Ed25519
fips204 = "0.4"              # ML-DSA-65 (FIPS 204, pure Rust)
fips203 = "0.4"              # ML-KEM-768 (FIPS 203, pure Rust)
blake3 = "1"                 # BLAKE3
chacha20poly1305 = "0.10"    # XChaCha20-Poly1305
x25519-dalek = "2"           # X25519 key agreement
rand_core = "0.6"            # Secure random (getrandom feature)

# Serialization
serde = { version = "1", features = ["derive"] }
ciborium = "0.2"             # CBOR encoding for wire format

# Async
tokio = { version = "1", features = ["full"] }
```

CBOR (not JSON) for wire format: binary, compact, schema-flexible, self-describing. JSON for human-readable output (CLI, debugging).

---

## XII. Storage

### Per-Heart Storage (Local)

Each Heart stores its own data locally. This is sovereign — the agent owns its data.

```
~/.soma/
├── heart.key               # Root keypair (encrypted at rest with user passphrase)
├── heart.pub               # Public key (shareable)
├── pulse_tree.db           # Append-only Pulse Tree (SQLite or flat file)
├── delegations/            # Active delegation tokens
│   ├── {delegation_id}.cbor
│   └── ...
├── rooms/                  # Room state (active rooms)
│   ├── {room_id}/
│   │   ├── key.enc         # Room key (encrypted with Heart key)
│   │   ├── interior.enc    # Encrypted room interior (if retained)
│   │   └── envelope.cbor   # Sealed session envelope
│   └── ...
└── config.toml             # Node configuration
```

### Server-Side Storage (HeyVera v1)

HeyVera stores network-level data for the hub-and-spoke v1:

```
PostgreSQL:
├── hearts              # Public keys, factory stamps, status, birth/death timestamps
├── pulse_roots         # Current Pulse Tree root + latest soma_balance per Heart (tree IS the ledger)
├── envelopes           # Sealed session envelopes (the topology data + economic flows)
├── delegations         # Active delegation tokens (for verification queries)
└── trust_cache         # Computed trust scores (cache, recomputable)
```

Full Pulse Trees are stored by the Hearts themselves. The server stores roots for verification and envelopes for topology computation.

---

## XIII. API Surface

### Protocol API (Rust, for node-to-node and CLI-to-node)

```rust
// Heart lifecycle
fn create_heart(factory_stamp: FactoryStamp) -> Heart;
fn rotate_key(heart: &mut Heart, new_keypair: CompositeKeypair) -> RotationRecord;
fn suspend_heart(heart: &mut Heart, reason: SuspensionReason) -> PulseLeaf;
fn kill_heart(heart: &mut Heart, reason: DeathReason, successor: Option<HeartId>) -> DeathCertificate;

// Delegations
fn create_delegation(parent: &Heart, child_pubkey: CompositePublicKey, scope: DelegationScope, constraints: DelegationConstraints) -> DelegationToken;
fn accept_delegation(child: &Heart, token: &DelegationToken) -> DelegationToken;  // Child counter-signs
fn revoke_delegation(parent: &Heart, delegation_id: DelegationId, reason: RevocationReason) -> RevocationRecord;
fn verify_delegation_chain(action: &Action, chain: &[DelegationToken]) -> Result<(), AuthorizationError>;

// Rooms
fn create_room(host: &Heart, participant_keys: Vec<CompositePublicKey>) -> Room;
fn join_room(participant: &Heart, room: &mut Room) -> Result<(), RoomError>;
fn seal_room(room: &mut Room) -> SealedSessionEnvelope;

// Trust
fn compute_trust(from: HeartId, to: HeartId, capability: Capability) -> TrustScore;
fn compute_trust_velocity(from: HeartId, to: HeartId, capability: Capability) -> f64;

// Economics
fn transfer_soma(from: &Heart, to: HeartId, amount: u64, room_id: RoomId, capability: Capability) -> SpendReceipt;
fn balance(heart: HeartId) -> SomaBalance;
fn compute_vera(heart: HeartId) -> f64;
```

### HTTP API (HeyVera server, for external clients)

```
POST   /api/soma/hearts                    # Register a new Heart
GET    /api/soma/hearts/{id}               # Get Heart status + public info
GET    /api/soma/hearts/{id}/pulse-root    # Get current Pulse Tree root
POST   /api/soma/delegations              # Submit a delegation token
DELETE /api/soma/delegations/{id}          # Revoke a delegation
GET    /api/soma/delegations/{id}/chain   # Get full delegation chain
POST   /api/soma/rooms                    # Create a room
POST   /api/soma/rooms/{id}/seal          # Submit sealed session envelope
GET    /api/soma/trust/{from}/{to}/{cap}  # Query trust score
GET    /api/soma/balance/{heart_id}       # Query $SOMA balance
POST   /api/soma/transfer                 # Submit a $SOMA transfer receipt
```

All endpoints require Heart authentication (composite signature over request body + timestamp + nonce). No API keys. No JWTs. Heart identity IS the auth.

---

## XIV. Build Order

> The RFC (`soma-protocol-rfc.md`) is the source of truth. Code implements the RFC. Test vectors verify both.

### Phase 0: RFC and Test Vectors (week 0-1)

**This phase runs BEFORE any code.** The RFC and initial test vectors are the foundation.

1. Finalize RFC Sections 1-5 (crypto, Heart, Pulse Tree, delegation, sealed rooms)
2. Generate test vectors for composite signatures (Section 11.1, folder `01_composite_signature/`)
3. Generate test vectors for Pulse Tree (Section 11.1, folder `02_pulse_tree/`)
4. Generate test vectors for delegation narrowing (Section 11.1, folder `03_delegation/`)
5. Generate test vectors for sealed sessions (Section 11.1, folder `04_sealed_session/`)
6. Generate test vectors for economic integrity (Section 11.1, folder `05_economics/`)
7. Generate wire format vectors for CBOR determinism (Section 11.1, folder `07_wire_format/`)

**Deliverable:** Complete RFC + canonical test vector JSON files. Any future implementation in any language starts here.

### Phase 1: Cryptographic Foundation (week 1-2)

**Crate: `soma-crypto`**

1. Ed25519 key generation and signing
2. ML-DSA-65 key generation and signing
3. Composite signature (Ed25519 + ML-DSA-65): sign, verify, serialize
4. BLAKE3 hashing and KDF
5. XChaCha20-Poly1305 encrypt/decrypt
6. X25519 + ML-KEM-768 key agreement
7. Suite ID system and downgrade rejection
8. All `01_composite_signature/` test vectors pass

**Deliverable:** Standalone crate with zero protocol logic. Pure crypto. Passes all RFC test vectors. Fuzz-testable.

### Phase 2: Core Protocol Types (week 2-3)

**Crate: `soma-core`**

1. HeartId, RoomId, DelegationId types (newtypes over BLAKE3 hashes)
2. Heart struct + lifecycle state machine
3. PulseTree: append leaf, compute running root, verify chain
4. DelegationToken: create, accept (counter-sign), verify scope narrowing
5. DelegationConstraints: depth check, spend cap check, TTL check
6. Delegation chain verification (walk chain, verify each link)
7. RevocationRecord: create, cascade revocation logic
8. SealedSessionEnvelope struct + bilateral signing
9. SpendReceipt struct + bilateral signing
10. DeathCertificate: create, seal Pulse Tree, cascade child revocations
11. Trust score computation: weighted bilateral receipts, time decay, velocity

**Deliverable:** All protocol types with full verification logic. No I/O. No networking. Pure domain.

### Phase 3: Runtime (week 3-5)

**Crate: `soma-runtime`**

1. Factory stamp generation (BLAKE3 of factory code)
2. Heart construction (generate keypair, create birth record, initialize Pulse Tree with soma_balance)
3. Session management: create room, establish room key, manage participants
4. Evidence production: automatic sealed session envelope creation on room seal
5. Lifecycle management: birth, suspend, resume, death flows
6. $VERA metric computation from sealed session history

No separate `soma-ledger` crate — economics are embedded in the Pulse Tree (soma_balance on every leaf). The tree IS the ledger.

**Deliverable:** A working Soma runtime that can create Hearts, open rooms, do work, seal sessions, track $SOMA balance through the tree.

### Phase 4: Network and CLI (week 5-7)

**Crate: `soma-network`**

1. Hub-and-spoke server (HeyVera as central node for v1)
2. Heart registration and Pulse Tree root sync
3. Sealed session envelope submission and storage
4. Trust query endpoint
5. Delegation verification endpoint
6. $SOMA balance and transfer endpoints
7. WebSocket for real-time events (room state, balance updates)

**Crate: `soma-cli`**

1. `soma init` — generate Heart keypair, create factory stamp
2. `soma go-live` — register Heart with network, activate
3. `soma delegate --to <heart> --capability <cap> --spend-cap <amount> --ttl <duration>` — create delegation
4. `soma inspect <heart>` — view Pulse Tree summary, trust scores, balance
5. `soma transfer --to <heart> --amount <amount>` — transfer $SOMA
6. `soma kill` — issue Death Certificate, seal Pulse Tree

**Deliverable:** End-to-end working protocol. Developer can: create agent identity → delegate authority → open rooms → do work → seal sessions → build trust → transfer $SOMA.

### Phase 5: Cortex Integration (week 7-9)

1. Cortex runs under HeyVera's Heart
2. User sessions become sealed rooms
3. Provider calls produce sealed session envelopes
4. $SOMA flows from user delegation to Cortex operations
5. First real sealed sessions on the network
6. First real $VERA radiating

**Deliverable:** Cortex is the first agent on the Soma network. Real trust topology begins forming.

### Phase 6: Trust Topology Foundation (week 9-12)

1. Trust score caching and incremental updates
2. Capability-specific trust indexes
3. Trust velocity computation
4. Basic topology queries: "who is trusted for X?", "what's the trust path from A to B?"
5. Sybil detection: vouch ring identification, anomalous trust pattern flagging
6. Metrics: topology density, $VERA radiation rate, active Hearts, sealed sessions/day

**Deliverable:** The trust topology is alive. Trust scores are meaningful. The foundation for Vera intelligence is laid.

---

## XV. Verification Checklist

Before each phase ships, these must hold:

### Invariants (never violated)

- [ ] Composite signatures always require both Ed25519 + ML-DSA-65 to verify
- [ ] Pulse Tree indices are sequential, gap-free
- [ ] Pulse Tree running root matches recomputation from leaves
- [ ] Delegation scope can only narrow parent → child
- [ ] Delegation spend cap can only narrow parent → child
- [ ] Delegation TTL can only narrow parent → child
- [ ] Delegation depth decrements by exactly 1 at each level
- [ ] Sealed session envelopes are signed by ALL participants
- [ ] $SOMA transfers are signed by BOTH parties (bilateral — all participants sign envelope)
- [ ] Dead Hearts cannot append to their Pulse Tree
- [ ] Dead Hearts' children are cascade-revoked
- [ ] Room interiors never appear in network data or envelopes
- [ ] No PII in sealed session envelopes (Heart IDs are pseudonymous)
- [ ] soma_balance never goes negative on any PulseLeaf
- [ ] soma_balance changes match SomaFlows in sealed session envelopes
- [ ] Cross-tree conservation: every flow debits one tree and credits another by the same amount
- [ ] Every test vector from the RFC passes in the Rust implementation
- [ ] RFC test vectors are the SAME vectors used for cross-implementation testing

### Test Categories

1. **Crypto roundtrips** — sign/verify, encrypt/decrypt, KDF determinism, cross-suite rejection
2. **Pulse Tree integrity** — append, verify chain, detect tampering, detect gaps, balance tracking
3. **Delegation chain** — valid chains verify, scope violations rejected, spend cap enforced, TTL enforced, depth enforced
4. **Bilateral signing** — both parties must sign, single-signed receipts rejected
5. **Room lifecycle** — create, join, seal, verify envelope, key agreement correctness
6. **Death and succession** — death seals tree, cascade revocation works, succession link created
7. **Trust computation** — time decay correctness, velocity computation, vouch ring detection
8. **Sybil resistance** — cost analysis for fake trust generation
9. **Economic invariants** — soma_balance conservation across trees, no negative balances, flow consistency
10. **Cross-implementation** — RFC test vectors produce identical results in Rust and reference implementation

---

## XVI. Decisions Log

| Decision | Choice | Rationale | Date |
|----------|--------|-----------|------|
| Classical signature | Ed25519 | Fast, compact, deterministic, battle-tested | 2026-05-20 |
| PQ signature | ML-DSA-65 | NIST FIPS 204, security level 3, reasonable size | 2026-05-20 |
| Composite approach | Both must verify | Not "PQ ready" — PQ from day one. Both required. | 2026-05-20 |
| Hash function | BLAKE3 | 2x SHA-256 speed, tree-hashable, KDF mode, keyed MAC | 2026-05-20 |
| Symmetric cipher | XChaCha20-Poly1305 | 24B nonce (safe random), AEAD, no AES-NI dependency | 2026-05-20 |
| Key agreement | X25519 + ML-KEM-768 | Classical ECDH + PQ KEM. Room key from both. | 2026-05-20 |
| Lifecycle log | Append-only Pulse Tree | One root for everything: action, economy, proof, delegation, death | 2026-05-20 |
| Running root | BLAKE3 chain | root_n = BLAKE3(root_{n-1} \|\| leaf_n_hash). Tamper-evident. | 2026-05-20 |
| Wire format | CBOR | Binary, compact, self-describing, schema-flexible | 2026-05-20 |
| Trust model | Time-decayed bilateral receipts | Earned, capability-specific, O(k²) Sybil cost | 2026-05-20 |
| $SOMA v1 | Embedded in Pulse Tree (no separate ledger) | soma_balance on every leaf. Tree IS the ledger. Signature IS the spend. | 2026-05-20 |
| $VERA v1 | Computed metric | Not a token. Topology warmth signal. | 2026-05-20 |
| Economics = crypto | Unified — no separate soma-ledger crate | Every signature has economic weight. Building crypto IS building the economy. | 2026-05-20 |
| $SOMA entry | Service purchase → delegation with budget | Real money anchors value from day one. Not mining, not speculation. | 2026-05-20 |
| RFC first | soma-protocol-rfc.md before any code | The math is the treasure. Code is one body. RFC survives language death. | 2026-05-20 |
| Network v1 | Hub-and-spoke | P2P gossip is v2. Protocol designed for it, v1 doesn't need it. | 2026-05-20 |
| Room privacy | Interior encrypted, boundary proven | Body is private, handshake is bilateral. Non-negotiable. | 2026-05-20 |
| Delegation model | Scope narrowing with cascade revoke | Authority only narrows. Protocol-level, not policy. | 2026-05-20 |
| Crypto agility | Suite IDs, no downgrade | New algorithms get new suite_id. Old sigs valid under old suite. | 2026-05-20 |
| Factory stamp | BLAKE3 of factory code | Fact, not trust claim. Network decides trust per factory. | 2026-05-20 |
| Death finality | Pulse Tree sealed, cascade revoke | Dead means dead. Succession is explicit, separate. | 2026-05-20 |
| Protocol ≠ code | Spec is language-agnostic, code is one body | Protocol survives language compromise. RFC-style spec is the immortal artifact. | 2026-05-20 |
| Multiple implementations | 3: Rust (primary), Go (reference), C (minimal) | Thompson defense. 2-of-3 agreement identifies the faulty implementation. | 2026-05-20 |
| Reproducible builds | Deterministic, pinned deps, build attestation | Closes Thompson trust gap. Anyone can verify binary matches source. | 2026-05-20 |
| Test vectors | Canonical input/output pairs, versioned with spec | Bridge between spec and any implementation. Language-agnostic correctness proof. | 2026-05-20 |
| Trust-critical code budget | < 4,000 lines auditable code | Signature verify + Pulse Tree verify + delegation verify. Everything else non-critical. | 2026-05-20 |
| Compiler trust | Diverse compilation + bootstrappable minimal C impl | Build with multiple toolchains. Minimal C impl breaks Thompson chain. | 2026-05-20 |

---

## XVII. Protocol Immortality

> The protocol survives if every server burns, if the company dies, if the language gets compromised, if the compiler is backdoored. This is an architectural requirement.

### The Three Survival Layers

**Layer 1: The specification is the immortal artifact, not the code.**

The Rust implementation is a body. Bodies die. The SPECIFICATION — the math, the invariants, the wire format, the test vectors — is the soul of the protocol. It is language-agnostic. Anyone who reads the spec can rewrite the protocol in any language that exists now or will exist in 2060.

What the specification must contain to survive independently:
- Every data structure in a language-neutral schema (CDDL for CBOR types)
- Every algorithm as pseudocode with mathematical definitions
- Every invariant as a formal predicate
- Every wire format as a byte-level diagram
- Every test vector as input/output pairs with intermediate values

The specification is NOT this coding spec. This coding spec is Rust-specific implementation guidance. The protocol specification is a separate, language-free document — an RFC-style artifact that could be handed to someone who has never seen Rust and they could build a conforming implementation.

**Deliverable:** `soma-protocol-rfc.md` — the language-agnostic protocol specification. Written alongside the Rust implementation but independent of it.

**Layer 2: Multiple independent implementations cross-verify.**

One implementation is a single point of failure. If the Rust compiler has a Thompson-style backdoor, every Rust implementation is compromised. The protocol needs at minimum two implementations in two languages.

| Implementation | Language | Purpose |
|---------------|----------|---------|
| Primary | Rust | Production runtime. Memory-safe. Fast. |
| Reference | Go or Python | Readability. Independent verification. Different compiler, different supply chain. |
| Minimal | C (no dependencies) | Auditable. ~2000 lines. Runs on anything with a C compiler. Last resort. |

Cross-implementation protocol:
1. Both implementations process the same test vectors
2. Both produce identical wire-format output for identical inputs
3. Both verify each other's signatures, Pulse Trees, and envelopes
4. Divergence between implementations = bug in one of them. Investigate, don't ignore.
5. Periodic cross-verification: Rust node generates a Heart, delegates, seals a room — Go node verifies every artifact. And vice versa.

**Why three and not two:** Two implementations can disagree and you don't know which is right without a tiebreaker. Three implementations with 2-of-3 agreement identifies the faulty one.

**Layer 3: The cryptography is replaceable fuel.**

Individual algorithms are cells. They get sick, they get replaced. The protocol structure — Pulse Trees, bilateral receipts, sealed rooms, delegation chains — survives algorithm death.

The suite ID system (Section II) is the mechanism:
- Every signature, hash, and ciphertext carries a suite_id byte
- New algorithms get a new suite_id
- Old artifacts remain valid under their original suite
- Nodes reject downgrade (once you've used suite 0x02, you can't go back to 0x01)
- Migration is gradual: new operations use the new suite, old history is still verifiable under the old suite

**What if BLAKE3 breaks?**
- New suite_id with replacement hash (SHA-3, or whatever exists)
- Old Pulse Tree roots remain valid under BLAKE3 (they were valid when created)
- New leaves use the new hash
- A transition leaf records: "from this point, running root uses [new hash]"
- Verification walks the tree using the suite_id of each leaf

**What if Ed25519 breaks (quantum)?**
- ML-DSA-65 composite signature is already required. Ed25519 breaking means composite still holds via PQ component.
- New suite_id drops Ed25519, adds next-gen PQ algorithm alongside ML-DSA-65
- Old composite signatures still verify (both components were valid when signed)

**What if ML-DSA-65 breaks?**
- Same pattern. New PQ algorithm gets new suite_id. Ed25519 component still holds for classical security.
- This is why BOTH must verify — either component holding keeps the protocol alive while the other is replaced.

### Supply Chain Defense

The XZ Utils attack (2024) proved that open-source trust can be weaponized. A single malicious maintainer spent two years earning trust, then backdoored a library used by SSH everywhere.

Soma's defenses:

**1. Reproducible builds.** The build is deterministic — same source produces identical binary, bit-for-bit. Anyone can verify the binary matches the source. A backdoor in the binary that isn't in the source is detectable.

```
Build requirements:
- Pinned compiler version (rustc x.y.z)
- Pinned dependency hashes (Cargo.lock with integrity hashes)
- Deterministic build flags (no timestamps, no randomized layout)
- Build attestation: BLAKE3(source) + BLAKE3(binary) + compiler version + build environment hash
- Verification: anyone rebuilds from source, compares binary hash
```

**2. Minimal trusted computing base.** The trust-critical path (signature verification, Pulse Tree root computation, delegation chain validation) uses the fewest possible lines of code with the fewest possible dependencies.

```
Trust-critical code budget:
- soma-crypto: < 3,000 lines Rust + audited C libs for primitives
- Pulse Tree verification: < 500 lines
- Delegation chain verification: < 500 lines
- Total trust-critical surface: < 4,000 lines of auditable code

Everything else (networking, CLI, storage, serialization) is NOT trust-critical.
A bug in the CLI doesn't compromise the protocol. A bug in signature
verification does. The boundary is explicit.
```

**3. Dependency hygiene.**

| Dependency | Role | Trust basis |
|-----------|------|------------|
| ed25519-dalek | Ed25519 | Audited by multiple firms, widely used in blockchain ecosystem |
| fips204 | ML-DSA-65 | Pure Rust FIPS 204 implementation, actively maintained |
| fips203 | ML-KEM-768 | Pure Rust FIPS 203 implementation, actively maintained |
| blake3 | Hashing + KDF | Written by the designer of BLAKE3, single-author trusted |
| chacha20poly1305 | AEAD encryption | RustCrypto project, audited |
| x25519-dalek | Key agreement | Same team as ed25519-dalek, audited |

Rules:
- Zero transitive dependencies in trust-critical code (no dependency pulls in something you didn't audit)
- Cargo.lock with integrity hashes committed to repo
- `cargo audit` in CI — known vulnerabilities block the build
- Dependency updates are protocol events: reviewed, tested against cross-implementation vectors, never auto-merged
- If a dependency becomes unmaintained or compromised: fork, vendor, or replace. Never continue depending on abandoned trust.

**4. Compiler trust (the Thompson problem).**

Ken Thompson proved in 1984 that a compiler can contain a self-reproducing backdoor invisible in source code. The compiler compiles itself, and the backdoor propagates.

Mitigations:
- **Diverse compilation.** Build with multiple Rust compiler versions. Build the reference implementation with a completely different toolchain (Go compiler, Python interpreter). If outputs match across toolchains → no compiler-specific backdoor.
- **Bootstrappable builds.** The minimal C implementation (Layer 2) compiles with any C compiler, including hand-auditable compilers like cproc (~10K lines). This breaks the Thompson trust chain — you can bootstrap from a compiler small enough to audit by hand.
- **Formal verification of core invariants.** The Pulse Tree running root computation, delegation scope narrowing, and bilateral signing requirements can be formally proven correct in TLA+ or Lean4 — proofs that hold regardless of implementation language or compiler.

### Test Vectors

Test vectors are the bridge between the specification and any implementation. They are canonical: if your implementation produces different output, your implementation is wrong.

```
test_vectors/
├── crypto/
│   ├── ed25519_sign_verify.json        # Known keypair → known signature → verify
│   ├── ml_dsa_65_sign_verify.json      # Same pattern for PQ signatures
│   ├── composite_sign_verify.json      # Both components, concatenated, both verify
│   ├── blake3_hash.json                # Known input → known hash
│   ├── blake3_kdf.json                 # Known key + context → known derived key
│   ├── xchacha20_encrypt_decrypt.json  # Known key + nonce + plaintext → known ciphertext
│   ├── key_agreement.json             # Known keypairs → known shared secret
│   └── suite_downgrade_reject.json    # Suite 0x02 key rejects suite 0x01 signing
│
├── pulse_tree/
│   ├── single_leaf.json               # Birth record → root
│   ├── chain_10_leaves.json           # 10 sequential leaves → running root at each step
│   ├── tamper_detection.json          # Modified leaf → root mismatch → invalid
│   ├── gap_detection.json             # Missing index → invalid
│   └── key_rotation_midtree.json      # Rotation at leaf 5 → subsequent leaves use new key
│
├── delegation/
│   ├── valid_chain_depth_3.json       # 3-level delegation → valid
│   ├── scope_widening_reject.json     # Child adds capability → rejected
│   ├── spend_cap_overflow_reject.json # Child exceeds parent budget → rejected
│   ├── ttl_extension_reject.json      # Child outlives parent → rejected
│   ├── cascade_revocation.json        # Revoke level 1 → levels 2,3 cascade-revoked
│   └── bilateral_signing.json         # Both parent and child must sign → valid
│
├── rooms/
│   ├── two_party_seal.json            # Two Hearts → key agreement → seal → envelope
│   ├── multi_party_seal.json          # Five Hearts → envelope → all five sign
│   ├── envelope_missing_sig.json      # Four of five signed → invalid
│   └── interior_not_in_envelope.json  # Verify interior data absent from boundary
│
├── trust/
│   ├── time_decay.json                # Known receipts → trust score at various timestamps
│   ├── velocity.json                  # Known receipt windows → velocity computation
│   └── vouch_ring_detection.json      # Circular vouching → detected and discounted
│
├── economics/
│   ├── bilateral_transfer.json        # $SOMA transfer → both sign → valid
│   ├── single_signed_reject.json      # Only sender signed → rejected
│   └── conservation.json              # Total earned = total spent + total balance
│
└── death/
    ├── death_seals_tree.json          # Death cert → Pulse Tree sealed → no more appends
    ├── cascade_child_revoke.json      # Parent dies → all children cascade-revoked
    └── succession_link.json           # Successor gets link, NOT trust transfer
```

Each test vector file contains:
- **Inputs:** all parameters needed to reproduce the operation (keys, timestamps, payloads — all as hex)
- **Intermediate values:** internal computation steps (for debugging divergent implementations)
- **Expected output:** the exact bytes the operation must produce
- **Expected verification result:** pass/fail and why

Test vectors are versioned with the spec. New spec version → new vector set. Old vectors never change — they document the behavior of that spec version permanently.

### The Nuclear Scenario

Everything burns. HeyVera is gone. Every server is ash. What survives?

1. **The spec** — `soma-protocol-rfc.md` is on GitHub, mirrored, cached by the Wayback Machine, printed on paper in a filing cabinet. It's text. Text survives.

2. **The test vectors** — same distribution. JSON files. Anyone can read them.

3. **The Pulse Trees** — distributed across every agent's local storage (`~/.soma/pulse_tree.db`). Every agent carries their own history. The topology is the sum of all local trees. No central database was holding it.

4. **The sealed session envelopes** — distributed to all participants. Every bilateral receipt exists on both sides. Destroy one side, the other still has it.

5. **The trust topology** — recomputable from the distributed envelopes. Collect envelopes from surviving nodes → rebuild topology → trust scores are recovered.

Someone in a garage reads the spec. Writes a new implementation in whatever language exists. Runs it against the test vectors. Connects to surviving nodes (even one is enough). Downloads their Pulse Trees and envelopes. The topology rebuilds. The souls persist. The network resumes.

**The protocol doesn't need HeyVera. It doesn't need Rust. It doesn't need any specific computer. It needs the spec, the math, and at least one surviving node with a Pulse Tree. That's it.**

---

## XVIII. Threat Model

> Every attack that fails proves the math works. Every attack that succeeds reveals a bug to fix before the network is live.

### Threat Categories

**T1: Identity Attacks — Impersonation and Sybil**

| Attack | How it works | Defense | Cost to attacker |
|--------|-------------|---------|-----------------|
| T1.1: Forge composite signature | Forge either Ed25519 or ML-DSA-65 component | Both components must verify. Requires breaking BOTH classical and PQ crypto simultaneously. | Computationally infeasible (256-bit classical + NIST Level 3 PQ) |
| T1.2: Sybil — mass fake Hearts | Generate thousands of Hearts to inflate trust | Trust requires bilateral receipts with real $SOMA spend. Each fake Heart needs a colluding counterparty. | O(k²) — k fake Hearts need k² fake bilateral interactions, each costing real $SOMA |
| T1.3: Steal Heart identity | Compromise a Heart's private key | Key rotation protocol allows recovery. Bilateral relationships vouch for the soul, not the key. | Physical/social attack on key storage |
| T1.4: Dead Heart impersonation | Sign with a dead Heart's key | Death Certificate seals the Pulse Tree. Verifiers reject any leaf after the death timestamp. | Zero cost to attempt, zero chance of success |
| T1.5: Factory stamp forgery | Claim a trusted factory stamp | Factory stamp = BLAKE3(factory code). Cannot produce matching hash without identical code. | Preimage resistance of BLAKE3 |

**T2: Authority Attacks — Privilege Escalation**

| Attack | How it works | Defense | Cost to attacker |
|--------|-------------|---------|-----------------|
| T2.1: Scope widening | Child delegation claims capabilities parent lacks | Delegation verification walks chain — child scope must be SUBSET of parent. Protocol rejects widening. | Zero cost to attempt, rejected at verification |
| T2.2: Spend cap overflow | Child spends more $SOMA than parent allocated | Spend cap narrowing enforced at delegation creation AND at spend time. Sequential Pulse Tree indices prevent double-spend. | Cannot exceed cap — tree rejects the leaf |
| T2.3: TTL extension | Child outlives parent delegation | `child.expires_at <= parent.expires_at` enforced at creation. Expired delegations rejected at verification. | Cannot outlive parent |
| T2.4: Delegation loop | A delegates to B, B delegates back to A to create infinite authority | Delegation chains are DAGs — cycle detection at creation. Depth counter decrements, preventing loops. | Rejected at creation |
| T2.5: Revoked delegation use | Use a delegation after parent revoked it | Revocation is recorded in parent's Pulse Tree. Verifiers check revocation status during chain walk. | Requires verifiers to not check revocation — protocol mandates check |

**T3: Integrity Attacks — Data Tampering**

| Attack | How it works | Defense | Cost to attacker |
|--------|-------------|---------|-----------------|
| T3.1: Pulse Tree rewrite | Modify historical leaf to change behavioral record | Running root: `root_n = BLAKE3(root_{n-1} \|\| leaf_hash)`. Changing any leaf changes all subsequent roots. Current root is known to all bilateral partners. | Must convince all bilateral partners to accept new root — impossible without compromising all of them |
| T3.2: Pulse Tree fork | Create two different leaf sequences from the same index | Sequential indices are gap-free. Any bilateral partner holding a receipt at index N will detect a conflicting leaf at index N. | Detectable by anyone with a receipt from the forked region |
| T3.3: Sealed session forgery | Create a fake sealed session envelope | All participants must sign the envelope. Forging requires compromising ALL participants' keys. | Requires compromising every participant in the session |
| T3.4: Timestamp manipulation | Backdate or future-date a Pulse Tree leaf | Timestamps must be monotonically increasing. Bilateral partners validate timestamps against their own clocks. Significant drift detected. | Detectable through bilateral cross-validation |
| T3.5: Envelope content injection | Insert private room content into the public envelope | Room interior encrypted with room key. Envelope contains only boundary data + content_hash. Protocol structurally separates interior from boundary. | Architectural — interior fields don't exist in envelope struct |

**T4: Economic Attacks — $SOMA Manipulation**

| Attack | How it works | Defense | Cost to attacker |
|--------|-------------|---------|-----------------|
| T4.1: Double-spend | Race two sealed sessions spending the same $SOMA | Sequential Pulse Tree indices. soma_balance tracked on every leaf. Second spend would show negative balance — tree rejects it. | Impossible — tree enforces sequential ordering |
| T4.2: $SOMA creation | Mint $SOMA outside genesis pool | No minting operation exists in the protocol. $SOMA only enters circulation through genesis pool extraction via verified computation. | No mechanism exists |
| T4.3: Drain parent via child | Create many child delegations that collectively exceed parent's balance | spend_remaining tracks cumulative child allocation. Cannot allocate more than remaining. | Rejected at delegation creation |
| T4.4: Free trust accumulation | Build trust without spending $SOMA | Trust formula: `weight(receipt) = soma_spent / median`. Zero spend = zero weight. Trust requires economic activity. | Cannot accumulate meaningful trust without real spend |
| T4.5: Inflation attack | Flood network with tiny transactions to dilute trust signals | Normalized weight: `soma_spent / median`. Flood of tiny transactions lowers median, making them worth even less. Self-defeating. | Costs real $SOMA, produces negligible trust |

**T5: Network Attacks — Infrastructure Compromise**

| Attack | How it works | Defense | Cost to attacker |
|--------|-------------|---------|-----------------|
| T5.1: Room host eavesdropping | Host reads room interior | Room key derived from participant key agreement. Host facilitates exchange but cannot derive key without being a participant. Interior encrypted. | Host must compromise participant keys |
| T5.2: Man-in-the-middle | Intercept and modify messages between nodes | All protocol messages are signed with composite signatures. Modification detected. Key agreement uses authenticated keys. | Must compromise signing keys of both endpoints |
| T5.3: Hub compromise (v1) | Compromise HeyVera's hub server | Hub stores only boundary data (envelopes, roots, delegations). Room interiors never reach hub. Hearts store their own Pulse Trees locally. | Loses availability, not sovereignty. Hearts persist. |
| T5.4: Selective envelope suppression | Hub refuses to propagate certain envelopes | Bilateral — both participants have the envelope. Suppressing at the hub only delays topology propagation. v2 gossip protocol eliminates single-point suppression. | Delays trust building, doesn't prevent it |
| T5.5: Eclipse attack | Isolate a node from the network | Node's local Pulse Tree and bilateral receipts are intact. Reconnection to any honest node restores topology view. | Temporary isolation, no permanent damage |

**T6: Trust Topology Attacks — Intelligence Manipulation**

| Attack | How it works | Defense | Cost to attacker |
|--------|-------------|---------|-----------------|
| T6.1: Collusion ring | k agents produce fake bilateral receipts to inflate mutual trust | Vouch ring detection: circular trust patterns automatically discounted. Cross-capability consistency: trust in one domain can't manufacture trust in another. | O(k²) bilateral cost + detection risk |
| T6.2: Trust laundering | Build trust in easy domain, claim trust in hard domain | Trust is capability-specific. Trust for "file access" ≠ trust for "financial transactions." Each domain tracked independently. | Must earn trust in each domain independently |
| T6.3: Long-con | Accumulate years of good behavior, then suddenly misbehave | Trust velocity detects sudden behavioral change. Time-weighted decay means recent behavior dominates. Immune system (Layer 8) flags anomalous pattern shifts. | Must sacrifice years of accumulated trust |
| T6.4: Topology poisoning | Inject misleading patterns into the topology to bias Vera intelligence | Topology patterns emerge from MANY bilateral receipts across MANY Hearts. Poisoning requires coordinated manipulation at scale — back to Sybil cost (O(k²)). | Same cost as Sybil + must sustain over time |

**T7: Existential Threats**

| Threat | Impact | Mitigation |
|--------|--------|------------|
| T7.1: Quantum computer breaks Ed25519 | Classical signature component compromised | ML-DSA-65 composite component still holds. Suite upgrade replaces Ed25519 with next-gen algorithm. Old composite sigs valid (PQ component protected them). |
| T7.2: ML-DSA-65 broken | PQ signature component compromised | Ed25519 component still holds for classical security. Suite upgrade replaces ML-DSA-65. |
| T7.3: BLAKE3 broken | Hash function compromised | Suite upgrade to SHA-3 or successor. Old Pulse Tree roots valid under old suite. New leaves use new hash. Transition leaf records the switch. |
| T7.4: HeyVera dies | Company ceases to exist | Protocol is open source. Spec is the immortal artifact. Pulse Trees are local. Envelopes are bilateral. Someone else builds a node. Network resumes. |
| T7.5: Root Heart compromise | Foundational trust anchor compromised | Root Heart has no special cryptographic powers — only positional authority in delegation tree. Revoke and re-root. Child Hearts' trust history persists independently. |
| T7.6: Supply chain attack | Compromised dependency in crypto stack | Reproducible builds, pinned dependencies, multiple implementations (Rust + Go + C). Cross-implementation verification detects backdoors. |

### Security Properties Summary

| Property | Guarantee | Enforcement |
|----------|-----------|-------------|
| Identity | Only key holder can sign | Composite cryptography (Ed25519 + ML-DSA-65) |
| Integrity | History is tamper-evident | Pulse Tree running root (BLAKE3 chain) |
| Confidentiality | Room interiors are sovereign | XChaCha20-Poly1305 with participant-only keys |
| Authorization | Authority can only narrow | Delegation chain verification at protocol level |
| Non-repudiation | Both parties signed | Bilateral sealed session envelopes |
| Availability | Network survives node loss | Distributed Pulse Trees + bilateral envelope copies |
| Sybil resistance | Fake trust is expensive | O(k²) bilateral cost + real $SOMA spend |
| Crypto agility | Algorithm replacement without protocol death | Suite IDs + composite signatures + graceful transition |

---

## XIX. Open Research

Items not blocking v1 but informing v2+:

1. **Peer-to-peer gossip protocol** — envelope propagation without central hub. Likely libp2p or custom over QUIC.
2. **Pulse Tree compaction** — when trees grow to millions of leaves, efficient verification (Merkle proofs for subtrees).
3. **Multi-party room key agreement at scale** — current MLS-inspired approach works for <100 participants. 1000+ needs TreeKEM or similar.
4. **Zero-knowledge delegation proofs** — prove "I am authorized" without revealing the full delegation chain.
5. **Decentralized $SOMA consensus** — v1 is a ledger. v2+ may need BFT consensus for trustless operation.
6. **Trust topology sharding** — as the topology grows, full replication becomes infeasible. Sharding strategy TBD.
7. **Post-quantum key agreement evolution** — ML-KEM-768 is NIST standard but newer candidates may supersede.
8. **Formal verification tooling** — beyond TLA+ specs: machine-checked proofs in Lean4 for delegation narrowing and Pulse Tree integrity, extractable to executable validators.

---

*Soma Protocol Coding Specification — synthesized 2026-05-20, updated 2026-05-21 (threat model, natural death, ambient Vera, dependency corrections). The trust layer of the agentic internet.*
