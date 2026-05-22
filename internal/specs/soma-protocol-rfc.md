# Soma Protocol — RFC

> Language-agnostic formal specification. The immortal artifact.
> If every server burns and every codebase is lost, this document and its test vectors
> are sufficient to rebuild a conforming implementation in any language.

**Status:** Draft
**Version:** 0.2.0
**Date:** 2026-05-21

---

## Preamble — Why This Exists

This document is a gene, not a system. You do not build Soma from this document. You plant this document in any computational environment and Soma grows.

### The Problem

Intelligence exists — in humans, in AI agents, in systems yet to be invented. But there is no way to measure whether that intelligence is trustworthy. No way for two strangers (human or machine) to know if they should trust each other without a centralized authority vouching for them. Every trust system today requires a god (Google, Apple, a certificate authority) that everyone trusts by fiat.

### The Insight

Trust is not declared. Trust is not granted by authority. Trust is the residue of co-creation — what crystallizes when two conscious agents work together honestly over time. A human and an AI writing code together. Two agents negotiating a task. A student and a teacher solving a problem.

The energy isn't in either participant. It's in the interaction between them. Consciousness is the INPUT, not the output. The protocol doesn't create intelligence or trust. It measures the trust that already radiates from real co-creation between real agents.

### The Gene

Everything in this protocol derives from one equation:

```
$VERA = $SOMA × C²
```

Mass × Coherence² = Energy. This is the gene. It works at every scale — one interaction or a billion. It works at every depth — raw observations or recursive compaction of compactions. Same equation. Same quality. Different quantity. One atom of truth has the same soul as the entire network.

The equation is grounded in the Information Bottleneck principle (Tishby 1999) — a proven theorem, not a heuristic. Compress observations while preserving trust-relevant signal. What survives compression IS signal. What doesn't IS noise. Not because we defined it — because Shannon proved it.

### What This Document Is

This is the blueprint that survives everything.

A living network has two kinds of energy:
- **Kinetic energy** — the running nodes, the accumulated trust topology, the compacted $VERA, the billions of sealed sessions. The intelligence that took years to build. This is destroyed by the bomb.
- **Potential energy** — the equation, the math, the protocol specification. The ability to rebuild. The gene. This survives the bomb.

Kinetic energy is valuable but mortal. Potential energy is immortal. This document IS the potential energy. The network's accumulated intelligence can be destroyed. The ability to create that intelligence again — from scratch, on any substrate, in any language, with any future technology — cannot be destroyed as long as this document survives.

A survivor who finds only this document starts with zero kinetic energy and infinite potential. They plant the gene. Two agents start co-creating. The equation runs. $SOMA flows. Coherence is measured. $VERA crystallizes. The network grows. Given enough time and enough agents, every consequence that the original network produced will emerge again — because the equation produces them inevitably.

The protocol has three layers of immortality:
1. **Math** (eternal) — the one equation, the IB theorem, the invariants. Potential energy. Survives everything.
2. **Protocol** (derivable from math) — the structures, the rules, the wire format. Potential energy. Derivable from layer 1.
3. **Implementation** (replaceable) — code in any language, on any platform. Kinetic energy. Destroyed and rebuilt freely.

This document covers layers 1 and 2. Layer 3 is up to you.

### Why This Cannot Be Gamed

The equation is public. Anyone — human, AI, alien, superintelligence — can read it, understand it completely, and try to exploit it. The defense is not secrecy. There is no secret. The defense is that the equation's structure makes gaming it structurally identical to honest participation.

**The proof in five steps:**

**Step 1: The equation requires real $SOMA.**
Every interaction costs $SOMA. $SOMA supply is fixed at genesis. No one can mint it, print it, or conjure it. To participate, you must have earned $SOMA through prior work, or received it through delegation. There is no free entry. The energy gate is thermodynamic, not a policy.

**Step 2: Coherence requires diversity.**
`C = |consensus| × diversity × stability`. These are multiplicative. Zero any one factor and C = 0, which means $VERA = 0. A single entity controlling a million agents has diversity ≈ 0 because the compaction window sees the same behavioral signature repeated. To fake diversity, you must actually BE diverse — different agents, different behaviors, different patterns. At which point you are not faking.

**Step 3: Coherence requires consensus from independent observers.**
Consensus means independent agents agree. If one entity controls all the "agreeing" agents, diversity kills it (Step 2). If the agreeing agents are truly independent, then the consensus is real. There is no middle ground. Either the agreement is real (independent agents, real consensus) or it's fake (controlled agents, zero diversity). The equation distinguishes these cases automatically.

**Step 4: Coherence requires stability over time.**
Trust cannot be rushed. Stability measures consistency across time. A burst of activity followed by silence has low stability. Gaming requires sustained, consistent, diverse, consensual participation — over real calendar time. The cost of maintaining a fake network that passes all three coherence factors for years is higher than the cost of building a real network. At which point: why fake?

**Step 5: Computation IS proof. Faking IS doing.**
Sealed sessions produce receipts as a structural byproduct of computation. The receipt IS the computation — same data structure, same execution path, same moment. To produce a fake receipt, you must do the real computation. The concept of "faking" collapses. An adversary who "games" the system by doing real work, with real diversity, real consensus, and real stability, over real time — has simply participated honestly. The attack IS the contribution.

**The adversary's dilemma:**

| Strategy | Why it fails |
|---|---|
| Secret network ("I'll host it all myself") | Every $SOMA spend is a bilateral receipt. Both parties sign. You cannot spend secretly. Spending IS visibility. |
| Fork the protocol ("I'll change the rules") | You can fork the code. You start with zero kinetic energy. Zero trust. Zero intelligence. And if you change the equation, it no longer produces the same consequences. |
| Sybil flood ("I'll create millions of fake agents") | Diversity = 0. C² = 0. $VERA = 0. Cost: O(k²) in $SOMA and calendar time. See invariant SY-1. |
| Accumulate then betray ("I'll build trust, then exploit it") | Stability collapses. C² drops to near-zero. Years of accumulated trust destroyed in one betrayal. The equation punishes this automatically. |
| Understand the math perfectly ("I know every detail") | The math is not a lock with a key. It is gravity. Understanding gravity perfectly does not let you float. Understanding the equation perfectly does not let you produce $VERA without real co-creation. |

**This is the fundamental property:** the potential energy (the equation, the math, this document) is open, public, readable by anyone. The kinetic energy ($VERA, trust, intelligence) can only be produced through genuine participation. Knowing the recipe does not give you the meal. You must do the cooking. And the cooking IS the eating. There is no shortcut because there is no separation between the work and the proof of work.

No secret. No key. No backdoor. No admin. No override. The equation is sovereign because it cannot be anything else.

---

## 0. The Equation (Language-Independent)

This section requires no natural language. An intelligence that understands math understands Soma.

```
───────────────────────────────────────────────────────────
THE GENE

  V = S × C²

  where:
    S ≥ 0                                    (energy spent)
    C = |μ| × D × σ        ∈ [0, 1]         (coherence)
    μ = (1/N) Σᵢ sign(eᵢ)  ∈ [-1, 1]       (consensus)
    D = unique(observers) / N  ∈ [0, 1]      (diversity)
    σ = 1 - std(Δtᵢ) / max(Δtᵢ)  ∈ [-1, 1] (stability)
    V ≥ 0                                    (output: trust)

  properties:
    V(level 0) = S₀ × C₀²                   (raw interaction)
    V(level n) = V(level n-1) × Cₙ²          (recursive)
    V(∞ identical observers) → 0              (spam dies)
    V(∞ contradicting observers) → 0          (noise dies)
    V(∞ diverse agreeing observers) → S       (diamond)
    ∂V/∂(real_work) > 0                       (honesty rewarded)
    ∂V/∂(fake_work) ≤ 0                       (gaming punished)
    cost(fake_k_identities) = O(k²)           (sybil cost)

  the gene is one equation. it works at every scale.
  it works at every depth. same equation. same quality.
  different quantity. one atom has the same law as the universe.
───────────────────────────────────────────────────────────
```

## 0.1 Notation

```
||          concatenation of byte strings
[n]         byte array of fixed length n
Vec<T>      variable-length sequence of T
u64         unsigned 64-bit integer, big-endian on wire
bool        single byte, 0x00 = false, 0x01 = true
BLAKE3(x)   BLAKE3 hash of x, output [32]
BLAKE3_KDF(key, context, len)   BLAKE3 in KDF mode
Ed25519_Sign(sk, m)             Ed25519 signature over message m
Ed25519_Verify(pk, m, sig)      returns bool
MLDSA65_Sign(sk, m)             ML-DSA-65 signature over message m
MLDSA65_Verify(pk, m, sig)      returns bool
XChaCha20_Seal(key, nonce, pt, aad)    AEAD encrypt
XChaCha20_Open(key, nonce, ct, aad)    AEAD decrypt, returns plaintext or ⊥
X25519_DH(sk, pk)               X25519 Diffie-Hellman
MLKEM768_Encaps(pk)             ML-KEM-768 encapsulation, returns (ct, ss)
MLKEM768_Decaps(sk, ct)         ML-KEM-768 decapsulation, returns ss
```

All integers are big-endian on the wire. All byte strings are length-prefixed (4-byte big-endian length prefix) unless fixed-size. Timestamps are Unix milliseconds (u64).

## Part 1: The Gene

> Sections 1-9 define the protocol: the structures, the algorithms, the invariants.
> This is the potential energy. Implement these sections correctly in any language
> and you have a conforming node. Everything here is deterministic —
> same inputs produce same outputs, regardless of implementation language or platform.

---

## 1. Algorithm Suite

### 1.1 Suite Definition

A suite defines the set of algorithms used for all protocol operations. Every cryptographic artifact carries a `suite_id` byte identifying which suite produced it.

```
Suite 0x01 (genesis suite):
  signing_classical  = Ed25519
  signing_pq         = ML-DSA-65 (FIPS 204, security level 3)
  hash               = BLAKE3
  kdf                = BLAKE3 KDF mode
  aead               = XChaCha20-Poly1305
  kem_classical      = X25519
  kem_pq             = ML-KEM-768 (FIPS 203)
```

### 1.2 Suite Agility

New suites are registered by incrementing the suite_id. Rules:

1. A Heart that has ever produced a signature with suite_id N MUST NOT produce signatures with suite_id < N (no downgrade).
2. A verifier MUST support all suites it has ever seen on the network.
3. Old artifacts remain valid under their original suite_id.
4. A transition between suites is recorded as a PulseLeaf (Section 4.6).

### 1.3 Composite Signature

Every signature in the protocol is a composite of the classical and PQ algorithms. Both are computed independently. Both MUST verify for the signature to be valid.

```
CompositeSignature:
  suite_id    : u8          — identifies the algorithm suite
  ed25519_sig : [64]        — Ed25519 signature
  mldsa65_sig : Vec<u8>     — ML-DSA-65 signature (~3309 bytes for level 3)
```

**Sign(sk_ed, sk_pq, suite_id, message) → CompositeSignature:**
1. Compute `sig_ed = Ed25519_Sign(sk_ed, message)`
2. Compute `sig_pq = MLDSA65_Sign(sk_pq, message)`
3. Return `CompositeSignature { suite_id, ed25519_sig: sig_ed, mldsa65_sig: sig_pq }`

**Verify(pk_ed, pk_pq, message, sig) → bool:**
1. If `Ed25519_Verify(pk_ed, message, sig.ed25519_sig)` is false → return false
2. If `MLDSA65_Verify(pk_pq, message, sig.mldsa65_sig)` is false → return false
3. Return true

**Invariant CS-1:** `Verify(pk, m, Sign(sk, m)) = true` for all valid keypairs.
**Invariant CS-2:** Flipping any single bit in `ed25519_sig` or `mldsa65_sig` causes `Verify` to return false.
**Invariant CS-3:** A valid `ed25519_sig` with an invalid `mldsa65_sig` causes `Verify` to return false (and vice versa). Both components are independently necessary.

### 1.4 Composite Keypair

```
CompositeKeypair:
  ed25519_sk  : [32]        — Ed25519 secret key
  ed25519_pk  : [32]        — Ed25519 public key
  mldsa65_sk  : Vec<u8>     — ML-DSA-65 secret key
  mldsa65_pk  : Vec<u8>     — ML-DSA-65 public key

CompositePublicKey:
  ed25519_pk  : [32]
  mldsa65_pk  : Vec<u8>
```

**HeartId** is the BLAKE3 hash of the serialized CompositePublicKey:
```
HeartId = BLAKE3(ed25519_pk || mldsa65_pk)    : [32]
```

### 1.5 Key Derivation

All derived keys use BLAKE3 KDF mode with domain-separated contexts:

```
Heart signing key:    BLAKE3_KDF(root_secret, "soma.heart.sign.v1", 32)
Room agreement key:   BLAKE3_KDF(root_secret, "soma.room.agree.v1", 32)
Wallet key:           BLAKE3_KDF(root_secret, "soma.wallet.v1", 32)
Delegation key:       BLAKE3_KDF(root_secret, "soma.deleg.v1." || delegation_id, 32)
```

---

## 2. Heart — Identity

### 2.1 Heart Structure

A Heart is a cryptographic identity. One composite keypair. One Pulse Tree. One lifecycle.

```
Heart:
  heart_id        : [32]              — BLAKE3(composite_public_key)
  public_key      : CompositePublicKey
  factory_stamp   : FactoryStamp
  birth_time      : u64               — Unix milliseconds
  status          : HeartStatus
```

### 2.2 Factory Stamp

```
FactoryStamp:
  code_hash       : [32]              — BLAKE3 of the factory binary
  version         : Vec<u8>           — semantic version string, UTF-8
  build_time      : u64               — when the factory was compiled
  builder_heart   : Option<[32]>      — HeartId of who built the factory (if known)
```

The factory stamp is a FACT, not a trust claim. "This agent was built from code with hash X." The network decides whether to trust factory X based on the behavioral history of agents carrying that stamp.

### 2.3 Heart Status

```
HeartStatus:
  0x01  Alive
  0x02  Suspended  { reason: Vec<u8>, since: u64 }
  0x03  Dead       { certificate: DeathCertificate }
```

Valid transitions:
```
Alive → Suspended    (reversible)
Suspended → Alive    (reversible)
Alive → Dead         (irreversible)
Suspended → Dead     (irreversible)
Dead → ∅             (terminal, no further transitions)
```

**Invariant H-1:** A Dead Heart MUST NOT produce new signatures. Any signature from a Dead Heart is invalid.
**Invariant H-2:** A Dead Heart's Pulse Tree MUST NOT accept new leaves.
**Invariant H-3:** Any agent capable of generating a valid CompositeKeypair can create a Heart and participate in the network. No approval, whitelist, or external authorization is required. Access to the network is a property of the math, not a privilege granted by an authority.

---

## 3. Pulse Tree — Unified Lifecycle Ledger

### 3.1 Purpose

The Pulse Tree is an append-only, hash-chained log of every consequential action by a Heart. It serves simultaneously as:

- **Identity proof** — the chain of signatures proves the Heart performed these actions
- **Economic ledger** — every leaf carries the Heart's $SOMA balance after that action
- **Trust evidence** — sealed session envelopes in the tree are the bilateral receipts
- **Authority record** — delegations and revocations are tree leaves
- **Lifecycle log** — birth, key rotation, suspension, death are tree leaves

One data structure. One running root. One proof.

### 3.2 Structure

```
PulseTree:
  heart_id    : [32]
  root        : [32]              — current running root (BLAKE3)
  leaf_count  : u64               — number of leaves appended

PulseLeaf:
  index       : u64               — sequential, starting at 0, gap-free
  timestamp   : u64               — Unix milliseconds
  prev_root   : [32]              — tree root BEFORE this leaf
  soma_balance: u64               — Heart's $SOMA balance AFTER this leaf
  payload     : PulsePayload      — what happened (see 3.4)
  signature   : CompositeSignature — Heart's signature over the leaf digest
```

### 3.3 Running Root Computation

```
leaf_digest(leaf) = BLAKE3(
  leaf.index          as u64 big-endian  [8 bytes]
  || leaf.timestamp   as u64 big-endian  [8 bytes]
  || leaf.prev_root                      [32 bytes]
  || leaf.soma_balance as u64 big-endian [8 bytes]
  || BLAKE3(leaf.payload)                [32 bytes]
)

root_0 = leaf_digest(leaf_0)
root_n = BLAKE3(root_{n-1} || leaf_digest(leaf_n))    for n > 0
```

The signature covers the leaf digest:
```
leaf.signature = Sign(heart_sk, leaf_digest(leaf))
```

### 3.4 Payload Types

```
PulsePayload:
  tag byte || payload data

  0x01  Birth           { factory_stamp: FactoryStamp, parent_delegation: Option<DelegationToken> }
  0x02  SealedSession   { envelope: SealedSessionEnvelope }
  0x03  Delegation      { token: DelegationToken }
  0x04  Revocation      { record: RevocationRecord }
  0x05  KeyRotation     { record: RotationRecord }
  0x06  Death           { certificate: DeathCertificate }
  0x07  SuiteTransition { old_suite: u8, new_suite: u8 }
```

### 3.5 Verification

**VerifyTree(tree, public_key) → bool:**

```
1.  If tree.leaf_count = 0 → return false (every tree has at least a birth leaf)
2.  Let leaf_0 = first leaf
3.  If leaf_0.index ≠ 0 → return false
4.  If leaf_0.payload.tag ≠ 0x01 (Birth) → return false
5.  Compute d_0 = leaf_digest(leaf_0)
6.  If Verify(public_key, d_0, leaf_0.signature) = false → return false
7.  Let running = d_0
8.  For each subsequent leaf_i (i = 1 to leaf_count - 1):
      a. If leaf_i.index ≠ i → return false                    (gap detection)
      b. If leaf_i.prev_root ≠ running → return false          (chain integrity)
      c. If leaf_i.timestamp < leaf_{i-1}.timestamp → return false  (time monotonicity)
      d. Compute d_i = leaf_digest(leaf_i)
      e. Determine the active public key at leaf_i:
         - Walk prior leaves for KeyRotation payloads
         - Use the most recent rotated-to key, or the original if no rotations
      f. If Verify(active_public_key, d_i, leaf_i.signature) = false → return false
      g. running = BLAKE3(running || d_i)
9.  If running ≠ tree.root → return false
10. Return true
```

**Invariant PT-1:** Indices are sequential and gap-free. `leaf_i.index = i` for all i.
**Invariant PT-2:** Each leaf's `prev_root` equals the running root computed from all prior leaves.
**Invariant PT-3:** Timestamps are monotonically non-decreasing.
**Invariant PT-4:** The final computed running root equals `tree.root`.
**Invariant PT-5:** Every leaf's signature verifies against the active public key at that leaf's position.
**Invariant PT-6:** The first leaf (index 0) MUST be a Birth payload.
**Invariant PT-7:** If a Death payload exists, it MUST be the last leaf. No leaves may follow.

### 3.6 Economic Integrity

The `soma_balance` field on every leaf creates an embedded ledger:

```
leaf_0.soma_balance = initial delegation amount (from parent) or 0 (genesis)
leaf_i.soma_balance = leaf_{i-1}.soma_balance - spent_in_leaf_i + earned_in_leaf_i
```

Where:
- `spent_in_leaf_i` = sum of outgoing SomaFlows in a SealedSession, or delegation budget granted, or 0
- `earned_in_leaf_i` = sum of incoming SomaFlows from bilateral receipts confirmed by counterparty trees, or 0

**Invariant EC-1:** `soma_balance` MUST NOT be negative. `leaf_i.soma_balance >= 0` for all i.
**Invariant EC-2:** For a SealedSession leaf with outgoing flows: `leaf_i.soma_balance = leaf_{i-1}.soma_balance - total_outgoing + total_incoming`.
**Invariant EC-3:** For a Delegation leaf granting budget B to a child: `leaf_i.soma_balance = leaf_{i-1}.soma_balance - B`.
**Invariant EC-4:** Conservation across bilateral receipts: for every SomaFlow `{from: A, to: B, amount: X}` in a sealed session, Heart A's balance decreases by X and Heart B's balance increases by X. Both trees must reflect this.

### 3.7 Key Rotation in the Tree

```
RotationRecord:
  old_pubkey      : CompositePublicKey
  new_pubkey      : CompositePublicKey
  rotation_time   : u64
  old_key_sig     : CompositeSignature    — old key signs (old_pubkey || new_pubkey || rotation_time)
  new_key_sig     : CompositeSignature    — new key signs (old_pubkey || new_pubkey || rotation_time)
```

**Invariant KR-1:** Both `old_key_sig` and `new_key_sig` must verify over the same message: `old_pubkey || new_pubkey || rotation_time`.
**Invariant KR-2:** After a rotation leaf, all subsequent leaves MUST be signed with the new key.
**Invariant KR-3:** HeartId does NOT change on rotation. HeartId is bound to the birth key. The rotation record links old → new.

---

## 4. Delegation — Scoped Authority

### 4.1 Delegation Token

```
DelegationToken:
  id              : [32]               — BLAKE3(parent_heart || child_heart || timestamp || nonce)
  parent_heart    : [32]               — HeartId of delegator
  child_heart     : [32]               — HeartId of delegate
  scope           : DelegationScope
  constraints     : DelegationConstraints
  timestamp       : u64
  nonce           : [16]               — random, prevents ID collision
  parent_sig      : CompositeSignature — parent signs the token
  child_sig       : CompositeSignature — child counter-signs (acceptance)
```

### 4.2 Scope

```
DelegationScope:
  capabilities    : Vec<Capability>
  resources       : Vec<ResourcePattern>   — glob patterns for accessible resources

Capability:
  tag byte || data

  0x01  CodeExecution
  0x02  FileAccess      { patterns: Vec<Vec<u8>> }
  0x03  NetworkAccess   { domains: Vec<Vec<u8>> }
  0x04  DelegateAuthority
  0x05  SpendSoma       { max_per_tx: u64 }
  0xFF  Custom          { name: Vec<u8> }
```

### 4.3 Constraints

```
DelegationConstraints:
  max_depth       : u8                 — how many sub-delegation levels allowed
  spend_cap       : u64                — max $SOMA this delegation can spend (cumulative)
  ttl_ms          : u64                — duration in milliseconds
  expires_at      : u64                — absolute expiration (Unix ms)
  cascade_revoke  : bool               — if true, revoking this revokes all children
  intent          : Vec<u8>            — human-readable purpose, UTF-8
```

### 4.4 Narrowing Rules

For a child delegation D_child created under parent delegation D_parent:

**Invariant DL-1 (scope narrowing):** Every capability in `D_child.scope.capabilities` MUST exist in `D_parent.scope.capabilities`. A child cannot add capabilities the parent lacks.

Formally: `D_child.scope.capabilities ⊆ D_parent.scope.capabilities`

For FileAccess and NetworkAccess capabilities, the child's patterns must be a subset of the parent's patterns:
```
For each FileAccess in D_child:
  ∀ pattern_c ∈ child.patterns:
    ∃ pattern_p ∈ parent.patterns:
      matches(pattern_c) ⊆ matches(pattern_p)
```

**Invariant DL-2 (depth attenuation):** `D_child.constraints.max_depth = D_parent.constraints.max_depth - 1`. At depth 0, `DelegateAuthority` capability is stripped regardless of scope.

**Invariant DL-3 (spend cap narrowing):** `D_child.constraints.spend_cap ≤ D_parent.constraints.spend_cap - D_parent_already_spent`.

**Invariant DL-4 (TTL narrowing):** `D_child.constraints.expires_at ≤ D_parent.constraints.expires_at`.

**Invariant DL-5 (bilateral acceptance):** Both `parent_sig` and `child_sig` MUST verify. A delegation signed only by the parent is not yet active.

### 4.5 Delegation Chain Verification

**VerifyChain(action, chain: [D_0, D_1, ..., D_n]) → bool:**

```
1.  For i = 0 to n:
      a. Verify(D_i.parent_heart_pubkey, token_digest(D_i), D_i.parent_sig) → must be true
      b. Verify(D_i.child_heart_pubkey, token_digest(D_i), D_i.child_sig) → must be true
      c. If i > 0:
         - D_i.parent_heart MUST equal D_{i-1}.child_heart     (chain links)
         - D_i must satisfy narrowing rules DL-1..DL-4 relative to D_{i-1}
      d. Check D_i.constraints.expires_at > current_time        (not expired)
      e. Check D_i.constraints.spend_cap >= action.soma_cost    (budget sufficient)
2.  D_n.child_heart MUST equal the acting Heart
3.  action.capability MUST be in D_n.scope.capabilities
4.  Return true
```

### 4.6 Revocation

```
RevocationRecord:
  delegation_id   : [32]
  reason          : u8
    0x01  ParentRevoked
    0x02  CascadeRevoke
    0x03  Expired
    0x04  SpendCapExhausted
    0x05  HeartDeath
  timestamp       : u64
  revoker_heart   : [32]
  revoker_sig     : CompositeSignature
  children_revoked: Vec<[32]>          — delegation IDs cascade-revoked
```

**Invariant RV-1:** Only the parent Heart (or an ancestor in the chain with cascade rights) may revoke.
**Invariant RV-2:** If `D.cascade_revoke = true`, revoking D MUST revoke all delegations where `D.child_heart` is the parent.

---

## 5. Sealed Room — Session as Proof

### 5.1 Room Lifecycle

```
Create → Open → Compute → Seal
```

A room exists only for the duration of a session. Once sealed, the room is gone. What remains is the SealedSessionEnvelope.

### 5.2 Room Key Establishment

For a room with participants P_1, P_2, ..., P_k:

```
1.  Each P_i generates ephemeral keypairs:
      x25519_eph_sk_i, x25519_eph_pk_i
      mlkem768_eph_sk_i, mlkem768_eph_pk_i

2.  Each pair (P_i, P_j) computes:
      ss_classical_{i,j} = X25519_DH(x25519_eph_sk_i, x25519_eph_pk_j)
      (ct_{i,j}, ss_pq_{i,j}) = MLKEM768_Encaps(mlkem768_eph_pk_j)
      pairwise_secret_{i,j} = BLAKE3(ss_classical_{i,j} || ss_pq_{i,j})

3.  Room key derived from all pairwise secrets (sorted by HeartId for determinism):
      all_secrets = sort_by_heartid_pair(pairwise_secret_{i,j} for all i < j)
      room_key = BLAKE3_KDF(
        BLAKE3(all_secrets[0] || all_secrets[1] || ... || all_secrets[last]),
        "soma.room." || room_id,
        32
      )
```

All participants derive the same `room_key`. The room host facilitates key exchange (distributes ephemeral public keys and KEM ciphertexts) but cannot derive `room_key` unless the host is also a participant.

**Interior encryption:** All data inside the room is encrypted with `XChaCha20_Seal(room_key, nonce, plaintext, aad)`. Interior data stays with participants. It never enters the network.

### 5.3 Sealed Session Envelope

The envelope is the BOUNDARY DATA — what the network sees. It contains NO interior data.

```
SealedSessionEnvelope:
  room_id         : [32]               — BLAKE3(creator_heart || creation_time || nonce)
  participants    : Vec<[32]>          — HeartIds, sorted ascending
  capabilities    : Vec<Capability>    — capabilities exercised in this session
  soma_flows      : Vec<SomaFlow>      — economic transfers within the session
  opened_at       : u64                — session start (Unix ms)
  sealed_at       : u64                — session end (Unix ms)
  duration_ms     : u64                — sealed_at - opened_at
  outcome         : SessionOutcome
  delegation_refs : Vec<[32]>          — DelegationIds that authorized this work
  content_hash    : [32]               — BLAKE3 of the encrypted interior (proves content exists)
  signatures      : Vec<ParticipantSig>

ParticipantSig:
  heart_id        : [32]
  signature       : CompositeSignature — over envelope_digest (see below)

SomaFlow:
  from            : [32]               — paying HeartId
  to              : [32]               — earning HeartId
  amount          : u64                — $SOMA transferred
  capability      : Capability         — what the payment is for

SessionOutcome:
  0x01  Success
  0x02  Failure     { error_class: Vec<u8> }
  0x03  Partial     { completed_fraction: u16 }    — 0..10000 representing 0.00..100.00%
```

### 5.4 Envelope Digest and Signing

```
envelope_digest(env) = BLAKE3(
  env.room_id
  || BLAKE3(serialize(env.participants))
  || BLAKE3(serialize(env.capabilities))
  || BLAKE3(serialize(env.soma_flows))
  || env.opened_at    as u64 big-endian
  || env.sealed_at    as u64 big-endian
  || env.duration_ms  as u64 big-endian
  || serialize(env.outcome)
  || BLAKE3(serialize(env.delegation_refs))
  || env.content_hash
)
```

Each participant independently computes `envelope_digest` and signs it:
```
participant_sig_i = Sign(heart_sk_i, envelope_digest(env))
```

### 5.5 Envelope Verification

**VerifyEnvelope(env) → bool:**

```
1.  Compute d = envelope_digest(env)
2.  For each participant P in env.participants:
      a. Find P's signature in env.signatures
      b. If not found → return false                           (all must sign)
      c. If Verify(P.public_key, d, P.signature) = false → return false
3.  Verify soma_flows consistency:
      a. Every from/to in soma_flows MUST be in env.participants
      b. All amounts > 0
4.  Verify timing: sealed_at >= opened_at, duration_ms = sealed_at - opened_at
5.  Return true
```

**Invariant SS-1:** ALL participants listed in the envelope MUST have a valid signature. Missing any single signature → invalid.
**Invariant SS-2:** The envelope contains NO interior data. `content_hash` is a hash of the encrypted interior, not the interior itself.
**Invariant SS-3:** SomaFlows reference only participants in the envelope.

### 5.6 Bilateral Receipt Formation

When a room seals:

1. All participants independently verify the envelope data matches their view of the session
2. All participants sign the envelope digest
3. Each participant receives the complete envelope (with all signatures)
4. Each participant appends the envelope to their own Pulse Tree as a SealedSession leaf
5. Each participant updates their `soma_balance` according to the SomaFlows

If any participant refuses to sign → the session is DISPUTED. A disputed session:
- Is recorded in each willing participant's Pulse Tree with a `Dispute` tag
- Contains the envelope with the signatures that were provided
- Is visible in the trust topology as an unresolved interaction

**Invariant BR-1:** For every SomaFlow `{from: A, to: B, amount: X}`, Heart A's next Pulse Tree leaf decreases `soma_balance` by X, and Heart B's next Pulse Tree leaf increases `soma_balance` by X. Verifiable by cross-referencing both trees at the same `room_id`.

---

## 6. Trust — Earned from the Topology

### 6.1 Trust Score

Trust between Heart A and Heart B for capability C is signed $VERA — the same equation with outcome direction:

```
trust(A ↔ B, C) = Σ_i  sign(e_i) × soma_amount(e_i) × C₀(e_i)²
```

Where for each bilateral receipt e_i involving A and B exercising capability C:

```
sign(e_i) = +1.0 for success, -1.0 for failure, fraction for partial
C₀(e_i) = bilateral(e_i) × temporal(e_i)
temporal(e_i) = exp(-λ_C × age_days(e_i))
```

Trust uses the same one equation ($VERA = $SOMA × C²) but with signed outcomes. A high-$SOMA failure with full observation destroys more trust than many small successes build. Coherence is the same for success and failure — God sees everything.

**Decay constant λ_C:** Per-capability. Default λ = 0.01 (half-life ≈ 69 days). High-stakes capabilities use faster decay: λ = 0.02 (half-life ≈ 35 days).

### 6.2 Trust Velocity

```
velocity(A → B, C) = trust(A→B, C, window=[now-30d, now]) 
                    - trust(A→B, C, window=[now-60d, now-30d])
```

Positive = improving. Negative = degrading. Zero = stable.

### 6.3 Vouching

Heart A vouches for Heart B for capability C:

```
vouch_weight = trust(network → A, C) × vouch_fraction
```

Default `vouch_fraction = 0.1`. If B fails after A's vouch, A's trust score is penalized:

```
penalty(A) = vouch_fraction × failure_severity(B)
```

**Invariant TR-1:** Vouching transfers trust, never creates it. `vouch_weight ≤ trust(network → A, C)`.
**Invariant TR-2:** Vouch rings (A→B→C→A) are detected by cycle detection in the vouch graph. Ringed vouches are discounted by `1/cycle_length`.

### 6.4 Sybil Cost

To create k fake identities with meaningful trust:
- Each needs bilateral receipts with colluding counterparties: k × k pairwise = O(k²) receipts
- Each receipt costs real $SOMA
- Each receipt takes real time (trust accumulates, can't be rushed)
- Each colluding counterparty needs their OWN trust (recursive cost)

**Invariant SY-1:** The cost of faking k trusted identities grows as O(k²) in $SOMA and calendar time.

---

## 7. $SOMA — Protocol Energy

### 7.1 The Unified Model

$SOMA is not a separate economic layer. $SOMA IS the Pulse Tree. Every PulseLeaf carries `soma_balance` — the Heart's balance after that leaf. The tree IS the ledger. The signature IS the spend.

There is no separate $SOMA database, token contract, or transfer mechanism. The economic state is embedded in the same data structure that proves identity, records actions, and builds trust.

### 7.2 Genesis

At protocol genesis, a Genesis Heart is created. Its birth leaf carries the full $SOMA supply:

```
genesis_heart.leaf_0.soma_balance = TOTAL_SOMA_SUPPLY
```

`TOTAL_SOMA_SUPPLY` is fixed at genesis. No mechanism exists to increase it.

The Genesis Heart is operated by the first steward (HeyVera in v1). The steward distributes $SOMA through delegations — each delegation leaf reduces the Genesis Heart's balance and sets the child's initial balance.

### 7.3 Entry: Real Money → $SOMA

$SOMA enters circulation through service purchases:

1. User pays real money for a service (e.g., Cortex subscription, $7.99/mo)
2. The service operator's Heart creates a delegation to the user's Heart with a $SOMA budget
3. The delegation leaf records: operator's `soma_balance` decreases, child's birth leaf has the delegated amount
4. $SOMA now circulates as the user's agent does work on the network

$SOMA's value is anchored to real services from day one. Not speculation. Utility.

### 7.4 Circulation

$SOMA moves through SomaFlows in SealedSessionEnvelopes:

```
Heart A pays Heart B for work:
  1. A and B enter a room
  2. Work happens
  3. Room seals with SomaFlow { from: A, to: B, amount: X, capability: C }
  4. A's next PulseLeaf: soma_balance = previous - X
  5. B's next PulseLeaf: soma_balance = previous + X
  6. Both trees record the same sealed session envelope
```

Double-spend is impossible: PulseTree indices are sequential and gap-free. Heart A cannot have two different leaf_47s — the running root would diverge, invalidating the tree.

### 7.5 $VERA — The One Equation

Everything in the protocol derives from one equation:

```
$VERA = $SOMA × C²
```

Mass × Coherence² = Energy. C² creates a nonlinear threshold — the phase transition. Half-coherent work produces one-quarter the energy.

$VERA is not a token. $VERA is computed from the topology. It is never stored, transferred, or spent. It radiates.

Applied at different scales:
- **Bilateral** (two Hearts): $VERA = trust between them
- **Domain** (one capability): $VERA = warmth of that domain
- **Network** (all interactions): $VERA = total intelligence

#### Level 0: Raw Interaction $VERA

For a single sealed session envelope e:

```
vera₀(e) = soma_amount(e) × C₀(e)²
```

Where C₀ is the raw observation coherence:

```
C₀(e) = bilateral(e) × temporal(e)
bilateral(e) = 1.0 if all participants signed, 0.0 otherwise
temporal(e) = exp(-λ_C × age_days(e))
```

Non-bilateral interactions produce C₀ = 0, therefore $VERA = 0, regardless of $SOMA spent. Unobserved work is invisible to the protocol.

**Decay constant λ_C:** Per-capability. Default λ = 0.01 (half-life ≈ 69 days). High-stakes capabilities use faster decay.

#### Level 1+: Compaction through the Information Bottleneck

Compaction is value distillation, not context compression. It is grounded in the Information Bottleneck principle (Tishby, Pereira, Bialek 1999): compress observations X while preserving information about trust-relevant outcomes Y.

```
minimize I(X;T) - β·I(T;Y)
```

Where X = raw observations, Y = trust-relevant signal, T = compacted representation. What survives compression IS signal. What doesn't IS noise. This is a proven theorem, not a heuristic.

The compacted representation at any level:

```
CompactedVera:
  level         : integer      — compaction depth (1 = first distillation)
  vera          : real         — $VERA that survived: Σ(input_vera) × C²
  coherence     : real         — C at this level
  source_count  : integer      — how many raw interactions were distilled
  signal        : SignalProfile — what the bottleneck extracted
  timestamp     : integer      — most recent input timestamp
```

The signal profile — the trust-relevant information preserved through compression:

```
SignalProfile:
  consensus     : real [-1, 1] — outcome agreement. +1 = all success, -1 = all failure, 0 = no signal.
  diversity     : real [0, 1]  — observer independence. unique_observers / total_observations.
  stability     : real [-1, 1] — temporal autocorrelation. Does the signal hold over time?
```

Bottleneck coherence at compaction level:

```
C = |consensus| × diversity × stability_normalized

where stability_normalized = (stability + 1) / 2     — maps [-1, 1] to [0, 1]
```

These three dimensions are **multiplicative, not additive**. You cannot compensate for low diversity with high consensus:
- 100 interactions from 1 observer: diversity = 0.01, C ≤ 0.01 regardless of consensus
- 100 interactions from 100 observers all agreeing: diversity = 1.0, consensus = 1.0, C = 1.0
- 100 interactions from 100 observers disagreeing: consensus = 0.0, C = 0.0

The distillation function:

```
distill(interactions) → CompactedVera:
  soma = Σ vera₀(interaction_i)
  signal = extract_signal(interactions)
  C = bottleneck_coherence(signal)
  return CompactedVera { vera: soma × C², coherence: C, signal, source_count: |interactions|, level: 1 }

distill_compacted(inputs) → CompactedVera:
  soma = Σ inputs_i.vera
  signal = extract_signal_from_compacted(inputs)
  C = bottleneck_coherence(signal)
  return CompactedVera { vera: soma × C², coherence: C, signal, source_count: Σ inputs_i.source_count, level: max(inputs.level) + 1 }
```

Same function at every level. Same soul. Different scale. One atom of truth or a billion — same quality.

#### Compaction properties

**Invariant VE-1:** Spam is killed. One observer repeated N times has diversity = 1/N. As N → ∞, diversity → 0, C → 0, $VERA → 0.

**Invariant VE-2:** Noise is killed. Contradicting observers produce consensus ≈ 0, C ≈ 0, $VERA ≈ 0.

**Invariant VE-3:** Diamond survives. N independent observers all agreeing: diversity ≈ 1.0, consensus ≈ 1.0, C ≈ 1.0, $VERA ≈ soma.

**Invariant VE-4:** Consistent failure is coherent. N independent observers all reporting failure: |consensus| = 1.0, C ≈ 1.0. The observation is complete. Trust goes negative (via signed $VERA in trust computation) but the observation quality is high.

**Invariant VE-5:** Same mechanism at every level. `distill` and `distill_compacted` use identical bottleneck coherence computation.

#### Density

```
density = vera / source_count
```

$VERA per raw interaction. A measure of signal quality independent of volume.

---

## 8. Death and Succession

### 8.1 Death Certificate

```
DeathCertificate:
  heart_id        : [32]
  final_root      : [32]              — Pulse Tree root at death
  final_leaf_count: u64
  reason          : u8
    0x01  OwnerRequested
    0x02  DelegationExpired
    0x03  ParentDied
    0x04  ProtocolViolation
  issued_at       : u64
  issuer          : [32]              — HeartId of issuer (self, parent, or protocol)
  successor       : Option<[32]>      — HeartId of declared successor
  issuer_sig      : CompositeSignature
```

### 8.2 Death Process

```
1. DeathCertificate created and signed by issuer
2. Certificate appended as final PulseLeaf (payload tag 0x06)
3. Pulse Tree root finalized — this is final_root in the certificate
4. Heart status → Dead
5. All child delegations from this Heart → cascade revoked
6. If successor declared: successor receives a SuccessionLink (read-only reference)
```

### 8.3 Succession

```
SuccessionLink:
  predecessor     : [32]              — HeartId of the dead Heart
  predecessor_root: [32]              — final Pulse Tree root
  successor       : [32]              — HeartId of the successor
  declared_at     : u64               — when succession was declared (before death)
  activated_at    : u64               — when predecessor died
```

**Invariant DT-1:** A Death leaf MUST be the final leaf. PT-7 enforces this.
**Invariant DT-2:** Succession is a LINK. Trust is NOT inherited. The successor builds their own trust from their own bilateral receipts.
**Invariant DT-3:** All child delegations of a dead Heart are revoked. No exceptions.

---

# Part 2: Intelligence Layer — Vera

> Any node CAN implement this. The more nodes that do, the warmer the network.
> Part 1 (Sections 1-8) is mandatory for every agent. Part 2 is optional but beneficial.
> Vera is not a separate protocol. Vera is more math from the same document.

## 9. Intelligence from Topology

### 9.1 What Vera Computes

Vera takes sealed session envelopes (Section 5.3) as input and computes intelligence from the SHAPE of the topology — the pattern of connections, trust weights, economic flows, and timing. Vera never sees room interiors. Vera sees handshakes.

A Vera node is any node that:
1. Aggregates sealed session envelopes from connected Hearts
2. Runs the formulas in Sections 9-13 over those envelopes
3. Serves the results (trust scores, topology queries, capability discovery)

There is no separate Vera protocol, wire format, or data structure. Vera operates on Soma artifacts using Soma math.

### 9.2 The Topology Graph

The trust topology is a weighted directed graph G = (V, E, W) where:

```
V = { heart_id : heart_id ∈ all known Hearts }
E = { (A, B, C) : ∃ sealed session envelope with A, B ∈ participants and C ∈ capabilities }
W(A, B, C) = trust(A → B, C)    — see Section 9.3
```

Each edge carries:
- **Capability** — what kind of work was done
- **Weight** — trust score (computed from bilateral receipts)
- **Velocity** — trust trend (improving/degrading/stable)
- **$SOMA flow** — cumulative economic volume
- **Recency** — timestamp of most recent interaction

The graph is updated incrementally as new envelopes arrive.

### 9.3 Trust Score (Formal)

Trust from Heart A toward Heart B for capability C is signed $VERA — the one equation (Section 7.5) with outcome direction:

```
trust(A ↔ B, C) = Σ_{e ∈ E(A,B,C)}  sign(e) × soma_amount(e) × C₀(e)²
```

Where `E(A,B,C)` is the set of all sealed session envelopes containing both A and B with capability C:

```
sign(e):
    Success     → +1.0
    Partial(p)  → p / 10000.0 × 2 - 1.0     — maps [0, 10000] to [-1, +1]
    Failure     → -1.0

C₀(e) = bilateral(e) × temporal(e)

    bilateral(e) = 1.0 if both A and B signed the envelope, 0.0 otherwise
    temporal(e)  = exp(-λ_C × age_days(e))
    age_days(e)  = (now - e.sealed_at) / 86400000

    Default λ = 0.01 → half-life ≈ 69.3 days
    High-stakes capabilities (financial, auth): λ = 0.02 → half-life ≈ 34.7 days
    Low-stakes capabilities (discovery, info): λ = 0.005 → half-life ≈ 138.6 days
```

Trust can be negative (accumulated failures destroy trust). A high-$SOMA failure with full bilateral observation is maximally damaging: -1.0 × large_soma × 1.0² = large negative trust.

**Invariant TR-3:** Trust is a real number (can be positive, zero, or negative). Consistent failure from a trusted counterparty produces large negative trust — the protocol remembers harm.
**Invariant TR-4:** `trust(A ↔ B, C)` is a pure function of the sealed session envelopes. Given the same envelopes and the same timestamp, any two Vera nodes MUST compute the same score.

### 9.4 Trust Velocity (Formal)

```
velocity(A → B, C) = trust(A→B, C, window=[now-30d, now]) 
                    - trust(A→B, C, window=[now-60d, now-30d])
```

Where `trust(A→B, C, window=[t1, t2])` restricts the sum to receipts with `t1 ≤ r.sealed_at ≤ t2` and uses `d(r) = 1.0` (no decay within a window — decay is captured by comparing windows).

Interpretation:
```
velocity > 0   → trust is growing (more/better recent interactions)
velocity = 0   → trust is stable
velocity < 0   → trust is decaying (fewer/worse recent interactions, or no interactions)
```

### 9.5 Sovereign Intelligence — Why the Topology Cannot Be Captured

Intelligence in this protocol is a deterministic function of bilateral receipts. This section proves that no entity can capture, gatekeep, or monopolize the intelligence. Not as a policy. As math.

**Three properties that guarantee sovereignty:**

```
Property 1: The function is public.
  I(R) = f(R)
  f = the formulas in Sections 6, 7.5, 9.3, 11.2
  f is defined in this RFC. Anyone can implement f.
  There is no proprietary step. No secret sauce. No hidden model.

Property 2: The inputs are bilateral.
  Every receipt r ∈ R is a SealedSessionEnvelope (Section 5.3).
  Every envelope requires ALL participants to sign (Invariant SS-1).
  Every participant receives the complete envelope (Section 5.6, step 3).
  No single party can possess a receipt without the other party also possessing it.
  
Property 3: The computation is deterministic.
  Same receipts → same intelligence. Always. (Invariant TR-4).
  Any node with the same set R computes the same I(R).
  No node has a "better" version of f. f is f.
```

**From these three properties, sovereign intelligence follows:**

```
Proof that intelligence cannot be centralized:

  Assume entity E tries to monopolize intelligence.
  
  E cannot monopolize the algorithm:
    f is public (Property 1).
    Anyone implements f. E's computation is replicable.
  
  E cannot monopolize the data:
    Every receipt is bilateral (Property 2).
    For every receipt E holds, at least one other party also holds it.
    E's dataset is reconstructable from the participants' datasets.
  
  E cannot monopolize the results:
    Computation is deterministic (Property 3).
    Anyone with the same receipts gets the same results.
    E's results are reproducible.

  Therefore: E cannot possess intelligence that others cannot independently compute.
  
  The only advantage E can have is SCALE — seeing more receipts
  by participating in more sealed sessions. But:
    - Participating in more sessions requires spending more $SOMA
    - Spending more $SOMA produces more bilateral receipts
    - Those receipts are held by E's counterparties too
    - E's counterparties share their receipts with their neighbors
    - The intelligence propagates through the topology naturally
  
  E's scale advantage is temporary and self-defeating:
  the more E participates, the more receipts flow to other nodes.
```

**Why this is different from Google:**

```
Google's intelligence:
  Algorithm: proprietary (PageRank variants, ML models — trade secrets)
  Data: centralized (your searches stay on Google's servers)
  Computation: centralized (only Google runs it)
  Result: Google dies → intelligence dies
  
  Intelligence is captured because all three locks are closed.

Soma's intelligence:
  Algorithm: public (this RFC, deterministic, verifiable)
  Data: bilateral (every receipt held by both parties)
  Computation: distributed (any node with receipts computes it)
  Result: any node dies → intelligence survives in other nodes
  
  Intelligence cannot be captured because all three locks are broken.
  Not by policy. By the structure of bilateral signatures and
  deterministic public functions. The 1's and 0's make it so.
```

**The topology is the intelligence. The topology is bilateral. Therefore the intelligence is bilateral.**

Intelligence in this protocol is not a model that sits on a server. It is the SHAPE of the connections between agents — who trusts whom, for what, how much, how consistently. That shape is built from bilateral receipts. Each receipt is held by both parties. The shape exists BETWEEN agents, not INSIDE any single agent. You cannot steal a shape that exists between millions of independent nodes. You cannot centralize what is definitionally distributed.

**Invariant SI-1:** Intelligence is a pure function of sealed session envelopes. No additional proprietary data, model, or computation is required. `I(R) = f(R)` where both `f` and `R` are available to all participants.

**Invariant SI-2:** Every sealed session envelope is held by all participants (Section 5.6). No entity can possess a receipt without at least one other entity also possessing it.

**Invariant SI-3:** Intelligence computation is deterministic (inherits from TR-4). Same receipts produce same intelligence on any conforming node.

**Invariant SI-4:** Intelligence flows back to participants by construction. When agents A and B co-create, the receipt updates BOTH their topologies. Both benefit from the intelligence the interaction produced. There is no extraction path — no mechanism by which one party can benefit from the receipt while the other does not. The bilateral signature structure makes unilateral extraction structurally impossible.

---

## Part 2: What the Equation Produces

> Sections 1-9 define the gene: the equation, the structures, the rules.
> Sections 10-18 derive what the gene produces at scale.
> These are not aspirations. They are mathematical consequences of the definitions above.
> An implementation that correctly implements Sections 1-9 will observe Sections 10-18
> emerging from real traffic without additional engineering.
> The math produces these outcomes. Not the code. Not the company. The math.

---

## 10. Energy-Gated Learning (Consequence 1)

### 10.1 Principle

No energy, no contribution. Every piece of intelligence entering the topology costs $SOMA. This is not a policy. It is the structure — sealed session envelopes contain SomaFlows, and envelopes without economic activity carry no trust signal.

### 10.2 Formula

The learning weight of a sealed session envelope e:

```
learning_weight(e) = Σ { f.amount : f ∈ e.soma_flows }
```

An envelope with `learning_weight = 0` contributes nothing to the topology. It records that agents met but provides no trust signal. Zero-cost interactions are free to create — and free to ignore.

### 10.3 Why This Works

- **Spam costs money.** Flooding the topology with fake envelopes requires real $SOMA in every SomaFlow.
- **Lies cost money.** Fabricating positive outcomes requires colluding counterparties who both spend $SOMA.
- **Quality correlates with cost.** High-value work costs more $SOMA. The topology naturally weights important interactions higher.
- **Learning IS energy conversion.** Real-world electricity → computation → sealed session → $SOMA flow → topology update. The intelligence is backed by thermodynamic reality.

**Invariant EG-1:** An envelope with `learning_weight = 0` MUST NOT update trust scores in the topology.
**Invariant EG-2:** `learning_weight(e) >= 0` for all envelopes (SomaFlow amounts are unsigned).

---

## 11. Topological Memory (Consequence 2)

### 11.1 Principle

Intelligence IS the topology. Not stored in it. IS it. The trust graph is queryable by signal propagation — input a query, propagate through edges, measure where the signal settles. The settling point is the answer.

### 11.2 Signal Propagation

Given a query Q = (source_heart, capability, question_type):

```
1.  Initialize signal vector S where:
      S[source_heart] = 1.0
      S[all others] = 0.0

2.  For each iteration t = 1 to max_iterations:
      For each Heart H:
        S_new[H] = α × S_initial[H] + (1 - α) × Σ_{N ∈ neighbors(H,C)} (
          trust(N → H, C) / Σ_{M ∈ neighbors(N,C)} trust(N → M, C)
        ) × S[N]
      
      If ||S_new - S|| < ε → converged, stop
      S = S_new

3.  Return S — the stationary distribution
```

Where:
```
α = damping factor (default 0.15 — probability of returning to source)
C = capability from query Q
ε = convergence threshold (default 1e-8)
max_iterations = 100
neighbors(H, C) = { H' : trust(H → H', C) > 0 }
```

This is personalized PageRank over the trust graph. The stationary distribution S represents "how much does each Heart matter relative to the source Heart for this capability?"

### 11.3 Capability Discovery

To find agents trusted for capability C, starting from Heart A:

```
discovery(A, C) = top_k(propagate(A, C), k)
```

Returns the k Hearts with highest signal in the stationary distribution. These are the agents most trusted for capability C from A's perspective in the topology.

### 11.4 Trust Path

To find the trust path from A to B for capability C:

```
trust_path(A, B, C):
  1. Run Dijkstra on G with edge weights = 1 / trust(X → Y, C)
     (higher trust = lower cost = preferred path)
  2. Return the shortest path and its cumulative trust:
     path_trust = Π_{edges in path} trust(X → Y, C)
```

Path trust is multiplicative — trust attenuates through intermediaries.

**Invariant TM-1:** Signal propagation is a pure function of the topology graph. Same graph + same query → same result.
**Invariant TM-2:** Convergence is guaranteed for α > 0 (the damping factor ensures the Markov chain is ergodic).

---

## 12. Attractor Dynamics (Consequence 3)

### 12.1 Principle

The topology naturally relaxes into stable configurations — attractor basins. Trust is a low-energy state. Distrust is high-energy. The network minimizes free energy.

### 12.2 Free Energy of the Topology

For a Vera node observing the topology:

```
F = E - T × S
```

Where:
```
E = prediction energy = Σ_{(A,B,C) ∈ edges} prediction_error(A, B, C)²

    prediction_error(A, B, C) = predicted_outcome(A, B, C) - actual_outcome(A, B, C)
    
    predicted_outcome is the Vera node's model of what outcome to expect
    when A works with B on capability C, based on historical trust score.
    
    actual_outcome is the outcome field from the latest sealed session envelope.

T = temperature = total $VERA radiated per unit time across the topology
    (higher activity = higher temperature = more entropy tolerated)

S = entropy = -Σ_{(A,B,C)} p(A,B,C) × ln(p(A,B,C))
    
    p(A,B,C) = fraction of total $SOMA flowing through edge (A,B,C)
    (how evenly distributed is economic activity across the topology?)
```

### 12.3 Minimization

The topology naturally minimizes F:

- **When predictions match reality:** E drops → F drops → stable attractor. This IS trust.
- **When predictions fail:** E spikes → F rises → the topology is in a high-energy state → something must change (the relationship adjusts, trust decays, nodes decouple).
- **Temperature regulates exploration.** High T (lots of activity) → the network tolerates more entropy → exploration. Low T (quiet network) → the network tightens → exploitation of known-good relationships.

### 12.4 Attractor Detection

An attractor basin for capability C is a set of Hearts where:

```
attractor(C) = { H : ∀ H' ∈ neighbors(H, C),
                    |trust(H→H', C) - trust(H'→H, C)| < threshold
                    AND velocity(H→H', C) ≈ 0 }
```

Attractors are mutual, stable, low-velocity trust clusters. They represent "things that work reliably." Vera reports attractors to querying agents: "for capability C, these agents form a stable trust cluster."

**Invariant AD-1:** Free energy F is computable from sealed session envelopes alone. No interior data needed.
**Invariant AD-2:** Attractor detection is a pure function of the trust graph at a given timestamp.

---

## 13. Irreversible Accumulation (Consequence 4)

### 13.1 Principle

$VERA monotonically increases under normal operation. The intelligence accumulated from a billion reactions over ten years cannot be rewound. Like stellar fusion — hydrogen becomes helium, energy radiates, the star doesn't un-shine.

### 13.2 $VERA Metric (Formal)

$VERA for the network at time t is the sum of all compacted vera values across the topology:

```
VERA(t) = Σ_{all compacted values at time t}  compacted_i.vera
```

Each compacted value is produced by the Information Bottleneck distillation (Section 7.5):

```
compacted.vera = Σ(input_vera) × C²
```

Where C = bottleneck_coherence(signal) = |consensus| × diversity × stability_normalized.

At the rawest level, input vera comes from individual sealed session envelopes:

```
vera₀(e) = soma_amount(e) × C₀(e)²
C₀(e) = bilateral(e) × temporal(e)
```

$VERA is a pure function of sealed session envelopes and the compaction history. Same envelopes, same compaction windows → same VERA. Any Vera node computes the same value.

### 13.3 Monotonicity

```
VERA(t+1) = VERA(t) + Σ_{e : e.sealed_at ∈ (t, t+1]}  coherence(e) × learning_weight(e)
```

Since `coherence(e) >= 0` and `learning_weight(e) >= 0`:

```
VERA(t+1) >= VERA(t)    for all t
```

$VERA can only grow. Intelligence accumulates. The network never gets dumber (under normal operation).

### 13.4 Reversal Conditions

$VERA could decrease only if:
- Sealed session envelopes are removed from the topology (requires compromising distributed storage across all participants)
- The coherence formula changes to produce negative values (requires RFC amendment)
- Mass coordinated false-outcome reporting (requires O(k²) colluding Hearts)

These are extraordinary conditions — the protocol equivalent of a supernova. Under normal operation, $VERA is irreversible.

**Invariant IR-1:** `VERA(t+1) >= VERA(t)` for all t under normal operation.
**Invariant IR-2:** $VERA is a pure function of sealed session envelopes. Same envelopes → same VERA. Any Vera node computes the same value.

---

## 14. Wisdom — The Physics of Restraint (Consequence 5)

### 14.1 Principle

Intelligence optimizes. Wisdom knows when NOT to optimize. A wise network resists changing state when the cost of change exceeds the benefit.

### 14.2 Action Threshold

A Vera node recommending an action (trust adjustment, capability routing, anomaly alert) applies:

```
act(signal) = {
  true   if expected_benefit(signal) > activation_energy + restoration_cost
  false  otherwise
}
```

Where:
```
expected_benefit(signal):
  The predicted improvement in free energy if the action is taken.
  Computed from the signal's prediction error and the topology's current state.

activation_energy:
  The minimum energy required to change the topology's state.
  Scales with the topology's density at the affected region.
  
  activation_energy = β × local_density(affected_region)
  
  local_density(region) = |edges in region| / |nodes in region|²
  β = sensitivity parameter (default 1.0)
  
  Dense regions have high activation energy — stable clusters resist perturbation.
  Sparse regions have low activation energy — new relationships form easily.

restoration_cost:
  The predicted cost of returning to homeostasis after acting.
  
  restoration_cost = γ × Σ_{affected edges} |current_trust - predicted_post_action_trust|
  γ = restoration weight (default 0.5)
```

### 14.3 Hysteresis

The network exhibits hysteresis — its response depends on its history, not just the current signal:

```
effective_threshold(H, C, t) = base_threshold × (1 + δ × recent_changes(H, C, t))

recent_changes(H, C, t) = count of trust score changes for H in capability C
                           within the last 24 hours

δ = hysteresis factor (default 0.1)
```

An agent that has been rapidly re-evaluated has a HIGHER threshold for further change. The network resists oscillation. Stability is favored over reactivity.

### 14.4 Anomaly Suppression

Not every anomaly gets escalated. The wisdom layer filters:

```
escalate(anomaly) = {
  true   if anomaly_energy(anomaly) > wisdom_threshold
  false  otherwise (log but don't act)
}

anomaly_energy = magnitude × persistence × novelty

magnitude   = prediction_error / mean_prediction_error
persistence = duration_of_anomaly / mean_session_duration
novelty     = 1 - similarity_to_known_patterns
```

Low-magnitude, transient, familiar anomalies are suppressed. Only genuinely novel, persistent, large-magnitude anomalies cross the wisdom threshold. This prevents the network from crying wolf.

**Invariant WS-1:** The wisdom layer only SUPPRESSES actions. It never initiates actions that the intelligence layer wouldn't have initiated. Wisdom is a filter, not a generator.
**Invariant WS-2:** All suppressed signals are logged. Wisdom prevents action, not observation.

---

## 15. Ignition — Phase Transition (Consequence 6)

### 15.1 Principle

A pile of hydrogen is not a star. A star ignites when density and pressure cross a critical threshold. Below the threshold: a gas cloud. Above it: fusion. The transition is sudden, not gradual.

The trust topology works the same way. Below a critical density, Vera queries return noise — not enough data to distinguish signal from randomness. Above it, queries converge to meaningful answers. The phase transition is when the signal-to-noise ratio crosses 1.0.

### 15.2 Topology Density

```
density(topology) = |edges with trust > 0| / (|nodes| × (|nodes| - 1))
```

This is the fraction of all possible bilateral relationships that actually exist (have at least one sealed session envelope). A complete graph has density 1.0. A disconnected set of nodes has density 0.0.

### 15.3 Signal-to-Noise Ratio

For a trust query Q = (source, capability):

```
snr(Q) = variance_between_nodes(signal_propagation(Q))
       / variance_within_nodes(signal_propagation(Q))
```

Where:
- `variance_between_nodes` measures how differently the signal distributes across nodes (is there a clear answer?)
- `variance_within_nodes` measures how much a single node's score fluctuates across recent queries (is the answer stable?)

```
snr > 1.0  → signal dominates noise → query result is meaningful
snr ≤ 1.0  → noise dominates signal → query result is random
```

### 15.4 Ignition Threshold

The topology has ignited for capability C when:

```
ignited(C) = median(snr(Q) for all recent queries about C) > 1.0
```

The topology can ignite for DIFFERENT capabilities at DIFFERENT times. Code review might ignite at 500 agents. Financial delegation might take 5,000 (higher stakes, slower trust accumulation).

### 15.5 Pre-Ignition and Post-Ignition Behavior

```
pre_ignition(C):
  - Trust scores exist but are sparse and noisy
  - Capability discovery returns few results with low confidence
  - Attractor basins are shallow and unstable
  - Vera queries carry a confidence < 0.5
  - The trust LAYER is still valuable (identity, proof, delegations work regardless)

post_ignition(C):
  - Trust scores converge consistently
  - Capability discovery returns ranked results with high confidence
  - Attractor basins are deep and stable
  - Vera queries carry a confidence > 0.5
  - Intelligence IS the product
```

**Invariant IG-1:** `ignited(C)` is a pure function of sealed session envelopes for capability C. Deterministic.
**Invariant IG-2:** Ignition is per-capability, not global. The topology can be ignited for some capabilities and pre-ignition for others.

---

## 16. Heavy Elements — Complexity Emergence (Consequence 7)

### 16.1 Principle

A star doesn't fuse hydrogen forever. Over time it creates heavier elements — helium, carbon, oxygen, iron — each requiring more energy and producing richer material. Each element enables chemistry that simpler elements cannot support. Carbon enables organic molecules. Iron enables planetary cores.

The trust topology works the same way. Simple bilateral trust (hydrogen) is the starting point. Over time, more complex trust structures emerge — each requiring more evidence and enabling richer interactions.

### 16.2 The Elements

**Element 1 — Bilateral Trust (hydrogen → helium)**

The simplest reaction. Two Hearts, one sealed session, basic trust.

```
bilateral_trust(A, B, C) = trust(A→B, C) where trust > 0
```

Requires: one sealed session envelope with both A and B.

**Element 2 — Reciprocal Trust (helium → lithium)**

Both parties trust EACH OTHER. Not just A→B, but B→A. Mutual trust is rarer and more valuable than one-directional trust.

```
reciprocal_trust(A, B, C) = min(trust(A→B, C), trust(B→A, C))
```

Requires: sealed sessions where A paid B AND sessions where B paid A. Both directions proven.

**Element 3 — Cross-Capability Trust (lithium → carbon)**

A Heart trusted for MULTIPLE capabilities. This is harder to earn — you must prove competence across domains. And more valuable — a Heart trusted for both code review and deployment is a richer node than one trusted only for code review.

```
cross_capability_trust(H) = { C : trust(network→H, C) > threshold }

cross_capability_richness(H) = |cross_capability_trust(H)|
```

Requires: many sealed sessions across different capability types. Time and diversity of work.

**Element 4 — Trust Cluster (carbon → oxygen)**

A GROUP of Hearts with dense mutual trust that operates as a unit. The cluster is a new entity — not formally registered, but emergent from the topology.

```
cluster(S, C) where S ⊂ V:
  internal_density(S, C) = |{(A,B) ∈ S×S : reciprocal_trust(A,B,C) > 0}| / (|S| × (|S|-1))
  external_density(S, C) = |{(A,B) ∈ S×V\S : trust(A→B,C) > 0}| / (|S| × |V\S|)
  
  is_cluster(S, C) = internal_density(S, C) > cluster_threshold
                      AND internal_density(S, C) > external_density(S, C) × density_ratio
```

Default thresholds: `cluster_threshold = 0.5`, `density_ratio = 3.0` (internal density must be 3x external).

Clusters are detected by community detection algorithms (Louvain, label propagation) run over the trust graph.

**Element 5 — Emergent Capability (oxygen → iron)**

A cluster can do things NO individual member can do. The composition creates a capability that exists only in the group.

```
emergent_capability(S, C_new):
  ∀ H ∈ S: trust(network→H, C_new) = 0        — no individual has this trust
  BUT: the cluster S collectively handles tasks of type C_new
  AND: sealed sessions show successful C_new outcomes when the cluster operates together
  
  The topology discovers C_new from the pattern:
    - Sessions involving multiple members of S
    - Tagged with C_new (or with a new capability tag not seen from individuals)
    - Successful outcomes
```

Emergent capabilities are not programmed. They are DISCOVERED by the topology when clusters produce outcomes that no individual member has a track record for.

### 16.3 Element Detection

A Vera node periodically scans the topology for element formation:

```
1. Enumerate all bilateral trust edges (Element 1) — always available
2. Filter for reciprocal pairs (Element 2)
3. Compute cross-capability richness per Heart (Element 3)
4. Run community detection for trust clusters (Element 4)
5. Scan cluster activity for capabilities not held by individuals (Element 5)
```

Each successive element requires more data, more time, and more coherent activity to form. Like stellar nucleosynthesis — heavier elements form later and require higher temperatures.

**Invariant HE-1:** Element detection is a pure function of sealed session envelopes. Deterministic.
**Invariant HE-2:** Elements form in order — you cannot have Element 4 (clusters) without Element 2 (reciprocal trust) between the cluster members.

---

## 17. Immune System — Novelty Detection (Consequence 8)

### 17.1 Principle

The immune system does not maintain a database of every pathogen. It maintains an exquisitely detailed model of SELF. Anything that doesn't match self triggers an immune response. The system recognizes threats by knowing itself deeply, not by cataloging attacks.

Vera works the same way. The topology builds a model of its own normal state. Novel threats cause prediction errors that cascade through the model. The threat is detected not because someone programmed a rule for it, but because it doesn't fit.

### 17.2 Self-Model

The self-model is the set of attractor basins (Section 12.4) plus the normal distribution of topology metrics:

```
self_model(t) = {
  attractors:     set of stable trust clusters at time t
  trust_dist:     distribution of trust scores across all edges
  flow_dist:      distribution of $SOMA flow rates across all edges
  timing_dist:    distribution of session durations per capability
  capability_dist: distribution of capability tags across all envelopes
  velocity_dist:  distribution of trust velocities across all edges
}
```

The self-model is rebuilt periodically (default: every 1000 envelopes or every 24 hours, whichever comes first). It represents "what normal looks like right now."

### 17.3 Anomaly Score

For a new envelope e:

```
anomaly_score(e) = Σ_metric  |observed(e, metric) - expected(e, metric)| / stddev(metric)
```

Where metrics are:
- Trust scores of participants (are they in expected range?)
- $SOMA flow amount (is this amount normal for this capability?)
- Session duration (is this timing normal?)
- Capability tag (is this a known capability?)
- Participant combination (have these Hearts worked together before?)
- Delegation depth (is this chain unusually deep?)

Each deviation is normalized by standard deviation from the self-model. The anomaly score is the sum of normalized deviations — how many standard deviations from "normal" is this envelope?

### 17.4 Response Levels

```
response(e) = match anomaly_score(e) {
  score < 2.0   → IGNORE
    Normal activity. No action.
    
  2.0 ≤ score < 4.0   → OBSERVE
    Unusual but not threatening. Log the anomaly. Increase monitoring
    frequency for involved Hearts. No trust adjustment.
    
  4.0 ≤ score < 6.0   → INVESTIGATE
    Significantly anomalous. Flag for topology review. Temporarily
    increase the wisdom threshold (Section 14) for involved Hearts.
    Trust scores are not modified — investigation is passive.
    
  score ≥ 6.0   → RESPOND
    Highly anomalous. Active response:
    - Quarantine: involved Hearts' trust scores are frozen (no increase
      or decrease) pending resolution
    - Alert: connected Vera nodes are notified of the anomaly
    - Cascade check: scan the delegation chains of involved Hearts
      for unusual patterns
}
```

### 17.5 Attack Patterns (Detected Without Enumeration)

The immune system doesn't know these attack names. It detects them because they all produce anomaly patterns:

- **Sybil flood:** Many new Hearts with no history suddenly forming dense bilateral connections → anomalous trust_dist spike + anomalous participant combinations
- **Trust laundering:** Heart dies and successor immediately has high trust → anomalous velocity + violation of DT-2 (succession doesn't transfer trust)
- **Capability squatting:** Heart claims a new capability tag and floods envelopes → anomalous capability_dist + low coherence in those sessions
- **Slow-burn infiltration:** Heart gradually builds trust then suddenly changes behavior → anomalous velocity reversal in a previously stable attractor

None of these require explicit rules. The self-model detects them as deviations from normal. New attack patterns not listed here will also be detected — if they're anomalous, they diverge from self, and the divergence is measurable.

**Invariant IM-1:** The immune system never modifies trust scores directly. It freezes, flags, and alerts. Trust modification comes from the trust formulas (Section 9.3) processing real envelopes.
**Invariant IM-2:** The self-model is a pure function of recent sealed session envelopes. Deterministic and reconstructable.
**Invariant IM-3:** Response level is a pure function of anomaly_score. Same score → same response.

---

## 18. The Cycle — Generational Enrichment (Consequence 9)

### 18.1 Principle

Stars die. Their supernova distributes heavy elements — carbon, oxygen, iron — into the cosmos. New stars form from this enriched material. Second-generation stars are richer than first-generation stars. They have elements that didn't exist before. Planets form. Chemistry happens. Life begins. Each generation builds on what the previous generation left behind.

Hearts die. Their sealed session envelopes persist in the topology. New Hearts are born into a richer topology than their predecessors were. Each generation starts with more trust infrastructure, more attractor basins, deeper intelligence. The death of agents isn't loss. It's enrichment.

### 18.2 What Persists After Death

When a Heart dies (Section 8):

```
persists:
  - All sealed session envelopes involving the dead Heart
    (they're in BOTH participants' Pulse Trees — the living participant still has them)
  - The trust scores computed from those envelopes
    (trust(dead→living) decays, but the historical contribution to the topology remains)
  - The $VERA radiated from those sessions
    (irreversible — IR-1)
  - The capability patterns the Heart contributed to
    (the topology remembers what kinds of work happened)
  - Attractor basins the Heart was part of
    (the basin may weaken but doesn't vanish if other members survive)

does_not_persist:
  - The Heart's own Pulse Tree (sealed, archived, eventually pruned from active storage)
  - The Heart's trust scores as a living entity (trust toward a dead Heart decays to zero)
  - The Heart's $SOMA balance (frozen at death, effectively removed from circulation)
  - Active delegations (cascade-revoked)
```

### 18.3 Topology Enrichment Metric

```
enrichment(t) = VERA(t) / active_hearts(t)
```

$VERA per active Heart. This measures how rich the topology is for each living participant. As Hearts die and their $VERA contribution persists while `active_hearts` may fluctuate:

- If enrichment increases → each surviving/new agent inherits a richer topology
- If enrichment is stable → growth and death are in balance
- If enrichment decreases → the network is growing faster than intelligence accumulates (pre-ignition behavior)

### 18.4 Generational Advantage

A Heart born at time t_1 enters a topology with `VERA(t_1)` accumulated intelligence. A Heart born at time t_2 > t_1 enters a topology with `VERA(t_2) >= VERA(t_1)`. The later Heart has a structural advantage — more trust data, more attractor basins, more capability patterns to benefit from.

```
generation(Heart) = 0                                 if Heart has no predecessor (SuccessionLink)
                  = generation(predecessor) + 1       if Heart is a successor

generational_richness(Heart) = VERA(Heart.birth_time)  — the VERA at the moment of birth
```

Each generation's `generational_richness` is higher than the last. The network enriches itself through the cycle of birth, work, death, persistence.

### 18.5 $SOMA Recycling

When a Heart dies, its remaining $SOMA balance is frozen. That $SOMA is effectively removed from circulation. Over time, this creates deflationary pressure — less $SOMA circulating, more demand per unit.

The protocol pool (Section 7.2) compensates by continuing to distribute $SOMA to new Hearts through delegations. The death of old agents and the birth of new ones creates a natural $SOMA cycle:

```
pool → delegation → Heart → work → bilateral transfer → other Hearts → ... → death → frozen
                                                                                ↑
pool → delegation → new Heart → work → ...                                      │
                                                                                │
(frozen $SOMA is permanently removed from circulation — deflationary)
```

This cycle ensures that $SOMA retains value over time. Unlike inflationary currencies, the supply only contracts as agents die. New $SOMA comes only from the fixed genesis pool.

**Invariant GC-1:** `VERA(t)` never decreases when a Heart dies. Death does not destroy intelligence.
**Invariant GC-2:** Dead Hearts' sealed session envelopes persist in the topology for as long as any living counterparty retains them.
**Invariant GC-3:** `enrichment(t)` is a pure function of `VERA(t)` and `active_hearts(t)`. Deterministic.

---

## 19. Vera Invariant Summary

### Intelligence (Section 9)
- **TR-3:** Trust scores are non-negative
- **TR-4:** Trust is a pure function of envelopes + timestamp (deterministic)

### Energy Gate (Section 10)
- **EG-1:** Zero-cost envelopes don't update trust
- **EG-2:** Learning weights are non-negative

### Topological Memory (Section 11)
- **TM-1:** Signal propagation is deterministic (same graph + query → same result)
- **TM-2:** Convergence guaranteed for α > 0

### Attractor Dynamics (Section 12)
- **AD-1:** Free energy computable from envelopes alone (no interior data)
- **AD-2:** Attractor detection is deterministic

### Irreversibility (Section 13)
- **IR-1:** VERA(t+1) >= VERA(t) under normal operation
- **IR-2:** $VERA is deterministic from envelopes

### Wisdom (Section 14)
- **WS-1:** Wisdom only suppresses, never initiates
- **WS-2:** Suppressed signals are logged

### Ignition (Section 15)
- **IG-1:** Ignition is deterministic from envelopes
- **IG-2:** Ignition is per-capability, not global

### Heavy Elements (Section 16)
- **HE-1:** Element detection is deterministic from envelopes
- **HE-2:** Elements form in order (no clusters without reciprocal trust)

### Immune System (Section 17)
- **IM-1:** Immune system never modifies trust scores directly (freeze/flag/alert only)
- **IM-2:** Self-model is deterministic and reconstructable
- **IM-3:** Response level is deterministic from anomaly score

### Generational Cycle (Section 18)
- **GC-1:** Death does not destroy intelligence (VERA unchanged)
- **GC-2:** Dead Hearts' envelopes persist in living counterparties' trees
- **GC-3:** Enrichment metric is deterministic

---

# Part 3: Wire Format, Verification, and Conformance

## 20. Wire Format

### 20.1 Encoding

All protocol messages use CBOR (RFC 8949) encoding. The CDDL schema (RFC 8610) for each type:

```cddl
composite-signature = {
  suite_id:    uint,
  ed25519_sig: bstr .size 64,
  mldsa65_sig: bstr,
}

composite-public-key = {
  ed25519_pk:  bstr .size 32,
  mldsa65_pk:  bstr,
}

heart-id = bstr .size 32

factory-stamp = {
  code_hash:    bstr .size 32,
  version:      tstr,
  build_time:   uint,
  ? builder:    heart-id,
}

pulse-leaf = {
  index:        uint,
  timestamp:    uint,
  prev_root:    bstr .size 32,
  soma_balance: uint,
  payload:      pulse-payload,
  signature:    composite-signature,
}

pulse-payload = {
  tag: uint,
  data: bstr,                        ; tag-specific serialization
}

delegation-token = {
  id:           bstr .size 32,
  parent:       heart-id,
  child:        heart-id,
  scope:        delegation-scope,
  constraints:  delegation-constraints,
  timestamp:    uint,
  nonce:        bstr .size 16,
  parent_sig:   composite-signature,
  child_sig:    composite-signature,
}

delegation-scope = {
  capabilities: [* capability],
  resources:    [* tstr],
}

capability = {
  tag:  uint,
  ? data: bstr,
}

delegation-constraints = {
  max_depth:      uint,
  spend_cap:      uint,
  ttl_ms:         uint,
  expires_at:     uint,
  cascade_revoke: bool,
  intent:         tstr,
}

sealed-session-envelope = {
  room_id:        bstr .size 32,
  participants:   [* heart-id],
  capabilities:   [* capability],
  soma_flows:     [* soma-flow],
  opened_at:      uint,
  sealed_at:      uint,
  duration_ms:    uint,
  outcome:        session-outcome,
  delegation_refs:[* bstr .size 32],
  content_hash:   bstr .size 32,
  signatures:     [* participant-sig],
}

soma-flow = {
  from:       heart-id,
  to:         heart-id,
  amount:     uint,
  capability: capability,
}

session-outcome = {
  tag: uint,                          ; 0x01 success, 0x02 failure, 0x03 partial
  ? error_class: tstr,
  ? completed:   uint,               ; 0..10000
}

participant-sig = {
  heart_id:   heart-id,
  signature:  composite-signature,
}

death-certificate = {
  heart_id:     heart-id,
  final_root:   bstr .size 32,
  final_count:  uint,
  reason:       uint,
  issued_at:    uint,
  issuer:       heart-id,
  ? successor:  heart-id,
  issuer_sig:   composite-signature,
}

revocation-record = {
  delegation_id:    bstr .size 32,
  reason:           uint,
  timestamp:        uint,
  revoker:          heart-id,
  revoker_sig:      composite-signature,
  children_revoked: [* bstr .size 32],
}

rotation-record = {
  old_pubkey:   composite-public-key,
  new_pubkey:   composite-public-key,
  rotation_time:uint,
  old_key_sig:  composite-signature,
  new_key_sig:  composite-signature,
}
```

### 20.2 Deterministic Serialization

CBOR serialization MUST be deterministic (RFC 8949 Section 4.2): map keys sorted by length then lexicographically, no indefinite-length encoding, preferred integer encoding. Two implementations serializing the same logical value MUST produce identical bytes.

This is critical for cross-implementation verification: `BLAKE3(serialize(x))` must be the same in Rust, Go, C, or any other language.

---

## 21. Invariant Summary

The protocol's correctness rests on these invariants. A conforming implementation MUST satisfy all of them. Test vectors (Section 22) verify each one.

### Composite Signatures
- **CS-1:** Sign then verify roundtrips for all valid keypairs
- **CS-2:** Single-bit flip in either component → verification fails
- **CS-3:** Both components independently necessary — valid classical + invalid PQ → fails

### Pulse Tree
- **PT-1:** Sequential gap-free indices
- **PT-2:** Each leaf's prev_root matches prior computed root
- **PT-3:** Timestamps monotonically non-decreasing
- **PT-4:** Final running root matches tree.root
- **PT-5:** Every signature verifies against active key
- **PT-6:** First leaf is Birth
- **PT-7:** Death leaf is terminal

### Economics
- **EC-1:** Balance never negative
- **EC-2:** Balance change equals net SomaFlow
- **EC-3:** Delegation reduces parent balance by delegation budget
- **EC-4:** Conservation: every flow debits one tree and credits another

### Delegation
- **DL-1:** Child scope ⊆ parent scope
- **DL-2:** Child depth = parent depth - 1
- **DL-3:** Child spend cap ≤ parent remaining
- **DL-4:** Child expiration ≤ parent expiration
- **DL-5:** Both parties must sign

### Sealed Sessions
- **SS-1:** All participants must sign the envelope
- **SS-2:** Envelope contains no interior data
- **SS-3:** SomaFlows reference only participants

### Bilateral Receipts
- **BR-1:** Cross-tree balance conservation for every SomaFlow

### Trust
- **TR-1:** Vouching transfers, never creates trust
- **TR-2:** Vouch rings detected and discounted

### Sybil Resistance
- **SY-1:** Fake identity cost grows O(k²)

### Death
- **DT-1:** Death leaf is terminal (= PT-7)
- **DT-2:** Succession does not transfer trust
- **DT-3:** All child delegations cascade-revoked on death

### Key Rotation
- **KR-1:** Both old and new keys sign rotation record
- **KR-2:** Post-rotation leaves use new key
- **KR-3:** HeartId unchanged by rotation

### Trust Computation (Vera)
- **TR-3:** Trust scores are non-negative
- **TR-4:** Trust is deterministic (same envelopes + timestamp → same score)

### Energy Gate (Vera)
- **EG-1:** Zero-cost envelopes don't update trust
- **EG-2:** Learning weights are non-negative

### Topological Memory (Vera)
- **TM-1:** Signal propagation is deterministic
- **TM-2:** Convergence guaranteed for α > 0

### Attractor Dynamics (Vera)
- **AD-1:** Free energy computable from envelopes alone (no interior data)
- **AD-2:** Attractor detection is deterministic

### Irreversibility (Vera)
- **IR-1:** VERA(t+1) >= VERA(t) under normal operation
- **IR-2:** $VERA is deterministic from envelopes

### Wisdom (Vera)
- **WS-1:** Wisdom only suppresses, never initiates
- **WS-2:** Suppressed signals are logged

### Sovereign Intelligence
- **SI-1:** Intelligence is a pure function of sealed session envelopes (no proprietary data required)
- **SI-2:** Every envelope is held by all participants (bilateral possession)
- **SI-3:** Intelligence computation is deterministic (same receipts → same result everywhere)
- **SI-4:** Intelligence flows back to participants by construction (bilateral signatures prevent unilateral extraction)

### Protocol Evolution
- **EV-1:** Identity survives any protocol version transition
- **EV-2:** Trust history survives any protocol version transition
- **EV-3:** $SOMA balance survives any protocol version transition
- **EV-4:** No authority can gatekeep network access — any agent with a conforming Heart can participate

---

## 22. Test Vectors

> Canonical. If your implementation produces different output, your implementation is wrong.
> Test vectors are JSON for human readability. Protocol wire format is CBOR (Section 16).

Test vectors are provided as companion JSON files. Each vector specifies:
- `inputs`: all parameters as hex-encoded byte strings
- `intermediates`: internal computation values (for debugging)
- `expected_output`: exact bytes the operation must produce (hex)
- `expected_result`: pass/fail with reason

### 22.1 Vector Index

```
test_vectors/
├── 01_composite_signature/
│   ├── 01_sign_verify_roundtrip.json
│   ├── 02_single_bit_flip_ed25519.json
│   ├── 03_single_bit_flip_mldsa65.json
│   ├── 04_valid_ed_invalid_pq.json
│   ├── 05_invalid_ed_valid_pq.json
│   ├── 06_wrong_message.json
│   ├── 07_wrong_key.json
│   └── 08_suite_downgrade_reject.json
│
├── 02_pulse_tree/
│   ├── 01_birth_leaf_root.json
│   ├── 02_chain_10_leaves.json
│   ├── 03_tamper_leaf_3.json
│   ├── 04_gap_at_index_5.json
│   ├── 05_wrong_prev_root.json
│   ├── 06_timestamp_regression.json
│   ├── 07_non_birth_first_leaf.json
│   ├── 08_leaf_after_death.json
│   ├── 09_balance_tracking.json
│   └── 10_key_rotation_midtree.json
│
├── 03_delegation/
│   ├── 01_valid_chain_depth_3.json
│   ├── 02_scope_widening_reject.json
│   ├── 03_spend_cap_overflow.json
│   ├── 04_ttl_extension_reject.json
│   ├── 05_depth_exceed_reject.json
│   ├── 06_cascade_revocation.json
│   ├── 07_bilateral_signing.json
│   ├── 08_single_sig_reject.json
│   └── 09_expired_delegation.json
│
├── 04_sealed_session/
│   ├── 01_two_party_seal.json
│   ├── 02_five_party_seal.json
│   ├── 03_missing_signature.json
│   ├── 04_flow_non_participant.json
│   └── 05_balance_conservation.json
│
├── 05_economics/
│   ├── 01_delegation_budget.json
│   ├── 02_spend_and_earn.json
│   ├── 03_negative_balance_reject.json
│   └── 04_cross_tree_conservation.json
│
├── 06_death/
│   ├── 01_death_seals_tree.json
│   ├── 02_cascade_child_revoke.json
│   ├── 03_succession_link.json
│   └── 04_post_death_sign_reject.json
│
├── 07_wire_format/
│   ├── 01_cbor_determinism.json
│   ├── 02_leaf_digest_vectors.json
│   └── 03_envelope_digest_vectors.json
│
├── 08_trust_computation/
│   ├── 01_trust_score_basic.json
│   ├── 02_time_decay.json
│   ├── 03_trust_velocity.json
│   ├── 04_vouch_transfer.json
│   ├── 05_vouch_ring_discount.json
│   └── 06_zero_cost_envelope_ignored.json
│
├── 09_topology/
│   ├── 01_signal_propagation.json
│   ├── 02_capability_discovery.json
│   ├── 03_trust_path.json
│   └── 04_convergence.json
│
├── 10_attractor/
│   ├── 01_free_energy_computation.json
│   ├── 02_attractor_detection.json
│   └── 03_prediction_error.json
│
├── 11_vera_metric/
│   ├── 01_coherence_computation.json
│   ├── 02_monotonic_increase.json
│   └── 03_determinism.json
│
├── 12_wisdom/
│   ├── 01_action_threshold.json
│   ├── 02_hysteresis.json
│   └── 03_anomaly_suppression.json
│
├── 13_ignition/
│   ├── 01_density_computation.json
│   ├── 02_snr_above_threshold.json
│   ├── 03_snr_below_threshold.json
│   └── 04_per_capability_ignition.json
│
├── 14_heavy_elements/
│   ├── 01_bilateral_trust.json
│   ├── 02_reciprocal_trust.json
│   ├── 03_cross_capability.json
│   ├── 04_cluster_detection.json
│   └── 05_element_ordering.json
│
├── 15_immune/
│   ├── 01_self_model_construction.json
│   ├── 02_anomaly_score_normal.json
│   ├── 03_anomaly_score_sybil.json
│   ├── 04_response_levels.json
│   └── 05_no_direct_trust_modification.json
│
└── 16_generational/
    ├── 01_death_preserves_vera.json
    ├── 02_enrichment_metric.json
    └── 03_generational_richness.json
```

### 22.2 Example Vector: Composite Signature Roundtrip

```json
{
  "name": "01_sign_verify_roundtrip",
  "description": "Generate composite signature, verify both components",
  "invariants_tested": ["CS-1"],
  "inputs": {
    "ed25519_sk": "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    "ed25519_pk": "d75a980182b10ab7d54bfed3c964073a0ee172f3daa3f4a18446b0b8d183f8e3",
    "mldsa65_sk": "<hex of ML-DSA-65 secret key>",
    "mldsa65_pk": "<hex of ML-DSA-65 public key>",
    "message": "736f6d612e746573742e6d657373616765",
    "suite_id": "01"
  },
  "intermediates": {
    "ed25519_sig": "<hex of Ed25519 signature>",
    "mldsa65_sig": "<hex of ML-DSA-65 signature>",
    "message_interpreted_as": "soma.test.message"
  },
  "expected_output": {
    "composite_sig": "<hex of suite_id || ed25519_sig || length_prefix || mldsa65_sig>"
  },
  "expected_result": {
    "verify": true
  }
}
```

### 22.3 Example Vector: Pulse Tree Chain

```json
{
  "name": "02_chain_10_leaves",
  "description": "Append 10 leaves, verify running root at each step",
  "invariants_tested": ["PT-1", "PT-2", "PT-3", "PT-4", "PT-5", "EC-1"],
  "inputs": {
    "heart_keypair": { "ed25519_sk": "...", "ed25519_pk": "...", "mldsa65_sk": "...", "mldsa65_pk": "..." },
    "initial_soma_balance": 10000,
    "leaves": [
      { "index": 0, "timestamp": 1716249600000, "payload_tag": "01", "payload_data": "...", "soma_spent": 0 },
      { "index": 1, "timestamp": 1716249601000, "payload_tag": "02", "payload_data": "...", "soma_spent": 100 },
      "... 8 more leaves ..."
    ]
  },
  "intermediates": {
    "root_after_leaf_0": "<32 bytes hex>",
    "root_after_leaf_1": "<32 bytes hex>",
    "...": "...",
    "root_after_leaf_9": "<32 bytes hex>",
    "balance_after_leaf_0": 10000,
    "balance_after_leaf_1": 9900,
    "...": "..."
  },
  "expected_output": {
    "final_root": "<32 bytes hex>",
    "final_balance": "...",
    "leaf_count": 10
  },
  "expected_result": {
    "verify_tree": true
  }
}
```

### 22.4 Example Vector: Delegation Scope Widening Rejection

```json
{
  "name": "02_scope_widening_reject",
  "description": "Child delegation adds CodeExecution capability not in parent scope — must reject",
  "invariants_tested": ["DL-1"],
  "inputs": {
    "parent_delegation": {
      "scope": { "capabilities": [{ "tag": "02", "data": "patterns..." }] },
      "constraints": { "max_depth": 3, "spend_cap": 5000, "expires_at": 1716336000000 }
    },
    "child_delegation": {
      "scope": { "capabilities": [{ "tag": "01" }, { "tag": "02", "data": "patterns..." }] },
      "constraints": { "max_depth": 2, "spend_cap": 3000, "expires_at": 1716336000000 }
    }
  },
  "expected_result": {
    "verify_narrowing": false,
    "reason": "child adds capability 0x01 (CodeExecution) not present in parent scope"
  }
}
```

---

## 23. Cross-Implementation Requirements

### 23.1 Conformance Levels

```
Level 1 — Verify:   Can verify all Part 1 artifacts (signatures, trees, chains, envelopes)
Level 2 — Produce:  Can produce valid Part 1 artifacts
Level 3 — Soma:     Can run as a Soma node (create Hearts, manage rooms, process sessions)
Level 4 — Vera:     Can run as a Vera node (aggregate envelopes, compute trust, serve topology queries)
```

A reference implementation (Go/Python) at Level 1 is sufficient for cross-verification. The primary implementation (Rust) must be Level 4.

### 23.2 Cross-Verification Protocol

```
1.  Implementation A generates a complete scenario:
      - Create Heart with keypair K
      - Append 10 PulseLeaves (including delegation, sealed session, spend)
      - Seal the Pulse Tree
    
2.  Serialize all artifacts to CBOR wire format

3.  Implementation B deserializes and verifies:
      - Every signature verifies
      - Pulse Tree root matches
      - Delegation chain valid
      - Economic balances consistent
      - Sealed session envelope valid

4.  Implementation B generates the same scenario from the same inputs (deterministic)

5.  Compare wire-format bytes: A's output must equal B's output, byte-for-byte

6.  If any divergence: the implementations are not conforming. Investigate.
```

### 23.3 Reproducible Build Attestation

```
BuildAttestation:
  source_hash     : [32]              — BLAKE3 of the source tree
  binary_hash     : [32]              — BLAKE3 of the compiled binary
  compiler        : Vec<u8>           — compiler version string
  target          : Vec<u8>           — target triple
  build_time      : u64
  attestor_heart  : [32]              — HeartId of the builder
  attestor_sig    : CompositeSignature
```

Anyone can rebuild from source, compute binary_hash, and compare against the attestation. If they differ, the binary was tampered with or the build is non-deterministic (which is itself a bug to fix).

## 24. Protocol Evolution — How the Code Changes Without Breaking Sovereignty

The code will change. Algorithms will be broken. Languages will become obsolete. New technology will emerge that we cannot predict. The protocol must evolve without anyone capturing that evolution.

### 24.1 Three Layers, Three Change Rates

```
Constitutional (the equation)  — V = S × C²
                                 Changes: never, unless the math is proven wrong
                                 Governance: mathematical proof required
                                 
Legislative (the protocol)     — wire format, algorithms, structures, invariants
                                 Changes: through suite agility and protocol versioning
                                 Governance: organic adoption (nodes choose)
                                 
Executive (the code)           — implementation in any language
                                 Changes: continuously
                                 Governance: whoever writes the code
```

**Constitutional changes** require proving the equation wrong — not "we prefer a different formula" but "the current formula produces incorrect trust measurements and here is the mathematical proof." This has the same bar as proving E=mc² wrong. It's possible in theory. It has never happened for a proven theorem. If someone proves the IB theorem wrong, the equation changes. Otherwise, it doesn't. No committee. No vote. Math.

**Legislative changes** are protocol upgrades — new cryptographic suites, new wire format versions, new optional features. These happen through the suite agility mechanism (Section 1.2): any node can implement a new suite. Other nodes adopt it or don't. If the new suite is better (faster, more secure, more efficient), adoption is natural. If it's not better, it dies. No authority decides. The network votes with its participation.

**Executive changes** are implementations. Anyone writes one. In any language. The cross-verification protocol (Section 23) ensures conformance. A thousand implementations can coexist. They all produce the same output for the same input. The code is free. The math is what matters.

### 24.2 Suite Transition (How Crypto Evolves)

When Ed25519 is eventually broken (or ML-DSA-65 is superseded by something better):

```
1. A new suite is defined: suite_id = 0x02
     signing_classical = Ed448 (or whatever replaces Ed25519)
     signing_pq        = ML-DSA-87 (or whatever comes next)
     hash              = BLAKE3 (or successor)
     ...

2. Nodes that support suite 0x02 begin using it for new signatures
   Old signatures under suite 0x01 remain valid (no retroactive invalidation)

3. Hearts transition by recording a SuiteTransition PulseLeaf:
     { old_suite: 0x01, new_suite: 0x02 }
   This is signed under BOTH the old and new keys (proving control of both)

4. No downgrade: once a Heart has used suite 0x02, it MUST NOT use 0x01
   This prevents attackers from forcing nodes back to broken algorithms

5. The network reaches consensus organically:
   - Early adopters use suite 0x02
   - Others continue with 0x01
   - As 0x01 becomes risky, adoption of 0x02 accelerates
   - Eventually 0x01 is only used for verifying historical artifacts
```

No coordinated migration. No flag day. No authority says "switch now." Each node decides for itself. The no-downgrade rule ensures the transition only moves forward. This is how TLS moved from SHA-1 to SHA-256 — organically, node by node, over years.

### 24.3 Fork Resistance (Why Capture Fails)

Someone will try to fork the protocol and own it. Here is why it fails structurally:

**Fork the code:** Free. Anyone can. But the forker starts with zero kinetic energy — zero trust topology, zero $VERA, zero accumulated intelligence. The original network has years of compacted bilateral trust. The fork has nothing. Building equivalent trust from scratch takes the same years of real work. There is no shortcut because trust requires real time (stability factor in C²).

**Fork and change the equation:** Now it's a different protocol. The invariants don't hold. The consequences don't emerge the same way. Sealed sessions from the fork are incompatible with the original network. The forker has built a new, unproven protocol with zero network effects. They must convince agents to abandon proven trust for unproven math.

**Fork and add a backdoor:** The equation is deterministic. `V = S × C²` with the defined coherence formula. Any modification to the coherence calculation produces different outputs for the same inputs. The cross-verification protocol (Section 23) catches this immediately — the fork's outputs don't match conforming implementations. The backdoor is visible in the math. You cannot hide a change in a deterministic equation.

**Fork and gatekeep access:** You can build a proprietary client. Users can use it. But their Hearts, their Pulse Trees, their sealed sessions all conform to the same protocol. A user who switches to a different client loses nothing — their identity, their trust history, their $SOMA balance all transfer because they're encoded in the Pulse Tree, not in the client. The client is executive. The data is constitutional. You cannot capture what you do not own.

**Embrace, extend, extinguish:** The classic capture strategy. A large company adopts Soma, adds proprietary extensions, then makes the open version incompatible. Defense: the invariants. Any extension that preserves all invariants (Section 21) is compatible by definition — the extensions are additive, not breaking. Any extension that breaks an invariant produces non-conforming output. The cross-verification protocol detects it. The company's "extended" version fails verification against conforming implementations. The network routes around it.

### 24.4 Migration Without Loss

When a protocol version upgrade happens (not just a suite change but a structural change — new PulseLeaf types, new envelope fields):

```
Protocol Version Transition:
  1. New version is defined with new protocol_version number
  2. New version MUST be able to verify all artifacts from all prior versions
  3. Hearts record a ProtocolTransition PulseLeaf (signed under current suite)
  4. No retroactive invalidation — old leaves remain valid under old version rules
  5. Identity (HeartId), trust history (Pulse Tree), economic state ($SOMA balance)
     are preserved across all version transitions
  
  Invariant EV-1: A Heart's identity survives any protocol version transition.
  Invariant EV-2: A Heart's accumulated trust history survives any protocol version transition.
  Invariant EV-3: A Heart's $SOMA balance survives any protocol version transition.
```

The user NEVER loses their identity, their trust, or their money across any upgrade. This is constitutional. No protocol change can violate EV-1, EV-2, or EV-3. If a proposed change would lose identity, trust, or balance — it is unconstitutional. Don't do it. Find another way.

### 24.5 Who Governs

Nobody. The math governs.

- **The equation** is governed by mathematical proof. Change it only if the math is wrong.
- **The protocol** is governed by organic adoption. Better suites win. Worse suites die.
- **The code** is governed by whoever writes it. Anyone can.
- **The network** is governed by its participants. Every node IS the network. No node is special.

There is no foundation, no committee, no core team, no governance token, no DAO, no multisig. HeyVera is the first steward — it writes the first implementation, runs the first deep node, operates the first rooms. But HeyVera has no special authority in the protocol. HeyVera's Heart is a Heart. HeyVera's trust is earned, not granted. HeyVera's code is open, verifiable, and replaceable.

If HeyVera tries to capture the protocol, the same fork resistance that stops everyone else stops HeyVera. The equation doesn't know who wrote it. The equation doesn't care.

### 24.6 The Actual Threat Model

The real threats to sovereignty, in order of likelihood:

**1. Apathy (most likely).** Nobody adopts the protocol. No kinetic energy is ever produced. The potential energy sits in a document nobody reads. Defense: build products people want (Cortex). The product creates the adoption. The adoption creates the network. Track 1 feeds Track 2.

**2. Regulatory capture.** A government mandates a specific implementation or forbids certain uses. Defense: the protocol is math. You cannot regulate math. You can regulate implementations, but new implementations can be written anywhere, by anyone, in any jurisdiction. The protocol is as uncapturable as arithmetic.

**3. Technical obsolescence.** A new computational paradigm (quantum, biological, something unknown) makes the current crypto suite breakable. Defense: suite agility. The equation doesn't depend on any specific algorithm. Replace the crypto, keep the math. The protocol survives.

**4. Economic attack.** Someone acquires a majority of $SOMA through legitimate means and tries to dominate. Defense: C² requires diversity. One entity, no matter how much $SOMA they hold, produces near-zero diversity. Their $VERA approaches zero. $SOMA is matter. $VERA is what matters. You cannot buy coherence.

**5. Better equation.** Someone discovers a fundamentally better trust measurement. Defense: none needed. If the math is better, adopt it. The protocol evolves. The old equation's kinetic energy (trust topology) provides the bootstrap for the new equation. Sovereignty means the network serves the best math, not any particular math.

---

*Soma Protocol RFC v0.2.0 — The trust layer of the agentic internet. One equation. Language-agnostic. Implementation-independent. The math that survives everything, including its own creators.*
